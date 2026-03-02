-- =====================================================
-- RETROACTIVE: Exported from Supabase (tables already exist)
-- IDM Bot: Core tables — DCA goals, wallets, tiers, alerts
-- =====================================================

-- =====================================================
-- DCA Goals
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_dca_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  crypto_id VARCHAR(50) NOT NULL,
  goal_amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, crypto_id)
);

CREATE INDEX IF NOT EXISTS idx_idm_dca_user ON idm_dca_goals(user_id);

ALTER TABLE idm_dca_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_dca_goals_no_anon ON idm_dca_goals FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON idm_dca_goals FROM anon, authenticated;

CREATE TRIGGER trg_idm_dca_updated
  BEFORE UPDATE ON idm_dca_goals
  FOR EACH ROW EXECUTE FUNCTION idm_update_timestamp();

-- =====================================================
-- Wallets (on-chain tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, address)
);

CREATE INDEX IF NOT EXISTS idx_idm_wallets_user_id ON idm_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_idm_wallets_address ON idm_wallets(address);

ALTER TABLE idm_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_wallets_no_anon ON idm_wallets FOR ALL USING (false);
REVOKE ALL ON idm_wallets FROM anon, authenticated;

-- =====================================================
-- Tier Limits (config table)
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_tier_limits (
  tier TEXT PRIMARY KEY,
  max_wallets INTEGER NOT NULL,
  max_chains TEXT[] NOT NULL,
  group_ai_enabled BOOLEAN NOT NULL DEFAULT false,
  group_ai_daily_limit INTEGER NOT NULL DEFAULT 0,
  alerts_enabled BOOLEAN NOT NULL DEFAULT false,
  max_alerts INTEGER NOT NULL DEFAULT 0,
  weekly_report BOOLEAN NOT NULL DEFAULT false,
  daily_report BOOLEAN NOT NULL DEFAULT false,
  export_csv BOOLEAN NOT NULL DEFAULT false,
  price_monthly_brl NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE idm_tier_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_tier_limits_no_anon ON idm_tier_limits FOR ALL USING (false);
REVOKE ALL ON idm_tier_limits FROM anon, authenticated;

-- Seed tier data
INSERT INTO idm_tier_limits (tier, max_wallets, max_chains, group_ai_enabled, group_ai_daily_limit, alerts_enabled, max_alerts, weekly_report, daily_report, export_csv, price_monthly_brl)
VALUES
  ('free', 2, ARRAY['bitcoin','ethereum','solana'], true, 3, true, 1, false, false, false, 0.00),
  ('pro', 10, ARRAY['bitcoin','ethereum','solana','base','polygon','arbitrum','bnb','optimism','avalanche'], true, 50, true, 10, true, false, false, 19.90),
  ('whale', -1, ARRAY['bitcoin','ethereum','solana','base','polygon','arbitrum','bnb','optimism','avalanche'], true, -1, true, 50, true, true, true, 49.90)
ON CONFLICT (tier) DO NOTHING;

-- =====================================================
-- Price Alerts
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  crypto_id VARCHAR(50) NOT NULL,
  target_price NUMERIC NOT NULL,
  alert_type VARCHAR(10) NOT NULL,
  is_triggered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_idm_alerts_user ON idm_price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_idm_alerts_active ON idm_price_alerts(crypto_id, target_price) WHERE is_triggered = false;

ALTER TABLE idm_price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_price_alerts_no_anon ON idm_price_alerts FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON idm_price_alerts FROM anon, authenticated;

-- =====================================================
-- Legacy alerts table (kept for compatibility)
-- =====================================================
CREATE TABLE IF NOT EXISTS idm_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  crypto_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  target_price NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idm_alerts_user_id ON idm_alerts(user_id);

ALTER TABLE idm_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY idm_alerts_no_anon ON idm_alerts FOR ALL USING (false);
REVOKE ALL ON idm_alerts FROM anon, authenticated;
