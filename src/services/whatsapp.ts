import { env } from '../config/env.js';

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;
const MAX_DELAY = 10000;

// Humanized delay between 1-3 seconds
function getHumanizedDelay(): number {
  return 1000 + Math.random() * 2000;
}

// Exponential backoff delay
function getRetryDelay(attempt: number): number {
  const delay = BASE_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendMessage(
  phoneNumber: string,
  text: string
): Promise<SendMessageResponse> {
  // Add humanized delay before sending
  await sleep(getHumanizedDelay());

  const remoteJid = phoneNumber.includes('@')
    ? phoneNumber
    : `${phoneNumber}@s.whatsapp.net`;

  const url = `${env.EVOLUTION_API_URL}/message/sendText/${env.EVOLUTION_INSTANCE}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[WhatsApp] Sending message to ${phoneNumber} (attempt ${attempt + 1})`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: remoteJid,
          textMessage: {
            text,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WhatsApp] API error: ${response.status} - ${errorText}`);

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return {
            success: false,
            error: `API error: ${response.status}`,
          };
        }

        // Retry on server errors (5xx)
        if (attempt < MAX_RETRIES - 1) {
          await sleep(getRetryDelay(attempt));
          continue;
        }

        return {
          success: false,
          error: `API error after ${MAX_RETRIES} attempts: ${response.status}`,
        };
      }

      const data = (await response.json()) as { key?: { id?: string } };

      console.log(`[WhatsApp] Message sent successfully to ${phoneNumber}`);

      return {
        success: true,
        messageId: data.key?.id,
      };
    } catch (error) {
      console.error(`[WhatsApp] Error sending message (attempt ${attempt + 1}):`, error);

      if (attempt < MAX_RETRIES - 1) {
        await sleep(getRetryDelay(attempt));
        continue;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return {
    success: false,
    error: 'Max retries exceeded',
  };
}

export async function sendTyping(phoneNumber: string): Promise<void> {
  const remoteJid = phoneNumber.includes('@')
    ? phoneNumber
    : `${phoneNumber}@s.whatsapp.net`;

  const url = `${env.EVOLUTION_API_URL}/chat/presence/${env.EVOLUTION_INSTANCE}`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: remoteJid,
        presence: 'composing',
      }),
    });
  } catch (error) {
    // Ignore typing indicator errors
    console.debug('[WhatsApp] Error sending typing indicator:', error);
  }
}

export async function stopTyping(phoneNumber: string): Promise<void> {
  const remoteJid = phoneNumber.includes('@')
    ? phoneNumber
    : `${phoneNumber}@s.whatsapp.net`;

  const url = `${env.EVOLUTION_API_URL}/chat/presence/${env.EVOLUTION_INSTANCE}`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: remoteJid,
        presence: 'paused',
      }),
    });
  } catch (error) {
    // Ignore typing indicator errors
    console.debug('[WhatsApp] Error stopping typing indicator:', error);
  }
}

// Send message with typing indicator for a more human-like experience
export async function sendMessageWithTyping(
  phoneNumber: string,
  text: string
): Promise<SendMessageResponse> {
  await sendTyping(phoneNumber);

  // Simulate typing based on message length (rough estimate)
  const typingDuration = Math.min(text.length * 20, 3000);
  await sleep(typingDuration);

  await stopTyping(phoneNumber);

  return sendMessage(phoneNumber, text);
}
