#!/usr/bin/env node
/**
 * Compare subgraph data with Dune query results (real-time)
 *
 * Dune Query: https://dune.com/queries/4963482
 *
 * Usage:
 *   DUNE_API_KEY=xxx node scripts/compare-dune.js
 *   node scripts/compare-dune.js --dune-api-key xxx
 */

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/115860/liquidity-eth/version/latest';
const DUNE_API_BASE = 'https://api.dune.com/api/v1';
const DUNE_QUERY_ID = '4963482'; // Liquidity and Protocol-owned-liquidity ETH

async function fetchSubgraphData() {
  const query = `{
    lptokenMetrics(id: "") {
      totalSupply
      treasurySupply
      treasuryPercentage
      currentReserve0
      currentReserve1
      poolLiquidityUsd
      protocolOwnedLiquidityUsd
      lastEthPriceUsd
    }
  }`;

  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const json = await response.json();
  return json.data?.lptokenMetrics || null;
}

async function fetchDuneData(apiKey) {
  const url = `${DUNE_API_BASE}/query/${DUNE_QUERY_ID}/results`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'x-dune-api-key': apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Dune API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  const rows = json.result?.rows || [];

  // Parse Dune results into structured object
  const result = {};
  for (const row of rows) {
    const category = row.Category?.toLowerCase().replace(/[^a-z]/g, '_') || '';
    result[category] = row.Value;
  }

  return {
    poolLiquidity: result.pool_liquidity_ || 0,
    poolLiquidityUsd: result.pool_liquidity__usd_ || 0,
    protocolOwnedLiquidity: result.protocol_owned_liquidity || 0,
    protocolOwnedLiquidityUsd: result.protocol_owned_liquidity__usd_ || 0,
    raw: rows,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let apiKey = process.env.DUNE_API_KEY || null;

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--dune-api-key') {
      apiKey = args[i + 1];
    }
  }

  return { apiKey };
}

function formatNumber(num, decimals = 2) {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatUsd(num) {
  return '$' + formatNumber(num);
}

function calculateDiff(subgraph, dune) {
  const diff = subgraph - dune;
  const pct = dune !== 0 ? ((diff / dune) * 100).toFixed(4) : 'N/A';
  return { diff, pct };
}

async function main() {
  const { apiKey } = parseArgs();

  console.log('='.repeat(70));
  console.log('Liquidity Subgraph vs Dune Query Comparison (Real-time)');
  console.log('Dune Query: https://dune.com/queries/4963482');
  console.log('='.repeat(70));
  console.log();

  // Fetch subgraph data
  console.log('Fetching subgraph data...');
  const subgraph = await fetchSubgraphData();

  if (!subgraph) {
    console.error('Failed to fetch subgraph data. Is the subgraph synced?');
    process.exit(1);
  }

  // Fetch Dune data
  let dune;
  if (apiKey) {
    console.log('Fetching Dune data (real-time)...');
    try {
      dune = await fetchDuneData(apiKey);
      console.log('✓ Dune data fetched successfully\n');
    } catch (error) {
      console.error(`✗ Failed to fetch Dune data: ${error.message}`);
      console.log('Falling back to cached values...\n');
      dune = null;
    }
  } else {
    console.log('No DUNE_API_KEY provided, using cached values...');
    console.log('Set DUNE_API_KEY env var or use --dune-api-key flag\n');
  }

  // Fallback to cached values if no API key or fetch failed
  if (!dune) {
    dune = {
      poolLiquidity: 63682.97741999,
      poolLiquidityUsd: 2835506.7794031436,
      protocolOwnedLiquidity: 63657.402469742345,
      protocolOwnedLiquidityUsd: 2834232.196705818,
    };
  }

  // Convert subgraph values
  const sgTotalSupply = parseFloat(subgraph.totalSupply) / 1e18;
  const sgTreasurySupply = parseFloat(subgraph.treasurySupply) / 1e18;
  const sgPoolLiquidityUsd = parseFloat(subgraph.poolLiquidityUsd);
  const sgPolUsd = parseFloat(subgraph.protocolOwnedLiquidityUsd);
  const sgEthPrice = parseFloat(subgraph.lastEthPriceUsd);
  const sgReserve0 = parseFloat(subgraph.currentReserve0) / 1e18;
  const sgReserve1 = parseFloat(subgraph.currentReserve1) / 1e18;

  // Print subgraph raw data
  console.log('SUBGRAPH DATA:');
  console.log('-'.repeat(70));
  console.log(`  Total Supply:      ${formatNumber(sgTotalSupply, 6)} LP tokens`);
  console.log(`  Treasury Supply:   ${formatNumber(sgTreasurySupply, 6)} LP tokens`);
  console.log(`  Reserve0 (OLAS):   ${formatNumber(sgReserve0, 6)} OLAS`);
  console.log(`  Reserve1 (ETH):    ${formatNumber(sgReserve1, 6)} ETH`);
  console.log(`  ETH Price:         ${formatUsd(sgEthPrice)}`);
  console.log(`  Pool Liquidity:    ${formatUsd(sgPoolLiquidityUsd)}`);
  console.log(`  POL USD:           ${formatUsd(sgPolUsd)}`);
  console.log();

  // Print Dune data
  console.log('DUNE DATA:');
  console.log('-'.repeat(70));
  if (dune.raw) {
    for (const row of dune.raw) {
      console.log(`  ${row.Category}: ${formatNumber(row.Value, 6)}`);
    }
  } else {
    console.log(`  Pool Liquidity:    ${formatNumber(dune.poolLiquidity, 6)} LP tokens`);
    console.log(`  Pool Liquidity:    ${formatUsd(dune.poolLiquidityUsd)}`);
    console.log(`  POL:               ${formatNumber(dune.protocolOwnedLiquidity, 6)} LP tokens`);
    console.log(`  POL USD:           ${formatUsd(dune.protocolOwnedLiquidityUsd)}`);
  }
  console.log();

  // Comparison
  console.log('COMPARISON:');
  console.log('-'.repeat(70));

  // LP Token comparison
  const lpDiff = calculateDiff(sgTotalSupply, dune.poolLiquidity);
  console.log(`  Total LP Supply:`);
  console.log(`    Subgraph: ${formatNumber(sgTotalSupply, 6)}`);
  console.log(`    Dune:     ${formatNumber(dune.poolLiquidity, 6)}`);
  console.log(`    Diff:     ${formatNumber(lpDiff.diff, 6)} (${lpDiff.pct}%)`);
  console.log();

  // Treasury comparison
  const treasuryDiff = calculateDiff(sgTreasurySupply, dune.protocolOwnedLiquidity);
  console.log(`  Treasury Supply:`);
  console.log(`    Subgraph: ${formatNumber(sgTreasurySupply, 6)}`);
  console.log(`    Dune:     ${formatNumber(dune.protocolOwnedLiquidity, 6)}`);
  console.log(`    Diff:     ${formatNumber(treasuryDiff.diff, 6)} (${treasuryDiff.pct}%)`);
  console.log();

  // Pool Liquidity USD comparison
  const poolUsdDiff = calculateDiff(sgPoolLiquidityUsd, dune.poolLiquidityUsd);
  console.log(`  Pool Liquidity USD:`);
  console.log(`    Subgraph: ${formatUsd(sgPoolLiquidityUsd)}`);
  console.log(`    Dune:     ${formatUsd(dune.poolLiquidityUsd)}`);
  console.log(`    Diff:     ${formatUsd(poolUsdDiff.diff)} (${poolUsdDiff.pct}%)`);
  console.log();

  // POL USD comparison
  const polUsdDiff = calculateDiff(sgPolUsd, dune.protocolOwnedLiquidityUsd);
  console.log(`  Protocol-Owned Liquidity USD:`);
  console.log(`    Subgraph: ${formatUsd(sgPolUsd)}`);
  console.log(`    Dune:     ${formatUsd(dune.protocolOwnedLiquidityUsd)}`);
  console.log(`    Diff:     ${formatUsd(polUsdDiff.diff)} (${polUsdDiff.pct}%)`);
  console.log();

  // Summary
  console.log('='.repeat(70));
  console.log('NOTES:');
  console.log('-'.repeat(70));
  console.log('  - Subgraph uses ETH price from Chainlink (ETH reserves x ETH price x 2)');
  console.log('  - Dune uses OLAS price from DEX trades (OLAS reserves x OLAS price x 2)');
  console.log('  - Both methods should yield similar results for balanced AMM pools');
  console.log('='.repeat(70));
}

main().catch(console.error);
