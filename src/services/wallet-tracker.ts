import { getSpotPrice, getSpotPriceBatch } from './price-service.js';

// =====================================================
// Wallet Tracker Service
// Multi-chain + ERC-20 tokens via public RPCs (gratuito)
// =====================================================

// Cache de saldos (evita spam nas APIs)
const balanceCache = new Map<string, { balances: TokenBalance[]; timestamp: number }>();
const CACHE_TTL = 60_000; // 1 minuto

// =====================================================
// Tipos
// =====================================================
export type Chain = 'bitcoin' | 'ethereum' | 'solana' | 'base';

export interface TokenBalance {
  symbol: string;       // "BTC", "ETH", "USDC", etc.
  name: string;         // "Bitcoin", "Ethereum", etc.
  balance: number;      // Quantidade
  valueUsd: number;     // Valor em USD
  valueBrl: number;     // Valor em BRL
  cryptoId: string;     // CoinGecko ID
  chain?: string;       // Em qual chain está (para multi-chain)
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
// RPCs públicos gratuitos (sem API key)
// =====================================================
const RPC_URLS: Record<string, string> = {
  ethereum: 'https://cloudflare-eth.com',
  base: 'https://mainnet.base.org',
};

// =====================================================
// Contratos de tokens conhecidos (ERC-20)
// =====================================================
interface KnownToken {
  symbol: string;
  name: string;
  decimals: number;
  cryptoId: string; // CoinGecko ID pra pegar preço
  contracts: Record<string, string>; // chain → contract address
}

const KNOWN_TOKENS: KnownToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    cryptoId: 'usd-coin',
    contracts: {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    decimals: 6,
    cryptoId: 'tether',
    contracts: {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      base: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    },
  },
  {
    symbol: 'DAI',
    name: 'Dai',
    decimals: 18,
    cryptoId: 'dai',
    contracts: {
      ethereum: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      base: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    },
  },
  {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    cryptoId: 'ethereum',
    contracts: {
      base: '0x4200000000000000000000000000000000000006',
    },
  },
  {
    symbol: 'cbBTC',
    name: 'Coinbase BTC',
    decimals: 8,
    cryptoId: 'bitcoin',
    contracts: {
      base: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    },
  },
];

// =====================================================
// Detecção de chain pelo formato do endereço
// =====================================================

export function detectChain(address: string): Chain | null {
  const trimmed = address.trim();

  // Bitcoin: começa com 1, 3, ou bc1
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return 'bitcoin';
  if (/^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/.test(trimmed)) return 'bitcoin';

  // Ethereum/Base: começa com 0x + 40 hex chars
  // Retorna 'ethereum' como padrão — getWalletBalance checa múltiplas chains EVM
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return 'ethereum';

  // Solana: Base58, 32-44 chars, sem 0x
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    if (!trimmed.startsWith('1') && !trimmed.startsWith('3') && !trimmed.startsWith('bc1')) {
      return 'solana';
    }
  }

  return null;
}

export function isWalletAddress(text: string): boolean {
  return detectChain(text.trim()) !== null;
}

// =====================================================
// RPC helpers — chamadas diretas sem API key
// =====================================================

/**
 * Chama eth_getBalance via RPC público.
 * Retorna saldo nativo em unidades inteiras (ETH, não wei).
 */
async function rpcGetNativeBalance(rpcUrl: string, address: string): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [address, 'latest'],
      }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { result?: string };
    if (!data.result) return 0;
    // Converte hex wei → ETH (dividir por 10^18)
    return Number(BigInt(data.result)) / 1e18;
  } catch (err) {
    console.error(`[WalletTracker] RPC native balance error:`, err);
    return 0;
  }
}

/**
 * Chama balanceOf(address) no contrato ERC-20 via eth_call.
 * O seletor 0x70a08231 = keccak256("balanceOf(address)")[:4]
 * Retorna saldo já convertido com decimais.
 */
async function rpcGetTokenBalance(
  rpcUrl: string,
  contractAddress: string,
  walletAddress: string,
  decimals: number
): Promise<number> {
  try {
    // balanceOf(address) = 0x70a08231 + address padded to 32 bytes
    const paddedAddr = walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');
    const callData = `0x70a08231${paddedAddr}`;

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          { to: contractAddress, data: callData },
          'latest',
        ],
      }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { result?: string };
    if (!data.result || data.result === '0x' || data.result === '0x0') return 0;
    return Number(BigInt(data.result)) / Math.pow(10, decimals);
  } catch (err) {
    console.error(`[WalletTracker] RPC token balance error:`, err);
    return 0;
  }
}

// =====================================================
// Consultas de saldo
// =====================================================

export async function getWalletBalance(address: string, chain: Chain, label?: string): Promise<WalletSummary> {
  const addrLower = address.toLowerCase();

  // Checa cache
  const cached = balanceCache.get(addrLower);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const totalUsd = cached.balances.reduce((sum, b) => sum + b.valueUsd, 0);
    const totalBrl = cached.balances.reduce((sum, b) => sum + b.valueBrl, 0);
    return { address, chain, label, balances: cached.balances, totalUsd, totalBrl, lastUpdated: new Date(cached.timestamp) };
  }

  let balances: TokenBalance[];

  switch (chain) {
    case 'bitcoin':
      balances = await fetchBitcoinBalance(address);
      break;
    case 'ethereum':
    case 'base':
      // Para endereços EVM: checa AMBAS as chains (ETH mainnet + Base)
      balances = await fetchEVMMultiChainBalance(address);
      break;
    case 'solana':
      balances = await fetchSolanaBalance(address);
      break;
    default:
      balances = [];
  }

  // Remove saldos muito pequenos (dust < R$0.01)
  balances = balances.filter((b) => b.valueBrl > 0.01 || b.balance > 0.000001);

  // Ordena por valor (maior primeiro)
  balances.sort((a, b) => b.valueBrl - a.valueBrl);

  // Atualiza cache
  balanceCache.set(addrLower, { balances, timestamp: Date.now() });

  const totalUsd = balances.reduce((sum, b) => sum + b.valueUsd, 0);
  const totalBrl = balances.reduce((sum, b) => sum + b.valueBrl, 0);

  return { address, chain, label, balances, totalUsd, totalBrl, lastUpdated: new Date() };
}

// =====================================================
// EVM Multi-Chain (Ethereum + Base) + Tokens ERC-20
// =====================================================

async function fetchEVMMultiChainBalance(address: string): Promise<TokenBalance[]> {
  // ===========================================
  // Fase 1: busca TODOS os saldos em PARALELO (nativo + tokens × chains)
  // ===========================================
  interface RawBalance {
    symbol: string;
    name: string;
    balance: number;
    cryptoId: string;
    chain: string;
    chainLabel: string;
  }

  const evmChains = ['ethereum', 'base'] as const;

  // Monta todas as promises de uma vez: nativo + ERC-20 × chain
  const fetchPromises: Promise<RawBalance | null>[] = [];

  for (const chainName of evmChains) {
    const rpcUrl = RPC_URLS[chainName];
    if (!rpcUrl) continue;
    const chainLabel = chainName === 'ethereum' ? 'ETH' : 'Base';

    // ETH nativo
    fetchPromises.push(
      rpcGetNativeBalance(rpcUrl, address).then((bal) =>
        bal > 0.0000001 ? { symbol: 'ETH', name: `Ethereum (${chainLabel})`, balance: bal, cryptoId: 'ethereum', chain: chainName, chainLabel } : null
      ).catch(() => null)
    );

    // Tokens ERC-20 em paralelo
    for (const token of KNOWN_TOKENS) {
      const contractAddr = token.contracts[chainName];
      if (!contractAddr) continue;

      fetchPromises.push(
        rpcGetTokenBalance(rpcUrl, contractAddr, address, token.decimals).then((bal) =>
          bal > 0.000001 ? { symbol: token.symbol, name: `${token.name} (${chainLabel})`, balance: bal, cryptoId: token.cryptoId, chain: chainName, chainLabel } : null
        ).catch(() => null)
      );
    }
  }

  // Executa TUDO ao mesmo tempo (~200-400ms ao invés de ~4-6s sequencial)
  const results = await Promise.all(fetchPromises);
  const rawBalances = results.filter((r): r is RawBalance => r !== null);

  if (rawBalances.length === 0) return [];

  // ===========================================
  // Fase 2: busca TODOS os preços numa só chamada CoinGecko
  // ===========================================
  const uniqueIds = [...new Set(rawBalances.map((b) => b.cryptoId))];
  const priceMap = await getSpotPriceBatch(uniqueIds);

  // ===========================================
  // Fase 3: aplica preços e monta resultado
  // ===========================================
  return rawBalances.map((raw) => {
    const priceBrl = priceMap.get(raw.cryptoId) ?? 0;
    return {
      symbol: raw.symbol,
      name: raw.name,
      balance: raw.balance,
      valueUsd: 0,
      valueBrl: raw.balance * priceBrl,
      cryptoId: raw.cryptoId,
      chain: raw.chain,
    };
  });
}

// =====================================================
// Bitcoin — via blockchain.info (gratuito)
// =====================================================
async function fetchBitcoinBalance(address: string): Promise<TokenBalance[]> {
  try {
    const res = await fetch(`https://blockchain.info/balance?active=${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as Record<string, { final_balance: number }>;
    const satoshis = data[address]?.final_balance ?? 0;
    const btcBalance = satoshis / 1e8;

    if (btcBalance === 0) return [];

    const spotPrice = await getSpotPrice('bitcoin');
    const priceBrl = spotPrice?.price ?? 0;

    return [{
      symbol: 'BTC',
      name: 'Bitcoin',
      balance: btcBalance,
      valueUsd: 0,
      valueBrl: btcBalance * priceBrl,
      cryptoId: 'bitcoin',
      chain: 'bitcoin',
    }];
  } catch (error) {
    console.error('[WalletTracker] Bitcoin balance error:', error);
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

    const spotPrice = await getSpotPrice('solana');
    const priceBrl = spotPrice?.price ?? 0;

    return [{
      symbol: 'SOL',
      name: 'Solana',
      balance: solBalance,
      valueUsd: 0,
      valueBrl: solBalance * priceBrl,
      cryptoId: 'solana',
      chain: 'solana',
    }];
  } catch (error) {
    console.error('[WalletTracker] Solana balance error:', error);
    return [];
  }
}

// =====================================================
// Utilidades
// =====================================================

export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatChainName(chain: Chain): string {
  const names: Record<Chain, string> = {
    bitcoin: '₿ Bitcoin',
    ethereum: 'Ξ Ethereum',
    solana: '◎ Solana',
    base: '🔵 Base',
  };
  return names[chain] ?? chain;
}
