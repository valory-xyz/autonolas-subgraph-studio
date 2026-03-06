/**
 * Validate that TraderAgent totals equal the sum of all their MarketParticipant totals.
 *
 * Checks:
 *   1. agent.totalTraded == SUM(participant.totalTraded)
 *   2. agent.totalFees == SUM(participant.totalFees)
 *   3. agent.totalTradedSettled == SUM(participant.totalTradedSettled)
 *   4. agent.totalFeesSettled == SUM(participant.totalFeesSettled)
 *   5. agent.totalPayout == SUM(participant.totalPayout)
 *   6. agent.totalExpectedPayout == SUM(participant.expectedPayout)
 *   7. agent.totalBets == SUM(participant.totalBets)
 *
 * Usage:
 *   1. Run the queries below for one agent address.
 *   2. Paste results into `agent` and `participants`.
 *   3. Run: node scripts/validate-agent-vs-participants.js
 *
 * Query 1 — Agent:
 *   {
 *     traderAgent(id: "0xAGENT") {
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
 * Query 2 — All market participants for the agent:
 *   {
 *     marketParticipants(
 *       where: { traderAgent: "0xAGENT" }
 *       first: 1000
 *       orderBy: createdAt
 *     ) {
 *       id
 *       fixedProductMarketMaker { id, question }
 *       totalBets
 *       totalTraded
 *       totalFees
 *       totalTradedSettled
 *       totalFeesSettled
 *       totalPayout
 *       expectedPayout
 *       settled
 *     }
 *   }
 */

// ──── PASTE YOUR DATA HERE ────

const agent = {
  // totalBets: 100,
  // totalTraded: "1000000000000000000",
  // totalFees: "50000000000000000",
  // totalTradedSettled: "800000000000000000",
  // totalFeesSettled: "40000000000000000",
  // totalPayout: "500000000000000000",
  // totalExpectedPayout: "600000000000000000",
};

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

// ──── VALIDATION ────

console.log("════════════════════════════════════════════════════════════");
console.log("  Agent Totals vs Sum of MarketParticipant Totals");
console.log("════════════════════════════════════════════════════════════\n");

const fields = [
  { agent: "totalBets", participant: "totalBets", isBigInt: false },
  { agent: "totalTraded", participant: "totalTraded", isBigInt: true },
  { agent: "totalFees", participant: "totalFees", isBigInt: true },
  { agent: "totalTradedSettled", participant: "totalTradedSettled", isBigInt: true },
  { agent: "totalFeesSettled", participant: "totalFeesSettled", isBigInt: true },
  { agent: "totalPayout", participant: "totalPayout", isBigInt: true },
  { agent: "totalExpectedPayout", participant: "expectedPayout", isBigInt: true },
];

let issues = 0;

for (const f of fields) {
  if (f.isBigInt) {
    const agentVal = bn(agent[f.agent]);
    const sumVal = participants.reduce((acc, p) => acc + bn(p[f.participant]), 0n);
    const match = agentVal === sumVal;
    if (!match) issues++;
    console.log(`  ${f.agent.padEnd(22)} agent=${fmt(agentVal).padEnd(20)} sum=${fmt(sumVal).padEnd(20)} ${match ? "OK" : "MISMATCH (delta=" + fmt(agentVal - sumVal) + ")"}`);
  } else {
    const agentVal = Number(agent[f.agent] || 0);
    const sumVal = participants.reduce((acc, p) => acc + Number(p[f.participant] || 0), 0);
    const match = agentVal === sumVal;
    if (!match) issues++;
    console.log(`  ${f.agent.padEnd(22)} agent=${String(agentVal).padEnd(20)} sum=${String(sumVal).padEnd(20)} ${match ? "OK" : "MISMATCH (delta=" + (agentVal - sumVal) + ")"}`);
  }
}

// ──── SETTLED CONSISTENCY ────

console.log("\n════════════════════════════════════════════════════════════");
console.log("  Settled Consistency per Market");
console.log("════════════════════════════════════════════════════════════\n");

let settledIssues = 0;

for (const p of participants) {
  const marketId = p.fixedProductMarketMaker?.id || "unknown";
  const question = (p.fixedProductMarketMaker?.question || "").slice(0, 50);

  // If settled, totalTradedSettled should equal totalTraded
  if (p.settled) {
    const traded = bn(p.totalTraded);
    const tradedSettled = bn(p.totalTradedSettled);
    const fees = bn(p.totalFees);
    const feesSettled = bn(p.totalFeesSettled);

    if (traded !== tradedSettled) {
      settledIssues++;
      console.log(`  ${marketId.slice(0, 10)}... ${question}`);
      console.log(`    SETTLED but totalTraded(${fmt(traded)}) != totalTradedSettled(${fmt(tradedSettled)})`);
    }
    if (fees !== feesSettled) {
      settledIssues++;
      console.log(`  ${marketId.slice(0, 10)}... ${question}`);
      console.log(`    SETTLED but totalFees(${fmt(fees)}) != totalFeesSettled(${fmt(feesSettled)})`);
    }
  }

  // totalTradedSettled should never exceed totalTraded
  if (bn(p.totalTradedSettled) > bn(p.totalTraded)) {
    settledIssues++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    totalTradedSettled(${fmt(bn(p.totalTradedSettled))}) > totalTraded(${fmt(bn(p.totalTraded))})`);
  }
  if (bn(p.totalFeesSettled) > bn(p.totalFees)) {
    settledIssues++;
    console.log(`  ${marketId.slice(0, 10)}... ${question}`);
    console.log(`    totalFeesSettled(${fmt(bn(p.totalFeesSettled))}) > totalFees(${fmt(bn(p.totalFees))})`);
  }
}

// Agent-level: settled should not exceed total
const agentTradedSettled = bn(agent.totalTradedSettled);
const agentTraded = bn(agent.totalTraded);
if (agentTradedSettled > agentTraded) {
  settledIssues++;
  console.log(`  Agent: totalTradedSettled(${fmt(agentTradedSettled)}) > totalTraded(${fmt(agentTraded)})`);
}

if (settledIssues === 0) {
  console.log("  All settled markets have consistent totals.\n");
} else {
  console.log(`\n  ── Total issues: ${settledIssues} ──\n`);
}

// ──── SUMMARY ────

console.log("════════════════════════════════════════════════════════════");
console.log(`  TOTAL ISSUES: ${issues + settledIssues}`);
console.log("════════════════════════════════════════════════════════════\n");
