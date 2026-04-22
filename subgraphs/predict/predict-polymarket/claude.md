# Autonolas Predict Polymarket Subgraph — Technical Implementation Guide

> **AI Assistant Context**: This document describes the subgraph's current architecture. It was generalized from a polystrat-only (agent ID 86) indexer to a cohort-agnostic one — see [`subgraphs/pearl/SUBGRAPH_PLAN.md`](../../pearl/SUBGRAPH_PLAN.md) for the motivation. Cohort filtering is now client-side.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Core Data Model](#core-data-model)
- [Event Handlers & Data Flow](#event-handlers--data-flow)
- [Cohort Filtering (Client-Side)](#cohort-filtering-client-side)
- [Common Queries](#common-queries)
- [Development Workflow](#development-workflow)

---

## Architecture Overview

### Purpose
GraphQL API tracking Autonolas agent activity on Polymarket (Polygon). Indexes **every** Olas multisig on Polygon and lazy-creates a `TraderAgent` on its first trade. Cohort filtering (polystrat, Pearl Mini, etc.) is resolved client-side against the `Multisig.agentIds` / `Multisig.operators` arrays via the `multisig_:` link on `TraderAgent`.

### Directory Structure
```
subgraphs/predict/predict-polymarket/
├── schema.graphql                   # GraphQL schema
├── subgraph.yaml                    # Data sources & event mappings
├── src/
│   ├── service-registry-l-2.ts      # Multisig entity lifecycle
│   ├── conditional-tokens.ts        # Condition preparation, vanilla payouts
│   ├── ctf-exchange.ts              # OrderFilled + lazy TraderAgent creation
│   ├── uma-mapping.ts               # UMA question metadata + resolution
│   ├── neg-risk-mapping.ts          # NegRisk markets + NegRisk payouts
│   ├── constants.ts                 # ONE_DAY, PayoutSource enum values
│   └── utils.ts                     # processTradeActivity, processMarketResolution, processRedemption
├── tests/                           # Matchstick tests
└── generated/                       # Auto-generated bindings (gitignored)
```

### Key Contracts
1. **ServiceRegistryL2** (`0xE3607b00E75f6405248323A9417ff6b39B244b50`) — Olas service lifecycle on Polygon.
2. **ConditionalTokens** (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`) — Condition preparation and payouts.
3. **CTFExchange** / **NegRiskCTFExchange** — Order book; agents are **makers**.
4. **OptimisticOracleV3** (`0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7`) — UMA oracle.
5. **UmaCtfAdapter** (`0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`) — Alternate UMA adapter.
6. **NegRiskAdapter** (`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`) — Multi-outcome wrapper.

### Core Business Rules

1. **Generalized indexing (no agent-ID gate).** Every Olas multisig on Polygon is indexed via the `Multisig` entity, regardless of `agentId`. Cohort identity is inferred client-side from `Multisig.agentIds` / `Multisig.operators` (see [Cohort Filtering](#cohort-filtering-client-side)). This was historically a polystrat-only subgraph filtered on `agentId == 86`; that filter is gone.
2. **Lazy `TraderAgent` creation.** `TraderAgent` is created on first trade in `handleOrderFilled`, *not* at service registration. Its presence is a semantic signal that a service has actually traded. `Global.totalTraderAgents` reflects trading services only.
3. **Binary markets only.** Markets with `outcomeSlotCount != 2` are ignored.
4. **Agents are MAKERS.** On CTFExchange/NegRiskCTFExchange we filter on `event.params.maker`, never `taker`.
5. **Two-tier volume accounting.** `totalTraded` updates immediately on every trade; `totalTradedSettled` updates at resolution for *all* bets (winning and losing).
6. **Settlement-day profit attribution.** All P&L is attributed on `QuestionResolved` using outcome-share balances — never at payout time.
    - Valid answer: `expectedPayout = max(0, outcomeShares[winningIndex])`.
    - Invalid answer (`-1`): `expectedPayout = max(0,shares0)/2 + max(0,shares1)/2`.
    - `profit = expectedPayout - (totalTraded - totalTradedSettled)` at resolution.
7. **Payout tracking is separate.** `handlePayoutRedemption` / `handleNegRiskPayoutRedemption` only update `totalPayout` and emit an immutable `PayoutRedemption` record with a `source: PayoutSource` discriminator.
8. **Sell convention.** Sells use negative `amount` and `shares`; `isBuy` distinguishes direction.
9. **No re-answer logic.** Polymarket resolutions are final.

---

## Core Data Model

### Multisig (new; cohort-filter index)
Minimal service-registration index for every Olas multisig on Polygon. Source of truth for the cohort-filter predicate inside this subgraph. Full registration records (per-instance history with timestamps) live in [`subgraphs/service-registry/`](../../service-registry/), not here.

```graphql
type Multisig @entity(immutable: false) {
  id: Bytes!                 # multisig address
  serviceId: BigInt!
  agentIds: [Int!]!          # deduplicated; appended on RegisterInstance
  operators: [Bytes!]!       # deduplicated; appended on RegisterInstance
  traderAgent: TraderAgent   # null until first trade (lazy creation)
  createdAt: BigInt!
  terminatedAt: BigInt       # set by handleTerminateService
  blockNumber: BigInt!
  transactionHash: Bytes!
}
```

### TraderAgent (lazy-created; multisig-linked)
```graphql
type TraderAgent @entity(immutable: false) {
  id: Bytes!                         # multisig Safe address
  multisig: Multisig!                # link for cohort queries
  serviceId: BigInt!                 # denormalized from multisig.serviceId
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

### PayoutRedemption (now source-annotated)
```graphql
enum PayoutSource {
  CONDITIONAL_TOKENS    # vanilla binary markets
  NEG_RISK_ADAPTER      # multi-outcome markets via NegRiskAdapter
}

type PayoutRedemption @entity(immutable: true) {
  id: Bytes!              # txHash + logIndex
  redeemer: TraderAgent!
  conditionId: Bytes!
  question: Question
  payoutAmount: BigInt!
  source: PayoutSource!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

### Internal helpers (not for consumers)
- **`ServiceIndex { id: serviceIdBytes, multisig: Bytes! }`** — serviceId → multisig lookup, written when `CreateMultisigWithAgents` fires.
- **`PendingMultisig { id: serviceIdBytes, agentIds, operators }`** — buffers `RegisterInstance` events that fire before `CreateMultisigWithAgents` (the typical initial-deployment order on Polygon). Drained into `Multisig` when the multisig is created.

### Unchanged entities
`Question`, `MarketMetadata`, `Bet`, `TokenRegistry`, `QuestionResolution`, `MarketParticipant`, `DailyProfitStatistic`, `MarketParticipated`, `QuestionIdToConditionId`, `Global`.

Consumers use these exactly as before. See `schema.graphql` for the full surface.

---

## Event Handlers & Data Flow

### 1. Service registration (`service-registry-l-2.ts`)

Polygon order for a fresh service: `RegisterInstance*` → `CreateMultisigWithAgents`. Handlers accept either order.

**`handleRegisterInstance(operator, serviceId, agentInstance, agentId)`**
- If `ServiceIndex[serviceId]` exists → load `Multisig`, dedup-append `agentId` and `operator`.
- Otherwise → dedup-append to `PendingMultisig[serviceId]` (created on demand).
- No `TraderAgent` touched.

**`handleCreateMultisigWithAgents(serviceId, multisig)`**
- Create `Multisig[multisig]` with `createdAt`, empty arrays.
- If `PendingMultisig[serviceId]` exists → drain `agentIds`/`operators` into `Multisig` (dedup-merged).
- Write `ServiceIndex[serviceId] = multisig` for any future `RegisterInstance`.
- No `TraderAgent` touched.

**`handleTerminateService(serviceId)`**
- Resolve `multisig` via `ServiceIndex[serviceId]`, set `Multisig.terminatedAt`.
- Trading history persists across termination for audit.

### 2. Market condition setup (`conditional-tokens.ts`)

**`handleConditionPreparation`** — unchanged. Writes `QuestionIdToConditionId` bridge for binary (2-outcome) markets. `Question` itself is created later by `uma-mapping` / `neg-risk-mapping` once metadata is available.

### 3. Market metadata (`uma-mapping.ts`, `neg-risk-mapping.ts`)

Unchanged:
- `handleOOQuestionInitialized` / `handleUmaQuestionInitialized` → create `MarketMetadata` + `Question` (vanilla binary).
- `handleQuestionPrepared` → create `MarketMetadata` + `Question` (NegRisk; outcomes always `["Yes","No"]`).

### 4. Token registration (`ctf-exchange.ts`)

**`handleTokenRegistered`** — unchanged. Writes `TokenRegistry[tokenId]` for outcome 0 and outcome 1. Early-returns on duplicate (CTFExchange fires swapped-pair duplicates).

### 5. Trade placement (`ctf-exchange.ts`)

**`handleOrderFilled`** — this is the critical change-point.

1. `Multisig.load(event.params.maker)` — **early return if null** (non-Olas maker).
2. `TraderAgent.load(maker)` — if null:
    - Create `TraderAgent`, link `multisig: Multisig!`, copy `serviceId`, zero cumulative fields.
    - Set `Multisig.traderAgent = TraderAgent.id` (back-link).
    - Increment `Global.totalTraderAgents`.
3. Decode direction and amounts (buy: `makerAssetId==0`; sell: `takerAssetId==0`). Sells carry negative `amount`/`shares`.
4. `TokenRegistry.load(outcomeTokenId)` — warn+return on miss (see correctness note below).
5. Update daily stat, create `Bet`, link `question`.
6. `processTradeActivity` — updates `Global`, `TraderAgent`, and `MarketParticipant` in one pass; tracks outcome share positions (buys add, sells subtract).

> **Correctness note — two-start-blocks pattern.** `TokenRegistered` (on CTFExchange sources) and `ConditionPreparation` / `QuestionInitialized` fire well before any trade. If trade sources start at a later block than these market-creation sources, the `TokenRegistry.load` / `Question.load` will be null and the bet is silently dropped. See [`SUBGRAPH_PLAN.md` §7.1](../../pearl/SUBGRAPH_PLAN.md) — the generalized deployment uses an earlier start block for market-creation sources to avoid this bug.

### 6. Resolution (`uma-mapping.ts`, `neg-risk-mapping.ts`)

**`handleOOQuestionResolved` / `handleUmaQuestionResolved` / `handleOutcomeReported`** — all route to `processMarketResolution(conditionId, winningOutcome, settledPrice, payouts, event)` in `utils.ts`.

`processMarketResolution` iterates every `MarketParticipant` for the conditionId:
- Skips `settled == true` (idempotency).
- Computes `expectedPayout` from outcome-share balances (rules above).
- Sets `participant.totalTradedSettled = totalTraded`, `participant.settled = true`.
- Aggregates into cached `TraderAgent` and `DailyProfitStatistic` (batch-saved at end) and delta-accumulates into `Global`.
- Marks bets `countedInProfit = true`, `countedInTotal = true`.

### 7. Payout (`conditional-tokens.ts`, `neg-risk-mapping.ts`)

**`handlePayoutRedemption`** → `processRedemption(..., "CONDITIONAL_TOKENS")`.
**`handleNegRiskPayoutRedemption`** → `processRedemption(..., "NEG_RISK_ADAPTER")`.

`processRedemption`:
- Validates `TraderAgent`, `Question`, `MarketParticipant` exist (early return on miss).
- Creates immutable `PayoutRedemption` with the supplied `source`.
- Updates `totalPayout` on `TraderAgent`, `MarketParticipant`, `Global`, and `DailyProfitStatistic`.
- **No `dailyProfit` change** — profit was attributed at resolution.

---

## Cohort Filtering (Client-Side)

The subgraph itself does not know or label cohorts. Clients filter through the `multisig_:` link on `TraderAgent`:

```graphql
# Polystrat — the classic filter, now explicit
traderAgents(where: { multisig_: { agentIds_contains: [86] } }) { ... }

# Pearl Mini — services created via PolySafeCreator
traderAgents(
  where: { multisig_: { operators_contains: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }
) { ... }

# All Olas multisigs (including ones that haven't traded yet)
multisigs { id, serviceId, agentIds, operators, traderAgent { id, totalBets } }
```

Consumers own the address/label mapping (e.g. `0xA749f605...` → "Pearl Mini", `86` → "polystrat") as a small local constant. See [`SUBGRAPH_PLAN.md` §4.1](../../pearl/SUBGRAPH_PLAN.md) and §8 for cohort-ownership conventions.

On-chain classification via `ApplicationClassifier` is a documented future enhancement (see `SUBGRAPH_PLAN.md` §4.2), not part of current scope.

---

## Common Queries

### Agent P&L + markets
```graphql
{
  dailyProfitStatistics(where: { traderAgent: "0x..." }, orderBy: date) {
    date
    dailyProfit
    totalTraded
    totalPayout
    profitParticipants { id, metadata { title } }
  }
}
```

### Pearl Mini cohort — realized + open positions
```graphql
{
  traderAgents(
    where: { multisig_: { operators_contains: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }
  ) {
    id
    totalTraded
    totalTradedSettled
    totalExpectedPayout
    totalPayout  # compare with totalExpectedPayout to surface unclaimed winnings
  }
}
```

### Global statistics
```graphql
{
  globals {
    totalTraderAgents
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalTradedSettled
    totalExpectedPayout
    totalPayout
  }
}
```

### Audit trail — distinguishing vanilla vs NegRisk payouts
```graphql
{
  payoutRedemptions(where: { source: NEG_RISK_ADAPTER }, first: 100, orderBy: blockTimestamp, orderDirection: desc) {
    redeemer { id }
    conditionId
    payoutAmount
    transactionHash
  }
}
```

---

## Development Workflow

### Setup
```bash
yarn install
```

### Build
```bash
yarn codegen   # regenerate TS from schema + ABIs
yarn build     # AssemblyScript → WASM
yarn test      # Matchstick
```

### Deploy
```bash
graph deploy --studio autonolas-predict-polymarket
```

See the [root README](../../../README.md) for deployment details.

### Configuration (`subgraph.yaml`)

| Data source | Key events | Handler file |
|---|---|---|
| ServiceRegistryL2 | `RegisterInstance`, `CreateMultisigWithAgents`, `TerminateService` | `src/service-registry-l-2.ts` |
| ConditionalTokens | `ConditionPreparation`, `PayoutRedemption` | `src/conditional-tokens.ts` |
| OptimisticOracleV3 | `QuestionInitialized`, `QuestionResolved` | `src/uma-mapping.ts` |
| UmaCtfAdapter | `QuestionInitialized`, `QuestionResolved` | `src/uma-mapping.ts` |
| NegRiskAdapter | `QuestionPrepared`, `OutcomeReported`, `PayoutRedemption` | `src/neg-risk-mapping.ts` |
| CTFExchange, NegRiskCTFExchange | `OrderFilled`, `TokenRegistered` | `src/ctf-exchange.ts` |

### Utility Functions (`src/utils.ts`)

| Function | Purpose |
|---|---|
| `getGlobal()` | Singleton `Global` (id=`""`); creates if absent. |
| `saveMapValues<T>(map)` | Batch-saves all entities in a cache. |
| `getDayTimestamp(ts)` | UTC midnight: `ts / 86400 * 86400`. |
| `getDailyProfitStatistic(agent, ts)` | Get-or-create daily stat for `(agent, day)`. |
| `addProfitParticipant(stat, questionId)` | Dedup-append to `profitParticipants`. |
| `processTradeActivity(...)` | Trade-time updates to `Global`, `TraderAgent`, `MarketParticipant`; tracks `outcomeShares0/1`. |
| `processMarketResolution(...)` | Resolution-time settlement: `expectedPayout`, profit, idempotency via `settled`. Uses Map caches + delta accumulation. |
| `processRedemption(..., source)` | Payout-only update; creates `PayoutRedemption` with the supplied `source`. |

### Constants (`src/constants.ts`)
- `ONE_DAY = BigInt.fromI32(86400)`
- `PAYOUT_SOURCE_CONDITIONAL_TOKENS = "CONDITIONAL_TOKENS"`
- `PAYOUT_SOURCE_NEG_RISK_ADAPTER = "NEG_RISK_ADAPTER"`

---

## Summary for AI Assistants

### Critical points
1. **No agent-ID gate.** Every Olas multisig on Polygon is indexed via `Multisig`. `TraderAgent` is lazy-created on first trade.
2. **Cohort is a client concern.** Use `traderAgents(where: { multisig_: { agentIds_contains: [...] | operators_contains: [...] } })`.
3. **Agents are MAKERS** on CTF/NegRisk exchanges.
4. **Volume accounting is two-tier.** `totalTraded` is immediate; `totalTradedSettled` updates at resolution for all bets.
5. **All profit is attributed at resolution**, not at payout.
6. **Payouts are source-tagged.** `PayoutSource = CONDITIONAL_TOKENS | NEG_RISK_ADAPTER`.
7. **Sell convention.** Sells carry negative `amount` and `shares`.
8. **Idempotency.** `MarketParticipant.settled` prevents double-processing at resolution.
9. **No re-answer logic.** Polymarket resolutions are final.
10. **`Question` id is `conditionId`** (not `questionId`); `Global` id is `""` (empty string).
11. **Handlers depend on Map caches** (`agentCache`, `dailyStatsCache`) + delta accumulation on `Global` to keep resolution O(participants).

### Event ordering on Polygon
`RegisterInstance*` → `CreateMultisigWithAgents` is the typical order for fresh services; `handleRegisterInstance` buffers to `PendingMultisig` in that case. For re-registrations after `TerminateService`, `RegisterInstance` may fire with a pre-existing `ServiceIndex` — both orderings are supported.

### Start-block correctness
Market-creation sources (`ConditionPreparation`, `QuestionInitialized`, `TokenRegistered`, `QuestionPrepared`) must start from a block **earlier** than the earliest trade by any indexed multisig, or trades on pre-start-block markets are silently dropped at `TokenRegistry.load` / `Question.load`. See [`SUBGRAPH_PLAN.md` §7.1](../../pearl/SUBGRAPH_PLAN.md).

---

*Keep this document current when schema, handlers, or entity semantics change.*
