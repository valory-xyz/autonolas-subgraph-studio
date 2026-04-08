# Protocol Owned Liquidity (POL) Subgraph

Track the full Olas Protocol Owned Liquidity across Ethereum mainnet and L2 chains.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for current implementation details, schema reference, handler docs, and utility functions.

## Goal

Replace the current Dune-based POL tracking ([Dune query 5383248](https://dune.com/queries/5383248/8807520), shown on [olas.network/bond](https://olas.network/bond)) with subgraph-based indexing for all protocol-owned LP positions, including USD valuations.

## Current State

The Ethereum subgraph tracks the **OLAS-ETH Uniswap V2 pool on Ethereum mainnet**:
- LP token supply (mint/burn via Transfer events)
- Treasury LP token balance and 8 bridged LP token balances (including 2 Base pools)
- Pool reserves (OLAS + ETH) with Chainlink USD valuation
- Treasury share of total supply (basis points)
- **Swap fee tracking**: daily and cumulative fees in USD, split between protocol and external LPs

The L2 subgraph (`liquidity-l2`) tracks 7 L2 pools (6 Balancer V2 including 2 on Base, + 1 Ubeswap/Celo) with reserves, BPT supply, and swap fees in token terms.

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
| Base | WETH-OLAS | Balancer V2 | `0x2da6e67C45aF2aaA539294D9FA27ea50CE4e2C5f` | `0xad47b6ffEe3ed15fCE55eCA42AcE9736901b94A1` | Wormhole Portal | 21,293,873 |
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

## Full POL Calculation Algorithm

Total POL USD is computed by `scripts/pol-aggregation.js`, which combines data from two sources: subgraph queries (on-chain via Chainlink) and Solana RPC (off-chain). **All prices come from Chainlink oracles** — no external price APIs are used.

### Step 1: Fetch Data (all in parallel)

| Source | What's Fetched | Endpoint |
|---|---|---|
| Ethereum subgraph | `lptokenMetrics` (reserves, treasury %, prices, cumulative fees USD), `bridgedPOLHoldings` (8 bridged LP balances), `priceDatas` (ETH/USD, MATIC/USD, SOL/USD) | GraphQL |
| Gnosis subgraph | `poolMetrics` (reserves, supply, cumulative token fees) | GraphQL |
| Polygon subgraph | `poolMetrics` (reserves, supply, cumulative token fees) | GraphQL |
| Arbitrum subgraph | `poolMetrics` (reserves, supply, cumulative token fees) | GraphQL |
| Optimism subgraph | `poolMetrics` (reserves, supply, cumulative token fees) | GraphQL |
| Base subgraph | `poolMetrics` (reserves, supply, cumulative token fees) | GraphQL |
| Celo subgraph | `poolMetrics` (reserves, supply, celoUsdPrice, cumulative token fees) | GraphQL |
| Solana RPC | SOL vault balance | `getTokenAccountBalance` |

### Step 2: Resolve Prices

All prices come from Chainlink oracles, fetched on-chain by the respective subgraphs with 1-hour staleness caching:

| Price | Source | Subgraph |
|---|---|---|
| ETH/USD | Chainlink `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | Ethereum (`ethUsdPrice`) |
| MATIC/USD | Chainlink `0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676` | Ethereum (`maticUsdPrice`) |
| SOL/USD | Chainlink `0x4ffC43a60e009B551865A93d232E33Fce9f01507` | Ethereum (`solUsdPrice`) |
| CELO/USD | Chainlink `0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e` | Celo (`celoUsdPrice`) |

OLAS/USD price is **not needed** — all pools use the `2 × paired_token_reserves × paired_token_price` method, including Solana (`2 × SOL_vault × SOL/USD`).

### Step 3: Compute POL Per Chain

**Group A — Fully on-chain (subgraph only, no external price needed):**

| Chain | Formula | Notes |
|---|---|---|
| Ethereum | `protocolOwnedLiquidityUsd` from subgraph directly | Pre-computed: `2 × ETH_reserves × ETH/USD × treasury% / 10000` |
| Gnosis | `2 × WXDAI_reserves × (bridged_balance / BPT_supply)` | WXDAI ≈ $1 (stablecoin) |
| Base (USDC) | `2 × USDC_reserves × (bridged_balance / BPT_supply)` | USDC ≈ $1 (stablecoin), 6 decimals |

**Group B — On-chain reserves + Chainlink price from Ethereum subgraph:**

| Chain | Formula | Price Source |
|---|---|---|
| Polygon | `2 × WMATIC_reserves × MATIC/USD × (bridged_balance / BPT_supply)` | `maticUsdPrice` from Ethereum subgraph |
| Arbitrum | `2 × WETH_reserves × ETH/USD × (bridged_balance / BPT_supply)` | `ethUsdPrice` from Ethereum subgraph |
| Optimism | `2 × WETH_reserves × ETH/USD × (bridged_balance / BPT_supply)` | `ethUsdPrice` from Ethereum subgraph |
| Base (WETH) | `2 × WETH_reserves × ETH/USD × (bridged_balance / BPT_supply)` | `ethUsdPrice` from Ethereum subgraph |

**Group C — On-chain reserves + Chainlink price from Celo subgraph:**

| Chain | Formula | Price Source |
|---|---|---|
| Celo | `2 × CELO_reserves × CELO/USD × (bridged_balance / BPT_supply)` | Chainlink CELO/USD on Celo chain (`0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e`), stored in Celo subgraph `poolMetrics.celoUsdPrice` |

**Group D — Off-chain reserves + Chainlink price (Solana RPC):**

| Chain | Formula | Off-Chain Dependencies |
|---|---|---|
| Solana | `2 × SOL_vault × SOL/USD × treasury_share` | Solana RPC for SOL vault balance, Chainlink SOL/USD from Ethereum subgraph |

Solana vault account:
- SOL vault (`CLA8hU8SkdCZ9cJVLMfZQfcgAsywZ9txBJ6qrRAqthLx`) — 9 decimals
- Formula: `2 × SOL_vault × SOL/USD` (same balanced-pool approach as all other chains, no OLAS price needed)
- Treasury share: approximated as 99.995% (Treasury holds nearly all bridged LP supply on L1)

### Step 4: Sum

```
Total POL USD = Ethereum + Gnosis + Polygon + Arbitrum + Optimism + Base (USDC) + Base (WETH) + Celo + Solana
```

### Step 5: Compute Protocol Fees (cumulative)

**Ethereum**: Fees are pre-computed in USD by the subgraph (`cumulativeFeesUsd`, `cumulativeProtocolFeesUsd`, `cumulativeExternalFeesUsd` on `LPTokenMetrics`, 8 decimals). Swap fee = 0.3% of input, split by `treasuryPercentage`.

**L2 chains**: Fees are tracked in token amounts (`cumulativeFeesToken0`, `cumulativeFeesToken1` on `PoolMetrics`). The aggregation script converts to USD using the same prices as POL valuation:

| Chain | Fee USD Conversion |
|---|---|
| Gnosis | `feeWXDAI × $1 + feeOLAS × (WXDAI_reserve / OLAS_reserve) × $1` |
| Polygon | `feeWMATIC × MATIC/USD + feeOLAS × (WMATIC_reserve / OLAS_reserve) × MATIC/USD` |
| Arbitrum | `feeWETH × ETH/USD + feeOLAS × (WETH_reserve / OLAS_reserve) × ETH/USD` |
| Optimism | `feeWETH × ETH/USD + feeOLAS × (WETH_reserve / OLAS_reserve) × ETH/USD` |
| Base (USDC) | `feeUSDC × $1 + feeOLAS × (USDC_reserve / OLAS_reserve) × $1` |
| Base (WETH) | `feeWETH × ETH/USD + feeOLAS × (WETH_reserve / OLAS_reserve) × ETH/USD` |
| Celo | `feeCELO × CELO/USD + feeOLAS × (CELO_reserve / OLAS_reserve) × CELO/USD` |

Protocol/external split on L2: `protocolFees = totalFees × (bridged_LP_balance / BPT_supply)`, using the same treasury share as POL.

**Solana**: Fee tracking not available (no subgraph).

### Key Variables

For each L2 chain, `bridged_balance` comes from the Ethereum subgraph's `bridgedPOLHoldings` entity (Treasury's balance of the bridged LP token on L1), and `BPT_supply` comes from the respective L2 subgraph's `poolMetrics.totalSupply`. The ratio `bridged_balance / BPT_supply` gives Treasury's share of the pool (currently 99.78–100% across all chains).

### Running the Aggregation

The script computes **two values**: total POL (protocol owned liquidity) and total protocol fees across all chains. Both are shown in terminal output and included in JSON output.

```bash
# From repo root (no dependencies needed — uses only Node.js built-ins)
node scripts/pol-aggregation.js            # human-readable tables (POL + Fees)
node scripts/pol-aggregation.js --json     # JSON output with totalPolUsd, totalProtocolFeesUsd, totalFeesUsd
node scripts/pol-aggregation.js --verbose  # include raw subgraph data
```

**Terminal output** shows two tables:
1. **POL Valuation by Chain** — Pool TVL, Treasury POL, share %, valuation method
2. **Cumulative Protocol Fees by Chain** — Total fees, protocol fees, external fees (all in USD)

**JSON output** (with `--json`) includes per-chain results and aggregate totals:
```json
{
  "totalPolUsd": 2500000.00,
  "totalProtocolFeesUsd": 50000.00,
  "totalExternalFeesUsd": 25.00,
  "totalFeesUsd": 50025.00,
  "polChainsValued": 8,
  "feesChainsValued": 7,
  "chainsTotal": 8
}
```

**Environment variables** to override subgraph endpoints:
- `SUBGRAPH_ETH_URL`, `SUBGRAPH_GNOSIS_URL`, `SUBGRAPH_POLYGON_URL`
- `SUBGRAPH_ARBITRUM_URL`, `SUBGRAPH_OPTIMISM_URL`, `SUBGRAPH_BASE_URL`, `SUBGRAPH_CELO_URL`
- `SOLANA_RPC_URL` (defaults to `https://api.mainnet-beta.solana.com`)

**Prerequisites**: Node.js 18+. No `yarn install` needed — the script uses only built-in `https`/`http` modules.

## Implementation Status

### Phase 1 — Ethereum Mainnet (DONE)

- Chainlink ETH/USD, MATIC/USD, SOL/USD oracles — fetched via `latestRoundData()` with 1-hour staleness caching
- 8 bridged LP token data sources tracking Treasury balances (including 2 Base pools: OLAS-USDC + WETH-OLAS)
- USD valuation: `poolLiquidityUsd`, `protocolOwnedLiquidityUsd` computed on each Sync event

### Phase 2 — L2 Pool Subgraphs (DONE)

Multi-network `liquidity-l2` subgraph deployed as 7 subgraphs across 6 chains:
- 6 Balancer V2 pools (Gnosis, Polygon, Arbitrum, Optimism, Base OLAS-USDC, Base WETH-OLAS) — BPT Transfer + Vault `getPoolTokens()` calls + Vault Swap events for fees
- 1 Ubeswap/UniswapV2 pool (Celo) — Transfer + Sync + Swap events (manual manifest)

### Phase 3 — Off-Chain Aggregation (DONE)

**Aggregation script**: `scripts/pol-aggregation.js` at repo root — queries all 8 subgraphs + Solana RPC, computes total POL USD and total protocol fees USD. All prices from Chainlink.

### Phase 4 — Swap Fee Tracking (DONE)

**Ethereum**: `handleSwap` handler on the OLAS-ETH pair. Fees = 0.3% of input, converted to USD via Chainlink, split by treasury percentage. Stored in `DailyFees` entities and cumulative fields on `LPTokenMetrics`.

**L2 Balancer chains**: `handleVaultSwap` on the Balancer V2 Vault. Processes all Vault Swap events, filters by `poolId` in handler. Fee = `amountIn × swapFeePercentage / 1e18`. Tracked in token terms; USD conversion in aggregation script.

**Celo**: `handleUniswapSwap` on the Ubeswap pair. Fee = 0.3% of input. Tracked in token terms.

**Aggregation script** updated to compute total fees USD across all chains, with protocol/external split using treasury share.

## Data Sources Reference

| Source | What It Provides | Link |
|---|---|---|
| Current subgraph | LP metrics, ETH reserves (Ethereum only) | This subgraph |
| Dune query 4963482 | LP supply, POL, USD valuations (all chains) | [Dune](https://dune.com/queries/4963482) |
| Dune query 5383248 | Total POL USD (shown on olas.network/bond) | [Dune](https://dune.com/queries/5383248/8807520) |
| Dune query 5409446 | Protocol revenue from POL | [Dune](https://dune.com/queries/5409446/8836411) |
| Chainlink | ETH/USD, MATIC/USD, SOL/USD (Ethereum), CELO/USD (Celo) | Per-chain oracle contracts |
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

### Known Dune Query Issues (as of 2026-03-18)

Analysis of the Dune POL query chain (5383248 → sub-queries) revealed two issues that explain the ~31% gap between Dune ($3.7M) and subgraph ($2.5M) totals:

**1. Arbitrum double-counting bug in query 5383248**

The `combined_pol` CTE includes `arbitrum_pol` twice:
```sql
select * from arbitrum_pol
union all
select * from arbitrum_pol    -- ← DUPLICATE
union all
select * from optimism_pol
```
Impact: inflates total by ~$106K (the Arbitrum POL value).

**2. Inflated OLAS price from thin DEX trades**

The ETH POL sub-query (4963482) values the pool as `2 × OLAS_reserves × OLAS_price`, where OLAS price comes from query 2767077 → 2766789:
```sql
-- query_2766789: last 10 DEX trades, unweighted average
SELECT *, amount_usd / token_bought_amount AS olas_value
FROM dex.trades WHERE token_bought_address = 0x0001A500A6B18995B03f44bb040A5fFc28E45CB0
ORDER BY block_time DESC LIMIT 10

-- query_2767077: simple average
SELECT AVG(olas_value) as latest_price FROM query_2766789
```

This produces an unreliable OLAS price because:
- Only 10 trades with no volume weighting (a $10 trade has the same weight as a $100K trade)
- No time filter — trades can span hours
- Includes all DEX venues, some with thin liquidity and skewed prices
- Implied Dune OLAS price is ~$0.069 vs market VWAP of ~$0.048 — a **42% markup**

Since Dune uses `2 × OLAS_reserves × OLAS_price` for the ETH pool (the largest POL component at ~69% of total), this inflated price propagates to ~$1M of overcount.

### Why the Subgraph Approach Is More Accurate

The subgraph uses `2 × paired_token_reserves × Chainlink_price` — it does **not depend on OLAS price** for 6 of 8 chains:

| Chain | Subgraph Method | OLAS Price Needed? |
|---|---|---|
| Ethereum | 2 × ETH × Chainlink ETH/USD | No |
| Gnosis | 2 × WXDAI (~$1) | No |
| Polygon | 2 × WMATIC × Chainlink MATIC/USD | No |
| Arbitrum | 2 × WETH × Chainlink ETH/USD | No |
| Optimism | 2 × WETH × Chainlink ETH/USD | No |
| Base | 2 × USDC (~$1) | No |
| Celo | 2 × CELO × Chainlink CELO/USD (on Celo chain) | No |
| Solana | 2 × SOL × Chainlink SOL/USD | No |

Chainlink feeds are audited, volume-weighted, and manipulation-resistant. The subgraph's POL valuation is independent of OLAS market price for all major pools.

## Validating Protocol Fees Against Dune

After all subgraphs are redeployed with fee tracking, the subgraph fee data should be compared against the existing Dune fee datasets to ensure correctness. This follows the same approach used for POL validation above.

### Dune Fee Datasets

The Dune fee data lives in per-chain materialized views by user `adrian0x`:

| Chain | Dune Dataset | Columns |
|---|---|---|
| Ethereum | `dune.adrian0x.result_ethereum_earned_fees_by_day` | `day`, `ethereum_protocol_earned_fees`, `ethereum_external_earned_fees`, `cumulative_protocol_earned_fees` |
| Gnosis | `dune.adrian0x.result_gnosis_earned_fees_by_day` | `day`, `gnosis_protocol_earned_fees`, `gnosis_external_earned_fees` |
| Arbitrum | `dune.adrian0x.result_arbitrum_earned_fees_by_day` | `day`, `arbitrum_protocol_earned_fees`, `arbitrum_external_earned_fees` |
| Polygon | `dune.adrian0x.result_polygon_earned_fees_by_day` | `day`, `polygon_protocol_earned_fees`, `polygon_external_earned_fees` |
| Optimism | `dune.adrian0x.result_optimism_protocol_earned_fees_by_day` | `day`, `optimism_protocol_earned_fees`, `optimism_external_earned_fees` |
| Base | `dune.adrian0x.result_base_protocol_earned_fees_by_day` | `day`, `base_protocol_earned_fees`, `base_external_earned_fees` |

The aggregation query [5409446](https://dune.com/queries/5409446/8836411) combines all chains with daily and cumulative totals.

**Note**: The Dune datasets may not yet include the second Base pool (WETH-OLAS). Verify coverage before comparing.

### What to Compare

**Per-chain cumulative totals** (simplest — one comparison per chain):

| Chain | Subgraph Source | Dune Source |
|---|---|---|
| Ethereum | `lptokenMetrics.cumulativeFeesUsd` (÷ 1e8) | `SUM(ethereum_protocol_earned_fees + ethereum_external_earned_fees)` |
| Ethereum (protocol only) | `lptokenMetrics.cumulativeProtocolFeesUsd` (÷ 1e8) | `MAX(cumulative_protocol_earned_fees)` |
| Gnosis | `poolMetrics.cumulativeFeesToken0` + `cumulativeFeesToken1` → USD via script | `SUM(gnosis_protocol_earned_fees + gnosis_external_earned_fees)` |
| Polygon | Same pattern | Same pattern |
| Arbitrum | Same pattern | Same pattern |
| Optimism | Same pattern | Same pattern |
| Base (USDC) | Same pattern | Same pattern |
| Base (WETH) | Same pattern | May not exist in Dune yet |

**Daily spot checks** (pick 5–10 random dates across the history):

| Subgraph | Dune |
|---|---|
| `dailyFees(id: "<dayTimestamp>") { totalFeesUsd protocolFeesUsd }` | `SELECT * FROM dune.adrian0x.result_ethereum_earned_fees_by_day WHERE day = '<date>'` |
| L2: `dailyFees(id: "<dayTimestamp>") { totalFeesToken0 totalFeesToken1 }` → convert to USD | Per-chain dataset filtered by day |

### Step-by-Step Comparison Plan

**1. Pick a comparison date range**

Choose a 30-day window where both the subgraph and Dune have data. Start from the most recent complete day (UTC midnight) and go back 30 days.

**2. Query subgraph fees (Ethereum)**

```graphql
# Cumulative totals
{
  lptokenMetrics(id: "global") {
    cumulativeFeesUsd
    cumulativeProtocolFeesUsd
    cumulativeExternalFeesUsd
  }
}

# Daily breakdown for spot checks
{
  dailyFees_collection(
    first: 30
    orderBy: dayTimestamp
    orderDirection: desc
  ) {
    id dayTimestamp totalFeesUsd protocolFeesUsd externalFeesUsd swapCount
  }
}
```

**3. Query subgraph fees (L2 — per chain)**

```graphql
# Cumulative totals
{
  poolMetrics_collection(first: 1) {
    cumulativeFeesToken0
    cumulativeFeesToken1
    reserve0 reserve1
  }
}

# Daily breakdown
{
  dailyFees_collection(
    first: 30
    orderBy: dayTimestamp
    orderDirection: desc
  ) {
    id dayTimestamp totalFeesToken0 totalFeesToken1 swapCount
  }
}
```

Convert L2 token fees to USD using the same formulas as the aggregation script (see [Step 5: Compute Protocol Fees](#step-5-compute-protocol-fees-cumulative) above).

**4. Query Dune fees (via Dune MCP or API)**

```sql
-- Per-chain daily fees (example: Ethereum)
SELECT day, ethereum_protocol_earned_fees, ethereum_external_earned_fees
FROM dune.adrian0x.result_ethereum_earned_fees_by_day
WHERE day >= CURRENT_DATE - INTERVAL '30' DAY
ORDER BY day DESC;

-- Cross-chain cumulative totals
SELECT
  SUM(Total_Protocol_Earned_Fees) AS total_protocol,
  SUM(Total_External_Earned_Fees) AS total_external
FROM dune.adrian0x.result_total_protocol_earned_fees;
```

**5. Compare and report**

For each chain and date:
```
deviation = |subgraph_value - dune_value| / dune_value × 100%
```

Report PASS (< 5% deviation) or FAIL (≥ 5%) per metric. Document any systematic biases.

### Expected Discrepancy Sources

| Source | Impact | Direction |
|---|---|---|
| **Fee calculation method** | Subgraph computes `0.3% × amountIn` (UniV2) or `amountIn × swapFeePercentage / 1e18` (Balancer). Dune may use a different formula or data source (e.g., reserve deltas, `dex.trades` table). | Could go either way |
| **USD conversion** | Subgraph uses cached Chainlink price (1-hour staleness on L1). Dune may use spot prices from `prices.usd` or trade-time prices. | Small, < 2% |
| **Rounding** | Subgraph uses BigInt truncation (18-decimal tokens → 8-decimal USD). Dune uses float64. | Subgraph slightly lower |
| **Protocol/external split** | Subgraph uses real-time `treasuryPercentage` per swap. Dune may use a daily average or snapshot. | Small |
| **Block coverage** | Subgraph indexes all blocks from startBlock. Dune datasets may have different start dates or may miss events during RPC outages. | Could cause cumulative drift |
| **Base WETH-OLAS pool** | Dune may not include the second Base pool. | Subgraph higher on Base |
| **Swap fee percentage changes (Balancer)** | If the Balancer pool fee changed over time, the subgraph caches the fee at first use. Dune may track historical fee rates. | Unlikely for OLAS pools |

### Automation

After manual validation confirms reasonable agreement (< 5% per chain), the comparison can be automated:

1. Add a `--compare-dune` flag to `scripts/pol-aggregation.js`
2. Use the Dune API (`DUNE_API_KEY` env var) to fetch cumulative totals
3. Output a per-chain comparison table with deviations
4. Fail CI if any chain exceeds the tolerance threshold

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

#### Daily Fees (last 7 days)
```graphql
{
  dailyFees_collection(
    first: 7
    orderBy: dayTimestamp
    orderDirection: desc
  ) {
    id
    dayTimestamp
    totalFeesUsd
    protocolFeesUsd
    externalFeesUsd
    swapCount
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
| Ethereum mainnet | 24,677,330 | Treasury owns 99.95% of OLAS-ETH LP ($1.83M POL), all 8 bridged LP tokens tracked, Chainlink price caching active |
| Gnosis L2 | 45,195,995 | Pool TVL ~$384K, 99.88% of BPT bridged to L1 Treasury |
| Polygon L2 | 84,315,911 | 99.86% of BPT bridged to L1 Treasury |

Cross-chain consistency confirmed: bridged LP balances on Ethereum closely match BPT supply on L2 (gap ~0.1% = LP not yet bridged). Treasury has never sold any LP tokens (totalSold = 0 everywhere).

See [CLAUDE.md — Verification Results](CLAUDE.md#verification-results-2026-03-17-v002) for full data tables.
