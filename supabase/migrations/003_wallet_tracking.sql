-- =====================================================
-- IDM Bot: Wallet Tracking
-- Tabela para monitorar endereços de carteira on-chain
-- =====================================================

CREATE TABLE IF NOT EXISTS idm_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES idm_users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('bitcoin', 'ethereum', 'solana', 'base')),
  label TEXT, -- apelido opcional (ex: "minha cold wallet")
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Um usuário não pode monitorar o mesmo endereço duas vezes
  UNIQUE(user_id, address)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_idm_wallets_user_id ON idm_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_idm_wallets_address ON idm_wallets(address);

-- RLS: bloqueia acesso público (igual às outras tabelas)
ALTER TABLE idm_wallets ENABLE ROW LEVEL SECURITY;

-- Bloqueia anon e authenticated (só service_role acessa)
REVOKE ALL ON idm_wallets FROM anon, authenticated;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_idm_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_idm_wallets_updated_at
  BEFORE UPDATE ON idm_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_idm_wallets_updated_at();
