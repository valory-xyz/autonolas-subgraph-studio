# predict-omen / predict-polymarket — Profit Field Migration

Migration guide for consumers of the `predict-omen` and `predict-polymarket` subgraphs following [PR #103](https://github.com/valory-xyz/autonolas-subgraph-studio/pull/103).

## What changed

Before PR #103, `TraderAgent.totalPayout` meant "expected payout computed at settlement" and `DailyProfitStatistic.dailyProfit` was split between settlement day (losses) and payout day (wins). After the PR:

- `totalPayout` = **actual xDAI / xUSDC redeemed** via `PayoutRedemption` events.
- `totalExpectedPayout` = **calculated expected payout at settlement** (this is the field that behaves like the old `totalPayout`).
- `totalTradedSettled` and `DailyProfitStatistic.dailyProfit` are now booked **entirely on the settlement day** for all bets (wins and losses), not split across settlement/payout days.

## Field-by-field mapping

| Old usage | New equivalent |
|---|---|
| `TraderAgent.totalPayout` (as a proxy for "expected winnings") | `TraderAgent.totalExpectedPayout` |
| `TraderAgent.totalPayout` (if you actually wanted on-chain redemptions) | `TraderAgent.totalPayout` (unchanged name, new semantics) |
| `Global.totalPayout` (expected) | `Global.totalExpectedPayout` |
| `DailyProfitStatistic.dailyProfit` (wins landing on payout day) | `DailyProfitStatistic.dailyProfit` (now always on settlement day) |
| `Bet.timestamp` | `Bet.blockTimestamp` (`timestamp` is `@deprecated`) |

## Recomputing profit

If an agent was computing `profit = totalPayout − totalTraded`, switch to:

```text
expectedProfit = totalExpectedPayout − totalTradedSettled
realizedProfit = totalPayout − totalTradedSettled   // only counts redeemed markets
```

For day-level PnL, keep reading `dailyProfit`, but note the **attribution day has shifted** for winning bets (settlement day instead of payout day). Any historical series an agent cached will need a re-pull, and week/day buckets straddling old vs. new data will double-count unless rebuilt.

## Polymarket-only gotcha

`Bet.amount` and `Bet.shares` are now **signed**: negative on sells. If an agent was summing them assuming all positive, it needs to either filter `isBuy: true` or use absolute values where appropriate.

## New entities available (optional, not required to migrate)

- `PayoutRedemption` — per-event log of on-chain redemptions.
- `MarketParticipant.outcomeTokenBalance0/1` (omen) / `outcomeShares0/1` (polymarket), `expectedPayout`, `settled` — per-market position state.

## Validation

The PR ships `scripts/validate-*.js` against the deployed subgraph. Agents can run:

```bash
node scripts/validate-agent.js <subgraph-url> <agent-address>
```

to cross-check their own numbers against the new schema before cutting over. See `subgraphs/predict/predict-omen/scripts/README.md` and `subgraphs/predict/predict-polymarket/scripts/README.md` for the full list.
