# BabyDegen Base (Basius) Subgraph

Tracks the **Basius** babydegen agent's portfolio performance on **Base**. Port of
`babydegen-optimism` repointed to Base + **Aerodrome** (the only DEX Basius trades on).
Indexing **filters by Olas `agentId == 115`** and tracks every Basius service (currently
607/610/611/612 on Base), mirroring optimism's `OPTIMUS_AGENT_ID` filter.

> **Id note:** 115 is the **agent** id, not a service id. (Service *115* is an unrelated
> 2025 service on the generic agent 9 — an early Divya/Tanya mix-up, resolved on-chain.)

> Status: **Phase 1 complete + Phase 2 stub.** Builds + tests green. Registry, Aerodrome
> surface, Chainlink feeds, LiFi, v2 PoolFactory, startBlock and cadence all confirmed.
> AERO is priced off the Aerodrome AERO/USDC volatile pool; OLAS dropped (not held). A
> provisional daily-activity stub (DAA + swaps-based transactions) is in place pending the
> product definition of "transactions". See `IMPLEMENTATION-PLAN.md`.

## What changed vs babydegen-optimism

| Aspect | Optimism | Base (this subgraph) |
|--------|----------|----------------------|
| Network | `optimism` | `base` |
| DEXs tracked | Velodrome CL + V2, **Uniswap V3**, **Balancer** | **Aerodrome only** (CL = Slipstream, v2) |
| Agent scoping | agent-id filter (`OPTIMUS_AGENT_ID = 40`) + excluded ids | agent-id filter (`BASIUS_AGENT_ID = 115`), all matching services |
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
| Basius services | agentId 115 → 607/610/611/612 | tracked dynamically by agent id, not hardcoded |
| Aerodrome Slipstream NFPM | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | CL positions (`VeloNFTManager`) |
| Aerodrome Slipstream factory | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | CL pool discovery |
| Aerodrome LpSugar v3 | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` | v2 bootstrap (`VeloV2Sugar`) |
| Aerodrome v2 PoolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | confirmed |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | CREATE2, same on all EVM |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | primary funding/valuation |
| WETH / OLAS / AERO | `0x4200…0006` / `0x54330d28…` / `0x940181a9…` | |

Chainlink feeds (Base, verified on-chain — live, 8 decimals): ETH/USD `0x71041ddd…`,
USDC/USD `0x7e860098…`.

**startBlock** for every data source = `47163056` (earliest agentId-115 service, #607,
2026-06-10).

### Base reference addresses (NOT indexed by this subgraph)

babydegen tracks via the registry + Safe events, so it does not wire the staking/multisend
contracts. For reference, the corrected Base addresses (Divya's first set were stale
Optimism values): StakingToken `0x2585e63df7BD9De8e058884D496658a030b5c6ce`, ActivityChecker
`0x87C9922A099467E5A80367553e7003349FE50106`, Multisend `0x998739BFdAAdde7C933B942a68053933098f9EDa`.

## Tracked tokens

USDC (native), WETH, AERO, and the whitelisted stablecoins BOLD / msUSD / frxUSD / eUSD /
axlUSDC. USDC+WETH price off Chainlink; stables resolve to ~$1 (referenced to the USDC feed
— confirmed fine by Divya); **AERO** (the CL-gauge reward token) prices off the Aerodrome
AERO/USDC volatile pool `0x6cdcb1c4…` via the `velodrome_v2` adapter (`tokenConfig.ts`).
**OLAS is not tracked** — Basius holds none and it isn't a trading asset for this agent.

## Schema, core logic, KPIs

Schema and the entire portfolio/ROI/APR/snapshot/population pipeline are **identical** to
babydegen-optimism (network-agnostic). The website KPIs map to existing entities:

- "APR relative to USDC – MA7D" → `DailyPopulationMetric.sma7dAPR`
- "APR relative to ETH – MA7D" → `DailyPopulationMetric.sma7dEthAdjustedAPR`
- per-day ROI (explorer heatmap) → `AgentPortfolioSnapshot.roi`

Snapshots fire from the `PortfolioScheduler` block handler at UTC-midnight crossings.
Block-handler interval is `every: 1800` (~1h on Base) — confirmed: a finer interval can't
add snapshots since they only fire on day boundaries.

### Phase 2 stub — daily activity (`src/dailyActivity.ts`)

`DailyActivityMetric` (id = UTC-midnight day) holds per-day `transactionCount` and
`activeAgents` (DAA) for the agent-explorer heatmap; `DailyAgentActivity`
(`<day>-<serviceSafe>`) is an immutable dedup marker so each service counts toward DAA once
per day. `recordSwapActivity()` is called from the LiFi handler on each tracked swap.
**Provisional:** `transactionCount` counts LiFi swaps — the final "transactions" definition
(swaps vs Safe executions vs mech requests; mech requests need a new data source) is pending
product confirmation (Tatiana).

## Development

```bash
yarn install && yarn codegen && yarn build && yarn test
```

See the root `CLAUDE.md` for repo-wide conventions. For deeper architecture/handler/price
docs, the optimism `CLAUDE.md` still applies to everything not changed above.
