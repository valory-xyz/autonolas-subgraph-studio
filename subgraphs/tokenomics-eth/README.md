# Autonolas Tokenomics Ethereum Subgraph

Indexes the full OLAS tokenomics system on Ethereum mainnet: epoch management, bonding products, staking/developer incentive distribution, OLAS token tracking, and veOLAS lock tracking.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, epoch management logic, utility functions, and AI context.

## Quick Overview

- Tracks **7 contracts**: Tokenomics, DepositoryV1/V2, DispenserV1/V2, OLAS, veOLAS
- **Epoch lifecycle**: Settlement events trigger epoch finalization, matured bond calculation, and next-epoch creation
- **Bond tracking**: Product creation/closure, bond creation/redemption, and OLAS bond claims detected via Transfer events
- **Incentive distribution**: Developer incentives (V1+V2) and staking incentives (V2, with cross-chain nominee hash resolution)
- **Token stats**: OLAS supply, holder count, individual balances, and veOLAS locked amount

## Common Queries

### Epoch Data
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
* `src/dispenser.ts` -- Incentive distribution handlers (V1 + V2)
* `src/veolas.ts` -- veOLAS deposit/withdrawal tracking
* `src/olas.ts` -- OLAS token transfer & bond claim tracking
* `src/utils.ts` -- Epoch lookup, nominee hash, token balance helpers

### Setup & Deployment
**Check the [root README](/README.md).**
