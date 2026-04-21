# Pearl Mini Subgraph Plan — Generalized Predict-Polymarket + ApplicationClassifier

**Status:** Scoping / pre-implementation
**Target network:** Polygon mainnet (first); multi-chain later
**Last updated:** 2026-04-21

This document scopes the subgraph work required to make Pearl Mini cohort
analytics queryable (bets, outcomes, realised P&L, funding flows) while
also fixing a structural issue in the existing prediction-market indexing
stack. It replaces an earlier draft that proposed three dedicated Pearl
Mini subgraphs. That draft was superseded after review feedback — see
§10 for what changed and why.

---

## 1. Hard Constraints

These constraints are load-bearing and drive every design decision below.

### 1.1 On-chain data only

The subgraph **only indexes on-chain data**. Server-side prediction records
(the prediction server's request log: `mode`, `tool`, `tier`, per-prediction
cost, request identifiers, etc.) are out of scope and **must not be joined
with on-chain data** for privacy and regulatory reasons.

Concretely, the schema must not contain:

- Any field or entity that correlates a prediction request to a specific
  on-chain bet.
- Any shared identifier (request id, session id, timestamp-window join key)
  that would let an external consumer reconstruct that correlation.
- Any change to the prediction server to emit request metadata on-chain.

This boundary is enforced at schema review time via the "deliberately
absent" section in [`pearl-trades-schema.md`](./pearl-trades-schema.md#deliberately-absent).

### 1.2 Cohort keying

All per-agent analytics are keyed on the **Olas `serviceId`** (and,
transitively, on the multisig Safe address). No off-chain identifier is
required or used. Cohort membership (PEARL, POLYSTRAT, OTHER) is resolved
on-chain via `ApplicationClassifier` — see §4.

### 1.3 What this excludes

The following questions are **unanswerable under the current scope**:

- "Does deep-mode perform better than fast-mode for user X?" — requires
  server-side `mode` joined to on-chain bets.
- "Which tool / tier did user X use when placing this specific bet?" —
  same reason.
- "ROI by mode or by tier" — same reason.

These become answerable only if §1.1 is explicitly revisited and
approved. Until then they are intentionally excluded.

---

## 2. What Can Be Collected On-Chain (Polygon)

Pearl Mini Safes and all other Olas services are distinguishable on
Polygon via a combination of contracts that are already deployed and/or
already indexed:

- `ServiceRegistryL2` — every Olas service + multisig linkage. Already
  indexed by [`subgraphs/service-registry/`](../service-registry/) with
  no agent-id filter.
- `IdentityRegistryBridger` — ERC-8004 agent identity + agent wallet
  (via `AgentWalletSet`). Already indexed by `service-registry`.
- `PolySafeCreator` (`0xA749f605D93B3efcc207C54270d83C6E8fa70fF8`) — Pearl
  Mini-specific. Emits the owner EOA (Privy-derived wallet). Not
  currently indexed anywhere.
- `ApplicationClassifier` (via `AgentClassificationProxy`) — on-chain
  classification per `serviceId`. See §4.

From Polygon on-chain events, the following is derivable per service /
Safe:

| Metric | Source |
|---|---|
| Full Olas service set | `ServiceRegistryL2.CreateService` (via `service-registry/`) |
| Multisig ↔ serviceId link | `ServiceRegistryL2.CreateMultisigWithAgents` (via `service-registry/`) |
| Agent EOA + ERC-8004 identity | `IdentityRegistryBridger.AgentWalletSet` (via `service-registry/`) |
| Service termination | `ServiceRegistryL2.TerminateService` (via `service-registry/`) |
| Pearl Mini owner EOA (Privy) | `PolySafeCreator.*` — **not currently indexed** |
| Cohort classification | `ApplicationClassifier.ServiceApplicationTypeUpdated(serviceId, appType)` — **contract not yet deployed** |
| Trade history per Safe | `CTFExchange.OrderFilled` + `NegRiskCTFExchange.OrderFilled` |
| Position state per Safe | ConditionalTokens — `PositionSplit` / `PositionMerge` / ERC-1155 transfers |
| Redemption / payout per Safe | `ConditionalTokens.PayoutRedemption` + `NegRiskAdapter.PayoutRedemption` (see §6) |
| Wallet-level funding flows | USDC + MATIC `Transfer` events, cohort-scoped (only for classified-PEARL services) |
| Realised P&L per Safe | Σ redemption payouts − Σ `OrderFilled` buy cost, attributed at resolution |

---

## 3. Architecture

Single generalized subgraph instead of a dedicated Pearl Mini subgraph.

### 3.1 Generalize `subgraphs/predict/predict-polymarket/`

`predict-polymarket` currently filters via `TraderService` (created only
when `RegisterInstance.agentId == 86`, i.e. polystrat). That filter is
removed. In its place:

1. **Index `ApplicationClassifier`** as a new data source.
   `ServiceApplicationTypeUpdated(serviceId, appType)` populates a
   `ServiceClassification` entity, with every change recorded as an
   immutable `ClassificationChange` row (audit trail, answers "when was
   this service reclassified, by whom").
2. **Every Olas agent with trade activity becomes a `TraderAgent`.** The
   entity gains a `classification: ServiceClassification` link resolved
   via `serviceId`. Clients filter with
   `traderAgents(where: { classification_: { appType: PEARL } })`.
3. **Index `PolySafeCreator`** as a narrow data source purely to capture
   Pearl Mini owner EOAs. Populates `ownerEOA` + `agentEOA` on
   `TraderAgent` when the classification resolves to `PEARL`. For non-
   PEARL services, these fields remain null.
4. **Funding flows are cohort-scoped.** USDC + wMATIC `Transfer` handlers
   attribute only when the counterparty side is a known PEARL Safe / owner
   EOA / agent EOA. Non-PEARL services don't create `Funding` entities —
   keeps indexing cost proportional to the Pearl Mini cohort, not to
   total ERC-20 volume on Polygon.

The full schema delta vs the current `predict-polymarket` is in
[`pearl-trades-schema.md`](./pearl-trades-schema.md). Handler logic for
settlement, payout redemption, daily profit attribution, and NegRisk
handling carries over unchanged — only the cohort gate, the classifier
handler, the `PolySafeCreator` handler, and the funding handlers are new.

### 3.2 `service-registry/` stays the source of truth for service enumeration

`service-registry/` on Polygon (start block `41783952`) already captures
every `CreateService`, `CreateMultisigWithAgents`, `RegisterInstance`,
`TerminateService`, plus the full `IdentityRegistryBridger` surface
(`AgentWalletSet`, `MetadataSet`, `ServiceAgentLinked`). There is no
benefit to duplicating any of that in the trades subgraph. The
generalized predict-polymarket uses `service-registry` as the authoritative
enumeration and focuses on *what services do* on Polymarket.

### 3.3 No dedicated Pearl Mini cohort subgraph

The earlier draft proposed `pearl-cohort/` for cohort enumeration and
`pearl-trades/` for trade-side analytics. Both are dropped:

- Cohort enumeration is already in `service-registry/` + (soon) the
  `PolySafeCreator` data source added to the generalized subgraph.
- Trade-side analytics are in the generalized predict-polymarket itself,
  surfaced via `classification_.appType` filtering.

The `subgraphs/pearl/` directory contains only scoping docs (this file
and the schema delta). No Pearl-specific subgraph will be shipped.

---

## 4. Classification: Why `ApplicationClassifier`

The cohort label — PEARL, POLYSTRAT, OTHER — is read from the on-chain
`ApplicationClassifier` contract, not from heuristics in subgraph
handlers.

### 4.1 Contract shape

`ApplicationClassifier.sol` (in `valory-xyz/autonolas-registries/contracts/utils/`):

- `mapServiceIdStatuses: serviceId → ApplicationType {NON_EXISTENT, PEARL, OTHER}`
- Maintainer-gated `recordApplicationType(serviceId, appType)`
- Emits `ServiceApplicationTypeUpdated(serviceId, appType)`
- UUPS-upgradeable behind `AgentClassificationProxy` — enum can grow
  (PEARL_MINI, WILDCARD, …) without changing the proxy address or event
  signature.

### 4.2 Why this wins over the alternatives

| Approach | Source of truth | Registration-time contract change? | Trust model | Reclassification | Recommended |
|---|---|---|---|---|---|
| `ApplicationClassifier` | Dedicated contract | No | Maintainer-attested | Yes (recordApplicationType can be re-called) | **Primary** |
| ERC-8004 metadata key (`application_type`) | Identity NFT metadata | Yes (ServiceManager / IdentityRegistryBridger input) | Self-attested unless whitelist added | Depends on metadata mutability | Optional future layer |
| Handler heuristic (e.g. `agentId == 86` ⇒ POLYSTRAT) | Subgraph code | No | Hardcoded rules | Requires subgraph redeploy | Fallback only |
| Off-chain label list | Each consumer | No | Consumer-attested | Per consumer | Not considered |

The decisive properties of the classifier approach:

1. **Decoupled from registration.** `ServiceManager` and
   `IdentityRegistryBridger` don't need to change. That's a multi-quarter
   contract conversation avoided.
2. **One source of truth per chain.** Clients don't guess.
3. **Adding a cohort is a contract upgrade + subgraph schema update**, not
   a scavenger hunt through handler code.
4. **Full audit trail via events.** `ClassificationChange` in the subgraph
   captures every reclassification, answering "when did this service
   become PEARL" and "who classified it."

### 4.3 Is classification actually decidable?

For current cohorts, yes — from on-chain signals alone:

- **PEARL** ⇔ service whose multisig was emitted by `PolySafeCreator`
  (`0xA749f605...`). Deterministic on-chain.
- **POLYSTRAT** ⇔ service registered via `RegisterInstance` with
  `agentId == 86`. Deterministic on-chain.
- **OTHER** ⇔ the complement.

A one-time off-chain backfill script walks the existing service set,
applies these rules, and submits batched `recordApplicationType` txs. See
§7. Future cohorts may require more subjective judgment; the classifier
accommodates that natively since the maintainer can encode any rule they
choose.

### 4.4 ERC-8004 metadata: optional future layer

If the ERC-8004 standard grows an `application_type` metadata key (set
via `IdentityRegistryBridger.MetadataSet`), the subgraph can read it in
parallel as a secondary signal. Resolution rule on conflict:
`ApplicationClassifier` wins. This gives us optionality without blocking
on the standards discussion — adding the secondary read is a small
follow-up, not a redesign.

---

## 5. ROI / Performance Measurement — How the Subgraph Answers It

Unchanged from the superseded plan; repeated here because it's the most
common product question about this subgraph.

- **Forgotten / unclaimed settlements.** ROI is computed at **resolution
  time**, not at payout time. When UMA resolves a market, the handler
  iterates every `MarketParticipant` in that market and sets
  `expectedPayout` from each Safe's outcome-share balances, regardless of
  whether the Safe has redeemed. `PayoutRedemption` is tracked separately
  as `totalPayout` — the difference between `totalExpectedPayout` and
  `totalPayout` surfaces unclaimed winnings.
- **Bets on far-future events.** `MarketParticipant.settled == false`
  represents an open position. `outcomeShares0`/`outcomeShares1` give
  the current paper value at any outcome-token price; `expectedPayout` is
  only set at resolution. Dashboards should expose two ROI views:
  **realised ROI** (settled subset only) and **open position value**
  (mark-to-shares paper value). Conflating them hides the distinction
  between measured and speculative performance.

Resolution iteration uses `Question.participants.load()` with Map-based
caching for `TraderAgent` and `DailyProfitStatistic` entities — same
pattern as the current `predict-polymarket/src/utils.ts`.

---

## 6. NegRisk Coverage

Polymarket's multi-outcome ("NegRisk") markets route redemptions through a
separate `NegRiskAdapter` contract rather than directly through
`ConditionalTokens`. Trades still pass through the CTF Exchange variants,
so `OrderFilled` captures both market types, but payout tracking must
index both adapters:

- `ConditionalTokens.PayoutRedemption` — vanilla binary markets.
- `NegRiskAdapter.PayoutRedemption` — multi-outcome markets.

Any P&L calculation that reads only `ConditionalTokens.PayoutRedemption`
systematically under-counts. The schema delta adds a `PayoutSource` enum
on `PayoutRedemption` to distinguish the two adapters in the audit
trail. See [`pearl-trades-schema.md`](./pearl-trades-schema.md).

---

## 7. Implementation Path

### 7.1 Sequence

1. **Ship `ApplicationClassifier` on Polygon.** Deployment address and
   start block are the hard dependency for every subgraph step below.
   Contracts are in `valory-xyz/autonolas-registries/contracts/utils/` and
   under review. No subgraph work begins until this lands.
2. **Write + run the backfill script.** Walk the existing Olas service
   set (via the public `service-registry` subgraph or an archive node),
   apply the heuristics in §4.3 to assign `PEARL`/`POLYSTRAT`/`OTHER`,
   and submit batched `recordApplicationType` txs from the maintainer
   key. One-time cost per chain. Owned by whoever operates the
   maintainer key.
3. **Stand up the generalized predict-polymarket deployment in
   parallel.** Do not mutate the current polystrat-only deployment.
   Use either the existing `predict-polymarket` subgraph name with a
   new version, or a distinct name (e.g., `autonolas-predict-polygon`)
   during transition.
   - Two-start-blocks pattern still applies: market-creation sources
     (`ConditionPreparation`, UMA `QuestionInitialized`, `TokenRegistered`)
     from ~Oct 2025; trade / redemption sources (`OrderFilled`,
     `PayoutRedemption`, NegRisk `PayoutRedemption`, `PolySafeCreator`,
     `ApplicationClassifier`) from a start block that covers all cohorts'
     activity (not later than the earliest known Pearl Mini Safe
     creation).
4. **Cut consumers over once caught up.** Validate parity on the
   polystrat cohort (queries that worked against the old deployment
   should return equivalent results filtered by
   `classification_.appType: POLYSTRAT`). Then retire the old
   deployment.

### 7.2 Reindex cost

The reindex concern raised during review — "weeks to reindex if we
change the filter" — is bounded but not zero. Two notes:

- **Handler load is proportional to Olas-agent trade volume, not total
  Polymarket volume.** `TraderAgent.load(maker)` already runs on every
  `OrderFilled`; removing the polystrat filter just means more lookups
  result in "found, process" vs "not found, return." Processing cost
  scales with the new cohort's activity.
- **Sizing check before committing.** Before cutover, count distinct
  makers on `CTFExchange.OrderFilled` that are also Olas multisigs.
  That's the real upper bound. Almost certainly modest, but worth
  measuring rather than assuming.

### 7.3 Enum extension discipline

Adding a new `ApplicationType` value requires a UUPS upgrade of
`ApplicationClassifier` **and** a schema update in the subgraph in
lockstep. If the subgraph sees an unknown numeric enum value, it should
record it under a sentinel (e.g., `OTHER` with a log warning) rather
than drop the event. A contributing note in the subgraph's CLAUDE.md (to
be added with implementation) captures this.

---

## 8. What Additionally Needs to Be Done (Outside the Subgraph)

Tracking list of non-subgraph dependencies:

1. **`ApplicationClassifier` deployment on Polygon.** Address + start
   block. Blocks everything.
2. **Per-chain classifier deployment strategy.** Pearl Mini is Polygon-
   only today; polystrat runs on Gnosis (Omen) and Polygon. Confirm
   whether Gnosis (and any future chain with trade activity to classify)
   gets its own `ApplicationClassifier` deployment, and on what
   timeline. The generalized predict-omen variant of this work reuses the
   same architecture once the Gnosis deployment exists.
3. **Backfill script + maintainer key ops.** Owned outside this repo.
   Needs: runbook, responsibility, post-deployment cadence for
   classifying new services (SLA target, monitoring).
4. **`PolySafeCreator` event signature + deployment block.** Needed to
   write the subgraph manifest data source. Pull from the deployed
   contract ABI once available.
5. **Reindex sizing check.** Count distinct Olas-multisig makers on
   `CTFExchange.OrderFilled` before committing to cutover timing.
6. **ERC-8004 `application_type` metadata key** (optional / later). If
   the standards discussion progresses, add a secondary read in the
   subgraph. Classifier wins on conflict.
7. **Tempo stance decision** (see §9). Separate policy question; does
   not block the generalized subgraph.

---

## 9. Deferred: Tempo Channel Data

MPP payment-channel events on the Tempo chain (`ChannelOpened`, deposits,
voucher claims, settlements) are technically on-chain. The concern is a
second-order privacy exposure: joining a channel to a Safe or EOA
reconstructs a "user X spent $Y on predictions at effort-tier Z"
attribution that §1.1 is specifically designed to prevent.

**Provisional stance:** index Tempo channel events if/when approved, but
keep them **unjoined** with Safe / EOA data. Channel-level aggregates
only:

- Total channels, total revenue.
- Spend per effort tier, inferred from channel price points.
- No schema field links a channel owner to a Safe / EOA.

Not implemented until §1.1 is re-confirmed as compatible with this
design, and until an explicit check for re-identifiability at the
inferred-tier level passes (if only one user ever hits a given price
point in a given window, "aggregate" becomes re-identifying).

---

## 10. What Changed From the Earlier Draft, and Why

The first version of this plan (commits before the rewrite) proposed
three dedicated Pearl Mini subgraphs: `pearl-cohort`, `pearl-trades`,
and a deferred `pearl-tempo`. Review feedback surfaced two structural
problems with that approach:

1. **`pearl-cohort` was duplicative.** `service-registry/` already
   indexes every Olas service + multisig + ERC-8004 identity on Polygon
   without any agent-id filter. A dedicated Pearl Mini cohort subgraph
   would have reproduced ~95% of that work for one extra field
   (`PolySafeCreator` owner EOA), which is better added as a narrow data
   source to the trades subgraph directly.
2. **`pearl-trades` as a clone of `predict-polymarket` forks the
   schema per cohort.** The right answer is to generalize
   `predict-polymarket` once — track every Olas agent on Polymarket —
   and attach a cohort label, rather than maintain N parallel per-cohort
   subgraphs that will drift over time.

Separately, an on-chain classification primitive (`ApplicationClassifier`)
is already under review in `autonolas-registries`. Taking a dependency
on that primitive, rather than encoding cohort rules in subgraph
handler code, moves the decision to one auditable place, works across
chains, and makes adding future cohorts (WILDCARD, …) a contract action
rather than a subgraph redeploy.

This rewrite adopts both corrections.

---

## 11. Out of Scope (recap)

Repeated because the boundary must not drift:

- Linking on-chain activity to server-side prediction requests.
- Server-side data export of any kind (request id, mode, tool, cost).
- Request → bet correlation in any form — no schema, no time-window
  join, no shared identifier.
- ROI-by-mode / ROI-by-tier. Requires the server-side join above.

Tempo channel data is deferred (§9), not out of scope.

---

## 12. Open Questions

- **`ApplicationClassifier` deployment address + start block on Polygon.**
  Blocks manifest authoring.
- **Per-chain deployment plan and timeline.** Gnosis (for predict-omen
  generalization), future chains.
- **`PolySafeCreator` event signature + deployment block.**
- **Backfill script ownership.** Who writes it, who runs it, where does
  it live.
- **Maintainer process.** Who holds the key, response SLA, runbook.
- **ERC-20 `Transfer` volume at scale.** USDC + wMATIC `Transfer` events
  are high-frequency on Polygon. Even with cohort-scoped attribution,
  the indexer still receives every event. If this is a performance
  problem at beta scale, revisit — options include a separate funding-
  only subgraph, balance-snapshot pattern, or upstream filtering via
  network-level event filters where supported.
- **Tempo stance confirmation** (§9).

---

## Related Documents

- [`pearl-trades-schema.md`](./pearl-trades-schema.md) — proposed schema
  delta vs current `predict-polymarket/schema.graphql`.
- [`subgraphs/predict/predict-polymarket/`](../predict/predict-polymarket/) —
  existing deployment this work generalizes.
- [`subgraphs/service-registry/`](../service-registry/) — upstream source
  of truth for service enumeration.
- `valory-xyz/autonolas-registries/contracts/utils/ApplicationClassifier.sol` — classification contract under review.
- `valory-xyz/autonolas-registries/contracts/utils/ApplicationClassifierProxy.sol` — UUPS proxy for the classifier.
- `valory-xyz/autonolas-registries/contracts/8004/IdentityRegistryBridger.sol` — ERC-8004 identity registry (optional future metadata-based classification source).
