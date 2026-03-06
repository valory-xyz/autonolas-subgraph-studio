#!/usr/bin/env node
/**
 * Validate Global entity consistency against all TraderAgent entities.
 *
 * Usage:
 *   node scripts/validate-global.js <subgraph-url>
 *
 * Example:
 *   node scripts/validate-global.js https://api.studio.thegraph.com/query/xxx/predict-polymarket/version/latest
 */

// ──── HELPERS ────

const bn = (s) => BigInt(s || "0");
const fmt = (wei) => {
  const sign = wei < 0n ? "-" : "";
  const abs = wei < 0n ? -wei : wei;
  const whole = abs / 10n ** 6n;
  const frac = (abs % 10n ** 6n).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${sign}${whole}.${frac}`;
};

async function query(url, q) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data;
}

async function paginate(url, entityName, fields, pageSize = 1000) {
  let all = [];
  let lastId = "";
  while (true) {
    const whereClause = lastId ? `where: { id_gt: "${lastId}" }` : "";
    const q = `{ ${entityName}(first: ${pageSize}, orderBy: id, orderDirection: asc, ${whereClause}) { id ${fields} } }`;
    const data = await query(url, q);
    const batch = data[entityName];
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < pageSize) break;
  }
  return all;
}

// ──── MAIN ────

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/validate-global.js <subgraph-url>");
    process.exit(1);
  }

  console.log(`\n  Fetching data from subgraph...\n`);

  // Fetch global and all agents
  const [globalData, agents] = await Promise.all([
    query(url, `{
      globals {
        totalTraderAgents
        totalActiveTraderAgents
        totalBets
        totalTraded
        totalTradedSettled
        totalPayout
        totalExpectedPayout
        totalMarketsParticipated
      }
    }`),
    paginate(url, "traderAgents", `
      totalBets
      totalTraded
      totalTradedSettled
      totalPayout
      totalExpectedPayout
      firstParticipation
    `),
  ]);

  const global = globalData.globals[0];
  if (!global) {
    console.error("  No Global entity found.");
    process.exit(1);
  }

  console.log(`  Fetched: ${agents.length} agents\n`);

  let totalIssues = 0;

  // ──── CHECK 1: Global vs Sum of Agents ────

  console.log("════════════════════════════════════════════════════════════");
  console.log("  1. Global Totals vs Sum of TraderAgent Totals");
  console.log("════════════════════════════════════════════════════════════\n");

  const bigIntFields = [
    "totalTraded", "totalTradedSettled",
    "totalPayout", "totalExpectedPayout",
  ];

  // totalBets (int)
  const globalBets = Number(global.totalBets || 0);
  const sumBets = agents.reduce((acc, a) => acc + Number(a.totalBets || 0), 0);
  const betsMatch = globalBets === sumBets;
  if (!betsMatch) totalIssues++;
  console.log(`  totalBets              global=${String(globalBets).padEnd(15)} sum=${String(sumBets).padEnd(15)} ${betsMatch ? "OK" : "MISMATCH (" + (globalBets - sumBets) + ")"}`);

  for (const field of bigIntFields) {
    const globalVal = bn(global[field]);
    const sumVal = agents.reduce((acc, a) => acc + bn(a[field]), 0n);
    const match = globalVal === sumVal;
    if (!match) totalIssues++;
    console.log(`  ${field.padEnd(22)} global=${fmt(globalVal).padEnd(15)} sum=${fmt(sumVal).padEnd(15)} ${match ? "OK" : "MISMATCH (" + fmt(globalVal - sumVal) + ")"}`);
  }

  // Agent counts
  const agentCount = agents.length;
  const activeCount = agents.filter((a) => a.firstParticipation != null).length;
  const countMatch = Number(global.totalTraderAgents || 0) === agentCount;
  const activeMatch = Number(global.totalActiveTraderAgents || 0) === activeCount;
  if (!countMatch) totalIssues++;
  if (!activeMatch) totalIssues++;
  console.log(`  totalTraderAgents      global=${String(global.totalTraderAgents || 0).padEnd(15)} count=${String(agentCount).padEnd(15)} ${countMatch ? "OK" : "MISMATCH"}`);
  console.log(`  totalActiveTraderAgents global=${String(global.totalActiveTraderAgents || 0).padEnd(15)} count=${String(activeCount).padEnd(15)} ${activeMatch ? "OK" : "MISMATCH"}`);

  // ──── CHECK 2: Per-Agent Sanity ────

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  2. Per-Agent Sanity Checks");
  console.log("════════════════════════════════════════════════════════════\n");

  let agentIssues = 0;

  for (const a of agents) {
    const errs = [];
    const traded = bn(a.totalTraded);
    const tradedSettled = bn(a.totalTradedSettled);
    const payout = bn(a.totalPayout);
    const expected = bn(a.totalExpectedPayout);

    if (traded > 0n && tradedSettled > traded)
      errs.push(`totalTradedSettled(${fmt(tradedSettled)}) > totalTraded(${fmt(traded)})`);
    if (payout < 0n)
      errs.push(`totalPayout is negative: ${fmt(payout)}`);
    if (expected < 0n)
      errs.push(`totalExpectedPayout is negative: ${fmt(expected)}`);
    if (Number(a.totalBets || 0) > 0 && a.firstParticipation == null)
      errs.push("has bets but no firstParticipation");

    if (errs.length > 0) {
      agentIssues += errs.length;
      console.log(`  Agent ${a.id}:`);
      for (const e of errs) console.log(`    ${e}`);
    }
  }

  totalIssues += agentIssues;

  if (agentIssues === 0) {
    console.log("  All agents pass sanity checks.\n");
  } else {
    console.log(`\n  Agent issues: ${agentIssues}\n`);
  }

  // ──── CHECK 3: Global Invariants ────

  console.log("════════════════════════════════════════════════════════════");
  console.log("  3. Global Invariants");
  console.log("════════════════════════════════════════════════════════════\n");

  const gTraded = bn(global.totalTraded);
  const gTradedSettled = bn(global.totalTradedSettled);
  const gPayout = bn(global.totalPayout);
  const gExpected = bn(global.totalExpectedPayout);

  const invariants = [
    { name: "totalTradedSettled <= totalTraded", ok: gTradedSettled <= gTraded, detail: `${fmt(gTradedSettled)} vs ${fmt(gTraded)}` },
    { name: "totalPayout >= 0", ok: gPayout >= 0n, detail: fmt(gPayout) },
    { name: "totalExpectedPayout >= 0", ok: gExpected >= 0n, detail: fmt(gExpected) },
  ];

  for (const inv of invariants) {
    if (!inv.ok) totalIssues++;
    console.log(`  ${inv.name.padEnd(35)} ${inv.ok ? "OK" : "FAIL (" + inv.detail + ")"}`);
  }

  // Unsettled volume
  const unsettled = gTraded - gTradedSettled;
  if (unsettled > 0n) {
    console.log(`\n  Info: ${fmt(unsettled)} USDC in unsettled trades (open markets)`);
  }

  // Settlement rate
  if (gTraded > 0n) {
    const rate = Number(gTradedSettled * 10000n / gTraded) / 100;
    console.log(`  Info: Settlement rate: ${rate}%`);
  }

  // Claim rate
  if (gExpected > 0n) {
    const rate = Number(gPayout * 10000n / gExpected) / 100;
    console.log(`  Info: Claim rate: ${rate}% (actual payout / expected payout)`);
  }

  // ──── SUMMARY ────

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  TOTAL ISSUES: ${totalIssues}`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
