# Validation Scripts

Scripts to verify data consistency across all subgraph entities. They fetch data directly from the subgraph GraphQL API — no manual copy-paste needed.

Requires **Node.js 18+** (uses native `fetch`).

## Scripts

### `validate-global.js`

Validates **Global** entity against all **TraderAgent** entities. Only needs the subgraph URL.

```bash
node scripts/validate-global.js <subgraph-url>
```

**Checks:**
- Global totals (totalBets, totalTraded, totalTradedSettled, totalPayout, totalExpectedPayout) match sum of all TraderAgent totals
- totalTraderAgents / totalActiveTraderAgents match actual agent counts
- Per-agent sanity: settled <= total, no negative payouts, firstParticipation set if bets exist
- Global invariants: settled <= total, no negative values

---

### `validate-agent.js`

Validates all data for a single **TraderAgent**. Needs the subgraph URL and an agent address.

```bash
node scripts/validate-agent.js <subgraph-url> <agent-address>
```

**Checks:**
1. Agent totals == sum of MarketParticipant totals
2. Settled markets have `totalTradedSettled == totalTraded`
3. Bet sums (amounts, share balances) match participant totals
4. `expectedPayout` matches recalculation from share balances + winning outcome
5. Bet flags (`countedInProfit`, `countedInTotal`) consistent with settlement status
6. Sell bets have correct sign conventions (negative amount + negative shares, isBuy=false)
7. Daily stats activity fields match bets placed that day
8. Sum of daily stats matches agent totals
9. Three-way profit match: `Sum(dailyProfit)` vs agent expected profit vs participant expected profit
10. All settled markets appear in some day's `profitParticipants`
11. Daily payout sum matches agent totalPayout

## Example

```bash
# Check global consistency
node scripts/validate-global.js https://api.studio.thegraph.com/query/xxx/predict-polymarket/version/latest

# Check a specific agent
node scripts/validate-agent.js https://api.studio.thegraph.com/query/xxx/predict-polymarket/version/latest 0x1234abcd...
```

Both scripts exit with code **0** if no issues found, **1** otherwise — useful for CI.
