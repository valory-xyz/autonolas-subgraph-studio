# Autonolas Tokenomics Ethereum Subgraph

Indexes the full OLAS tokenomics system on Ethereum mainnet: epoch management, bonding, staking incentives, developer incentive distribution, OLAS token tracking, and veOLAS lock tracking.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Epoch Management Logic](#epoch-management-logic)
- [Configuration (subgraph.yaml)](#configuration)
- [Testing](#testing)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)
- [AI Summary](#ai-summary)

---

## Architecture Overview

### Directory Structure
```
subgraphs/tokenomics-eth/
├── schema.graphql
├── subgraph.yaml                    # prune: auto, network: mainnet
├── src/
│   ├── mappings.ts                  # Epoch settlement & dev incentive logic
│   ├── depository.ts                # Bond product & bond event handlers (V1 + V2)
│   ├── tokenomics.ts                # Tokenomics contract event handlers (V1 + V2)
│   ├── dispenser.ts                 # Incentive distribution handlers (V1 + V2)
│   ├── veolas.ts                    # veOLAS deposit/withdrawal tracking
│   ├── olas.ts                      # OLAS token transfer & bond claim tracking
│   └── utils.ts                     # Epoch lookup, nominee hash, token balance helpers
├── tests/
│   ├── depository.test.ts           # BondCalculatorUpdated test
│   ├── depository-utils.ts          # Test helpers
│   ├── dispenser.test.ts            # IncentivesClaimed test
│   ├── dispenser-utils.ts           # Test helpers
│   ├── tokenomics.test.ts           # AgentRegistryUpdated test
│   └── tokenomics-utils.ts          # Test helpers
└── package.json                     # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Key Contracts (Ethereum Mainnet)

| Contract | Address | Start Block |
|----------|---------|-------------|
| DepositoryV1 | 0x52a043bcebdb2f939baef2e8b6f01652290eab3f | 16,699,263 |
| DepositoryV2 | 0xfF8697d8d2998d6AA2e09B405795C6F4BEeB0C81 | 17,777,168 |
| Tokenomics | 0xc096362fa6f4A4B1a9ea68b1043416f3381ce300 | 16,699,195 |
| DispenserV1 | 0xeED0000fE94d7cfeF4Dc0CA86a223f0F603A61B8 | 16,699,279 |
| DispenserV2 | 0x5650300fCBab43A0D7D02F8Cb5d0f039402593f0 | 20,340,783 |
| OLAS | 0x0001a500a6b18995b03f44bb040a5ffc28e45cb0 | 15,050,732 |
| veOLAS | 0x7e01A500805f8A52Fad229b3015AD130A332B7b3 | 15,050,278 |

### Core Business Rules

1. **Epoch Lifecycle**: Tokenomics operates in epochs. `EpochSettled` events trigger epoch finalization and next-epoch creation. Epoch 1 has hardcoded startBlock and effectiveBond values.
2. **V1/V2 Contract Pairs**: Depository and Dispenser each have V1 and V2 contracts with different event signatures. Both are indexed simultaneously.
3. **Bond Maturity Tracking**: At each epoch settlement, all historical bonds are scanned to find those maturing within the epoch window (`prevEpochEndTimestamp < maturity <= currentEpochEndTimestamp`).
4. **Bond Claim Detection**: OLAS transfers originating from DepositoryV1 or DepositoryV2 addresses are identified as bond claims and linked to the current epoch.
5. **Staking Incentive Epoch Resolution**: DispenserV2 uses `mapLastClaimedStakingEpochs` contract call to determine which epoch a staking claim belongs to (claimed epoch = lastClaimed - 1).
6. **veOLAS Holder Count**: Global singleton tracks active veOLAS depositors (incremented on deposit/reactivation, decremented on withdrawal).

---

## Schema Reference

### Epoch (mutable)
Central entity tracking epoch settlement data.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Epoch counter as string (e.g. "1", "2") |
| counter | `Int!` | Epoch number |
| startBlock | `BigInt!` | First block of the epoch |
| endBlock | `BigInt` | Nullable until settled |
| blockTimestamp | `BigInt` | Settlement timestamp |
| accountTopUps | `BigInt!` | Developer top-ups from settlement |
| availableDevIncentives | `BigInt!` | Dev incentives available for claiming |
| devIncentivesTotalTopUp | `BigInt` | Running sum of claimed dev topUps |
| devIncentives | `[DevIncentive!]` | `@derivedFrom(field: "epoch")` |
| availableStakingIncentives | `BigInt` | Staking incentives budget |
| stakingIncentives | `[StakingIncentive!]` | `@derivedFrom(field: "epoch")` |
| totalStakingIncentives | `BigInt` | Running sum of claimed staking incentives |
| createProducts | `[CreateProduct!]` | `@derivedFrom(field: "epoch")` |
| totalCreateProductsSupply | `BigInt` | Sum of all product supply in this epoch |
| effectiveBond | `BigInt` | Read from contract at settlement |
| createBonds | `[CreateBond!]` | `@derivedFrom(field: "epoch")` |
| maturedBonds | `[CreateBond!]` | Bonds maturing in this epoch (stored array) |
| bondClaims | `[BondClaim!]` | `@derivedFrom(field: "epoch")` |
| totalBondsClaimable | `BigInt` | OLAS amount of matured bonds |
| totalBondsClaimed | `BigInt` | OLAS amount actually claimed |

### DevIncentive (mutable)
Developer incentive claim linked to an epoch.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Transaction hash hex |
| epoch | `Epoch!` | Parent epoch |
| owner | `Bytes!` | Claimer address |
| reward | `BigInt!` | ETH reward |
| topUp | `BigInt!` | OLAS top-up |

### StakingIncentive (mutable)
Staking incentive claim linked to an epoch.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{txHash}_{chainId}_{index}` |
| epoch | `Epoch!` | Determined via contract call |
| account | `Bytes!` | Claimer |
| chainId | `BigInt!` | Target L2 chain |
| stakingTarget | `Bytes!` | Target staking contract |
| stakingIncentive | `BigInt!` | Amount |

### BondClaim (mutable)
Tracks bond OLAS claims detected from Transfer events.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| epoch | `Epoch!` | Current epoch |
| claimer | `Bytes!` | Recipient of OLAS |
| amountOLAS | `BigInt!` | Amount claimed |

### Token / TokenHolder (mutable)
OLAS token supply and individual holder balances. Also tracks veOLAS contract balance separately.

### VeolasDepositor (mutable)
veOLAS lock tracking with `unlockTimestamp` and `isActive` flag.

### Global (mutable)
Singleton (id: `""`) with `veolasHolderCount` and `updatedAt`.

### Immutable Event Entities

**Depository Events**: `BondCalculatorUpdated`, `CloseProduct`, `CreateBond`, `CreateProduct`, `OwnerUpdated`, `RedeemBond`, `TokenomicsUpdated`, `TreasuryUpdated`

**Tokenomics Events**: `AgentRegistryUpdated`, `ComponentRegistryUpdated`, `DepositoryUpdated`, `DispenserUpdated`, `DonatorBlacklistUpdated`, `EffectiveBondUpdated`, `EpochLengthUpdated`, `EpochSettled`, `IDFUpdated`, `IncentiveFractionsUpdateRequested`, `IncentiveFractionsUpdated`, `TokenomicsOwnerUpdated`, `ServiceRegistryUpdated`, `StakingParamsUpdateRequested`, `StakingParamsUpdated`, `StakingRefunded`, `TokenomicsImplementationUpdated`, `TokenomicsParametersUpdateRequested`, `TokenomicsParametersUpdated`, `TokenomicsTreasuryUpdated`

**Dispenser Events**: `IncentivesClaimed`, `DispenserOwnerUpdated`, `DispenserTokenomicsUpdated`, `DispenserTreasuryUpdated`

**DispenserV2 Events**: `AddNomineeHash`, `RemoveNomineeHash`, `PauseDispenser`, `Retained`, `SetDepositProcessorChainIds`, `StakingIncentivesBatchClaimed`, `StakingIncentivesBatch`, `StakingIncentivesClaimed`, `DispenserV2StakingParamsUpdated`, `VoteWeightingUpdated`, `WithheldAmountSynced`

---

## Event Handlers

### Depository Handlers (`src/depository.ts`)

Handles both V1 and V2 Depository contracts with separate handlers for differing event signatures.

| Handler | Event Source | Key Logic |
|---------|-------------|-----------|
| `handleCreateBond` | DepositoryV1 | Uses `expiry` param as `maturity`. Links to epoch via `findEpochId()` |
| `handleCreateBondV2` | DepositoryV2 | Uses `maturity` param directly. Links to epoch via `findEpochId()` |
| `handleCreateProduct` | DepositoryV1 | Has `expiry` param. Updates `epoch.totalCreateProductsSupply` |
| `handleCreateProductV2` | DepositoryV2 | Has `vesting` param. Updates `epoch.totalCreateProductsSupply` |
| `handleCloseProduct` | DepositoryV1 | No `supply` in event |
| `handleCloseProductV2` | DepositoryV2 | Includes `supply` param |
| `handleRedeemBond` | Both | Creates immutable RedeemBond entity |
| `handleBondCalculatorUpdated` | Both | Creates immutable event entity |
| `handleOwnerUpdated` | Both | Creates immutable event entity |
| `handleTokenomicsUpdated` | Both | Creates immutable event entity |
| `handleTreasuryUpdated` | Both | Creates immutable event entity |

### Tokenomics Handlers (`src/tokenomics.ts`)

Handles the Tokenomics contract with V1/V2 event signature variants.

| Handler | Event Signature | Key Logic |
|---------|----------------|-----------|
| `handleEpochSettled` | V1: 4 params | Creates `EpochSettled` entity + calls `handleEpochSave()` with `availableStakingIncentives = 0` |
| `handleEpochSettledV2` | V2: 7 params (adds effectiveBond, returnedStakingIncentive, totalStakingIncentive) | Creates `EpochSettled` entity + calls `handleEpochSave()` with actual staking incentive data |
| `handleEffectiveBondUpdated` | V1: 1 param | Updates epoch effectiveBond via `findEpochId()` lookup |
| `handleEffectiveBondUpdatedV2` | V2: 2 params (epochNumber, effectiveBond) | Updates epoch effectiveBond directly by epochNumber |
| Other handlers | Various | Create immutable event entities (registries, params, staking updates, etc.) |

### Dispenser Handlers (`src/dispenser.ts`)

Handles DispenserV1 and DispenserV2 incentive distribution.

| Handler | Event Source | Key Logic |
|---------|-------------|-----------|
| `handleIncentivesClaimed` | DispenserV1 | Creates `IncentivesClaimed` + `DevIncentive` linked to epoch |
| `handleIncentivesClaimedV2` | DispenserV2 | Same + includes `unitTypes[]` and `unitIds[]` |
| `handleStakingIncentivesBatchClaimed` | DispenserV2 | **Complex**: Flattens nested arrays into `StakingIncentivesBatch` entities per chainId. Uses `mapLastClaimedStakingEpochs` contract call to resolve epoch. Creates `StakingIncentive` entities. Updates `epoch.totalStakingIncentives` and reduces `epoch.availableStakingIncentives` |
| `handleStakingIncentivesClaimed` | DispenserV2 | Single claim version of batch logic |
| Other handlers | DispenserV2 | Create immutable event entities (nominee hashes, pause, retained, vote weighting, withheld sync, etc.) |

### OLAS Transfer Handler (`src/olas.ts`)

| Handler | Event | Key Logic |
|---------|-------|-----------|
| `handleTransfer` | `Transfer(indexed address, indexed address, uint256)` | 1) Detects bond claims when `from` is DepositoryV1 or V2 address; creates `BondClaim` and updates `epoch.totalBondsClaimed`. 2) Calls `handleTransferBalances()` for OLAS token/holder tracking. 3) Tracks veOLAS contract OLAS balance separately |

### veOLAS Handlers (`src/veolas.ts`)

| Handler | Event | Key Logic |
|---------|-------|-----------|
| `handleDeposit` | `Deposit(indexed address, uint256, uint256, uint8, uint256)` | Creates/reactivates `VeolasDepositor`, increments `Global.veolasHolderCount` for new/reactivated depositors |
| `handleWithdraw` | `Withdraw(indexed address, uint256, uint256)` | Marks depositor inactive, decrements `Global.veolasHolderCount` |

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `findEpochId(blockNumber)` | Linear search through Epoch entities to find which epoch contains the given block. Returns epoch ID string or empty string |
| `getNomineeHash(stakingTarget, chainId)` | Computes `keccak256(stakingTarget \|\| chainId_as_32bytes)` for staking target lookup in DispenserV2 contract |
| `handleTransferBalances(tokenAddress, from, to, amount)` | Updates Token balance (mint/burn detection via ADDRESS_ZERO) and TokenHolder balances. Manages holderCount (increment when balance goes 0->positive, decrement when positive->0) |
| `getOrCreateToken(tokenAddress)` | Load-or-create Token entity |
| `getOrCreateTokenHolder(tokenAddress, holderAddress)` | Load-or-create TokenHolder entity |

Epoch helpers in `src/mappings.ts`:

| Function/Class | Purpose |
|----------------|---------|
| `EpochMapper` | Data class capturing epoch settlement parameters |
| `handleEpochSave(params)` | Creates/updates Epoch entity at settlement. Calculates matured bonds. Creates next epoch with `effectiveBond` from contract. See [Epoch Management Logic](#epoch-management-logic) |
| `DevIncentiveMapper` | Data class for dev incentive parameters |
| `handleDevIncentiveSave(params)` | Creates `DevIncentive` entity linked to current epoch, updates `epoch.devIncentivesTotalTopUp` |

---

## Epoch Management Logic

The `handleEpochSave()` function in `src/mappings.ts` is the core epoch lifecycle manager:

1. **Current epoch finalization**: Sets `endBlock`, `blockTimestamp`, `accountTopUps`, `availableStakingIncentives`
2. **Epoch 1 hardcoding**: `startBlock = 16699195`, `effectiveBond = 376744602072265367760000`
3. **Matured bonds calculation**: Iterates all historical epochs' bonds to find those maturing within `(prevEpochEndTimestamp, currentEpochEndTimestamp]`. Accumulates `totalBondsClaimable`
4. **Next epoch creation**: Pre-creates the next epoch entity with `startBlock = currentEndBlock + 1`, reads `effectiveBond` from Tokenomics contract state
5. **Developer incentives budget**: Sets `nextEpoch.availableDevIncentives = adjustedAccountTopUps` (with special handling for epochs 1 and 2)

### Hardcoded Adjustments
- **Epoch 1**: `availableDevIncentives = 0` (no top-ups from a previous epoch)
- **Epoch 2**: `accountTopUps` reduced by `877000006048735000000000` due to a contract calculation error in early operation

---

## Configuration

### Data Sources (subgraph.yaml)

| Data Source | Events | Handler File |
|-------------|--------|--------------|
| DepositoryV1 | BondCalculatorUpdated, CloseProduct, CreateBond, CreateProduct, OwnerUpdated, RedeemBond, TokenomicsUpdated, TreasuryUpdated | `depository.ts` |
| DepositoryV2 | Same events (different signatures for CloseProduct, CreateBond, CreateProduct) | `depository.ts` |
| Tokenomics | 20 events (AgentRegistryUpdated through TreasuryUpdated, V1+V2 variants of EpochSettled and EffectiveBondUpdated) | `tokenomics.ts` |
| DispenserV1 | IncentivesClaimed, OwnerUpdated, TokenomicsUpdated, TreasuryUpdated | `dispenser.ts` |
| DispenserV2 | 14 events (AddNomineeHash through WithheldAmountSynced, including V2 IncentivesClaimed and staking batch/single claims) | `dispenser.ts` |
| OLAS | Transfer | `olas.ts` |
| veOLAS | Deposit, Withdraw | `veolas.ts` |

**Spec**: v1.0.0 | **API**: 0.0.7 | **Network**: mainnet | **Pruning**: auto

---

## Testing

**Framework**: Matchstick-as 0.5.0

Basic scaffold tests verifying entity creation for core events:
- `depository.test.ts`: BondCalculatorUpdated event creates entity (imports from `DepositoryV2`)
- `dispenser.test.ts`: IncentivesClaimed event creates entity (imports from `DispenserV1`)
- `tokenomics.test.ts`: AgentRegistryUpdated event creates entity (imports from `Tokenomics`)

Tests use mock events from `*-utils.ts` helper files.

---

## Development Workflow

```bash
cd subgraphs/tokenomics-eth
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
yarn test       # Run Matchstick tests
```

### Adding a New Contract Version
1. Add ABI to root `abis/` directory
2. Add data source to `subgraph.yaml` with new address, startBlock, and event handlers
3. Add handler functions in relevant `src/*.ts` file (follow V1/V2 pattern)
4. Add new entity types to `schema.graphql` if needed
5. `yarn codegen && yarn build`

---

## Common Queries

### Epoch Data with Bonds and Incentives
```graphql
{
  epoch(id: "10") {
    counter
    startBlock
    endBlock
    effectiveBond
    accountTopUps
    availableDevIncentives
    availableStakingIncentives
    totalBondsClaimable
    totalBondsClaimed
    totalCreateProductsSupply
    totalStakingIncentives
    devIncentives { owner, reward, topUp }
    stakingIncentives { chainId, stakingTarget, stakingIncentive }
  }
}
```

### OLAS Token Stats
```graphql
{
  token(id: "0x0001a500a6b18995b03f44bb040a5ffc28e45cb0") {
    balance
    holderCount
  }
}
```

### veOLAS Holder Count
```graphql
{
  global(id: "") {
    veolasHolderCount
    updatedAt
  }
}
```

### Bond Claims in an Epoch
```graphql
{
  epoch(id: "15") {
    bondClaims {
      claimer
      amountOLAS
      blockTimestamp
    }
    totalBondsClaimed
    totalBondsClaimable
  }
}
```

---

## AI Summary

### Critical Points
1. **All financial fields are `BigInt`** -- no BigDecimal.
2. **7 data sources** from 7 contracts on Ethereum mainnet. V1/V2 pairs for Depository and Dispenser handle different event signatures.
3. **Epoch 1 has hardcoded values**: startBlock 16699195, effectiveBond 376744602072265367760000.
4. **Epoch 2 manual adjustment**: accountTopUps reduced by 877000006048735000000000 due to contract calculation error.
5. **Next epoch pre-creation**: At settlement, the next epoch is created immediately with `effectiveBond` fetched from Tokenomics contract state.
6. **Block-based epoch lookup** (`findEpochId`): Linear scan through all epochs. Works because epoch count is bounded (tokenomics epochs are long).
7. **Bond claim detection via Transfer**: OLAS transfers from Depository addresses are identified as bond claims. No dedicated event -- pattern-matched from ERC20 Transfer.
8. **Staking incentive epoch resolution**: Uses `DispenserV2.mapLastClaimedStakingEpochs(nomineeHash)` contract call, subtracts 1 to get the claimed epoch.
9. **Nominee hash**: `keccak256(stakingTarget || chainId_as_32bytes)` used to look up staking epoch data from DispenserV2 contract.
10. **Nested array workaround**: `StakingIncentivesBatchClaimed` events contain nested arrays (chainIds -> stakingTargets[] -> stakingIncentives[]). Flattened to `StakingIncentivesBatch` entities per chainId.
11. **veOLAS tracking** is independent: Deposit/Withdraw events manage `VeolasDepositor` entities and `Global.veolasHolderCount`. Reactivation (deposit after withdrawal) correctly increments count.
12. **Entity IDs**: Immutable event entities use `txHash.concatI32(logIndex)`. Epoch IDs are counter strings ("1", "2", ...). DevIncentive IDs are transaction hash hex. StakingIncentive IDs are `{txHash}_{chainId}_{index}`.
