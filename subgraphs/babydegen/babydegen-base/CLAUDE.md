# BabyDegen Base (Basius) Subgraph

Tracks the **Basius** babydegen agent's portfolio performance on **Base**. Port of
`babydegen-optimism` repointed to Base + **Aerodrome** (the only DEX Basius trades on).
Indexing is **pinned to Olas service 115**.

> Status: **Phase 1 scaffold.** Builds + tests are green with placeholder values for a
> handful of addresses/blocks still to be confirmed (every one is marked with a
> `TODO(divya)` / `TODO` comment). See `IMPLEMENTATION-PLAN.md` for the open questions.

## What changed vs babydegen-optimism

| Aspect | Optimism | Base (this subgraph) |
|--------|----------|----------------------|
| Network | `optimism` | `base` |
| DEXs tracked | Velodrome CL + V2, **Uniswap V3**, **Balancer** | **Aerodrome only** (CL = Slipstream, v2) |
| Agent scoping | agent-id filter (`OPTIMUS_AGENT_ID = 40`) + excluded ids | **pinned to service id 115** |
| Pricing | Chainlink + DEX | Chainlink (Base feeds) + Aerodrome; stables via $1 |
| Reward token | VELO | AERO |

**Dropped files** (Uniswap V3 / Balancer / manual bootstrap / dead helpers):
`uniV3NFTManager.ts`, `uniV3Pool.ts`, `uniV3Shared.ts`, `balancerVault.ts`,
`balancerShared.ts`, `manualServiceBootstrap.ts`, plus the unused
`veloCLPool.ts` / `veloV2Router.ts` / `veloV2DirectPool.ts`.

**Naming note:** the Velodrome handler files keep their `velo*` names (Aerodrome is a
Velodrome fork with identical ABIs — reused from `abis/defi/Velodrome*` and
`abis/nft/VelodromePositionNFTManager.json`). Only the **consumer-facing** protocol
strings changed: `ProtocolPosition.protocol` is now `aerodrome-cl` / `aerodrome-v2`
(`PROTOCOL_VELODROME_V3` / `PROTOCOL_VELODROME_V2` constants).

## Key contracts (Base mainnet)

| Contract | Address | Notes |
|----------|---------|-------|
| ServiceRegistryL2 | `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` | canonical Olas registry on Base |
| Basius service safe | `0x9eb5faed6e6983fedc4206af1b58a17fabe9a0d9` | service 115, agent id 9 |
| Aerodrome Slipstream NFPM | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | CL positions (`VeloNFTManager`) |
| Aerodrome Slipstream factory | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | CL pool discovery |
| Aerodrome LpSugar v3 | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` | v2 bootstrap (`VeloV2Sugar`) |
| Aerodrome v2 PoolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | **TODO(divya): VERIFY** |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | **TODO(divya): VERIFY on Base** |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | primary funding/valuation |
| WETH / OLAS / AERO | `0x4200…0006` / `0x54330d28…` / `0x940181a9…` | |

Chainlink feeds (Base): ETH/USD `0x71041ddd…` and USDC/USD `0x7e860098…` — both
`TODO(divya): VERIFY`.

## Tracked tokens

USDC (native), USDbC (bridged), WETH, OLAS, AERO, and the whitelisted stablecoins
BOLD / msUSD / frxUSD / eUSD / axlUSDC. USDC+WETH price off Chainlink; stables resolve to
~$1 (referenced to the USDC feed); **OLAS and AERO are unpriced (→ $0) until Aerodrome
pools are added** (`tokenConfig.ts`).

## Schema, core logic, KPIs

Schema and the entire portfolio/ROI/APR/snapshot/population pipeline are **identical** to
babydegen-optimism (network-agnostic). The website KPIs map to existing entities:

- "APR relative to USDC – MA7D" → `DailyPopulationMetric.sma7dAPR`
- "APR relative to ETH – MA7D" → `DailyPopulationMetric.sma7dEthAdjustedAPR`
- per-day ROI (explorer heatmap) → `AgentPortfolioSnapshot.roi`

Snapshots fire from the `PortfolioScheduler` block handler at UTC-midnight crossings.
Block-handler interval is still `every: 1800` — on Base (~2s blocks) that is ~1h; consider
`900` (~30m) once cadence is confirmed.

## Development

```bash
yarn install && yarn codegen && yarn build && yarn test
```

See the root `CLAUDE.md` for repo-wide conventions. For deeper architecture/handler/price
docs, the optimism `CLAUDE.md` still applies to everything not changed above.
