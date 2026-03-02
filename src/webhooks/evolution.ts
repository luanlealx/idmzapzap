import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EvolutionWebhookPayload, ParsedMessage } from '../types/index.js';
import { env } from '../config/env.js';

// =====================================================
// 🔒 SECURITY CONSTANTS
// =====================================================

// Max message length to process (prevents abuse / memory exhaustion)
const MAX_MESSAGE_LENGTH = 500;

// Valid phone number pattern: 10-15 digits (international format)
const PHONE_REGEX = /^\d{10,15}$/;

// Sanitize display names: strip control chars, limit length
function sanitizePushName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  // Remove control characters, trim, limit to 50 chars
  return name.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 50) || undefined;
}

export function parseMessage(payload: EvolutionWebhookPayload): ParsedMessage | null {
  const { data } = payload;

  // Ignore messages sent by the bot itself (fromMe + source web)
  if (data.key.fromMe && data.source === 'web') {
    return null;
  }

  // Ignore broadcast messages
  const remoteJid = data.key.remoteJid ?? '';
  if (remoteJid.endsWith('@broadcast')) {
    return null;
  }

  // Detect group messages
  const isGroup = remoteJid.endsWith('@g.us');
  const groupJid = isGroup ? remoteJid : undefined;

  // Extract text from message
  let text: string | undefined;
  if (data.message?.conversation) {
    text = data.message.conversation;
  } else if (data.message?.extendedTextMessage?.text) {
    text = data.message.extendedTextMessage.text;
  }

  // Ignore non-text messages
  if (!text) {
    return null;
  }

  // 🔒 Truncate oversized messages
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH);
  }

  // Extract phone number
  // In groups: sender is the participant (data.key.participant or payload.sender)
  // In DMs: sender is remoteJid
  let senderJid: string;
  if (isGroup) {
    // In groups, participant field has the actual sender
    senderJid = data.key.participant ?? payload.sender ?? '';
  } else {
    senderJid = payload.sender ?? data.key.remoteJid;
  }
  const phoneNumber = senderJid.split('@')[0];

  // 🔒 Validate phone number format
  if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
    console.warn('[Webhook] Invalid phone number format, ignoring');
    return null;
  }

  return {
    phoneNumber,
    text: text.trim(),
    pushName: sanitizePushName(data.pushName),
    messageId: data.key.id,
    timestamp: data.messageTimestamp ?? Date.now(),
    isGroup,
    groupJid,
  };
}

async function handleWebhook(
  request: FastifyRequest<{ Body: EvolutionWebhookPayload }>,
  reply: FastifyReply
): Promise<void> {
  try {
    // 🔒 Verify webhook authenticity via API key header
    const apiKey = request.headers['apikey'] as string | undefined;
    if (apiKey && apiKey !== env.EVOLUTION_API_KEY) {
      console.warn('[Webhook] Invalid API key in webhook request');
      reply.status(401).send({ status: 'unauthorized' });
      return;
    }

    const payload = request.body;

    // 🔒 Safe logging: only log event type, not full payload with personal data
    if (env.NODE_ENV === 'development') {
      console.log('[Webhook] Raw payload:', JSON.stringify(payload, null, 2));
    } else {
      console.log(`[Webhook] Event received: ${payload.event ?? 'messages.upsert'}`);
    }

    // Evolution v1.x sends event in different format when using webhook_by_events
    // The event might already be filtered by the URL path
    if (payload.event && payload.event !== 'messages.upsert') {
      reply.status(200).send({ status: 'ignored', reason: 'not a message event' });
      return;
    }

    const message = parseMessage(payload);

    if (!message) {
      reply.status(200).send({ status: 'ignored', reason: 'invalid or non-text message' });
      return;
    }

    // 🔒 Safe logging: mask phone number in production
    const maskedPhone = env.NODE_ENV === 'production'
      ? `${message.phoneNumber.slice(0, 4)}***${message.phoneNumber.slice(-2)}`
      : message.phoneNumber;
    console.log(`[Webhook] Message from ${maskedPhone}: "${message.text.slice(0, 80)}"`);

    // Import and call message router (lazy import to avoid circular deps)
    const { processMessage } = await import('../services/message-router.js');

    // Process message asynchronously
    processMessage(message).catch((error: unknown) => {
      console.error('[Webhook] Error processing message:', error);
    });

    reply.status(200).send({ status: 'received' });
  } catch (error) {
    console.error('[Webhook] Error handling webhook:', error);
    reply.status(500).send({ status: 'error' });
  }
}

export function registerEvolutionWebhook(app: FastifyInstance): void {
  // Support both Evolution v1.x and v2.x webhook formats
  app.post('/webhook/evolution', handleWebhook);
  app.post('/webhook/evolution/messages-upsert', handleWebhook);

  // =====================================================
  // 💳 MercadoPago PIX Webhook
  // Receives payment confirmations for PIX payments
  // =====================================================
  app.post('/webhook/mercadopago', async (request, reply) => {
    try {
      const body = request.body as {
        type?: string;
        action?: string;
        data?: { id?: string };
      };

      console.log(`[MP Webhook] Received: type=${body.type}, action=${body.action}`);

      // MercadoPago sends notification when payment status changes
      if (body.type === 'payment' && body.data?.id) {
        const mpPaymentId = String(body.data.id);

        const { handleMercadoPagoWebhook } = await import('../services/payment.js');
        const result = await handleMercadoPagoWebhook(mpPaymentId);

        if (result.confirmed && result.userId) {
          // Send confirmation message to user
          const { supabase: db } = await import('../database/client.js');
          const { data: user } = await db
            .from('idm_users')
            .select('phone_number')
            .eq('id', result.userId)
            .single();

          if (user?.phone_number) {
            const { sendMessageWithTyping } = await import('../services/whatsapp.js');
            const planName = result.plan === 'whale' ? 'Whale' : 'Pro';
            await sendMessageWithTyping(
              user.phone_number,
              `✅ *PIX confirmado!*\n\nPlano *${planName}* ativado por 30 dias.\n\nManda *meu plano* pra ver tudo que desbloqueou.`
            );
          }
        }
      }

      reply.status(200).send({ status: 'ok' });
    } catch (error) {
      console.error('[MP Webhook] Error:', error);
      reply.status(200).send({ status: 'ok' }); // Always 200 to MP
    }
  });

  // =====================================================
  // ⏰ Cron: alert checker + payment cleanup
  // Runs every 60 seconds
  // =====================================================
  setInterval(async () => {
    try {
      const { checkAlerts } = await import('../services/alert-service.js');
      await checkAlerts();

      const { cleanupExpiredPayments } = await import('../services/payment.js');
      await cleanupExpiredPayments();
    } catch (err) {
      console.error('[Cron] Error in periodic tasks:', err);
    }
  }, 60_000); // every 60 seconds

  console.log('[Webhook] Registered: Evolution, MercadoPago, Cron (alerts + payments)');
}
