# Autonolas Subgraph Studio

Monorepo of [The Graph](https://thegraph.com/) subgraphs for the Autonolas/Olas ecosystem. Hosted on The Graph Studio.

## Repository Structure

```
abis/                          # Shared ABI files (referenced by all subgraphs)
scripts/
  generate-manifests.js        # Generates network manifests from templates
  pol-aggregation.js           # Cross-chain POL + protocol fees report (queries all liquidity subgraphs + Solana RPC)
shared/
  constants.ts                 # Shared constants across subgraphs
subgraphs/
  babydegen/                   # Baby Degen agent portfolio tracking (Optimism)
  governance/                  # Governance tracking
  legacy-mech-fees/            # Legacy mech fee indexing
  liquidity/                   # Protocol Owned Liquidity — Ethereum mainnet (OLAS-ETH + bridged L2 LP tokens)
  liquidity-l2/                # Protocol Owned Liquidity — L2 pools (6 networks; template pattern with manual overrides for Base dual-pool and Celo Ubeswap)
  new-mech-fees/               # Multi-network mech fees (Gnosis, Base, Polygon, Optimism, Arbitrum, Celo, Ethereum — 7 networks)
  predict/                     # Prediction markets (Omen on Gnosis, Polymarket on Polygon)
  service-registry/            # Service registry (8 networks; hybrid: hand-crafted mainnet manifest + L2 template)
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

1. **Template Pattern** (staking, tokenomics-l2, liquidity-l2): `subgraph.template.yaml` + `networks.json` + `generate-manifests.js`. `liquidity-l2` additionally maintains hand-crafted manifests for Base (dual pool) and Celo (Ubeswap, not Balancer).
2. **Per-Network Manifests** (new-mech-fees): shared `src/` with `subgraph.<network>.yaml` per network; mappings dispatch on `dataSource.network()`.
3. **Hybrid** (service-registry): `subgraph.mainnet.yaml` (1-param `CreateService` ABI) alongside template-generated L2 manifests (2-param `CreateService` + `configHash`); separate `mapping.ts` / `mapping-eth.ts` share `utils.ts`.
4. **Single Network** (babydegen, governance, liquidity, legacy-mech-fees, tokenomics-eth, predict-omen, predict-polymarket): standalone `subgraph.yaml`.

## Development Workflow

Each subgraph is self-contained with its own `package.json`. Navigate to the subgraph directory and run commands locally:

```bash
cd subgraphs/<subgraph-name>           # Navigate to the subgraph directory
yarn install                           # Install dependencies
yarn codegen                           # Generate TS types from schema + ABIs
yarn build                             # Build subgraph (compiles to WASM)
yarn test                              # Run Matchstick tests
```

CI runs on every PR via `.github/workflows/test.yaml` — a matrix over all 12 subgraph targets runs `yarn graph codegen` followed by `yarn graph test` (Matchstick) for each. Template subgraphs run `yarn generate-manifests` first; per-network subgraphs symlink a representative manifest (`subgraph.gnosis.yaml`) before testing. Deployment is handled via `.github/workflows/deploy-subgraph.yaml` (manual dispatch from main).

## Conventions

- Entity IDs: typically address-based (e.g., safe address, `<address>-<tokenId>`, `<address>-<dayTimestamp>`)
- Financial fields use `BigInt` by default. Exception: `new-mech-fees` uses `BigDecimal` for USD-denominated fields (rationale in [`docs/TOKEN-PAYMENT-POOLS.md`](docs/TOKEN-PAYMENT-POOLS.md)).
- UTC midnight timestamps for daily entities: `timestamp / 86400 * 86400`
- Shared ABIs live in root `abis/` directory
- Each subgraph has its own `schema.graphql`, `subgraph.yaml`, `src/`, and optional `tests/`

## CLAUDE.md Maintenance

Each subgraph should have its own `CLAUDE.md` with subgraph-specific context (entities, handlers, business logic, contracts). When making feature changes to a subgraph:

1. **Update the subgraph's CLAUDE.md** to reflect new/changed entities, handlers, contracts, or business rules
2. If adding a new subgraph, create a CLAUDE.md for it following the pattern in existing subgraphs (see `subgraphs/predict/predict-omen/CLAUDE.md` or `subgraphs/babydegen/babydegen-optimism/CLAUDE.md` for examples)
3. Keep CLAUDE.md concise but comprehensive — it serves as the primary AI context for future development
