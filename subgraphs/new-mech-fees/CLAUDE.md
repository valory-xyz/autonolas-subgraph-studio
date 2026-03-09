# New Mech Fees Subgraph

Tracks fees for autonomous agents (mechs) interacting with the new marketplace contracts. Indexes every fee-in (accrual via `MechBalanceAdjusted`) and fee-out (collection via `Withdraw`) event across multiple payment models and networks.

## Architecture Overview

### Directory Structure
```
subgraphs/new-mech-fees/
├── schema.graphql                    # Shared schema (all networks)
├── subgraph.gnosis.yaml              # Gnosis manifest (3 data sources)
├── subgraph.base.yaml                # Base manifest (3 data sources)
├── subgraph.polygon.yaml             # Polygon manifest (4 data sources)
├── subgraph.optimism.yaml            # Optimism manifest (4 data sources)
├── src/
│   ├── native-mapping.ts             # Native payment model (xDAI/ETH/POL)
│   ├── nvm-mapping.ts                # NVM subscription model (credits)
│   ├── token-olas-mapping.ts         # Token OLAS payment model
│   ├── token-usdc-mapping.ts         # Token USDC payment model (Polygon/Optimism only)
│   ├── utils.ts                      # Shared helpers, entity management, USD conversion
│   ├── token-utils.ts                # Balancer V2 pool OLAS price calculation
│   └── constants.ts                  # NVM token ratios, decimal configs
└── package.json                      # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Multi-Network Pattern
Per-network manifests with shared `src/` and `schema.graphql`. Each manifest defines data sources for the payment models available on that network. Network detection at runtime via `dataSource.network()`.

### Networks & Contracts

**Gnosis (xdai)** — 3 data sources:

| Payment Model | Contract | Start Block |
|---------------|----------|-------------|
| Native (xDAI) | `0x21cE6799A22A3Da84B7c44a814a9c79ab1d2A50D` | 38,662,107 |
| NVM | `0x7D686bD1fD3CFF6E45a40165154D61043af7D67c` | 38,662,005 |
| Token OLAS | `0x53Bd432516707a5212A70216284a99A563aAC1D1` | 38,662,275 |

**Base** — 3 data sources:

| Payment Model | Contract | Start Block |
|---------------|----------|-------------|
| Native (ETH) | `0xB3921F8D8215603f0Bd521341Ac45eA8f2d274c1` | 26,642,932 |
| NVM | `0xaafbeef195bdab1bb6f3dc9ceba875cd72499230` | 27,585,236 |
| Token OLAS | `0x43fB32f25dce34EB76c78C7A42C8F40F84BCD237` | 26,643,048 |

**Polygon (matic)** — 4 data sources:

| Payment Model | Contract | Start Block |
|---------------|----------|-------------|
| Native (POL) | `0xc096362fa6f4A4B1a9ea68b1043416f3381ce300` | 81,028,655 |
| NVM | `0xd00Cb760Bf30183EAFE67f0E590BEeE190F35Cf3` | 81,724,578 |
| Token OLAS | `0x1521918961bDBC9Ed4C67a7103D5999e4130E6CB` | 81,028,765 |
| Token USDC | `0x5C50ebc17d002A4484585C8fbf62f51953493c0B` | 81,888,996 |

**Optimism** — 4 data sources:

| Payment Model | Contract | Start Block |
|---------------|----------|-------------|
| Native (ETH) | `0x4Cd816ce806FF1003ee459158A093F02AbF042a8` | 145,788,503 |
| NVM | `0x1a0bFCC27051BCcDDc444578f56A4F5920e0E083` | 146,485,258 |
| Token OLAS | `0x70A0D93fb0dB6EAab871AB0A3BE279DcA37a2bcf` | 145,788,564 |
| Token USDC | `0xA123748Ce7609F507060F947b70298D0bde621E6` | 145,788,564 |

### Burn Addresses (per network, from `shared/constants.ts`)
Withdraw events to burn addresses are skipped (protocol fee burn, not mech earnings):
- Gnosis: `0x153196110040a0c729227c603db3a6c6d91851b2`
- Base: `0x3FD8C757dE190bcc82cF69Df3Cd9Ab15bCec1426`
- Polygon: `0x88943F63E29cd436B62cFfE332aD54De92AdCE98`
- Optimism: `0x4891f5894634DcD6d11644fe8E56756EF2681582`

---

## Schema Reference

**Note**: This subgraph uses `BigDecimal` for all financial fields (unlike most other subgraphs in the monorepo that use `BigInt`).

### Global (mutable)
Singleton aggregate (id: `""`). Tracks total USD fees across all mechs.

| Field | Type | Notes |
|-------|------|-------|
| totalFeesInUSD | `BigDecimal!` | Cumulative fee-in USD |
| totalFeesOutUSD | `BigDecimal!` | Cumulative fee-out USD |

### Mech (mutable)
Per-mech lifetime totals. ID is the mech address.

| Field | Type | Notes |
|-------|------|-------|
| totalFeesInUSD | `BigDecimal!` | Cumulative fee-in USD |
| totalFeesOutUSD | `BigDecimal!` | Cumulative fee-out USD |
| totalFeesInRaw | `BigDecimal!` | Cumulative fee-in in raw units (mixed if multi-model) |
| totalFeesOutRaw | `BigDecimal!` | Cumulative fee-out in raw units (mixed if multi-model) |

### MechModel (mutable)
Per-mech, per-payment-model aggregates. Provides model-isolated raw unit totals.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `${mechAddress}-${model}` |
| mech | `Mech!` | Parent mech |
| model | `String!` | `native`, `nvm`, `token-olas`, or `token-usdc` |
| totalFeesInUSD | `BigDecimal!` | |
| totalFeesOutUSD | `BigDecimal!` | |
| totalFeesInRaw | `BigDecimal!` | Model-specific raw units |
| totalFeesOutRaw | `BigDecimal!` | Model-specific raw units |

### MechTransaction (immutable)
Individual fee event record.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `${txHash}-${logIndex}` |
| mech | `Mech!` | |
| type | `String!` | `FEE_IN` or `FEE_OUT` |
| model | `String!` | Payment model |
| amountRaw | `BigDecimal!` | Model-specific raw units |
| amountUSD | `BigDecimal!` | USD equivalent |
| timestamp | `BigInt!` | |
| blockNumber | `BigInt!` | |
| txHash | `Bytes!` | |
| deliveryRate | `BigInt` | Nullable — only on FEE_IN |
| balance | `BigInt` | Nullable — only on FEE_IN |
| rateDiff | `BigInt` | Nullable — only on FEE_IN |

### DailyTotals (mutable)
Global per-day USD totals.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Unix start-of-day (UTC) as string, e.g. `"1710460800"` |
| date | `Int!` | Same value as id, as integer |
| totalFeesInUSD | `BigDecimal!` | |
| totalFeesOutUSD | `BigDecimal!` | |

### MechDaily (mutable)
Per-mech, per-day totals.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `${mechAddress}-${dayStart}` |
| mech | `Mech!` | |
| date | `Int!` | Unix start-of-day (UTC) |
| feesInUSD | `BigDecimal!` | |
| feesOutUSD | `BigDecimal!` | |
| feesInRaw | `BigDecimal!` | Mixed raw units if multi-model |
| feesOutRaw | `BigDecimal!` | Mixed raw units if multi-model |

---

## Event Handlers

All payment models follow the same two-event pattern:

| Event | Type | Handler creates |
|-------|------|----------------|
| `MechBalanceAdjusted(indexed address, uint256, uint256, uint256)` | FEE_IN | MechTransaction, updates Mech/MechModel/Global/DailyTotals/MechDaily |
| `Withdraw(indexed address, indexed address, uint256)` | FEE_OUT | MechTransaction, updates Mech/MechModel/Global/DailyTotals/MechDaily |

### Per-Model Mapping Files

**`native-mapping.ts`** (model: `"native"`):
- FEE_IN: `amountRaw` = `deliveryRate` in wei; USD via `convertGnosisNativeWeiToUsd()` (Gnosis: xDAI=USD) or Chainlink price feed (Base/Polygon/Optimism)
- FEE_OUT: Same USD conversion logic; skips burn address

**`nvm-mapping.ts`** (model: `"nvm"`):
- FEE_IN: `amountRaw` = `deliveryRate` in credits; USD via network-specific NVM formula (`credits * tokenRatio / (1e18 * 10^tokenDecimals)`)
- FEE_OUT: Converts token withdrawal back to equivalent credits for raw units; USD via `convertGnosisNativeWeiToUsd()` (Gnosis) or `convertBaseUsdcToUsd()` (others)

**`token-olas-mapping.ts`** (model: `"token-olas"`):
- FEE_IN/OUT: `amountRaw` = OLAS wei; USD via `calculateOlasInUsd()` using Balancer V2 pool price
- On Polygon/Optimism: additional Chainlink conversion (pool gives intermediate native token value)

**`token-usdc-mapping.ts`** (model: `"token-usdc"`, Polygon/Optimism only):
- FEE_IN/OUT: `amountRaw` = USDC units; USD via `convertBaseUsdcToUsd()` (1 USDC = 1 USD)
- Zero-amount guard: returns early if conversion yields 0

### Handler Flow (all models)
1. Extract mech ID and amount from event
2. Convert to USD using model-specific logic
3. Update entities: `Global` → `Mech` → `MechModel` → `DailyTotals` → `MechDaily`
4. Create immutable `MechTransaction`
5. For Withdraw: skip if recipient is burn address

---

## USD Conversion Strategies

| Model | Network | Method | Details |
|-------|---------|--------|---------|
| Native | Gnosis | Direct | xDAI ≈ USD, divide by 1e18 |
| Native | Base/Optimism | Chainlink | ETH/USD price feed |
| Native | Polygon | Chainlink | POL/USD price feed |
| NVM | Gnosis | Formula | `credits * 990...e30 / (1e18 * 1e18)` |
| NVM | Base/Polygon/Optimism | Formula | `credits * 990...e18 / (1e18 * 1e6)` |
| Token OLAS | Gnosis/Base | Balancer V2 | `OLAS/stablecoin` pool price |
| Token OLAS | Polygon/Optimism | Balancer + Chainlink | Pool gives native value, then Chainlink to USD |
| Token USDC | All | Direct | 1 USDC = 1 USD, divide by 1e6 |

### OLAS Price Calculation (`token-utils.ts`)
Uses Balancer V2 Vault `getPoolTokens()` to get OLAS and stablecoin balances from the pool, then: `olasPrice = stablecoinBalance / olasBalance`. Network-specific pool/token addresses from `shared/constants.ts`.

### NVM Credit Consistency
- FEE_IN stores `deliveryRate` directly as credits
- FEE_OUT converts token withdrawals back to equivalent credits using inverse formula
- `totalFeesInRaw - totalFeesOutRaw` gives meaningful net credit balance within NVM model

---

## Raw Units

**Raw units are NOT comparable across different payment models.** Use USD fields for cross-model analysis.

| Model | Raw Unit |
|-------|----------|
| Native (Gnosis) | xDAI wei |
| Native (Base/Optimism) | ETH wei |
| Native (Polygon) | POL wei |
| NVM | Credits (abstract units from `deliveryRate`) |
| Token OLAS | OLAS wei |
| Token USDC | USDC (6 decimals) |

`Mech.totalFeesInRaw` aggregates across all models — use `MechModel` for correct per-model raw totals.

---

## Utility Functions

### `utils.ts`

| Function | Purpose |
|----------|---------|
| `getOrInitialiseGlobal()` | Singleton Global (id: `""`) |
| `getOrInitializeMech(mechId)` | Load-or-create Mech |
| `getOrInitializeMechModel(mechId, model)` | Load-or-create MechModel (id: `${mech}-${model}`) |
| `updateMechFeesIn/Out(mechId, usd, raw)` | Update Mech totals |
| `updateMechModelIn/Out(mechId, model, usd, raw)` | Update MechModel totals |
| `updateTotalFeesIn/Out(amount)` | Update Global totals |
| `createMechTransactionForAccrued(...)` | Create FEE_IN transaction |
| `createMechTransactionForCollected(...)` | Create FEE_OUT transaction |
| `updateDailyTotalsIn/Out(usd, timestamp)` | Update DailyTotals |
| `updateMechDailyIn/Out(mechId, usd, raw, timestamp)` | Update MechDaily |
| `convertGnosisNativeWeiToUsd(wei)` | xDAI wei → USD (divide by 1e18) |
| `convertNativeWeiToUsd(wei, price)` | Native wei + Chainlink price → USD |
| `calculateGnosisNvmFeesIn(deliveryRate)` | Credits → USD (Gnosis NVM formula) |
| `calculateBaseNvmFeesIn(deliveryRate)` | Credits → USD (Base NVM formula) |
| `calculatePolygonNvmFeesIn(deliveryRate)` | Credits → USD (Polygon NVM formula) |
| `calculateOptimismNvmFeesIn(deliveryRate)` | Credits → USD (Optimism NVM formula) |
| `convertBaseUsdcToUsd(usdc)` | USDC → USD (divide by 1e6) |

### `token-utils.ts`

| Function | Purpose |
|----------|---------|
| `calculateOlasInUsd(vault, poolId, olas, stable, decimals, amount)` | OLAS → USD via Balancer V2 pool price |

### `constants.ts`
NVM token ratios and decimal configs per network. Chainlink/ETH decimals.

### `shared/constants.ts`
Network-specific addresses (burn, Balancer, OLAS, stablecoin, Chainlink) with `dataSource.network()` selector functions.

---

## Configuration

### Events per Data Source

| Data Source | ABI | Events |
|-------------|-----|--------|
| BalanceTrackerFixedPriceNative | BalanceTrackerFixedPriceNative + AggregatorV3Interface | `MechBalanceAdjusted`, `Withdraw` |
| BalanceTrackerNvmSubscription | BalanceTrackerNvmSubscription | `MechBalanceAdjusted`, `Withdraw` |
| BalanceTrackerFixedPriceTokenOLAS | BalanceTrackerFixedPriceToken + BalancerV2 + AggregatorV3 | `MechBalanceAdjusted`, `Withdraw` |
| BalanceTrackerFixedPriceTokenUSDC | BalanceTrackerFixedPriceToken | `MechBalanceAdjusted`, `Withdraw` |

**Spec**: v0.0.5 | **API**: 0.0.7

### Build Commands
```bash
yarn build:gnosis     # graph build subgraph.gnosis.yaml
yarn build:base       # graph build subgraph.base.yaml
yarn build:polygon    # graph build subgraph.polygon.yaml
yarn build:optimism   # graph build subgraph.optimism.yaml
```

---

## Implementation Notes

- `Withdraw` event = mech claimed payments. Since protocol fees are currently off, claimed payments = realized mech earnings
- All financial fields use `BigDecimal` (exception to monorepo convention of `BigInt`)
- Daily aggregation skips zero/negative USD amounts
- Day timestamp: `(timestamp / 86400) * 86400` (integer division, UTC midnight)
- No tests currently exist for this subgraph
- `DailyTotals` list field in GraphQL is `dailyTotals_collection` (Graph Node naming for `Int` id types)
