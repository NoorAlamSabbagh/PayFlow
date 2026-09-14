# PayFlow Payment Workflows & Sequence Specifications

## 1. P2P Wallet Transfer Workflow (ACID & Idempotency)

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Sender (Alice)
    participant Client as Web App
    participant API as Express API Gateway
    participant Redis as Redis L1 Idempotency
    participant DB as PostgreSQL 16
    participant Outbox as Outbox Relay Worker
    participant SQS as AWS SQS FIFO
    participant Worker as Background Worker

    Alice->>Client: Enters transfer ₹1,000 to Bob
    Client->>Client: Generates client UUID Idempotency-Key
    Client->>API: POST /api/v1/transfers (Header: Idempotency-Key)
    
    Note over API,Redis: L1 Idempotency Check
    API->>Redis: SETNX idempotency:{alice_id}:{key} EX 30
    alt Mutex Lock Fails (Concurrent Request in flight)
        Redis-->>API: Conflict (Key already exists)
        API-->>Client: 409 Conflict (Request already in progress)
    end

    Note over API,DB: Start ACID Database Transaction
    API->>DB: BEGIN TRANSACTION (READ COMMITTED)
    API->>DB: Check L2 idempotency_keys WHERE user_id = alice_id AND key = $1
    alt Key already COMPLETED
        DB-->>API: Return cached response_body
        API-->>Client: 200 OK (Cached previous response replayed)
    end

    API->>DB: Insert into idempotency_keys (status='IN_PROGRESS', request_hash)

    Note over API,DB: Deadlock-Free Row Lock
    API->>DB: SELECT * FROM wallets WHERE id IN (alice_wallet, bob_wallet) ORDER BY id ASC FOR UPDATE;
    DB-->>API: Returns locked wallet records

    API->>API: Verify alice_wallet.balance >= 100000 paise
    alt Insufficient Balance
        API->>DB: ROLLBACK;
        API-->>Client: 400 Bad Request (Insufficient Balance)
    end

    API->>DB: UPDATE wallets SET balance = balance - 100000 WHERE id = alice_wallet;
    API->>DB: UPDATE wallets SET balance = balance + 100000 WHERE id = bob_wallet;
    API->>DB: INSERT INTO transactions (type='P2P_TRANSFER', amount=100000, status='COMPLETED') RETURNING id;
    
    Note over API,DB: Double-Entry Immutable Ledger
    API->>DB: INSERT INTO ledger_entries (wallet_id=alice, entry_type='DEBIT', amount=100000, balance_after=alice_new);
    API->>DB: INSERT INTO ledger_entries (wallet_id=bob, entry_type='CREDIT', amount=100000, balance_after=bob_new);

    Note over API,DB: Transactional Outbox Pattern
    API->>DB: INSERT INTO outbox_events (aggregate_type='TRANSACTION', event_type='TRANSFER_COMPLETED', payload={...});
    API->>DB: UPDATE idempotency_keys SET status='COMPLETED', response_status=200, response_body={...};

    API->>DB: COMMIT;
    API-->>Client: 200 OK (Transfer successful)

    Note over Outbox,Worker: Asynchronous Event Fanout
    Outbox->>DB: Poll outbox_events WHERE status='PENDING' FOR UPDATE SKIP LOCKED;
    Outbox->>SQS: SendMessageBatch (payflow-transaction-events.fifo, MessageGroupId=alice_wallet)
    Outbox->>DB: UPDATE outbox_events SET status='PUBLISHED', published_at=NOW();
    
    SQS->>Worker: Consume TRANSFER_COMPLETED event
    Worker->>Worker: Dispatch push notification / email receipt & index audit trail
```

---

## 2. Add Money / Top-Up via Mock Gateway & Webhook

```mermaid
sequenceDiagram
    autonumber
    actor Alice as User (Alice)
    participant Client as Web App
    participant API as Express API
    participant PG as Mock Payment Gateway
    participant DB as PostgreSQL
    participant SQS as AWS SQS

    Alice->>Client: Add ₹5,000 to Wallet
    Client->>API: POST /api/v1/payments/intents { amount: 500000 }
    API->>PG: Create Order (Mock Gateway API)
    PG-->>API: Return gateway_order_id & checkout_url
    API->>DB: INSERT INTO payment_intents (gateway_order_id, amount, status='CREATED')
    API-->>Client: 201 Created { gateway_order_id, checkout_url }

    Client->>PG: Simulated Payment Checkout (Authorize Card / UPI)
    PG->>PG: Process Authorization
    PG->>API: POST /api/v1/webhooks/gateway (Header: X-PayFlow-Signature: HMAC-SHA256)

    Note over API: Inbound Webhook Verification
    API->>API: Calculate HMAC over raw body with MOCK_GATEWAY_WEBHOOK_SECRET
    alt Signature Mismatch
        API-->>PG: 401 Unauthorized (Invalid Signature)
    end

    API->>DB: Check webhook_events for gateway_event_id
    alt Webhook Already Processed
        API-->>PG: 200 OK (Idempotent ignore)
    end

    API->>DB: BEGIN TRANSACTION;
    API->>DB: INSERT INTO webhook_events (gateway_event_id, payload, is_processed=true);
    API->>DB: UPDATE payment_intents SET status='SUCCESS', gateway_payment_id=$1;
    
    API->>DB: SELECT * FROM wallets WHERE id IN (alice_wallet, clearing_wallet) ORDER BY id ASC FOR UPDATE;
    API->>DB: UPDATE wallets SET balance = balance + 500000 WHERE id = alice_wallet;
    API->>DB: UPDATE wallets SET balance = balance + 500000 WHERE id = clearing_wallet;
    
    Note over API,DB: Double-Entry Top-up
    API->>DB: INSERT INTO ledger_entries (wallet_id=clearing_wallet, entry_type='DEBIT', amount=500000);
    API->>DB: INSERT INTO ledger_entries (wallet_id=alice_wallet, entry_type='CREDIT', amount=500000);
    API->>DB: INSERT INTO outbox_events (event_type='TOPUP_SUCCESS', payload={...});
    
    API->>DB: COMMIT;
    API-->>PG: 200 OK
```

---

## 3. Transaction State Machine & Life Cycle

```
                       [ CREATED ]
                            |
                            v
                    [ IN_PROGRESS ]
                       /         \
                      /           \
                     v             v
              [ COMPLETED ]    [ FAILED ]
                    |
              (Refund Flow)
                    |
                    v
              [ REVERSED ]
```
