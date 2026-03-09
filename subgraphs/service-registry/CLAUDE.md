# Service Registry Subgraph

Tracks the lifecycle of Olas services across Ethereum mainnet and 7 L2 networks: agent registration, multisig creation, service termination, ERC-8004 agent identity, and daily activity metrics.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Multi-Network Pattern](#multi-network-pattern)
- [Key Business Rules](#key-business-rules)
- [Configuration](#configuration)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)

---

## Architecture Overview

### Directory Structure
```
subgraphs/service-registry/
├── schema.graphql
├── subgraph.template.yaml          # Template for L2 manifests
├── subgraph.mainnet.yaml           # Mainnet (uses ServiceRegistry, mapping-eth.ts)
├── subgraph.gnosis.yaml            # Generated from template
├── subgraph.base.yaml
├── subgraph.celo.yaml
├── subgraph.optimism.yaml
├── subgraph.matic.yaml
├── subgraph.arbitrum-one.yaml
├── networks.json                   # Contract addresses & start blocks per network
├── src/
│   ├── mapping.ts                  # L2 handlers (imports ServiceRegistryL2)
│   ├── mapping-eth.ts              # Mainnet handlers (imports ServiceRegistry)
│   └── utils.ts                    # Shared helpers & entity factories
└── package.json                    # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Indexed Contracts

| Contract | Used On | Purpose |
|----------|---------|---------|
| `ServiceRegistry` | Mainnet | Core service management (different ABI, `CreateService` has 1 param) |
| `ServiceRegistryL2` | L2 networks | L2 service management (`CreateService` has 2 params: `serviceId` + `configHash`) |
| `IdentityRegistryBridger` | All networks | ERC-8004 agent identity: links agents to services, sets wallets, manages metadata |
| `GnosisSafe` (template) | All networks | Dynamic — created per multisig to track `ExecutionSuccess` and `ExecutionFromModuleSuccess` |

### Mainnet vs L2 Differences

- **Mainnet** (`mapping-eth.ts`): Imports from `ServiceRegistry` ABI. `CreateService` event has only `serviceId` (no `configHash`). Uses `subgraph.mainnet.yaml`.
- **L2** (`mapping.ts`): Imports from `ServiceRegistryL2` ABI. `CreateService` event includes `configHash`. Uses generated manifests from `subgraph.template.yaml`.
- Both files share identical handler logic (copy-pasted) and import the same utils.

---

## Schema Reference

### Service
Represents an Olas service with its registered agents and multisig.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Service ID (string) |
| multisig | `Bytes` | Nullable. Set on `CreateMultisigWithAgents`, cleared on `TerminateService` |
| agentIds | `[Int!]!` | Agent IDs registered to this service |
| creationTimestamp | `BigInt!` | Set on `CreateService` |
| configHash | `Bytes` | Nullable. L2 only — set on `CreateService` |
| creator | `Creator` | Nullable. Set on `CreateMultisigWithAgents` from `tx.from`, cleared on terminate |
| erc8004Agent | `ERC8004Agent` | Nullable. Set on `ServiceAgentLinked` |

### ERC8004Agent
Agent identity from the IdentityRegistryBridger contract.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Agent ID (string) |
| service | `[Service!]!` | `@derivedFrom(field: "erc8004Agent")` |
| agentWallet | `Bytes` | Nullable. Set on `AgentWalletSet` |
| metadata | `[ERC8004Metadata!]` | `@derivedFrom(field: "agent")` |

### ERC8004Metadata
Key-value metadata for ERC-8004 agents. Default entries (`ecosystem: "Olas"`, `serviceRegistry: <serviceId>`) are created on `ServiceAgentLinked`.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{agentId}-{metadataKey}` |
| agent | `ERC8004Agent!` | |
| key | `String!` | |
| value | `String` | Nullable |

### Multisig
Gnosis Safe wallet created for a service.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Multisig address |
| serviceId | `Int!` | |
| creator | `Bytes!` | `tx.from` at multisig creation |
| creationTimestamp | `BigInt!` | |
| txHash | `Bytes!` | |
| agentIds | `[Int!]!` | **Most recently registered agent only** (not all agents) to prevent double counting |

### AgentRegistration
Records when an agent was registered to a service. Used to determine most recent agent at multisig creation.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{serviceId}-{agentId}` |
| serviceId | `Int!` | |
| agentId | `Int!` | |
| registrationTimestamp | `BigInt!` | Updated on each `RegisterInstance` |

### Creator
Service deployer address.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Creator address |
| services | `[Service!]!` | `@derivedFrom(field: "creator")` |

### Operator
Unique operator addresses (tracked globally).

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Operator address |

### AgentPerformance
Cumulative transaction count per agent (all-time).

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Agent ID (string) |
| txCount | `BigInt!` | Total transactions across all multisigs |

### Global
Singleton aggregate statistics (id: `""`).

| Field | Type | Notes |
|-------|------|-------|
| txCount | `BigInt!` | Total multisig transactions |
| lastUpdated | `BigInt!` | Timestamp of last transaction |
| totalOperators | `Int!` | Unique operator count |

### Daily Aggregation Entities

**DailyServiceActivity** — Active agents per service per day.
- ID: `day-{dayTimestamp}-service-{serviceId}`
- Fields: `service`, `dayTimestamp`, `agentIds`

**DailyUniqueAgents** — Unique active agents across all services per day.
- ID: `day-{dayTimestamp}`
- Fields: `dayTimestamp`, `count`, `agents` (derived)
- Uses `DailyUniqueAgent` join entity for deduplication (each agent counted once per day)

**DailyAgentPerformance** — Per-agent daily transaction count and active multisig count.
- ID: `day-{dayTimestamp}-agent-{agentId}`
- Fields: `dayTimestamp`, `agentId`, `txCount`, `activeMultisigCount`, `multisigs` (derived)
- Uses `DailyAgentMultisig` join entity for deduplication

**DailyActiveMultisigs** — System-wide active multisig count per day.
- ID: `day-{dayTimestamp}`
- Fields: `dayTimestamp`, `count`, `multisigs` (derived)
- Uses `DailyActiveMultisig` join entity for deduplication

---

## Event Handlers

### 1. handleCreateService
**File**: `mapping.ts` / `mapping-eth.ts` | **Event**: `CreateService`

- Creates `Service` entity with empty `agentIds` and `creationTimestamp`
- L2 version also stores `configHash`; mainnet version does not

### 2. handleRegisterInstance
**Event**: `RegisterInstance(indexed address, indexed uint256, indexed address, uint256)`

- Loads or creates `Service`
- Creates `AgentRegistration` with timestamp (used later by `getMostRecentAgentId`)
- Adds agent ID to `service.agentIds` (deduplicates)
- Calls `updateUniqueOperators()` — creates `Operator` entity and increments `Global.totalOperators` on first seen

### 3. handleCreateMultisig
**Event**: `CreateMultisigWithAgents(indexed uint256, indexed address)`

- **Guard**: Service must already exist
- Creates `Creator` entity from `tx.from`, links to service
- Creates `Multisig` entity with creator, timestamp, txHash
- **Agent selection**: Uses `getMostRecentAgentId()` to pick only the most recently registered agent (prevents double counting in daily metrics). Falls back to all agents if none found.
- Creates `GnosisSafe` dynamic template for the new multisig address

### 4. handleTerminateService
**Event**: `TerminateService(indexed uint256)`

- Clears `service.agentIds`, `service.multisig`, and `service.creator`

### 5. handleExecutionSuccess / handleExecutionFromModuleSuccess
**Events**: `ExecutionSuccess(bytes32, uint256)` / `ExecutionFromModuleSuccess(indexed address)`

Both handlers have identical logic — triggered by GnosisSafe multisig transactions:
- **Guard**: Multisig and its associated Service must exist
- Updates all daily aggregation entities:
  - `DailyServiceActivity`: Records active agents for this service today
  - `DailyUniqueAgents`: Deduplicates agents active today (via join entity)
  - `DailyAgentPerformance`: Increments per-agent `txCount`, tracks active multisigs per agent (via join entity)
  - `DailyActiveMultisigs`: Deduplicates active multisigs today (via join entity)
- Increments `AgentPerformance.txCount` (cumulative per agent)
- Increments `Global.txCount` and updates `Global.lastUpdated`
- **Agent ID mismatch guard**: Validates `entity.agentId == agentId` in `updateDailyAgentPerformance` to prevent cross-agent contamination

### 6. handleServiceAgentLinked (IdentityRegistryBridger)
**Event**: `ServiceAgentLinked(indexed uint256, indexed uint256)`

- Links an ERC-8004 agent to a service
- Initializes default metadata: `ecosystem: "Olas"`, `serviceRegistry: {serviceId}`

### 7. handleAgentWalletSet (IdentityRegistryBridger)
**Event**: `AgentWalletSet(indexed uint256, indexed uint256, indexed address)`

- Sets `ERC8004Agent.agentWallet`

### 8. handleMetadataSet (IdentityRegistryBridger)
**Event**: `MetadataSet(indexed uint256, indexed uint256, string, bytes)`

- Creates/updates `ERC8004Metadata` with key-value pair

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `getDayTimestamp(event)` | UTC midnight: `timestamp / 86400 * 86400` |
| `getOrCreateService(serviceId, timestamp?)` | Load-or-create Service |
| `getOrCreateMultisig(address, event)` | Load-or-create Multisig |
| `getOrCreateDailyServiceActivity(serviceId, event)` | Daily service activity |
| `getOrCreateDailyUniqueAgents(event)` | Daily unique agents counter |
| `getOrCreateDailyAgentPerformance(event, agentId)` | Daily per-agent performance |
| `getOrCreateDailyActiveMultisigs(event)` | Daily active multisigs counter |
| `getGlobal()` | Singleton Global (id: `""`) |
| `getOrCreateAgentPerformance(agentId)` | Cumulative agent performance |
| `getOrCreateOperator(address)` | Load-or-create Operator |
| `updateUniqueOperators(address)` | Create operator + increment `Global.totalOperators` on first seen |
| `getOrCreateServiceCreator(address)` | Load-or-create Creator |
| `createDailyUniqueAgent(dailyUniqueAgents, agent)` | Join entity — deduplicates agents per day, increments `count` |
| `createDailyAgentMultisig(dailyAgentPerformance, multisig)` | Join entity — tracks multisigs per agent per day, increments `activeMultisigCount` |
| `createDailyActiveMultisig(dailyActiveMultisigs, multisig)` | Join entity — deduplicates active multisigs per day, increments `count` |
| `createOrUpdateAgentRegistration(serviceId, agentId, timestamp)` | Records registration timestamp |
| `getMostRecentAgentId(serviceId, agentIds, deploymentTimestamp)` | Finds most recently registered agent before deployment (prevents double counting) |
| `getOrCreateERC8004Agent(agentId)` | Load-or-create ERC8004Agent |
| `getOrCreateERC8004Metadata(agentId, key)` | Load-or-create metadata entry |
| `initializeERC8004DefaultMetadata(agentId, serviceId)` | Sets `ecosystem: "Olas"` and `serviceRegistry: {serviceId}` |

---

## Multi-Network Pattern

Uses **template pattern**: `subgraph.template.yaml` + `networks.json` + `scripts/generate-manifests.js`.

- L2 manifests are generated from the template (Mustache syntax: `{{ ServiceRegistryL2.address }}`)
- Mainnet (`subgraph.mainnet.yaml`) is hand-written — uses `ServiceRegistry` ABI (different `CreateService` signature)
- Both mainnet and L2 manifests also include `IdentityRegistryBridger` data source

### Supported Networks

| Network | Contract | Manifest |
|---------|----------|----------|
| Ethereum | `ServiceRegistry` 0x48b6af7B | `subgraph.mainnet.yaml` |
| Gnosis | `ServiceRegistryL2` 0x9338b515 | `subgraph.gnosis.yaml` |
| Base | `ServiceRegistryL2` 0x3C1fF68f | `subgraph.base.yaml` |
| Optimism | `ServiceRegistryL2` 0x3d77596b | `subgraph.optimism.yaml` |
| Polygon | `ServiceRegistryL2` 0xE3607b00 | `subgraph.matic.yaml` |
| Arbitrum | `ServiceRegistryL2` 0xE3607b00 | `subgraph.arbitrum-one.yaml` |
| Celo | `ServiceRegistryL2` 0xE3607b00 | `subgraph.celo.yaml` |

---

## Key Business Rules

1. **Most Recent Agent Selection**: At multisig creation, only the most recently registered agent is assigned to the multisig (via `getMostRecentAgentId`). This prevents double-counting in daily metrics when a service has multiple agents.
2. **Daily Deduplication**: All daily entities use join entities (`DailyUniqueAgent`, `DailyAgentMultisig`, `DailyActiveMultisig`) with load-or-create pattern to ensure each item is counted exactly once per day.
3. **Service Termination Clears State**: `TerminateService` resets `agentIds`, `multisig`, and `creator` to empty/null. The multisig entity itself is not deleted.
4. **GnosisSafe Dynamic Template**: Created on `CreateMultisigWithAgents`. Both `ExecutionSuccess` and `ExecutionFromModuleSuccess` trigger identical daily metric updates.
5. **Operator Tracking**: Each unique operator address (from `RegisterInstance`) increments `Global.totalOperators` exactly once.
6. **ERC-8004 Identity**: `IdentityRegistryBridger` events manage agent identity (wallet, metadata) independently from service registration. Default metadata (`ecosystem`, `serviceRegistry`) is auto-initialized on `ServiceAgentLinked`.

---

## Configuration

### Data Sources

| Data Source | Events | Handler File |
|-------------|--------|--------------|
| ServiceRegistry (mainnet) | `CreateService(indexed uint256)`, `CreateMultisigWithAgents`, `RegisterInstance`, `TerminateService` | `mapping-eth.ts` |
| ServiceRegistryL2 (L2s) | `CreateService(indexed uint256, bytes32)`, `CreateMultisigWithAgents`, `RegisterInstance`, `TerminateService` | `mapping.ts` |
| IdentityRegistryBridger | `ServiceAgentLinked`, `AgentWalletSet`, `MetadataSet` | `mapping.ts` / `mapping-eth.ts` |

### Dynamic Template

| Template | Events | Handler File |
|----------|--------|--------------|
| GnosisSafe | `ExecutionSuccess(bytes32, uint256)`, `ExecutionFromModuleSuccess(indexed address)` | `mapping.ts` / `mapping-eth.ts` |

**Spec**: v0.0.5 | **API**: 0.0.6

---

## Development Workflow

```bash
yarn install                        # Install dependencies
yarn codegen                        # Generate TS types (defaults to gnosis)
yarn build                          # Build (defaults to gnosis)
yarn generate-manifests             # Regenerate L2 manifests from template
yarn test                           # Run Matchstick tests
```

Deploy per-network:
```bash
yarn deploy-gnosis
yarn deploy-ethereum
yarn deploy-base
yarn deploy-optimism
yarn deploy-arbitrum
yarn deploy-polygon
yarn deploy-celo
```

---

## Common Queries

### Daily Active Agents per Agent ID
```graphql
{
  dailyAgentPerformances(
    where: { agentId: 40, dayTimestamp_gte: "1672531200" }
    orderBy: dayTimestamp
    orderDirection: desc
  ) {
    dayTimestamp
    activeMultisigCount
  }
}
```

### Daily Active Multisigs (System-Wide)
```graphql
{
  dailyActiveMultisigs(
    orderBy: dayTimestamp
    orderDirection: desc
    where: { dayTimestamp_gte: "1672531200" }
  ) {
    dayTimestamp
    count
  }
}
```

### Total Transactions per Agent
```graphql
{
  agentPerformances(orderBy: txCount, orderDirection: desc) {
    id
    txCount
  }
}
```

### Global Statistics
```graphql
{
  global(id: "") {
    txCount
    totalOperators
  }
}
```
