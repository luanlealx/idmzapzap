import { supabase } from '../client.js';

// =====================================================
// Tipos locais (wallet tracking)
// =====================================================
export interface Wallet {
  id: string;
  user_id: string;
  address: string;
  chain: string;
  label?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWalletInput {
  userId: string;
  address: string;
  chain: string;
  label?: string;
}

// =====================================================
// CRUD
// =====================================================

/**
 * Adiciona uma wallet pra monitorar.
 * Se já existir (mesmo user + address), retorna a existente.
 */
export async function addWallet(input: CreateWalletInput): Promise<Wallet> {
  // Checa se já existe
  const existing = await findWalletByAddress(input.userId, input.address);
  if (existing) {
    // Reativa se estava desativada
    if (!existing.is_active) {
      const { data } = await supabase
        .from('idm_wallets')
        .update({ is_active: true, label: input.label })
        .eq('id', existing.id)
        .select()
        .single();
      return data as Wallet;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('idm_wallets')
    .insert({
      user_id: input.userId,
      address: input.address,
      chain: input.chain,
      label: input.label,
    })
    .select()
    .single();

  if (error) {
    console.error('[WalletRepo] Error adding wallet:', error);
    throw error;
  }

  return data as Wallet;
}

/**
 * Lista todas as wallets ativas de um usuário
 */
export async function getUserWallets(userId: string): Promise<Wallet[]> {
  const { data, error } = await supabase
    .from('idm_wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[WalletRepo] Error listing wallets:', error);
    throw error;
  }

  return (data ?? []) as Wallet[];
}

/**
 * Busca wallet por endereço (de um usuário específico)
 */
export async function findWalletByAddress(userId: string, address: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from('idm_wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('address', address.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[WalletRepo] Error finding wallet:', error);
    throw error;
  }

  return data as Wallet | null;
}

/**
 * Remove (desativa) uma wallet
 */
export async function removeWallet(userId: string, address: string): Promise<boolean> {
  const { error, count } = await supabase
    .from('idm_wallets')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('address', address.toLowerCase())
    .eq('is_active', true);

  if (error) {
    console.error('[WalletRepo] Error removing wallet:', error);
    throw error;
  }

  return (count ?? 0) > 0;
}

/**
 * Conta wallets ativas de um usuário (pra limitar)
 */
export async function countUserWallets(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('idm_wallets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    console.error('[WalletRepo] Error counting wallets:', error);
    return 0;
  }

  return count ?? 0;
}
