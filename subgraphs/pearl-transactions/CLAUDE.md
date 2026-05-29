# pearl-transactions

Funds movement subgraph for Pearl Master Safe / Agent Safe accounts on
Gnosis, Polygon, Optimism, Base. **Currently a scaffold only** — see
[`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) on the
`docs/pearl-funds-plan` branch / PR #129 for the full design.

The directory name historically tracked the plan branch (`pearl-funds`)
but was renamed to `pearl-transactions` per PR #129 review §11 #5 to
match the downstream consumer (Pearl wallet transaction-history UI,
VLOP-73).

## Current state — Phase 1a (registry + SRTU bonds + Master EOA)

Following the scaffold PR, Phase 1a (step 3 of
[`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) §8)
adds the full semantic ledger for the registry + SRTU side. Implemented:

- **Schema** (`schema.graphql`) — `MasterSafe` (with `masterEoa` /
  `owners` / `threshold` from `getOwners()` eth_call), `AgentSafe`,
  `Service` (with `agentIds` + `operators` consumer-filter lists, NFT
  custodian, state), `FundsMovement` (immutable, with `bondType` enum),
  `ServiceNftCustodyChange`, plus internal helpers (`ServiceIndex`,
  `PendingRegistration`, `PendingBondCounter`, `PendingBondAttribution`,
  `AgentBondStashGuard`).
- **Handlers** (`src/service-registry.ts`):
  `handleRegisterInstance` (with `PendingRegistration` buffering +
  `AGENT_BOND` attribution dedupe via `AgentBondStashGuard`);
  `handleActivateRegistration` (`SECURITY_DEPOSIT` attribution);
  `handleCreateMultisigWithAgents` (create `Service` + `AgentSafe`,
  drain buffer, write `ServiceIndex`); `handleServiceNftTransfer`
  (NFT custody + `getOrCreateMasterSafe` for the un-staked path);
  `handleTerminateService` (state + refund attribution);
  `handleOperatorUnbond` (`AGENT_BOND` refund attribution).
- **Handlers** (`src/service-registry-token-utility.ts`):
  `handleTokenDeposit` → `SERVICE_BOND_DEPOSIT` row with best-effort
  `bondType` consumed from the per-tx queue; `handleTokenRefund`
  mirror.
- **Master EOA derivation** (`src/utils.ts` `getOrCreateMasterSafe`) —
  one-shot `GnosisSafe.getOwners()` + `getThreshold()` eth_call at
  first sighting of each Master Safe. Emits a `SAFE_DEPLOYED`
  semantic row anchoring the consumer wallet UI's "Setup complete"
  entry. Idempotent on subsequent calls (only bumps
  `lastActivityTimestamp`).
- **Bond-type attribution queue** (`src/utils.ts`
  `enqueuePendingBondRow` / `dequeueAndAttribute`) — per-tx FIFO.
  On-chain the SRTU event (`TokenDeposit`/`TokenRefund`) always fires
  *before* its `ServiceRegistryL2` counterpart (`ServiceManager` calls
  the `*TokenDeposit`/`*TokenRefund` function before the registry
  function in every path), so the SRTU handler is the **producer** — it
  creates the `FundsMovement` row and enqueues its id — and the
  `ServiceRegistryL2` handler is the **consumer**, dequeuing the oldest
  pending row and backfilling `serviceId` + `bondType` (hence
  `FundsMovement` is `immutable: false`). `bondType` stays null when no
  SR event follows the deposit/refund.
- **8 Matchstick tests** covering ordering, dedupe, NFT custody,
  stake/unstake cycles with bondType attribution, null-attribution
  fallback, per-tx isolation.

Honest limits documented in
[`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) §5.4
that apply to Phase 1a as-shipped:
- `bondType` attribution is best-effort; unmodeled call orderings
  leave it null but preserve the amount.
- Non-Safe NFT recipients (staking proxy when a service is staked,
  EOAs, etc.) are skipped: `getOrCreateMasterSafe` probes `getOwners()`
  and returns `null` on revert/empty, so no phantom `MasterSafe` /
  `SAFE_DEPLOYED` row is created and the service keeps its real Master
  Safe link from mint. Phase 1b replaces this probe with an explicit
  `StakingContract` allowlist.
- Master EOA owner-list staleness between first sighting and Phase 2a
  `Safe` template spawn (no `AddedOwner` / `RemovedOwner` handling
  yet).

## Coming in subsequent PRs (per `IMPLEMENTATION-PLAN.md` §8)

| Step | Adds | Plan §§ |
|---|---|---|
| 3 — Phase 1a | ✅ landed in this PR — `ServiceRegistryTokenUtility` data source + `Master Safe` / `MasterEOA` derivation via `getOwners()` + `SAFE_DEPLOYED` row + `SERVICE_BOND_DEPOSIT` / `_REFUND` rows with best-effort `bondType` attribution | §4.4, §5.1, §5.2 |
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

| Network | `ServiceRegistryL2` | `ServiceRegistryTokenUtility` |
|---|---|---|
| `gnosis` | `0x9338…755fD` @ 27,871,084 | `0xa45E…7eD8` @ 30,095,874 |
| `matic` (Polygon) | `0xE360…4b50` @ 41,783,952 | `0xa45E…7eD8` @ 52,737,296 |
| `optimism` | `0x3d77…1e44` @ 116,423,039 | `0xBb7e…7eac` @ 116,423,237 |
| `base` | `0x3C1f…95fE` @ 10,827,380 | `0x34C8…3dd5` @ 10,827,475 |

SRTU addresses from
[`valory-xyz/autonolas-registries`](https://github.com/valory-xyz/autonolas-registries/blob/main/docs/configuration.json);
start blocks verified per chain via explorer creation-tx lookup.
StakingFactory and the rest of the Phase 2 data sources (OLAS, USDC,
USDC.e, Safe template) come online in subsequent PRs per the plan.
