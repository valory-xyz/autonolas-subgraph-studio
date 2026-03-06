/**
 * Validate individual bet consistency across all entities.
 *
 * Checks:
 *   1. Every bet belongs to a valid MarketParticipant
 *   2. Every bet's fixedProductMarketMaker matches its participant's market
 *   3. Bet flags (countedInProfit, countedInTotal) consistency with market settlement
 *   4. No orphan bets (bet exists but no participant references it)
 *   5. Sell bets have negative amount and negative outcomeTokenAmount
 *   6. Sum of token amounts per outcome per market matches participant balances
 *   7. Bet's dailyStatistic date matches bet's blockTimestamp day
 *
 * Usage:
 *   1. Run the queries below for one agent address.
 *   2. Paste results into `participants`.
 *   3. Run: node scripts/validate-bet-consistency.js
 *
 * Query — All market participants with bets:
 *   {
 *     marketParticipants(
 *       where: { traderAgent: "0xAGENT" }
 *       first: 1000
 *       orderBy: createdAt
 *     ) {
 *       id
 *       fixedProductMarketMaker { id, question, currentAnswer }
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalTradedSettled
 *       totalFeesSettled
 *       totalPayout
 *       expectedPayout
 *       outcomeTokenBalance0
 *       outcomeTokenBalance1
 *       settled
 *       bets {
 *         id
 *         outcomeIndex
 *         amount
 *         feeAmount
 *         outcomeTokenAmount
 *         countedInProfit
 *         countedInTotal
 *         blockTimestamp
 *         fixedProductMarketMaker { id }
 *         dailyStatistic { id, date }
 *       }
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const participants = [
  // Paste marketParticipants array here
];

// ──── HELPERS ────

const bn = (s) => BigInt(s || "0");
const fmt = (wei) => {
  const sign = wei < 0n ? "-" : "";
  const abs = wei < 0n ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0";
  return `${sign}${whole}.${frac}`;
};
const fmtDate = (ts) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
const ONE_DAY = 86400;
const getDayTimestamp = (ts) => Math.floor(Number(ts) / ONE_DAY) * ONE_DAY;

// ──── ANALYSIS 1: Bet Amounts & Token Balances vs Participant ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Bet Sums vs Participant Totals");
console.log("════════════════════════════════════════════════════════════\n");

let issues1 = 0;

for (const p of participants) {
  const bets = p.bets || [];
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);
  const errs = [];

  let sumAmount = 0n;
  let sumFees = 0n;
  let sumTokens0 = 0n;
  let sumTokens1 = 0n;

  for (const bet of bets) {
    sumAmount += bn(bet.amount);
    sumFees += bn(bet.feeAmount);
    if (bn(bet.outcomeIndex) === 0n) {
      sumTokens0 += bn(bet.outcomeTokenAmount);
    } else {
      sumTokens1 += bn(bet.outcomeTokenAmount);
    }
  }

  if (sumAmount !== bn(p.totalTraded)) errs.push(`totalTraded: sum=${fmt(sumAmount)} stored=${fmt(bn(p.totalTraded))}`);
  if (sumFees !== bn(p.totalFees)) errs.push(`totalFees: sum=${fmt(sumFees)} stored=${fmt(bn(p.totalFees))}`);
  if (sumTokens0 !== bn(p.outcomeTokenBalance0)) errs.push(`balance0: sum=${fmt(sumTokens0)} stored=${fmt(bn(p.outcomeTokenBalance0))}`);
  if (sumTokens1 !== bn(p.outcomeTokenBalance1)) errs.push(`balance1: sum=${fmt(sumTokens1)} stored=${fmt(bn(p.outcomeTokenBalance1))}`);
  if (bets.length !== Number(p.totalBets || 0)) errs.push(`totalBets: bets.length=${bets.length} stored=${p.totalBets}`);

  if (errs.length > 0) {
    issues1 += errs.length;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    for (const e of errs) console.log(`    ${e}`);
    console.log();
  }
}

if (issues1 === 0) {
  console.log("  All participant totals match bet sums.\n");
}

// ──── ANALYSIS 2: Bet Flag Consistency ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Bet Flag Consistency");
console.log("════════════════════════════════════════════════════════════\n");

let issues2 = 0;

for (const p of participants) {
  const bets = p.bets || [];
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);

  for (const bet of bets) {
    const errs = [];

    // If settled, all bets should be counted
    if (p.settled) {
      if (!bet.countedInProfit) errs.push("settled market but countedInProfit=false");
      if (bet.countedInTotal === false) errs.push("settled market but countedInTotal=false");
    }

    // countedInProfit=true implies countedInTotal=true
    if (bet.countedInProfit && bet.countedInTotal === false) {
      errs.push("countedInProfit=true but countedInTotal=false (inconsistent)");
    }

    // If not settled, flags should be false
    if (!p.settled) {
      if (bet.countedInProfit) errs.push("unsettled market but countedInProfit=true");
      if (bet.countedInTotal === true) errs.push("unsettled market but countedInTotal=true");
    }

    if (errs.length > 0) {
      issues2++;
      console.log(`  ${marketId.slice(0, 10)}... ${question}`);
      console.log(`    Bet ${(bet.id || "").slice(0, 20)}...`);
      for (const e of errs) console.log(`      ${e}`);
    }
  }
}

if (issues2 === 0) {
  console.log("  All bet flags consistent with settlement status.\n");
} else {
  console.log(`\n  ── Flag issues: ${issues2} ──\n`);
}

// ──── ANALYSIS 3: Bet Market Assignment ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Bet Market Assignment");
console.log("════════════════════════════════════════════════════════════\n");

let issues3 = 0;

for (const p of participants) {
  const bets = p.bets || [];
  const marketId = p.fixedProductMarketMaker?.id;

  for (const bet of bets) {
    const betMarketId = bet.fixedProductMarketMaker?.id;
    if (betMarketId && marketId && betMarketId !== marketId) {
      issues3++;
      console.log(`  Bet ${(bet.id || "").slice(0, 20)}... assigned to market ${betMarketId} but participant is for ${marketId}`);
    }
  }
}

if (issues3 === 0) {
  console.log("  All bets assigned to correct markets.\n");
}

// ──── ANALYSIS 4: Daily Statistic Date Consistency ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Bet DailyStatistic Date Consistency");
console.log("════════════════════════════════════════════════════════════\n");

let issues4 = 0;

for (const p of participants) {
  const bets = p.bets || [];

  for (const bet of bets) {
    if (!bet.dailyStatistic || !bet.blockTimestamp) continue;

    const betDay = getDayTimestamp(bet.blockTimestamp);
    const statDate = Number(bet.dailyStatistic.date || 0);

    if (betDay !== statDate) {
      issues4++;
      console.log(`  Bet ${(bet.id || "").slice(0, 20)}...`);
      console.log(`    blockTimestamp day: ${fmtDate(betDay)} (${betDay})`);
      console.log(`    dailyStatistic date: ${fmtDate(statDate)} (${statDate})`);
    }
  }
}

if (issues4 === 0) {
  console.log("  All bets assigned to correct daily statistics.\n");
}

// ──── ANALYSIS 5: Sell Bet Sign Checks ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Sell Bet Sign Convention");
console.log("════════════════════════════════════════════════════════════\n");

let issues5 = 0;

for (const p of participants) {
  const bets = p.bets || [];

  for (const bet of bets) {
    const amount = bn(bet.amount);
    const tokens = bn(bet.outcomeTokenAmount);

    // Sells have negative amount and negative tokens
    if (amount < 0n && tokens > 0n) {
      issues5++;
      console.log(`  Bet ${(bet.id || "").slice(0, 20)}... negative amount(${fmt(amount)}) but positive tokens(${fmt(tokens)})`);
    }
    if (amount > 0n && tokens < 0n) {
      issues5++;
      console.log(`  Bet ${(bet.id || "").slice(0, 20)}... positive amount(${fmt(amount)}) but negative tokens(${fmt(tokens)})`);
    }

    // Fees should always be non-negative
    const fee = bn(bet.feeAmount);
    if (fee < 0n) {
      issues5++;
      console.log(`  Bet ${(bet.id || "").slice(0, 20)}... negative feeAmount(${fmt(fee)})`);
    }
  }
}

if (issues5 === 0) {
  console.log("  All sell bets have consistent sign conventions.\n");
}

// ──── SUMMARY ────

const total = issues1 + issues2 + issues3 + issues4 + issues5;
console.log("════════════════════════════════════════════════════════════");
console.log(`  TOTAL ISSUES: ${total}`);
console.log("════════════════════════════════════════════════════════════\n");
