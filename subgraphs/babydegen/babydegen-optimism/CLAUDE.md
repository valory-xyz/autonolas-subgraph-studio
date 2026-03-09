# BabyDegen Optimism Subgraph

Tracks autonomous agent portfolio performance and population-level metrics for the BabyDegen agent economy on Optimism. Monitors agents participating in DeFi protocols (Velodrome CL, Velodrome V2, Uniswap V3, Balancer), tracking portfolio performance, position management, funding flows, and aggregated population statistics.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Schema Reference](#schema-reference)
- [Event Handlers & Data Sources](#event-handlers--data-sources)
- [Core Logic](#core-logic)
- [Price Discovery](#price-discovery)
- [Constants & Configuration](#constants--configuration)
- [Development Workflow](#development-workflow)
- [Common Queries](#common-queries)
- [AI Summary](#ai-summary)

---

## Architecture Overview

### Directory Structure
```
subgraphs/babydegen/babydegen-optimism/
├── schema.graphql                # Entity definitions
├── subgraph.yaml                 # Manifest with data sources & handlers
├── package.json                  # graph-cli ^0.97.0, graph-ts ^0.38.0, matchstick-as 0.5.0
├── src/
│   ├── serviceRegistry.ts        # Agent registration & service creation
│   ├── safe.ts                   # ETH balance tracking via Safe events
│   ├── funding.ts                # USDC funding redirect
│   ├── tokenBalances.ts          # ERC20 balance & funding flow tracking
│   ├── helpers.ts                # Portfolio metric calculations (ROI, APR, values)
│   ├── roiCalculation.ts         # Position-based ROI from closed positions
│   ├── priceDiscovery.ts         # Multi-source token pricing (Chainlink + DEX)
│   ├── tokenConfig.ts            # Token configurations & price source definitions
│   ├── portfolioScheduler.ts     # Block handler: daily snapshots & global metrics
│   ├── globalMetrics.ts          # Population-level statistics (median, SMA)
│   ├── veloNFTManager.ts         # Velodrome CL position lifecycle
│   ├── uniV3NFTManager.ts        # Uniswap V3 position lifecycle
│   ├── veloCLShared.ts           # Velodrome CL position state refresh
│   ├── uniV3Shared.ts            # Uniswap V3 position state refresh
│   ├── veloV2Shared.ts           # Velodrome V2 AMM position handling
│   ├── veloV2Bootstrap.ts        # V2 pool discovery & bootstrap
│   ├── balancerVault.ts          # Balancer V2 pool join/exit events
│   ├── balancerShared.ts         # Balancer position value calculation
│   ├── lifiDiamond.ts            # LiFi swap tracking & slippage
│   ├── swapTracking.ts           # Swap-to-position association & cost tracking
│   ├── constants.ts              # Addresses, IDs, whitelists
│   ├── common.ts                 # EOA detection, ETH price helpers
│   ├── config.ts                 # Service lookup helpers
│   └── libs/
│       ├── TickMath.ts           # Uniswap V3 tick-to-price math
│       ├── LiquidityAmounts.ts   # Liquidity-to-token-amount conversion
│       └── mostSignificantBit.ts # Bit manipulation for math
```

### Key Contracts (Optimism Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| ServiceRegistryL2 | `0x3d77596beb0f130a4415df3D2D8232B3d3D31e44` | Agent registration (start block: 124618633) |
| VeloNFTManager | `0x416b433906b1B72FA758e166e239c43d68dC6F29` | Velodrome CL positions |
| VeloCLFactory | `0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F` | Velodrome CL pool discovery |
| VeloV2Factory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | Velodrome V2 pool discovery |
| UniV3NFTManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | Uniswap V3 positions |
| UniV3Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | Uniswap V3 pool discovery |
| BalancerVault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | Balancer V2 liquidity |
| LiFiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | Swap routing & slippage |
| USDC Native | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | Funding tracking |

### Chainlink Price Feeds
- ETH/USD, USDC/USD, USDT/USD, DAI/USD (addresses in `constants.ts`)

---

## Schema Reference

### Service Management

#### Service
Registered autonomous agent service.
| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Service safe address |
| serviceId | `BigInt!` | Unique service identifier |
| serviceSafe | `Bytes!` | Agent's safe address |
| operatorSafe | `Bytes!` | Operator address |
| isActive | `Boolean!` | Current activity status |
| positions | `[ProtocolPosition!]!` | @derivedFrom |
| balances | `[TokenBalance!]!` | @derivedFrom |
| positionIds | `[String!]!` | Array of position identifiers |

#### ServiceIndex
Maps serviceId to current service safe (handles safe migrations).

#### ServiceRegistry
Singleton tracking all service addresses (used by portfolio scheduler for iteration).

#### AddressType
Cached EOA/contract detection to avoid repeated RPC calls.

### Portfolio Tracking

#### AgentPortfolio
Current portfolio metrics for an agent (id: service safe address).
| Field | Type | Notes |
|-------|------|-------|
| finalValue | `BigDecimal!` | Total current portfolio value (USD) |
| initialValue | `BigDecimal!` | Initial investment from funding |
| positionsValue | `BigDecimal!` | Current value of active positions |
| uninvestedValue | `BigDecimal!` | Token balances in safe |
| roi | `BigDecimal!` | Return on Investment % |
| apr | `BigDecimal!` | Annualized Percentage Return |
| firstTradingTimestamp | `BigInt` | When agent started trading |
| totalPositions | `Int!` | Count of active positions |

Also tracks: ETH-adjusted metrics (ROI - ETHDelta), reward tracking, unrealized PnL.

#### AgentPortfolioSnapshot
Immutable daily snapshots at UTC midnight (id: `<serviceSafe>-<dayTimestamp>`).
Same fields as AgentPortfolio plus `timestamp`, `block`, `positionIds`.

### DeFi Positions

#### ProtocolPosition
Individual LP positions across protocols (id: `<agent>-<tokenId>`).
| Field | Type | Notes |
|-------|------|-------|
| protocol | `String!` | "velodrome-cl", "velodrome-v2", "uniswap-v3", "balancer" |
| tokenId | `BigInt!` | NFT token ID for LP positions |
| isActive | `Boolean!` | Open/closed status |
| usdCurrent | `BigDecimal!` | Current USD value |
| token0/token1 | `Bytes!` | Token addresses |
| token0Symbol/token1Symbol | `String!` | Token symbols |
| amount0/amount1 | `BigInt!` | Current token amounts |
| liquidity | `BigInt!` | Current liquidity |
| entryAmountUSD | `BigDecimal!` | Initial investment |
| exitAmountUSD | `BigDecimal!` | Exit value when closed |
| tickLower/tickUpper | `BigInt` | Position range (CL positions) |
| claimableReward | `BigDecimal!` | Unclaimed rewards |
| claimableRewardUSD | `BigDecimal!` | USD value of rewards |
| swapSlippageUSD | `BigDecimal!` | Associated swap slippage costs |

### Token & Pricing

#### Token
Token metadata with multi-source pricing.
| Field | Type | Notes |
|-------|------|-------|
| derivedUSD | `BigDecimal!` | Current best price |
| priceSources | `[PriceSource!]!` | Available sources |
| priceConfidence | `String!` | Confidence level |

#### TokenBalance
Agent's token holdings (id: `<serviceSafe>-<tokenAddress>`).

#### PriceSource / PriceUpdate
Price source details and immutable price update history.

### Funding

#### FundingBalance
Tracks funding flows in/out (id: service safe address).
| Field | Type | Notes |
|-------|------|-------|
| totalInUsd | `BigDecimal!` | Total funded amount |
| totalOutUsd | `BigDecimal!` | Total outflows |
| totalWithdrawnUsd | `BigDecimal!` | Total withdrawn |
| firstInTimestamp | `BigInt` | When first funded |

### Swap Tracking

#### SwapTransaction
Individual swap events with slippage calculation.

#### SwapToEntryAssociation
Links swaps to position entries within a 20-minute window.

#### AgentSwapBuffer
Time-bucket system (4 buckets of 5 min) for efficient slippage aggregation.

### Population Analytics

#### DailyPopulationMetric
Daily population-level stats at UTC midnight (id: `<dayTimestamp>`).
| Field | Type | Notes |
|-------|------|-------|
| medianPopulationROI | `BigDecimal!` | Median ROI across all agents |
| medianPopulationAPR | `BigDecimal!` | Median APR across all agents |
| sma7dROI | `BigDecimal!` | 7-day SMA of median ROI |
| sma7dAPR | `BigDecimal!` | 7-day SMA of median APR |
| totalAgents | `Int!` | Agents included in calculation |
| historicalMedianROI/APR | `[BigDecimal!]!` | Last 7 days for SMA rolling calc |

---

## Event Handlers & Data Sources

### 1. ServiceRegistryL2
**File**: `src/serviceRegistry.ts`
- `handleRegisterInstance`: Records registration, filters by `OPTIMUS_AGENT_ID = 40`, excludes test service IDs [29, 37, 56, 58]
- `handleCreateMultisigWithAgents`: Creates Service entity, registers for snapshots, creates Safe template instances for service safe and operator safe

### 2. Token Transfers (USDC + 13 tracked tokens)
**Files**: `src/funding.ts`, `src/tokenBalances.ts`
- `handleUSDC` → redirects to `handleERC20Transfer`
- `handleERC20Transfer`: Central handler for all token transfers. Updates TokenBalance with USD values, identifies funding flows (EOA/operator → service = funding in), updates FundingBalance
- **Only USDC Native and ETH affect funding metrics**; other tokens tracked for balance only

### 3. VeloNFTManager (Velodrome CL)
**File**: `src/veloNFTManager.ts`
- `handleNFTTransfer`: FROM zero = position created; TO zero = position closed
- `handleIncreaseLiquidity`: Updates position with new liquidity
- `handleDecreaseLiquidity`: Updates after partial withdrawal
- `handleCollect`: Tracks reward collection
- All call `refreshVeloCLPosition()` to load current on-chain state

### 4. UniV3NFTManager (Uniswap V3)
**File**: `src/uniV3NFTManager.ts`
- Same event pattern as VeloNFTManager
- Calls `refreshUniV3Position()` for on-chain state

### 5. VeloV2Sugar (Bootstrap)
**File**: `src/veloV2Bootstrap.ts`
- Block handler `handleVeloV2Bootstrap`: Discovers existing V2 positions at indexing start (runs once)

### 6. VeloV2Factory
**File**: `src/veloV2Bootstrap.ts`
- `handleVeloV2PoolCreated`: Discovers new V2 pools for price discovery

### 7. PortfolioScheduler (Block Handler)
**File**: `src/portfolioScheduler.ts`
- `handleBlock`: Runs every 1800 blocks (~20 min). Checks for UTC midnight crossing, triggers portfolio snapshots and global metrics for all services

### 8. LiFiDiamond
**File**: `src/lifiDiamond.ts` → `src/swapTracking.ts`
- `handleLiFiGenericSwapCompleted`: Records swaps, calculates slippage, associates with position entries within 20-min window

### 9. BalancerVault
**File**: `src/balancerVault.ts`
- `handlePoolBalanceChanged`: Tracks Balancer V2 pool join/exit events

### 10. Dynamic Templates
- **VeloV2Pool**: Mint/Burn/Transfer for V2 position tracking
- **Safe**: SafeReceived, ExecutionSuccess, ExecutionFromModuleSuccess for ETH tracking

---

## Core Logic

### Portfolio Calculation Flow
```
handleBlock (every 1800 blocks)
  → getDayTimestamp (check UTC midnight)
  → For each service:
    → calculatePortfolioMetrics()
      → Refresh all active positions (on-chain reads)
      → calculateUninvestedValue() (sum whitelisted token balances)
      → calculateActualROI() (from closed positions only)
      → getTokenPriceUSD() (cached, multi-source)
      → Calculate ETH-adjusted metrics (ROI - ETHDelta)
    → Create AgentPortfolioSnapshot (immutable)
  → calculateGlobalMetrics()
    → Collect all agent snapshots for the day
    → Calculate median ROI, APR, unrealisedPnL
    → Separate "lifetime active" agents (>2 positions) vs stagnant
    → Compute 7-day SMA
    → Create DailyPopulationMetric
```

### ROI Calculation (`src/roiCalculation.ts`)
- `calculateActualROI()`: From closed positions only
  - Formula: `(Sum(GrossGains) - Sum(Investments) - Sum(Costs)) / (Sum(Investments) + Sum(Costs))`
- `calculatePositionROI()`: Individual position ROI when closed
  - `Investment = entryAmountUSD + totalCostsUSD`
  - `NetGain = exitAmountUSD - investmentUSD`
  - `PositionROI = netGain / investment * 100`

### ETH-Adjusted Metrics
- `ETHDelta = (CurrentEthPrice / FirstEthPrice - 1) * 100`
- `ETH-adjusted ROI = ROI - ETHDelta` (removes ETH price impact from performance)

### Swap-to-Position Association
- 20-minute window for matching swaps to position entries
- Time-bucket system (4 buckets of 5 min) for efficient storage
- Slippage aggregated in `ProtocolPosition.swapSlippageUSD`

### Position State Management
- `isActive: true` → open position, current values updated on-chain
- `isActive: false` → closed position, entry/exit amounts frozen
- Both active and closed positions used in portfolio calculations

---

## Price Discovery

**File**: `src/priceDiscovery.ts`, `src/tokenConfig.ts`

### Resolution Order
1. **Chainlink feeds** (primary for ETH, USDC, DAI, USDT)
2. **DEX pools** (Velodrome CL/SlipStream, Velodrome V2, Uniswap V3)
3. **Stablecoin fallback** (assume $1 for USDC/USDT/DAI/LUSD/DOLA)
4. **Hardcoded** ($1 for DOLA)

### Caching
- 5-minute cache for token prices
- Chainlink feeds cached at contract level
- EOA detection cached in AddressType entity

### Tracked Tokens
WETH, DAI, USDT, DOLA, BOLD, LUSD, FRAX, sDAI, USDC (Native + Bridged), USDT0, oUSDT, USDGLO, VELO

---

## Constants & Configuration

**File**: `src/constants.ts`

| Constant | Value | Notes |
|----------|-------|-------|
| OPTIMUS_AGENT_ID | 40 | Only this agent type is tracked |
| Excluded service IDs | [29, 37, 56, 58] | Test/development agents |
| Whitelisted tokens | 13+ tokens | See tokenConfig.ts for full list |
| Protocol names | "velodrome-cl", "velodrome-v2", "uniswap-v3", "balancer" | |

---

## Development Workflow

```bash
yarn install                        # Install dependencies
yarn codegen                        # Generate TS types from schema + ABIs
yarn build                          # Compile to WASM
yarn test                           # Run Matchstick tests
```

### Adding a New DeFi Protocol
1. Add ABI to root `abis/` directory
2. Add data source or template to `subgraph.yaml`
3. Create handler file in `src/` (follow pattern of `veloNFTManager.ts`)
4. Create shared position refresh logic (follow `veloCLShared.ts`)
5. Add protocol name constant to `constants.ts`
6. Update `calculatePortfolioMetrics()` in `helpers.ts` to include new protocol
7. Run `yarn codegen && yarn build`

### Adding a New Tracked Token
1. Add token address to whitelisted tokens in `constants.ts`
2. Add token config with price sources in `tokenConfig.ts`
3. Add Transfer event data source in `subgraph.yaml`
4. Run `yarn codegen && yarn build`

---

## Common Queries

### Latest Population Metrics
```graphql
{
  dailyPopulationMetrics(first: 1, orderBy: timestamp, orderDirection: desc) {
    medianPopulationROI
    medianPopulationAPR
    sma7dROI
    sma7dAPR
    totalAgents
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
    entryAmountUSD
    claimableRewardUSD
  }
}
```

---

## AI Summary

### Critical Points
1. **Agent filtering**: Only `OPTIMUS_AGENT_ID = 40` tracked. Test services [29, 37, 56, 58] excluded at registration.
2. **Portfolio snapshots**: Immutable daily snapshots created at UTC midnight via block handler (every 1800 blocks). ID format: `<serviceSafe>-<dayTimestamp>`.
3. **Position ID format**: `<agent>-<tokenId>` — unique per agent + NFT token combination.
4. **ROI from closed positions only**: `calculateActualROI()` uses only closed positions. Active positions contribute to `positionsValue` and `unrealisedPnL` but not ROI.
5. **Multi-protocol support**: Velodrome CL, Velodrome V2, Uniswap V3, Balancer — each with separate handler files but unified portfolio calculation.
6. **Price discovery is multi-source**: Chainlink primary, DEX fallback, stablecoin fallback. 5-minute cache. Confidence scoring.
7. **Funding tracking**: Only USDC Native and ETH affect `FundingBalance`. Other tokens tracked for balance only. Funding direction determined by EOA/operator detection.
8. **ETH-adjusted metrics**: Separates agent alpha from ETH price movement. `ETHDelta = (currentEthPrice/firstEthPrice - 1) * 100`.
9. **Swap slippage**: LiFi swaps associated with position entries within 20-min window. Time-bucket system for efficiency.
10. **Population metrics**: Daily median ROI/APR across all agents, 7-day SMA, separates "lifetime active" (>2 positions) vs stagnant agents.
11. **Safe template**: Dynamic data source created for each service safe and operator safe — tracks ETH in/out via Safe events.
12. **Block handler frequency**: Every 1800 blocks (~20 min on Optimism). Only triggers snapshots when UTC day changes.
