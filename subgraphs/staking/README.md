# Staking Subgraph

This subgraph tracks staking activities and reward distributions across multiple networks in the OLAS ecosystem. It monitors staking factory contracts and individual staking proxy instances to provide comprehensive analytics for staking participants, service providers, and reward distributions.

## Overview

The staking subgraph provides real-time indexing of staking activities, tracking:

- **Staking Factory Management**: Creation, removal, and status changes of staking instances
- **Service Staking**: Individual service staking and unstaking activities
- **Reward Distribution**: Checkpoint events and reward claiming
- **Deposit Management**: OLAS deposits and withdrawals
- **Service Lifecycle**: Inactivity warnings, force unstaking, and evictions
- **Multi-Network Support**: Deployments across 8 different networks

## Data Sources

The subgraph monitors staking contracts across multiple networks:

### Supported Networks

| Network | StakingFactory Address | Start Block |
|---------|----------------------|-------------|
| **Gnosis** | `0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700` | 35206806 |
| **Base** | `0x1cEe30D08943EB58EFF84DD1AB44a6ee6FEff63a` | 17310019 |
| **Mode Mainnet** | `0x75D529FAe220bC8db714F0202193726b46881B76` | 14444647 |
| **Optimism** | `0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8` | 124618633 |
| **Ethereum Mainnet** | `0xEBdde456EA288b49f7D5975E7659bA1Ccf607efc` | 20409818 |
| **Polygon** | `0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461` | 62213142 |
| **Arbitrum One** | `0xEB5638eefE289691EcE01943f768EDBF96258a80` | 256823487 |
| **Celo** | `0x1c2cD884127b080F940b7546c1e9aaf525b1FA55` | 27900037 |

### Contract Architecture

- **StakingFactory**: Creates and manages staking proxy instances
- **StakingProxy**: Individual staking contracts with full configuration
- **Service Registry**: Links services to staking activities
- **Activity Checker**: Monitors service activity and inactivity

## Entities

### Factory Management Entities

#### `StakingContract`
Represents a staking proxy instance with full configuration:
- **id**: Contract instance address
- **sender**: Creator address
- **instance/implementation**: Contract addresses
- **metadataHash**: Contract metadata identifier
- **maxNumServices**: Maximum services allowed
- **rewardsPerSecond**: Reward emission rate
- **minStakingDeposit**: Minimum deposit requirement
- **minStakingDuration**: Minimum staking period
- **maxNumInactivityPeriods**: Maximum inactivity tolerance
- **livenessPeriod**: Activity monitoring period
- **timeForEmissions**: Total emission duration
- **numAgentInstances**: Number of agent instances
- **agentIds**: Array of agent identifiers
- **threshold**: Staking threshold
- **configHash/proxyHash**: Configuration identifiers
- **serviceRegistry/activityChecker**: Related contract addresses

#### Factory Events
- `InstanceCreated`: New staking proxy creation
- `InstanceRemoved`: Staking proxy removal
- `InstanceStatusChanged`: Enable/disable status changes
- `OwnerUpdated`: Factory owner changes
- `VerifierUpdated`: Verifier address updates

### Staking Activity Entities

#### `Service`
Represents a staked service with performance metrics:
- **id**: Service identifier
- **currentOlasStaked**: Currently staked OLAS amount
- **olasRewardsEarned**: Total rewards earned (cumulative)
- **olasRewardsClaimed**: Total rewards claimed (cumulative)
- **latestStakingContract**: Address of current staking contract (null if unstaked)
- **totalEpochsParticipated**: Number of epochs the service has participated in
- **rewardsHistory**: Array of epoch-by-epoch reward records (derived from ServiceRewardsHistory)
- **blockNumber/blockTimestamp**: Last update details

#### `ServiceStaked`
Service staking events:
- **id**: Event identifier
- **epoch**: Staking epoch
- **serviceId**: Service identifier
- **owner/multisig**: Service owner addresses
- **nonces**: Transaction nonces
- **blockNumber/blockTimestamp**: Event details

#### `ServiceUnstaked`
Service unstaking events:
- **id**: Event identifier
- **epoch**: Unstaking epoch
- **serviceId**: Service identifier
- **owner/multisig**: Service owner addresses
- **nonces**: Transaction nonces
- **reward**: Reward amount received
- **availableRewards**: Available rewards at time
- **blockNumber/blockTimestamp**: Event details

#### `ServiceRewardsHistory`
Epoch-by-epoch reward tracking for each service:
- **id**: Composite identifier `{serviceId}-{contractAddress}-{epoch}`
- **service**: Reference to the Service entity
- **epoch**: The epoch number
- **contractAddress**: Staking contract address
- **checkpoint**: Reference to the Checkpoint event (null until checkpoint occurs)
- **rewardAmount**: Reward earned in this epoch (0 if service didn't meet KPIs)
- **checkpointedAt**: Timestamp when the checkpoint occurred (null until checkpoint)
- **blockNumber/blockTimestamp**: When the service staked for this epoch
- **transactionHash**: Transaction hash

**Key Features**:
- Created when a service stakes for an epoch
- Updated with reward amount (or 0) when checkpoint occurs
- Tracks services that were active but didn't meet KPIs (rewardAmount = 0)
- Enables historical analysis of service performance across epochs

### Reward Management Entities

#### `Checkpoint`
Reward distribution checkpoints:
- **id**: Event identifier
- **epoch**: Checkpoint epoch
- **availableRewards**: Total available rewards
- **serviceIds**: Array of service identifiers
- **rewards**: Array of reward amounts
- **epochLength**: Duration of epoch
- **contractAddress**: Staking contract address
- **blockNumber/blockTimestamp**: Event details

#### `RewardClaimed`
Individual reward claim events:
- **id**: Event identifier
- **epoch**: Claim epoch
- **serviceId**: Service identifier
- **owner/multisig**: Claimer addresses
- **nonces**: Transaction nonces
- **reward**: Claimed reward amount
- **blockNumber/blockTimestamp**: Event details

#### `RewardUpdate`
Reward update tracking:
- **id**: Update identifier
- **type**: "Claimable" or "Claimed"
- **amount**: Reward amount
- **blockNumber/blockTimestamp**: Update details

### Deposit Management Entities

#### `Deposit`
OLAS deposit events:
- **id**: Event identifier
- **sender**: Depositor address
- **amount**: Deposit amount
- **balance**: New total balance
- **availableRewards**: Available rewards
- **blockNumber/blockTimestamp**: Event details

#### `Withdraw`
OLAS withdrawal events:
- **id**: Event identifier
- **to**: Recipient address
- **amount**: Withdrawal amount
- **blockNumber/blockTimestamp**: Event details

#### `ActiveServiceEpoch`
Tracks which services are actively staked in each epoch per contract:
- **id**: Composite identifier `{contractAddress}-{epoch}`
- **contractAddress**: Staking contract address
- **epoch**: The epoch number
- **activeServiceIds**: Array of service IDs active in this epoch
- **blockNumber/blockTimestamp**: Last update details

**Purpose**: Used internally to determine which services should receive reward history entries during checkpoint events, even if they didn't earn rewards.

### Service Management Entities

#### `ServiceInactivityWarning`
Service inactivity warnings:
- **id**: Event identifier
- **epoch**: Warning epoch
- **serviceId**: Service identifier
- **serviceInactivity**: Inactivity duration
- **blockNumber/blockTimestamp**: Event details

#### `ServiceForceUnstaked`
Forced service unstaking:
- **id**: Event identifier
- **epoch**: Unstaking epoch
- **serviceId**: Service identifier
- **owner/multisig**: Service owner addresses
- **nonces**: Transaction nonces
- **reward**: Reward amount
- **availableRewards**: Available rewards
- **blockNumber/blockTimestamp**: Event details

#### `ServicesEvicted`
Bulk service evictions:
- **id**: Event identifier
- **epoch**: Eviction epoch
- **serviceIds**: Array of service identifiers
- **owners/multisigs**: Service owner addresses
- **serviceInactivity**: Inactivity durations
- **blockNumber/blockTimestamp**: Event details

### Global Analytics

#### `Global`
Aggregate staking statistics:
- **id**: Global identifier
- **cumulativeOlasStaked**: Total OLAS ever staked
- **cumulativeOlasUnstaked**: Total OLAS ever unstaked
- **currentOlasStaked**: Currently staked OLAS
- **totalRewards**: Cumulative rewards distributed across all services
- **lastActiveDayTimestamp**: Most recent day with activity (used for forward-filling daily snapshots)
- **services**: Array of all Service entities (derived relationship)

#### `CumulativeDailyStakingGlobal`
Daily snapshots of global staking metrics:
- **id**: Day timestamp in bytes format
- **timestamp**: Beginning of the day timestamp
- **block**: Block number when snapshot was updated
- **totalRewards**: Cumulative rewards at this day
- **numServices**: Number of services in the ecosystem
- **medianCumulativeRewards**: Median of cumulative rewards across all services

**Features**:
- Forward-fills data from most recent active day for continuity
- Recalculates median from all services at each checkpoint
- Provides daily aggregated view of ecosystem health

## Key Features

### Multi-Network Support
- Deployed across 8 different networks
- Network-specific configurations and addresses
- Unified data schema across all networks

### Comprehensive Staking Tracking
- Full service lifecycle from staking to unstaking
- Reward distribution and claiming events
- Epoch-by-epoch reward history for each service
- Tracks both rewarded and non-rewarded participation
- Inactivity monitoring and enforcement
- Deposit and withdrawal management

### Real-time Analytics
- Global staking statistics with cumulative metrics
- Individual service performance metrics
- Epoch-by-epoch reward history for detailed analysis
- Daily snapshots with median calculations
- Reward distribution tracking (both earned and claimed)
- Activity monitoring and warnings
- Forward-filled daily metrics for continuous data

### Service Management
- Service staking and unstaking events
- Inactivity warnings and force unstaking
- Bulk service evictions
- Reward claiming and distribution

### Enhanced Service Tracking

The subgraph now includes comprehensive service-level analytics:

**ServiceRewardsHistory Entity**
- Records every epoch a service participates in
- Tracks reward amounts (including zero rewards when KPIs aren't met)
- Links to checkpoint events for full context
- Enables historical performance analysis per service

**Service Entity Enhancements**
- `olasRewardsClaimed`: Separate tracking of claimed vs earned rewards
- `latestStakingContract`: Identifies current staking contract (null when unstaked)
- `totalEpochsParticipated`: Counts total participation across all epochs
- `rewardsHistory`: Direct access to epoch-by-epoch performance

**Daily Aggregations**
- `CumulativeDailyStakingGlobal`: Daily snapshots of ecosystem metrics
- Forward-fills data from last active day for continuous time series
- Computes median rewards across all services for benchmarking
- Tracks service count and total rewards over time

**Active Service Tracking**
- `ActiveServiceEpoch`: Maintains list of active services per epoch
- Ensures reward history is created even when services don't earn rewards
- Properly handles service evictions and unstaking events
- Carries forward active services to next epoch automatically

## Usage Examples

### Query Staking Contracts by Network
```graphql
{
  stakingContracts(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 10
  ) {
    id
    sender
    instance
    maxNumServices
    rewardsPerSecond
    minStakingDeposit
    minStakingDuration
  }
}
```

### Get Recent Service Staking Events
```graphql
{
  serviceStakeds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 10
  ) {
    epoch
    serviceId
    owner
    multisig
    blockTimestamp
  }
}
```

### Monitor Reward Distributions
```graphql
{
  checkpoints(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 10
  ) {
    epoch
    availableRewards
    serviceIds
    rewards
    epochLength
    contractAddress
  }
}
```

### Track Global Staking Statistics
```graphql
{
  globals {
    cumulativeOlasStaked
    cumulativeOlasUnstaked
    currentOlasStaked
  }
}
```

### Get Service Performance
```graphql
{
  services(
    orderBy: olasRewardsEarned
    orderDirection: desc
    first: 10
  ) {
    id
    currentOlasStaked
    olasRewardsEarned
    olasRewardsClaimed
    latestStakingContract
    totalEpochsParticipated
    blockTimestamp
  }
}
```

### Query Service Rewards History
```graphql
{
  serviceRewardsHistories(
    where: { service: "123" }
    orderBy: epoch
    orderDirection: desc
    first: 20
  ) {
    id
    epoch
    contractAddress
    rewardAmount
    checkpointedAt
    checkpoint {
      id
      availableRewards
    }
  }
}
```

### Get Service with Complete History
```graphql
{
  service(id: "123") {
    id
    currentOlasStaked
    olasRewardsEarned
    olasRewardsClaimed
    totalEpochsParticipated
    latestStakingContract
    rewardsHistory(orderBy: epoch, orderDirection: desc, first: 50) {
      epoch
      contractAddress
      rewardAmount
      checkpointedAt
    }
  }
}
```

### Track Daily Staking Metrics
```graphql
{
  cumulativeDailyStakingGlobals(
    orderBy: timestamp
    orderDirection: desc
    first: 30
  ) {
    timestamp
    totalRewards
    numServices
    medianCumulativeRewards
    block
  }
}
```

### Monitor Reward Claims
```graphql
{
  rewardClaimeds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 10
  ) {
    epoch
    serviceId
    owner
    multisig
    reward
    blockTimestamp
  }
}
```

## Development

### Prerequisites
- Graph CLI: `yarn global add @graphprotocol/graph-cli`
- Dependencies: `yarn install`

### Building and Deploying
1. Generate types: `yarn codegen`
2. Build the subgraph: `yarn build`
3. Deploy: `graph deploy --studio [SUBGRAPH_NAME]`

### Multi-Network Deployment
The subgraph supports deployment across multiple networks:
- Network configurations are in `networks.json`
- Template-based deployment using `subgraph.template.yaml`
- Network-specific address and block configurations

### Local Development
- The subgraph uses AssemblyScript for mapping logic
- Factory events are handled in `src/staking-factory.ts`
- Proxy events are handled in `src/staking-proxy.ts`
- Utility functions are in `src/utils.ts`

## Contributing

When adding new features or modifying the subgraph:
1. Update the schema in `schema.graphql`
2. Add corresponding event handlers in the appropriate `src/` files
3. Update the subgraph configuration in `subgraph.template.yaml`
4. Update network configurations in `networks.json` if needed
5. Test thoroughly before deployment
