# Basius (`babydegen-base`) — implementation plan

New subgraph for the **Basius** babydegen agent on **Base**, providing portfolio / APR /
ROI metrics for the olas.network babydegen page and (later) the agent-explorer page. It is
a port of `babydegen-optimism`, stripped to **Aerodrome-only** and scoped by **Olas
`agentId == 115`** (tracking every Basius service), mirroring optimism's `OPTIMUS_AGENT_ID`.

## Why this shape

`babydegen-mode` (a sibling Optimism→Mode port) proved the babydegen subgraph is
~95% network configuration: the schema and the entire ROI/APR/snapshot/population pipeline
are network-agnostic and copy unchanged. Basius trades exclusively on **Aerodrome**, which
is a **Velodrome fork** (Slipstream CL + v2 stable/volatile), so the existing Velodrome
handlers and ABIs (`abis/defi/Velodrome*`, `abis/nft/VelodromePositionNFTManager.json`) are
reused directly. Uniswap V3, Balancer, and Mode's STURDY vault are not in scope.

## Verified on-chain (Base mainnet)

- Canonical `ServiceRegistryL2 = 0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` (same address
  the repo's `service-registry` subgraph uses for Base; has bytecode).
- **Basius = `agentId 115`.** Services running it (all DEPLOYED, distinct multisigs):
  **607, 610, 611, 612**. The earliest, **#607**, was created at block **47163056
  (2026-06-10)** → that's the subgraph `startBlock`.
- ⚠️ **115 is the AGENT id, not a service id.** Service *115* (agentId `[9]`, created
  2025-03-28) is an unrelated old service on the generic agent 9 — NOT Basius. (Original
  context conflated the two; resolved on-chain.)
- All Aerodrome contracts + USDC/WETH/OLAS/AERO have bytecode on Base; Chainlink ETH/USD &
  USDC/USD feeds verified (live, 8 decimals); v2 PoolFactory and LiFi confirmed.
- ⚠️ The four Olas addresses originally provided (ServiceRegistry `0x48b6…`, StakingToken
  `0x88996…`, ActivityChecker `0x7Fd1F4…`, Multisend `0xbE5b00…`) **have no bytecode on
  Base** — stale Optimism values. Corrected Base StakingToken/ActivityChecker/Multisend are
  in CLAUDE.md (reference only; this subgraph indexes via the registry + Safe events).

## KPI → entity mapping (already produced by the ported code)

| Website metric | Source entity/field |
|----------------|---------------------|
| APR relative to USDC – MA7D | `DailyPopulationMetric.sma7dAPR` |
| APR relative to ETH – MA7D | `DailyPopulationMetric.sma7dEthAdjustedAPR` |
| Weekly ROI / APR (KPIs) | `AgentPortfolio.roi` / `.apr` |
| Explorer "ROI per day" heatmap | `AgentPortfolioSnapshot.roi` (per agent, per UTC day) |

`apr = roi * 365 / daysSinceFirstTrade`; ETH-adjusted strips
`ETHDelta = (curEth/firstEth − 1) * 100`.

## Phase 1 — core subgraph (DONE in this PR, modulo TODOs)

- [x] Clone `babydegen-optimism` → `subgraphs/babydegen/babydegen-base`.
- [x] Drop Uniswap V3 + Balancer + manual bootstrap + dead helper files; clean all references.
- [x] Repoint `constants.ts` / `config.ts` / `tokenConfig.ts` to Base (registry, tokens,
      Chainlink feeds, Aerodrome addresses); protocol strings → `aerodrome-cl`/`aerodrome-v2`;
      reward token VELO → AERO.
- [x] Filter `serviceRegistry.ts` by `agentId == 115` (both handlers; tracks all matching
      services, like optimism).
- [x] Rewrite `subgraph.yaml` for Base/Aerodrome (CL NFPM, Slipstream factory, v2 factory +
      LpSugar bootstrap, LiFi, token Transfer sources, block-handler scheduler, Safe + v2-pool
      templates). Uniswap/Balancer sources removed. `startBlock = 47163056` everywhere.
- [x] `package.json` name → `olas-babydegen-base`; undici resolution bumped to `^7.28.0`.
- [x] Update Matchstick tests to agentId-filter semantics (incl. a multi-service test) —
      **codegen + build + 10/10 tests green.**
- [x] Add `babydegen-base` to the CI matrix.

This delivers `AgentPortfolio`, `AgentPortfolioSnapshot`, and `DailyPopulationMetric`, i.e.
everything the **current** babydegen website page shows for Basius.

### Confirmed since the first scaffold (Divya + on-chain)

- `startBlock = 47163056` (earliest agentId-115 service, #607).
- Aerodrome **v2 PoolFactory** `0x420DD381…40Da`, **LiFi Diamond** `0x1231DEB6…`, and Base
  Chainlink **ETH/USD** / **USDC/USD** feeds — all confirmed/verified.
- Whitelisted stables (BOLD/msUSD/frxUSD/eUSD/axlUSDC) price at ~$1 via the USDC feed —
  confirmed fine (Basius holds no meaningful balances).
- Speculative **USDbC** token removed (not in Basius's spec).

### Token pricing

- **OLAS dropped** — Basius holds none and it isn't a trading asset; removed from the token
  set, manifest, and decimals/symbol maps.
- **AERO priced** — off the Aerodrome AERO/USDC *volatile* pool
  `0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d` via the `velodrome_v2` adapter (same way
  optimism prices VELO). It's the CL-gauge reward token, so this makes `claimableRewardUSD`
  correct once Basius opens CL positions. Stables remain ~$1 via the USDC feed.

## Phase 2 — explorer daily metrics (STUB LANDED)

A minimal, clearly-labelled skeleton is in place:
- `DailyActivityMetric` (id = UTC-midnight day) with `activeAgents` (DAA) and
  `transactionCount`; `DailyAgentActivity` (`<day>-<serviceSafe>`) dedups DAA per day.
- `recordSwapActivity()` (`src/dailyActivity.ts`) is called from the LiFi handler on each
  tracked swap; covered by Matchstick tests (single swap, repeat swap, multi-service DAA).
- ROI/day is already available via `AgentPortfolioSnapshot.roi`.

**Provisional / pending product:** `transactionCount` currently counts **LiFi swaps**. The
final definition of "transactions per day" is undecided — candidates: **swaps** (done),
**Safe executions** (`ExecutionSuccess`, cheap, already captured), or **mech requests**
(Tatiana's historical meaning; Divya notes babydegen now uses mechs — this one needs a NEW
Base mech-marketplace data source). DAA's "active" signal (currently = swapped that day) may
also need broadening once the metric is confirmed.

## Open questions for the team

1. **Phase 2 definition** (Tatiana/Presh) — what counts as a "transaction per day" (swaps vs
   Safe executions vs mech requests) and how DAA should be computed. The swaps-based stub is
   live; redirecting to mech requests is the only option needing a new data source.
2. **AERO/USDC pool choice** (Divya, optional) — confirm the volatile AERO/USDC pool
   `0x6cdcb1c4…` is the preferred price source (vs AERO/WETH).

_Resolved: agentId-vs-serviceId scoping (agentId 115, multi-service), v2 PoolFactory,
startBlock, LiFi, Chainlink feeds, stable pricing, block-handler cadence (`1800`), OLAS
dropped, AERO priced._
