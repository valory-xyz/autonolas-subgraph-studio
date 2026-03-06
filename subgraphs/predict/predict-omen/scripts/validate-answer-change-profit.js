/**
 * Validate profit correctness when a market answer changes (re-answer scenario).
 *
 * When an answer changes, the subgraph should:
 *   1. Reverse the old profit from the old settlement day's DailyProfitStatistic
 *   2. Apply the new profit to the new settlement day's DailyProfitStatistic
 *   3. Update participant.expectedPayout based on new answer
 *   4. Update participant.totalTradedSettled = participant.totalTraded (full settle)
 *
 * This script detects re-answer markets and validates:
 *   - expectedPayout matches recalculation from token balances + current answer
 *   - Sum of all daily profits matches (expectedPayout - totalTraded - totalFees) across all settled markets
 *   - totalPayout vs expectedPayout consistency (payout claimed vs expected)
 *   - Bets countedInProfit/countedInTotal flags are all set for settled markets
 *
 * Usage:
 *   1. Run the queries below for one agent address.
 *   2. Paste results into `dailyStats`, `participants`, and `agent`.
 *   3. Run: node scripts/validate-answer-change-profit.js
 *
 * Query 1 — Daily stats:
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
 *       totalPayout
 *       profitParticipants { id, currentAnswer, currentAnswerTimestamp }
 *     }
 *   }
 *
 * Query 2 — All market participants:
 *   {
 *     marketParticipants(
 *       where: { traderAgent: "0xAGENT" }
 *       first: 1000
 *       orderBy: createdAt
 *     ) {
 *       id
 *       fixedProductMarketMaker { id, question, currentAnswer, currentAnswerTimestamp }
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
 *       }
 *     }
 *   }
 *
 * Query 3 — Agent:
 *   {
 *     traderAgent(id: "0xAGENT") {
 *       totalTraded
 *       totalTradedSettled
 *       totalFees
 *       totalFeesSettled
 *       totalPayout
 *       totalExpectedPayout
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const agent = {
  // totalTraded: "...",
  // totalTradedSettled: "...",
  // totalFees: "...",
  // totalFeesSettled: "...",
  // totalPayout: "...",
  // totalExpectedPayout: "...",
};

const dailyStats = [
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

const ANSWER_0 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ANSWER_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";

function calcExpectedPayout(answer, b0, b1) {
  if (answer === ANSWER_0) return b0 > 0n ? b0 : 0n;
  if (answer === ANSWER_1) return b1 > 0n ? b1 : 0n;
  // Invalid or other answer: equal split
  const p0 = b0 > 0n ? b0 / 2n : 0n;
  const p1 = b1 > 0n ? b1 / 2n : 0n;
  return p0 + p1;
}

const participantByMarket = new Map();
for (const p of participants) {
  const marketId = p.fixedProductMarketMaker?.id;
  if (marketId) participantByMarket.set(marketId, p);
}

// ──── ANALYSIS 1: Expected Payout Recalculation ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Expected Payout vs Recalculation from Token Balances");
console.log("════════════════════════════════════════════════════════════\n");

let issues1 = 0;

for (const p of participants) {
  if (!p.settled) continue;

  const answer = p.fixedProductMarketMaker?.currentAnswer;
  if (!answer || answer === "none") continue;

  const b0 = bn(p.outcomeTokenBalance0);
  const b1 = bn(p.outcomeTokenBalance1);
  const recalc = calcExpectedPayout(answer, b0, b1);
  const stored = bn(p.expectedPayout);
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);

  if (recalc !== stored) {
    issues1++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    stored=${fmt(stored)} recalc=${fmt(recalc)} delta=${fmt(stored - recalc)}`);
    console.log(`    answer=${answer.slice(0, 10)} b0=${fmt(b0)} b1=${fmt(b1)}`);
    console.log();
  }
}

if (issues1 === 0) {
  console.log("  All settled markets have correct expectedPayout.\n");
}

// ──── ANALYSIS 2: Sum of Daily Profit vs Agent-level Expected Profit ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Sum(dailyProfit) vs Agent Expected Profit");
console.log("════════════════════════════════════════════════════════════\n");

const sumDailyProfit = dailyStats.reduce((acc, d) => acc + bn(d.dailyProfit), 0n);

// Expected profit from agent level: expectedPayout - settledTraded - settledFees
const agentExpectedProfit = bn(agent.totalExpectedPayout) - bn(agent.totalTradedSettled) - bn(agent.totalFeesSettled);

// Expected profit from participant level: SUM(expectedPayout - totalTraded - totalFees) for settled markets
const participantExpectedProfit = participants
  .filter((p) => p.settled)
  .reduce((acc, p) => acc + bn(p.expectedPayout) - bn(p.totalTraded) - bn(p.totalFees), 0n);

console.log(`  Sum(dailyProfit):                ${fmt(sumDailyProfit)}`);
console.log(`  Agent expected profit:           ${fmt(agentExpectedProfit)}`);
console.log(`  Participant sum expected profit:  ${fmt(participantExpectedProfit)}`);

const match1 = sumDailyProfit === agentExpectedProfit;
const match2 = sumDailyProfit === participantExpectedProfit;
const match3 = agentExpectedProfit === participantExpectedProfit;

if (!match1) console.log(`  MISMATCH: dailyProfit vs agent (delta=${fmt(sumDailyProfit - agentExpectedProfit)})`);
if (!match2) console.log(`  MISMATCH: dailyProfit vs participants (delta=${fmt(sumDailyProfit - participantExpectedProfit)})`);
if (!match3) console.log(`  MISMATCH: agent vs participants (delta=${fmt(agentExpectedProfit - participantExpectedProfit)})`);
if (match1 && match2 && match3) console.log("  All three match.");
console.log();

// ──── ANALYSIS 3: Bet Flags for Settled Markets ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Bet Flags for Settled Markets");
console.log("════════════════════════════════════════════════════════════\n");

let flagIssues = 0;

for (const p of participants) {
  if (!p.settled) continue;

  const bets = p.bets || [];
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);

  for (const bet of bets) {
    const errs = [];
    if (!bet.countedInProfit) errs.push("countedInProfit=false");
    if (bet.countedInTotal === false) errs.push("countedInTotal=false");

    if (errs.length > 0) {
      flagIssues++;
      console.log(`  ${marketId.slice(0, 10)}... ${question}`);
      console.log(`    Bet ${bet.id}: ${errs.join(", ")}`);
      console.log(`    outcomeIndex=${bet.outcomeIndex} amount=${fmt(bn(bet.amount))} fee=${fmt(bn(bet.feeAmount))}`);
    }
  }
}

if (flagIssues === 0) {
  console.log("  All bets in settled markets have correct flags.\n");
} else {
  console.log(`\n  ── Flag issues: ${flagIssues} ──\n`);
}

// ──── ANALYSIS 4: Answer Change Detection & Impact ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Answer Change Detection");
console.log("════════════════════════════════════════════════════════════\n");

let changeIssues = 0;

for (const p of participants) {
  const payout = bn(p.totalPayout);
  const expected = bn(p.expectedPayout);
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);
  const answer = p.fixedProductMarketMaker?.currentAnswer || "none";

  // Detect: payout received but expected is 0 (answer likely changed after settlement)
  if (payout > 0n && expected === 0n) {
    changeIssues++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    Payout=${fmt(payout)} but expectedPayout=0`);
    console.log(`    settled=${p.settled} answer=${answer.slice(0, 10)}`);
    console.log(`    -> Answer likely changed AFTER settlement but re-answer not processed`);
    console.log();
  }

  // Detect: payout significantly exceeds expected
  if (payout > 0n && expected > 0n && payout > expected + 1n) {
    changeIssues++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    Payout=${fmt(payout)} > expectedPayout=${fmt(expected)}`);
    console.log(`    delta=${fmt(payout - expected)} settled=${p.settled}`);
    console.log(`    -> Possible answer change or multiple redemptions`);
    console.log();
  }

  // Detect: settled with expected payout but no actual payout (unclaimed)
  if (p.settled && expected > 0n && payout === 0n) {
    // Not an error, just informational
  }
}

if (changeIssues === 0) {
  console.log("  No answer change anomalies detected.\n");
} else {
  console.log(`  ── Anomalies: ${changeIssues} ──\n`);
}

// ──── ANALYSIS 5: Profit Participants Completeness ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Profit Participants Completeness");
console.log("════════════════════════════════════════════════════════════\n");

// Every settled market should appear in some day's profitParticipants
const settledMarketIds = new Set(
  participants
    .filter((p) => p.settled)
    .map((p) => p.fixedProductMarketMaker?.id)
    .filter(Boolean)
);

const profitParticipantIds = new Set();
for (const day of dailyStats) {
  for (const pp of (day.profitParticipants || [])) {
    profitParticipantIds.add(pp.id);
  }
}

let missing = 0;
for (const id of settledMarketIds) {
  if (!profitParticipantIds.has(id)) {
    missing++;
    const p = participantByMarket.get(id);
    const question = (p?.fixedProductMarketMaker?.question || "").slice(0, 50);
    console.log(`  Missing from profitParticipants: ${id.slice(0, 10)}... ${question}`);
  }
}

if (missing === 0) {
  console.log("  All settled markets appear in profitParticipants.\n");
} else {
  console.log(`\n  ── Missing: ${missing} ──\n`);
}

// ──── SUMMARY ────

const total = issues1 + (!match1 ? 1 : 0) + (!match2 ? 1 : 0) + (!match3 ? 1 : 0) + flagIssues + changeIssues + missing;
console.log("════════════════════════════════════════════════════════════");
console.log(`  TOTAL ISSUES: ${total}`);
console.log("════════════════════════════════════════════════════════════\n");
