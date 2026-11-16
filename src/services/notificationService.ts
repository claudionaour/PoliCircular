import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, requireSupabase } from './supabase';
import type { AppNotification } from '../types/domain';

export async function listNotifications(userId: string): Promise<AppNotification[]> {
  if (!isSupabaseConfigured) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

export function subscribeUserNotifications(
  userId: string,
  onNewNotification: (notif: AppNotification) => void
): RealtimeChannel {
  const sb = requireSupabase();
  return sb
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onNewNotification(payload.new as AppNotification)
    )
    .subscribe();
}
