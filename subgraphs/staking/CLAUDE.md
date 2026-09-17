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
Immutable. On-chain configuration snapshot of a staking proxy, created in `handleInstanceCreated` for **every** instance the factory creates.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Instance address |
| sender | `Bytes!` | Creator |
| instance / implementation | `Bytes!` | Contract addresses |
| stakingManager | `Bytes` | **Nullable.** Read from `stakingManager()`, which not every implementation exposes |
| configComplete | `Boolean!` | False when at least one getter below reverted and its value is a default rather than a reading |
| stakingToken | `Bytes` | **Nullable.** Deposit token; null when `stakingToken()` is not exposed |
| isOlasStaking | `Boolean!` | `stakingToken` matches this network's OLAS. False means its deposits are **not** OLAS and must not reach the OLAS totals |
| serviceRegistryTokenUtility | `Bytes` | **Nullable.** Where service deposits and agent bonds actually sit |
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
| currentStakeAmount | `BigInt!` | Amount recorded at stake time, subtracted verbatim on unstake |
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
| totalRewards | `BigInt!` | Cumulative rewards earned (claimable), summed at checkpoint |
| totalRewardsClaimed | `BigInt!` | Cumulative rewards paid out, summed at claim/unstake |
| lastActiveDayTimestamp | `BigInt!` | For daily snapshot forward-filling |
| services | `[Service!]!` | `@derivedFrom(field: "global")` |

### CumulativeDailyStakingGlobal
Mutable. Daily snapshots of ecosystem metrics.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Day timestamp as UTF8 bytes |
| timestamp | `BigInt!` | UTC midnight timestamp |
| block | `BigInt!` | Block when updated |
| totalRewards | `BigInt!` | Cumulative rewards earned at this day |
| totalRewardsClaimed | `BigInt!` | Cumulative rewards claimed at this day |
| numServices | `Int!` | Total service count |
| medianCumulativeRewards | `BigInt!` | Median of `olasRewardsEarned` across all services |

---

## Event Handlers

### Factory Handlers (`src/staking-factory.ts`)

#### 1. handleInstanceCreated
**Event**: `InstanceCreated(indexed address sender, indexed address instance, indexed address implementation)`

- Creates immutable `InstanceCreated` entity
- Creates the `StakingProxy` dynamic template and a `StakingContract` entity for **every** instance — the factory is the authority on what is a staking contract, so there is no implementation allowlist
- `StakingContract` fields are populated via on-chain calls, each through `try_*`. Implementations differ in which getters they expose, so a revert defaults the field — zero for numerics, empty for bytes, `[]` for `agentIds` — and clears `configComplete`. An unguarded call would revert the handler and **halt indexing for the whole network**, which is what the old allowlist was really protecting against
- `stakingManager()` is only exposed by some implementations, so a non-null value marks an externally managed contract without needing a hardcoded address list

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
- Calculates stake amount via `getOlasForStaking(event.address, serviceId)` — reads the service's locked OLAS on-chain, and records it on `Service.currentStakeAmount`
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
- Calls `processUnstake()` — shared logic for unstaking, which also adds the payout to `Global.totalRewardsClaimed`

#### 4. handleServiceForceUnstaked
- Creates immutable `ServiceForceUnstaked` entity
- Creates `RewardUpdate` with type "Claimed" — a force unstake pays the accrued reward out too
- Calls `processUnstake()` — same shared logic

#### 5. handleRewardClaimed
**Event**: `RewardClaimed(uint256 epoch, indexed uint256 serviceId, ...)`

- Creates immutable `RewardClaimed` entity
- Updates `Service.olasRewardsClaimed` (adds claimed amount)
- Creates `RewardUpdate` with type "Claimed"
- Calls `recordRewardsClaimed()` — adds to `Global.totalRewardsClaimed` and today's snapshot

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
| `getOlasForStaking(address, serviceId)` | OLAS to attribute to a service: the on-chain locked amount, falling back to the contract's parameters. Returns 0 for non-OLAS contracts |
| `readLockedOlas(stakingContract, serviceId)` | Reads security deposit + agent bonds from ServiceRegistryTokenUtility. Returns null if any read reverts, so the caller can fall back |
| `getOrCreateGlobal()` | Singleton Global entity (id: `""`) — creates with zero values if null |
| `getDayTimestamp(timestamp)` | UTC midnight: `timestamp / 86400 * 86400` |
| `getOrCreateCumulativeDailyStakingGlobal(event)` | Daily snapshot with forward-fill from `Global.lastActiveDayTimestamp` |
| `upsertCumulativeDailyStakingGlobal(event, totalRewards)` | Updates daily snapshot: sets totalRewards, computes median, counts services, updates `Global.lastActiveDayTimestamp` |
| `recordRewardsClaimed(event, reward)` | Adds a payout to `Global.totalRewardsClaimed` and mirrors it onto today's snapshot. Skips the median/service-count recompute — claims are far more frequent than checkpoints, and those fields only move on a checkpoint |
| `computeMedianOfAllServices()` | Loads all Service entities, sorts `olasRewardsEarned`, returns median (avg of two middle for even count) |
| `getOrCreateServiceRewardsHistory(serviceId, contractAddress, epoch, ...)` | ID: `{serviceId}-{contractAddress}-{epoch}`. Increments `Service.totalEpochsParticipated` on creation only |
| `processUnstake(event, serviceId, epoch, reward, contractAddress)` | Shared unstake logic: clears `latestStakingContract`, adds reward to `olasRewardsClaimed`, decrements `currentOlasStaked` **by `Service.currentStakeAmount`**, updates Global, calls `recordRewardsClaimed()` |

---

## Business Logic

### Epoch-Based Reward Flow
1. **Service stakes** → `Service` created/updated, `ServiceRewardsHistory` created with `rewardAmount=0`, added to `ActiveServiceEpoch`
2. **Checkpoint fires** → Rewarded services get `rewardAmount` updated; unrewarded active services get zero-reward entries; all services carried forward to next epoch
3. **Service unstakes** → `latestStakingContract` cleared, reward added to `olasRewardsClaimed`, stake amount removed from Global

### Staking Amount Calculation

The OLAS a service locks lives in **ServiceRegistryTokenUtility**, not in the staking contract, and is read at the block being indexed so historic stakes get historic values:

```
locked = tokenUtility.mapServiceIdTokenDeposit(serviceId).securityDeposit
       + Σ (agentParams[i].slots * tokenUtility.getAgentBond(serviceId, agentIds[i]))
```

The staking contract's own parameters are only a **fallback** for when those reads are unavailable:

```
olasForStaking = StakingContract.minStakingDeposit * (StakingContract.numAgentInstances + 1)
```

That fallback describes the contract's *minimum*, not what a given service actually posted, and some implementations have no `numAgentInstances` at all. Prefer the read; the formula is what the numbers degrade to.

Contracts with `isOlasStaking: false` contribute **zero** — their deposits are denominated in another token.

### Stake / Unstake Symmetry

`Service.currentStakeAmount` is written when a service stakes and subtracted verbatim when it unstakes. Never recompute the amount on the unstake path: the on-chain deposit can change while a service is staked, and an asymmetric add/subtract makes `currentOlasStaked` drift permanently — potentially negative. It also makes a service that unstakes without a recorded stake (staked before the subgraph's `startBlock`) release zero instead of a phantom amount.

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
- `CumulativeDailyStakingGlobal` updated on every checkpoint (all fields) and every claim/unstake (`totalRewardsClaimed` only)
- A new day seeds both cumulative totals from `Global`, so a day opened by a claim rather than a checkpoint still carries `totalRewards` forward
- Forward-fills from last active day (via `Global.lastActiveDayTimestamp`) for population continuity
- `medianCumulativeRewards` computed from all services' `olasRewardsEarned`

### Reward Tracking: Earned vs Claimed
- `olasRewardsEarned`: Updated at checkpoint time — cumulative rewards the service has earned
- `olasRewardsClaimed`: Updated at claim/unstake time — cumulative rewards actually withdrawn
- Compare the two to measure unclaimed rewards
- The same pair exists ecosystem-wide as `Global.totalRewards` / `Global.totalRewardsClaimed`, with a daily series on `CumulativeDailyStakingGlobal`. Prefer these over summing `RewardUpdate` rows: Gnosis alone has >124k of them, so any paginated sum is both slow and easy to silently truncate
- Three sums are kept in lockstep by design: `Global.totalRewardsClaimed` == sum of `RewardUpdate` where `type: "Claimed"` == sum of `Service.olasRewardsClaimed`

---

## Constants

No hardcoded contract allowlists. Which instances count as staking contracts comes from the factory; `stakingManager()` on the instance marks the externally managed ones.

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
- `tests/staking-factory-utils.ts`: `createInstanceCreatedEvent` plus `mockStakingProxyConfig(instance, reverting, stakingManager)`, which mocks every getter `handleInstanceCreated` reads and reverts the ones named, so partial implementations can be simulated
- `tests/staking-proxy-utils.ts`: Event factories (`createServiceStakedEvent`, `createCheckpointEvent`, `createServiceUnstakedEvent`, `createServiceForceUnstakedEvent`, `createRewardClaimedEvent`, `createServicesEvictedEvent`)
- `tests/test-helpers.ts`: Namespaced constants (`TestAddresses`, `TestBytes`, `TestConstants`) and ID helper functions (`createHistoryId`, `createActiveEpochId`)
- Test setup creates `StakingContract` entity with `MIN_STAKING_DEPOSIT = 10e18`, `NUM_AGENT_INSTANCES = 3`

### Test Coverage (21 in staking-proxy.test.ts + 4 in staking-factory.test.ts + 5 in utils.test.ts)

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
| Checkpoint accumulates Global.totalRewards | Claimable accumulator moves, claimed stays at 0 |
| RewardClaimed accumulates Global.totalRewardsClaimed | Two claims sum |
| ServiceUnstaked payout counts as claimed | Unstake payout reaches the global accumulator |
| ServiceForceUnstaked payout counts as claimed | Global accumulator + `RewardUpdate` emitted |
| Daily snapshot carries both cumulative totals | `totalRewards` and `totalRewardsClaimed` on one day |
| Fully featured instance indexed | `configComplete: true`, `stakingManager: null`, agentIds read |
| Instance missing getAgentIds | Still indexed; `configComplete: false`, manager set, other getters kept |
| Sparse implementation missing most getters | Indexing does not halt; successful reads retained |
| InstanceCreated recorded for every instance | No implementation gate |
| Stake amount comes from the on-chain deposit | On-chain 1000 used, not the contract minimum |
| Unstake releases the recorded amount | Deposit doubles mid-stake; totals still return to zero |
| Non-OLAS contracts contribute nothing | `isOlasStaking: false` adds 0 to the totals |

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
    totalRewardsClaimed
  }
}
```

### Daily Metrics
```graphql
{
  cumulativeDailyStakingGlobals(orderBy: timestamp, orderDirection: desc, first: 30) {
    timestamp
    totalRewards
    totalRewardsClaimed
    numServices
    medianCumulativeRewards
  }
}
```

---

## AI Summary

### Critical Points
1. **All financial fields are `BigInt`** — no BigDecimal.
2. **No implementation filtering**: every factory instance gets a `StakingProxy` template + `StakingContract` entity. Getter reads are all `try_*` because implementations expose different subsets — one unguarded revert would halt indexing for the network. `configComplete` flags entities holding defaults; `stakingManager` is non-null on externally managed contracts.
3. **Stake amount**: read on-chain from ServiceRegistryTokenUtility at stake time (security deposit + agent bonds), recorded on `Service.currentStakeAmount`, and released verbatim on unstake. The `minStakingDeposit * (numAgentInstances + 1)` formula is only a fallback. Non-OLAS contracts contribute zero.
4. **Earned vs Claimed**: `olasRewardsEarned` updated at checkpoint; `olasRewardsClaimed` updated at claim/unstake. Compare for unclaimed balance. Ecosystem-wide equivalents live on `Global` (`totalRewards` / `totalRewardsClaimed`) and `CumulativeDailyStakingGlobal` — use those instead of summing `RewardUpdate` rows.
5. **Zero-reward tracking**: ALL active services get `ServiceRewardsHistory` entries at checkpoint, even if reward=0. Enables KPI analysis.
6. **Migration detection**: At checkpoint, services with `latestStakingContract != event.address` are skipped for zero-reward entries (they migrated to another contract).
7. **Eviction does NOT clear state**: `handleServicesEvicted` only records the event. `latestStakingContract` remains set, service stays in `ActiveServiceEpoch`.
8. **Epoch rollover with deduplication**: Checkpoint merges current active services into next epoch's tracker, handling race conditions where services stake for the next epoch before the current checkpoint.
9. **Daily forward-fill**: `CumulativeDailyStakingGlobal` copies `numServices` and `medianCumulativeRewards` from last active day when creating a new snapshot, ensuring continuous time series.
10. **`processUnstake()` shared logic**: Used by both `handleServiceUnstaked` and `handleServiceForceUnstaked`. Clears `latestStakingContract`, adds reward to `olasRewardsClaimed`, decrements stake from Global, adds the payout to `Global.totalRewardsClaimed`.
11. **`ServiceRewardsHistory` ID**: `{serviceId}-{contractAddress}-{epoch}` — scoped by contract, enabling multi-contract participation.
12. **`totalEpochsParticipated`**: Incremented inside `getOrCreateServiceRewardsHistory()` only on first creation per unique ID — idempotent on subsequent calls.
