# Autonolas Subgraphs Monorepo

This repository contains multiple subgraphs for [The Graph](https://thegraph.com), primarily indexing contracts related to the Autonolas ecosystem.

## Getting Started

- Prerequisites: `yarn global add @graphprotocol/graph-cli`
- Install dependencies by running `yarn install`

## Monorepo Architecture

This repository is a monorepo that houses multiple subgraph projects. The goal is to maintain a centralized, organized, and consistent structure for all subgraphs related to the Autonolas ecosystem which are hosted on platforms like The Graph Studio or Alchemy.

### Key Directories

-   `abis/`: A central directory for all contract ABI JSON files. ABIs stored here are shared and can be referenced by any subgraph.
-   `scripts/`: Contains utility scripts such as `generate-manifests.js` for generating network-specific manifests from templates.
-   `subgraphs/`: The main directory containing all the individual subgraph projects. Each subdirectory represents a different subgraph category (e.g., `tokenomics-eth`, `tokenomics-l2`, `service-registry`, `staking`, `liquidity`, `liquidity-l2`).

### Multi-Network Subgraph Patterns

We use two primary patterns for managing subgraphs that are deployed across multiple networks.

#### 1. Template (`subgraph.template.yaml`) Pattern

This is the **preferred pattern for new multi-network subgraphs**, especially when they involve complex configurations or many networks.

-   **Structure**: A `subgraph.template.yaml` file serves as a base template. A `networks.json` file contains a list of networks with their specific contract addresses and start blocks.
-   **Generation**: A script (e.g., `scripts/generate-manifests.js`) consumes the template and the `networks.json` file to generate the final `subgraph.<network>.yaml` manifest for each network.
-   **Example**: `staking`.

#### 2. Per-Network Manifests Pattern

Used when networks have structural differences (e.g., different numbers of data sources, different ABIs) that prevent a single template.

-   **Structure**: Shared `src/` directory with consolidated mapping files. Per-network `subgraph.<network>.yaml` manifests at the root of the subgraph directory.
-   **Runtime dispatch**: Mapping files use `dataSource.network()` to branch logic per network.
-   **Example**: `new-mech-fees` (Gnosis/Base have 3 data sources, Polygon/Optimism have 4).

## Adding a New Subgraph

Here is a step-by-step guide to adding a new subgraph to this repository.

### Step 1: Create the Subgraph Directory

1.  Create a new directory under `subgraphs/` for your project (e.g., `subgraphs/my-new-subgraph/`).
2.  If it's a multi-network subgraph, **consider using the Template Pattern as described above.** Otherwise, follow the Shared Code (`common/`) Pattern by creating a `common/` directory for your shared logic and separate directories for each network (e.g., `my-new-subgraph-mainnet/`).
3.  Add your `schema.graphql`, `subgraph.yaml` (or `subgraph.template.yaml` if using the template pattern), and `src/mapping.ts` files as you normally would.

### Step 2: Add ABIs

Place the JSON ABI files for all required smart contracts into the root `/abis` directory. This ensures they can be easily referenced by your subgraph and other projects.

### Step 3: Add a `package.json`

Each subgraph (or network-specific subdirectory) must have its own `package.json` with `codegen`, `build`, and `test` scripts.

**Single-network subgraph example:**
```json
{
  "name": "my-new-subgraph",
  "scripts": {
    "codegen": "graph codegen subgraph.yaml",
    "build": "graph build subgraph.yaml",
    "test": "graph test"
  },
  "dependencies": {
    "@graphprotocol/graph-cli": "^0.97.0",
    "@graphprotocol/graph-ts": "^0.38.0"
  },
  "devDependencies": {
    "matchstick-as": "0.5.0"
  }
}
```

**Per-network manifests pattern example:**
```json
{
  "name": "my-new-subgraph",
  "scripts": {
    "codegen": "graph codegen subgraph.polygon.yaml",
    "build": "graph build subgraph.polygon.yaml",
    "build:gnosis": "graph build subgraph.gnosis.yaml",
    "build:polygon": "graph build subgraph.polygon.yaml",
    "test": "graph test"
  },
  "dependencies": {
    "@graphprotocol/graph-cli": "^0.97.0",
    "@graphprotocol/graph-ts": "^0.38.0"
  },
  "devDependencies": {
    "matchstick-as": "0.5.0"
  }
}
```

### Step 4: Add a README.md

Create a `README.md` file inside your subgraph's main directory (e.g., `subgraphs/my-new-subgraph/README.md`). Please follow the structure of the existing READMEs (`service-registry/README.md`, `tokenomics/README.md`) to ensure consistency.

Your README should include:
-   A brief overview.
-   The architecture of your subgraph.
-   A list of indexed contracts.
-   A description of the core entities in your schema.
-   A list of supported networks.
-   GraphQL query examples.

## Development Workflow

Each subgraph is self-contained with its own `package.json`. Navigate to the subgraph directory and run commands locally:

```bash
cd subgraphs/<subgraph-name>           # Navigate to the subgraph directory
yarn install                           # Install dependencies
yarn codegen                           # Generate TS types from schema + ABIs
yarn build                             # Build subgraph (compiles to WASM)
yarn test                              # Run Matchstick tests
```

## Deployment

Deployment is handled via CI/CD. Each subgraph is built and deployed from its own directory automatically.
