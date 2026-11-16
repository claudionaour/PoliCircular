import { isSupabaseConfigured, requireSupabase } from './supabase';
import type { Product, ProductCondition, ProductModality } from '../types/domain';

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  communeId?: string;
  sectorId?: string;
  modality?: ProductModality | '';
  condition?: ProductCondition | '';
  onlyAvailable?: boolean;
  dateRange?: 'all' | '7d' | '30d';
}

const PRODUCT_SELECT = `
  *,
  categories(id, slug, name, icon_name, estimated_weight_kg),
  communes(id, name, region, latitude, longitude),
  sectors(id, name, approx_lat, approx_lng),
  profiles!products_owner_id_fkey(id, full_name, username, avatar_url, account_type, institution_name, reputation_avg, reputation_count, is_minor_supervised),
  product_images(id, storage_path, public_url, is_primary, sort_order)
`;

export async function listApprovedProducts(filters: ProductFilters = {}): Promise<Product[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  let query = sb
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (filters.onlyAvailable !== false) {
    query = query.gt('available_quantity', 0);
  }
  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId);
  }
  if (filters.communeId) {
    query = query.eq('commune_id', filters.communeId);
  }
  if (filters.sectorId) {
    query = query.eq('sector_id', filters.sectorId);
  }
  if (filters.modality) {
    query = query.eq('modality', filters.modality);
  }
  if (filters.condition) {
    query = query.eq('condition', filters.condition);
  }
  if (filters.dateRange === '7d') {
    const d = new Date(Date.now() - 7 * 86400000).toISOString();
    query = query.gte('created_at', d);
  } else if (filters.dateRange === '30d') {
    const d = new Date(Date.now() - 30 * 86400000).toISOString();
    query = query.gte('created_at', d);
  }
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function listMyProducts(userId: string): Promise<Product[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProductById(productId: string): Promise<Product | null> {
  if (!isSupabaseConfigured) return null;
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', productId)
    .maybeSingle();
  if (error) throw error;
  return data as Product | null;
}

export interface CreateProductInput {
  ownerId: string;
  title: string;
  description: string;
  categoryId: string;
  condition: ProductCondition;
  modality: ProductModality;
  desiredExchangeItems?: string;
  totalQuantity: number;
  communeId: string;
  sectorId?: string | null;
  deliveryMethod: string;
  images: { file: File; isPrimary: boolean }[];
}

export async function createProductWithImages(input: CreateProductInput): Promise<Product> {
  const sb = requireSupabase();

  const { data: created, error: insertError } = await sb
    .from('products')
    .insert({
      owner_id: input.ownerId,
      title: input.title.trim(),
      description: input.description.trim(),
      category_id: input.categoryId,
      condition: input.condition,
      modality: input.modality,
      desired_exchange_items:
        input.modality === 'exchange' ? input.desiredExchangeItems?.trim() || null : null,
      total_quantity: input.totalQuantity,
      available_quantity: input.totalQuantity,
      reserved_quantity: 0,
      commune_id: input.communeId,
      sector_id: input.sectorId || null,
      delivery_method: input.deliveryMethod.trim(),
      status: 'pending',
    })
    .select('*')
    .single();

  if (insertError) throw insertError;

  const productId = created.id as string;

  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i];
    const storagePath = `${input.ownerId}/${productId}/${Date.now()}_${i}.webp`;
    const { error: uploadError } = await sb.storage
      .from('product-images')
      .upload(storagePath, img.file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = sb.storage.from('product-images').getPublicUrl(storagePath);

    const { error: imgRowError } = await sb.from('product_images').insert({
      product_id: productId,
      storage_path: storagePath,
      public_url: urlData.publicUrl,
      is_primary: img.isPrimary,
      sort_order: i,
    });

    if (imgRowError) throw imgRowError;
  }

  const full = await getProductById(productId);
  return full ?? (created as Product);
}

export async function archiveOwnProduct(productId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('products')
    .update({ status: 'archived' })
    .eq('id', productId);
  if (error) throw error;
}
