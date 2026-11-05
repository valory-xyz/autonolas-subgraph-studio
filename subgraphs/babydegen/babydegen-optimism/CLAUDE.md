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
│   ├── funding.ts                # USDC Transfers → handleERC20Transfer
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
│   ├── veloV2Factory.ts          # Aero v2 PoolFactory → V2PoolVenue
│   ├── aeroGaugeManager.ts       # Aero GaugeCreated → AeroGauge
│   ├── positionIncome.ts         # Collected fees and claimed rewards per position
│   ├── balancerVault.ts          # Balancer V2 pool join/exit events
│   ├── balancerShared.ts         # Balancer position value calculation
│   ├── lifiDiamond.ts            # LiFi swap tracking & slippage
│   ├── swapTracking.ts           # Swap-to-position association & cost tracking
│   ├── constants.ts              # Addresses, IDs, whitelists
│   ├── common.ts                 # User side / withdrawal rules, address types, ABI-word readers, ETH price
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
| AeroNFTManager | `0x4857DB576eE0e45F10525eC59527BfD10beeC60b` | Aero CL positions (start block 158477277) |
| Aero CL factory | `0xfeaB42D90055db3a0616249f76B6002D72266778` | Aero CL pool lookup (`AERO_NFT_MANAGER.factory()`) |
| AeroV2Stable/VolatileFactory | `0x78589E87…EF2D` / `0x8E6a9FCd…76D2` | Aero v2 pool discovery |
| AeroGaugeManager | `0xbF234b32c5e58868243A4a14831626f3EdE7b183` | `GaugeCreated` → Aero v2 pool→gauge map |

### Chainlink Price Feeds
- The `*_USD_FEED` constants in `constants.ts`, wired to tokens in `tokenConfig.ts`

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
| agentInstances | `[Bytes!]!` | Agent EOAs from `RegisterInstance` — never the user side of a funding flow |

#### ServiceIndex
Maps serviceId to current service safe (handles safe migrations).

#### ServiceRegistry
Singleton tracking all service addresses (used by portfolio scheduler for iteration).

#### AddressType
Cached EOA/contract detection (`isContract`) and Safe detection (`isSafe`, `getThreshold()` answers) to avoid repeated RPC calls.

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

Also tracks: reward tracking, unrealized PnL, and `ethAdjusted*` fields that are deprecated and equal their unadjusted counterparts.

#### AgentPortfolioSnapshot
Immutable daily snapshots at UTC midnight (id: `<serviceSafe>-<dayTimestamp>`).
Same fields as AgentPortfolio plus `timestamp`, `block`, `positionIds`.

### DeFi Positions

#### ProtocolPosition
Individual LP positions across protocols (id: `<agent>-<protocol>-<tokenId>` for CL, `<agent>-<protocol>-<pool>` for v2).
| Field | Type | Notes |
|-------|------|-------|
| protocol | `String!` | "velodrome-v3" (Velodrome CL), "velodrome-v2", "aero-cl", "aero-v2", "uniswap-v3", "balancer" |
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
| collectedFees0/1, collectedFeesUSD | `BigDecimal!` | Fee part of each `Collect` paid to the Safe (principal excluded), USD at the Collect |
| claimedRewards, claimedRewardsUSD | `BigDecimal!` | Gauge rewards claimed for this position (reward-token units), USD at the claim |
| swapSlippageUSD | `BigDecimal!` | Associated swap slippage costs |

### Token & Pricing

#### Token
Token metadata with multi-source pricing.
| Field | Type | Notes |
|-------|------|-------|
| derivedUSD | `BigDecimal!` | Current best price |
| priceSources | `[PriceSource!]!` | Available sources |
| priceConfidence | `String!` | Confidence level |
| priceStale | `Boolean!` | `derivedUSD` is the last valid price; no source gave a valid one since |
| depegged | `Boolean!` | Stablecoin (`STABLECOINS`) last priced below $0.98 |

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

### 2. Token Transfers (every whitelisted token)
**Files**: `src/funding.ts`, `src/tokenBalances.ts`
- `handleUSDC` → redirects to `handleERC20Transfer`
- `handleERC20Transfer`: Central handler for all token transfers. Updates TokenBalance with USD values, attributes gauge rewards to positions, and updates FundingBalance
- **Every tracked token and ETH counts as funding, in and out, valued at its price at the transfer.** The user side (`isUserSide`, `common.ts`) is the operator Safe, any Safe, the tx sender, or an EOA that is not one of the service's agent EOAs; the zero address (mints) and the agent EOAs never are. The tx-sender rule covers EIP-7702 wallets, which have code and are no Safe. An outflow to any other contract is a withdrawal only when the tx receipt shows nothing coming back to the Safe — no ERC-20/ERC-721 `Transfer` to it and no `SafeReceived` (`isWithdrawalRecipient`). This catches EIP-7702 wallets (they have code) and keeps swaps and LP entries out. Every Transfer and Safe handler sets `receipt: true`
- Withdrawals go to `totalWithdrawnUsd` (added back into `finalValue`); they never reduce `netUsd`
- Matchstick has no `ethereum.hasCode`, so `processERC20Transfer` / `processSafeReceived` take the address-type reader; handlers pass `getAddressType`, tests pass a reader over seeded `AddressType` rows

### 3. VeloNFTManager (Velodrome CL)
**File**: `src/veloNFTManager.ts`
- `handleNFTTransfer`: FROM zero = position created; TO zero = position closed
- `handleIncreaseLiquidity`: Updates position with new liquidity
- `handleDecreaseLiquidity`: Updates after partial withdrawal
- `handleCollect`: Records the fee part of a `Collect` paid to the Safe — the amount minus principal that `DecreaseLiquidity` released since the last collect (`UncollectedPrincipal`). Looks the position up by `<protocol>-<tokenId>` like the other handlers; a closed position is not refreshed, so its exit amounts stay
- All call `refreshVeloCLPosition()` to load current on-chain state

### 3b. AeroNFTManager (Aero CL)
**File**: `src/veloNFTManager.ts` (same handlers), `src/veloCLShared.ts`
- Aero (the merged Velodrome/Aerodrome protocol, live 2026-10-22) has its own NFPM. Its
  `IncreaseLiquidity` carries `tickLower`/`tickUpper`, so it has its own handler
  `handleAeroIncreaseLiquidity`; Transfer/Decrease/Collect reuse the Velodrome handlers.
- The emitting NFPM picks a `CLVenue` (`clVenueForManager`): manager, CL factory, reward token,
  protocol label. Mapping and position ids carry the label, so the two NFPMs' token ids never collide.
- Rewards: Aero's CLGauge has no `earned(address,uint256)`. `getAeroCLEarned` checks
  `stakedContains(agent, tokenId)` (unstaked → 0) then reads `earned(agent, [tokenId])`.
  Rewards are **xAERO**, recorded as `claimableReward` with `claimableRewardUSD = 0`: its
  Optimism pools are too thin to price.

### 4. UniV3NFTManager (Uniswap V3)
**File**: `src/uniV3NFTManager.ts`
- Same event pattern as VeloNFTManager, with the same fee accounting (`NFTPositionMapping` `uniswap-v3-<tokenId>`)
- Calls `refreshUniV3Position()` for on-chain state

### 5. VeloV2Sugar (Bootstrap)
**File**: `src/veloV2Bootstrap.ts`
- Block handler `handleVeloV2Bootstrap`: Discovers existing V2 positions at indexing start (runs once)

### 6. VeloV2Factory
**File**: `src/veloV2Bootstrap.ts`
- `handleVeloV2PoolCreated`: Discovers new V2 pools for price discovery

### 6b. Aero v2 factories + AeroGaugeManager
**Files**: `src/veloV2Factory.ts`, `src/aeroGaugeManager.ts`
- `handleAeroV2PoolCreated` (stable + volatile factories; Aero's `PoolCreated` has no indexed
  `stable`, hence `AeroV2PoolFactory.json`): whitelisted pairs get a `V2PoolVenue` row
  (`aero-v2`) and an `AeroV2Pool` template.
- Aero v2 pools have no `gauge()` and the Aero Voter has no `gauges(pool)`, so
  `handleAeroGaugeCreated` stores `AeroGauge { id: pool, gauge }` from GaugeManager
  `GaugeCreated`; the `aero-v2` branch of `resolveV2Gauge` reads it on every refresh (a later
  `GaugeCreated` replaces it).

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
- **VeloV2Pool**: Mint/Burn/Transfer for V2 position tracking. `refreshVeloV2Position` is **gauge-aware**: V2 LP staked into a Velodrome gauge leaves the safe (`pool.balanceOf(safe)==0`), so it resolves the gauge via the Velodrome **Voter** (`gauges(pool)`, `VELO_VOTER`, cached on `rewardsContract`), counts `gauge.balanceOf(safe)` as staked LP (so a staked position isn't misread as closed), and folds `gauge.earned(safe)` VELO into `usdCurrentWithRewards`. ABIs: `VeloVoter.json`, `VeloV2Gauge.json`. (CL gauge rewards already handled in `veloCLShared.ts`.)
- **AeroV2Pool**: same handlers as VeloV2Pool except `handleAeroV2Mint` — Aero pools emit
  `Mint(indexed sender, indexed to, amount0, amount1)` and have no `stable()`. Positions are
  labelled `aero-v2` via `v2ProtocolFor(pool)` (`V2PoolVenue`); rewards are xAERO (unpriced).
- **Safe**: `SafeReceived` for ETH in. ETH out is read from the Safe's own `execTransaction` calldata when the tx calls the Safe (`ethSentBySafe`, `safe.ts`): its Call's value, or each Call of a `multiSend` it delegatecalls. The outer tx's `value` is the executor's, not the Safe's. Each recipient goes through `isWithdrawalRecipient`; ETH to an agent EOA lowers value as a cost. A module execution's calldata, or an execTransaction relayed through another contract, is not readable here: its ETH is not counted and a `SAFE_ETH:` warning is logged. A send to an indexed Safe (the operator Safe) is counted once: its own `SafeReceived` skips a send the decoder already read from the same tx, and still records one sent through a relayed execution

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
      → Set the deprecated ethAdjusted* fields equal to their unadjusted values
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
  - `GrossGain = exitAmountUSD + collectedFeesUSD + claimedRewardsUSD`
  - `NetGain = GrossGain - investmentUSD`
  - `PositionROI = netGain / investment * 100`

### Claimed rewards (`src/positionIncome.ts`)
A reward Transfer into the Safe is credited to positions, never to funding:
- From a gauge (`ProtocolPosition.rewardsContract`): to the tokenId of the first `Withdraw(user = Safe, tokenId, …)` that gauge emits after it in the receipt. With no such Withdraw, a CL `getReward(tokenId)` claim is split across the Safe's active CL positions on that gauge by `claimableReward` as it stood before the block (`ClaimableRewardBeforeBlock` — a refresh in the claim's block writes it to 0), by liquidity when all are 0. A v2 gauge holds one LP position per pool.
- Aero CL (`aero-cl`): from the gauge's `EmissionsClaimed(_account, _tokenId, _recipient, _rewardAmount)` with `_recipient` = Safe: each event credits its `_tokenId` its own `_rewardAmount`. A Transfer of the Aero CL reward token (`rewardTokenFor(PROTOCOL_AERO_CL)`: xAERO here, Aero's AERO on Base) pays the not-yet-credited events, in log order, whose amounts it covers; each is credited once (`CreditedRewardClaim`). A claim not covered by the Transfer, or for a tokenId the Safe doesn't own, is skipped and logged.
- A Withdraw that names a tokenId the Safe does not track is logged and not split across its other positions. A v2 gauge reward that arrives after the position closed (a `getReward` after the exit) goes to the most recently closed v2 position on that gauge. An `EmissionsClaimed` counts only when the position's own gauge (`rewardsContract`) emitted it.
- `aero-v2`: not attributed to a position yet; a reward Transfer to a Safe that holds or held an `aero-v2` position (rewards are often claimed after the exit) logs a `REWARDS:` warning.
Fees and rewards already sit in the Safe, so portfolio `finalValue` is unchanged by them.

### ETH-Adjusted Metrics
Deprecated: every `ethAdjusted*` field equals its unadjusted counterpart. Subtracting ETH's whole price move misstated every Safe that never held ETH.

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
1. **Chainlink feeds** (primary for ETH, USDC, DAI, USDT, WBTC, sUSD)
2. **DEX pools** (Velodrome CL/SlipStream, Velodrome V2, Uniswap V3) — DOLA included. A Velodrome v2 *stable* pool is priced from its `getAmountOut` quote for one token, not its reserve ratio (wrong on a stable curve)
3. **No valid price**: the last valid price, with `priceStale = true`; a token never priced is 0. There is no $1 fallback
- Stablecoins have no lower price bound, so a depeg is recorded: `depegged` below $0.98
- A pool's pair leg is priced from its own token config, never taken as $1: its Chainlink source, else its `velodrome_v2` pool when that pool's pair leg has a feed (LUSD); otherwise the pool gives no price (`getPairTokenPrice`). Feed staleness is judged against the event's block, with a 90000s limit (24h heartbeat + grace)
- The no-floor stablecoin band ($0–1.50; USDC $0–1.05) applies to every `STABLECOINS` token
- A stable pool's `getAmountOut` quote is net of the pool's swap fee, so its price reads below the fee-free price by that fee (about 0.9995 × at Velodrome's default 5 bps stable fee)

### Caching
- 5-minute cache for token prices
- Chainlink feeds cached at contract level
- EOA detection cached in AddressType entity

### Tracked Tokens
WETH, WBTC, DAI, USDT, DOLA, BOLD (legacy `0x087c…`), LUSD, FRAX, sDAI, sUSD, USDC (Native + Bridged), USDT0, oUSDT, USDGLO, VELO,
plus the agent's BOLD `0x0356…` (Velodrome v2 stable BOLD/USDC `0x8828…`, quoted with
`getAmountOut` by the `velodrome_v2` adapter, as for every pool whose `stable()` is true, since a stable pool's
reserve ratio is not its price), USDS and xAERO. USDS and xAERO have no price source yet: tracked for balances,
valued at $0, and `getPriceFromSources` logs a warning. BOLD `0x0356…` and USDS are in `STABLECOINS`, so
`depegged` is set when they are priced below $0.98.

---

## Constants & Configuration

**File**: `src/constants.ts`

| Constant | Value | Notes |
|----------|-------|-------|
| OPTIMUS_AGENT_ID | 40 | Only this agent type is tracked |
| Excluded service IDs | [29, 37, 56, 58] | Test/development agents |
| Whitelisted tokens | 13+ tokens | See tokenConfig.ts for full list |
| Protocol names | "velodrome-v3", "velodrome-v2", "aero-cl", "aero-v2", "uniswap-v3", "balancer" | |

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
3. **Position ID format**: `<agent>-<protocol>-<tokenId>` (CL) / `<agent>-<protocol>-<pool>` (v2) — the label keeps the two NFPMs' token ids apart.
4. **ROI from closed positions only**: `calculateActualROI()` uses only closed positions. Active positions contribute to `positionsValue` and `unrealisedPnL` but not ROI.
5. **Multi-protocol support**: Velodrome CL, Velodrome V2, Aero CL, Aero v2, Uniswap V3, Balancer — each with separate handler files but unified portfolio calculation.
6. **Price discovery is multi-source**: Chainlink primary, DEX fallback, then the last valid price marked stale. No $1 fallback. 5-minute cache. Confidence scoring.
7. **Funding tracking**: Every tracked token and ETH moves `FundingBalance`, in and out, through `isUserSide` / `isWithdrawalRecipient` (receipt-based for contract recipients). Agent EOAs are never the user side.
8. **ETH-adjusted metrics**: Deprecated; equal to the unadjusted values.
9. **Swap slippage**: LiFi swaps associated with position entries within 20-min window. Time-bucket system for efficiency.
10. **Population metrics**: Daily median ROI/APR across all agents, 7-day SMA, separates "lifetime active" (>2 positions) vs stagnant agents.
11. **Safe template**: Dynamic data source created for each service safe and operator safe — tracks ETH in/out via Safe events.
12. **Block handler frequency**: Every 1800 blocks (~20 min on Optimism). Only triggers snapshots when UTC day changes.
