# Autonolas Tokenomics Ethereum Subgraph

Indexes the full OLAS tokenomics system on Ethereum mainnet: epoch management, bonding products, staking/developer incentive distribution, OLAS token tracking, and veOLAS lock tracking.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, epoch management logic, utility functions, and AI context.

## Quick Overview

- Tracks **8 contracts**: Tokenomics, DepositoryV1/V2, DispenserV1/V2/Proxy, OLAS, veOLAS
- **Epoch lifecycle**: Settlement events trigger epoch finalization, matured bond calculation, and next-epoch creation
- **Bond tracking**: Product creation/closure, bond creation/redemption, and OLAS bond claims detected via Transfer events
- **Incentive distribution**: Developer incentives (V1, V2 and proxy), staking epoch rollups and raw claims from legacy and proxy Dispensers
- **Token stats**: OLAS supply, holder count, individual balances, and veOLAS locked amount

## Common Queries

### Epoch Data

Staking epoch totals and `stakingIncentives` include both legacy and proxy Dispensers. Each target's full claim amount is attributed to `mapLastClaimedStakingEpochs(nomineeHash) - 1`, using the emitting Dispenser. This preserves the existing method: multi-epoch claims are not split, and reads reflect end-of-block state. Incentive allocations, actual transfers and returned amounts remain separate in raw claim records.

```graphql
{
  epoch(id: "10") {
    counter
    startBlock
    endBlock
    effectiveBond
    accountTopUps
    totalBondsClaimable
    totalBondsClaimed
    totalStakingIncentives
    devIncentives { owner, reward, topUp }
  }
}
```

### OLAS Token & veOLAS Stats
```graphql
{
  token(id: "0x0001a500a6b18995b03f44bb040a5ffc28e45cb0") {
    balance
    holderCount
  }
  global(id: "") {
    veolasHolderCount
  }
}
```

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
yarn test       # Run unit tests
```

### Project Structure
* `src/mappings.ts` -- Epoch settlement & dev incentive logic
* `src/depository.ts` -- Bond product & bond event handlers (V1 + V2)
* `src/tokenomics.ts` -- Tokenomics contract event handlers (V1 + V2)
* `src/dispenser.ts` -- Shared raw claim saves and epoch rollups (V1 + V2 + proxy)
* `src/dispenser-proxy.ts` -- Shared event exports, proxy upgrades and staking handlers
* `src/veolas.ts` -- veOLAS deposit/withdrawal tracking
* `src/olas.ts` -- OLAS token transfer & bond claim tracking
* `src/utils.ts` -- Epoch lookup, nominee hash, token balance helpers

### Setup & Deployment
**Check the [root README](/README.md).**

### Deploying the proxy staking rollup update

Deploy a fresh Studio version and fully reindex to include historical proxy claims in the rollups. Merging or restarting an existing deployment does not backfill them. Validate the fresh index before switching consumers. The schema shape is unchanged; exact multi-epoch accounting remains a separate follow-up.
