# Protocol Owned Liquidity (POL) Subgraph

Track the full Olas Protocol Owned Liquidity across Ethereum mainnet and L2 chains.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for current implementation details, schema reference, handler docs, and utility functions.

## Goal

Replace the current Dune-based POL tracking ([Dune query 5383248](https://dune.com/queries/5383248/8807520), shown on [olas.network/bond](https://olas.network/bond)) with subgraph-based indexing for all protocol-owned LP positions, including USD valuations.

## Current State

The subgraph today tracks **only the OLAS-ETH Uniswap V2 pool on Ethereum mainnet**:
- LP token supply (mint/burn via Transfer events)
- Treasury LP token balance
- Pool reserves (OLAS + ETH)
- Treasury share of total supply (basis points)
- **No USD valuation, no L2 chains, no bridged tokens**

### Prior Work (Closed PRs)
- [PR #90](https://github.com/valory-xyz/autonolas-subgraph-studio/pull/90) — Added Chainlink ETH/USD oracle integration and `poolLiquidityUsd` / `protocolOwnedLiquidityUsd` fields. Added Dune comparison scripts. Closed Feb 2026, paused for later.
- [PR #91](https://github.com/valory-xyz/autonolas-subgraph-studio/pull/91) — Added multi-chain L2 support with Balancer V2 `PoolBalanceChanged` handler, `BridgedPOL` entity, and per-chain YAML configs. Closed, paused for later.

## Full POL Composition

The Treasury on Ethereum mainnet (`0xa0DA53447C0f6C4987964d8463da7e6628B30f82`) holds:
1. **Native OLAS-ETH LP tokens** from the Uniswap V2 pool on Ethereum
2. **Bridged LP tokens** from L2 chains and Solana, transferred to L1 via bridges

### 1. Ethereum Mainnet — Native Pool

| Item | Detail |
|------|--------|
| DEX | Uniswap V2 |
| Pool / LP Token | `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F` |
| Pair | OLAS-WETH |
| Treasury | `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` |
| Depository | `0xfF8697d8d2998d6AA2e09B405795C6F4BEeB0C81` |
| Events | `Transfer(indexed address,indexed address,uint256)`, `Sync(uint112,uint112)` |

### 2. Bridged LP Tokens Held by Treasury on Ethereum

These are ERC-20 tokens on Ethereum that represent LP positions from L2/Solana pools. They were bridged to L1 so bonders can deposit them into the Depository. The Treasury accumulates them as POL.

Source: [lp_token_bridging.md](https://github.com/valory-xyz/autonolas-tokenomics/blob/main/docs/lp_token_bridging.md)

| Origin Chain | Pair | DEX | Native LP Address | Bridged L1 Address (Ethereum) | Bridge | L1 Start Block |
|---|---|---|---|---|---|---|
| Gnosis | OLAS-WXDAI | Balancer V2 | `0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985` | `0x27df632fd0dcf191C418c803801D521cd579F18e` | OmniBridge | 18,324,324 |
| Polygon | OLAS-WMATIC | Balancer V2 | `0x62309056c759c36879Cde93693E7903bF415E4Bc` | `0xf9825A563222f9eFC81e369311DAdb13D68e60a4` | Wormhole Portal | 19,126,747 |
| Solana | WSOL-OLAS | Orca | `CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR` | `0x3685B8cC36B8df09ED9E81C1690100306bF23E04` | Wormhole Portal | 19,641,245 |
| Arbitrum | OLAS-WETH | Balancer V2 | `0xAF8912a3C4f55a8584B67DF30ee0dDf0e60e01f8` | `0x36B203Cb3086269f005a4b987772452243c0767f` | Wormhole Portal | 19,120,775 |
| Optimism | WETH-OLAS | Balancer V2 | `0x5bb3e58887264b667f915130fd04bbb56116c278` | `0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F` | Wormhole Portal | 19,457,188 |
| Base | OLAS-USDC | Balancer V2 | `0x5332584890d6e415a6dc910254d6430b8aab7e69` | `0x9946d6FD1210D85EC613Ca956F142D911C97a074` | Wormhole Portal | 19,532,493 |
| Celo | CELO-OLAS | Balancer V2 | `0x2976Fa805141b467BCBc6334a69AffF4D914d96A` | `0xC085F31E4ca659fF8A17042dDB26f1dcA2fBdAB4` | Wormhole Portal | 20,488,304 |

### 3. Related Tokenomics Contracts

Source: [configuration.json](https://github.com/valory-xyz/autonolas-tokenomics/blob/main/docs/configuration.json)

#### Ethereum Mainnet
| Contract | Address |
|---|---|
| Treasury | `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` |
| Depository | `0xfF8697d8d2998d6AA2e09B405795C6F4BEeB0C81` |
| Tokenomics | `0x1ce191601e7f2777EEB797149d6e65aE40dF0e93` |
| UniswapPriceOracle | `0xfB81f2D75DCE6ff54A501E8660028d7595019C4a` |
| BuyBackBurnerUniswap | `0x07749207793DC1f9208BFCAAA08ef1ea204402A6` |

#### L2 BuyBackBurners and Price Oracles
| Chain | BuyBackBurner | PriceOracle | DEX Type |
|---|---|---|---|
| Gnosis | `0x47Cb42216f08AB8E69F1321ACfEFd435b3c36943` | `0xFa4dD5CE7A99E86a45a45250ca4EB18Ba3d16187` | Balancer |
| Polygon | `0x2Ef503950Be67a98746F484DA0bBAdA339DF3326` | `0x1853D16c2ccC6d26fe50b24F35Ee460C33E66d07` | Balancer |
| Arbitrum | `0x4891f5894634DcD6d11644fe8E56756EF2681582` | `0x71f78A4692B665232969Dc01216f44d4d1E6ee89` | Balancer |
| Optimism | `0x71f78A4692B665232969Dc01216f44d4d1E6ee89` | `0x2C3F556Ff33B6b5279C85CA99ed2Ba8351A2E9Bf` | Balancer |
| Base | `0xEea5F1e202dc43607273d54101fF8b58FB008A99` | `0x586D916819d9B707101f81e4cDD22cE119D1C220` | Balancer |
| Celo | `0x4E82BC73BFB9647074aA71CBF467e66c1808C571` | `0xa987Fe40034AaD2EbB0E01B22DFc57f20C87F949` | Uniswap |

## USD Valuation Approach

Two complementary methods (both explored in PR #90):

1. **ETH-based (primary)**: `Pool Liquidity USD = 2 * ETH_reserves * ETH/USD_price` using Chainlink `AggregatorV3Interface` on each chain.
2. **OLAS-based (validation)**: `Pool Liquidity USD = 2 * OLAS_reserves * OLAS/USD_price` using CoinGecko. Expected variance < 1% for balanced pools.

For non-ETH pools:
- OLAS-WXDAI (Gnosis): WXDAI ~ $1, so `2 * WXDAI_reserves`
- OLAS-USDC (Base): USDC ~ $1, so `2 * USDC_reserves`
- OLAS-WMATIC (Polygon): Chainlink MATIC/USD feed
- CELO-OLAS (Celo): Chainlink CELO/USD feed

**POL USD** = `Pool Liquidity USD * (treasury_LP_balance / total_LP_supply)`

## Implementation Plan

### Phase 1 — Complete Ethereum Mainnet (extend current subgraph)

1. **Chainlink ETH/USD oracle** — add `AggregatorV3Interface` data source, compute `poolLiquidityUsd` and `protocolOwnedLiquidityUsd` on each Sync event.
2. **Bridged LP token tracking** — add 7 ERC-20 data sources (one per bridged LP token address on Ethereum) watching `Transfer` events. Track Treasury balance for each. New `BridgedPOLHolding` entity with `currentBalance`, `originChain`, `pair`.
3. **Dune comparison script** — validate subgraph output against [Dune query 4963482](https://dune.com/queries/4963482).

### Phase 2 — L2 Pool Subgraphs (new subgraph, template pattern)

Create a multi-network liquidity subgraph (like `staking` or `service-registry`) to track pool reserves on each L2:

| Chain | Pool Address | DEX | Key Events |
|---|---|---|---|
| Gnosis | `0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985` | Balancer V2 | `PoolBalanceChanged`, `Swap` |
| Polygon | `0x62309056c759c36879Cde93693E7903bF415E4Bc` | Balancer V2 | `PoolBalanceChanged`, `Swap` |
| Arbitrum | `0xAF8912a3C4f55a8584B67DF30ee0dDf0e60e01f8` | Balancer V2 | `PoolBalanceChanged`, `Swap` |
| Optimism | `0x5bb3e58887264b667f915130fd04bbb56116c278` | Balancer V2 | `PoolBalanceChanged`, `Swap` |
| Base | `0x5332584890d6e415a6dc910254d6430b8aab7e69` | Balancer V2 | `PoolBalanceChanged`, `Swap` |
| Celo | `0x2976Fa805141b467BCBc6334a69AffF4D914d96A` | Balancer V2 | `PoolBalanceChanged`, `Swap` |

All 6 L2 pools are Balancer V2 (events come from the Vault contract, not the pool itself). Handler logic: `PoolBalanceChanged` updates reserves, `Swap` can update reserves or be used for volume tracking.

Each L2 subgraph computes:
- Pool reserves (both tokens)
- Total LP supply
- Pool TVL in USD (via chain-native Chainlink price feed)

### Phase 3 — Aggregation and Solana

1. **Off-chain aggregation** — script/API that queries all subgraphs and computes:
   - `Total POL USD = Ethereum_native_POL_USD + sum(bridged_LP_balance / L2_total_supply * L2_pool_TVL_USD)`
2. **Solana** — Orca pool (`CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR`) cannot be indexed by The Graph. Requires an off-chain data source (Orca API, Jupiter API, or a Solana-specific indexer like Shyft/Helius).

## Data Sources Reference

| Source | What It Provides | Link |
|---|---|---|
| Current subgraph | LP metrics, ETH reserves (Ethereum only) | This subgraph |
| Dune query 4963482 | LP supply, POL, USD valuations (all chains) | [Dune](https://dune.com/queries/4963482) |
| Dune query 5383248 | Total POL USD (shown on olas.network/bond) | [Dune](https://dune.com/queries/5383248/8807520) |
| Dune query 5409446 | Protocol revenue from POL | [Dune](https://dune.com/queries/5409446/8836411) |
| CoinGecko | OLAS/USD price | API |
| Chainlink | ETH/USD and other asset prices (on-chain) | Per-chain oracle contracts |
| Tokenomics docs | Contract addresses, LP bridging, configuration | [GitHub](https://github.com/valory-xyz/autonolas-tokenomics/blob/main/docs) |

## Validating Subgraph Against Dune

To ensure the subgraph produces correct data, its output should be compared against the existing Dune queries that power [olas.network/bond](https://olas.network/bond).

### What to Compare

**Ethereum mainnet subgraph vs Dune query [4963482](https://dune.com/queries/4963482):**

| Subgraph Field | Dune Equivalent | Entity / Query |
|---|---|---|
| Treasury OLAS-ETH LP balance | LP balance held by Treasury | `treasuryHoldings.currentBalance` |
| OLAS reserves (reserve0) | Pool OLAS reserves | `lpTokenMetrics.currentReserve0` |
| ETH reserves (reserve1) | Pool ETH reserves | `lpTokenMetrics.currentReserve1` |
| Treasury % of LP supply | Treasury share | `lpTokenMetrics.treasuryPercentage` (basis points) |
| Pool liquidity USD | Pool TVL | `lpTokenMetrics.poolLiquidityUsd` (8 decimals) |
| Protocol owned liquidity USD | POL USD | `lpTokenMetrics.protocolOwnedLiquidityUsd` (8 decimals) |
| Bridged LP balances (per chain) | Bridged LP held by Treasury | `bridgedPOLHoldings` (7 entities) |

**Ethereum mainnet subgraph total POL vs Dune query [5383248](https://dune.com/queries/5383248/8807520):**

Total POL USD = `protocolOwnedLiquidityUsd` (native OLAS-ETH) + sum of bridged LP valuations (requires L2 subgraph reserves for each chain).

**L2 subgraphs vs Dune query [4963482](https://dune.com/queries/4963482):**

| Subgraph Field | Dune Equivalent | Entity / Query |
|---|---|---|
| Pool reserves (reserve0, reserve1) | L2 pool token balances | `poolMetrics.reserve0`, `poolMetrics.reserve1` |
| BPT total supply | L2 BPT supply | `poolMetrics.totalSupply` |

### Comparison Approach

1. **Query subgraph** GraphQL endpoints for current state of all entities listed above
2. **Fetch Dune results** via the [Dune API](https://docs.dune.com/api-reference/executions/endpoint/get-query-result) (requires `DUNE_API_KEY`) or export CSV from the Dune UI
3. **Normalize units**: subgraph uses raw wei (18 decimals) and 8-decimal USD; Dune typically uses human-readable numbers
4. **Compare with tolerance**: small discrepancies (< 1%) are expected due to block timing differences between the subgraph indexing head and Dune's snapshot block
5. **Report**: PASS/FAIL per metric with actual vs expected values and % deviation

### Expected Discrepancy Sources

- **Block timing**: Dune snapshots at a specific block; the subgraph may be a few blocks ahead or behind
- **Price staleness**: Subgraph fetches Chainlink price on each Sync event; Dune may use a different price source or timestamp
- **Rounding**: BigInt division truncates in the subgraph; Dune may use floating-point math
- **Solana**: The Orca pool (`CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR`) is not indexed by the subgraph — this LP token's value will be missing from the subgraph total but present in Dune

### Automation (Future)

- Build a `scripts/compare-dune.js` script that automates the above steps
- Run in CI after each subgraph deployment to catch regressions
- Alert if any metric diverges beyond the tolerance threshold

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
```

### Project Structure
* `src/mapping.ts` — Event handlers for LP transfers and reserve syncs
* `src/utils.ts` — Constants, helpers, and get-or-create patterns

### Common Queries

**Note**: The Graph auto-generates query field names from entity names. The correct field names are `lptokenMetrics` (not `lpTokenMetrics`), `bridgedPOLHoldings`, etc. See the examples below.

#### Current Metrics (with USD valuation)
```graphql
{
  lptokenMetrics(id: "global") {
    totalSupply
    treasurySupply
    treasuryPercentage
    currentReserve0
    currentReserve1
    ethUsdPrice
    poolLiquidityUsd
    protocolOwnedLiquidityUsd
  }
}
```

#### Treasury Holdings
```graphql
{
  treasuryHoldings(id: "0xa0da53447c0f6c4987964d8463da7e6628b30f82") {
    currentBalance
    totalAcquired
    totalSold
    transactionCount
  }
}
```

#### Bridged LP Token Balances
```graphql
{
  bridgedPOLHoldings(first: 10) {
    id
    originChain
    pair
    currentBalance
    totalAcquired
    totalSold
    transactionCount
  }
}
```

#### L2 Pool Metrics (liquidity-l2 subgraph)
```graphql
{
  poolMetrics_collection(first: 1) {
    id
    poolId
    token0
    token1
    reserve0
    reserve1
    totalSupply
  }
}
```

### Verified Results (2026-03-17, v0.0.2)

3 subgraphs deployed to The Graph Studio and fully synced with zero indexing errors:

| Subgraph | Block | Key Finding |
|---|---|---|
| Ethereum mainnet | 24,677,330 | Treasury owns 99.95% of OLAS-ETH LP ($1.83M POL), all 7 bridged LP tokens tracked, Chainlink price caching active |
| Gnosis L2 | 45,195,995 | Pool TVL ~$384K, 99.88% of BPT bridged to L1 Treasury |
| Polygon L2 | 84,315,911 | 99.86% of BPT bridged to L1 Treasury |

Cross-chain consistency confirmed: bridged LP balances on Ethereum closely match BPT supply on L2 (gap ~0.1% = LP not yet bridged). Treasury has never sold any LP tokens (totalSold = 0 everywhere).

See [CLAUDE.md — Verification Results](CLAUDE.md#verification-results-2026-03-17-v002) for full data tables.
