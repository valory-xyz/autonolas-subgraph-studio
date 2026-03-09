# Legacy Mech Fees Gnosis Subgraph

Tracks fee accrual (in) and collection (out) for legacy autonomous agent mechs on Gnosis Chain. Covers both direct mech interactions and marketplace-mediated transactions.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Business Rules](#business-rules)
- [Constants](#constants)
- [Configuration (subgraph.yaml)](#configuration)

---

## Architecture Overview

### Directory Structure
```
subgraphs/legacy-mech-fees/
├── schema.graphql
├── subgraph.yaml
├── src/
│   ├── mapping.ts       # All event/call handlers
│   ├── utils.ts         # Global, DailyFees, MechDaily helpers
│   └── constants.ts     # Burn address
└── package.json         # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Two Mech Types
- **Legacy Mech (LM)**: Direct user-to-mech interactions. Created by LM factories.
- **Legacy Market-Maker Mech (LMM)**: Marketplace-mediated interactions. Created by LMM factories, fee-in tracked via `MarketplaceRequest` on the marketplace contract.

### Key Contracts (Gnosis Chain)

| Contract | Address | Start Block |
|----------|---------|-------------|
| LM Factory 1 | `0x88de734655184a09b70700ae4f72364d1ad23728` | 27,911,512 |
| LM Factory 2 | `0x4be7a91e67be963806fefa9c1fd6c53dfc358d94` | 30,662,989 |
| LMM Factory 1 | `0x2acd313b892c9922e470e4950e907d5eaa70fc2a` | 35,714,019 |
| LMM Factory 2 | `0x6d8cbebcad7397c63347d44448147db05e7d17b0` | 36,582,492 |
| LMM Factory 3 | `0x25c980328762a03f70c2649ef4be691b811b690a` | 36,582,492 |
| Legacy Marketplace | `0x4554fE75c1f5576c1d7F765B2A036c199Adae329` | 35,714,019 |

---

## Schema Reference

### LegacyMech
Individual standard legacy mech with lifetime fee totals.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Mech contract address |
| agentId | `Int!` | Agent ID from factory |
| price | `BigInt!` | Current mech price (updated via `PriceUpdated`) |
| totalFeesIn | `BigInt!` | Cumulative fees received (from `Request` events) |
| totalFeesOut | `BigInt!` | Cumulative fees distributed (from `exec` calls, excluding burns) |

### LegacyMechMarketPlace
Marketplace-based mech. Same structure as `LegacyMech`.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Mech contract address |
| agentId | `Int!` | Agent ID from factory |
| price | `BigInt!` | Current mech price |
| totalFeesIn | `BigInt!` | Cumulative fees received (from `MarketplaceRequest`) |
| totalFeesOut | `BigInt!` | Cumulative fees distributed (from `exec` calls, excluding burns) |

### Global
Singleton aggregate statistics (id: `""`).

| Field | Type | Notes |
|-------|------|-------|
| totalFeesIn | `BigInt!` | Combined total across both mech types |
| totalFeesOut | `BigInt!` | Combined total across both mech types |
| totalFeesInLegacyMech | `BigInt!` | LM-only incoming fees |
| totalFeesInLegacyMechMarketPlace | `BigInt!` | LMM-only incoming fees |
| totalFeesOutLegacyMech | `BigInt!` | LM-only outgoing fees |
| totalFeesOutLegacyMechMarketPlace | `BigInt!` | LMM-only outgoing fees |

### DailyFees
Daily fee aggregation across all mechs. ID = UTC midnight timestamp as string.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `dayTimestamp * 86400` as string |
| date | `Int!` | UTC midnight timestamp |
| totalFeesInLegacyMech | `BigInt!` | Daily LM incoming fees |
| totalFeesInLegacyMechMarketPlace | `BigInt!` | Daily LMM incoming fees |
| totalFeesOutLegacyMech | `BigInt!` | Daily LM outgoing fees |
| totalFeesOutLegacyMechMarketPlace | `BigInt!` | Daily LMM outgoing fees |

### MechDaily
Per-mech daily fee aggregation. ID = `{mechAddress}-{dayTimestamp}`.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{mechAddress}-{dayTimestamp * 86400}` |
| mech | `Bytes!` | Mech contract address |
| agentId | `Int!` | Agent ID |
| date | `Int!` | UTC midnight timestamp |
| feesInLegacyMech | `BigInt!` | Daily LM incoming fees for this mech |
| feesOutLegacyMech | `BigInt!` | Daily LM outgoing fees for this mech |
| feesInLegacyMechMarketPlace | `BigInt!` | Daily LMM incoming fees for this mech |
| feesOutLegacyMechMarketPlace | `BigInt!` | Daily LMM outgoing fees for this mech |

---

## Event Handlers

All handlers are in `src/mapping.ts`.

### 1. handleCreateMechLM
**Event**: `CreateMech(indexed address, indexed uint256, indexed uint256)` on LM Factory 1 & 2

- Creates `LegacyMech` entity with zero fee totals
- Stores `agentId` and initial `price` from event params
- Instantiates `LegacyMech` dynamic template for the new mech address
- Skips if mech already exists (idempotent)

### 2. handleCreateMechLMM
**Event**: `CreateMech(indexed address, indexed uint256, indexed uint256)` on LMM Factory 1, 2, & 3

- Same pattern as `handleCreateMechLM` but creates `LegacyMechMarketPlace` entity
- Instantiates `LegacyMechMarketPlace` dynamic template

### 3. handleRequest (Fee In — LM)
**Event**: `Request(indexed address, uint256, bytes)` on LegacyMech template

- Loads `LegacyMech` entity; warns and returns if unknown mech
- Fee amount = mech's current `price`
- Updates: mech `totalFeesIn`, Global LM fees in, DailyFees LM in, MechDaily LM in

### 4. handleMarketplaceRequest (Fee In — LMM)
**Event**: `MarketplaceRequest(indexed address, indexed address, uint256, bytes)` on LegacyMarketPlace

- Reads mech price via `getMechPrice()` — tries LMM contract first, falls back to LM contract
- Skips if price <= 0
- Updates: mech `totalFeesIn` (if mech exists), Global LMM fees in, DailyFees LMM in, MechDaily LMM in
- Note: Global and DailyFees are updated even if mech entity is not found (logs warning)

### 5. handleExecLM (Fee Out — LM)
**Call handler**: `exec(address, uint256, bytes, uint8, uint256)` on LegacyMech template

- **Filters out**: transfers to burn address and zero-amount transfers
- Uses `call.inputs.to` (destination) and `call.inputs.value` (amount)
- Updates: mech `totalFeesOut`, Global LM fees out, DailyFees LM out, MechDaily LM out

### 6. handleExecLMM (Fee Out — LMM)
**Call handler**: `exec(address, uint256, bytes, uint8, uint256)` on LegacyMechMarketPlace template

- Same pattern as `handleExecLM` but for `LegacyMechMarketPlace` entities

### 7. handlePriceUpdateLM / handlePriceUpdateLMM
**Event**: `PriceUpdated(uint256)` on respective templates

- Updates the `price` field on the mech entity
- No fee calculations — just price tracking

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `getOrCreateGlobal()` | Returns singleton Global entity (creates with zeros if null) |
| `updateGlobalFeesInLegacyMech(amount)` | Adds to `totalFeesIn` + `totalFeesInLegacyMech` |
| `updateGlobalFeesInLegacyMechMarketPlace(amount)` | Adds to `totalFeesIn` + `totalFeesInLegacyMechMarketPlace` |
| `updateGlobalFeesOutLegacyMech(amount)` | Adds to `totalFeesOut` + `totalFeesOutLegacyMech` |
| `updateGlobalFeesOutLegacyMechMarketPlace(amount)` | Adds to `totalFeesOut` + `totalFeesOutLegacyMechMarketPlace` |
| `getOrCreateDailyFees(timestamp)` | Get-or-create daily fees entity for UTC day |
| `getOrCreateMechDaily(mechAddress, agentId, timestamp)` | Get-or-create per-mech daily entity |
| `updateMechDailyFeesIn/OutLegacyMech(...)` | Update per-mech daily LM fees |
| `updateMechDailyFeesIn/OutLegacyMechMarketPlace(...)` | Update per-mech daily LMM fees |

All update functions guard against zero/negative amounts.

---

## Business Rules

### Fee Denomination
- **Native token**: xDAI on Gnosis Chain
- **Base unit**: Wei (10^18 precision)
- All fields use `BigInt` (no BigDecimal)

### Fee-In Logic
- **LM mechs**: Fee = mech's current `price` at time of `Request` event
- **LMM mechs**: Fee = mech price read via `getMechPrice()` contract call (tries LMM ABI first, then LM ABI)
- Price can change over time via `PriceUpdated` events

### Fee-Out Logic
- Tracked via `exec` call handlers (not events)
- **Burn address filtering**: Transfers to `0x153196110040a0c729227c603db3a6c6d91851b2` are excluded
- **Zero-amount filtering**: Zero-value exec calls are skipped

### Daily Aggregation
- Date ID = `(timestamp / 86400 * 86400)` as string — UTC midnight normalization
- Two levels: global daily (`DailyFees`) and per-mech daily (`MechDaily`)

### Factory Pattern
- Multiple factory contracts per mech type create new mech instances
- Each new mech spawns a dynamic data source template for event/call monitoring

---

## Constants

From `src/constants.ts`:

```typescript
BURN_ADDRESS_MECH_FEES_GNOSIS = "0x153196110040a0c729227c603db3a6c6d91851b2"
```

---

## Configuration

### Data Sources (subgraph.yaml)

| Data Source | Event/Call | Handler |
|-------------|-----------|---------|
| LMFactory (×2) | `CreateMech` | `handleCreateMechLM` |
| LMMFactory (×3) | `CreateMech` | `handleCreateMechLMM` |
| LegacyMarketPlace | `MarketplaceRequest` | `handleMarketplaceRequest` |

### Dynamic Templates

| Template | Events/Calls | Handlers |
|----------|-------------|----------|
| LegacyMech | `Request`, `PriceUpdated`, `exec` (call) | `handleRequest`, `handlePriceUpdateLM`, `handleExecLM` |
| LegacyMechMarketPlace | `PriceUpdated`, `exec` (call) | `handlePriceUpdateLMM`, `handleExecLMM` |

**Spec**: v0.0.5 | **API**: 0.0.7 | **Network**: gnosis

**Note**: LMM mechs do NOT have a `Request` event handler — fee-in is tracked via the marketplace contract's `MarketplaceRequest` event instead.

---

## AI Summary

### Critical Points
1. **All financial fields are `BigInt`** — no BigDecimal.
2. **Two mech types with separate tracking**: LM (direct) and LMM (marketplace). Each has its own entity type, factory contracts, and fee tracking paths.
3. **Fee-in uses mech price, not transaction value**: `Request` handler uses stored `price`; `MarketplaceRequest` reads price via contract call.
4. **Burn address exclusion**: Outgoing exec calls to the burn address are filtered out to prevent artificial inflation of fee-out totals.
5. **Call handlers for fee-out**: Uses `callHandlers` (not `eventHandlers`) for `exec` function — this tracks actual fund transfers, not events.
6. **`handleMarketplaceRequest` updates globals even if mech entity is unknown**: The global and daily fee updates happen regardless, only the individual mech update is skipped with a warning.
7. **`getMechPrice()` tries LMM ABI first, then LM**: Falls back gracefully if one contract binding reverts.
8. **Three aggregation levels**: Individual mech lifetime totals, global daily (`DailyFees`), and per-mech daily (`MechDaily`).
9. **No tests directory**: This subgraph currently has no Matchstick tests.
