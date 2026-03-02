import { supabase } from '../client.js';

export interface PriceAlert {
  id: string;
  user_id: string;
  crypto_id: string;
  target_price: number;
  alert_type: 'above' | 'below';
  is_triggered: boolean;
  created_at: string;
  triggered_at?: string;
}

export async function createAlert(input: {
  userId: string;
  cryptoId: string;
  targetPrice: number;
  alertType: 'above' | 'below';
}): Promise<PriceAlert> {
  const { data, error } = await supabase
    .from('idm_price_alerts')
    .insert({
      user_id: input.userId,
      crypto_id: input.cryptoId,
      target_price: input.targetPrice,
      alert_type: input.alertType,
    })
    .select()
    .single();

  if (error) {
    console.error('[AlertRepo] Error creating alert:', error);
    throw error;
  }

  return data as PriceAlert;
}

export async function getUserAlerts(userId: string): Promise<PriceAlert[]> {
  const { data, error } = await supabase
    .from('idm_price_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_triggered', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[AlertRepo] Error fetching alerts:', error);
    return [];
  }

  return (data ?? []) as PriceAlert[];
}

export async function countUserAlerts(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('idm_price_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_triggered', false);

  if (error) {
    console.error('[AlertRepo] Error counting alerts:', error);
    return 0;
  }

  return count ?? 0;
}

export async function getActiveAlerts(): Promise<PriceAlert[]> {
  const { data, error } = await supabase
    .from('idm_price_alerts')
    .select('*')
    .eq('is_triggered', false);

  if (error) {
    console.error('[AlertRepo] Error fetching active alerts:', error);
    return [];
  }

  return (data ?? []) as PriceAlert[];
}

export async function triggerAlert(alertId: string): Promise<void> {
  await supabase
    .from('idm_price_alerts')
    .update({ is_triggered: true, triggered_at: new Date().toISOString() })
    .eq('id', alertId);
}

export async function removeAlert(userId: string, alertId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('idm_price_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    console.error('[AlertRepo] Error removing alert:', error);
    return false;
  }

  return (data?.length ?? 0) > 0;
}
