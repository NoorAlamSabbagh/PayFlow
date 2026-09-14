# PayFlow – Scalable Digital Wallet & Payment Processing Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)
[![AWS SQS](https://img.shields.io/badge/AWS-SQS%20FIFO-orange.svg)](https://aws.amazon.com/sqs/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)

PayFlow is an enterprise-grade digital wallet and payment processing platform designed to demonstrate modern fintech engineering, distributed transaction safety, double-entry bookkeeping, and scalable event-driven architecture.

---

## 🌟 Core Engineering Highlights
- **Immutable Double-Entry Bookkeeping:** All money movements are recorded as balancing debit and credit entries; zero floating-point arithmetic (integer cents/paise).
- **Concurrency & Deadlock-Free Transfers:** Pessimistic row-level locking (`SELECT ... FOR UPDATE` ordered by UUID) preventing double-spending and deadlock hazards.
- **Distributed Idempotency (Defense-in-Depth):** Two-layer idempotency guard using Redis for fast mutex locking and PostgreSQL for durable response caching and payload-tamper detection.
- **Transactional Outbox Pattern:** Atomic writes to an `outbox_events` table within ACID boundaries to eliminate the dual-write problem with AWS SQS.
- **Mock Payment Gateway & Webhook Ingestion:** Inbound HMAC-SHA256 signature verification with replay protection and idempotent webhook processing.
- **Automated Ledger Reconciliation:** Scheduled jobs verifying mathematical zero-sum ledger consistency against cached balances.

---

## 🏗️ Architecture & Documentation
Comprehensive engineering documentation is available in the [`docs/`](./docs) directory:
- [System Architecture & Design Decisions](./docs/architecture.md)
- [Database Schema & Indexing Specification](./docs/database-design.md)
- [Payment & Transfer Sequence Flows](./docs/payment-flow.md)
- [REST API Specification](./docs/api-documentation.md)
- [Failure Scenarios & Resilience Engineering](./docs/failure-scenarios.md)
- [Security & RBAC Architecture](./docs/security.md)
- [Scalability & Performance Engineering](./docs/scalability.md)
- [Fintech Interview Talking Points & Cheat Sheet](./docs/interview-notes.md)

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- [Docker & Docker Compose](https://www.docker.com/)
- [Node.js (v20+)](https://nodejs.org/)
- [npm or pnpm](https://pnpm.io/)

### 2. Start Local Infrastructure
Start PostgreSQL 16, Redis 7, and LocalStack (AWS SQS):
```bash
docker-compose up -d
```

### 3. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

---

## 📊 Development Phases
- [x] **Phase 0:** Architecture, Repository Structure, Database Design & Documentation
- [ ] **Phase 1:** Project Foundation, Authentication, Users, RBAC & Core UI
- [ ] **Phase 2:** Wallet and Double-Entry Ledger
- [ ] **Phase 3:** Wallet-to-Wallet Transfers and Distributed Idempotency
- [ ] **Phase 4:** Mock Payment Gateway, Payment States, Webhooks & Refunds
- [ ] **Phase 5:** Redis Caching, AWS SQS & Asynchronous Workers
- [ ] **Phase 6:** Fraud/Risk Rules & Ledger Reconciliation
- [ ] **Phase 7:** AWS Deployment, Docker Multi-Stage, CI/CD & CloudWatch
- [ ] **Phase 8:** Security Hardening, Chaos Testing & Interview Preparation
