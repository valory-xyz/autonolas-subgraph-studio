# Step 5 — On-Studio Verification Checklist

First real-data validation of the deployed subgraph. Everything before this
was unit-tested with mocked events; this confirms the handlers behave against
real Pearl transactions. Run after a deploy and once indexing has progressed.

**Endpoints:** `https://api.studio.thegraph.com/query/1716136/pearl-<network>-transactions/<version>`
(`<network>` = `gnosis` | `polygon`; `<version>` = `v0.0.3`). Use the Studio
**Playground**, or POST the query as `{"query":"…"}`.

**Pearl agents by home chain** (to pick a real service; `Service.agentIds`
contains these):

| Chain | Agent | agentIds |
|---|---|---|
| gnosis | Predict Trader (Omenstrat) | 14, 25 |
| matic | Polystrat | 86 |
| optimism | Optimus | 40 |
| base | Agents.fun | 43 |

---

## A. Health — no silent failures

```graphql
{ _meta { block { number timestamp } hasIndexingErrors } }
```
- [ ] `hasIndexingErrors: false`
- [ ] `block.number` is advancing on re-run (subgraph is live, not stuck)

## B. Token metadata — the resolver-drift canary

```graphql
{ tokens(first: 50) { id symbol decimals } }
```
- [ ] Stablecoins (`USDC`, `USDC.e`, `pUSD`) show `decimals: 6`
- [ ] `OLAS` and wrapped-native (`WXDAI`/`WPOL`/`WETH`) show `decimals: 18`
- [ ] **No `UNKNOWN` symbol** (UNKNOWN ⇒ an indexed token missing a
      `getStablecoinSymbol` branch — check indexing logs for the `log.critical`)

## C. Entity graph — pick a real service and cross-check the explorer

```graphql
{
  masterSafes(first: 5, orderBy: lastActivityTimestamp, orderDirection: desc) {
    id masterEoa owners threshold historyFloorBlock setupTransferSeen
    services { id serviceId state agentIds nftCustodian
               currentStakingContract { id } totalOlasRewardsClaimed }
  }
}
```
For one Master Safe + service:
- [ ] `masterEoa` == `owners[0]` and matches the Safe's owner on the explorer
      (`getOwners()` on the Safe address)
- [ ] `threshold` is 1 (Pearl default)
- [ ] `historyFloorBlock` == the Safe's first-sighting block
- [ ] exactly one `SAFE_DEPLOYED` row per Master Safe (query D, filter
      `category: SAFE_DEPLOYED`)
- [ ] `agentIds` contains the expected Pearl agent ID for the chain (table above)

## D. Ledger — amounts reconcile against the block explorer

```graphql
query Rows($safe: Bytes!) {
  fundsMovements(where: { masterSafe: $safe }, orderBy: blockTimestamp,
                 orderDirection: desc, first: 100) {
    category source amount token bondType from to
    service { id } blockNumber transactionHash
  }
}
```
Pick a service that has staked at least once and verify against the explorer:
- [ ] **Stake:** two `SERVICE_BOND_DEPOSIT` rows (SECURITY_DEPOSIT + AGENT_BOND);
      amounts match the SRTU `TokenDeposit` logs in that tx
- [ ] **Claim:** `STAKING_REWARD_CLAIM` amount matches the `RewardClaimed`
      reward in the staking tx; OLAS `to` == Agent Safe
- [ ] **Unstake:** `UNSTAKE_REWARD` + two `SERVICE_BOND_REFUND` rows reconcile
- [ ] **Funding:** a real Master Safe → Agent Safe token transfer shows as
      `MASTER_TO_AGENT` (and is grouped under an `AgentFundingEvent`)
- [ ] **Setup:** the first live Master EOA → Master Safe inbound is
      `SAFE_SETUP_TRANSFER`; later inbounds are `MASTER_FUNDING_IN`
- [ ] `amount` ÷ `Token.decimals` gives the human value seen on the explorer
      (stablecoins ÷ 1e6, OLAS/native ÷ 1e18)

## E. Polygon USDC.e sync-lag watch (the §2.2 cost hotspot)

Compare `_meta.block.number` (query A) to the current Polygon chain head:
- [ ] v0.0.3 has reached chain head (fully synced), **or** is closing the gap
      at a healthy rate
- [ ] If sync stalls / falls badly behind: this is the USDC.e firehose. Rollback
      = drop the `matic` USDC.e entry from `networks.json` `erc20Tokens`
      (one-line change) and fall back to the off-chain path for that one token
      (plan §6.3).

## Red flags (stop and investigate)

- `hasIndexingErrors: true`, or sync stuck at a fixed block
- Any `Token` with `symbol: "UNKNOWN"` or wrong decimals
- A staked service with `masterSafe` pointing at a staking-proxy address
  (would mean the NFT-transfer guard regressed)
- Bond rows with `bondType` swapped (SECURITY where AGENT expected) — the
  producer/consumer ordering assumption (plan §4.6) failing on real txs
- Native withdrawals appearing with a non-zero amount (they shouldn't appear
  at all — native-out is not indexed)
