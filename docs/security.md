# PayFlow Security Architecture & Hardening Guide

## 1. Authentication & Session Management

### 1.1 Why JWT Authentication Is Used
In high-throughput distributed systems, querying the database for every single incoming HTTP request to validate a session ID creates an enormous I/O bottleneck. JSON Web Tokens (JWT) provide:
1. **Stateless Verification:** Backend microservices and API routes can cryptographically verify authenticity, extract user claims (`userId`, `role`), and authorize requests locally using the shared secret without any database lookup.
2. **Horizontal Scalability:** Multiple load-balanced Express nodes can validate tokens without sharing session state or sticky sessions.
3. **Decoupled Architecture:** Seamlessly passes claims to downstream asynchronous workers and external microservices.

### 1.2 Access Token vs. Refresh Token Tradeoffs
| Dimension | Access Token | Refresh Token |
| :--- | :--- | :--- |
| **Lifespan** | Extremely short (15 minutes) | Long (7 days) |
| **Storage Location** | In-Memory (Redux state, non-persistent) | `HttpOnly`, `SameSite=Strict`, `Secure` Cookie |
| **Verification** | Stateless (cryptographic signature) | Stateful (SHA-256 hash lookup in PostgreSQL) |
| **Revocability** | Cannot be revoked until expiration | Can be revoked immediately on demand |
| **Threat Profile** | Stolen token expires in <= 15m; immune to XSS persistence | Protected from JavaScript access; replay-monitored |

### 1.3 Refresh Token Rotation & Replay Detection Architecture
To prevent stolen refresh tokens from providing perpetual access, PayFlow implements **Token Family Rotation with Compromise Revocation**:
1. **Token Family Generation:** When a user logs in, a unique `family_id` (UUID) is created. The issued refresh token is tied to this family.
2. **Rotation on Use:** When the client requests `/api/v1/auth/refresh`, the presented token is immediately marked `is_revoked = true`, and a new refresh token is issued under the *same* `family_id`.
3. **Replay Detection (Compromise Alarm):** If an adversary intercepts a refresh token and attempts to use it *after* the legitimate client has already rotated it, the server finds the token with `is_revoked = true`.
4. **Whole-Family Invalidation:** The server detects an active breach, **revokes all tokens matching that `family_id` immediately**, and rejects the request. Both the attacker and the legitimate user are forced to re-authenticate, neutralizing the stolen credential.

### 1.4 Why Role-Based Access Control (RBAC) Is Essential in Fintech
Financial platforms separate operational duties to prevent internal fraud and accidental privilege escalation:
- **`USER`:** Restricted strictly to self-owned financial resources (own wallet, initiating transfers from own account, checking own statement).
- **`OPERATOR`:** Read-only compliance access to inspect user accounts and freeze wallets under fraud investigations.
- **`ADMIN`:** Privileged system control (triggering manual reconciliation runs, viewing platform-wide financial aggregates, managing system clearing accounts).
Enforced using reusable `requireRole('ADMIN')` middleware guards. A regular user cannot perform administrative ledger operations or tamper with other users' accounts.


---

## 2. Role-Based Access Control (RBAC)

| Resource / Action | USER | OPERATOR | ADMIN |
| :--- | :---: | :---: | :---: |
| View Own Wallet & Ledger | Yes | Yes | Yes |
| Initiate P2P Transfer | Yes | No | No |
| Add Money / Top-up | Yes | No | No |
| View All User Wallets | No | Yes | Yes |
| Freeze / Unfreeze Wallets | No | Yes | Yes |
| Trigger Manual Reconciliation | No | No | Yes |
| Access Audit Logs | No | Read-Only | Full Access |

---

## 3. Webhook Security (HMAC-SHA256 & Timestamp Verification)

Incoming payment gateway webhooks must be protected against tampering and replay attacks:
1. **Signature Header:** Every webhook arrives with `X-PayFlow-Signature: t=1773489600,v1=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`.
2. **Replay Window:** The server rejects any webhook whose timestamp `t` deviates by more than 300 seconds (5 minutes) from server clock.
3. **Payload Signature Verification:**
   ```typescript
   const expectedSignature = crypto
     .createHmac('sha256', process.env.MOCK_GATEWAY_WEBHOOK_SECRET!)
     .update(`${timestamp}.${rawBody}`)
     .digest('hex');
   
   // Constant-time comparison prevents timing attacks
   const isValid = crypto.timingSafeEqual(
     Buffer.from(signature),
     Buffer.from(expectedSignature)
   );
   ```

---

## 4. Input Sanitization & Defense-in-Depth

- **Zero SQL Injection Risk:** All database access is conducted through parameterized queries (`$1, $2, ...`). Dynamic raw string concatenation in SQL queries is strictly prohibited.
- **Zod Schema Validation:** All inbound HTTP request parameters, query strings, and JSON request bodies are parsed through strict Zod schemas that strip unknown fields.
- **HTTP Security Headers:** Integrated `helmet` middleware setting strict Content Security Policy (CSP), HSTS, and X-Content-Type-Options.
