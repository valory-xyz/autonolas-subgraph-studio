# pearl-transactions

Tracks **funds movement for Pearl Master Safe and Agent Safe accounts**
on Gnosis, Polygon, Optimism, Base. The on-chain backend for the Pearl
wallet transaction-history UI.

> **Status — scaffold.** Only the directory skeleton + manifest +
> single placeholder handler are in place. Implementation work is
> phased per [`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md)
> (on branch `docs/pearl-funds-plan` / PR #129). See
> [`CLAUDE.md`](./CLAUDE.md) for the per-PR roadmap.

## What this subgraph will cover

| Entity | Source | Phase |
|---|---|---|
| `MasterSafe`, `Service`, `AgentSafe`, `MasterEOA` graph | `ServiceRegistryL2` + `getOwners()` eth_call | 1 |
| Service NFT custody trail (Master Safe ↔ staking proxy ↔ Master Safe) | `ServiceRegistryL2.Transfer` (ERC-721) | 1 |
| `SERVICE_BOND_DEPOSIT` / `SERVICE_BOND_REFUND` (2 of each per stake-cycle) | `ServiceRegistryTokenUtility.TokenDeposit` / `TokenRefund` | 1 |
| `STAKING_REWARD_CLAIM` / `UNSTAKE_REWARD` / `SERVICE_EVICTED` | `StakingProxy` events | 1 |
| Raw OLAS `Transfer` ledger with `classifyTransfer` reconciliation | dedicated OLAS data source | 2a |
| Native coin (xDAI / POL / ETH) inbound (precise) + outbound (approximate) | per-Safe `Safe` template | 2a |
| `Master EOA` owner-list maintenance | `Safe.AddedOwner` / `RemovedOwner` / `ChangedThreshold` | 2a |
| `AgentFundingEvent` (per-tx grouping for Master→Agent multi-token funding) | derived | 2a |
| `USDC` / `USDC.e` ledger (Polygon cost hotspot — benchmark-gated) | dedicated `Transfer` data sources | 2b |

## What this subgraph does **not** cover

- In-market bet flows on Polymarket / Omen — covered by
  `predict-polymarket` and `predict-omen`. Consumers join on Agent Safe
  address.
- USD valuation — raw token amounts only.
- Pre-Master-Safe-creation Master EOA history — fundamentally
  unrecoverable from on-chain events; see plan §5.4 / §11 #8 for
  options.
- Any server-side / off-chain join keys (mode / tool / tier / requestId
  / time-window) — see plan §12 ("Deliberately Absent").

## Development

```bash
yarn install
yarn generate-manifests       # Render per-network manifests
yarn codegen                  # Generate TS types
yarn test                     # Run Matchstick tests
```

See [`CLAUDE.md`](./CLAUDE.md) for the full workflow + per-PR roadmap.

## Related documents

- [`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) —
  full design (PR #129).
- [`subgraphs/staking`](../staking) — reuse source for `StakingFactory`
  + `StakingProxy` template patterns.
- [`subgraphs/service-registry`](../service-registry) — reuse source
  for `ServiceRegistryL2` data source shape.
- [`subgraphs/babydegen/babydegen-optimism`](../babydegen/babydegen-optimism)
  — reuse source for `Safe` template + `tokenBalances` patterns.
- [`subgraphs/predict/predict-omen`](../predict/predict-omen) and
  [`subgraphs/predict/predict-polymarket`](../predict/predict-polymarket)
  — in-market bet ledger; consumers of pearl-transactions join on
  Agent Safe address.
