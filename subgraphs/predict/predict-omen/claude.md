# Autonolas Predict Omen Subgraph

A GraphQL API for tracking prediction markets and Autonolas agent performance on Gnosis Chain. Indexes binary prediction markets created by whitelisted agents and tracks trading activity, profit/loss attribution, and market settlements.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Accounting Rules](#accounting-rules)
- [Performance Patterns](#performance-patterns)
- [Constants](#constants)
- [Configuration (subgraph.yaml)](#configuration)
- [Testing](#testing)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)
- [AI Summary](#ai-summary)

---

## Architecture Overview

### Directory Structure
```
subgraphs/predict/predict-omen/
├── schema.graphql
├── subgraph.yaml                        # prune: auto enabled
├── src/
│   ├── service-registry-l-2.ts          # Agent registration
│   ├── FPMMDeterministicFactoryMapping.ts # Market creation
│   ├── FixedProductMarketMakerMapping.ts # Buy/Sell trades
│   ├── realitio.ts                      # Oracle answers & settlement
│   ├── conditional-tokens.ts            # Condition prep & payout redemption
│   ├── utils.ts                         # Helpers (processTradeActivity, caching, etc.)
│   └── constants.ts                     # Whitelists & configs
├── tests/
│   ├── profit.test.ts                   # 19 unit tests
│   └── profit.ts                        # Test helpers
└── package.json                         # graph-cli 0.98.1, graph-ts 0.38.2
```

### Key Contracts (Gnosis Chain)

| Contract | Address | Start Block |
|----------|---------|-------------|
| ServiceRegistryL2 | 0x9338b5153AE39BB89f50468E608eD9d764B755fD | 27,871,084 |
| ConditionalTokens | 0xCeAfDD6bc0bEF976fdCd1112955828E00543c0Ce | 28,900,000 |
| FPMMDeterministicFactory | 0x9083A2B699c0a4AD06F63580BDE2635d26a3eeF0 | 28,900,000 |
| Realitio | 0x79e32aE03fb27B07C89c0c568F80287C01ca2E57 | 28,900,000 |

### Core Business Rules

1. **Selective Tracking**: Only tracks agents registered via `ServiceRegistryL2` and markets from whitelisted creators (see [constants](#constants)).
2. **Market Lifecycle**: 4-day trading window; payouts 24+ hours after closing.
3. **Two-Tier Accounting**:
   - `totalTraded` / `totalFees`: Updated **immediately** when bets are placed.
   - `totalTradedSettled` / `totalFeesSettled`: Updated **at settlement** (`handleLogNewAnswer`) for ALL bets (both correct and incorrect).
4. **Settlement-Day Profit Attribution**: ALL profit/loss is calculated at settlement time when `LogNewAnswer` fires. Uses outcome token balances to compute `expectedPayout` for each participant:
   - **Valid answer (0 or 1)**: Winning tokens worth 1:1 in collateral. `expectedPayout = outcomeTokenBalance for winning outcome`.
   - **Invalid answer**: `payoutNumerators = [1, 1]`, each token worth 1/2 collateral. `expectedPayout = balance0/2 + balance1/2` (integer division).
   - **Profit**: `expectedPayout - totalTraded - totalFees` (settled on the same day).
5. **Payout Tracking**: `handlePayoutRedemption` only tracks actual xDAI claimed (`totalPayout`) and creates immutable `PayoutRedemption` entries for debugging. No profit calculation occurs at payout time.
6. **Answer Changes (Re-answers)**: Oracle answers can change within 24 hours via Reality.eth's dispute mechanism (~415/15,000 markets affected). When `LogNewAnswer` fires with a different answer:
   - Old profit is **reversed** from the previous answer's daily stat (looked up via `previousAnswerTimestamp`).
   - New profit is computed using **full market cost**: `newExpectedPayout - totalTraded - totalFees` (not incremental). This ensures correct reconstruction on subsequent re-answers.
   - Agent/Global `totalExpectedPayout` adjusted by delta (`new - old`). Incremental `totalTradedSettled`/`totalFeesSettled` only for bets placed between answers.
   - `profitParticipants` removed from old daily stat, added to new daily stat.
   - Same-answer resubmissions (higher bond) are no-ops — `settled` flag + answer equality check skip processing.
   - Chains correctly for arbitrary re-answer sequences (A→B→C→...).
7. **No Arbitration Events**: Only `LogNewQuestion` and `LogNewAnswer` are registered in subgraph.yaml. Handlers for `LogAnswerReveal`, `LogNotifyOfArbitrationRequest`, and `LogFinalize` exist in `realitio.ts` but are **not wired** — they never fire.
8. **Mech Fee Correlation**: `profitParticipants` on `DailyProfitStatistic` lists the markets that contributed to PnL on a given day. This is used to cross-reference with the **Mech subgraph** — agents send requests to a Mech to decide how to trade (yes/no) on a market question. By matching market titles between subgraphs, Mech request fees can be attributed to specific profit events at settlement time.

---

## Schema Reference

### TraderAgent
An Autonolas trading agent with cumulative performance metrics.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Agent's multisig address |
| serviceId | `BigInt!` | ServiceRegistryL2 ID |
| firstParticipation | `BigInt` | **Nullable.** Set on first bet (in `processTradeActivity`), not registration |
| lastActive | `BigInt` | Updated on each bet |
| totalBets | `Int!` | All bets regardless of settlement |
| totalTraded | `BigInt!` | All bet amounts (immediate) |
| totalFees | `BigInt!` | All bet fees (immediate) |
| totalPayout | `BigInt!` | All xDAI reclaimed |
| totalTradedSettled | `BigInt!` | Settled markets only |
| totalFeesSettled | `BigInt!` | Settled markets only |
| totalExpectedPayout | `BigInt!` | Sum of expectedPayouts from settled markets |
| bets | `[Bet!]!` | `@derivedFrom(field: "bettor")` |
| dailyProfitStatistics | `[DailyProfitStatistic!]!` | `@derivedFrom(field: "traderAgent")` |
| blockNumber | `BigInt!` | Registration block |
| blockTimestamp | `BigInt!` | Registration timestamp |
| transactionHash | `Bytes!` | Registration tx |

### Bet
Individual trade (Buy or Sell). No `type` field — sells are distinguished by **negative** `amount`.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `txHash.concatI32(logIndex).toHexString()` |
| bettor | `TraderAgent!` | |
| outcomeIndex | `BigInt!` | 0 or 1 for binary markets |
| amount | `BigInt!` | Positive for Buy, **negative** for Sell |
| feeAmount | `BigInt!` | |
| outcomeTokenAmount | `BigInt!` | Tokens bought (positive) or sold (negative) |
| countedInProfit | `Boolean!` | Set true at settlement for all bets |
| countedInTotal | `Boolean` | **Nullable.** Set true at settlement for all bets |
| fixedProductMarketMaker | `FixedProductMarketMakerCreation` | Link to market |
| dailyStatistic | `DailyProfitStatistic` | Link to daily stat when bet was placed |
| timestamp | `BigInt!` | `@deprecated` — use `blockTimestamp` |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

### FixedProductMarketMakerCreation
A prediction market.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Market address |
| creator | `Bytes!` | |
| conditionalTokens | `Bytes!` | |
| collateralToken | `Bytes!` | |
| conditionIds | `[Bytes!]!` | |
| question | `String` | **Nullable.** Parsed from raw question text |
| outcomes | `[String!]` | **Nullable.** Parsed from comma-separated field |
| fee | `BigInt!` | |
| currentAnswer | `Bytes` | Oracle answer (set at settlement) |
| currentAnswerTimestamp | `BigInt` | |
| bets | `[Bet!]!` | `@derivedFrom(field: "fixedProductMarketMaker")` |
| participants | `[MarketParticipant!]!` | `@derivedFrom(field: "fixedProductMarketMaker")` |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | Market creation time |
| transactionHash | `Bytes!` | |

### MarketParticipant
Agent's activity within a specific market.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{agentAddress}_{marketAddress}` |
| traderAgent | `TraderAgent!` | |
| fixedProductMarketMaker | `FixedProductMarketMakerCreation!` | |
| bets | `[Bet!]!` | **Manually managed** array (not derived) |
| totalBets | `Int!` | |
| totalTraded | `BigInt!` | All bets (immediate) |
| totalPayout | `BigInt!` | |
| totalFees | `BigInt!` | All bets (immediate) |
| totalTradedSettled | `BigInt!` | Settled only |
| totalFeesSettled | `BigInt!` | Settled only |
| outcomeTokenBalance0 | `BigInt!` | Net token position for outcome 0 |
| outcomeTokenBalance1 | `BigInt!` | Net token position for outcome 1 |
| expectedPayout | `BigInt!` | Calculated at settlement from token balance |
| settled | `Boolean!` | Idempotency flag — prevents re-processing on same-answer resubmission. Triggers reversal + re-settlement on different-answer re-answer. |
| createdAt | `BigInt!` | |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

### DailyProfitStatistic
Day-to-day agent performance tracker.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{agentAddress}_{dayTimestamp}` |
| traderAgent | `TraderAgent!` | |
| date | `BigInt!` | UTC midnight timestamp |
| bets | `[Bet!]!` | `@derivedFrom(field: "dailyStatistic")` |
| totalBets | `Int!` | Bets placed today |
| totalTraded | `BigInt!` | Volume placed today (immediate) |
| totalFees | `BigInt!` | Fees today (immediate) |
| totalPayout | `BigInt!` | Payouts received today |
| dailyProfit | `BigInt!` | PnL realized today (all at settlement time) |
| profitParticipants | `[FixedProductMarketMakerCreation!]!` | Markets contributing to PnL today (deduplicated) |

### Global
Singleton aggregate statistics (id: `""`).

| Field | Type | Notes |
|-------|------|-------|
| totalTraderAgents | `Int!` | Incremented on registration |
| totalActiveTraderAgents | `Int!` | Incremented on **first bet**, not registration |
| totalBets | `Int!` | All bets including open markets |
| totalPayout | `BigInt!` | |
| totalTraded | `BigInt!` | All bets (immediate) |
| totalFees | `BigInt!` | All bets (immediate) |
| totalTradedSettled | `BigInt!` | Settled only |
| totalFeesSettled | `BigInt!` | Settled only |
| totalExpectedPayout | `BigInt!` | Sum of expectedPayouts from settled markets |

### Supplementary Entities

| Entity | Mutable | Purpose |
|--------|---------|---------|
| CreatorAgent | No | Tracks whitelisted market creators. Fields: `totalQuestions`, block metadata |
| ConditionPreparation | Immutable | Links `conditionId` to `questionId`. Only saved for known questions |
| Question | No | Raw question text + link to FPMM. `currentAnswer`/`currentAnswerTimestamp` updated at settlement |
| PayoutRedemption | Immutable | Debug log for every `PayoutRedemption` event. Fields: redeemer, conditionId, payoutAmount, FPMM, block metadata |
| QuestionFinalized | No | Created by orphaned handlers (never fires in practice) |
| LogNewAnswer | No | Entity exists in schema but unused by active handlers |
| LogSetQuestionFee | Immutable | Exists in schema, no handler creates it |
| LogNewTemplate | Immutable | Exists in schema, no handler creates it |
| LogNotifyOfArbitrationRequest | Immutable | Arbitration tracking. Created by orphaned handler (never fires) |

---

## Event Handlers

### 1. handleCreateMultisigWithAgents
**File**: `src/service-registry-l-2.ts` | **Event**: `CreateMultisigWithAgents(indexed uint256, indexed address)`

- Checks if TraderAgent already exists for the multisig address (prevents duplicates)
- Creates TraderAgent with all counters at zero
- `firstParticipation` and `lastActive` stay **null** until first bet
- Increments `Global.totalTraderAgents` (but NOT `totalActiveTraderAgents` — that happens on first bet)

### 2. handleLogNewQuestion
**File**: `src/realitio.ts` | **Event**: `LogNewQuestion(...)`

- Filters by `CREATOR_ADDRESSES` (lowercase comparison)
- Creates `Question` entity with raw question text
- Question is not linked to FPMM yet — that happens in market creation

### 3. handleFixedProductMarketMakerCreation
**File**: `src/FPMMDeterministicFactoryMapping.ts` | **Event**: `FixedProductMarketMakerCreation(...)`

- **Guard**: Creator must be in `CREATOR_ADDRESSES` AND market not in `BLACKLISTED_MARKETS`
- Creates `FixedProductMarketMakerCreation` entity with all contract params
- **Question linking**:
  - Loads `ConditionPreparation` from first `conditionId`
  - Loads `Question` from condition's `questionId`
  - Parses question text: splits by `\u241f` separator, extracts title (field 0) and outcomes (field 1, comma-separated)
  - Outcomes are cleaned: removes quotes (`"`) and slashes (`/`), trims whitespace
  - Sets `question.fixedProductMarketMaker = marketAddress` (links question to market)
- **CreatorAgent**: Load-or-create pattern, increments `totalQuestions`
- Creates dynamic `FixedProductMarketMaker` template for the new market

### 4. handleConditionPreparation
**File**: `src/conditional-tokens.ts` | **Event**: `ConditionPreparation(...)`

- Only saves conditions where the `questionId` matches a known Question entity
- Creates `ConditionPreparation` linking `conditionId` to `questionId`

### 5. handleBuy / handleSell
**File**: `src/FixedProductMarketMakerMapping.ts` | **Events**: `FPMMBuy(...)`, `FPMMSell(...)`

- **Guard**: Both FPMM and TraderAgent must exist
- **Bet ID**: `event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()` — supports multiple bets per transaction
- **Sell amounts are NEGATIVE**: `BigInt.zero().minus(event.params.returnAmount)`
- Updates `DailyProfitStatistic`: `totalBets`, `totalTraded`, `totalFees` (immediate)
- Calls `processTradeActivity()` which atomically updates:
  - `Global`: totalBets, totalTraded, totalFees
  - `TraderAgent`: totalBets, totalTraded, totalFees, firstParticipation (on first bet), lastActive
  - `MarketParticipant`: creates if needed, adds bet ID to `bets` array, updates totals, tracks `outcomeTokenBalance0`/`outcomeTokenBalance1`
  - `Global.totalActiveTraderAgents` incremented on agent's first-ever bet
- Creates `Bet` entity with `countedInTotal = false`, `countedInProfit = false`, `outcomeTokenAmount`
- Links bet to `fixedProductMarketMaker` and `dailyStatistic`

### 6. handleLogNewAnswer (Settlement — CRITICAL)
**File**: `src/realitio.ts` | **Event**: `LogNewAnswer(...)`

This is the most complex handler. Processes ALL participants in a market when the oracle provides an answer, calculating expected payouts from outcome token balances.

- **Early returns**: Skip commitments (`is_commitment`), unknown questions, questions without FPMM
- Captures `previousAnswer` and `previousAnswerTimestamp` before updating `FPMM`
- Updates `Question` and `FPMM` with `currentAnswer` and `currentAnswerTimestamp`
- Determines `isReAnswer = previousAnswer !== null && previousAnswer != newAnswer`
- Converts answer bytes to BigInt via `bytesToBigInt()` for outcome comparison
- **Initializes Map caches** for `TraderAgent` and `DailyProfitStatistic`
- Loads all participants via `fpmm.participants.load()` and iterates:
  - **Fresh settlement** (participant not yet settled):
    - **Expected payout calculation** from outcome token balances:
      - Answer 0: `expectedPayout = max(0, outcomeTokenBalance0)`
      - Answer 1: `expectedPayout = max(0, outcomeTokenBalance1)`
      - Invalid answer: `expectedPayout = max(0, balance0)/2 + max(0, balance1)/2` (integer division, matches on-chain [1,1] payout split)
    - **Settlement**: `amountToSettle = totalTraded - totalTradedSettled`, `feesToSettle = totalFees - totalFeesSettled`
    - **Profit**: `expectedPayout - amountToSettle - feesToSettle` (added to `dailyProfit` on settlement day)
    - Sets `participant.settled = true`, `totalTradedSettled = totalTraded`, `totalFeesSettled = totalFees`
  - **Re-answer** (participant already settled AND `isReAnswer`):
    - **Reconstruct old profit**: `oldProfit = participant.expectedPayout - participant.totalTradedSettled - participant.totalFeesSettled`
    - **New expected payout**: Same formula as fresh settlement using current token balances + new answer
    - **New profit using full market cost**: `newProfit = newExpectedPayout - participant.totalTraded - participant.totalFees` (NOT incremental — ensures correct reconstruction on subsequent re-answers)
    - **Reverse old daily stat** (via `previousAnswerTimestamp`): `dailyProfit -= oldProfit`, remove market from `profitParticipants`
    - **Apply new daily stat**: `dailyProfit += newProfit`, add market to `profitParticipants`
    - **Agent**: `totalExpectedPayout += (new - old)`, incremental `totalTradedSettled`/`totalFeesSettled` for bets between answers
    - **Participant**: `expectedPayout = newExpectedPayout`, `totalTradedSettled = totalTraded`, `totalFeesSettled = totalFees`, `settled` stays true
  - **Same-answer resubmission** (participant settled AND NOT `isReAnswer`): skipped (no-op)
  - Updates agent `totalTradedSettled`, `totalFeesSettled`, `totalExpectedPayout` (via cache)
  - Updates daily stats `dailyProfit` and `profitParticipants` (via cache)
  - Marks individual bets via `participant.bets` stored array: sets `countedInProfit = true` and `countedInTotal = true`
- **Batch saves** all cached entities via `saveMapValues()`
- Updates `Global` settled totals and `totalExpectedPayout` with accumulated deltas (save condition uses `!equals(BigInt.zero())` to handle negative deltas from re-answers)

### 7. handlePayoutRedemption (Payout Tracking)
**File**: `src/conditional-tokens.ts` | **Event**: `PayoutRedemption(...)`

Tracks actual xDAI claimed by agents. No profit calculation — that's done at settlement.

- **Guard**: Requires ConditionPreparation, Question with FPMM link, MarketParticipant, and TraderAgent to exist
- **Creates `PayoutRedemption`** (immutable entity): records redeemer, conditionId, payoutAmount, FPMM, block metadata for debugging
- **Payout totals**: Adds `payoutAmount` to agent, participant, and global `totalPayout`
- **Daily stats**: Updates `dailyStat.totalPayout` (actual redemption tracking only, no profit changes)

### 8. Orphaned Handlers (NOT registered in subgraph.yaml)
**File**: `src/realitio.ts`

These handlers exist in code but are **not wired** in `subgraph.yaml` — they never fire:
- `handleLogAnswerReveal`: Creates/updates `QuestionFinalized`
- `handleLogNotifyOfArbitrationRequest`: Creates `LogNotifyOfArbitrationRequest`
- `handleLogFinalize`: Creates `QuestionFinalized` with final answer

---

## Utility Functions

All in `src/utils.ts`:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getGlobal` | `(): Global` | Returns singleton Global entity (creates if null) |
| `saveMapValues` | `<T>(map: Map<string, T>): void` | Batch-saves all entities in a Map cache |
| `getDayTimestamp` | `(timestamp: BigInt): BigInt` | Normalizes to UTC midnight: `timestamp / 86400 * 86400` |
| `bytesToBigInt` | `(bytes: Bytes): BigInt` | Converts oracle answer bytes to BigInt (reverses byte order) |
| `getDailyProfitStatistic` | `(agentAddress: Bytes, timestamp: BigInt): DailyProfitStatistic` | Get-or-create daily stat for agent on specific day |
| `addProfitParticipant` | `(statistic: DailyProfitStatistic, marketId: Bytes): void` | Adds market to `profitParticipants` (deduplicates — checks `indexOf` before pushing) |
| `removeProfitParticipant` | `(statistic: DailyProfitStatistic, marketId: Bytes): void` | Removes market from `profitParticipants` (used during re-answer reversal to clean old daily stat) |
| `processTradeActivity` | `(agent, market, betId, amount, fees, timestamp, blockNumber, txHash, outcomeIndex, outcomeTokenAmount): void` | **Main consolidated update function.** Atomically updates Global (totalBets, totalTraded, totalFees), TraderAgent (totalBets, totalTraded, totalFees, firstParticipation, lastActive), and MarketParticipant (creates if needed, adds bet to bets array, updates outcomeTokenBalance0/1). Increments `Global.totalActiveTraderAgents` on agent's first bet. |

---

## Accounting Rules

### Volume Attribution

| Phase | DailyProfitStatistic.totalTraded | Agent.totalTraded | Agent.totalTradedSettled | Global.totalTraded | Global.totalTradedSettled |
|-------|----------------------------------|-------------------|-------------------------|-------------------|--------------------------|
| **Bet Placed** | Recorded | Recorded | - | Recorded | - |
| **Settlement** | - | - | Added (all bets) | - | Added (all bets) |

Same pattern applies to `totalFees` / `totalFeesSettled`.

### Profit/Loss Attribution

All profit/loss is calculated at settlement time using outcome token balances:

| Scenario | When | Handler | DailyProfitStatistic Impact |
|----------|------|---------|----------------------------|
| **All bets** | Settlement day | `handleLogNewAnswer` | `dailyProfit += (expectedPayout - amount - fees)` |
| **Payout claim** | Payout day | `handlePayoutRedemption` | Only `totalPayout` updated, no `dailyProfit` change |

### Expected Payout Calculation

At settlement (`handleLogNewAnswer`), expected payout is calculated from outcome token balances:

| Answer | Formula |
|--------|---------|
| 0 (No) | `expectedPayout = max(0, outcomeTokenBalance0)` |
| 1 (Yes) | `expectedPayout = max(0, outcomeTokenBalance1)` |
| Invalid (0xff..ff) | `expectedPayout = max(0, balance0)/2 + max(0, balance1)/2` (integer division, matches on-chain [1,1] payout split) |

### State Tracking

| Flag/Field | Type | Purpose | Set By |
|------------|------|---------|--------|
| `MarketParticipant.settled` | `Boolean!` | Idempotency — prevents re-processing on same-answer resubmission. On different-answer re-answer, triggers reversal + re-settlement instead of skip. | `handleLogNewAnswer` |
| `Bet.countedInTotal` | `Boolean` (nullable) | Legacy flag, set at settlement for all bets | `handleLogNewAnswer` |
| `Bet.countedInProfit` | `Boolean!` | Legacy flag, set at settlement for all bets | `handleLogNewAnswer` |

**Note**: `countedInTotal` is nullable — legacy entities may have `null`. Primary idempotency is now via `participant.settled`.

### Profit Formula

**Fresh settlement** (first answer):
```
amountToSettle = participant.totalTraded - participant.totalTradedSettled
feesToSettle = participant.totalFees - participant.totalFeesSettled
profit = expectedPayout - amountToSettle - feesToSettle
```

**Re-answer** (answer changes — reversal + new settlement):
```
oldProfit = participant.expectedPayout - participant.totalTradedSettled - participant.totalFeesSettled
newProfit = newExpectedPayout - participant.totalTraded - participant.totalFees  (full market cost)
```
Full market cost is used (not incremental) so that `oldProfit` reconstruction always works: after each settlement, `totalTradedSettled = totalTraded`, so the formula `expectedPayout - totalTradedSettled - totalFeesSettled` consistently reproduces what was stored.

---

## Performance Patterns

- **Map Caching** (`handleLogNewAnswer`): Uses `Map<string, Entity>` caches for TraderAgent, MarketParticipant, and DailyProfitStatistic. Each entity loaded once, modified in memory, saved once at end. Reduces I/O ~90% for large markets.
- **Batch Saves**: `saveMapValues()` iterates cached Map and calls `.save()` on each entity.
- **Selective Indexing**: Early returns for non-whitelisted creators/agents. Keeps database lean.
- **Delta Accumulation**: Global settled totals accumulated as deltas during loop, applied once at end.
- **Minimal Saves**: Bets only saved if actually modified (tracked via `betModified` boolean).

---

## Constants

From `src/constants.ts`:

```typescript
CREATOR_ADDRESSES = [
  "0x89c5cc945dd550bcffb72fe42bff002429f46fec",
  "0xffc8029154ecd55abed15bd428ba596e7d23f557"
]
BLACKLISTED_MARKETS = [
  "0xe7ed8a5f2f0f17f7d584ae8ddd0592d1ac67791f",
  "0xbfa584b29891941c8950ce975c1f7fa595ce1b99"
]
QUESTION_SEPARATOR = "\u241f"   // Unicode separator
ONE_DAY = BigInt.fromI32(86400) // seconds
```

---

## Configuration

### Data Sources (subgraph.yaml)

| Data Source | Events Registered | Handler File |
|-------------|-------------------|--------------|
| ServiceRegistryL2 | `CreateMultisigWithAgents` | `service-registry-l-2.ts` |
| ConditionalTokens | `ConditionPreparation`, `PayoutRedemption` | `conditional-tokens.ts` |
| FPMMDeterministicFactory | `FixedProductMarketMakerCreation` | `FPMMDeterministicFactoryMapping.ts` |
| Realitio | `LogNewQuestion`, `LogNewAnswer` | `realitio.ts` |

### Dynamic Template

| Template | Events | Handler File |
|----------|--------|--------------|
| FixedProductMarketMaker | `FPMMBuy`, `FPMMSell` | `FixedProductMarketMakerMapping.ts` |

**Spec**: v1.0.0 | **API**: 0.0.7 | **Network**: gnosis | **Pruning**: auto

**Note**: Realitio source only registers 2 of 5 available events. The other 3 (`LogAnswerReveal`, `LogFinalize`, `LogNotifyOfArbitrationRequest`) have handlers in code but are NOT in subgraph.yaml.

---

## Testing

**Framework**: Matchstick-as v0.6.0 | **Files**: `tests/profit.test.ts`, `tests/profit.ts`

### Test Helpers (`tests/profit.ts`)
- `createBuyEvent(buyer, investment, fee, outcomeIndex, fpmm, timestamp, logIndex?, outcomeTokensBought?)`
- `createNewAnswerEvent(questionId, answer, timestamp)`
- `createPayoutRedemptionEvent(redeemer, payout, conditionId, timestamp)`

### Test Coverage (19 tests)

| Test | Validates |
|------|-----------|
| Day 1: Activity recorded, profit = 0 | Immediate totalTraded/totalFees, deferred dailyProfit |
| Day 3: Market resolution loss | Negative dailyProfit on settlement day, expectedPayout = 0 |
| Day 7: Payout redemption win | totalPayout updated, dailyProfit unchanged (profit already at settlement) |
| Complex multi-market | Split bets, simultaneous win/loss across markets |
| Multiple losing bets | All losses processed in single settlement |
| Aggregation: two markets same day | Correct dailyProfit sum, 2 profitParticipants |
| Settled totals: incorrect bet path | totalTradedSettled updates at settlement |
| Settled totals: correct bet path | totalTradedSettled updates at settlement (not payout) |
| Mixed bets: different settlement times | Both correct and incorrect settled at resolution |
| Multiple markets: aggregate settled totals | Cross-market settled total accumulation |
| Global entity tracking | Global settled totals and totalExpectedPayout across agents |
| Same-answer resubmission (idempotency) | participant.settled flag prevents double-counting on same answer |
| **Re-answer: losing to winning** | Old loss reversed from day 3, new full profit on day 4, agent/global expectedPayout corrected |
| **Re-answer: winning to losing** | Old win reversed, negative expectedPayout delta saved to global |
| **Re-answer: valid to invalid** | [1,1] split payout applied on re-answer, old profit reversed |
| **Triple re-answer (A→B→C)** | Chains correctly — each re-answer reverses previous, applies new full profit |
| Comprehensive multi-agent | Full lifecycle: 2 agents, 2 markets, all phases |
| PayoutRedemption creates PayoutRedemption | Immutable log entity with correct fields |
| Invalid answer: expectedPayout = balance0/2 + balance1/2 | Correct payout for invalid markets with [1,1] split |

---

## Development Workflow

```bash
# Install dependencies
yarn install

# Generate TypeScript from schema + ABIs
yarn codegen

# Compile to WebAssembly
yarn build

# Run unit tests
yarn test

# Deploy
graph deploy --studio autonolas-predict
```

### Adding a New Whitelisted Creator
1. Add address to `CREATOR_ADDRESSES` in `src/constants.ts`
2. `yarn build && graph deploy`

### Adding a New Entity Field
1. Add field to `schema.graphql`
2. `yarn codegen` to regenerate bindings
3. Initialize field in relevant handlers
4. `yarn build && graph deploy`

---

## Common Queries

### Agent PnL with Markets
```graphql
{
  dailyProfitStatistics(where: { traderAgent: "0x..." }, orderBy: date) {
    date
    dailyProfit
    totalTraded
    totalFees
    totalPayout
    profitParticipants { id, question, outcomes }
  }
}
```

### Agent Performance Summary
```graphql
{
  traderAgent(id: "0x...") {
    serviceId
    totalBets
    totalTraded
    totalTradedSettled
    totalPayout
    totalFees
    firstParticipation
    lastActive
  }
}
```

### Global Statistics
```graphql
{
  globals {
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalTradedSettled
    totalPayout
    totalFees
  }
}
```

### Market Details with Participants
```graphql
{
  fixedProductMarketMakerCreation(id: "0x...") {
    question
    outcomes
    currentAnswer
    currentAnswerTimestamp
    participants {
      traderAgent { id }
      totalBets
      totalTraded
      totalPayout
    }
    bets(orderBy: blockTimestamp) {
      bettor { id }
      amount
      feeAmount
      outcomeIndex
      blockTimestamp
    }
  }
}
```

---

## AI Summary

### Critical Points
1. **All financial fields are `BigInt`** — no BigDecimal anywhere in the codebase.
2. **Two-tier accounting**: `totalTraded`/`totalFees` recorded immediately; `totalTradedSettled`/`totalFeesSettled` settled at `handleLogNewAnswer` for ALL bets.
3. **Settlement-day profit**: ALL profit/loss calculated at settlement time using outcome token balances. `expectedPayout` computed from `outcomeTokenBalance0`/`outcomeTokenBalance1`.
4. **Payout tracking is separate**: `handlePayoutRedemption` only updates `totalPayout` and creates `PayoutRedemption`. No profit calculation.
5. **Invalid answer handling**: `payoutNumerators = [1, 1]` → `expectedPayout = balance0/2 + balance1/2` (integer division).
6. **Sell bets use negative amounts**: No `type` field on Bet — check `amount` sign. Token amounts also negative for sells.
7. **Participant-level settlement with re-answer support**: `participant.settled` flag provides idempotency for same-answer resubmissions. For different-answer re-answers, the handler reverses old profit and applies new full profit (`expectedPayout - totalTraded - totalFees`). Iteration is over `fpmm.participants.load()`, not `fpmm.bets.load()` (fewer entities, pruning-resilient).
8. **`processTradeActivity()`** is the consolidated function for all trade updates (agent, participant, global). Tracks outcome token balances. Increments `totalActiveTraderAgents` on first bet.
9. **Caching is essential**: `handleLogNewAnswer` uses Map caches for TraderAgent and DailyProfitStatistic, delta accumulation for Global.
10. **Only 2 of 5 Realitio events are registered**: `LogNewQuestion` and `LogNewAnswer`. Other handlers are orphaned code.
11. **Re-answer profit uses full market cost**: `newProfit = newExpectedPayout - totalTraded - totalFees` (not incremental). This is critical for correct `oldProfit` reconstruction on subsequent re-answers, since `totalTradedSettled = totalTraded` after each settlement.
12. **`totalExpectedPayout` vs `totalPayout`**: Compare these on TraderAgent/Global to measure claim rate (how much agents actually redeem vs what they're entitled to).
