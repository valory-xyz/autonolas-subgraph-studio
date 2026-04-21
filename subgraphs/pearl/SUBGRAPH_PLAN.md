# Pearl Mini Subgraph Plan

**Status:** Scoping / pre-implementation
**Target network:** Polygon mainnet
**Last updated:** 2026-04-21

This document scopes the subgraph work required to support analytics for the
Pearl Mini cohort (Olas/Autonolas Pearl Mini Safes trading on Polymarket).
It records the constraints we must honour, the data that can be collected
on-chain, the proposed subgraph architecture, and the open questions that
need a policy decision before implementation.

---

## 1. Hard Constraints

Before proposing anything, the following constraints are load-bearing and
must be reflected in every downstream design decision.

### 1.1 On-chain data only

The subgraph **only indexes on-chain data**. Server-side prediction records
(the prediction server's request log: `mode`, `tool`, `tier`, per-prediction
cost, request identifiers, etc.) are out of scope and **must not be joined
with on-chain data** for privacy and regulatory reasons.

Concretely, the subgraph must not contain:

- Any schema field or entity that correlates a prediction request to a
  specific on-chain bet.
- Any shared identifier (request id, session id, timestamp-window join key)
  that would let an external consumer reconstruct that correlation.
- Any change to the prediction server to emit request metadata on-chain.

### 1.2 Cohort keying

All per-user analytics are keyed on the **PolySafe address** (or on the
owner EOA / agent EOA, both of which are derivable from on-chain events —
see §3). No off-chain identifier (user id, email, wallet label) is required
or used.

### 1.3 What this excludes

The following questions are **unanswerable under the current scope**:

- "Does deep-mode perform better than fast-mode for user X?" — requires
  the server-side `mode` field joined to on-chain bets.
- "Which tool / tier did user X use when placing this specific bet?" —
  same reason.
- "ROI by mode or by tier" — same reason.

These may become answerable later if a dedicated policy decision approves
joining server-side data to on-chain cohort data. Until that happens they
are intentionally excluded.

---

## 2. What Can Be Collected On-Chain (Polygon)

Pearl Mini Safes are uniquely identifiable on Polygon without access to any
off-chain data:

- Every Pearl Mini PolySafe is produced by `PolySafeCreator`
  (`0xA749f605D93B3efcc207C54270d83C6E8fa70fF8`).
- Each Safe is paired with an Olas service (`ServiceRegistryL2`) and an
  ERC-8004 identity NFT (`IdentityRegistryBridger`).
- `PolySafeCreator` emits the owner EOA (Privy-derived wallet).
  `IdentityRegistryBridger.AgentWalletSet(agentId, wallet)` binds the agent
  EOA. Both EOAs are recoverable from events alone.

From Polygon on-chain events, the following is derivable per Safe:

| Metric | Source |
|---|---|
| Pearl Mini Safe set | `PolySafeCreator.*` events |
| Owner EOA + agent EOA per Safe | `PolySafeCreator` (owner) + `IdentityRegistryBridger.AgentWalletSet` (agent) |
| Service created per Safe | `ServiceRegistryL2.CreateService` |
| Service terminated per Safe | `ServiceRegistryL2.TerminateService` (clear-data flow tracking) |
| ERC-8004 agent identity per Safe | `IdentityRegistryBridger.AgentWalletSet(agentId, wallet)` |
| Wallet-level funding flows | USDC + MATIC `Transfer` events to/from owner EOA, agent EOA, Safe |
| Trade history per Safe | Polymarket CLOB — `CTFExchange.OrderFilled` and `NegRiskCTFExchange.OrderFilled` where maker or taker is the Safe |
| Position state per Safe | `ConditionalTokens` — `PositionSplit`/`PositionMerge`/ERC-1155 transfers |
| Redemption / payout per Safe | `ConditionalTokens.PayoutRedemption` **plus** `NegRiskAdapter.PayoutRedemption` (see §4.2) |
| Trading volume per Safe, rolling windows | Sum of `OrderFilled.makerAmountFilled` / `takerAmountFilled` for the Safe |
| Realised P&L per Safe | Σ (CTF `PayoutRedemption.payout` + NegRiskAdapter redemption payout) − Σ `OrderFilled` buy cost |
| Per-market participation / open positions | Derived from outcome-token share balances per Safe × condition |

This is precisely the metric surface the existing predict-polymarket
subgraph produces for the polystrat agent cohort — only the cohort filter
differs.

---

## 3. Blueprint: Reuse the Existing Polymarket Subgraph

The closest precedent in this repository is
[`subgraphs/predict/predict-polymarket/`](../predict/predict-polymarket/).
It already indexes Polygon CTF Exchange order fills, UMA oracle resolutions,
ConditionalTokens redemptions, and NegRisk redemptions, and it computes
resolution-time expected-payout and day-level P&L per agent. The full
behaviour is documented in
[`subgraphs/predict/predict-polymarket/CLAUDE.md`](../predict/predict-polymarket/CLAUDE.md).

The substantive deltas for Pearl Mini are:

1. **Cohort gate.** `predict-polymarket` filters via
   `ServiceRegistryL2.RegisterInstance` with `agentId == 86`. Pearl Mini
   must filter via `PolySafeCreator`-emitted Safes (plus the paired
   service/identity registrations).
2. **Funding flows.** `predict-polymarket` does not track wallet funding.
   Pearl Mini needs USDC/MATIC `Transfer` indexing for the owner EOA,
   agent EOA, and Safe to answer first-deposit / top-up / withdrawal
   questions.
3. **Clear-data flow.** `ServiceRegistryL2.TerminateService` must be
   indexed so the cohort's "clear data" behaviour is observable.

Everything else — the resolution-time settlement logic, NegRisk adapter
handling, UMA metadata parsing, sell-bet convention, outcome-share-based
`expectedPayout` calculation, daily-stat attribution — is reusable.

---

## 4. Proposed Architecture (Three Pieces)

### 4.1 `subgraphs/pearl/pearl-cohort/` — Cohort identification

Minimal, standalone subgraph on Polygon mainnet. Starts from the first
`PolySafeCreator` deployment block. Indexes only:

- `PolySafeCreator.*` — every Pearl Mini Safe and its owner EOA.
- `ServiceRegistryL2.CreateService` + `TerminateService` — links
  `serviceId` to Safe and tracks termination.
- `IdentityRegistryBridger.AgentWalletSet` — links `agentId` and agent EOA
  to Safe.

Primary entity:

```graphql
type PearlSafe @entity(immutable: false) {
  id: Bytes!               # Safe address — primary key for all analytics
  serviceId: BigInt!
  agentId: BigInt
  ownerEOA: Bytes!
  agentEOA: Bytes
  createdAt: BigInt!
  terminatedAt: BigInt
  # block metadata
}
```

Small (hundreds to low thousands of entities at beta scale), indexes in
hours. This is the authoritative Safe list consumed by everything
downstream.

### 4.2 `subgraphs/pearl/pearl-trades/` — Trade + P&L per Safe

Mostly a fork of `predict-polymarket/` with the filter replaced and funding
flows added. Data sources:

- `CTFExchange` (0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982e) —
  `OrderFilled`, `TokenRegistered`.
- `NegRiskCTFExchange` (0xC5d563A36AE78145C45a50134d48A1215220f80a) — same.
- `ConditionalTokens` (0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) —
  `ConditionPreparation`, `PayoutRedemption`.
- `NegRiskAdapter` (0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296) —
  `QuestionPrepared`, `OutcomeReported`, `PayoutRedemption`.
  **Required for NegRisk markets** — binary-only payout tracking under-counts
  multi-outcome redemptions otherwise.
- `OptimisticOracleV3` (0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7) —
  `QuestionInitialized`, `QuestionResolved`.
- `UmaCtfAdapter` (0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49) — same.
- `PolySafeCreator`, `ServiceRegistryL2`, `IdentityRegistryBridger` —
  cohort gate (same events as `pearl-cohort`; consider whether to graft
  from `pearl-cohort` or duplicate — see §6).
- USDC + wMATIC `Transfer` event handlers filtered to cohort addresses —
  funding-flow support.

Entity schema follows `predict-polymarket` with the following deltas:

- Rename `TraderAgent` → `PearlSafe` (or keep `TraderAgent` and point it at
  the Safe; naming is cosmetic).
- Drop `TraderService` (polystrat-specific filter); replace with a
  `PolySafeCreator`-driven gate.
- Add `Funding` entity for USDC/MATIC transfers into/out of Safe, owner
  EOA, agent EOA. Per the plan-doc column: `fundingBySafe(safe) { firstDeposit, totalIn, totalOut }`.
- Keep `Bet`, `Question`, `MarketMetadata`, `MarketParticipant`,
  `QuestionResolution`, `TokenRegistry`, `DailyProfitStatistic`,
  `PayoutRedemption`, `Global` unchanged in structure.

Handler logic is the same as `predict-polymarket` — the only functional
change is the agent-lookup predicate inside `handleOrderFilled` and
`handleCreateMultisigWithAgents`.

**Two start blocks (per plan doc §Optimization Paths Option B):**

- Market-creation sources (`ConditionPreparation`, `TokenRegistered`, UMA
  `QuestionInitialized`, NegRisk `QuestionPrepared`): `startBlock` ≈
  October 2025. Pearl Mini users trade on markets created months before
  their Safe existed, so these must be indexed earlier than the cohort
  cut-off.
- Trade / position / redemption sources (`OrderFilled`, `PayoutRedemption`,
  NegRisk `PayoutRedemption`, `PolySafeCreator`, ERC-20 `Transfer`):
  `startBlock` ≈ Pearl Mini mainnet deployment. No cohort Safe exists
  before that.

This two-block split is the difference between an hours-long index and a
weeks-long index.

### 4.3 (Deferred) `subgraphs/pearl/pearl-tempo/` — MPP channel aggregates

MPP payment-channel events on the Tempo chain (`ChannelOpened`, deposits,
voucher claims, settlements) are technically on-chain, so they sit inside
the on-chain-only rule. The concern is that joining a Tempo channel to a
Safe or EOA reconstructs a "user X spent $Y on predictions at effort-tier
Z" attribution that the constraint in §1.1 is specifically designed to
prevent.

**Adopted stance (provisional):** index Tempo channel events but keep them
**unjoined** with Safe / EOA data. Channel-level aggregates only:

- Total channels, total revenue.
- Spend per effort tier, inferred from channel price points.
- No schema field links a channel owner to a Safe / EOA.

This surfaces "how much do users collectively spend on predictions, and
which effort tiers are preferred" without reconstructing per-user spend.

**Not implemented until §1.1 is explicitly re-confirmed as compatible with
this design.** If the inferred-tier aggregate turns out to be
re-identifiable (e.g., if only one user ever hits a given price point in a
given window), the design needs revision or full exclusion.

---

## 5. ROI / Performance Measurement — How On-Chain Answers It

A concern raised during scoping: "users can't track all resolved markets
for them, might forget, or bet on events long in the future — how does
ROI work?" The subgraph handles both cases:

- **Forgotten / unclaimed settlements.** ROI is computed at **resolution
  time**, not at payout time. When UMA resolves a market, the handler
  iterates every `MarketParticipant` in that market and sets
  `expectedPayout` from each Safe's outcome-share balances, regardless of
  whether the Safe has redeemed. `PayoutRedemption` is tracked separately
  as `totalPayout` — the difference between `totalExpectedPayout` and
  `totalPayout` surfaces unclaimed winnings.
- **Bets on far-future events.** `MarketParticipant.settled == false`
  represents an open position. Its `outcomeShares0`/`outcomeShares1` give
  the current paper value at any outcome-token price; `expectedPayout`
  is only set once the market resolves. Dashboards should expose two ROI
  views: **realised ROI** (settled subset only, based on
  `totalTradedSettled` and `totalExpectedPayout`) and **open position
  value** (the mark-to-shares paper value). Conflating them hides the
  distinction between measured and speculative performance.

Resolution iteration uses `Question.participants.load()` with Map-based
caching for TraderAgent and DailyProfitStatistic entities, matching the
pattern in `predict-polymarket`.

---

## 6. Implementation Order

1. **Stand up `pearl-cohort`** first. Produces the canonical Safe list.
   Low risk, fast to index. Schema can be reviewed independently before
   touching the trade-side subgraph.
2. **Schema delta review for `pearl-trades`** before any handler work —
   the delta vs `predict-polymarket` is the concrete surface where §1.1
   either holds or breaks, and it is cheaper to review than to rewrite.
3. **Implement `pearl-trades`** — fork `predict-polymarket`, swap the
   cohort gate, add funding flows, apply the two-start-blocks split.
   Open question during implementation: does the cohort gate share a
   deployment with `pearl-cohort` (graft / cross-subgraph reads), or does
   `pearl-trades` re-index the `PolySafeCreator` events itself? The
   latter is simpler to operate and is probably the right default unless
   deployment cost becomes meaningful.
4. **Tempo stance decision.** Do not implement `pearl-tempo` until the
   §4.3 stance is explicitly re-confirmed. If approved, the subgraph
   design must preserve the "no Safe/EOA join" constraint at the schema
   level, not just in convention.

---

## 7. Out of Scope (recap)

Repeated here because the boundary must not drift:

- Linking on-chain activity to server-side prediction requests. Not done,
  for privacy / regulatory reasons.
- Server-side data export of any kind (request id, mode, tool, cost). The
  prediction pipeline stays self-contained and keys on its own request
  identifiers, not on wallets.
- Request → bet correlation in any form — no schema, no time-window join,
  no shared identifier.
- ROI-by-mode / ROI-by-tier. Requires the server-side join above.

Tempo channel data is the open policy question (§4.3), not a scope item.

---

## 8. Open Questions

- **Tempo channel indexing stance.** §4.3 proposes the middle-ground
  stance (channel-level aggregates, no Safe/EOA join). Needs explicit
  sign-off before implementation, and needs a re-check for
  re-identifiability at the inferred-tier level.
- **polystrat market-extended split.** The
  [`predict-polymarket`](../predict/predict-polymarket/) subgraph combines
  market-extended data (condition preparation, UMA metadata, resolutions)
  with polystrat agent-activity data. An alternative path — not yet
  adopted — is to split that deployment and share the market-extended
  half with Pearl Mini. That reduces duplicate indexing but requires
  coordination with the existing deployment. Re-visit once `pearl-trades`
  is implemented and operational.
- **`PolySafeCreator` event signature + start block.** Needs to be
  confirmed from the deployed contract before the cohort subgraph
  manifest is written.
- **ERC-20 `Transfer` volume.** USDC and wMATIC `Transfer` events are
  very high-frequency on Polygon. Filtering to cohort addresses happens
  at handler time (not at indexing time), which means the indexer still
  receives every event. If this is a performance problem at beta scale,
  revisit — options include upstream filtering, a separate funding-only
  subgraph, or switching to a periodic balance snapshot pattern.
