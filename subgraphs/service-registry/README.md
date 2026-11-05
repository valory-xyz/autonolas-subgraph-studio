# Service Registry Subgraph

Tracks Olas service lifecycle, multisigs, ERC-8004 identity and daily activity.

**Current hosting:** Ethereum, Polygon, Optimism, Arbitrum and Celo use this
Studio subgraph. Gnosis uses the
[self-hosted subgraph](https://github.com/valory-xyz/autonolas-subgraph/tree/main/subgraphs/service-registry);
Base and Robinhood use the
[service-registry squid](https://github.com/valory-xyz/autonolas-subgraph/tree/main/squids/service-registry).
Retained manifests describe source coverage, not consumer routing. See the internal
**[WD] Subgraph&Squids Development and Deployment Tracking** document for current endpoints and versions.

This cleanup removes the Gnosis configuration explicitly retired from this
repository. It does not remove every manifest whose consumers use another backend:
Base's manifest, network entry and `deploy-base` script remain available for source
coverage and explicit manual Studio deployment. Their presence is not a recommendation
to switch consumers from the squid; check the deployment tracker before deploying
or changing consumer routing. Retiring Base's Studio configuration is a separate decision.

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
Ethereum, Base, Optimism, Polygon, Arbitrum, Celo

### Setup & Deployment
**Check the [root README](/README.md).**
