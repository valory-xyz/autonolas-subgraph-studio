# common

Shared schema, utilities, and constants used by all payment model handlers.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | Architecture decisions, raw unit semantics, NVM credit formulas | Understanding why raw units differ across models, credit-to-USD conversion logic |
| `schema.graphql` | Entity definitions (Mech, MechModel, MechTransaction, DailyTotals, MechDaily, Global) | Adding fields, creating new entities, understanding data model |
| `utils.ts` | Entity helpers, USD conversion functions, daily aggregation logic | Modifying fee calculations, adding new conversion functions, fixing aggregation bugs |
| `constants.ts` | NVM token ratios and decimal configurations per network | Adjusting credit conversion constants, adding new network support |
| `token-utils.ts` | Balancer V2 pool price calculation for OLAS→USD | Debugging OLAS price fetching, modifying pool query logic |

## Directories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `generated/` | Auto-generated TypeScript bindings from ABIs and schema | Understanding available contract methods, entity field types |
