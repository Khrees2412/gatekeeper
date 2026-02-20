# Gatekeeper — On-Chain API Gateway (Solana)

> *"Every company runs an API gateway—AWS API Gateway, Kong, or custom middleware with Redis. The rules for who can call what and how often live in a database your company controls. Gatekeeper moves that control-plane on-chain: any service, team, or third-party can verify API access against the same shared state without trusting your database."*

Gatekeeper is a Solana program (Anchor) that implements:
- API key issuance and revocation
- Role-based permission scopes (`u64` bitmask)
- Fixed-window rate limiting per key

No frontend is included. This is control-plane + CLI + minimal adapter.

## Program and Cluster
- Deployed cluster: `devnet`
- Program ID: `45QGviwx5gsAyo2tSVGDn482baYC5Dvk6EYRZggv9Rfv`
- [View program on Solana Explorer](https://explorer.solana.com/address/45QGviwx5gsAyo2tSVGDn482baYC5Dvk6EYRZggv9Rfv?cluster=devnet)

## Prerequisites
- Rust 1.86+
- Solana CLI / Agave
- Anchor CLI 0.31.1
- Node.js 18+
- Yarn 1.x

## Environment
Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

Variables:
- `ANCHOR_PROVIDER_URL` RPC URL (`http://127.0.0.1:8899` for local tests)
- `ANCHOR_WALLET` keypair path
- `GATEKEEPER_PROGRAM_ID` deployed program address
- `GATEKEEPER_CLUSTER` explorer cluster param (`localnet`, `devnet`, `mainnet-beta`)
- `GATEKEEPER_ADAPTER_PORT` HTTP adapter port

## Build and Test

```bash
yarn install
anchor build
anchor test
```

## Web2 Design vs Solana Design

| Web2 | Solana |
|---|---|
| `api_keys` table | `ApiKey` PDA |
| `roles` table | `Role` PDA |
| `plans` table | `UsagePlan` PDA |
| Redis counter | `ApiKey.count` + `window_start` |
| Middleware authorization | `consume(required_scopes_mask)` |

## Account Model

| Account | Seeds | Purpose |
|---|---|---|
| `GlobalState` | `["global_state"]` | Program authority |
| `UsagePlan` | `["plan", plan_id_le_bytes]` | Rate policy (`window_seconds`, `max_per_window`, `is_active`) |
| `Role` | `["role", role_id_le_bytes]` | Scope policy (`scopes_bitmask`, `name: [u8;32]`) |
| `ApiKey` | `["key", owner_pubkey]` | Issued key identity + usage counter |

## Instructions
- `initialize()`
- `create_plan(plan_id, window_seconds, max_per_window, is_active)`
- `toggle_plan(plan_id)`
- `upsert_role(role_id, name, scopes_bitmask)`
- `issue_key(owner, plan_id, role_id)`
- `revoke_key(owner)`
- `consume(required_scopes_mask)`

Error codes:
- `Unauthorized`
- `KeyRevoked`
- `PlanInactive`
- `InsufficientScopes`
- `RateLimitExceeded`
- `InvalidPlanOrRole`

## CLI

Run with:

```bash
yarn cli -- <command>
```

Commands:

```bash
yarn cli -- init
yarn cli -- create-plan --plan-id 1 --window 60 --max 10
yarn cli -- toggle-plan --plan-id 1
yarn cli -- upsert-role --role-id 1 --scopes 1 --name reader
yarn cli -- issue-key --owner <OWNER_PUBKEY> --plan-id 1 --role-id 1
yarn cli -- consume --owner <OWNER_PUBKEY> --required-scopes 1
yarn cli -- revoke-key --owner <OWNER_PUBKEY>
```

CLI output includes:
- Relevant account addresses (plan/role/key/global)
- Transaction signature
- Explorer link based on `GATEKEEPER_CLUSTER`
- `ALLOW` / `DENY` output for `consume`

## Adapter Middleware

Run:

```bash
yarn adapter
```

Routes:
- `GET /read?owner=<PUBKEY>` -> requires scope bit `1` (`READ`)
- `POST /write?owner=<PUBKEY>` -> requires scope bit `2` (`WRITE`)

Status mapping:
- `200`: allowed
- `401`: revoked key or invalid key
- `403`: missing scope or plan inactive
- `429`: rate limit exceeded

Example:

```bash
curl -i "http://127.0.0.1:8080/read?owner=<PUBKEY>"
curl -i -X POST "http://127.0.0.1:8080/write?owner=<PUBKEY>"
```

## Real-World Example: Payment Processing API

Imagine you're building a REST API for a fintech client. Merchants need API keys to read transaction history (`GET /transactions`) and create payment intents (`POST /payments`). The client wants rate limiting (free tier vs pro tier) and RBAC (read-only vs read+write keys).

### 1. Initialize the program (one-time)

```bash
yarn cli -- init
```

### 2. Create rate-limit tiers

```bash
yarn cli -- create-plan --plan-id 1 --window 60 --max 100      # Free: 100 req/min
yarn cli -- create-plan --plan-id 2 --window 60 --max 10000    # Pro: 10,000 req/min
```

### 3. Create roles with scope bitmasks

`READ = 1`, `WRITE = 2`, `READ + WRITE = 3`:

```bash
yarn cli -- upsert-role --role-id 1 --scopes 1 --name read-only
yarn cli -- upsert-role --role-id 2 --scopes 3 --name read-write
```

### 4. Issue keys to merchants

```bash
# Merchant A — read-only, free tier
yarn cli -- issue-key --owner <MERCHANT_A_WALLET> --plan-id 1 --role-id 1

# Merchant B — read+write, pro tier
yarn cli -- issue-key --owner <MERCHANT_B_WALLET> --plan-id 2 --role-id 2
```

### 5. Gate incoming requests

```bash
# Merchant A reads transactions — ALLOW
yarn cli -- consume --owner <MERCHANT_A_WALLET> --required-scopes 1

# Merchant A tries to write — DENY (403, insufficient scopes)
yarn cli -- consume --owner <MERCHANT_A_WALLET> --required-scopes 2
```

In production, instead of shelling out to the CLI per request, run the adapter as a sidecar:

```bash
yarn adapter
# Your API server calls http://localhost:8080/read?owner=<PUBKEY> before processing.
# 200 → forward to handler | 401/403/429 → reject immediately.
```

### 6. Revoke a compromised key

```bash
yarn cli -- revoke-key --owner <MERCHANT_A_WALLET>
# All subsequent consume calls for this key return DENY (401, key revoked).
```

### Why on-chain?

- **Auditability** — every issuance, revocation, and rate-limit hit is a Solana transaction with a timestamp. No one can quietly delete a log entry.
- **Multi-party trust** — a third-party aggregator can independently verify a merchant's access level by reading the on-chain PDA, no API call to your backend required.
- **Tamper-proof rate limits** — rate-limit bumps are visible on-chain; no silent favouritism.

## Tradeoffs
- Per-request transaction cost: each `consume` is an on-chain transaction.
- Hot account contention: every consume mutates one `ApiKey` account. This demo uses a single mutable `ApiKey` account per key; production would shard counters across multiple PDAs or separate real-time auth from on-chain settlement.
- Demo suitability: this is acceptable for correctness and shared verifiability; production systems typically split read-path auth from settlement or shard counters.

## Devnet Evidence
- **Cluster:** `devnet`
- **Program ID:** [`45QGviwx5gsAyo2tSVGDn482baYC5Dvk6EYRZggv9Rfv`](https://explorer.solana.com/address/45QGviwx5gsAyo2tSVGDn482baYC5Dvk6EYRZggv9Rfv?cluster=devnet)
- **Deploy tx:** [`4gdimwmyqF5oz598f5L8hBLcWogTVAFajEgCmKCD75sAULNbikpTRgaxuKhx2FuN4pgZhxESbhMBBhn2GQQsGJaR`](https://explorer.solana.com/tx/4gdimwmyqF5oz598f5L8hBLcWogTVAFajEgCmKCD75sAULNbikpTRgaxuKhx2FuN4pgZhxESbhMBBhn2GQQsGJaR?cluster=devnet)
- **Create plan tx:** [`43TNG2eAw6uVC3Jdj9XM39ceuV4xATxpK7fzqJKxAaWYTHYQdDPuaFgbXX4iUfoTuduUQ1mrNUuy3m1PVBrxtnEy`](https://explorer.solana.com/tx/43TNG2eAw6uVC3Jdj9XM39ceuV4xATxpK7fzqJKxAaWYTHYQdDPuaFgbXX4iUfoTuduUQ1mrNUuy3m1PVBrxtnEy?cluster=devnet)
- **Create role tx:** [`5LLTGxen2j9fjCSGMQz3iXw1na5erBfG2o8m1L5m7HYVcqk2Njmn6Ndif2sQqcBL57gEnLuhuyyvYeTGu3sAmT1x`](https://explorer.solana.com/tx/5LLTGxen2j9fjCSGMQz3iXw1na5erBfG2o8m1L5m7HYVcqk2Njmn6Ndif2sQqcBL57gEnLuhuyyvYeTGu3sAmT1x?cluster=devnet)
- **Issue key tx:** [`2XjoBHBcEepFSNfyPnFsjuCjAY3G83Sx1QL5xYuELofGprSzWfkDiJTzBzZJuGbVo2Vs7m5BHgBbrZuAKER14M7e`](https://explorer.solana.com/tx/2XjoBHBcEepFSNfyPnFsjuCjAY3G83Sx1QL5xYuELofGprSzWfkDiJTzBzZJuGbVo2Vs7m5BHgBbrZuAKER14M7e?cluster=devnet)
- **Permission allow tx:** [`2yNi78j3XV8TStV4VZW1KBrPqAegy1KPhsNceKY9vVWswAtFtyF8PpqNvJqQRs3zSqTNrLhYv6RZ8ovBPKgcJPAn`](https://explorer.solana.com/tx/2yNi78j3XV8TStV4VZW1KBrPqAegy1KPhsNceKY9vVWswAtFtyF8PpqNvJqQRs3zSqTNrLhYv6RZ8ovBPKgcJPAn?cluster=devnet)
- **Permission deny tx (insufficient scopes):** consume returned `DENY insufficient scopes (403) [InsufficientScopes]` — read-only key attempted write scope
- **Rate-limit deny tx:** consume returned `DENY rate limit exceeded (429) [RateLimitExceeded]` — 11th call in 60s window (max=10)
- **Revoke key tx:** [`3FpZMhMsePQfXqybFvifWbGsW7ubSDV9Cj8SEHvQEhwpMAiVRwkKCQrV1D2MUJ4kxrQBrqVFBSJdYzEfdeNqbwto`](https://explorer.solana.com/tx/3FpZMhMsePQfXqybFvifWbGsW7ubSDV9Cj8SEHvQEhwpMAiVRwkKCQrV1D2MUJ4kxrQBrqVFBSJdYzEfdeNqbwto?cluster=devnet)
- **Revoke deny tx:** consume returned `DENY key revoked (401) [KeyRevoked]` after revocation
- **Toggle plan tx:** [`59EL4KTuSse4nzXBd7n6CXZWYerWWg9JZqoR14kuQ6rpf6TkFgGA65z2g6dNgWmRgQG7GwE5cmvrpoNZVfQdU3G7`](https://explorer.solana.com/tx/59EL4KTuSse4nzXBd7n6CXZWYerWWg9JZqoR14kuQ6rpf6TkFgGA65z2g6dNgWmRgQG7GwE5cmvrpoNZVfQdU3G7?cluster=devnet)
- **Plan inactive deny tx:** consume returned `DENY plan inactive (403) [PlanInactive]` after toggling plan off

Replay note: use a fresh wallet and run the CLI flow above against devnet.
