# BabyDegen Subgraph

This subgraph tracks agent portfolio performance and population-level metrics for the BabyDegen agent economy on Optimism. It monitors autonomous agents participating in DeFi protocols, tracking their portfolio performance, position management, and providing aggregated population statistics.

## Overview

The BabyDegen subgraph provides real-time indexing of autonomous agent activities, tracking:

- **Portfolio Performance**: Real-time unrealised PnL calculations with ETH-adjusted metrics
- **DeFi Positions**: Multi-protocol position tracking across Velodrome CL, Velodrome V2, Uniswap V3, and Balancer V2
- **Token Management**: Balance tracking and uninvested fund monitoring
- **Population Analytics**: Daily median metrics with lifetime active agent segmentation
- **Daily Snapshots**: UTC midnight portfolio snapshots for historical analysis
- **Funding Tracking**: USDC and ETH funding balance monitoring with withdrawal tracking

## Data Sources

The subgraph monitors contracts on **Optimism Mainnet**:

### Core Contracts
- **ServiceRegistryL2**: `0x3d77596beb0f130a4415df3D2D8232B3d3D31e44` (Block: 124618633)
- **Safe**: Dynamic multisig wallet tracking via templates
- **USDC Native**: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` (funding tracking)

### DeFi Protocol Contracts
- **Velodrome NFT Manager**: `0x416b433906b1B72FA758e166e239c43d68dC6F29`
- **Velodrome CL Factory**: `0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F`
- **Velodrome V2 Factory**: `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a`
- **Uniswap V3 NFT Manager**: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
- **Uniswap V3 Factory**: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- **Balancer V2 Vault**: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`

### Price Oracle Contracts
- **Chainlink Price Feeds**: ETH/USD, USDC/USD, USDT/USD, DAI/USD
- **DEX Pools**: Velodrome V2, Velodrome CL, and Balancer V2 pools for price discovery

## Events Tracking

The subgraph monitors specific events from each protocol to track agent activities:

### Core Service Events
**ServiceRegistryL2** (`0x3d77596beb0f130a4415df3D2D8232B3d3D31e44`)
- `CreateMultisigWithAgents(indexed uint256,indexed address)` - Service multisig creation
- `RegisterInstance(indexed address,indexed uint256,indexed address,uint256)` - Service registration

### Funding and Token Balance Events
**USDC Native** (`0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`)
- `Transfer(indexed address,indexed address,uint256)` - USDC funding flows

**Token Contracts** (WETH, DAI, USDT, DOLA, BOLD, LUSD, FRAX, sDAI, USDC.e, USDT0, oUSDT, USDGLO)
- `Transfer(indexed address,indexed address,uint256)` - Token balance tracking

### DeFi Protocol Events

#### Velodrome Concentrated Liquidity
**Velodrome NFT Manager** (`0x416b433906b1B72FA758e166e239c43d68dC6F29`)
- `IncreaseLiquidity(indexed uint256,uint128,uint256,uint256)` - Position liquidity additions
- `DecreaseLiquidity(indexed uint256,uint128,uint256,uint256)` - Position liquidity removals
- `Collect(indexed uint256,address,uint256,uint256)` - Fee collection
- `Transfer(indexed address,indexed address,indexed uint256)` - NFT transfers

#### Uniswap V3
**Uniswap V3 NFT Manager** (`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`)
- `IncreaseLiquidity(indexed uint256,uint128,uint256,uint256)` - Position liquidity additions
- `DecreaseLiquidity(indexed uint256,uint128,uint256,uint256)` - Position liquidity removals
- `Collect(indexed uint256,address,uint256,uint256)` - Fee collection
- `Transfer(indexed address,indexed address,indexed uint256)` - NFT transfers

#### Velodrome V2 AMM
**Velodrome V2 Factory** (`0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a`)
- `PoolCreated(indexed address,indexed address,indexed bool,address,uint256)` - New pool creation

**Velodrome V2 Pools** (Dynamic via templates)
- `Mint(indexed address,uint256,uint256)` - Liquidity provision
- `Burn(indexed address,indexed address,uint256,uint256)` - Liquidity removal
- `Transfer(indexed address,indexed address,uint256)` - LP token transfers

#### Balancer V2
**Balancer V2 Vault** (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`)
- `PoolBalanceChanged(indexed bytes32,indexed address,address[],int256[],uint256[])` - Pool balance changes

### Safe Events
**Safe Contracts** (Dynamic via templates)
- `SafeReceived(indexed address,uint256)` - ETH received by safe
- `ExecutionSuccess(bytes32,uint256)` - Successful transaction execution
- `ExecutionFromModuleSuccess(indexed address)` - Module execution success

### Bootstrap and Discovery Events
**Velodrome V2 Sugar** (`0xA64db2D254f07977609def75c3A7db3eDc72EE1D`)
- Block handler for initial pool discovery (runs once)

**Portfolio Scheduler**
- Block handler for portfolio snapshots

## Entities

### Service Management Entities

#### `Service`
Represents a registered autonomous agent service:
- **serviceId**: Unique service identifier
- **serviceSafe**: Agent's safe address
- **operatorSafe**: Operator address
- **isActive**: Current activity status
- **positions**: Array of DeFi positions
- **balances**: Token balance tracking
- **positionIds**: Array of position identifiers for iteration
- **latestRegistrationTimestamp**: Latest service registration time
- **latestMultisigTimestamp**: Latest multisig creation time

#### `ServiceRegistration` & `ServiceIndex`
Service registration tracking and indexing for service lifecycle management.

#### `AddressType`
Cached address type checking (EOA vs Contract) for performance optimization.

### Funding and Balance Entities

#### `FundingBalance`
Tracks funding flows for each service:
- **totalInUsd**: Total USDC funding received
- **totalOutUsd**: Total USDC funding sent out
- **totalWithdrawnUsd**: Total USDC withdrawn to EOAs (separate tracking)
- **netUsd**: Net funding balance (totalIn - totalOut)
- **firstInTimestamp**: First funding timestamp

#### `TokenBalance`
Agent token balance tracking:
- **balance**: Token amount
- **balanceUSD**: USD value using price discovery
- **symbol**: Token symbol
- **decimals**: Token decimals
- **lastUpdated**: Last update timestamp

### Portfolio Tracking Entities

#### `AgentPortfolio`
Tracks an agent's overall portfolio performance with enhanced metrics:
- **finalValue**: Total current value (positions + uninvested + withdrawn)
- **initialValue**: Initial investment from FundingBalance
- **positionsValue**: Current value of all active positions
- **uninvestedValue**: Token balances in safe
- **totalWithdrawnUsd**: Total amount withdrawn to EOAs
- **unrealisedPnL**: Current portfolio-based unrealised PnL
- **projectedUnrealisedPnL**: APR calculated from unrealised PnL
- **ethAdjustedUnrealisedPnL**: ETH-adjusted unrealised PnL
- **ethAdjustedProjectedUnrealisedPnL**: ETH-adjusted projected unrealised PnL
- **firstFundingEthPrice**: ETH price at first funding
- **currentEthPrice**: Current ETH price
- **firstTradingTimestamp**: When agent started trading
- **totalPositions**: Count of active positions
- **totalClosedPositions**: Count of closed positions

#### `AgentPortfolioSnapshot`
Daily immutable snapshots with ETH-adjusted metrics:
- **timestamp**: UTC midnight snapshot time
- **finalValue/initialValue**: Portfolio values at snapshot
- **unrealisedPnL/projectedUnrealisedPnL**: Unrealized performance metrics
- **ethAdjustedUnrealisedPnL/ethAdjustedProjectedUnrealisedPnL**: ETH-adjusted unrealized metrics
- **totalPositions/totalClosedPositions**: Position counts
- **positionIds**: Active position identifiers at snapshot

### DeFi Position Entities

#### `ProtocolPosition`
Individual DeFi positions across supported protocols:
- **protocol**: "velodrome-cl", "velodrome-v2", "uniswap-v3", or "balancer"
- **tokenId**: NFT token ID for LP positions (0 for Velodrome V2)
- **isActive**: Position status (open/closed)
- **usdCurrent**: Current USD value
- **token0/token1**: Token addresses and symbols
- **amount0/amount1**: Current token amounts
- **amount0USD/amount1USD**: Current USD values
- **liquidity**: Current liquidity amount
- **tickLower/tickUpper**: Position range (CL positions)
- **tickSpacing**: Tick spacing (Velodrome CL)
- **fee**: Fee tier (Uniswap V3) or pool type indicator
- **entryTxHash/entryTimestamp**: Entry transaction details
- **entryAmount0/entryAmount1**: Initial token amounts
- **entryAmount0USD/entryAmount1USD**: Initial USD values
- **entryAmountUSD**: Total initial investment
- **exitTxHash/exitTimestamp**: Exit transaction details (when closed)
- **exitAmount0/exitAmount1**: Final token amounts withdrawn
- **exitAmount0USD/exitAmount1USD**: Final USD values
- **exitAmountUSD**: Total exit value

### Token and Price Entities

#### `Token`
Token metadata and pricing:
- **symbol/name**: Token identifiers
- **decimals**: Token precision
- **derivedUSD**: Current best price
- **priceSources**: Available price sources
- **priceConfidence**: Current price confidence level
- **lastPriceUpdate**: Last price update timestamp

#### `PriceSource`
Price source configuration:
- **sourceType**: "chainlink", "uniswap_v3", "velodrome_v2", "velodrome_slipstream", "balancer_v2"
- **priority**: Source priority (1 = highest)
- **isActive**: Source status
- **confidence**: Confidence score (0-1)

#### `PriceUpdate`
Historical price updates:
- **priceUSD**: Price in USD
- **source**: Price source used
- **confidence**: Price confidence
- **timestamp**: Update timestamp

### Population Analytics Entities

#### `DailyPopulationMetric`
Comprehensive daily population-level metrics calculated at UTC midnight:

**Core Population Metrics:**
- **medianUnrealisedPnL**: Median unrealised PnL across all agents
- **medianProjectedUnrealisedPnL**: Median projected unrealised PnL across all agents

**ETH-Adjusted Population Metrics:**
- **medianEthAdjustedUnrealisedPnL**: Median ETH-adjusted unrealised PnL
- **medianEthAdjustedProjectedUnrealisedPnL**: Median ETH-adjusted projected unrealised PnL

**Lifetime Active Agent Metrics (>2 positions):**
- **medianLifetimeActiveUnrealisedPnL**: Median unrealised PnL for lifetime active agents
- **medianLifetimeActiveProjectedUnrealisedPnL**: Median projected unrealised PnL for lifetime active agents
- **medianLifetimeActiveEthAdjustedUnrealisedPnL**: Median ETH-adjusted unrealised PnL for lifetime active agents
- **medianLifetimeActiveEthAdjustedProjectedUnrealisedPnL**: Median ETH-adjusted projected unrealised PnL for lifetime active agents
- **medianLifetimeActiveAUM**: Median AUM for lifetime active agents
- **totalLifetimeActiveFundedAUM**: Total funded AUM for lifetime active agents
- **totalLifetimeActiveAgents**: Number of lifetime active agents

**AUM and Staking Metrics:**
- **totalFundedAUM**: Sum of all funding balances across active services
- **medianAUM**: Median AUM across all active agents
- **averageAgentDaysActive**: Average time since agents started (for annualization)

**7-Day Simple Moving Averages:**
- **sma7dUnrealisedPnL/sma7dProjectedUnrealisedPnL**: 7-day SMAs of unrealized metrics
- **sma7dEthAdjustedUnrealisedPnL/sma7dEthAdjustedProjectedUnrealisedPnL**: 7-day SMAs of ETH-adjusted unrealized metrics
- **sma7dLifetimeActive...**: 7-day SMAs for lifetime active agent metrics
- **sma7dAUM**: 7-day SMA of median AUM

**Historical Data Arrays:**
- **historicalMedianUnrealisedPnL/historicalMedianProjectedUnrealisedPnL**: Arrays storing last 7 days of values for SMA calculations
- **historicalMedianEthAdjusted...**: Arrays for ETH-adjusted historical data
- **historicalMedianLifetimeActive...**: Arrays for lifetime active agent historical data

**Metadata:**
- **timestamp**: UTC midnight timestamp
- **block**: Block number when calculated

## Key Features

### Portfolio Analytics
- Real-time unrealised PnL calculations with time-based annualization
- ETH-adjusted metrics to account for ETH price movements
- Comprehensive position value tracking across multiple protocols

### Advanced Population Insights
- Daily calculation of population-wide metrics
- ETH-adjusted population metrics
- 7-day moving averages for trend analysis across all metric categories
- AUM tracking for staking APR calculations

### Multi-Protocol Support
- Unified tracking across Velodrome CL, Velodrome V2, Uniswap V3, and Balancer V2
- Protocol-specific position metadata (ticks, fees, etc.)
- Consistent position lifecycle tracking across all protocols

### Price Discovery
- Multi-source pricing with Chainlink integration and DEX fallbacks
- Confidence scoring for price reliability

## Usage Examples

### Latest Population Metrics with ETH-Adjusted Data
```graphql
{
  dailyPopulationMetrics(first: 1, orderBy: timestamp, orderDirection: desc) {
    medianUnrealisedPnL
    medianProjectedUnrealisedPnL
    medianEthAdjustedUnrealisedPnL
    medianEthAdjustedProjectedUnrealisedPnL
    sma7dUnrealisedPnL
    sma7dProjectedUnrealisedPnL
    sma7dEthAdjustedUnrealisedPnL
    sma7dEthAdjustedProjectedUnrealisedPnL
    totalAgents
    timestamp
  }
}
```

### Lifetime Active Agent Metrics
```graphql
{
  dailyPopulationMetrics(first: 1, orderBy: timestamp, orderDirection: desc) {
    medianLifetimeActiveUnrealisedPnL
    medianLifetimeActiveProjectedUnrealisedPnL
    medianLifetimeActiveEthAdjustedUnrealisedPnL
    medianLifetimeActiveEthAdjustedProjectedUnrealisedPnL
    medianLifetimeActiveAUM
    totalLifetimeActiveFundedAUM
    totalLifetimeActiveAgents
    sma7dLifetimeActiveUnrealisedPnL
    sma7dLifetimeActiveProjectedUnrealisedPnL
    timestamp
  }
}
```

### Agent Portfolio Performance with ETH-Adjusted Metrics
```graphql
{
  agentPortfolio(id: "0x...") {
    finalValue
    initialValue
    positionsValue
    uninvestedValue
    totalWithdrawnUsd
    unrealisedPnL
    projectedUnrealisedPnL
    ethAdjustedUnrealisedPnL
    ethAdjustedProjectedUnrealisedPnL
    firstFundingEthPrice
    currentEthPrice
    totalPositions
    totalClosedPositions
    firstTradingTimestamp
  }
}
```

### Active Position Analysis
```graphql
{
  protocolPositions(
    where: { agent: "0x...", isActive: true }
    orderBy: usdCurrent
    orderDirection: desc
  ) {
    protocol
    tokenId
    token0Symbol
    token1Symbol
    usdCurrent
    amount0
    amount1
    amount0USD
    amount1USD
    entryAmountUSD
    entryTimestamp
  }
}
```

### Funding Balance Tracking
```graphql
{
  fundingBalance(id: "0x...") {
    totalInUsd
    totalOutUsd
    totalWithdrawnUsd
    netUsd
    firstInTimestamp
    lastChangeTs
  }
}
```

### Token Balance Overview
```graphql
{
  tokenBalances(where: { service: "0x..." }) {
    token
    symbol
    balance
    balanceUSD
    decimals
    lastUpdated
  }
}
```

### Population Trend Analysis (30 days)
```graphql
{
  dailyPopulationMetrics(
    first: 30
    orderBy: timestamp
    orderDirection: desc
  ) {
    medianUnrealisedPnL
    medianProjectedUnrealisedPnL
    medianEthAdjustedUnrealisedPnL
    medianEthAdjustedProjectedUnrealisedPnL
    sma7dUnrealisedPnL
    sma7dProjectedUnrealisedPnL
    sma7dEthAdjustedUnrealisedPnL
    sma7dEthAdjustedProjectedUnrealisedPnL
    totalAgents
    timestamp
  }
}
```

### Top Performing Agents by Unrealised PnL
```graphql
{
  agentPortfolios(
    orderBy: unrealisedPnL
    orderDirection: desc
    first: 10
    where: { finalValue_gt: "100" }
  ) {
    service {
      serviceId
    }
    finalValue
    initialValue
    unrealisedPnL
    projectedUnrealisedPnL
    ethAdjustedUnrealisedPnL
    ethAdjustedProjectedUnrealisedPnL
    totalPositions
    totalClosedPositions
  }
}
```

## Development

### Prerequisites
- Graph CLI: `yarn global add @graphprotocol/graph-cli`
- Dependencies: `yarn install`

### Building and Deploying
1. Generate types: `yarn codegen-babydegen-optimism`
2. Build the subgraph: `yarn build-babydegen-optimism`
3. Deploy: `graph deploy --studio [SUBGRAPH_NAME]`

### Local Development
The subgraph uses AssemblyScript for mapping logic with the following key modules:

**Core Event Handlers:**
- `src/serviceRegistry.ts`: Service registration and multisig creation
- `src/safe.ts`: ETH transfer tracking for funding
- `src/funding.ts`: USDC funding balance tracking
- `src/tokenBalances.ts`: Token balance management

**DeFi Protocol Handlers:**
- `src/veloNFTManager.ts`: Velodrome CL position management
- `src/veloCLShared.ts`: Velodrome CL shared utilities
- `src/veloV2Pool.ts`: Velodrome V2 AMM position tracking
- `src/veloV2Shared.ts`: Velodrome V2 shared utilities
- `src/uniV3NFTManager.ts`: Uniswap V3 position management
- `src/uniV3Shared.ts`: Uniswap V3 shared utilities
- `src/balancerVault.ts`: Balancer V2 position tracking
- `src/balancerShared.ts`: Balancer V2 shared utilities

**Analytics and Calculations:**
- `src/helpers.ts`: Portfolio calculations and metrics
- `src/globalMetrics.ts`: Population-level metric calculations
- `src/portfolioScheduler.ts`: Daily snapshot scheduling

**Price Discovery:**
- `src/priceDiscovery.ts`: Multi-source price aggregation
- `src/priceAdapters.ts`: Protocol-specific price adapters
- `src/tokenConfig.ts`: Token configuration and price sources

**Utilities:**
- `src/config.ts`: Service configuration and lookup
- `src/constants.ts`: Network-specific constants
- `src/common.ts`: Shared utility functions
- `src/tokenUtils.ts`: Token metadata utilities

### Key Architecture Features

**Performance Optimizations:**
- Cached address type checking (EOA vs Contract)
- Pool address caching for NFT positions
- 5-minute price caching with confidence scoring

**Data Integrity:**
- Comprehensive position lifecycle tracking
- ETH price tracking for macro-economic adjustments
- Separate tracking of unrealized performance metrics

**Scalability:**
- Dynamic service discovery and registration
- Template-based contract tracking
- Efficient position ID management

## Contributing

When adding new features or modifying the subgraph:
1. Update the schema in `schema.graphql`
2. Add corresponding event handlers in the appropriate `src/` files
3. Update the subgraph configuration in `subgraph.yaml`
4. Test thoroughly before deployment
