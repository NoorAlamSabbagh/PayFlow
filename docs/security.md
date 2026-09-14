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

## 3. Webhook Security (HMAC-SHA256 & Timing-Safe Verification)

Incoming payment gateway webhooks must be protected against forgery, payload tampering, and replay attacks:
1. **Raw Body Buffer Preservation:**
   To prevent JSON re-serialization hash mismatch (due to key reordering, whitespace, or Unicode discrepancies), Express is configured with a raw body capture verify callback in `src/app.ts`:
   ```typescript
   app.use(express.json({
     limit: '1mb',
     verify: (req: any, _res, buf) => {
       req.rawBody = buf; // Preserve exact unmodified buffer
     }
   }));
   ```
2. **Cryptographic HMAC-SHA256 Signature Computation:**
   The gateway signs the raw request payload with the shared secret:
   ```typescript
   const expectedSignature = crypto
     .createHmac('sha256', secret)
     .update(rawBody)
     .digest('hex');
   ```
3. **Timing-Safe Equality Comparison:**
   Standard string comparison (`===`) terminates on the first non-matching byte, leaking timing information to attackers. PayFlow compares signature byte buffers in constant time using `crypto.timingSafeEqual`:
   ```typescript
   const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
   const actualBuffer = Buffer.from(signature, 'utf8');
   if (expectedBuffer.length !== actualBuffer.length) return false;
   return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
   ```
4. **Ingress Deduplication Table (`webhook_events`):**
   External event IDs (`gateway_event_id`) are unique per provider. Repeated deliveries return an HTTP 200 acknowledgment without re-running financial logic.

---

## 4. Financial Non-Negotiable: Authoritative Server-Side Confirmation

1. **Client Never Confirms Payment:**
   The frontend browser is treated as an untrusted public environment. Client-side callbacks or checkout completion redirects only trigger a status polling indicator ("Payment verification in progress...").
2. **Authoritative Webhook Settlement:**
   A wallet is credited and double-entry ledger records are posted **only** when the server successfully verifies the external gateway's cryptographic webhook.

---

## 5. Input Sanitization & Defense-in-Depth

- **Zero SQL Injection Risk:** All database access is conducted through parameterized queries (`$1, $2, ...`). Dynamic raw string concatenation in SQL queries is strictly prohibited.
- **Zod Schema Validation:** All inbound HTTP request parameters, query strings, and JSON request bodies are parsed through strict Zod schemas that strip unknown fields.
- **Integer Money Invariant:** Floats and decimals are rejected at the routing boundary. All monetary values are represented strictly as integers in smallest currency units (paise/cents).
- **HTTP Security Headers:** Integrated `helmet` middleware setting strict Content Security Policy (CSP), HSTS, and X-Content-Type-Options.
