import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EvolutionWebhookPayload, ParsedMessage } from '../types/index.js';

export function parseMessage(payload: EvolutionWebhookPayload): ParsedMessage | null {
  const { data } = payload;

  // Ignore messages sent by the bot itself (fromMe + source web)
  if (data.key.fromMe && data.source === 'web') {
    return null;
  }

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

  // Extract phone number from sender field (Evolution v1.x format)
  // Format: 5511999999999@s.whatsapp.net
  // Fallback to remoteJid if sender is not present
  const senderJid = payload.sender ?? data.key.remoteJid;
  const phoneNumber = senderJid.split('@')[0];

  if (!phoneNumber) {
    return null;
  }

  return {
    phoneNumber,
    text: text.trim(),
    pushName: data.pushName,
    messageId: data.key.id,
    timestamp: data.messageTimestamp ?? Date.now(),
  };
}

async function handleWebhook(
  request: FastifyRequest<{ Body: EvolutionWebhookPayload }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const payload = request.body;

    console.log('[Webhook] Raw payload:', JSON.stringify(payload, null, 2));

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

    console.log(`[Webhook] Received message from ${message.phoneNumber}: ${message.text}`);

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
}
