import { supabase } from '../database/client.js';
import { getPortfolioSummary } from './portfolio.js';
import { sendMessageWithTyping, sendImageWithTyping } from './whatsapp.js';
import { generatePortfolioCard } from './image-generator.js';
import { formatCurrency, formatPercent } from '../utils/formatters.js';
import { type Tier } from './tier-service.js';
import { getCryptoSymbol } from '../utils/crypto-mapper.js';

// =====================================================
// 📊 Daily Summary Service
// Sends morning portfolio update to active users
// Free: text only. Pro/Whale: visual card + insight
// =====================================================

export async function sendDailySummaries(): Promise<{ sent: number; errors: number }> {
  console.log('[DailySummary] Starting daily summaries...');

  // Get all active users who have at least one holding
  const { data: users, error } = await supabase
    .from('idm_users')
    .select('id, phone_number, streak_days, tier')
    .eq('is_active', true);

  if (error || !users) {
    console.error('[DailySummary] Failed to fetch users:', error);
    return { sent: 0, errors: 1 };
  }

  let sent = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const summary = await getPortfolioSummary(user.id);
      if (summary.holdings.length === 0) continue;

      const tier = user.tier as Tier;
      const streak = user.streak_days ?? 0;

      // Build holdings mini-summary
      const holdingsText = summary.holdings
        .slice(0, 5) // max 5 assets
        .map((h) => {
          const sym = getCryptoSymbol(h.crypto_id);
          const arrow = h.profit_loss_percent >= 0 ? '▲' : '▼';
          return `${sym} ${arrow}`;
        })
        .join(' ');

      const plEmoji = summary.total_profit_loss >= 0 ? '📈' : '📉';
      const plSign = summary.total_profit_loss >= 0 ? '+' : '';

      // Streak fire
      const streakText = streak > 1
        ? `\n🔥 ${streak} dias seguidos acompanhando`
        : '';

      if (tier === 'free') {
        // Free: text only, shorter
        const msg = `Bom dia! ${plEmoji}\n\nPortfolio: ${formatCurrency(summary.total_current_value)} (${plSign}${formatPercent(summary.total_profit_loss_percent)} geral)\n${holdingsText}${streakText}`;
        await sendMessageWithTyping(user.phone_number, msg);
      } else {
        // Pro/Whale: visual card
        try {
          const cardImage = await generatePortfolioCard(summary);
          const caption = `Bom dia! ${plEmoji} Teu portfolio: ${formatCurrency(summary.total_current_value)} (${plSign}${formatPercent(summary.total_profit_loss_percent)})${streakText}`;
          await sendImageWithTyping(user.phone_number, cardImage, caption);
        } catch {
          // Fallback to text if image fails
          const msg = `Bom dia! ${plEmoji}\n\nPortfolio: ${formatCurrency(summary.total_current_value)} (${plSign}${formatPercent(summary.total_profit_loss_percent)})\n${holdingsText}${streakText}`;
          await sendMessageWithTyping(user.phone_number, msg);
        }
      }

      sent++;

      // Rate limit: 50ms between messages to avoid flooding Evolution API
      await new Promise((r) => setTimeout(r, 50));
    } catch (err) {
      console.error(`[DailySummary] Error for user ${user.id}:`, err);
      errors++;
    }
  }

  console.log(`[DailySummary] Done: ${sent} sent, ${errors} errors`);
  return { sent, errors };
}
