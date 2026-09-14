# PayFlow API Specification & REST Contracts

## 1. Global API Standards

### Base URL
`http://localhost:5000/api/v1`

Interactive Swagger OpenAPI 3.0 documentation is available at:
`http://localhost:5000/api-docs`

### Standard Success Response Envelope
```json
{
  "success": true,
  "message": "User logged in successfully",
  "data": {
    "user": {
      "id": "11111111-1111-1111-1111-111111111111",
      "email": "alice@payflow.internal",
      "fullName": "Alice Walker",
      "role": "USER",
      "isActive": true,
      "createdAt": "2026-09-14T12:00:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Standard Error Response Envelope
```json
{
  "success": false,
  "message": "Invalid email or password",
  "error": {
    "code": "INVALID_CREDENTIALS"
  }
}
```

### Required Financial Headers
- `Authorization`: `Bearer <jwt_access_token>`
- `Idempotency-Key`: `<UUIDv4>` (Mandatory for mutating payment & transfer operations in later phases)
- `Cookie`: `refreshToken=<secret>` (Handled automatically by browser with `HttpOnly`)

---

## 2. Core Endpoints Summary

### 2.1 Authentication & User Endpoints (`/auth`, `/users`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` | Register new user + hashes password (Bcrypt) + issues tokens | No |
| `POST` | `/auth/login` | Authenticate credentials + returns accessToken + sets HttpOnly cookie | No |
| `POST` | `/auth/refresh` | Rotates refresh token + detects replay attacks + issues new accessToken | HttpOnly Cookie |
| `POST` | `/auth/logout` | Revokes refresh token in database + clears cookie | Optional |
| `GET` | `/users/me` | Fetch authenticated user profile | Bearer Token |
| `GET` | `/users` | List all registered users (RBAC: `ADMIN` only) | Bearer Token (ADMIN) |


### 2.2 Wallets & Ledger (`/wallets`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/wallets/me` | Fetch authenticated user's wallet, status & cached balance | Bearer |
| `GET` | `/wallets/ledger` | Fetch paginated, immutable double-entry ledger statement | Bearer |

### 2.3 Transfers (`/transfers`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/transfers` | Initiate P2P transfer with row lock, double-entry ledger & idempotency | Bearer + Idempotency-Key |
| `GET` | `/transfers/:referenceId` | Lookup transfer status by public reference ID | Bearer |

### 2.4 Payments & Gateway Webhooks (`/payments`, `/webhooks`)
| Method | Endpoint | Description | Auth Required | Idempotent |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/payments/intents` | Create payment intent and gateway order | Bearer JWT | Yes (`Idempotency-Key` header) |
| `GET` | `/payments/:paymentIntentId` | Fetch status of specific payment intent | Bearer JWT (Ownership/Admin) | Yes |
| `GET` | `/payments` | Paginated list of user's payment attempts | Bearer JWT | Yes |
| `POST` | `/webhooks/payment-gateway` | Authoritative webhook receiver for payment gateways | Public (HMAC Signature Required) | Yes (`webhook_events` deduplication) |
| `GET` | `/payments/admin/all` | View all platform payment intents across all users | Bearer JWT (`ADMIN` only) | Yes |
| `POST` | `/payments/admin/:id/reconcile` | Audit reconciliation against gateway and ledger entries | Bearer JWT (`ADMIN` only) | Yes |

#### Endpoint Specifications

##### `POST /api/v1/payments/intents`
- **Headers:** `Authorization: Bearer <token>`, `Idempotency-Key: <uuid>`
- **Request Body:**
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
      "id": "intent-uuid",
      "userId": "user-uuid",
      "walletId": "wallet-uuid",
      "amount": 100000,
      "currency": "INR",
      "provider": "MOCK_GATEWAY",
      "gatewayOrderId": "order_mock_12345",
      "gatewayPaymentId": null,
      "status": "CREATED",
      "errorMessage": null,
      "createdAt": "2026-09-14T20:00:00.000Z",
      "completedAt": null
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid amount (non-integer, <= 0), missing idempotency key.
  - `409 Conflict`: `IDEMPOTENCY_PAYLOAD_MISMATCH` (reusing key with different amount), `IDEMPOTENCY_IN_PROGRESS`.

##### `POST /api/v1/webhooks/payment-gateway`
- **Headers:** `x-mock-signature: <hmac_hex>` or `x-razorpay-signature: <hmac_hex>`
- **Request Body:** Raw gateway webhook JSON.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Webhook event acknowledged and processed",
    "data": {
      "received": true,
      "status": "SETTLED",
      "transactionReference": "TXN_TOPUP_...",
      "paymentIntentId": "intent-uuid"
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: `INVALID_WEBHOOK_SIGNATURE` (HMAC verification failed). Zero DB mutations.

