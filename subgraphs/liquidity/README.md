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

## Data Sources

1. **ERC20 Transfer Events**: Tracks LP token minting, burning, and treasury movements
2. **Uniswap V2 Sync Events**: Tracks pool reserves for OLAS and ETH

## Implementation Notes

- Timestamps are truncated to day boundaries for daily aggregations
- Treasury percentage is stored in basis points (10000 = 100%)
- All token amounts are in wei (18 decimals)
- Reserves: reserve0 = OLAS, reserve1 = ETH