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
