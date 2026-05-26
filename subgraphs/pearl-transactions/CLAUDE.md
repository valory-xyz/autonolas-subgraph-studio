# pearl-transactions

Funds movement subgraph for Pearl Master Safe / Agent Safe accounts on
Gnosis, Polygon, Optimism, Base. **Currently a scaffold only** — see
[`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) on the
`docs/pearl-funds-plan` branch / PR #129 for the full design.

The directory name historically tracked the plan branch (`pearl-funds`)
but was renamed to `pearl-transactions` per PR #129 review §11 #5 to
match the downstream consumer (Pearl wallet transaction-history UI,
VLOP-73).

## Current state — scaffold

This PR (step 2 of `IMPLEMENTATION-PLAN.md` §8) lands an
empty-but-valid subgraph so CI is green and follow-up phase PRs only
need to add code. Specifically:

- `package.json` with the converged pinned tooling
  (`graph-cli` 0.98.1, `graph-ts` 0.38.2, `matchstick-as` 0.6.0).
- Template-pattern manifest (`subgraph.template.yaml` +
  `networks.json` + `scripts/generate-manifests.js`) covering all four
  v1 target networks.
- `schema.graphql` with a single `Service` placeholder entity (will be
  expanded — not replaced — in Phase 1a per
  [`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md)
  §5.1).
- One `ServiceRegistryL2.RegisterInstance` handler in
  `src/service-registry.ts` that writes the placeholder `Service` row.
  Phase 1a will replace it with the full handler set (`handleRegisterInstance`
  with `PendingRegistration` + `PendingBondAttribution` buffering,
  `handleActivateRegistration`, `handleCreateMultisigWithAgents`,
  `handleServiceNftTransfer`, `handleTerminateService`).
- One Matchstick smoke test in `tests/service-registry.test.ts`.

## Coming in subsequent PRs (per `IMPLEMENTATION-PLAN.md` §8)

| Step | Adds | Plan §§ |
|---|---|---|
| 3 — Phase 1a | `ServiceRegistryTokenUtility` data source + `Master Safe` / `MasterEOA` derivation via `getOwners()` + `SAFE_DEPLOYED` row + `SERVICE_BOND_DEPOSIT` / `_REFUND` rows with best-effort `bondType` attribution | §4.4, §5.1, §5.2 |
| 4 — Phase 1b | `StakingFactory` + `StakingProxy` (dynamic template); `STAKING_REWARD_CLAIM` / `UNSTAKE_REWARD` / `SERVICE_EVICTED` rows; `DailyServiceFunds` | §5.2 |
| 5 — Verify on Studio | Spot-check stake/claim/unstake against block explorer for a known Pearl service | — |
| 6 — Verify graph-node `startBlock`-in-context | Open Q #6: determines option for §6.2 pre-stake-transfer recovery | §6.2 |
| 7 — Phase 2a | OLAS `Transfer` data source + per-Safe `Safe` templates; `classifyTransfer`; `TrackedSafe` / `TrackedEOA` / `TokenBalance` / `Token`; `AgentFundingEvent` aggregation | §6.1, §6.2, §6.4, §6.5 |
| 8 — Phase 2b | USDC / USDC.e benchmark + product decision (§6.3) | §6.3 |
| 9 — Docs | Finalize this file + `README.md`; update root `CLAUDE.md` | — |

## Development workflow

```bash
cd subgraphs/pearl-transactions
yarn install                  # Install dependencies
yarn generate-manifests       # Render per-network manifests from template
yarn codegen                  # Generate TS types from schema + ABIs
yarn build                    # Build (compiles to WASM, uses gnosis manifest)
yarn test                     # Run Matchstick tests
```

Deploy per network (manual; CI/CD also wraps these):

```bash
yarn deploy-gnosis
yarn deploy-matic
yarn deploy-optimism
yarn deploy-base
```

## Multi-network deployment

| Network | `ServiceRegistryL2` | Start block |
|---|---|---|
| `gnosis` | `0x9338b5153AE39BB89f50468E608eD9d764B755fD` | 27,871,084 |
| `matic` (Polygon) | `0xE3607b00E75f6405248323A9417ff6b39B244b50` | 41,783,952 |
| `optimism` | `0x3d77596beb0f130a4415df3D2D8232B3d3D31e44` | 116,423,039 |
| `base` | `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` | 10,827,380 |

Addresses converge with `subgraphs/service-registry/networks.json`.
Other data sources (StakingFactory, ServiceRegistryTokenUtility, OLAS,
USDC, USDC.e, Safe template) come online in later PRs per the plan.
