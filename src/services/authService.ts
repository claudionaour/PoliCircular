import { requireSupabase } from './supabase';
import type { AccountType, PrivateContact, Profile, UserRole } from '../types/domain';

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  username: string;
  communeId: string;
  sectorId?: string;
  accountType: AccountType;
  institutionName?: string;
  institutionDescription?: string;
  responsiblePerson?: string;
  institutionalCode?: string;
  privatePhone?: string;
  isMinorSupervised?: boolean;
  guardianAuthorizationNote?: string;
}

export async function registerUser(payload: RegisterPayload) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signUp({
    email: payload.email.trim(),
    password: payload.password,
    options: {
      emailRedirectTo: `${window.location.origin}/iniciar-sesion`,
      data: {
        full_name: payload.fullName.trim(),
        username: payload.username.trim().toLowerCase(),
        commune_id: payload.communeId,
        sector_id: payload.sectorId || null,
        account_type: payload.accountType,
        institution_name: payload.institutionName?.trim() || null,
        institution_description: payload.institutionDescription?.trim() || null,
        responsible_person: payload.responsiblePerson?.trim() || null,
        institutional_code: payload.institutionalCode?.trim() || null,
        private_phone: payload.privatePhone?.trim() || null,
        is_minor_supervised: Boolean(payload.isMinorSupervised),
        guardian_authorization_note: payload.guardianAuthorizationNote?.trim() || null,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signInUser(email: string, password: string) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const sb = requireSupabase();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordRecovery(email: string) {
  const sb = requireSupabase();
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/restablecer-contrasena`,
  });
  if (error) throw error;
}

export async function updateUserPassword(newPassword: string) {
  const sb = requireSupabase();
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function fetchUserProfile(userId: string): Promise<Profile | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('*, communes(id, name, region), sectors(id, name, approx_lat, approx_lng)')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function fetchUserRoles(userId: string): Promise<UserRole[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('user_roles').select('role').eq('user_id', userId);
  if (error) throw error;
  const roles = (data ?? []).map((r) => r.role as UserRole);
  return roles.length > 0 ? roles : ['user'];
}

export async function fetchPrivateContact(userId: string): Promise<PrivateContact | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('profile_private_contacts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as PrivateContact | null;
}

export async function updateOwnProfile(
  userId: string,
  updates: Partial<{
    full_name: string;
    bio: string | null;
    commune_id: string | null;
    sector_id: string | null;
    avatar_url: string | null;
    institution_name: string | null;
    institution_description: string | null;
    responsible_person: string | null;
    institutional_code: string | null;
  }>,
  privatePhone?: string | null
) {
  const sb = requireSupabase();
  const { error: profileError } = await sb.from('profiles').update(updates).eq('id', userId);
  if (profileError) throw profileError;

  if (privatePhone !== undefined) {
    const { error: contactError } = await sb
      .from('profile_private_contacts')
      .update({ private_phone: privatePhone || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (contactError) throw contactError;
  }
}

export async function uploadAvatarImage(userId: string, file: File): Promise<string> {
  const sb = requireSupabase();
  const ext = file.name.split('.').pop() || 'webp';
  const filePath = `${userId}/avatar_${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('avatars').upload(filePath, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
  const { data } = sb.storage.from('avatars').getPublicUrl(filePath);
  return data.publicUrl;
}

export async function deleteOwnAccount(): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('request_own_account_deletion');
  if (error) throw error;
  await sb.auth.signOut();
}
