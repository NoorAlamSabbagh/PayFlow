# PayFlow: Master Architecture & Technical Documentation Hub

Welcome to the central technical documentation suite for **PayFlow**, a scalable digital wallet and real-time payment processing platform.

---

## 1. Executive Summary & 90-Second Elevator Pitch

> *"PayFlow is an institutional-grade digital wallet and payment processing engine built with a zero-compromise approach to financial correctness. Rather than prematurely adopting distributed microservices, PayFlow is designed as a high-throughput **Modular Monolith** in TypeScript and Node.js. 
> 
> To guarantee financial integrity, the platform eliminates floating-point arithmetic by operating exclusively in minor currency units (cents), audits every balance mutation through an immutable **Double-Entry Ledger**, and neutralizes concurrency race conditions using database-level **Pessimistic Row Locking** (`SELECT ... FOR UPDATE`).
> 
> The architecture addresses critical distributed systems challenges: deadlocks are mathematically eliminated via **deterministic lock ordering**, double-spending from network retries is blocked using **Dual-Layer Idempotency** (Redis + PostgreSQL), and external message publishing is made fault-tolerant via the **Transactional Outbox Pattern** over AWS SQS. From memory-hard Argon2id identity management to automated end-of-day ledger reconciliation and multi-AZ cloud deployments on AWS ECS Fargate, PayFlow represents an end-to-end blueprint for mission-critical FinTech engineering."*

---

## 2. Phase Implementation & Specification Status Matrix

PayFlow is engineered across 9 systematic phases. Each phase has its own technical specification, architecture diagrams, and interview deep dives:

| Phase | Title | Scope & Key Capabilities | Implementation Status | Phase Document |
| :---: | :--- | :--- | :---: | :---: |
| **00** | **Project Setup & Foundation** | Modular Monolith layout, Zod env validation, `pg.Pool`, Redis setup, centralized error envelopes, structured Pino logging | `[STATUS: IMPLEMENTED & VERIFIED]` | [Phase 0 Guide](phases/phase-0-foundation.md) |
| **01** | **Auth, RBAC & Identity** | Argon2id hashing, short-lived JWT (15m), HttpOnly cookies, Refresh Token Family Rotation, replay attack invalidation, RBAC | `[STATUS: IMPLEMENTED & VERIFIED]` | [Phase 1 Guide](phases/phase-1-auth-users.md) |
| **02** | **Wallet & Double-Entry Ledger** | Integer cent storage, dual-balance model (`available`/`locked`), immutable double-entry journal, pessimistic row locking (`FOR UPDATE`) | `[STATUS: IMPLEMENTED & VERIFIED]` | [Phase 2 Guide](phases/phase-2-wallet-ledger.md) |
| **03** | **P2P Transfer & Idempotency** | Atomic multi-wallet transfers, deterministic lock ordering (`ORDER BY id ASC`), dual-layer idempotency (Redis + PostgreSQL) | `[STATUS: IMPLEMENTED & VERIFIED]` | [Phase 3 Guide](phases/phase-3-transfer-idempotency.md) |
| **04** | **Payment Gateways & Webhooks** | Stripe/Razorpay adapter pattern, HMAC-SHA256 signature verification over raw body, webhook deduplication log, settlement state machine | `[STATUS: IMPLEMENTED & VERIFIED]` | [Phase 4 Guide](phases/phase-4-payment-gateway-webhooks.md) |
| **05** | **Distributed Systems & SQS** | Transactional Outbox Pattern, AWS SQS FIFO messaging, background worker fleet, Redis sliding window rate limiter (Lua) | `[STATUS: PLANNED SPECIFICATION]` | [Phase 5 Guide](phases/phase-5-redis-sqs-async.md) |
| **06** | **Fraud & Ledger Reconciliation** | Heuristic velocity risk rules (<15ms), decision matrix (`ALLOW`, `REVIEW`, `BLOCK`), automated nightly 3-way ledger reconciliation | `[STATUS: PLANNED SPECIFICATION]` | [Phase 6 Guide](phases/phase-6-fraud-reconciliation.md) |
| **07** | **Cloud, Docker & CI/CD** | Multi-stage Dockerfile (<120MB, non-root), AWS VPC Multi-AZ (ALB, ECS Fargate, Aurora RDS), zero-downtime expand/contract migrations | `[STATUS: PLANNED SPECIFICATION]` | [Phase 7 Guide](phases/phase-7-aws-docker-cicd.md) |
| **08** | **Hardening & Scalability** | 5-tier Defense-in-Depth security matrix, Read-Write replica routing, Citus/hash database sharding, OpenTelemetry & Prometheus, DR | `[STATUS: PLANNED SPECIFICATION]` | [Phase 8 Guide](phases/phase-8-production-hardening.md) |

---

## 3. High-Fidelity Visual Architecture Index

Every phase includes both high-contrast standalone vector diagrams (`.svg`) and collapsible Mermaid diagrams for cross-platform rendering:

| Phase | Visual Diagram Title | Vector Graphic File | Core Technical Focus |
| :---: | :--- | :---: | :--- |
| **00** | PayFlow System Architecture | [system_architecture.svg](diagrams/phase-0/system_architecture.svg) | Client ingress, Modular Monolith boundaries, PostgreSQL & Redis |
| **00** | Modular Monolith C4 Model | [modular_monolith_c4.svg](diagrams/phase-0/modular_monolith_c4.svg) | Container & component interaction boundaries |
| **01** | User Registration Flow | [registration_flow.svg](diagrams/phase-1/registration_flow.svg) | Memory-hard Argon2id hashing & initial token lineage generation |
| **01** | Login & Token Rotation Sequence | [login_rotation_sequence.svg](diagrams/phase-1/login_rotation_sequence.svg) | Silent token refresh via HttpOnly cookies and lineage updates |
| **01** | Token Replay Detection & Invalidation | [token_replay_detection.svg](diagrams/phase-1/token_replay_detection.svg) | Token reuse detection triggering family-wide session termination |
| **02** | Deposit & Double-Entry Accounting | [deposit_double_entry.svg](diagrams/phase-2/deposit_double_entry.svg) | Single ACID transaction updating wallet balance & ledger record |
| **02** | Row-Level Locking Concurrency | [row_locking_concurrency.svg](diagrams/phase-2/row_locking_concurrency.svg) | Serialization via `SELECT ... FOR UPDATE` preventing lost updates |
| **02** | Ledger Accounting Model | [ledger_accounting_model.svg](diagrams/phase-2/ledger_accounting_model.svg) | Double-entry asset, liability, and zero-sum invariant model |
| **03** | Atomic P2P Transfer Sequence | [p2p_transfer_atomic.svg](diagrams/phase-3/p2p_transfer_atomic.svg) | Multi-wallet debit/credit execution under global lock ordering |
| **03** | Dual-Layer Idempotency Guard | [dual_layer_idempotency.svg](diagrams/phase-3/dual_layer_idempotency.svg) | Redis in-flight lock paired with PostgreSQL persistent cache |
| **04** | Mock Gateway Ingestion Flow | [mock_gateway_payment_flow.svg](diagrams/phase-4/mock_gateway_payment_flow.svg) | Checkout intent creation, hosted card authorization, and webhook |
| **04** | Webhook Deduplication Architecture | [webhook_deduplication.svg](diagrams/phase-4/webhook_deduplication.svg) | HMAC-SHA256 signature verification & event_id deduplication |
| **05** | Transactional Outbox & SQS Pipeline | [transactional_outbox_sqs.svg](diagrams/phase-5/transactional_outbox_sqs.svg) | Eliminating the dual-write problem with asynchronous SQS dispatch |
| **05** | Redis Distributed Systems | [redis_distributed_systems.svg](diagrams/phase-5/redis_distributed_systems.svg) | Atomic Lua sliding window limiter & Redlock cross-node coordination |
| **06** | Fraud Risk Decision Tree | [fraud_decision_tree.svg](diagrams/phase-6/fraud_decision_tree.svg) | Sub-15ms velocity and volume decision trees (`ALLOW`, `REVIEW`, `BLOCK`) |
| **06** | Automated Ledger Reconciliation | [ledger_reconciliation_flow.svg](diagrams/phase-6/ledger_reconciliation_flow.svg) | Nightly three-way audit matching wallets, ledger, and bank files |
| **07** | AWS Well-Architected Cloud Topology | [aws_cloud_architecture.svg](diagrams/phase-7/aws_cloud_architecture.svg) | Multi-AZ VPC subnets, ALB ingress, ECS Fargate, and Aurora DB |
| **07** | CI/CD Deployment Pipeline | [cicd_deployment_pipeline.svg](diagrams/phase-7/cicd_deployment_pipeline.svg) | GitHub Actions quality gates, container scans, and rolling updates |
| **08** | PayFlow Evolution Roadmap | [payflow_evolution_roadmap.svg](diagrams/phase-8/payflow_evolution_roadmap.svg) | 9-phase evolutionary journey from baseline to institutional scale |
| **08** | Defense-in-Depth Security Matrix | [defense_in_depth_matrix.svg](diagrams/phase-8/defense_in_depth_matrix.svg) | 5-layer enterprise protection from edge perimeter to KMS encryption |

---

## 4. Core Cross-Cutting Technical Pillars

### 1. Zero Floating-Point Arithmetic
All balances, transfers, fees, and ledger entries use integer values representing minor currency units (cents). Floating-point values (`0.10`) are strictly forbidden across controllers, services, and database columns.

### 2. Invariant-Driven Accounting
Every balance change requires a matching entry in the append-only `ledger_entries` table. Wallet balance mutations and ledger records are bound in the same ACID transaction.

### 3. Concurrency & Deadlock Defense
- Single-wallet mutations: `SELECT ... FOR UPDATE`.
- Multi-wallet mutations: Wallets are sorted alphabetically by UUID and locked in ascending order (`ORDER BY id ASC FOR UPDATE`), eliminating cyclic dependencies.

### 4. Zero Unchecked Dual-Writes
External event publishing routes through the `outbox_events` table inside the database transaction, preventing inconsistent state between PostgreSQL and message brokers.

---

## 5. Directory Layout & Document Map

```
docs/
├── README.md                          # Master documentation hub (this file)
├── architecture.md                    # Core architecture design
├── database-design.md                 # Database schemas and indexing strategies
├── interview-notes.md                 # Complete System Design interview study guide
├── diagrams/                          # Standalone vector SVG diagrams
│   ├── phase-0/                       # System architecture & C4 model
│   ├── phase-1/                       # Auth, rotation & replay detection
│   ├── phase-2/                       # Double-entry, locking & balance models
│   ├── phase-3/                       # P2P transfers & idempotency
│   ├── phase-4/                       # Gateway webhooks & deduplication
│   ├── phase-5/                       # Transactional outbox & Redis systems
│   ├── phase-6/                       # Fraud decision tree & reconciliation
│   ├── phase-7/                       # AWS cloud topology & CI/CD pipeline
│   └── phase-8/                       # Roadmap & defense-in-depth matrix
└── phases/                            # Phase-by-phase specifications (0 to 8)
    ├── phase-0-foundation.md          # [IMPLEMENTED] Foundation & config
    ├── phase-1-auth-users.md          # [IMPLEMENTED] Identity & RBAC
    ├── phase-2-wallet-ledger.md       # [IMPLEMENTED] Wallets & Double-entry
    ├── phase-3-transfer-idempotency.md# [PLANNED] P2P & Idempotency
    ├── phase-4-payment-gateway-webhooks.md # [PLANNED] Gateways & Webhooks
    ├── phase-5-redis-sqs-async.md     # [PLANNED] Outbox & SQS Messaging
    ├── phase-6-fraud-reconciliation.md# [PLANNED] Risk & Nightly Audit
    ├── phase-7-aws-docker-cicd.md     # [PLANNED] Cloud, Docker & CI/CD
    └── phase-8-production-hardening.md# [PLANNED] Sharding & Observability
```

---

## 6. How to Use This Documentation for Technical Interviews

- **For System Design Interviews:** Review the 90-second pitches and visual architecture diagrams in [README.md](README.md) and [architecture.md](architecture.md). Read Section 18 ("Interview Presentation Guide") and Section 19 ("High-Frequency Interview Q&A Deep Dive") in each phase document.
- **For Low-Level Design (LLD) & Concurrency Interviews:** Focus on [Phase 2 (Wallet & Ledger)](phases/phase-2-wallet-ledger.md) and [Phase 3 (Transfer & Idempotency)](phases/phase-3-transfer-idempotency.md) to explain pessimistic locking, deterministic lock ordering, and the dual-layer idempotency filter.
- **For Distributed Systems & Reliability Interviews:** Study [Phase 5 (Outbox & SQS)](phases/phase-5-redis-sqs-async.md), [Phase 6 (Reconciliation)](phases/phase-6-fraud-reconciliation.md), and [Phase 8 (Production Hardening)](phases/phase-8-production-hardening.md).
