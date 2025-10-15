# Legacy Mech Fees Gnosis Subgraph

A blockchain indexing system that tracks fees for autonomous agents (mechs) interacting with the legacy marketplace contracts on Gnosis Chain. This subgraph provides comprehensive fee tracking for both standard legacy mechs and marketplace-mediated transactions.

## Overview

This subgraph provides real-time tracking of every fee-in (accrual) and fee-out (collection) event for legacy mechs on Gnosis Chain. By logging each transaction, the subgraph enables detailed time-based analysis, including daily fee aggregation and historical trends.

The system tracks two distinct types of legacy mechs:
- **Legacy Mechs (LM)**: Direct mech interactions
- **Legacy Market-Maker Mechs (LMM)**: Marketplace-mediated interactions

## Contract Details

| Component | Contract Address | Start Block |
| :--- | :--- | :--- |
| **LM Factory 1** | `0x88de734655184a09b70700ae4f72364d1ad23728` | 27911512 |
| **LM Factory 2** | `0x4be7a91e67be963806fefa9c1fd6c53dfc358d94` | 30662989 |
| **LMM Factory 1** | `0x2acd313b892c9922e470e4950e907d5eaa70fc2a` | 35714019 |
| **LMM Factory 2** | `0x6d8cbebcad7397c63347d44448147db05e7d17b0` | 36582492 |
| **LMM Factory 3** | `0x25c980328762a03f70c2649ef4be691b811b690a` | 36582492 |
| **Legacy Marketplace** | `0x4554fE75c1f5576c1d7F765B2A036c199Adae329` | 35714019 |

## Core Entities

- **`LegacyMech`**: Tracks individual legacy mechs with lifetime fee totals, agent ID, and current pricing
- **`LegacyMechMarketPlace`**: Tracks marketplace-based mechs with the same structure as LegacyMech
- **`Global`**: Aggregates system-wide statistics with separate totals for each mech type
- **`DailyFees`**: Daily fee aggregation entity that tracks daily totals for both mech types
- **`MechDaily`**: Daily fee aggregation entity that tracks daily totals for each mech

## Fee Units

All fee amounts in this subgraph are denominated in:
- **Native Token**: xDAI on Gnosis Chain
- **Base Unit**: Wei (10^18 precision)
- **Burn Address**: `0x153196110040a0c729227c603db3a6c6d91851b2` (excluded from outgoing fee totals)

## Key Features

### Dual Mech Type Tracking
- **Standard Legacy Mechs**: Direct user-to-mech interactions
- **Marketplace Mechs**: Transactions routed through the legacy marketplace

### Comprehensive Fee Flow Monitoring
- **Incoming Fees**: Tracked via `Request` events and marketplace calls
- **Outgoing Fees**: Tracked via `exec` function calls (excluding burns)
- **Price Updates**: Dynamic pricing changes tracked in real-time

### Daily Aggregation
- **Daily Totals**: Automatic daily fee aggregation by mech type
- **Date-Based IDs**: Unix timestamp-based daily entity identification
- **Historical Analysis**: Complete daily fee history since deployment

## Mech Daily Aggregation

- **Daily Totals**: Automatic daily fee aggregation for each mech
- **Date-Based IDs**: Unix timestamp-based daily entity identification
- **Historical Analysis**: Complete daily fee history since deployment

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

### Get Daily Fees for Date Range
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

### Get All Legacy Mechs with Activity
```graphql
{
  legacyMechs(
    where: {
      or: [
        { totalFeesIn_gt: "0" },
        { totalFeesOut_gt: "0" }
      ]
    }
    orderBy: totalFeesIn,
    orderDirection: desc
  ) {
    id
    agentId
    price
    totalFeesIn
    totalFeesOut
  }
}
```

### Get Daily Fees for the first 7 mechs
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

## Architecture

### Factory Pattern
- Multiple factory contracts create new mech instances
- Dynamic template instantiation for each new mech
- Automatic event handler registration

### Burn Address Filtering
- Outgoing transfers to burn address are excluded from fee statistics
- Maintains accurate fee flow calculations
- Prevents artificial inflation of outgoing fee totals

### Price Tracking
- Real-time price updates for each mech
- Historical pricing information preserved
- Fee calculations based on current mech pricing

## Data Flow

1. **Mech Creation**: Factory contracts emit `CreateMech` events
2. **Fee Accrual**: Direct requests or marketplace calls trigger fee-in tracking
3. **Fee Distribution**: `exec` calls distribute fees to recipients (fee-out tracking)
4. **Daily Aggregation**: All fee events automatically update daily totals globally and for each mech
5. **Global Updates**: System-wide statistics updated with each transaction

## Network Information

- **Network**: Gnosis Chain (xDAI)
- **Native Token**: xDAI
- **Precision**: 18 decimals (wei)
- **Block Explorer**: [Gnosisscan](https://gnosisscan.io/)

This subgraph provides comprehensive insights into the legacy mech ecosystem on Gnosis Chain, enabling analysis of fee flows, mech performance, and system-wide economics.