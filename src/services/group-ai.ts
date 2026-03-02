import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

// =====================================================
// 🤖 Group AI Service
// Respostas inteligentes quando o bot é marcado no grupo
// Usa Sonnet pra qualidade (feature paga)
// =====================================================

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é o IDM Bot, um assistente de crypto em um grupo de WhatsApp. Responda de forma curta, direta e útil. Máximo 3 parágrafos.

Regras:
- Responda em português BR informal
- Seja direto, sem enrolação
- Use dados e fatos, não achismo
- Se não souber, diga que não sabe
- Nunca dê conselho financeiro ("isso não é recomendação de investimento")
- Pode usar emojis com moderação
- Mantenha tom profissional mas acessível
- Foque em crypto, blockchain e mercado financeiro

Você pode responder sobre:
- Análise de mercado e tendências
- Explicação de conceitos crypto/DeFi
- Comparações entre projetos
- Notícias recentes do mercado
- Estratégias gerais (DCA, HODL, etc)`;

export async function generateGroupAIResponse(userMessage: string): Promise<string> {
  // Strip @mention from message
  const cleanMessage = userMessage
    .replace(/@idm\s*/gi, '')
    .replace(/idm bot\s*/gi, '')
    .replace(/idm,?\s*/gi, '')
    .trim();

  if (!cleanMessage || cleanMessage.length < 3) {
    return 'Me marca com uma pergunta! Ex: "@IDM o que tá acontecendo com ETH hoje?"';
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: cleanMessage }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      return 'Não consegui processar. Tenta de novo!';
    }

    return content.text;
  } catch (error) {
    console.error('[GroupAI] Error:', error);
    throw error;
  }
}
