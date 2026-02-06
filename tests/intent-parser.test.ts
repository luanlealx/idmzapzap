import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic SDK before importing the module
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// Mock env
vi.mock('../src/config/env.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
  },
}));

// Import after mocking
import { resolveCryptoId } from '../src/utils/crypto-mapper.js';

describe('Crypto Mapper', () => {
  describe('resolveCryptoId', () => {
    it('should resolve BTC aliases', () => {
      expect(resolveCryptoId('btc')).toBe('bitcoin');
      expect(resolveCryptoId('BTC')).toBe('bitcoin');
      expect(resolveCryptoId('bitcoin')).toBe('bitcoin');
      expect(resolveCryptoId('Bitcoin')).toBe('bitcoin');
    });

    it('should resolve ETH aliases', () => {
      expect(resolveCryptoId('eth')).toBe('ethereum');
      expect(resolveCryptoId('ETH')).toBe('ethereum');
      expect(resolveCryptoId('ethereum')).toBe('ethereum');
      expect(resolveCryptoId('ether')).toBe('ethereum');
    });

    it('should resolve SOL aliases', () => {
      expect(resolveCryptoId('sol')).toBe('solana');
      expect(resolveCryptoId('SOL')).toBe('solana');
      expect(resolveCryptoId('solana')).toBe('solana');
    });

    it('should resolve various altcoins', () => {
      expect(resolveCryptoId('ada')).toBe('cardano');
      expect(resolveCryptoId('xrp')).toBe('ripple');
      expect(resolveCryptoId('doge')).toBe('dogecoin');
      expect(resolveCryptoId('matic')).toBe('matic-network');
      expect(resolveCryptoId('dot')).toBe('polkadot');
      expect(resolveCryptoId('avax')).toBe('avalanche-2');
      expect(resolveCryptoId('link')).toBe('chainlink');
    });

    it('should return null for unknown cryptos', () => {
      expect(resolveCryptoId('unknown')).toBeNull();
      expect(resolveCryptoId('xyz123')).toBeNull();
      expect(resolveCryptoId('')).toBeNull();
    });

    it('should handle whitespace', () => {
      expect(resolveCryptoId(' btc ')).toBe('bitcoin');
      expect(resolveCryptoId('  eth  ')).toBe('ethereum');
    });
  });
});

describe('Intent Parser Regex Patterns', () => {
  // We'll test the regex patterns directly since the LLM part is mocked
  // These patterns are extracted from the parseWithRegex function

  describe('Buy patterns', () => {
    const buyPatterns = [
      /^(?:comprei|compra|comprar|aportei|aporte|aportar)\s+(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)$/i,
      /^(?:comprei|compra|comprar|aportei|aporte|aportar)\s+(\w+)\s+(\d+(?:[.,]\d+)?)$/i,
      /^(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)$/i,
    ];

    it('should match "comprei 500 de btc"', () => {
      const match = buyPatterns[0]?.exec('comprei 500 de btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('500');
      expect(match?.[2]).toBe('btc');
    });

    it('should match "comprei 1000.50 de eth"', () => {
      const match = buyPatterns[0]?.exec('comprei 1000.50 de eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('1000.50');
      expect(match?.[2]).toBe('eth');
    });

    it('should match "aportei 500 sol"', () => {
      const match = buyPatterns[0]?.exec('aportei 500 sol');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('500');
      expect(match?.[2]).toBe('sol');
    });

    it('should match "500 de btc" (implicit buy)', () => {
      const match = buyPatterns[2]?.exec('500 de btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('500');
      expect(match?.[2]).toBe('btc');
    });

    it('should match with comma decimal "comprei 1000,50 de btc"', () => {
      const match = buyPatterns[0]?.exec('comprei 1000,50 de btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('1000,50');
    });
  });

  describe('Sell patterns', () => {
    const sellPatterns = [
      /^(?:vendi|venda|vender)\s+(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(\w+)(?:\s+(?:por|a)\s+(\d+(?:[.,]\d+)?))?$/i,
    ];

    it('should match "vendi 0.5 eth"', () => {
      const match = sellPatterns[0]?.exec('vendi 0.5 eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('0.5');
      expect(match?.[2]).toBe('eth');
    });

    it('should match "vendi 1 btc por 500000"', () => {
      const match = sellPatterns[0]?.exec('vendi 1 btc por 500000');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('1');
      expect(match?.[2]).toBe('btc');
      expect(match?.[3]).toBe('500000');
    });

    it('should match "vendi 0.5 de eth a 15000"', () => {
      const match = sellPatterns[0]?.exec('vendi 0.5 de eth a 15000');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('0.5');
      expect(match?.[2]).toBe('eth');
      expect(match?.[3]).toBe('15000');
    });
  });

  describe('Price check patterns', () => {
    const priceCheckPattern =
      /^(?:preço|preco|cotação|cotacao|quanto (?:tá|ta|está|esta|custa)|valor)(?:\s+(?:do|da|de))?\s+(\w+)$/i;

    it('should match "preço do btc"', () => {
      const match = priceCheckPattern.exec('preço do btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('btc');
    });

    it('should match "cotação eth"', () => {
      const match = priceCheckPattern.exec('cotação eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('eth');
    });

    it('should match "quanto tá sol"', () => {
      const match = priceCheckPattern.exec('quanto tá sol');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('sol');
    });

    it('should match "valor de ada"', () => {
      const match = priceCheckPattern.exec('valor de ada');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('ada');
    });
  });

  describe('Portfolio patterns', () => {
    const portfolioPattern = /^(carteira|portfolio|portfólio|minha carteira|resumo)$/i;

    it('should match portfolio keywords', () => {
      expect(portfolioPattern.test('carteira')).toBe(true);
      expect(portfolioPattern.test('portfolio')).toBe(true);
      expect(portfolioPattern.test('portfólio')).toBe(true);
      expect(portfolioPattern.test('minha carteira')).toBe(true);
      expect(portfolioPattern.test('resumo')).toBe(true);
      expect(portfolioPattern.test('CARTEIRA')).toBe(true);
    });
  });

  describe('Help patterns', () => {
    const helpPattern = /^(ajuda|help|comandos|como usar|\?)$/i;

    it('should match help keywords', () => {
      expect(helpPattern.test('ajuda')).toBe(true);
      expect(helpPattern.test('help')).toBe(true);
      expect(helpPattern.test('comandos')).toBe(true);
      expect(helpPattern.test('como usar')).toBe(true);
      expect(helpPattern.test('?')).toBe(true);
    });
  });

  describe('Asset detail patterns', () => {
    const assetDetailPattern =
      /^(?:quanto\s+(?:tenho|tem)|detalhe[s]?|info|posição|posicao)(?:\s+(?:de|do|da))?\s+(\w+)$/i;

    it('should match "quanto tenho de btc"', () => {
      const match = assetDetailPattern.exec('quanto tenho de btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('btc');
    });

    it('should match "posição de eth"', () => {
      const match = assetDetailPattern.exec('posição de eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('eth');
    });

    it('should match "detalhes sol"', () => {
      const match = assetDetailPattern.exec('detalhes sol');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('sol');
    });
  });

  describe('Remove asset patterns', () => {
    const removePattern =
      /^(?:remover|remove|zerar|zera|excluir|deletar)(?:\s+(?:posição|posicao))?(?:\s+(?:de|do|da))?\s+(\w+)$/i;

    it('should match "remover btc"', () => {
      const match = removePattern.exec('remover btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('btc');
    });

    it('should match "zerar posição de eth"', () => {
      const match = removePattern.exec('zerar posição de eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('eth');
    });

    it('should match "excluir sol"', () => {
      const match = removePattern.exec('excluir sol');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('sol');
    });
  });

  describe('DCA goal patterns', () => {
    const dcaGoalPattern =
      /^(?:meta|objetivo|goal|dca)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s+(?:em|de|para)\s+(\w+)$/i;

    it('should match "meta 10000 em btc"', () => {
      const match = dcaGoalPattern.exec('meta 10000 em btc');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('10000');
      expect(match?.[2]).toBe('btc');
    });

    it('should match "objetivo de 5000 para eth"', () => {
      const match = dcaGoalPattern.exec('objetivo de 5000 para eth');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('5000');
      expect(match?.[2]).toBe('eth');
    });
  });

  describe('Alert patterns', () => {
    const alertPattern =
      /^(?:alerta|alert|avisar|avisa)(?:\s+(?:de|do|da|para|quando))?\s+(\w+)\s+(acima|abaixo|maior|menor|>|<)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)$/i;

    it('should match "alerta btc acima de 500000"', () => {
      const match = alertPattern.exec('alerta btc acima de 500000');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('btc');
      expect(match?.[2]).toBe('acima');
      expect(match?.[3]).toBe('500000');
    });

    it('should match "avisar eth abaixo 10000"', () => {
      const match = alertPattern.exec('avisar eth abaixo 10000');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('eth');
      expect(match?.[2]).toBe('abaixo');
      expect(match?.[3]).toBe('10000');
    });
  });

  describe('Projection patterns', () => {
    const projectionPattern =
      /^(?:projeção|projecao|projection|simular|simula)\s+(\d+)\s+(?:meses?|m)$/i;

    it('should match "projeção 12 meses"', () => {
      const match = projectionPattern.exec('projeção 12 meses');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('12');
    });

    it('should match "simular 6 m"', () => {
      const match = projectionPattern.exec('simular 6 m');
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('6');
    });
  });
});
