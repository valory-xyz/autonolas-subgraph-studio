/**
 * Validate DailyProfitStatistic activity fields match the bets placed that day,
 * and that sum of daily stats matches agent totals.
 *
 * Checks:
 *   1. dailyStat.totalBets == count of bets placed that day
 *   2. dailyStat.totalTraded == SUM(bet.amount) for bets placed that day
 *   3. dailyStat.totalFees == SUM(bet.feeAmount) for bets placed that day
 *   4. SUM(dailyStat.totalTraded) == agent.totalTraded
 *   5. SUM(dailyStat.totalFees) == agent.totalFees
 *   6. SUM(dailyStat.totalBets) == agent.totalBets
 *   7. SUM(dailyStat.totalPayout) == agent.totalPayout
 *   8. No bet is assigned to a dailyStatistic from a different day
 *
 * Usage:
 *   1. Run the queries below for one agent address.
 *   2. Paste results into `agent`, `dailyStats`, and `bets`.
 *   3. Run: node scripts/validate-daily-stats-vs-bets.js
 *
 * Query 1 — Agent:
 *   {
 *     traderAgent(id: "0xAGENT") {
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalPayout
 *     }
 *   }
 *
 * Query 2 — Daily stats with bets:
 *   {
 *     dailyProfitStatistics(
 *       where: { traderAgent: "0xAGENT" }
 *       orderBy: date
 *       orderDirection: asc
 *       first: 1000
 *     ) {
 *       id
 *       date
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalPayout
 *       dailyProfit
 *       bets {
 *         id
 *         amount
 *         feeAmount
 *         blockTimestamp
 *       }
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const agent = {
  // totalBets: 100,
  // totalTraded: "1000000000000000000",
  // totalFees: "50000000000000000",
  // totalPayout: "500000000000000000",
};

const dailyStats = [
  // Paste dailyProfitStatistics array here
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

// ──── VALIDATION 1: Daily Stats vs Their Bets ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Daily Stats Activity vs Bets Placed That Day");
console.log("════════════════════════════════════════════════════════════\n");

let issues = 0;

for (const day of dailyStats) {
  const bets = day.bets || [];
  const date = Number(day.date);

  // Sum bets
  let sumAmount = 0n;
  let sumFees = 0n;
  let wrongDayBets = 0;

  for (const bet of bets) {
    sumAmount += bn(bet.amount);
    sumFees += bn(bet.feeAmount);

    // Check bet is assigned to correct day
    const betDay = getDayTimestamp(bet.blockTimestamp);
    if (betDay !== date) {
      wrongDayBets++;
    }
  }

  const betsCountMatch = bets.length === Number(day.totalBets || 0);
  const tradedMatch = sumAmount === bn(day.totalTraded);
  const feesMatch = sumFees === bn(day.totalFees);

  if (!betsCountMatch || !tradedMatch || !feesMatch || wrongDayBets > 0) {
    issues++;
    console.log(`  ${fmtDate(day.date)} (${day.id}):`);
    if (!betsCountMatch) {
      console.log(`    totalBets: stat=${day.totalBets} bets.length=${bets.length}`);
    }
    if (!tradedMatch) {
      console.log(`    totalTraded: stat=${fmt(bn(day.totalTraded))} sum=${fmt(sumAmount)} delta=${fmt(bn(day.totalTraded) - sumAmount)}`);
    }
    if (!feesMatch) {
      console.log(`    totalFees: stat=${fmt(bn(day.totalFees))} sum=${fmt(sumFees)} delta=${fmt(bn(day.totalFees) - sumFees)}`);
    }
    if (wrongDayBets > 0) {
      console.log(`    ${wrongDayBets} bet(s) assigned to wrong day!`);
    }
  }
}

if (issues === 0) {
  console.log("  All daily stats match their bets.\n");
} else {
  console.log(`\n  ── Issues found: ${issues} ──\n`);
}

// ──── VALIDATION 2: Sum of Daily Stats vs Agent Totals ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Sum of Daily Stats vs Agent Totals");
console.log("════════════════════════════════════════════════════════════\n");

let issues2 = 0;

const sumDailyBets = dailyStats.reduce((acc, d) => acc + Number(d.totalBets || 0), 0);
const sumDailyTraded = dailyStats.reduce((acc, d) => acc + bn(d.totalTraded), 0n);
const sumDailyFees = dailyStats.reduce((acc, d) => acc + bn(d.totalFees), 0n);
const sumDailyPayout = dailyStats.reduce((acc, d) => acc + bn(d.totalPayout), 0n);

const checks = [
  { name: "totalBets", agentVal: Number(agent.totalBets || 0), sumVal: sumDailyBets, isBigInt: false },
  { name: "totalTraded", agentVal: bn(agent.totalTraded), sumVal: sumDailyTraded, isBigInt: true },
  { name: "totalFees", agentVal: bn(agent.totalFees), sumVal: sumDailyFees, isBigInt: true },
  { name: "totalPayout", agentVal: bn(agent.totalPayout), sumVal: sumDailyPayout, isBigInt: true },
];

for (const c of checks) {
  if (c.isBigInt) {
    const match = c.agentVal === c.sumVal;
    if (!match) issues2++;
    console.log(`  ${c.name.padEnd(16)} agent=${fmt(c.agentVal).padEnd(20)} sumDaily=${fmt(c.sumVal).padEnd(20)} ${match ? "OK" : "MISMATCH (delta=" + fmt(c.agentVal - c.sumVal) + ")"}`);
  } else {
    const match = c.agentVal === c.sumVal;
    if (!match) issues2++;
    console.log(`  ${c.name.padEnd(16)} agent=${String(c.agentVal).padEnd(20)} sumDaily=${String(c.sumVal).padEnd(20)} ${match ? "OK" : "MISMATCH (delta=" + (c.agentVal - c.sumVal) + ")"}`);
  }
}

// ──── VALIDATION 3: Duplicate Dates ────

console.log("\n════════════════════════════════════════════════════════════");
console.log("  Duplicate Date Check");
console.log("════════════════════════════════════════════════════════════\n");

const dateMap = new Map();
let dupes = 0;
for (const day of dailyStats) {
  const key = day.date;
  if (dateMap.has(key)) {
    dupes++;
    console.log(`  Duplicate date: ${fmtDate(key)} (IDs: ${dateMap.get(key)}, ${day.id})`);
  }
  dateMap.set(key, day.id);
}

if (dupes === 0) {
  console.log("  No duplicate dates found.\n");
} else {
  console.log(`\n  ── Duplicates: ${dupes} ──\n`);
}

// ──── SUMMARY ────

const total = issues + issues2 + dupes;
console.log("════════════════════════════════════════════════════════════");
console.log(`  TOTAL ISSUES: ${total}`);
console.log("════════════════════════════════════════════════════════════\n");
