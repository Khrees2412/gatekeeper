# Gatekeeper — On-Chain API Gateway (Solana)

> *"Every company runs an API gateway—AWS API Gateway, Kong, or custom middleware with Redis. The rules for who can call what and how often live in a database your company controls. Gatekeeper moves that control-plane on-chain: any service, team, or third-party can verify API access against the same shared state without trusting your database."*

Gatekeeper is a Solana program (Anchor) that implements:
- API key issuance and revocation
- Role-based permission scopes (`u64` bitmask)
- Fixed-window rate limiting per key

No frontend is included. This is control-plane + CLI + minimal adapter.

## Program and Cluster
- Local development cluster: `localnet`
- Program ID: `9E2niqsSRf2GspkTvFE927shX6D1V27TRdxB4cA2YJaj`

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
- `ANCHOR_PROVIDER_URL` RPC URL (`http://127.0.0.1:8898` for local tests)
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
- `initialize(authority)`
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

## Tradeoffs
- Per-request transaction cost: each `consume` is an on-chain transaction.
- Hot account contention: every consume mutates one `ApiKey` account. This demo uses a single mutable `ApiKey` account per key; production would shard counters across multiple PDAs or separate real-time auth from on-chain settlement.
- Demo suitability: this is acceptable for correctness and shared verifiability; production systems typically split read-path auth from settlement or shard counters.

## Devnet Evidence (Fill After Deployment)
- Cluster: `devnet`
- Program ID: `<add deployed program id>`
- Permission allow tx: `<explorer link>`
- Permission deny tx: `<explorer link>`
- Rate-limit deny tx: `<explorer link>`
- Revoke deny tx: `<explorer link>`

Replay note: use a fresh wallet and run the CLI flow above against devnet.
