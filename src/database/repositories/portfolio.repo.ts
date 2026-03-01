import { supabase } from '../client.js';
import type { Holding, DcaGoal } from '../../types/index.js';

export async function getHoldingsByUser(userId: string): Promise<Holding[]> {
  const { data, error } = await supabase
    .from('idm_user_holdings')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[PortfolioRepo] Error getting holdings:', error);
    throw error;
  }

  return (data ?? []) as Holding[];
}

export async function getHoldingByUserAndCrypto(
  userId: string,
  cryptoId: string
): Promise<Holding | null> {
  const { data, error } = await supabase
    .from('idm_user_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('crypto_id', cryptoId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[PortfolioRepo] Error getting holding:', error);
    throw error;
  }

  return data as Holding | null;
}

export async function refreshHoldings(): Promise<void> {
  const { error } = await supabase.rpc('idm_refresh_holdings');

  if (error) {
    console.error('[PortfolioRepo] Error refreshing holdings:', error);
    // Don't throw, as this is called by trigger anyway
  }
}

// DCA Goals
export async function getDcaGoal(userId: string, cryptoId: string): Promise<DcaGoal | null> {
  const { data, error } = await supabase
    .from('idm_dca_goals')
    .select('*')
    .eq('user_id', userId)
    .eq('crypto_id', cryptoId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[PortfolioRepo] Error getting DCA goal:', error);
    throw error;
  }

  return data as DcaGoal | null;
}

export async function getDcaGoalsByUser(userId: string): Promise<DcaGoal[]> {
  const { data, error } = await supabase
    .from('idm_dca_goals')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[PortfolioRepo] Error getting DCA goals:', error);
    throw error;
  }

  return (data ?? []) as DcaGoal[];
}

export async function setDcaGoal(
  userId: string,
  cryptoId: string,
  goalAmount: number
): Promise<DcaGoal> {
  const { data, error } = await supabase
    .from('idm_dca_goals')
    .upsert(
      {
        user_id: userId,
        crypto_id: cryptoId,
        goal_amount: goalAmount,
      },
      { onConflict: 'user_id,crypto_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('[PortfolioRepo] Error setting DCA goal:', error);
    throw error;
  }

  return data as DcaGoal;
}

export async function deleteDcaGoal(userId: string, cryptoId: string): Promise<void> {
  const { error } = await supabase
    .from('idm_dca_goals')
    .delete()
    .eq('user_id', userId)
    .eq('crypto_id', cryptoId);

  if (error) {
    console.error('[PortfolioRepo] Error deleting DCA goal:', error);
    throw error;
  }
}

// Remove asset (create a sell transaction that zeroes the position)
export async function createZeroingTransaction(
  userId: string,
  cryptoId: string,
  currentHolding: Holding,
  currentPrice: number
): Promise<void> {
  if (currentHolding.total_crypto <= 0) {
    return;
  }

  const { error } = await supabase.from('idm_transactions').insert({
    user_id: userId,
    crypto_id: cryptoId,
    type: 'sell',
    amount_fiat: currentHolding.total_crypto * currentPrice,
    amount_crypto: currentHolding.total_crypto,
    price_at_transaction: currentPrice,
  });

  if (error) {
    console.error('[PortfolioRepo] Error creating zeroing transaction:', error);
    throw error;
  }
}
