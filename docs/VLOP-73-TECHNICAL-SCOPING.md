# VLOP-73 — Technical Scoping: Pearl Wallet Transaction History

**Linear:** [VLOP-73](https://linear.app/valory-xyz/issue/VLOP-73)
**Date:** 2026-05-29 (rev. 2026-06-01 — finalised approach is the subgraph; self-hosted indexer rejected)

---

## The Problem

The Pearl wallet shows only a balance. VLOP-73 adds a **transaction history** — every fund movement in and out of the Master Safe (and Agent Safe) across Gnosis, Polygon, Optimism, and Base.

---

## Approaches Evaluated

**The Graph event-based subgraph — ✅ CHOSEN.** Indexes the Pearl contract events (service registry, `ServiceRegistryTokenUtility`, staking factory/proxy, OLAS / native / stablecoin `Transfer`s, and per-Safe `Safe` template events). Hosted on The Graph Studio, no bespoke infra to operate, and fits the repo's existing subgraph fleet. Covers all the material fund flows; the two things it can't see (below) are accepted v1 gaps.

**Substreams — rejected.** Would expose raw execution traces, but Gnosis runs Nethermind (no Firehose instrumentation) and no public Gnosis execution-layer endpoint exists from any provider.

**Goldsky Mirror — rejected.** Streams raw traces into your own Postgres, but Pearl Safe addresses are discovered at runtime, so the pipeline can't be pre-filtered to them — it would ingest every value-bearing transaction on the chain.

**Self-hosted trace indexer — rejected.** A backend service watching the Pearl contracts and fetching execution traces (`trace_transaction` / `debug_traceTransaction`) *would* close the native-gas-leg gap and recover a literal "Setup complete" row — but at the cost of standing up and operating a bespoke backend + database + API, with org-wide maintenance and on-call burden. Not justified for v1 given the subgraph covers the material flows. Revisit only if VLOP-73 acceptance later requires the native gas leg or a server-side setup row.

---

## Finalised Approach: `pearl-transactions` subgraph

A Graph subgraph at `subgraphs/pearl-transactions/`, deployed per network, built in phases:

| Phase | PR | Adds |
|---|---|---|
| 1a | #131 | Service registry + SRTU bond deposits/refunds + Master EOA derivation (`getOwners()`) + `SAFE_DEPLOYED` anchor |
| 1b | #132 | Staking factory/proxy — reward claims, unstake rewards, evictions, daily reward rollups |
| 2a | #133 | Raw OLAS + native (`Safe` template) ledger; `classifyTransfer`; `SAFE_SETUP_TRANSFER`; agent-funding aggregation |
| 2b | #138 | Stablecoin `Transfer`s — USDC / USDC.e / pUSD per chain |

**Address roles** are derived from chain events: Master Safe from the NFT mint / `ServiceStaked.owner`, Agent Safe from `CreateMultisigWithAgents`, Agent EOA from `RegisterInstance`, Master EOA from `getOwners()[0]`.

---

## What's Covered

- Master Safe + Agent Safe full transaction history per chain: SRTU bond deposits/refunds, staking reward claims, raw OLAS / native / stablecoin transfers, withdrawals, and agent funding (multi-token-in-one-tx grouped via `AgentFundingEvent`).
- Staking / unstaking / eviction events; OLAS rewards (stored; the UI may hide them).
- Stale-data indicator via the subgraph's last-indexed block.
- **"Setup complete"** — rendered **frontend-side** (Path A, product-confirmed): the wallet shows a "History starts here" divider at `MasterSafe.historyFloorBlock` and fetches opening balances itself via archive RPC (`balanceOf` for ERC-20, `eth_getBalance` for native). The subgraph emits no opening-balance row.

---

## Accepted v1 gaps (event-based indexing limits)

- **Native outflows from a Safe are not indexed.** A native-coin transfer *out* of a Safe surfaces only as the Safe's `ExecutionSuccess` event, which carries no amount or recipient (and fires on every Safe tx) — so the v1 handlers are a no-op for it. Consequence: **native withdrawals to external wallets** and the **native agent gas-funding leg (Master Safe → Agent EOA)** do not appear. Native *inflows* to a Safe (`SafeReceived`) and all *token* transfers in/out are captured precisely. Closing the native-outflow gap requires call/trace handlers (the rationale that was floated for the self-hosted indexer); accepted as a v1 limit.
- **"Setup complete" / pre-discovery transfers as literal rows.** The `Safe` template only sees events from its spawn block, so a pre-stake funding transfer can't be back-filled as a real row. Handled via Path A (frontend opening balances at `historyFloorBlock`) rather than a synthetic row.
- **Token coverage is a known allowlist, not "any token."** A subgraph `Transfer` data source must target specific token contracts, so the subgraph indexes the set the wallet displays (OLAS, wrapped-native, USDC / USDC.e / pUSD per chain — sourced from the app's `config/tokens.ts`). An arbitrary/unknown ERC-20 landing in a Safe won't appear. Adding a token to the wallet requires adding it to `networks.json` + the symbol resolver in lockstep.

These gaps were the rationale floated for the self-hosted trace indexer; product accepted them as v1 limits and chose the subgraph for its far lower operational cost.
