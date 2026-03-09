# OLAS-ETH Liquidity Pool Subgraph

Tracks liquidity metrics for the OLAS-ETH Uniswap V2 pool on Ethereum mainnet.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, utility functions, and implementation notes.

## Quick Overview

- Monitors LP token supply through mint/burn events (Transfer from/to zero address)
- Tracks treasury holdings (LP tokens owned by `0xa0DA53447C0f6C4987964d8463da7e6628B30f82`)
- Indexes pool reserves (OLAS and ETH) from Uniswap V2 Sync events
- Calculates protocol-owned liquidity percentage in basis points

## Common Queries

### Current Metrics
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

### Treasury Holdings
```graphql
{
  treasuryHoldings(id: "0xa0da53447c0f6c4987964d8463da7e6628b30f82") {
    currentBalance
    totalAcquired
    totalSold
    transactionCount
  }
}
```

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
```

### Project Structure
* `src/mapping.ts` — Event handlers for LP transfers and reserve syncs
* `src/utils.ts` — Constants, helpers, and get-or-create patterns

### Setup & Deployment
**Check the [root README](/README.md).**
