import { isSupabaseConfigured, requireSupabase } from './supabase';
import type {
  Achievement,
  ImpactRecord,
  UserAchievement,
  UserTreeProgress,
} from '../types/domain';

export async function getTreeProgress(userId: string): Promise<UserTreeProgress | null> {
  if (!isSupabaseConfigured) return null;
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_tree_progress')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as UserTreeProgress | null;
}

export async function listAllAchievements(): Promise<Achievement[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('achievements')
    .select('*')
    .order('required_operations', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Achievement[];
}

export async function listUserAchievements(userId: string): Promise<UserAchievement[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('user_achievements')
    .select('*, achievements(*)')
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserAchievement[];
}

export async function listImpactRecords(communeId?: string): Promise<ImpactRecord[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  let query = sb
    .from('impact_records')
    .select('*, categories(name), communes(name), sectors(name)')
    .order('created_at', { ascending: false });

  if (communeId) {
    query = query.eq('commune_id', communeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ImpactRecord[];
}

export async function getCommunityParticipationCounts(): Promise<{
  participantsCount: number;
  organizationsCount: number;
}> {
  if (!isSupabaseConfigured) return { participantsCount: 0, organizationsCount: 0 };
  const sb = requireSupabase();
  const [{ count: participantsCount }, { count: organizationsCount }] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', false),
    sb
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('account_type', ['organization', 'educational'])
      .eq('is_suspended', false),
  ]);
  return {
    participantsCount: participantsCount ?? 0,
    organizationsCount: organizationsCount ?? 0,
  };
}

export async function saveEducationModuleProgress(
  userId: string,
  moduleSlug: string,
  quizScore: number
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('education_progress').upsert(
    {
      user_id: userId,
      module_slug: moduleSlug,
      quiz_score: quizScore,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,module_slug' }
  );
  if (error) throw error;
}

export async function listEducationProgress(
  userId: string
): Promise<{ module_slug: string; quiz_score: number; completed_at: string }[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('education_progress')
    .select('module_slug, quiz_score, completed_at')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}
