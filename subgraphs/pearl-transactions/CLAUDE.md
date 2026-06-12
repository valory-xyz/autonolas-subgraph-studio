# pearl-transactions

Funds-movement subgraph for Pearl **Master Safe / Agent Safe** accounts on
Gnosis, Polygon, Optimism, Base. Powers the Pearl wallet transaction-history
view (VLOP-73): every fund movement in/out of the Master Safe, classified
into wallet-history rows. Design-of-record:
[`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md).

(Directory was renamed from `pearl-funds` per PR #129 review §11 #5 to match
the consumer; the plan doc moved here with it.)

## Status — all phases implemented; deployed to Studio

| Phase | PR | Adds |
|---|---|---|
| 1a | #131 | `ServiceRegistryL2` + `ServiceRegistryTokenUtility`; `Service` / `MasterSafe` / `AgentSafe`; Master EOA via `getOwners()`; `SAFE_DEPLOYED`; SRTU bond deposit/refund rows |
| 1b | #132 | `StakingFactory` + `StakingProxy` template; reward / unstake / eviction rows; `DailyServiceFunds` |
| 2a | #133 | OLAS + WrappedNative `Transfer` + per-Safe `Safe` template; `classifyTransfer`; `TrackedSafe`/`TrackedEOA`/`TokenBalance`/`Token`; `AgentFundingEvent`; `SAFE_SETUP_TRANSFER` + `historyFloorBlock` (Path A) |
| 2b | #138 | Per-chain stablecoin `Transfer` data sources — USDC / USDC.e / pUSD |

**Deployed:** `pearl-gnosis-transactions` + `pearl-polygon-transactions`
**v0.0.5** (Studio account `1716136`); Optimism/Base validated on a
personal Studio account (the 3-subgraph cap is the company-account
blocker). All four networks are queryable as **published** subgraphs via
the Graph gateway (`gateway.thegraph.com/api/subgraphs/id/<ID>`):
gnosis `29C7oxkMpkE5Pt1LPLLa5HkcAZchCFEd1pHGVTDMsZHT`, polygon
`FAhPh2M5JXjGysCHG1RzABKXr9efmh92w9bARk5DJ5iV`, optimism
`JDUWGET5wYQufGsk3VqV9pwDjx7gPDpeGYeWn4pRR9H3`, base
`77FkWBy4o1LpXkFAQb1hTqzBvaYb4VXYxxYeChih4RmY`. Sync as of 2026-06-12:
Gnosis at chain head; Optimism ≈1 day out; Base ≈11 days; Polygon ≈15
days — it indexes ~5 blk/s through the USDC.e-dense range (the §2.2 cost
hotspot; remediation in
[`INDEXING-PERFORMANCE.md`](./INDEXING-PERFORMANCE.md)).

**Remaining (Step 5 / 9):** on-Studio verification against real services
(see [`STEP5-VERIFICATION.md`](./STEP5-VERIFICATION.md)); Optimism/Base
company-account deploy; watch Polygon USDC.e sync.

## Entities (`schema.graphql`)

- **Structural:** `MasterSafe` (`masterEoa`/`owners`/`threshold`,
  `historyFloorBlock`, `setupTransferSeen`), `AgentSafe`, `Service`
  (`agentIds`/`operators` consumer-filter lists, `state`, `nftCustodian`,
  `currentStakingContract`, `totalOlasRewardsClaimed`), `StakingContract`.
- **Ledger:** `FundsMovement` (**`immutable: false`** — see bond queue
  below), `DailyServiceFunds`, `ServiceNftCustodyChange`,
  `AgentFundingEvent`.
- **Phase-2 tracking:** `Token`, `TrackedSafe`, `TrackedEOA`, `TokenBalance`.
- **Internal helpers:** `ServiceIndex`, `PendingRegistration`,
  `PendingBondCounter`, `PendingBondRow`, `AgentBondAttributionGuard`.
- **Enums:** `FundsCategory`, `ServiceBondType`, `FundsSource`.

## Data sources & handlers

- **`ServiceRegistryL2`** (`src/service-registry.ts`) — `RegisterInstance`,
  `ActivateRegistration`, `CreateMultisigWithAgents`, `Transfer` (service
  NFT), `TerminateService`, `OperatorUnbond`. Consumer side of the bond
  queue; dual-guarded Master Safe discovery on the NFT path.
- **`ServiceRegistryTokenUtility`** (`src/service-registry-token-utility.ts`)
  — `TokenDeposit` / `TokenRefund`. Producer side: creates the
  `SERVICE_BOND_DEPOSIT` / `_REFUND` row + stamps `masterSafe` from the bond
  payer (`account`, guarded to tracked Master Safes) + enqueues it. The
  consumer (`dequeueAndAttribute`) backfills `serviceId` + `bondType` +
  `agentSafe` (and `masterSafe` as fallback). This single SEMANTIC row is the
  complete bond record — `classifyTransfer` drops the Master Safe ↔ SRTU OLAS
  `RAW_TRANSFER` duplicate so the wallet (masterSafe-filtered) doesn't
  double-count. `agentSafe` resolves on refunds (multisig already exists); a
  genesis deposit leaves it null but `service.agentIds` still yields the
  display name.
- **`StakingFactory`** (`src/staking-factory.ts`) — `InstanceCreated`:
  allow-list check → spawn `StakingProxy` template + create `StakingContract`.
- **`StakingProxy`** template (`src/staking-proxy.ts`) — `ServiceStaked`
  (canonical Master+Agent Safe discovery), `RewardClaimed`,
  `ServiceUnstaked`, `ServiceForceUnstaked`, `ServicesEvicted`.
- **`OLAS` / `WrappedNative` / per-chain stablecoins** (`src/erc20.ts`
  `handleErc20Transfer`) — one generic ERC-20 `Transfer` handler shared by
  all token data sources; the row's `token` is `event.address`. After
  `classifyTransfer`, an OLAS `AGENT_TO_MASTER` hop is re-tagged
  `AGENT_OLAS_TO_MASTER` (the reward-sweep bucket) so the wallet can exclude
  it at query time instead of fetch-then-filter; native / non-OLAS
  agent→master stays `AGENT_TO_MASTER`. The token isn't visible inside
  `classifyTransfer` (it only sees from/to), so the split happens in the
  handler. We do **not** distinguish a reward sweep from a manual OLAS
  return — both bucket here. Stablecoin
  data sources are rendered from a per-network `erc20Tokens` array in
  `networks.json` via the `{{ erc20TokenDataSources }}` marker in
  `generate-manifests.js`.
- **`Safe`** template (`src/safe.ts`) — `SafeReceived` (native inbound,
  precise); `ExecutionSuccess` / `ExecutionFromModuleSuccess` (native-out:
  intentional no-op, see limits); `AddedOwner` / `RemovedOwner` /
  `ChangedThreshold` (Master Safe owner-list maintenance).

## Key mechanisms (`src/utils.ts` unless noted)

- **`getOrCreateMasterSafe`** — first-sighting `GnosisSafe.getOwners()` +
  `getThreshold()` eth_call; returns `null` if `getOwners()` reverts (not a
  Safe), so staking proxies / EOAs don't become phantom Master Safes. NFT
  handler also short-circuits known proxies via `isStakingContract` (dual
  guard). Emits the `SAFE_DEPLOYED` anchor once per Master Safe.
- **Bond-type attribution queue** (`enqueuePendingBondRow` /
  `dequeueAndAttribute`, dedupe via `attributeAgentBondOncePerService`) —
  on-chain the SRTU event fires **before** its `ServiceRegistryL2`
  counterpart in every path (`ServiceManager` calls `*TokenDeposit`/
  `*TokenRefund` before the registry fn), so the **SRTU handler is the
  producer** (creates the `FundsMovement` row + enqueues its id) and the
  **`ServiceRegistryL2` handler is the consumer** (dequeues + backfills
  `serviceId` + `bondType`). Hence `FundsMovement` is mutable. `bondType`
  stays null when no SR event follows.
- **`classifyTransfer`** — routes `(from, to)` against `TrackedSafe` /
  `TrackedEOA` / `StakingContract` / SRTU / ServiceRegistryL2, most-specific
  first, into the `FundsCategory` (`MASTER_FUNDING_IN`, `MASTER_TO_AGENT`,
  `AGENT_TO_MASTER`, `MASTER_WITHDRAWAL`, `STAKING_REWARD_CLAIM`,
  `SAFE_SETUP_TRANSFER`, …). Returns null for untracked counterparties (row
  dropped) **and** for Master Safe ↔ SRTU OLAS hops (deduped against the
  SEMANTIC bond row). Inbound to a Master Safe **from the ServiceRegistryL2
  contract** is classified `OTHER` (protocol dust — e.g. 1-wei native refunds
  during terminate/unbond — not a user deposit; `getServiceRegistryAddress`
  in constants.ts).
- **`getOrCreateToken`** — OLAS / wrapped-native 18 decimals; stablecoins
  (USDC / USDC.e / pUSD) 6 decimals via `getStablecoinSymbol` (constants.ts);
  `log.critical` + UNKNOWN/6 if an indexed token has no resolver branch.
- **`AgentFundingEvent`** — groups same-tx `MASTER_TO_AGENT` rows so one
  funding action is one consumer row.
- **`SAFE_SETUP_TRANSFER` / Path A** — the first live Master-EOA → Master-Safe
  inbound hop after first sighting is tagged `SAFE_SETUP_TRANSFER`; opening
  balances are NOT emitted by the subgraph — the frontend reads them via
  archive RPC at `MasterSafe.historyFloorBlock` (AC #3 / Path A).

## Honest limits

- `bondType` attribution is best-effort; unmodeled call orderings leave it
  null but preserve the amount.
- SRTU bond rows are **token-secured-only**. Every `TokenDeposit` /
  `TokenRefund` emit in `ServiceRegistryTokenUtility` sits inside an
  `if (token != address(0))` guard, so ETH/native-secured services emit no
  SRTU events and produce no `SERVICE_BOND_DEPOSIT` / `_REFUND` rows.
- `unbondTokenRefund` additionally guards on `refund > 0`, so a fully-slashed
  operator emits `OperatorUnbond` without a matching `TokenRefund`. Harmless
  in an isolated unbond tx; the only hazard is a batched multi-operator
  unbond with one fully slashed (not in Pearl's one-operator-per-service
  flow).
- Non-Safe NFT recipients (staking proxy, EOAs) are skipped via the
  `getOwners()` probe + `isStakingContract`, so the real Master Safe link
  from mint is preserved.
- **Native outflows from a Safe are not indexed.** Native sent *out*
  surfaces only as `ExecutionSuccess` (no amount/recipient), so
  `handleSafeExecution*` are intentional no-ops. Consequence: **native
  withdrawals to external wallets** and the **native agent gas-funding leg
  (Master Safe → Agent EOA)** do not appear. Native *inflows* (`SafeReceived`)
  and all *token* flows in/out are captured. Closing this needs call/trace
  handlers (the rejected self-hosted indexer); accepted v1 gap.
- **Token coverage is a fixed allowlist, not "any token."** A subgraph
  `Transfer` data source targets specific contracts, so we index the set the
  wallet displays (OLAS, wrapped-native, USDC / USDC.e / pUSD per chain,
  from the Operate app `frontend/config/tokens.ts`). An arbitrary ERC-20
  won't appear. **Adding a wallet token requires updating `networks.json`
  `erc20Tokens` + `getStablecoinSymbol` in lockstep** (the `log.critical`
  above is the drift canary).
- Master EOA owner-list staleness in the window before the `Safe` template
  spawns (no `AddedOwner`/`RemovedOwner` handling pre-spawn).

## Token set (per chain — from the Operate app `config/tokens.ts`)

| Chain | OLAS | Wrapped native | Stablecoins (6 dec) |
|---|---|---|---|
| gnosis | `0xcE11…9d9f` | WXDAI `0xe91D…a97d` | USDC `0xDDAfbb50…`, USDC.e `0x2a22f9c3…` |
| matic | `0xFEF5…2F95` | WPOL `0x0d50…1270` | USDC `0x3c499c54…`, USDC.e `0x2791bca1…`, pUSD `0xC011a7E1…` |
| optimism | `0xFC2E…E527` | WETH `0x4200…0006` | USDC `0x0b2C639c…`, USDC.e `0x7F5c764c…` |
| base | `0x5433…3416` | WETH `0x4200…0006` | USDC `0x833589fC…` |

## Tests

46 Matchstick tests across `tests/service-registry.test.ts` (Phase 1a),
`tests/staking.test.ts` (Phase 1b), `tests/phase-2a.test.ts` (Phase 2a + the
Phase-2b stablecoin suite — all 8 (chain, token) tuples). `yarn test`.

## Development workflow

```bash
cd subgraphs/pearl-transactions
yarn install
yarn generate-manifests   # render per-network manifests from the template
yarn codegen
yarn build                # uses subgraph.gnosis.yaml
yarn test
```

## Deployment

Manual via the `Deploy Subgraph` GitHub Action (workflow_dispatch from
`main`) or `yarn deploy-{gnosis,matic,optimism,base}`. Studio slugs:
`pearl-{gnosis,polygon,optimism,base}-transactions`. The GH-Actions workflow
builds the **committed** per-network manifest (`subgraph.<network>.yaml`)
as-is — it does not re-run `generate-manifests`, so if you change
`networks.json` or the template, regenerate + commit before triggering it.
(The local `yarn deploy-<network>` scripts run `generate-manifests` first as
a safety net.)

Per-network data-source addresses live in `networks.json` (ServiceRegistryL2,
ServiceRegistryTokenUtility, StakingFactory, OLAS, WrappedNative, and the
`erc20Tokens` stablecoin array). All Phase-2b stablecoin data sources start at
the chain's `ServiceRegistryL2` block — a provably-safe lower bound (no Pearl
Safe predates it).
