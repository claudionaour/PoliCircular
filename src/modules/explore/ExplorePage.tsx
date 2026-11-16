import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  Heart,
  Layers,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { listApprovedProducts } from '../../services/productService';
import {
  listActiveCommunes,
  listCategories,
  listSectorsByCommune,
} from '../../services/territorialService';
import { upsertProductInterest } from '../../services/matchingService';
import { isSupabaseConfigured } from '../../services/supabase';
import { SupabaseSetupNotice } from '../../components/SupabaseSetupNotice';
import { ImageWithFallback } from '../../components/ImageWithFallback';
import { CONDITION_LABELS, formatChileDate, MODALITY_LABELS } from '../../utils/formatters';
import type {
  Category,
  Commune,
  InterestDecision,
  Product,
  ProductCondition,
  ProductModality,
  Sector,
} from '../../types/domain';

type ViewMode = 'cards' | 'list' | 'swipe';

export const ExplorePage: React.FC = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [showFilters, setShowFilters] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [communeId, setCommuneId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [modality, setModality] = useState<ProductModality | ''>('');
  const [condition, setCondition] = useState<ProductCondition | ''>('');
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d'>('all');

  const [loading, setLoading] = useState(true);
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listCategories(), listActiveCommunes()])
      .then(([cats, comms]) => {
        setCategories(cats);
        setCommunes(comms);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!communeId) {
      setSectors([]);
      setSectorId('');
      return;
    }
    listSectorsByCommune(communeId, true).then(setSectors).catch(() => setSectors([]));
  }, [communeId]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listApprovedProducts({
        search,
        categoryId: categoryId || undefined,
        communeId: communeId || undefined,
        sectorId: sectorId || undefined,
        modality,
        condition,
        dateRange,
        onlyAvailable: true,
      });
      setProducts(items);
      setSwipeIndex(0);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search, categoryId, communeId, sectorId, modality, condition, dateRange]);

  useEffect(() => {
    const timer = setTimeout(loadProducts, 200);
    return () => clearTimeout(timer);
  }, [loadProducts]);

  const handleInterest = async (product: Product, decision: InterestDecision) => {
    if (!user) {
      setFeedback('Inicia sesión para guardar intereses o favoritos.');
      return;
    }
    try {
      await upsertProductInterest(product.id, user.id, decision);
      const label =
        decision === 'interested'
          ? 'Interés registrado (recuerda enviar solicitud para generar Match).'
          : decision === 'favorite'
            ? 'Guardado en tus favoritos.'
            : 'Producto descartado de tu vista de deslizamiento.';
      setFeedback(label);
      if (viewMode === 'swipe') {
        setSwipeIndex((idx) => idx + 1);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No fue posible guardar tu acción.');
    }
  };

  const currentSwipeProduct = products[swipeIndex];

  const onPointerDown = (e: React.PointerEvent) => {
    setDragStartX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStartX === null) return;
    setDragOffsetX(e.clientX - dragStartX);
  };
  const onPointerUp = () => {
    if (dragStartX === null || !currentSwipeProduct) {
      setDragStartX(null);
      setDragOffsetX(0);
      return;
    }
    if (dragOffsetX > 90) {
      handleInterest(currentSwipeProduct, 'interested');
    } else if (dragOffsetX < -90) {
      handleInterest(currentSwipeProduct, 'discarded');
    }
    setDragStartX(null);
    setDragOffsetX(0);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <SupabaseSetupNotice />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#102C49]">
            Explorar productos aprobados
          </h1>
          <p className="text-sm text-slate-600">
            Solo se muestran publicaciones verificadas y disponibles para regalo o intercambio sin dinero.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F4F6F8] border border-slate-200 rounded-xl self-start">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'cards' ? 'bg-white text-[#102C49] shadow-sm' : 'text-slate-600'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Tarjetas</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'list' ? 'bg-white text-[#102C49] shadow-sm' : 'text-slate-600'
            }`}
          >
            <List className="h-4 w-4" />
            <span>Listado</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('swipe')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'swipe' ? 'bg-white text-[#102C49] shadow-sm' : 'text-slate-600'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Deslizar</span>
          </button>
        </div>
      </div>

      {/* Buscador y barra de filtros */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o descripción..."
              className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:border-[#102C49] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-[#102C49] hover:bg-[#F4F6F8] min-h-[44px]"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filtros</span>
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-100">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Filtrar por categoría"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={communeId}
              onChange={(e) => setCommuneId(e.target.value)}
              aria-label="Filtrar por comuna"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="">Todas las comunas</option>
              {communes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              disabled={!communeId}
              aria-label="Filtrar por sector"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white disabled:opacity-50"
            >
              <option value="">Todos los sectores</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={modality}
              onChange={(e) => setModality(e.target.value as ProductModality | '')}
              aria-label="Filtrar por modalidad"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="">Regalo o Intercambio</option>
              <option value="gift">Solo regalo gratuito</option>
              <option value="exchange">Solo intercambio</option>
            </select>

            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as ProductCondition | '')}
              aria-label="Filtrar por estado"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="">Todos los estados</option>
              {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as 'all' | '7d' | '30d')}
              aria-label="Filtrar por fecha"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="all">Cualquier fecha</option>
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Últimos 30 días</option>
            </select>
          </div>
        )}
      </div>

      {feedback && (
        <div className="rounded-xl bg-[#E6F4EA] border border-[#1E7E48]/30 px-4 py-2.5 text-xs text-[#1E7E48] flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-semibold underline">
            Cerrar
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-80 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center space-y-3">
          <h2 className="font-display text-lg font-bold text-[#102C49]">
            {isSupabaseConfigured
              ? 'No hay productos aprobados con esos filtros'
              : 'Conecta Supabase para visualizar el catálogo comunitario'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {isSupabaseConfigured
              ? 'Prueba limpiando los filtros o publica un objeto para darle una segunda oportunidad.'
              : 'Cuando configures las credenciales de Supabase y apruebes publicaciones en moderación, aparecerán aquí.'}
          </p>
          {user && (
            <Link
              to="/publicar"
              className="inline-block px-5 py-2.5 rounded-xl bg-[#F28C28] text-white text-sm font-semibold"
            >
              Publicar producto
            </Link>
          )}
        </div>
      ) : viewMode === 'swipe' ? (
        <div className="max-w-md mx-auto py-4">
          {currentSwipeProduct ? (
            <div className="space-y-4">
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ transform: `translateX(${dragOffsetX}px) rotate(${dragOffsetX * 0.03}deg)` }}
                className="rounded-3xl bg-white border border-slate-200 shadow-md overflow-hidden select-none touch-pan-y transition-transform duration-150"
              >
                <div className="h-72 bg-[#F4F6F8]">
                  <ImageWithFallback
                    src={
                      currentSwipeProduct.product_images?.find((i) => i.is_primary)?.public_url ||
                      currentSwipeProduct.product_images?.[0]?.public_url
                    }
                    alt={currentSwipeProduct.title}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                </div>
                <div className="p-5 space-y-2.5">
                  <div className="text-xs text-slate-500">
                    <span className="font-semibold text-[#F28C28]">
                      {MODALITY_LABELS[currentSwipeProduct.modality]}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>{currentSwipeProduct.categories?.name}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{CONDITION_LABELS[currentSwipeProduct.condition]}</span>
                  </div>
                  <h2 className="font-display text-xl font-bold text-[#102C49]">
                    {currentSwipeProduct.title}
                  </h2>
                  <p className="text-sm text-slate-600 line-clamp-3">
                    {currentSwipeProduct.description}
                  </p>
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                    <span>
                      {currentSwipeProduct.sectors?.name || currentSwipeProduct.communes?.name}
                    </span>
                    <Link
                      to={`/producto/${currentSwipeProduct.id}`}
                      className="font-semibold text-[#102C49] hover:underline"
                    >
                      Abrir detalle
                    </Link>
                  </div>
                </div>
              </div>

              {/* Botones accesibles alternativos al deslizamiento */}
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => handleInterest(currentSwipeProduct, 'discarded')}
                  aria-label="Descartar producto"
                  className="h-14 w-14 rounded-full bg-white border border-slate-300 text-slate-600 hover:border-red-400 hover:text-red-600 flex items-center justify-center shadow-sm"
                >
                  <X className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => handleInterest(currentSwipeProduct, 'favorite')}
                  aria-label="Guardar en favoritos"
                  className="h-12 w-12 rounded-full bg-white border border-slate-300 text-[#102C49] hover:border-[#F28C28] hover:text-[#F28C28] flex items-center justify-center shadow-sm"
                >
                  <Bookmark className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleInterest(currentSwipeProduct, 'interested')}
                  aria-label="Me interesa este producto"
                  className="h-14 w-14 rounded-full bg-[#F28C28] text-white hover:bg-[#D97719] flex items-center justify-center shadow-sm"
                >
                  <Heart className="h-6 w-6" />
                </button>
              </div>
              <p className="text-center text-xs text-slate-500">
                Desliza hacia la derecha para mostrar interés o hacia la izquierda para descartar.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-3">
              <p className="font-display font-bold text-[#102C49]">Revisaste todas las tarjetas</p>
              <button
                type="button"
                onClick={() => setSwipeIndex(0)}
                className="px-4 py-2 rounded-xl bg-[#102C49] text-white text-xs font-semibold"
              >
                Volver a empezar
              </button>
            </div>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-200">
          {products.map((product) => {
            const img =
              product.product_images?.find((i) => i.is_primary)?.public_url ||
              product.product_images?.[0]?.public_url;
            return (
              <div
                key={product.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F4F6F8]/60 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="h-20 w-24 rounded-xl overflow-hidden bg-[#F4F6F8] shrink-0 border border-slate-200">
                    <ImageWithFallback src={img} alt={product.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold text-[#F28C28]">
                        {MODALITY_LABELS[product.modality]}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{product.categories?.name}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{CONDITION_LABELS[product.condition]}</span>
                    </div>
                    <Link
                      to={`/producto/${product.id}`}
                      className="font-display font-bold text-base text-[#102C49] hover:underline block"
                    >
                      {product.title}
                    </Link>
                    <p className="text-xs text-slate-600 line-clamp-1">{product.description}</p>
                    <p className="text-xs text-slate-500">
                      {product.communes?.name}
                      {product.sectors ? ` · ${product.sectors.name}` : ''} ·{' '}
                      {product.profiles?.full_name} ({Number(product.profiles?.reputation_avg ?? 0).toFixed(1)} ★)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/producto/${product.id}`}
                    className="px-4 py-2 rounded-xl bg-[#102C49] text-white text-xs font-semibold whitespace-nowrap"
                  >
                    Ver detalle
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => {
            const img =
              product.product_images?.find((i) => i.is_primary)?.public_url ||
              product.product_images?.[0]?.public_url;
            return (
              <article
                key={product.id}
                className="rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col hover:border-[#102C49]/40 transition-colors"
              >
                <Link to={`/producto/${product.id}`} className="block h-52 bg-[#F4F6F8] overflow-hidden">
                  <ImageWithFallback
                    src={img}
                    alt={product.title}
                    fallbackTitle={product.title}
                    className="w-full h-full object-cover"
                  />
                </Link>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <div className="text-xs text-slate-500">
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

                    <Link
                      to={`/producto/${product.id}`}
                      className="font-display font-bold text-lg text-[#102C49] hover:text-[#F28C28] transition-colors block line-clamp-1"
                    >
                      {product.title}
                    </Link>

                    <p className="text-sm text-slate-600 line-clamp-2">{product.description}</p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="truncate">
                      <span className="font-medium text-[#102C49]">
                        {product.profiles?.institution_name || product.profiles?.full_name}
                      </span>
                      <span className="text-slate-400"> · </span>
                      <span className="inline-flex items-center gap-0.5 tabular-nums">
                        <Star className="h-3 w-3 text-[#F28C28] fill-[#F28C28]" />
                        {Number(product.profiles?.reputation_avg ?? 0).toFixed(1)}
                      </span>
                      <div className="text-[11px] text-slate-500 truncate">
                        {product.communes?.name}
                        {product.sectors ? ` · ${product.sectors.name}` : ''} ·{' '}
                        {formatChileDate(product.created_at)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleInterest(product, 'favorite')}
                      aria-label="Guardar favorito"
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:text-[#F28C28] hover:border-[#F28C28]"
                    >
                      <Bookmark className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
