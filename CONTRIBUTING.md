# Contributing to `autonolas-subgraph-studio`

First off, thank you for taking the time to contribute! This document describes how to propose changes, report issues,
and participate in the development of this repository.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Repository Structure](#repository-structure)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Security & Responsible Disclosure](#security--responsible-disclosure)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Build](#build)
  - [Test](#test)
- [Subgraph Development Guide](#subgraph-development-guide)
  - [Multi-Network Patterns](#multi-network-patterns)
  - [Adding a New Subgraph](#adding-a-new-subgraph)
  - [Adding a New ABI](#adding-a-new-abi)
- [Testing Guidelines](#testing-guidelines)
- [Commit Messages & Branching](#commit-messages--branching)
- [Deployment](#deployment)
- [License](#license)
- [Contact](#contact)

---

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to **security@valory.xyz**.

---

## Repository Structure

This is a monorepo of [The Graph](https://thegraph.com/) subgraphs for the Autonolas/Olas ecosystem, hosted on The Graph Studio and Alchemy. Each subgraph indexes on-chain events from Olas smart contracts across multiple EVM networks.

```
abis/                    # Shared ABI files referenced by all subgraphs
scripts/
  deploy-studio.js       # Interactive deployment script
  generate-manifests.js  # Generates network manifests from templates
shared/
  constants.ts           # Shared constants across subgraphs
subgraphs/
  babydegen/             # Baby Degen (Optimism)
  governance/            # Governance
  legacy-mech-fees/      # Legacy mech fee tracking
  liquidity/             # Liquidity tracking
  new-mech-fees/         # Mech fee tracking (Gnosis, Base, Polygon, Optimism)
  predict/               # Prediction market tracking
  service-registry/      # Service registry (multi-network, template pattern)
  staking/               # Staking contracts (multi-network, template pattern)
  tokenomics/            # Tokenomics (multi-network, shared code pattern)
```

Unlike the self-hosted `autonolas-subgraph` repo, this repo uses a **root-level `package.json`** with all codegen/build scripts.

---

## How Can I Contribute?

### Reporting Bugs

1. **Search existing issues** to avoid duplicates.
2. **Open a new issue** with a clear title and description.
3. Include the affected subgraph, network, and any relevant entity IDs or transaction hashes.

### Suggesting Enhancements

- Explain the motivation and expected impact.
- Specify which subgraph(s) and network(s) are affected.
- Consider compatibility with existing indexed data and entity schemas.

### Security & Responsible Disclosure

**Do not** open public GitHub issues for security vulnerabilities. Instead:

- Email **security@valory.xyz** with a detailed report.
- Include the affected subgraph, potential impact, and steps to reproduce.

We aim to acknowledge receipt within 72 hours.

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added or changed handler logic, add tests.
3. Ensure the subgraph builds for all affected networks and tests pass.
4. Open a PR with a clear description of the change and reasoning.

**PR Checklist:**

- [ ] Self-reviewed, no debug logs or dead code.
- [ ] Build passes for all affected network manifests.
- [ ] `yarn test` passes (if Matchstick tests exist for the subgraph).
- [ ] Schema changes are backward-compatible or migration is documented.
- [ ] New ABIs added to root `abis/` directory and referenced in manifests.
- [ ] Deployment script (`scripts/deploy-studio.js`) updated if adding new subgraphs or networks.
- [ ] Root `package.json` updated with codegen/build scripts for new subgraphs or networks.

---

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **Yarn** (v1)
- **Graph CLI**: `yarn global add @graphprotocol/graph-cli` (or installed via root dependencies)

### Install

```bash
git clone https://github.com/valory-xyz/autonolas-subgraph-studio.git
cd autonolas-subgraph-studio

# Install dependencies (from repo root)
yarn install
```

### Build

All codegen and build commands are run from the **repo root** via `package.json` scripts:

```bash
# Codegen (generates TypeScript types from schema and ABIs)
yarn codegen-tokenomics-l2
yarn codegen-new-mech-fees-gnosis

# Build (runs codegen then compiles to WASM)
yarn build-tokenomics:ethereum
yarn build-new-mech-fees:gnosis
yarn build-babydegen-optimism
```

For subgraphs using the **template pattern** (staking, service-registry), generate manifests first:

```bash
node scripts/generate-manifests.js
```

### Test

```bash
# Run all tests
yarn test

# Run tests for a specific subgraph
graph test subgraphs/staking/tests/staking.test.ts
```

---

## Subgraph Development Guide

### Multi-Network Patterns

This repo uses two patterns for multi-network subgraphs:

#### 1. Template Pattern (preferred for new subgraphs)

Used by: `staking`, `service-registry`

- `subgraph.template.yaml` serves as the base manifest template.
- `networks.json` contains per-network contract addresses and start blocks.
- `scripts/generate-manifests.js` generates `subgraph.<network>.yaml` files from the template.

```
subgraphs/staking/
  subgraph.template.yaml    # Base template
  networks.json             # Network-specific addresses/blocks
  subgraph.gnosis.yaml      # Generated manifest
  subgraph.base.yaml        # Generated manifest
  src/                      # Shared handlers
  schema.graphql            # Shared schema
```

#### 2. Shared Code Pattern

Used by: `tokenomics`

- A `common/` directory holds shared schema, mappers, and utilities.
- Each network has its own subdirectory with a network-specific manifest.

```
subgraphs/tokenomics/
  common/                        # Shared schema, mappers, generated types
  tokenomics-eth/subgraph.yaml   # Ethereum L1 manifest
  tokenomics-base/subgraph.base.yaml
  tokenomics-gnosis/subgraph.gnosis.yaml
```

### Adding a New Subgraph

1. Create a directory under `subgraphs/` (e.g., `subgraphs/my-subgraph/`).
2. Choose a multi-network pattern (template or shared code) if targeting multiple networks.
3. Add your `schema.graphql`, manifest(s), and handler source files.
4. Place ABI files in the root `abis/` directory.
5. Add `codegen-*` and `build-*` scripts to the root `package.json`.
6. Register the subgraph in `scripts/deploy-studio.js` for interactive deployment.
7. Add a `README.md` inside your subgraph directory.

### Adding a New ABI

1. Place the ABI JSON file in the root `abis/` directory.
2. Reference it in your subgraph manifest's `abis` section using a relative path (e.g., `../../../abis/MyContract.json`).
3. Run the codegen script for your subgraph to generate TypeScript types.

---

## Testing Guidelines

Tests use the [Matchstick](https://thegraph.com/docs/en/developing/unit-testing-framework/) framework (AssemblyScript-based).

- Place test files in your subgraph's `tests/` directory with `.test.ts` extension.
- Use `clearStore()` in `afterEach` to reset entity state between tests.
- Use `dataSourceMock.setNetwork()` to set the network context.
- Use `createMockedFunction()` to mock on-chain contract calls.
- Assert entity state with `assert.fieldEquals()` and `assert.entityCount()`.

---

## Commit Messages & Branching

- Use **Conventional Commits**:
  - `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
- Branch names:
  - `feat/<short-topic>`, `fix/<short-topic>`, `docs/<short-topic>`
- Reference issues/PRs in the body (e.g., `Closes #123`).

---

## Deployment

Subgraphs are deployed to **The Graph Studio** or **Alchemy** using the interactive deployment script:

```bash
# Authenticate with The Graph Studio
graph auth --studio [DEPLOY_KEY]

# Interactive deployment
yarn deploy-studio
```

The script will prompt you to select a subgraph, network, and version, then build and deploy.

Manual deployment steps:

1. Run the codegen script for your subgraph.
2. Run the build script for the target network.
3. Deploy: `graph deploy --studio <subgraph-name>`

---

## License

This project is licensed under the **Apache License 2.0**. See `LICENSE`.

---

## Contact

- General questions: **info@valory.xyz**
- Security: **security@valory.xyz**

Thank you for contributing!
