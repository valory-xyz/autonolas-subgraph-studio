# Governance Subgraph

Tracks the OLAS token governance system on Ethereum mainnet. Indexes two GovernorOLAS contract versions, covering the full proposal lifecycle (creation, voting, queuing, execution, cancellation), governance parameter changes, and timelock management.

## Architecture Overview

### Directory Structure
```
subgraphs/governance/
├── schema.graphql          # Entity definitions (11 entities)
├── subgraph.yaml           # Manifest with 2 GovernorOLAS data sources
├── package.json            # graph-cli ^0.97.0, graph-ts ^0.38.0, matchstick-as 0.5.0
├── src/
│   ├── governor-olas.ts    # All 11 event handlers
│   └── utils.ts            # Historical quorum calculation utility
```

### Key Contracts (Ethereum Mainnet)

| Contract | Address | Blocks | Status |
|----------|---------|--------|--------|
| GovernorOLAS V1 | `0x34C895f302D0b5cf52ec0Edd3945321EB0f83dd5` | 15050305 → 17527057 | Archived |
| GovernorOLAS V2 | `0x8e84b5055492901988b831817e4ace5275a3b401` | 17527057 → present | Active |

Both contracts share the same ABI (`abis/GovernorOLAS.json`) and the same set of 11 event handlers. V1 has an `endBlock` set at the upgrade point.

---

## Schema Reference

### Core Governance Entities

#### ProposalCreated (mutable)
Main entity representing governance proposals.
| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `proposalId.toString()` |
| proposalId | `BigInt!` | Unique proposal identifier |
| proposer | `Bytes!` | Address of proposal creator |
| targets | `[Bytes!]!` | Contract addresses to call |
| values | `[BigInt!]!` | ETH values for each call |
| signatures | `[String!]!` | Function signatures |
| calldatas | `[Bytes!]!` | Encoded function calls |
| startBlock / endBlock | `BigInt!` | Voting period boundaries |
| description | `String!` | Human-readable proposal description |
| votesFor | `BigInt!` | Cumulative votes in favor |
| votesAgainst | `BigInt!` | Cumulative votes against |
| quorum | `BigInt` | Required votes to pass (nullable, lazily calculated) |
| isExecuted | `Boolean!` | Execution status |
| isCancelled | `Boolean!` | Cancellation status |
| isQueued | `Boolean!` | Queued for timelock status |
| voteCasts | `[VoteCast!]` | @derivedFrom — votes on this proposal |

#### VoteCast (immutable)
Individual votes on proposals.
| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| voter | `Bytes!` | Address that voted |
| proposalId | `BigInt!` | Proposal being voted on |
| support | `Int!` | 0=against, 1=for, 2=abstain |
| weight | `BigInt!` | Voting power used |
| reason | `String!` | Optional vote reason |
| proposalCreated | `ProposalCreated` | Link to parent proposal |

### Proposal Lifecycle Events (all immutable)

| Entity | Key Fields | Side Effect |
|--------|------------|-------------|
| ProposalCanceled | `proposalId` | Sets `ProposalCreated.isCancelled = true` |
| ProposalExecuted | `proposalId` | Sets `ProposalCreated.isExecuted = true` |
| ProposalQueued | `proposalId`, `eta` | Sets `ProposalCreated.isQueued = true` |

### Governance Parameter Events (all immutable)

| Entity | Key Fields | Purpose |
|--------|------------|---------|
| ProposalThresholdSet | `oldProposalThreshold`, `newProposalThreshold` | Min votes to create proposal |
| QuorumNumeratorUpdated | `oldQuorumNumerator`, `newQuorumNumerator` | Quorum percentage changes |
| VotingDelaySet | `oldVotingDelay`, `newVotingDelay` | Delay before voting starts |
| VotingPeriodSet | `oldVotingPeriod`, `newVotingPeriod` | Voting duration changes |
| TimelockChange | `oldTimelock`, `newTimelock` | Timelock contract changes |

### VoteCastWithParams (immutable)
Same as VoteCast but includes `params: Bytes!` for extended voting parameters. Does **not** update vote tallies on the parent proposal.

---

## Event Handlers

**File**: `src/governor-olas.ts`

| Event | Handler | Logic |
|-------|---------|-------|
| `ProposalCreated` | `handleProposalCreated` | Creates entity, converts Address[] to Bytes[], initializes vote counts to zero, all status flags to false |
| `ProposalCanceled` | `handleProposalCanceled` | Creates event entity, sets `isCancelled = true`, calls `updateProposalQuorum()` |
| `ProposalExecuted` | `handleProposalExecuted` | Creates event entity, sets `isExecuted = true`, calls `updateProposalQuorum()` |
| `ProposalQueued` | `handleProposalQueued` | Creates event entity with `eta`, sets `isQueued = true`, calls `updateProposalQuorum()` |
| `VoteCast` | `handleVoteCast` | Creates VoteCast entity, **accumulates votes**: support=0 → `votesAgainst`, support=1 → `votesFor`, support=2 → neither |
| `VoteCastWithParams` | `handleVoteCastWithParams` | Creates event entity only, does **not** update vote counts on proposal |
| `ProposalThresholdSet` | `handleProposalThresholdSet` | Creates event entity |
| `QuorumNumeratorUpdated` | `handleQuorumNumeratorUpdated` | Creates event entity |
| `VotingDelaySet` | `handleVotingDelaySet` | Creates event entity |
| `VotingPeriodSet` | `handleVotingPeriodSet` | Creates event entity |
| `TimelockChange` | `handleTimelockChange` | Creates event entity |

---

## Core Logic

### Vote Accumulation
- Only `handleVoteCast` updates `votesFor`/`votesAgainst` on `ProposalCreated`
- `VoteCastWithParams` logs the event but does **not** modify vote tallies
- Abstain votes (support=2) do not increment either counter

### Quorum Calculation (`src/utils.ts`)
- `updateProposalQuorum(proposalId, blockNumber, contractAddress)` is called by lifecycle handlers (canceled, executed, queued)
- Only calculates if: proposal exists, quorum is null, current block > proposal's start block
- Uses on-chain call: `contract.quorum(proposalCreated.startBlock)` to get historical quorum at the proposal's voting start
- Enables accurate retroactive quorum display for older proposals

### Entity ID Patterns
- **Proposals**: `event.params.proposalId.toString()`
- **Event entities**: `event.transaction.hash.concatI32(event.logIndex.toI32())`

---

## Development Workflow

```bash
cd subgraphs/governance
yarn install
yarn codegen                # Generate types from schema + ABIs
yarn build                  # Compile to WASM
yarn test                   # Run Matchstick tests (no tests currently)
```

---

## AI Summary

### Critical Points
1. **Two contract versions**: V1 archived at block 17527057, V2 active from same block. Both use identical handlers and ABI.
2. **Vote accumulation asymmetry**: `handleVoteCast` updates proposal vote tallies; `handleVoteCastWithParams` does not.
3. **Lazy quorum**: Quorum is not set at proposal creation — it's backfilled on first lifecycle event (cancel/execute/queue) when `currentBlock > startBlock`.
4. **Proposal entity is mutable**: Updated by VoteCast (tallies), ProposalCanceled/Executed/Queued (status flags), and quorum calculation.
5. **All other entities are immutable**: Event log entities created once and never modified.
6. **Indexer hints**: Prune mode set to `auto` in subgraph.yaml.
7. **Single network**: Ethereum mainnet only.
