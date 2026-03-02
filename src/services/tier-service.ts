import { supabase } from '../database/client.js';

// =====================================================
// 🏷️ IDM Tier Service
// Gerencia limites e permissões por plano
// =====================================================

export type Tier = 'free' | 'pro' | 'whale';

export interface TierLimits {
  tier: Tier;
  max_wallets: number;       // -1 = unlimited
  max_chains: string[];
  group_ai_enabled: boolean;
  group_ai_daily_limit: number; // -1 = unlimited
  alerts_enabled: boolean;
  max_alerts: number;
  weekly_report: boolean;
  daily_report: boolean;
  export_csv: boolean;
  price_monthly_brl: number;
}

// Cache dos limites (quase nunca muda)
let limitsCache: Map<Tier, TierLimits> | null = null;
let limitsCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// =====================================================
// Busca limites do tier
// =====================================================
export async function getTierLimits(tier: Tier): Promise<TierLimits> {
  const now = Date.now();

  if (!limitsCache || now - limitsCacheAt > CACHE_TTL) {
    const { data, error } = await supabase
      .from('idm_tier_limits')
      .select('*');

    if (error || !data) {
      console.error('[Tier] Failed to load limits:', error);
      // Fallback hardcoded free tier
      return {
        tier: 'free',
        max_wallets: 2,
        max_chains: ['bitcoin', 'ethereum', 'solana'],
        group_ai_enabled: false,
        group_ai_daily_limit: 0,
        alerts_enabled: false,
        max_alerts: 0,
        weekly_report: false,
        daily_report: false,
        export_csv: false,
        price_monthly_brl: 0,
      };
    }

    limitsCache = new Map();
    for (const row of data) {
      limitsCache.set(row.tier as Tier, row as TierLimits);
    }
    limitsCacheAt = now;
  }

  return limitsCache.get(tier) ?? limitsCache.get('free')!;
}

// =====================================================
// Busca tier do usuário
// =====================================================
export async function getUserTier(userId: string): Promise<Tier> {
  const { data, error } = await supabase
    .from('idm_users')
    .select('tier, tier_expires_at')
    .eq('id', userId)
    .single();

  if (error || !data) return 'free';

  // Check if tier expired
  if (data.tier_expires_at) {
    const expiresAt = new Date(data.tier_expires_at);
    if (expiresAt < new Date()) {
      // Expired — downgrade to free
      await supabase
        .from('idm_users')
        .update({ tier: 'free', tier_expires_at: null })
        .eq('id', userId);
      return 'free';
    }
  }

  return data.tier as Tier;
}

// =====================================================
// Checks de permissão
// =====================================================

export async function canAddWallet(userId: string, currentCount: number): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);

  if (limits.max_wallets === -1) return { allowed: true };
  if (currentCount >= limits.max_wallets) {
    return {
      allowed: false,
      upgrade: true,
      reason: `Limite de ${limits.max_wallets} wallets no plano ${tier}. Upgrade pro Pro pra ter ${tier === 'free' ? '10' : 'ilimitadas'}.`,
    };
  }
  return { allowed: true };
}

export async function canUseChain(userId: string, chain: string): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);

  if (!limits.max_chains.includes(chain)) {
    return {
      allowed: false,
      upgrade: true,
      reason: `Rede ${chain} disponivel no plano Pro. Upgrade pra desbloquear!`,
    };
  }
  return { allowed: true };
}

export async function canUseGroupAI(userId: string): Promise<{ allowed: boolean; remaining?: number; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);

  if (!limits.group_ai_enabled) {
    return {
      allowed: false,
      upgrade: true,
      reason: 'Respostas inteligentes no grupo sao do plano Pro. Upgrade pra desbloquear!',
    };
  }

  // Unlimited
  if (limits.group_ai_daily_limit === -1) {
    return { allowed: true };
  }

  // Check daily usage
  const { data } = await supabase
    .from('idm_users')
    .select('group_ai_queries_today, group_ai_queries_reset_at')
    .eq('id', userId)
    .single();

  if (!data) return { allowed: false, reason: 'Erro interno.' };

  // Reset counter if new day
  const resetAt = new Date(data.group_ai_queries_reset_at);
  const now = new Date();
  let queriesToday = data.group_ai_queries_today;

  if (resetAt.toDateString() !== now.toDateString()) {
    // New day — reset
    await supabase
      .from('idm_users')
      .update({ group_ai_queries_today: 0, group_ai_queries_reset_at: now.toISOString() })
      .eq('id', userId);
    queriesToday = 0;
  }

  if (queriesToday >= limits.group_ai_daily_limit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Limite de ${limits.group_ai_daily_limit} perguntas/dia no grupo atingido. Reseta amanha!`,
    };
  }

  return { allowed: true, remaining: limits.group_ai_daily_limit - queriesToday };
}

export async function incrementGroupAIUsage(userId: string): Promise<void> {
  await supabase.rpc('increment_group_ai', { p_user_id: userId }).then(() => {});
  // Fallback if RPC doesn't exist
  const { data } = await supabase
    .from('idm_users')
    .select('group_ai_queries_today')
    .eq('id', userId)
    .single();

  if (data) {
    await supabase
      .from('idm_users')
      .update({ group_ai_queries_today: (data.group_ai_queries_today ?? 0) + 1 })
      .eq('id', userId);
  }
}

export async function canAddAlert(userId: string, currentAlertCount: number): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);

  if (!limits.alerts_enabled) {
    return {
      allowed: false,
      upgrade: true,
      reason: 'Alertas de preco sao do plano Pro. Upgrade pra receber notificacoes!',
    };
  }

  if (currentAlertCount >= limits.max_alerts) {
    return {
      allowed: false,
      reason: `Limite de ${limits.max_alerts} alertas no plano ${tier}.`,
    };
  }

  return { allowed: true };
}

// =====================================================
// Upgrade/Downgrade
// =====================================================

export async function upgradeTier(userId: string, newTier: Tier, durationDays?: number): Promise<void> {
  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await supabase
    .from('idm_users')
    .update({
      tier: newTier,
      tier_started_at: new Date().toISOString(),
      tier_expires_at: expiresAt,
    })
    .eq('id', userId);
}

// =====================================================
// Mensagens de upsell (usadas nas respostas)
// =====================================================

export function buildUpgradeMessage(feature: string): string {
  return `\n\n🔓 *${feature}* — disponivel no plano Pro (R$19,90/mês)\nManda "upgrade" pra saber mais.`;
}

export function buildTierInfo(tier: Tier): string {
  switch (tier) {
    case 'free':
      return '📋 Teu plano: Free\n• 2 wallets on-chain\n• 3 redes (BTC, ETH, SOL)\n• Cotacoes ilimitadas\n• Registro de compra/venda\n\nManda "upgrade" pra ver os planos.';
    case 'pro':
      return '⭐ Teu plano: Pro\n• 10 wallets on-chain\n• 9 redes\n• Bot inteligente no grupo (50/dia)\n• Alertas de preco\n• Relatorio semanal';
    case 'whale':
      return '🐋 Teu plano: Whale\n• Wallets ilimitadas\n• Todas as redes\n• Bot analista no grupo (ilimitado)\n• Alertas de preco (50)\n• Relatorio diario\n• Export CSV';
  }
}

export function buildUpgradePlans(): string {
  return `🔓 *Planos IDM Portfolio*

*Free* — R$0
• 2 wallets on-chain (BTC, ETH, SOL)
• Registro de compra/venda
• Cotacoes em tempo real

*Pro* — R$19,90/mes
• 10 wallets (9 redes)
• Bot responde perguntas no grupo
• Alertas de preco (10)
• Relatorio semanal

*Whale* — R$49,90/mes
• Wallets ilimitadas (9 redes)
• Bot analista no grupo (ilimitado)
• Alertas de preco (50)
• Relatorio diario
• Export CSV

Manda "assinar pro" ou "assinar whale" pra continuar.`;
}
