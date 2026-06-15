# pearl-transactions — Indexing Performance Review

Review of indexing speed against The Graph's best practices (pruning,
`@derivedFrom`, immutable entities + Bytes IDs, eth_calls, timeseries,
grafting), as of v0.0.5 (Gnosis + Polygon deployed on Studio). Applies to
all four networks; Polygon-specific context at the end.

## TL;DR

Sync time is dominated by the chain-wide ERC-20 `Transfer` data sources
(OLAS, wrapped native, and the per-chain stablecoins). Every transfer of
those tokens — Pearl-related or not — invokes `handleErc20Transfer`, which
performs up to **6 store lookups plus 2 address-string parses** before
concluding "not ours", and ~99.99% of them are not ours. The two
highest-leverage fixes:

1. Raise the token data-source start blocks to the first Pearl Safe per
   chain (zero code).
2. Collapse the tracked-address lookup from 6 loads to 2, against
   immutable tables.

## Proposals, ranked by impact

### 1. Raise token data-source start blocks (zero code, biggest sync win)

All token sources currently start at the chain's `ServiceRegistryL2`
block (`networks.json`). That bound is provably safe, but a tighter one is
equally provable: **no transfer can classify before the first
`TrackedSafe`/`TrackedEOA` exists**, and those are only created from
`ServiceRegistryL2`/`StakingProxy` events — never from the token sources
themselves.

- Keep the `ServiceRegistryL2` / `ServiceRegistryTokenUtility` /
  `StakingFactory` start blocks as-is (they are the discovery path).
- Query the deployed subgraphs for `MIN(MasterSafe.firstSeenBlock)` per
  chain and start `OLAS`, `WrappedNative`, and every `erc20Tokens` entry
  there.

This skips every stablecoin/wrapped-native/OLAS transfer between registry
deploy and the first Pearl onboarding on each chain. `networks.json`
change + regenerate + commit only.

**Deployment caveat:** ship via graft onto the synced deployments — but
since the live deployments run `prune: auto`, **you cannot graft at a
pruned height**. Pick a graft block within the retained window (near chain
head is safest), and graft before further pruning advances.

### 2. Collapse `classifyTransfer`'s lookups: one `TrackedAddress` table

`classifyTransfer` (`src/utils.ts`) front-loads six entity loads per
transfer (`TrackedSafe`×2, `TrackedEOA`×2, `StakingContract`×2) plus
`getSrtuAddress()` / `getServiceRegistryAddress()`, which re-parse address
literals via `Address.fromString` on every call.

Merge the three lookup tables into one internal `TrackedAddress` entity
with `role: MASTER | AGENT | MASTER_EOA | AGENT_EOA | STAKING` (staking
proxies get their row written in `handleInstanceCreated`). The hot path
becomes:

1. Two free SRTU address-equality checks (no store access).
2. `TrackedAddress.load(from)` + `TrackedAddress.load(to)` — **2 loads
   instead of 6**.
3. Both null → return null immediately.

Also move the `getServiceRegistryAddress()` call into the only branch
that uses it (the registry-dust check in the `toMaster.role == "MASTER"`
branch) instead of computing it unconditionally at the top.

These are internal helper entities — no consumer-API impact.

### 3. Mark write-once entities `immutable: true`

graph-node skips block-range versioning for immutable entities — cheaper
writes *and* cheaper reads, and the reads here are the millions of
`classifyTransfer` lookups. Never mutated after creation but declared
mutable today:

- `TrackedSafe` / `TrackedEOA` (or the merged `TrackedAddress`) — upserts
  early-return on existing rows; nothing updates them.
- `StakingContract` — its own schema comment says "nothing updates
  afterward".
- `Token` — explicitly first-write-wins.

`FundsMovement`, `MasterSafe`, `Service`, `AgentFundingEvent`,
`ServiceIndex`, `DailyServiceFunds` genuinely mutate — correctly left
mutable.

**Why this can't graft:** grafting only permits *adding* entities/fields —
flipping the `immutable` flag on an existing type counts as changing its
schema, so proposals #2/#3/#4 all force a clean sync. That's the argument
for landing them together in one release.

### 4. Split the mutable bond rows out of `FundsMovement` (bigger lift, consumer-facing)

`FundsMovement` — the highest-cardinality public entity — is mutable
solely so the SRTU producer/consumer queue can backfill `serviceId` /
`bondType` / `agentSafe` onto a few bond rows per service lifecycle. Every
RAW_TRANSFER row pays the versioning tax for that. Moving
`SERVICE_BOND_DEPOSIT` / `SERVICE_BOND_REFUND` into a small mutable
`BondMovement` entity lets `FundsMovement` go immutable — the combined
immutable + Bytes-ID practice is what the Graph docs benchmark at ~48%
indexing / ~28% query improvement, and this entity is where the volume is.

Trade-off: the wallet must union two entities. Propose to the consumer
team rather than do unilaterally.

**Bytes-ID gap, same conversation:** `FundsMovement.id` is already Bytes,
but `Service.id` is the *string* `serviceId.toString()` and
`DailyServiceFunds.id` is the string `"serviceId-dayTimestamp"` — so every
`FundsMovement.service` FK stores and compares UTF-8 strings. Converting
`Service.id` to Bytes (`Bytes.fromBigInt(serviceId)`, as `ServiceIndex`
already does) halves FK storage and speeds comparisons. Consumer-facing,
so bundle it with the same breaking release if the wallet team agrees;
not worth a release alone.

### 5. Smaller items

- **specVersion 1.0.0 / apiVersion 0.0.7 → 1.3.0 / 0.0.9**
  (`subgraph.template.yaml`): worth doing alongside the schema release,
  but **do not adopt declared eth_calls here** — declared calls execute
  before *every* handler invocation, while `getOwners()` /
  `getThreshold()` currently fire only once per first sighting behind
  `MasterSafe.load()` + `isStakingContract` guards. Declaring them would
  turn one-shot calls into per-event RPC. The bump's value is staying on
  the maintained runtime and unlocking timeseries support (1.1.0+) should
  it ever be wanted.
- Redundant double-saves, all low-volume — fix opportunistically, not for
  speed:
  - `getOrCreatePendingBondCounter` saves on create, then again in
    `enqueuePendingBondRow`.
  - `handleCreateMultisigWithAgents` and `handleServiceStaked` each save
    `Service` twice.
  - `getOrCreateMasterSafe` does a load+save on every re-sighting just to
    bump `lastActivityTimestamp`.

## Checked and fine — no action

- **Pruning:** `prune: auto` already set, and it's *safe* here — the
  wallet's opening-balance flow (Path A) reads archive **RPC** at
  `historyFloorBlock`, not subgraph time-travel queries, so no history
  retention is needed. Only constraint is the graft-block caveat in #1.
- **Arrays / `@derivedFrom`:** compliant. The unbounded relations
  (`MasterSafe.services` / `agentSafes`, `AgentFundingEvent.transfers`)
  already use `@derivedFrom`; the stored arrays (`MasterSafe.owners`,
  `Service.agentIds` / `operators`) are small and bounded by Pearl's flow.
- **eth_calls:** already well-behaved — `getOwners()` / `getThreshold()`
  fire once per first sighting and are guarded by `isStakingContract` on
  the NFT path.
- **Timeseries/aggregations — considered and rejected:**
  `DailyServiceFunds` looks like a candidate, but (a)
  `cumulativeOlasRewardsClaimed` is a running total, which `@aggregate`
  interval functions (sum/count/min/max/first/last/avg) cannot express,
  and (b) reward-claim volume is tiny — the hand-rolled rollup costs one
  load+save per claim, nowhere near the hot path. Converting would add a
  breaking schema change for no measurable win.

## Why Polygon syncs slowest (context, not a defect)

The sync cost of a subgraph is roughly *(blocks in range containing a
matching log) × (per-trigger work)*, and on Polygon this subgraph
maximizes the first factor:

- Polygon produces a ~2s block (~40k blocks/day) with very high
  transaction density, and the subgraph watches `Transfer` on USDC and
  USDC.e — among the highest-volume token contracts in all of crypto.
  Effectively **every block** contains a matching transfer, so graph-node
  can never bulk-skip empty ranges; it processes every block individually
  and runs the WASM handler millions of times to discard ~99.99% of
  events.
- At that trigger density, indexing becomes **RPC-bound**: `eth_getLogs`
  over USDC-class contracts returns enormous result sets (providers cap
  ranges in response, forcing tiny batches), and nearly every block needs
  a full block fetch. It is not that "The Graph is slow on Polygon" or
  that Polygon RPC is inherently bad — quiet subgraphs (staking,
  tokenomics-l2) sync fine on the same chain. It's the trigger profile.
- Self-hosted graph-node over plain JSON-RPC is several-fold slower than
  Studio's upgrade indexer on a chain like this, because serious indexers
  ingest Polygon from Firehose (pre-extracted flat block files), not RPC
  polling. If self-hosting matters, the levers in order of impact: a
  Firehose-backed Polygon source; high-tier archive RPC (watch graph-node
  logs for `eth_getLogs` retries/range reductions); graph-node tuning
  (`GRAPH_ETHEREUM_MAX_BLOCK_RANGE_SIZE`,
  `GRAPH_ETHEREUM_TARGET_TRIGGERS_PER_BLOCK_RANGE`, store write
  batching); Postgres capacity.

Proposals #1 and #2 above attack exactly this: #1 removes the worst
stretch of the Polygon scan range outright, and #2 cuts per-trigger work
~3×.

## Suggested sequencing

1. **Now, no schema change:** #1 — query the live subgraphs for the
   per-chain first-Safe blocks, update `networks.json`, regenerate, and
   redeploy grafted at an unpruned (recent) block.
2. **One clean-sync release:** #2 + #3 + spec bump, plus #4 and the
   `Service` Bytes-ID change if the wallet team signs off — validated on
   the personal Studio account first, as with v0.0.5.
