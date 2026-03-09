/**
 * Validate dailyProfit consistency for a trader agent.
 *
 * Usage:
 *   1. Run the two GraphQL queries below for the same agent address.
 *   2. Paste the results into `dailyStats` and `agent` below.
 *   3. Run: node scripts/validate-profit.js
 *
 * Query 1 — Daily stats:
 *   {
 *     dailyProfitStatistics(
 *       where: { traderAgent: "0xAGENT" }
 *       orderBy: date
 *       orderDirection: asc
 *       first: 1000
 *     ) {
 *       date
 *       dailyProfit
 *       totalPayout
 *     }
 *   }
 *
 * Query 2 — Agent totals:
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

const dailyStats = [
  // { date: "1700000000", dailyProfit: "-500000000000000000", totalPayout: "0" },
  // { date: "1700086400", dailyProfit: "200000000000000000", totalPayout: "700000000000000000" },
];

const agent = {
  // totalTraded: "1000000000000000000",
  // totalTradedSettled: "1000000000000000000",
  // totalFees: "50000000000000000",
  // totalFeesSettled: "50000000000000000",
  // totalPayout: "700000000000000000",
  // totalExpectedPayout: "700000000000000000",
};

// ──── VALIDATION ────

const bn = (s) => BigInt(s || "0");

const sumDailyProfit = dailyStats.reduce((acc, d) => acc + bn(d.dailyProfit), 0n);
const sumDailyPayout = dailyStats.reduce((acc, d) => acc + bn(d.totalPayout), 0n);

const expectedProfit = bn(agent.totalExpectedPayout) - bn(agent.totalTradedSettled) - bn(agent.totalFeesSettled);

const fmt = (wei) => {
  const sign = wei < 0n ? "-" : "";
  const abs = wei < 0n ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0";
  return `${sign}${whole}.${frac}`;
};

console.log("═══ Daily Stats Summary ═══");
console.log(`  Days with data:        ${dailyStats.length}`);
console.log(`  Sum of dailyProfit:    ${fmt(sumDailyProfit)} xDAI`);
console.log(`  Sum of totalPayout:    ${fmt(sumDailyPayout)} xDAI`);

console.log("\n═══ Agent Totals ═══");
console.log(`  totalExpectedPayout:   ${fmt(bn(agent.totalExpectedPayout))} xDAI`);
console.log(`  totalTradedSettled:    ${fmt(bn(agent.totalTradedSettled))} xDAI`);
console.log(`  totalFeesSettled:      ${fmt(bn(agent.totalFeesSettled))} xDAI`);
console.log(`  totalPayout (actual):  ${fmt(bn(agent.totalPayout))} xDAI`);

console.log("\n═══ Validation ═══");
console.log(`  Expected profit (agent-level):  ${fmt(expectedProfit)} xDAI`);
console.log(`  Sum of dailyProfit:             ${fmt(sumDailyProfit)} xDAI`);

const profitMatch = sumDailyProfit === expectedProfit;
console.log(`  Profit match:  ${profitMatch ? "OK" : "MISMATCH"}`);
if (!profitMatch) {
  console.log(`  Delta:         ${fmt(sumDailyProfit - expectedProfit)} xDAI`);
}

const payoutMatch = sumDailyPayout === bn(agent.totalPayout);
console.log(`  Payout match:  ${payoutMatch ? "OK" : "MISMATCH"}`);
if (!payoutMatch) {
  console.log(`  Delta:         ${fmt(sumDailyPayout - bn(agent.totalPayout))} xDAI`);
}

const claimRate = bn(agent.totalExpectedPayout) > 0n
  ? Number(bn(agent.totalPayout) * 10000n / bn(agent.totalExpectedPayout)) / 100
  : 0;
console.log(`  Claim rate:    ${claimRate}% (actual / expected payout)`);

const unsettled = bn(agent.totalTraded) - bn(agent.totalTradedSettled);
if (unsettled > 0n) {
  console.log(`\n  Warning: ${fmt(unsettled)} xDAI in unsettled trades (open markets)`);
}
