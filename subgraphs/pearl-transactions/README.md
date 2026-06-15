# pearl-transactions

Indexes **funds movement for Pearl Master Safe and Agent Safe accounts** on
Gnosis, Polygon, Optimism, Base. The on-chain backend for the Pearl wallet
transaction-history view (VLOP-73).

> **Status — implemented (phases 1a/1b/2a/2b), deployed.** Gnosis + Polygon
> are live on Studio (`pearl-gnosis-transactions`, `pearl-polygon-transactions`,
> v0.0.5). Optimism/Base manifests build but aren't deployed on the company
> account yet. See
> [`CLAUDE.md`](./CLAUDE.md) for architecture and
> [`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) for the design.

## What it covers

An immutable `FundsMovement` ledger, classified per row, plus a small mutable
`BondMovement` ledger for SRTU bond deposits/refunds (the only rows that get
backfilled — split out so `FundsMovement` can stay immutable). **A complete
wallet ledger is `fundsMovements` ∪ `bondMovements`.** Entity graph:
`MasterSafe` / `AgentSafe` / `Service` / `StakingContract`; helpers:
`AgentFundingEvent`, `TokenBalance`, `DailyServiceFunds`,
`ServiceNftCustodyChange`.

Category values (`FundsCategory`, shared by both ledgers — the
`SERVICE_BOND_*` values appear only on `BondMovement`):

| Category | Meaning |
|---|---|
| `SAFE_DEPLOYED` | First sighting of a Master Safe — history anchor (amount 0) |
| `SAFE_SETUP_TRANSFER` | First live Master EOA → Master Safe inbound hop |
| `MASTER_FUNDING_IN` | Later EOA → Master Safe top-ups |
| `MASTER_WITHDRAWAL` | Master Safe → external EOA (tokens; native-out not indexed) |
| `MASTER_TO_AGENT` | Master Safe → Agent Safe/EOA (grouped via `AgentFundingEvent`) |
| `AGENT_TO_MASTER` | Agent Safe → Master Safe in native / non-OLAS token |
| `AGENT_OLAS_TO_MASTER` | Agent Safe → Master Safe in OLAS (reward sweeps + manual returns; split out so the wallet can exclude it at query time) |
| `SERVICE_BOND_DEPOSIT` / `SERVICE_BOND_REFUND` | SRTU bond posted / refunded (with `bondType`) — **`BondMovement` rows, not `FundsMovement`** |
| `STAKING_REWARD_CLAIM` / `UNSTAKE_REWARD` / `SERVICE_EVICTED` | Staking events |
| `AGENT_TO_APP` / `APP_TO_AGENT` / `OTHER` | App-contract flows / untyped |

`source` is `SEMANTIC` (derived from a typed event) or `RAW_TRANSFER` (raw
ERC-20/native). `token` is null for native coin. `amount` is the on-chain
integer (divide by `Token.decimals` — **stablecoins are 6, OLAS/native 18**).

## Query endpoints

Studio: `https://api.studio.thegraph.com/query/1716136/pearl-<network>-transactions/<version>`
(`<network>` = `gnosis` | `polygon`; current `<version>` = `v0.0.5`).

### Wallet history for a Master Safe

A complete history is the union of the two ledgers — `bondType` lives only on
`bondMovements`, and `Service.id` is Bytes, so read the numeric `serviceId`:

```graphql
query History($safe: Bytes!) {
  fundsMovements(
    where: { masterSafe: $safe }
    orderBy: blockTimestamp
    orderDirection: desc
    first: 100
  ) {
    category
    source
    amount
    token            # null = native coin
    from
    to
    service { serviceId }
    agentSafe { id }
    blockTimestamp
    transactionHash
  }
  bondMovements(
    where: { masterSafe: $safe }
    orderBy: blockTimestamp
    orderDirection: desc
    first: 100
  ) {
    category         # SERVICE_BOND_DEPOSIT | SERVICE_BOND_REFUND
    bondType         # SECURITY_DEPOSIT | AGENT_BOND (null if unattributed)
    amount
    token
    from
    to
    service { serviceId }
    agentSafe { id }
    blockTimestamp
    transactionHash
  }
}
```
Variables: `{ "safe": "0x<master-safe-address-lowercase>" }`. The frontend
renders a "History starts here" divider at `MasterSafe.historyFloorBlock`
and fetches opening balances via archive RPC at that block (the subgraph
emits no opening-balance row).

### Token metadata / decimals

```graphql
{ tokens(first: 50) { id symbol decimals } }
```

### Sync health

```graphql
{ _meta { block { number timestamp } hasIndexingErrors } }
```

## What it does **not** cover

- **Native coin leaving a Safe** (withdrawals to external wallets, the native
  agent gas-funding leg) — emits no usable event; accepted v1 gap. Native
  *inflows* and all *token* flows are covered.
- **Arbitrary tokens** — only the wallet's token set is indexed (OLAS,
  wrapped-native, USDC/USDC.e/pUSD per chain).
- In-market bet flows (Polymarket/Omen) — `predict-polymarket` / `predict-omen`;
  join on Agent Safe address.
- USD valuation — raw token amounts only.
- Pre-Master-Safe Master EOA history — frontend reads opening balances via
  archive RPC at `historyFloorBlock` (AC #3 / Path A).
- Any off-chain join keys (mode / tool / tier / requestId / time-window) —
  plan §12 ("Deliberately Absent").

## Development

```bash
yarn install
yarn generate-manifests   # render per-network manifests
yarn codegen
yarn test                 # 53 Matchstick tests
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture and
[`STEP5-VERIFICATION.md`](./STEP5-VERIFICATION.md) for the on-chain
verification checklist.

## Related

- [`IMPLEMENTATION-PLAN.md`](../pearl-funds/IMPLEMENTATION-PLAN.md) — full design.
- [`subgraphs/staking`](../staking) — `StakingFactory`/`StakingProxy` source.
- [`subgraphs/service-registry`](../service-registry) — `ServiceRegistryL2` source.
- [`predict-polymarket`](../predict/predict-polymarket) / [`predict-omen`](../predict/predict-omen)
  — in-market bet ledger; join on Agent Safe address.
