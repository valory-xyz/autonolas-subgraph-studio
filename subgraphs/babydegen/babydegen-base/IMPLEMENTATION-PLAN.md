# Basius (`babydegen-base`) — implementation plan

New subgraph for the **Basius** babydegen agent on **Base**, providing portfolio / APR /
ROI metrics for the olas.network babydegen page and (later) the agent-explorer page. It is
a port of `babydegen-optimism`, stripped to **Aerodrome-only** and **pinned to Olas service
115**.

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
- Basius = **service 115**, **agent id 9**, service safe (multisig)
  `0x9eb5faed6e6983fedc4206af1b58a17fabe9a0d9`, owner/operator `0x3aad0fd3…`, state DEPLOYED.
- All Aerodrome contracts + USDC/WETH/OLAS/AERO have bytecode on Base.
- ⚠️ The four Olas addresses originally provided (ServiceRegistry `0x48b6…`, StakingToken
  `0x88996…`, ActivityChecker `0x7Fd1F4…`, Multisend `0xbE5b00…`) **have no bytecode on
  Base** — wrong network/mislabeled. We use the canonical registry instead; the
  staking/multisend contracts aren't needed (babydegen tracks via the registry + Safe events).

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
- [x] Pin `serviceRegistry.ts` to service 115 (both handlers).
- [x] Rewrite `subgraph.yaml` for Base/Aerodrome (CL NFPM, Slipstream factory, v2 factory +
      LpSugar bootstrap, LiFi, token Transfer sources, block-handler scheduler, Safe + v2-pool
      templates). Uniswap/Balancer sources removed.
- [x] `package.json` name → `olas-babydegen-base`.
- [x] Update Matchstick tests to the pinned-service semantics — **codegen + build + 10/10
      tests green.**
- [x] Add `babydegen-base` to the CI matrix.

This delivers `AgentPortfolio`, `AgentPortfolioSnapshot`, and `DailyPopulationMetric`, i.e.
everything the **current** babydegen website page shows for Basius.

### Placeholders still in the tree (all marked `TODO`)

- Every `startBlock` = `17310019` (placeholder) → set to the **service-115 registration
  block** on Base.
- Aerodrome **v2 PoolFactory** `0x420DD381…40Da` → VERIFY (not provided by Divya).
- Base Chainlink **ETH/USD** `0x71041ddd…` and **USDC/USD** `0x7e860098…` → VERIFY.
- **LiFi Diamond** on Base `0x1231DEB6…` → VERIFY.
- **USDbC** `0xd9aAEc86…` → VERIFY Basius actually holds bridged USDC.
- **OLAS / AERO pricing**: unconfigured → resolve to $0. Add Aerodrome OLAS/<pair> and
  AERO/<pair> pools in `tokenConfig.ts` (AERO matters: it's the CL gauge reward token, so
  reward USD is currently 0).
- Whitelisted stables (BOLD/msUSD/frxUSD/eUSD/axlUSDC) currently price at ~$1 via the USDC
  feed → confirm whether real Aerodrome pools are needed.

## Phase 2 — explorer daily metrics (DEFERRED)

The agent-explorer heatmap wants, per day: **DAA (daily active agents)**, **transactions**,
**avg**, **ROI**. ROI/day already exists (`AgentPortfolioSnapshot.roi`). DAA and
transactions-per-day are **not implemented** in babydegen today.

**Blocked on a product decision:** what does "transactions" mean for babydegen? Historically
it meant **mech requests** (Tatiana) — and babydegen now relies on mech requests for its KPI
(Divya) — vs counting **swaps**. Once defined, Phase 2 likely indexes the Base
mech-marketplace requests for the Basius safe and adds a daily metric entity.

## Open questions for the team

1. **Scope** — keep the single **service-115 pin**, or generalise to an **agent-id (9)
   filter**? Agent 9 may be shared by other Base services, so we pinned for safety. (Marked
   as a `TODO(reviewers)` in `serviceRegistry.ts`.)
2. **Aerodrome v2 PoolFactory** address (for `PoolCreated` discovery) — not in the config Divya
   provided.
3. **service-115 registration block** for `startBlock`.
4. **LiFi Diamond** address on Base (confirm the cross-chain deterministic address applies).
5. **Whitelisted-asset pricing** — $1 fallback vs real Aerodrome pools for
   BOLD/msUSD/frxUSD/eUSD/axlUSDC; and the **OLAS/AERO** pricing pools.
6. **Block-handler cadence** — keep `every: 1800` (~1h on Base) or drop to `900` (~30m)?
7. **Phase 2** — confirm the "transactions/DAA per day" definitions so the explorer metrics
   can be scoped.
