# PayFlow Failure Scenarios & Resilience Engineering

## 1. Concurrency & Financial Race Conditions

### 1.1 Double-Spend Attack via Concurrent Requests
- **Scenario:** User with ₹1,000 balance fires two concurrent transfer requests of ₹1,000 at the exact same millisecond.
- **Defense Mechanism:**
  1. **L1 Mutex:** If requests share the same `Idempotency-Key`, Redis `SETNX` allows only one through, rejecting the duplicate with `409 Conflict`.
  2. **Pessimistic Row Lock:** If requests have different idempotency keys, both reach PostgreSQL. The first transaction locks the sender's wallet row using `SELECT ... FOR UPDATE`.
  3. The second transaction blocks waiting for the first transaction's lock.
  4. First transaction decrements balance to ₹0 and commits.
  5. Second transaction wakes up, re-evaluates `balance >= amount` (which is now `0 >= 100000 = false`), rolls back, and returns `400 Insufficient Funds`.

### 1.2 Deadlock on Bi-Directional Transfers
- **Scenario:** User A transfers to User B while User B transfers to User A simultaneously.
- **Risk:** Transaction 1 locks Wallet A and requests Wallet B; Transaction 2 locks Wallet B and requests Wallet A. Classic circular deadlock.
- **Defense Mechanism:**
  - **Deterministic Lock Ordering:** The application sorts wallet IDs lexicographically before acquiring locks:
    ```typescript
    const [firstLockId, secondLockId] = [senderId, receiverId].sort();
    await client.query('SELECT * FROM wallets WHERE id IN ($1, $2) ORDER BY id ASC FOR UPDATE', [firstLockId, secondLockId]);
    ```
  - Both transactions will attempt to lock the lower UUID first. Transaction 1 acquires it; Transaction 2 waits on the lower UUID before touching the higher UUID. Deadlock is eliminated.

### 1.3 Intermediate Crash During Financial Deposit (Atomicity Protection)
- **Scenario:** The server executes the `INSERT INTO ledger_entries` query, but crashes or loses network connectivity before `UPDATE wallets SET balance = ...` can be executed.
- **Defense Mechanism:**
  - In PostgreSQL, multi-statement queries run inside an explicit `BEGIN ... COMMIT` transaction.
  - If the client drops, times out, or catches an error, the connection issues `ROLLBACK` (or PostgreSQL automatically terminates and rolls back the uncommitted transaction upon socket close).
  - Both the ledger entry and balance change are completely rolled back. Zero orphan ledger records or partial financial state can persist.

### 1.4 Attempted Unbalanced Ledger Injection
- **Scenario:** A software defect or malicious request attempts to deposit funds by crediting a user without a corresponding counterparty debit, or submits non-zero difference between debits and credits.
- **Defense Mechanism:**
  - The `LedgerService` enforces runtime validation before any SQL statement is generated:
    $$\sum \text{Debits} == \sum \text{Credits} == \text{Amount}$$
  - If debits != credits, an immediate `BadRequestError('UNBALANCED_LEDGER_TRANSACTION')` is raised, aborting execution before touching the database.

---

## 2. Network Partitions & Gateway Failures

### 2.1 Network Timeout on Client Request
- **Scenario:** Client initiates transfer; the server executes the transfer and commits to DB, but the client's connection drops before receiving the HTTP 200 response.
- **Resolution:**
  - Client retries with the exact same `Idempotency-Key`.
  - Server intercepts the key in `idempotency_keys` table, detects status `'COMPLETED'`, and immediately replays the cached HTTP 200 response without re-executing any ledger entries.

### 2.2 Duplicate or Out-of-Order Webhooks
- **Scenario:** Payment gateway retries webhook delivery three times or delivers them out of order.
- **Resolution:**
  - Inbound webhook handler records the unique `gateway_event_id` in `webhook_events` table within a unique constraint.
  - Subsequent duplicate webhook deliveries hit `ON CONFLICT DO NOTHING`, returning HTTP 200 instantly without applying balance credits twice.

---

## 3. Asynchronous Streaming & Worker Failures

### 3.1 Outbox Poller Crash or SQS Unavailability
- **Scenario:** Database commits financial ledger entry, but LocalStack/AWS SQS is unreachable when the outbox relay attempts to publish.
- **Resolution:**
  - The event remains safely persisted in `outbox_events` with `status = 'PENDING'`.
  - The poller increments `retry_count` with exponential backoff.
  - Once SQS recovers, the poller resumes dispatching pending events with at-least-once delivery guarantees.

### 3.2 Worker Failure & Poison Pill Messages
- **Scenario:** Worker crashes or throws an unhandled exception while processing an event from SQS.
- **Resolution:**
  - SQS visibility timeout expires; message is redelivered up to max receive count (e.g. 3 retries).
  - If it continuously fails, message is moved to an **AWS SQS Dead-Letter Queue (DLQ)** for operator inspection and alerting.

---

## 4. Phase 4: Payment Gateway & Webhook Failure Scenarios

### 4.1 Forged / Tampered Webhook Signature
- **Problem:** Malicious actor invokes `POST /api/v1/webhooks/payment-gateway` with forged "payment.captured" JSON payload attempting to inject fake wallet credits.
- **Detection:** Gateway adapter computes HMAC-SHA256 of `req.rawBody` buffer against `GATEWAY_WEBHOOK_SECRET` and compares with `x-signature` using `crypto.timingSafeEqual`.
- **Handling:** Rejects immediately with `401 Unauthorized` (`INVALID_WEBHOOK_SIGNATURE`).
- **Financial Safety:** Zero database transactions opened. Zero wallet mutations.
- **Recovery:** IP logging and rate-limiting to mitigate brute-force attempts.

### 4.2 Webhook Ingress Duplicate Delivery (Replay Attack)
- **Problem:** Payment gateway retries successful payment webhook three times due to network latency.
- **Detection:** Ingress check queries `webhook_events` for `(gateway_name, gateway_event_id)`.
- **Handling:** If record exists with `is_processed = true`, returns HTTP 200 OK (`ALREADY_PROCESSED`) immediately.
- **Financial Safety:** Wallet balance and ledger entries are created ONLY ONCE on the initial delivery.
- **Recovery:** Self-healing; gateway receives 200 OK and stops retry attempts.

### 4.3 Concurrent Duplicate Webhook Ingress Race
- **Problem:** Two identical webhook retries arrive at the exact same millisecond and both pass the initial non-locking deduplication query simultaneously.
- **Detection:** Inside PostgreSQL transaction, both threads execute `SELECT ... FROM payment_intents WHERE gateway_order_id = $1 FOR UPDATE`.
- **Handling:** Thread 1 acquires lock, completes settlement, updates status to `SUCCESS`, and commits. Thread 2 wakes up, inspects intent, sees status is already `SUCCESS`, immediately commits and returns 200 OK without crediting.
- **Financial Safety:** Double credit is physically impossible due to pessimistic row locking.
- **Recovery:** Seamless idempotent return.

### 4.4 Payment Intent Creation Idempotency Tampering
- **Problem:** Client sends an `Idempotency-Key` originally used for ₹1,000, but changes the request amount to ₹2,000.
- **Detection:** Backend computes deterministic SHA-256 payload hash `SHA256({ userId, amount, currency })` and compares it with `request_hash` stored in `idempotency_keys`.
- **Handling:** Detects hash mismatch and throws `409 Conflict` (`IDEMPOTENCY_PAYLOAD_MISMATCH`).
- **Financial Safety:** Prevents parameter mutation attacks from hijacking existing idempotency slots.
- **Recovery:** Client must generate a fresh UUID for the new transaction.

### 4.5 Gateway Card Decline / Payment Failure
- **Problem:** Customer enters invalid CVV or issuing bank declines payment. Gateway sends `payment.failed` webhook.
- **Detection:** Webhook parser classifies event as `PAYMENT_FAILED`.
- **Handling:** Updates `payment_intents` status to `FAILED`, records `error_message`, and marks `webhook_events` processed.
- **Financial Safety:** Wallet balance remains strictly unchanged. Zero ledger entries posted.
- **Recovery:** User is notified in UI and prompted to try another payment method.

### 4.6 Payment Gateway Timeout During Order Creation
- **Problem:** Network connection to Razorpay/Gateway times out during intent creation.
- **Detection:** Catch block detects HTTP timeout / ECONNRESET from gateway endpoint.
- **Handling:** Returns 504 Gateway Timeout or 500 error. No `payment_intents` row is persisted.
- **Financial Safety:** No financial state created.
- **Recovery:** Client retries with the same `Idempotency-Key`; fresh order is created once gateway is reachable.

### 4.7 Database Failure During Settlement Transaction
- **Problem:** Database connection drops or constraint violation occurs during double-entry ledger insertion.
- **Detection:** Try/catch block catches PostgreSQL error.
- **Handling:** Connection issues `ROLLBACK`.
- **Financial Safety:** Wallet credit, ledger entries, and outbox event are completely undone.
- **Recovery:** When the payment gateway retries the webhook, the intent remains in `CREATED` status and can be processed cleanly.

### 4.8 Reconciliation Discrepancy
- **Problem:** Gateway reports successful capture, but PayFlow intent remains in `CREATED` state due to network drop of webhook.
- **Detection:** `POST /api/v1/payments/admin/:id/reconcile` compares internal intent status against gateway status.
- **Handling:** Discrepancy report lists: `"Gateway reports payment SUCCESS but PayFlow intent is not settled"`.
- **Financial Safety:** Operations team or automated reconcile worker can trigger authoritative settlement.
- **Recovery:** Audit trail logged in `audit_logs` table.

