import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('tu-proyecto.supabase.co') &&
    !supabaseAnonKey.includes('tu-supabase-anon-public-key')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Faltan las variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para conectar con Supabase.'
    );
  }
  return supabase;
}

export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  error?: string;
}> {
  if (!supabase) {
    return {
      connected: false,
      error: 'Variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY no configuradas.',
    };
  }
  const { error } = await supabase.from('communes').select('id').limit(1);
  if (error) {
    return { connected: false, error: error.message };
  }
  return { connected: true };
}
