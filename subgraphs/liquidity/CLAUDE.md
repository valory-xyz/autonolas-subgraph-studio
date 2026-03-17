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

Native pool (OLASETHLPToken, OLASETHPair) starts from block 17,679,229. Each bridged LP token starts from its first Transfer block on Ethereum mainnet:

| Bridged LP | Start Block |
|---|---|
| BridgedLP_Gnosis (`0x27df632fd0dcf191C418c803801D521cd579F18e`) | 18,324,324 |
| BridgedLP_Polygon (`0xf9825A563222f9eFC81e369311DAdb13D68e60a4`) | 19,126,747 |
| BridgedLP_Solana (`0x3685B8cC36B8df09ED9E81C1690100306bF23E04`) | 19,641,245 |
| BridgedLP_Arbitrum (`0x36B203Cb3086269f005a4b987772452243c0767f`) | 19,120,775 |
| BridgedLP_Optimism (`0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F`) | 19,457,188 |
| BridgedLP_Base (`0x9946d6FD1210D85EC613Ca956F142D911C97a074`) | 19,532,493 |
| BridgedLP_Celo (`0xC085F31E4ca659fF8A17042dDB26f1dcA2fBdAB4`) | 20,488,304 |

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
- **Chainlink price fetch (cached)**: Only calls `latestRoundData()` if the stored price is older than 1 hour (`PRICE_STALENESS_THRESHOLD = 3600 seconds`). Reuses cached `PriceData` otherwise to reduce contract call overhead during indexing.
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

Chainlink ETH/USD is fetched via `latestRoundData()` contract call (not event-based, since the Chainlink proxy at `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` does not re-emit `AnswerUpdated` events from its underlying aggregator). The price is cached and only refreshed when stale (>1 hour old) to minimize contract call overhead during indexing.

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

## Deployment to The Graph Studio

### Prerequisites

- A wallet (MetaMask or similar) to sign in at [thegraph.com/studio](https://thegraph.com/studio)
- Studio accounts are free for development/testing

### Step 1: Create Subgraphs in Studio UI

Create **8 subgraphs** in the Studio dashboard (one per deployment):

| Subgraph Name | Network | Source |
|---|---|---|
| `olas-liquidity-eth` | Ethereum mainnet | `subgraphs/liquidity/subgraph.yaml` |
| `olas-liquidity-gnosis` | Gnosis | `subgraphs/liquidity-l2/subgraph.gnosis.yaml` |
| `olas-liquidity-matic` | Polygon | `subgraphs/liquidity-l2/subgraph.matic.yaml` |
| `olas-liquidity-arbitrum` | Arbitrum One | `subgraphs/liquidity-l2/subgraph.arbitrum-one.yaml` |
| `olas-liquidity-optimism` | Optimism | `subgraphs/liquidity-l2/subgraph.optimism.yaml` |
| `olas-liquidity-base` | Base | `subgraphs/liquidity-l2/subgraph.base.yaml` |
| `olas-liquidity-celo` | Celo | `subgraphs/liquidity-l2/subgraph.celo.yaml` |

Each one provides a **deploy key** and a **slug**.

### Step 2: Authenticate

```bash
graph auth <your-deploy-key>
```

### Step 3: Deploy

**Ethereum mainnet:**
```bash
cd subgraphs/liquidity
yarn codegen && yarn build
graph deploy olas-liquidity-eth subgraph.yaml
```

**L2 chains (repeat for each network):**
```bash
cd subgraphs/liquidity-l2
yarn codegen
graph deploy olas-liquidity-gnosis subgraph.gnosis.yaml
graph deploy olas-liquidity-matic subgraph.matic.yaml
graph deploy olas-liquidity-arbitrum subgraph.arbitrum-one.yaml
graph deploy olas-liquidity-optimism subgraph.optimism.yaml
graph deploy olas-liquidity-base subgraph.base.yaml
graph deploy olas-liquidity-celo subgraph.celo.yaml
```

### Step 4: Wait for Indexing

- Studio dashboard shows sync progress (% indexed)
- Ethereum mainnet takes longest (indexing from block 17,679,229 with 9 data sources)
- L2 chains are faster (single data source each, fewer blocks)
- **Do not publish** until validated against Dune — publishing puts the subgraph on the decentralized network and costs GRT

### Step 5: Test Queries

Once synced, use the Studio GraphQL playground to verify data. See [Common Queries in README.md](README.md#common-queries) for example queries.

### Step 6: Compare Against Dune

Once all 8 subgraphs are synced, compare output against Dune to validate correctness. See [Validating Subgraph Against Dune in README.md](README.md#validating-subgraph-against-dune) for the full comparison approach.

### Studio Endpoints (Development)

| Subgraph | Studio Query URL                                                           |
|---|----------------------------------------------------------------------------|
| Ethereum mainnet | `https://api.studio.thegraph.com/query/81139/olas-liquidity-eth/v0.0.2`    |
| Gnosis | `https://api.studio.thegraph.com/query/81139/olas-liquidity-gnosis/v0.0.2` |
| Polygon | `https://api.studio.thegraph.com/query/81139/olas-liquidity-matic/v0.0.2`  |
| Arbitrum | TBD                                                                        |
| Optimism | TBD                                                                        |
| Base | TBD                                                                        |
| Celo | TBD                                                                        |

---

## Verification Results (2026-03-17, v0.0.2)

All 3 deployed subgraphs synced fully, zero indexing errors. Full comparison against Dune pending.

### Ethereum Mainnet (block 24,677,330)

| Metric | Value |
|---|---|
| LP total supply | 63,683.02 |
| Treasury LP balance | 63,657.40 (never sold, totalSold = 0) |
| Treasury share | 99.95% (9995 basis points) |
| Treasury transactions | 246 |
| OLAS reserves | 18,125,954.04 |
| ETH reserves | 393.04 |
| ETH/USD (Chainlink) | $2,325.78 |
| Pool liquidity USD | $1,828,255.78 |
| Protocol owned liquidity USD | $1,827,341.65 |
| Price staleness caching | Active — price fetched at block 24,677,164 (166 blocks behind head) |

**Bridged LP tokens in Treasury** (all totalSold = 0):

| Chain | Pair | Balance (BPT) | Transactions |
|---|---|---|---|
| Gnosis | OLAS-WXDAI | 1,634,374.52 | 44 |
| Polygon | OLAS-WMATIC | 976,904.80 | 46 |
| Solana | WSOL-OLAS | 2,163,960,829,576 (raw, non-18-dec) | 26 |
| Arbitrum | OLAS-WETH | 8,639.77 | 28 |
| Optimism | WETH-OLAS | 5,548.32 | 20 |
| Base | OLAS-USDC | 514,612.63 | 31 |
| Celo | CELO-OLAS | 210,254.80 | 28 |

### Gnosis L2 (block 45,195,995)

| Metric | Value |
|---|---|
| Pool | OLAS-WXDAI (Balancer V2) |
| Token0 (OLAS) reserves | 3,875,175.27 |
| Token1 (WXDAI) reserves | 191,804.93 |
| BPT total supply | 1,636,413.92 |
| BPT total minted | 1,823,726.17 |
| BPT total burned | 187,312.25 |
| Pool TVL (approx) | $383,610 (2 x WXDAI) |
| Treasury POL (approx) | $383,132 |

### Polygon L2 (block 84,315,911)

| Metric | Value |
|---|---|
| Pool | OLAS-WMATIC (Balancer V2) |
| Token0 (WMATIC) reserves | 311,124.86 |
| Token1 (OLAS) reserves | 822,942.71 |
| BPT total supply | 978,297.77 |
| BPT total minted | 1,058,007.73 |
| BPT total burned | 79,709.96 |

### Cross-Chain Consistency Checks

| Check | Result |
|---|---|
| Gnosis bridged LP on L1 vs BPT supply | 1,634,374.52 / 1,636,413.92 = 99.88% bridged |
| Polygon bridged LP on L1 vs BPT supply | 976,904.80 / 978,297.77 = 99.86% bridged |
| All bridged tokens totalSold | 0 across all 7 chains (Treasury never sold) |
| Indexing errors | None on any chain |

The small gap between bridged LP on L1 and BPT supply (~0.1-0.2%) represents LP tokens not yet bridged to Ethereum mainnet.

### v0.0.2 Optimizations Verified

| Optimization | Evidence |
|---|---|
| Chainlink price staleness caching (1h) | Price at block 24,677,164, head at 24,677,330 — 166 block delta confirms caching works |
| Per-token bridged LP startBlocks | Correct data with fewer empty blocks scanned |
| L2 reserves only on mint/burn | Reserves still accurate, contract calls reduced |

### GraphQL Field Names

The Graph auto-generates query field names that differ from entity names. Correct queries:

| Entity | Singular Query | Collection Query |
|---|---|---|
| LPTokenMetrics | `lptokenMetrics(id: "global")` | `lptokenMetrics_collection` |
| TreasuryHoldings | `treasuryHoldings(id: "0xa0da53447c0f6c4987964d8463da7e6628b30f82")` | `treasuryHoldings_collection` |
| BridgedPOLHolding | `bridgedPOLHolding(id: "0x27df632fd0dcf191c418c803801d521cd579f18e")` | `bridgedPOLHoldings` |
| PriceData | `priceData(id: "eth-usd")` | `priceDatas` |
| PoolReserves | `poolReserves(id: "0x09d1d767edf8fa23a64c51fa559e0688e526812f")` | `poolReserves_collection` |

### Validating Against Dune

Subgraph output should be compared against Dune queries [4963482](https://dune.com/queries/4963482) and [5383248](https://dune.com/queries/5383248/8807520) to ensure correctness. Key comparison points: treasury LP balance, pool reserves, USD valuations, bridged LP balances. Expect < 1% discrepancy from block timing and price source differences. Solana LP will be missing from subgraph totals (not indexable by The Graph). See [README.md — Validating Subgraph Against Dune](README.md#validating-subgraph-against-dune) for full details.

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
