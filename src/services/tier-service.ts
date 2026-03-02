import { supabase } from '../database/client.js';

// =====================================================
// 🏷️ IDM Tier Service v2
// Free com gostinho de Pro, streak, referral
// =====================================================

export type Tier = 'free' | 'pro' | 'whale';

export interface TierLimits {
  tier: Tier;
  max_wallets: number;
  max_chains: string[];
  group_ai_enabled: boolean;
  group_ai_daily_limit: number; // free=per WEEK, pro/whale=per DAY
  alerts_enabled: boolean;
  max_alerts: number;
  weekly_report: boolean;
  daily_report: boolean;
  export_csv: boolean;
  price_monthly_brl: number;
}

let limitsCache: Map<Tier, TierLimits> | null = null;
let limitsCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function getTierLimits(tier: Tier): Promise<TierLimits> {
  const now = Date.now();
  if (!limitsCache || now - limitsCacheAt > CACHE_TTL) {
    const { data, error } = await supabase.from('idm_tier_limits').select('*');
    if (error || !data) {
      return {
        tier: 'free', max_wallets: 2, max_chains: ['bitcoin', 'ethereum', 'solana'],
        group_ai_enabled: true, group_ai_daily_limit: 3, alerts_enabled: true,
        max_alerts: 1, weekly_report: false, daily_report: false, export_csv: false,
        price_monthly_brl: 0,
      };
    }
    limitsCache = new Map();
    for (const row of data) limitsCache.set(row.tier as Tier, row as TierLimits);
    limitsCacheAt = now;
  }
  return limitsCache.get(tier) ?? limitsCache.get('free')!;
}

export async function getUserTier(userId: string): Promise<Tier> {
  const { data } = await supabase
    .from('idm_users').select('tier, tier_expires_at').eq('id', userId).single();
  if (!data) return 'free';
  if (data.tier_expires_at) {
    if (new Date(data.tier_expires_at) < new Date()) {
      await supabase.from('idm_users').update({ tier: 'free', tier_expires_at: null }).eq('id', userId);
      return 'free';
    }
  }
  return data.tier as Tier;
}

// =====================================================
// Permission checks
// =====================================================

export async function canAddWallet(userId: string, currentCount: number): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);
  if (limits.max_wallets === -1) return { allowed: true };
  if (currentCount >= limits.max_wallets) {
    return { allowed: false, upgrade: true, reason: `Limite de ${limits.max_wallets} wallets no plano ${tier}.` };
  }
  return { allowed: true };
}

export async function canUseChain(userId: string, chain: string): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);
  if (!limits.max_chains.includes(chain)) {
    return { allowed: false, upgrade: true, reason: `Rede ${chain} disponivel no plano Pro.` };
  }
  return { allowed: true };
}

export async function canUseGroupAI(userId: string): Promise<{ allowed: boolean; remaining?: number; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);

  if (!limits.group_ai_enabled) return { allowed: false, upgrade: true };
  if (limits.group_ai_daily_limit === -1) return { allowed: true }; // whale

  const { data } = await supabase
    .from('idm_users')
    .select('group_ai_queries_today, group_ai_queries_reset_at, group_ai_queries_week, group_ai_week_reset_at')
    .eq('id', userId).single();
  if (!data) return { allowed: false, reason: 'Erro interno.' };

  const now = new Date();

  // FREE: weekly limit
  if (tier === 'free') {
    let weekQ = data.group_ai_queries_week ?? 0;
    const weekReset = new Date(data.group_ai_week_reset_at ?? 0);
    const daysSince = Math.floor((now.getTime() - weekReset.getTime()) / 86400000);
    if (daysSince >= 7) {
      await supabase.from('idm_users').update({ group_ai_queries_week: 0, group_ai_week_reset_at: now.toISOString() }).eq('id', userId);
      weekQ = 0;
    }
    const limit = limits.group_ai_daily_limit;
    if (weekQ >= limit) {
      const resetDate = new Date(weekReset); resetDate.setDate(resetDate.getDate() + 7);
      const daysLeft = Math.max(1, Math.ceil((resetDate.getTime() - now.getTime()) / 86400000));
      return { allowed: false, upgrade: true, remaining: 0, reason: `Suas ${limit} perguntas da semana acabaram. Reseta em ${daysLeft} dia(s).` };
    }
    return { allowed: true, remaining: limit - weekQ };
  }

  // PRO: daily limit
  let dayQ = data.group_ai_queries_today ?? 0;
  const dayReset = new Date(data.group_ai_queries_reset_at ?? 0);
  if (dayReset.toDateString() !== now.toDateString()) {
    await supabase.from('idm_users').update({ group_ai_queries_today: 0, group_ai_queries_reset_at: now.toISOString() }).eq('id', userId);
    dayQ = 0;
  }
  if (dayQ >= limits.group_ai_daily_limit) {
    return { allowed: false, remaining: 0, reason: `Limite de ${limits.group_ai_daily_limit}/dia atingido. Reseta amanha!` };
  }
  return { allowed: true, remaining: limits.group_ai_daily_limit - dayQ };
}

export async function incrementGroupAIUsage(userId: string): Promise<void> {
  const tier = await getUserTier(userId);
  if (tier === 'free') {
    await supabase.rpc('idm_increment_group_ai_week', { p_user_id: userId });
  } else {
    await supabase.rpc('idm_increment_group_ai_today', { p_user_id: userId });
  }
}

export async function canAddAlert(userId: string, currentAlertCount: number): Promise<{ allowed: boolean; reason?: string; upgrade?: boolean }> {
  const tier = await getUserTier(userId);
  const limits = await getTierLimits(tier);
  if (!limits.alerts_enabled) return { allowed: false, upgrade: true, reason: 'Alertas nao disponiveis.' };
  if (currentAlertCount >= limits.max_alerts) {
    return { allowed: false, upgrade: tier === 'free', reason: `Limite de ${limits.max_alerts} alerta(s) no plano ${tier}.` };
  }
  return { allowed: true };
}

// =====================================================
// 🔥 Streak
// =====================================================

export async function updateStreak(userId: string): Promise<{ streak: number; isNewDay: boolean }> {
  const { data } = await supabase.from('idm_users').select('streak_days, last_active_date').eq('id', userId).single();
  if (!data) return { streak: 0, isNewDay: false };

  const today = new Date().toISOString().slice(0, 10);
  if (data.last_active_date === today) return { streak: data.streak_days ?? 0, isNewDay: false };

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = data.last_active_date === yesterday ? (data.streak_days ?? 0) + 1 : 1;

  await supabase.from('idm_users').update({ streak_days: newStreak, last_active_date: today }).eq('id', userId);
  return { streak: newStreak, isNewDay: true };
}

// =====================================================
// 🔗 Referral
// =====================================================

function generateReferralCode(phoneNumber: string): string {
  const suffix = phoneNumber.slice(-4);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 3; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `IDM${suffix}${rand}`;
}

export async function getOrCreateReferralCode(userId: string, phoneNumber: string): Promise<string> {
  const { data } = await supabase.from('idm_users').select('referral_code').eq('id', userId).single();
  if (data?.referral_code) return data.referral_code;
  const code = generateReferralCode(phoneNumber);
  await supabase.from('idm_users').update({ referral_code: code }).eq('id', userId);
  return code;
}

export async function processReferral(newUserId: string, referralCode: string): Promise<{ success: boolean; referrerName?: string }> {
  const { data: referrer } = await supabase
    .from('idm_users').select('id, name, referral_count').eq('referral_code', referralCode.toUpperCase()).single();
  if (!referrer) return { success: false };

  await supabase.from('idm_users').update({ referred_by: referralCode.toUpperCase() }).eq('id', newUserId);
  const newCount = (referrer.referral_count ?? 0) + 1;
  await supabase.from('idm_users').update({ referral_count: newCount }).eq('id', referrer.id);

  // Every 3 referrals = 7 days Pro
  if (newCount % 3 === 0) {
    await supabase.from('idm_users').update({
      tier: 'pro', tier_started_at: new Date().toISOString(),
      tier_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }).eq('id', referrer.id);
  }
  return { success: true, referrerName: referrer.name ?? undefined };
}

// =====================================================
// 📋 Onboarding
// =====================================================

export async function getOnboardingStep(userId: string): Promise<number> {
  const { data } = await supabase.from('idm_users').select('onboarding_step').eq('id', userId).single();
  return data?.onboarding_step ?? 0;
}

export async function setOnboardingStep(userId: string, step: number): Promise<void> {
  await supabase.from('idm_users').update({ onboarding_step: step }).eq('id', userId);
}

// =====================================================
// Upgrade
// =====================================================

export async function upgradeTier(userId: string, newTier: Tier, durationDays?: number): Promise<void> {
  const expiresAt = durationDays ? new Date(Date.now() + durationDays * 86400000).toISOString() : null;
  await supabase.from('idm_users').update({
    tier: newTier, tier_started_at: new Date().toISOString(), tier_expires_at: expiresAt,
  }).eq('id', userId);
}

// =====================================================
// Messages
// =====================================================

export function buildUpgradeMessage(feature: string): string {
  return `\n\n🔓 *${feature}* — Pro (R$19,90/mes)\nManda "upgrade" pra ver os planos.`;
}

export function buildGroupUpsellNudge(pushName: string): string {
  return `@${pushName} manda "upgrade" no meu privado pra desbloquear mais 🔓`;
}

export function buildTierInfo(tier: Tier, streak?: number, referralCode?: string): string {
  const s = streak && streak > 1 ? `\n🔥 Streak: ${streak} dias seguidos` : '';
  const r = referralCode ? `\n🔗 Teu codigo: *${referralCode}*\nConvida 3 amigos = 1 semana Pro gratis!` : '';

  switch (tier) {
    case 'free': return `📋 *Teu plano: Free*\n• 2 wallets (BTC, ETH, SOL)\n• 3 perguntas/semana no grupo\n• 1 alerta de preco\n• Cotacoes ilimitadas${s}${r}\n\nManda "upgrade" pra ver os planos.`;
    case 'pro': return `⭐ *Teu plano: Pro*\n• 10 wallets (9 redes)\n• 50 perguntas/dia no grupo\n• 10 alertas + relatorio semanal${s}${r}`;
    case 'whale': return `🐋 *Teu plano: Whale*\n• Wallets ilimitadas (9 redes)\n• Perguntas ilimitadas no grupo\n• 50 alertas + relatorio diario + CSV${s}${r}`;
  }
}

export function buildUpgradePlans(): string {
  return `🔓 *Planos IDM*\n\n*Free* — R$0\n• 2 wallets (BTC, ETH, SOL)\n• 3 perguntas/semana no grupo\n• 1 alerta de preco\n\n*Pro* — R$19,90/mes\n• 10 wallets (9 redes)\n• 50 perguntas/dia no grupo\n• 10 alertas + relatorio semanal\n\n*Whale* — R$49,90/mes\n• Wallets ilimitadas\n• Perguntas ilimitadas no grupo\n• 50 alertas + relatorio diario + CSV\n\nManda "assinar pro" ou "assinar whale".`;
}

export function buildReferralInfo(code: string, count: number): string {
  const remaining = 3 - (count % 3);
  return `🔗 *Referral*\n\nCodigo: *${code}*\n\n📊 ${count} convidados (${3 - remaining}/3 pro proximo Pro gratis)\nFaltam ${remaining} pra ganhar 1 semana Pro!`;
}
