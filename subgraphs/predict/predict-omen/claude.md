# Autonolas Predict Omen Subgraph - Technical Implementation Guide

> **AI Assistant Context**: This document provides comprehensive technical details about the Predict subgraph's architecture, patterns, and implementation for AI-assisted development.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Core Data Model](#core-data-model)
- [Event Handlers & Data Flow](#event-handlers--data-flow)
- [Performance Optimizations](#performance-optimizations)
- [Accounting Rules](#accounting-rules)
- [Key Technical Patterns](#key-technical-patterns)
- [Common Queries](#common-queries)
- [Testing Strategy](#testing-strategy)

---

## Architecture Overview

### Purpose
A GraphQL API for tracking prediction markets and Autonolas agent performance on Gnosis Chain. Indexes binary prediction markets created by whitelisted agents and tracks trading activity, profit/loss attribution, and market settlements.

### Directory Structure
```
subgraphs/predict/
├── schema.graphql           # GraphQL schema definitions
├── subgraph.yaml            # Subgraph configuration & event mappings
├── src/
│   ├── service-registry-l-2.ts           # Agent registration
│   ├── conditional-tokens.ts              # Payout redemption logic
│   ├── realitio.ts                        # Oracle answers & settlement
│   ├── FixedProductMarketMakerMapping.ts # Buy/Sell activity
│   ├── FPMMDeterministicFactoryMapping.ts# Market creation
│   ├── utils.ts                           # Helper functions
│   └── constants.ts                       # Whitelists & configs
├── tests/
│   ├── profit.test.ts                    # Unit tests
│   └── profit.ts                          # Test helpers
└── generated/                             # Auto-generated bindings
```

### Key Contracts
1. **ServiceRegistryL2** (0x9338b5153AE39BB89f50468E608eD9d764B755fD) - Agent registration
2. **ConditionalTokens** (0xCeAfDD6bc0bEF976fdCd1112955828E00543c0Ce) - Payouts
3. **FPMMDeterministicFactory** (0x9083A2B699c0a4AD06F63580BDE2635d26a3eeF0) - Market creation
4. **Realitio** (0x79e32aE03fb27B07C89c0c568F80287C01ca2E57) - Oracle

### Core Business Rules

1.  **Selective Tracking**: 
    * **Agents**: Only tracks agents registered through `ServiceRegistryL2`.
    * **Markets**: Only indexes binary markets created by whitelisted creator agents.
2.  **Market Lifecycle**: 4-day trading window; payouts 24+ hours after closing.
3.  **Accounting & Statistics**:
    * **Settlement-Based Totals**: Global/agent `totalTraded` and `totalFees` update ONLY when a market closes.
    * **Split Profit Attribution**: 
        * **Losses**: Recorded on **Market Settlement Day** (for incorrect bets).
        * **Wins**: Recorded on **Payout Redemption Day** (Net: Payout - Costs).
4.  **No Arbitration**: Expected single `LogNewAnswer` per market. Arbitration events are ignored.
5.  **Invalid Markets**: Handled automatically. If "Invalid", all bets are treated as losses during settlement.
6.  **Mech Fee Analysis**: `profitParticipants` allows correlation between PnL events and market metadata for external fee tracking.

---

## Core Data Model

### Primary Entities (schema.graphql)

#### TraderAgent
Represents an Autonolas trading agent with cumulative performance metrics.

**Key Fields:**
```graphql
type TraderAgent @entity {
  id: Bytes!                    # Agent's multisig address
  serviceId: BigInt!            # ServiceRegistryL2 ID

  # Activity tracking
  firstParticipation: BigInt!
  lastActive: BigInt!
  totalBets: BigInt!

  # Financial metrics (SETTLED MARKETS ONLY)
  totalTraded: BigDecimal!      # Volume (added at settlement)
  totalFees: BigDecimal!        # Fees (added at settlement)
  totalPayout: BigDecimal!      # All xDAI reclaimed

  # Relationships
  bets: [Bet!]! @derivedFrom(field: "bettor")
  dailyProfitStatistics: [DailyProfitStatistic!]! @derivedFrom(field: "traderAgent")
}
```

**Critical Rule**: `totalTraded` and `totalFees` are updated **only when a market closes**, not when bets are placed.

---

#### Bet
Individual trade (Buy or Sell).

**Key Fields:**
```graphql
type Bet @entity {
  id: Bytes!                    # Transaction hash
  bettor: TraderAgent!
  fpmm: FixedProductMarketMakerCreation!

  # Trade details
  type: String!                 # "Buy" or "Sell"
  amount: BigDecimal!           # Positive for Buy, negative for Sell
  feeAmount: BigDecimal!
  outcomeIndex: BigInt!         # 0 or 1 for binary markets

  # Accounting flags
  countedInTotal: Boolean!      # Added to totalTraded? (at settlement)
  countedInProfit: Boolean!     # Added to dailyProfit? (at settlement/payout)

  timestamp: BigInt!
}
```

**Critical Flags:**
- `countedInTotal`: Prevents double-counting volume in agent/global totals
- `countedInProfit`: Prevents double-processing PnL impact

---

#### DailyProfitStatistic
Day-to-day agent performance tracker.

**Key Fields:**
```graphql
type DailyProfitStatistic @entity {
  id: ID!                       # {agentAddress}_{dayTimestamp}
  traderAgent: TraderAgent!
  date: BigInt!                 # UTC midnight timestamp

  # Activity placed on this day
  totalBets: BigInt!
  totalTraded: BigDecimal!      # Volume PLACED this day
  totalFees: BigDecimal!

  # PnL adjusted on this day
  dailyProfit: BigDecimal!      # Losses (settlement) or Wins (payout)

  # Markets that contributed to PnL
  profitParticipants: [FixedProductMarketMakerCreation!]!
}
```

**Critical Distinction:**
- `totalTraded`: Volume **placed** on this specific day (immediate)
- `dailyProfit`: PnL **realized** on this day (delayed until settlement/payout)

---

#### FixedProductMarketMakerCreation
A prediction market.

**Key Fields:**
```graphql
type FixedProductMarketMakerCreation @entity {
  id: Bytes!                    # Market address
  creator: Bytes!
  creationTimestamp: BigInt!

  # Market details
  question: String!
  outcomes: [String!]!

  # Settlement
  currentAnswer: Bytes          # Oracle answer
  currentAnswerTimestamp: BigInt

  # Relationships
  bets: [Bet!]! @derivedFrom(field: "fpmm")
  participants: [MarketParticipant!]! @derivedFrom(field: "fpmm")
}
```

---

#### MarketParticipant
Agent's activity within a specific market.

**Key Fields:**
```graphql
type MarketParticipant @entity {
  id: ID!                       # {agentAddress}_{marketAddress}
  traderAgent: TraderAgent!
  fpmm: FixedProductMarketMakerCreation!

  # Per-market statistics
  totalBets: BigInt!
  totalTraded: BigDecimal!
  totalPayout: BigDecimal!
  totalFees: BigDecimal!
}
```

---

#### Global
Aggregate statistics across all agents.

**Key Fields:**
```graphql
type Global @entity {
  id: ID!                       # Singleton: "1"

  totalTraderAgents: BigInt!
  totalActiveTraderAgents: BigInt!
  totalBets: BigInt!

  # Financial metrics (SETTLED MARKETS ONLY)
  totalTraded: BigDecimal!
  totalFees: BigDecimal!
  totalPayout: BigDecimal!
}
```

---

## Event Handlers & Data Flow

### 1. Agent Registration (service-registry-l-2.ts)

**Event**: `CreateMultisigWithAgents(serviceId, multisig)`

**Handler**: `handleCreateMultisigWithAgents`

```typescript
export function handleCreateMultisigWithAgents(event: CreateMultisigWithAgents): void {
  let agent = new TraderAgent(event.params.multisig);
  agent.serviceId = event.params.serviceId;
  agent.totalBets = BigInt.fromI32(0);
  agent.totalTraded = BigDecimal.fromString("0");
  agent.totalFees = BigDecimal.fromString("0");
  agent.totalPayout = BigDecimal.fromString("0");
  agent.save();

  let global = getGlobal();
  global.totalTraderAgents = global.totalTraderAgents.plus(BigInt.fromI32(1));
  global.save();
}
```

**Pattern**: Only registered agents are tracked (selective indexing).

---

### 2. Market Creation (FPMMDeterministicFactoryMapping.ts)

**Event**: `FixedProductMarketMakerCreation(creator, fixedProductMarketMaker, ...)`

**Handler**: `handleFixedProductMarketMakerCreation`

```typescript
export function handleFixedProductMarketMakerCreation(
  event: FixedProductMarketMakerCreation
): void {
  // Whitelist check
  if (!CREATOR_ADDRESSES.includes(event.params.creator.toHexString())) {
    return;
  }

  // Blacklist check
  if (BLACKLISTED_MARKETS.includes(event.params.fixedProductMarketMaker.toHexString())) {
    return;
  }

  // Parse question and outcomes
  let questionParts = event.params.question.split(QUESTION_SEPARATOR);

  // Create FPMM entity
  let fpmm = new FixedProductMarketMakerCreation(event.params.fixedProductMarketMaker);
  fpmm.question = questionParts[0];
  fpmm.outcomes = [questionParts[1], questionParts[2]];
  fpmm.save();

  // Create dynamic data source for market trades
  FixedProductMarketMakerTemplate.create(event.params.fixedProductMarketMaker);
}
```

**Pattern**: Dynamic data sources - each market gets its own event handlers for `FPMMBuy` and `FPMMSell`.

---

### 3. Trading Activity (FixedProductMarketMakerMapping.ts)

**Events**: `FPMMBuy(buyer, investmentAmount, feeAmount, outcomeIndex, ...)`

**Handlers**: `handleBuy`, `handleSell`

```typescript
export function handleBuy(event: FPMMBuy): void {
  let agent = TraderAgent.load(event.params.buyer);
  if (!agent) return; // Only track registered agents

  // Create Bet entity
  let bet = new Bet(event.transaction.hash);
  bet.bettor = agent.id;
  bet.fpmm = event.address;
  bet.type = "Buy";
  bet.amount = event.params.investmentAmount.toBigDecimal();
  bet.feeAmount = event.params.feeAmount.toBigDecimal();
  bet.outcomeIndex = event.params.outcomeIndex;
  bet.countedInTotal = false;    // Will be set to true at settlement
  bet.countedInProfit = false;   // Will be set to true at settlement/payout
  bet.timestamp = event.block.timestamp;
  bet.save();

  // Update DailyProfitStatistic (activity placed today)
  let dailyStat = getDailyProfitStatistic(agent.id, event.block.timestamp);
  dailyStat.totalBets = dailyStat.totalBets.plus(BigInt.fromI32(1));
  dailyStat.totalTraded = dailyStat.totalTraded.plus(bet.amount);
  dailyStat.totalFees = dailyStat.totalFees.plus(bet.feeAmount);
  dailyStat.save();

  // Update agent activity
  updateTraderAgentActivity(agent, event.block.timestamp);
  agent.totalBets = agent.totalBets.plus(BigInt.fromI32(1));
  agent.save();

  // Update MarketParticipant
  updateMarketParticipantActivity(agent.id, event.address, event.block.timestamp);

  // Increment global bet counter
  incrementGlobalTotalBets();
}
```

**Key Pattern**: Activity is recorded immediately, but `totalTraded`/`totalFees` for agent/global are deferred until settlement.

---

### 4. Market Settlement (realitio.ts) - CRITICAL HANDLER

**Event**: `LogNewAnswer(question_id, answer, is_commitment, ...)`

**Handler**: `handleLogNewAnswer`

This is the most complex and performance-critical handler in the subgraph.

```typescript
export function handleLogNewAnswer(event: LogNewAnswer): void {
  // Skip commitments (we only care about final answers)
  if (event.params.is_commitment) return;

  // Load question and validate
  let question = Question.load(event.params.question_id);
  if (!question || !question.fixedProductMarketMaker) return;

  // Update question and FPMM with answer
  question.currentAnswer = event.params.answer;
  question.currentAnswerTimestamp = event.block.timestamp;
  question.save();

  let fpmm = FixedProductMarketMakerCreation.load(question.fixedProductMarketMaker);
  if (!fpmm) return;

  fpmm.currentAnswer = event.params.answer;
  fpmm.currentAnswerTimestamp = event.block.timestamp;
  fpmm.save();

  // Convert answer bytes to BigInt for comparison
  let answerBigInt = bytesToBigInt(event.params.answer);

  // PERFORMANCE OPTIMIZATION: Initialize caches
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();

  let global = getGlobal();

  // Process all bets in the market
  for (let i = 0; i < fpmm.bets.length; i++) {
    let bet = Bet.load(fpmm.bets[i]);
    if (!bet) continue;

    // Load agent from cache (or database if not cached)
    let agentId = bet.bettor.toHexString();
    let agent = agentCache.has(agentId)
      ? agentCache.get(agentId)!
      : TraderAgent.load(bet.bettor)!;

    // Load market participant from cache (or database)
    let participantId = agentId + "_" + fpmm.id.toHexString();
    let participant = participantCache.has(participantId)
      ? participantCache.get(participantId)!
      : MarketParticipant.load(Bytes.fromUTF8(participantId))!;

    // UPDATE TOTALS (if not already counted)
    if (!bet.countedInTotal) {
      agent.totalTraded = agent.totalTraded.plus(bet.amount.abs());
      agent.totalFees = agent.totalFees.plus(bet.feeAmount);
      participant.totalTraded = participant.totalTraded.plus(bet.amount.abs());
      participant.totalFees = participant.totalFees.plus(bet.feeAmount);
      global.totalTraded = global.totalTraded.plus(bet.amount.abs());
      global.totalFees = global.totalFees.plus(bet.feeAmount);
      bet.countedInTotal = true;
    }

    // REALIZE LOSSES (if bet was wrong and not already counted)
    if (!bet.countedInProfit && bet.outcomeIndex != answerBigInt) {
      // Load daily stat from cache (or create new)
      let dayTimestamp = getDayTimestamp(event.block.timestamp);
      let dailyStatId = agentId + "_" + dayTimestamp.toString();
      let dailyStat = dailyStatsCache.has(dailyStatId)
        ? dailyStatsCache.get(dailyStatId)!
        : getDailyProfitStatistic(bet.bettor, event.block.timestamp);

      // Deduct loss: spent amount + fees
      let lossAmount = bet.amount.abs().plus(bet.feeAmount);
      dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);

      // Track which market contributed to this loss
      addProfitParticipant(dailyStat, fpmm.id);

      dailyStatsCache.set(dailyStatId, dailyStat);
      bet.countedInProfit = true;
    }

    bet.save();
    agentCache.set(agentId, agent);
    participantCache.set(participantId, participant);
  }

  // BATCH SAVE: Save all cached entities once
  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);
  global.save();
}
```

**Critical Optimizations:**
1. **Entity Caching**: Each entity loaded once, saved once (reduces I/O by ~90%)
2. **Batch Saves**: All updates buffered in memory, written in single operation
3. **Early Returns**: Skip irrelevant events immediately

**Accounting Logic:**
- **Update Totals**: If `countedInTotal == false`, add volume/fees to agent/global totals
- **Realize Losses**: If `countedInProfit == false` AND `outcomeIndex != answer`, deduct `amount + fees` from `dailyProfit` on settlement day

---

### 5. Payout Redemption (conditional-tokens.ts)

**Event**: `PayoutRedemption(redeemer, payout, conditionId, ...)`

**Handler**: `handlePayoutRedemption`

```typescript
export function handlePayoutRedemption(event: PayoutRedemption): void {
  let agent = TraderAgent.load(event.params.redeemer);
  if (!agent) return;

  // Update agent's total payout
  let payoutAmount = event.params.payout.toBigDecimal();
  updateTraderAgentPayout(agent, payoutAmount);

  // Traverse: condition → question → FPMM
  let condition = Condition.load(event.params.conditionId);
  if (!condition) return;

  let question = Question.load(condition.question);
  if (!question || !question.fixedProductMarketMaker) return;

  let fpmm = FixedProductMarketMakerCreation.load(question.fixedProductMarketMaker);
  if (!fpmm) return;

  // Update global and market participant payouts
  updateGlobalPayout(payoutAmount);
  let participantId = agent.id.toHexString() + "_" + fpmm.id.toHexString();
  let participant = MarketParticipant.load(Bytes.fromUTF8(participantId));
  if (participant) {
    updateMarketParticipantPayout(participant, payoutAmount);
  }

  // Calculate net profit: payout - total costs
  let totalCosts = BigDecimal.fromString("0");

  for (let i = 0; i < fpmm.bets.length; i++) {
    let bet = Bet.load(fpmm.bets[i]);
    if (!bet || bet.bettor != agent.id) continue;
    if (bet.countedInProfit) continue; // Already counted

    // Sum up costs: amount + fees
    totalCosts = totalCosts.plus(bet.amount.abs()).plus(bet.feeAmount);
    bet.countedInProfit = true;
    bet.save();
  }

  // Net profit = payout - costs
  let netProfit = payoutAmount.minus(totalCosts);

  // Record profit on redemption day
  let dailyStat = getDailyProfitStatistic(agent.id, event.block.timestamp);
  dailyStat.dailyProfit = dailyStat.dailyProfit.plus(netProfit);
  addProfitParticipant(dailyStat, fpmm.id);
  dailyStat.save();
}
```

**Accounting Logic:**
- **Net Profit** = `payout - (Σ bet.amount + Σ bet.feeAmount)` for uncounted winning bets
- **Recorded On**: Payout redemption day (not settlement day)
- **Tracking**: Market added to `profitParticipants` array

---

## Performance Optimizations

### 1. Caching Strategy (handleLogNewAnswer)

**Problem**: Processing 1000+ bets per market caused O(n²) database queries.

**Solution**: Internal `Map` caches for entities accessed multiple times:

```typescript
let dailyStatsCache = new Map<string, DailyProfitStatistic>();
let agentCache = new Map<string, TraderAgent>();
let participantCache = new Map<string, MarketParticipant>();

// Load once
let agent = agentCache.has(id)
  ? agentCache.get(id)!
  : TraderAgent.load(id)!;

// Use multiple times
agent.totalTraded = agent.totalTraded.plus(bet.amount);
agent.totalFees = agent.totalFees.plus(bet.feeAmount);

// Cache for reuse
agentCache.set(id, agent);

// Save once at end
saveMapValues(agentCache);
```

**Impact**: Reduced execution time by ~90% for large markets.

---

### 2. Batch Saves

All entity modifications buffered in memory, single `save()` call per entity:

```typescript
// utils.ts
export function saveMapValues<T extends Entity>(map: Map<string, T>): void {
  let values = map.values();
  for (let i = 0; i < values.length; i++) {
    values[i].save();
  }
}
```

**Impact**: Minimizes I/O overhead.

---

### 3. Selective Indexing

Early returns for non-whitelisted creators/agents:

```typescript
// Only process markets from approved creators
if (!CREATOR_ADDRESSES.includes(event.params.creator.toHexString())) {
  return;
}

// Only track registered agents
let agent = TraderAgent.load(event.params.buyer);
if (!agent) return;
```

**Impact**: Keeps database lean and queries fast.

---

### 4. Flag-Based State Tracking

Boolean flags prevent re-processing:

```typescript
// Prevent double-counting volume
if (!bet.countedInTotal) {
  agent.totalTraded = agent.totalTraded.plus(bet.amount);
  bet.countedInTotal = true;
}

// Prevent double-processing PnL
if (!bet.countedInProfit && bet.outcomeIndex != answer) {
  dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);
  bet.countedInProfit = true;
}
```

**Impact**: No need to query historical state.

---

## Accounting Rules

### Volume Attribution

| Phase | DailyProfitStatistic.totalTraded | TraderAgent.totalTraded | Global.totalTraded |
|-------|----------------------------------|-------------------------|-------------------|
| **Bet Placed** | ✅ Recorded immediately | ❌ Not yet | ❌ Not yet |
| **Market Settled** | (no change) | ✅ Added | ✅ Added |

**Critical Rule**: Agent/global `totalTraded` reflects **settled volume only**.

---

### Profit/Loss Attribution

| Scenario | When Recorded | DailyProfitStatistic Impact | Date |
|----------|--------------|----------------------------|------|
| **Loss** | Market settlement | `dailyProfit -= (amount + fees)` | Settlement day |
| **Win** | Payout redemption | `dailyProfit += (payout - costs)` | Redemption day |

**Critical Rules:**
- **Losses**: Recorded on market settlement day (when `LogNewAnswer` arrives)
  - For bets where `bet.outcomeIndex != answer`
  - Deduct `bet.amount + bet.feeAmount`
- **Wins**: Recorded on payout redemption day
  - Only for bets not already counted as losses
  - Add `payout - total_costs`

---

### Race Condition Prevention

**Flags:**
- `countedInTotal`: Prevents double-counting volume in totals
- `countedInProfit`: Prevents double-processing PnL impact

**Caching:**
- Ensures entity consistency within handler execution
- All bets for a market processed with same agent/stat state

---

## Key Technical Patterns

### 1. Two-Phase Accounting

**Phase 1 (Trading)**: Record activity, defer totals
```typescript
// Immediate: Daily activity
dailyStat.totalTraded += bet.amount;

// Deferred: Agent/global totals
bet.countedInTotal = false; // Will be set at settlement
```

**Phase 2 (Settlement/Payout)**: Finalize totals and PnL
```typescript
// At settlement: Update totals
if (!bet.countedInTotal) {
  agent.totalTraded += bet.amount;
  bet.countedInTotal = true;
}

// At settlement/payout: Update PnL
if (!bet.countedInProfit) {
  dailyStat.dailyProfit += netProfit;
  bet.countedInProfit = true;
}
```

---

### 2. Composite Entity IDs

Enable efficient lookups and prevent duplicates:

```typescript
// MarketParticipant
let id = agent.id.toHexString() + "_" + market.id.toHexString();

// DailyProfitStatistic
let dayTimestamp = getDayTimestamp(timestamp);
let id = agent.id.toHexString() + "_" + dayTimestamp.toString();
```

---

### 3. Derived Fields

Automatically maintained relationships:

```graphql
type TraderAgent @entity {
  bets: [Bet!]! @derivedFrom(field: "bettor")
  dailyProfitStatistics: [DailyProfitStatistic!]! @derivedFrom(field: "traderAgent")
}
```

No manual array management needed.

---

### 4. Conditional Early Returns

Fail fast for irrelevant events:

```typescript
if (!whitelisted) return;
if (is_commitment) return;
if (!agent) return;
if (!question || !question.fixedProductMarketMaker) return;
```

Minimizes wasted processing.

---

### 5. Entity Caching Pattern

Standard pattern for high-frequency entity access:

```typescript
let cache = new Map<string, Entity>();

// Load once
let entity = cache.has(id)
  ? cache.get(id)!
  : Entity.load(id)!;

// Use multiple times
entity.field1 = value1;
entity.field2 = value2;

// Cache for reuse
cache.set(id, entity);

// Save once at end
saveMapValues(cache);
```

---

## Common Queries

### Agent PnL with Involved Markets

```graphql
{
  dailyProfitStatistics(
    where: { traderAgent: "0x..." }
    orderBy: date
    orderDirection: asc
  ) {
    date
    dailyProfit
    totalTraded
    totalFees
    profitParticipants {
      id
      question
      outcomes
    }
  }
}
```

**Use Case**: Track which markets contributed to profit/loss each day.

---

### Agent Performance Summary

```graphql
{
  traderAgent(id: "0x...") {
    serviceId
    totalBets
    totalTraded
    totalPayout
    totalFees
    firstParticipation
    lastActive
    dailyProfitStatistics(orderBy: date) {
      date
      dailyProfit
      totalTraded
    }
  }
}
```

**Use Case**: Comprehensive agent performance overview.

---

### Global Statistics

```graphql
{
  globals {
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalPayout
    totalFees
  }
}
```

**Use Case**: Platform-wide metrics dashboard.

---

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
      totalFees
    }
    bets(orderBy: timestamp) {
      bettor { id }
      type
      amount
      feeAmount
      outcomeIndex
      timestamp
    }
  }
}
```

**Use Case**: Detailed market analysis with all participants and bets.

---

### Active Markets (Not Settled)

```graphql
{
  fixedProductMarketMakerCreations(
    where: { currentAnswer: null }
    orderBy: creationTimestamp
    orderDirection: desc
  ) {
    id
    question
    outcomes
    creationTimestamp
  }
}
```

**Use Case**: List all open markets.

---

### Recently Settled Markets

```graphql
{
  fixedProductMarketMakerCreations(
    where: { currentAnswer_not: null }
    orderBy: currentAnswerTimestamp
    orderDirection: desc
    first: 10
  ) {
    id
    question
    outcomes
    currentAnswer
    currentAnswerTimestamp
  }
}
```

**Use Case**: Recent market resolutions.

---

## Testing Strategy

### Framework
- **Matchstick-as**: AssemblyScript testing for subgraphs
- Located in: `tests/`

### Test Coverage (profit.test.ts)

#### 1. Basic Placement
```typescript
test("Basic bet placement records activity, profit = 0", () => {
  handleBuy(createBuyEvent(...));

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "totalTraded", "100");
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "0");
});
```

**Validates**: Activity recorded immediately, PnL deferred.

---

#### 2. Immediate Loss
```typescript
test("Market resolves against bet → negative profit on settlement day", () => {
  handleBuy(createBuyEvent(...));
  handleNewAnswer(createNewAnswerEvent(...)); // Wrong outcome

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "-105"); // -100 - 5 fees
});
```

**Validates**: Losses recorded on settlement day.

---

#### 3. Delayed Profit
```typescript
test("Winning bet → profit recorded on payout day", () => {
  handleBuy(createBuyEvent(...));
  handleNewAnswer(createNewAnswerEvent(...)); // Correct outcome
  handlePayoutRedemption(createPayoutRedemptionEvent(...)); // +200 payout

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "95"); // 200 - 100 - 5
});
```

**Validates**: Wins recorded on payout redemption day.

---

#### 4. Complex Multi-Market
```typescript
test("Multiple markets, split bets, simultaneous wins/losses", () => {
  // Market A: Win (bet 100, payout 200)
  // Market B: Loss (bet 50)
  // Market C: Win (bet 80, payout 150)

  // ... handle events

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "120");
});
```

**Validates**: Correct aggregation across multiple markets.

---

#### 5. Edge Case - Multiple Losses
```typescript
test("Single market resolution with multiple losing bets", () => {
  handleBuy(createBuyEvent(...)); // Bet 1: -100
  handleBuy(createBuyEvent(...)); // Bet 2: -50
  handleNewAnswer(createNewAnswerEvent(...)); // Both wrong

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "-160");
});
```

**Validates**: All losing bets processed correctly in single settlement.

---

#### 6. Aggregation
```typescript
test("Two markets resolving same day for same agent", () => {
  // Market A: Loss -105
  // Market B: Payout +95

  let dailyStat = DailyProfitStatistic.load(id)!;
  assert.fieldEquals("DailyProfitStatistic", id, "dailyProfit", "-10");
  assert.i32Equals(dailyStat.profitParticipants.length, 2);
});
```

**Validates**: Correct aggregation on same day, proper `profitParticipants` tracking.

---

### Test Helpers (profit.ts)

```typescript
export function createBuyEvent(
  buyer: Address,
  investmentAmount: BigInt,
  feeAmount: BigInt,
  outcomeIndex: BigInt,
  timestamp: BigInt
): FPMMBuy { ... }

export function createNewAnswerEvent(
  question_id: Bytes,
  answer: Bytes,
  timestamp: BigInt
): LogNewAnswer { ... }

export function createPayoutRedemptionEvent(
  redeemer: Address,
  payout: BigInt,
  conditionId: Bytes,
  timestamp: BigInt
): PayoutRedemption { ... }
```

---

## Utility Functions Reference (utils.ts)

### Entity Management

```typescript
// Singleton global statistics
export function getGlobal(): Global

// Get or create daily profit statistic
export function getDailyProfitStatistic(
  agent: Bytes,
  timestamp: BigInt
): DailyProfitStatistic

// Normalize timestamp to UTC midnight
export function getDayTimestamp(timestamp: BigInt): BigInt
```

---

### Update Helpers

```typescript
// Track agent's first/last participation
export function updateTraderAgentActivity(
  agent: TraderAgent,
  timestamp: BigInt
): void

// Add payout to agent total
export function updateTraderAgentPayout(
  agent: TraderAgent,
  payout: BigDecimal
): void

// Track market participant activity
export function updateMarketParticipantActivity(
  agentId: Bytes,
  marketId: Bytes,
  timestamp: BigInt
): void

// Add payout to market participant
export function updateMarketParticipantPayout(
  participant: MarketParticipant,
  payout: BigDecimal
): void

// Increment global bet counter
export function incrementGlobalTotalBets(): void

// Add payout to global total
export function updateGlobalPayout(payout: BigDecimal): void
```

---

### Profit Tracking

```typescript
// Add market to daily profit participants (deduplicates)
export function addProfitParticipant(
  stat: DailyProfitStatistic,
  marketId: Bytes
): void
```

---

### Performance Utilities

```typescript
// Batch save entities from cache
export function saveMapValues<T extends Entity>(
  map: Map<string, T>
): void

// Convert oracle answer bytes to BigInt for comparison
export function bytesToBigInt(bytes: Bytes): BigInt
```

---

## Constants Reference (constants.ts)

```typescript
// Whitelisted market creators
export const CREATOR_ADDRESSES: string[] = [
  "0x89c5cc945dd550bcffb72fe42bff002429f46fec",
  "0xffc8029154ecd55abed15bd428ba596e7d23f557"
]

// Markets to exclude from indexing
export const BLACKLISTED_MARKETS: string[] = [
  "0xe7ed8a5f2f0f17f7d584ae8ddd0592d1ac67791f",
  "0xbfa584b29891941c8950ce975c1f7fa595ce1b99"
]

// Question parsing
export const QUESTION_SEPARATOR = "\u241f"

// Time constants
export const ONE_DAY = BigInt.fromI32(86400)
```

---

## Development Workflow

### Setup
```bash
npm install
```

### Build
```bash
npm run codegen   # Generate TypeScript bindings from schema
npm run build     # Compile AssemblyScript to WASM
```

### Test
```bash
npm run test      # Run Matchstick tests
```

### Deploy
```bash
graph deploy --studio autonolas-predict
```

---

## Configuration Reference (subgraph.yaml)

### Data Sources

1. **ServiceRegistryL2** (0x9338b5153AE39BB89f50468E608eD9d764B755fD)
   - Start block: 27871084
   - Events: `CreateMultisigWithAgents`

2. **ConditionalTokens** (0xCeAfDD6bc0bEF976fdCd1112955828E00543c0Ce)
   - Start block: 28900000
   - Events: `ConditionPreparation`, `PayoutRedemption`

3. **FPMMDeterministicFactory** (0x9083A2B699c0a4AD06F63580BDE2635d26a3eeF0)
   - Start block: 28900000
   - Events: `FixedProductMarketMakerCreation`

4. **Realitio** (0x79e32aE03fb27B07C89c0c568F80287C01ca2E57)
   - Start block: 28900000
   - Events: `LogNewQuestion`, `LogNewAnswer`

### Dynamic Template

**FixedProductMarketMaker** - Created for each new market
- Events: `FPMMBuy`, `FPMMSell`
- Handler: `FixedProductMarketMakerMapping.ts`

---

## Common Development Tasks

### Adding a New Whitelisted Creator

1. Update [constants.ts](src/constants.ts):
```typescript
export const CREATOR_ADDRESSES: string[] = [
  "0x89c5cc945dd550bcffb72fe42bff002429f46fec",
  "0xffc8029154ecd55abed15bd428ba596e7d23f557",
  "0xNEW_CREATOR_ADDRESS" // Add here
]
```

2. Rebuild and redeploy:
```bash
npm run build
graph deploy --studio autonolas-predict
```

---

### Adding a New Entity Field

1. Update [schema.graphql](schema.graphql):
```graphql
type TraderAgent @entity {
  # ... existing fields
  newField: BigDecimal! # Add new field
}
```

2. Regenerate bindings:
```bash
npm run codegen
```

3. Update handlers to populate new field:
```typescript
agent.newField = BigDecimal.fromString("0");
agent.save();
```

4. Rebuild and redeploy:
```bash
npm run build
graph deploy --studio autonolas-predict
```

---

### Debugging Handler Issues

1. Add logs to handler:
```typescript
import { log } from "@graphprotocol/graph-ts";

log.info("Processing bet: amount={}, fee={}", [
  bet.amount.toString(),
  bet.feeAmount.toString()
]);
```

2. Check subgraph logs in Graph Studio

3. Write unit test to reproduce:
```typescript
test("Bug reproduction", () => {
  // Setup
  handleBuy(createBuyEvent(...));

  // Verify
  assert.fieldEquals("Bet", id, "amount", "100");
});
```

---

## Performance Monitoring

### Key Metrics to Track

1. **Handler Execution Time**
   - `handleLogNewAnswer`: Should complete in <5 seconds for 1000+ bets
   - If slower, check caching implementation

2. **Entity Count Growth**
   - Monitor `Bet` and `DailyProfitStatistic` entity counts
   - Large growth may indicate missing early returns

3. **Failed Handlers**
   - Check logs for handler errors
   - Common causes: null checks, type conversions

---

## Troubleshooting Guide

### Issue: `totalTraded` Not Updating

**Likely Cause**: Market not settled yet (no `LogNewAnswer` event).

**Solution**: Volume only updates at settlement, not when bets placed.

---

### Issue: `dailyProfit` Incorrect

**Likely Causes**:
1. Bet `countedInProfit` flag not set correctly
2. Missing payout redemption event
3. Wrong outcome comparison logic

**Debug Steps**:
1. Check bet's `countedInProfit` flag
2. Verify `currentAnswer` matches expected outcome
3. Check payout redemption event was processed

---

### Issue: Missing Bets

**Likely Causes**:
1. Agent not registered in `ServiceRegistryL2`
2. Market creator not whitelisted
3. Market blacklisted

**Debug Steps**:
1. Check `CREATOR_ADDRESSES` in constants.ts
2. Verify `TraderAgent` entity exists for bettor
3. Check `BLACKLISTED_MARKETS`

---

### Issue: Slow Market Settlement

**Likely Cause**: Too many bets, caching not working correctly.

**Debug Steps**:
1. Verify `Map` caches initialized in `handleLogNewAnswer`
2. Check `saveMapValues()` called at end
3. Ensure each entity loaded once per handler

---

## Security Considerations

### Input Validation

All event handlers validate inputs:

```typescript
// Null checks
if (!agent) return;
if (!question || !question.fixedProductMarketMaker) return;

// Whitelist checks
if (!CREATOR_ADDRESSES.includes(creator.toHexString())) return;

// Commitment checks (skip non-final answers)
if (event.params.is_commitment) return;
```

---

### Overflow Protection

BigDecimal arithmetic prevents overflow:

```typescript
// Safe for large numbers
agent.totalTraded = agent.totalTraded.plus(bet.amount);
dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);
```

---

### Idempotency

Flags ensure handlers are idempotent:

```typescript
// Prevent double-processing
if (!bet.countedInTotal) {
  agent.totalTraded += bet.amount;
  bet.countedInTotal = true;
}
```

---

## Dependencies

**Runtime** (package.json):
- `@graphprotocol/graph-cli`: ^0.97.0
- `@graphprotocol/graph-ts`: ^0.38.0

**Development**:
- `matchstick-as`: ^0.6.0 (testing framework)

**ABIs Used**:
- ServiceRegistryL2.json
- ConditionalTokens.json
- FPMMDeterministicFactory.json
- FixedProductMarketMaker.json
- Realitio.json
- ERC20Detailed.json

---

## Additional Resources

- **The Graph Docs**: https://thegraph.com/docs
- **AssemblyScript Docs**: https://www.assemblyscript.org/
- **Matchstick Testing**: https://thegraph.com/docs/en/developer/matchstick/

---

## Summary for AI Assistants

### Critical Points to Remember

1. **Two-Phase Accounting**: Activity recorded immediately, totals/PnL deferred
2. **Losses at Settlement**: `dailyProfit` decremented when market resolves
3. **Wins at Payout**: `dailyProfit` incremented when redemption claimed
4. **Caching is Essential**: `handleLogNewAnswer` uses `Map` caches for performance
5. **Flags Prevent Double-Counting**: `countedInTotal` and `countedInProfit`
6. **Selective Indexing**: Only whitelisted creators and registered agents

### Common Modification Patterns

**Adding New Statistics:**
1. Update schema.graphql
2. Run `npm run codegen`
3. Update relevant handlers
4. Add tests

**Optimizing Handler:**
1. Use `Map` caches for frequently accessed entities
2. Load once, save once
3. Early returns for invalid data

**Debugging PnL Issues:**
1. Check `countedInProfit` flags
2. Verify `currentAnswer` set correctly
3. Trace through settlement and payout handlers

---

*This document is maintained for AI-assisted development. Update when handlers, schema, or patterns change.*
