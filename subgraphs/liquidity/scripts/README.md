# Liquidity Verification Scripts

Scripts for validating the liquidity subgraph USD calculations against external data sources.

## Scripts

### compare-dune.js

Compares subgraph LP token metrics and USD valuations against Dune Analytics data.

```bash
# With Dune API key (real-time data)
DUNE_API_KEY=xxx node scripts/compare-dune.js

# Without API key (uses cached values)
node scripts/compare-dune.js
```

**What it compares:**
- Total LP token supply
- Treasury (protocol-owned) LP supply
- Pool liquidity USD
- Protocol-owned liquidity USD

**Note:** LP token metrics should match exactly. USD values may differ ~0.2% due to different price sources (Chainlink vs DEX prices).

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

The subgraph uses the **ETH-based method**:

```
Pool Liquidity USD = 2 × ETH_reserves × ETH_price (Chainlink)
```

This is validated against the **OLAS-based method**:

```
Pool Liquidity USD = 2 × OLAS_reserves × OLAS_price (CoinGecko)
```

Both methods should yield similar results for balanced Uniswap V2 AMM pools due to the constant product invariant.

## Data Sources

| Source | Data |
|--------|------|
| Subgraph | LP metrics, ETH reserves, Chainlink ETH/USD price |
| Dune Query [4963482](https://dune.com/queries/4963482) | LP supply, POL, USD valuations |
| CoinGecko | OLAS/USD price |
