# Liquidity L2 Subgraph — Technical Reference

Tracks Balancer V2 pool reserves and BPT (Balancer Pool Token) supply for OLAS liquidity pools across 6 L2 chains (including 2 pools on Base in one subgraph). Uses the template pattern for multi-network deployment.

Part of the broader POL (Protocol Owned Liquidity) tracking system. See [../liquidity/README.md](../liquidity/README.md) for the full POL picture.

## Architecture Overview

### Directory Structure
```
subgraphs/liquidity-l2/
├── schema.graphql
├── subgraph.template.yaml           # Template with {{ network }}, {{ BalancerPool.address }}, {{ BalancerPool.startBlock }}
├── networks.json                    # Per-network pool addresses and start blocks
├── subgraph.{network}.yaml          # Generated per-network manifests (4 networks) + manual base/celo
├── src/
│   ├── mapping.ts                   # BPT Transfer handler with Vault contract calls
│   └── utils.ts                     # Constants, helpers, get-or-create
├── tests/
│   ├── mapping.test.ts              # 7 Matchstick tests
│   ├── mapping-utils.ts             # Event factory (createBPTTransferEvent)
│   └── test-helpers.ts              # Test constants, pool ID
├── package.json                     # graph-cli ^0.97.0, graph-ts ^0.38.0
└── tsconfig.json
```

### Supported Networks

5 pools are Balancer V2 Weighted Pools (50/50), using the Balancer V2 Vault at `0xBA12222222228d8Ba445958a75a0704d566BF2C8`. Celo is an **Ubeswap (UniswapV2)** pair — handled as a special case with a manual manifest.

| Network | Pool (LP) Address | Pair | DEX | Start Block |
|---------|-------------------|------|-----|-------------|
| Gnosis | `0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985` | OLAS-WXDAI | Balancer V2 | 30,396,445 |
| Polygon (matic) | `0x62309056c759c36879Cde93693E7903bF415E4Bc` | OLAS-WMATIC | Balancer V2 | 51,626,717 |
| Arbitrum One | `0xAF8912a3C4f55a8584B67DF30ee0dDf0e60e01f8` | OLAS-WETH | Balancer V2 | 175,754,394 |
| Optimism | `0x5bb3e58887264b667f915130fd04bbb56116c278` | WETH-OLAS | Balancer V2 | 117,547,761 |
| Base (pool 1) | `0x5332584890d6e415a6dc910254d6430b8aab7e69` | OLAS-USDC | Balancer V2 | 12,416,046 |
| Base (pool 2) | `0x2da6e67C45aF2aaA539294D9FA27ea50CE4e2C5f` | WETH-OLAS | Balancer V2 | 23,026,768 |
| Celo | `0x2976Fa805141b467BCBc6334a69AffF4D914d96A` | CELO-OLAS | Ubeswap (UniswapV2) | 27,100,181 |

---

## Schema Reference

### PoolMetrics (mutable)
Singleton per network — tracks pool reserves and BPT supply.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Pool (BPT) contract address |
| poolId | `Bytes!` | Balancer V2 pool ID (bytes32), fetched via `pool.getPoolId()` |
| token0 | `Bytes!` | First token address, from `vault.getPoolTokens()` |
| token1 | `Bytes!` | Second token address |
| reserve0 | `BigInt!` | First token balance in pool (wei) |
| reserve1 | `BigInt!` | Second token balance in pool (wei) |
| totalSupply | `BigInt!` | BPT total supply (minted - burned) |
| totalMinted | `BigInt!` | Cumulative BPT minted |
| totalBurned | `BigInt!` | Cumulative BPT burned |
| cumulativeFeesToken0 | `BigInt!` | All-time cumulative fees in token0 (wei) |
| cumulativeFeesToken1 | `BigInt!` | All-time cumulative fees in token1 (wei) |
| swapFeePercentage | `BigInt!` | Cached Balancer swap fee % (18 decimals); 0 on Celo |
| lastUpdatedBlock | `BigInt!` | |
| lastUpdatedTimestamp | `BigInt!` | |
| lastUpdatedTransaction | `Bytes!` | |

### DailyFees (mutable)
Daily swap fee aggregation.

| Field | Type | Notes |
|-------|------|-------|
| id | `ID!` | UTC midnight timestamp string |
| dayTimestamp | `BigInt!` | UTC midnight: `timestamp / 86400 * 86400` |
| totalFeesToken0 | `BigInt!` | Daily fees in token0 (wei) |
| totalFeesToken1 | `BigInt!` | Daily fees in token1 (wei) |
| swapCount | `Int!` | Number of swaps this day |

### BPTTransfer (immutable)
Individual BPT transfer event.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| from | `Bytes!` | Sender address |
| to | `Bytes!` | Recipient address |
| value | `BigInt!` | BPT transferred (wei) |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

---

## Event Handlers

### handleBPTTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

Shared handler for all 7 deployments (both Balancer and Ubeswap pools). On each LP Transfer:
1. Creates immutable `BPTTransfer` entity
2. **Mint detection**: `from == 0x0` → increments `totalSupply` and `totalMinted`
3. **Burn detection**: `to == 0x0` → decrements `totalSupply`, increments `totalBurned`
4. **Reserve fetch (mint/burn only, Balancer chains)**: On mint or burn, calls `pool.getPoolId()` then `vault.getPoolTokens(poolId)` to get absolute token balances. On Celo (Ubeswap), these calls fail silently via `try_` — reserves come from `handleUniswapSync` instead.
5. Updates `PoolMetrics` with fresh reserves, token addresses, and supply

### handleUniswapSync
**File**: `src/mapping.ts` | **Event**: `Sync(uint112, uint112)` | **Celo only**

Handles reserve updates for the Celo Ubeswap (UniswapV2) pool:
1. Reads `reserve0` and `reserve1` directly from the Sync event params
2. On first invocation, populates `token0`/`token1` addresses via `pair.token0()`/`pair.token1()` contract calls
3. Fetches CELO/USD from Chainlink on Celo (`0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e`) with 1-hour staleness caching, stores in `PriceData("celo-usd")` and `poolMetrics.celoUsdPrice`
4. Updates `PoolMetrics` with fresh reserves and timestamp

### handleVaultSwap
**File**: `src/mapping.ts` | **Event**: `Swap(indexed bytes32, indexed address, indexed address, uint256, uint256)` | **Balancer chains only**

Handles swap events from the Balancer V2 Vault contract (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`):
1. Derives pool address from `poolId` (first 20 bytes) and loads `PoolMetrics` — if no entity exists (no prior mint/burn), returns immediately (prevents creating orphan entities for unrelated pools)
2. Checks `poolId` matches — returns if different (skips non-matching swaps)
3. Reads `swapFeePercentage` from pool (cached on `PoolMetrics`, fetched via `pool.getSwapFeePercentage()`)
4. Computes fee: `amountIn * swapFeePercentage / 1e18`
5. Assigns fee to `feeToken0` or `feeToken1` based on which token was swapped in
6. Updates `DailyFees` entity (daily aggregation by UTC day) and cumulative fields on `PoolMetrics`

### handleUniswapSwap
**File**: `src/mapping.ts` | **Event**: `Swap(indexed address, uint256, uint256, uint256, uint256, indexed address)` | **Celo only**

Handles UniswapV2 swap events on the Celo Ubeswap pair:
1. Computes fees: 0.3% of input amounts (`amount0In * 3 / 1000`, `amount1In * 3 / 1000`)
2. Updates `DailyFees` entity and cumulative fields on `PoolMetrics`

### Design Decisions

- **Celo special case**: The Celo CELO-OLAS pool is an Ubeswap (UniswapV2 fork) pair at `0x2976Fa805141b467BCBc6334a69AffF4D914d96A`, not a Balancer V2 pool. It uses `Sync` events for reserves and `getReserves()` / `token0()` / `token1()` instead of `getPoolId()` / `getPoolTokens()`. The Celo manifest (`subgraph.celo.yaml`) is written manually, not generated from the template.
- **Contract calls only on mint/burn (Balancer)**: Regular transfers don't change pool reserves, so calling `getPoolTokens()` on every transfer would waste indexing resources.
- **Why Transfer events + contract calls (not Vault events)**: Indexing the Vault's `PoolBalanceChanged` would process ALL Balancer pools on the chain — very expensive.
- **Absolute reserves via `getPoolTokens()` (Balancer) / `Sync` event (Celo)**: Both approaches give current balances, no accumulation needed.
- **Reserves only update on join/exit (Balancer) or every swap (Celo)**: On Balancer chains, reserves only update on mint/burn. On Celo, Sync fires on every swap too, giving more frequent updates.
- **Vault Swap indexing for fee tracking (Balancer)**: The Balancer V2 Vault emits `Swap` events for ALL pools on the chain. The `handleVaultSwap` handler filters by `poolId` and returns immediately for non-matching swaps. This adds indexing overhead on busy chains (Arbitrum, Polygon) but provides accurate per-swap fee data. The swap fee percentage is cached on `PoolMetrics` and refreshed via `pool.getSwapFeePercentage()` contract call.
- **Fee tracking in token terms only (L2)**: L2 subgraphs track fees in token0/token1 amounts without USD conversion. USD conversion is deferred to the off-chain aggregation script (`scripts/pol-aggregation.js`), which uses the same Chainlink prices as POL valuation.

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `isZeroAddress(address)` | Check for zero address (mint/burn detection) |
| `getOrCreatePoolMetrics(poolAddress)` | Load-or-create singleton keyed by pool address |
| `getOrCreateDailyFees(timestamp)` | Load-or-create daily fee entity keyed by UTC day timestamp |

### Constants
| Constant | Value |
|----------|-------|
| `BALANCER_VAULT` | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| `CHAINLINK_CELO_USD` | `0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e` |
| `CELO_PRICE_ID` | `"celo-usd"` |
| `PRICE_STALENESS_THRESHOLD` | 3600 (1 hour) |
| `DAY_SECONDS` | 86400 |
| `WEI` | 1e18 |
| `SWAP_FEE_NUMERATOR` | 3 (UniswapV2 0.3% fee) |
| `SWAP_FEE_DENOMINATOR` | 1000 |
| `ZERO_ADDRESS` | `0x0000000000000000000000000000000000000000` |

---

## Multi-Network Pattern

Uses the **Template Pattern** for 4 Balancer chains, plus **manual manifests** for Base (2 pools) and Celo (Ubeswap):

1. `networks.json`: Pool address and startBlock for Gnosis, Polygon, Arbitrum, Optimism, Base
2. `subgraph.template.yaml`: Placeholders `{{ network }}`, `{{ BalancerPool.address }}`, `{{ BalancerPool.startBlock }}`
3. `scripts/generate-manifests.js` (at repo root): Generates `subgraph.<network>.yaml` per network
4. `subgraph.celo.yaml`: Written manually — uses UniswapV2Pair ABI with both `Transfer` and `Sync` event handlers

### Generating Manifests
```bash
yarn generate-manifests    # Outputs: subgraph.gnosis.yaml, subgraph.matic.yaml, etc. (NOT celo)
```

---

## Configuration

**Single data source per network**: The LP pool contract

| ABI | Used By | Purpose |
|-----|---------|---------|
| BalancerV2WeightedPool | Balancer chains | BPT Transfer events + `getPoolId()` / `getSwapFeePercentage()` calls |
| BalancerV2Vault | Balancer chains | `getPoolTokens(poolId)` call for reserves + `Swap` events for fee tracking |
| UniswapV2Pair | Celo | Transfer + Sync + Swap events + `token0()`/`token1()` calls |
| AggregatorV3Interface | Celo | Chainlink CELO/USD `latestRoundData()` call |

All ABIs are included in every manifest for codegen compatibility. The Celo manifest uses UniswapV2Pair as primary ABI; Balancer manifests use BalancerV2WeightedPool. The Balancer template also adds a second data source for the Vault (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`) to index Swap events for fee tracking.

**Spec**: v1.0.0 | **API**: 0.0.7 | **Pruning**: auto

---

## Development Workflow

```bash
cd subgraphs/liquidity-l2
yarn install               # Install dependencies
yarn generate-manifests    # Generate per-network YAML files from template
yarn codegen               # Generate TypeScript (uses gnosis manifest)
yarn build                 # Compile to WebAssembly (uses gnosis manifest)
```

---

## Testing

**Framework**: Matchstick-as 0.5.0 | **15 tests**

### Test Files
| File | Purpose |
|------|---------|
| `tests/mapping.test.ts` | 15 test cases across 3 handler groups |
| `tests/mapping-utils.ts` | Event factories (`createBPTTransferEvent`, `createVaultSwapEvent`, `createUniswapSwapEvent`) |
| `tests/test-helpers.ts` | Namespaced constants (`TestAddresses`, `TestValues`, `POOL_ID`) |

### Test Coverage

| Handler | Tests | What's Covered |
|---------|-------|----------------|
| handleBPTTransfer | 7 | Mint/burn supply tracking, Vault reserve fetch, token addresses, pool ID, regular transfers, multiple mint accumulation |
| handleVaultSwap | 5 | Matching poolId tracks fees correctly (via `getSwapFeePercentage`), swap before any mint ignored (no PoolMetrics), non-matching poolId ignored, multiple swaps accumulate daily, cumulative fees on PoolMetrics |
| handleUniswapSwap | 3 | Celo 0.3% fee calculation, cross-day separate DailyFees entities, cumulative fees on PoolMetrics |

Contract calls (`getPoolId`, `getPoolTokens`, `getSwapFeePercentage`) are mocked via `createMockedFunction`.

### Running Tests
```bash
ln -sf subgraph.gnosis.yaml subgraph.yaml && yarn test; rm -f subgraph.yaml
```

---

### GraphQL Field Names

The Graph auto-generates query field names. Correct queries for this subgraph:

| Entity | Singular Query | Collection Query |
|---|---|---|
| PoolMetrics | `poolMetrics(id: "0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac985")` | `poolMetrics_collection` |
| BPTTransfer | N/A (query by filters instead) | `bpttransfers` |

---

## Core Business Rules

### What This Subgraph Tracks

This subgraph indexes the **L2 side** of Olas Protocol Owned Liquidity. 5 chains use Balancer V2 Weighted Pools (50/50); Celo uses an Ubeswap (UniswapV2 fork) pair. The subgraph tracks:

- **LP token supply**: Total minted minus burned. This represents the total number of LP shares in existence for each pool.
- **Pool reserves**: The actual token balances in each pool. On Balancer chains, fetched via `vault.getPoolTokens(poolId)` contract call. On Celo, read directly from UniswapV2 `Sync` events.

The **Treasury does not hold LP tokens on L2 directly** — LP tokens are bridged to Ethereum mainnet where the Treasury accumulates them. Treasury balance tracking happens in the Ethereum mainnet subgraph (`subgraphs/liquidity/`). This subgraph provides the denominator: knowing the total BPT supply and pool reserves on L2, combined with the Treasury's bridged LP balance on L1, gives the Treasury's proportional share of the L2 pool's value.

### How POL Valuation Works Across Chains

1. **L2 subgraph** provides: pool reserves (token0, token1 balances) and BPT total supply
2. **Ethereum subgraph** provides: Treasury's bridged LP balance for each chain
3. **Off-chain aggregation** computes: `Treasury_POL_USD = (bridged_LP_balance / BPT_total_supply) * pool_TVL_USD`

For example, if Gnosis pool has 191K WXDAI + 3.8M OLAS, TVL ~ $384K, and Treasury holds 99.88% of BPT supply via bridged tokens on L1, then Treasury's Gnosis POL ~ $383K.

### Key Accounting Rules

1. **Reserves Only on Mint/Burn (Balancer)**: Contract calls to `vault.getPoolTokens()` are only made when BPT is minted or burned (pool join/exit). Regular user-to-user transfers do not trigger reserve fetches. On Celo, reserves come from every `Sync` event (including swaps).

2. **Mint/Burn Detection**: Transfers from the zero address are mints (liquidity added); transfers to the zero address are burns (liquidity removed).

3. **Underflow Protection**: Burns clamp `totalSupply` to zero if the burn amount exceeds the tracked supply. This guards against data inconsistency from partial-history indexing.

4. **Balancer V2 Architecture (5 chains)**: The pools are Weighted Pools but the reserves are held by the central **Vault** contract (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`, same address on all EVM chains). Each pool has a unique `poolId` (bytes32) that the Vault uses to identify it. The first 20 bytes of the poolId equal the pool contract address.

5. **Ubeswap/UniswapV2 Architecture (Celo)**: The Celo pool (`0x2976Fa805141b467BCBc6334a69AffF4D914d96A`) is a standard UniswapV2 pair. Reserves are emitted in `Sync(uint112, uint112)` events on every swap/join/exit. Token addresses come from `token0()`/`token1()` view functions. No Vault or poolId concept.

6. **No USD Valuation On-Chain (Balancer chains)**: The Balancer subgraphs do not compute USD values — USD conversion is deferred to the off-chain aggregation layer. **Celo is the exception**: it fetches CELO/USD from Chainlink on Celo (`0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e`) and stores it in `poolMetrics.celoUsdPrice` and `PriceData("celo-usd")`.

7. **No Treasury Tracking**: The subgraph does not track who holds LP tokens (no equivalent of `TreasuryHoldings`). It only tracks aggregate supply and pool reserves.

8. **Swap Fee Tracking**: Fees are tracked in token amounts (no USD conversion on-chain). For Balancer chains, the Vault `Swap` event provides `amountIn` and the fee is `amountIn × swapFeePercentage / 1e18`. For Celo (Ubeswap), fees are 0.3% of swap input. Daily aggregation is stored in `DailyFees` entities. The protocol/external fee split is computed off-chain by the aggregation script using the treasury share from the Ethereum subgraph.

### Unit Conventions

- All token amounts are in wei (18 decimals), except USDC on Base which is 6 decimals
- No USD values in this subgraph
- Token order (token0/token1) is determined by Balancer, not configurable — check the `token0`/`token1` addresses in `PoolMetrics` to know which is which

### Scope Limitations

- **Solana** (Orca pool `CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR`) is NOT covered — The Graph cannot index Solana
- **Swap-induced reserve changes** are not tracked — only join/exit events update reserves. For balanced 50/50 pools, total value is approximately stable across swaps
- Start blocks are set to actual pool contract creation blocks on each chain
