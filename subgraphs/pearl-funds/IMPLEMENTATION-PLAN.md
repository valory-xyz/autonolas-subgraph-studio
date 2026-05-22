# Pearl Funds-Movement Subgraph — Implementation Plan

**Status:** Proposed — for verification before implementation. No code yet.
**Proposed subgraph:** `subgraphs/pearl-funds/`
**Target networks (v1):** Gnosis, Polygon
**Last updated:** 2026-05-22

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

| Actor | What it is |
|---|---|
| **Master EOA** | The key Pearl holds for the user. |
| **Master Safe** | A Gnosis Safe owned by the Master EOA. One per chain. Funds and owns services; **holds the service NFT**. |
| **Service** | An Olas service, an ERC-721 minted by `ServiceRegistryL2`. `tokenId == serviceId`. Owned by the Master Safe. |
| **Agent Safe** | The service multisig (`ServiceRegistryL2.CreateMultisigWithAgents.multisig`). The Safe the agent operates from — places bets, receives rewards. |
| **Agent EOA(s)** | Agent instances registered via `RegisterInstance`; signers of the Agent Safe. |
| **Staking proxy** | A `StakingToken`/`StakingProxy` instance created by `StakingFactory`. Custodies the service NFT while staked; pays OLAS rewards. |

The funding hierarchy: **Master EOA → Master Safe → Agent Safe → app
contracts (staking, prediction markets) → back.**

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
5. **App funding.** Native coin / USDC / USDC.e(pUSD) moves Master Safe →
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

### 2.3 Cohort keying

All per-service analytics key on the Olas `serviceId` and, transitively,
the Master Safe / Agent Safe addresses. The Pearl predict cohort is
identified on-chain by **agent ID** (`RegisterInstance.agentId`):

| Network | Pearl predict agent ID | Source |
|---|---|---|
| Gnosis (omenstrat) | **25** | Confirmed by maintainer; matches `valory-xyz/autonolas-subgraph` PR #89 (`PREDICT_AGENT_ID = 25`) |
| Polygon (polystrat) | **86** | `predict-polymarket/src/constants.ts` |

Gating on agent ID (rather than tracking every Olas service) is a
deliberate choice here — unlike the trade subgraph, it materially bounds
the Agent-Safe set that Phase 2's raw token ledger must watch. The
`operators` array is additionally recorded per service so the Pearl-Mini
vs. polystrat sub-cohort split (`operator == PolySafeCreator`,
`0xA749f605D93B3efcc207C54270d83C6E8fa70fF8`) stays client-side filterable,
consistent with the prior plan's philosophy.

---

## 3. Scope & Phasing

### 3.1 In scope (v1)

Pearl **predict** services on **Gnosis and Polygon** — their Master Safes,
Agent Safes, service NFTs, staking activity, and (Phase 2) token funding
flows.

### 3.2 Phasing

| Phase | Delivers | Cost | Gate |
|---|---|---|---|
| **Phase 1 — Semantic ledger** | Master/Agent/Service graph; service-NFT custody; staking stake/claim/unstake/eviction with exact OLAS reward amounts (straight from events) | Low — no high-volume data sources | Ship first |
| **Phase 2a — OLAS + native ledger** | OLAS `Transfer` data source (low volume); native coin via `Safe` dynamic templates. Captures Agent→Master OLAS sweeps and native funding | Low–moderate | After Phase 1 verified |
| **Phase 2b — Stablecoin ledger** | USDC + USDC.e `Transfer` ledger, filtered to tracked safes | **High (Polygon USDC.e)** | **Benchmark-gated — see §6.3** |

The user-facing framing is "Phase 1 and Phase 2"; Phase 2 is split here
only because **2a is cheap and unconditional** while **2b carries a real
indexing-cost risk** and must clear a benchmark before commitment.

### 3.3 Out of scope / deferred

- **Other Pearl agent types** (Optimus/babydegen, agents.fun, Modius) and
  other networks — template pattern leaves the door open; not v1.
- **USD valuation** — raw token amounts only (per scoping decision).
  Consumers value downstream.
- **ServiceRegistryTokenUtility bonds** — the literal OLAS security
  deposit / agent bond posted at *service registration* is held by
  `ServiceRegistryTokenUtility`, which is not indexed in this repo. See
  §5.4 — the stake "deposit" is treated as a computed commitment in
  Phase 1; indexing the literal bond transfer is a Phase 2b+ option.
- **In-market bet P&L** — owned by the predict subgraphs.

### 3.4 Cross-deployment note

Template pattern → one template, **two Studio deployments** (Gnosis,
Polygon). `serviceId` is unique per deployment; consumers query both.
This matches `staking` and `service-registry`.

---

## 4. Architecture

### 4.1 New subgraph, template pattern

`subgraphs/pearl-funds/` — `subgraph.template.yaml` + `networks.json` +
the shared `scripts/generate-manifests.js`, exactly like `staking`. Gnosis
and Polygon share identical data-source *shapes*; only addresses, start
blocks, and the per-network agent ID differ. Per-network constants resolve
via a `dataSource.network()` switch, the way `staking/src/utils.ts` does
`isAllowedImplementation`.

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

| Data source | Gnosis | Polygon | Events | Phase |
|---|---|---|---|---|
| `ServiceRegistryL2` | `0x9338b5153AE39BB89f50468E608eD9d764B755fD` @ 27,871,084 | `0xE3607b00E75f6405248323A9417ff6b39B244b50` @ 80,360,433 | `RegisterInstance`, `CreateMultisigWithAgents`, ERC-721 `Transfer`, `TerminateService` | 1 |
| `StakingFactory` | `0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700` @ 35,206,806 | `0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461` @ 62,213,142 | `InstanceCreated` | 1 |
| `StakingProxy` (dynamic template) | discovered via factory | discovered via factory | `ServiceStaked`, `ServiceUnstaked`, `ServiceForceUnstaked`, `RewardClaimed`, `ServicesEvicted` | 1 |
| `OLAS` (ERC-20) | `0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f` | `0xFEF5d947472e72Efbb2E388c730B7428406F2F95` | `Transfer` | 2a |
| `Safe` (dynamic template) | per Master/Agent Safe | per Master/Agent Safe | `SafeReceived`, `ExecutionSuccess`, `ExecutionFromModuleSuccess` | 2a |
| `USDC` (ERC-20) | — | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | `Transfer` | 2b |
| `USDC.e` / pUSD (ERC-20) | — | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174` | `Transfer` | 2b |

Native token references: WXDAI `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`
(Gnosis), WPOL/WMATIC `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`
(Polygon) — used only for symbol/decimals metadata; native coin itself is
tracked via the `Safe` template, not an ERC-20 data source.

`ServiceRegistryL2` start blocks match the predict subgraphs (proven to
cover Pearl predict services). `StakingFactory` may start at its natural
deploy block — `InstanceCreated` is rare and cheap; staking *proxy* events
are processed only for known Pearl services anyway.

### 4.4 Service / Master Safe / Agent Safe discovery

- **Pearl predict service** — flagged when `RegisterInstance.agentId`
  equals the network's Pearl predict agent ID (§2.3).
- **Agent Safe** — `CreateMultisigWithAgents.multisig`.
- **Master Safe** — two on-chain sources, cross-checked:
  1. `StakingProxy.ServiceStaked.owner` — the authoritative service owner
     recorded by the staking contract (for staked services).
  2. The ERC-721 `Transfer` owner of the service NFT — ground truth for
     un-staked services and after unstake.
  The service NFT `Transfer` also yields the stake/unstake custody trail
  for free (Master Safe → staking proxy → Master Safe).

**Event-ordering gotcha.** On `ServiceRegistryL2`, the initial deployment
order is typically `RegisterInstance*` → `CreateMultisigWithAgents` — so
the multisig address is unknown when `RegisterInstance` fires. This is the
same ordering issue the prior plan hit
([`pearl-trades-schema.md`](../pearl/pearl-trades-schema.md) §3.4). Reuse
its pattern: a tiny internal `ServiceIndex` (`serviceId → multisig`) plus a
`PendingRegistration` buffer for `RegisterInstance` data that arrives
first, drained when `CreateMultisigWithAgents` creates the `Service`.

---

## 5. Phase 1 — Semantic Ledger

### 5.1 Schema (Phase 1)

```graphql
# --- Structural -------------------------------------------------------

type MasterSafe @entity(immutable: false) {
  id: Bytes!                          # Master Safe address
  network: String!
  services: [Service!]! @derivedFrom(field: "masterSafe")
  agentSafes: [AgentSafe!]! @derivedFrom(field: "masterSafe")
  totalOlasRewardsClaimed: BigInt!    # cumulative across all its services
  firstSeenTimestamp: BigInt!
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
  agentIds: [Int!]!                   # deduplicated; from RegisterInstance
  operators: [Bytes!]!                # deduplicated; sub-cohort filtering
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
  STAKING_REWARD_CLAIM                # RewardClaimed → Agent Safe
  UNSTAKE_REWARD                      # (Force)Unstaked reward → Agent Safe
  SERVICE_EVICTED                     # ServicesEvicted (informational)
  # Phase 2 adds: MASTER_FUNDING_IN, MASTER_TO_AGENT, AGENT_TO_MASTER,
  # MASTER_WITHDRAWAL, AGENT_TO_APP, APP_TO_AGENT, OTHER
}

enum FundsSource { SEMANTIC, RAW_TRANSFER }

type FundsMovement @entity(immutable: true) {
  id: Bytes!                          # txHash.concatI32(logIndex)
  service: Service
  masterSafe: MasterSafe
  agentSafe: AgentSafe
  category: FundsCategory!
  source: FundsSource!
  token: Bytes                        # OLAS address (null = pure NFT custody)
  amount: BigInt!
  from: Bytes!
  to: Bytes!
  stakingContract: StakingContract
  epoch: BigInt
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
```

### 5.2 Handlers (Phase 1)

| Handler | Data source / event | Action |
|---|---|---|
| `handleRegisterInstance` | `ServiceRegistryL2.RegisterInstance` | If `agentId` is the Pearl predict ID: record on `Service` (or buffer in `PendingRegistration` if the `Service` isn't created yet). Append `agentId`/`operator`, deduplicated. |
| `handleCreateMultisigWithAgents` | `ServiceRegistryL2.CreateMultisigWithAgents` | If the service is a known Pearl predict service: create `Service` + `AgentSafe`, drain `PendingRegistration`, write `ServiceIndex`. |
| `handleServiceNftTransfer` | `ServiceRegistryL2.Transfer` (ERC-721) | Update `Service.nftCustodian`; emit `ServiceNftCustodyChange`. The owner before first stake / after unstake is the **Master Safe**. |
| `handleTerminateService` | `ServiceRegistryL2.TerminateService` | `Service.state = TERMINATED`. |
| `handleInstanceCreated` | `StakingFactory.InstanceCreated` | Spawn the `StakingProxy` template; snapshot `StakingContract` config (`minStakingDeposit`, `numAgentInstances`, `implementation`) via contract calls — copy `staking/src/staking-factory.ts`. |
| `handleServiceStaked` | `StakingProxy.ServiceStaked` | If Pearl predict service: set `masterSafe = owner` (get-or-create `MasterSafe`), `agentSafe = multisig`, `state = STAKED`, `currentStakingContract`. |
| `handleRewardClaimed` | `StakingProxy.RewardClaimed` | `FundsMovement(STAKING_REWARD_CLAIM, source=SEMANTIC, token=OLAS, amount=reward, to=agentSafe)`; bump cumulative counters on `Service` / `MasterSafe`; update `DailyServiceFunds`. |
| `handleServiceUnstaked` / `handleServiceForceUnstaked` | `StakingProxy.ServiceUnstaked` / `ServiceForceUnstaked` | `FundsMovement(UNSTAKE_REWARD, …)`; `state = UNSTAKED`; clear `currentStakingContract`. |
| `handleServicesEvicted` | `StakingProxy.ServicesEvicted` | `FundsMovement(SERVICE_EVICTED)` per affected Pearl service (informational; eviction does not move funds). |

All `StakingProxy` handlers first check the `serviceId` is a known Pearl
predict `Service` and early-return otherwise — the template fires for every
allowed-implementation proxy on the network, not just Pearl's.

### 5.3 What Phase 1 answers

- The full Master Safe ↔ Agent Safe ↔ Service ↔ staking-contract graph.
- The service-NFT custody trail (stake/unstake).
- Exact OLAS reward amounts claimed and at unstake, per service, per
  Master Safe, daily and cumulative — these are *real* OLAS transfers, and
  the amounts come straight from the events (no token indexing needed).

### 5.4 What Phase 1 does **not** answer (honest limits)

- The **staking deposit is virtual at `ServiceStaked`.** The literal OLAS
  bond moved earlier, at service registration, into
  `ServiceRegistryTokenUtility` (not indexed here). Phase 1 records reward
  *outflows* precisely; it does not assert a deposit transfer on stake.
- Native / USDC / USDC.e funding top-ups and Agent→Master OLAS sweeps —
  Phase 2.
- In-market bet flows — the predict subgraphs; join on Agent Safe address.

---

## 6. Phase 2 — Raw Token Ledger

### 6.1 Phase 2a — OLAS `Transfer` data source

OLAS volume on Gnosis and Polygon is low; a full `Transfer` data source is
cheap. The handler filters to tracked safes via an O(1) `TrackedSafe`
lookup and classifies:

- Agent Safe → Master Safe ⇒ `AGENT_TO_MASTER` (the reward sweep).
- Master Safe → Agent Safe ⇒ `MASTER_TO_AGENT`.
- EOA → Master Safe ⇒ `MASTER_FUNDING_IN`; Master Safe → EOA ⇒
  `MASTER_WITHDRAWAL`.
- staking proxy → Agent Safe — already booked semantically in Phase 1;
  the raw row is reconciled, not double-counted (`source = RAW_TRANSFER`).

### 6.2 Phase 2a — native coin via `Safe` dynamic templates

A `Safe` template is created per Master Safe and per Agent Safe (the
babydegen pattern, `babydegen/src/safe.ts`):

- `SafeReceived` ⇒ native **in** — reliable.
- `ExecutionSuccess` / `ExecutionFromModuleSuccess` ⇒ native **out** —
  **approximate.** A Safe executing via a relayer carries 0 outer-tx
  value; precise native-out needs call/trace handlers. This limit is
  documented, not hidden — it is inherent to Safe event modelling and
  babydegen accepts the same trade-off.

### 6.3 Phase 2b — USDC / USDC.e — benchmark-gated

USDC.e on Polygon is the cost hotspot (§2.2). **Before any commitment**,
run a benchmark:

1. Deploy a throwaway USDC.e `Transfer` subgraph with an early start
   block; measure sync throughput (events/s) and projected full-sync time.
2. If projected sync is acceptable (target: full historical sync in
   days, not weeks) → ship 2b as a normal `Transfer` data source with the
   `TrackedSafe` in-handler filter.
3. If not acceptable → **do not ship 2b on-chain.** Document the
   off-chain alternative the prior plan already endorsed
   ([`pearl/SUBGRAPH_PLAN.md`](../pearl/SUBGRAPH_PLAN.md) §6.1: USDC/MATIC
   flows are "answerable off-chain against a Safe address by a
   general-purpose ERC-20 indexer — Dune, archive RPC"). Revisit if a
   substreams-powered data source becomes viable for Polygon.

This gate is the whole reason Phase 2 is split — 2a ships unconditionally;
2b is a measured decision.

### 6.4 Classification engine

A shared `classifyTransfer(from, to)` helper resolves each raw transfer's
`category` by matching `from`/`to` against `TrackedSafe` (role: MASTER /
AGENT), `StakingContract`, `ServiceRegistryL2`, and a small constant set of
known app contracts (the FPMM / ConditionalTokens / CTFExchange addresses
already enumerated in the predict subgraphs). Unmatched ⇒ `OTHER`.

### 6.5 Schema additions (Phase 2)

```graphql
type Token @entity(immutable: true) {
  id: Bytes!                          # token address
  symbol: String!
  decimals: Int!
}

type TrackedSafe @entity(immutable: false) {
  id: Bytes!                          # Safe address
  role: String!                       # MASTER | AGENT
  service: Service!
}

type TokenBalance @entity(immutable: false) {
  id: Bytes!                          # safe.concat(token)
  safe: Bytes!
  token: Token!
  balance: BigInt!                    # running balance (transfer-derived)
  lastUpdatedTimestamp: BigInt!
  lastUpdatedBlock: BigInt!
}
```

`FundsMovement` is reused — Phase 2 rows carry `source = RAW_TRANSFER` and
the additional `FundsCategory` variants. Consumers get one unified ledger.

### 6.6 What Phase 2 answers

Master Safe funding top-ups and withdrawals; Master ↔ Agent transfers
(incl. the OLAS reward sweep); Agent/Master ↔ app-contract flows; per-safe
running token balances. With 2b: the same for USDC/USDC.e (stablecoin
prediction funding). Combined with the predict subgraphs (bet P&L) this
gives end-to-end "follow the money" for a Pearl predict service.

---

## 7. Asset / File Inventory

Everything implementation will create or touch. **This PR adds only this
plan document** — the table is the build contract for the follow-up PRs.

### 7.1 New — `subgraphs/pearl-funds/`

| File | Phase | Notes |
|---|---|---|
| `package.json` | 1 | Exact pins: `@graphprotocol/graph-cli` 0.98.1, `@graphprotocol/graph-ts` 0.38.2, `matchstick-as` 0.6.0. `generate-manifests` script. |
| `tsconfig.json` | 1 | Copy from `staking`. |
| `schema.graphql` | 1 / 2 | §5.1 + §6.5. |
| `subgraph.template.yaml` | 1 / 2 | Data sources per §4.3. |
| `networks.json` | 1 / 2 | Gnosis + Polygon addresses / start blocks. |
| `src/constants.ts` | 1 | Per-network agent IDs (25 / 86), OLAS addresses, allowed staking implementations (`isAllowedImplementation`). |
| `src/utils.ts` | 1 | `getOrCreateService` / `MasterSafe` / `AgentSafe`, `ServiceIndex` + `PendingRegistration` drain, daily-snapshot helper. |
| `src/service-registry.ts` | 1 | Registry handlers (§5.2). |
| `src/staking-factory.ts` | 1 | `handleInstanceCreated`. |
| `src/staking-proxy.ts` | 1 | Stake / claim / unstake / evict handlers. |
| `src/erc20.ts` | 2 | OLAS + (2b) USDC/USDC.e `Transfer` handler; `classifyTransfer`. |
| `src/safe.ts` | 2 | Native-coin handlers. |
| `tests/*.test.ts` + helpers | 1 / 2 | Matchstick — §10. |
| `CLAUDE.md` | 1 | Subgraph context, per repo convention. |
| `README.md` | 1 | Consumer-facing entity/query reference. |

### 7.2 Shared ABIs — `abis/` (reuse; verify)

| ABI | Status |
|---|---|
| `ServiceRegistryL2.json` | Exists. **Verify it includes the ERC-721 `Transfer` event**; add an ERC-721 fragment if absent. |
| `StakingFactory.json`, `StakingProxy.json` / `StakingToken.json` | Exist (used by `staking`). Reuse. |
| `ERC20.json` (or `ERC20Detailed.json`) | Exists (predict). Reuse for Phase 2. |
| `GnosisSafe.json` / `Safe.json` | Exist (`service-registry` / `babydegen`). Reuse for Phase 2. |

### 7.3 Repo-level changes (land **with the code PRs**, not this plan PR)

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Add a `pearl-funds` entry to the `test` matrix (`generate: true`, `manifest: subgraph.gnosis.yaml`); add `subgraphs/pearl-funds` to the `lockfile-lint` matrix. |
| `CLAUDE.md` (root) | Add `pearl-funds/` to the subgraph tree + Multi-Network Patterns. |
| `.supply-chain/` | If new dependencies appear, refresh `install-hooks.allowlist` per repo policy. (No new deps expected — toolchain is identical to `staking`.) |
| `scripts/generate-manifests.js` | No change — already generic. |

---

## 8. Implementation Sequence

1. **This PR** — land this plan for verification. No code.
2. **Scaffold** — `subgraphs/pearl-funds/` skeleton (package.json, tsconfig,
   empty schema/template/networks.json), `ci.yml` matrix entry. CI green
   on an empty-but-valid subgraph.
3. **Phase 1a — registry** — `ServiceRegistryL2` handlers; `Service` /
   `MasterSafe` / `AgentSafe` / NFT custody; `ServiceIndex` /
   `PendingRegistration`. Tests.
4. **Phase 1b — staking** — `StakingFactory` + `StakingProxy` handlers;
   `FundsMovement` (semantic); `DailyServiceFunds`. Tests.
5. **Verify Phase 1** — deploy to Studio (Gnosis + Polygon); spot-check a
   known Pearl service's stake/claim/unstake against a block explorer.
6. **Phase 2a** — OLAS `Transfer` data source + `Safe` templates;
   `classifyTransfer`; `TrackedSafe` / `TokenBalance` / `Token`. Tests.
7. **Phase 2b benchmark** (§6.3) — decision point: ship USDC/USDC.e
   on-chain, or document the off-chain path.
8. **Docs** — finalize `CLAUDE.md` / `README.md`; update root `CLAUDE.md`.

Each of steps 3/4, 6, and 7 is a separate reviewable PR.

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

- **Phase 1** — agent-ID filtering (Pearl ID accepted, others rejected);
  `RegisterInstance`-before-`CreateMultisigWithAgents` ordering;
  Master Safe resolved from both `ServiceStaked.owner` and NFT `Transfer`;
  stake → claim → unstake lifecycle produces the right `FundsMovement`
  rows and cumulative counters; NFT custody trail; eviction is
  informational only; daily-snapshot rollover at UTC midnight.
- **Phase 2** — `classifyTransfer` for each category; double-count
  reconciliation between the semantic claim row and the raw OLAS row;
  native in/out via `Safe` events; `TokenBalance` running total.

CI runs `yarn graph codegen` + `yarn graph test` via the `ci.yml` matrix.

---

## 11. Open Questions

1. **Polygon `ServiceRegistryL2` start block.** Plan uses 80,360,433
   (the `predict-polymarket` block). Confirm no Pearl predict service was
   registered on Polygon before it; if uncertain, drop to the
   `service-registry` Polygon block (41,783,952) — costs more
   `RegisterInstance` decoding but is provably safe.
2. **Phase 2b feasibility** — the USDC.e benchmark (§6.3) is the single
   biggest unknown. Result decides on-chain vs. off-chain stablecoin
   tracking.
3. **`ServiceRegistryL2.json` ABI** — confirm it carries the ERC-721
   `Transfer` event (§7.2).
4. **predict-omen agent-ID filter** — separate from this work, but worth
   noting: `predict-omen` in *this* repo still has no agent-ID filter;
   the `PREDICT_AGENT_ID = 25` fix is stranded in the unmerged
   `valory-xyz/autonolas-subgraph` PR #89. Recommend porting it
   independently.
5. **Subgraph name** — `pearl-funds` proposed. If the team expects to
   later generalize to all Olas services (as happened with
   `predict-polymarket`), a neutral name (`agent-funds` / `funds-movement`)
   may age better.

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
