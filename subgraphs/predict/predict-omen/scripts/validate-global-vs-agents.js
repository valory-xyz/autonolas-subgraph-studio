/**
 * Validate that Global totals equal the sum of all TraderAgent totals.
 *
 * Checks:
 *   1. global.totalBets == SUM(agent.totalBets)
 *   2. global.totalTraded == SUM(agent.totalTraded)
 *   3. global.totalFees == SUM(agent.totalFees)
 *   4. global.totalTradedSettled == SUM(agent.totalTradedSettled)
 *   5. global.totalFeesSettled == SUM(agent.totalFeesSettled)
 *   6. global.totalPayout == SUM(agent.totalPayout)
 *   7. global.totalExpectedPayout == SUM(agent.totalExpectedPayout)
 *   8. global.totalActiveTraderAgents == count of agents with firstParticipation != null
 *
 * Usage:
 *   1. Run the queries below.
 *   2. Paste results into `global` and `agents`.
 *   3. Run: node scripts/validate-global-vs-agents.js
 *
 * Query 1 — Global:
 *   {
 *     globals {
 *       totalTraderAgents
 *       totalActiveTraderAgents
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalTradedSettled
 *       totalFeesSettled
 *       totalPayout
 *       totalExpectedPayout
 *     }
 *   }
 *
 * Query 2 — All agents (paginate if >1000):
 *   {
 *     traderAgents(first: 1000, orderBy: blockTimestamp) {
 *       id
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalTradedSettled
 *       totalFeesSettled
 *       totalPayout
 *       totalExpectedPayout
 *       firstParticipation
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const global = {
  // totalTraderAgents: 50,
  // totalActiveTraderAgents: 30,
  // totalBets: 5000,
  // totalTraded: "100000000000000000000",
  // totalFees: "5000000000000000000",
  // totalTradedSettled: "80000000000000000000",
  // totalFeesSettled: "4000000000000000000",
  // totalPayout: "60000000000000000000",
  // totalExpectedPayout: "70000000000000000000",
};

const agents = [
  // Paste traderAgents array here
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

// ──── VALIDATION 1: Global vs Sum of Agents ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Global Totals vs Sum of TraderAgent Totals");
console.log("════════════════════════════════════════════════════════════\n");

const bigIntFields = [
  "totalTraded",
  "totalFees",
  "totalTradedSettled",
  "totalFeesSettled",
  "totalPayout",
  "totalExpectedPayout",
];

let issues = 0;

// Int fields
const globalBets = Number(global.totalBets || 0);
const sumBets = agents.reduce((acc, a) => acc + Number(a.totalBets || 0), 0);
const betsMatch = globalBets === sumBets;
if (!betsMatch) issues++;
console.log(`  totalBets              global=${String(globalBets).padEnd(20)} sum=${String(sumBets).padEnd(20)} ${betsMatch ? "OK" : "MISMATCH (delta=" + (globalBets - sumBets) + ")"}`);

// BigInt fields
for (const field of bigIntFields) {
  const globalVal = bn(global[field]);
  const sumVal = agents.reduce((acc, a) => acc + bn(a[field]), 0n);
  const match = globalVal === sumVal;
  if (!match) issues++;
  console.log(`  ${field.padEnd(22)} global=${fmt(globalVal).padEnd(20)} sum=${fmt(sumVal).padEnd(20)} ${match ? "OK" : "MISMATCH (delta=" + fmt(globalVal - sumVal) + ")"}`);
}

// Agent counts
const totalAgents = agents.length;
const activeAgents = agents.filter((a) => a.firstParticipation !== null && a.firstParticipation !== undefined).length;

const agentCountMatch = Number(global.totalTraderAgents || 0) === totalAgents;
const activeCountMatch = Number(global.totalActiveTraderAgents || 0) === activeAgents;

if (!agentCountMatch) issues++;
if (!activeCountMatch) issues++;
console.log(`  totalTraderAgents      global=${String(global.totalTraderAgents || 0).padEnd(20)} count=${String(totalAgents).padEnd(20)} ${agentCountMatch ? "OK" : "MISMATCH"}`);
console.log(`  totalActiveTraderAgents global=${String(global.totalActiveTraderAgents || 0).padEnd(20)} count=${String(activeAgents).padEnd(20)} ${activeCountMatch ? "OK" : "MISMATCH"}`);

// ──── VALIDATION 2: Per-Agent Sanity ────

console.log("\n════════════════════════════════════════════════════════════");
console.log("  Per-Agent Sanity Checks");
console.log("════════════════════════════════════════════════════════════\n");

let agentIssues = 0;

for (const a of agents) {
  const errs = [];

  // totalTradedSettled should not exceed totalTraded (for positive totalTraded)
  const traded = bn(a.totalTraded);
  const tradedSettled = bn(a.totalTradedSettled);
  if (traded > 0n && tradedSettled > traded) {
    errs.push(`totalTradedSettled(${fmt(tradedSettled)}) > totalTraded(${fmt(traded)})`);
  }

  // totalFeesSettled should not exceed totalFees (for positive totalFees)
  const fees = bn(a.totalFees);
  const feesSettled = bn(a.totalFeesSettled);
  if (fees > 0n && feesSettled > fees) {
    errs.push(`totalFeesSettled(${fmt(feesSettled)}) > totalFees(${fmt(fees)})`);
  }

  // totalPayout should not be negative
  const payout = bn(a.totalPayout);
  if (payout < 0n) {
    errs.push(`totalPayout is negative: ${fmt(payout)}`);
  }

  // expectedPayout should not be negative
  const expected = bn(a.totalExpectedPayout);
  if (expected < 0n) {
    errs.push(`totalExpectedPayout is negative: ${fmt(expected)}`);
  }

  // If agent has bets but no firstParticipation
  if (Number(a.totalBets || 0) > 0 && (a.firstParticipation === null || a.firstParticipation === undefined)) {
    errs.push("has bets but no firstParticipation");
  }

  if (errs.length > 0) {
    agentIssues += errs.length;
    console.log(`  Agent ${a.id}:`);
    for (const e of errs) {
      console.log(`    ${e}`);
    }
  }
}

if (agentIssues === 0) {
  console.log("  All agents pass sanity checks.\n");
} else {
  console.log(`\n  ── Total agent issues: ${agentIssues} ──\n`);
}

// ──── SUMMARY ────

console.log("════════════════════════════════════════════════════════════");
console.log(`  TOTAL ISSUES: ${issues + agentIssues}`);
console.log("════════════════════════════════════════════════════════════\n");
