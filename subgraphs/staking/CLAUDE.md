# Staking Subgraph

Indexes OLAS staking activities across 7 networks. Tracks staking factory contracts (StakingFactory) and dynamically created staking proxy instances (StakingProxy) to provide per-service reward tracking, epoch-based reward history, and daily ecosystem snapshots.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers](#event-handlers)
- [Utility Functions](#utility-functions)
- [Business Logic](#business-logic)
- [Constants](#constants)
- [Configuration](#configuration)
- [Testing](#testing)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)
- [AI Summary](#ai-summary)

---

## Architecture Overview

### Directory Structure
```
subgraphs/staking/
├── schema.graphql
├── subgraph.template.yaml          # Template for network manifests
├── subgraph.{network}.yaml         # Generated per-network manifests (7 networks)
├── networks.json                   # Network addresses and start blocks
├── package.json                    # graph-cli 0.98.1, graph-ts 0.38.2
├── src/
│   ├── staking-factory.ts          # Factory event handlers (5 handlers)
│   ├── staking-proxy.ts            # Proxy event handlers (9 handlers)
│   └── utils.ts                    # Shared utilities
└── tests/
    ├── staking-proxy.test.ts       # 12 test cases
    ├── staking-proxy-utils.ts      # Event factories for tests
    ├── utils.test.ts               # Utility function tests
    └── test-helpers.ts             # Test constants and ID helpers
```

### Multi-Network Deployment

Uses **template pattern**: `subgraph.template.yaml` + `networks.json` + `generate-manifests.js`.

| Network | StakingFactory Address | Start Block |
|---------|----------------------|-------------|
| gnosis | `0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700` | 35,206,806 |
| base | `0x1cEe30D08943EB58EFF84DD1AB44a6ee6FEff63a` | 17,310,019 |
| optimism | `0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8` | 124,618,633 |
| mainnet | `0xEBdde456EA288b49f7D5975E7659bA1Ccf607efc` | 20,409,818 |
| matic | `0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461` | 62,213,142 |
| arbitrum-one | `0xEB5638eefE289691EcE01943f768EDBF96258a80` | 256,823,487 |
| celo | `0x1c2cD884127b080F940b7546c1e9aaf525b1FA55` | 27,900,037 |

### Contract Architecture

- **StakingFactory** (static data source): Creates and manages staking proxy instances. Only one per network.
- **StakingProxy** (dynamic template): Individual staking contracts, created via `StakingProxy.create()` when `InstanceCreated` fires with an allowed implementation.

---

## Schema Reference

### Immutable Event Entities

These are direct recordings of on-chain events. All marked `@entity(immutable: true)`.

| Entity | Key Fields | Source |
|--------|-----------|--------|
| InstanceCreated | sender, instance, implementation | StakingFactory |
| InstanceRemoved | instance | StakingFactory |
| InstanceStatusChanged | instance, isEnabled | StakingFactory |
| OwnerUpdated | owner | StakingFactory |
| VerifierUpdated | verifier | StakingFactory |
| Checkpoint | epoch, availableRewards, serviceIds[], rewards[], epochLength, contractAddress | StakingProxy |
| Deposit | sender, amount, balance, availableRewards | StakingProxy |
| RewardClaimed | epoch, serviceId, owner, multisig, nonces[], reward | StakingProxy |
| ServiceStaked | epoch, serviceId, owner, multisig, nonces[] | StakingProxy |
| ServiceUnstaked | epoch, serviceId, owner, multisig, nonces[], reward, availableRewards | StakingProxy |
| ServiceForceUnstaked | epoch, serviceId, owner, multisig, nonces[], reward, availableRewards | StakingProxy |
| ServiceInactivityWarning | epoch, serviceId, serviceInactivity | StakingProxy |
| ServicesEvicted | epoch, serviceIds[], owners[], multisigs[], serviceInactivity[] | StakingProxy |
| Withdraw | to, amount | StakingProxy |
| RewardUpdate | type ("Claimable"\|"Claimed"), amount | StakingProxy |

### StakingContract
Immutable. Full on-chain configuration snapshot of a staking proxy, created in `handleInstanceCreated`.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Instance address |
| sender | `Bytes!` | Creator |
| instance / implementation | `Bytes!` | Contract addresses |
| metadataHash | `Bytes!` | |
| maxNumServices | `BigInt!` | Max services allowed |
| rewardsPerSecond | `BigInt!` | Emission rate |
| minStakingDeposit | `BigInt!` | Min deposit per agent slot |
| minStakingDuration | `BigInt!` | Min staking period |
| maxNumInactivityPeriods | `BigInt!` | Inactivity tolerance |
| livenessPeriod | `BigInt!` | Activity monitoring period |
| timeForEmissions | `BigInt!` | Total emission duration |
| numAgentInstances | `BigInt!` | Agent instance count |
| agentIds | `[BigInt!]!` | Agent identifiers |
| threshold | `BigInt!` | Staking threshold |
| configHash / proxyHash | `Bytes!` | Config identifiers |
| serviceRegistry / activityChecker | `Bytes!` | Related contract addresses |

### Service
Mutable. Per-service cumulative state across all staking contracts.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | Service ID (string) |
| currentOlasStaked | `BigInt!` | Currently staked amount |
| olasRewardsEarned | `BigInt!` | Cumulative rewards earned (updated at checkpoint) |
| olasRewardsClaimed | `BigInt!` | Cumulative rewards claimed (updated at claim/unstake) |
| latestStakingContract | `Bytes` | **Nullable.** Current contract address; null when unstaked |
| totalEpochsParticipated | `Int!` | Incremented in `getOrCreateServiceRewardsHistory()` on first call per epoch |
| rewardsHistory | `[ServiceRewardsHistory!]!` | `@derivedFrom(field: "service")` |
| global | `Global!` | Reference to singleton Global |
| blockNumber / blockTimestamp | `BigInt!` | Last update |

### ServiceRewardsHistory
Mutable. Epoch-by-epoch reward tracking per service per contract.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{serviceId}-{contractAddress}-{epoch}` |
| service | `Service!` | |
| epoch | `BigInt!` | |
| contractAddress | `Bytes!` | Staking contract address |
| checkpoint | `Checkpoint` | **Nullable.** Linked when checkpoint occurs |
| rewardAmount | `BigInt!` | Reward earned (0 if KPI not met) |
| checkpointedAt | `BigInt` | **Nullable.** Timestamp when checkpointed |
| blockNumber / blockTimestamp | `BigInt!` | When created (at stake time) |
| transactionHash | `Bytes!` | |

### ActiveServiceEpoch
Mutable. Internal tracking of which services are active per epoch per contract.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | `{contractAddress}-{epoch}` |
| contractAddress | `Bytes!` | |
| epoch | `BigInt!` | |
| activeServiceIds | `[BigInt!]!` | Service IDs active in this epoch |
| blockNumber / blockTimestamp | `BigInt!` | |

### Global
Mutable. Singleton (id: `""`) aggregate statistics.

| Field | Type | Notes |
|-------|------|-------|
| cumulativeOlasStaked | `BigInt!` | Total OLAS ever staked |
| cumulativeOlasUnstaked | `BigInt!` | Total OLAS ever unstaked |
| currentOlasStaked | `BigInt!` | Net currently staked |
| totalRewards | `BigInt!` | Cumulative rewards distributed |
| lastActiveDayTimestamp | `BigInt!` | For daily snapshot forward-filling |
| services | `[Service!]!` | `@derivedFrom(field: "global")` |

### CumulativeDailyStakingGlobal
Mutable. Daily snapshots of ecosystem metrics.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Day timestamp as UTF8 bytes |
| timestamp | `BigInt!` | UTC midnight timestamp |
| block | `BigInt!` | Block when updated |
| totalRewards | `BigInt!` | Cumulative rewards at this day |
| numServices | `Int!` | Total service count |
| medianCumulativeRewards | `BigInt!` | Median of `olasRewardsEarned` across all services |

---

## Event Handlers

### Factory Handlers (`src/staking-factory.ts`)

#### 1. handleInstanceCreated
**Event**: `InstanceCreated(indexed address sender, indexed address instance, indexed address implementation)`

- Creates immutable `InstanceCreated` entity
- **Guard**: Checks `isAllowedImplementation(implementation)` — skips if not whitelisted
- If allowed: creates `StakingProxy` dynamic template and `StakingContract` entity
- `StakingContract` fields populated via on-chain contract calls (`contract.metadataHash()`, `contract.maxNumServices()`, etc.)

#### 2-5. Simple Event Recorders
- **handleInstanceRemoved**: Records `InstanceRemoved`
- **handleInstanceStatusChanged**: Records `InstanceStatusChanged` with `isEnabled`
- **handleOwnerUpdated**: Records `OwnerUpdated`
- **handleVerifierUpdated**: Records `VerifierUpdated`

### Proxy Handlers (`src/staking-proxy.ts`)

#### 1. handleServiceStaked (Complex)
**Event**: `ServiceStaked(uint256 epoch, indexed uint256 serviceId, indexed address owner, indexed address multisig, uint256[] nonces)`

- Creates immutable `ServiceStaked` entity
- Creates or loads `Service` entity (initializes all counters to 0 on first creation)
- Calculates stake amount via `getOlasForStaking(event.address)` — reads from `StakingContract`
- Updates `Service.currentOlasStaked`, sets `Service.latestStakingContract`
- Creates/updates `ActiveServiceEpoch` — adds service to active list (deduplicates)
- Creates `ServiceRewardsHistory` entry for this epoch (increments `totalEpochsParticipated`)
- Updates `Global.cumulativeOlasStaked` and `Global.currentOlasStaked`

#### 2. handleCheckpoint (Most Complex)
**Event**: `Checkpoint(indexed uint256 epoch, uint256 availableRewards, uint256[] serviceIds, uint256[] rewards, uint256 epochLength)`

Four-phase processing:

1. **Process rewarded services**: Iterates `serviceIds[]`/`rewards[]` from event. Updates `Service.olasRewardsEarned`. Creates/updates `ServiceRewardsHistory` with reward amount and checkpoint reference. Tracks handled services in `Map` to prevent double-processing.

2. **Process active-but-unrewarded services**: Loads `ActiveServiceEpoch` for this epoch. For each active service not already handled: creates zero-reward `ServiceRewardsHistory` entry. **Skips** services that migrated to a different contract (checks `Service.latestStakingContract`).

3. **Epoch rollover**: Carries forward active services to next epoch's `ActiveServiceEpoch`. If next epoch tracker already exists (race condition — someone staked for next epoch before checkpoint), **merges and deduplicates** the service lists.

4. **Global updates**: Adds total rewards to `Global.totalRewards`. Calls `upsertCumulativeDailyStakingGlobal()` for daily snapshot. Creates `RewardUpdate` with type "Claimable".

#### 3. handleServiceUnstaked
**Event**: `ServiceUnstaked(uint256 epoch, indexed uint256 serviceId, ...)`

- Creates immutable `ServiceUnstaked` entity
- Creates `RewardUpdate` with type "Claimed"
- Calls `processUnstake()` — shared logic for unstaking

#### 4. handleServiceForceUnstaked
- Creates immutable `ServiceForceUnstaked` entity
- Calls `processUnstake()` — same shared logic
- **No** `RewardUpdate` created (unlike regular unstake)

#### 5. handleRewardClaimed
**Event**: `RewardClaimed(uint256 epoch, indexed uint256 serviceId, ...)`

- Creates immutable `RewardClaimed` entity
- Updates `Service.olasRewardsClaimed` (adds claimed amount)
- Creates `RewardUpdate` with type "Claimed"

#### 6. handleServicesEvicted
- Creates immutable `ServicesEvicted` entity with array fields
- **Does NOT** update `Service` entities — services remain "active" for continuous tracking

#### 7-9. Simple Event Recorders
- **handleDeposit**: Records `Deposit`
- **handleServiceInactivityWarning**: Records `ServiceInactivityWarning`
- **handleWithdraw**: Records `Withdraw`

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `createRewardUpdate(id, blockNumber, blockTimestamp, txHash, type, amount)` | Creates immutable `RewardUpdate` entity |
| `getOlasForStaking(address)` | Returns `minStakingDeposit * (numAgentInstances + 1)` from `StakingContract` entity |
| `getOrCreateGlobal()` | Singleton Global entity (id: `""`) — creates with zero values if null |
| `getDayTimestamp(timestamp)` | UTC midnight: `timestamp / 86400 * 86400` |
| `getOrCreateCumulativeDailyStakingGlobal(event)` | Daily snapshot with forward-fill from `Global.lastActiveDayTimestamp` |
| `upsertCumulativeDailyStakingGlobal(event, totalRewards)` | Updates daily snapshot: sets totalRewards, computes median, counts services, updates `Global.lastActiveDayTimestamp` |
| `computeMedianOfAllServices()` | Loads all Service entities, sorts `olasRewardsEarned`, returns median (avg of two middle for even count) |
| `isAllowedImplementation(implementation)` | Network-specific whitelist of allowed implementation addresses |
| `getOrCreateServiceRewardsHistory(serviceId, contractAddress, epoch, ...)` | ID: `{serviceId}-{contractAddress}-{epoch}`. Increments `Service.totalEpochsParticipated` on creation only |
| `processUnstake(event, serviceId, epoch, reward, contractAddress)` | Shared unstake logic: clears `latestStakingContract`, adds reward to `olasRewardsClaimed`, decrements `currentOlasStaked`, updates Global |

---

## Business Logic

### Epoch-Based Reward Flow
1. **Service stakes** → `Service` created/updated, `ServiceRewardsHistory` created with `rewardAmount=0`, added to `ActiveServiceEpoch`
2. **Checkpoint fires** → Rewarded services get `rewardAmount` updated; unrewarded active services get zero-reward entries; all services carried forward to next epoch
3. **Service unstakes** → `latestStakingContract` cleared, reward added to `olasRewardsClaimed`, stake amount removed from Global

### Staking Amount Calculation
```
olasForStaking = StakingContract.minStakingDeposit * (StakingContract.numAgentInstances + 1)
```

### Service Migration
- `Service.latestStakingContract` tracks current contract
- When staking on a new contract, it updates to the new address
- At checkpoint, services that migrated (latestStakingContract != event.address) are **skipped** for zero-reward entries
- `ServiceRewardsHistory` is scoped by contract — allows multi-contract participation tracking

### Eviction Behavior
- `ServicesEvicted` is recorded but **does not update** `Service` entities
- `latestStakingContract` is NOT cleared on eviction (unlike unstake)
- Service remains in `ActiveServiceEpoch` for continuous tracking

### Daily Snapshots
- `CumulativeDailyStakingGlobal` updated on every checkpoint
- Forward-fills from last active day (via `Global.lastActiveDayTimestamp`) for population continuity
- `medianCumulativeRewards` computed from all services' `olasRewardsEarned`

### Reward Tracking: Earned vs Claimed
- `olasRewardsEarned`: Updated at checkpoint time — cumulative rewards the service has earned
- `olasRewardsClaimed`: Updated at claim/unstake time — cumulative rewards actually withdrawn
- Compare the two to measure unclaimed rewards

---

## Constants

### Allowed Implementations (per network)

| Network | Implementation Address |
|---------|----------------------|
| arbitrum-one | `0x04b0007b2aFb398015B76e5f22993a1fddF83644` |
| base | `0xEB5638eefE289691EcE01943f768EDBF96258a80` |
| celo | `0xe1E1B286EbE95b39F785d8069f2248ae9C41b7a9` |
| gnosis | `0xEa00be6690a871827fAfD705440D20dd75e67AB1` |
| mainnet | `0x0Dc23eEf3bC64CF3cbd8f9329B57AE4C4f28d5d2` |
| matic | `0x4aba1Cf7a39a51D75cBa789f5f21cf4882162519` |
| optimism | `0x63C2c53c09dE534Dd3bc0b7546c1e9aaf525b1FA55` |

---

## Configuration

### Data Source (subgraph.template.yaml)

| Data Source | Events Registered | Handler File |
|-------------|-------------------|--------------|
| StakingFactory | `InstanceCreated`, `InstanceRemoved`, `InstanceStatusChanged`, `OwnerUpdated`, `VerifierUpdated` | `staking-factory.ts` |

### Dynamic Template

| Template | Events | Handler File |
|----------|--------|--------------|
| StakingProxy | `Checkpoint`, `Deposit`, `RewardClaimed`, `ServiceForceUnstaked`, `ServiceInactivityWarning`, `ServiceStaked`, `ServiceUnstaked`, `ServicesEvicted`, `Withdraw` | `staking-proxy.ts` |

**Spec**: v1.0.0 | **API**: 0.0.7 | **Pruning**: auto

ABIs: `../../abis/StakingFactory.json`, `../../abis/StakingProxy.json`

---

## Testing

**Framework**: Matchstick-as v0.6.0

### Test Helpers
- `tests/staking-proxy-utils.ts`: Event factories (`createServiceStakedEvent`, `createCheckpointEvent`, `createServiceUnstakedEvent`, `createServiceForceUnstakedEvent`, `createRewardClaimedEvent`, `createServicesEvictedEvent`)
- `tests/test-helpers.ts`: Namespaced constants (`TestAddresses`, `TestBytes`, `TestConstants`) and ID helper functions (`createHistoryId`, `createActiveEpochId`)
- Test setup creates `StakingContract` entity with `MIN_STAKING_DEPOSIT = 10e18`, `NUM_AGENT_INSTANCES = 3`

### Test Coverage (12 tests in staking-proxy.test.ts + utils.test.ts)

| Test | Validates |
|------|-----------|
| ServiceStaked creates history and updates Service fields | Entity creation, totalEpochsParticipated, latestStakingContract |
| Multiple services in same epoch tracked | ActiveServiceEpoch contains all services |
| Checkpoint updates history for KPI-meeting services | rewardAmount set, olasRewardsEarned updated |
| Checkpoint creates zero-reward entries for non-KPI services | Active but unrewarded services get rewardAmount=0 |
| RewardClaimed updates olasRewardsClaimed | Cumulative claim tracking |
| ServiceUnstaked updates claimed and clears contract | olasRewardsClaimed, latestStakingContract=null |
| ServiceForceUnstaked same behavior as unstake | olasRewardsClaimed, latestStakingContract=null |
| totalEpochsParticipated increments correctly | Counts across epochs 1→2→3 |
| Multiple rewards accumulate | 1000+500+250 = 1750 |
| Checkpoint carries forward to next epoch | NextEpoch tracker has all services |
| Service on different contracts tracked separately | Per-contract history, totalEpochsParticipated=2 |
| Complex lifecycle: stake→evict→restake→migrate | 6 epochs, 2 contracts, full history chain |
| Checkpoint deduplicates next epoch tracker | Race condition: early stake + checkpoint merge |

---

## Development Workflow

```bash
yarn install                           # Install dependencies
yarn codegen                           # Generate types (uses gnosis manifest)
yarn build                             # Build (uses gnosis manifest)
yarn test                              # Run Matchstick tests (symlinks gnosis manifest)
yarn generate-manifests                # Regenerate network manifests from template
```

Deploy per network:
```bash
yarn deploy-gnosis
yarn deploy-base
yarn deploy-optimism
yarn deploy-ethereum
yarn deploy-polygon
yarn deploy-arbitrum
yarn deploy-celo
```

---

## Common Queries

### Service Performance
```graphql
{
  services(orderBy: olasRewardsEarned, orderDirection: desc, first: 10) {
    id
    currentOlasStaked
    olasRewardsEarned
    olasRewardsClaimed
    latestStakingContract
    totalEpochsParticipated
  }
}
```

### Service Rewards History
```graphql
{
  serviceRewardsHistories(where: { service: "123" }, orderBy: epoch, orderDirection: desc) {
    epoch
    contractAddress
    rewardAmount
    checkpointedAt
    checkpoint { availableRewards }
  }
}
```

### Global Statistics
```graphql
{
  globals {
    cumulativeOlasStaked
    cumulativeOlasUnstaked
    currentOlasStaked
    totalRewards
  }
}
```

### Daily Metrics
```graphql
{
  cumulativeDailyStakingGlobals(orderBy: timestamp, orderDirection: desc, first: 30) {
    timestamp
    totalRewards
    numServices
    medianCumulativeRewards
  }
}
```

---

## AI Summary

### Critical Points
1. **All financial fields are `BigInt`** — no BigDecimal.
2. **Implementation filtering**: Only whitelisted implementations (one per network) get `StakingProxy` template + `StakingContract` entity. `InstanceCreated` events are always recorded regardless.
3. **Stake amount**: `minStakingDeposit * (numAgentInstances + 1)`, read from the `StakingContract` entity (not on-chain at stake time).
4. **Earned vs Claimed**: `olasRewardsEarned` updated at checkpoint; `olasRewardsClaimed` updated at claim/unstake. Compare for unclaimed balance.
5. **Zero-reward tracking**: ALL active services get `ServiceRewardsHistory` entries at checkpoint, even if reward=0. Enables KPI analysis.
6. **Migration detection**: At checkpoint, services with `latestStakingContract != event.address` are skipped for zero-reward entries (they migrated to another contract).
7. **Eviction does NOT clear state**: `handleServicesEvicted` only records the event. `latestStakingContract` remains set, service stays in `ActiveServiceEpoch`.
8. **Epoch rollover with deduplication**: Checkpoint merges current active services into next epoch's tracker, handling race conditions where services stake for the next epoch before the current checkpoint.
9. **Daily forward-fill**: `CumulativeDailyStakingGlobal` copies `numServices` and `medianCumulativeRewards` from last active day when creating a new snapshot, ensuring continuous time series.
10. **`processUnstake()` shared logic**: Used by both `handleServiceUnstaked` and `handleServiceForceUnstaked`. Clears `latestStakingContract`, adds reward to `olasRewardsClaimed`, decrements stake from Global.
11. **`ServiceRewardsHistory` ID**: `{serviceId}-{contractAddress}-{epoch}` — scoped by contract, enabling multi-contract participation.
12. **`totalEpochsParticipated`**: Incremented inside `getOrCreateServiceRewardsHistory()` only on first creation per unique ID — idempotent on subsequent calls.
