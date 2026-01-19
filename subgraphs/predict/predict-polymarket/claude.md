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
│   ├── uma-mapping.ts               # Market metadata extraction from UMA events
│   ├── constants.ts                 # Constants
│   └── utils.ts                     # Utility functions
└── generated/                       # Auto-generated bindings
```

### Key Contracts
1. **ServiceRegistryL2** (0xE3607b00E75f6405248323A9417ff6b39B244b50) - Agent registration on Polygon
2. **ConditionalTokens** (0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) - Condition preparation and payouts
3. **OptimisticOracleV3** (0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7) - UMA oracle for market metadata

### Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks services with agent ID 86 registered through the `ServiceRegistryL2` contract on Polygon.
    * **Markets**: Binary markets (2 outcomes) tracked via UMA OptimisticOracleV3 and ConditionalTokens.
    * **Financial Metrics**: `totalTraded` and `totalFees` only count settled markets (when answer is known).

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
  totalTraded: BigInt!          # Total trading volume for settled markets only
  totalFees: BigInt!            # Total fees paid for settled markets only
  totalPayout: BigInt!          # Total payouts (all bets including open markets)

  # Block metadata
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Important**: `totalTraded` and `totalFees` only count settled markets (when we have an answer), while `totalPayout` includes all bets including open markets.

---

#### ConditionPreparation
Immutable record of condition setup from ConditionalTokens.

**Key Fields:**
```graphql
type ConditionPreparation @entity(immutable: true) {
  id: ID!                       # conditionId as hex string
  conditionId: Bytes!           # bytes32
  oracle: Bytes!                # address
  questionId: Bytes!            # bytes32
  outcomeSlotCount: BigInt!     # uint256 (only 2 outcomes tracked)
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Only conditions with 2 outcomes are stored (binary markets).

---

#### Question
Links market questions to conditions with metadata.

**Key Fields:**
```graphql
type Question @entity {
  id: Bytes!                    # questionId
  conditionId: Bytes!           # bytes32
  metadata: MarketMetadata      # Market details (nullable until UMA event)
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

**Pattern**: Created during ConditionPreparation, metadata populated later by UMA QuestionInitialized event.

---

#### MarketMetadata
Market details extracted from UMA ancillary data.

**Key Fields:**
```graphql
type MarketMetadata @entity(immutable: true) {
  id: Bytes!                    # questionId
  title: String!                # Market question title
  outcomes: [String!]!          # Array of outcome names (e.g., ["Yes", "No"])
  description: String           # Optional market description
}
```

**Pattern**: Parsed from UMA OptimisticOracleV3 ancillary data string format.

---

#### Global
Aggregate statistics across all agents.

**Key Fields:**
```graphql
type Global @entity {
  id: ID!                       # Singleton: "1"

  totalTraderAgents: Int!
  totalActiveTraderAgents: Int!
  totalBets: Int!               # All bets including open markets

  # Financial metrics
  totalTraded: BigInt!          # Trading volume for settled markets only
  totalFees: BigInt!            # Fees for settled markets only
  totalPayout: BigInt!          # All payouts
}
```

**Important**: Like TraderAgent, `totalTraded` and `totalFees` only count settled markets.

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
    traderAgent.totalFees = BigInt.zero();
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

### 4. Payout Handling (conditional-tokens.ts)

**Event**: `PayoutRedemption(redeemer, collateralToken, conditionId, indexSets, payout)`

**Handler**: `handlePayoutRedemption`

```typescript
export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  // TODO: Implementation pending
}
```

**Status**: Not yet implemented. Will track agent payouts when completed.

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
    totalPayout
    totalFees
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
    totalPayout
    totalFees
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
- `src/uma-mapping.ts`: Market metadata extraction from UMA events
- `schema.graphql`: GraphQL schema

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

## Future Enhancements

This is an initial implementation with basic infrastructure. Future versions may include:

### Trading Activity Tracking
- **Bet** entity: Track individual trades per agent
- Detailed bet tracking per agent

### Profitability Tracking
- **DailyProfitStatistic** entity: Day-to-day performance
- **MarketParticipant** entity: Per-market agent statistics
- Complete payout redemption handler implementation
- Profit/loss calculation

### Advanced Features
- Market creation tracking
- Detailed fee analysis
- Time-series aggregations
- Cross-market analytics

---

## Key Differences from Omen Subgraph

This Polymarket subgraph differs from the Omen implementation:

1. **Agent Filtering**: Only tracks services with agent ID 86 using TraderService helper entity
2. **Network**: Polygon instead of Gnosis Chain
3. **Platform**: Polymarket (UMA + ConditionalTokens) instead of Omen
4. **Market Metadata**: Extracts market info from UMA OptimisticOracleV3 ancillary data
5. **Financial Metrics**: Distinguishes between settled market metrics (`totalTraded`, `totalFees`) and all-market metrics (`totalPayout`, `totalBets`)

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
  let global = Global.load("1");
  if (!global) {
    global = new Global("1");
    global.totalTraderAgents = 0;
    global.totalActiveTraderAgents = 0;
    global.totalBets = 0;
    global.totalTraded = BigInt.fromI32(0);
    global.totalFees = BigInt.fromI32(0);
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
3. **Settled vs All Markets**: `totalTraded`/`totalFees` count only settled markets; `totalPayout`/`totalBets` count all markets
4. **UMA Metadata Parsing**: Market titles/outcomes extracted from OptimisticOracleV3 ancillary data
5. **Polygon Network**: Deployed on Polygon, different from Omen (Gnosis Chain)
6. **Incomplete Payout Handler**: `handlePayoutRedemption` is a TODO stub

### Common Modification Patterns

**Adding New Statistics:**
1. Update schema.graphql
2. Run `npm run codegen`
3. Update relevant handlers
4. Rebuild and deploy

**When Expanding to Track Trading:**
1. Add new entities (Bet, Market, MarketParticipant, DailyProfitStatistic)
2. Implement `handlePayoutRedemption` in [src/conditional-tokens.ts](src/conditional-tokens.ts)
3. Add trading event handlers for CTF Exchange or other trading contracts
4. Update `totalTraded`, `totalFees`, `firstParticipation`, `lastActive` fields based on activity

**Constants Reference:**
- `PREDICT_AGENT_ID = 86` in [src/constants.ts](src/constants.ts)
- `ONE_DAY = 86400` for daily statistics calculations

---

*This document is maintained for AI-assisted development. Update when handlers, schema, or patterns change.*
