# Service Registry Subgraph

Tracks the lifecycle of Olas services across Ethereum mainnet and 7 L2 networks, including agent registration, multisig creation, ERC-8004 agent identity, and daily activity metrics.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, business rules, multi-network configuration, and AI context.

## Quick Overview

- Indexes `ServiceRegistry` (mainnet) and `ServiceRegistryL2` (L2s) for service creation, agent registration, multisig deployment, and termination
- Dynamically tracks `GnosisSafe` multisig transactions via templates
- **ERC-8004 identity**: Tracks agent wallets and metadata via `IdentityRegistryBridger`
- **Daily aggregations**: Unique agents, per-agent transaction counts, active multisigs — all deduplicated via join entities
- **Most recent agent selection**: At multisig creation, only the most recently registered agent is assigned to prevent double counting

## Common Queries

### Daily Active Agents per Agent ID
```graphql
{
  dailyAgentPerformances(
    where: { agentId: 40, dayTimestamp_gte: "1672531200" }
    orderBy: dayTimestamp
    orderDirection: desc
  ) {
    dayTimestamp
    activeMultisigCount
  }
}
```

### Global Statistics
```graphql
{
  global(id: "") {
    txCount
    totalOperators
  }
}
```

## Development

```bash
yarn install                # Install dependencies
yarn codegen                # Generate TypeScript from schema + ABIs
yarn build                  # Compile to WebAssembly
yarn generate-manifests     # Regenerate L2 manifests from template
yarn test                   # Run Matchstick tests
```

### Project Structure
* `src/mapping.ts` — L2 handlers (ServiceRegistryL2 + GnosisSafe + IdentityRegistryBridger)
* `src/mapping-eth.ts` — Mainnet handlers (ServiceRegistry + GnosisSafe + IdentityRegistryBridger)
* `src/utils.ts` — Shared helpers & entity factories
* `subgraph.template.yaml` — Template for L2 manifest generation
* `networks.json` — Contract addresses & start blocks per network

### Supported Networks
Ethereum, Gnosis, Base, Optimism, Polygon, Arbitrum, Celo

### Setup & Deployment
**Check the [root README](/README.md).**
