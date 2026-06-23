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

### Only remaining placeholder

- **OLAS / AERO pricing**: unconfigured → resolves to $0. Divya to send Aerodrome OLAS/<pair>
  and AERO/<pair> pools; backfill in a follow-up PR. **AERO is the CL gauge reward token, so
  reward USD reads 0 until added — prioritise it.**

## Phase 2 — explorer daily metrics (DEFERRED)

The agent-explorer heatmap wants, per day: **DAA (daily active agents)**, **transactions**,
**avg**, **ROI**. ROI/day already exists (`AgentPortfolioSnapshot.roi`). DAA and
transactions-per-day are **not implemented** in babydegen today.

**Blocked on a product decision:** what does "transactions" mean for babydegen? Historically
it meant **mech requests** (Tatiana) — and babydegen now relies on mech requests for its KPI
(Divya) — vs counting **swaps**. Once defined, Phase 2 likely indexes the Base
mech-marketplace requests for the Basius safe and adds a daily metric entity.

## Open questions for the team

1. **OLAS/AERO pricing pools** (Divya) — Aerodrome OLAS/<pair> and AERO/<pair> pool addresses
   (deepest WETH or USDC pair) to lift these off $0; AERO first.
2. **Phase 2** (Tatiana) — define "transactions per day" for babydegen (mech requests vs
   swaps) and how DAA should be computed, so the explorer metrics can be scoped.

_Resolved: agentId-vs-serviceId scoping (it's agentId 115, multi-service), v2 PoolFactory,
startBlock, LiFi, Chainlink feeds, stable pricing, block-handler cadence (`1800`)._
