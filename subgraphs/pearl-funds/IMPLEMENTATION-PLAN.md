# Pearl Funds-Movement Subgraph — Implementation Plan

**Status:** Implemented through Phase 2a (PRs #131/#132/#133 merged to `main`); Phase 2b (#138) in review. This plan is the design-of-record.
**Subgraph:** `subgraphs/pearl-transactions/` (renamed from `pearl-funds` per §11 #5)
**Target networks (v1):** Gnosis, Polygon, Optimism, Base
**Last updated:** 2026-06-01 (Rev. 7 — Phase 2b token-set reconciliation: pUSD is a separate Polymarket contract `0xC011a7E1…`, not a USDC.e UI alias; §4.5 token table + §4.3 networks table rebuilt to the shipped per-chain set (USDC / USDC.e / pUSD); §6.3 records the ship-on-chain decision + Polygon USDC.e rollback condition; Polystrat funds in USDC + pUSD. Rev. 6 — back-propagated the PR #131/#132 producer/consumer fixes so the plan matches shipped code: §3.3 SRTU is indexed, §4.6 SRTU-before-SR event order, §5.1/§5.2 inverted bond-attribution entities + handlers, §5.1 FundsMovement/Token mutability, §5.2 dual NFT guard + handleServiceStaked null-check, §5.4/§7/§8 staleness, pearl-transactions path. Rev. 5 — product decisions finalised: OPENING_BALANCE rows removed, opening balances delegated to the frontend via historyFloorBlock; native → Agent EOA confirmed accepted gap; AC #3 = Path A. Rev. 4 addressed PR #130 review + §11 #6. Rev. 3 added §4.5/§4.6. Rev. 2 added SRTU bond indexing, agent-ID anti-hardcoding, Master EOA tracking. Rev. 1 addressed PR #129 feedback.)

This document scopes a new subgraph that indexes **funds movement for the
Master Safe and Agent Safe of Pearl predict services**. It covers Phase 1
(semantic ledger), Phase 2 (raw token ledger), the full asset/file
inventory, the reuse map, and the implementation sequence.

It is the dedicated funding subgraph explicitly deferred by the prior Pearl
scoping work — see [`subgraphs/pearl/SUBGRAPH_PLAN.md`](../pearl/SUBGRAPH_PLAN.md)
§6.1: *"If this later needs to ship on-chain … a dedicated funding subgraph
is the right place — not mixed into trades."* That branch
(`docs/pearl-subgraph-plan`) generalized **trade** tracking in
`predict-polymarket`; this plan is the orthogonal, complementary
**funding** work it called out.

---

## 1. Background & Motivation

### 1.1 The actors in a Pearl service

| Actor | What it is | On-chain derivation |
|---|---|---|
| **Master EOA** | The key Pearl holds for the user. Primary signer on the Master Safe. | `GnosisSafe.getOwners()[0]` on each Master Safe — one-shot eth_call at first sighting; kept current via `Safe.AddedOwner` / `RemovedOwner` template events (Phase 2a). |
| **Master Safe** | A Gnosis Safe owned by the Master EOA. **1-of-2** (threshold = 1, two owners — the Master EOA plus a non-signing backup); see `olas-operate-middleware/operate/utils/gnosis.py:177-182`. One per chain. Funds and owns services; **holds the service NFT**. | `StakingProxy.ServiceStaked.owner` + ERC-721 `Transfer` owner of the service NFT (cross-checked). |
| **Service** | An Olas service, an ERC-721 minted by `ServiceRegistryL2`. `tokenId == serviceId`. Owned by the Master Safe. | All services on `ServiceRegistryL2` — see §2.3. |
| **Agent Safe** | The service multisig (`ServiceRegistryL2.CreateMultisigWithAgents.multisig`). The Safe the agent operates from — places bets, receives rewards. | `CreateMultisigWithAgents.multisig`. |
| **Agent EOA(s)** | Agent instances registered via `RegisterInstance`; signers of the Agent Safe. | `RegisterInstance.{agentInstance, operator}`, deduplicated per service. |
| **Staking proxy** | A `StakingToken`/`StakingProxy` instance created by `StakingFactory`. Custodies the service NFT while staked; pays OLAS rewards. | `StakingFactory.InstanceCreated` → `StakingProxy` template. |

The funding hierarchy: **Master EOA → Master Safe → Agent Safe → app
contracts (staking, prediction markets) → back.** All four wallet types
are derived from on-chain data; no off-chain mapping or import.

### 1.2 The fund flows to capture

1. **Stake.** The service NFT moves Master Safe → staking proxy.
   `StakingProxy.ServiceStaked` carries both `owner` (Master Safe) and
   `multisig` (Agent Safe).
2. **Claim.** `StakingProxy.RewardClaimed` — OLAS is transferred to the
   Agent Safe. The amount is in the event.
3. **Unstake.** `ServiceUnstaked` / `ServiceForceUnstaked` — remaining
   rewards go to the Agent Safe; the service NFT moves staking proxy →
   Master Safe.
4. **Reward sweep.** Claimed OLAS is sometimes moved Agent Safe → Master
   Safe afterward. This is a discretionary transfer, not covered by any
   staking event.
5. **App funding.** Native coin / USDC / USDC.e / pUSD moves Master Safe →
   app-specific contracts and is received back by the Master/Agent Safe as
   prediction proceeds (omenstrat on Gnosis, polystrat on Polygon).

### 1.3 The gap this fills

| Existing subgraph | Covers | Does **not** cover |
|---|---|---|
| `predict/predict-omen`, `predict/predict-polymarket` | Per-Agent-Safe bet / fee / payout P&L *inside* prediction markets | Master Safe; raw funding; staking |
| `staking` | Service staking aggregates, reward totals per service per epoch | Master/Agent Safe as funding entities; literal token transfers |
| `service-registry` | Service lifecycle, multisig, ERC-8004 identity | Master Safe (its `creator` field is `tx.from`, an EOA/relayer — not the Safe); funds; staking |

**Nothing models the Master Safe, or the flows between Master Safe ↔ Agent
Safe ↔ staking ↔ app contracts as a single ledger.** That is precisely the
scope here. In-market bet P&L stays owned by the predict subgraphs;
consumers join on the Agent Safe address.

---

## 2. Hard Constraints

### 2.1 On-chain data only — no server-side joins (inherited)

Inherited verbatim from [`pearl/SUBGRAPH_PLAN.md`](../pearl/SUBGRAPH_PLAN.md)
§1.1. The subgraph indexes **only on-chain data**, and on-chain data may
only be joined with **other on-chain data**. Funds movement is public
ERC-20 / native / NFT transfer data — public-with-public, fully in bounds.

What must **never** appear: any field or identifier that correlates an
on-chain transfer to the prediction server's private request log
(`mode`, `tool`, `tier`, request id, cost, session id, time-window join
keys). §12 ("Deliberately Absent") enforces this at schema-review time.

### 2.2 Indexing-cost discipline

A naive "index every USDC.e `Transfer` on Polygon" subgraph is
prohibitively expensive — Polygon USDC.e is one of the highest-volume
ERC-20s in the ecosystem, and graph-node must decode and dispatch **every**
`Transfer` of a token data source even when the handler early-returns.
This is the same objection the prior plan raised (§6.1) when it deferred
funding indexing. The phasing in §3.2 and the benchmark gate in §6.3 exist
specifically to manage this.

### 2.3 Cohort keying — query-time, not index-time

All per-service analytics key on the Olas `serviceId` and, transitively,
the Master Safe / Agent Safe addresses. Pearl-specific cohorts (predict
on Gnosis = agent ID 25, polystrat on Polygon = agent ID 86, Pearl-Mini
operator filter, etc.) are recorded **on each `Service` as data fields**
(`agentIds: [Int!]!`, `operators: [Bytes!]!`) and filtered **by
consumers at query time** — not hard-coded in the WASM as an indexing
gate.

Rationale (corrected from earlier revision per @Tanya-atatakai PR #129
review):

- A WASM-level agent-ID gate would force a **full reindex every time a
  new Pearl agent type launches** — the constant list lives in the
  compiled mapping, so any change requires redeploy + resync. This is
  exactly the kind of brittleness the trade subgraph plan avoided.
- The indexing-cost concern in §2.2 is bounded by the size of
  `TrackedSafe` in Phase 2, **not** by the total number of indexed
  services. `ServiceRegistryL2` event volume is low (same shape as the
  `service-registry` subgraph), so indexing every service is cheap.
- Recording `agentIds` + `operators` on each `Service` preserves every
  cohort filter the prior plan called out (predict ID, polystrat ID,
  PolySafeCreator `0xA749f605D93B3efcc207C54270d83C6E8fa70fF8` for
  Pearl-Mini vs. polystrat split) — applied client-side, no reindex on
  new IDs.

Known Pearl predict agent IDs for documentation (the WASM does **not**
filter on these — they're consumer query parameters):

| Network | Pearl predict agent ID | Source |
|---|---|---|
| Gnosis (omenstrat) | **25** | Confirmed by maintainer; matches `valory-xyz/autonolas-subgraph` PR #89 (`PREDICT_AGENT_ID = 25`) |
| Polygon (polystrat) | **86** | `predict-polymarket/src/constants.ts` |

Phase 2's `TrackedSafe` set still needs a gate to keep the cost low. The
gate moves from "is this a Pearl predict service" to "does this service
appear in the Pearl predict cohort or any other tracked cohort" — for
v1 the only cohort we spawn `Safe` templates for is the Pearl predict
agent IDs, but the gate is a per-deployment constant set the operator can
update without re-architecting the schema.

---

## 3. Scope & Phasing

### 3.1 In scope (v1)

All Olas services (with Pearl predict cohort filterable client-side per
§2.3) on **Gnosis, Polygon, Optimism, Base** — their Master Safes,
Agent Safes, service NFTs, staking activity, and (Phase 2) token funding
flows. Mode is intentionally omitted (deprecated network).

Pearl predict services are the **primary consumer cohort** for v1
(`agent ID 25` on Gnosis, `agent ID 86` on Polygon); the schema and
data sources are deliberately agent-agnostic so other Pearl agent types
(Optimus / babydegen / agents.fun) become drop-in additions of `TrackedSafe`
seeding rather than full reindexes.

### 3.2 Phasing

| Phase | Delivers | Cost | Gate |
|---|---|---|---|
| **Phase 1 — Semantic ledger** | Master/Master-EOA/Agent/Service graph (Master EOA derived via one-shot `getOwners()`); service-NFT custody; real bond deposit/refund rows from `ServiceRegistryTokenUtility` events (twice per stake/unstake cycle, best-effort `bondType`); staking stake/claim/unstake/eviction with exact OLAS reward amounts (straight from events); synthetic `SAFE_DEPLOYED` anchor row | Low — no high-volume data sources | Ship first |
| **Phase 2a — OLAS + native ledger** | OLAS `Transfer` data source (low volume); native coin + owner-list maintenance via `Safe` dynamic templates. Adds `SAFE_SETUP_TRANSFER`, agent-funding aggregation, Agent→Master OLAS sweeps and native funding | Low–moderate | After Phase 1 verified |
| **Phase 2b — Stablecoin ledger** | USDC / USDC.e / pUSD `Transfer` ledger (per chain), filtered to tracked safes | **High (Polygon USDC.e)** | Shipped on-chain (#138); benchmark deferred + rollback condition — see §6.3 |

The user-facing framing is "Phase 1 and Phase 2"; Phase 2 is split here
only because **2a is cheap and unconditional** while **2b carries a real
indexing-cost risk** (and a product-side dependency on Polygon stablecoin
visibility) and must clear both gates before commitment.

### 3.3 Out of scope / deferred

- **Other Pearl agent types' Phase 2 cohorts** (Optimus / babydegen,
  agents.fun, etc.) — services for *every* agent type are still indexed
  in Phase 1, but `TrackedSafe` seeding in Phase 2 is initially scoped to
  the Pearl predict cohort to bound cost. Adding cohorts later is a
  per-deployment constant change, not a re-architecture.
- **Mode network** — deprecated.
- **USD valuation** — raw token amounts only (per scoping decision).
  Consumers value downstream.
- **In-market bet P&L** — owned by the predict subgraphs.

### 3.4 Cross-deployment note

Template pattern → one template, **two Studio deployments** (Gnosis,
Polygon). `serviceId` is unique per deployment; consumers query both.
This matches `staking` and `service-registry`.

---

## 4. Architecture

### 4.1 New subgraph, template pattern

`subgraphs/pearl-funds/` — `subgraph.template.yaml` + `networks.json` +
the shared `scripts/generate-manifests.js`, exactly like `staking`. All
four target networks share identical data-source *shapes*; only addresses
and start blocks differ. Per-network constants resolve via a
`dataSource.network()` switch, the way `staking/src/utils.ts` does
`isAllowedImplementation`. Per §2.3, no per-network agent-ID constants
are baked into the WASM.

### 4.2 Why a new subgraph, not an extension

- **Not `service-registry`** — it is a lean operational-metrics subgraph
  (tx counts, agent activity). Adding token data sources + `Safe`
  templates would multiply its indexing cost and conflate two concerns.
- **Not `staking`** — the staking events are the best master/agent source,
  but `staking` is a clean, focused, business-critical subgraph; funding
  is a different concern with a different cost profile.
- **Not `predict-polymarket`** — the prior plan (§6.1) explicitly ruled
  funding out of the trade subgraph.

A new subgraph is also the prior plan's own recommendation (§6.1).

### 4.3 Data sources (per network, via template)

Address/start-block source: `subgraphs/service-registry/networks.json`
(ServiceRegistryL2), `subgraphs/staking/networks.json` (StakingFactory),
`shared/constants.ts` (OLAS), with USDC values from canonical token
deployments. All four networks have all four core data sources (Phase 1
+ Phase 2a). USDC / USDC.e / pUSD (Phase 2b) is shipped on-chain (#138)
per §6.3.

| Data source | Events | Phase |
|---|---|---|
| `ServiceRegistryL2` | `RegisterInstance`, `CreateMultisigWithAgents`, `ActivateRegistration`, ERC-721 `Transfer`, `TerminateService` | 1 |
| `ServiceRegistryTokenUtility` | `TokenDeposit(account indexed, token indexed, amount)`, `TokenRefund(account indexed, token indexed, amount)` — see §5.2 for the disambiguation pattern | 1 |
| `StakingFactory` | `InstanceCreated` | 1 |
| `StakingProxy` (dynamic template) | `ServiceStaked`, `ServiceUnstaked`, `ServiceForceUnstaked`, `RewardClaimed`, `ServicesEvicted` | 1 |
| `OLAS` (ERC-20) | `Transfer` | 2a |
| `WrappedNative` (ERC-20, per-chain: WXDAI on Gnosis, WPOL on Polygon, WETH on Optimism + Base) | `Transfer` | 2a *(Rev. 4)* |
| `Safe` (dynamic template, per Master/Agent Safe) | `SafeReceived`, `ExecutionSuccess`, `ExecutionFromModuleSuccess`, `AddedOwner`, `RemovedOwner`, `ChangedThreshold` | 2a |
| `USDC` / `USDCe` / `PUSD` (ERC-20, per chain — see §4.5; pUSD is Polygon-only) | `Transfer` | 2b |

Per-network addresses (the Phase-2b stablecoins are rendered from a
per-network `erc20Tokens` array in `networks.json` — see §4.5 for the
full set; column below lists them):

| Network (graph-node id) | `ServiceRegistryL2` | `ServiceRegistryTokenUtility` | `StakingFactory` | OLAS | WrappedNative *(2a)* | Stablecoins (Phase 2b) |
|---|---|---|---|---|---|---|
| `gnosis` | `0x9338b5153AE39BB89f50468E608eD9d764B755fD` @ 27,871,084 | `0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8` @ 30,095,874 | `0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700` @ 35,206,806 | `0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f` | WXDAI `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` | USDC `0xDDAfbb50…`; USDC.e `0x2a22f9c3…` |
| `matic` (Polygon) | `0xE3607b00E75f6405248323A9417ff6b39B244b50` @ 41,783,952 | `0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8` @ 52,737,296 | `0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461` @ 62,213,142 | `0xFEF5d947472e72Efbb2E388c730B7428406F2F95` | WPOL/WMATIC `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | USDC `0x3c499c54…`; USDC.e `0x2791bca1…`; pUSD `0xC011a7E1…` |
| `optimism` | `0x3d77596beb0f130a4415df3D2D8232B3d3D31e44` @ 116,423,039 | `0xBb7e1D6Cb6F243D6bdE81CE92a9f2aFF7Fbe7eac` @ 116,423,237 | `0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8` @ 124,618,633 | `0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527` | WETH `0x4200000000000000000000000000000000000006` | USDC `0x0b2C639c…`; USDC.e `0x7F5c764c…` |
| `base` | `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` @ 10,827,380 | `0x34C895f302D0b5cf52ec0Edd3945321EB0f83dd5` @ 10,827,475 | `0x1cEe30D08943EB58EFF84DD1AB44a6ee6FEff63a` @ 17,310,019 | `0x54330d28ca3357F294334BDC454a032e7f353416` | WETH `0x4200000000000000000000000000000000000006` | USDC `0x833589fC…` |

`ServiceRegistryTokenUtility` addresses come from
`valory-xyz/autonolas-registries`
[`docs/configuration.json`](https://github.com/valory-xyz/autonolas-registries/blob/main/docs/configuration.json);
start blocks are not in `configuration.json` and must be sourced from
each chain's explorer (first tx on the contract) — see §11 #7. The
Gnosis and Polygon addresses share a string but should still be
re-verified independently against the explorer (deterministic-deploy
collisions or doc errors are both possible).

Native gas coin (xDAI / POL / ETH) is tracked via the `Safe` template
(`SafeReceived` in, `ExecutionSuccess` out — see §6.2 for the approximation
limit). **Wrapped-native tokens (WXDAI / WPOL / WETH) are tracked as
their own ERC-20 data sources** per the `WrappedNative` slot above —
this was upgraded from metadata-only in Rev. 4 after @Tanya-atatakai
pointed out that `SafeReceived` only fires for native value transfers,
not for transfers of the wrapped tokens themselves; on Gnosis where
Omen FPMM bets settle in WXDAI those movements would otherwise drop
out entirely. Wrapped-native volume is much lower than USDC.e on
Polygon, so the §6.3 benchmark gate is not needed for them.

`ServiceRegistryL2` start blocks match `service-registry` (provably safe
— predates any Pearl service on each chain). The earlier Polygon start
block `80,360,433` from `predict-polymarket` is dropped in favor of the
service-registry block, resolving Open Q #1. `StakingFactory` starts at
its natural deploy block — `InstanceCreated` is rare and cheap; staking
*proxy* events are processed only for known Pearl services anyway.

### 4.4 Service / Master Safe / Master EOA / Agent Safe discovery

All four wallet types are derived from on-chain data only.

- **Service** — every service is indexed via `ServiceRegistryL2`
  (`RegisterInstance` + `CreateMultisigWithAgents`); per-service
  `agentIds` + `operators` are recorded so consumers filter cohorts at
  query time (§2.3).
- **Agent Safe** — `CreateMultisigWithAgents.multisig`.
- **Agent EOA(s)** — `RegisterInstance.{agentInstance, operator}`,
  deduplicated.
- **Master Safe** — two on-chain sources, cross-checked:
  1. `StakingProxy.ServiceStaked.owner` — the authoritative service owner
     recorded by the staking contract (for staked services).
  2. The ERC-721 `Transfer` owner of the service NFT — ground truth for
     un-staked services and after unstake.
  The service NFT `Transfer` also yields the stake/unstake custody trail
  for free (Master Safe → staking proxy → Master Safe).
- **Master EOA** — added per PR #129 review. At **first sighting** of
  each Master Safe (either via `ServiceStaked.owner` or via service-NFT
  `Transfer` to a non-staking address), the handler does a one-shot
  `GnosisSafe.getOwners()` + `GnosisSafe.getThreshold()` eth_call against
  the Master Safe and writes `owners`, `masterEoa = owners[0]`, and
  `threshold` to the `MasterSafe` entity. Pearl's onboarding flow
  guarantees the Master EOA is `owners[0]` (1-of-2 with a non-signing
  backup; see §1.1 actors table). Going forward, the `Safe` dynamic
  template (Phase 2a) listens to `AddedOwner` / `RemovedOwner` /
  `ChangedThreshold` to keep the lists current — so Phase 1 has the
  Master EOA at first sighting, and Phase 2a tracks any later changes.

  This matches the pattern in `babydegen/src/safe.ts` and avoids
  indexing every Safe ever deployed on each chain (which is what
  watching `SafeProxyFactory.ProxyCreation` would require).

**Event-ordering gotcha.** On `ServiceRegistryL2`, the initial deployment
order is typically `RegisterInstance*` → `CreateMultisigWithAgents` — so
the multisig address is unknown when `RegisterInstance` fires. This is the
same ordering issue the prior plan hit
([`pearl-trades-schema.md`](../pearl/pearl-trades-schema.md) §3.4). Reuse
its pattern: a tiny internal `ServiceIndex` (`serviceId → multisig`) plus a
`PendingRegistration` buffer for `RegisterInstance` data that arrives
first, drained when `CreateMultisigWithAgents` creates the `Service`.

### 4.5 Asset inventory (per network)

Added in Rev. 3 to formalize **every asset a Pearl predict service
touches** per chain. Distinct from §4.3 (which is the *indexing* view —
data sources, ABIs, start blocks). This section is the *wallet UI* view:
what does the Pearl wallet need balances and history for, where, and
which phase indexes it.

| Asset | Type | Gnosis (`gnosis`) | Polygon (`matic`) | Optimism | Base | Tracked via | Phase |
|---|---|---|---|---|---|---|---|
| **Native gas coin** | native | xDAI | POL *(ex-MATIC, [renamed 2024-09](https://polygon.technology/blog/save-the-date-pol-saga-token-migration-coming-september-4th))* | ETH | ETH | per-Safe `Safe` template (`SafeReceived` in; `ExecutionSuccess`/`ExecutionFromModuleSuccess` out, approximate) | 2a |
| **OLAS** | ERC-20 | `0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f` | `0xFEF5d947472e72Efbb2E388c730B7428406F2F95` | `0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527` | `0x54330d28ca3357F294334BDC454a032e7f353416` | dedicated `Transfer` data source with `TrackedAddress` in-handler filter; reconciled vs. Phase 1 semantic rows | 2a |
| **Wrapped native** | ERC-20 | WXDAI `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` | WPOL/WMATIC `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | WETH `0x4200000000000000000000000000000000000006` | WETH `0x4200000000000000000000000000000000000006` | dedicated `Transfer` data source w/ `TrackedAddress` filter (the `WrappedNative` slot in §4.3) | 2a *(Rev. 4)* |
| **USDC (canonical)** | ERC-20 (6 dec) | `0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | dedicated `Transfer` data source w/ `TrackedAddress` filter | 2b |
| **USDC.e (bridged)** | ERC-20 (6 dec) | `0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0` | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174` | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | — | dedicated `Transfer` data source w/ `TrackedAddress` filter | 2b (**Polygon USDC.e = §2.2 cost hotspot**) |
| **pUSD** (Polymarket USD) | ERC-20 (6 dec) | — | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` | — | — | dedicated `Transfer` data source w/ `TrackedAddress` filter | 2b |

Notes:

- **pUSD is a separate token from USDC.e.** Earlier revisions assumed
  Pearl's "pUSD" was just a UI label for bridged USDC.e (`0x2791…4174`)
  with no separate contract. That is **no longer true**: the Operate app's
  [`frontend/config/tokens.ts`](https://github.com/valory-xyz/olas-operate-app/blob/main/frontend/config/tokens.ts)
  lists **pUSD as a distinct contract `0xC011a7E1…`** (Polymarket's USD
  stablecoin on Polygon), alongside USDC.e `0x2791…`. The shipped subgraph
  (#138) follows the app and indexes all three Polygon stablecoins (USDC,
  USDC.e, pUSD) as separate tokens — this table now matches that.
- **Polystrat funds in USDC + pUSD** (per the current app config), not
  USDC.e as earlier revisions stated.
- The full token set is sourced from the Operate app `config/tokens.ts`
  and resolved per chain in `getStablecoinSymbol` (all 6 decimals).
- **Native coin tracking is half-precise.** Inbound native is reliable
  (`SafeReceived` event). Outbound native via Safe execution is
  approximate — a Safe executing via a relayer carries `value = 0` on the
  outer tx, so we cannot read the moved amount from `ExecutionSuccess`.
  Precise native-out requires call/trace handlers (§6.2). Babydegen has
  the same trade-off. The wallet UI either shows native running balance
  with an asterisk or computes balance via `Token` snapshots — both
  acceptable for v1.
- **WXDAI / WPOL / WETH transfers are tracked as their own ERC-20
  data sources** (Rev. 4, in response to @Tanya-atatakai's PR #130
  comment). The Rev. 3 assumption — "native via `Safe` template
  suffices, wrapped is metadata-only" — was wrong: `SafeReceived`
  fires for native value transfers only, never for transfers of the
  wrapped token itself. Omen FPMM bets settle in WXDAI on Gnosis, so
  any Agent-Safe ↔ FPMM hop in WXDAI would otherwise be invisible to
  this subgraph. Wrapped-native volume is much lower than USDC.e on
  Polygon, so the §6.3 benchmark gate isn't needed for them.
  In-market bet *outcome accounting* still belongs to `predict-omen` /
  `predict-polymarket` (consumers join on Agent Safe); this subgraph
  captures the *raw token movement* to/from the Safe.
- **Other Pearl agent types (out of v1 scope) have different asset sets.**
  Optimus/babydegen on Optimism trades sDAI / MORPHO / DAI / USDC / WETH
  and is covered by `babydegen-optimism`. agents.fun and Modius have
  their own asset sets, not enumerated here. Adding them to pearl-funds
  in a later revision is a per-asset addition of a `Transfer` data source
  + `TrackedAddress` seeding, not a re-architecture.
- **The service NFT (ERC-721)** is not an "asset" in the wallet-balance
  sense, but its custody trail is the master/staking provenance signal
  (§5.2 `handleServiceNftTransfer`). Not double-counted as a `Token`.

### 4.6 Funds-flow diagrams

Three diagrams scoped to v1 (Pearl predict). All entities shown here are
either indexed by `pearl-funds` (the boxed ones) or referenced by it
(the dashed ones).

#### A. Wallet hierarchy + ownership

The four wallet types and the service NFT. Solid arrows are signing /
ownership relationships; dashed arrows are derived references.

```mermaid
flowchart TD
    MEOA["Master EOA<br/>(Pearl-held key)<br/>discovered via getOwners()"]
    BACKUP["Non-signing backup EOA<br/>(2nd Safe owner)"]
    MSAFE["Master Safe<br/>1-of-2 Gnosis Safe<br/>(one per chain)"]
    NFT["Service NFT<br/>ERC-721, tokenId = serviceId"]
    SVC["Service<br/>(indexed)"]
    ASAFE["Agent Safe<br/>(service multisig)"]
    AEOA1["Agent EOA #1"]
    AEOA2["Agent EOA #N"]

    MEOA -->|"owner #1 (signer)"| MSAFE
    BACKUP -->|"owner #2 (no-sign)"| MSAFE
    MSAFE -->|"holds when un-staked"| NFT
    NFT -.->|"tokenId = serviceId"| SVC
    SVC -.->|"multisig field"| ASAFE
    AEOA1 -->|"signer"| ASAFE
    AEOA2 -->|"signer"| ASAFE

    classDef tracked fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    classDef external fill:#f3f4f6,stroke:#9ca3af,stroke-width:1px,stroke-dasharray:3
    class MEOA,MSAFE,ASAFE,SVC,NFT,AEOA1,AEOA2 tracked
    class BACKUP external
```

#### B. Stake-cycle and unstake-cycle (single multicalls)

What happens when Pearl stakes / unstakes a service. Each yellow / green
block is a single user-facing tx (the Olas middleware sends a multicall
that calls several functions in order). Events emitted are noted; those
in **bold** become a `FundsMovement` row in this subgraph.

```mermaid
sequenceDiagram
    autonumber
    participant MEOA as Master EOA
    participant MSAFE as Master Safe
    participant SR as ServiceRegistryL2
    participant SRTU as SRTU<br/>(TokenUtility)
    participant SF as StakingFactory
    participant SP as StakingProxy
    participant ASAFE as Agent Safe

    Note over MEOA,MSAFE: Onboarding (Safe deployed off-chain by Pearl middleware)
    MEOA->>MSAFE: native + OLAS funding (SAFE_SETUP_TRANSFER)

    rect rgba(255,235,205,0.4)
    Note over MSAFE,SP: Stake-cycle multicall (single tx)
    MSAFE->>SR: create(...) → mints NFT to MSAFE
    SR-->>MSAFE: ERC-721 Transfer (NFT)
    Note over MSAFE,SR: ServiceManager wraps each call SRTU-first, registry-second — so the SRTU event ALWAYS fires before its SR counterpart
    MSAFE->>SRTU: activateRegistrationTokenDeposit(serviceId)
    Note right of SRTU: **TokenDeposit(MSAFE, OLAS, securityDeposit)** [FIRST]<br/>→ SERVICE_BOND_DEPOSIT row created here (amount only) + enqueued
    MSAFE->>SR: activateRegistration(serviceId)
    Note right of SR: emit ActivateRegistration [SECOND]<br/>→ dequeues the row + tags bondType=SECURITY_DEPOSIT
    MSAFE->>SRTU: registerAgentsTokenDeposit(operator, serviceId)
    Note right of SRTU: **TokenDeposit(MSAFE, OLAS, totalBond)** [FIRST]<br/>→ SERVICE_BOND_DEPOSIT row created + enqueued
    MSAFE->>SR: registerAgents(serviceId, [...agentInstances])
    Note right of SR: emit RegisterInstance (per agent) [SECOND]<br/>→ dequeues the row + tags bondType=AGENT_BOND (once-per-service guard)
    MSAFE->>SR: deploy(serviceId, multisigFactory)
    SR-->>ASAFE: emit CreateMultisigWithAgents (multisig=ASAFE)
    MSAFE->>SP: stake(serviceId)
    SR-->>SP: NFT transferred to StakingProxy
    SP-->>SP: **emit ServiceStaked(owner=MSAFE, multisig=ASAFE)**<br/>→ records masterSafe + agentSafe + state
    end

    Note over SP,ASAFE: Operation (one or many epochs)
    SP->>ASAFE: **RewardClaimed(OLAS reward)**<br/>→ STAKING_REWARD_CLAIM
    ASAFE-->>MSAFE: optional OLAS sweep<br/>→ AGENT_TO_MASTER (Phase 2a raw)

    rect rgba(220,255,220,0.4)
    Note over MSAFE,SP: Unstake-cycle multicall (single tx)
    MSAFE->>SP: unstake(serviceId)
    SP->>ASAFE: **UnstakeReward (OLAS)** → UNSTAKE_REWARD
    SP-->>MSAFE: return NFT (ERC-721 Transfer)
    MSAFE->>SRTU: terminateTokenRefund(serviceId)
    SRTU-->>MSAFE: refund OLAS (security deposit)
    Note right of SRTU: **TokenRefund(MSAFE, OLAS, securityRefund)** [FIRST]<br/>→ SERVICE_BOND_REFUND row created + enqueued
    MSAFE->>SR: terminate(serviceId)
    Note right of SR: emit TerminateService [SECOND]<br/>→ dequeues the row + tags bondType=SECURITY_DEPOSIT
    MSAFE->>SRTU: unbondTokenRefund(serviceId)
    SRTU-->>MSAFE: refund OLAS (agent bond)
    Note right of SRTU: **TokenRefund(MSAFE, OLAS, refund)** [FIRST]<br/>→ SERVICE_BOND_REFUND row created + enqueued
    MSAFE->>SR: unbond(serviceId)
    Note right of SR: emit OperatorUnbond [SECOND]<br/>→ dequeues the row + tags bondType=AGENT_BOND
    end
```

Bond-type attribution is best-effort per §5.2. Because the SRTU event
fires *before* its ServiceRegistryL2 counterpart in every path, the SRTU
handler is the **producer** (creates the `FundsMovement` row + enqueues
it) and the ServiceRegistryL2 handler is the **consumer** (`ActivateRegistration`
/ `RegisterInstance` / `TerminateService` / `OperatorUnbond` dequeue the
row and backfill `serviceId` + `bondType`). The diagram shows the
canonical Pearl multicall ordering; deviations leave `bondType` null but
preserve amounts.

#### C. Predict-app funding flow (polystrat on Polygon)

Where Pearl predict's *stablecoin* moves. Per §4.5 / §6.3.b, polystrat
funds in **USDC / pUSD**; **USDC.e** is the Polymarket bet collateral and
the §2.2 high-volume hotspot, not the canonical funding token. Same shape
applies to omenstrat on Gnosis with
xDAI / WXDAI substituted; the predict subgraphs cover the in-market
side, this subgraph covers the funding side.

```mermaid
flowchart LR
    MEOA["Master EOA"]
    MSAFE["Master Safe"]
    ASAFE["Agent Safe"]
    AEOA["Agent EOA<br/>(gas wallet)"]
    POLY["Polymarket<br/>CTFExchange + ConditionalTokens"]

    MEOA -->|"stablecoin funding USDC / pUSD<br/>(SAFE_SETUP_TRANSFER, then MASTER_FUNDING_IN)"| MSAFE
    MSAFE -->|"polystrat capital (USDC / pUSD)<br/>MASTER_TO_AGENT"| ASAFE
    MSAFE -->|"gas top-up (POL or stablecoin)<br/>grouped under AgentFundingEvent"| AEOA
    ASAFE -->|"place bet (USDC.e collateral)"| POLY
    POLY -->|"payout / refund"| ASAFE
    ASAFE -->|"optional profit sweep<br/>AGENT_TO_MASTER"| MSAFE
    MSAFE -->|"user withdrawal (rare)<br/>MASTER_WITHDRAWAL"| MEOA

    classDef tracked fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    classDef predictSubgraph fill:#fef3c7,stroke:#d97706,stroke-width:2px,stroke-dasharray:6
    class MEOA,MSAFE,ASAFE,AEOA tracked
    class POLY predictSubgraph
```

The yellow/dashed `POLY` node is covered by `predict-polymarket`
(joined on Agent Safe address); arrows entering/leaving it represent
the boundary where pearl-funds' raw `Transfer` ledger ends and the
in-market bet ledger begins. The same pattern holds for omenstrat on
Gnosis (substitute Polymarket → Omen FPMM, USDC.e → WXDAI).

---

## 5. Phase 1 — Semantic Ledger

### 5.1 Schema (Phase 1)

```graphql
# --- Structural -------------------------------------------------------

type MasterSafe @entity(immutable: false) {
  id: Bytes!                          # Master Safe address
  network: String!
  # Per PR #129 review — owner derivation via getOwners() at first sighting,
  # kept current via Safe.AddedOwner/RemovedOwner/ChangedThreshold (Phase 2a).
  masterEoa: Bytes!                   # owners[0] at first sighting; primary Pearl signer
  owners: [Bytes!]!                   # full owner list
  threshold: BigInt!                  # signature threshold (Pearl default: 1)
  services: [Service!]! @derivedFrom(field: "masterSafe")
  agentSafes: [AgentSafe!]! @derivedFrom(field: "masterSafe")
  totalOlasRewardsClaimed: BigInt!    # cumulative across all its services
  firstSeenTimestamp: BigInt!
  firstSeenBlock: BigInt!             # for consumer "Setup complete" anchoring
  # Rev. 5: historyFloor* is the block at which the Master Safe was first
  # sighted. The frontend uses this to call eth_getBalance / token.balanceOf
  # at that block to derive opening balances — the subgraph no longer emits
  # OPENING_BALANCE rows. Named distinctly from firstSeen* because it is
  # a consumer-facing contract, not internal provenance.
  historyFloorBlock: BigInt!
  historyFloorTimestamp: BigInt!
  lastActivityTimestamp: BigInt!
}

type AgentSafe @entity(immutable: false) {
  id: Bytes!                          # Agent Safe (service multisig) address
  masterSafe: MasterSafe
  service: Service!
  createdTimestamp: BigInt!
}

type Service @entity(immutable: false) {
  id: ID!                             # serviceId
  serviceId: BigInt!
  agentIds: [Int!]!                   # deduplicated; from RegisterInstance — consumer filter, not WASM gate (§2.3)
  operators: [Bytes!]!                # deduplicated; sub-cohort filter (PolySafeCreator etc.)
  masterSafe: MasterSafe
  agentSafe: AgentSafe
  state: String!                      # REGISTERED|DEPLOYED|STAKED|UNSTAKED|TERMINATED
  nftCustodian: Bytes                 # current ERC-721 owner
  currentStakingContract: StakingContract
  totalOlasRewardsClaimed: BigInt!
  registeredTimestamp: BigInt!
  updatedTimestamp: BigInt!
}

type StakingContract @entity(immutable: false) {
  id: Bytes!                          # staking proxy address
  implementation: Bytes!
  minStakingDeposit: BigInt!
  numAgentInstances: BigInt!
}

# --- Ledger -----------------------------------------------------------

enum FundsCategory {
  # Phase 1 — semantic (registry / SRTU / staking)
  SAFE_DEPLOYED                       # First sighting of a Master Safe — anchor row (amount=0)
  SERVICE_BOND_DEPOSIT                # SRTU.TokenDeposit — fires twice per stake-cycle: activateRegistration + registerAgents. See §5.2.
  STAKING_REWARD_CLAIM                # RewardClaimed → Agent Safe
  UNSTAKE_REWARD                      # (Force)Unstaked reward → Agent Safe
  SERVICE_BOND_REFUND                 # SRTU.TokenRefund — fires twice per unstake-cycle: terminate + unbond
  SERVICE_EVICTED                     # ServicesEvicted (informational)
  # Phase 2a:
  # OPENING_BALANCE removed in Rev. 5 — opening balances are derived by the
  # frontend via eth_getBalance / token.balanceOf at historyFloorBlock.
  SAFE_SETUP_TRANSFER                 # First live Master EOA → Master Safe inbound hop. Fires once per Master Safe.
  # Phase 2 also adds: MASTER_FUNDING_IN, MASTER_TO_AGENT,
  # AGENT_TO_MASTER, MASTER_WITHDRAWAL, AGENT_TO_APP, APP_TO_AGENT, OTHER
}

# Best-effort disambiguator for SERVICE_BOND_DEPOSIT / SERVICE_BOND_REFUND
# rows. Both deposit-side functions emit the same event signature; both
# refund-side functions emit the same event signature. Disambiguation is
# done via cross-event correlation in the same tx with ServiceRegistryL2
# events (`ActivateRegistration` ↔ SECURITY_DEPOSIT; `RegisterInstance` ↔
# AGENT_BOND; `TerminateService` ↔ SECURITY_DEPOSIT-refund;
# `Unbond` / state-change ↔ AGENT_BOND-refund). Best-effort because the
# correlation can fail under unusual call orderings; null = unattributed.
enum ServiceBondType {
  SECURITY_DEPOSIT                    # activateRegistrationTokenDeposit / terminateTokenRefund
  AGENT_BOND                          # registerAgentsTokenDeposit / unbondTokenRefund
}

enum FundsSource {
  SEMANTIC                            # Derived from a typed event (TokenDeposit, RewardClaimed, ServiceStaked, etc.)
  RAW_TRANSFER                        # Direct ERC-20/native Transfer observed on chain
}

type FundsMovement @entity(immutable: false) {
  # Mutable: SRTU TokenDeposit/TokenRefund rows are created amount-only by
  # the SRTU producer and backfilled with serviceId + bondType by the
  # ServiceRegistryL2 consumer later in the same tx (see §5.2). All other
  # rows are write-once in practice.
  id: Bytes!                          # txHash.concatI32(logIndex) — for semantic rows lacking a logIndex, use a stable sub-index
  service: Service
  masterSafe: MasterSafe
  agentSafe: AgentSafe
  category: FundsCategory!
  source: FundsSource!
  bondType: ServiceBondType           # nullable; only populated for SERVICE_BOND_DEPOSIT / SERVICE_BOND_REFUND when disambiguation succeeds
  token: Bytes                        # token address (null for SAFE_DEPLOYED + pure NFT custody)
  amount: BigInt!                     # 0 for SAFE_DEPLOYED / SERVICE_EVICTED informational rows
  from: Bytes!
  to: Bytes!
  stakingContract: StakingContract
  epoch: BigInt
  # Phase 2 backref — see §6.5; null on all Phase 1 rows and on Phase 2 rows
  # that aren't part of a multi-row agent-funding action.
  agentFundingEvent: AgentFundingEvent
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# --- Service-NFT custody trail ---------------------------------------

type ServiceNftCustodyChange @entity(immutable: true) {
  id: Bytes!
  service: Service!
  from: Bytes!
  to: Bytes!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# --- Daily snapshot ---------------------------------------------------

type DailyServiceFunds @entity(immutable: false) {
  id: ID!                             # serviceId-dayTimestamp
  service: Service!
  dayTimestamp: BigInt!               # UTC midnight
  olasRewardsClaimed: BigInt!         # that day
  cumulativeOlasRewardsClaimed: BigInt!
}

# --- Internal helpers (not part of the public contract) --------------

type ServiceIndex @entity(immutable: false) { id: Bytes! multisig: Bytes! }
type PendingRegistration @entity(immutable: false) {
  id: Bytes! agentIds: [Int!]! operators: [Bytes!]!
}

# Same-tx bond-attribution queue for SRTU TokenDeposit/TokenRefund
# disambiguation. The SRTU event fires BEFORE its ServiceRegistryL2
# counterpart in every path (§4.6), so the SRTU handler is the PRODUCER
# (creates the FundsMovement row + enqueues its id) and the SR handler is
# the CONSUMER (dequeues + backfills serviceId + bondType). Three entities:
type PendingBondCounter @entity(immutable: false) {
  id: Bytes!                          # tx.hash
  nextEnqueueSlot: Int!
  nextDequeueSlot: Int!
}
type PendingBondRow @entity(immutable: false) {
  id: Bytes!                          # tx.hash.concatI32(slot)
  fundsMovement: Bytes!               # FundsMovement id awaiting serviceId + bondType
  attributed: Boolean!
}
# Dedupe guard: registerAgents emits one TokenDeposit but RegisterInstance
# fires once per agent instance — ensures the single AGENT_BOND row is
# attributed exactly once per (txHash, serviceId).
type AgentBondAttributionGuard @entity(immutable: true) {
  id: Bytes!                          # tx.hash.concat(serviceId.toBytes())
}
```

### 5.2 Handlers (Phase 1)

A shared helper `getOrCreateMasterSafe(addr, blockNumber, timestamp)`
does the first-sighting work: on creation, it calls
`GnosisSafe.getOwners()` + `GnosisSafe.getThreshold()` on the Master Safe,
sets `owners` / `masterEoa = owners[0]` / `threshold`, writes
`firstSeenBlock` / `firstSeenTimestamp`, and emits a single
`FundsMovement(category=SAFE_DEPLOYED, source=SEMANTIC, amount=0,
from=zero, to=masterSafe)` row so consumers anchor the "Setup complete"
event without needing to know the Safe-creation tx. The helper is
idempotent — subsequent calls just update `lastActivityTimestamp`.

| Handler | Data source / event | Action |
|---|---|---|
| `handleRegisterInstance` | `ServiceRegistryL2.RegisterInstance` | Record on `Service` (or buffer in `PendingRegistration` if the `Service` isn't created yet). Append `agentId` / `operator`, deduplicated. No agent-ID gate (§2.3). **Consumer:** dequeue the pending bond row enqueued by the preceding `registerAgentsTokenDeposit` and tag it `bondType=AGENT_BOND` — `attributeAgentBondOncePerService` guards against the once-per-agent-instance firing. |
| `handleActivateRegistration` | `ServiceRegistryL2.ActivateRegistration` | **Consumer:** dequeue the pending bond row enqueued by the preceding `activateRegistrationTokenDeposit` and tag it `bondType=SECURITY_DEPOSIT`. |
| `handleCreateMultisigWithAgents` | `ServiceRegistryL2.CreateMultisigWithAgents` | Create `Service` + `AgentSafe`, drain `PendingRegistration`, write `ServiceIndex`. |
| `handleServiceNftTransfer` | `ServiceRegistryL2.Transfer` (ERC-721) | Update `Service.nftCustodian`; emit `ServiceNftCustodyChange`. **Dual guard** before treating `to` as a Master Safe: (1) `isStakingContract(to)` early-return (fast path, no eth_call — the NFT moves to the staking proxy on stake); (2) `getOrCreateMasterSafe(to, …)` returns `null` when `getOwners()` reverts (defence-in-depth for proxies created before `StakingFactory.startBlock` or by an older factory). Only the resolved-Safe case links `service.masterSafe`, so a stake hop never clobbers the real link. |
| `handleTerminateService` | `ServiceRegistryL2.TerminateService` | `Service.state = TERMINATED`. **Consumer:** dequeue the pending bond row enqueued by the preceding `terminateTokenRefund` and tag it `bondType=SECURITY_DEPOSIT`. |
| `handleTokenDeposit` | `ServiceRegistryTokenUtility.TokenDeposit` | **Producer:** create `FundsMovement(SERVICE_BOND_DEPOSIT, source=SEMANTIC, token, amount, from=account, to=SRTU)` (amount only — `serviceId`/`bondType` left null) and enqueue its id in the per-tx queue. The following ServiceRegistryL2 event (`ActivateRegistration` / `RegisterInstance`) backfills them. Fires twice per stake-side multicall; both rows persisted. |
| `handleTokenRefund` | `ServiceRegistryTokenUtility.TokenRefund` | Mirror of `handleTokenDeposit`: producer of `FundsMovement(SERVICE_BOND_REFUND, source=SEMANTIC, token, amount, from=SRTU, to=account)`; backfilled by the following `TerminateService` / `OperatorUnbond`. Fires twice per unstake-side multicall. |
| `handleInstanceCreated` | `StakingFactory.InstanceCreated` | Spawn the `StakingProxy` template; snapshot `StakingContract` config (`minStakingDeposit`, `numAgentInstances`, `implementation`) via contract calls — copy `staking/src/staking-factory.ts`. |
| `handleServiceStaked` | `StakingProxy.ServiceStaked` | `getOrCreateMasterSafe(owner, …)` (fires `SAFE_DEPLOYED` on first sighting via the staking path — the canonical discovery path, since `owner`/`multisig` are event params); **link only when it resolves** (`if (masterSafe != null) service.masterSafe = masterSafe.id` — null for a non-Safe/EOA owner rather than crashing). Set `agentSafe = multisig`, `state = STAKED`, `currentStakingContract`. **No synthetic `STAKING_DEPOSIT` row** — the bond movement is captured by two real `SERVICE_BOND_DEPOSIT` rows from the SRTU handlers above. |
| `handleRewardClaimed` | `StakingProxy.RewardClaimed` | `FundsMovement(STAKING_REWARD_CLAIM, source=SEMANTIC, token=OLAS, amount=reward, from=stakingContract, to=agentSafe)`; bump cumulative counters on `Service` / `MasterSafe`; update `DailyServiceFunds`. |
| `handleServiceUnstaked` / `handleServiceForceUnstaked` | `StakingProxy.ServiceUnstaked` / `ServiceForceUnstaked` | `FundsMovement(UNSTAKE_REWARD, …)`; `state = UNSTAKED`; clear `currentStakingContract`. |
| `handleServicesEvicted` | `StakingProxy.ServicesEvicted` | `FundsMovement(SERVICE_EVICTED, amount=0)` per affected service (informational; eviction does not move funds). |

**SRTU bond-type disambiguation (best-effort).** Both
`activateRegistrationTokenDeposit` and `registerAgentsTokenDeposit` emit
the same `TokenDeposit(account, token, amount)` signature, and for Pearl
both have `account = MasterSafe` (Master Safe is both serviceOwner AND
operator). The same applies to the two refund functions
(see [autonolas-registries `ServiceRegistryTokenUtility.sol:391/465/498/541`](https://github.com/valory-xyz/autonolas-registries/blob/main/contracts/ServiceRegistryTokenUtility.sol)).
Disambiguation uses a per-tx queue (`PendingBondCounter` +
`PendingBondRow`). Because the SRTU function is called *before* the
registry function in every path (§4.6), the SRTU handler is the
**producer**: `handleTokenDeposit` / `handleTokenRefund` create the
`FundsMovement` row (amount only) and enqueue its id. The following
`ServiceRegistryL2` handler is the **consumer**: `ActivateRegistration`
→ SECURITY_DEPOSIT, `RegisterInstance` → AGENT_BOND (guarded once per
service by `AgentBondAttributionGuard`), `TerminateService` →
SECURITY_DEPOSIT, `OperatorUnbond` → AGENT_BOND — each dequeues the
oldest pending row and backfills `serviceId` + `bondType`. If no SR
event follows (e.g. an ETH-secured service that emits no SRTU event, or
an unmodeled call path), the row keeps its correct amount and a null
`bondType`.

`StakingProxy` handlers do not gate on Pearl agent ID — they fire for
every allowed-implementation proxy on the network, and the resulting
rows are filterable by `Service.agentIds` at query time (§2.3). The
implementation allow-list (`isAllowedImplementation` from `staking`) is
the only gate retained, since unknown staking implementations may have
incompatible event ABIs.

### 5.3 What Phase 1 answers

- The full Master Safe ↔ Master EOA ↔ Agent Safe ↔ Service ↔
  staking-contract graph — all four wallet types derived on-chain.
- A "Setup complete" anchor row (`SAFE_DEPLOYED`) at first sighting of
  each Master Safe, so consumers always have a first history entry.
- The service-NFT custody trail (stake/unstake).
- **Two real `SERVICE_BOND_DEPOSIT` rows per stake-cycle** (security
  deposit + agent bond) and **two real `SERVICE_BOND_REFUND` rows per
  unstake-cycle** (terminate + unbond refunds), sourced from the
  `ServiceRegistryTokenUtility` typed events — amounts taken straight
  from the event, with best-effort `bondType` attribution. The
  underlying ERC-20 OLAS movement between Master Safe and SRTU is not
  duplicated in Phase 1 (the raw `Transfer` rows appear in Phase 2a with
  `source = RAW_TRANSFER`, filterable out for the canonical view).
- Exact OLAS reward amounts claimed and at unstake, per service, per
  Master Safe, daily and cumulative — these are *real* OLAS transfers, and
  the amounts come straight from the events (no token indexing needed).

### 5.4 What Phase 1 does **not** answer (honest limits)

- **SRTU bond-type disambiguation is best-effort.** Both `TokenDeposit`
  emissions in a stake-cycle multicall (and both `TokenRefund` emissions
  in an unstake-cycle) share an event signature and, for Pearl,
  `account = MasterSafe`. The per-tx producer/consumer queue (§5.2)
  disambiguates them via same-tx `ServiceRegistryL2` event correlation,
  but if no SR event follows the SRTU row (unmodeled call path, or an
  ETH/native-secured service that emits no SRTU event at all), the row
  carries the correct amount and a null `bondType`. Consumers should not
  assume `bondType` is always populated, nor that every service produces
  `SERVICE_BOND_*` rows (token-secured services only).
- **Master EOA owner-list staleness between first sighting and Phase 2a
  template spawn.** Phase 1 captures `owners` via one-shot eth_call;
  `AddedOwner` / `RemovedOwner` only start firing once the Phase 2a Safe
  template is live. Pearl never rotates Master EOAs in normal operation,
  so this is a documented edge case, not a known failure mode.
- Native / USDC / USDC.e funding top-ups and Agent→Master OLAS sweeps —
  Phase 2.
- **Pre-first-sighting transfers and pre-Master-Safe Master EOA
  history** — unobservable from on-chain events: Phase 2a's Safe template
  can't back-fill events before it spawns, and until a Master Safe is
  sighted on chain no signal identifies an EOA as a Pearl Master EOA.
  Resolved per AC #3 / Path A (Rev. 5, §6.2 / §11 #8): the subgraph emits
  **no opening-balance row**; it records `MasterSafe.historyFloorBlock`
  and the wallet UI renders a "History starts here" divider there and
  fetches opening balances itself via archive RPC (`balanceOf` for
  ERC-20, `eth_getBalance` for native). After first sighting, Phase 2a
  captures Master EOA OLAS transfers via the tracked-address filter
  (§6.1). **Native → Agent EOA transfers remain a confirmed accepted v1
  gap** (EOAs emit no events; only call traces expose them, which defeats
  the §2.2 discipline).
- In-market bet flows — the predict subgraphs; join on Agent Safe address.

---

## 6. Phase 2 — Raw Token Ledger

### 6.1 Phase 2a — OLAS `Transfer` data source + agent-funding aggregation

OLAS volume on all four chains is low; a full `Transfer` data source is
cheap. The handler filters to a `TrackedAddress` set (an O(1) lookup
combining `TrackedSafe` for Master / Agent Safes with `TrackedEOA` for
Master EOAs — the latter added per the Rev. 2 maintainer ask so that
Master EOA → Master Safe funding hops are captured in their own right,
not only as the recipient side of a Safe event). The handler classifies
(see also §6.4):

- **First Master EOA → Master Safe transfer of any token after
  `SAFE_DEPLOYED`** ⇒ `SAFE_SETUP_TRANSFER` — per PR #129 review, this
  is the inbound transfer that the consumer wallet UI uses to render the
  "Setup complete" funding row (after the bare `SAFE_DEPLOYED` anchor).
  Detection: at first sighting of a Master Safe we set
  `MasterSafe.setupTransferSeen = false` (transient flag on the entity);
  the first qualifying inbound flips it.
- EOA → Master Safe (subsequent) ⇒ `MASTER_FUNDING_IN`; Master Safe →
  EOA ⇒ `MASTER_WITHDRAWAL`.
- Master Safe → Agent Safe (or Master Safe → an Agent EOA tracked under
  the same service) ⇒ `MASTER_TO_AGENT`, with `agentFundingEvent`
  populated per §6.5 so multi-row tx aggregates correctly.
- Agent Safe → Master Safe ⇒ `AGENT_TO_MASTER` (the reward sweep).
- staking proxy → Agent Safe — already booked semantically in Phase 1
  (`STAKING_REWARD_CLAIM` / `UNSTAKE_REWARD`); the raw row is reconciled,
  not double-counted (`source = RAW_TRANSFER`).
- **Master Safe ↔ ServiceRegistryTokenUtility — already booked
  semantically in Phase 1** (`SERVICE_BOND_DEPOSIT` / `SERVICE_BOND_REFUND`);
  the raw row is reconciled with `source = RAW_TRANSFER`,
  `category = SERVICE_BOND_DEPOSIT` (or `_REFUND`). The wallet UI
  filters by `source = SEMANTIC` to avoid showing the user "Master Safe
  funded SRTU" alongside the typed bond rows — same pattern as the
  staking-reward reconciliation. The two SEMANTIC rows per stake-cycle
  carry the canonical per-bond amounts; the single RAW_TRANSFER row
  shows the aggregated ERC-20 movement for forensic purposes.

**Agent-funding aggregation.** Per spec (VLOP-73, also called out in
@Tanya-atatakai's review): "Treats Master Safe → Agent EOA and Master
Safe → Agent Safe as the same transaction of funding the agent." Phase
2a emits one `FundsMovement` per raw `Transfer`, but additionally
groups same-tx Master→agent-side transfers under an `AgentFundingEvent`
entity (§6.5) keyed on `txHash + masterSafe + service`. Consumers may
query one row per `AgentFundingEvent` (lists constituent transfers) or
read the raw `FundsMovement` rows — both work, no dedup logic on the
consumer.

### 6.2 Phase 2a — native coin via `Safe` dynamic templates

A `Safe` template is created per Master Safe and per Agent Safe (the
babydegen pattern, `babydegen/src/safe.ts`):

- `SafeReceived` ⇒ native **in** — reliable.
- `ExecutionSuccess` / `ExecutionFromModuleSuccess` ⇒ native **out** —
  **approximate.** A Safe executing via a relayer carries 0 outer-tx
  value; precise native-out needs call/trace handlers. This limit is
  documented, not hidden — it is inherent to Safe event modelling and
  babydegen accepts the same trade-off.
- `AddedOwner` / `RemovedOwner` / `ChangedThreshold` (Master Safes
  only) ⇒ update `MasterSafe.owners` / `masterEoa` / `threshold` per
  §4.4. Owner changes are rare; the handler is cheap.

**Pre-template-spawn transfers (the "Setup complete" cold-start
problem).** The Safe template is not retroactive — it only sees events
from its spawn block onward. The MasterEOA → MasterSafe funding transfer
happens before the template exists and cannot be recovered by the subgraph.

**Rev. 5 decision:** Opening balances are delegated to the frontend.

1. **`MasterSafe.historyFloorBlock` / `historyFloorTimestamp`** — the
   block at which the Master Safe was first sighted. The frontend uses
   this as the "History starts here" cut-line and calls
   `token.balanceOf(masterSafe, historyFloorBlock)` (for OLAS /
   WrappedNative) and `eth_getBalance(masterSafe, historyFloorBlock)`
   (for native coin) via an archive RPC to derive opening balances.
   Native opening balance is available via this RPC call — the subgraph
   does not need to emit it.
2. **`SAFE_SETUP_TRANSFER` row** — fires once for the first live
   Master-EOA → Master-Safe inbound ERC-20 or native hop the subgraph
   observes after first sighting. Subsequent inbound hops are
   `MASTER_FUNDING_IN`.

**Known accepted gap — native → Agent EOA:** Native coin transfers
to a plain EOA emit no on-chain log. The Agent EOA gas-funding leg
(e.g. 2 xDAI sent directly to the Agent EOA) is permanently
unobservable from event-based subgraph indexing on
Gnosis/Polygon/Optimism/Base, where call handlers are not supported.
This gap is accepted for v1 and documented here.

**VLOP-73 AC #3 implication** (Rev. 4 follow-up, per @rajat2502's
self-correction on PR #130). AC #3 is verbatim:

> *"First history entry after Safe creation is the 'Setup complete'
> event."*

and the transactions list names it:

> *"Funds moved from MasterEOA (Safe Setup)"*

This asks for a **literal transfer row** with the actual MasterEOA →
Master Safe funding amount + token, labelled "Setup complete".
`OPENING_BALANCE` (the post-funding *snapshot* at first sighting) does
not satisfy AC #3 as written. So:

**AC #3 — resolved (Rev. 5, 2026-05-29):** Path A confirmed by product.
"Setup complete" is rendered frontend-side: the UI shows a "History starts
here" divider at `historyFloorBlock`, then displays opening balances fetched
via archive RPC (`balanceOf` for ERC-20, `eth_getBalance` for native).
No subgraph change needed. Path B (backdated template startBlock) was
verified as not supported upstream (§11 #6). Path C (on-chain workarounds
— discovery+graft+static dataSources, chain-wide deferred classification,
substreams; see PR #129 history) was evaluated and rejected as
unnecessary given the Path A product decision.

### 6.3 Phase 2b — stablecoins (USDC / USDC.e / pUSD)

**Decision (Rev. 7): shipped on-chain (#138), benchmark deferred.** Product
chose to ship all of 2b on-chain now and monitor post-deploy rather than
gate on the §6.3a benchmark first — the benchmark couldn't run because
Studio isn't provisioned yet (no environment to measure in). The token set
is **USDC + USDC.e + pUSD** (per the Operate app `config/tokens.ts`; pUSD is
a distinct Polymarket contract, not a USDC.e alias — see §4.5). **Rollback
condition:** if Polygon USDC.e sync (the §2.2 hotspot) proves too slow once
deployed, drop the `matic` USDC.e entry from `networks.json` `erc20Tokens`
(a one-line change — no re-render of the rest of the matrix) and fall back
to the off-chain path below for that one token.

The original gating analysis (still the rationale behind the rollback
condition) was **two decisions, not one** (per @Tanya-atatakai's PR #129
review):

**(a) Indexing-cost decision.** USDC.e on Polygon is the cost hotspot
(§2.2). Before any commitment, run a benchmark:

1. Deploy a throwaway USDC.e `Transfer` subgraph with an early start
   block; measure sync throughput (events/s) and projected full-sync
   time.
2. If projected sync is acceptable (target: full historical sync in
   days, not weeks) → ship 2b as a normal `Transfer` data source with
   the `TrackedSafe` in-handler filter.
3. If not acceptable → do **not** ship 2b on-chain. Document the
   off-chain alternative the prior plan already endorsed
   ([`pearl/SUBGRAPH_PLAN.md`](../pearl/SUBGRAPH_PLAN.md) §6.1: USDC /
   MATIC flows are "answerable off-chain against a Safe address by a
   general-purpose ERC-20 indexer — Dune, archive RPC"). Revisit if a
   substreams-powered data source becomes viable for Polygon.

**(b) Product decision.** Polystrat funding on Polygon is
stablecoin-denominated (USDC + pUSD per the current app config). If 2b is
punted off-chain, **the Polygon wallet
view cannot satisfy the VLOP-73 acceptance criterion *"Each included
transaction type renders correctly"* without the consumer pulling
stablecoin transfers from a second source.** This is a product
trade-off, not just an infra one. Surface to Pearl product **before**
benchmarking, so the decision tree on the "off-chain fallback" branch
is owned (do we ship an off-chain integration as part of the wallet
work, or do we accept that Polygon stablecoin rows won't appear in v1?).

**Consumer-side merge cost** (Rev. 4, per @rajat2502's PR #130
review). The off-chain fallback isn't free for the wallet client
either: the Pearl Wallet would merge on-chain `pearl-transactions`
rows with an off-chain stablecoin ERC-20 source per-Safe, deduping
and time-aligning two paginated APIs. Concretely doubles Polygon-side
wiring complexity in the consumer and means the wallet's offline-cache
story is different per-chain. Worth weighing against the on-chain
indexing-cost concern when picking the path.

Together: 2a ships unconditionally; 2b's go/no-go is a measured infra
decision *and* an explicit product decision *and* a consumer-cost
decision. **Decide before Phase 2 code lands** — by the time the
benchmark runs the wallet UI is being wired, so the answer determines
which client path consumers prepare for.

### 6.4 Classification engine

A shared `classifyTransfer(from, to)` helper resolves each raw transfer's
`category` by matching `from`/`to` against:

- `TrackedSafe` (role: MASTER / AGENT)
- `TrackedEOA` (role: MASTER_EOA / AGENT_EOA) — added in Rev. 2 so Master
  EOA hops are first-class, not just inferred via Safe `SafeReceived`
- `StakingContract` (any indexed `StakingProxy`)
- `ServiceRegistryL2` (per-network constant)
- `ServiceRegistryTokenUtility` (per-network constant) — Rev. 2; routes
  Master Safe ↔ SRTU transfers to `SERVICE_BOND_DEPOSIT` /
  `SERVICE_BOND_REFUND` reconciliation rows
- A small constant set of known app contracts (FPMM / ConditionalTokens
  / CTFExchange addresses already enumerated in the predict subgraphs)

Unmatched ⇒ `OTHER`.

### 6.5 Schema additions (Phase 2)

```graphql
type Token @entity(immutable: false) {
  id: Bytes!                          # token address
  symbol: String!
  decimals: Int!
}

type TrackedSafe @entity(immutable: false) {
  id: Bytes!                          # Safe address
  role: String!                       # MASTER | AGENT
  service: Service!
}

# Added Rev. 2 — Master EOAs (and optionally agent EOAs) tracked alongside
# Safes so OLAS handler classify() can route Master EOA hops without
# relying on Safe SafeReceived inference. Populated by getOrCreateMasterSafe
# (Phase 1) and by RegisterInstance (for agent EOAs, when needed).
type TrackedEOA @entity(immutable: false) {
  id: Bytes!                          # EOA address
  role: String!                       # MASTER_EOA | AGENT_EOA
  masterSafe: MasterSafe              # backref (always set for MASTER_EOA)
  service: Service                    # set for AGENT_EOA; null for MASTER_EOA shared across services
  firstTrackedBlock: BigInt!          # block at which we first identified this EOA
}

type TokenBalance @entity(immutable: false) {
  id: Bytes!                          # safe.concat(token)
  safe: Bytes!
  token: Token!
  balance: BigInt!                    # running balance (transfer-derived)
  lastUpdatedTimestamp: BigInt!
  lastUpdatedBlock: BigInt!
}

# Per @Tanya-atatakai PR #129 review — wallet UI renders one row per
# logical "agent funding action" even when the user funded multiple
# tokens / both Agent Safe and Agent EOAs in a single tx.
type AgentFundingEvent @entity(immutable: false) {
  id: Bytes!                          # txHash.concat(masterSafe).concat(service.id)
  service: Service!
  masterSafe: MasterSafe!
  txHash: Bytes!
  blockTimestamp: BigInt!
  totalNativeAmount: BigInt!          # sum across constituent transfers
  totalOlasAmount: BigInt!
  # other token totals added as needed
  transfers: [FundsMovement!]! @derivedFrom(field: "agentFundingEvent")
}
```

`FundsMovement` is reused (with the `agentFundingEvent` backref already
in §5.1) — Phase 2 rows carry `source = RAW_TRANSFER` and the additional
`FundsCategory` variants. Constituent Master→Agent transfers in a single
tx all link to the same `AgentFundingEvent`. Consumers may render either
one row per `AgentFundingEvent` (the wallet UI's default) or per
`FundsMovement` (forensic view) — both work without consumer-side dedup.

**Symmetric direction — resolved (v1): consumer-side `GROUP BY txHash`.**
The Figma's multi-token rows like "Withdraw to external wallet"
(-USDC.e/-XDAI/-OLAS/-WXDAI in one tx) and "Omenstrat withdrawal"
(+OLAS/+XDAI/+WXDAI in one tx) need per-tx grouping for the
`MASTER_WITHDRAWAL`, `AGENT_TO_MASTER`, and `MASTER_TO_AGENT` (already
handled by `AgentFundingEvent`) directions. For v1, `AgentFundingEvent`
covers only `MASTER_TO_AGENT`; consumers group the other directions by
`txHash` on the indexed `FundsMovement` rows client-side — feasible, no
schema change. A server-side generic `TxBundle` entity per
`(txHash, masterSafe)` is deferred to a future rev only if VLOP-73
acceptance specifically requires server-side grouping for these
directions.

### 6.6 What Phase 2 answers

Master Safe setup transfer, funding top-ups, and withdrawals; Master ↔
Agent transfers (incl. the OLAS reward sweep), grouped per-tx via
`AgentFundingEvent`; Agent/Master ↔ app-contract flows; per-safe running
token balances; live Master Safe owner-set changes. With 2b: the same
for USDC/USDC.e (stablecoin prediction funding). Combined with the
predict subgraphs (bet P&L) this gives end-to-end "follow the money"
for a Pearl predict service. See §6.2 for the documented limit on
pre-first-sighting native baseline.

---

## 7. Asset / File Inventory

Everything the implementation created. This was the build contract for
the follow-up PRs (#130–#133, all merged; #138 in review).

### 7.1 `subgraphs/pearl-transactions/`

| File | Phase | Notes |
|---|---|---|
| `package.json` | 1 | Exact pins: `@graphprotocol/graph-cli` 0.98.1, `@graphprotocol/graph-ts` 0.38.2, `matchstick-as` 0.6.0. `generate-manifests` script. |
| `tsconfig.json` | 1 | Copy from `staking`. |
| `schema.graphql` | 1 / 2 | §5.1 + §6.5. |
| `subgraph.template.yaml` | 1 / 2 | Data sources per §4.3. |
| `networks.json` | 1 / 2 | Gnosis + Polygon + Optimism + Base addresses / start blocks (per-network table in §4.3). |
| `src/constants.ts` | 1 | Per-network OLAS / USDC / USDC.e selectors (extends `shared/constants.ts` patterns); `isAllowedImplementation` list. **No agent-ID gate** (§2.3); the published agent IDs 25 / 86 are documentation only, not WASM constants. |
| `src/utils.ts` | 1 | `getOrCreateService` / `AgentSafe`; `getOrCreateMasterSafe` (with one-shot `GnosisSafe.getOwners()` + `getThreshold()` eth_call and `SAFE_DEPLOYED` row emission, §5.2); `ServiceIndex` + `PendingRegistration` drain; daily-snapshot helper. |
| `src/service-registry.ts` | 1 | Registry handlers (§5.2), incl. dual-guard NFT-transfer Master Safe discovery and the **consumer** side of the bond queue (dequeue + backfill `serviceId`/`bondType` on `ActivateRegistration` / `RegisterInstance` / `TerminateService` / `OperatorUnbond`). |
| `src/service-registry-token-utility.ts` | 1 | `handleTokenDeposit` / `handleTokenRefund` — **producer** side: create the `SERVICE_BOND_DEPOSIT` / `SERVICE_BOND_REFUND` row (amount only) + enqueue for the SR consumer to backfill `bondType`. |
| `src/staking-factory.ts` | 1 | `handleInstanceCreated`. |
| `src/staking-proxy.ts` | 1 | Stake (no synthetic deposit row in Rev. 2 — real SRTU events cover it) / claim / unstake / evict handlers. |
| `src/erc20.ts` | 2a / 2b | Generic `handleErc20Transfer` shared by all ERC-20 data sources — OLAS + WrappedNative (2a), USDC / USDC.e / pUSD (2b); `classifyTransfer`; `SAFE_SETUP_TRANSFER` detection; `AgentFundingEvent` aggregation. |
| `src/safe.ts` | 2a | Native-coin handlers + `AddedOwner` / `RemovedOwner` / `ChangedThreshold` owner-list maintenance per §4.4. |
| `tests/*.test.ts` + helpers | 1 / 2 | Matchstick — §10. |
| `CLAUDE.md` | 1 | Subgraph context, per repo convention. |
| `README.md` | 1 | Consumer-facing entity/query reference. |

### 7.2 Shared ABIs — `abis/` (reuse; verify)

| ABI | Status |
|---|---|
| `ServiceRegistryL2.json` | Exists. **Verify it includes** (a) the ERC-721 `Transfer` event (add fragment if absent), and (b) the `ActivateRegistration` event (the bond-queue consumer for SRTU bond-type disambiguation per §5.2). |
| `ServiceRegistryTokenUtility.json` | **New — must be added.** Source from [`valory-xyz/autonolas-registries`](https://github.com/valory-xyz/autonolas-registries) build artifacts. Needs at minimum the `TokenDeposit(address,address,uint256)` and `TokenRefund(address,address,uint256)` event fragments. |
| `StakingFactory.json`, `StakingProxy.json` / `StakingToken.json` | Exist (used by `staking`). Reuse. |
| `ERC20.json` (or `ERC20Detailed.json`) | Exists (predict). Reuse for Phase 2 `Transfer` events. (No `balanceOf` baseline call — opening balances are read frontend-side under Path A, §6.2.) |
| `GnosisSafe.json` / `Safe.json` | Exist (`service-registry` / `babydegen`). Reuse for `getOwners()` / `getThreshold()` eth_calls (§4.4) and the `Safe` template events. |

### 7.3 Repo-level changes (landed alongside the code PRs)

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | `pearl-transactions` entry in the `test` matrix + `lockfile-lint` matrix (landed with #130). |
| `CLAUDE.md` (root) | `pearl-transactions/` documented in the subgraph tree + Multi-Network Patterns (landed with #130). |
| `.supply-chain/` | `install-hooks.allowlist` refreshed when #131/#132 landed (no new deps — toolchain identical to `staking`). |
| `scripts/generate-manifests.js` | Phase 2b (#138) added an optional per-network `erc20Tokens` array (guarded; no-op for other subgraphs) for the variable stablecoin count; otherwise generic. |

---

## 8. Implementation Sequence

How the work was sequenced (✅ = merged to `main`):

1. ✅ **Plan** (this PR, #129) + **Scaffold** (#130) — `subgraphs/pearl-transactions/` skeleton + `ci.yml` matrix entry.
2. ✅ **Phase 1a** (#131) — `ServiceRegistryL2` handlers; `ServiceRegistryTokenUtility` `TokenDeposit` / `TokenRefund`; `Service` / `MasterSafe` / `AgentSafe` / NFT custody; `getOrCreateMasterSafe` (`getOwners()` eth_call + `SAFE_DEPLOYED`); two `SERVICE_BOND_DEPOSIT` / `_REFUND` rows with the producer/consumer bond queue. (#131 also fixed the SRTU-before-SR ordering + the non-Safe NFT guard.)
3. ✅ **Phase 1b** (#132) — `StakingFactory` + `StakingProxy`; `STAKING_REWARD_CLAIM` / `UNSTAKE_REWARD` / `SERVICE_EVICTED`; `DailyServiceFunds`.
4. ✅ **Phase 2a** (#133) — OLAS + WrappedNative `Transfer` data sources + per-Safe `Safe` template; `classifyTransfer`; `TrackedSafe` / `TrackedEOA` / `TokenBalance` / `Token`; `AgentFundingEvent`; `SAFE_SETUP_TRANSFER` (first live inbound hop) + `historyFloorBlock` per the Path A decision (§6.2); owner-list maintenance.
5. 🔄 **Phase 2b** (#138, in review) — stablecoin `Transfer` data sources (USDC / USDC.e / pUSD per chain, §6.3); on-chain path chosen, the §6.3a Polygon sync benchmark deferred.

**§11 #6** (graph-node backdated `startBlock`) was verified NOT SUPPORTED — Path B is dead; AC #3 resolved via Path A (§6.2), so there is no "option 1 vs option 2" decision left.

### Still ahead

- **Verify on Studio** — deploy all four networks; spot-check a known Pearl service's stake/claim/unstake against a block explorer and `MasterSafe.masterEoa` against the onboarding tx. (Blocked on Studio provisioning.)
- **Docs (Phase 9)** — finalize `subgraphs/pearl-transactions/CLAUDE.md` / `README.md`; the subgraph CLAUDE.md still describes the Phase 1a state.

---

## 9. Reuse Map

| From | Reused for |
|---|---|
| `staking/` | `StakingFactory` + `StakingProxy` template, `isAllowedImplementation`, `handleInstanceCreated` config snapshot, template / `networks.json` / `generate-manifests` wiring, `tsconfig.json` |
| `service-registry/` | `ServiceRegistryL2` data source shape, `getOrCreateService`, `RegisterInstance` handling |
| `pearl/pearl-trades-schema.md` §3.4 | `ServiceIndex` + `PendingRegistration` event-ordering pattern |
| `babydegen/src/safe.ts`, `tokenBalances.ts` | Phase 2 `Safe` template handlers, ERC-20 transfer + balance tracking, in-handler tracked-address filter |
| `shared/constants.ts` | OLAS addresses (extend with USDC/USDC.e/native metadata) |
| `predict/predict-*` | Known app-contract addresses for `classifyTransfer` |

---

## 10. Testing Strategy

Matchstick (`matchstick-as` 0.6.0), mirroring the repo's existing suites.

- **Phase 1** — `agentIds` / `operators` correctly recorded on `Service`
  for both Pearl predict and a non-Pearl agent (no WASM-level gate, per
  §2.3); `RegisterInstance`-before-`CreateMultisigWithAgents` ordering;
  Master Safe resolved from both `ServiceStaked.owner` and NFT `Transfer`;
  Master EOA derived from mocked `GnosisSafe.getOwners()` call and
  written to `MasterSafe.masterEoa`; `SAFE_DEPLOYED` row emitted exactly
  once per Master Safe at first sighting; **SRTU stake-cycle: a
  multicall containing `ActivateRegistration` + `RegisterInstance` +
  two `TokenDeposit` events produces exactly two `SERVICE_BOND_DEPOSIT`
  rows with `bondType = SECURITY_DEPOSIT` and `AGENT_BOND` respectively
  via the producer/consumer bond queue (§5.2); the same with
  `SERVICE_BOND_REFUND` on the unstake side; an unmodeled call
  ordering still produces the rows with null `bondType`**; stake →
  claim → unstake lifecycle produces the right `FundsMovement` rows
  and cumulative counters; NFT custody trail; eviction is
  informational only; daily-snapshot rollover at UTC midnight.
- **Phase 2** — `classifyTransfer` for each category (incl.
  `SAFE_SETUP_TRANSFER` only fires for first qualifying inbound, not
  later top-ups); same-tx Master→Agent transfers across multiple tokens
  / Agent Safe + Agent EOA group under one `AgentFundingEvent`; double-
  count reconciliation between the semantic claim row and the raw OLAS
  row; **Master Safe → SRTU OLAS Transfer produces a row with
  `category = SERVICE_BOND_DEPOSIT`, `source = RAW_TRANSFER` and
  consumers filtering by `source = SEMANTIC` see only the two typed
  bond rows from Phase 1**; **Master EOA in `TrackedEOA` set —
  Master EOA → Master Safe OLAS transfer triggers `SAFE_SETUP_TRANSFER`
  on first qualifying inbound and `MASTER_FUNDING_IN` afterwards;
  Master EOA → unrelated EOA classified `OTHER`, not silently dropped**;
  native in/out via `Safe` events; `TokenBalance` running total;
  `AddedOwner` / `RemovedOwner` update `MasterSafe.owners` /
  `masterEoa`.

CI runs `yarn graph codegen` + `yarn graph test` via the `ci.yml` matrix.

---

## 11. Open Questions

1. ~~Polygon `ServiceRegistryL2` start block.~~ **Resolved:** use the
   `service-registry` Polygon block `41,783,952` (provably safe — predates
   any Pearl predict service). The earlier `predict-polymarket` block
   `80,360,433` was a fast-sync optimization that risked missing late-start
   stragglers; the cost of decoding extra `RegisterInstance` events from
   `41,783,952` onward is negligible.
2. **Phase 2b feasibility** — the USDC.e benchmark (§6.3a) is the single
   biggest unknown. Result decides on-chain vs. off-chain stablecoin
   tracking. New: §6.3b also requires Pearl product input on the
   off-chain branch before benchmarking.
3. **`ServiceRegistryL2.json` ABI** — confirm it carries the ERC-721
   `Transfer` event (§7.2). If absent, add an ERC-721 fragment.
4. **predict-omen agent-ID filter** — separate from this work but worth
   noting: `predict-omen` in *this* repo still has no agent-ID filter;
   the `PREDICT_AGENT_ID = 25` fix is stranded in the unmerged
   `valory-xyz/autonolas-subgraph` PR #89. Recommend porting it
   independently. (Note: per §2.3, this `pearl-funds` subgraph
   deliberately does **not** gate on agent ID — so this open question
   is orthogonal to pearl-funds and only affects the trade subgraph.)
5. ~~**Subgraph name**~~ **Resolved:** renamed to `pearl-transactions`
   (PR #130 scaffold). Directory, CI matrix entry, and Studio slug all
   use `pearl-transactions`.
6. ~~**Graph-node support for backdated template `startBlock`**~~
   **Resolved 2026-05-27: NOT SUPPORTED.** Verification (via
   reading graph-node master at v0.43.0) confirms the
   `Template.createWithContext` startBlock-via-context trick is a
   myth. graph-node hardcodes `start_block: creation_block` for
   spawned templates in
   [`chain/ethereum/src/data_source.rs#L132`](https://github.com/graphprotocol/graph-node/blob/master/chain/ethereum/src/data_source.rs);
   [issue #902](https://github.com/graphprotocol/graph-node/issues/902)
   tracking this feature was stale-bot closed in July 2025 without an
   implementing PR. Studio runs hosted graph-node and so cannot offer
   a feature that doesn't exist upstream.

   **Consequence:** Path B from §6.2 is dead. AC #3 resolved via
   Path A (Rev. 5, 2026-05-29) — "Setup complete" is rendered
   frontend-side from `historyFloorBlock`. See §6.2.
7. **`ServiceRegistryTokenUtility` start blocks** (Rev. 2). Addresses
   are sourced from `autonolas-registries`
   [`docs/configuration.json`](https://github.com/valory-xyz/autonolas-registries/blob/main/docs/configuration.json),
   but the file does not list deployment blocks. Before manifest
   generation, look up the first tx on each address per chain (Gnosis,
   Polygon, Optimism, Base) on the corresponding explorer and record
   the value in `networks.json`. Pessimistic fallback: use the
   matching-chain `ServiceRegistryL2` start block (always ≤ SRTU deploy
   because SRTU is wired in `ServiceRegistryL2.changeServiceManager`
   post-deploy) — wastes some indexing but is provably safe. Also
   verify the deduped Gnosis/Polygon address is not a doc error.
8. ~~**Pre-Master-Safe Master EOA history**~~ **Resolved (Rev. 5,
   2026-05-29):** Path A confirmed by product — `historyFloorBlock` is
   the contract (the subgraph emits no opening-balance row). The wallet
   UI renders "History starts here" at that block; opening balances are
   fetched by the frontend via archive RPC (`eth_getBalance` /
   `token.balanceOf` at `historyFloorBlock`).
   Native → Agent EOA transfers are a confirmed accepted gap for v1.

---

## 12. Deliberately Absent

Per §2.1 and the prior plan's audit discipline — none of the following
appear in the schema, and none may be added without an explicit policy
revisit:

- No `mode` / `tool` / `tier` / `requestId` / prediction-server
  identifier on any entity.
- No `source = SERVER` enum variant, no off-chain enrichment hook.
- No timestamp-bucket or window-join field that would make a server-side
  join one query away.
- No free-text `label` / `note` field repurposable for off-chain metadata.
- No USD valuation fields (scope decision — raw amounts only).

---

## 13. Related Documents

- [`subgraphs/pearl/SUBGRAPH_PLAN.md`](../pearl/SUBGRAPH_PLAN.md) — prior
  Pearl scoping; §6.1 defers the funding subgraph this plan delivers.
- [`subgraphs/pearl/pearl-trades-schema.md`](../pearl/pearl-trades-schema.md)
  — §3.4 `ServiceIndex` / `PendingMultisig` event-ordering pattern reused here.
- [`subgraphs/staking/`](../staking/) — `StakingFactory` / `StakingProxy`
  patterns; reward-event semantics.
- [`subgraphs/service-registry/`](../service-registry/) — `ServiceRegistryL2`
  data source; service lifecycle.
- [`subgraphs/predict/`](../predict/) — in-market bet P&L; app-contract
  address constants.
- `valory-xyz/autonolas-subgraph` PR #89 — confirms Gnosis Pearl predict
  agent ID `25` (unmerged, old repo).
