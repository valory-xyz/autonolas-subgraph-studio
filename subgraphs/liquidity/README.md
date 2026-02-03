# OLAS Liquidity Subgraph

Multi-chain subgraph tracking OLAS liquidity across Uniswap V2 and Balancer V2 pools.

## Architecture

### Multi-Chain POL Tracking Strategy

OLAS Protocol-Owned Liquidity (POL) exists across 7 chains but is tracked centrally on Ethereum:

**The Problem**: L2 chains show zero POL because tokens are bridged to Ethereum for bonding.

**Root Cause**: On L2 chains (Polygon, Arbitrum, Optimism, Base):
1. Users provide liquidity on L2 (receive BPT tokens)
2. Users bridge BPT to Ethereum via Wormhole to participate in bonding
3. Ethereum Treasury receives the bridged BPT
4. L2 subgraph correctly shows zero POL (tokens left the chain)

**Architectural Decision**: Track all POL on Ethereum mainnet subgraph only.
- **POL tracking**: Ethereum subgraph (native LP + bridged BPT from all L2s)
- **Liquidity metrics**: Each L2 subgraph (pool reserves, TVL, total supply)

**Implementation**: Ethereum subgraph listens to Transfer events on 4 bridged token contracts representing L2 BPT tokens on Ethereum mainnet. Treasury address `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` holds all POL.

**Trade-off**: USD valuation of bridged POL deferred due to cross-subgraph complexity (would require querying L2 subgraphs for pool prices).

### Dual DEX Integration

Two DEX integration paths share common treasury tracking but differ in USD calculation:

### Uniswap V2 Path (Ethereum, Celo)
- **Chains**: Ethereum mainnet (OLAS/ETH), Celo (OLAS/CELO via Ubeswap)
- **LP Tracking**: ERC20 Transfer events from LP token contract
- **Reserves**: Sync events from Uniswap V2 Pair contract
- **USD Pricing**: Chainlink oracle for native token (ETH/CELO) price

### Balancer V2 Path (Gnosis, Polygon, Arbitrum, Optimism, Base)
- **Chains**: All L2s and Gnosis Chain (OLAS/WXDAI or OLAS/USDC pools)
- **LP Tracking**: ERC20 Transfer events from BPT (Balancer Pool Token) contract
- **Reserves**: PoolBalanceChanged events from Balancer Vault (filtered by poolId)
- **USD Pricing**: Pool spot price (assumes stablecoin = $1 USD)

### Reserve Ordering

Token ordering verified on-chain varies by pool:
- **Ethereum**: token0=OLAS, token1=WETH → reserve1 = native (ETH)
- **Celo**: token0=CELO, token1=OLAS → reserve0 = native (CELO)
- **Balancer**: Dynamic ordering from `getPoolTokens()` RPC call

### Bridged POL Tracking (Ethereum Only)

Separate handler `handleBridgedTransfer()` for L2 BPT tokens bridged to Ethereum:
- Monitors 4 bridged token contracts (Wormhole-wrapped BPT)
- Tracks Treasury acquisitions and sales per source chain
- Stores in `BridgedPOL` entity (one per L2 chain)
- No USD valuation (would require cross-subgraph queries)

### Shared Treasury Logic

Both paths use identical `handleLPTransfer()` handler:
- Tracks mints (from zero address), burns (to zero address)
- Monitors treasury address `0xa0DA53447C0f6C4987964d8463da7e6628B30f82`
- Updates `treasurySupply` and `treasuryPercentage` in `LPTokenMetrics`

## Overview

The subgraph monitors:
- **LP Token Supply**: Total supply through mint/burn events (Transfer from/to zero address)
- **Treasury Holdings**: LP/BPT tokens owned by treasury address `0xa0DA53447C0f6C4987964d8463da7e6628B30f82`
- **Pool Reserves**: OLAS and native/stablecoin reserves from Sync or PoolBalanceChanged events
- **Daily Aggregations**: Time-series data for analytics

## Key Entities

### Core Tracking
- `LPTransfer`: Individual LP token transfer events
- `PoolReserves`: Current pool reserves (OLAS/ETH)
- `TreasuryHoldings`: Treasury LP token balance and history

### Aggregated Metrics
- `DailyLPSupplyChange`: Daily mint/burn and treasury movements
- `LPTokenMetrics`: Global metrics (total supply, treasury percentage, etc.)
- `DailyMetrics`: Daily snapshots for time-series analysis
- `ReservesSnapshot`: Historical reserves data
- `BridgedPOL`: Per-chain Treasury holdings of L2 BPT bridged to Ethereum

## Deployed Chains

### Uniswap V2 Pools
- **Ethereum**: OLAS/ETH LP `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F`
- **Celo**: OLAS/CELO LP `0x2976fa805141b467bcbc6334a69afff4d914d96a` (Ubeswap)

### Balancer V2 Pools
- **Gnosis**: OLAS/WXDAI BPT `0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac985`
- **Polygon**: OLAS/USDC BPT `0xd7edb56f63b2a0191742aea32df1f98ca81ed9d6`
- **Arbitrum**: OLAS/USDC BPT `0xf44d059ec5b2c09c68cf35ae3ded6fd81c6a8580`
- **Optimism**: OLAS/USDC BPT `0xe14ddddb0c810a38f6fa4ed455c59ddda779f6b0`
- **Base**: OLAS/USDC BPT `0xf4c0d0c533c0286d2dbdc48f015834f6a2dbdc87`

### Bridged BPT Tokens (Ethereum Mainnet Only)
- **Polygon 50WMATIC-50OLAS**: `0xf9825A563222f9eFC81e369311DAdb13D68e60a4`
- **Arbitrum 50WETH-50OLAS**: `0x36B203Cb3086269f005a4b987772452243c0767f`
- **Optimism 50WETH-50OLAS**: `0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F`
- **Base 50OLAS-50USDC**: `0x9946d6FD1210D85EC613Ca956F142D911C97a074`

### Shared
- **Treasury Address**: `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` (all chains)

## Key Metrics Calculated

Based on the SQL query requirements:

1. **Total LP Supply**: Sum of all minted tokens minus burned tokens
2. **Treasury Supply**: Current LP tokens held by treasury
3. **Protocol-owned Liquidity %**: Treasury supply / Total supply
4. **Pool Reserves**: Current OLAS reserves (reserve0) and ETH reserves (reserve1)

## Usage

### Build and Deploy

```bash
# Generate code
npx graph codegen

# Build subgraph
npx graph build

# Deploy (example)
npx graph deploy --studio your-subgraph-name
```

### Example Queries

Get current metrics:
```graphql
{
  lpTokenMetrics(id: "") {
    totalSupply
    treasurySupply
    treasuryPercentage
    currentReserve0
    currentReserve1
  }
  bridgedPOLs {
    id
    chain
    tokenName
    treasuryBalance
    totalAcquired
    totalSold
    transactionCount
    lastUpdated
  }
}
```

Get daily time series:
```graphql
{
  dailyMetrics(orderBy: dayTimestamp, orderDirection: desc, first: 30) {
    dayTimestamp
    totalSupply
    treasurySupply
    treasuryPercentage
    reserve0
    reserve1
  }
}
```

## USD Valuations

The subgraph calculates USD values for pool liquidity and protocol-owned liquidity. Pricing strategy varies by DEX type.

### Uniswap V2 Data Flow (Ethereum, Celo)

```
Sync Event (reserve0, reserve1)
         |
         v
  Select native token reserve (reserve1 for Ethereum, reserve0 for Celo)
         |
         v
  Chainlink Native/USD Price Fetch (ETH/USD or CELO/USD)
         |
         v
  Calculate USD Values:
    - poolLiquidityUsd = 2 × nativeReserve × nativePrice / (10^8 × 10^18)
    - protocolOwnedLiquidityUsd = (treasurySupply / totalSupply) × poolLiquidityUsd
         |
         v
  Store in LPTokenMetrics
```

### Balancer V2 Data Flow (Gnosis, Polygon, Arbitrum, Optimism, Base)

```
PoolBalanceChanged Event
         |
         v
  Filter by OLAS poolId (early return if not matching)
         |
         v
  RPC Call: vault.getPoolTokens(poolId)
         |
         v
  Extract OLAS and stablecoin balances from token array
         |
         v
  Calculate OLAS spot price (assumes stablecoin = $1 USD):
    - olasPrice = stablecoinBalance / olasBalance
         |
         v
  Calculate USD Values:
    - poolLiquidityUsd = 2 × olasBalance × olasPrice / 10^18
    - protocolOwnedLiquidityUsd = (treasurySupply / totalSupply) × poolLiquidityUsd
         |
         v
  Store in LPTokenMetrics (lastEthPriceUsd = olasPrice for compatibility)
```

### Pool Liquidity Formula

Pool liquidity USD uses `2 × ETH reserves × ETH price` because:
- Uniswap V2 is a constant product AMM (x × y = k)
- At equilibrium, both sides of the pool have equal USD value
- Total pool value = 2 × one side's USD value
- The ETH side is chosen because Chainlink provides a direct ETH/USD price

**Example**: If the pool has 1000 ETH reserves and ETH price is $1800:
- Pool liquidity USD = 2 × 1000 × $1800 = $3,600,000

### Uniswap V2 Chainlink Integration

**Feed Details**:
- Ethereum ETH/USD: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`
- Celo CELO/USD: Uses Chainlink feed on Celo network
- Decimals: 8 (e.g., 180000000000 = $1800.00)
- Update frequency: ~1 hour heartbeat

**Error Handling**:
- Uses `try_latestRoundData()` pattern to prevent handler crashes
- On Chainlink call failure: logs error with transaction hash, returns zero
- USD values default to zero when price fetch fails (safe default: never negative, never stale)

### Balancer V2 Spot Price Calculation

**Assumptions**:
- Stablecoins (WXDAI, USDC) are valued at exactly $1 USD
- Pool is balanced (no significant price impact)

**Error Handling**:
- Uses `try_getPoolTokens()` to prevent RPC call failures from crashing handler
- On RPC failure: logs error, early returns to preserve last known USD value
- Token ordering validation ensures OLAS and stablecoin addresses match expected values

### Invariants

The implementation maintains these guarantees:
- USD values are zero when price fetch fails (never negative or stale)
- `poolLiquidityUsd >= protocolOwnedLiquidityUsd` (treasury cannot own more than total pool value)
- `lastEthPriceUsd` tracks the price used for calculation (native token price on Uniswap V2, OLAS spot price on Balancer V2)
- When `totalSupply` is zero (pool initialization), `protocolOwnedLiquidityUsd` is zero (avoids division by zero)
- Balancer V2: Only processes events matching configured OLAS poolId (filters out 100+ other pools per chain)

### Query Examples

Get current USD valuations:
```graphql
{
  lpTokenMetrics(id: "") {
    poolLiquidityUsd
    protocolOwnedLiquidityUsd
    lastEthPriceUsd
  }
}
```

## Data Sources

### Uniswap V2 Chains (Ethereum, Celo)
1. **ERC20 Transfer Events**: Tracks LP token minting, burning, and treasury movements
2. **Uniswap V2 Sync Events**: Tracks pool reserves for OLAS and native token
3. **Chainlink Price Feed**: Fetches native token/USD price for USD valuations

### Balancer V2 Chains (Gnosis, Polygon, Arbitrum, Optimism, Base)
1. **ERC20 Transfer Events**: Tracks BPT (Balancer Pool Token) minting, burning, and treasury movements
2. **Balancer V2 PoolBalanceChanged Events**: Emitted by Balancer Vault for all pool balance changes
3. **Balancer V2 Vault RPC**: `getPoolTokens(poolId)` call to fetch current balances for OLAS spot price

### Bridged BPT Tracking (Ethereum Only)
1. **ERC20 Transfer Events**: Tracks bridged BPT tokens from L2 chains (Polygon, Arbitrum, Optimism, Base)
2. **Filters**: Only Treasury inflows/outflows are recorded
3. **Start Blocks**: Each bridged token contract has a specific start block corresponding to its Wormhole deployment

## Implementation Notes

### General
- Timestamps are truncated to day boundaries for daily aggregations
- Treasury percentage is stored in basis points (10000 = 100%)
- All token amounts are in wei (18 decimals)
- USD values use BigDecimal to preserve precision

### Uniswap V2 Specifics
- Reserve ordering varies by chain (see Reserve Ordering section)
- Ethereum: reserve0 = OLAS, reserve1 = ETH
- Celo: reserve0 = CELO, reserve1 = OLAS

### Balancer V2 Specifics
- BPT addresses derived from first 20 bytes of poolId
- Example: poolId `0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac98500020000000000000000075e` → BPT `0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac985`
- Token ordering dynamically determined via `getPoolTokens()` RPC call
- Events filtered by poolId to avoid processing unrelated Balancer pools