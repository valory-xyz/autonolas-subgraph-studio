# Autonolas Predict Polymarket Subgraph

A streamlined GraphQL API for tracking Autonolas agent activity on Polymarket prediction markets on Polygon.

> **Technical reference**: See [claude.md](claude.md) for full business rules, schema reference, handler details, accounting formulas, and AI context.

## Quick Overview

- Indexes **every** Olas multisig on Polygon via the `Multisig` entity; `TraderAgent` is **lazy-created on first trade**. Cohort filtering (polystrat, Pearl Mini, etc.) is client-side via `traderAgents(where: { multisig_: { agentIds_contains | operators_contains } })`
- Binary markets only, via UMA OO V3 / UmaCtfAdapter (vanilla) and NegRiskAdapter (multi-outcome)
- **Two-tier accounting**: `totalTraded` recorded immediately; `totalTradedSettled` at resolution (for all bets)
- **Settlement-day profit**: All PnL calculated at `QuestionResolved` using outcome share balances
- **No re-answer logic**: Polymarket resolutions are final (unlike omen)
- **Payout tracking**: `handlePayoutRedemption` / `handleNegRiskPayoutRedemption` only update `totalPayout` and emit immutable `PayoutRedemption` entries tagged with `source: PayoutSource` (`CONDITIONAL_TOKENS` | `NEG_RISK_ADAPTER`)
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

### Cohort filter (client-side)
```graphql
# Polystrat (agent ID 86)
{ traderAgents(where: { multisig_: { agentIds_contains: [86] } }) { id, totalTraded } }

# Pearl Mini (services created via PolySafeCreator)
{ traderAgents(where: { multisig_: { operators_contains: ["0xA749f605D93B3efcc207C54270d83C6E8fa70fF8"] } }) { id } }
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
* `src/service-registry-l-2.ts` — `Multisig` / `ServiceIndex` / `PendingMultisig` lifecycle (RegisterInstance, CreateMultisigWithAgents, TerminateService)
* `src/conditional-tokens.ts` — Condition preparation and vanilla payout redemption
* `src/ctf-exchange.ts` — Order tracking + **lazy `TraderAgent` creation** (agents as makers)
* `src/uma-mapping.ts` — UMA metadata extraction and resolution handling
* `src/neg-risk-mapping.ts` — NegRisk market handling and NegRisk payout redemption
* `src/utils.ts` — Helpers (processTradeActivity, processMarketResolution, processRedemption, caching)

### Validation Scripts
See [scripts/README.md](scripts/README.md) for data consistency validation tools.

### Setup & Deployment
Check the [root README](/README.md) for build and deployment instructions.
