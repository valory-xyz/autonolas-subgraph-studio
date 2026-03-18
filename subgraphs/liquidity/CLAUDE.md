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

### USD Calculation (Ethereum pool only)

```
poolLiquidityUsd (8 dec) = 2 * reserve1_ETH (18 dec) * ethUsdPrice (8 dec) / 1e18
protocolOwnedLiquidityUsd = poolLiquidityUsd * treasuryPercentage / 10000
```

### Full POL Calculation (all 8 chains)

The complete algorithm is in `scripts/pol-aggregation.js` and documented in [README.md — Full POL Calculation Algorithm](README.md#full-pol-calculation-algorithm). Summary of data flow:

- **Fully on-chain** (3 chains): Ethereum (Chainlink ETH/USD), Gnosis (WXDAI ≈ $1), Base (USDC ≈ $1)
- **On-chain reserves + Chainlink price** (3 chains): Polygon (MATIC/USD), Arbitrum (ETH/USD), Optimism (ETH/USD)
- **On-chain reserves + CoinGecko price** (1 chain): Celo (CELO/USD — no Chainlink on Ethereum mainnet)
- **Off-chain reserves + mixed prices** (1 chain): Solana (Solana RPC for vault balances, Chainlink SOL/USD, CoinGecko OLAS/USD)

### Chainlink Price Feeds

All feeds are on Ethereum mainnet, fetched via `latestRoundData()` contract call with 1-hour staleness caching:

| Feed | Proxy Address | Used For |
|---|---|---|
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | Ethereum OLAS-ETH pool USD, Arbitrum OLAS-WETH, Optimism WETH-OLAS |
| MATIC/USD | `0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676` | Polygon OLAS-WMATIC |
| SOL/USD | `0x4ffC43a60e009B551865A93d232E33Fce9f01507` | Solana WSOL-OLAS (price only — pool reserves from Solana RPC off-chain) |

**Not available on-chain**: CELO/USD has no Chainlink feed on Ethereum mainnet. Celo POL USD must be computed by the off-chain aggregation layer using external price APIs (CoinGecko, etc.).

Gnosis (WXDAI) and Base (USDC) pools are stablecoin-paired — their USD value is `2 * stablecoin_reserves` with no price feed needed.

### Solana LP Valuation

The bridged Solana LP token (`0x3685B8cC36B8df09ED9E81C1690100306bF23E04`) has **8 decimals** (not 18). Treasury holds 99.995% of the bridged supply. The SOL/USD price is available on-chain via Chainlink, but the Orca pool reserves must be fetched off-chain (The Graph cannot index Solana).

**Pool type**: Orca Whirlpool (concentrated liquidity), NOT a standard AMM. All positions use **full-range ticks** (-443584 to 443584, tick spacing 64), so the pool behaves similarly to a constant-product AMM.

#### Simple Approach: Solana RPC Vault Balances

The simplest way to get pool reserves is to query the token vault balances directly from Solana RPC — no SDK needed:

```bash
# SOL vault balance (9 decimals)
curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getTokenAccountBalance",
  "params": ["CLA8hU8SkdCZ9cJVLMfZQfcgAsywZ9txBJ6qrRAqthLx"]
}'

# OLAS vault balance (8 decimals)
curl -s https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getTokenAccountBalance",
  "params": ["6E8pzDK8uwpENc49kp5xo5EGydYjtamPSmUKXxum4ybb"]
}'
```

Then:
```
Pool TVL = SOL_vault_balance × SOL_USD + OLAS_vault_balance × OLAS_USD
Treasury share = bridgedLpBalance / totalBridgedSupply  (from this subgraph)
Solana POL = Pool TVL × Treasury share
```

Verified on 2026-03-18: SOL vault = 201.69 SOL, OLAS vault = 490,903.49 OLAS, Pool TVL ~ $42,684, Treasury share = 99.995%.

#### Alternative: Orca SDK Approach

The [autonolas-frontend-mono](https://github.com/valory-xyz/autonolas-frontend-mono/tree/main/apps/bond/components/BondingProducts/Bonding/TokenManagement) uses `@orca-so/whirlpools-sdk` to compute token amounts from position liquidity:

1. Query all full-range positions from the Whirlpool via Shyft GraphQL API
2. For each position, compute token amounts: `PoolUtil.getTokenAmountsFromLiquidity(liquidity, sqrtPrice, tickLowerSqrtPrice, tickUpperSqrtPrice, false)`
3. Sum reserves across positions
4. Compute LP price: `priceLp = (reserveOlas * 1e28) / totalLiquidity`

This is more precise for partial positions but overkill when the vault balances give the total directly.

**Solana pool constants**:

| Constant | Address |
|---|---|
| Bridged token mint | `CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR` |
| Lockbox | `3UaaD3puPemoZk7qFYJWWCvmN6diS7P63YR4Si9QRpaW` |
| Position | `EHQbFx7m5gPBqXXiViNBfHJDRUuFgqqYsLzuWu18ckaR` |
| Token vault A (SOL) | `CLA8hU8SkdCZ9cJVLMfZQfcgAsywZ9txBJ6qrRAqthLx` |
| Token vault B (OLAS) | `6E8pzDK8uwpENc49kp5xo5EGydYjtamPSmUKXxum4ybb` |
| Tick spacing | 64 |
| Full range ticks | -443584 to 443584 |
| LP token decimals | 8 (SVM_AMOUNT_DIVISOR = 1e8) |
| SOL decimals | 9 |
| OLAS decimals (on Solana) | 8 |

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

See [README.md — Validating Subgraph Against Dune](README.md#validating-subgraph-against-dune) for full comparison approach and tables.

### Dune vs Subgraph Methodology Differences

The Dune POL total (~$3.7M) is ~31% higher than the subgraph total (~$2.5M). Root causes identified (2026-03-18):

**Arbitrum double-counting**: Dune query 5383248 includes `arbitrum_pol` twice in the `UNION ALL`. Impact: +$106K.

**OLAS price inflation**: Dune values the ETH pool as `2 × OLAS_reserves × OLAS_price` (query 4963482), where OLAS price comes from query 2767077 — the **unweighted average of the last 10 DEX trades** (query 2766789). This produces an OLAS price ~42% higher than CoinGecko's VWAP ($0.069 vs $0.048), inflating the total by ~$1M.

**Subgraph approach**: Uses `2 × paired_token_reserves × Chainlink_price`. Does not depend on OLAS price for 7 of 8 chains. Chainlink feeds are audited, volume-weighted, and manipulation-resistant. Only the Solana pool partially depends on CoinGecko OLAS price.

Dune query chain: 5383248 (aggregator) → 4963482 (ETH POL) → 2767077 (OLAS price) → 2766789 (last 10 DEX trades).

---

## Core Business Rules

### What is Protocol Owned Liquidity (POL)?

The Olas protocol acquires LP tokens permanently through its **bonding mechanism**. Participants (bonders) deposit LP tokens into the Depository contract in exchange for discounted OLAS tokens with a vesting period. The Depository forwards LP tokens to the Treasury, which holds them indefinitely as protocol-owned liquidity. This gives the protocol permanent, deep liquidity in its trading pools without relying on external liquidity providers.

### How This Subgraph Tracks POL

1. **Native OLAS-ETH Pool (Uniswap V2 on Ethereum)**: The primary source of POL. The subgraph tracks the pool's LP token supply (mint/burn), the Treasury's LP balance, and pool reserves (OLAS + ETH). The Treasury currently owns ~99.95% of all LP tokens and has never sold any (`totalSold = 0`).

2. **Bridged LP Tokens from L2 Chains**: The protocol also owns LP positions in Balancer V2 pools on 6 L2 chains plus an Orca pool on Solana. These LP tokens are bridged to Ethereum mainnet (via OmniBridge or Wormhole Portal) where the Treasury holds them. This subgraph tracks the Treasury's balance of each bridged LP token by watching ERC-20 Transfer events on the 7 bridged token contracts.

3. **USD Valuation**: Pool liquidity in USD is computed as `2 * ETH_reserves * ETH/USD_price` (since in a balanced Uniswap V2 pool, each side is worth half the total). The ETH/USD price comes from the Chainlink oracle at `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` via `latestRoundData()` contract calls. Protocol-owned liquidity USD is the Treasury's proportional share.

### Key Accounting Rules

1. **Treasury-Only Tracking for Bridged Tokens**: The `handleBridgedLPTransfer` handler only processes transfers where the Treasury (`0xa0DA53447C0f6C4987964d8463da7e6628B30f82`) is sender or receiver. All other transfers are ignored — the subgraph does not track individual user balances for bridged LP tokens.

2. **Mint/Burn Detection**: Transfers from the zero address are mints (new LP created); transfers to the zero address are burns (LP redeemed). These update `totalSupply`, `totalMinted`, and `totalBurned`.

3. **Treasury Percentage in Basis Points**: `treasuryPercentage = treasurySupply * 10000 / totalSupply`. Value of 9995 means 99.95%.

4. **Chainlink Price Caching**: The ETH/USD price is only fetched when the cached value is older than 1 hour (`PRICE_STALENESS_THRESHOLD = 3600 seconds`). This reduces contract call overhead during indexing. Zero or negative oracle answers are discarded.

5. **Underflow Protection**: Outgoing bridged LP transfers clamp `currentBalance` to zero if the transfer amount exceeds the tracked balance. This guards against data inconsistency from partial-history indexing (e.g., if `startBlock` is set after the Treasury already received tokens).

6. **No Daily Aggregation**: The subgraph only tracks current state (latest balances, reserves, prices). There are no daily snapshot or time-series entities — historical data can be reconstructed from immutable `LPTransfer` entities or by querying at specific blocks.

### Unit Conventions

- All token amounts are in wei (18 decimals)
- Treasury percentage is in basis points (10000 = 100%)
- USD values are in 8 decimals (matching Chainlink precision, e.g., `200000000000` = $2,000.00)
- Reserves: `reserve0` = OLAS, `reserve1` = ETH
- Solana's bridged LP token uses non-18-decimal raw values (Orca LP tokens have different precision)
