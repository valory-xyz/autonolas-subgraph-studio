# Predict-Polymarket Generalization — Schema Delta

**Status:** Draft for review (no code written yet)
**Parent plan:** [`SUBGRAPH_PLAN.md`](./SUBGRAPH_PLAN.md)
**Target:** modifies [`subgraphs/predict/predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql) in place (deployed in parallel; see §5)
**Reference handlers / business rules:** [`subgraphs/predict/predict-polymarket/CLAUDE.md`](../predict/predict-polymarket/CLAUDE.md)

This document is the concrete surface where the on-chain-only policy
boundary (plan §1.1) either holds or breaks. Review the delta here before
any handler work.

> **Filename note.** Kept as `pearl-trades-schema.md` for continuity with
> the review thread on PR #115. The subject is now the generalized
> predict-polymarket schema — there is no separate `pearl-trades`
> subgraph. Pearl Mini is one cohort among several surfaced by the
> generalized deployment.

---

## 1. What This Doc Is Not

Two things this doc deliberately isn't:

- **Not a new subgraph.** The plan moved away from cloning
  `predict-polymarket` per cohort (see plan §10). This schema modifies
  the existing subgraph in place, deployed in parallel with the current
  polystrat-only deployment for cutover safety.
- **Not a policy-boundary change.** Every field in the schema below can
  be derived from on-chain events alone. Nothing ties to server-side
  prediction data, by design. See §7.

---

## 2. Delta Summary

| Entity | Change | Rationale |
|---|---|---|
| `TraderService` | **Removed** | Polystrat-specific gate (`agentId == 86`). Cohort membership now resolved via `ApplicationClassifier`, which classifies at `serviceId` granularity regardless of agent id. |
| `ServiceClassification` | **New** | Mirrors `ApplicationClassifier.mapServiceIdStatuses` on-chain. Populated from `ServiceApplicationTypeUpdated` events. Keyed on `serviceId`. |
| `ClassificationChange` | **New** | Immutable audit-trail row per `ServiceApplicationTypeUpdated`. Answers "when was this service classified / reclassified, by whom." |
| `ApplicationType` | **New enum** | `{ NON_EXISTENT, PEARL, OTHER }` — mirrors the on-chain enum. Must grow in lockstep with classifier UUPS upgrades (see plan §7.3). |
| `TraderAgent` | **Extended** | Adds `classification: ServiceClassification` (resolved via `serviceId` at agent creation); adds `agentIds: [Int!]!` populated from `RegisterInstance` so the polystrat-only view (`agentIds_contains: [86]`) is preserved after the cohort gate is removed; adds optional `ownerEOA` / `agentEOA` populated only for PEARL services from `PolySafeCreator`. No rename — keeps schema continuity with the existing deployment. |
| `Funding` | **New** (cohort-scoped) | USDC / wMATIC `Transfer` events touching a known PEARL Safe / owner EOA / agent EOA. Non-PEARL services don't create these entities. |
| `FundingDaily` | **New** (cohort-scoped) | Per-Safe, per-asset daily aggregate to keep "first deposit / total in / total out" queries cheap. |
| `PayoutRedemption` | **Field added:** `source: PayoutSource!` | Distinguishes `CONDITIONAL_TOKENS` vs `NEG_RISK_ADAPTER` in the audit trail. Without this field, NegRisk vs vanilla redemptions are indistinguishable. |
| `PayoutSource` | **New enum** | `{ CONDITIONAL_TOKENS, NEG_RISK_ADAPTER }`. |
| `Bet` / `MarketParticipant` / `DailyProfitStatistic` / `Global` / `Question` / `MarketMetadata` / `QuestionResolution` / `TokenRegistry` / `QuestionIdToConditionId` / `MarketParticipated` | **Unchanged** | Cohort-agnostic market/trade state. The only reason to touch these is the enum-value addition above on `PayoutRedemption`. |

**Nothing in this schema references a server-side `mode`, `tool`, `tier`,
request id, or any identifier that could be joined to the prediction
server** — by construction. §7 lists what's deliberately absent, for
review discipline.

---

## 3. Proposed Schema

Only new / modified entities are shown below. Unchanged entities carry
over verbatim from
[`predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql).

### 3.1 Classification (new)

```graphql
# Mirrors ApplicationClassifier.ApplicationType on-chain.
# Must be extended in lockstep with UUPS upgrades of the classifier.
enum ApplicationType {
  NON_EXISTENT
  PEARL
  OTHER
}

# One row per classified service. Upserted on every
# ServiceApplicationTypeUpdated event. Non-immutable because appType can
# be re-recorded by the maintainer.
type ServiceClassification @entity(immutable: false) {
  id: ID!                        # serviceId as string
  appType: ApplicationType!
  classifiedAt: BigInt!          # timestamp of most recent ServiceApplicationTypeUpdated
  classifiedBy: Bytes!           # maintainer that recorded the current appType
  history: [ClassificationChange!]! @derivedFrom(field: "classification")
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Immutable audit-trail row per ServiceApplicationTypeUpdated event.
type ClassificationChange @entity(immutable: true) {
  id: Bytes!                     # txHash + logIndex
  classification: ServiceClassification!
  previousType: ApplicationType! # NON_EXISTENT on first record
  newType: ApplicationType!
  classifiedBy: Bytes!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

### 3.2 `TraderAgent` (extended; no rename)

```graphql
type TraderAgent @entity(immutable: false) {
  id: Bytes!                        # multisig Safe address — unchanged
  serviceId: BigInt!                # unchanged

  # NEW — resolved at agent creation via serviceId. May be null if the
  # service has not yet been classified (backfill lag, or service created
  # before classifier deployment).
  classification: ServiceClassification

  # NEW — every agentId registered to this service, captured from
  # ServiceRegistryL2.RegisterInstance. Array because a service can
  # register multiple agent types. Preserves the polystrat-only view
  # (agentIds_contains: [86]) after the cohort gate is removed. Mirrors
  # service-registry/'s Service.agentIds pattern.
  agentIds: [Int!]!

  # NEW — populated only when classification.appType == PEARL, from
  # PolySafeCreator events. Null for all other cohorts. Used for
  # funding-flow attribution and Pearl Mini-specific queries.
  ownerEOA: Bytes                   # Privy-derived owner EOA
  agentEOA: Bytes                   # agent EOA from IdentityRegistryBridger.AgentWalletSet

  # Unchanged fields follow
  firstParticipation: BigInt
  lastActive: BigInt
  totalBets: Int!
  totalTraded: BigInt!
  totalTradedSettled: BigInt!
  totalPayout: BigInt!
  totalExpectedPayout: BigInt!
  bets: [Bet!]! @derivedFrom(field: "bettor")
  dailyProfitStatistics: [DailyProfitStatistic!]! @derivedFrom(field: "traderAgent")
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

Client query pattern:

```graphql
# All Pearl Mini agents — classifier-driven, human-readable cohort
traderAgents(where: { classification_: { appType: PEARL } }) { ... }

# All polystrat agents — raw registry-id filter, equivalent to the
# current implicit filter. Keep working even if polystrat is never
# given its own ApplicationType enum value.
traderAgents(where: { agentIds_contains: [86] }) { ... }
```

The two filters are independent and can be combined or used alone —
classifier for human-readable cohort names (as they're added to the
on-chain enum), `agentIds_contains` for durable raw-id queries.

### 3.3 Funding (new, cohort-scoped)

```graphql
enum FundingAsset { USDC, MATIC }
enum FundingDirection { IN, OUT }
enum FundingAddress { SAFE, OWNER, AGENT }

# One Funding row per ERC-20 Transfer touching a known PEARL cohort
# address. Handler early-returns for non-PEARL counterparties, so this
# entity only exists for Pearl Mini Safes.
type Funding @entity(immutable: true) {
  id: Bytes!                     # txHash + logIndex
  safe: TraderAgent!             # the Safe the flow is attributed to
  counterparty: Bytes!
  asset: FundingAsset!
  direction: FundingDirection!
  touches: FundingAddress!       # which cohort address (safe/owner/agent) actually moved
  amount: BigInt!                # positive; direction encodes in/out
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Daily aggregate — keeps "first deposit / total in / total out" O(days)
# rather than O(transfers). Per-asset, per-Safe.
type FundingDaily @entity(immutable: false) {
  id: ID!                        # safeAddress + "_" + asset + "_" + dayTimestamp
  safe: TraderAgent!
  asset: FundingAsset!
  date: BigInt!                  # UTC midnight
  totalIn: BigInt!
  totalOut: BigInt!
  transferCount: Int!
}
```

### 3.4 `PayoutRedemption` (field added)

```graphql
enum PayoutSource {
  CONDITIONAL_TOKENS             # vanilla binary markets
  NEG_RISK_ADAPTER               # multi-outcome markets
}

type PayoutRedemption @entity(immutable: true) {
  id: Bytes!                     # txHash + logIndex — unchanged
  redeemer: TraderAgent!         # unchanged
  conditionId: Bytes!            # unchanged
  question: Question             # unchanged
  payoutAmount: BigInt!          # unchanged
  source: PayoutSource!          # NEW
  blockNumber: BigInt!           # unchanged
  blockTimestamp: BigInt!        # unchanged
  transactionHash: Bytes!        # unchanged
}
```

---

## 4. Handler-Level Implications

Changes to `src/` relative to the current `predict-polymarket`
handlers:

### 4.1 Removed

- `TraderService` creation in `handleRegisterInstance`. No gate on
  `agentId == 86`. Agent creation moves to
  `handleCreateMultisigWithAgents` with no prerequisite `TraderService`
  lookup. The `handleRegisterInstance` handler is **not** removed — it's
  repurposed (see §4.2) to populate `agentIds` on `TraderAgent`.

### 4.2 Added

1. **Repurposed `handleRegisterInstance` — `agentIds` population.**
   The old cohort-gate body is replaced with: load-or-create
   `TraderAgent` by the service's multisig (via `serviceId` lookup),
   append `event.params.agentId.toI32()` to `agentIds` if not already
   present. Handler runs for every service registration, regardless of
   agentId. Preserves the polystrat-only query path
   (`agentIds_contains: [86]`) and supports services that register
   multiple agent types.
2. **`ApplicationClassifier` data source + handler.**
   `handleServiceApplicationTypeUpdated(serviceId, appType)`:
   - Load-or-create `ServiceClassification` by `serviceId`.
   - Capture `previousType` = existing `appType` or `NON_EXISTENT`.
   - Write new `appType`, `classifiedAt`, `classifiedBy`.
   - Append a `ClassificationChange` row.
   - Walk any `TraderAgent` entities whose `serviceId` matches and update
     their `classification` link. (In practice this is a single entity,
     since one service maps to one multisig.)
3. **`PolySafeCreator` data source + handler.**
   `handleSafeCreated(safe, owner, …)`:
   - Load-or-create `TraderAgent` by `safe` address.
   - Set `ownerEOA` = `owner`.
   - `agentEOA` is populated later when
     `IdentityRegistryBridger.AgentWalletSet` fires (via the existing
     `service-registry` path, re-indexed here or cross-read — see §5).
4. **ERC-20 `Transfer` handlers (USDC + wMATIC), cohort-scoped.**
   Handler steps:
   - Look up whether `from` or `to` is a known PEARL Safe / owner EOA /
     agent EOA (via a side index — see §4.3 below).
   - If neither side is a PEARL cohort address, early return. This is
     the cost-control lever that keeps indexing bounded.
   - Create `Funding` row, update `FundingDaily`, attribute to the Safe.
5. **`PayoutRedemption.source` populated by source handler.**
   `handlePayoutRedemption` (ConditionalTokens) → `CONDITIONAL_TOKENS`;
   `handleNegRiskPayoutRedemption` (NegRiskAdapter) → `NEG_RISK_ADAPTER`.

### 4.3 Modified

- **Cohort-address side index.** The ERC-20 `Transfer` handler can't
  afford to scan `TraderAgent` to check cohort membership per event. A
  small helper entity (`CohortAddress { id: Bytes!, safe: TraderAgent!,
  kind: FundingAddress! }`) indexed on the raw address gives O(1)
  lookup. Populated whenever a Safe, owner EOA, or agent EOA is set on
  a PEARL-classified `TraderAgent`.
- **`handleOrderFilled` gate.** Unchanged in structure — still
  `TraderAgent.load(maker)` and early-return if null. The difference is
  that `TraderAgent` now exists for all Olas agents, not just polystrat.
- **Settlement logic.** Unchanged. `processMarketResolution`,
  `processTradeActivity`, `processRedemption` from
  `predict-polymarket/src/utils.ts` port verbatim. Map caching, delta
  accumulation for `Global`, idempotency via `participant.settled` —
  all carry over.

---

## 5. Deployment Strategy — Parallel, Not Mutate

The existing `predict-polymarket` deployment stays up and untouched
until cutover. Steps:

1. **New deployment with the generalized schema.** Either `predict-polymarket`
   as a new version, or a distinct name during transition. The repo
   currently has the subgraph at `subgraphs/predict/predict-polymarket/` —
   implementation can stay in place; the deployment name is the switch.
2. **Two-start-blocks pattern.** Market-creation sources (`ConditionPreparation`,
   UMA `QuestionInitialized`, `TokenRegistered`) from the earlier of
   (a) current `predict-polymarket` start block or (b) a point early
   enough that every classified cohort's trading history is covered.
   Trade / redemption / classifier / PolySafeCreator / Transfer sources
   start from the earliest Olas-agent trading block, not the current
   polystrat start block.
3. **Parity check on cutover.** Run both deployments in parallel. Query
   the polystrat cohort on both and assert equivalence (modulo the new
   enum filter). Switch consumer dashboards when parity holds for N
   days.
4. **Retire the old deployment** once traffic has moved.

Reindex cost is proportional to Olas-agent trade volume, not total
Polymarket volume — see plan §7.2. A sizing check (distinct Olas-multisig
makers on `CTFExchange.OrderFilled`) should run before cutover.

---

## 6. Review Questions

Worth resolving before handler work begins:

1. **Current enum granularity.** `ApplicationClassifier.ApplicationType`
   today is `{NON_EXISTENT, PEARL, OTHER}`. Polystrat is therefore
   classified as `OTHER` for now — which is acceptable because the
   `agentIds_contains: [86]` filter gives the polystrat view directly
   without requiring a named enum value. Adding a first-class POLYSTRAT
   enum value is a separate UUPS upgrade + schema update that can
   happen later without a data migration. Flag for discussion: extend
   now or later?
2. **`TraderAgent` not renamed to `PearlSafe`.** Since the entity now
   covers every Olas agent, not just Pearl Safes, keeping the original
   name is correct and preserves query compatibility with consumers of
   the current polystrat-only deployment.
3. **Optional vs required `classification` field.** Modeled as nullable
   because agents may exist transiently between service creation and
   classifier record (backfill lag, or service created before classifier
   deployment). Alternative: make it required, with a NON_EXISTENT
   default row written at agent creation. Nullable is simpler; required
   is stricter. Recommendation: nullable + handler that defensively
   load-or-creates a `NON_EXISTENT` classification if needed.
4. **`Funding` counterparty on cohort-to-cohort transfers.** If two
   PEARL Safes transfer between themselves, the same `Transfer` maps to
   two `Funding` rows (one IN, one OUT) — `touches` disambiguates.
   Acceptable; flagged so query patterns account for it.
5. **Cost control for `Transfer` indexing.** USDC + wMATIC are among the
   highest-volume ERC-20s on Polygon. Even with cohort-scoped attribution
   (early-return on non-PEARL sides), the indexer still receives every
   event. If this proves expensive at beta scale, alternatives:
   (a) balance-snapshot pattern (query balances periodically, not per
   transfer), (b) separate funding-only subgraph, (c) reduce to USDC
   only. Recommendation: ship with both assets, measure, optimize.
6. **ERC-8004 metadata as a secondary signal (later).** If
   `IdentityRegistryBridger.MetadataSet` grows an `application_type` key,
   adding a secondary read is a follow-up. Resolution rule on conflict:
   `ApplicationClassifier` wins. Captured as an open item in plan §4.4.

---

## 7. Deliberately Absent

For audit discipline, absence is as important as presence. None of the
following appear in this schema, and none should be added without an
explicit policy revisit against plan §1.1:

- No `mode` / `tool` / `tier` field on any entity.
- No `requestId` / `predictionId` / server-correlation identifier.
- No `source = SERVER` enum variant, no "off-chain" enrichment hook.
- No timestamp-join helper fields (e.g., "request_minute bucket") that
  would make a server-side join one query away.
- No free-text `label` / `note` fields on `TraderAgent` or `Bet` that
  could be repurposed to carry server-side metadata informally.

If any of these become necessary for a future product ask, the answer is
a policy decision on plan §1.1, not a schema change.
