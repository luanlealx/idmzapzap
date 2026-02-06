-- IDM Portfolio Bot - Initial Schema
-- Run this migration manually in the Supabase Dashboard SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index on phone_number for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crypto_id VARCHAR(50) NOT NULL, -- CoinGecko ID (e.g., 'bitcoin', 'ethereum')
    type VARCHAR(10) NOT NULL CHECK (type IN ('buy', 'sell')),
    amount_fiat DECIMAL(18, 2) NOT NULL, -- Amount in BRL
    amount_crypto DECIMAL(24, 12) NOT NULL, -- Amount of crypto
    price_at_transaction DECIMAL(18, 8) NOT NULL, -- Price per unit in BRL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for transactions
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_crypto ON transactions(user_id, crypto_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- Materialized view for user holdings (for performance)
CREATE MATERIALIZED VIEW IF NOT EXISTS user_holdings AS
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
FROM transactions
GROUP BY user_id, crypto_id
HAVING SUM(CASE WHEN type = 'buy' THEN amount_crypto ELSE -amount_crypto END) > 0;

-- Index on user_holdings
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_holdings_user_crypto
ON user_holdings(user_id, crypto_id);

-- Function to refresh user_holdings
CREATE OR REPLACE FUNCTION refresh_user_holdings()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_holdings;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh user_holdings on transaction changes
DROP TRIGGER IF EXISTS trigger_refresh_user_holdings ON transactions;
CREATE TRIGGER trigger_refresh_user_holdings
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_user_holdings();

-- DCA Goals table
CREATE TABLE IF NOT EXISTS dca_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crypto_id VARCHAR(50) NOT NULL,
    goal_amount DECIMAL(18, 2) NOT NULL, -- Goal amount in BRL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, crypto_id)
);

-- Index on dca_goals
CREATE INDEX IF NOT EXISTS idx_dca_goals_user_id ON dca_goals(user_id);

-- Price Alerts table (for future feature)
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crypto_id VARCHAR(50) NOT NULL,
    target_price DECIMAL(18, 8) NOT NULL, -- Target price in BRL
    alert_type VARCHAR(10) NOT NULL CHECK (alert_type IN ('above', 'below')),
    is_triggered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    triggered_at TIMESTAMP WITH TIME ZONE
);

-- Indexes on price_alerts
CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_not_triggered
ON price_alerts(crypto_id, target_price) WHERE is_triggered = FALSE;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to users
DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to dca_goals
DROP TRIGGER IF EXISTS trigger_dca_goals_updated_at ON dca_goals;
CREATE TRIGGER trigger_dca_goals_updated_at
BEFORE UPDATE ON dca_goals
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Note: These are optional and depend on your security requirements

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dca_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- Policy to allow the service role to access all data
-- (The anon key should be restricted to specific operations via API)
CREATE POLICY "Service role full access to users" ON users
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to transactions" ON transactions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to dca_goals" ON dca_goals
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to price_alerts" ON price_alerts
    FOR ALL USING (true) WITH CHECK (true);
