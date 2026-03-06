#!/usr/bin/env node
/**
 * Validate all data consistency for a single TraderAgent.
 *
 * Checks:
 *   1. Agent totals vs sum of MarketParticipant totals
 *   2. Settled consistency per market (settled => tradedSettled == traded)
 *   3. Bet sums vs participant totals (amounts, share balances)
 *   4. Expected payout recalculation from share balances + winning outcome
 *   5. Bet flag consistency (countedInProfit/countedInTotal vs settlement)
 *   6. Sell bet sign conventions
 *   7. Daily stats activity vs bets placed that day
 *   8. Sum of daily stats vs agent totals
 *   9. Sum(dailyProfit) vs agent expected profit vs participant expected profit
 *  10. Profit participants completeness (settled markets appear in some day)
 *  11. Daily payout sum vs agent totalPayout
 *
 * Usage:
 *   node scripts/validate-agent.js <subgraph-url> <agent-address>
 *
 * Example:
 *   node scripts/validate-agent.js https://api.studio.thegraph.com/query/xxx/predict-polymarket/version/latest 0x1234...
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
const fmtDate = (ts) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
const ONE_DAY = 86400;
const getDayTimestamp = (ts) => Math.floor(Number(ts) / ONE_DAY) * ONE_DAY;

function calcExpectedPayout(winningIndex, shares0, shares1) {
  if (winningIndex === 0n) return shares0 > 0n ? shares0 : 0n;
  if (winningIndex === 1n) return shares1 > 0n ? shares1 : 0n;
  // Invalid (-1): each share worth 1/2 collateral
  const p0 = shares0 > 0n ? shares0 / 2n : 0n;
  const p1 = shares1 > 0n ? shares1 / 2n : 0n;
  return p0 + p1;
}

async function gqlQuery(url, q) {
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

async function paginateByIdGt(url, entityName, whereBase, fields, pageSize = 1000) {
  let all = [];
  let lastId = "";
  while (true) {
    const idFilter = lastId ? `, id_gt: "${lastId}"` : "";
    const q = `{ ${entityName}(first: ${pageSize}, orderBy: id, orderDirection: asc, where: { ${whereBase}${idFilter} }) { id ${fields} } }`;
    const data = await gqlQuery(url, q);
    const batch = data[entityName];
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < pageSize) break;
  }
  return all;
}

function heading(num, title) {
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  ${num}. ${title}`);
  console.log(`════════════════════════════════════════════════════════════\n`);
}

// ──── MAIN ────

async function main() {
  const url = process.argv[2];
  const address = process.argv[3];
  if (!url || !address) {
    console.error("Usage: node scripts/validate-agent.js <subgraph-url> <agent-address>");
    process.exit(1);
  }

  const addr = address.toLowerCase();
  console.log(`\n  Fetching data for agent ${addr}...\n`);

  // Fetch agent, participants (with bets), and daily stats in parallel
  const [agentData, participants, dailyStats] = await Promise.all([
    gqlQuery(url, `{
      traderAgent(id: "${addr}") {
        id
        totalBets
        totalTraded
        totalTradedSettled
        totalPayout
        totalExpectedPayout
        firstParticipation
      }
    }`),
    paginateByIdGt(url, "marketParticipants", `traderAgent: "${addr}"`, `
      question {
        id
        questionId
        metadata { title }
        resolution { winningIndex }
      }
      totalBets
      totalTraded
      totalTradedSettled
      totalPayout
      outcomeShares0
      outcomeShares1
      expectedPayout
      settled
      bets {
        id
        outcomeIndex
        amount
        shares
        isBuy
        countedInProfit
        countedInTotal
        blockTimestamp
      }
    `),
    paginateByIdGt(url, "dailyProfitStatistics", `traderAgent: "${addr}"`, `
      date
      totalBets
      totalTraded
      totalPayout
      dailyProfit
      profitParticipants { id }
      bets {
        id
        amount
        blockTimestamp
      }
    `),
  ]);

  const agent = agentData.traderAgent;
  if (!agent) {
    console.error(`  Agent ${addr} not found.`);
    process.exit(1);
  }

  console.log(`  Fetched: ${participants.length} market participations, ${dailyStats.length} daily stats\n`);

  let totalIssues = 0;

  // Build lookup
  const participantByQuestion = new Map();
  for (const p of participants) {
    const qId = p.question?.id;
    if (qId) participantByQuestion.set(qId, p);
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK 1: Agent totals vs sum of MarketParticipant totals
  // ════════════════════════════════════════════════════════════════

  heading(1, "Agent Totals vs Sum of MarketParticipant Totals");

  const fieldMappings = [
    { agent: "totalBets", participant: "totalBets", isBigInt: false },
    { agent: "totalTraded", participant: "totalTraded", isBigInt: true },
    { agent: "totalTradedSettled", participant: "totalTradedSettled", isBigInt: true },
    { agent: "totalPayout", participant: "totalPayout", isBigInt: true },
    { agent: "totalExpectedPayout", participant: "expectedPayout", isBigInt: true },
  ];

  for (const f of fieldMappings) {
    if (f.isBigInt) {
      const agentVal = bn(agent[f.agent]);
      const sumVal = participants.reduce((acc, p) => acc + bn(p[f.participant]), 0n);
      const match = agentVal === sumVal;
      if (!match) totalIssues++;
      console.log(`  ${f.agent.padEnd(22)} agent=${fmt(agentVal).padEnd(18)} sum=${fmt(sumVal).padEnd(18)} ${match ? "OK" : "MISMATCH (" + fmt(agentVal - sumVal) + ")"}`);
    } else {
      const agentVal = Number(agent[f.agent] || 0);
      const sumVal = participants.reduce((acc, p) => acc + Number(p[f.participant] || 0), 0);
      const match = agentVal === sumVal;
      if (!match) totalIssues++;
      console.log(`  ${f.agent.padEnd(22)} agent=${String(agentVal).padEnd(18)} sum=${String(sumVal).padEnd(18)} ${match ? "OK" : "MISMATCH (" + (agentVal - sumVal) + ")"}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK 2: Settled consistency per market
  // ════════════════════════════════════════════════════════════════

  heading(2, "Settled Consistency per Market");

  let settledIssues = 0;

  for (const p of participants) {
    const mid = (p.question?.id || "unknown").slice(0, 10) + "...";
    const title = (p.question?.metadata?.title || "").slice(0, 45);

    if (p.settled) {
      if (bn(p.totalTraded) !== bn(p.totalTradedSettled)) {
        settledIssues++;
        console.log(`  ${mid} ${title}`);
        console.log(`    SETTLED but totalTraded(${fmt(bn(p.totalTraded))}) != totalTradedSettled(${fmt(bn(p.totalTradedSettled))})`);
      }
    }
    if (bn(p.totalTradedSettled) > bn(p.totalTraded)) {
      settledIssues++;
      console.log(`  ${mid} ${title}`);
      console.log(`    totalTradedSettled(${fmt(bn(p.totalTradedSettled))}) > totalTraded(${fmt(bn(p.totalTraded))})`);
    }
  }

  totalIssues += settledIssues;
  if (settledIssues === 0) console.log("  All settled markets have consistent totals.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 3: Bet sums vs participant totals
  // ════════════════════════════════════════════════════════════════

  heading(3, "Bet Sums vs Participant Totals");

  let betSumIssues = 0;

  for (const p of participants) {
    const bets = p.bets || [];
    const mid = (p.question?.id || "unknown").slice(0, 10) + "...";
    const title = (p.question?.metadata?.title || "").slice(0, 45);
    const errs = [];

    let sumAmount = 0n, sumShares0 = 0n, sumShares1 = 0n;
    for (const bet of bets) {
      sumAmount += bn(bet.amount);
      if (bn(bet.outcomeIndex) === 0n) sumShares0 += bn(bet.shares);
      else sumShares1 += bn(bet.shares);
    }

    if (sumAmount !== bn(p.totalTraded)) errs.push(`totalTraded: sum=${fmt(sumAmount)} stored=${fmt(bn(p.totalTraded))}`);
    if (sumShares0 !== bn(p.outcomeShares0)) errs.push(`outcomeShares0: sum=${fmt(sumShares0)} stored=${fmt(bn(p.outcomeShares0))}`);
    if (sumShares1 !== bn(p.outcomeShares1)) errs.push(`outcomeShares1: sum=${fmt(sumShares1)} stored=${fmt(bn(p.outcomeShares1))}`);
    if (bets.length !== Number(p.totalBets || 0)) errs.push(`totalBets: count=${bets.length} stored=${p.totalBets}`);

    if (errs.length > 0) {
      betSumIssues += errs.length;
      console.log(`  ${mid} ${title}`);
      for (const e of errs) console.log(`    ${e}`);
    }
  }

  totalIssues += betSumIssues;
  if (betSumIssues === 0) console.log("  All participant totals match bet sums.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 4: Expected payout recalculation
  // ════════════════════════════════════════════════════════════════

  heading(4, "Expected Payout vs Recalculation from Share Balances");

  let payoutCalcIssues = 0;

  for (const p of participants) {
    if (!p.settled) continue;
    const resolution = p.question?.resolution;
    if (!resolution) continue;

    const winningIndex = bn(resolution.winningIndex);
    const shares0 = bn(p.outcomeShares0);
    const shares1 = bn(p.outcomeShares1);
    const recalc = calcExpectedPayout(winningIndex, shares0, shares1);
    const stored = bn(p.expectedPayout);

    if (recalc !== stored) {
      payoutCalcIssues++;
      const mid = (p.question?.id || "").slice(0, 10) + "...";
      const title = (p.question?.metadata?.title || "").slice(0, 45);
      console.log(`  ${mid} ${title}`);
      console.log(`    stored=${fmt(stored)} recalc=${fmt(recalc)} delta=${fmt(stored - recalc)}`);
      console.log(`    winningIndex=${winningIndex} shares0=${fmt(shares0)} shares1=${fmt(shares1)}`);
    }
  }

  totalIssues += payoutCalcIssues;
  if (payoutCalcIssues === 0) console.log("  All settled markets have correct expectedPayout.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 5: Bet flag consistency
  // ════════════════════════════════════════════════════════════════

  heading(5, "Bet Flag Consistency");

  let flagIssues = 0;

  for (const p of participants) {
    const bets = p.bets || [];
    const mid = (p.question?.id || "unknown").slice(0, 10) + "...";

    for (const bet of bets) {
      const errs = [];

      if (p.settled) {
        if (!bet.countedInProfit) errs.push("settled but countedInProfit=false");
        if (bet.countedInTotal === false) errs.push("settled but countedInTotal=false");
      } else {
        if (bet.countedInProfit) errs.push("unsettled but countedInProfit=true");
        if (bet.countedInTotal === true) errs.push("unsettled but countedInTotal=true");
      }

      if (bet.countedInProfit && bet.countedInTotal === false) {
        errs.push("countedInProfit=true but countedInTotal=false");
      }

      if (errs.length > 0) {
        flagIssues++;
        console.log(`  ${mid} Bet ${(bet.id || "").slice(0, 18)}... ${errs.join(", ")}`);
      }
    }
  }

  totalIssues += flagIssues;
  if (flagIssues === 0) console.log("  All bet flags consistent with settlement status.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 6: Sell bet sign conventions
  // ════════════════════════════════════════════════════════════════

  heading(6, "Sell Bet Sign Conventions");

  let signIssues = 0;

  for (const p of participants) {
    for (const bet of (p.bets || [])) {
      const amount = bn(bet.amount);
      const shares = bn(bet.shares);

      // Buy: positive amount, positive shares
      // Sell: negative amount, negative shares
      if ((amount < 0n && shares > 0n) || (amount > 0n && shares < 0n)) {
        signIssues++;
        console.log(`  Bet ${(bet.id || "").slice(0, 18)}... amount=${fmt(amount)} shares=${fmt(shares)} (sign mismatch)`);
      }

      // isBuy consistency
      if (bet.isBuy && amount < 0n) {
        signIssues++;
        console.log(`  Bet ${(bet.id || "").slice(0, 18)}... isBuy=true but amount is negative`);
      }
      if (!bet.isBuy && amount > 0n) {
        signIssues++;
        console.log(`  Bet ${(bet.id || "").slice(0, 18)}... isBuy=false but amount is positive`);
      }
    }
  }

  totalIssues += signIssues;
  if (signIssues === 0) console.log("  All bets have consistent sign conventions.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 7: Daily stats activity vs bets placed that day
  // ════════════════════════════════════════════════════════════════

  heading(7, "Daily Stats Activity vs Bets Placed That Day");

  let dailyBetIssues = 0;

  for (const day of dailyStats) {
    const bets = day.bets || [];
    const date = Number(day.date);
    let sumAmount = 0n, wrongDay = 0;

    for (const bet of bets) {
      sumAmount += bn(bet.amount);
      if (getDayTimestamp(bet.blockTimestamp) !== date) wrongDay++;
    }

    const errs = [];
    if (bets.length !== Number(day.totalBets || 0)) errs.push(`totalBets: stat=${day.totalBets} bets=${bets.length}`);
    if (sumAmount !== bn(day.totalTraded)) errs.push(`totalTraded: stat=${fmt(bn(day.totalTraded))} sum=${fmt(sumAmount)}`);
    if (wrongDay > 0) errs.push(`${wrongDay} bet(s) assigned to wrong day`);

    if (errs.length > 0) {
      dailyBetIssues++;
      console.log(`  ${fmtDate(day.date)}: ${errs.join(", ")}`);
    }
  }

  totalIssues += dailyBetIssues;
  if (dailyBetIssues === 0) console.log("  All daily stats match their bets.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 8: Sum of daily stats vs agent totals
  // ════════════════════════════════════════════════════════════════

  heading(8, "Sum of Daily Stats vs Agent Totals");

  let dailySumIssues = 0;

  const checks = [
    { name: "totalBets", agentVal: Number(agent.totalBets || 0), sumVal: dailyStats.reduce((a, d) => a + Number(d.totalBets || 0), 0), isBigInt: false },
    { name: "totalTraded", agentVal: bn(agent.totalTraded), sumVal: dailyStats.reduce((a, d) => a + bn(d.totalTraded), 0n), isBigInt: true },
    { name: "totalPayout", agentVal: bn(agent.totalPayout), sumVal: dailyStats.reduce((a, d) => a + bn(d.totalPayout), 0n), isBigInt: true },
  ];

  for (const c of checks) {
    const match = c.isBigInt ? c.agentVal === c.sumVal : c.agentVal === c.sumVal;
    if (!match) dailySumIssues++;
    const agStr = c.isBigInt ? fmt(c.agentVal) : String(c.agentVal);
    const sumStr = c.isBigInt ? fmt(c.sumVal) : String(c.sumVal);
    const delta = c.isBigInt ? fmt(c.agentVal - c.sumVal) : String(c.agentVal - c.sumVal);
    console.log(`  ${c.name.padEnd(16)} agent=${agStr.padEnd(18)} sumDaily=${sumStr.padEnd(18)} ${match ? "OK" : "MISMATCH (" + delta + ")"}`);
  }

  totalIssues += dailySumIssues;

  // ════════════════════════════════════════════════════════════════
  // CHECK 9: Profit consistency (three-way match)
  // ════════════════════════════════════════════════════════════════

  heading(9, "Profit Consistency (Three-Way Match)");

  const sumDailyProfit = dailyStats.reduce((a, d) => a + bn(d.dailyProfit), 0n);
  const agentExpectedProfit = bn(agent.totalExpectedPayout) - bn(agent.totalTradedSettled);
  const participantExpectedProfit = participants
    .filter((p) => p.settled)
    .reduce((a, p) => a + bn(p.expectedPayout) - bn(p.totalTraded), 0n);

  console.log(`  Sum(dailyProfit):                ${fmt(sumDailyProfit)}`);
  console.log(`  Agent expected profit:           ${fmt(agentExpectedProfit)}`);
  console.log(`  Participant sum expected profit:  ${fmt(participantExpectedProfit)}`);

  const m1 = sumDailyProfit === agentExpectedProfit;
  const m2 = sumDailyProfit === participantExpectedProfit;
  const m3 = agentExpectedProfit === participantExpectedProfit;

  if (!m1) { totalIssues++; console.log(`  MISMATCH: dailyProfit vs agent (delta=${fmt(sumDailyProfit - agentExpectedProfit)})`); }
  if (!m2) { totalIssues++; console.log(`  MISMATCH: dailyProfit vs participants (delta=${fmt(sumDailyProfit - participantExpectedProfit)})`); }
  if (!m3) { totalIssues++; console.log(`  MISMATCH: agent vs participants (delta=${fmt(agentExpectedProfit - participantExpectedProfit)})`); }
  if (m1 && m2 && m3) console.log("  All three match.");

  // Unsettled & claim rate info
  const unsettled = bn(agent.totalTraded) - bn(agent.totalTradedSettled);
  if (unsettled > 0n) console.log(`\n  Info: ${fmt(unsettled)} USDC in unsettled trades`);
  const expectedPayout = bn(agent.totalExpectedPayout);
  if (expectedPayout > 0n) {
    const rate = Number(bn(agent.totalPayout) * 10000n / expectedPayout) / 100;
    console.log(`  Info: Claim rate: ${rate}%`);
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK 10: Profit participants completeness
  // ════════════════════════════════════════════════════════════════

  heading(10, "Profit Participants Completeness");

  const settledQuestionIds = new Set(
    participants.filter((p) => p.settled).map((p) => p.question?.id).filter(Boolean)
  );
  const profitParticipantIds = new Set();
  for (const day of dailyStats) {
    for (const pp of (day.profitParticipants || [])) profitParticipantIds.add(pp.id);
  }

  let missingCount = 0;
  for (const id of settledQuestionIds) {
    if (!profitParticipantIds.has(id)) {
      missingCount++;
      const p = participantByQuestion.get(id);
      console.log(`  Missing: ${id.slice(0, 10)}... ${(p?.question?.metadata?.title || "").slice(0, 45)}`);
    }
  }

  totalIssues += missingCount;
  if (missingCount === 0) console.log("  All settled markets appear in profitParticipants.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 11: Daily payout sum vs agent totalPayout
  // ════════════════════════════════════════════════════════════════

  heading(11, "Daily Payout Sum vs Agent totalPayout");

  const sumDailyPayout = dailyStats.reduce((a, d) => a + bn(d.totalPayout), 0n);
  const agentPayout = bn(agent.totalPayout);
  const payoutMatch = sumDailyPayout === agentPayout;
  if (!payoutMatch) totalIssues++;
  console.log(`  Sum(daily.totalPayout) = ${fmt(sumDailyPayout)}`);
  console.log(`  Agent.totalPayout      = ${fmt(agentPayout)}`);
  console.log(`  ${payoutMatch ? "OK" : "MISMATCH (delta=" + fmt(sumDailyPayout - agentPayout) + ")"}`);

  // ──── FINAL SUMMARY ────

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TOTAL ISSUES: ${totalIssues}`);
  console.log(`${"═".repeat(60)}\n`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
