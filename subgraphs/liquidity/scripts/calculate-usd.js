#!/usr/bin/env node
/**
 * Calculate Pool Liquidity USD using both methods
 *
 * Usage:
 *   node scripts/calculate-usd.js --olas-price 0.08446
 *   DUNE_API_KEY=xxx node scripts/calculate-usd.js  # fetches OLAS price from Dune
 */

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/115860/liquidity-eth/version/latest';
const DUNE_API_BASE = 'https://api.dune.com/api/v1';
const DUNE_OLAS_PRICE_QUERY_ID = '2767077'; // OLAS: Latest Price

async function fetchSubgraphData() {
  const query = `{
    lptokenMetrics(id: "") {
      currentReserve0
      currentReserve1
      lastEthPriceUsd
      totalSupply
      treasurySupply
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

async function fetchOlasPriceFromDune(apiKey) {
  const url = `${DUNE_API_BASE}/query/${DUNE_OLAS_PRICE_QUERY_ID}/results`;

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

  // Find latest_price in the results
  if (rows.length > 0) {
    return rows[0].latest_price || rows[0].price || null;
  }

  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let olasPrice = null;
  let apiKey = process.env.DUNE_API_KEY || null;

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--olas-price') {
      olasPrice = parseFloat(args[i + 1]);
    } else if (args[i] === '--dune-api-key') {
      apiKey = args[i + 1];
    }
  }

  return { olasPrice, apiKey };
}

function formatUsd(num) {
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  let { olasPrice, apiKey } = parseArgs();

  // Try to fetch OLAS price from Dune if not provided
  if (!olasPrice && apiKey) {
    console.log('Fetching OLAS price from Dune...');
    try {
      olasPrice = await fetchOlasPriceFromDune(apiKey);
      if (olasPrice) {
        console.log(`✓ OLAS price from Dune: ${formatUsd(olasPrice)}\n`);
      }
    } catch (error) {
      console.error(`✗ Failed to fetch OLAS price: ${error.message}\n`);
    }
  }

  if (!olasPrice) {
    console.log('Usage:');
    console.log('  node scripts/calculate-usd.js --olas-price <price>');
    console.log('  DUNE_API_KEY=xxx node scripts/calculate-usd.js');
    console.log('\nExample:');
    console.log('  node scripts/calculate-usd.js --olas-price 0.08446');
    process.exit(1);
  }

  console.log('Fetching subgraph data...\n');
  const data = await fetchSubgraphData();

  if (!data) {
    console.error('Failed to fetch subgraph data');
    process.exit(1);
  }

  // Parse values
  const reserve0 = parseFloat(data.currentReserve0) / 1e18;  // OLAS
  const reserve1 = parseFloat(data.currentReserve1) / 1e18;  // ETH
  const ethPrice = parseFloat(data.lastEthPriceUsd);
  const totalSupply = parseFloat(data.totalSupply) / 1e18;
  const treasurySupply = parseFloat(data.treasurySupply) / 1e18;

  // Calculate Pool Liquidity USD - Method 1: ETH side
  const poolUsdEth = 2 * reserve1 * ethPrice;

  // Calculate Pool Liquidity USD - Method 2: OLAS side
  const poolUsdOlas = 2 * reserve0 * olasPrice;

  // Calculate POL USD
  const treasuryPct = treasurySupply / totalSupply;
  const polUsdEth = treasuryPct * poolUsdEth;
  const polUsdOlas = treasuryPct * poolUsdOlas;

  // Difference
  const poolDiff = poolUsdEth - poolUsdOlas;
  const poolDiffPct = (poolDiff / poolUsdOlas * 100).toFixed(2);

  // Implied OLAS price from ETH method
  const impliedOlasPrice = poolUsdEth / 2 / reserve0;

  console.log('RAW DATA:');
  console.log('─'.repeat(50));
  console.log(`  Reserve0 (OLAS):   ${reserve0.toLocaleString()} OLAS`);
  console.log(`  Reserve1 (ETH):    ${reserve1.toLocaleString()} ETH`);
  console.log(`  ETH Price:         ${formatUsd(ethPrice)} (Chainlink)`);
  console.log(`  OLAS Price:        ${formatUsd(olasPrice)} (${apiKey ? 'Dune' : 'provided'})`);
  console.log(`  Treasury %:        ${(treasuryPct * 100).toFixed(4)}%`);
  console.log();

  console.log('POOL LIQUIDITY USD:');
  console.log('─'.repeat(50));
  console.log(`  Method 1 (ETH):    2 × ${reserve1.toFixed(2)} × ${formatUsd(ethPrice)}`);
  console.log(`                     = ${formatUsd(poolUsdEth)}`);
  console.log();
  console.log(`  Method 2 (OLAS):   2 × ${reserve0.toFixed(2)} × ${formatUsd(olasPrice)}`);
  console.log(`                     = ${formatUsd(poolUsdOlas)}`);
  console.log();
  console.log(`  Difference:        ${formatUsd(poolDiff)} (${poolDiffPct}%)`);
  console.log();

  console.log('PROTOCOL-OWNED LIQUIDITY USD:');
  console.log('─'.repeat(50));
  console.log(`  Method 1 (ETH):    ${formatUsd(polUsdEth)}`);
  console.log(`  Method 2 (OLAS):   ${formatUsd(polUsdOlas)}`);
  console.log();

  console.log('IMPLIED OLAS PRICE (from ETH method):');
  console.log('─'.repeat(50));
  console.log(`  ${formatUsd(impliedOlasPrice)}`);
}

main().catch(console.error);
