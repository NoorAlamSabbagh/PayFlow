-- ============================================================================
-- PayFlow Migration: 003_p2p_transfer_indexes.sql
-- Optimizing P2P Money Transfer Lookups and Timeline Pagination
-- ============================================================================

-- 1. Accelerate high-frequency queries for sender and receiver transfer history
CREATE INDEX IF NOT EXISTS idx_transactions_sender_created 
  ON transactions(sender_wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_receiver_created 
  ON transactions(receiver_wallet_id, created_at DESC);

-- 2. Compound index on idempotency lookup with user_id
CREATE INDEX IF NOT EXISTS idx_idempotency_user_key 
  ON idempotency_keys(user_id, key);

-- 3. Accelerated index for pending outbox message dispatch
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending 
  ON outbox_events(status, created_at ASC);
