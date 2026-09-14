-- ============================================================================
-- PayFlow Initial Database Schema Migration: 001_initial_schema.sql
-- Financial Grade Double-Entry Ledger, Idempotency, and Outbox Architecture
-- ============================================================================

-- Enable cryptographic UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Custom ENUM Types
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN', 'OPERATOR');
CREATE TYPE wallet_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE wallet_type AS ENUM ('USER', 'SYSTEM_ESCROW', 'SYSTEM_FEES', 'SYSTEM_GATEWAY_CLEARING');
CREATE TYPE transaction_type AS ENUM ('TOPUP', 'P2P_TRANSFER', 'REFUND', 'FEE', 'ADJUSTMENT');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');
CREATE TYPE ledger_entry_type AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE idempotency_status AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');
CREATE TYPE payment_intent_status AS ENUM ('CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE refund_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE outbox_status AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- ----------------------------------------------------------------------------
-- 1. Users Table
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role user_role NOT NULL DEFAULT 'USER',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ----------------------------------------------------------------------------
-- 2. Refresh Tokens (Token Family Rotation for Secure Session Replay Detection)
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash of refresh token
    family_id UUID NOT NULL,               -- Identifies the token generation family
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ----------------------------------------------------------------------------
-- 3. Wallets Table
-- Balance represents cached aggregate balance in integer cents/paise (₹1 = 100).
-- The immutable source of truth is always verified by the double-entry ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT, -- NULL for system accounts
    type wallet_type NOT NULL DEFAULT 'USER',
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    balance BIGINT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,                        -- Optimistic concurrency guard
    status wallet_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_wallet_balance_non_negative CHECK (
        type != 'USER' OR balance >= 0
    )
);

CREATE UNIQUE INDEX idx_wallets_user_currency ON wallets(user_id, currency) WHERE user_id IS NOT NULL;
CREATE INDEX idx_wallets_type ON wallets(type);

-- ----------------------------------------------------------------------------
-- 4. Transactions Table (Business Transaction Container)
-- ----------------------------------------------------------------------------
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_id VARCHAR(64) NOT NULL UNIQUE, -- Public idempotent tracking ref (e.g. TXN_...)
    type transaction_type NOT NULL,
    status transaction_status NOT NULL DEFAULT 'PENDING',
    amount BIGINT NOT NULL,                   -- Stored in smallest integer unit (cents/paise)
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    sender_wallet_id UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    receiver_wallet_id UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    failure_reason VARCHAR(255) NULL,
    metadata JSONB NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_transaction_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_transactions_reference ON transactions(reference_id);
CREATE INDEX idx_transactions_sender ON transactions(sender_wallet_id);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_wallet_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Ledger Entries Table (Strict Double-Entry Bookkeeping - IMMUTABLE)
-- For every completed transaction, the sum of debits MUST EQUAL the sum of credits.
-- ----------------------------------------------------------------------------
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    entry_type ledger_entry_type NOT NULL,
    amount BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_wallet_timeline ON ledger_entries(wallet_id, created_at DESC);

-- FINANCIAL IMMUTABILITY TRIGGER: Disallow UPDATE or DELETE on ledger_entries
CREATE OR REPLACE FUNCTION enforce_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL AUDIT ERROR: ledger_entries is an immutable table. UPDATE and DELETE operations are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutability
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_immutability();

-- ----------------------------------------------------------------------------
-- 6. Idempotency Keys Table (Persistent L2 Idempotency Barrier)
-- ----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    request_path VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,       -- SHA-256 of payload to guard against parameter mutation
    response_status INT NULL,
    response_body JSONB NULL,
    status idempotency_status NOT NULL DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_user_idempotency_key UNIQUE (user_id, key)
);

CREATE INDEX idx_idempotency_lookup ON idempotency_keys(user_id, key);
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);

-- ----------------------------------------------------------------------------
-- 7. Payment Intents Table (Mock Gateway Integration & Top-up Sessions)
-- ----------------------------------------------------------------------------
CREATE TABLE payment_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    gateway_order_id VARCHAR(128) NOT NULL UNIQUE,
    gateway_payment_id VARCHAR(128) NULL UNIQUE,
    status payment_intent_status NOT NULL DEFAULT 'CREATED',
    error_message VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payment_intent_amount CHECK (amount > 0)
);

CREATE INDEX idx_payment_intents_order ON payment_intents(gateway_order_id);
CREATE INDEX idx_payment_intents_user ON payment_intents(user_id);

-- ----------------------------------------------------------------------------
-- 8. Webhook Events Table (External Webhook Audit & Idempotent Consumer)
-- ----------------------------------------------------------------------------
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gateway_name VARCHAR(64) NOT NULL DEFAULT 'MOCK_GATEWAY',
    gateway_event_id VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    is_processed BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMPTZ NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_gateway_id ON webhook_events(gateway_name, gateway_event_id);

-- ----------------------------------------------------------------------------
-- 9. Refunds Table
-- ----------------------------------------------------------------------------
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE RESTRICT,
    original_transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    reason VARCHAR(255) NOT NULL,
    status refund_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_refund_amount CHECK (amount > 0)
);

CREATE INDEX idx_refunds_intent ON refunds(payment_intent_id);

-- ----------------------------------------------------------------------------
-- 10. Outbox Events Table (Transactional Outbox Pattern for SQS Publishing)
-- ----------------------------------------------------------------------------
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,      -- e.g. 'TRANSACTION', 'WALLET', 'PAYMENT'
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,          -- e.g. 'TRANSFER_COMPLETED', 'TOPUP_SUCCESS'
    payload JSONB NOT NULL,
    status outbox_status NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL
);

-- Fast index for the outbox poller using SKIP LOCKED
CREATE INDEX idx_outbox_pending_poller ON outbox_events(created_at ASC) WHERE status = 'PENDING';

-- ----------------------------------------------------------------------------
-- 11. Audit Logs Table
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    changes JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ----------------------------------------------------------------------------
-- 12. Seed Platform System Accounts
-- Standard double-entry counter-party clearing accounts
-- ----------------------------------------------------------------------------
INSERT INTO wallets (id, user_id, type, currency, balance, status)
VALUES 
    ('00000000-0000-0000-0000-000000000001', NULL, 'SYSTEM_GATEWAY_CLEARING', 'INR', 0, 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000002', NULL, 'SYSTEM_ESCROW', 'INR', 0, 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000003', NULL, 'SYSTEM_FEES', 'INR', 0, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
