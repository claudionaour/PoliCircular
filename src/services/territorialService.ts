import { isSupabaseConfigured, requireSupabase } from './supabase';
import type { Category, Commune, Sector } from '../types/domain';

export async function listActiveCommunes(): Promise<Commune[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('communes')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Commune[];
}

export async function listAllCommunes(): Promise<Commune[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb.from('communes').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Commune[];
}

export async function listSectorsByCommune(communeId: string, activeOnly = true): Promise<Sector[]> {
  if (!isSupabaseConfigured || !communeId) return [];
  const sb = requireSupabase();
  let query = sb.from('sectors').select('*').eq('commune_id', communeId).order('name', { ascending: true });
  if (activeOnly) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Sector[];
}

export async function listCategories(): Promise<Category[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}
