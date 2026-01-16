#!/usr/bin/env node
/**
 * Calculate Pool Liquidity USD using both methods
 *
 * Usage:
 *   node scripts/calculate-usd.js
 *   node scripts/calculate-usd.js --olas-price 0.08446  # override price
 */

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/115860/liquidity-eth/version/latest';
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price?ids=autonolas&vs_currencies=usd';

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

async function fetchOlasPriceFromCoingecko() {
  const response = await fetch(COINGECKO_API);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CoinGecko API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  return json.autonolas?.usd || null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let olasPrice = null;

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--olas-price') {
      olasPrice = parseFloat(args[i + 1]);
    }
  }

  return { olasPrice };
}

function formatUsd(num) {
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  let { olasPrice } = parseArgs();

  // Fetch OLAS price from CoinGecko if not provided
  if (!olasPrice) {
    console.log('Fetching OLAS price from CoinGecko...');
    try {
      olasPrice = await fetchOlasPriceFromCoingecko();
      if (olasPrice) {
        console.log(`✓ OLAS price: ${formatUsd(olasPrice)}\n`);
      }
    } catch (error) {
      console.error(`✗ Failed to fetch OLAS price: ${error.message}`);
      console.log('Use --olas-price <price> to provide manually');
      process.exit(1);
    }
  }

  if (!olasPrice) {
    console.error('Could not fetch OLAS price. Use --olas-price <price> to provide manually');
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
  console.log(`  OLAS Price:        ${formatUsd(olasPrice)} (CoinGecko)`);
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
