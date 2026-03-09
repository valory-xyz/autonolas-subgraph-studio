# Autonolas Tokenomics L2 Subgraph

Tracks OLAS token transfers and holder balances across 6 Layer 2 networks using a shared codebase with per-network manifest generation.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, multi-network pattern, and AI context.

## Quick Overview

- Tracks **OLAS ERC-20 Transfer events** on Arbitrum, Base, Celo, Gnosis, Optimism, and Polygon
- **Token supply & holders**: Running supply balance (mint/burn aware) and unique holder count
- **Transfer history**: Every transfer stored as an immutable entity
- Uses the **template pattern**: `subgraph.template.yaml` + `networks.json` generates per-network manifests

## Common Queries

### Token Supply and Holders
```graphql
{
  tokens {
    id
    balance
    holderCount
  }
}
```

### Recent Transfers
```graphql
{
  transfers(orderBy: blockTimestamp, orderDirection: desc, first: 20) {
    from
    to
    value
    blockTimestamp
    transactionHash
  }
}
```

## Development

```bash
yarn install               # Install dependencies
yarn generate-manifests    # Generate per-network YAML files from template
yarn codegen               # Generate TypeScript from schema + ABIs
yarn build                 # Compile to WebAssembly
yarn test                  # Run unit tests
```

### Project Structure
* `src/olas-l2.ts` -- Transfer event handler
* `src/utils.ts` -- Token/holder balance management
* `networks.json` -- Per-network OLAS contract addresses and start blocks
* `subgraph.template.yaml` -- Manifest template with placeholders

### Supported Networks

| Network | OLAS Address |
|---------|-------------|
| Arbitrum One | 0x064F8B858C2A603e1b106a2039f5446D32dc81c1 |
| Base | 0x54330d28ca3357F294334BDC454a032e7f353416 |
| Celo | 0xaCFfAe8e57Ec6E394Eb1b41939A8CF7892DbDc51 |
| Gnosis | 0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f |
| Optimism | 0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527 |
| Polygon | 0xFEF5d947472e72Efbb2E388c730B7428406F2F95 |

### Setup & Deployment
**Check the [root README](/README.md).**
