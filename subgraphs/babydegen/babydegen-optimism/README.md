# BabyDegen Subgraph

This subgraph tracks agent portfolio performance and population-level metrics for the BabyDegen agent economy on Optimism. It monitors autonomous agents participating in DeFi protocols, tracking their portfolio performance, position management, and providing aggregated population statistics.

## Overview

The BabyDegen subgraph provides real-time indexing of autonomous agent activities, tracking:

- **Portfolio Performance**: Real-time ROI and APR calculations for each agent
- **DeFi Positions**: Multi-protocol position tracking across Velodrome and Uniswap V3
- **Token Management**: Balance tracking and uninvested fund monitoring
- **Population Analytics**: Daily median metrics and 7-day moving averages
- **Daily Snapshots**: UTC midnight portfolio snapshots for historical analysis

## Data Sources

The subgraph monitors contracts on **Optimism Mainnet**:

### Core Contracts
- **ServiceRegistryL2**: `0x3d77596beb0f130a4415df3D2D8232B3d3D31e44` (Block: 124618633)
- **Safe**: Dynamic multisig wallet tracking via templates

### DeFi Protocol Contracts
- **Velodrome NFT Manager**: `0x416b433906b1B72FA758e166e239c43d68dC6F29`
- **Velodrome CL Factory**: `0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F`
- **Uniswap V3 NFT Manager**: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
- **Uniswap V3 Factory**: `0x1F98431c8aD98523631AE4a59f267346ea31F984`

### Price Oracle Contracts
- **Chainlink Price Feeds**: ETH/USD, USDC/USD, USDT/USD, DAI/USD
- **DEX Pools**: Velodrome V2 and CL pools for price discovery

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
- **positionIds**: Array of position identifiers

#### `ServiceRegistry`
Singleton registry tracking all services:
- **serviceAddresses**: Array of all registered service addresses

### Portfolio Tracking Entities

#### `AgentPortfolio`
Tracks an agent's overall portfolio performance:
- **finalValue**: Total current portfolio value (USD)
- **initialValue**: Initial investment from funding
- **positionsValue**: Current value of active positions
- **uninvestedValue**: Token balances in safe
- **roi**: Return on Investment percentage
- **apr**: Annualized Percentage Return
- **firstTradingTimestamp**: When agent started trading
- **totalPositions**: Count of active positions

#### `AgentPortfolioSnapshot`
Daily immutable snapshots of agent portfolio performance:
- **timestamp**: UTC midnight snapshot time
- **finalValue/initialValue**: Portfolio values at snapshot
- **roi/apr**: Performance metrics at snapshot
- **totalPositions**: Number of active positions
- **positionIds**: Active position identifiers at snapshot

### DeFi Position Entities

#### `ProtocolPosition`
Individual DeFi positions across supported protocols:
- **protocol**: "velodrome-cl", "velodrome-v2", or "uniswap-v3"
- **tokenId**: NFT token ID for LP positions
- **isActive**: Position status (open/closed)
- **usdCurrent**: Current USD value
- **token0/token1**: Token addresses and symbols
- **amount0/amount1**: Current token amounts
- **liquidity**: Current liquidity amount
- **entryAmountUSD**: Initial investment amount
- **exitAmountUSD**: Exit value when closed
- **tickLower/tickUpper**: Position range (CL positions)

### Token and Price Entities

#### `Token`
Token metadata and pricing:
- **symbol/name**: Token identifiers
- **decimals**: Token precision
- **derivedUSD**: Current best price
- **priceSources**: Available price sources
- **priceConfidence**: Current price confidence level

#### `TokenBalance`
Agent token balance tracking:
- **balance**: Token amount
- **balanceUSD**: USD value
- **lastUpdated**: Last update timestamp

### Population Analytics Entities

#### `Global`
Population-level metrics calculated daily:
- **medianPopulationROI**: Median ROI across all agents
- **medianPopulationAPR**: Median APR across all agents
- **sma7dROI**: 7-day simple moving average of median ROI
- **sma7dAPR**: 7-day simple moving average of median APR
- **totalAgents**: Number of agents included in calculation
- **historicalMedianROI**: Last 7 days of median ROI values
- **historicalMedianAPR**: Last 7 days of median APR values
- **timestamp**: UTC midnight timestamp
- **block**: Block number when calculated

## Key Features

### Portfolio Analytics
The subgraph provides comprehensive portfolio tracking with real-time performance calculations and time-based annualization.

### Population Insights
Daily calculation of population-wide metrics including median ROI/APR and 7-day moving averages for trend analysis.

### Multi-Protocol Support
Unified tracking across Velodrome Concentrated Liquidity, Velodrome V2 AMM, and Uniswap V3 protocols.

### Price Discovery
Multi-source pricing with Chainlink integration and DEX fallbacks for comprehensive token price coverage.

## Usage Examples

### Latest Population Metrics
```graphql
{
  globals(first: 1, orderBy: timestamp, orderDirection: desc) {
    medianPopulationROI
    medianPopulationAPR
    sma7dROI
    sma7dAPR
    totalAgents
    timestamp
  }
}
```

### Population Trend Analysis
```graphql
{
  globals(
    first: 30
    orderBy: timestamp
    orderDirection: desc
  ) {
    medianPopulationROI
    medianPopulationAPR
    sma7dROI
    sma7dAPR
    timestamp
  }
}
```

### Agent Portfolio Performance
```graphql
{
  agentPortfolio(id: "0x...") {
    finalValue
    initialValue
    positionsValue
    uninvestedValue
    roi
    apr
    totalPositions
    firstTradingTimestamp
  }
}
```

### Agent Portfolio History
```graphql
{
  agentPortfolioSnapshots(
    where: { service: "0x..." }
    orderBy: timestamp
    orderDirection: desc
    first: 30
  ) {
    timestamp
    finalValue
    initialValue
    roi
    apr
    totalPositions
  }
}
```

### Active DeFi Positions
```graphql
{
  protocolPositions(
    where: { agent: "0x...", isActive: true }
    orderBy: usdCurrent
    orderDirection: desc
  ) {
    protocol
    tokenId
    usdCurrent
    token0Symbol
    token1Symbol
    amount0
    amount1
    entryAmountUSD
  }
}
```

### Top Performing Agents
```graphql
{
  agentPortfolios(
    orderBy: roi
    orderDirection: desc
    first: 10
    where: { finalValue_gt: "100" }
  ) {
    service {
      serviceId
    }
    finalValue
    initialValue
    roi
    apr
    totalPositions
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
- The subgraph uses AssemblyScript for mapping logic
- Service events are handled in `src/serviceRegistry.ts`
- Safe events are handled in `src/safe.ts`
- Portfolio calculations are in `src/helpers.ts`
- Global metrics are calculated in `src/globalMetrics.ts`
- Daily scheduling is managed in `src/portfolioScheduler.ts`

## Contributing

When adding new features or modifying the subgraph:
1. Update the schema in `schema.graphql`
2. Add corresponding event handlers in the appropriate `src/` files
3. Update the subgraph configuration in `subgraph.yaml`
4. Test thoroughly before deployment
