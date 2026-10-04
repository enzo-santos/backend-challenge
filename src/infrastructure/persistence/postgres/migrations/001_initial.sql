CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  player_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  balance NUMERIC(20, 2) NOT NULL CHECK (balance >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (player_id, currency)
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets (id),
  provider_id TEXT NOT NULL,
  external_id TEXT,
  idempotency_key TEXT,
  payload_hash CHAR(64),
  idempotency_output JSONB,
  type TEXT NOT NULL CHECK (type IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
  amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  player_id TEXT,
  round_id TEXT,
  game_id TEXT,
  failure_code TEXT,
  referenced_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  pending_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pending_attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  CHECK ((idempotency_key IS NULL) = (payload_hash IS NULL)),
  CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$'),
  CHECK (
    (status IN ('REJECTED', 'FAILED')) = (failure_code IS NOT NULL)
  ),
  CHECK (processed_at IS NULL OR status = 'PROCESSED')
);

CREATE UNIQUE INDEX transactions_provider_external_id_uq
  ON transactions (provider_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX transactions_provider_idempotency_key_uq
  ON transactions (provider_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX transactions_pending_references_idx
  ON transactions (status, next_attempt_at, created_at, id);

CREATE TABLE ledger_items (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions (id),
  wallet_id UUID NOT NULL REFERENCES wallets (id),
  type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  balance_before NUMERIC(20, 2) NOT NULL CHECK (balance_before >= 0),
  amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(20, 2) NOT NULL CHECK (balance_after >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (transaction_id),
  CHECK (
    (type = 'CREDIT' AND balance_after = balance_before + amount)
    OR (type = 'DEBIT' AND balance_after = balance_before - amount)
  )
);

CREATE INDEX ledger_items_wallet_order_idx
  ON ledger_items (wallet_id, created_at, id);

CREATE TABLE inbox_messages (
  consumer_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (consumer_name, message_id)
);

CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_code TEXT
);

CREATE INDEX outbox_messages_due_idx
  ON outbox_messages (next_attempt_at, lease_until, occurred_at, id)
  WHERE published_at IS NULL AND failed_at IS NULL;
