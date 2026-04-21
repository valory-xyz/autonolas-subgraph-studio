# Predict-Polymarket Generalization — Schema Delta

**Status:** Draft for review (no code written yet)
**Parent plan:** [`SUBGRAPH_PLAN.md`](./SUBGRAPH_PLAN.md)
**Target:** modifies [`subgraphs/predict/predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql) in place (deployed in parallel; see §4)
**Reference handlers / business rules:** [`subgraphs/predict/predict-polymarket/CLAUDE.md`](../predict/predict-polymarket/CLAUDE.md)

This document is the concrete surface where the on-chain-only policy
boundary (plan §1.1) either holds or breaks. Review the delta here
before any handler work.

> **Filename note.** Kept as `pearl-trades-schema.md` for continuity with
> the review thread on PR #115. The subject is now the generalized
> predict-polymarket schema — there is no separate `pearl-trades`
> subgraph. Pearl Mini is one cohort among several, filtered client-side
> (see plan §4).

---

## 1. What This Doc Is Not

- **Not a new subgraph.** Modifies the existing `predict-polymarket`
  in place; deployed in parallel with the current polystrat-only
  deployment for cutover safety (§4).
- **Not a classifier integration.** `ApplicationClassifier` is a
  documented future follow-up in plan §4.2, not part of this change.
- **Not a funding-flow indexer.** USDC/MATIC `Transfer` handling is
  explicitly out of scope; see plan §6.1.

---

## 2. Delta Summary

| Entity | Change | Rationale |
|---|---|---|
| `TraderService` | **Removed** | Polystrat-specific gate (`agentId == 86`). Cohort filtering is now client-side against `TraderAgent.agentIds` and `AgentInstance.operator`. |
| `AgentInstance` | **New** | One row per `ServiceRegistryL2.RegisterInstance` event. Captures the full `(operator, agentInstance, agentId, service)` tuple so clients can filter by operator address (e.g. PolySafeCreator for Pearl Mini) or agent id without cross-subgraph joins. |
| `TraderAgent` | **Extended** | Adds `agentIds: [Int!]!` (deduplicated, fast polystrat filter) and derived `agentInstances: [AgentInstance!]!`. No rename — keeps schema continuity. |
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

### 3.1 `AgentInstance` (new)

```graphql
# One row per ServiceRegistryL2.RegisterInstance event. Captures the
# full registration tuple so clients can filter by operator (e.g. the
# PolySafeCreator contract for Pearl Mini services) or agent id.
#
# If the same agent-instance address is registered under multiple
# services over time, id collision is avoided by deriving the id from
# (agentInstance, serviceId) — see handler note in §4.
type AgentInstance @entity(immutable: true) {
  id: Bytes!                     # concat(agentInstance, serviceId) — unique per registration
  agentInstance: Bytes!          # the agent's EOA registered to act for the service
  service: TraderAgent!          # the TraderAgent (multisig) of the service
  agentId: Int!                  # RegisterInstance.agentId
  operator: Bytes!               # RegisterInstance.operator — who registered this instance
  registeredAt: BigInt!          # block timestamp
  blockNumber: BigInt!
  transactionHash: Bytes!
}
```

### 3.2 `TraderAgent` (extended; no rename)

```graphql
type TraderAgent @entity(immutable: false) {
  id: Bytes!                        # multisig Safe address — unchanged
  serviceId: BigInt!                # unchanged

  # NEW — every agentId registered to this service, deduplicated.
  # Populated from ServiceRegistryL2.RegisterInstance. Preserves the
  # polystrat-only view via agentIds_contains: [86]. Mirrors
  # service-registry/'s Service.agentIds pattern.
  agentIds: [Int!]!

  # NEW — derived list of full registration records. Each
  # AgentInstance carries (agentInstance, agentId, operator). Use this
  # collection when filtering by operator (e.g. PolySafeCreator for
  # Pearl Mini).
  agentInstances: [AgentInstance!]! @derivedFrom(field: "service")

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

Client query patterns:

```graphql
# Polystrat — equivalent to the current implicit filter
traderAgents(where: { agentIds_contains: [86] }) { ... }

# Pearl Mini — services registered via PolySafeCreator as operator
traderAgents(
  where: { agentInstances_: { operator_in: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }
) { ... }

# Full registration records (who deployed what)
agentInstances(where: { service: "0x..." }) { operator, agentId, agentInstance }
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

---

## 4. Handler-Level Implications

Changes to `src/` relative to the current `predict-polymarket` handlers:

### 4.1 Removed

- `TraderService` creation in `handleRegisterInstance`. No gate on
  `agentId == 86`. Agent creation moves to
  `handleCreateMultisigWithAgents` with no prerequisite lookup.

### 4.2 Repurposed: `handleRegisterInstance`

Was a cohort gate; now populates `TraderAgent.agentIds` and creates
`AgentInstance`:

1. Look up the `TraderAgent` for `event.params.serviceId` via a
   `serviceId → multisig` helper (populated on `CreateMultisigWithAgents`
   — see §4.3). If not yet created, buffer the event or early-return
   and handle on `CreateMultisigWithAgents` ordering; in practice
   `CreateMultisigWithAgents` precedes `RegisterInstance` in standard
   flows.
2. Append `event.params.agentId.toI32()` to `TraderAgent.agentIds` if
   not already present.
3. Create an `AgentInstance` entity:
   - `id` = `concat(agentInstance, serviceId)` (bytes) — unique per
     registration.
   - `agentInstance`, `agentId`, `operator`, `registeredAt` from the
     event.
   - `service` = the `TraderAgent`.

### 4.3 Modified: `handleCreateMultisigWithAgents`

Creates the `TraderAgent` unconditionally (no `TraderService` gate) and
initializes `agentIds` as an empty array. Also updates a small
`ServiceToSafe` helper (one row per `serviceId` → multisig) that
`handleRegisterInstance` uses for O(1) lookup. The helper is internal;
not listed in §2 because it isn't part of the public schema surface.

> Alternative: drop the helper and make `AgentInstance.id` derive from
> `(agentInstance)` alone, looking up `TraderAgent` via a
> `ServiceRegistryL2` contract call. Avoid contract calls — the helper
> is cheaper.

### 4.4 Settlement / payout logic unchanged

`processMarketResolution`, `processTradeActivity`, `processRedemption`
from `predict-polymarket/src/utils.ts` port verbatim. Map caching, delta
accumulation for `Global`, idempotency via `participant.settled` —
all carry over.

`processRedemption` gains one extra line setting `source` on the
created `PayoutRedemption`. The source is determined by which handler
invoked it (`handlePayoutRedemption` on ConditionalTokens →
`CONDITIONAL_TOKENS`; `handleNegRiskPayoutRedemption` on NegRiskAdapter
→ `NEG_RISK_ADAPTER`).

### 4.5 Unchanged handlers

- `handleOrderFilled` (CTFExchange + NegRiskCTFExchange). Still does
  `TraderAgent.load(maker)` and early-returns on null. The difference
  is that `TraderAgent` now exists for all Olas agents.
- UMA `handleQuestionResolved` / `handleUmaQuestionResolved`.
- NegRisk handlers.
- `handleTokenRegistered`.
- `handleConditionPreparation`.

---

## 5. Deployment Strategy — Parallel, Not Mutate

Per plan §7, the existing `predict-polymarket` deployment stays up and
untouched until cutover:

1. New deployment with the generalized schema under a new version or
   distinct Studio name.
2. Two-start-blocks pattern (plan §7.1 item 3).
3. Parity check on cutover — run both deployments in parallel, validate
   the polystrat cohort via `agentIds_contains: [86]` on the new
   deployment matches the current deployment, wait N days before
   consumers swap.
4. Retire the old deployment.

Reindex cost is proportional to Olas-agent trade volume. A sizing check
(distinct Olas-multisig makers on `CTFExchange.OrderFilled`) runs before
cutover (plan §7.2).

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
- No free-text `label` / `note` fields on `TraderAgent` / `Bet` /
  `AgentInstance` that could be repurposed to carry server-side
  metadata informally.

Also deliberately absent (scope-reduction, not policy):

- No `ServiceClassification` / `ClassificationChange` / `ApplicationType`
  entities — deferred to a follow-up once `ApplicationClassifier`
  deploys. See plan §4.2.
- No `Funding` / `FundingDaily` / ERC-20 `Transfer` handling — plan
  §6.1.
- No `ownerEOA` / `agentEOA` fields on `TraderAgent` — plan §6.2.
- No `PolySafeCreator` data source. Its address is consumed as a
  client-side constant for `operator_in:` filtering, not indexed as
  events.

---

## 7. Review Questions

1. **`AgentInstance.id` scheme.** Proposed: `concat(agentInstance, serviceId)`
   so re-registrations of the same address under different services
   don't collide. If re-registrations within a single service matter,
   switch to `txHash + logIndex`. Flag for discussion.
2. **`ServiceToSafe` helper entity** (§4.3). Adds one small write per
   `CreateMultisigWithAgents`. Acceptable; alternative is a contract
   call from the `RegisterInstance` handler, which is slower.
3. **`TraderAgent` not renamed.** Since the entity now covers every
   Olas agent, not just polystrat or Pearl Safes, the current name is
   correct and preserves query compatibility with existing consumers.
4. **`PayoutSource` grouping with the cohort change.** Orthogonal to
   cohort work but cheap to ship together. Alternative: ship as a
   separate minor-version change. Recommendation: bundle — it's one
   enum + one field addition.
