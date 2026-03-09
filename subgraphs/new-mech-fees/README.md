# New Mech Fees Subgraphs

Tracks fees for autonomous agents (mechs) across multiple payment models and networks. Indexes every fee-in (accrual) and fee-out (collection) event with USD conversion.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, USD conversion strategies, contract addresses, raw unit rules, and utility functions.

## Quick Overview

- **4 networks**: Gnosis, Base, Polygon, Optimism (per-network manifests: `subgraph.<network>.yaml`)
- **4 payment models**: Native, NVM (credits), Token OLAS, Token USDC
- **Two event types**: `MechBalanceAdjusted` (fee-in) and `Withdraw` (fee-out)
- **USD conversion**: Chainlink price feeds (native), Balancer V2 pools (OLAS), direct (xDAI/USDC)
- **Raw units are NOT comparable across models** — use USD fields for cross-model analysis, `MechModel` entity for per-model raw totals
- **`Withdraw`** = mech claimed payments (protocol fees currently off, so claimed = earned)

## Core Entities

- **`Mech`**: Lifetime totals (USD + raw) per mech address
- **`MechModel`**: Per-mech, per-payment-model aggregates (`id = "${mech}-${model}"`) — use this for correct raw totals
- **`MechTransaction`**: Immutable record of each fee event (`FEE_IN` / `FEE_OUT`)
- **`Global`**: Singleton aggregate USD totals across all mechs (`id = ""`)
- **`DailyTotals`**: Global per-day USD totals (`id = dayStart as string`)
- **`MechDaily`**: Per-mech per-day totals (`id = "${mech}-${dayStart}"`)

## Sample Queries

### Mech Lifetime Totals
```graphql
{
  mech(id: "0x...") {
    totalFeesInUSD
    totalFeesOutUSD
    totalFeesInRaw
    totalFeesOutRaw
  }
}
```

### Per-Model Totals (raw correctness)
```graphql
{
  mechModels(where: { mech: "0xMECH" }) {
    model
    totalFeesInUSD
    totalFeesOutUSD
    totalFeesInRaw
    totalFeesOutRaw
  }
}
```

### Daily Fee Transactions
```graphql
{
  mechTransactions(
    where: {
      mech: "0x...",
      timestamp_gte: "1672531200",
      timestamp_lt: "1672617600"
    },
    orderBy: timestamp,
    orderDirection: desc
  ) {
    type
    model
    amountRaw
    amountUSD
    timestamp
    txHash
  }
}
```

### Global Statistics
```graphql
{
  global(id: "") {
    totalFeesInUSD
    totalFeesOutUSD
  }
}
```

### Per-Mech Daily Totals
```graphql
{
  mechDailies(
    where: { mech: "0xMECH_ADDRESS", date_gte: 1710460800, date_lt: 1711065600 },
    orderBy: date, orderDirection: asc
  ) {
    date
    feesInUSD
    feesOutUSD
    feesInRaw
    feesOutRaw
  }
}
```

### Global Daily Totals
```graphql
# Note: list field is dailyTotals_collection
{
  dailyTotals_collection(
    where: { date_gte: 1710460800, date_lt: 1711065600 },
    orderBy: date, orderDirection: asc
  ) {
    date
    totalFeesInUSD
    totalFeesOutUSD
  }
}
```

### Top Mechs by Model
```graphql
{
  mechModels(
    where: { model: "native" }
    orderBy: totalFeesInUSD
    orderDirection: desc
    first: 100
  ) {
    mech { id }
    totalFeesInUSD
    totalFeesOutUSD
    totalFeesInRaw
    totalFeesOutRaw
  }
}
```

## Development

```bash
yarn install              # Install dependencies
yarn codegen              # Generate TypeScript (default: polygon manifest)
yarn build:gnosis         # Build for Gnosis
yarn build:base           # Build for Base
yarn build:polygon        # Build for Polygon
yarn build:optimism       # Build for Optimism
```

### Project Structure
* `src/native-mapping.ts` — Native payment model handlers (xDAI/ETH/POL)
* `src/nvm-mapping.ts` — NVM subscription model handlers (credits)
* `src/token-olas-mapping.ts` — Token OLAS payment handlers
* `src/token-usdc-mapping.ts` — Token USDC payment handlers (Polygon/Optimism only)
* `src/utils.ts` — Shared helpers, entity management, USD conversion functions
* `src/token-utils.ts` — Balancer V2 pool OLAS price calculation
* `src/constants.ts` — NVM token ratios and decimal configs

### Setup & Deployment
**Check the [root README](/README.md).**
