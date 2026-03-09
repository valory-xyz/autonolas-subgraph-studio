# Autonolas Predict Omen Subgraph

A streamlined GraphQL API for tracking prediction markets and Autonolas agent performance on Gnosis Chain.

> **Technical reference**: See [CLAUDE.md](claude.md) for full business rules, schema reference, handler details, accounting formulas, and AI context.

## Quick Overview

- Tracks agents registered via `ServiceRegistryL2` and binary markets from whitelisted creators
- **Two-tier accounting**: `totalTraded`/`totalFees` recorded immediately; `totalTradedSettled`/`totalFeesSettled` at settlement
- **Settlement-day profit**: All PnL calculated at `LogNewAnswer` using outcome token balances
- **Re-answer handling**: Oracle answers can change within 24h — old profit is reversed, new profit applied using full market cost
- **Payout tracking**: `handlePayoutRedemption` only updates `totalPayout`, no profit recalculation

## Common Queries

### Agent PnL & Involved Markets
```graphql
{
  dailyProfitStatistics(where: { traderAgent: "0x..." }, orderBy: date) {
    date
    dailyProfit
    profitParticipants {
      id
      question
    }
  }
}
```

### Global Statistics
```graphql
{
  globals {
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalTradedSettled
    totalFees
    totalFeesSettled
    totalPayout
  }
}
```

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
yarn test       # Run unit tests (19 tests)
```

### Project Structure
* `src/service-registry-l-2.ts` — Agent registration and multisig creation
* `src/conditional-tokens.ts` — Condition preparation and payout redemption
* `src/realitio.ts` — Oracle answers, settlement, and re-answer handling
* `src/FixedProductMarketMakerMapping.ts` — Buy/sell activity and daily volume stats
* `src/utils.ts` — Helpers (processTradeActivity, caching, profit participant management)

### Setup & Deployment
**Check the [root README](/README.md).**
