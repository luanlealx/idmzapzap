import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { ParsedIntent, IntentType } from '../types/index.js';
import { resolveCryptoId, getAllAliases } from '../utils/crypto-mapper.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um parser de intenções para um bot de portfolio de criptomoedas. Analise a mensagem do usuário e extraia a intenção e os dados relevantes.

Retorne APENAS um JSON válido no seguinte formato:
{
  "type": "buy|sell|portfolio_summary|asset_detail|price_check|remove_asset|set_dca_goal|dca_progress|projection|set_alert|help|unknown",
  "data": {
    "crypto": "nome ou símbolo da cripto (se mencionado)",
    "amountFiat": número (valor em reais, se mencionado),
    "amountCrypto": número (quantidade de crypto, se mencionado),
    "price": número (preço por unidade, se mencionado),
    "targetPrice": número (preço alvo para alerta, se mencionado),
    "alertType": "above|below" (tipo de alerta, se mencionado),
    "goalAmount": número (meta de DCA em reais, se mencionado),
    "months": número (meses para projeção, se mencionado)
  },
  "confidence": número entre 0 e 1
}

Exemplos:
- "comprei 500 de btc" → {"type": "buy", "data": {"crypto": "btc", "amountFiat": 500}, "confidence": 0.95}
- "vendi 0.5 eth por 5000" → {"type": "sell", "data": {"crypto": "eth", "amountCrypto": 0.5, "amountFiat": 5000}, "confidence": 0.95}
- "carteira" ou "portfolio" → {"type": "portfolio_summary", "data": {}, "confidence": 0.9}
- "quanto tenho de btc" → {"type": "asset_detail", "data": {"crypto": "btc"}, "confidence": 0.9}
- "preço do eth" ou "cotação sol" → {"type": "price_check", "data": {"crypto": "eth"}, "confidence": 0.95}
- "remover btc" ou "zerar posição de eth" → {"type": "remove_asset", "data": {"crypto": "btc"}, "confidence": 0.9}
- "meta de 10000 em btc" → {"type": "set_dca_goal", "data": {"crypto": "btc", "goalAmount": 10000}, "confidence": 0.9}
- "progresso dca" → {"type": "dca_progress", "data": {}, "confidence": 0.9}
- "projeção 12 meses" → {"type": "projection", "data": {"months": 12}, "confidence": 0.9}
- "alerta btc acima de 500000" → {"type": "set_alert", "data": {"crypto": "btc", "targetPrice": 500000, "alertType": "above"}, "confidence": 0.9}
- "ajuda" ou "comandos" → {"type": "help", "data": {}, "confidence": 1.0}

Apenas retorne o JSON, sem explicações adicionais.`;

export async function parseIntent(text: string): Promise<ParsedIntent> {
  // Try LLM first
  try {
    const result = await parseWithLLM(text);
    if (result.confidence >= 0.7) {
      return result;
    }
    console.log(`[IntentParser] LLM confidence too low (${result.confidence}), trying regex`);
  } catch (error) {
    console.error('[IntentParser] LLM parsing failed:', error);
  }

  // Fallback to regex
  const regexResult = parseWithRegex(text);
  return regexResult;
}

async function parseWithLLM(text: string): Promise<ParsedIntent> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  const parsed = JSON.parse(content.text) as {
    type: IntentType;
    data?: ParsedIntent['data'];
    confidence: number;
  };

  // Resolve crypto alias to CoinGecko ID
  if (parsed.data?.crypto) {
    const resolved = resolveCryptoId(parsed.data.crypto);
    if (resolved) {
      parsed.data.crypto = resolved;
    }
  }

  return {
    type: parsed.type,
    data: parsed.data,
    confidence: parsed.confidence,
    rawText: text,
  };
}

function parseWithRegex(text: string): ParsedIntent {
  const normalizedText = text.toLowerCase().trim();

  // Help patterns
  if (/^(ajuda|help|comandos|como usar|\?)$/i.test(normalizedText)) {
    return { type: 'help', confidence: 1.0, rawText: text };
  }

  // Portfolio summary patterns
  if (/^(carteira|portfolio|portfólio|minha carteira|resumo)$/i.test(normalizedText)) {
    return { type: 'portfolio_summary', confidence: 0.95, rawText: text };
  }

  // Price check patterns
  const priceCheckMatch = normalizedText.match(
    /^(?:preço|preco|cotação|cotacao|quanto (?:tá|ta|está|esta|custa)|valor)(?:\s+(?:do|da|de))?\s+(\w+)$/i
  );
  if (priceCheckMatch?.[1]) {
    const crypto = resolveCryptoId(priceCheckMatch[1]);
    if (crypto) {
      return {
        type: 'price_check',
        data: { crypto },
        confidence: 0.9,
        rawText: text,
      };
    }
  }

  // Buy patterns
  const buyPatterns = [
    // "comprei 500 de btc" or "comprei 500 btc"
    /^(?:comprei|compra|comprar|aportei|aporte|aportar)\s+(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)$/i,
    // "comprei btc 500"
    /^(?:comprei|compra|comprar|aportei|aporte|aportar)\s+(\w+)\s+(\d+(?:[.,]\d+)?)$/i,
    // "500 de btc" (implicit buy)
    /^(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)$/i,
  ];

  for (const pattern of buyPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const [, first, second] = match;
      let amountStr: string;
      let cryptoStr: string;

      // Determine which capture group is the amount and which is the crypto
      if (/^\d/.test(first ?? '')) {
        amountStr = first ?? '';
        cryptoStr = second ?? '';
      } else {
        cryptoStr = first ?? '';
        amountStr = second ?? '';
      }

      const crypto = resolveCryptoId(cryptoStr);
      const amount = parseFloat(amountStr.replace(',', '.'));

      if (crypto && !isNaN(amount)) {
        return {
          type: 'buy',
          data: { crypto, amountFiat: amount },
          confidence: 0.85,
          rawText: text,
        };
      }
    }
  }

  // Sell patterns
  const sellPatterns = [
    /^(?:vendi|venda|vender)\s+(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)(?:\s+(?:por|a)\s+(\d+(?:[.,]\d+)?))?$/i,
    /^(?:vendi|venda|vender)\s+(\w+)\s+(\d+(?:[.,]\d+)?)(?:\s+(?:por|a)\s+(\d+(?:[.,]\d+)?))?$/i,
  ];

  for (const pattern of sellPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const [, first, second, fiatStr] = match;
      let cryptoStr: string;
      let amountStr: string;

      if (/^\d/.test(first ?? '')) {
        amountStr = first ?? '';
        cryptoStr = second ?? '';
      } else {
        cryptoStr = first ?? '';
        amountStr = second ?? '';
      }

      const crypto = resolveCryptoId(cryptoStr);
      const amountCrypto = parseFloat(amountStr.replace(',', '.'));
      const amountFiat = fiatStr ? parseFloat(fiatStr.replace(',', '.')) : undefined;

      if (crypto && !isNaN(amountCrypto)) {
        return {
          type: 'sell',
          data: { crypto, amountCrypto, amountFiat },
          confidence: 0.85,
          rawText: text,
        };
      }
    }
  }

  // Asset detail patterns
  const assetDetailMatch = normalizedText.match(
    /^(?:quanto\s+(?:tenho|tem)|detalhe[s]?|info|posição|posicao)(?:\s+(?:de|do|da))?\s+(\w+)$/i
  );
  if (assetDetailMatch?.[1]) {
    const crypto = resolveCryptoId(assetDetailMatch[1]);
    if (crypto) {
      return {
        type: 'asset_detail',
        data: { crypto },
        confidence: 0.85,
        rawText: text,
      };
    }
  }

  // Remove asset patterns
  const removeMatch = normalizedText.match(
    /^(?:remover|remove|zerar|zera|excluir|deletar)(?:\s+(?:posição|posicao))?(?:\s+(?:de|do|da))?\s+(\w+)$/i
  );
  if (removeMatch?.[1]) {
    const crypto = resolveCryptoId(removeMatch[1]);
    if (crypto) {
      return {
        type: 'remove_asset',
        data: { crypto },
        confidence: 0.85,
        rawText: text,
      };
    }
  }

  // DCA goal patterns
  const dcaGoalMatch = normalizedText.match(
    /^(?:meta|objetivo|goal|dca)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s+(?:em|de|para)\s+(\w+)$/i
  );
  if (dcaGoalMatch) {
    const [, amountStr, cryptoStr] = dcaGoalMatch;
    const crypto = resolveCryptoId(cryptoStr ?? '');
    const goalAmount = parseFloat((amountStr ?? '').replace(',', '.'));

    if (crypto && !isNaN(goalAmount)) {
      return {
        type: 'set_dca_goal',
        data: { crypto, goalAmount },
        confidence: 0.85,
        rawText: text,
      };
    }
  }

  // DCA progress
  if (/^(?:progresso|progress|dca|metas)$/i.test(normalizedText)) {
    return { type: 'dca_progress', confidence: 0.85, rawText: text };
  }

  // Alert patterns
  const alertMatch = normalizedText.match(
    /^(?:alerta|alert|avisar|avisa)(?:\s+(?:de|do|da|para|quando))?\s+(\w+)\s+(acima|abaixo|maior|menor|>|<)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)$/i
  );
  if (alertMatch) {
    const [, cryptoStr, direction, priceStr] = alertMatch;
    const crypto = resolveCryptoId(cryptoStr ?? '');
    const targetPrice = parseFloat((priceStr ?? '').replace(',', '.'));
    const alertType =
      direction === 'acima' || direction === 'maior' || direction === '>'
        ? 'above'
        : 'below';

    if (crypto && !isNaN(targetPrice)) {
      return {
        type: 'set_alert',
        data: { crypto, targetPrice, alertType },
        confidence: 0.85,
        rawText: text,
      };
    }
  }

  // Projection patterns
  const projectionMatch = normalizedText.match(
    /^(?:projeção|projecao|projection|simular|simula)\s+(\d+)\s+(?:meses?|m)$/i
  );
  if (projectionMatch?.[1]) {
    const months = parseInt(projectionMatch[1], 10);
    if (!isNaN(months)) {
      return {
        type: 'projection',
        data: { months },
        confidence: 0.85,
        rawText: text,
      };
    }
  }

  // Unknown intent
  return { type: 'unknown', confidence: 0, rawText: text };
}

export function getSupportedCryptosForHelp(): string {
  const aliases = getAllAliases();
  const uniqueAliases = aliases.filter(
    (alias, index, self) => self.indexOf(alias) === index
  );
  return uniqueAliases.slice(0, 20).join(', ');
}
