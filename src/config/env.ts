import 'dotenv/config';

export interface Env {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  EVOLUTION_API_URL: string;
  EVOLUTION_API_KEY: string;
  EVOLUTION_INSTANCE: string;
  COINGECKO_API_URL: string;
  // Payments
  MERCADOPAGO_ACCESS_TOKEN: string;
  CRYPTO_PAYMENT_ADDRESS: string; // USDT on Base
  CRYPTO_PAYMENT_CHAIN: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[FATAL] Variável obrigatória não configurada: ${name}`);
    process.exit(1);
  }
  return value;
}

function loadEnv(): Env {
  return {
    PORT: parseInt(process.env['PORT'] ?? '3000', 10),
    NODE_ENV: (process.env['NODE_ENV'] as Env['NODE_ENV']) ?? 'development',
    SUPABASE_URL: requireEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),
    EVOLUTION_API_URL: requireEnv('EVOLUTION_API_URL'),
    EVOLUTION_API_KEY: requireEnv('EVOLUTION_API_KEY'),
    EVOLUTION_INSTANCE: requireEnv('EVOLUTION_INSTANCE'),
    COINGECKO_API_URL: process.env['COINGECKO_API_URL'] ?? 'https://api.coingecko.com/api/v3',
    // Payments (optional during dev, required in production)
    MERCADOPAGO_ACCESS_TOKEN: process.env['MERCADOPAGO_ACCESS_TOKEN'] ?? '',
    CRYPTO_PAYMENT_ADDRESS: process.env['CRYPTO_PAYMENT_ADDRESS'] ?? '',
    CRYPTO_PAYMENT_CHAIN: process.env['CRYPTO_PAYMENT_CHAIN'] ?? 'base',
  };
}

export const env = loadEnv();
