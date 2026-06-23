# BabyDegen Base Subgraph (Basius)

Tracks portfolio performance and population-level metrics for the **Basius** agent
(Pearl / BabyDegen agent economy) on **Base**. It monitors the agent's DeFi activity
on **Aerodrome** (Slipstream concentrated-liquidity + v2 stable/volatile pools),
tracking portfolio value, position management, funding flows, ROI/APR, and daily
population statistics.

It is a port of [`babydegen-optimism`](../babydegen-optimism): the portfolio scheduler,
ROI/APR math, daily snapshots and population metrics are identical and network-agnostic.
The differences are network configuration (Base addresses, Chainlink feeds), the DEX
surface (Aerodrome only — Uniswap V3 and Balancer are dropped), and the agent scope.

## Scope

- **Network:** Base
- **Agent:** Basius — pinned to Olas **service ID 115** (service safe
  `0x9eb5faed6e6983fedc4206af1b58a17fabe9a0d9`, canonical agent id 9) on
  `ServiceRegistryL2` `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE`.
- **DEX:** Aerodrome (a Velodrome fork — the existing `velo*` handlers and
  `abis/defi/Velodrome*` ABIs are reused; the consumer-facing `protocol` strings are
  `aerodrome-cl` / `aerodrome-v2`).

## Status

Phase 1 scaffold — builds, codegens and tests green. Several config values are
placeholders pending confirmation from the team (every one is marked `TODO`/`TODO(divya)`
in source); see [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md). Phase 2
(explorer daily DAA / transactions-per-day) is deferred.

## Development

```bash
yarn install
yarn codegen
yarn build
yarn test
```

See [`CLAUDE.md`](./CLAUDE.md) for entities, handlers, and the Optimism→Base port map.
