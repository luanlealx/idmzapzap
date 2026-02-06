import { supabase } from '../client.js';
import type { Transaction, CreateTransactionInput } from '../../types/index.js';

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: input.userId,
      crypto_id: input.cryptoId,
      type: input.type,
      amount_fiat: input.amountFiat,
      amount_crypto: input.amountCrypto,
      price_at_transaction: input.priceAtTransaction,
    })
    .select()
    .single();

  if (error) {
    console.error('[TransactionRepo] Error creating transaction:', error);
    throw error;
  }

  return data as Transaction;
}

export async function getTransactionsByUser(userId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[TransactionRepo] Error getting transactions:', error);
    throw error;
  }

  return (data ?? []) as Transaction[];
}

export async function getTransactionsByUserAndCrypto(
  userId: string,
  cryptoId: string
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('crypto_id', cryptoId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[TransactionRepo] Error getting transactions:', error);
    throw error;
  }

  return (data ?? []) as Transaction[];
}

export async function getRecentTransactions(
  userId: string,
  limit: number = 10
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[TransactionRepo] Error getting recent transactions:', error);
    throw error;
  }

  return (data ?? []) as Transaction[];
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', transactionId);

  if (error) {
    console.error('[TransactionRepo] Error deleting transaction:', error);
    throw error;
  }
}
