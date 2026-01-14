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
A GraphQL API for tracking Autonolas agent activity on Polymarket prediction markets on Polygon. This is a **minimal initial implementation** that focuses on agent registration and basic statistics tracking.

### Directory Structure
```
subgraphs/predict/predict-polymarket/
├── schema.graphql           # GraphQL schema definitions
├── subgraph.yaml            # Subgraph configuration & event mappings
├── src/
│   └── service-registry-l-2.ts  # Agent registration handler
└── generated/                    # Auto-generated bindings
```

### Key Contracts
1. **ServiceRegistryL2** (0xE3607b00E75f6405248323A9417ff6b39B244b50) - Agent registration on Polygon

### Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks agents registered through the `ServiceRegistryL2` contract on Polygon.
    * **Scope**: This initial version includes only TraderAgent and Global entities for basic tracking.

---

## Core Data Model

### Primary Entities (schema.graphql)

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
  totalTraded: BigInt!          # Total trading volume
  totalFees: BigInt!            # Total fees paid
  totalPayout: BigInt!          # Total payouts received

  # Block metadata
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

---

#### Global
Aggregate statistics across all agents.

**Key Fields:**
```graphql
type Global @entity {
  id: ID!                       # Singleton: "1"

  totalTraderAgents: Int!
  totalActiveTraderAgents: Int!
  totalBets: Int!

  # Financial metrics
  totalTraded: BigInt!
  totalFees: BigInt!
  totalPayout: BigInt!
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
  agent.totalBets = 0;
  agent.totalTraded = BigInt.fromI32(0);
  agent.totalFees = BigInt.fromI32(0);
  agent.totalPayout = BigInt.fromI32(0);
  agent.blockNumber = event.block.number;
  agent.blockTimestamp = event.block.timestamp;
  agent.transactionHash = event.transaction.hash;
  agent.save();

  let global = getGlobal();
  global.totalTraderAgents = global.totalTraderAgents + 1;
  global.save();
}
```

**Pattern**: Only registered agents are tracked (selective indexing).

**Note**: This initial version focuses solely on agent registration. Future versions will add handlers for:
- Trading activity tracking
- Market settlements
- Payout redemptions
- Daily profit statistics

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

---

## Configuration Reference (subgraph.yaml)

### Data Sources

1. **ServiceRegistryL2** (0xE3607b00E75f6405248323A9417ff6b39B244b50)
   - Network: Polygon (matic)
   - Start block: 80360433
   - Events: `CreateMultisigWithAgents`

---

## Future Enhancements

This is a minimal initial implementation. Future versions will include:

### Phase 2 - Trading Activity
- **Bet** entity: Track individual trades
- **Market** entity: Track Polymarket markets
- Trade event handlers (buys/sells)

### Phase 3 - Profitability Tracking
- **DailyProfitStatistic** entity: Day-to-day performance
- **MarketParticipant** entity: Per-market agent statistics
- Settlement and payout handlers
- Profit/loss calculation

### Phase 4 - Advanced Features
- Market creation tracking
- Detailed fee analysis
- Time-series aggregations
- Cross-market analytics

---

## Key Differences from Omen Subgraph

This Polymarket subgraph differs from the Omen implementation:

1. **Minimal Scope**: Only TraderAgent and Global entities (vs. full suite in Omen)
2. **Network**: Polygon instead of Gnosis Chain
3. **Platform**: Polymarket instead of Omen
4. **Future Integration**: Will need to integrate with Polymarket-specific contracts and events

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

---

## Additional Resources

- **The Graph Docs**: https://thegraph.com/docs
- **AssemblyScript Docs**: https://www.assemblyscript.org/
- **Polymarket Docs**: https://docs.polymarket.com/

---

## Summary for AI Assistants

### Critical Points to Remember

1. **Minimal Implementation**: Only agent registration tracking in this version
2. **Polygon Network**: Different from Omen (Gnosis Chain)
3. **Selective Indexing**: Only registered agents tracked via ServiceRegistryL2
4. **Future Expansion**: Designed to be extended with trading, settlement, and profit tracking

### Common Modification Patterns

**Adding New Statistics:**
1. Update schema.graphql
2. Run `npm run codegen`
3. Update relevant handlers
4. Rebuild and deploy

**When Expanding to Track Trading:**
1. Add new entities (Bet, Market, etc.)
2. Add new data sources for Polymarket contracts
3. Implement trading event handlers
4. Add settlement and payout logic

---

*This document is maintained for AI-assisted development. Update when handlers, schema, or patterns change.*
