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
