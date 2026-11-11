# Autonolas Subgraph Studio

Monorepo of [The Graph](https://thegraph.com/) subgraphs for the Autonolas/Olas ecosystem. Hosted on The Graph Studio.

## Repository Structure

```
abis/                          # Shared ABI files (referenced by all subgraphs)
scripts/
  generate-manifests.js        # Generates network manifests from templates
  pol-aggregation.js           # Cross-chain POL + protocol fees report (queries all liquidity subgraphs + Solana RPC)
  audit.mjs                    # Wraps `yarn audit --json` with allowlist (.supply-chain/audit-allowlist.json). Run as `yarn audit:prod`.
  audit-install-hooks.mjs      # Diffs node_modules install-hooks against .supply-chain/install-hooks.allowlist
.supply-chain/
  audit-allowlist.json         # Time-bounded suppressions for high/critical advisories
  install-hooks.allowlist      # Approved packages with non-trivial install hooks
shared/
  constants.ts                 # Shared constants across subgraphs
subgraphs/
  babydegen/                   # Baby Degen agent portfolio tracking (Optimism; deprecated Base deployment retained during migration)
  governance/                  # Governance tracking
  legacy-mech-fees/            # Legacy mech fee indexing
  liquidity/                   # Protocol Owned Liquidity — Ethereum mainnet (OLAS-ETH + bridged L2 LP tokens)
  liquidity-l2/                # Protocol Owned Liquidity — L2 pools (6 networks; Base remains active for olas-website/POL aggregation; manual Base dual-pool and Celo Ubeswap manifests)
  new-mech-fees/               # Multi-network mech fees (Gnosis, Polygon, Optimism, Arbitrum, Celo, Ethereum — 6 networks; Base deployment config retired)
  pearl-transactions/          # Pearl Master/Agent Safe funds movement → wallet transaction history, VLOP-73 (Gnosis, Polygon, Optimism — template pattern; Base deployment config retired). Current Pearl uses this subgraph on Gnosis/Optimism and the Infra squid on Base/Polygon; older Base consumers still need the published Studio deployment. Design: subgraphs/pearl-transactions/IMPLEMENTATION-PLAN.md.
  service-registry/            # Service registry (5 Studio configs; Gnosis self-hosted; Base/Robinhood squid; Polygon squid deployed, consumer cutover pending; hand-crafted mainnet + L2 template)
  staking/                     # Staking contracts (6 networks, template pattern; Base deployment config retired; Polygon squid deployed, consumer cutover pending)
  tokenomics-eth/              # Tokenomics L1 (Ethereum mainnet, standalone)
  tokenomics-l2/               # Tokenomics L2 (5 networks, template pattern; Base deployment config retired)
```

## Tech Stack

- **Language**: AssemblyScript (compiled to WASM by Graph CLI)
- **Framework**: The Graph (graph-cli 0.98.1, graph-ts 0.38.2 — exact pins, no carets, all 14 package.json files converged)
- **Testing**: Matchstick (matchstick-as 0.6.0 — exact pin)
- **Node**: 22.x via `.nvmrc`; `packageManager: "yarn@1.22.22"` enforced via Corepack in CI.
- **Deployment**: CI/CD → The Graph Studio / Alchemy

## Multi-Network Patterns

Retired Base configurations remain available at the recovery SHA in README.md for legacy consumer hotfixes. Base liquidity stays deployable here until its squid replacement is live and consumers have switched.

1. **Template Pattern** (staking, tokenomics-l2, liquidity-l2, pearl-transactions): `subgraph.template.yaml` + `networks.json` + `generate-manifests.js`. `liquidity-l2` additionally maintains hand-crafted manifests for Base (dual pool) and Celo (Ubeswap, not Balancer).
2. **Per-Network Manifests** (new-mech-fees): shared `src/` with `subgraph.<network>.yaml` per network; mappings dispatch on `dataSource.network()`.
3. **Hybrid** (service-registry): `subgraph.mainnet.yaml` (1-param `CreateService` ABI) alongside template-generated L2 manifests (2-param `CreateService` + `configHash`); separate `mapping.ts` / `mapping-eth.ts` share `utils.ts`.
4. **Single Network** (babydegen, governance, liquidity, legacy-mech-fees, tokenomics-eth): standalone `subgraph.yaml`.

## Development Workflow

Each subgraph is self-contained with its own `package.json`. Navigate to the subgraph directory and run commands locally:

```bash
cd subgraphs/<subgraph-name>           # Navigate to the subgraph directory
yarn install                           # Install dependencies
yarn codegen                           # Generate TS types from schema + ABIs
yarn build                             # Build subgraph (compiles to WASM)
yarn test                              # Run Matchstick tests
```

CI runs on every PR via `.github/workflows/ci.yml` — a matrix over the remaining subgraph targets runs `yarn graph codegen` followed by `yarn graph test` (Matchstick) for each. Template subgraphs run `yarn generate-manifests` first; per-network subgraphs symlink a representative manifest (`subgraph.gnosis.yaml`) before testing. Deployment is handled via `.github/workflows/deploy-subgraph.yaml` (manual dispatch from main).

Supply-chain checks are jobs in `.github/workflows/ci.yml`: advisory auditing,
install-hook checks and lockfile lint run over the remaining package paths;
the `scan` job runs secret scanning with a checksum-verified gitleaks binary.

## Conventions

- Entity IDs: typically address-based (e.g., safe address, `<address>-<tokenId>`, `<address>-<dayTimestamp>`)
- Financial fields use `BigInt` by default. Exception: `new-mech-fees` uses `BigDecimal` for USD-denominated fields (rationale in [`docs/TOKEN-PAYMENT-POOLS.md`](docs/TOKEN-PAYMENT-POOLS.md)).
- UTC midnight timestamps for daily entities: `timestamp / 86400 * 86400`
- Shared ABIs live in root `abis/` directory
- Each subgraph has its own `schema.graphql`, `subgraph.yaml`, `src/`, and optional `tests/`

## Supply chain & security

This repo's deployments serve indexed on-chain data to **every Olas dashboard, frontend, and analytics consumer**. A compromised subgraph deploy has org-wide blast radius — far beyond what the small dep tree might suggest. Treat the deploy auth secret (`SUBGRAPH_STUDIO_KEY`) and the `@graphprotocol/graph-cli` toolchain as crown-jewel surfaces.

- **Threat model + controls + response playbook**: [`SUPPLY-CHAIN-SECURITY.md`](SUPPLY-CHAIN-SECURITY.md).
- **Disclosure policy**: [`SECURITY.md`](SECURITY.md).
- **Audit allowlist**: [`.supply-chain/audit-allowlist.json`](.supply-chain/audit-allowlist.json) — every entry needs `id`, `reason`, `added`, `review` (all required).
- **Install-hook allowlist**: [`.supply-chain/install-hooks.allowlist`](.supply-chain/install-hooks.allowlist) — drift in either direction (new hook OR removed hook) fails CI.

**Yarn 1 gotcha**: the audit gate is invoked as `yarn audit:prod`, NOT `yarn audit`. Yarn 1.x's built-in `yarn audit` shadows same-named scripts in `package.json`, so naming the script `audit` would silently invoke the built-in instead. Same care with `audit:install-hooks` (the install-hook gate).

After any dep change, refresh the install-hooks allowlist:

```bash
yarn install
yarn audit:install-hooks:update
git add .supply-chain/install-hooks.allowlist
```

## CLAUDE.md Maintenance

Each subgraph should have its own `CLAUDE.md` with subgraph-specific context (entities, handlers, business logic, contracts). When making feature changes to a subgraph:

1. **Update the subgraph's CLAUDE.md** to reflect new/changed entities, handlers, contracts, or business rules
2. If adding a new subgraph, create a CLAUDE.md for it following the pattern in existing subgraphs (see `subgraphs/babydegen/babydegen-optimism/CLAUDE.md` for examples)
3. Keep CLAUDE.md concise but comprehensive — it serves as the primary AI context for future development

Active trader sources: Polystrat/Polymarket uses `autonolas-subgraph/squids/predict-polymarket`; Omen uses `autonolas-subgraph/subgraphs/predict-omen` (self-hosted). Their Studio source implementations have been removed from this repository; the published Studio deployments are deprecated, and the repository maintainer confirmed on 2026-11-05 that no consumers still use them (see README.md).
