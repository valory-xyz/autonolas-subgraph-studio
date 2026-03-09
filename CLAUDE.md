# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo of [The Graph](https://thegraph.com/) subgraphs for the Autonolas/Olas ecosystem. Indexes on-chain events from Olas smart contracts across multiple EVM networks (Ethereum, Arbitrum, Base, Celo, Gnosis, Optimism, Polygon). Deployed to The Graph Studio and Alchemy.

## Common Commands

All commands run from the **repo root**.

```bash
yarn install                          # Install dependencies
yarn codegen-<subgraph>               # Generate TypeScript types from schema/ABIs
yarn build-<subgraph>:<network>       # Codegen + compile to WASM
yarn test                             # Run all Matchstick tests
graph test subgraphs/<name>/tests/<file>.test.ts  # Run specific test
yarn deploy-studio                    # Interactive deployment CLI
node scripts/generate-manifests.js    # Generate manifests from templates (staking, service-registry)
```

Build script naming: `build-tokenomics:ethereum`, `build-new-mech-fees:gnosis`, `build-babydegen-optimism`. Check `package.json` for the full list.

For template-pattern subgraphs (staking, service-registry), run `generate-manifests.js` before building.

## Architecture

### Multi-Network Patterns

**Template Pattern** (preferred for new subgraphs): `subgraph.template.yaml` + `networks.json` → generated `subgraph.<network>.yaml` via `scripts/generate-manifests.js`. Used by: `staking`, `service-registry`.

**Shared Code Pattern**: `common/` directory with shared schema, mappers, and utilities; each network gets its own subdirectory with a network-specific manifest. Used by: `tokenomics`, `new-mech-fees`.

### Key Directories

- `abis/` — Shared ABI JSON files referenced by all subgraphs (use relative paths like `../../../abis/Contract.json`)
- `subgraphs/` — Individual subgraph projects
- `scripts/` — `deploy-studio.js` (interactive deploy), `generate-manifests.js` (template→manifest)
- `shared/constants.ts` — Constants shared across subgraphs

### Tokenomics Special Case

Tokenomics has separate L1 (Ethereum) and L2 codegen. The L1 build requires running both L2 and L1 codegen, then copying the `generated/` directory:
```bash
yarn codegen-tokenomics-l2 && yarn codegen-tokenomics-l1 && cp -r generated subgraphs/tokenomics/tokenomics-eth/ && graph build ...
```

### Mapping Pattern

Handlers import from generated contract ABIs and schema types, using `graph-ts` utilities (Address, BigInt, Bytes). Standard pattern: `handleEventName(event: EventType): void`.

## Adding a New Subgraph

1. Create directory under `subgraphs/`
2. Choose multi-network pattern (template or shared code)
3. Add schema, manifest(s), and handler source files
4. Place ABIs in root `abis/` directory
5. Add `codegen-*` and `build-*` scripts to root `package.json`
6. Register in `scripts/deploy-studio.js` for interactive deployment

## Conventions

- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **Branch names**: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`
- **Testing**: Matchstick framework, tests in `subgraphs/<name>/tests/`, use `clearStore()` in `afterEach`
- **Dependencies**: `@graphprotocol/graph-cli` ^0.97.0, `@graphprotocol/graph-ts` ^0.38.0, `matchstick-as` 0.5.0
- **Node.js** >= 18, **Yarn** v1
