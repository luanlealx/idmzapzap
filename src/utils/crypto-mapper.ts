// Mapping of common crypto aliases (pt-br and common) to CoinGecko IDs
const CRYPTO_ALIASES: Record<string, string> = {
  // Bitcoin
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  satoshi: 'bitcoin',

  // Ethereum
  eth: 'ethereum',
  ethereum: 'ethereum',
  ether: 'ethereum',

  // Solana
  sol: 'solana',
  solana: 'solana',

  // BNB
  bnb: 'binancecoin',
  binance: 'binancecoin',

  // XRP
  xrp: 'ripple',
  ripple: 'ripple',

  // Cardano
  ada: 'cardano',
  cardano: 'cardano',

  // Dogecoin
  doge: 'dogecoin',
  dogecoin: 'dogecoin',

  // Polygon
  matic: 'matic-network',
  polygon: 'matic-network',

  // Polkadot
  dot: 'polkadot',
  polkadot: 'polkadot',

  // Avalanche
  avax: 'avalanche-2',
  avalanche: 'avalanche-2',

  // Chainlink
  link: 'chainlink',
  chainlink: 'chainlink',

  // Litecoin
  ltc: 'litecoin',
  litecoin: 'litecoin',

  // Uniswap
  uni: 'uniswap',
  uniswap: 'uniswap',

  // Cosmos
  atom: 'cosmos',
  cosmos: 'cosmos',

  // Stellar
  xlm: 'stellar',
  stellar: 'stellar',

  // Monero
  xmr: 'monero',
  monero: 'monero',

  // Tron
  trx: 'tron',
  tron: 'tron',

  // Near
  near: 'near',

  // Aptos
  apt: 'aptos',
  aptos: 'aptos',

  // Arbitrum
  arb: 'arbitrum',
  arbitrum: 'arbitrum',

  // Optimism
  op: 'optimism',
  optimism: 'optimism',

  // Sui
  sui: 'sui',

  // Pepe
  pepe: 'pepe',

  // Shiba Inu
  shib: 'shiba-inu',
  shiba: 'shiba-inu',

  // Render
  rndr: 'render-token',
  render: 'render-token',

  // Injective
  inj: 'injective-protocol',
  injective: 'injective-protocol',

  // Sei
  sei: 'sei-network',

  // Jupiter
  jup: 'jupiter-exchange-solana',
  jupiter: 'jupiter-exchange-solana',

  // Stablecoins (for reference)
  usdt: 'tether',
  tether: 'tether',
  usdc: 'usd-coin',
};

// Display names for formatting responses
const CRYPTO_DISPLAY_NAMES: Record<string, string> = {
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  solana: 'Solana',
  binancecoin: 'BNB',
  ripple: 'XRP',
  cardano: 'Cardano',
  dogecoin: 'Dogecoin',
  'matic-network': 'Polygon',
  polkadot: 'Polkadot',
  'avalanche-2': 'Avalanche',
  chainlink: 'Chainlink',
  litecoin: 'Litecoin',
  uniswap: 'Uniswap',
  cosmos: 'Cosmos',
  stellar: 'Stellar',
  monero: 'Monero',
  tron: 'Tron',
  near: 'NEAR',
  aptos: 'Aptos',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  sui: 'Sui',
  pepe: 'Pepe',
  'shiba-inu': 'Shiba Inu',
  'render-token': 'Render',
  'injective-protocol': 'Injective',
  'sei-network': 'Sei',
  'jupiter-exchange-solana': 'Jupiter',
  tether: 'USDT',
  'usd-coin': 'USDC',
};

// Symbols for display
const CRYPTO_SYMBOLS: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  ripple: 'XRP',
  cardano: 'ADA',
  dogecoin: 'DOGE',
  'matic-network': 'MATIC',
  polkadot: 'DOT',
  'avalanche-2': 'AVAX',
  chainlink: 'LINK',
  litecoin: 'LTC',
  uniswap: 'UNI',
  cosmos: 'ATOM',
  stellar: 'XLM',
  monero: 'XMR',
  tron: 'TRX',
  near: 'NEAR',
  aptos: 'APT',
  arbitrum: 'ARB',
  optimism: 'OP',
  sui: 'SUI',
  pepe: 'PEPE',
  'shiba-inu': 'SHIB',
  'render-token': 'RNDR',
  'injective-protocol': 'INJ',
  'sei-network': 'SEI',
  'jupiter-exchange-solana': 'JUP',
  tether: 'USDT',
  'usd-coin': 'USDC',
};

export function resolveCryptoId(input: string): string | null {
  const normalized = input.toLowerCase().trim();
  return CRYPTO_ALIASES[normalized] ?? null;
}

export function getCryptoDisplayName(cryptoId: string): string {
  return CRYPTO_DISPLAY_NAMES[cryptoId] ?? cryptoId;
}

export function getCryptoSymbol(cryptoId: string): string {
  return CRYPTO_SYMBOLS[cryptoId] ?? cryptoId.toUpperCase();
}

export function getAllSupportedCryptos(): string[] {
  return [...new Set(Object.values(CRYPTO_ALIASES))];
}

export function getAllAliases(): string[] {
  return Object.keys(CRYPTO_ALIASES);
}
