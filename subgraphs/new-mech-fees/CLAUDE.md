# new-mech-fees

Subgraph indexing mech fee transactions across three payment models (native, NVM, token) on Gnosis and Base networks.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | Architecture, raw unit semantics, sample queries | Understanding payment models, querying data, validating against Dune |

## Directories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `common/` | Shared schema, utilities, constants | Modifying entity structure, adding conversion functions, understanding USD calculations |
| `mech-fees-base/` | Base network composite subgraph config | Deploying to Base, adding data sources |
| `mech-fees-gnosis/` | Gnosis network composite subgraph config | Deploying to Gnosis, adding data sources |
| `new-native-mech-fees-base/` | Native payment model handlers for Base | Debugging Base native fee indexing, modifying ETH price conversion |
| `new-native-mech-fees-gnosis/` | Native payment model handlers for Gnosis | Debugging Gnosis native fee indexing (xDAI ≈ USD) |
| `new-nvm-mech-fees-base/` | NVM subscription handlers for Base | Debugging Base NVM indexing, modifying USDC credit conversion |
| `new-nvm-mech-fees-gnosis/` | NVM subscription handlers for Gnosis | Debugging Gnosis NVM indexing, modifying xDAI credit conversion |
| `new-token-mech-fees-base/` | OLAS token handlers for Base | Debugging Base OLAS indexing, modifying Balancer pool price fetch |
| `new-token-mech-fees-gnosis/` | OLAS token handlers for Gnosis | Debugging Gnosis OLAS indexing, modifying Balancer pool price fetch |
