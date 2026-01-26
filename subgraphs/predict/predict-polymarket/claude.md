# Autonolas Predict Polymarket Subgraph - Technical Implementation Guide

> **AI Assistant Context**: This document provides technical details about the Polymarket Predict subgraph's architecture and implementation for AI-assisted development.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Core Data Model](#core-data-model)
- [Event Handlers & Data Flow](#event-handlers--data-flow)
- [Common Queries](#common-queries)
- [Development Workflow](#development-workflow)

---

## Architecture Overview

### Purpose
A GraphQL API for tracking Autonolas agent activity on Polymarket prediction markets on Polygon. Tracks agent registration, market metadata, and trading statistics.

### Directory Structure
```
subgraphs/predict/predict-polymarket/
├── schema.graphql                   # GraphQL schema definitions
├── subgraph.yaml                    # Subgraph configuration & event mappings
├── src/
│   ├── service-registry-l-2.ts      # Agent registration
│   ├── conditional-tokens.ts        # Condition preparation and payout handling
│   ├── ctf-exchange.ts              # Order tracking from CTF Exchange (agents as makers)
│   ├── uma-mapping.ts               # Market metadata extraction from UMA events
│   ├── constants.ts                 # Constants
│   └── utils.ts                     # Utility functions
├── tests/                           # Test files
│   ├── ctf-exchange.test.ts         # CTF Exchange handler tests
│   ├── profit.test.ts               # Profit calculation integration tests
│   ├── test-helpers.ts              # Shared test utilities
│   └── ...
└── generated/                       # Auto-generated bindings
```

### Key Contracts
1. **ServiceRegistryL2** (0xE3607b00E75f6405248323A9417ff6b39B244b50) - Agent registration on Polygon
2. **ConditionalTokens** (0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) - Condition preparation and payouts
3. **CTFExchange** - Order book exchange for trading outcome tokens (agents as makers)
4. **OptimisticOracleV3** (0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7) - UMA oracle for market metadata

### Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks services with agent ID 86 registered through the `ServiceRegistryL2` contract on Polygon.
    * **Markets**: Binary markets (2 outcomes) tracked via UMA OptimisticOracleV3 and ConditionalTokens.
2.  **Financial Metrics**:
    * `totalTraded` tracks all bets regardless of settlement status (updated immediately when bets are placed)
    * `totalTradedSettled` tracks settled markets only (updated at settlement for incorrect bets, at payout for correct bets)

---

## Core Data Model

### Primary Entities (schema.graphql)

#### TraderService
Helper entity for filtering agents with ID 86.

**Key Fields:**
```graphql
type TraderService @entity(immutable: true) {
  id: ID!                       # serviceId
}
```

**Pattern**: Only created when a service registers with agent ID 86, allowing proper TraderAgent filtering.

---

#### TraderAgent
Represents an Autonolas trading agent with basic tracking information.

**Key Fields:**
```graphql
type TraderAgent @entity {
  id: Bytes!                    # Agent's multisig address
  serviceId: BigInt!            # ServiceRegistryL2 ID

  # Activity tracking
  firstParticipation: BigInt
  lastActive: BigInt
  totalBets: Int!

  # Financial metrics
  totalTraded: BigInt!          # All bets volume (updated immediately when bets are placed)
  totalTradedSettled: BigInt!   # Volume for settled markets only (updated at settlement/payout)
  totalPayout: BigInt!          # Total payouts from redemptions

  # Block metadata
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Important**: `totalTraded` represents all bets volume (updated immediately when bets are placed), while `totalTradedSettled` represents volume for settled markets only (updated at settlement or payout).

---

#### QuestionIdToConditionId
Bridge entity linking UMA question IDs to ConditionalTokens condition IDs.

**Key Fields:**
```graphql
type QuestionIdToConditionId @entity(immutable: true) {
  id: Bytes!                    # questionId
  conditionId: Bytes!           # bytes32
  transactionHash: Bytes!
}
```

**Pattern**: Created during ConditionPreparation to establish the link between UMA's oracle system and ConditionalTokens.

---

#### Question
Represents a market with metadata and links to its condition.

**Key Fields:**
```graphql
type Question @entity(immutable: true) {
  id: Bytes!                    # conditionId (NOT questionId)
  questionId: Bytes!            # bytes32
  metadata: MarketMetadata!     # Market details
  bets: [Bet!]!                 # Derived from Bet.question
  resolution: QuestionResolution # Derived from QuestionResolution.question
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during QuestionInitialized with the conditionId as the primary ID, linked to metadata.

---

#### MarketMetadata
Market details extracted from UMA ancillary data.

**Key Fields:**
```graphql
type MarketMetadata @entity(immutable: true) {
  id: Bytes!                    # questionId
  title: String!                # Market question title
  outcomes: [String!]!          # Array of outcome names (e.g., ["Yes", "No"])
  rawAncillaryData: String!     # Full ancillary data string
}
```

**Pattern**: Parsed from UMA OptimisticOracleV3 ancillary data string format.

---

#### Bet
Individual trade placed by an agent.

**Key Fields:**
```graphql
type Bet @entity(immutable: false) {
  id: Bytes!                    # transaction hash + log index
  bettor: TraderAgent!
  outcomeIndex: BigInt!         # 0 or 1 for binary markets
  amount: BigInt!               # USDC spent
  shares: BigInt!               # Outcome tokens received
  countedInTotal: Boolean!      # Volume added to settled totals
  countedInProfit: Boolean!     # PnL impact processed
  question: Question            # Market this bet is for
  dailyStatistic: DailyProfitStatistic # Day when bet was placed
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during OrderFilled when an agent (as maker) trades outcome tokens.

---

#### DailyProfitStatistic
Tracks day-to-day performance for an agent.

**Key Fields:**
```graphql
type DailyProfitStatistic @entity(immutable: false) {
  id: ID!                       # agentAddress_dayTimestamp
  traderAgent: TraderAgent!
  date: BigInt!                 # Normalized to start of day UTC

  # Activity placed on this day
  totalBets: Int!               # Bets placed today
  totalTraded: BigInt!          # Volume placed today (regardless of settlement)
  totalPayout: BigInt!          # Payouts received today

  # Profit realized on this day
  dailyProfit: BigInt!          # Net profit/loss (adjusted on settlement/payout days)
  profitParticipants: [Question!]! # Markets affecting PnL on this day
}
```

**Pattern**: Automatically created/updated when bets are placed, markets settle, or payouts are redeemed.

---

#### MarketParticipant
Tracks an agent's participation in a specific market.

**Key Fields:**
```graphql
type MarketParticipant @entity(immutable: false) {
  id: ID!                       # agentAddress_conditionId
  traderAgent: TraderAgent!
  question: Question!
  totalBets: Int!
  totalTraded: BigInt!          # All volume in this market
  totalTradedSettled: BigInt!   # Settled volume only
  totalPayout: BigInt!          # Payouts from this market
  bets: [Bet!]!
  createdAt: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created on first bet in a market, updated as agent continues trading.

---

#### TokenRegistry
Maps outcome token IDs to their condition and outcome index.

**Key Fields:**
```graphql
type TokenRegistry @entity(immutable: true) {
  id: Bytes!                    # tokenId as bytes
  tokenId: BigInt!
  conditionId: Bytes!
  outcomeIndex: BigInt!         # 0 or 1 for binary markets
  transactionHash: Bytes!
}
```

**Pattern**: Created during TokenRegistered events from CTF Exchange. Essential for identifying which outcome an agent is betting on.

---

#### QuestionResolution
Tracks market finalization when UMA resolves the question.

**Key Fields:**
```graphql
type QuestionResolution @entity(immutable: true) {
  id: Bytes!                    # conditionId
  question: Question!
  winningIndex: BigInt!         # -1 for invalid, 0 or 1 for winner
  settledPrice: BigInt!
  payouts: [BigInt!]!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during QuestionResolved events. Determines which bets won/lost.

---

#### ConditionPreparation (Deprecated)
Immutable record of condition setup from ConditionalTokens.

**Note**: This entity is no longer used in the current implementation. The bridge is established via QuestionIdToConditionId instead.


---

#### Global
Aggregate statistics across all agents.

**Key Fields:**
```graphql
type Global @entity {
  id: ID!                       # Singleton: "" (empty string)

  totalTraderAgents: Int!
  totalActiveTraderAgents: Int!
  totalBets: Int!               # All bets including open markets

  # Financial metrics
  totalTraded: BigInt!          # All bets volume (updated immediately)
  totalTradedSettled: BigInt!   # Volume for settled markets only
  totalPayout: BigInt!          # All payouts
}
```

**Important**: Like TraderAgent, `totalTraded` represents all bets volume while `totalTradedSettled` only counts settled markets.

---

## Event Handlers & Data Flow

### 1. Agent Registration (service-registry-l-2.ts)

#### Event 1: `RegisterInstance(operator, serviceId, agentInstance, agentId)`

**Handler**: `handleRegisterInstance`

```typescript
export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  let agentId = event.params.agentId.toI32();
  // Only create TraderService if it has agent ID 86
  if (agentId !== PREDICT_AGENT_ID) return;

  let serviceId = event.params.serviceId.toString();
  let traderService = TraderService.load(serviceId);
  if (traderService !== null) return;

  traderService = new TraderService(serviceId);
  traderService.save()
}
```

**Pattern**: Creates TraderService marker entity only for services with agent ID 86, enabling selective tracking in the next handler.

---

#### Event 2: `CreateMultisigWithAgents(serviceId, multisig)`

**Handler**: `handleCreateMultisigWithAgents`

```typescript
export function handleCreateMultisigWithAgents(event: CreateMultisigWithAgentsEvent): void {
  // Skip non-trader services
  let traderService = TraderService.load(event.params.serviceId.toString())
  if (traderService === null) return;

  let traderAgent = TraderAgent.load(event.params.multisig);
  if (traderAgent === null) {
    traderAgent = new TraderAgent(event.params.multisig);
    traderAgent.totalBets = 0;
    traderAgent.serviceId = event.params.serviceId;
    traderAgent.totalPayout = BigInt.zero();
    traderAgent.totalTraded = BigInt.zero();
    traderAgent.totalTradedSettled = BigInt.zero();
    traderAgent.blockNumber = event.block.number;
    traderAgent.blockTimestamp = event.block.timestamp;
    traderAgent.transactionHash = event.transaction.hash;
    traderAgent.save();

    let global = getGlobal();
    global.totalTraderAgents += 1;
    global.save();
  }
}
```

**Pattern**: Two-step filtering ensures only services with agent ID 86 create TraderAgent entities. Uses TraderService as a gate.

---

### 2. Market Condition Setup (conditional-tokens.ts)

**Event**: `ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount)`

**Handler**: `handleConditionPreparation`

```typescript
export function handleConditionPreparation(event: ConditionPreparationEvent): void {
  // Only handle binary markets (2 outcomes)
  if (event.params.outcomeSlotCount.toI32() != 2) {
    return;
  }

  let entity = new ConditionPreparation(event.params.conditionId.toHexString());
  entity.conditionId = event.params.conditionId;
  entity.oracle = event.params.oracle;
  entity.questionId = event.params.questionId;
  entity.outcomeSlotCount = event.params.outcomeSlotCount;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();

  let question = new Question(event.params.questionId)
  question.conditionId = event.params.conditionId;
  question.metadata = null; // Will be populated by UMA event
  question.blockNumber = event.block.number;
  question.blockTimestamp = event.block.timestamp;
  question.transactionHash = event.transaction.hash;
  question.save();
}
```

**Pattern**: Only binary markets tracked. Question entity created with null metadata, waiting for UMA event.

---

### 3. Market Metadata Extraction (uma-mapping.ts)

**Event**: `QuestionInitialized(questionID, timestamp, requester, ancillaryData, rewardToken, reward, proposalBond)`

**Handler**: `handleQuestionInitialized`

```typescript
export function handleQuestionInitialized(event: QuestionInitialized): void {
  let metadata = new MarketMetadata(event.params.questionID)

  // ancillaryData format: "q: title: Will BTC hit 100k?, res_data: p1: 0, p2: 1, outcomes: [Yes, No]"
  let rawData = event.params.ancillaryData.toString()

  metadata.title = extractTitle(rawData)
  metadata.outcomes = extractBinaryOutcomes(rawData)
  metadata.save()
}
```

**Helper Functions**:
- `extractTitle(rawData)`: Parses title from UMA ancillary data string
- `extractBinaryOutcomes(rawData)`: Extracts outcome names from "p1 corresponds to X, p2 to Y" or "outcomes: [X, Y]" format

**Pattern**: Parses UMA's structured ancillary data format to extract human-readable market information.

---

### 4. Token Registration (ctf-exchange.ts)

**Event**: `TokenRegistered(token0, token1, conditionId)`

**Handler**: `handleTokenRegistered`

```typescript
export function handleTokenRegistered(event: TokenRegisteredEvent): void {
  // Register Outcome 0 (Usually "No")
  let token0Id = Bytes.fromByteArray(Bytes.fromBigInt(event.params.token0));
  let registry0 = new TokenRegistry(token0Id);
  registry0.tokenId = event.params.token0;
  registry0.conditionId = event.params.conditionId;
  registry0.outcomeIndex = BigInt.fromI32(0);
  registry0.transactionHash = event.transaction.hash;
  registry0.save();

  // Register Outcome 1 (Usually "Yes")
  let token1Id = Bytes.fromByteArray(Bytes.fromBigInt(event.params.token1));
  let registry1 = new TokenRegistry(token1Id);
  registry1.tokenId = event.params.token1;
  registry1.conditionId = event.params.conditionId;
  registry1.outcomeIndex = BigInt.fromI32(1);
  registry1.transactionHash = event.transaction.hash;
  registry1.save();
}
```

**Pattern**: Creates TokenRegistry entries for both outcome tokens, mapping each token ID to its outcome index (0 or 1). Essential for identifying which outcome an agent is betting on when processing OrderFilled events.

---

### 5. Bet Placement (ctf-exchange.ts)

**Event**: `OrderFilled(orderHash, maker, taker, makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled)`

**Handler**: `handleOrderFilled`

```typescript
export function handleOrderFilled(event: OrderFilledEvent): void {
  // 1. Identify if the maker is one of our TraderAgents
  let agentId = event.params.maker;  // IMPORTANT: Agents are MAKERS, not takers
  let agent = TraderAgent.load(agentId);
  if (agent === null) return;

  // 2. Determine trade direction and amounts
  let isBuying = event.params.makerAssetId.isZero();
  let usdcAmount = isBuying ? event.params.makerAmountFilled : event.params.takerAmountFilled;
  let sharesAmount = isBuying ? event.params.takerAmountFilled : event.params.makerAmountFilled;
  let outcomeTokenId = isBuying ? event.params.takerAssetId : event.params.makerAssetId;

  // 3. Lookup outcome index from TokenRegistry
  let tokenRegistry = TokenRegistry.load(Bytes.fromByteArray(Bytes.fromBigInt(outcomeTokenId)));
  if (tokenRegistry === null) return;

  // 4. Update Daily Stats
  let dailyStat = getDailyProfitStatistic(agent.id, event.block.timestamp);
  dailyStat.totalBets += 1;
  dailyStat.totalTraded = dailyStat.totalTraded.plus(usdcAmount);
  dailyStat.save();

  // 5. Create Bet entity
  let betId = event.transaction.hash.concat(Bytes.fromI32(event.logIndex.toI32()));
  let bet = new Bet(betId);
  bet.bettor = agent.id;
  bet.outcomeIndex = tokenRegistry.outcomeIndex;
  bet.amount = usdcAmount;
  bet.shares = sharesAmount;
  bet.countedInTotal = false;  // Will be set to true during settlement
  bet.countedInProfit = false;
  bet.question = tokenRegistry.conditionId;
  bet.dailyStatistic = dailyStat.id;
  bet.save();

  // 6. Update TraderAgent, MarketParticipant, and Global
  processTradeActivity(agent, tokenRegistry.conditionId, betId, usdcAmount, ...);
}
```

**Critical Pattern - Agents as Makers**:
- **Our agents operate as MAKERS, not takers** in the CTF Exchange order book
- The **maker** creates the limit order (our agent), the **taker** fills it (counterparty)
- We track via `event.params.maker`

**Asset Flow (Maker Perspective)**:
- **Buying (makerAssetId = 0)**: Maker gives USDC, receives outcome tokens
- **Selling (takerAssetId = 0)**: Maker gives outcome tokens, receives USDC

---

### 6. Market Resolution (uma-mapping.ts)

**Event**: `QuestionResolved(questionID, settledPrice, payouts)`

**Handler**: `handleQuestionResolved`

```typescript
export function handleQuestionResolved(event: QuestionResolvedEvent): void {
  let bridge = QuestionIdToConditionId.load(event.params.questionID);
  if (bridge == null) return;

  // 1. Create Resolution entity
  let resolution = new QuestionResolution(bridge.conditionId);
  resolution.question = bridge.conditionId;
  resolution.settledPrice = event.params.settledPrice;
  resolution.payouts = event.params.payouts;

  // 2. Determine winner
  let winningOutcome = BigInt.fromI32(-1); // Default for Invalid
  if (event.params.payouts.length >= 2) {
    let p0 = event.params.payouts[0];
    let p1 = event.params.payouts[1];
    if (p1 > p0) winningOutcome = BigInt.fromI32(1); // YES won
    else if (p0 > p1) winningOutcome = BigInt.fromI32(0); // NO won
  }
  resolution.winningIndex = winningOutcome;
  resolution.save();

  // 3. Process losing bets (using caching for performance)
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();

  let question = Question.load(bridge.conditionId);
  let bets = question.bets.load();

  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];

    // Only settle losses for incorrect bets
    if (winningOutcome.ge(BigInt.zero()) && !bet.outcomeIndex.equals(winningOutcome)) {
      // Update settled totals
      if (!bet.countedInTotal) {
        agent.totalTradedSettled = agent.totalTradedSettled.plus(bet.amount);
        participant.totalTradedSettled = participant.totalTradedSettled.plus(bet.amount);
        global.totalTradedSettled = global.totalTradedSettled.plus(bet.amount);
        bet.countedInTotal = true;
      }

      // Realize loss
      if (!bet.countedInProfit) {
        dailyStat.dailyProfit = dailyStat.dailyProfit.minus(bet.amount);
        addProfitParticipant(dailyStat, bridge.conditionId);
        bet.countedInProfit = true;
      }

      bet.save();
    }
  }

  // 4. Save cached entities
  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);
  global.save();
}
```

**Pattern**: Processes market resolution by:
- Creating QuestionResolution entity with winning outcome
- Updating `totalTradedSettled` for **incorrect bets only**
- Realizing losses on the settlement day
- Using Map caches for performance when processing many bets

**Note**: Correct bets are NOT processed here - their settled totals and profits are handled during payout redemption.

---

### 7. Payout Handling (conditional-tokens.ts)

**Event**: `PayoutRedemption(redeemer, collateralToken, parentCollectionId, conditionId, indexSets, payout)`

**Handler**: `handlePayoutRedemption`

```typescript
export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  const redeemer = event.params.redeemer;
  const conditionId = event.params.conditionId;

  // 1. Validation: Only process if it's one of our agents
  let agent = TraderAgent.load(redeemer);
  if (agent == null) return;

  // 2. Identify the amount that needs to be moved to 'Settled'
  let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
  const payoutAmount = event.params.payout;

  // 3. Update settled totals for correct bets
  if (amountToSettle.gt(BigInt.zero())) {
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);
    participant.totalTradedSettled = participant.totalTradedSettled.plus(amountToSettle);
    global.totalTradedSettled = global.totalTradedSettled.plus(amountToSettle);
  }

  // 4. Update payout totals
  agent.totalPayout = agent.totalPayout.plus(payoutAmount);
  participant.totalPayout = participant.totalPayout.plus(payoutAmount);
  global.totalPayout = global.totalPayout.plus(payoutAmount);

  // 5. Mark bets as counted
  for (let i = 0; i < betIds.length; i++) {
    let bet = Bet.load(betIds[i]);
    if (bet !== null && !bet.countedInProfit) {
      bet.countedInProfit = true;
      bet.countedInTotal = true;
      bet.save();
    }
  }

  // 6. Update daily profit (Profit = Payout - Costs)
  dailyStat.dailyProfit = dailyStat.dailyProfit.plus(payoutAmount.minus(amountToSettle));
  addProfitParticipant(dailyStat, conditionId);

  // Save all entities
  agent.save();
  participant.save();
  global.save();
  dailyStat.save();
}
```

**Status**: Fully implemented. Tracks agent payouts and updates settled totals for winning bets.

---

## Common Queries

### Agent Statistics
Track an individual agent's performance.

```graphql
{
  traderAgent(id: "0x...") {
    serviceId
    firstParticipation
    lastActive
    totalBets
    totalTraded
    totalTradedSettled
    totalPayout
    blockNumber
    blockTimestamp
  }
}
```

**Use Case**: Get basic statistics for a specific agent.

---

### Market Information
Query market metadata and conditions.

```graphql
{
  question(id: "0x...") {
    conditionId
    metadata {
      title
      outcomes
      description
    }
  }
}
```

**Use Case**: Get human-readable market information linked to a condition.

---

### All Agents
List all registered agents.

```graphql
{
  traderAgents(
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    serviceId
    totalBets
    totalTraded
    totalPayout
    firstParticipation
    lastActive
  }
}
```

**Use Case**: Get overview of all registered agents.

---

### Global Statistics

```graphql
{
  global(id: "") {
    totalTraderAgents
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalTradedSettled
    totalPayout
  }
}
```

**Use Case**: Platform-wide metrics dashboard.

---

## Development Workflow

### Project Structure
This subgraph is part of the autonolas-subgraph-studio monorepo:
- `src/service-registry-l-2.ts`: Agent registration (services with agent ID 86 only)
- `src/conditional-tokens.ts`: Condition preparation and payout handling
- `src/ctf-exchange.ts`: Order tracking from CTF Exchange (agents as makers)
- `src/uma-mapping.ts`: Market metadata extraction from UMA events
- `schema.graphql`: GraphQL schema
- `tests/`: Comprehensive test suite including integration tests

### Setup
```bash
npm install
```

### Build
```bash
npm run codegen   # Generate TypeScript bindings from schema
npm run build     # Compile AssemblyScript to WASM
```

### Deploy
```bash
graph deploy --studio autonolas-predict-polymarket
```

**Note**: Check the [root README](../../../README.md) for detailed build and deployment instructions.

---

## Configuration Reference (subgraph.yaml)

### Data Sources

1. **ServiceRegistryL2** (0xE3607b00E75f6405248323A9417ff6b39B244b50)
   - Network: Polygon (matic)
   - Start block: 80360433
   - Events: `RegisterInstance`, `CreateMultisigWithAgents`
   - Handler: [src/service-registry-l-2.ts](src/service-registry-l-2.ts)

2. **ConditionalTokens** (0x4D97DCd97eC945f40cF65F87097ACe5EA0476045)
   - Network: Polygon (matic)
   - Start block: 80360433
   - Events: `ConditionPreparation`, `PayoutRedemption`
   - Handler: [src/conditional-tokens.ts](src/conditional-tokens.ts)

3. **OptimisticOracleV3** (0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7)
   - Network: Polygon (matic)
   - Start block: 80360433
   - Events: `QuestionInitialized`
   - Handler: [src/uma-mapping.ts](src/uma-mapping.ts)

---

## Implemented Features

This subgraph includes comprehensive tracking for Autonolas agents on Polymarket:

### Core Tracking
- ✅ **Agent Registration**: Tracks services with agent ID 86
- ✅ **Market Creation**: Binary market tracking via ConditionalTokens
- ✅ **Market Metadata**: Extracts human-readable info from UMA oracle
- ✅ **Token Registry**: Maps outcome tokens to their indices

### Trading Activity
- ✅ **Bet Tracking**: Individual trades with amount, shares, and outcome
- ✅ **Maker-Based Tracking**: Identifies agents as makers in CTF Exchange
- ✅ **Market Participation**: Per-market statistics for each agent
- ✅ **Daily Statistics**: Day-to-day performance metrics

### Profitability & Settlement
- ✅ **Two-Phase Settlement**: Incorrect bets on resolution, correct bets on payout
- ✅ **Profit/Loss Calculation**: Net P&L with daily attribution
- ✅ **Payout Tracking**: Complete redemption handler
- ✅ **Settled vs Unsettled**: Distinguishes active and finalized bets

### Performance Optimizations
- ✅ **Caching Strategy**: Map-based entity caching during settlement
- ✅ **Batch Saves**: Bulk updates to minimize I/O
- ✅ **Selective Indexing**: Early returns for non-tracked markets/agents

---

## Key Differences from Omen Subgraph

This Polymarket subgraph differs from the Omen implementation:

1. **Agent Filtering**: Only tracks services with agent ID 86 using TraderService helper entity
2. **Network**: Polygon instead of Gnosis Chain
3. **Platform**: Polymarket (UMA + ConditionalTokens) instead of Omen
4. **Market Metadata**: Extracts market info from UMA OptimisticOracleV3 ancillary data
5. **Financial Metrics**: Distinguishes between immediate tracking (`totalTraded` for all bets) and settlement-based tracking (`totalTradedSettled` for settled markets only)

---

## Common Development Tasks

### Adding a New Entity Field

1. Update [schema.graphql](schema.graphql):
```graphql
type TraderAgent @entity {
  # ... existing fields
  newField: BigInt! # Add new field
}
```

2. Regenerate bindings:
```bash
npm run codegen
```

3. Update handlers to populate new field:
```typescript
agent.newField = BigInt.fromI32(0);
agent.save();
```

4. Rebuild and redeploy:
```bash
npm run build
graph deploy --studio autonolas-predict-polymarket
```

---

## Utility Functions Reference

### Entity Management

```typescript
// Get or create singleton global statistics
export function getGlobal(): Global {
  let global = Global.load("");
  if (!global) {
    global = new Global("");
    global.totalTraderAgents = 0;
    global.totalActiveTraderAgents = 0;
    global.totalBets = 0;
    global.totalTraded = BigInt.fromI32(0);
    global.totalTradedSettled = BigInt.fromI32(0);
    global.totalPayout = BigInt.fromI32(0);
    global.save();
  }
  return global;
}
```

---

## Dependencies

**Runtime** (package.json):
- `@graphprotocol/graph-cli`: ^0.97.0
- `@graphprotocol/graph-ts`: ^0.38.0

**ABIs Used**:
- ServiceRegistryL2.json
- ConditionalTokens.json
- OptimisticOracleV3.json

---

## Additional Resources

- **The Graph Docs**: https://thegraph.com/docs
- **AssemblyScript Docs**: https://www.assemblyscript.org/
- **Polymarket Docs**: https://docs.polymarket.com/

---

## Summary for AI Assistants

### Critical Points to Remember

1. **Agent ID 86 Only**: Two-step filtering via TraderService + TraderAgent entities
2. **Binary Markets Only**: Only tracks markets with 2 outcomes via ConditionalTokens
3. **Agents as Makers**: Our agents are MAKERS (not takers) in CTF Exchange - identify via `event.params.maker`
4. **Immediate vs Settled Tracking**:
   - `totalTraded` = all bets volume (updated immediately when bets are placed)
   - `totalTradedSettled` = settled markets only (updated at settlement for incorrect, at payout for correct)
5. **Two-Phase Settlement**:
   - Incorrect bets: settled on resolution day via `handleQuestionResolved`
   - Correct bets: settled on payout day via `handlePayoutRedemption`
6. **Question Entity ID**: Uses `conditionId` as primary key (NOT questionId)
7. **Global Singleton ID**: Uses empty string "" (NOT "1")
8. **UMA Metadata Parsing**: Market titles/outcomes extracted from OptimisticOracleV3 ancillary data
9. **Polygon Network**: Deployed on Polygon, different from Omen (Gnosis Chain)
10. **Performance Caching**: Uses Map-based caching in `handleQuestionResolved` for bulk bet processing

### Common Modification Patterns

**Adding New Statistics:**
1. Update schema.graphql
2. Run `npm run codegen`
3. Update relevant handlers
4. Rebuild and deploy

**When Adding New Tracking Features:**
1. Update schema.graphql with new entities or fields
2. Run `npm run codegen` to regenerate TypeScript bindings
3. Update relevant handlers to populate new data
4. Add tests in the tests/ directory
5. Rebuild and deploy: `npm run build && graph deploy`

**Constants Reference:**
- `PREDICT_AGENT_ID = 86` in [src/constants.ts](src/constants.ts)
- `ONE_DAY = 86400` for daily statistics calculations

---

*This document is maintained for AI-assisted development. Update when handlers, schema, or patterns change.*
