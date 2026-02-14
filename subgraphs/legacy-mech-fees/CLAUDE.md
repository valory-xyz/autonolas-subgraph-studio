# legacy-mech-fees/

Gnosis Chain subgraph tracking fee flows for legacy mechs (LM) and marketplace mechs (LMM).

## Files

| File | What | When to read |
| --- | --- | --- |
| `README.md` | Architecture, entities, sample queries, data flow | Understanding subgraph design, writing queries, debugging fee calculations |
| `schema.graphql` | Entity definitions (LegacyMech, LegacyMechMarketPlace, Global, DailyFees, MechDaily) | Adding/modifying entities, understanding data model |
| `subgraph.yaml` | Data sources, factory contracts, event/call handlers, templates | Adding contracts, modifying event handlers, debugging indexing |
| `package.json` | Build scripts (codegen, build, test) | Running builds, adding dependencies |
| `tsconfig.json` | TypeScript configuration | Modifying TypeScript settings |

## Subdirectories

| Directory | What | When to read |
| --- | --- | --- |
| `src/` | Mapping handlers, utilities, known edge cases | Modifying fee tracking logic, debugging data gaps |

## Commands

```bash
# Generate types from schema and ABIs
yarn codegen

# Build the subgraph
yarn build

# Run tests
yarn test
```
