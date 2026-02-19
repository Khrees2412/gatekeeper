# spec.md — Solana Gatekeeper (API Keys + RBAC + Rate Limits)

---

## 0. Goal

Implement a Solana program (Rust, Anchor or native) that rebuilds a classic backend pattern:

- **API key issuance and revocation**
- **Role-based permission scopes** (bitmask)
- **Rate limiting per API key** using a fixed time window

Deliver a minimal but complete control-plane backend on Solana, with a CLI and a tiny gateway adapter.

> **No frontend. No delegation. No nested roles. No adaptive logic.**

---

## 1. Web2 Model (reference)

A typical Web2 gateway uses:

- **DB tables:** `api_keys`, `roles`, `plans`, `usage_counters`
- **Middleware:**
  - Validate key
  - Check permissions
  - Enforce rate limits
  - Increment usage counter

Solana version replaces the DB with accounts and moves core logic into an on-chain program instruction.

---

## 2. On-Chain Model (Solana)

Control-plane state lives on-chain, and any service can verify access against it.

| Concept       | Purpose                                          |
| ------------- | ------------------------------------------------ |
| **ApiKey**    | The primary identity                              |
| **Role**      | Defines permission scopes (bitmask)               |
| **UsagePlan** | Defines rate limits                               |
| **consume**   | Enforces limit + increments counter atomically    |

---

## 3. Accounts

### 3.1 GlobalState (PDA)

**Purpose:** Program-wide admin config.

**Fields:**

| Field       | Type     |
| ----------- | -------- |
| `authority` | `Pubkey` |
| `bump`      | `u8`     |

**Seeds:**

```
["global_state"]
```

**Invariants:**

- Only `authority` may create/modify plans, roles, and revoke keys.

---

### 3.2 UsagePlan (PDA)

**Purpose:** Reusable rate policy.

**Fields:**

| Field              | Type   |
| ------------------ | ------ |
| `plan_id`          | `u32` (or `u64`) |
| `window_seconds`   | `u64`  |
| `max_per_window`   | `u64`  |
| `is_active`        | `bool` |

**Seeds:**

```
["plan", plan_id_le_bytes]
```

**Notes:**

- `window_seconds` should be a small number for the demo (e.g. `60`).
- `max_per_window` e.g. `10`.

---

### 3.3 Role (PDA)

**Purpose:** Reusable permission policy.

**Fields:**

| Field             | Type                                    |
| ----------------- | --------------------------------------- |
| `role_id`         | `u32` (or `u64`)                        |
| `name`            | `[u8; 32]` (optional; fixed size avoids realloc) |
| `scopes_bitmask`  | `u64` (or `u128` if you want more scopes)       |

**Seeds:**

```
["role", role_id_le_bytes]
```

**Notes:**

- Scopes are bits: `bit 0 = READ`, `bit 1 = WRITE`, etc.
- The adapter/gateway decides which bit is required for an endpoint.

---

### 3.4 ApiKey (PDA)

**Purpose:** Issued "API key identity" tied to a role and plan, plus usage counter state.

**Fields:**

| Field          | Type                                  |
| -------------- | ------------------------------------- |
| `owner`        | `Pubkey`                              |
| `plan`         | `Pubkey` (plan account address)       |
| `role`         | `Pubkey` (role account address)       |
| `status`       | `u8` (`0 = Active`, `1 = Revoked`)    |
| `window_start` | `i64`                                 |
| `count`        | `u64`                                 |
| `created_at`   | `i64`                                 |

**Seeds (choose one):**

| Option | Seeds                                       | Notes                    |
| ------ | ------------------------------------------- | ------------------------ |
| **A**  | `["key", owner_pubkey]`                     | 1 key per owner          |
| **B**  | `["key", owner_pubkey, key_id_le_bytes]`    | Multiple keys per owner  |

> **Recommended for simplicity:** Option A.

---

## 4. Instructions (6)

### 4.1 `initialize(authority)`

Creates `GlobalState`.

**Rules:**

- Can only be run once (or allow re-init only if state is empty).

---

### 4.2 `create_plan(plan_id, window_seconds, max_per_window, is_active)`

Creates a `UsagePlan`.

**Auth:**

- `GlobalState.authority` only.

---

### 4.3 `upsert_role(role_id, name, scopes_bitmask)`

Creates or updates a `Role`.

**Auth:**

- `GlobalState.authority` only.

**Notes:**

- "upsert" means create if missing, else overwrite fields.

---

### 4.4 `issue_key(owner, plan_pubkey, role_pubkey)`

Creates an `ApiKey` for `owner`.

**Auth:**

- `GlobalState.authority` only (admin-issued keys).

**Rules:**

- `status` must start as `Active`.
- Initialize `window_start = 0`, `count = 0`.

---

### 4.5 `revoke_key(api_key_pubkey)`

Revokes an API key.

**Auth:**

- `GlobalState.authority` only.

**Rules:**

- Set `status = Revoked`.

---

### 4.6 `consume(required_scopes_mask: u64)`

Atomic authorization + rate-limit check + usage increment.

**Accounts read/write:**

| Account         | Access |
| --------------- | ------ |
| `ApiKey`        | mut    |
| `UsagePlan`     | read   |
| `Role`          | read   |
| Clock sysvar    | read   |

**Logic (exact):**

```
1. Reject if ApiKey.status == Revoked
2. Reject if UsagePlan.is_active == false
3. Permission check:
     Role.scopes_bitmask & required_scopes_mask == required_scopes_mask
     else → reject
4. Rate limit check (fixed window):
     now = clock.unix_timestamp
     if ApiKey.window_start == 0 → set to now
     if now >= ApiKey.window_start + plan.window_seconds:
         ApiKey.window_start = now
         ApiKey.count = 0
     if ApiKey.count >= plan.max_per_window → reject
     else → ApiKey.count += 1
5. Return:
     Success = allowed
     Failure = denied (custom error codes)
```

---

## 5. Error Codes (minimum)

| Code                   | Meaning                             |
| ---------------------- | ----------------------------------- |
| `Unauthorized`         | Caller is not the authority         |
| `KeyRevoked`           | API key has been revoked            |
| `PlanInactive`         | Usage plan is not active            |
| `InsufficientScopes`   | Missing required permission bits    |
| `RateLimitExceeded`    | Window usage count exceeded         |
| `InvalidPlanOrRole`    | Referenced plan or role is invalid  |

---

## 6. CLI Requirements (no frontend)

**CLI commands:**

```
init
create-plan    --plan-id ... --window ... --max ...
upsert-role    --role-id ... --scopes ... --name ...
issue-key      --owner ... --plan-id ... --role-id ...
consume        --owner ... --required-scopes ...
revoke-key     --owner ...
```

**The CLI should output:**

- Account addresses
- Transaction signatures (Devnet links in README)
- Allow/deny results for `consume`

---

## 7. Adapter Middleware (minimal)

A tiny sample gateway adapter (Node / Bun / Go acceptable):

1. Maps an HTTP route to a `required_scopes_mask`
2. Calls `consume(required_scopes_mask)` against the user's `ApiKey`
3. Returns:
   - `200` if allowed
   - `429` if rate-limited
   - `403` if permission denied

> Keep it small. The adapter is demonstration only.

---

## 8. README Story (include verbatim)

> *"Every company runs an API gateway—AWS API Gateway, Kong, or custom middleware with Redis. The rules for who can call what and how often live in a database your company controls. Gatekeeper moves that control-plane on-chain: any service, team, or third-party can verify API access against the same shared state without trusting your database."*

Then document:

- **Web2 design vs Solana design**
- **Account model**
- **Tradeoffs:**
  - Per-request transaction cost
  - Hot account contention on `ApiKey`
  - Why this is acceptable for a demo and what you'd split later

---

## 9. Non-goals

- ❌ No subscription billing
- ❌ No payments
- ❌ No delegation / sub-admins
- ❌ No multiple environments
- ❌ No analytics dashboards
- ❌ No adaptive logic

---

## 10. Acceptance Checklist

- [ ] Program builds and tests locally
- [ ] Deployed to Devnet
- [ ] Public repo
- [ ] README includes architecture + tradeoffs + Devnet tx links
- [ ] CLI can demonstrate:
  - [ ] Permission allow/deny
  - [ ] Rate limit allow/deny
  - [ ] Revoke stops access
