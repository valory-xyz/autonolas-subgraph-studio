# AERO gauge-reward indexing — verification & implementation plan

**Status:** code path is **built and shipped** (in `#156`), but **unverified end-to-end**
because no Basius CL position has been staked in an Aerodrome gauge on Base yet. This doc
captures exactly what the path does, which assumptions are still unproven, and the concrete
steps to confirm (and, if needed, fix) it once the first real staked position exists.

This is deliberately a docs-first PR: there is **no Basius gauge state on-chain to test
against today**, so we describe the plan and add self-reporting instrumentation rather than
guess at fixes.

---

## 1. What the path does today

For every **active Aerodrome Slipstream (CL)** position, `refreshVeloCLPosition`
(`src/veloCLShared.ts`) reads unclaimed staking rewards from the position's gauge and folds
them into the portfolio value:

```ts
// src/veloCLShared.ts  (reward block, ~L332–375)
const gauge = VeloCLGauge.bind(gaugeAddress)
const earnedResult = gauge.try_earned(nftOwner, tokenId)   // earned(address account, uint256 tokenId)

if (!earnedResult.reverted) {
  rewardAmount = earnedResult.value.toBigDecimal().div(BigDecimal.fromString("1e18"))  // AERO is 18-dec
  const aeroPrice = getTokenPriceUSD(AERO, block.timestamp, false)                     // AERO/USDC pool
  rewardUSD = rewardAmount.times(aeroPrice)
} else {
  log.warning(...)  // self-reporting — see §4
}

position.claimableReward       = rewardAmount
position.claimableRewardUSD    = rewardUSD
position.usdCurrent            = usd                 // base liquidity only
position.usdCurrentWithRewards = usd.plus(rewardUSD) // base + rewards
```

`gaugeAddress` comes from `position.rewardsContract` if cached, else from the CL pool's
`gauge()` getter (`pool.try_gauge()`), which is then cached on the position.

### Why it matters

`usdCurrentWithRewards` feeds `refreshPortfolio` → the portfolio snapshots → the **APR/ROI
KPIs** surfaced on the website:

- `DailyPopulationMetric.sma7dAPR` — "APR relative to USDC – MA7D"
- `DailyPopulationMetric.sma7dEthAdjustedAPR` — "APR relative to ETH – MA7D"
- `AgentPortfolioSnapshot.roi` — explorer per-day heatmap

So a wrong reward value isn't cosmetic — it understates realized agent performance.

---

## 2. What is already verified (offline)

- **`earned` ABI shape.** `abis/defi/VeloCLGauge.json` declares
  `earned(address account, uint256 tokenId) → uint256`. The bound call matches the ABI.
- **Gauge getters exist.** The same ABI exposes `rewardToken()`, `stakedContains(depositor,
  tokenId)`, `stakedByIndex`, `stakedValues(depositor)` and `getReward` — the getters the
  verification in §3 relies on.
- **AERO token.** 18 decimals (so the `/1e18` is correct), address
  `0x940181a94A35A4569E4529A3CDfB74e38FD98631`.
- **AERO pricing.** Priced off the Aerodrome **AERO/USDC volatile** pool
  `0x6cdcb1c4…` via the `velodrome_v2` adapter (`src/tokenConfig.ts`), Divya-confirmed.
- **Contracts deployed.** Slipstream NFPM / factory and the CL pool `gauge()` getter all
  return live bytecode on Base.

## 3. What is NOT yet verified (needs a live staked position)

Three assumptions can only be confirmed against real gauge state:

1. **The gauge selector actually resolves.** Aerodrome's *deployed* CL gauge must implement
   `earned(address,uint256)` with the same selector. If it differs, `try_earned` **reverts
   silently** and reward records as **0** — no crash, no error. This is the dangerous mode:
   the data looks healthy while undercounting.
2. **The `account` argument is right.** We pass the **service safe** (`nftOwner`) as
   `account`. Aerodrome credits `earned` to whoever **staked the NFT** (called
   `gauge.deposit(tokenId)`). If Basius stakes directly from the safe → correct. If it stakes
   through a relayer/intermediary → `earned(safe, tokenId)` returns 0 for the safe.
3. **The full wei → AERO → USD product.** Each factor is individually checked; the
   end-to-end number (`earned` wei → human AERO → USD → `usdCurrentWithRewards`) has never
   been compared against a real, non-zero value.

---

## 4. Instrumentation added in this PR

To convert "deferred unknown" into "self-reporting", the `else` branch of the `earned` call
now emits a `log.warning` whenever `earned()` reverts on an **active** CL position
(`src/veloCLShared.ts`). When the first real Basius position is staked, the indexer logs will
immediately show whether the path works:

- **No warning + non-zero `claimableRewardUSD`** → path is working; close this out.
- **Warning fires** → assumption (1) or (2) is wrong; follow §5 to fix.

No behavior change for the (correct) happy path; this only makes the failure visible.

---

## 5. Verification runbook (run once a Basius CL position is staked)

Prereq: identify a staked position — a Basius service safe (607/610/611/612) that has called
`gauge.deposit(tokenId)` on an Aerodrome Slipstream gauge. Use a **Base archive RPC**
(`base.drpc.org`) so historical `eth_call` works.

1. **Find the gauge.** From the position's pool: `eth_call pool.gauge()` → `gaugeAddress`.
2. **Confirm reward token is AERO.** `eth_call gauge.rewardToken()` →
   should equal `0x940181a9…`. (If not, the `/1e18` + AERO pricing assumptions change.)
3. **Confirm the staker.** `eth_call gauge.stakedContains(safe, tokenId)` → must be `true`.
   - `true` → assumption (2) holds; `account = safe` is correct.
   - `false` → find the real depositor (check the `Deposit` event / `stakedValues`), and the
     `account` passed to `earned` must be that address, not the safe. **Fix:** thread the
     depositor through instead of `nftOwner`.
4. **Confirm `earned` resolves and is non-zero.**
   `eth_call gauge.earned(safe, tokenId)` at a recent block.
   - Reverts → assumption (1): the deployed gauge's `earned` selector differs from
     `abis/defi/VeloCLGauge.json`. **Fix:** regenerate the ABI from the deployed Aerodrome CL
     gauge (Sourcify/Basescan), re-`codegen`, re-build.
   - Returns 0 while the Aerodrome UI shows pending rewards → re-check (2)/(3).
5. **Cross-check the indexed value.** Once indexing past the stake block, query the subgraph's
   `ProtocolPosition.claimableRewardUSD` and compare to
   `earned_wei / 1e18 × AERO/USDC price` at the same block (and against the Aerodrome
   UI / `RewardsSugar`). Expect a match within rounding / price-source skew.

If all five pass: the path is confirmed — delete the `log.warning`, flip the status line at
the top of this doc to "verified", and update `CLAUDE.md`'s gauge note.

---

## 6. Likely fixes, by symptom

| Symptom at first staked position | Root cause | Fix |
|---|---|---|
| `log.warning` fires; `earned` reverts | Wrong gauge `earned` selector/ABI | Regenerate `VeloCLGauge.json` from deployed Aerodrome gauge → `codegen` → build |
| `earned(safe, …)` returns 0 but UI shows rewards | NFT staked by a non-safe depositor | Pass the actual depositor as `account` (derive from `Deposit` event / `stakedContains`) |
| Reward USD wrong by orders of magnitude | Decimals / price source | Confirm `rewardToken()` decimals; confirm AERO/USDC pool liquidity is non-trivial at the block |

---

## 7. Scope

- **In scope:** the CL-gauge `earned` reward path described above and its effect on
  `usdCurrentWithRewards` / APR / ROI.
- **Out of scope (already settled):** AERO *spot* pricing (done, `tokenConfig.ts`), Aerodrome
  v2 bootstrap (done, `forSwaps`), and per-day transactions / DAA (live in the
  `service-registry` subgraph, not here). See `CLAUDE.md`.
