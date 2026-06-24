# AERO gauge-reward indexing — verification & implementation plan

**Status:** CL reward path is **built and shipped** (in `#156`). Most assumptions are now
**verified on-chain** via a real Basius **V2** stake (Divya, block 47702491 — §2): depositor
identity, `rewardToken = AERO`, and `earned(safe)` resolving non-zero all hold. The **one
strictly-open gap is the CL `earned(address,uint256)` selector** (a different gauge ABI than
the V2 `earned(address)` that was exercised) — unverifiable until a Basius position lands in a
Slipstream pool. Divya's example also surfaced a **separate, larger V2 gap** (§7): staked V2
positions currently vanish from the portfolio. This doc captures the path, the verification
status, and the runbook to close CL out once a real staked CL position exists.

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

## 2. What is already verified

### Offline (ABI / token / contracts)

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

### On-chain (Divya, PR #159, against a real Basius **V2** stake)

A Basius test agent (`0xcb9a…fc45`) staked into an Aerodrome **V2 stable** gauge
(`0x793f…733e`, pool USDC/eUSD `0x7A03…1f4F`), verified at block **47702491**:

- ✅ **Depositor identity = the service safe.** The gauge `Deposit` log carries the safe as
  the depositor (no operator/proxy in between). This is structural to Aerodrome and applies
  **universally to V2 *and* CL** → settles assumption (2) below.
- ✅ **`rewardToken() = 0x940181a9…` (AERO)** confirmed live.
- ✅ **`earned(safe)` resolves and is non-zero** (`0.0098155476 AERO` live on that position) —
  for the **V2** gauge, which uses `earned(address)`.
- ✅ **Deposited LP matches our record.** On-chain `7157236262142` wei == the agent's internal
  `current_liquidity`, so our view of the position lines up with the gauge's.

## 3. What is NOT yet verified (needs a live **CL/Slipstream** staked position)

After Divya's V2 verification, only the **CL-selector** gap remains strictly open:

1. **The CL gauge selector actually resolves.** Aerodrome's *deployed* CL gauge must implement
   `earned(address,uint256)` — a **different selector on a different gauge ABI** than the V2
   `earned(address)` Divya exercised. If it differs, `try_earned` **reverts silently** and
   reward records as **0** — no crash, no error. This is the dangerous mode: the data looks
   healthy while undercounting. **Still the one thing we cannot claim until a Basius position
   lands in a Slipstream pool.** The `log.warning` guard (§4) exists precisely to surface it.
2. ~~The `account` argument is right.~~ **✅ Settled by Divya** — the safe is the depositor,
   universally (V2 + CL). We pass the safe; that's correct.
3. **The full wei → AERO → USD product.** Verified for the **V2** path (Divya's liquidity +
   `earned` cross-check). The **CL** product still rides on (1) resolving; once it does, do the
   §5 cross-check to confirm the end-to-end number.

> **Strongly suggested, not proven:** because depositor identity, `rewardToken`, and the
> account argument all hold on V2, CL is very likely to work too. But the selector difference
> means we keep CL marked *unverified* until a real Slipstream stake confirms it.

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

## 7. Separate, larger gap surfaced by Divya's V2 example — staked V2 positions vanish

Divya's verification used a **V2-gauge** stake, which incidentally exposes a real correctness
gap in the **V2** path that is *bigger* than missing rewards:

- V2 position value is computed from **`pool.balanceOf(safe)`** (`src/veloV2Shared.ts`).
- Staking LP into an Aerodrome V2 gauge **transfers the LP ERC20 out of the safe into the
  gauge**, so `balanceOf(safe)` becomes **0**.
- `handleVeloV2Transfer` refreshes the `from` address on that transfer, and the refresh hits
  the `userBalance == 0` branch → marks the position **`isActive = false`** and zeroes
  `usdCurrent`.

**Net effect:** the moment a Basius agent stakes a V2 position, the subgraph treats it as
**closed and worthless** — dropping both principal value *and* AERO rewards from the portfolio
while it's actually staked and earning. (`usdCurrentWithRewards = usdCurrent` with a
`// TODO: Calculate V2 fees later` only compounds it.) This code is **inherited verbatim from
`babydegen-optimism`**, so the same gap likely exists there.

This is **out of scope for this docs PR** (it's a behavioral fix with its own design — read
the gauge's `stakedValues`/`balanceOf` for the safe to value staked LP, add V2 `earned`
rewards, and possibly mirror the fix to optimism). It is flagged here so it isn't lost. If
prioritized, it should be a separate implementation PR with its own tests. The CL `log.warning`
guard does **not** cover this — V2 uses no such code path.

## 8. Scope

- **In scope (this PR):** documenting the CL-gauge `earned` reward path, folding in Divya's
  on-chain verification, and the `log.warning` silent-zero guard for the CL path.
- **Tracked but not in this PR:** the **V2 staked-position** gap (§7) — value + rewards for
  gauge-staked V2 positions; needs its own PR (likely affects optimism too). And the **CL**
  end-to-end confirmation (§3/§5), which is event-gated on a real Slipstream stake.
- **Out of scope (already settled):** AERO *spot* pricing (done, `tokenConfig.ts`), Aerodrome
  v2 bootstrap (done, `forSwaps`), and per-day transactions / DAA (live in the
  `service-registry` subgraph, not here). See `CLAUDE.md`.
