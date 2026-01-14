# OLAS-ETH Liquidity Pool Subgraph

This subgraph tracks liquidity metrics for the OLAS-ETH Uniswap V2 pool, implementing the analytics logic from the provided SQL query.

## Overview

The subgraph monitors:
- **LP Token Supply**: Total supply through mint/burn events (Transfer from/to zero address)
- **Treasury Holdings**: LP tokens owned by treasury address `0xa0DA53447C0f6C4987964d8463da7e6628B30f82`
- **Pool Reserves**: OLAS and ETH reserves from Uniswap Sync events
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

## Contract Addresses

- **OLAS-ETH LP Token**: `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F`
- **Treasury Address**: `0xa0DA53447C0f6C4987964d8463da7e6628B30f82`

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
  lpTokenMetrics(id: "global") {
    totalSupply
    treasurySupply
    treasuryPercentage
    currentReserve0
    currentReserve1
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

The subgraph calculates USD values for pool liquidity and protocol-owned liquidity using Chainlink's ETH/USD price feed.

### Data Flow

```
Sync Event (reserve0, reserve1)
         |
         v
  Chainlink ETH/USD Price Fetch
         |
         v
  Calculate USD Values:
    - poolLiquidityUsd = 2 × reserve1 × ethPrice / (10^8 × 10^18)
    - protocolOwnedLiquidityUsd = (treasurySupply / totalSupply) × poolLiquidityUsd
         |
         v
  Store in LPTokenMetrics
```

### Pool Liquidity Formula

Pool liquidity USD uses `2 × ETH reserves × ETH price` because:
- Uniswap V2 is a constant product AMM (x × y = k)
- At equilibrium, both sides of the pool have equal USD value
- Total pool value = 2 × one side's USD value
- The ETH side is chosen because Chainlink provides a direct ETH/USD price

**Example**: If the pool has 1000 ETH reserves and ETH price is $1800:
- Pool liquidity USD = 2 × 1000 × $1800 = $3,600,000

### Chainlink Integration

**Feed Details**:
- Contract: `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (Ethereum mainnet)
- Decimals: 8 (e.g., 180000000000 = $1800.00)
- Update frequency: ~1 hour heartbeat

**Error Handling**:
- Uses `try_latestRoundData()` pattern to prevent handler crashes
- On Chainlink call failure: logs error with transaction hash, returns zero
- USD values default to zero when price fetch fails (safe default: never negative, never stale)

### Invariants

The implementation maintains these guarantees:
- USD values are zero when Chainlink call fails (never negative or stale)
- `poolLiquidityUsd >= protocolOwnedLiquidityUsd` (treasury cannot own more than total pool value)
- `lastEthPriceUsd` tracks the ETH price used for the calculation (aids debugging)
- When `totalSupply` is zero (pool initialization), `protocolOwnedLiquidityUsd` is zero (avoids division by zero)

### Query Examples

Get current USD valuations:
```graphql
{
  lpTokenMetrics(id: "global") {
    poolLiquidityUsd
    protocolOwnedLiquidityUsd
    lastEthPriceUsd
  }
}
```

## Data Sources

1. **ERC20 Transfer Events**: Tracks LP token minting, burning, and treasury movements
2. **Uniswap V2 Sync Events**: Tracks pool reserves for OLAS and ETH
3. **Chainlink Price Feed**: Fetches ETH/USD price for USD valuations

## Implementation Notes

- Timestamps are truncated to day boundaries for daily aggregations
- Treasury percentage is stored in basis points (10000 = 100%)
- All token amounts are in wei (18 decimals)
- Reserves: reserve0 = OLAS, reserve1 = ETH
- USD values use BigDecimal to preserve precision from Chainlink's 8-decimal price