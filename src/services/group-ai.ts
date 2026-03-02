import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

// =====================================================
// 🤖 Group AI Service
// Respostas inteligentes quando o bot é marcado no grupo
// Usa Sonnet pra qualidade (feature paga)
// =====================================================

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Voce e o IDM Bot, um assistente de crypto em um grupo de WhatsApp. Responda de forma curta, direta e util. Maximo 3 paragrafos.

Regras:
- Responda em portugues BR informal
- Seja direto, sem enrolacao
- Use dados e fatos, nao achismo
- Se nao souber, diga que nao sabe
- Nunca de conselho financeiro ("isso nao e recomendacao de investimento")
- Pode usar emojis com moderacao
- Mantenha tom profissional mas acessivel
- Foque em crypto, blockchain e mercado financeiro

Voce pode responder sobre:
- Analise de mercado e tendencias
- Explicacao de conceitos crypto/DeFi
- Comparacoes entre projetos
- Noticias recentes do mercado
- Estrategias gerais (DCA, HODL, etc)`;

export async function generateGroupAIResponse(userMessage: string): Promise<string> {
  // Strip @mention from message
  const cleanMessage = userMessage
    .replace(/@idm\s*/gi, '')
    .replace(/idm bot\s*/gi, '')
    .replace(/idm,?\s*/gi, '')
    .trim();

  if (!cleanMessage || cleanMessage.length < 3) {
    return 'Me marca com uma pergunta! Ex: "@IDM o que ta acontecendo com ETH hoje?"';
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
      return 'Nao consegui processar. Tenta de novo!';
    }

    return content.text;
  } catch (error) {
    console.error('[GroupAI] Error:', error);
    throw error;
  }
}
