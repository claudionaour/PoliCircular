import { isSupabaseConfigured, requireSupabase } from './supabase';
import type {
  Commune,
  EducationalInstitution,
  InstitutionBadge,
  ModerationLog,
  Product,
  Profile,
  ReportRecord,
  Sector,
} from '../types/domain';

export interface AdminDashboardStats {
  usersCount: number;
  pendingProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  requestsCount: number;
  matchesCount: number;
  completedExchanges: number;
  openReports: number;
}

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  if (!isSupabaseConfigured) {
    return {
      usersCount: 0,
      pendingProducts: 0,
      approvedProducts: 0,
      rejectedProducts: 0,
      requestsCount: 0,
      matchesCount: 0,
      completedExchanges: 0,
      openReports: 0,
    };
  }
  const sb = requireSupabase();
  const [
    usersRes,
    pendingRes,
    approvedRes,
    rejectedRes,
    requestsRes,
    matchesRes,
    exchangesRes,
    reportsRes,
  ] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    sb.from('match_requests').select('id', { count: 'exact', head: true }),
    sb.from('matches').select('id', { count: 'exact', head: true }),
    sb.from('exchanges').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    sb.from('reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
  ]);

  return {
    usersCount: usersRes.count ?? 0,
    pendingProducts: pendingRes.count ?? 0,
    approvedProducts: approvedRes.count ?? 0,
    rejectedProducts: rejectedRes.count ?? 0,
    requestsCount: requestsRes.count ?? 0,
    matchesCount: matchesRes.count ?? 0,
    completedExchanges: exchangesRes.count ?? 0,
    openReports: reportsRes.count ?? 0,
  };
}

export async function listModerationQueue(statusFilter?: string): Promise<Product[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  let query = sb
    .from('products')
    .select(`
      *,
      categories(id, name),
      communes(id, name),
      sectors(id, name),
      profiles!products_owner_id_fkey(id, full_name, username, account_type, institution_name),
      product_images(id, public_url, is_primary, sort_order)
    `)
    .order('created_at', { ascending: false });

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function moderateProductRpc(
  productId: string,
  action: 'approve' | 'reject' | 'suspend',
  reason?: string
): Promise<Product> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('moderate_product', {
    p_product_id: productId,
    p_action: action,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
  return data as Product;
}

export async function listModerationLogs(): Promise<ModerationLog[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('moderation_logs')
    .select('*, actor:profiles!moderation_logs_actor_id_fkey(full_name, username)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ModerationLog[];
}

export async function listUsersForAdmin(search?: string): Promise<Profile[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  let query = sb
    .from('profiles')
    .select('*, communes(id, name, region), sectors(id, name, approx_lat, approx_lng)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (search?.trim()) {
    const q = search.trim();
    query = query.or(`full_name.ilike.%${q}%,username.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function toggleUserSuspensionRpc(
  userId: string,
  suspend: boolean,
  reason?: string
): Promise<Profile> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_toggle_user_suspension', {
    p_target_user_id: userId,
    p_suspend: suspend,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
  return data as Profile;
}

export async function saveCommuneAdmin(payload: {
  id?: string;
  name: string;
  region: string;
  is_active: boolean;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<Commune> {
  const sb = requireSupabase();
  if (payload.id) {
    const { data, error } = await sb
      .from('communes')
      .update({
        name: payload.name.trim(),
        region: payload.region.trim(),
        is_active: payload.is_active,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
      })
      .eq('id', payload.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Commune;
  }
  const { data, error } = await sb
    .from('communes')
    .insert({
      name: payload.name.trim(),
      region: payload.region.trim(),
      is_active: payload.is_active,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Commune;
}

export async function saveSectorAdmin(payload: {
  id?: string;
  commune_id: string;
  name: string;
  description?: string;
  approx_lat?: number | null;
  approx_lng?: number | null;
  is_active: boolean;
}): Promise<Sector> {
  const sb = requireSupabase();
  if (payload.id) {
    const { data, error } = await sb
      .from('sectors')
      .update({
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        approx_lat: payload.approx_lat ?? null,
        approx_lng: payload.approx_lng ?? null,
        is_active: payload.is_active,
      })
      .eq('id', payload.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Sector;
  }
  const { data, error } = await sb
    .from('sectors')
    .insert({
      commune_id: payload.commune_id,
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      approx_lat: payload.approx_lat ?? null,
      approx_lng: payload.approx_lng ?? null,
      is_active: payload.is_active,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Sector;
}

export async function listEducationalInstitutions(): Promise<EducationalInstitution[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('educational_institutions')
    .select('*, communes(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EducationalInstitution[];
}

export async function saveEducationalInstitution(payload: {
  id?: string;
  name: string;
  institution_code?: string;
  commune_id?: string | null;
  responsible_name: string;
  badge_level: InstitutionBadge;
  is_verified: boolean;
}): Promise<EducationalInstitution> {
  const sb = requireSupabase();
  if (payload.id) {
    const { data, error } = await sb
      .from('educational_institutions')
      .update({
        name: payload.name.trim(),
        institution_code: payload.institution_code?.trim() || null,
        commune_id: payload.commune_id || null,
        responsible_name: payload.responsible_name.trim(),
        badge_level: payload.badge_level,
        is_verified: payload.is_verified,
      })
      .eq('id', payload.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as EducationalInstitution;
  }
  const { data, error } = await sb
    .from('educational_institutions')
    .insert({
      name: payload.name.trim(),
      institution_code: payload.institution_code?.trim() || null,
      commune_id: payload.commune_id || null,
      responsible_name: payload.responsible_name.trim(),
      badge_level: payload.badge_level,
      is_verified: payload.is_verified,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as EducationalInstitution;
}

export async function createReport(params: {
  reporterId: string;
  targetType: ReportRecord['target_type'];
  targetId: string;
  reasonCategory: string;
  description: string;
}): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('reports').insert({
    reporter_id: params.reporterId,
    target_type: params.targetType,
    target_id: params.targetId,
    reason_category: params.reasonCategory,
    description: params.description.trim(),
    status: 'open',
  });
  if (error) throw error;
}

export async function listReportsAdmin(): Promise<ReportRecord[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reports')
    .select('*, reporter:profiles!reports_reporter_id_fkey(id, full_name, username)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReportRecord[];
}

export async function resolveReportRpc(
  reportId: string,
  status: 'under_review' | 'resolved' | 'dismissed',
  resolutionNotes: string
): Promise<ReportRecord> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_status: status,
    p_resolution_notes: resolutionNotes.trim(),
  });
  if (error) throw error;
  return data as ReportRecord;
}
