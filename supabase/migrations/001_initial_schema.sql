-- =====================================================
-- RETROACTIVE: Exported from Supabase (tables already exist)
-- IDM Bot: Base schema — users, transactions, holdings
-- =====================================================

-- Utility function: auto-update updated_at
CREATE OR REPLACE FUNCTION idm_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Users
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  tier TEXT NOT NULL DEFAULT 'free',
  tier_started_at TIMESTAMPTZ DEFAULT now(),
  tier_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  group_ai_queries_today INTEGER NOT NULL DEFAULT 0,
  group_ai_queries_reset_at TIMESTAMPTZ DEFAULT now(),
  group_ai_queries_week INTEGER NOT NULL DEFAULT 0,
  group_ai_week_reset_at TIMESTAMPTZ DEFAULT now(),
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  referred_by TEXT,
  referral_code TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  onboarding_step INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idm_users_phone ON idm_users(phone_number);
CREATE INDEX IF NOT EXISTS idx_idm_users_tier ON idm_users(tier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idm_users_referral_code ON idm_users(referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE idm_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_users_no_anon ON idm_users FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON idm_users FROM anon, authenticated;

CREATE TRIGGER trg_idm_users_updated
  BEFORE UPDATE ON idm_users
  FOR EACH ROW EXECUTE FUNCTION idm_update_timestamp();

-- =====================================================
-- Transactions
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  crypto_id VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL,
  amount_fiat NUMERIC NOT NULL,
  amount_crypto NUMERIC NOT NULL,
  price_at_transaction NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idm_tx_user ON idm_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_idm_tx_user_crypto ON idm_transactions(user_id, crypto_id);
CREATE INDEX IF NOT EXISTS idx_idm_tx_created ON idm_transactions(created_at);

ALTER TABLE idm_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_transactions_no_anon ON idm_transactions FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON idm_transactions FROM anon, authenticated;

-- =====================================================
-- Materialized View: User Holdings
-- =====================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS idm_user_holdings AS
SELECT
  user_id,
  crypto_id,
  SUM(CASE WHEN type = 'buy' THEN amount_crypto ELSE -amount_crypto END) AS total_crypto,
  SUM(CASE WHEN type = 'buy' THEN amount_fiat ELSE -amount_fiat END) AS total_invested,
  CASE
    WHEN SUM(CASE WHEN type = 'buy' THEN amount_crypto ELSE -amount_crypto END) > 0
    THEN SUM(CASE WHEN type = 'buy' THEN amount_fiat ELSE -amount_fiat END) /
         SUM(CASE WHEN type = 'buy' THEN amount_crypto ELSE -amount_crypto END)
    ELSE 0
  END AS average_price
FROM idm_transactions
GROUP BY user_id, crypto_id
HAVING SUM(CASE WHEN type = 'buy' THEN amount_crypto ELSE -amount_crypto END) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_idm_holdings_pk ON idm_user_holdings(user_id, crypto_id);

-- Auto-refresh holdings on transaction changes
CREATE OR REPLACE FUNCTION idm_refresh_holdings()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY idm_user_holdings;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_idm_refresh_holdings
  AFTER INSERT OR UPDATE OR DELETE ON idm_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION idm_refresh_holdings();

-- =====================================================
-- RPC: Increment group AI counters
-- =====================================================
CREATE OR REPLACE FUNCTION idm_increment_group_ai_today(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE idm_users
  SET group_ai_queries_today = group_ai_queries_today + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION idm_increment_group_ai_week(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE idm_users
  SET group_ai_queries_week = group_ai_queries_week + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
