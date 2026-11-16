import { isSupabaseConfigured, requireSupabase } from './supabase';
import type { InterestDecision, MatchRecord, MatchRequest, ProductModality } from '../types/domain';

export async function upsertProductInterest(
  productId: string,
  userId: string,
  decision: InterestDecision
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('product_interests')
    .upsert(
      {
        product_id: productId,
        user_id: userId,
        decision,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id,user_id' }
    );
  if (error) throw error;
}

export async function listUserInterests(userId: string) {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('product_interests')
    .select(
      '*, products(*, categories(name), communes(name), sectors(name), product_images(*))'
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createMatchRequest(params: {
  targetProductId: string;
  requesterId: string;
  ownerId: string;
  modality: ProductModality;
  offeredProductId?: string | null;
  requestedQuantity: number;
  message?: string;
}): Promise<MatchRequest> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('match_requests')
    .insert({
      target_product_id: params.targetProductId,
      requester_id: params.requesterId,
      owner_id: params.ownerId,
      modality: params.modality,
      offered_product_id: params.modality === 'exchange' ? params.offeredProductId || null : null,
      requested_quantity: params.requestedQuantity,
      message: params.message?.trim() || null,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as MatchRequest;
}

export async function listMatchRequests(userId: string): Promise<MatchRequest[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('match_requests')
    .select(`
      *,
      target_product:products!match_requests_target_product_id_fkey(id, title, modality, available_quantity, product_images(public_url, is_primary)),
      offered_product:products!match_requests_offered_product_id_fkey(id, title, modality, product_images(public_url, is_primary)),
      requester:profiles!match_requests_requester_id_fkey(id, full_name, username, avatar_url, reputation_avg),
      owner:profiles!match_requests_owner_id_fkey(id, full_name, username, avatar_url, reputation_avg)
    `)
    .or(`owner_id.eq.${userId},requester_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MatchRequest[];
}

export async function acceptMatchRequestRpc(requestId: string): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('accept_match_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as string;
}

export async function updateMatchRequestStatus(
  requestId: string,
  status: 'rejected' | 'cancelled' | 'chat_requested'
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('match_requests').update({ status }).eq('id', requestId);
  if (error) throw error;
}

export async function listUserMatches(userId: string): Promise<MatchRecord[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('matches')
    .select(`
      *,
      target_product:products!matches_target_product_id_fkey(id, title, modality, condition, product_images(public_url, is_primary)),
      offered_product:products!matches_offered_product_id_fkey(id, title, product_images(public_url, is_primary)),
      owner:profiles!matches_owner_id_fkey(id, full_name, username, avatar_url, reputation_avg),
      requester:profiles!matches_requester_id_fkey(id, full_name, username, avatar_url, reputation_avg),
      conversations(*),
      exchanges(*, exchange_confirmations(*))
    `)
    .or(`owner_id.eq.${userId},requester_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MatchRecord[];
}

export async function getMatchDetail(matchId: string): Promise<MatchRecord | null> {
  if (!isSupabaseConfigured) return null;
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('matches')
    .select(`
      *,
      target_product:products!matches_target_product_id_fkey(id, title, modality, condition, delivery_method, communes(name), sectors(name), product_images(public_url, is_primary)),
      offered_product:products!matches_offered_product_id_fkey(id, title, product_images(public_url, is_primary)),
      owner:profiles!matches_owner_id_fkey(id, full_name, username, avatar_url, reputation_avg, is_minor_supervised, account_type, institution_name),
      requester:profiles!matches_requester_id_fkey(id, full_name, username, avatar_url, reputation_avg, is_minor_supervised, account_type, institution_name),
      conversations(*),
      exchanges(*, exchange_confirmations(*))
    `)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  return data as MatchRecord | null;
}
