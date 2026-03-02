import { supabase } from '../client.js';

export interface Payment {
  id: string;
  user_id: string;
  plan: 'pro' | 'whale';
  duration_days: number;
  method: 'pix' | 'crypto';
  amount_brl: number;
  amount_usd?: number;
  discount_percent: number;
  status: 'pending' | 'confirmed' | 'expired' | 'failed' | 'refunded';
  mp_payment_id?: string;
  pix_qr_code?: string;
  pix_qr_code_base64?: string;
  crypto_chain?: string;
  crypto_token?: string;
  crypto_amount?: number;
  crypto_address?: string;
  crypto_tx_hash?: string;
  expires_at: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentInput {
  userId: string;
  plan: 'pro' | 'whale';
  durationDays?: number;
  method: 'pix' | 'crypto';
  amountBrl: number;
  amountUsd?: number;
  discountPercent?: number;
  expiresAt: Date;
  // PIX fields
  mpPaymentId?: string;
  pixQrCode?: string;
  pixQrCodeBase64?: string;
  // Crypto fields
  cryptoChain?: string;
  cryptoToken?: string;
  cryptoAmount?: number;
  cryptoAddress?: string;
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const { data, error } = await supabase
    .from('idm_payments')
    .insert({
      user_id: input.userId,
      plan: input.plan,
      duration_days: input.durationDays ?? 30,
      method: input.method,
      amount_brl: input.amountBrl,
      amount_usd: input.amountUsd,
      discount_percent: input.discountPercent ?? 0,
      expires_at: input.expiresAt.toISOString(),
      mp_payment_id: input.mpPaymentId,
      pix_qr_code: input.pixQrCode,
      pix_qr_code_base64: input.pixQrCodeBase64,
      crypto_chain: input.cryptoChain,
      crypto_token: input.cryptoToken,
      crypto_amount: input.cryptoAmount,
      crypto_address: input.cryptoAddress,
    })
    .select()
    .single();

  if (error) {
    console.error('[PaymentRepo] Error creating payment:', error);
    throw error;
  }

  return data as Payment;
}

export async function findPendingPaymentByUser(userId: string): Promise<Payment | null> {
  const { data, error } = await supabase
    .from('idm_payments')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[PaymentRepo] Error finding pending payment:', error);
    return null;
  }

  return data as Payment | null;
}

export async function findPaymentByMpId(mpPaymentId: string): Promise<Payment | null> {
  const { data, error } = await supabase
    .from('idm_payments')
    .select('*')
    .eq('mp_payment_id', mpPaymentId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[PaymentRepo] Error finding by MP id:', error);
    return null;
  }

  return data as Payment | null;
}

export async function confirmPayment(paymentId: string, txHash?: string): Promise<Payment | null> {
  const updateData: Record<string, unknown> = {
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  };
  if (txHash) updateData['crypto_tx_hash'] = txHash;

  const { data, error } = await supabase
    .from('idm_payments')
    .update(updateData)
    .eq('id', paymentId)
    .select()
    .single();

  if (error) {
    console.error('[PaymentRepo] Error confirming payment:', error);
    return null;
  }

  return data as Payment;
}

export async function expireStalePendingPayments(): Promise<number> {
  const { data, error } = await supabase
    .from('idm_payments')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[PaymentRepo] Error expiring payments:', error);
    return 0;
  }

  return data?.length ?? 0;
}

export async function getUserPaymentHistory(userId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('idm_payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[PaymentRepo] Error fetching history:', error);
    return [];
  }

  return (data ?? []) as Payment[];
}
