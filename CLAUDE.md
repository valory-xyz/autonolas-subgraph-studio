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
  babydegen/                   # Baby Degen agent portfolio tracking (Optimism)
  governance/                  # Governance tracking
  legacy-mech-fees/            # Legacy mech fee indexing
  liquidity/                   # Protocol Owned Liquidity — Ethereum mainnet (OLAS-ETH + bridged L2 LP tokens)
  liquidity-l2/                # Protocol Owned Liquidity — L2 pools (6 networks; template pattern with manual overrides for Base dual-pool and Celo Ubeswap)
  new-mech-fees/               # Multi-network mech fees (Gnosis, Base, Polygon, Optimism, Arbitrum, Celo, Ethereum — 7 networks)
  pearl-transactions/          # Pearl Master/Agent Safe funds movement (Gnosis, Polygon, Optimism, Base — template pattern). Scaffold only; full design in PR #129.
  predict/                     # Prediction markets (Omen on Gnosis, Polymarket on Polygon)
  service-registry/            # Service registry (8 networks; hybrid: hand-crafted mainnet manifest + L2 template)
  staking/                     # Staking contracts (7 networks, template pattern)
  tokenomics-eth/              # Tokenomics L1 (Ethereum mainnet, standalone)
  tokenomics-l2/               # Tokenomics L2 (6 networks, template pattern)
```

## Tech Stack

- **Language**: AssemblyScript (compiled to WASM by Graph CLI)
- **Framework**: The Graph (graph-cli 0.98.1, graph-ts 0.38.2 — exact pins, no carets, all 14 package.json files converged)
- **Testing**: Matchstick (matchstick-as 0.6.0 — exact pin)
- **Node**: 22.x via `.nvmrc`; `packageManager: "yarn@1.22.22"` enforced via Corepack in CI.
- **Deployment**: CI/CD → The Graph Studio / Alchemy

## Multi-Network Patterns

1. **Template Pattern** (staking, tokenomics-l2, liquidity-l2, pearl-transactions): `subgraph.template.yaml` + `networks.json` + `generate-manifests.js`. `liquidity-l2` additionally maintains hand-crafted manifests for Base (dual pool) and Celo (Ubeswap, not Balancer).
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

CI runs on every PR via `.github/workflows/ci.yml` — a matrix over all 13 subgraph targets runs `yarn graph codegen` followed by `yarn graph test` (Matchstick) for each. Template subgraphs run `yarn generate-manifests` first; per-network subgraphs symlink a representative manifest (`subgraph.gnosis.yaml`) before testing. Deployment is handled via `.github/workflows/deploy-subgraph.yaml` (manual dispatch from main).

Two additional CI workflows enforce supply-chain hygiene (advisory-only at first; promote to required-status when the team is ready):
- `.github/workflows/supply-chain.yml` — matrix audit + install-hook + lockfile-lint over all 13 paths.
- `.github/workflows/gitleaks.yml` — secret scanning with SHA-256 verified gitleaks binary.

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
2. If adding a new subgraph, create a CLAUDE.md for it following the pattern in existing subgraphs (see `subgraphs/predict/predict-omen/CLAUDE.md` or `subgraphs/babydegen/babydegen-optimism/CLAUDE.md` for examples)
3. Keep CLAUDE.md concise but comprehensive — it serves as the primary AI context for future development
