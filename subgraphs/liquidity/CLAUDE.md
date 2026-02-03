# Liquidity Subgraph Index

## What & When

| What | When |
|------|------|
| `schema.graphql` | Define entities for liquidity tracking |
| `src/mapping.ts` | Implement event handlers |
| `src/utils.ts` | Shared helper functions |
| `README.md` | Architecture, dual DEX patterns, USD calculation logic |
| `subgraph.yaml` | Ethereum mainnet config (Uniswap V2 OLAS/ETH) |
| `subgraph.celo.yaml` | Celo config (Ubeswap OLAS/CELO) |
| `subgraph.gnosis.yaml` | Gnosis config (Balancer V2 OLAS/WXDAI) |
| `subgraph.polygon.yaml` | Polygon config (Balancer V2 OLAS/USDC) |
| `subgraph.arbitrum.yaml` | Arbitrum config (Balancer V2 OLAS/USDC) |
| `subgraph.optimism.yaml` | Optimism config (Balancer V2 OLAS/USDC) |
| `subgraph.base.yaml` | Base config (Balancer V2 OLAS/USDC) |

## Handlers

| What | When |
|------|------|
| `handleLPTransfer()` | Track LP/BPT token transfers (mints, burns, treasury movements) |
| `handleSync()` | Track Uniswap V2 reserves and calculate USD via Chainlink (Ethereum, Celo) |
| `handlePoolBalanceChanged()` | Track Balancer V2 reserves and calculate USD via spot price (Gnosis, Polygon, Arbitrum, Optimism, Base) |
| `handleBridgedTransfer()` | Track L2 bridged BPT tokens held in Ethereum Treasury (Polygon, Arbitrum, Optimism, Base) |

## Key Entities

| What | When |
|------|------|
| `LPTokenMetrics` | Query global liquidity metrics (total supply, treasury %, USD values) |
| `TreasuryHoldings` | Query treasury LP/BPT token balance history |
| `PoolReserves` | Query current pool reserves (OLAS + native/stablecoin) |
| `LPTransfer` | Query individual transfer events for auditing |
| `BridgedPOL` | Query Treasury holdings of L2 BPT bridged to Ethereum (per-chain breakdown) |
