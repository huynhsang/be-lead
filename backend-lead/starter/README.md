# Mini Wallet Service - Starter

This is the starter codebase for the Backend Lead take-home. The task itself is described in [`../readme.md`](../readme.md).

## Stack

TypeScript, Express, Sequelize, PostgreSQL, Jest. Money is `DECIMAL(36,18)` in Postgres, strings in JS/JSON, and all arithmetic goes through `bignumber.js` (see `src/lib/money.ts`).

## Setup

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # starts Postgres on localhost:5439 (dev + test databases)
npm run db:migrate   # migrates the dev database
npm test             # migrates the test database and runs the test suite
npm run dev          # starts the API on :3000
```

If port 5439 clashes with something on your machine, change it in `docker-compose.yml` and `.env`.

## Layout

```
src/
├── app.ts               # express app factory
├── index.ts             # entrypoint
├── config.ts
├── lib/money.ts         # BigNumber helpers - use these for all money math
├── domain/              # funding state machine and service errors
├── db/
│   ├── sequelize.ts
│   ├── cli-config.js    # sequelize-cli config (used by npm run db:migrate)
│   ├── migrations/      # add your migrations here
│   └── models/
├── routes/
├── services/            # money rules and transaction orchestration
└── repositories/        # Sequelize queries, locks and append-only ledger writes
test/                    # add your tests here
```

## Conventions to keep

- Money never touches JS `number`. Strings at the boundaries, BigNumber in between.
- Any operation writing more than one row runs in a single DB transaction (see `memberService.createMember`).
- Routes validate input with zod and delegate to services; business logic lives in services, not routes.
- New tables are created via migrations, not `sync()`.

## Implemented API

Create a member with `POST /members` (`{ "username": "alice01" }`) and use its
member and wallet IDs in the following flow:

| Endpoint | Body | Success |
| --- | --- | --- |
| `POST /deposits` | `{ "memberId": "<uuid>", "amount": "100.50", "turnoverMultiplier": 1 }` | 201: pending funding transaction, including `id` and `pspRef` |
| `POST /psp/callbacks` | `{ "pspRef": "<ref>", "status": "completed", "amount": "100.50" }` | 200: terminal funding transaction (also for matching retries) |
| `POST /wallets/:walletId/wagers` | `{ "amount": "10.00" }` | 201: wager ID, wallet ID, new balance and accrued turnover |
| `POST /withdrawals` | `{ "memberId": "<uuid>", "amount": "50.00" }` | 201: pending funding transaction; wallet debited immediately |
| `GET /members/:memberId/wallet` | None | 200: wallet ID, member ID, balance and both turnover counters |

The callback also accepts `failed`. Amounts are positive plain decimal strings
fitting `DECIMAL(36,18)`. Validation errors return 400, unknown resources 404,
callback amount/state conflicts 409, and insufficient balance, outstanding
turnover or numeric capacity errors 422. A turnover error includes
`outstandingTurnover` as a decimal string.

## curl examples

Start the API with `npm run dev` after completing setup, then run these examples
in order in another terminal. They use Bash and `curl`; no extra tools are needed.
Amounts must be JSON strings, not numbers.

### 1. Check health

```bash
BASE_URL=http://localhost:3000

curl -i "$BASE_URL/health"
```

Returns 200 with `{"status":"ok"}` when the database is reachable.

### 2. Create a member and wallet

```bash
curl -i -X POST "$BASE_URL/members" \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice01"}'
```

Returns 201 with `member` and `wallet` objects. Choose a new, unique username
(3-64 characters) if you repeat this flow. Copy `member.id` and `wallet.id` from
the response into these variables:

```bash
MEMBER_ID='replace-with-member-id'
WALLET_ID='replace-with-wallet-id'
```

### 3. Get the member's wallet

```bash
curl -i "$BASE_URL/members/$MEMBER_ID/wallet"
```

Returns 200 with the wallet's balance, `requiredTurnover` and `accruedTurnover`.
A new wallet starts with all three values at zero.

### 4. Create a deposit

```bash
curl -i -X POST "$BASE_URL/deposits" \
  -H 'Content-Type: application/json' \
  -d "{\"memberId\":\"$MEMBER_ID\",\"amount\":\"100.50\",\"turnoverMultiplier\":0}"
```

Returns 201 with a pending funding transaction. The wallet is not credited yet.
This walkthrough uses `turnoverMultiplier: 0` so the later withdrawal can succeed
without first wagering the entire deposit. Omit it to use the default of 1.
Copy `pspRef` from the response:

```bash
PSP_REF='replace-with-deposit-psp-ref'
```

### 5. Complete the deposit through the mock PSP callback

```bash
curl -i -X POST "$BASE_URL/psp/callbacks" \
  -H 'Content-Type: application/json' \
  -d "{\"pspRef\":\"$PSP_REF\",\"status\":\"completed\",\"amount\":\"100.50\"}"
```

Returns 200 and credits the wallet with 100.50. Repeating this exact callback
returns 200 without crediting again.

To simulate a failed deposit instead, create a **separate pending deposit** in
step 4, set `PSP_REF` to its reference, and send:

```bash
curl -i -X POST "$BASE_URL/psp/callbacks" \
  -H 'Content-Type: application/json' \
  -d "{\"pspRef\":\"$PSP_REF\",\"status\":\"failed\",\"amount\":\"100.50\"}"
```

A failed callback returns 200 without crediting the wallet. Do not send it for
the already completed deposit: conflicting terminal states return 409.

### 6. Record a wager

```bash
curl -i -X POST "$BASE_URL/wallets/$WALLET_ID/wagers" \
  -H 'Content-Type: application/json' \
  -d '{"amount":"10.00"}'
```

Returns 201 with the wager ID, wallet ID, new balance and accrued turnover.
After the successful deposit above, the balance is 90.50 and accrued turnover is
10.00. Each request records a new wager; this endpoint is not idempotent.

### 7. Create a withdrawal

```bash
curl -i -X POST "$BASE_URL/withdrawals" \
  -H 'Content-Type: application/json' \
  -d "{\"memberId\":\"$MEMBER_ID\",\"amount\":\"50.00\"}"
```

Returns 201 with a pending withdrawal and debits the wallet immediately.
Following the successful flow above, the remaining balance is 40.50. Repeat
the GET request in step 3 to inspect it. Outstanding turnover or insufficient
balance returns 422 instead.

## Development notes

`npm test` migrates and truncates the configured **test** database: use a dedicated
database, never production. Tests use real PostgreSQL row locks and require the
test role to see its own sessions in `pg_stat_activity` (the provided setup does).
`npm run build` checks TypeScript and generates `dist/`; there is no configured
lint/format command. Existing setup commands above apply; no extra packages are
needed. The mock callback is intentionally unauthenticated, not a production
webhook endpoint.

See [`../DECISIONS.md`](../DECISIONS.md) for correctness guarantees, trade-offs and
AI disclosure, and [`../DESIGN-PSP.md`](../DESIGN-PSP.md) for the provider extension
design.
