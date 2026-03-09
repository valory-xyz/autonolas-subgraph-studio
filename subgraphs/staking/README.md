# Staking Subgraph

Indexes OLAS staking activities and reward distributions across 7 networks in the Autonolas ecosystem.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, business logic, implementation whitelists, and AI context.

## Quick Overview

- Tracks **StakingFactory** contracts and dynamically created **StakingProxy** instances across 7 networks (Gnosis, Base, Optimism, Ethereum, Polygon, Arbitrum, Celo)
- **Epoch-based reward tracking**: Per-service reward history with zero-reward entries for services that didn't meet KPIs
- **Service lifecycle**: Staking, unstaking, force unstaking, eviction, and cross-contract migration
- **Daily ecosystem snapshots**: Forward-filled metrics with median reward calculations

## Common Queries

### Service Performance
```graphql
{
  services(orderBy: olasRewardsEarned, orderDirection: desc, first: 10) {
    id
    currentOlasStaked
    olasRewardsEarned
    olasRewardsClaimed
    latestStakingContract
    totalEpochsParticipated
  }
}
```

### Global Statistics
```graphql
{
  globals {
    cumulativeOlasStaked
    cumulativeOlasUnstaked
    currentOlasStaked
    totalRewards
  }
}
```

## Development

```bash
yarn install                  # Install dependencies
yarn codegen                  # Generate TypeScript from schema + ABIs
yarn build                    # Compile to WebAssembly
yarn test                     # Run unit tests (12 tests)
```

### Project Structure
* `src/staking-factory.ts` — Factory event handlers (instance creation with implementation filtering)
* `src/staking-proxy.ts` — Proxy event handlers (staking, checkpoints, rewards, unstaking)
* `src/utils.ts` — Shared utilities (stake calculation, daily snapshots, median computation)

### Setup & Deployment
**Check the [root README](/README.md).**
