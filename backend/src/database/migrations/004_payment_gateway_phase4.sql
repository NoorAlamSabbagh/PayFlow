-- ============================================================================
-- PayFlow Migration: 004_payment_gateway_phase4.sql
-- External Payment Gateway Integration, Payment Intents, Webhooks & Idempotency
-- ============================================================================

-- 1. Enhance payment_intents table
ALTER TABLE payment_intents 
  ADD COLUMN IF NOT EXISTS provider VARCHAR(64) NOT NULL DEFAULT 'MOCK_GATEWAY',
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

-- 2. Enhance webhook_events table
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(64) NULL;

-- 3. Dedicated Indexes for Performance & Data Integrity
CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_order 
  ON payment_intents(provider, gateway_order_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_status_created 
  ON payment_intents(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user_created 
  ON payment_intents(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_intents_user_idempotency 
  ON payment_intents(user_id, idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_provider_event 
  ON webhook_events(gateway_name, gateway_event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created 
  ON webhook_events(created_at DESC);
