#!/usr/bin/env node
/**
 * Validate all data consistency for a single TraderAgent.
 *
 * Checks:
 *   1. Agent totals vs sum of MarketParticipant totals
 *   2. Settled consistency per market (settled => tradedSettled == traded)
 *   3. Bet sums vs participant totals (amounts, fees, token balances)
 *   4. Expected payout recalculation from token balances + current answer
 *   5. Bet flag consistency (countedInProfit/countedInTotal vs settlement)
 *   6. Sell bet sign conventions
 *   7. Daily stats activity vs bets placed that day
 *   8. Sum of daily stats vs agent totals
 *   9. Sum(dailyProfit) vs agent expected profit vs participant expected profit
 *  10. Profit participants completeness (settled markets appear in some day)
 *  11. Answer change anomalies (payout > expectedPayout)
 *  12. Daily payout sum vs agent totalPayout
 *
 * Usage:
 *   node scripts/validate-agent.js <subgraph-url> <agent-address>
 *
 * Example:
 *   node scripts/validate-agent.js https://api.studio.thegraph.com/query/xxx/predict-omen/version/latest 0x1234...
 */

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

const ANSWER_0 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ANSWER_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";

function calcExpectedPayout(answer, b0, b1) {
  if (answer === ANSWER_0) return b0 > 0n ? b0 : 0n;
  if (answer === ANSWER_1) return b1 > 0n ? b1 : 0n;
  const p0 = b0 > 0n ? b0 / 2n : 0n;
  const p1 = b1 > 0n ? b1 / 2n : 0n;
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
        totalFees
        totalTradedSettled
        totalFeesSettled
        totalPayout
        totalExpectedPayout
        firstParticipation
      }
    }`),
    paginateByIdGt(url, "marketParticipants", `traderAgent: "${addr}"`, `
      fixedProductMarketMaker {
        id
        question
        currentAnswer
        currentAnswerTimestamp
      }
      totalBets
      totalTraded
      totalFees
      totalTradedSettled
      totalFeesSettled
      totalPayout
      expectedPayout
      outcomeTokenBalance0
      outcomeTokenBalance1
      settled
      bets {
        id
        outcomeIndex
        amount
        feeAmount
        outcomeTokenAmount
        countedInProfit
        countedInTotal
        blockTimestamp
      }
    `),
    paginateByIdGt(url, "dailyProfitStatistics", `traderAgent: "${addr}"`, `
      date
      totalBets
      totalTraded
      totalFees
      totalPayout
      dailyProfit
      profitParticipants { id }
      bets {
        id
        amount
        feeAmount
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
  const participantByMarket = new Map();
  for (const p of participants) {
    const marketId = p.fixedProductMarketMaker?.id;
    if (marketId) participantByMarket.set(marketId, p);
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK 1: Agent totals vs sum of MarketParticipant totals
  // ════════════════════════════════════════════════════════════════

  heading(1, "Agent Totals vs Sum of MarketParticipant Totals");

  const fieldMappings = [
    { agent: "totalBets", participant: "totalBets", isBigInt: false },
    { agent: "totalTraded", participant: "totalTraded", isBigInt: true },
    { agent: "totalFees", participant: "totalFees", isBigInt: true },
    { agent: "totalTradedSettled", participant: "totalTradedSettled", isBigInt: true },
    { agent: "totalFeesSettled", participant: "totalFeesSettled", isBigInt: true },
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
    const mid = (p.fixedProductMarketMaker?.id || "unknown").slice(0, 10) + "...";
    const q = (p.fixedProductMarketMaker?.question || "").slice(0, 45);

    if (p.settled) {
      if (bn(p.totalTraded) !== bn(p.totalTradedSettled)) {
        settledIssues++;
        console.log(`  ${mid} ${q}`);
        console.log(`    SETTLED but totalTraded(${fmt(bn(p.totalTraded))}) != totalTradedSettled(${fmt(bn(p.totalTradedSettled))})`);
      }
      if (bn(p.totalFees) !== bn(p.totalFeesSettled)) {
        settledIssues++;
        console.log(`  ${mid} ${q}`);
        console.log(`    SETTLED but totalFees(${fmt(bn(p.totalFees))}) != totalFeesSettled(${fmt(bn(p.totalFeesSettled))})`);
      }
    }
    if (bn(p.totalTradedSettled) > bn(p.totalTraded)) {
      settledIssues++;
      console.log(`  ${mid} ${q}`);
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
    const mid = (p.fixedProductMarketMaker?.id || "unknown").slice(0, 10) + "...";
    const q = (p.fixedProductMarketMaker?.question || "").slice(0, 45);
    const errs = [];

    let sumAmount = 0n, sumFees = 0n, sumT0 = 0n, sumT1 = 0n;
    for (const bet of bets) {
      sumAmount += bn(bet.amount);
      sumFees += bn(bet.feeAmount);
      if (bn(bet.outcomeIndex) === 0n) sumT0 += bn(bet.outcomeTokenAmount);
      else sumT1 += bn(bet.outcomeTokenAmount);
    }

    if (sumAmount !== bn(p.totalTraded)) errs.push(`totalTraded: sum=${fmt(sumAmount)} stored=${fmt(bn(p.totalTraded))}`);
    if (sumFees !== bn(p.totalFees)) errs.push(`totalFees: sum=${fmt(sumFees)} stored=${fmt(bn(p.totalFees))}`);
    if (sumT0 !== bn(p.outcomeTokenBalance0)) errs.push(`balance0: sum=${fmt(sumT0)} stored=${fmt(bn(p.outcomeTokenBalance0))}`);
    if (sumT1 !== bn(p.outcomeTokenBalance1)) errs.push(`balance1: sum=${fmt(sumT1)} stored=${fmt(bn(p.outcomeTokenBalance1))}`);
    if (bets.length !== Number(p.totalBets || 0)) errs.push(`totalBets: count=${bets.length} stored=${p.totalBets}`);

    if (errs.length > 0) {
      betSumIssues += errs.length;
      console.log(`  ${mid} ${q}`);
      for (const e of errs) console.log(`    ${e}`);
    }
  }

  totalIssues += betSumIssues;
  if (betSumIssues === 0) console.log("  All participant totals match bet sums.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 4: Expected payout recalculation
  // ════════════════════════════════════════════════════════════════

  heading(4, "Expected Payout vs Recalculation from Token Balances");

  let payoutCalcIssues = 0;

  for (const p of participants) {
    if (!p.settled) continue;
    const answer = p.fixedProductMarketMaker?.currentAnswer;
    if (!answer) continue;

    const b0 = bn(p.outcomeTokenBalance0);
    const b1 = bn(p.outcomeTokenBalance1);
    const recalc = calcExpectedPayout(answer, b0, b1);
    const stored = bn(p.expectedPayout);

    if (recalc !== stored) {
      payoutCalcIssues++;
      const mid = (p.fixedProductMarketMaker?.id || "").slice(0, 10) + "...";
      const q = (p.fixedProductMarketMaker?.question || "").slice(0, 45);
      console.log(`  ${mid} ${q}`);
      console.log(`    stored=${fmt(stored)} recalc=${fmt(recalc)} delta=${fmt(stored - recalc)}`);
      console.log(`    answer=${answer.slice(0, 10)} b0=${fmt(b0)} b1=${fmt(b1)}`);
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
    const mid = (p.fixedProductMarketMaker?.id || "unknown").slice(0, 10) + "...";

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
      const tokens = bn(bet.outcomeTokenAmount);
      const fee = bn(bet.feeAmount);

      if ((amount < 0n && tokens > 0n) || (amount > 0n && tokens < 0n)) {
        signIssues++;
        console.log(`  Bet ${(bet.id || "").slice(0, 18)}... amount=${fmt(amount)} tokens=${fmt(tokens)} (sign mismatch)`);
      }
      if (fee < 0n) {
        signIssues++;
        console.log(`  Bet ${(bet.id || "").slice(0, 18)}... negative fee=${fmt(fee)}`);
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
    let sumAmount = 0n, sumFees = 0n, wrongDay = 0;

    for (const bet of bets) {
      sumAmount += bn(bet.amount);
      sumFees += bn(bet.feeAmount);
      if (getDayTimestamp(bet.blockTimestamp) !== date) wrongDay++;
    }

    const errs = [];
    if (bets.length !== Number(day.totalBets || 0)) errs.push(`totalBets: stat=${day.totalBets} bets=${bets.length}`);
    if (sumAmount !== bn(day.totalTraded)) errs.push(`totalTraded: stat=${fmt(bn(day.totalTraded))} sum=${fmt(sumAmount)}`);
    if (sumFees !== bn(day.totalFees)) errs.push(`totalFees: stat=${fmt(bn(day.totalFees))} sum=${fmt(sumFees)}`);
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
    { name: "totalFees", agentVal: bn(agent.totalFees), sumVal: dailyStats.reduce((a, d) => a + bn(d.totalFees), 0n), isBigInt: true },
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
  const agentExpectedProfit = bn(agent.totalExpectedPayout) - bn(agent.totalTradedSettled) - bn(agent.totalFeesSettled);
  const participantExpectedProfit = participants
    .filter((p) => p.settled)
    .reduce((a, p) => a + bn(p.expectedPayout) - bn(p.totalTraded) - bn(p.totalFees), 0n);

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
  if (unsettled > 0n) console.log(`\n  Info: ${fmt(unsettled)} xDAI in unsettled trades`);
  const expectedPayout = bn(agent.totalExpectedPayout);
  if (expectedPayout > 0n) {
    const rate = Number(bn(agent.totalPayout) * 10000n / expectedPayout) / 100;
    console.log(`  Info: Claim rate: ${rate}%`);
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK 10: Profit participants completeness
  // ════════════════════════════════════════════════════════════════

  heading(10, "Profit Participants Completeness");

  const settledMarketIds = new Set(
    participants.filter((p) => p.settled).map((p) => p.fixedProductMarketMaker?.id).filter(Boolean)
  );
  const profitParticipantIds = new Set();
  for (const day of dailyStats) {
    for (const pp of (day.profitParticipants || [])) profitParticipantIds.add(pp.id);
  }

  let missingCount = 0;
  for (const id of settledMarketIds) {
    if (!profitParticipantIds.has(id)) {
      missingCount++;
      const p = participantByMarket.get(id);
      console.log(`  Missing: ${id.slice(0, 10)}... ${(p?.fixedProductMarketMaker?.question || "").slice(0, 45)}`);
    }
  }

  totalIssues += missingCount;
  if (missingCount === 0) console.log("  All settled markets appear in profitParticipants.");

  // ════════════════════════════════════════════════════════════════
  // CHECK 11: Answer change anomalies
  // ════════════════════════════════════════════════════════════════

  heading(11, "Answer Change Anomalies");

  let changeIssues = 0;

  for (const p of participants) {
    const payout = bn(p.totalPayout);
    const expected = bn(p.expectedPayout);
    const mid = (p.fixedProductMarketMaker?.id || "unknown").slice(0, 10) + "...";
    const q = (p.fixedProductMarketMaker?.question || "").slice(0, 45);
    const answer = p.fixedProductMarketMaker?.currentAnswer || "none";

    if (payout > 0n && expected === 0n) {
      changeIssues++;
      console.log(`  ${mid} ${q}`);
      console.log(`    Payout=${fmt(payout)} but expectedPayout=0 | settled=${p.settled}`);
      console.log(`    -> Answer likely changed after settlement but re-answer not processed`);
    } else if (payout > 0n && payout > expected + 1n) {
      changeIssues++;
      console.log(`  ${mid} ${q}`);
      console.log(`    Payout=${fmt(payout)} > expectedPayout=${fmt(expected)} (delta=${fmt(payout - expected)})`);
      console.log(`    -> Possible answer change or multiple redemptions`);
    }
  }

  totalIssues += changeIssues;
  if (changeIssues === 0) console.log("  No answer change anomalies detected.");

  // ──── FINAL SUMMARY ────

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TOTAL ISSUES: ${totalIssues}`);
  console.log(`${"═".repeat(60)}\n`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
