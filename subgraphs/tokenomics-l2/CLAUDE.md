# Autonolas Tokenomics L2 Subgraph

Tracks OLAS token transfers and holder balances across 6 Layer 2 networks. Lightweight subgraph using the template pattern for multi-network deployment.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Multi-Network Pattern](#multi-network-pattern)
- [Configuration](#configuration)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)
- [AI Summary](#ai-summary)

---

## Architecture Overview

### Directory Structure
```
subgraphs/tokenomics-l2/
├── schema.graphql
├── subgraph.template.yaml           # Template with {{ network }}, {{ OLAS.address }}, {{ OLAS.startBlock }}
├── networks.json                    # Per-network contract addresses and start blocks
├── subgraph.arbitrum-one.yaml       # Generated
├── subgraph.base.yaml              # Generated
├── subgraph.celo.yaml              # Generated
├── subgraph.gnosis.yaml            # Generated
├── subgraph.matic.yaml             # Generated
├── subgraph.optimism.yaml          # Generated
├── src/
│   ├── olas-l2.ts                  # Transfer event handler
│   └── utils.ts                    # Token/holder balance management
└── package.json                     # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Supported Networks

| Network | OLAS Address | Start Block |
|---------|-------------|-------------|
| Arbitrum One | 0x064F8B858C2A603e1b106a2039f5446D32dc81c1 | 173,139,043 |
| Base | 0x54330d28ca3357F294334BDC454a032e7f353416 | 10,622,421 |
| Celo | 0xaCFfAe8e57Ec6E394Eb1b41939A8CF7892DbDc51 | 24,781,592 |
| Gnosis | 0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f | 30,254,468 |
| Optimism | 0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527 | 116,217,922 |
| Polygon (matic) | 0xFEF5d947472e72Efbb2E388c730B7428406F2F95 | 49,574,787 |

### Core Business Rules

1. **Single contract per network**: Only the OLAS ERC-20 token Transfer event is indexed.
2. **Balance tracking**: Maintains running Token supply and individual TokenHolder balances.
3. **Holder count management**: holderCount increments when a holder's balance goes from 0 to positive, decrements when it drops to 0.
4. **Mint/burn detection**: Transfers from `ADDRESS_ZERO` are mints (increase Token supply); transfers to `ADDRESS_ZERO` are burns (decrease supply).
5. **Transfer history**: Every Transfer event is stored as an immutable entity for historical queries.

---

## Schema Reference

### Token (mutable)
Represents the OLAS token on the network.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Token contract address |
| balance | `BigInt!` | Total token supply (adjusted for mints/burns) |
| holderCount | `Int!` | Number of unique holders with balance > 0 |

### TokenHolder (mutable)
Individual holder's OLAS balance.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Holder address |
| token | `Bytes!` | Token address |
| balance | `BigInt!` | Current balance |

### Transfer (immutable)
Record of every OLAS transfer.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| from | `Bytes!` | Sender |
| to | `Bytes!` | Recipient |
| value | `BigInt!` | Transfer amount |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

---

## Event Handlers

### handleTransfer (`src/olas-l2.ts`)
**Event**: `Transfer(indexed address from, indexed address to, uint256 amount)`

1. Creates immutable `Transfer` entity with transaction details
2. Calls `handleTransferBalances()` to update Token and TokenHolder state

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `getOrCreateToken(tokenAddress)` | Load-or-create Token entity (initializes balance=0, holderCount=0) |
| `getOrCreateTokenHolder(tokenAddress, holderAddress)` | Load-or-create TokenHolder entity (initializes balance=0) |
| `handleTransferBalances(tokenAddress, from, to, amount)` | Core balance logic: mint detection (from=zero, increases supply), burn detection (to=zero, decreases supply), holder balance updates, holderCount management |

---

## Multi-Network Pattern

Uses the **Template Pattern** (shared with service-registry and staking subgraphs):

1. **`networks.json`**: Defines OLAS contract address and startBlock per network
2. **`subgraph.template.yaml`**: Contains `{{ network }}`, `{{ OLAS.address }}`, `{{ OLAS.startBlock }}` placeholders
3. **`scripts/generate-manifests.js`** (at repo root): Reads template + networks.json, outputs `subgraph.<network>.yaml` per network
4. **Shared codebase**: All networks use identical `schema.graphql`, `src/olas-l2.ts`, and `src/utils.ts`

### Generating Manifests
```bash
yarn generate-manifests    # Runs: node ../../scripts/generate-manifests.js --path=.
```

### Adding a New Network
1. Add entry to `networks.json` with OLAS address and startBlock
2. Run `yarn generate-manifests` to create the new `subgraph.<network>.yaml`
3. Deploy the new manifest

---

## Configuration

**Single data source per network**: OLAS token contract

| Event | Handler |
|-------|---------|
| `Transfer(indexed address, indexed address, uint256)` | `handleTransfer` |

**Spec**: v0.0.5 | **API**: 0.0.7 | **ABI**: `../../abis/OLAS.json` (shared)

Note: `codegen` and `build` scripts default to using the Gnosis manifest (`subgraph.gnosis.yaml`).

---

## Development Workflow

```bash
cd subgraphs/tokenomics-l2
yarn install               # Install dependencies
yarn generate-manifests    # Generate per-network YAML files from template
yarn codegen               # Generate TypeScript from schema + ABIs (uses gnosis manifest)
yarn build                 # Compile to WebAssembly (uses gnosis manifest)
yarn test                  # Run Matchstick tests
```

---

## Common Queries

### Token Supply and Holder Count
```graphql
{
  tokens {
    id
    balance
    holderCount
  }
}
```

### Top Holders
```graphql
{
  tokenHolders(orderBy: balance, orderDirection: desc, first: 10) {
    id
    balance
  }
}
```

### Recent Transfers
```graphql
{
  transfers(orderBy: blockTimestamp, orderDirection: desc, first: 20) {
    from
    to
    value
    blockTimestamp
    transactionHash
  }
}
```

---

## AI Summary

### Critical Points
1. **Minimal subgraph**: 3 entities (Token, TokenHolder, Transfer), 1 event handler, 1 contract per network.
2. **All financial fields are `BigInt`** -- no BigDecimal.
3. **Template pattern**: `subgraph.template.yaml` + `networks.json` generates per-network manifests. Same code deployed to 6 L2s.
4. **Balance logic is identical to tokenomics-eth**: `handleTransferBalances()` in both subgraphs uses the same pattern (mint/burn detection, holderCount management). The tokenomics-l2 version is a clean standalone copy in its own `src/utils.ts`.
5. **No complex business logic**: Pure ERC-20 transfer tracking. No epochs, bonds, incentives, or staking -- that's all in tokenomics-eth (Ethereum mainnet only).
6. **Spec version difference**: Uses v0.0.5 (vs v1.0.0 in tokenomics-eth). No pruning configured.
7. **Gnosis as default build target**: `codegen` and `build` scripts use `subgraph.gnosis.yaml`. To build for another network, run `graph build subgraph.<network>.yaml`.
