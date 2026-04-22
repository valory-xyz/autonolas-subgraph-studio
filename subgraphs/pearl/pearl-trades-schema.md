# Predict-Polymarket Generalization — Schema Delta

**Status:** Implemented (2026-04-22). The schema delta described here has landed in [`subgraphs/predict/predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql); handlers follow [`predict-polymarket/claude.md`](../predict/predict-polymarket/claude.md). Two small internal helpers not listed in §3 were added during implementation to handle the `RegisterInstance` → `CreateMultisigWithAgents` event ordering on Polygon — see [§3.4](#34-internal-helpers-added-during-implementation). This document is retained for design intent and review history.
**Parent plan:** [`SUBGRAPH_PLAN.md`](./SUBGRAPH_PLAN.md)
**Target:** modifies [`subgraphs/predict/predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql) in place (deployed in parallel; see §4)
**Reference handlers / business rules:** [`subgraphs/predict/predict-polymarket/claude.md`](../predict/predict-polymarket/claude.md)

This document is the concrete surface where the on-chain-only policy
boundary (plan §1.1) either holds or breaks. Review the delta here
before any handler work.

> **Filename note.** Kept as `pearl-trades-schema.md` for continuity with
> the review thread on PR #115. The subject is now the generalized
> predict-polymarket schema — there is no separate `pearl-trades`
> subgraph. Pearl Mini is one cohort among several, filtered client-side
> via the `multisig_:` link (see plan §4).

---

## 1. What This Doc Is Not

- **Not a new subgraph.** Modifies the existing `predict-polymarket`
  in place; deployed in parallel with the current polystrat-only
  deployment for cutover safety (§4).
- **Not a service-registry fork.** The `Multisig` helper introduced
  here carries only the minimum cohort-filter metadata needed inside
  this subgraph. Full registration records (`(agentInstance, agentId,
  operator)` tuples, timestamps, per-instance history) stay in
  `subgraphs/service-registry/`.
- **Not a classifier integration.** `ApplicationClassifier` is a
  documented future follow-up in plan §4.2, not part of this change.
- **Not a funding-flow indexer.** USDC/MATIC `Transfer` handling is
  explicitly out of scope; see plan §6.1.

---

## 2. Delta Summary

| Entity | Change | Rationale |
|---|---|---|
| `TraderService` | **Removed** | Polystrat-specific gate (`agentId == 86`). Cohort filtering moves to client queries against the `Multisig` link. |
| `Multisig` | **New** | Minimal index of every Olas multisig on Polygon. Carries `serviceId`, `agentIds: [Int!]!`, `operators: [Bytes!]!`, all deduplicated arrays. Created on `CreateMultisigWithAgents`, accumulated on `RegisterInstance`. Enables the cohort-filter predicate in `handleOrderFilled` and the public cohort filters (`multisig_: { agentIds_contains: [86] }`, etc.). Does not duplicate service-registry's full registration records — carries only what cohort filtering needs inside this subgraph. |
| `TraderAgent` | **Created lazily + link added** | Creation moves from `handleCreateMultisigWithAgents` to `handleOrderFilled` on first-trade. The entity only exists for services that have actually traded — the name stays semantically accurate. `multisig: Multisig!` link added for cohort filtering. No `agentIds` on `TraderAgent` — that lives on `Multisig`. |
| `PayoutRedemption` | **Field added:** `source: PayoutSource!` | Distinguishes `CONDITIONAL_TOKENS` vs `NEG_RISK_ADAPTER`. Without this field, NegRisk vs vanilla redemptions are indistinguishable in the audit trail. Orthogonal to the cohort work but shipped in the same change. |
| `PayoutSource` | **New enum** | `{ CONDITIONAL_TOKENS, NEG_RISK_ADAPTER }`. |
| `Bet` / `MarketParticipant` / `DailyProfitStatistic` / `Global` / `Question` / `MarketMetadata` / `QuestionResolution` / `TokenRegistry` / `QuestionIdToConditionId` / `MarketParticipated` | **Unchanged** | Cohort-agnostic market/trade state. |

**Nothing in this schema references a server-side `mode`, `tool`, `tier`,
request id, or any identifier that could be joined to the prediction
server** — by construction. §6 lists what's deliberately absent.

---

## 3. Proposed Schema

Only new / modified entities are shown. Unchanged entities carry over
verbatim from
[`predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql).

### 3.1 `Multisig` (new)

```graphql
# Minimal service-registration index for every Olas multisig on
# Polygon. Populated eagerly from ServiceRegistryL2 events. Used as
# the predicate for lazy TraderAgent creation in handleOrderFilled,
# and as the target of cohort-filter queries via the multisig_: link
# on TraderAgent.
#
# Scope note: this is NOT a duplicate of service-registry's Multisig
# entity. It carries only the deduplicated arrays needed for cohort
# filtering inside this subgraph. Full registration records (with
# per-instance tuples, timestamps, operator history) live in
# service-registry/.
type Multisig @entity(immutable: false) {
  id: Bytes!                     # multisig address
  serviceId: BigInt!
  agentIds: [Int!]!              # deduplicated; appended on RegisterInstance
  operators: [Bytes!]!            # deduplicated; appended on RegisterInstance
  traderAgent: TraderAgent       # @derivedFrom not used — link set at lazy creation
  createdAt: BigInt!
  terminatedAt: BigInt           # set by handleTerminateService
  blockNumber: BigInt!
  transactionHash: Bytes!
}
```

### 3.2 `TraderAgent` (lazy-created; no rename; `multisig` link)

```graphql
type TraderAgent @entity(immutable: false) {
  id: Bytes!                        # multisig Safe address — unchanged
  multisig: Multisig!               # NEW — link for cohort filter queries
  serviceId: BigInt!                # unchanged (denormalized for convenience)

  # Unchanged trade-activity fields
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

Removed fields relative to the prior draft: `agentIds`, `agentInstances`,
`classification`, `ownerEOA`, `agentEOA`. Cohort metadata lives on
`Multisig`; registration records live in `service-registry/`.

Client query patterns:

```graphql
# Polystrat — equivalent to the current implicit filter
traderAgents(where: { multisig_: { agentIds_contains: [86] } }) { ... }

# Pearl Mini — services registered via PolySafeCreator as operator
traderAgents(
  where: { multisig_: { operators_contains: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }
) { ... }

# All Olas multisigs, including ones that haven't traded yet
multisigs { id, serviceId, agentIds, operators, traderAgent { id, totalBets } }
```

The address/label mapping (`0xA749f605...` → "Pearl Mini", `86` →
"polystrat") lives in each client, not in the subgraph — see plan §4.1
and §8.

### 3.3 `PayoutRedemption` (field added)

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
  source: PayoutSource!          # NEW — distinguishes NegRisk vs vanilla
  blockNumber: BigInt!           # unchanged
  blockTimestamp: BigInt!        # unchanged
  transactionHash: Bytes!        # unchanged
}
```

### 3.4 Internal helpers (added during implementation)

The design in §3.1–3.3 assumed the multisig address was known at the point
`RegisterInstance` fires — which doesn't hold on Polygon, where the typical
initial-deployment event order for a fresh service is `RegisterInstance*` →
`CreateMultisigWithAgents`. Two tiny internal helper entities were added to
bridge this ordering without changing the consumer-visible surface:

```graphql
# Internal: serviceId -> multisig address lookup.
# Written when CreateMultisigWithAgents fires. Consulted by handleRegisterInstance
# (and handleTerminateService) to find the Multisig for a given serviceId.
type ServiceIndex @entity(immutable: false) {
  id: Bytes!        # bytes(serviceId)
  multisig: Bytes!  # multisig address
}

# Internal: buffer for RegisterInstance events that fire before
# CreateMultisigWithAgents. Drained into Multisig.agentIds / Multisig.operators
# when the Multisig entity is created.
type PendingMultisig @entity(immutable: false) {
  id: Bytes!             # bytes(serviceId)
  agentIds: [Int!]!
  operators: [Bytes!]!
}
```

These are not part of the public contract — consumers should not query them —
but are worth documenting here so future schema reviews understand why they
exist. The alternative (a contract `eth_call` from the handler to
`ServiceRegistryL2.getService`) was rejected per §5.1 ("prefer the helper —
no contract calls in handlers").

---

## 4. Handler-Level Implications

Changes to `src/` relative to the current `predict-polymarket` handlers:

### 4.1 Removed

- `TraderService` creation. No `agentId == 86` gate anywhere.

### 4.2 Modified: `handleCreateMultisigWithAgents`

- Creates a `Multisig` entity keyed on the multisig address, with
  `serviceId`, empty `agentIds`/`operators`, `createdAt`.
- **Does NOT create `TraderAgent`.** That creation is deferred to first
  trade (§4.4).

### 4.3 Repurposed: `handleRegisterInstance`

- Loads `Multisig` by the service's multisig address. (Needs a
  `serviceId → multisig` lookup — see §5 review questions; likely a
  small `ServiceIndex` helper populated on `CreateMultisigWithAgents`,
  or resolution via `ServiceRegistryL2.getService` call. Prefer the
  helper — no contract calls in handlers.)
- If the `Multisig` exists, append `event.params.agentId.toI32()` to
  `agentIds` and `event.params.operator` to `operators` (dedup both).
- Does not touch `TraderAgent`.

### 4.4 Modified: `handleOrderFilled` — lazy `TraderAgent` creation

1. Load `Multisig` by `event.params.maker`.
2. If `Multisig` is null → non-Olas maker, early return.
3. Load `TraderAgent` by the same address. If null:
   - Create `TraderAgent` with `multisig` = the loaded Multisig,
     `serviceId` copied from Multisig, zeros for cumulative fields.
   - Set `Multisig.traderAgent` to the new entity.
   - Increment `Global.totalTraderAgents`.
4. Proceed with the existing `handleOrderFilled` logic (bet creation,
   `processTradeActivity`, daily stat, market participant).

> **Correctness note on `TokenRegistry.load`.** The existing handler
> looks up the outcome token via `TokenRegistry.load(outcomeTokenId)`
> and early-returns on null. If `TokenRegistered` fired before the
> trade-source start block, the bet is silently dropped. This is an
> actual bug risk for the current polystrat deployment on markets
> created before its start block. The generalized deployment must use
> an earlier start block for market-creation sources — see plan §7.1
> item 3 for the two-start-blocks pattern, framed there as a
> correctness requirement. Same risk applies to `Question` via
> `ConditionPreparation`.

### 4.5 Modified: `handleTerminateService`

Set `Multisig.terminatedAt`. Doesn't touch `TraderAgent` — trading
history persists across service termination for audit purposes.

### 4.6 Settlement / payout logic unchanged

`processMarketResolution`, `processTradeActivity`, `processRedemption`
from `predict-polymarket/src/utils.ts` port verbatim. Map caching, delta
accumulation for `Global`, idempotency via `participant.settled` —
all carry over.

`processRedemption` gains one extra line setting `source` on the
created `PayoutRedemption`. The source is determined by which handler
invoked it (`handlePayoutRedemption` on ConditionalTokens →
`CONDITIONAL_TOKENS`; `handleNegRiskPayoutRedemption` on NegRiskAdapter
→ `NEG_RISK_ADAPTER`).

### 4.7 Unchanged handlers

- UMA `handleQuestionResolved` / `handleUmaQuestionResolved`.
- NegRisk handlers (other than the payout-source annotation).
- `handleTokenRegistered`.
- `handleConditionPreparation`.

---

## 5. Review Questions

1. **`serviceId → multisig` lookup in `handleRegisterInstance`.**
   Preferred implementation: a tiny internal `ServiceIndex { id:
   serviceId, multisig: Bytes }` entity written on
   `CreateMultisigWithAgents`. Alternative: read-through a contract
   call (`ServiceRegistryL2.getService`), slower and not recommended.
   Confirm the helper is acceptable (it's schema noise but cheap).
2. **`Multisig.traderAgent` field.** Modeled as a plain forward link
   (set explicitly at lazy creation) rather than `@derivedFrom` — lets
   us use it as a presence flag too (null = hasn't traded). If stricter
   modeling is preferred, make it `@derivedFrom(field: "multisig")` and
   use a separate boolean or check `TraderAgent.load(multisig.id)`
   explicitly in queries.
3. **`TraderAgent.serviceId` denormalization.** Duplicates
   `multisig.serviceId`. Kept for query convenience and schema
   continuity with the current deployment. Drop if preferred; consumers
   would then navigate `multisig { serviceId }`.
4. **`PayoutSource` grouping with the cohort change.** Orthogonal to
   cohort work but cheap to ship together. Alternative: ship as a
   separate minor-version change. Recommendation: bundle — it's one
   enum + one field addition.
5. **Cross-subgraph consistency.** This subgraph's `Multisig` is
   intentionally a subset of `service-registry/`'s `Multisig`. If the
   two ever drift (e.g. a service is terminated on-chain but one
   subgraph misses the event), consumers that join across should be
   aware. Document in subgraph CLAUDE.md at implementation time.

---

## 6. Deliberately Absent

For audit discipline, absence is as important as presence. None of the
following appear in this schema, and none should be added without an
explicit policy revisit against plan §1.1:

- No `mode` / `tool` / `tier` field on any entity.
- No `requestId` / `predictionId` / server-correlation identifier.
- No `source = SERVER` enum variant, no off-chain enrichment hook.
- No timestamp-join helper fields (e.g., "request_minute bucket") that
  would make a server-side join one query away.
- No free-text `label` / `note` fields on `TraderAgent` / `Multisig`
  that could be repurposed to carry server-side metadata informally.

Also deliberately absent (scope-reduction, not policy):

- No `ServiceClassification` / `ClassificationChange` / `ApplicationType`
  entities — deferred to a follow-up once `ApplicationClassifier`
  deploys. See plan §4.2.
- No `AgentInstance` entity with full `(agentInstance, agentId,
  operator)` tuples — that level of detail belongs in
  `subgraphs/service-registry/`, not here.
- No `Funding` / `FundingDaily` / ERC-20 `Transfer` handling —
  plan §6.1.
- No `ownerEOA` / `agentEOA` fields — plan §6.2.
- No `PolySafeCreator` data source. Its address is consumed as a
  client-side constant for `operators_contains:` filtering, not
  indexed as events.
