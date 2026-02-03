# Liquidity Verification Scripts

Scripts for validating the liquidity subgraph USD calculations against external data sources.

## Supported Chains

| Chain | DEX | Price Source |
|-------|-----|--------------|
| Ethereum | Uniswap V2 | Chainlink ETH/USD |
| Celo | Ubeswap (Uniswap V2 fork) | Chainlink CELO/USD |
| Gnosis | Balancer V2 | Pool spot price (WXDAI) |
| Polygon | Balancer V2 | Pool spot price (USDC) |
| Arbitrum | Balancer V2 | Pool spot price (USDC) |
| Optimism | Balancer V2 | Pool spot price (USDC) |
| Base | Balancer V2 | Pool spot price (USDC) |

## Scripts

### compare-dune.js

Compares subgraph LP token metrics and USD valuations against Dune Analytics data.

```bash
# Compare Ethereum (default)
node scripts/compare-dune.js

# Compare specific chain
node scripts/compare-dune.js --chain gnosis

# With Dune API key for real-time data
DUNE_API_KEY=xxx node scripts/compare-dune.js --chain ethereum
node scripts/compare-dune.js --chain polygon --dune-api-key xxx
```

**What it compares:**
- Total LP token supply
- Treasury (protocol-owned) LP supply
- Pool liquidity USD
- Protocol-owned liquidity USD

**Note:** LP token metrics should match exactly. USD values may differ ~1% due to different price sources.

### calculate-usd.js

Validates USD calculation methodology by comparing ETH-based vs OLAS-based approaches.

```bash
# Fetches OLAS price from CoinGecko automatically
node scripts/calculate-usd.js

# With manual OLAS price
node scripts/calculate-usd.js --olas-price 0.08
```

**What it shows:**
- Pool liquidity USD using ETH reserves × Chainlink ETH price
- Pool liquidity USD using OLAS reserves × CoinGecko OLAS price
- Difference between methods (should be <1% for balanced pools)
- Implied OLAS price from the ETH method

## USD Calculation Methods

### Uniswap V2 Chains (Ethereum, Celo)

Uses Chainlink price feeds:

```
Pool Liquidity USD = 2 × native_token_reserves × native_token_price (Chainlink)
```

### Balancer V2 Chains (Gnosis, Polygon, Arbitrum, Optimism, Base)

Uses pool spot price:

```
OLAS Price = stablecoin_balance / olas_balance
Pool Liquidity USD = 2 × olas_balance × olas_price
```

## Data Sources

| Source | Data |
|--------|------|
| Subgraph | LP metrics, reserves, price data |
| Dune Query [4963482](https://dune.com/queries/4963482) | Ethereum LP/POL data |
| Dune Query [5383248](https://dune.com/queries/5383248) | Multi-chain POL aggregation |
| CoinGecko | OLAS/USD price |
