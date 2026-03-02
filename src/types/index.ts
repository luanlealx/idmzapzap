// Evolution API Webhook Types
export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: EvolutionMessageData;
  destination?: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

export interface EvolutionMessageData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
    };
  };
  messageType?: string;
  messageTimestamp?: number;
  owner?: string;
  source?: string;
}

// Parsed Message
export interface ParsedMessage {
  phoneNumber: string;
  text: string;
  pushName?: string;
  messageId: string;
  timestamp: number;
  isGroup: boolean;
  groupJid?: string;
}

// Intent Types
export type IntentType =
  | 'buy'
  | 'sell'
  | 'portfolio_summary'
  | 'asset_detail'
  | 'price_check'
  | 'remove_asset'
  | 'set_dca_goal'
  | 'dca_progress'
  | 'projection'
  | 'set_alert'
  | 'watch_wallet'
  | 'list_wallets'
  | 'remove_wallet'
  | 'wallet_balance'
  | 'help'
  | 'my_plan'
  | 'upgrade'
  | 'referral'
  | 'group_ai_question'
  | 'unknown';

export interface ParsedIntent {
  type: IntentType;
  data?: {
    crypto?: string;
    amountFiat?: number;
    amountCrypto?: number;
    price?: number;
    targetPrice?: number;
    alertType?: 'above' | 'below';
    goalAmount?: number;
    months?: number;
    walletAddress?: string;
    walletLabel?: string;
    referralCode?: string;
  };
  confidence: number;
  rawText: string;
}

// User Types
export interface User {
  id: string;
  phone_number: string;
  name?: string;
  is_active: boolean;
  tier: 'free' | 'pro' | 'whale';
  tier_started_at?: string;
  tier_expires_at?: string;
  stripe_customer_id?: string;
  group_ai_queries_today: number;
  group_ai_queries_reset_at?: string;
  group_ai_queries_week: number;
  group_ai_week_reset_at?: string;
  streak_days: number;
  last_active_date?: string;
  referred_by?: string;
  referral_code?: string;
  referral_count: number;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
}

// Transaction Types
export type TransactionType = 'buy' | 'sell';

export interface Transaction {
  id: string;
  user_id: string;
  crypto_id: string;
  type: TransactionType;
  amount_fiat: number;
  amount_crypto: number;
  price_at_transaction: number;
  created_at: string;
}

export interface CreateTransactionInput {
  userId: string;
  cryptoId: string;
  type: TransactionType;
  amountFiat: number;
  amountCrypto: number;
  priceAtTransaction: number;
}

// Portfolio Types
export interface Holding {
  crypto_id: string;
  total_crypto: number;
  total_invested: number;
  average_price: number;
}

export interface HoldingWithCurrentValue extends Holding {
  current_price: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
}

export interface PortfolioSummary {
  holdings: HoldingWithCurrentValue[];
  total_invested: number;
  total_current_value: number;
  total_profit_loss: number;
  total_profit_loss_percent: number;
}

// DCA Goal Types
export interface DcaGoal {
  id: string;
  user_id: string;
  crypto_id: string;
  goal_amount: number;
  current_amount: number;
  created_at: string;
  updated_at: string;
}

// Price Alert Types
export interface PriceAlert {
  id: string;
  user_id: string;
  crypto_id: string;
  target_price: number;
  alert_type: 'above' | 'below';
  is_triggered: boolean;
  created_at: string;
  triggered_at?: string;
}

// Price Service Types
export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  last_updated: string;
}

export interface PriceCache {
  price: number;
  timestamp: number;
}
