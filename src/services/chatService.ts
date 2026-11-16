import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './supabase';
import type { Conversation, Message } from '../types/domain';

export async function getConversationByMatch(matchId: string): Promise<Conversation | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('conversations')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw error;
  return data as Conversation | null;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<Message> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body: body.trim(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Message;
}

export async function markConversationMessagesRead(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', currentUserId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function toggleConversationBlock(
  conversationId: string,
  userId: string,
  block: boolean
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('conversations')
    .update({
      is_blocked: block,
      blocked_by: block ? userId : null,
    })
    .eq('id', conversationId);
  if (error) throw error;
}

export function subscribeToConversationMessages(
  conversationId: string,
  onInsert: (msg: Message) => void,
  onUpdate: (msg: Message) => void
): RealtimeChannel {
  const sb = requireSupabase();
  return sb
    .channel(`chat:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert(payload.new as Message)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onUpdate(payload.new as Message)
    )
    .subscribe();
}
