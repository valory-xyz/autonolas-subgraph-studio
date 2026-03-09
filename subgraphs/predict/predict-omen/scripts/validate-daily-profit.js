/**
 * Validate dailyProfit by cross-referencing with MarketParticipant data.
 *
 * For each day that has dailyProfit != 0, checks which markets (profitParticipants)
 * settled that day and whether the sum of per-market profits matches dailyProfit.
 *
 * Usage:
 *   1. Run the queries below for one agent address.
 *   2. Paste results into `dailyStats` and `participants`.
 *   3. Run: node scripts/validate-daily-profit.js
 *
 * Query 1 — Daily stats with profitParticipants:
 *   {
 *     dailyProfitStatistics(
 *       where: { traderAgent: "0xAGENT" }
 *       orderBy: date
 *       orderDirection: asc
 *       first: 1000
 *     ) {
 *       id
 *       date
 *       dailyProfit
 *       totalTraded
 *       totalFees
 *       totalPayout
 *       profitParticipants { id, question, currentAnswer }
 *     }
 *   }
 *
 * Query 2 — All market participants for the agent:
 *   {
 *     marketParticipants(
 *       where: { traderAgent: "0xAGENT" }
 *       first: 1000
 *       orderBy: createdAt
 *     ) {
 *       id
 *       fixedProductMarketMaker { id, question, currentAnswer }
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
 *       }
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const dailyStats =  [
   // Paste dailyProfitStatistics array here
  ];

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

// Build market participant lookup by FPMM id
const participantByMarket = new Map();
for (const p of participants) {
  const marketId = p.fixedProductMarketMaker?.id;
  if (marketId) participantByMarket.set(marketId, p);
}

// ──── ANALYSIS 1: Daily Profit vs Market Participants ────

console.log("════════════════════════════════════════════════════════════");
console.log("  ANALYSIS 1: Daily Profit vs Market Participants");
console.log("════════════════════════════════════════════════════════════\n");

let totalDailyProfit = 0n;
let totalReconstructed = 0n;
let mismatchDays = 0;

for (const day of dailyStats) {
  const dailyProfit = bn(day.dailyProfit);
  totalDailyProfit += dailyProfit;

  const markets = day.profitParticipants || [];
  if (markets.length === 0 && dailyProfit === 0n) continue;

  // Reconstruct profit from market participants that settled this day
  let reconstructed = 0n;
  const marketDetails = [];

  for (const market of markets) {
    const p = participantByMarket.get(market.id);
    if (!p) {
      marketDetails.push({
        id: market.id?.slice(0, 10) + "...",
        question: (market.question || "").slice(0, 40),
        profit: "NOT FOUND",
        expected: "?",
        costs: "?",
      });
      continue;
    }

    const expected = bn(p.expectedPayout);
    const costs = bn(p.totalTradedSettled).plus
      ? bn(p.totalTradedSettled) + bn(p.totalFeesSettled)
      : bn(p.totalTradedSettled) + bn(p.totalFeesSettled);
    const profit = expected - costs;
    reconstructed += profit;

    marketDetails.push({
      id: market.id?.slice(0, 10) + "...",
      question: (market.question || "").slice(0, 40),
      answer: market.currentAnswer?.slice(0, 10) || "none",
      profit: fmt(profit),
      expected: fmt(expected),
      traded: fmt(bn(p.totalTradedSettled)),
      fees: fmt(bn(p.totalFeesSettled)),
      settled: p.settled,
    });
  }

  totalReconstructed += reconstructed;
  const match = dailyProfit === reconstructed;
  if (!match) mismatchDays++;

  // Only show details for days with profit or mismatches
  if (dailyProfit !== 0n || !match) {
    console.log(`  ${fmtDate(day.date)} | dailyProfit: ${fmt(dailyProfit)} | reconstructed: ${fmt(reconstructed)} | ${match ? "OK" : "MISMATCH (" + fmt(dailyProfit - reconstructed) + ")"}`);
    for (const m of marketDetails) {
      console.log(`    ${m.id} ${m.question}`);
      console.log(`      answer=${m.answer} expected=${m.expected} costs=${m.traded}+${m.fees} profit=${m.profit} settled=${m.settled}`);
    }
    console.log();
  }
}

console.log(`  ── Summary ──`);
console.log(`  Total dailyProfit:      ${fmt(totalDailyProfit)}`);
console.log(`  Total reconstructed:    ${fmt(totalReconstructed)}`);
console.log(`  Match: ${totalDailyProfit === totalReconstructed ? "OK" : "MISMATCH (" + fmt(totalDailyProfit - totalReconstructed) + ")"}`);
console.log(`  Days with mismatch:     ${mismatchDays}`);

// ──── ANALYSIS 2: Market Participants vs Individual Bets ────

console.log("\n════════════════════════════════════════════════════════════");
console.log("  ANALYSIS 2: Market Participant Balances vs Bet Sums");
console.log("════════════════════════════════════════════════════════════\n");

let betIssues = 0;

for (const p of participants) {
  const bets = p.bets || [];
  if (bets.length === 0) continue;

  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);
  const answer = p.fixedProductMarketMaker?.currentAnswer || "none";

  // Sum amounts and fees from bets
  let sumAmount = 0n;
  let sumFees = 0n;
  let sumTokens0 = 0n;
  let sumTokens1 = 0n;

  for (const bet of bets) {
    sumAmount += bn(bet.amount);
    sumFees += bn(bet.feeAmount);
    const tokens = bn(bet.outcomeTokenAmount);
    if (bn(bet.outcomeIndex) === 0n) {
      sumTokens0 += tokens;
    } else {
      sumTokens1 += tokens;
    }
  }

  const amountMatch = sumAmount === bn(p.totalTraded);
  const feesMatch = sumFees === bn(p.totalFees);
  const b0Match = sumTokens0 === bn(p.outcomeTokenBalance0);
  const b1Match = sumTokens1 === bn(p.outcomeTokenBalance1);

  if (!amountMatch || !feesMatch || !b0Match || !b1Match) {
    betIssues++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    if (!amountMatch) console.log(`    totalTraded: participant=${fmt(bn(p.totalTraded))} bets=${fmt(sumAmount)} delta=${fmt(bn(p.totalTraded) - sumAmount)}`);
    if (!feesMatch) console.log(`    totalFees: participant=${fmt(bn(p.totalFees))} bets=${fmt(sumFees)} delta=${fmt(bn(p.totalFees) - sumFees)}`);
    if (!b0Match) console.log(`    balance0: participant=${fmt(bn(p.outcomeTokenBalance0))} bets=${fmt(sumTokens0)} delta=${fmt(bn(p.outcomeTokenBalance0) - sumTokens0)}`);
    if (!b1Match) console.log(`    balance1: participant=${fmt(bn(p.outcomeTokenBalance1))} bets=${fmt(sumTokens1)} delta=${fmt(bn(p.outcomeTokenBalance1) - sumTokens1)}`);
    console.log();
  }

  // Also verify expectedPayout matches what we'd calculate from balances + answer
  if (p.settled) {
    const b0 = bn(p.outcomeTokenBalance0);
    const b1 = bn(p.outcomeTokenBalance1);
    let recalcPayout = 0n;
    let answerType = "";

    if (answer === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      answerType = "0";
      recalcPayout = b0 > 0n ? b0 : 0n;
    } else if (answer === "0x0000000000000000000000000000000000000000000000000000000000000001") {
      answerType = "1";
      recalcPayout = b1 > 0n ? b1 : 0n;
    } else if (answer !== "none") {
      answerType = "invalid";
      recalcPayout = (b0 > 0n ? b0 / 2n : 0n) + (b1 > 0n ? b1 / 2n : 0n);
    }

    const storedPayout = bn(p.expectedPayout);
    if (recalcPayout !== storedPayout && answer !== "none") {
      betIssues++;
      console.log(`  ${marketId.slice(0, 10)}... ${question}`);
      console.log(`    expectedPayout MISMATCH: stored=${fmt(storedPayout)} recalc=${fmt(recalcPayout)} (answer=${answerType})`);
      console.log(`    b0=${fmt(b0)} b1=${fmt(b1)}`);
      console.log();
    }
  }
}

if (betIssues === 0) {
  console.log("  No issues found. All participant balances match bet sums,");
  console.log("  and all expectedPayout values match recalculation from balances.\n");
} else {
  console.log(`  ── Total issues: ${betIssues} ──\n`);
}

// ──── ANALYSIS 3: Unsettled markets with payouts ────

console.log("════════════════════════════════════════════════════════════");
console.log("  ANALYSIS 3: Payout without settlement (answer changed?)");
console.log("════════════════════════════════════════════════════════════\n");

let anomalies = 0;

for (const p of participants) {
  const actual = bn(p.totalPayout);
  const expected = bn(p.expectedPayout);
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);
  const answer = p.fixedProductMarketMaker?.currentAnswer || "none";

  // Case 1: Payout exists but expectedPayout is 0 or much lower
  if (actual > 0n && expected === 0n) {
    anomalies++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    Payout=${fmt(actual)} but expectedPayout=0 | settled=${p.settled} answer=${answer.slice(0, 10)}`);
    console.log(`    → Likely: answer changed AFTER settlement (was losing, now winning)`);
    console.log();
  } else if (actual > 0n && actual > expected && (actual - expected) > 1n) {
    anomalies++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    Payout=${fmt(actual)} > expectedPayout=${fmt(expected)} | delta=${fmt(actual - expected)}`);
    console.log(`    settled=${p.settled} answer=${answer.slice(0, 10)}`);
    console.log(`    → Likely: answer changed (e.g., invalid→valid, or outcome flipped)`);
    console.log();
  }
}

if (anomalies === 0) {
  console.log("  No anomalies found.\n");
} else {
  console.log(`  ── Total anomalies: ${anomalies} ──`);
  console.log("  These markets likely had their answer changed after initial settlement.");
  console.log("  The re-settlement feature will fix this.\n");
}
