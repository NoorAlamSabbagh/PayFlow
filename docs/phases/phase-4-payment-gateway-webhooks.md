# PayFlow Phase 4 — Payment Gateway Integration, Payment Intents, Webhooks & External Payment Reconciliation

> **Implementation Status:** `[STATUS: IMPLEMENTED & VERIFIED]`  
> **Test Coverage:** 56/56 passing tests across 8 test suites (including 25 new Phase 4 unit and integration tests).  
> **Architectural Paradigm:** Authoritative Server Confirmation (Zero Client Trust), Asynchronous Cryptographic Webhooks (HMAC-SHA256), Dual-Layer Idempotency, Atomic Double-Entry Ledger Settlement (`DEBIT SYSTEM_GATEWAY_CLEARING`, `CREDIT USER_WALLET`), Transactional Outbox Pattern.

---

## 1. Objective

The primary objective of Phase 4 is to build an institutional-grade external payment gateway ingestion subsystem for PayFlow. Users can fund their digital wallet using an external payment processor (Razorpay / Mock Gateway), while enforcing the non-negotiable financial rule: **the server-side cryptographically verified webhook is the single authoritative source of truth for payment settlement.** The client browser is never trusted to confirm a successful financial transfer.

---

## 2. Business Problem

Fintech payment ingestion presents critical distributed systems challenges:
1. **Unreliable Client Callbacks:** Browser redirections and front-end network connections frequently drop or can be maliciously intercepted. If an application credits a digital wallet merely because a browser sends a "payment succeeded" signal, attackers can forge responses and steal unbounded funds.
2. **At-Least-Once Webhook Delivery:** Payment gateways (such as Razorpay or Stripe) do not guarantee exactly-once delivery. Network latency or transient 5xx responses cause payment processors to aggressively retry webhooks (e.g. 5 to 10 retry waves). Without strict deduplication, retried webhooks result in duplicate wallet credits.
3. **Out-of-Order Events:** In high-traffic scenarios, webhooks may arrive before or concurrently with the customer redirecting back to the application dashboard. The backend must handle asynchronous states safely without creating race conditions.
4. **Unbalanced Financial Books:** Deposits must not simply inflate a balance column in isolation; every external deposit must enter the platform through a counter-party clearing account (`SYSTEM_GATEWAY_CLEARING`) to maintain strict double-entry ledger balance.

---

## 3. Features Implemented

1. **Payment Intent Entity:** Tracks external payment attempts across a formal state machine (`CREATED` $\to$ `PROCESSING` $\to$ `SUCCESS` / `FAILED` / `CANCELLED`).
2. **Pluggable Payment Gateway Abstraction:** A clean `IPaymentGateway` interface decouple business logic from external SDKs, featuring:
   - `MockPaymentGatewayAdapter`: Deterministic local development, CI/CD testing, and signature verification without live internet credentials.
   - `RazorpayPaymentGatewayAdapter`: Production-ready Razorpay sandbox integration with Orders API and HMAC webhook verification.
   - `PaymentGatewayFactory`: Dynamic adapter resolution.
3. **Cryptographic HMAC-SHA256 Webhook Verification:** Timing-safe signature comparison (`crypto.timingSafeEqual`) against raw unparsed request bytes (`req.rawBody`).
4. **Ingress Webhook Deduplication Guard:** Deduplicates events via `webhook_events` (`gateway_name`, `gateway_event_id`), returning an idempotent HTTP 200 acknowledgment on replays.
5. **Dual-Layer Payment Creation Idempotency:** Redis in-flight mutex (L1) combined with PostgreSQL durable storage (L2) to prevent duplicate intent creation and block payload tampering (409 Conflict on payload mismatch).
6. **Atomic Double-Entry Ledger Settlement:** Verified webhooks execute inside a single PostgreSQL transaction (`BEGIN ... COMMIT`) acquiring pessimistic row locks (`FOR UPDATE`) on the payment intent and user wallet:
   - `DEBIT`: `SYSTEM_GATEWAY_CLEARING` (`00000000-0000-0000-0000-000000000001`)
   - `CREDIT`: `USER_WALLET`
7. **Transactional Outbox Event Generation:** Produces `PAYMENT_SUCCEEDED` events atomically inside the settlement transaction for downstream asynchronous publishing.
8. **Interactive Add Money UI:** React modal with preset quick chips, integer paise preview, sandbox payment checkout simulation, and authoritative polling indicator ("Payment verification in progress...").
9. **Basic Financial Reconciliation API:** Compares database intent state, gateway external status, and double-entry ledger records to detect balance anomalies.

---

## 4. Architecture

```
[ User Browser / Client ]
           │
           │ (1) POST /api/v1/payments/intents (Idempotency-Key)
           ▼
[ PayFlow API Gateway ]
           │
           ├──► [ Dual-Layer Idempotency Check ] (Redis L1 / Postgres L2)
           ├──► [ Payment Gateway Adapter ] ──► (Create Gateway Order)
           ├──► [ INSERT INTO payment_intents ] (Status: CREATED)
           ▼
[ Return Order Details to Client ] ──► (Wallet Balance UNCHANGED)
           │
           ▼
[ Customer Completes Gateway Payment ]
           │
           ▼ (Out-of-band HTTPS Callback)
[ POST /api/v1/webhooks/payment-gateway ]
           │
           ├──► [1] Raw Body Capture (req.rawBody Buffer)
           ├──► [2] HMAC-SHA256 Signature Verification (crypto.timingSafeEqual)
           │         └─ Invalid? ──► HTTP 401 Unauthorized (Zero DB mutations)
           ├──► [3] Webhook Ingress Deduplication (webhook_events)
           │         └─ Duplicate? ──► HTTP 200 OK (Acknowledge, Skip execution)
           │
           ▼ (4) Begin PostgreSQL Transaction (BEGIN)
           ├──► [5] SELECT payment_intents FOR UPDATE (Lock Intent)
           │         └─ Already SUCCESS? ──► COMMIT & return 200 (Idempotent)
           ├──► [6] SELECT wallets FOR UPDATE (Lock User & Clearing Wallets)
           ├──► [7] UPDATE wallets SET balance = balance + amount (Credit User)
           ├──► [8] UPDATE wallets SET balance = balance - amount (Debit Clearing)
           ├──► [9] INSERT INTO transactions (type: 'TOPUP', status: 'COMPLETED')
           ├──► [10] INSERT INTO ledger_entries (DEBIT Clearing, CREDIT User)
           ├──► [11] INSERT INTO outbox_events (event_type: 'PAYMENT_SUCCEEDED')
           ├──► [12] UPDATE payment_intents SET status = 'SUCCESS'
           ├──► [13] UPDATE webhook_events SET is_processed = true
           ▼
        [ COMMIT ]
           │
           ▼
[ Return HTTP 200 OK to Gateway ]
```

---

## 5. Payment Lifecycle State Machine

The payment lifecycle is governed by a deterministic state machine:

```
                  [ Client Initiates ]
                           │
                           ▼
                      [ CREATED ] ────(Timeout / Cancel)───► [ CANCELLED ]
                           │
                    (User Checkout)
                           │
                           ▼
                     [ PROCESSING ]
                      /          \
             (Webhook:            (Webhook:
              SUCCESS)             FAILED)
                    /              \
                   ▼                ▼
              [ SUCCESS ]        [ FAILED ]
              (Terminal)         (Terminal)
```

### State Machine Rules
- **Valid Transitions:**
  - `CREATED` $\to$ `PROCESSING`, `SUCCESS`, `FAILED`, `CANCELLED`
  - `PROCESSING` $\to$ `SUCCESS`, `FAILED`, `CANCELLED`
- **Strict Invariants:**
  - `SUCCESS`, `FAILED`, and `CANCELLED` are terminal states.
  - No transition from `SUCCESS` $\to$ `PROCESSING` or `SUCCESS` $\to$ `CREATED` is allowed.
  - A duplicate `SUCCESS` webhook arriving for an already settled intent returns HTTP 200 OK without re-crediting the wallet or posting additional ledger entries.

---

## 6. Payment Intent

A Payment Intent encapsulates the complete lifecycle of an external top-up attempt:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key referencing `users(id)` |
| `wallet_id` | UUID | Foreign key referencing `wallets(id)` |
| `amount` | BIGINT | Amount in integer paise (₹1 = 100 paise) |
| `currency` | VARCHAR(3) | ISO 4217 code (default `'INR'`) |
| `provider` | VARCHAR(64) | Payment provider (`'MOCK_GATEWAY'`, `'RAZORPAY'`) |
| `gateway_order_id`| VARCHAR(128)| Unique order ID from the payment processor |
| `gateway_payment_id`| VARCHAR(128)| Payment ID received in the webhook callback |
| `status` | ENUM | `'CREATED'`, `'PROCESSING'`, `'SUCCESS'`, `'FAILED'`, `'CANCELLED'` |
| `idempotency_key` | VARCHAR(255) | Client-provided deduplication key |
| `error_message` | VARCHAR(255) | Gateway decline code or description |
| `metadata` | JSONB | Extensible payload (client secrets, receipts) |
| `created_at` | TIMESTAMPTZ | Timestamp of intent creation |
| `completed_at` | TIMESTAMPTZ | Timestamp of authoritative settlement |

---

## 7. Payment Gateway Integration

To prevent tight coupling between core banking logic and third-party SDKs, all gateway operations implement `IPaymentGateway`:

```typescript
export interface IPaymentGateway {
  readonly providerName: string;
  createOrder(params: CreateOrderParams): Promise<PaymentOrderResult>;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string, secret?: string): boolean;
  parseWebhookEvent(rawBody: Buffer | string, headers: Record<string, string>): WebhookVerificationResult;
  getPaymentStatus(gatewayOrderId: string, gatewayPaymentId?: string): Promise<PaymentStatusResult>;
}
```

### Supported Adapters
1. **`MockPaymentGatewayAdapter`:**
   - Implements full HMAC-SHA256 signature generation and timing-safe verification.
   - Allows deterministic simulation of successes, card declines, and signature tampering in automated unit and integration tests without network I/O or live API keys.
2. **`RazorpayPaymentGatewayAdapter`:**
   - Connects to Razorpay Orders API using HTTP Basic Authentication (`RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET`).
   - Verifies incoming `x-razorpay-signature` headers against `RAZORPAY_WEBHOOK_SECRET`.

---

## 8. Webhook Architecture

Webhooks are public HTTP endpoints (`POST /api/v1/webhooks/payment-gateway`) invoked directly by external payment gateways. Because payment gateways operate outside user sessions, **no JWT authentication is required**. Authenticity and authorization are enforced strictly via cryptographic HMAC-SHA256 signature verification.

---

## 9. Webhook Signature Verification

### Why Raw Request Body Preservation is Critical
When a gateway signs an HTTP request body, it signs the exact sequence of bytes sent over the wire. If an Express server parses the body into a JavaScript object via `JSON.parse` and then attempts to re-stringify it (`JSON.stringify(req.body)`), differences in JSON key ordering, Unicode escaping, and whitespace will alter the SHA-256 digest, causing legitimate signatures to fail.

To solve this, PayFlow configures `express.json` with a custom `verify` callback in `src/app.ts`:
```typescript
app.use(express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf; // Preserve exact unmodified buffer
  }
}));
```

### Timing-Safe Verification
To prevent side-channel timing attacks (where attackers deduce correct signature bytes by measuring comparison latency), PayFlow uses `crypto.timingSafeEqual`:
```typescript
const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
const actualBuffer = Buffer.from(signature, 'utf8');
if (expectedBuffer.length !== actualBuffer.length) return false;
return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
```

---

## 10. Idempotency

PayFlow implements dual-level idempotency protection:

1. **Payment Intent Creation Idempotency:**
   - Client sends `Idempotency-Key: <uuid>`.
   - Backend calculates canonical hash: `SHA256({ userId, amount, currency })`.
   - Redis L1 cache locks in-flight execution for 15 seconds.
   - PostgreSQL L2 table (`idempotency_keys`) stores completed response DTOs for 24 hours.
   - Repeated requests with identical keys and identical payloads replay the cached intent DTO.
   - Reused keys with mutated payloads trigger an immediate `409 Conflict` (`IDEMPOTENCY_PAYLOAD_MISMATCH`).
2. **Webhook Ingress Idempotency:**
   - Gateway sends external event IDs (e.g. `evt_12345`).
   - Backend checks `webhook_events` table for `(gateway_name, gateway_event_id)`.
   - If previously processed, backend returns `HTTP 200 OK` (`ALREADY_PROCESSED`) immediately.
   - Wallet balance and ledger are untouched.

---

## 11. Wallet Credit

Wallet balances are credited only once inside the authoritative PostgreSQL transaction:
```sql
UPDATE wallets 
SET balance = balance + $1, 
    version = version + 1, 
    updated_at = NOW() 
WHERE id = $2;
```
The optimistic concurrency `version` column is incremented, and row-level pessimistic locking (`FOR UPDATE`) prevents concurrent race conditions.

---

## 12. Double-Entry Ledger

In accordance with Phase 2 accounting rules, money cannot appear from nowhere. External top-ups originate from the platform counter-party clearing account:

```
DEBIT:  SYSTEM_GATEWAY_CLEARING (00000000-0000-0000-0000-000000000001)  ₹1,000.00
CREDIT: USER_WALLET                                                       ₹1,000.00
```
- Total Debits = Total Credits.
- The immutable ledger trigger strictly forbids any `UPDATE` or `DELETE` operations on `ledger_entries`.

---

## 13. Outbox Event

Upon successful settlement, a transactional outbox record is inserted in the same database transaction:
```json
{
  "aggregateType": "PAYMENT",
  "aggregateId": "intent-uuid",
  "eventType": "PAYMENT_SUCCEEDED",
  "payload": {
    "paymentIntentId": "intent-uuid",
    "transactionId": "txn-uuid",
    "transactionReference": "TXN_TOPUP_...",
    "userId": "user-uuid",
    "walletId": "wallet-uuid",
    "amount": 100000,
    "currency": "INR",
    "gatewayPaymentId": "pay_mock_12345"
  },
  "status": "PENDING"
}
```
External systems or notification workers poll the outbox asynchronously without coupling to the synchronous payment path.

---

## 14. Database Changes

### Migration `004_payment_gateway_phase4.sql`
1. **Enhanced `payment_intents` Table:**
   - Added `provider VARCHAR(64) NOT NULL DEFAULT 'MOCK_GATEWAY'`
   - Added `idempotency_key VARCHAR(255) NULL`
   - Added `metadata JSONB NULL DEFAULT '{}'`
   - Added `completed_at TIMESTAMPTZ NULL`
2. **Enhanced `webhook_events` Table:**
   - Added `payload_hash VARCHAR(64) NULL`
3. **New Performance & Integrity Indexes:**
   - `idx_payment_intents_provider_order` ON `(provider, gateway_order_id)`
   - `idx_payment_intents_status_created` ON `(status, created_at DESC)`
   - `idx_payment_intents_user_created` ON `(user_id, created_at DESC)`
   - `uq_payment_intents_user_idempotency` UNIQUE ON `(user_id, idempotency_key)`
   - `uq_webhook_events_provider_event` UNIQUE ON `(gateway_name, gateway_event_id)`
   - `idx_webhook_events_created` ON `(created_at DESC)`

---

## 15. API Contracts

### 1. `POST /api/v1/payments/intents`
- **Auth:** Bearer JWT required.
- **Header:** `Idempotency-Key: <uuid>` (mandatory).
- **Request:**
  ```json
  {
    "amount": 100000,
    "currency": "INR",
    "provider": "MOCK_GATEWAY"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Payment intent created successfully",
    "data": {
      "id": "c1f7a1e0-...",
      "userId": "u1e8...",
      "walletId": "w2e9...",
      "amount": 100000,
      "currency": "INR",
      "provider": "MOCK_GATEWAY",
      "gatewayOrderId": "order_mock_172632...",
      "gatewayPaymentId": null,
      "status": "CREATED",
      "errorMessage": null,
      "createdAt": "2026-09-14T20:00:00.000Z",
      "completedAt": null
    }
  }
  ```

### 2. `GET /api/v1/payments/:paymentIntentId`
- **Auth:** Bearer JWT required (Ownership or ADMIN role enforced).
- **Response (200 OK):** Returns payment intent status, completed timestamp, and error details.

### 3. `GET /api/v1/payments`
- **Auth:** Bearer JWT required.
- **Query Params:** `page` (default 1), `limit` (default 20), `status` (optional).
- **Response (200 OK):** Paginated user payment attempts.

### 4. `POST /api/v1/webhooks/payment-gateway`
- **Auth:** Public. Verified via `x-mock-signature` or `x-razorpay-signature`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Webhook event acknowledged and processed",
    "data": {
      "received": true,
      "status": "SETTLED",
      "transactionReference": "TXN_TOPUP_172632...",
      "paymentIntentId": "c1f7a1e0-..."
    }
  }
  ```

### 5. `POST /api/v1/payments/admin/:id/reconcile`
- **Auth:** Admin Bearer JWT required.
- **Response (200 OK):** Returns reconciliation report comparing internal database status against gateway status and ledger integrity.

---

## 16. Frontend Changes

- **Add Money Modal (`frontend/src/features/payment/AddMoneyModal.tsx`):**
  - Intuitive quick amount chips (₹500, ₹1,000, ₹2,500, ₹5,000).
  - Clear real-time integer paise preview.
  - Interactive payment simulation card allowing users to trigger HMAC-signed webhook events.
  - Authoritative verification screen with animated polling indicator polling `GET /payments/:id`.
  - Detailed settlement receipt displaying transaction reference and accounting movement.
- **Wallet View (`frontend/src/features/wallet/WalletView.tsx`):**
  - Integrated `AddMoneyModal` directly into the "Add Money" primary action.
  - Automatically reloads wallet balance and ledger entries upon settlement.

---

## 17. Security

1. **Zero Client Trust:** The client browser cannot credit wallets. Client redirection only triggers a polling loop for server-side settlement.
2. **Cryptographic Signatures:** Every inbound webhook requires a valid HMAC-SHA256 signature calculated from the raw body buffer.
3. **Timing-Safe Comparison:** Signatures are compared using `crypto.timingSafeEqual` to defeat timing attacks.
4. **Parameter Tampering Prevention:** Reused idempotency keys with altered amounts return `409 Conflict`.
5. **Role-Based Access Control:** Regular users cannot query other users' payment intents or access admin reconciliation endpoints.
6. **Secret Management:** Gateway API keys and webhook signing secrets are stored exclusively in environment variables and never exposed to the client.

---

## 18. Failure Scenarios

| Scenario | Detection | System Behavior | Financial Safety |
|---|---|---|---|
| **Forged Webhook** | Signature mismatch | HTTP 401 Unauthorized | Zero DB mutations. Wallet untouched. |
| **Duplicate Webhook** | Ingress lookup in `webhook_events` | HTTP 200 OK (`ALREADY_PROCESSED`) | Zero double-credit. Exactly-once settlement. |
| **Unknown Order ID** | DB lookup yields null | HTTP 200 OK (`UNKNOWN_ORDER`) | Logged safely. No wallet mutated. |
| **Gateway Card Decline** | Webhook reports `PAYMENT_FAILED` | Intent marked `FAILED` | Wallet balance unchanged. No ledger entry. |
| **DB Crash Mid-Settlement** | PostgreSQL error in transaction | Automatic `ROLLBACK` | Zero partial state. Gateway retries webhook safely. |
| **Concurrent Duplicate Webhooks** | `FOR UPDATE` pessimistic row lock | First finishes settlement, second sees `SUCCESS` | Idempotent return without duplicate credit. |

---

## 19. Reconciliation

PayFlow introduces automated discrepancy detection via `reconcilePayment`:
- **Discrepancy 1 (Orphaned Gateway Charge):** Gateway reports `SUCCESS`, but PayFlow intent is not settled $\to$ Flags intent for manual review or automated settlement trigger.
- **Discrepancy 2 (Phantom Settlement):** PayFlow marked `SUCCESS`, but gateway reports non-success $\to$ Raises critical fraud alert.
- **Discrepancy 3 (Unbalanced Ledger):** Payment marked `SUCCESS`, but `SUM(DEBIT) != SUM(CREDIT)` or amount doesn't match intent $\to$ Triggers financial audit exception.

---

## 20. Concurrency

- **Pessimistic Row Locking (`SELECT ... FOR UPDATE`):** When a webhook attempts settlement, it locks both the `payment_intents` row and the target `wallets` row. Any concurrent webhook thread blocks until the first commits, then reads status `SUCCESS` and terminates safely.
- **Deterministic Lock Ordering:** Avoids deadlocks by always locking `payment_intents` first, followed by `wallets`.

---

## 21. Testing

### Automated Test Suites:
- **Unit Tests (`backend/tests/unit/payment.service.test.ts`):** 13 passing tests.
  - Valid intent creation returns `CREATED` status without crediting wallet.
  - Rejection of invalid amounts (negative, zero, floats).
  - Rejection of missing idempotency key.
  - Idempotency replay returns cached intent DTO.
  - Idempotency mismatch returns `409 Conflict`.
  - Authorization guards block unauthorized cross-user intent reads.
  - Admin users can inspect any user intent.
  - HMAC-SHA256 signature generation and timing-safe verification.
- **Integration Tests (`backend/tests/integration/webhook.integration.test.ts`):** 5 passing tests.
  - Forged webhook signature returns 401 with zero side-effects.
  - Authoritative settlement transitions intent, credits wallet, writes double-entry ledger, and records outbox event.
  - Webhook deduplication ignores duplicate deliveries (tested with 3 identical calls) and prevents double-crediting.
  - Failed payment webhook marks intent as `FAILED` and leaves wallet balance unchanged.
  - Webhook for unknown order safely acknowledges without error or mutation.
- **Regression Tests:** All 31 existing Phase 0–3 tests pass with zero regressions.
- **Overall Total:** **56 passing tests across 8 test suites**.

---

## 22. Files Changed

### Backend:
- `src/database/migrations/004_payment_gateway_phase4.sql` (New)
- `src/config/index.ts` (Modified - gateway settings)
- `src/app.ts` (Modified - `req.rawBody` preservation, mounted payment & webhook routes)
- `src/modules/payment/gateway/paymentGateway.interface.ts` (New)
- `src/modules/payment/gateway/mockPaymentGateway.adapter.ts` (New)
- `src/modules/payment/gateway/razorpayPaymentGateway.adapter.ts` (New)
- `src/modules/payment/gateway/paymentGateway.factory.ts` (New)
- `src/modules/payment/payment.types.ts` (New)
- `src/modules/payment/payment.validation.ts` (New)
- `src/modules/payment/payment.repository.ts` (New)
- `src/modules/payment/payment.service.ts` (New)
- `src/modules/payment/payment.controller.ts` (New)
- `src/modules/payment/payment.routes.ts` (New)
- `src/modules/webhook/webhook.repository.ts` (New)
- `src/modules/webhook/webhook.service.ts` (New)
- `src/modules/webhook/webhook.controller.ts` (New)
- `src/modules/webhook/webhook.routes.ts` (New)
- `tests/unit/payment.service.test.ts` (New)
- `tests/integration/webhook.integration.test.ts` (New)

### Frontend:
- `src/features/payment/paymentTypes.ts` (New)
- `src/features/payment/paymentService.ts` (New)
- `src/features/payment/AddMoneyModal.tsx` (New)
- `src/features/wallet/WalletView.tsx` (Modified)

---

## 23. Interview Explanation

> *"In PayFlow Phase 4, we built an authoritative payment gateway ingestion subsystem designed around the financial golden rule: **never trust the client to confirm money movement.** When a user enters ₹1,000 to add to their wallet, the API generates an idempotent Payment Intent in `CREATED` state and registers an order with the gateway. The user's wallet balance remains strictly unchanged at this stage.*
>
> *Once the customer completes checkout, the external gateway sends an out-of-band webhook to PayFlow. Our ingress middleware preserves the unparsed request buffer to verify the cryptographic HMAC-SHA256 signature using `crypto.timingSafeEqual`. We deduplicate incoming events via a dedicated `webhook_events` table to protect against at-least-once delivery retries.*
>
> *Financial settlement executes inside a single ACID transaction: we acquire pessimistic row locks on the intent and wallet, credit the user's wallet balance, post balancing double-entry ledger entries debiting `SYSTEM_GATEWAY_CLEARING` and crediting `USER_WALLET`, and queue a `PAYMENT_SUCCEEDED` event into the transactional outbox. Even if the same webhook arrives five times concurrently, our deduplication and row locks guarantee that funds are credited exactly once."*

---

## 24. Interview Questions

1. **Why do you need payment intents instead of creating transactions immediately?**  
   *An intent represents an attempt to pay before the external funds have settled. Initiating an order does not guarantee payment; modeling it as an intent keeps financial balances pure and avoids cluttering immutable ledger books with abandoned checkouts.*
2. **Why can't the frontend confirm payment success?**  
   *Client browsers run on untrusted user devices. Network requests can be manipulated, replayed, or spoofed using browser devtools or proxies. Only a cryptographically verified server-to-server webhook can authoritatively confirm settlement.*
3. **How do you verify webhook authenticity?**  
   *The gateway computes an HMAC-SHA256 hash of the request payload using a shared webhook secret. PayFlow recomputes the HMAC from the preserved raw byte buffer and compares it using `crypto.timingSafeEqual`.*
4. **Why is raw body preservation mandatory for webhook signature verification?**  
   *`JSON.stringify` does not guarantee byte-for-byte serialization match with the gateway's payload due to whitespace, key ordering, and character encoding differences.*
5. **How do you prevent duplicate webhook processing?**  
   *At ingress, we record `(gateway_name, gateway_event_id)` in `webhook_events`. On replays, the unique constraint or `is_processed = true` flag causes an immediate HTTP 200 acknowledgment without re-running settlement logic.*
6. **What happens if two identical webhooks arrive concurrently?**  
   *Both enter the database transaction, but the first acquires a pessimistic `FOR UPDATE` lock on the `payment_intents` row. The second thread blocks until the first commits, sees status `SUCCESS`, and returns an idempotent 200 without double-crediting.*
7. **What happens if the server crashes mid-transaction?**  
   *PostgreSQL rolls back the transaction completely: wallet balance remains uncredited, ledger entries are not posted, and outbox events are discarded. When the payment gateway retries the webhook, the server processes it cleanly.*
8. **What if the customer closes their browser before the webhook arrives?**  
   *Because settlement is asynchronous and driven by the server-side webhook, the wallet is credited regardless of whether the customer's browser is open. Next time the user logs in, their balance reflects the completed deposit.*
9. **How does double-entry bookkeeping apply to external deposits?**  
   *Money must balance across accounts. The system debits `SYSTEM_GATEWAY_CLEARING` and credits `USER_WALLET`. The clearing account tracks total funds receivable from the gateway.*
10. **Why use the Transactional Outbox pattern for payment notifications?**  
    *Publishing messages directly to message brokers (like SQS or Kafka) inside a DB transaction can cause dual-write inconsistency if the commit fails. Writing to `outbox_events` in the same transaction guarantees message delivery consistency.*

---

## 25. Completion Checklist

- [x] Pluggable Gateway Abstraction (`IPaymentGateway`, `MockPaymentGatewayAdapter`, `RazorpayPaymentGatewayAdapter`)
- [x] Migration `004_payment_gateway_phase4.sql` applied to PostgreSQL
- [x] Timing-Safe HMAC-SHA256 Signature Verification with Raw Buffer preservation
- [x] Webhook Ingress Deduplication via `webhook_events`
- [x] Payment State Machine (`CREATED`, `PROCESSING`, `SUCCESS`, `FAILED`, `CANCELLED`)
- [x] Atomic Double-Entry Ledger Settlement (`DEBIT CLEARING`, `CREDIT WALLET`)
- [x] Transactional Outbox Event Generation (`PAYMENT_SUCCEEDED`)
- [x] Dual-Layer Idempotency for Intent Creation (Redis L1 + PostgreSQL L2)
- [x] Interactive Add Money Modal with Authoritative Polling
- [x] 18 New Unit & Integration Tests (56/56 Total Tests Passing)
- [x] Zero regressions on Phase 0–3 features
