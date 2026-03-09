# Autonolas Subgraph Studio

Monorepo of [The Graph](https://thegraph.com/) subgraphs for the Autonolas/Olas ecosystem. Hosted on The Graph Studio.

## Repository Structure

```
abis/                          # Shared ABI files (referenced by all subgraphs)
scripts/
  generate-manifests.js        # Generates network manifests from templates
shared/
  constants.ts                 # Shared constants across subgraphs
subgraphs/
  babydegen/                   # Baby Degen agent portfolio tracking (Optimism)
  governance/                  # Governance tracking
  legacy-mech-fees/            # Legacy mech fee indexing
  liquidity/                   # Liquidity tracking
  new-mech-fees/               # Multi-network mech fees (Gnosis, Base, Polygon, Optimism)
  predict/                     # Prediction markets (Omen on Gnosis, Polymarket)
  service-registry/            # Service registry (7 networks, template pattern)
  staking/                     # Staking contracts (7 networks, template pattern)
  tokenomics-eth/              # Tokenomics L1 (Ethereum mainnet, standalone)
  tokenomics-l2/               # Tokenomics L2 (6 networks, template pattern)
```

## Tech Stack

- **Language**: AssemblyScript (compiled to WASM by Graph CLI)
- **Framework**: The Graph (graph-cli ^0.97.0, graph-ts ^0.38.0)
- **Testing**: Matchstick (matchstick-as 0.5.0)
- **Deployment**: CI/CD → The Graph Studio / Alchemy

## Multi-Network Patterns

1. **Template Pattern** (staking, service-registry, tokenomics-l2): `subgraph.template.yaml` + `networks.json` + `generate-manifests.js`
2. **Per-Network Manifests** (new-mech-fees): shared `src/` with `subgraph.<network>.yaml` per network
3. **Single Network** (babydegen, governance, liquidity, legacy-mech-fees, tokenomics-eth): standalone `subgraph.yaml`

## Development Workflow

Each subgraph is self-contained with its own `package.json`. Navigate to the subgraph directory and run commands locally:

```bash
cd subgraphs/<subgraph-name>           # Navigate to the subgraph directory
yarn install                           # Install dependencies
yarn codegen                           # Generate TS types from schema + ABIs
yarn build                             # Build subgraph (compiles to WASM)
yarn test                              # Run Matchstick tests
```

Deployment is handled via CI/CD — no manual deployment scripts.

## Conventions

- Entity IDs: typically address-based (e.g., safe address, `<address>-<tokenId>`, `<address>-<dayTimestamp>`)
- All financial fields use `BigInt` (no BigDecimal)
- UTC midnight timestamps for daily entities: `timestamp / 86400 * 86400`
- Shared ABIs live in root `abis/` directory
- Each subgraph has its own `schema.graphql`, `subgraph.yaml`, `src/`, and optional `tests/`

## CLAUDE.md Maintenance

Each subgraph should have its own `CLAUDE.md` with subgraph-specific context (entities, handlers, business logic, contracts). When making feature changes to a subgraph:

1. **Update the subgraph's CLAUDE.md** to reflect new/changed entities, handlers, contracts, or business rules
2. If adding a new subgraph, create a CLAUDE.md for it following the pattern in existing subgraphs (see `subgraphs/predict/predict-omen/CLAUDE.md` or `subgraphs/babydegen/babydegen-optimism/CLAUDE.md` for examples)
3. Keep CLAUDE.md concise but comprehensive — it serves as the primary AI context for future development
