import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Flag, Gift, RefreshCw, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getProductById, listMyProducts } from '../../services/productService';
import { createMatchRequest, upsertProductInterest } from '../../services/matchingService';
import { ImageWithFallback } from '../../components/ImageWithFallback';
import { OsmSectorMap } from '../../components/OsmSectorMap';
import { ReportModal } from '../../components/ReportModal';
import { CONDITION_LABELS, formatChileDate, MODALITY_LABELS } from '../../utils/formatters';
import type { Product } from '../../types/domain';

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [myApprovedProducts, setMyApprovedProducts] = useState<Product[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  const [offeredProductId, setOfferedProductId] = useState('');
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const [requestMessage, setRequestMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getProductById(id)
      .then((p) => setProduct(p))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!user) return;
    listMyProducts(user.id)
      .then((items) => {
        const approved = items.filter((p) => p.status === 'approved' && p.available_quantity > 0);
        setMyApprovedProducts(approved);
      })
      .catch(() => setMyApprovedProducts([]));
  }, [user]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !product) {
      navigate('/iniciar-sesion');
      return;
    }
    setSubmitting(true);
    setStatusMsg(null);
    try {
      await upsertProductInterest(product.id, user.id, 'interested');
      await createMatchRequest({
        targetProductId: product.id,
        requesterId: user.id,
        ownerId: product.owner_id,
        modality: product.modality,
        offeredProductId: product.modality === 'exchange' ? offeredProductId || null : null,
        requestedQuantity,
        message: requestMessage,
      });
      setStatusMsg({
        type: 'ok',
        text: 'Solicitud enviada. Cuando el propietario acepte, se creará el Match y el chat privado.',
      });
      setRequestMessage('');
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No fue posible enviar la solicitud.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="max-w-5xl mx-auto p-6 text-sm text-slate-500">Cargando publicación...</div>;
  }

  if (!product) {
    return (
      <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl border border-slate-200 text-center space-y-3">
        <p className="font-display font-bold text-[#102C49]">Publicación no disponible</p>
        <Link to="/explorar" className="text-sm font-semibold text-[#F28C28] hover:underline">
          Volver a Explorar
        </Link>
      </div>
    );
  }

  const images = [...(product.product_images ?? [])].sort((a, b) =>
    a.is_primary === b.is_primary ? a.sort_order - b.sort_order : a.is_primary ? -1 : 1
  );
  const currentImg = images[activePhotoIndex]?.public_url;
  const isOwner = user?.id === product.owner_id;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link
        to="/explorar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#102C49] hover:text-[#F28C28]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Volver al catálogo</span>
      </Link>

      <div className="grid lg:grid-cols-12 gap-8">
        {/* Galería + Mapa aproximado */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-3xl overflow-hidden border border-slate-200 bg-[#F4F6F8] aspect-[4/3]">
            <ImageWithFallback
              src={currentImg}
              alt={product.title}
              fallbackTitle={product.title}
              className="w-full h-full object-cover"
            />
          </div>

          {images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActivePhotoIndex(idx)}
                  className={`h-16 w-20 rounded-xl overflow-hidden border shrink-0 ${
                    idx === activePhotoIndex ? 'border-[#F28C28] ring-2 ring-[#F28C28]/40' : 'border-slate-200'
                  }`}
                >
                  <ImageWithFallback src={img.public_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <OsmSectorMap
            latitude={product.sectors?.approx_lat ?? product.communes?.latitude}
            longitude={product.sectors?.approx_lng ?? product.communes?.longitude}
            label={`Sector aproximado: ${product.sectors?.name || product.communes?.name}`}
            heightClass="h-56"
          />
        </div>

        {/* Detalles y Solicitud */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <div className="text-xs text-slate-600">
              <span
                className={`font-semibold ${
                  product.modality === 'gift' ? 'text-[#1E7E48]' : 'text-[#F28C28]'
                }`}
              >
                {MODALITY_LABELS[product.modality]}
              </span>
              <span aria-hidden="true"> · </span>
              <span>{product.categories?.name}</span>
              <span aria-hidden="true"> · </span>
              <span>{CONDITION_LABELS[product.condition]}</span>
            </div>

            <h1 className="font-display text-2xl font-bold text-[#102C49]">{product.title}</h1>

            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {product.description}
            </p>

            {product.modality === 'exchange' && product.desired_exchange_items && (
              <div className="rounded-xl bg-[#FFF8F1] border border-[#F28C28]/30 p-3.5 text-xs text-[#102C49]">
                <strong>Busca intercambiar por:</strong> {product.desired_exchange_items}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
              <div>
                <span className="text-slate-500 block">Disponibilidad</span>
                <span className="font-semibold text-[#102C49] tabular-nums">
                  {product.available_quantity} de {product.total_quantity} unidad(es)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Entrega sugerida</span>
                <span className="font-semibold text-[#102C49]">{product.delivery_method}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Comuna y sector</span>
                <span className="font-semibold text-[#102C49]">
                  {product.communes?.name}
                  {product.sectors ? ` · ${product.sectors.name}` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Publicado</span>
                <span className="font-semibold text-[#102C49]">{formatChileDate(product.created_at)}</span>
              </div>
            </div>

            {/* Oferente */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl overflow-hidden bg-[#F4F6F8] border border-slate-200">
                  <ImageWithFallback
                    src={product.profiles?.avatar_url}
                    alt={product.profiles?.full_name || 'Oferente'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#102C49]">
                    {product.profiles?.institution_name || product.profiles?.full_name}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1 tabular-nums">
                    <Star className="h-3.5 w-3.5 text-[#F28C28] fill-[#F28C28]" />
                    <span>
                      {Number(product.profiles?.reputation_avg ?? 0).toFixed(1)} (
                      {product.profiles?.reputation_count ?? 0} reseñas)
                    </span>
                  </p>
                </div>
              </div>

              {user && !isOwner && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => upsertProductInterest(product.id, user.id, 'favorite')}
                    className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:text-[#F28C28]"
                    aria-label="Guardar favorito"
                  >
                    <Bookmark className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReport(true)}
                    className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:text-red-600"
                    aria-label="Denunciar publicación"
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Formulario de solicitud / intercambio */}
          {!isOwner && product.status === 'approved' && product.available_quantity > 0 && (
            <form
              onSubmit={handleRequestSubmit}
              className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4"
            >
              <div className="flex items-center gap-2 font-display font-bold text-base text-[#102C49]">
                {product.modality === 'gift' ? (
                  <>
                    <Gift className="h-5 w-5 text-[#1E7E48]" />
                    <span>Me interesa este regalo</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-5 w-5 text-[#F28C28]" />
                    <span>Proponer intercambio</span>
                  </>
                )}
              </div>

              {product.available_quantity > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-[#102C49] mb-1">
                    Unidades solicitadas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={product.available_quantity}
                    value={requestedQuantity}
                    onChange={(e) => setRequestedQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
              )}

              {product.modality === 'exchange' && (
                <div>
                  <label className="block text-xs font-semibold text-[#102C49] mb-1">
                    Asociar uno de tus productos aprobados (opcional)
                  </label>
                  <select
                    value={offeredProductId}
                    onChange={(e) => setOfferedProductId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
                  >
                    <option value="">Acordar producto directamente por chat</option>
                    {myApprovedProducts.map((mp) => (
                      <option key={mp.id} value={mp.id}>
                        {mp.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#102C49] mb-1">
                  Mensaje para {product.profiles?.full_name}
                </label>
                <textarea
                  rows={3}
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  placeholder="Cuéntale por qué te sirve este objeto o qué propones para coordinar."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {statusMsg && (
                <div
                  className={`rounded-xl p-3 text-xs ${
                    statusMsg.type === 'ok'
                      ? 'bg-[#E6F4EA] text-[#1E7E48]'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                >
                  {statusMsg.text}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#F28C28] py-3 text-sm font-semibold text-white hover:bg-[#D97719] transition-colors disabled:opacity-50 min-h-[44px]"
              >
                {submitting
                  ? 'Enviando solicitud...'
                  : product.modality === 'gift'
                    ? 'Enviar solicitud de regalo'
                    : 'Enviar propuesta de intercambio'}
              </button>
            </form>
          )}
        </div>
      </div>

      {showReport && (
        <ReportModal
          targetType="product"
          targetId={product.id}
          targetTitle={product.title}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
};
