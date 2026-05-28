# Pearl Transactions — Substreams Implementation Plan

**Status:** Planning  
**Supersedes:** Event-based phase PRs (#131 phase-1a, #132 phase-1b, #133 phase-2a)  
**Depends on:** PR #130 scaffold (merged), PR #129 plan doc (reference)  
**Context:** [VLOP-73](https://linear.app/valory-xyz/issue/VLOP-73) — Transaction History in Pearl Wallet

---

## 1. Why Substreams

The event-based design (phase PRs #131–#133) covers ~95% of VLOP-73 but has two structural gaps that cannot be closed with standard subgraph techniques:

| Gap | Root cause | Event-based verdict |
|---|---|---|
| Native → Agent EOA (the 2 xDAI gas leg) | No log emitted on EOA receipt of native coin | ❌ permanently untrackable |
| Native out from Master Safe (withdrawals) | `ExecutionSuccess` carries no recipient/amount | 🟠 approximate only |
| "Setup complete" = actual transfer row (AC #3) | Safe template is not retroactive | ❌ only balance snapshot possible |

Substreams processes raw Firehose blocks — including the full **execution trace** — giving it access to every internal call with its `from`, `to`, `value`, and `call_type`. This closes all three gaps, making VLOP-73 fully satisfiable from the subgraph alone.

---

## 2. Architecture Overview

```
Firehose (raw blocks — logs + full execution traces)
        │
        ▼
┌───────────────────────────────────────┐
│  Rust Substreams module (.spkg)       │  ← new
│                                       │
│  map_block_events   ─→ typed events   │
│  map_block_traces   ─→ native calls   │
│  store_pearl_addrs  ─→ known Safes/   │
│                        EOAs registry  │
│  store_raw_transfers─→ pre-discovery  │
│                        transfer cache │
│  map_pearl_events   ─→ PearlBlock     │  ← protobuf output
│                        (protobuf)     │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  AssemblyScript subgraph              │  ← largely preserved
│                                       │
│  handlePearlBlock()                   │
│  └─ same entity logic as phase PRs    │
│     schema.graphql unchanged          │
└───────────────────────────────────────┘
        │
        ▼
   GraphQL API (same as current design)
```

The subgraph manifest changes from `kind: ethereum` (event-based) to `kind: substreams`. Everything below that — schema, entities, classification logic, test scenarios — is largely preserved.

---

## 3. What Substreams Unlocks vs. Current Design

| Data | Event-based (phase PRs) | Substreams |
|---|---|---|
| Registry events (RegisterInstance, ActivateRegistration, etc.) | ✅ | ✅ |
| SRTU bond events (TokenDeposit / TokenRefund) | ✅ | ✅ |
| Staking events (ServiceStaked, RewardClaimed, etc.) | ✅ | ✅ |
| OLAS / WrappedNative ERC-20 transfers | ✅ | ✅ |
| Native → Master/Agent Safe (inbound) | ✅ via SafeReceived | ✅ via trace |
| Native out from Safe (exact amount) | 🟠 approximate (ExecutionSuccess) | ✅ exact via trace |
| **Native → Agent EOA (gas leg)** | ❌ | ✅ trace `call_type=call, value>0` |
| **Pre-discovery MasterEOA→Safe transfers** | 🟠 balance snapshot only | ✅ retroactive trace store |
| **"Setup complete" = actual transfer row** | ❌ | ✅ |

---

## 4. Repository Layout (new files only)

```
subgraphs/pearl-transactions/
  substreams/                         ← new
    proto/
      pearl.proto                     ← protobuf schema for Rust→AS messages
    src/
      lib.rs                          ← Substreams module entrypoint
      modules/
        events.rs                     ← extract typed events from block logs
        traces.rs                     ← extract native value transfers from traces
        store.rs                      ← store helpers (pearl address registry, transfer cache)
        classify.rs                   ← classification logic (mirrors AS classifyTransfer)
      pb/                             ← generated from pearl.proto (gitignored build artefact)
    Cargo.toml
    substreams.yaml                   ← Substreams manifest (modules + chain endpoints)
    build.sh                          ← thin wrapper: buf generate + cargo build + pack .spkg
  subgraph.template.yaml             ← changes: kind: substreams, references .spkg
  subgraph.{gnosis,matic,optimism,base}.yaml  ← re-generated
  src/
    mappings.ts                       ← new entrypoint: handlePearlBlock(proto) → entities
    utils.ts                          ← preserved (entity helpers, getOrCreate*)
    constants.ts                      ← preserved
  schema.graphql                      ← unchanged
  networks.json                       ← unchanged
```

---

## 5. Protobuf Schema (`pearl.proto`)

The Rust module emits one `PearlBlock` per block. The AssemblyScript handler receives it decoded.

```protobuf
syntax = "proto3";
package pearl.v1;

// Top-level message emitted once per block.
message PearlBlock {
  uint64 block_number    = 1;
  uint64 timestamp       = 2;
  string network         = 3;

  repeated ServiceRegistryEvent  registry_events   = 4;
  repeated SrtuEvent             srtu_events        = 5;
  repeated StakingFactoryEvent   factory_events     = 6;
  repeated StakingProxyEvent     staking_events     = 7;
  repeated TokenTransfer         token_transfers    = 8;  // ERC-20 (OLAS, WrappedNative)
  repeated NativeTransfer        native_transfers   = 9;  // from execution traces
  repeated RetroactiveTransfer   retroactive        = 10; // pre-discovery transfers reclassified
}

// ── Registry ─────────────────────────────────────────────────────────────────

enum RegistryEventType {
  REGISTER_INSTANCE           = 0;
  ACTIVATE_REGISTRATION       = 1;
  CREATE_MULTISIG_WITH_AGENTS = 2;
  SERVICE_NFT_TRANSFER        = 3;
  TERMINATE_SERVICE           = 4;
  OPERATOR_UNBOND             = 5;
}

message ServiceRegistryEvent {
  RegistryEventType type       = 1;
  string            tx_hash    = 2;
  uint32            log_index  = 3;
  uint64            service_id = 4;
  string            operator   = 5;  // RegisterInstance
  string            agent_instance = 6;
  uint64            agent_id   = 7;
  string            multisig   = 8;  // CreateMultisigWithAgents
  string            nft_from   = 9;  // Transfer (ERC-721)
  string            nft_to     = 10;
}

// ── SRTU ─────────────────────────────────────────────────────────────────────

enum SrtuEventType {
  TOKEN_DEPOSIT = 0;
  TOKEN_REFUND  = 1;
}

message SrtuEvent {
  SrtuEventType type      = 1;
  string        tx_hash   = 2;
  uint32        log_index = 3;
  string        operator  = 4;
  string        token     = 5;
  string        amount    = 6;  // BigInt as string
}

// ── Staking Factory ───────────────────────────────────────────────────────────

message StakingFactoryEvent {
  string tx_hash        = 1;
  uint32 log_index      = 2;
  string proxy_address  = 3;
  string implementation = 4;
  string deployer       = 5;
}

// ── Staking Proxy ─────────────────────────────────────────────────────────────

enum StakingEventType {
  SERVICE_STAKED        = 0;
  REWARD_CLAIMED        = 1;
  SERVICE_UNSTAKED      = 2;
  SERVICE_FORCE_UNSTAKED = 3;
  SERVICES_EVICTED      = 4;
}

message StakingProxyEvent {
  StakingEventType type            = 1;
  string           tx_hash         = 2;
  uint32           log_index       = 3;
  string           proxy_address   = 4;
  uint64           epoch           = 5;
  uint64           service_id      = 6;
  string           multisig        = 7;
  string           owner           = 8;
  string           reward          = 9;  // BigInt as string
  string           nonce           = 10;
}

// ── Token transfers (ERC-20) ──────────────────────────────────────────────────

message TokenTransfer {
  string tx_hash   = 1;
  uint32 log_index = 2;
  string token     = 3;  // contract address
  string from      = 4;
  string to        = 5;
  string amount    = 6;  // BigInt as string
}

// ── Native transfers (from execution traces) ──────────────────────────────────

message NativeTransfer {
  string tx_hash     = 1;
  uint32 call_index  = 2;  // position in trace array (stable ID within tx)
  string from        = 3;
  string to          = 4;
  string value       = 5;  // BigInt as string (wei)
  string call_type   = 6;  // "call" | "delegatecall" etc.
}

// ── Retroactive transfers (pre-discovery, emitted when Safe is first seen) ───

message RetroactiveTransfer {
  string tx_hash      = 1;
  uint64 block_number = 2;
  uint64 timestamp    = 3;
  string from         = 4;
  string to           = 5;  // the newly-discovered Safe address
  string token        = 6;  // empty string = native
  string amount       = 7;
  string safe_address = 8;  // the Master Safe being retroactively classified
}
```

---

## 6. Rust Module Design

### 6.1 `map_block_events` — log extraction

Reads `block.logs` and emits typed event messages for each known contract address (ServiceRegistryL2, SRTU, StakingFactory, per-chain). Also emits `TokenTransfer` for OLAS/WrappedNative `Transfer(from, to, amount)` logs where `from` OR `to` is in the Pearl address store.

Input: `sf.ethereum.type.v2.Block`  
Output: intermediate `BlockEvents` proto (internal)

### 6.2 `map_block_traces` — trace extraction

Reads `block.transaction_traces[*].calls` and emits `NativeTransfer` for every call where:
- `call_type = CALL` (not DELEGATECALL/STATICCALL)
- `value > 0`
- `to` is in the Pearl address store OR `from` is in the Pearl address store

This is the core new capability. Native → Agent EOA is captured here regardless of destination type.

Input: `sf.ethereum.type.v2.Block`  
Output: intermediate `BlockTraces` proto (internal)

### 6.3 `store_pearl_addresses` — address registry

Accumulates every Pearl-relevant address as it is discovered:
- Master Safe: from `ServiceNftTransfer.to` (NFT mint recipient)
- Agent Safe: from `CreateMultisigWithAgents.multisig`
- Master EOA: from `GnosisSafe.getOwners()[0]` eth_call (called once per new Master Safe)
- Agent EOA: from `RegisterInstance.agentInstance`
- Staking proxies: from `StakingFactory.InstanceCreated`

Used as the filter for `map_block_traces` and `map_block_events`. Updates every block as new addresses are discovered. The filter is applied as an O(1) store get.

Input: `BlockEvents`  
Store operation: `set(address, role)` — append-only

### 6.4 `store_raw_transfers` — pre-discovery transfer cache

Accumulates ALL native value transfers (from traces) and ALL ERC-20 Transfer events (from logs) from `startBlock` onward, keyed by **recipient address**.

When `store_pearl_addresses` gains a new Master Safe address at block N, `map_pearl_events` queries `store_raw_transfers.get(masterSafeAddress)` and emits `RetroactiveTransfer` messages for everything in the cache. This is the mechanism that recovers the "Setup complete" MasterEOA→MasterSafe transfer and satisfies VLOP-73 AC #3 with an actual transfer row, not a balance snapshot.

Input: `BlockTraces` + `BlockEvents`  
Store operation: `append(to_address, serialized_transfer)`

> **Design note:** This store grows with all native transfers from startBlock. Gnosis has low native-transfer volume relative to Ethereum mainnet; the store size is acceptable. Polygon is higher — evaluate after initial sync. If the store becomes a performance concern, scope it to transfers where `from` is a GnosisSafe-deployed contract (detectable via `hasCode(from) == true`), which covers the Pearl flow without storing every EOA→EOA native transfer.

### 6.5 `map_pearl_events` — final output

Combines all upstream modules and emits one `PearlBlock` per block:
1. Pass through all typed registry/staking/token events from `BlockEvents`
2. Filter `NativeTransfer`s from `BlockTraces` against `store_pearl_addresses`
3. For newly discovered Safes, query `store_raw_transfers` and emit `RetroactiveTransfer`s
4. Classify each transfer using `classify.rs` (port of `classifyTransfer` from `utils.ts`)

Input: `BlockEvents`, `BlockTraces`, `store_pearl_addresses` (get), `store_raw_transfers` (get)  
Output: `PearlBlock` — consumed by the AssemblyScript subgraph

---

## 7. AssemblyScript Subgraph Changes

### 7.1 What is preserved

- `schema.graphql` — **unchanged**. All entities, enums, and fields stay identical.
- `networks.json` — unchanged. Same contract addresses and start blocks.
- `utils.ts` — entity helpers (`getOrCreateMasterSafe`, `getOrCreateService`, etc.) preserved with minor adaptation (handlers receive pre-decoded fields from protobuf rather than raw `event.params`).
- `constants.ts` — preserved.
- All test scenarios — rewritten for the protobuf trigger format but the same business logic assertions.

### 7.2 What changes

| File | Change |
|---|---|
| `subgraph.template.yaml` | `kind: substreams`, references `.spkg` package, single trigger `handlePearlBlock` |
| `src/service-registry.ts` | Logic moves into `mappings.ts`; functions become helpers called from handler |
| `src/service-registry-token-utility.ts` | Same |
| `src/staking-factory.ts` | Same |
| `src/staking-proxy.ts` | Same |
| `src/erc20.ts` | Same |
| `src/safe.ts` | Removed — native transfers now arrive pre-decoded as `NativeTransfer` in the protobuf |
| `src/mappings.ts` | New entrypoint. Single `handlePearlBlock(block: PearlBlock)` dispatches to sub-handlers |

### 7.3 New manifest shape

```yaml
specVersion: 1.0.0
schema:
  file: ./schema.graphql
dataSources:
  - kind: substreams
    name: PearlTransactions
    network: {{ network }}
    source:
      package:
        moduleName: map_pearl_events
        file: ./substreams/pearl-transactions.spkg
    mapping:
      apiVersion: 0.0.9          # bumped for ethereum.getBalance support
      language: wasm/assemblyscript
      file: ./src/mappings.ts
      handler: handlePearlBlock
      entities:
        - MasterSafe
        - AgentSafe
        - Service
        - StakingContract
        - FundsMovement
        - DailyServiceFunds
        - ServiceNftCustodyChange
        - Token
        - TokenBalance
        - TrackedSafe
        - TrackedEOA
        - AgentFundingEvent
        - ServiceIndex
        - PendingRegistration
        - PendingBondCounter
        - PendingBondAttribution
        - AgentBondStashGuard
```

No `templates` block — dynamic contract observation (Safe, StakingProxy) is now handled by the Rust module's `store_pearl_addresses` rather than the subgraph template mechanism.

---

## 8. Classification Logic — What Moves to Rust, What Stays in AS

| Logic | Location | Rationale |
|---|---|---|
| Address filtering (is this a Pearl address?) | Rust (`store_pearl_addresses`) | Must run before emitting — filters what gets included in `PearlBlock` |
| Native transfer extraction (is this a value-bearing call?) | Rust (`map_block_traces`) | Trace data only available in Rust |
| Transfer classification (`classifyTransfer`) | Rust (`classify.rs`) | Simpler to classify in Rust where all data is co-located; emit category in protobuf |
| Entity creation / graph store writes | AssemblyScript (`mappings.ts`) | Must stay in AS — only AS can write to The Graph's store |
| Bond attribution (PendingBondCounter/Attribution queue) | AssemblyScript | Stateful cross-event correlation, simpler to keep in AS |
| Daily rollup (DailyServiceFunds) | AssemblyScript | Same |

---

## 9. Retroactive "Setup Complete" — Detailed Flow

This is the most architecturally novel part. The sequence:

```
Block N-5: MasterEOA → MasterSafe (10 OLAS native call, value=10e18)
           ↓ store_raw_transfers.append(masterSafe, {from:masterEOA, value:10e18, ...})

Block N:   ServiceRegistryL2.Transfer(from=0x0, to=masterSafe, serviceId=42)  ← NFT mint
           ↓ store_pearl_addresses.set(masterSafe, "MASTER")
           ↓ map_pearl_events sees new Safe → queries store_raw_transfers.get(masterSafe)
           ↓ emits RetroactiveTransfer{block=N-5, from=masterEOA, to=masterSafe, value=10e18}
           ↓ emits PearlBlock with that RetroactiveTransfer included
           ↓ AS handler creates FundsMovement{category: SAFE_SETUP_TRANSFER, blockNumber: N-5}
```

Result: the wallet UI receives a real transfer row at block N-5, not a balance snapshot at block N. VLOP-73 AC #3 ("first history entry is the Setup complete event") is satisfied with an actual MasterEOA → MasterSafe movement row.

---

## 10. Chains and Endpoints

All four chains have Firehose/Substreams support. Substreams manifest endpoints:

| Network | `substreams.yaml` network key | Firehose endpoint |
|---|---|---|
| Gnosis | `gnosis` | `gnosis.substreams.pinax.network:443` |
| Polygon | `polygon` | `polygon.substreams.pinax.network:443` |
| Optimism | `optimism` | `optimism.substreams.pinax.network:443` |
| Base | `base` | `base.substreams.pinax.network:443` |

Traces must be enabled in the Firehose stream request. In `substreams.yaml`:

```yaml
network: gnosis
initialBlock: 27871084   # ServiceRegistryL2 startBlock — same as networks.json
```

The Rust module requests trace data by declaring call-level inputs in the module definition.

---

## 11. Phasing

### Phase 1 — Rust module scaffold + proto (1–2 weeks)

- [ ] Set up `substreams/` directory: `Cargo.toml`, `substreams.yaml`, `pearl.proto`
- [ ] `buf generate` pipeline + CI integration
- [ ] `map_block_events`: parse all registry/SRTU/staking/ERC-20 log events → emit typed proto. No trace work yet.
- [ ] `store_pearl_addresses`: build address registry from registry events
- [ ] Deploy to Substreams dev endpoint, validate against known Gnosis transactions
- [ ] Matchstick equivalent: Substreams testing with `substreams run -e gnosis.substreams...`

### Phase 2 — Trace integration (1 week)

- [ ] `map_block_traces`: extract native transfers from `transaction_traces[*].calls`
- [ ] Filter to Pearl addresses via `store_pearl_addresses`
- [ ] `classify.rs`: port `classifyTransfer` from `utils.ts`
- [ ] Validate: known Agent EOA gas-funding tx on Gnosis shows up in output

### Phase 3 — Retroactive store + Setup Complete (1 week)

- [ ] `store_raw_transfers`: accumulate all native/ERC-20 transfers keyed by recipient
- [ ] `map_pearl_events`: on new Safe discovery, emit `RetroactiveTransfer` rows from store
- [ ] Validate: known MasterEOA → MasterSafe setup tx appears as `RetroactiveTransfer` in output

### Phase 4 — AS subgraph integration (1 week)

- [ ] `mappings.ts`: single `handlePearlBlock` handler, dispatch to sub-handlers
- [ ] Adapt `utils.ts` entity helpers for protobuf input
- [ ] Update `subgraph.template.yaml` to `kind: substreams`
- [ ] `yarn codegen` + `yarn build` green on all four networks
- [ ] Port existing test scenarios to new trigger format

### Phase 5 — Deployment + validation (1 week)

- [ ] Pack `.spkg`: `graph build --substreams` or `substreams pack`
- [ ] Deploy to Graph Studio (Gnosis first)
- [ ] Spot-check against known Pearl service: verify Setup Complete row, Agent EOA gas leg, native withdrawal amounts
- [ ] Deploy remaining three chains
- [ ] Update `CLAUDE.md` and this doc

---

## 12. Open Questions

1. **`store_raw_transfers` size on Polygon.** Polygon has higher native-transfer volume than Gnosis. After the initial Gnosis sync, measure store size and determine whether the optimization (filter to `hasCode(from)=true` before caching) is needed for Polygon.

2. **Trace request in Firehose.** Confirm with StreamingFast/Pinax that trace data (`transaction_traces[*].calls`) is included by default or requires a flag in the Substreams module definition for each chain.

3. **Bond attribution queue in AS.** The `PendingBondCounter` / `PendingBondAttribution` / `AgentBondStashGuard` pattern relies on cross-event ordering within a tx. Confirm this ordering is preserved in the `PearlBlock` protobuf (events should be ordered by log index within each tx).

4. **USDC.e (Phase 2b).** Phase 2b (Polygon USDC.e / pUSD) is benchmark-gated. Adding it in Substreams is a one-line addition to the ERC-20 address list in `map_block_events` — no re-architecture, just a re-pack + re-deploy. Unlike event-based subgraphs, the cost impact is measured in streaming TB (not a new data source multiplier), so the benchmark question shifts from "can we afford the Transfer volume" to "what does the additional Polygon data add to the monthly TB cost."

5. **Multi-network `.spkg`.** Determine whether to build one `.spkg` per network (simpler, separate `substreams.yaml` per chain) or a single parameterised package (cleaner long-term). Given the template-pattern already in place via `networks.json`, one package per network mirrors the existing approach.

---

## 13. What This Plan Does NOT Change

- `schema.graphql` — identical to phase-2a PR
- `networks.json` — identical
- All business logic (classification rules, entity relationships, bond attribution) — ported, not redesigned
- VLOP-73 scope — fully satisfied; no product decisions required beyond what was already resolved in the event-based plan
- Supply-chain posture — Substreams SDK is a Rust crate (`substreams` on crates.io), separate from the npm tree; no new npm surface
