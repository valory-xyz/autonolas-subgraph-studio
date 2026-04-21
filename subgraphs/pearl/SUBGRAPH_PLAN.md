# Pearl Mini Subgraph Plan — Generalized Predict-Polymarket

**Status:** Scoping / pre-implementation
**Target network:** Polygon mainnet (first); other chains later
**Last updated:** 2026-04-21

This document scopes the subgraph work required to make Pearl Mini cohort
analytics queryable (bets, outcomes, realised P&L) while also fixing a
structural issue in the existing prediction-market indexing stack. It
replaces two earlier drafts — see §9 for what changed and why.

---

## 1. Hard Constraints

Load-bearing constraints that drive every design decision below.

### 1.1 On-chain data only

The subgraph **only indexes on-chain data**. Server-side prediction
records (the prediction server's request log: `mode`, `tool`, `tier`,
per-prediction cost, request identifiers) are out of scope and **must
not be joined with on-chain data** for privacy and regulatory reasons.

Concretely, the schema must not contain:

- Any field or entity that correlates a prediction request to a specific
  on-chain bet.
- Any shared identifier (request id, session id, timestamp-window join
  key) that would let an external consumer reconstruct that correlation.
- Any change to the prediction server to emit request metadata on-chain.

This boundary is enforced at schema review time via the "deliberately
absent" section in [`pearl-trades-schema.md`](./pearl-trades-schema.md).

### 1.2 Cohort keying

All per-agent analytics are keyed on the **Olas `serviceId`** (and,
transitively, on the multisig Safe address). No off-chain identifier is
required or used. Cohort membership is resolved **client-side** by
filtering on `Multisig.agentIds` and `Multisig.operators` via the
`multisig_:` link on `TraderAgent` — see §3. On-chain classification
(via `ApplicationClassifier`) is a documented future enhancement, not
part of the current scope.

### 1.3 What this excludes

- "Does deep-mode perform better than fast-mode for user X?" — requires
  server-side `mode` joined to on-chain bets.
- "Which tool / tier did user X use when placing this specific bet?" —
  same reason.
- "ROI by mode or by tier" — same reason.

These become answerable only if §1.1 is revisited and approved.

---

## 2. What Can Be Collected On-Chain (Polygon)

All actors and events below are indexed today (or soon will be) across
this repo's existing subgraphs:

| Data | Source | Indexed where |
|---|---|---|
| Full Olas service set | `ServiceRegistryL2.CreateService` | `subgraphs/service-registry/` |
| Multisig ↔ serviceId link | `ServiceRegistryL2.CreateMultisigWithAgents` | `subgraphs/service-registry/` |
| Agent registration — `(operator, serviceId, agentInstance, agentId)` | `ServiceRegistryL2.RegisterInstance` | `subgraphs/service-registry/` (full tuples); **this plan** (`agentIds` + `operators` deduplicated on `Multisig` helper, enough for cohort filtering) |
| Service termination | `ServiceRegistryL2.TerminateService` | `subgraphs/service-registry/` |
| Agent EOA + ERC-8004 identity | `IdentityRegistryBridger.AgentWalletSet` | `subgraphs/service-registry/` |
| Trade history per Safe | `CTFExchange.OrderFilled` + `NegRiskCTFExchange.OrderFilled` | **this plan** (currently polystrat-filtered in `predict-polymarket/`) |
| Position state per Safe | ConditionalTokens — `PositionSplit` / `PositionMerge` / ERC-1155 transfers | n/a (not currently needed) |
| Redemption / payout per Safe | `ConditionalTokens.PayoutRedemption` + `NegRiskAdapter.PayoutRedemption` | **this plan** |
| Realised P&L per Safe | Σ redemption payouts − Σ `OrderFilled` buy cost, attributed at resolution | **this plan** (existing logic, unchanged) |

Funding flows (USDC / MATIC balances over time) are **not** indexed as
explicit entities in this plan — see §6 for why. Any client needing them
can derive them from standard ERC-20 indexing against a Safe address.

---

## 3. Architecture

One generalized subgraph, not a dedicated Pearl Mini one.

### 3.1 Generalize `subgraphs/predict/predict-polymarket/`

`predict-polymarket` currently filters via `TraderService` (created only
when `RegisterInstance.agentId == 86`, i.e. polystrat). That filter is
removed. The generalization adds these concrete pieces:

1. **`Multisig` helper entity** — a minimal index of every Olas multisig
   on Polygon, keyed on the multisig address. Populated from
   `ServiceRegistryL2.CreateMultisigWithAgents` (creates the row with
   `serviceId`) and `RegisterInstance` (appends to `agentIds` and
   `operators` as deduplicated arrays). Carries only the service-
   registration metadata needed for cohort filtering and lazy
   `TraderAgent` creation; full registration records (`(agentInstance,
   agentId, operator)` tuples with timestamps) stay in
   `subgraphs/service-registry/`.
2. **`TraderAgent` is created lazily on first trade**, not on service
   registration. In `handleOrderFilled`, we look up the maker in the
   `Multisig` index: if absent, early-return (non-Olas trader); if
   present and `TraderAgent` doesn't yet exist, create it and link it
   back to the `Multisig`. This keeps `TraderAgent` semantically
   accurate — an entity only exists for services that have actually
   traded — and avoids bloating the subgraph with rows for every Olas
   service on Polygon.
3. **Cohort filtering goes through the `Multisig` link.** Queries use
   `traderAgents(where: { multisig_: { agentIds_contains: [86] } })`
   for polystrat, and `multisig_: { operators_contains: ["0xA749f605..."] }`
   for Pearl Mini. No cohort labels stored on `TraderAgent` itself.
4. **Keep all existing trade / settlement / payout logic unchanged.**
   `processTradeActivity`, `processMarketResolution`, `processRedemption`,
   NegRisk handling, daily-profit attribution, Map caching — all carry
   over verbatim. Handlers that materially change:
   `handleCreateMultisigWithAgents` (creates `Multisig`, not
   `TraderAgent`); `handleRegisterInstance` (accumulates on `Multisig`);
   `handleOrderFilled` (lazy-creates `TraderAgent` on first trade).

The full schema delta vs the current `predict-polymarket` is in
[`pearl-trades-schema.md`](./pearl-trades-schema.md).

### 3.2 `service-registry/` stays the source of truth for service enumeration

`service-registry/` on Polygon (start block `41783952`) already captures
every `CreateService`, `CreateMultisigWithAgents`, `RegisterInstance`,
`TerminateService`, plus the full `IdentityRegistryBridger` surface. The
generalized predict-polymarket does not duplicate that work; it adds only
the fields needed for trade-side cohort filtering (`agentIds` on the
`Multisig`) so trade queries don't have to cross-reference
`service-registry/` for every filter.

### 3.3 No dedicated Pearl Mini cohort subgraph

Earlier drafts proposed `pearl-cohort/` / `pearl-trades/` / `pearl-tempo/`.
All dropped:

- Cohort enumeration is in `service-registry/`.
- Trade-side analytics are in the generalized predict-polymarket.
- Pearl-specific cohort filtering is client-side (see §4).

The `subgraphs/pearl/` directory contains only scoping docs. No
Pearl-specific subgraph will be shipped.

---

## 4. Cohort Filtering — Client-Side

### 4.1 Current approach: via the `Multisig` link

All cohort filtering happens query-side through the `Multisig` helper:

```graphql
# Polystrat — the current implicit filter, explicit
traderAgents(where: { multisig_: { agentIds_contains: [86] } }) { ... }

# Pearl Mini — services registered via PolySafeCreator as operator
traderAgents(
  where: { multisig_: { operators_contains: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }
) { ... }

# Combined filters also work
traderAgents(
  where: {
    multisig_: {
      agentIds_contains: [86],
      operators_contains: [...]
    }
  }
) { ... }
```

This is sufficient because `(agentIds, operators)` on `Multisig` is
the deduplicated on-chain handle for cohort filtering. For current
cohorts:

- Polystrat ⇔ `agentId == 86` appears in the service's registrations.
- Pearl Mini ⇔ `operator == PolySafeCreator` (address `0xA749f605...`)
  — the `RegisterInstance` event for a Pearl Mini service has its
  `operator` parameter equal to the PolySafeCreator contract.

Clients maintain the address/agent-id → label mapping as a small local
constant. Adding a new cohort = add one line on the client, no subgraph
change. Full `(agentInstance, agentId, operator)` registration tuples,
with timestamps, live in `subgraphs/service-registry/` — clients join
there if they need per-instance detail beyond cohort membership.

### 4.2 Future: on-chain classification via `ApplicationClassifier`

`ApplicationClassifier` (`valory-xyz/autonolas-registries/contracts/utils/`)
is an on-chain contract being reviewed that stores
`serviceId → ApplicationType {NON_EXISTENT, PEARL, OTHER}` behind a UUPS
proxy. When deployed, it will let the subgraph surface a maintainer-
attested cohort label directly, reducing client-side mapping maintenance
and making classification auditable via events.

This is **not part of current subgraph scope.** It becomes a follow-up
once the contract deploys:

- Add `ServiceClassification` + `ClassificationChange` entities.
- Add a classifier data source (`ServiceApplicationTypeUpdated`).
- Add a link on `Multisig` (or on `TraderAgent`) so queries can filter
  by `classification_.appType: PEARL` alongside the existing
  `multisig_: { agentIds_contains / operators_contains }` paths.

Existing clients using the `multisig_:` filter patterns continue working
unchanged after this is added. The paths coexist.

ERC-8004 metadata (via `IdentityRegistryBridger.MetadataSet` with an
`application_type` key) remains a possible alternative secondary signal,
flagged for a later standards-alignment discussion. Not on the critical
path.

---

## 5. ROI / Performance Measurement

Unchanged from the existing `predict-polymarket` implementation:

- **Forgotten / unclaimed settlements.** ROI is computed at **resolution
  time**, not at payout time. When UMA resolves a market, the handler
  iterates every `MarketParticipant` in that market and sets
  `expectedPayout` from each Safe's outcome-share balances, regardless
  of whether the Safe has redeemed. `PayoutRedemption` is tracked
  separately as `totalPayout` — the difference between
  `totalExpectedPayout` and `totalPayout` surfaces unclaimed winnings.
- **Bets on far-future events.** `MarketParticipant.settled == false`
  represents an open position. `outcomeShares0`/`outcomeShares1` give
  the paper value at any outcome-token price. Dashboards should expose
  **realised ROI** (settled subset) and **open position value**
  (mark-to-shares) as separate metrics.

See [`subgraphs/predict/predict-polymarket/CLAUDE.md`](../predict/predict-polymarket/CLAUDE.md)
for the full settlement / caching / idempotency architecture — the
generalization does not change any of it.

---

## 6. Out of Scope (Explicit)

### 6.1 Funding flows not indexed as entities

USDC / MATIC `Transfer` events touching cohort addresses are not indexed
in this subgraph. Rationale:

- High-frequency events; cohort-scoped attribution still forces the
  indexer to receive every Transfer on the network.
- Any funding question ("first deposit, top-ups, withdrawals") is
  answerable off-chain against a Safe address by a general-purpose ERC-20
  indexer (Dune, archive RPC, purpose-built subgraph later).
- Keeps the generalization focused on trade-side analytics.

If this later needs to ship on-chain (sub-second dashboards, specific
product need), a dedicated funding subgraph is the right place — not
mixed into trades.

### 6.2 No `PolySafeCreator` data source in this subgraph

Owner EOA (Privy wallet) capture is not part of current scope. It would
only be needed for funding-flow attribution, which is itself out of
scope per §6.1. If funding ever lands on-chain, revisit.

The `operators` array on `Multisig` already answers "was this Safe
registered via PolySafeCreator?" via `operators_contains: [...]`,
which is the cohort-filter use case.

### 6.3 Server-side data (reiterated)

- No linking on-chain activity to prediction requests.
- No server-side data export (request id, mode, tool, cost).
- No request → bet correlation — no schema, no time-window join, no
  shared identifier.
- No ROI-by-mode / ROI-by-tier.

### 6.4 Deferred: Tempo channel data

MPP payment-channel events on Tempo are technically on-chain. A
provisional stance (channel-level aggregates only, no Safe/EOA join) is
captured separately and needs policy sign-off before any implementation.
Not part of this plan.

---

## 7. Implementation Path

### 7.1 Sequence

1. **Schema + handler edits on a branch of `predict-polymarket/`.**
   Remove cohort gate; add `Multisig` helper + lazy `TraderAgent`
   creation in `handleOrderFilled`; add `PayoutSource` discriminator
   on `PayoutRedemption` (orthogonal to cohort work but cheap to add
   in the same change — see §8).
2. **New parallel deployment.** The existing polystrat-only deployment
   stays up until cutover. Either a new version on the existing subgraph
   name or a distinct Studio name during transition.
3. **Two-start-blocks pattern.** Market-creation sources
   (`ConditionPreparation`, UMA `QuestionInitialized`, `TokenRegistered`)
   from the earlier of (a) current start block or (b) a point early
   enough that every cohort's trading history is covered. Trade /
   redemption sources start from the earliest Olas-agent trading block,
   not the current polystrat-only start block.
4. **Parity check on cutover.** Run both deployments in parallel. Query
   the polystrat cohort on both (old deployment directly, new via
   `agentIds_contains: [86]`) and assert equivalence for N days before
   switching consumers.
5. **Retire the old deployment.**

### 7.2 Reindex cost

Handler load is proportional to Olas-agent trade volume, not total
Polymarket volume. `TraderAgent.load(maker)` already runs on every
`OrderFilled`; removing the cohort gate just means more lookups result
in "found, process" rather than "not found, return." Before cutover:
measure distinct Olas-multisig makers on `CTFExchange.OrderFilled` to
size the real upper bound. Almost certainly modest.

---

## 8. What Additionally Needs to Be Done (Outside the Subgraph)

Short list for this scope:

1. **`PolySafeCreator` event ABI / deployment block confirmation.** Only
   needed for the §4 client-side filter — consumers need the contract
   address (`0xA749f605...`) and should verify it's current.
2. **Reindex sizing check.** Count distinct Olas-multisig makers on
   `CTFExchange.OrderFilled` before committing to cutover timing.
3. **Client address/label map.** Whoever consumes this subgraph
   (dashboards, analytics scripts) maintains a local constant mapping
   `agentId` values and known `operator` addresses to human-readable
   cohort names. Pearl Mini team owns the Pearl Mini entry; polystrat
   team owns the polystrat entry; etc.

Future-enhancement dependencies (not blocking this work):

4. **`ApplicationClassifier` deployment** (per chain). When it lands,
   follow-up PR adds the classifier data source + schema.
5. **ERC-8004 `application_type` metadata key** (optional standards-
   alignment work).
6. **Tempo stance confirmation** (independent).

---

## 9. What Changed From Earlier Drafts

This plan has been through three prior revisions. All superseded.

**First draft** proposed three dedicated Pearl Mini subgraphs
(`pearl-cohort`, `pearl-trades`, deferred `pearl-tempo`). Dropped after
review:

- `pearl-cohort` was ~95% duplicative of `service-registry/`.
- `pearl-trades` as a per-cohort clone of `predict-polymarket` would
  have forked schemas per cohort and drifted over time.

**Second draft** centered the design around on-chain classification via
`ApplicationClassifier`, with Pearl-specific enrichment
(`PolySafeCreator` data source, `Funding` / `FundingDaily` entities,
owner EOA tracking). Dropped after review:

- The classifier is under review but not deployed; making the subgraph
  depend on it for basic cohort filtering gates the ship on unrelated
  work.
- Funding flows don't need to live in the trade-side subgraph —
  off-chain reconstruction against the Safe address is viable.
- The Privy owner EOA isn't necessary when funding flows aren't indexed.

**Third draft** added an `AgentInstance` entity (one row per
`RegisterInstance` event, carrying the full tuple) and `agentIds` on
`TraderAgent`. `TraderAgent` was still created at service registration,
which made every Olas service on Polygon a `TraderAgent` — semantically
wrong, since most services never trade. Also duplicated service-level
data that already lives in `subgraphs/service-registry/`.

**Current draft** introduces a minimal `Multisig` helper entity that
carries only the cohort-filter metadata (`agentIds`, `operators` as
deduplicated arrays) needed inside this subgraph. Full registration
records stay in `service-registry/`. `TraderAgent` is created lazily
on first trade — so the name remains accurate (entities only exist for
services that have actually traded). Classifier is still a future
follow-up that leaves existing clients unchanged when it lands.

---

## 10. Open Questions

- **Reindex sizing before cutover** — see §7.2.
- **Client maintenance of the address/label map** — who owns the
  canonical list, where it lives (likely in each consumer's repo as a
  small constant; not a subgraph concern).
- **`PolySafeCreator` address stability** — if it gets re-deployed or
  upgraded, client maps need to update. Flag for consumers.
- **Tempo stance confirmation** (deferred, §6.4).

---

## Related Documents

- [`pearl-trades-schema.md`](./pearl-trades-schema.md) — proposed schema
  delta vs current `predict-polymarket/schema.graphql`.
- [`subgraphs/predict/predict-polymarket/`](../predict/predict-polymarket/) —
  existing deployment this work generalizes.
- [`subgraphs/service-registry/`](../service-registry/) — upstream source
  of truth for service enumeration.
- `valory-xyz/autonolas-registries/contracts/utils/ApplicationClassifier.sol` — classification contract under review (future enhancement).
- `valory-xyz/autonolas-registries/contracts/8004/IdentityRegistryBridger.sol` — ERC-8004 identity registry (potential future metadata-based classification source).
