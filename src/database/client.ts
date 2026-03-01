import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    // Usa service_role key: acesso total ao banco, server-side only
    // A anon key está bloqueada por RLS — ninguém externo acessa os dados
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabaseClient;
}

export const supabase = getSupabaseClient();
