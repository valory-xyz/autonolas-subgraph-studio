# Protocol Owned Liquidity Subgraph — Ethereum Mainnet

Tracks the full Olas Protocol Owned Liquidity on Ethereum mainnet: the native OLAS-ETH Uniswap V2 pool (reserves, supply, treasury holdings, USD valuation via Chainlink) and 7 bridged LP tokens from L2/Solana held by Treasury.

See [README.md](README.md) for the full POL picture across all chains.
See [../liquidity-l2/CLAUDE.md](../liquidity-l2/CLAUDE.md) for the L2 Balancer pool subgraph.

## Architecture Overview

### Directory Structure
```
subgraphs/liquidity/
├── schema.graphql
├── subgraph.yaml          # prune: auto enabled, 9 data sources
├── src/
│   ├── mapping.ts         # Event handlers (handleLPTransfer, handleSync, handleBridgedLPTransfer)
│   └── utils.ts           # Constants, helpers, get-or-create patterns, USD math
├── tests/
│   ├── mapping.test.ts    # 14 Matchstick tests
│   ├── mapping-utils.ts   # Event factory functions
│   └── test-helpers.ts    # Test constants
└── package.json           # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Contracts Indexed (Ethereum Mainnet)

| Data Source | Contract | Address | ABI | Events | Handler |
|---|---|---|---|---|---|
| OLASETHLPToken | OLAS-ETH LP (ERC20) | `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F` | ERC20 | `Transfer` | `handleLPTransfer` |
| OLASETHPair | OLAS-ETH LP (UniV2) | `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F` | UniswapV2Pair + AggregatorV3Interface | `Sync` | `handleSync` |
| BridgedLP_Gnosis | Gnosis OLAS-WXDAI | `0x27df632fd0dcf191C418c803801D521cd579F18e` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Polygon | Polygon OLAS-WMATIC | `0xf9825A563222f9eFC81e369311DAdb13D68e60a4` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Solana | Solana WSOL-OLAS | `0x3685B8cC36B8df09ED9E81C1690100306bF23E04` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Arbitrum | Arbitrum OLAS-WETH | `0x36B203Cb3086269f005a4b987772452243c0767f` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Optimism | Optimism WETH-OLAS | `0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Base | Base OLAS-USDC | `0x9946d6FD1210D85EC613Ca956F142D911C97a074` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |
| BridgedLP_Celo | Celo CELO-OLAS | `0xC085F31E4ca659fF8A17042dDB26f1dcA2fBdAB4` | ERC20 | `Transfer` | `handleBridgedLPTransfer` |

All start from block 17,679,229.

### Key Addresses

- **Treasury**: `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` — holds all POL (native LP + bridged LP tokens)
- **Depository**: `0xfF8697d8d2998d6AA2e09B405795C6F4BEeB0C81` — bond products; LP tokens deposited here by bonders
- **Chainlink ETH/USD**: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` — price feed proxy (called via `latestRoundData()`)

---

## Schema Reference

### LPTransfer (immutable)
Individual LP token transfer event for the native OLAS-ETH pool.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| from | `Bytes!` | Sender address |
| to | `Bytes!` | Recipient address |
| value | `BigInt!` | LP tokens transferred (wei) |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

### PoolReserves (mutable)
Current pool reserves — single entity per pool address.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Pool contract address |
| reserve0 | `BigInt!` | OLAS reserves (wei) |
| reserve1 | `BigInt!` | ETH reserves (wei) |
| lastSyncBlock | `BigInt!` | |
| lastSyncTimestamp | `BigInt!` | |
| lastSyncTransaction | `Bytes!` | |

### TreasuryHoldings (mutable)
Treasury LP token balance tracker for the native OLAS-ETH pool.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Treasury address |
| currentBalance | `BigInt!` | Current LP token balance |
| totalAcquired | `BigInt!` | Cumulative tokens received |
| totalSold | `BigInt!` | Cumulative tokens sent out |
| firstTransactionTimestamp | `BigInt!` | |
| lastTransactionTimestamp | `BigInt!` | |
| transactionCount | `Int!` | |

### LPTokenMetrics (mutable)
Singleton aggregate metrics (id: `"global"`).

| Field | Type | Notes |
|-------|------|-------|
| totalSupply | `BigInt!` | Current total LP supply (minted - burned) |
| totalMinted | `BigInt!` | Cumulative minted |
| totalBurned | `BigInt!` | Cumulative burned |
| treasurySupply | `BigInt!` | LP tokens held by treasury |
| treasuryPercentage | `BigInt!` | Treasury % in basis points (10000 = 100%) |
| currentReserve0 | `BigInt!` | Current OLAS reserves |
| currentReserve1 | `BigInt!` | Current ETH reserves |
| ethUsdPrice | `BigInt!` | Latest ETH/USD from Chainlink (8 decimals) |
| poolLiquidityUsd | `BigInt!` | Total pool value in USD (8 decimals) |
| protocolOwnedLiquidityUsd | `BigInt!` | Treasury's share in USD (8 decimals) |
| lastUpdated | `BigInt!` | |
| firstTransferTimestamp | `BigInt!` | |

### PriceData (mutable)
Chainlink ETH/USD price (id: `"eth-usd"`).

| Field | Type | Notes |
|-------|------|-------|
| price | `BigInt!` | ETH/USD price (8 decimals from Chainlink) |
| lastUpdatedBlock | `BigInt!` | |
| lastUpdatedTimestamp | `BigInt!` | |

### BridgedPOLHolding (mutable)
Treasury's balance of one bridged LP token from an L2/Solana chain.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Bridged LP token address on Ethereum |
| originChain | `String!` | Source chain (gnosis, polygon, solana, arbitrum, optimism, base, celo) |
| pair | `String!` | Trading pair (OLAS-WXDAI, OLAS-WMATIC, etc.) |
| currentBalance | `BigInt!` | Treasury's current balance |
| totalAcquired | `BigInt!` | Cumulative tokens received by Treasury |
| totalSold | `BigInt!` | Cumulative tokens sent from Treasury |
| lastTransactionTimestamp | `BigInt!` | |
| transactionCount | `Int!` | |

---

## Event Handlers

### 1. handleLPTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

- Creates immutable `LPTransfer` entity for every transfer of the native OLAS-ETH LP token
- **Mint detection**: `from == 0x0` → increments `totalSupply` and `totalMinted`
- **Burn detection**: `to == 0x0` → decrements `totalSupply`, increments `totalBurned`
- **Treasury tracking**: If `to` is treasury → `updateTreasuryHoldings(amount, isIncoming=true)`; if `from` is treasury → `updateTreasuryHoldings(amount, isIncoming=false)`
- After each transfer: recalculates `treasuryPercentage` and USD valuations

### 2. handleSync
**File**: `src/mapping.ts` | **Event**: `Sync(uint112, uint112)`

- Updates `PoolReserves` entity with current `reserve0` (OLAS) and `reserve1` (ETH)
- **Chainlink price fetch**: Calls `AggregatorV3Interface.bind(CHAINLINK_ETH_USD).try_latestRoundData()` to get ETH/USD price
- Updates `PriceData` entity with fresh price
- Recalculates `poolLiquidityUsd` and `protocolOwnedLiquidityUsd`

### 3. handleBridgedLPTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

- Shared handler for all 7 bridged LP token data sources
- Only processes transfers to/from Treasury address — all others are ignored
- Uses `event.address` to identify which bridged LP token is being transferred
- Creates/updates `BridgedPOLHolding` entity with balance, metadata (originChain, pair)

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `getDayTimestamp(timestamp)` | Truncates to UTC midnight: `timestamp / 86400 * 86400` |
| `isZeroAddress(address)` | Check for zero address (mint/burn detection) |
| `isTreasuryAddress(address)` | Check for treasury address |
| `calculatePercentageBasisPoints(num, denom)` | Returns `num * 10000 / denom`, zero-safe |
| `getBridgedLPOriginChain(address)` | Maps bridged LP address → origin chain name |
| `getBridgedLPPair(address)` | Maps bridged LP address → trading pair string |
| `getOrCreateLPTokenMetrics()` | Singleton load-or-create (id: `"global"`) |
| `getOrCreateTreasuryHoldings()` | Load-or-create keyed by treasury address |
| `getOrCreatePoolReserves(poolAddress)` | Load-or-create keyed by pool address |
| `getOrCreateBridgedPOLHolding(tokenAddress)` | Load-or-create keyed by bridged LP address; auto-populates originChain and pair |
| `recalculateUsd(metrics)` | Computes `poolLiquidityUsd` and `protocolOwnedLiquidityUsd` from reserves + Chainlink price |
| `updateTreasuryHoldings(amount, isIncoming, timestamp)` | Updates balance, cumulative totals, timestamps, count |
| `updateGlobalMetricsAfterTransfer(amount, isMint, isBurn, timestamp)` | Updates supply, treasury %, recalculates USD |
| `updateGlobalMetricsAfterSync(reserve0, reserve1, timestamp)` | Updates reserve fields, recalculates USD |

### USD Calculation

```
poolLiquidityUsd (8 dec) = 2 * reserve1_ETH (18 dec) * ethUsdPrice (8 dec) / 1e18
protocolOwnedLiquidityUsd = poolLiquidityUsd * treasuryPercentage / 10000
```

Chainlink ETH/USD is fetched via `latestRoundData()` contract call on each Sync event (not event-based, since the Chainlink proxy at `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` does not re-emit `AnswerUpdated` events from its underlying aggregator).

---

## Configuration (subgraph.yaml)

**Spec**: v1.0.0 | **API**: 0.0.7 | **Network**: mainnet | **Pruning**: auto

9 data sources total:
- 2 for the native OLAS-ETH pool (Transfer + Sync events from the same contract)
- 7 for bridged LP tokens (Transfer events only, filtered for Treasury in handler)

---

## Testing

**Framework**: Matchstick-as 0.5.0 | **14 tests**

### Test Files
| File | Purpose |
|------|---------|
| `tests/mapping.test.ts` | 14 test cases across 3 handler groups |
| `tests/mapping-utils.ts` | Event factory functions (`createTransferEvent`, `createSyncEvent`) |
| `tests/test-helpers.ts` | Namespaced constants (`TestAddresses`, `TestValues`) |

### Test Coverage

| Handler | Tests | What's Covered |
|---------|-------|----------------|
| handleLPTransfer | 5 | Mint increases supply, burn decreases supply, treasury incoming/outgoing updates holdings, treasury percentage in basis points |
| handleSync | 5 | Reserve updates, global metrics reserves, Chainlink ETH/USD price fetch (mocked via `createMockedFunction`), `poolLiquidityUsd` math, `protocolOwnedLiquidityUsd` with treasury share |
| handleBridgedLPTransfer | 4 | Treasury incoming creates entity with correct metadata (originChain, pair), treasury outgoing decreases balance, non-treasury transfers ignored, multiple bridged tokens tracked independently |

### Running Tests
```bash
yarn test    # Runs all 14 Matchstick tests
```

---

## Implementation Notes

- All token amounts are in wei (18 decimals)
- Treasury percentage is stored in basis points (10000 = 100%)
- USD values are in 8 decimals (matching Chainlink precision)
- Reserves: `reserve0` = OLAS, `reserve1` = ETH
- Both native pool data sources point to the same contract (`0x09D1d767eDF8Fa23A64C51fa559E0688E526812F`)
- Bridged LP tokens use a single handler (`handleBridgedLPTransfer`) dispatched by `event.address`
- No daily aggregation entities — only current-state tracking
- Single network (Ethereum mainnet), no template pattern needed
