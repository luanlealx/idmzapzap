-- =====================================================
-- 006: Payments table for PIX + Crypto checkout
-- =====================================================

CREATE TABLE IF NOT EXISTS idm_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'whale')),
  duration_days INTEGER NOT NULL DEFAULT 30,
  method TEXT NOT NULL CHECK (method IN ('pix', 'crypto')),
  amount_brl NUMERIC(10,2) NOT NULL,
  amount_usd NUMERIC(10,2),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'failed', 'refunded')),

  -- PIX (MercadoPago)
  mp_payment_id TEXT,
  pix_qr_code TEXT,
  pix_qr_code_base64 TEXT,

  -- Crypto (USDT on Base)
  crypto_chain TEXT,
  crypto_token TEXT,
  crypto_amount NUMERIC(12,4),
  crypto_address TEXT,
  crypto_tx_hash TEXT,

  -- Timestamps
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_idm_payments_user_status ON idm_payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_idm_payments_mp_id ON idm_payments(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idm_payments_tx_hash ON idm_payments(crypto_tx_hash) WHERE crypto_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idm_payments_expires ON idm_payments(expires_at) WHERE status = 'pending';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_idm_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_idm_payments_updated ON idm_payments;
CREATE TRIGGER trg_idm_payments_updated
  BEFORE UPDATE ON idm_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_idm_payments_updated_at();

-- RLS
ALTER TABLE idm_payments ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (backend uses service_role key)
CREATE POLICY "Service role full access" ON idm_payments
  FOR ALL USING (true) WITH CHECK (true);
