# `pearl-trades` Schema — Proposed Delta vs `predict-polymarket`

**Status:** Draft for review (no code written yet)
**Parent plan:** [`SUBGRAPH_PLAN.md`](./SUBGRAPH_PLAN.md)
**Reference schema:** [`subgraphs/predict/predict-polymarket/schema.graphql`](../predict/predict-polymarket/schema.graphql)
**Reference handlers / business rules:** [`subgraphs/predict/predict-polymarket/CLAUDE.md`](../predict/predict-polymarket/CLAUDE.md)

This doc is the concrete surface where the on-chain-only policy boundary
either holds or breaks (see `SUBGRAPH_PLAN.md` §1). Review the delta here
before any handler work on `pearl-trades/`.

---

## 1. Delta Summary

| Entity | Change | Rationale |
|---|---|---|
| `TraderService` | **Removed** | polystrat-specific gate (`agentId == 86`). Pearl Mini gates on `PolySafeCreator`-emitted Safes, not on the Olas service-registry agentId. |
| `TraderAgent` | **Renamed → `PearlSafe`** + cohort fields added | The entity is conceptually a Safe address, not a generic trader. New fields (`ownerEOA`, `agentEOA`, `agentId`, `terminatedAt`) surface the cohort identity that is meaningful for Pearl Mini. |
| `Funding` | **New** | Wallet-level funding flows (first deposit / top-up / withdrawal) were explicitly flagged in the scoping doc and are not tracked in predict-polymarket. |
| `FundingDaily` | **New** | Daily aggregate to keep funding queries cheap without scanning every `Funding` row. |
| `Bet` | **Field rename** `bettor` → `safe` | Follows the `PearlSafe` rename. |
| `MarketParticipant` | **Field rename** `traderAgent` → `safe` | Same. |
| `PayoutRedemption` | **Field rename** `redeemer` → `safe` | Same. |
| `DailyProfitStatistic` | **Field rename** `traderAgent` → `safe` | Same. |
| `Global` | **Field renames** `totalTraderAgents` → `totalSafes`, `totalActiveTraderAgents` → `totalActiveSafes` | Same. |
| `Question` / `MarketMetadata` / `QuestionResolution` / `TokenRegistry` / `QuestionIdToConditionId` / `MarketParticipated` | **Unchanged** | These entities describe market state, not cohort identity. They are cohort-agnostic and carry over verbatim. |

**Nothing in this schema references a server-side `mode`, `tool`, `tier`,
request id, or any identifier that could be joined to the prediction
server.** This is the observable half of the §1.1 constraint. The other
half lives in the handlers (which must not invent such fields at runtime)
and in review discipline.

---

## 2. Proposed `schema.graphql`

```graphql
# =============================================================================
# Cohort identity
# =============================================================================

# Represents a Pearl Mini Safe, its paired Olas service, and its agent EOA.
# Primary key for all analytics.
#
# Created by handleSafeCreated (PolySafeCreator.*). The serviceId + agentEOA
# are populated when ServiceRegistryL2.CreateMultisigWithAgents and
# IdentityRegistryBridger.AgentWalletSet fire for the same Safe.
type PearlSafe @entity(immutable: false) {
  id: Bytes!                  # Safe address
  serviceId: BigInt           # set on CreateMultisigWithAgents (nullable because events are async)
  agentId: BigInt             # ERC-8004 identity NFT id (from IdentityRegistryBridger)
  ownerEOA: Bytes!            # Privy-derived owner wallet (from PolySafeCreator)
  agentEOA: Bytes             # agent wallet (from IdentityRegistryBridger.AgentWalletSet)

  # Lifecycle
  createdAt: BigInt!
  terminatedAt: BigInt        # ServiceRegistryL2.TerminateService — clear-data flow

  # Activity
  firstParticipation: BigInt
  lastActive: BigInt
  totalBets: Int!

  # Financial metrics — identical semantics to predict-polymarket TraderAgent
  totalTraded: BigInt!                # all bets, updated at bet time
  totalTradedSettled: BigInt!         # settled markets, updated at resolution for ALL bets
  totalPayout: BigInt!                # actual USDC claimed via PayoutRedemption
  totalExpectedPayout: BigInt!        # sum of expectedPayouts from settled markets

  # Derived
  bets: [Bet!]! @derivedFrom(field: "safe")
  dailyProfitStatistics: [DailyProfitStatistic!]! @derivedFrom(field: "safe")
  funding: [Funding!]! @derivedFrom(field: "safe")

  # Block metadata
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# =============================================================================
# Wallet funding flows (new vs predict-polymarket)
# =============================================================================

# A single USDC or MATIC (native wrapped) Transfer event touching a Safe,
# owner EOA, or agent EOA. Filtered at handler time to cohort addresses.
#
# Tracked to answer: "how much did users deposit for first funding, top-ups,
# withdrawals" — per the scoping doc's fundingBySafe view.
type Funding @entity(immutable: true) {
  id: Bytes!                  # txHash + logIndex
  safe: PearlSafe!            # the Safe the flow is attributed to
  counterparty: Bytes!        # the non-cohort address on the other side
  asset: FundingAsset!
  direction: FundingDirection!
  touches: FundingAddress!    # which cohort address actually received/sent (safe/owner/agent)
  amount: BigInt!             # positive; direction encodes in/out
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

enum FundingAsset {
  USDC
  MATIC
}

enum FundingDirection {
  IN
  OUT
}

enum FundingAddress {
  SAFE
  OWNER
  AGENT
}

# Daily aggregate per Safe — keeps "first deposit / total in / total out"
# queries O(days) rather than O(transfers). Per-asset.
type FundingDaily @entity(immutable: false) {
  id: ID!                     # safe + "_" + asset + "_" + dayTimestamp
  safe: PearlSafe!
  asset: FundingAsset!
  date: BigInt!               # UTC midnight
  totalIn: BigInt!
  totalOut: BigInt!
  transferCount: Int!
}

# =============================================================================
# Market state — unchanged vs predict-polymarket (cohort-agnostic)
# =============================================================================

# Bridge entity linking UMA question IDs to ConditionalTokens condition IDs.
type QuestionIdToConditionId @entity(immutable: true) {
  id: Bytes!                  # questionId
  oracle: Bytes!
  conditionId: Bytes!
  transactionHash: Bytes!
}

# Market identity. Primary key is conditionId, NOT questionId.
type Question @entity(immutable: true) {
  id: Bytes!                  # conditionId
  questionId: Bytes!
  isNegRisk: Boolean!
  marketId: Bytes             # NegRisk grouping id
  metadata: MarketMetadata!
  bets: [Bet!]! @derivedFrom(field: "question")
  participants: [MarketParticipant!]! @derivedFrom(field: "question")
  resolution: QuestionResolution @derivedFrom(field: "question")
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Extracted from UMA OO V3 ancillary data.
type MarketMetadata @entity(immutable: true) {
  id: Bytes!                  # questionId
  title: String!
  outcomes: [String!]!
  rawAncillaryData: String!
}

# Maps an outcome token id to its (conditionId, outcomeIndex). Essential
# for OrderFilled handler to know which outcome is being bought/sold.
type TokenRegistry @entity(immutable: true) {
  id: Bytes!                  # tokenId as bytes
  tokenId: BigInt!
  conditionId: Bytes!
  outcomeIndex: BigInt!       # 0 or 1
  transactionHash: Bytes!
}

# Final oracle resolution — drives settlement in handleQuestionResolved.
type QuestionResolution @entity(immutable: true) {
  id: Bytes!                  # conditionId
  question: Question!
  winningIndex: BigInt!       # -1 invalid, 0 or 1 winner
  settledPrice: BigInt!
  payouts: [BigInt!]!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Marker for markets any cohort Safe participated in — used for
# Global.totalMarketsParticipated.
type MarketParticipated @entity(immutable: true) {
  id: Bytes!                  # conditionId
}

# =============================================================================
# Per-Safe trading activity (field renames vs predict-polymarket)
# =============================================================================

# A single CTF Exchange OrderFilled attributed to a Safe (as maker or taker).
# Sells use NEGATIVE amount and shares (matches predict-polymarket convention).
type Bet @entity(immutable: false) {
  id: Bytes!                  # txHash + logIndex
  safe: PearlSafe!            # renamed from bettor
  outcomeIndex: BigInt!
  amount: BigInt!             # USDC (6-decimal), positive for buy, negative for sell
  shares: BigInt!             # outcome tokens, positive for buy, negative for sell
  isBuy: Boolean!
  countedInTotal: Boolean!    # set true at resolution
  countedInProfit: Boolean!   # set true at resolution
  question: Question
  dailyStatistic: DailyProfitStatistic
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Per-Safe × per-market aggregate. Iterated at resolution time.
type MarketParticipant @entity(immutable: false) {
  id: ID!                     # safeAddress + "_" + conditionId
  safe: PearlSafe!            # renamed from traderAgent
  question: Question!
  totalBets: Int!
  totalTraded: BigInt!
  totalTradedSettled: BigInt!
  totalPayout: BigInt!
  outcomeShares0: BigInt!     # net shares, buys add / sells subtract
  outcomeShares1: BigInt!
  expectedPayout: BigInt!     # set at resolution from outcome share balances
  settled: Boolean!           # idempotency; set true at resolution
  bets: [Bet!]!
  createdAt: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# Audit-trail entity for every PayoutRedemption event (CTF + NegRiskAdapter).
# Profit is computed at resolution, not here — this only tracks claimed amounts.
type PayoutRedemption @entity(immutable: true) {
  id: Bytes!                  # txHash + logIndex
  safe: PearlSafe!            # renamed from redeemer
  conditionId: Bytes!
  question: Question
  payoutAmount: BigInt!
  source: PayoutSource!       # new vs predict-polymarket — distinguishes adapters
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

enum PayoutSource {
  CONDITIONAL_TOKENS          # vanilla binary markets
  NEG_RISK_ADAPTER            # multi-outcome markets
}

# Day-level P&L per Safe. Populated on bet placement, resolution, and payout.
type DailyProfitStatistic @entity(immutable: false) {
  id: ID!                     # safeAddress + "_" + dayTimestamp
  safe: PearlSafe!            # renamed from traderAgent
  date: BigInt!

  # Activity placed on this day
  bets: [Bet!]! @derivedFrom(field: "dailyStatistic")
  totalBets: Int!
  totalTraded: BigInt!
  totalPayout: BigInt!

  # Profit realized on this day (from settlements)
  dailyProfit: BigInt!
  profitParticipants: [Question!]!
}

# =============================================================================
# Global singleton — field renames only
# =============================================================================

type Global @entity(immutable: false) {
  id: ID!                     # empty string "" (matches predict-polymarket convention)
  totalSafes: Int!            # renamed from totalTraderAgents
  totalActiveSafes: Int!      # renamed from totalActiveTraderAgents
  totalBets: Int!
  totalPayout: BigInt!
  totalTraded: BigInt!
  totalTradedSettled: BigInt!
  totalExpectedPayout: BigInt!
  totalMarketsParticipated: Int!
}
```

---

## 3. Handler-Level Implications of This Schema

The schema changes are deliberately narrow, but they imply the following
handler changes relative to `predict-polymarket`:

1. **Gate in `handleOrderFilled` / `handleCreateMultisigWithAgents`.** Loads
   `PearlSafe.load(event.params.maker)` instead of `TraderAgent.load(...)`
   and skips if null. The `PearlSafe` entity is created in handlers for
   `PolySafeCreator.*` events, not in `handleRegisterInstance`. The
   `agentId == 86` filter is gone entirely.
2. **Safe population is multi-event.** `PolySafeCreator` creates the
   `PearlSafe` with `ownerEOA` set. `ServiceRegistryL2.CreateMultisigWithAgents`
   sets `serviceId`. `IdentityRegistryBridger.AgentWalletSet` sets
   `agentId` + `agentEOA`. These events may arrive in any order; handlers
   must `load-or-create` and null-check fields that might not yet be set.
3. **Funding handlers are new.** USDC and MATIC `Transfer` handlers check
   whether `from` or `to` is a known cohort address (Safe, owner EOA, or
   agent EOA), attribute to the Safe, and update `Funding` + `FundingDaily`.
   The cohort-address lookup should use a side index (e.g., a helper
   entity keyed on the raw address) so it's O(1) without scanning all
   `PearlSafe` entities.
4. **`PayoutRedemption.source` is populated** based on which handler fired
   (`handlePayoutRedemption` on ConditionalTokens → `CONDITIONAL_TOKENS`;
   `handleNegRiskPayoutRedemption` on NegRiskAdapter → `NEG_RISK_ADAPTER`).
   Without this field, NegRisk vs vanilla redemptions are indistinguishable
   in the audit trail.
5. **Idempotency for Safe termination.** `handleTerminateService` sets
   `terminatedAt` but must not delete the Safe or its history — downstream
   analytics care about "did a cleared user have realised P&L."
6. **Settlement logic is unchanged.** `processMarketResolution`,
   `processTradeActivity`, and `processRedemption` from
   `predict-polymarket/src/utils.ts` port over with field renames only
   (`agent.*` → `safe.*`). Map caching pattern, delta accumulation for
   `Global`, idempotency via `participant.settled` — all carry over.

---

## 4. Review Questions

Before implementation starts, the following are worth a look:

1. **Rename scope.** Renaming `TraderAgent` → `PearlSafe` makes queries
   clearer but forks the schema shape from `predict-polymarket`. Is that
   worth it, or should we keep `TraderAgent` and accept the naming
   mismatch? Recommendation: rename — the Safe-centric framing is load-
   bearing for this cohort.
2. **`Funding` granularity.** Per-transfer entity + per-day aggregate. An
   alternative is aggregates only, but debugging a "missing top-up"
   report requires the raw events. Recommendation: keep both; drop
   `Funding` (the raw entity) only if storage pressure appears.
3. **`counterparty` field on `Funding`.** Useful for audit ("where did
   this USDC come from"), but if the counterparty is itself a cohort
   address (Safe-to-Safe), the same transfer will appear twice (once
   IN, once OUT). Handler logic must decide whether that's one entity or
   two. Recommendation: two entities (one per cohort address touched),
   with `touches` making the distinction explicit.
4. **`MarketParticipated` marker.** Carried over verbatim but could be
   replaced by a count on `Global` incremented when the first cohort
   bet in a market is seen. Keeping the marker entity as-is is simpler
   and matches `predict-polymarket`.
5. **Anything in the schema that smells like a server-side join.** The
   schema was deliberately constructed to have none. If any field in
   review feels borderline (e.g., "should we add a `tier` enum"), the
   answer is **no, per §1.1** — and that's the whole point of doing
   schema review before code.

---

## 5. What's Deliberately Absent

For audit discipline, absence is as important as presence. None of the
following appear in this schema, and none should be added without an
explicit policy revisit:

- No `mode` / `tool` / `tier` field on any entity.
- No `requestId` / `predictionId` / server-correlation identifier.
- No `source = SERVER` enum variant, no "off-chain" enrichment hook.
- No timestamp-join helper fields (e.g., "request_minute bucket") that
  would make a server-side join one query away.

If any of these become necessary for a future product ask, the answer is
a policy decision on §1.1, not a schema change.
