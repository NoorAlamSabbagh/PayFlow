# PayFlow Database Design & Schema Specification

## 1. Relational Entity Overview
PostgreSQL 16 serves as the primary relational data store for PayFlow, enforcing ACID transaction boundaries and financial consistency.

```
+---------------+        1:1       +---------------+
|     users     |------------------|    wallets    |
+---------------+                  +---------------+
        |                                  |
        | 1:N                              | 1:N
        v                                  v
+---------------+                  +---------------+
| refresh_tokens|                  |ledger_entries |
+---------------+                  +---------------+
                                           |
                                           | N:1
                                           v
+---------------+ 1:1              +---------------+
|idempotency_keys|-----------------| transactions  |
+---------------+                  +---------------+
                                           |
                                           | 1:N
                                           v
                                   +---------------+
                                   | outbox_events |
                                   +---------------+
```

## 2. Table Specifications & Indexes

### 2.1 `users`
- **Purpose:** Manages core user identity, credentials, role-based authorization, and account state.
- **Columns:**
  - `id` (UUID, PK): Auto-generated v4 UUID.
  - `email` (VARCHAR(255), UNIQUE, NOT NULL): Canonical user email address.
  - `password_hash` (VARCHAR(255), NOT NULL): Salted hash generated via Bcrypt / Argon2.
  - `full_name` (VARCHAR(150), NOT NULL).
  - `role` (user_role ENUM: `'USER'`, `'ADMIN'`, `'OPERATOR'`).
  - `is_active` (BOOLEAN, DEFAULT true).
  - `created_at`, `updated_at` (TIMESTAMPTZ).
- **Indexes:**
  - `idx_users_email` on `email`.

### 2.2 `refresh_tokens`
- **Purpose:** Supports JWT refresh token rotation with token family replay detection.
- **Columns:**
  - `id` (UUID, PK).
  - `user_id` (UUID, FK -> `users.id` ON DELETE CASCADE).
  - `token_hash` (VARCHAR(64), UNIQUE): SHA-256 hash of refresh token secret.
  - `family_id` (UUID): Identifier tying generations of rotated refresh tokens together.
  - `is_revoked` (BOOLEAN, DEFAULT false).
  - `expires_at` (TIMESTAMPTZ).
  - `created_at` (TIMESTAMPTZ).
- **Indexes:**
  - `idx_refresh_tokens_user` on `user_id`.
  - `idx_refresh_tokens_family` on `family_id`.

### 2.3 `wallets`
- **Purpose:** Represents individual user wallets as well as system clearing accounts.
- **Columns:**
  - `id` (UUID, PK).
  - `user_id` (UUID, FK -> `users.id`, NULL for platform system accounts).
  - `type` (wallet_type ENUM: `'USER'`, `'SYSTEM_ESCROW'`, `'SYSTEM_FEES'`, `'SYSTEM_GATEWAY_CLEARING'`).
  - `currency` (VARCHAR(3), DEFAULT `'INR'`).
  - `balance` (BIGINT, DEFAULT 0, CHECK: `type != 'USER' OR balance >= 0`).
  - `version` (BIGINT, DEFAULT 0): Concurrency version counter.
  - `status` (wallet_status ENUM: `'ACTIVE'`, `'FROZEN'`, `'CLOSED'`).
  - `created_at`, `updated_at` (TIMESTAMPTZ).
- **Constraints & Indexes:**
  - Unique compound partial index: `idx_wallets_user_currency` on `(user_id, currency)` WHERE `user_id IS NOT NULL`.
  - Non-negative check constraint: User wallets can never have a negative balance at the database constraint level.

### 2.4 `transactions`
- **Purpose:** High-level business transaction records encapsulating transfers, deposits, and refunds.
- **Columns:**
  - `id` (UUID, PK).
  - `reference_id` (VARCHAR(64), UNIQUE, NOT NULL): Public human-readable reference (e.g. `TXN_20260914_...`).
  - `type` (transaction_type ENUM: `'TOPUP'`, `'P2P_TRANSFER'`, `'REFUND'`, `'FEE'`, `'ADJUSTMENT'`).
  - `status` (transaction_status ENUM: `'PENDING'`, `'COMPLETED'`, `'FAILED'`, `'REVERSED'`).
  - `amount` (BIGINT, NOT NULL, CHECK: `amount > 0`).
  - `currency` (VARCHAR(3), NOT NULL).
  - `sender_wallet_id` (UUID, FK -> `wallets.id`).
  - `receiver_wallet_id` (UUID, FK -> `wallets.id`).
  - `failure_reason` (VARCHAR(255)).
  - `metadata` (JSONB).
  - `created_at`, `updated_at` (TIMESTAMPTZ).
- **Indexes:**
  - `idx_transactions_reference` on `reference_id`.
  - `idx_transactions_sender` on `sender_wallet_id`.
  - `idx_transactions_receiver` on `receiver_wallet_id`.
  - `idx_transactions_created_at` on `created_at DESC`.

### 2.5 `ledger_entries` (Append-Only & Immutable)
- **Purpose:** Audit-compliant double-entry ledger. Stores every granular debit and credit.
- **Columns:**
  - `id` (UUID, PK).
  - `transaction_id` (UUID, FK -> `transactions.id`).
  - `wallet_id` (UUID, FK -> `wallets.id`).
  - `entry_type` (ledger_entry_type ENUM: `'DEBIT'`, `'CREDIT'`).
  - `amount` (BIGINT, NOT NULL, CHECK: `amount > 0`).
  - `balance_after` (BIGINT, NOT NULL): Wallet balance immediately after entry was applied.
  - `description` (VARCHAR(255)).
  - `created_at` (TIMESTAMPTZ, DEFAULT NOW()).
- **Immutability Enforcement:**
  Enforced via PostgreSQL trigger `trg_ledger_immutability`. Any `UPDATE` or `DELETE` statement triggers an uncatchable database exception.

### 2.6 `idempotency_keys`
- **Purpose:** Guaranteed exactly-once execution barrier for HTTP APIs.
- **Columns:**
  - `id` (UUID, PK).
  - `user_id` (UUID, FK -> `users.id`).
  - `key` (VARCHAR(255), NOT NULL): Client-supplied idempotency key.
  - `request_path` (VARCHAR(255), NOT NULL).
  - `request_hash` (VARCHAR(64), NOT NULL): SHA-256 hash of JSON request payload.
  - `response_status` (INT NULL).
  - `response_body` (JSONB NULL).
  - `status` (idempotency_status ENUM: `'IN_PROGRESS'`, `'COMPLETED'`, `'FAILED'`).
  - `created_at`, `expires_at` (TIMESTAMPTZ).
- **Constraints:**
  - `UNIQUE (user_id, key)`: Prevents duplicate execution across identical keys.

### 2.7 `outbox_events`
- **Purpose:** Implements the Transactional Outbox Pattern for atomic database writes and SQS message publishing.
- **Columns:**
  - `id` (UUID, PK).
  - `aggregate_type` (VARCHAR(64)): e.g. `'TRANSACTION'`.
  - `aggregate_id` (UUID).
  - `event_type` (VARCHAR(64)): e.g. `'TRANSFER_COMPLETED'`.
  - `payload` (JSONB).
  - `status` (outbox_status ENUM: `'PENDING'`, `'PUBLISHED'`, `'FAILED'`).
  - `retry_count` (INT, DEFAULT 0).
  - `created_at`, `published_at` (TIMESTAMPTZ).
- **Indexes:**
  - Partial index `idx_outbox_pending_poller` on `created_at ASC` WHERE `status = 'PENDING'`.
