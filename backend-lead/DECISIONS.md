# Implementation decisions

## Structure and scope

Kept Express, TypeScript, Sequelize, PostgreSQL, Jest, zod and bignumber.js; no
dependencies were added. Routes validate HTTP input, services implement business
rules and transaction boundaries, repositories own persistence and locking, and
`domain/` holds the funding state machine and service errors. These are services,
not use cases. This is intentional pragmatic layering, not a clean-architecture
rewrite: services depend on Sequelize model/transaction types through repositories.
Extra repository abstractions and DI wiring would add ceremony without reducing
risk for this scope. Existing member creation and wallet lookup remain unchanged.

## Money and storage

- Money crosses HTTP and database boundaries as decimal strings. BigNumber handles
  comparisons, additions, subtraction and multiplication; only the multiplier is
  a JS integer. Persisted results are exact, fixed-scale strings.
- Inputs must be positive plain decimal strings with at most 18 integer and 18
  fractional digits, matching `DECIMAL(36,18)`. Exponents, whitespace, leading
  zeros except `0.x`, and excess precision are rejected, not silently rounded.
  Multiplier defaults to 1, accepts 0, and is bounded by PostgreSQL `INTEGER`
  (2,147,483,647). Unrepresentable products or cumulative totals return 422
  `money_limit_exceeded`; the entire operation rolls back.
- `funding_transactions` stores amount, type, status, immutable deposit reference
  and multiplier. Withdrawals have no PSP reference. Wallets cache balance and
  lifetime required/accrued turnover for constant-time locked decisions.
- `wallet_txs` contains signed deltas, operation kind, wallet, optional funding
  link, and balance after the operation. A funding link is unique, providing a
  second defense against duplicate credits/debits. SQL checks enforce valid
  signs, links, positive funding amounts and nonnegative wallet values.
- Ledger updates/deletes are rejected by a PostgreSQL trigger. Wallets start at
  zero with no entry; the migration creates explicit opening entries for any
  pre-existing positive balances. Those entries establish a migration baseline,
  not invented historical transactions. Production backfill would require
  reconciliation of that baseline before rollout.

## Transactions, locking and callbacks

All multi-row writes run in managed transactions at `READ COMMITTED`.
Callbacks lock `funding_transactions` `FOR UPDATE`, validate amount and state,
then lock the wallet before crediting. Concurrent retries wait on the lock and
observe committed terminal state. Wallet mutation, turnover update, ledger append,
and funding completion commit atomically or roll back atomically. Concurrency
control is database-backed (cross-process), with no in-memory mutexes.

Wagers and withdrawals lock the wallet before evaluating balance/turnover. That
serializes competing debits on the same wallet (wager-vs-wager, withdrawal-vs-
withdrawal, mixed debit paths, and deposit completion interactions) while keeping
different wallets independent. Lock order remains consistent (`funding` -> `wallet`)
where both rows are involved, avoiding deadlocks from inverted lock acquisition.

Allowed state transitions are only `Pending -> Completed` and `Pending -> Failed`.
A duplicate terminal callback with the same numeric amount returns 200 as an
idempotent acknowledgement (not a new transition). Conflicting terminal statuses
return 409; unknown references return 404. Amount mismatch returns 409 for both
completed/failed callbacks, including retries, with no money or state mutation.
Amount comparison is numeric (`100.50` equals `100.5000`). The service never
credits a PSP-claimed amount that differs from the originally agreed amount.
Production operations must alert and reconcile real-money mismatches.

## Turnover and withdrawals

Only completed deposits add `amount * multiplier`; pending and failed deposits
add nothing. Successful wagers accrue their full amount, including when multiplier
is zero. Both counters are lifetime totals per wallet/member: withdrawals do not
reset them, excess accrued turnover carries forward, and new deposits can relock
the wallet. Rejected wagers accrue nothing. Outstanding turnover is the exact
positive difference, returned as a string in a 422 response:

```json
{ "error": "turnover_locked", "outstandingTurnover": "10.250000000000000000" }
```

Turnover is checked before insufficient funds, so a locked client always receives
the outstanding amount. A valid withdrawal is immediately debited, has a ledger
entry and stays `Pending`; approval, payout and rejection/refunds are out of scope.
Wagers are debits only; winnings were not requested.

## Evidence and limitations

Tests run against migrated PostgreSQL (not SQLite or mocked concurrency paths).
Contention tests hold a wallet lock, start competing HTTP requests, and verify
blocking in `pg_stat_activity` before release. Coverage includes sequential and
concurrent callback retries, concurrent deposit completions, conflicting state
transitions, concurrent wager/withdrawal and mixed debits, turnover lock/unlock/
relock behavior, precision/overflow constraints, and invalid input handling.
Failure injection at the ledger repository verifies rollback after earlier writes.
Ledger sums are cross-checked against wallet balances, and database immutability/
uniqueness constraints are exercised directly.

Exactly-once applies to the database effect of a deposit reference, not network
delivery. Repeated creation, wager and withdrawal requests are **not** idempotent:
the spec supplies no client operation key. Direct SQL balance updates, ledger
inserts or truncation by privileged administrators are outside the service's
guarantee. Production should restrict database privileges and reconcile caches
against the ledger and completed funding records.

## What's deliberately not included

- Authentication/authorization are intentionally out of scope in this exercise.
  Routes trust caller-supplied identifiers after validation; production must bind
  every operation to authenticated identity and ownership checks.
- Real PSP integration is intentionally out of scope. This implementation models
  callback state transitions and idempotency, but not provider signatures,
  provider-specific payload verification, or provider delivery contracts.
- Human approval/rejection payout workflows are intentionally out of scope.
  Withdrawals stop at creating a pending request plus the required accounting
  effects in one transaction.

## What I'd do next with more time (priority order)

1. **Authentication and authorization first**: bind member/wallet operations to
   authenticated identity and ownership checks, not only validated request data.
2. **Provider signature verification** (see `DESIGN-PSP.md`) and callback
   authenticity checks before processing terminal transitions.
3. **HTTP idempotency keys** for create/wager/withdraw APIs, complementing the
   existing database-level callback idempotency guarantees.
4. **Durable webhook receipt/audit storage and reconciliation workflows** so
   mismatches and delayed/failing provider deliveries are operationally recoverable.
5. **Metrics and alerts** for callback mismatches, overflow attempts, lock wait
   regressions, and rejected transitions.
6. **Transactional outbox** for external side effects to preserve consistency
   between database commits and asynchronous integration events.
7. **Bounded deadlock/serialization retries** if future flows introduce new lock
   orders or stricter isolation requirements.
8. **Reviewed reversal entries** for rejected payouts and operator-led recovery.

Auth, deployment hardening, and full provider implementations are intentionally
not included in this exercise.

## AI disclosure

I used GitHub Copilot (GPT-6.1 Sol) for drafting portions of implementation,
tests, and documentation after deciding the approach. I reviewed and executed the
final code/tests myself and can explain each decision in this document. I chose
GPT-6.1 Sol over Opus because this scope was primarily execution/refinement, where
the lighter model was sufficient and delivered faster iteration.
