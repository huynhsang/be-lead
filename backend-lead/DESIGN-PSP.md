# The 50th PSP

**Goal:** a junior adds one adapter, configuration and contract fixtures, without
editing wallet or funding rules. An experienced reviewer owns money semantics.

```text
POST /psp/:provider/callbacks (raw body + headers)
  -> allowlisted provider/account config
  -> adapter.verify(raw bytes, headers, secret reference)
  -> adapter.normalize(verified payload)
  -> durable callback receipt (unique provider/account/event key)
  -> deposit service (funding + wallet locks, state machine, ledger)
  -> commit receipt/outcome + outbox -> provider-specific acknowledgement
```

## Adapter contract and ownership

```ts
type NormalizedEvent =
  | {
      kind: 'terminal';
      eventId: string;
      pspRef: string;
      status: 'completed' | 'failed';
      amount: string; // exact major-unit decimal; never a JS number
      currency: string;
    }
  | { kind: 'nonterminal'; eventId: string; pspRef: string };

interface PspAdapter {
  /** Stable provider identifier used by the adapter registry and config mapping. */
  readonly id: string;
  /**
   * Verifies callback authenticity from raw request bytes before any business logic.
   *
   * @param raw - Original webhook body bytes; signature checks must never use a
   * parsed/re-serialized payload.
   * @param headers - Provider callback headers used by the verification scheme.
   * @param config - Provider/account verification config (secret reference, replay
   * window, expected account identifiers).
   * @returns Provider payload in a verified shape suitable for normalization.
   * @throws Error when signature, timestamp, account, or replay validation fails.
   */
  verify(raw: Buffer, headers: Headers, config: ProviderConfig): VerifiedPayload;
  /**
   * Converts verified provider payload into platform-standard callback semantics.
   *
   * @param payload - Verified provider callback payload from {@link verify}.
   * @param config - Provider/account normalization config (status map, unit scale,
   * accepted currency).
   * @returns Normalized callback event consumed by core funding/wallet services.
   * @throws Error when required fields are missing or values are ambiguous/invalid.
   */
  normalize(payload: VerifiedPayload, config: ProviderConfig): NormalizedEvent;
  /**
   * Builds provider-specific HTTP acknowledgement from callback processing outcome.
   *
   * @param outcome - Canonical callback handling result after durable receipt and
   * state-machine processing.
   * @returns HTTP response shape expected by the provider retry contract.
   */
  acknowledge(outcome: CallbackOutcome): { status: number; body: string };
}
```

Verification belongs at the provider edge, **before any normalization or money
service call**. It uses the original bytes for signatures, constant-time comparison
where appropriate, timestamp/replay policy, account identity and rotated secrets.
Express raw-body capture must happen before JSON parsing on these routes.
Adapters own status vocabulary, reference extraction, minor-unit conversion using
BigNumber and configured currency exponent, and provider-specific acknowledgements.
Missing/ambiguous values are errors, not default success; never infer success
from an HTTP response alone. Currency must match the funding record (the exercise
is single-currency; add that field before supporting real providers).

Core services own amount agreement, provider/account/reference ownership, legal
transitions, wallet locking, turnover and ledger atomicity. Provider identifiers
become a composite unique funding key. `success` followed by `pending` records a
nonterminal receipt with no state regression; a conflicting terminal event is
quarantined and alerted, never reversed automatically. Duplicate event IDs help
audit/dedupe delivery, but funding-row locking remains necessary because providers
can send different event IDs for the same payment.

## Configuration and safe extension

An explicit code registry maps provider names to adapters; validated configuration
selects enabled accounts, secret-manager references, accepted currencies,
amount units, verification windows and acknowledgement policy. Never dynamically
load code from callback input. Persist a configuration/version identifier with
receipts for incident reconstruction. Secrets and regulated payload fields are
redacted; encrypted receipt storage has restricted access and retention limits.

Concrete wiring (explicit allowlist + config lookup):

```ts
const ADAPTERS: Record<string, PspAdapter> = {
  mockpsp: new MockPspAdapter(),
  stripe: new StripeAdapter(),
  adyen: new AdyenAdapter(),
};

type ProviderConfig = {
  provider: string;
  enabled: boolean;
  accountId: string;
  secretRef: string;
  acceptedCurrencies: string[];
  amountUnit: 'major' | 'minor';
  replayWindowSeconds: number;
};

async function resolveProvider(provider: string): Promise<{ adapter: PspAdapter; config: ProviderConfig }> {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error('unknown_provider');

  const config = await providerConfigRepository.getEnabled(provider);
  return { adapter, config };
}
```

The junior workflow is: copy a small adapter template, map the provider's
documented states/units/signature scheme, add scrubbed fixtures, register the
adapter, pass contract tests and obtain review. No provider-specific branches
belong in deposit services. Unexpected provider behavior fails closed and alerts;
unknown references/mismatches remain actionable, not silent acknowledgements.
For providers requiring 200 even for quarantined callbacks, acknowledge only
after the receipt and an explicit quarantine outcome are durably committed.

## One-day integration path for a junior engineer

Scope for adding PSP #50 is intentionally narrow and procedural:

1. Add one adapter file implementing `verify`, `normalize`, `acknowledge`.
2. Register adapter in the static provider registry (explicit allowlist only).
3. Add provider/account configuration (secret reference, units, currencies,
   replay/timestamp window, acknowledgement policy).
4. Add scrubbed request fixtures (valid + tampered + retries + quirks).
5. Pass shared adapter contract tests and shared money-flow regression tests.
6. Obtain review from a senior owner of money semantics before enabling traffic.

This keeps juniors out of wallet/funding state-machine code; correctness-critical
logic stays centralized and reviewed by engineers who own incident risk.

## Sketch

```text
POST /psp/:provider/callbacks
  -> lookup provider config (allowlisted, enabled, account-scoped)
  -> adapter.verify(raw_body, headers, secret_ref)
       - signature/HMAC check on raw bytes
       - timestamp/replay window check
  -> adapter.normalize(verified_payload)
       - provider status -> terminal/nonterminal
       - minor/major units -> exact decimal string
  -> persist callback receipt (provider/account/event uniqueness)
  -> deposit service handleCallback(normalized_event)
       - lock funding row
       - validate transition + amount agreement
       - lock wallet row
       - apply wallet + ledger atomically
  -> persist outcome + emit outbox event
  -> adapter.acknowledge(outcome) (provider-specific HTTP response)
```

## Tests without a reliable provider

Use versioned, scrubbed request bytes/headers from provider docs or sandbox
captures and local test keys. Shared adapter contract tests require valid and
tampered signatures, whitespace/raw-byte changes, key rotation, stale timestamps,
missing/unknown fields, all documented states, exact minor-unit conversions and
unsupported currencies. Golden tests assert normalized events and exact
acknowledgements. Keep verification clock/config injectable; use the real crypto
algorithm, not a mocked `verify()` returning true.

Run each adapter through the shared PostgreSQL money-flow tests with duplicate,
concurrent and out-of-order fixtures. A local PSP stub simulates retries, timeouts
and reordered deliveries; CI needs no provider network or production secret.
Optional sandbox smoke tests run separately. Roll out disabled by default, then
enable a limited account with reconciliation and alerts before wider traffic.

Minimum adapter fixture matrix per provider:

- valid terminal success and valid terminal failure
- duplicate event delivery (same event id)
- same payment, different event ids (provider retry quirk)
- out-of-order events (`success` then `pending`, or terminal conflict)
- tampered signature/body/header and stale timestamp
- minor-unit/major-unit conversion boundaries and unsupported currency
