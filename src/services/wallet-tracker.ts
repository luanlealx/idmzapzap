import { getSpotPrice } from './price-service.js';

// =====================================================
// Wallet Tracker Service
// Consulta saldos on-chain via APIs públicas gratuitas
// =====================================================

// Cache de saldos (evita spam nas APIs)
// Chave: address, Valor: { balances, timestamp }
const balanceCache = new Map<string, { balances: TokenBalance[]; timestamp: number }>();
const CACHE_TTL = 60_000; // 1 minuto

// =====================================================
// Tipos
// =====================================================
export type Chain = 'bitcoin' | 'ethereum' | 'solana' | 'base';

export interface TokenBalance {
  symbol: string;       // "BTC", "ETH", "SOL", "USDT", etc.
  name: string;         // "Bitcoin", "Ethereum", etc.
  balance: number;      // Quantidade da crypto
  valueUsd: number;     // Valor em USD
  valueBrl: number;     // Valor em BRL
  cryptoId: string;     // CoinGecko ID pra referência
}

export interface WalletSummary {
  address: string;
  chain: Chain;
  label?: string;
  balances: TokenBalance[];
  totalUsd: number;
  totalBrl: number;
  lastUpdated: Date;
}

// =====================================================
// Detecção de chain pelo formato do endereço
// =====================================================

/**
 * Detecta a blockchain pelo formato do endereço.
 * Retorna null se não reconhecer.
 */
export function detectChain(address: string): Chain | null {
  const trimmed = address.trim();

  // Bitcoin: começa com 1, 3, ou bc1
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return 'bitcoin';
  if (/^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/.test(trimmed)) return 'bitcoin';

  // Ethereum/Base: começa com 0x + 40 hex chars
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return 'ethereum';

  // Solana: Base58, 32-44 chars, sem 0x
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    // Evita falso positivo com Bitcoin (que também é Base58)
    if (!trimmed.startsWith('1') && !trimmed.startsWith('3') && !trimmed.startsWith('bc1')) {
      return 'solana';
    }
  }

  return null;
}

/**
 * Verifica se uma string parece um endereço de blockchain
 */
export function isWalletAddress(text: string): boolean {
  return detectChain(text.trim()) !== null;
}

// =====================================================
// Consultas de saldo por chain
// =====================================================

/**
 * Consulta o saldo de uma wallet e retorna resumo completo
 */
export async function getWalletBalance(address: string, chain: Chain, label?: string): Promise<WalletSummary> {
  // Checa cache
  const cached = balanceCache.get(address);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const totalUsd = cached.balances.reduce((sum, b) => sum + b.valueUsd, 0);
    const totalBrl = cached.balances.reduce((sum, b) => sum + b.valueBrl, 0);
    return {
      address,
      chain,
      label,
      balances: cached.balances,
      totalUsd,
      totalBrl,
      lastUpdated: new Date(cached.timestamp),
    };
  }

  let balances: TokenBalance[];

  switch (chain) {
    case 'bitcoin':
      balances = await fetchBitcoinBalance(address);
      break;
    case 'ethereum':
    case 'base':
      balances = await fetchEthereumBalance(address);
      break;
    case 'solana':
      balances = await fetchSolanaBalance(address);
      break;
    default:
      balances = [];
  }

  // Atualiza cache
  balanceCache.set(address, { balances, timestamp: Date.now() });

  const totalUsd = balances.reduce((sum, b) => sum + b.valueUsd, 0);
  const totalBrl = balances.reduce((sum, b) => sum + b.valueBrl, 0);

  return {
    address,
    chain,
    label,
    balances,
    totalUsd,
    totalBrl,
    lastUpdated: new Date(),
  };
}

// =====================================================
// Bitcoin — via blockchain.info (gratuito, sem chave)
// =====================================================
async function fetchBitcoinBalance(address: string): Promise<TokenBalance[]> {
  try {
    const res = await fetch(`https://blockchain.info/balance?active=${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as Record<string, { final_balance: number }>;
    const satoshis = data[address]?.final_balance ?? 0;
    const btcBalance = satoshis / 1e8;

    if (btcBalance === 0) return [];

    // getSpotPrice already returns BRL (vs_currencies=brl)
    const spotPrice = await getSpotPrice('bitcoin');
    const priceBrl = spotPrice?.price ?? 0;

    return [{
      symbol: 'BTC',
      name: 'Bitcoin',
      balance: btcBalance,
      valueUsd: 0, // Not used, kept for interface compat
      valueBrl: btcBalance * priceBrl,
      cryptoId: 'bitcoin',
    }];
  } catch (error) {
    console.error('[WalletTracker] Bitcoin balance error:', error);
    return [];
  }
}

// =====================================================
// Ethereum — via Etherscan public API (gratuito, rate limited)
// =====================================================
async function fetchEthereumBalance(address: string): Promise<TokenBalance[]> {
  try {
    const res = await fetch(
      `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { status: string; result: string };
    if (data.status !== '1') throw new Error(`Etherscan error: ${data.result}`);

    const weiStr = data.result;
    const ethBalance = Number(BigInt(weiStr)) / 1e18;

    if (ethBalance < 0.0000001) return [];

    // getSpotPrice already returns BRL
    const spotPrice = await getSpotPrice('ethereum');
    const priceBrl = spotPrice?.price ?? 0;

    return [{
      symbol: 'ETH',
      name: 'Ethereum',
      balance: ethBalance,
      valueUsd: 0,
      valueBrl: priceBrl > 0 ? ethBalance * priceBrl : 0,
      cryptoId: 'ethereum',
    }];
  } catch (error) {
    console.error('[WalletTracker] Ethereum balance error:', error);
    return [];
  }
}

// =====================================================
// Solana — via RPC público (gratuito)
// =====================================================
async function fetchSolanaBalance(address: string): Promise<TokenBalance[]> {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { result?: { value: number } };
    const lamports = data.result?.value ?? 0;
    const solBalance = lamports / 1e9;

    if (solBalance < 0.0000001) return [];

    // getSpotPrice already returns BRL
    const spotPrice = await getSpotPrice('solana');
    const priceBrl = spotPrice?.price ?? 0;

    return [{
      symbol: 'SOL',
      name: 'Solana',
      balance: solBalance,
      valueUsd: 0,
      valueBrl: priceBrl > 0 ? solBalance * priceBrl : 0,
      cryptoId: 'solana',
    }];
  } catch (error) {
    console.error('[WalletTracker] Solana balance error:', error);
    return [];
  }
}

// =====================================================
// Utilidades
// =====================================================


/**
 * Formata endereço pra exibição (truncado)
 * 0x1234567890abcdef... → 0x1234...cdef
 */
export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Formata nome da chain pra exibição
 */
export function formatChainName(chain: Chain): string {
  const names: Record<Chain, string> = {
    bitcoin: '₿ Bitcoin',
    ethereum: 'Ξ Ethereum',
    solana: '◎ Solana',
    base: '🔵 Base',
  };
  return names[chain] ?? chain;
}
