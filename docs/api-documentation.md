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

### 2.4 Payments & Webhooks (`/payments`, `/webhooks`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/payments/intents` | Create top-up payment session with Mock Gateway | Bearer + Idempotency-Key |
| `POST` | `/webhooks/gateway` | Inbound webhook from Mock Payment Gateway | HMAC-SHA256 Signature |

### 2.5 Admin & Reconciliation (`/admin`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/admin/reconciliation` | Run on-demand ledger mathematical consistency check | Admin Bearer |
| `POST` | `/admin/wallets/:id/freeze`| Freeze suspicious wallet for compliance review | Admin Bearer |
