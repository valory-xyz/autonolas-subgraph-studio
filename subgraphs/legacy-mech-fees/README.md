# Legacy Mech Fees Gnosis Subgraph

A blockchain indexing system that tracks fees for autonomous agents (mechs) interacting with the legacy marketplace contracts on Gnosis Chain.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, business rules, contract addresses, and AI context.

## Quick Overview

- Tracks every fee-in (accrual) and fee-out (collection) event for legacy mechs on Gnosis Chain
- **Two mech types**: Legacy Mechs (LM) for direct interactions, Legacy Market-Maker Mechs (LMM) for marketplace-mediated transactions
- **Three aggregation levels**: Individual mech lifetime totals, global daily (`DailyFees`), and per-mech daily (`MechDaily`)
- **Burn address filtering**: Outgoing transfers to the burn address are excluded from fee statistics
- **Fee denomination**: xDAI in wei (10^18 precision)

## Sample Queries

### Get Legacy Mech Details
```graphql
{
  legacyMech(id: "0x...") {
    id
    agentId
    price
    totalFeesIn
    totalFeesOut
  }
}
```

### Get Daily Fee Summary
```graphql
{
  dailyFees(
    orderBy: date,
    orderDirection: desc,
    first: 30
  ) {
    id
    date
    totalFeesInLegacyMech
    totalFeesInLegacyMechMarketPlace
    totalFeesOutLegacyMech
    totalFeesOutLegacyMechMarketPlace
  }
}
```

### Get Global Statistics
```graphql
{
  global(id: "") {
    totalFeesIn
    totalFeesOut
    totalFeesInLegacyMech
    totalFeesInLegacyMechMarketPlace
    totalFeesOutLegacyMech
    totalFeesOutLegacyMechMarketPlace
  }
}
```

### Get Daily Fees for a Specific Date
```graphql
{
  dailyFees(
    where: {
      date_gte: 1710460800,  # March 15, 2024 00:00:00 UTC
      date_lt: 1710547200    # March 16, 2024 00:00:00 UTC
    }
  ) {
    id
    date
    totalFeesInLegacyMech
    totalFeesOutLegacyMech
  }
}
```

### Get Per-Mech Daily Fees
```graphql
{
  mechDailies(
    where: {
      date_gte: 1754298643
    }
    orderBy: date
    orderDirection: asc
    first: 7
  ) {
    date
    agentId
    feesInLegacyMech
    feesInLegacyMechMarketPlace
    feesOutLegacyMech
    feesOutLegacyMechMarketPlace
  }
}
```

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
yarn test       # Run Matchstick tests
```

### Project Structure
* `src/mapping.ts` — All event and call handlers (mech creation, fee tracking, price updates)
* `src/utils.ts` — Global, DailyFees, and MechDaily entity helpers
* `src/constants.ts` — Burn address constant

### Setup & Deployment
**Check the [root README](/README.md).**
