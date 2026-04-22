CREATE TABLE wallet_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id   UUID REFERENCES wallets(id) NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
  amount      INT NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  booking_id  UUID REFERENCES bookings(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_wallet ON wallet_transactions(wallet_id, created_at DESC);
