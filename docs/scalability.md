# PayFlow Scalability & Performance Engineering

## 1. Relational Database Scaling (PostgreSQL)

### 1.1 Connection Pool Optimization
Node.js processes use `pg.Pool` with bounded pool sizing to prevent exhaustion of PostgreSQL backend processes:
- `max: 20` connections per API instance.
- `idleTimeoutMillis: 30000` (reclaims idle connections).
- `connectionTimeoutMillis: 5000` (fails fast under pool starvation).
- `statement_timeout = '3000ms'` to abort slow-running queries and mitigate lock contention.

### 1.2 Table Partitioning Strategy for `ledger_entries`
In a high-throughput payment platform, the `ledger_entries` table grows by millions of rows monthly.
- **Range Partitioning by Month:**
  ```sql
  CREATE TABLE ledger_entries ( ... ) PARTITION BY RANGE (created_at);
  CREATE TABLE ledger_entries_2026_09 PARTITION OF ledger_entries
      FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
  ```
- **Benefits:** Keeps B-Tree index working sets small enough to fit inside RAM buffer cache, drastically accelerating recent balance reads and ledger audits.

---

## 2. Asynchronous Queue Scalability (AWS SQS FIFO)

### 2.1 FIFO Ordering with High Concurrency
Standard SQS FIFO enforces a maximum throughput of 300 messages/sec (or 3,000/sec with batching) if everything shares one group. PayFlow achieves massive horizontal throughput by using **per-entity partition grouping**:
- `MessageGroupId = wallet_id` (or `transaction_id`).
- Messages related to a specific wallet are delivered and processed in strict serial order, preventing race conditions on notifications and audit updates.
- Messages for different wallets are processed concurrently in parallel across multiple background worker threads.

---

## 3. Distributed In-Memory Caching (Redis)

- **Token Bucket Rate Limiting:** Executes atomic Lua scripts in Redis to enforce per-IP and per-user limits without database hits.
- **Short-Lived User Profile Caching:** Cached with 60-second TTL. Invalidated instantly upon profile update.
- **Redis Cluster Readiness:** All idempotency keys and cache keys utilize hash tags (e.g. `{user:123}:idempotency`) to ensure related keys map to the exact same hash slot in a clustered Redis deployment.
