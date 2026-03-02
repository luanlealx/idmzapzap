import {
  createAlert,
  getUserAlerts,
  countUserAlerts,
  getActiveAlerts,
  triggerAlert,
  type PriceAlert,
} from '../database/repositories/alert.repo.js';
import { canAddAlert } from './tier-service.js';
import { getSpotPrice } from './price-service.js';
import { sendMessageWithTyping } from './whatsapp.js';
import { supabase } from '../database/client.js';
import { getCryptoSymbol } from '../utils/crypto-mapper.js';
import { formatCurrency } from '../utils/formatters.js';

// =====================================================
// 🔔 IDM Alert Service
// Price alerts with tier-based limits
// =====================================================

export interface SetAlertResult {
  success: boolean;
  message: string;
  alert?: PriceAlert;
}

export async function setAlert(
  userId: string,
  cryptoId: string,
  targetPrice: number,
  alertType: 'above' | 'below',
): Promise<SetAlertResult> {
  // Check tier limit
  const currentCount = await countUserAlerts(userId);
  const check = await canAddAlert(userId, currentCount);

  if (!check.allowed) {
    return {
      success: false,
      message: check.reason ?? 'Limite de alertas atingido.',
    };
  }

  // Validate: get current price to ensure alert makes sense
  const spotPrice = await getSpotPrice(cryptoId);
  if (!spotPrice) {
    return { success: false, message: `Cripto "${cryptoId}" não encontrada.` };
  }

  // Warn if alert direction doesn't match current price
  if (alertType === 'above' && targetPrice <= spotPrice.price) {
    return {
      success: false,
      message: `O preço atual do ${getCryptoSymbol(cryptoId)} já está acima de ${formatCurrency(targetPrice)} (atual: ${formatCurrency(spotPrice.price)}). Use "abaixo" se quer saber quando cair.`,
    };
  }
  if (alertType === 'below' && targetPrice >= spotPrice.price) {
    return {
      success: false,
      message: `O preço atual do ${getCryptoSymbol(cryptoId)} já está abaixo de ${formatCurrency(targetPrice)} (atual: ${formatCurrency(spotPrice.price)}). Use "acima" se quer saber quando subir.`,
    };
  }

  const alert = await createAlert({ userId, cryptoId, targetPrice, alertType });
  const symbol = getCryptoSymbol(cryptoId);
  const direction = alertType === 'above' ? '📈 acima de' : '📉 abaixo de';

  return {
    success: true,
    message: `🔔 *Alerta criado!*\n\n${symbol} ${direction} ${formatCurrency(targetPrice)}\n\nTe aviso assim que atingir! (${currentCount + 1} alerta(s) ativo(s))`,
    alert,
  };
}

export async function listAlerts(userId: string): Promise<string> {
  const alerts = await getUserAlerts(userId);

  if (alerts.length === 0) {
    return `🔔 *Alertas de Preço*\n\nNenhum alerta ativo.\n\n💡 Ex: "alerta btc acima de 500000"`;
  }

  const text = alerts
    .map((a, i) => {
      const symbol = getCryptoSymbol(a.crypto_id);
      const direction = a.alert_type === 'above' ? '📈 acima' : '📉 abaixo';
      return `${i + 1}. ${symbol} ${direction} de ${formatCurrency(a.target_price)}`;
    })
    .join('\n');

  return `🔔 *Alertas Ativos* (${alerts.length})\n\n${text}`;
}

// =====================================================
// 🔄 Alert checker — called periodically (cron)
// Checks all active alerts against current prices
// =====================================================

export async function checkAlerts(): Promise<number> {
  const alerts = await getActiveAlerts();
  if (alerts.length === 0) return 0;

  // Group by crypto to minimize API calls
  const cryptoIds = [...new Set(alerts.map(a => a.crypto_id))];
  const prices = new Map<string, number>();

  for (const cryptoId of cryptoIds) {
    const spot = await getSpotPrice(cryptoId);
    if (spot) prices.set(cryptoId, spot.price);
  }

  let triggered = 0;

  for (const alert of alerts) {
    const currentPrice = prices.get(alert.crypto_id);
    if (!currentPrice) continue;

    const shouldTrigger =
      (alert.alert_type === 'above' && currentPrice >= alert.target_price) ||
      (alert.alert_type === 'below' && currentPrice <= alert.target_price);

    if (shouldTrigger) {
      await triggerAlert(alert.id);
      triggered++;

      // Get user phone to send notification
      const { data: user } = await supabase
        .from('idm_users')
        .select('phone_number')
        .eq('id', alert.user_id)
        .single();

      if (user?.phone_number) {
        const symbol = getCryptoSymbol(alert.crypto_id);
        const direction = alert.alert_type === 'above' ? '📈 subiu acima' : '📉 caiu abaixo';

        await sendMessageWithTyping(
          user.phone_number,
          `🔔 *ALERTA!*\n\n${symbol} ${direction} de ${formatCurrency(alert.target_price)}!\n\n💰 Preço atual: ${formatCurrency(currentPrice)}\n\nManda "preço do ${symbol.toLowerCase()}" pra ver detalhes.`
        );
      }
    }
  }

  if (triggered > 0) {
    console.log(`[AlertService] Triggered ${triggered} alert(s)`);
  }

  return triggered;
}
