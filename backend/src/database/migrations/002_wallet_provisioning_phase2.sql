-- ============================================================================
-- PayFlow Migration: 002_wallet_provisioning_phase2.sql
-- Ensure system accounts exist and backfill wallets for pre-existing users
-- ============================================================================

-- 1. Ensure system accounting wallets exist with deterministic IDs
INSERT INTO wallets (id, user_id, type, currency, balance, status)
VALUES 
    ('00000000-0000-0000-0000-000000000001', NULL, 'SYSTEM_GATEWAY_CLEARING', 'INR', 0, 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000002', NULL, 'SYSTEM_ESCROW', 'INR', 0, 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000003', NULL, 'SYSTEM_FEES', 'INR', 0, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 2. Safely provision active 'USER' wallets for any pre-existing users who don't have one yet
INSERT INTO wallets (user_id, type, currency, balance, status)
SELECT id, 'USER', 'INR', 0, 'ACTIVE'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.currency = 'INR'
)
ON CONFLICT (user_id, currency) WHERE user_id IS NOT NULL DO NOTHING;
