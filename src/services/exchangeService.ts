import { isSupabaseConfigured, requireSupabase } from './supabase';
import type { ExchangeRecord, Review } from '../types/domain';

export async function listUserExchanges(userId: string): Promise<ExchangeRecord[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .select(`
      *,
      exchange_confirmations(*),
      matches!inner(
        *,
        target_product:products!matches_target_product_id_fkey(id, title, modality, product_images(public_url, is_primary)),
        offered_product:products!matches_offered_product_id_fkey(id, title),
        owner:profiles!matches_owner_id_fkey(id, full_name, username, avatar_url),
        requester:profiles!matches_requester_id_fkey(id, full_name, username, avatar_url)
      )
    `)
    .or(`owner_id.eq.${userId},requester_id.eq.${userId}`, { foreignTable: 'matches' })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExchangeRecord[];
}

export async function proposeExchangeDelivery(params: {
  exchangeId: string;
  proposedBy: string;
  proposedDate: string;
  proposedTimeSlot: string;
  meetingPointLabel: string;
  meetingPointLat?: number | null;
  meetingPointLng?: number | null;
  agreed?: boolean;
}): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('exchanges')
    .update({
      proposed_by: params.proposedBy,
      proposed_date: params.proposedDate,
      proposed_time_slot: params.proposedTimeSlot,
      meeting_point_label: params.meetingPointLabel.trim(),
      meeting_point_lat: params.meetingPointLat ?? null,
      meeting_point_lng: params.meetingPointLng ?? null,
      status: params.agreed ? 'delivery_agreed' : 'coordinating',
    })
    .eq('id', params.exchangeId);
  if (error) throw error;
}

export async function confirmExchangeDeliveryRpc(params: {
  exchangeId: string;
  notes?: string;
  measuredWeightKg?: number | null;
}): Promise<ExchangeRecord> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('confirm_exchange_delivery', {
    p_exchange_id: params.exchangeId,
    p_notes: params.notes?.trim() || null,
    p_measured_weight_kg: params.measuredWeightKg ?? null,
  });
  if (error) throw error;
  return data as ExchangeRecord;
}

export async function cancelExchangeAgreementRpc(
  exchangeId: string,
  reason: string
): Promise<ExchangeRecord> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('cancel_exchange_agreement', {
    p_exchange_id: exchangeId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as ExchangeRecord;
}

export async function markExchangeDispute(exchangeId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('exchanges')
    .update({ status: 'disputed' })
    .eq('id', exchangeId);
  if (error) throw error;
}

export async function submitExchangeReviewRpc(params: {
  exchangeId: string;
  compliance: number;
  punctuality: number;
  condition: number;
  communication: number;
  respect: number;
  comment?: string;
}): Promise<Review> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('submit_exchange_review', {
    p_exchange_id: params.exchangeId,
    p_compliance: params.compliance,
    p_punctuality: params.punctuality,
    p_condition: params.condition,
    p_communication: params.communication,
    p_respect: params.respect,
    p_comment: params.comment?.trim() || null,
  });
  if (error) throw error;
  return data as Review;
}

export async function listUserReviews(userId: string): Promise<Review[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reviews')
    .select('*, reviewer:profiles!reviews_reviewer_id_fkey(id, full_name, username, avatar_url)')
    .eq('reviewed_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Review[];
}

export async function listMySubmittedReviewExchangeIds(userId: string): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reviews')
    .select('exchange_id')
    .eq('reviewer_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.exchange_id as string);
}
