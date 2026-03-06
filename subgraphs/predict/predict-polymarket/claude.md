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
│   ├── neg-risk-mapping.ts          # NegRisk market handling
│   ├── constants.ts                 # Constants
│   └── utils.ts                     # Utility functions (settlement, payout, trade activity)
├── tests/                           # Test files
│   ├── ctf-exchange.test.ts         # CTF Exchange handler tests
│   ├── profit.test.ts               # Profit calculation integration tests
│   ├── profit.ts                    # Test event creators
│   ├── test-helpers.ts              # Shared test utilities
│   └── ...
├── scripts/                         # Validation scripts
│   ├── validate-global.js           # Global vs TraderAgent consistency
│   ├── validate-agent.js            # Single agent deep validation
│   └── README.md                    # Script documentation
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
2.  **Two-Tier Accounting**:
    * `totalTraded` tracks all bets regardless of settlement status (updated immediately when bets are placed)
    * `totalTradedSettled` tracks settled markets only (updated at resolution for ALL bets — both winning and losing)
3.  **Settlement-Day Profit Attribution**: ALL profit/loss is calculated at resolution time when `QuestionResolved` fires. Uses outcome share balances to compute `expectedPayout` for each participant:
    * **Valid answer (0 or 1)**: Winning shares worth 1:1 in USDC collateral. `expectedPayout = outcomeShares for winning outcome`.
    * **Invalid answer (-1)**: Each share worth 1/2 collateral. `expectedPayout = max(0, shares0)/2 + max(0, shares1)/2`.
    * **Profit**: `expectedPayout - totalTraded` (attributed to the resolution day).
4.  **Payout Tracking**: `handlePayoutRedemption` only tracks actual USDC claimed (`totalPayout`) and creates immutable `PayoutRedemption` entries for debugging. No profit calculation occurs at payout time.
5.  **Sell Bet Convention**: Sell bets use **negative** amounts and shares (matching omen convention). `isBuy` field distinguishes direction.
6.  **No Re-Answer Logic**: Unlike omen, Polymarket resolutions are final — no answer change handling needed.

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
Represents an Autonolas trading agent with cumulative performance metrics.

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
  totalTradedSettled: BigInt!   # Volume for settled markets only (updated at resolution for ALL bets)
  totalPayout: BigInt!          # Actual USDC claimed via PayoutRedemption
  totalExpectedPayout: BigInt!  # Sum of expectedPayouts from settled markets

  # Block metadata
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Important**: `totalTraded` represents all bets volume (updated immediately), `totalTradedSettled` is updated at resolution for ALL bets (winning and losing). `totalExpectedPayout` tracks what agents are entitled to from settled markets. Compare with `totalPayout` to measure claim rate.

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
  isNegRisk: Boolean!           # Whether this is a NegRisk market
  marketId: Bytes               # Grouping ID for NegRisk markets
  metadata: MarketMetadata!     # Market details
  bets: [Bet!]!                 # Derived from Bet.question
  participants: [MarketParticipant!]! # Derived from MarketParticipant.question
  resolution: QuestionResolution # Derived from QuestionResolution.question
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during QuestionInitialized with the conditionId as the primary ID, linked to metadata. `participants` derived field used at resolution to iterate all agents in this market.

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
  amount: BigInt!               # USDC spent (positive for buy, negative for sell)
  shares: BigInt!               # Outcome tokens (positive for buy, negative for sell)
  isBuy: Boolean!               # true for buys, false for sells
  countedInTotal: Boolean!      # Volume added to settled totals
  countedInProfit: Boolean!     # PnL impact processed
  question: Question            # Market this bet is for
  dailyStatistic: DailyProfitStatistic # Day when bet was placed
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during OrderFilled when an agent (as maker) trades outcome tokens. Sell bets have negative `amount` and `shares`.

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
  totalTradedSettled: BigInt!   # Settled volume only (updated at resolution)
  totalPayout: BigInt!          # Payouts from this market
  outcomeShares0: BigInt!       # Net shares of outcome 0 (buys add, sells subtract)
  outcomeShares1: BigInt!       # Net shares of outcome 1
  expectedPayout: BigInt!       # Calculated at resolution from shares + winning outcome
  settled: Boolean!             # Idempotency flag, set true at resolution
  bets: [Bet!]!
  createdAt: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created on first bet in a market. Tracks outcome share positions. `expectedPayout` and `settled` are set at resolution time.

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
  totalTradedSettled: BigInt!   # Volume for settled markets only (updated at resolution)
  totalPayout: BigInt!          # All payouts
  totalExpectedPayout: BigInt!  # Sum of expectedPayouts from settled markets
  totalMarketsParticipated: Int! # Unique markets where any agent participated
}
```

**Important**: `totalTradedSettled` is updated at resolution for ALL bets (winning and losing). `totalExpectedPayout` tracks the theoretical total agents are entitled to.

---

#### PayoutRedemption
Immutable log entity for every payout redemption event (debugging/auditing).

**Key Fields:**
```graphql
type PayoutRedemption @entity(immutable: true) {
  id: Bytes!                    # txHash + logIndex
  redeemer: TraderAgent!
  conditionId: Bytes!
  question: Question
  payoutAmount: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during PayoutRedemption events. Provides an audit trail for all payouts.

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
  question.isNeqRisk = false;
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
  // Sells use NEGATIVE amounts (omen convention)
  let isBuying = event.params.makerAssetId.isZero();
  let usdcAmount = isBuying
    ? event.params.makerAmountFilled
    : BigInt.zero().minus(event.params.takerAmountFilled);  // negative for sells
  let sharesAmount = isBuying
    ? event.params.takerAmountFilled
    : BigInt.zero().minus(event.params.makerAmountFilled);  // negative for sells
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

  // 3. Process ALL participants (using caching for performance)
  processMarketResolution(bridge.conditionId, winningOutcome, settledPrice, payouts, event);
}
```

**`processMarketResolution`** (in utils.ts) iterates all participants in the market:
- Skips already settled participants (idempotency via `settled` flag)
- **Calculates expectedPayout** from outcome share balances:
  - Outcome 0 wins: `expectedPayout = max(0, outcomeShares0)`
  - Outcome 1 wins: `expectedPayout = max(0, outcomeShares1)`
  - Invalid (-1): `expectedPayout = max(0, shares0)/2 + max(0, shares1)/2`
- **Profit**: `expectedPayout - (totalTraded - totalTradedSettled)` — attributed to resolution day
- Sets `participant.settled = true`, `totalTradedSettled = totalTraded`
- Uses Map caches for TraderAgent and DailyProfitStatistic, delta accumulation for Global
- Marks all bets as `countedInProfit = true`, `countedInTotal = true`

**Key difference from omen**: No re-answer logic needed since Polymarket resolutions are final.

---

### 7. Payout Handling (conditional-tokens.ts)

**Event**: `PayoutRedemption(redeemer, collateralToken, parentCollectionId, conditionId, indexSets, payout)`

**Handler**: `handlePayoutRedemption`

Delegates to `processRedemption()` in utils.ts:
- Validates agent, question, and participant exist
- Creates immutable `PayoutRedemption` entity (audit trail)
- Updates payout totals only: `agent.totalPayout`, `participant.totalPayout`, `global.totalPayout`
- Updates daily stat: `dailyStat.totalPayout` (no `dailyProfit` change — profit was already calculated at resolution)

**Key point**: No profit calculation at payout time. All profit/loss is attributed at resolution.

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
- ✅ **Resolution-Time Settlement**: ALL profit/loss calculated at resolution for both winning and losing bets
- ✅ **Expected Payout**: Calculated from outcome share balances at resolution
- ✅ **Payout Tracking**: Immutable `PayoutRedemption` entity for audit trail (no profit at payout time)
- ✅ **Settled vs Unsettled**: `participant.settled` flag prevents double-processing
- ✅ **Invalid Market Handling**: Share-based expectedPayout calculation at resolution
- ✅ **Sell Bet Support**: Negative amounts/shares convention for sells

### Performance Optimizations
- ✅ **Caching Strategy**: Map-based entity caching during settlement
- ✅ **Batch Saves**: Bulk updates to minimize I/O
- ✅ **Selective Indexing**: Early returns for non-tracked markets/agents

---

## Key Differences from Omen Subgraph

This Polymarket subgraph differs from the Omen implementation:

1. **Agent Filtering**: Only tracks services with agent ID 86 using TraderService helper entity
2. **Network**: Polygon instead of Gnosis Chain
3. **Platform**: Polymarket (UMA + ConditionalTokens) instead of Omen (Reality.eth + ConditionalTokens)
4. **Market Metadata**: Extracts market info from UMA OptimisticOracleV3 ancillary data
5. **No Re-Answer Logic**: Polymarket resolutions are final — no answer change handling (omen has ~415/15,000 markets with re-answers)
6. **No Fee Tracking**: Polymarket doesn't have per-trade fees like omen (no `totalFees`/`totalFeesSettled` fields)
7. **USDC Denomination**: 6-decimal USDC instead of 18-decimal xDAI
8. **Shared Settlement Architecture**: Same resolution-time profit pattern as omen — ALL profit/loss at settlement using outcome share balances

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

## Utility Functions Reference (src/utils.ts)

| Function | Purpose |
|----------|---------|
| `getGlobal()` | Returns singleton Global entity (creates if null, including `totalExpectedPayout`) |
| `saveMapValues<T>(map)` | Batch-saves all entities in a Map cache |
| `getDayTimestamp(timestamp)` | Normalizes to UTC midnight: `timestamp / 86400 * 86400` |
| `getDailyProfitStatistic(agent, timestamp)` | Get-or-create daily stat for agent on specific day |
| `addProfitParticipant(stat, questionId)` | Adds market to `profitParticipants` (deduplicated) |
| `processTradeActivity(agent, conditionId, betId, amount, timestamp, blockNumber, txHash, outcomeIndex, sharesAmount)` | Consolidated trade update: Global, TraderAgent, MarketParticipant. Tracks outcomeShares0/1. |
| `processMarketResolution(conditionId, winningOutcome, settledPrice, payouts, event)` | Settlement: iterates participants, calculates expectedPayout, profit, updates settled totals. Uses Map caches. |
| `processRedemption(redeemer, conditionId, payoutAmount, timestamp, blockNumber, txHash, logIndex)` | Payout tracking only: creates PayoutRedemption, updates totalPayout. No profit. |

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
4. **Two-Tier Accounting**:
   - `totalTraded` = all bets volume (updated immediately when bets are placed)
   - `totalTradedSettled` = settled markets only (updated at resolution for ALL bets — both winning and losing)
5. **Settlement-Day Profit Attribution**: ALL profit/loss calculated at resolution time using outcome share balances. No profit at payout time.
   - `expectedPayout = outcomeShares for winning outcome` (or shares0/2 + shares1/2 for invalid)
   - `profit = expectedPayout - totalTraded`
6. **Payout Tracking is Separate**: `processRedemption` only updates `totalPayout` and creates immutable `PayoutRedemption` entries. No `dailyProfit` change.
7. **Sell Convention**: Sells use negative amounts and shares. `isBuy` field distinguishes direction.
8. **Participant-Level Settlement**: Iteration via `question.participants.load()` at resolution, not bets.
9. **Idempotency**: `participant.settled` flag prevents double-processing. No re-answer logic needed (Polymarket resolutions are final).
10. **Question Entity ID**: Uses `conditionId` as primary key (NOT questionId)
11. **Global Singleton ID**: Uses empty string "" (NOT "1")
12. **Performance Caching**: Uses Map-based caching for TraderAgent and DailyProfitStatistic, delta accumulation for Global
13. **`totalExpectedPayout` vs `totalPayout`**: Compare these on TraderAgent/Global to measure claim rate

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
