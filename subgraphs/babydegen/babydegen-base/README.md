# BabyDegen Base Subgraph (Basius)

Tracks portfolio performance and population-level metrics for the **Basius** agent
(Pearl / BabyDegen agent economy) on **Base**. It monitors the agents' DeFi activity
on **Aerodrome** (Slipstream concentrated-liquidity + v2 stable/volatile pools),
tracking portfolio value, position management, funding flows, ROI/APR, and daily
population statistics.

It is a port of [`babydegen-optimism`](../babydegen-optimism): the portfolio scheduler,
ROI/APR math, daily snapshots and population metrics are identical and network-agnostic.
The differences are network configuration (Base addresses, Chainlink feeds), the DEX
surface (Aerodrome only — Uniswap V3 and Balancer are dropped), and the agent scope.

## Scope

- **Network:** Base
- **Agent:** Basius — identified by Olas **agentId 115** on `ServiceRegistryL2`
  `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE`. The subgraph tracks **every service that
  registers under agentId 115** (mirroring how `babydegen-optimism` filters on
  `OPTIMUS_AGENT_ID`), not a single pinned service — there are already several
  (services 607/610/611/612 on Base). Indexing starts at block **47163056** (the earliest
  agentId-115 registration, service 607, 2026-06-10).
  > Note: `115` is the **agent id**, not a service id. Service id 115 is an unrelated 2025
  > service on the generic agentId 9 — it is *not* Basius.
- **DEX:** Aerodrome (a Velodrome fork — the existing `velo*` handlers and
  `abis/defi/Velodrome*` ABIs are reused; the consumer-facing `protocol` strings are
  `aerodrome-cl` / `aerodrome-v2`).

## Status

Functional Phase 1 — builds, codegens and tests green; addresses, startBlock, and the
agentId filter are confirmed on-chain. AERO is priced (Aerodrome AERO/USDC pool); OLAS is
dropped (not held by Basius). A Phase 2 daily-activity stub (`DailyActivityMetric`: DAA +
swaps-based `transactionCount`) is in place — the final "transactions" definition is the one
open product item. See [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md).

## Development

```bash
yarn install
yarn codegen
yarn build
yarn test
```

See [`CLAUDE.md`](./CLAUDE.md) for entities, handlers, and the Optimism→Base port map.
