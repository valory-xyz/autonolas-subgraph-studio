# Autonolas Predict Polymarket Subgraph

A streamlined GraphQL API for tracking Autonolas agent performance on Polymarket prediction markets on Polygon.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full business rules, schema reference, handler details, accounting formulas, and AI context.

## Quick Overview

- Tracks agents registered via `ServiceRegistryL2` (agent ID 86) and binary markets via UMA + ConditionalTokens
- **Two-tier accounting**: `totalTraded` recorded immediately; `totalTradedSettled` at settlement
- **Settlement-day profit**: All PnL calculated at `QuestionResolved` using outcome share balances
- **No re-answer logic**: Polymarket resolutions are final (unlike omen)
- **Payout tracking**: `handlePayoutRedemption` only updates `totalPayout`, no profit recalculation
- **Sell convention**: Negative amounts and shares for sells, `isBuy` field distinguishes direction

## Common Queries

### Agent PnL & Involved Markets
```graphql
{
  dailyProfitStatistics(where: { traderAgent: "0x..." }, orderBy: date) {
    date
    dailyProfit
    profitParticipants {
      id
      metadata {
        title
      }
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
    totalPayout
    totalExpectedPayout
  }
}
```

## Development

```bash
npm install     # Install dependencies
npm run codegen # Generate TypeScript from schema + ABIs
npm run build   # Compile to WebAssembly
npm run test    # Run unit tests
```

### Project Structure
* `src/service-registry-l-2.ts` — Agent registration and multisig creation
* `src/conditional-tokens.ts` — Condition preparation and payout redemption
* `src/ctf-exchange.ts` — Order tracking from CTF Exchange (agents as makers)
* `src/uma-mapping.ts` — Market metadata extraction and resolution handling
* `src/neg-risk-mapping.ts` — NegRisk market handling
* `src/utils.ts` — Helpers (processTradeActivity, processMarketResolution, processRedemption, caching)

### Validation Scripts
See [scripts/README.md](scripts/README.md) for data consistency validation tools.

### Setup & Deployment
Check the [root README](/README.md) for build and deployment instructions.
