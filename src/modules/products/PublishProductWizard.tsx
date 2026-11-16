import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Star,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  listActiveCommunes,
  listCategories,
  listSectorsByCommune,
} from '../../services/territorialService';
import { createProductWithImages } from '../../services/productService';
import { validateAndOptimizeImage } from '../../utils/imageOptimizer';
import { validateCommunityProductRules } from '../../utils/prohibitedContent';
import { CONDITION_LABELS, MODALITY_LABELS } from '../../utils/formatters';
import { OsmSectorMap } from '../../components/OsmSectorMap';
import type {
  Category,
  Commune,
  ProductCondition,
  ProductModality,
  Sector,
} from '../../types/domain';

interface LocalPhoto {
  id: string;
  file: File;
  previewUrl: string;
  sizeBytes: number;
  isPrimary: boolean;
}

const STEPS = ['Fotografías', 'Información', 'Modalidad', 'Ubicación', 'Confirmación'];

export const PublishProductWizard: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);

  // Paso 1: Fotografías (hasta 5)
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);

  // Paso 2: Información
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState<ProductCondition>('good');
  const [totalQuantity, setTotalQuantity] = useState(1);

  // Paso 3: Modalidad (nunca precios ni dinero)
  const [modality, setModality] = useState<ProductModality>('gift');
  const [desiredExchangeItems, setDesiredExchangeItems] = useState('');

  // Paso 4: Ubicación
  const [region, setRegion] = useState('Los Lagos');
  const [communeId, setCommuneId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('Punto de encuentro comunitario');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([listCategories(), listActiveCommunes()])
      .then(([cats, comms]) => {
        setCategories(cats);
        setCommunes(comms);
        if (cats[0]) setCategoryId(cats[0].id);
        const preferredCommune =
          comms.find((c) => c.id === profile?.commune_id) ||
          comms.find((c) => c.name === 'Castro') ||
          comms[0];
        if (preferredCommune) {
          setCommuneId(preferredCommune.id);
          setRegion(preferredCommune.region);
        }
        if (profile?.sector_id) {
          setSectorId(profile.sector_id);
        }
      })
      .catch(() => {});
  }, [profile]);

  useEffect(() => {
    if (!communeId) {
      setSectors([]);
      return;
    }
    const c = communes.find((item) => item.id === communeId);
    if (c) setRegion(c.region);
    listSectorsByCommune(communeId, true).then(setSectors).catch(() => setSectors([]));
  }, [communeId, communes]);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setError(null);

    if (photos.length + files.length > 5) {
      setError('Puedes subir un máximo de 5 fotografías por producto.');
      return;
    }

    try {
      const next: LocalPhoto[] = [];
      for (const f of files) {
        const opt = await validateAndOptimizeImage(f);
        next.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          file: opt.file,
          previewUrl: opt.previewUrl,
          sizeBytes: opt.sizeBytes,
          isPrimary: photos.length === 0 && next.length === 0,
        });
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error procesando imágenes.');
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      if (filtered.length > 0 && !filtered.some((p) => p.isPrimary)) {
        filtered[0].isPrimary = true;
      }
      return [...filtered];
    });
  };

  const setPrimaryPhoto = (id: string) => {
    setPhotos((prev) => prev.map((p) => ({ ...p, isPrimary: p.id === id })));
  };

  const validateStep = (currentStep: number): string | null => {
    if (currentStep === 0 && photos.length === 0) {
      return 'Agrega al menos 1 fotografía real del producto (máximo 5).';
    }
    if (currentStep === 1) {
      if (title.trim().length < 3) return 'Ingresa un nombre de producto de al menos 3 caracteres.';
      if (description.trim().length < 10) return 'Describe el producto con al menos 10 caracteres.';
      if (!categoryId) return 'Selecciona una categoría.';
      if (totalQuantity < 1) return 'La cantidad disponible debe ser al menos 1.';
      const ruleViolation = validateCommunityProductRules(title, description);
      if (ruleViolation) return ruleViolation;
    }
    if (currentStep === 2) {
      if (modality === 'exchange' && desiredExchangeItems.trim().length < 3) {
        return 'Describe qué productos te gustaría recibir en intercambio.';
      }
      if (modality === 'exchange') {
        const ruleViolation = validateCommunityProductRules(desiredExchangeItems, '');
        if (ruleViolation) return ruleViolation;
      }
    }
    if (currentStep === 3) {
      if (!communeId) return 'Selecciona la comuna.';
      if (deliveryMethod.trim().length < 4) return 'Indica el método de entrega sugerido.';
    }
    return null;
  };

  const nextStep = () => {
    const errMsg = validateStep(step);
    if (errMsg) {
      setError(errMsg);
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const handlePublish = async () => {
    if (!user) return;
    for (let i = 0; i < 4; i++) {
      const msg = validateStep(i);
      if (msg) {
        setError(msg);
        setStep(i);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProductWithImages({
        ownerId: user.id,
        title,
        description,
        categoryId,
        condition,
        modality,
        desiredExchangeItems,
        totalQuantity,
        communeId,
        sectorId: sectorId || null,
        deliveryMethod,
        images: photos.map((p) => ({ file: p.file, isPrimary: p.isPrimary })),
      });
      navigate('/mis-publicaciones', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible guardar la publicación en Supabase.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const selectedCommune = communes.find((c) => c.id === communeId);
  const selectedSector = sectors.find((s) => s.id === sectorId);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#102C49]">Publicar producto</h1>
        <p className="text-sm text-slate-600">
          Toda publicación queda en revisión obligatoria antes de mostrarse en Explorar. Sin precios ni dinero.
        </p>
      </div>

      {/* Indicador de pasos */}
      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((label, idx) => (
          <li
            key={label}
            className={`rounded-xl px-2 py-2.5 text-center text-xs font-semibold border transition-colors ${
              idx === step
                ? 'bg-[#102C49] text-white border-[#102C49]'
                : idx < step
                  ? 'bg-[#E6F4EA] text-[#1E7E48] border-[#1E7E48]/30'
                  : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            <span className="hidden sm:inline">{idx + 1}. {label}</span>
            <span className="sm:hidden">{idx + 1}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-6">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#102C49]">
              Paso 1: Fotografías (máximo 5)
            </h2>
            <p className="text-xs text-slate-600">
              Formatos aceptados: JPG, PNG o WebP. Las imágenes se optimizan automáticamente antes de subir.
            </p>

            <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-[#F4F6F8] p-8 cursor-pointer hover:border-[#F28C28] transition-colors">
              <ImagePlus className="h-8 w-8 text-[#102C49] mb-2" />
              <span className="text-sm font-semibold text-[#102C49]">
                Seleccionar fotografías ({photos.length}/5)
              </span>
              <span className="text-xs text-slate-500 mt-1">Máximo 10 MB por archivo original</span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFilesSelected}
                disabled={photos.length >= 5}
                className="sr-only"
              />
            </label>

            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className={`relative rounded-xl overflow-hidden border ${
                      photo.isPrimary ? 'border-[#F28C28] ring-2 ring-[#F28C28]/30' : 'border-slate-200'
                    }`}
                  >
                    <img
                      src={photo.previewUrl}
                      alt="Vista previa de producto"
                      className="w-full h-36 object-cover"
                    />
                    <div className="p-2 bg-white flex items-center justify-between gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setPrimaryPhoto(photo.id)}
                        className={`inline-flex items-center gap-1 font-semibold ${
                          photo.isPrimary ? 'text-[#F28C28]' : 'text-slate-600 hover:text-[#102C49]'
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${photo.isPrimary ? 'fill-[#F28C28]' : ''}`} />
                        <span>{photo.isPrimary ? 'Principal' : 'Hacer principal'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        aria-label="Eliminar fotografía"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#102C49]">Paso 2: Información del producto</h2>

            <div>
              <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Nombre del producto</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Silla de madera nativa o Mochila escolar"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Descripción</label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalla características, medidas aproximadas, detalles de uso o qué reparación requiere."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Categoría</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Estado</label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as ProductCondition)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
                >
                  {Object.entries(CONDITION_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Cantidad disponible</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={totalQuantity}
                  onChange={(e) => setTotalQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#102C49]">Paso 3: Modalidad sin dinero</h2>
            <p className="text-xs text-slate-600">
              PoliCircular no permite precios ni pagos. Elige cómo quieres dar una segunda oportunidad a este producto:
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setModality('gift')}
                className={`p-5 rounded-2xl border text-left transition-colors ${
                  modality === 'gift'
                    ? 'border-[#1E7E48] bg-[#E6F4EA]'
                    : 'border-slate-200 bg-white hover:bg-[#F4F6F8]'
                }`}
              >
                <div className="font-display font-bold text-base text-[#102C49]">REGALO GRATUITO</div>
                <p className="mt-1 text-xs text-slate-600">
                  Entregas el producto gratuitamente a quien lo necesite y selecciones en tus solicitudes.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setModality('exchange')}
                className={`p-5 rounded-2xl border text-left transition-colors ${
                  modality === 'exchange'
                    ? 'border-[#F28C28] bg-[#FFF8F1]'
                    : 'border-slate-200 bg-white hover:bg-[#F4F6F8]'
                }`}
              >
                <div className="font-display font-bold text-base text-[#102C49]">INTERCAMBIO</div>
                <p className="mt-1 text-xs text-slate-600">
                  Acuerdas intercambiar este producto por otro objeto aprobado sin utilizar dinero.
                </p>
              </button>
            </div>

            {modality === 'exchange' && (
              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">
                  ¿Qué productos te gustaría recibir a cambio?
                </label>
                <textarea
                  rows={3}
                  value={desiredExchangeItems}
                  onChange={(e) => setDesiredExchangeItems(e.target.value)}
                  placeholder="Ej. Libros juveniles, herramientas manuales, maceteros o lanas."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#102C49]">Paso 4: Ubicación aproximada</h2>
            <p className="text-xs text-slate-600">
              Tu domicilio particular nunca se muestra públicamente. Solo se indica comuna, sector y método de entrega.
            </p>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Región</label>
                <input
                  type="text"
                  value={region}
                  readOnly
                  className="w-full rounded-xl border border-slate-200 bg-[#F4F6F8] px-3.5 py-2.5 text-sm text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Comuna</label>
                <select
                  value={communeId}
                  onChange={(e) => {
                    setCommuneId(e.target.value);
                    setSectorId('');
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
                >
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Sector aproximado</label>
                <select
                  value={sectorId}
                  onChange={(e) => setSectorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
                >
                  <option value="">Comuna general</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Método de entrega</label>
              <select
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
              >
                <option value="Punto de encuentro comunitario">Punto de encuentro comunitario</option>
                <option value="Establecimiento educacional o sede">Establecimiento educacional o sede</option>
                <option value="Coordinación directa por chat privado">Coordinación directa por chat privado</option>
              </select>
            </div>

            <OsmSectorMap
              latitude={selectedSector?.approx_lat ?? selectedCommune?.latitude}
              longitude={selectedSector?.approx_lng ?? selectedCommune?.longitude}
              label={`Área aproximada: ${selectedSector?.name || selectedCommune?.name || 'Castro'}`}
              heightClass="h-52"
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[#102C49]">
              Paso 5: Vista previa y confirmación
            </h2>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-[#F4F6F8]">
              {photos[0] && (
                <img
                  src={(photos.find((p) => p.isPrimary) || photos[0]).previewUrl}
                  alt={title}
                  className="w-full h-56 object-cover"
                />
              )}
              <div className="p-5 bg-white space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-[#F28C28]">{MODALITY_LABELS[modality]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedCategory?.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{CONDITION_LABELS[condition]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{totalQuantity} unidad(es)</span>
                </div>
                <h3 className="font-display text-xl font-bold text-[#102C49]">{title}</h3>
                <p className="text-sm text-slate-600">{description}</p>
                {modality === 'exchange' && (
                  <p className="text-xs text-[#102C49] pt-1">
                    <strong>Busca intercambiar por:</strong> {desiredExchangeItems}
                  </p>
                )}
                <p className="text-xs text-slate-500 pt-2">
                  Ubicación referencial: {selectedCommune?.name}
                  {selectedSector ? ` · ${selectedSector.name}` : ''} · {deliveryMethod}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#FFF8F1] border border-[#F28C28]/40 p-3.5 text-xs text-[#102C49]">
              Al confirmar, la publicación quedará en estado <strong>Pendiente de moderación</strong> y aparecerá en Explorar una vez aprobada por el equipo moderador.
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep((s) => Math.max(0, s - 1));
            }}
            disabled={step === 0 || submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-[#F4F6F8] disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Anterior</span>
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={nextStep}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#102C49] text-white text-sm font-semibold hover:bg-[#0B2036]"
            >
              <span>Siguiente</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePublish}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#F28C28] text-white text-sm font-semibold hover:bg-[#D97719] disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <UploadCloud className="h-4 w-4 animate-bounce" />
                  <span>Enviando a moderación...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Enviar a moderación</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
