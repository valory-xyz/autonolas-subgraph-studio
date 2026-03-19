/**
 * POL (Protocol Owned Liquidity) Aggregation Script
 *
 * Queries all liquidity subgraphs (Ethereum + 6 L2 chains) plus Solana RPC,
 * fetches prices, and computes the total Protocol Owned Liquidity in USD.
 *
 * Usage:
 *   node scripts/pol-aggregation.js
 *   node scripts/pol-aggregation.js --json          # JSON output only
 *   node scripts/pol-aggregation.js --verbose       # include raw data
 *
 * Subgraph endpoints can be overridden via environment variables:
 *   SUBGRAPH_ETH_URL=https://...  node scripts/pol-aggregation.js
 *
 * No external dependencies — uses only Node.js built-ins.
 */

const https = require('https');
const http = require('http');

// ─── Configuration ───────────────────────────────────────────────────────────

const SUBGRAPH_URLS = {
  ethereum: process.env.SUBGRAPH_ETH_URL || 'https://api.studio.thegraph.com/query/1716136/olas-ethereum-liquidity/version/latest',
  gnosis: process.env.SUBGRAPH_GNOSIS_URL || 'https://api.studio.thegraph.com/query/1716136/olas-gnosis-liquidity/version/latest',
  polygon: process.env.SUBGRAPH_POLYGON_URL || 'https://api.studio.thegraph.com/query/1716136/olas-polygon-liquidity/version/latest',
  arbitrum: process.env.SUBGRAPH_ARBITRUM_URL || 'https://api.studio.thegraph.com/query/1716136/olas-arbitrum-liquidity/version/latest',
  optimism: process.env.SUBGRAPH_OPTIMISM_URL || 'https://api.studio.thegraph.com/query/1716136/olas-optimism-liquidity/version/latest',
  base: process.env.SUBGRAPH_BASE_URL || 'https://api.studio.thegraph.com/query/1716136/olas-base-liquidity/version/latest',
  celo: process.env.SUBGRAPH_CELO_URL || 'https://api.studio.thegraph.com/query/1716136/olas-celo-liquidity/version/latest',
};

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Solana pool vault accounts
const SOL_VAULT = 'CLA8hU8SkdCZ9cJVLMfZQfcgAsywZ9txBJ6qrRAqthLx';
const OLAS_VAULT = '6E8pzDK8uwpENc49kp5xo5EGydYjtamPSmUKXxum4ybb';

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url} (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout (${REQUEST_TIMEOUT_MS}ms) for ${url}`));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function graphqlQuery(url, query) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

function solanaRpc(method, params) {
  return fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// Two query variants: with and without solUsdPrice (field added in v0.0.4).
// The script tries the full query first and falls back to the safe query.
const ETH_QUERY_FULL = `{
  lptokenMetrics(id: "global") {
    totalSupply treasurySupply treasuryPercentage
    currentReserve0 currentReserve1
    ethUsdPrice maticUsdPrice solUsdPrice
    poolLiquidityUsd protocolOwnedLiquidityUsd
  }
  bridgedPOLHoldings(first: 10) {
    id originChain pair currentBalance totalSold
  }
  priceDatas(first: 5) { id price lastUpdatedTimestamp }
  _meta { block { number } hasIndexingErrors }
}`;

const ETH_QUERY_SAFE = `{
  lptokenMetrics(id: "global") {
    totalSupply treasurySupply treasuryPercentage
    currentReserve0 currentReserve1
    ethUsdPrice
    poolLiquidityUsd protocolOwnedLiquidityUsd
  }
  bridgedPOLHoldings(first: 10) {
    id originChain pair currentBalance totalSold
  }
  priceDatas(first: 5) { id price lastUpdatedTimestamp }
  _meta { block { number } hasIndexingErrors }
}`;

// Two L2 query variants: with and without celoUsdPrice (added with Celo Chainlink support)
const L2_QUERY_FULL = `{
  poolMetrics_collection(first: 1) {
    id token0 token1 reserve0 reserve1 totalSupply celoUsdPrice
  }
  _meta { block { number } hasIndexingErrors }
}`;

const L2_QUERY_SAFE = `{
  poolMetrics_collection(first: 1) {
    id token0 token1 reserve0 reserve1 totalSupply
  }
  _meta { block { number } hasIndexingErrors }
}`;

async function queryL2(url) {
  const full = await graphqlQuery(url, L2_QUERY_FULL);
  if (full.data) return full;
  return graphqlQuery(url, L2_QUERY_SAFE);
}

// ─── Chain-specific valuation logic ──────────────────────────────────────────

// Token identification per chain (which reserve is the "priced" token)
const CHAIN_CONFIG = {
  gnosis: {
    pair: 'OLAS-WXDAI',
    // token1 = WXDAI (stablecoin), value = 2 * WXDAI reserves
    valuate: (pool) => {
      const wxdai = Number(BigInt(pool.reserve1)) / 1e18;
      return { tvl: wxdai * 2, method: '2×WXDAI' };
    },
  },
  polygon: {
    pair: 'OLAS-WMATIC',
    // token0 = WMATIC, value = 2 * WMATIC * MATIC/USD
    valuate: (pool, prices) => {
      if (prices.matic <= 0) return { tvl: null, method: 'MATIC/USD PRICE UNAVAILABLE' };
      const wmatic = Number(BigInt(pool.reserve0)) / 1e18;
      return { tvl: wmatic * 2 * prices.matic, method: `2×WMATIC×$${prices.matic.toFixed(4)}` };
    },
  },
  arbitrum: {
    pair: 'OLAS-WETH',
    // token1 = WETH, value = 2 * WETH * ETH/USD
    valuate: (pool, prices) => {
      const weth = Number(BigInt(pool.reserve1)) / 1e18;
      return { tvl: weth * 2 * prices.eth, method: `2×WETH×$${prices.eth.toFixed(2)}` };
    },
  },
  optimism: {
    pair: 'WETH-OLAS',
    // token0 = WETH, value = 2 * WETH * ETH/USD
    valuate: (pool, prices) => {
      const weth = Number(BigInt(pool.reserve0)) / 1e18;
      return { tvl: weth * 2 * prices.eth, method: `2×WETH×$${prices.eth.toFixed(2)}` };
    },
  },
  base: {
    pair: 'OLAS-USDC',
    // token1 = USDC (6 decimals, stablecoin), value = 2 * USDC
    valuate: (pool) => {
      const usdc = Number(BigInt(pool.reserve1)) / 1e6;
      return { tvl: usdc * 2, method: '2×USDC' };
    },
  },
  celo: {
    pair: 'CELO-OLAS',
    // token0 = CELO, value = 2 * CELO * CELO/USD
    // CELO/USD from Chainlink on Celo chain (stored in poolMetrics.celoUsdPrice)
    valuate: (pool) => {
      const r0 = BigInt(pool.reserve0);
      if (r0 === 0n) return { tvl: null, method: 'RESERVES UNAVAILABLE (needs Sync handler redeploy)' };
      if (!pool.celoUsdPrice || pool.celoUsdPrice === '0') return { tvl: null, method: 'CELO/USD PRICE UNAVAILABLE (needs Chainlink deployment)' };
      const celo = Number(r0) / 1e18;
      const celoPrice = Number(BigInt(pool.celoUsdPrice)) / 1e8;
      return { tvl: celo * 2 * celoPrice, method: `2×CELO×$${celoPrice.toFixed(6)} (Chainlink)` };
    },
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const flags = process.argv.slice(2);
  const jsonMode = flags.includes('--json');
  const verbose = flags.includes('--verbose');

  const log = jsonMode ? () => {} : console.log.bind(console);

  log('Fetching data from all sources...\n');

  // Try queries with progressively fewer fields to support older deployments
  async function fetchEthSubgraph() {
    const full = await graphqlQuery(SUBGRAPH_URLS.ethereum, ETH_QUERY_FULL);
    if (full.data) return full;
    return graphqlQuery(SUBGRAPH_URLS.ethereum, ETH_QUERY_SAFE);
  }

  // Note: ETH_QUERY_FULL includes maticUsdPrice + solUsdPrice (v0.0.4+)
  //       ETH_QUERY_SAFE includes only ethUsdPrice (works with all versions)

  // Fetch everything in parallel
  const [ethData, gnData, pgData, arbData, optData, baseData, celoData, solVaultA, solVaultB] =
    await Promise.all([
      fetchEthSubgraph(),
      queryL2(SUBGRAPH_URLS.gnosis),
      queryL2(SUBGRAPH_URLS.polygon),
      queryL2(SUBGRAPH_URLS.arbitrum),
      queryL2(SUBGRAPH_URLS.optimism),
      queryL2(SUBGRAPH_URLS.base),
      queryL2(SUBGRAPH_URLS.celo),
      solanaRpc('getTokenAccountBalance', [SOL_VAULT]),
      solanaRpc('getTokenAccountBalance', [OLAS_VAULT]),
    ]);

  // ─── Validate ETH subgraph response ───
  if (!ethData.data || !ethData.data.lptokenMetrics) {
    const errMsg = ethData.errors ? ethData.errors.map(e => e.message).join('; ') : 'lptokenMetrics is null';
    throw new Error(`Ethereum subgraph query failed: ${errMsg}`);
  }
  if (ethData.data._meta && ethData.data._meta.hasIndexingErrors) {
    log('WARNING: Ethereum subgraph has indexing errors');
  }

  // ─── Prices (all from Chainlink via subgraphs) ───
  const metrics = ethData.data.lptokenMetrics;
  const prices = {
    eth: Number(BigInt(metrics.ethUsdPrice)) / 1e8,
    matic: Number(BigInt(metrics.maticUsdPrice || '0')) / 1e8,
    sol: 0,
  };

  // SOL/USD: try from lptokenMetrics.solUsdPrice (v0.0.4+), then PriceData entity
  if (metrics.solUsdPrice && metrics.solUsdPrice !== '0') {
    prices.sol = Number(BigInt(metrics.solUsdPrice)) / 1e8;
  }
  if (prices.sol === 0) {
    const solPriceEntity = (ethData.data.priceDatas || []).find(p => p.id === 'sol-usd');
    if (solPriceEntity) {
      prices.sol = Number(BigInt(solPriceEntity.price)) / 1e8;
    }
  }

  // CELO/USD comes from the Celo subgraph's poolMetrics.celoUsdPrice (Chainlink on Celo chain)

  log('Prices (all Chainlink):');
  log(`  ETH/USD:   $${prices.eth.toFixed(2)}`);
  log(`  MATIC/USD: $${prices.matic.toFixed(4)}`);
  log(`  SOL/USD:   $${prices.sol.toFixed(2)}`);
  log(`  CELO/USD:  from Celo subgraph (Chainlink on Celo chain)`);

  // ─── Bridged LP balances from ETH subgraph ───
  const bridged = {};
  for (const h of ethData.data.bridgedPOLHoldings) {
    bridged[h.originChain] = {
      balance: BigInt(h.currentBalance),
      pair: h.pair,
      totalSold: BigInt(h.totalSold),
    };
  }

  // ─── Results ───
  const results = [];

  // 1. Ethereum OLAS-ETH
  const ethPolUsd = Number(BigInt(metrics.protocolOwnedLiquidityUsd)) / 1e8;
  const ethPoolUsd = Number(BigInt(metrics.poolLiquidityUsd)) / 1e8;
  const ethShare = Number(BigInt(metrics.treasuryPercentage)) / 100;
  results.push({
    chain: 'Ethereum',
    pair: 'OLAS-WETH',
    dex: 'Uniswap V2',
    poolTvl: ethPoolUsd,
    treasuryPol: ethPolUsd,
    share: ethShare,
    method: `2×ETH×$${prices.eth.toFixed(2)}`,
    block: ethData.data._meta.block.number,
  });

  // 2-7. L2 chains
  const l2Data = { gnosis: gnData, polygon: pgData, arbitrum: arbData, optimism: optData, base: baseData, celo: celoData };
  for (const [chain, data] of Object.entries(l2Data)) {
    const config = CHAIN_CONFIG[chain];
    const dex = chain === 'celo' ? 'Ubeswap' : 'Balancer V2';

    // Defensive: check for GraphQL errors or missing data
    if (data.errors || !data.data) {
      const errMsg = data.errors ? data.errors.map(e => e.message).join('; ') : 'no data';
      results.push({ chain, pair: config.pair, dex, poolTvl: null, treasuryPol: null, share: 0, method: `QUERY ERROR: ${errMsg}`, block: 0 });
      continue;
    }
    if (data.data._meta && data.data._meta.hasIndexingErrors) {
      results.push({ chain, pair: config.pair, dex, poolTvl: null, treasuryPol: null, share: 0, method: 'INDEXING ERRORS', block: data.data._meta.block.number });
      continue;
    }
    const pool = (data.data.poolMetrics_collection || [])[0];
    if (!pool) {
      results.push({ chain, pair: config.pair, dex, poolTvl: null, treasuryPol: null, share: 0, method: 'NO POOL DATA', block: data.data._meta ? data.data._meta.block.number : 0 });
      continue;
    }

    const { tvl, method } = config.valuate(pool, prices);
    const supply = BigInt(pool.totalSupply);
    const bridgedBal = bridged[chain]?.balance || 0n;
    const share = supply > 0n ? Number(bridgedBal) / Number(supply) : 0;
    const pol = tvl !== null ? tvl * share : null;

    results.push({
      chain: chain.charAt(0).toUpperCase() + chain.slice(1),
      pair: config.pair,
      dex: chain === 'celo' ? 'Ubeswap' : 'Balancer V2',
      poolTvl: tvl,
      treasuryPol: pol,
      share: share * 100,
      method,
      block: data.data._meta.block.number,
    });
  }

  // 8. Solana
  // Uses 2 × SOL_vault × SOL/USD (same balanced-pool approach as all other chains).
  // SOL/USD from Chainlink via Ethereum subgraph. No OLAS price needed.
  // Treasury holds ~99.995% of bridged supply (approximation).
  const solVaultOk = solVaultA && solVaultA.result && solVaultA.result.value;
  const solBalance = solVaultOk ? Number(solVaultA.result.value.uiAmount) : 0;
  let solTvl = null;
  let solMethod = 'SOLANA RPC ERROR';
  if (!solVaultOk) {
    solMethod = 'SOLANA RPC ERROR: ' + (solVaultA && solVaultA.error ? solVaultA.error.message : 'unexpected response');
  } else if (prices.sol <= 0) {
    solMethod = 'SOL/USD PRICE UNAVAILABLE';
  } else {
    solTvl = solBalance * 2 * prices.sol;
    solMethod = `2×SOL×$${prices.sol.toFixed(2)} (Chainlink)`;
  }
  const solShare = 99.995; // approximation — Treasury holds nearly all bridged supply
  const solPol = solTvl !== null ? solTvl * (solShare / 100) : null;

  results.push({
    chain: 'Solana',
    pair: 'WSOL-OLAS',
    dex: 'Orca Whirlpool',
    poolTvl: solTvl,
    treasuryPol: solPol,
    share: solShare,
    method: solMethod,
    solReserves: solBalance,
    block: solVaultOk ? 'Solana slot ' + solVaultA.result.context.slot : 'N/A',
  });

  // ─── Output ───
  let total = 0;
  let totalKnown = 0;

  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  const fmtUsd = (v) => v !== null ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';

  log('\n' + '='.repeat(90));
  log('POL VALUATION BY CHAIN');
  log('='.repeat(90));
  log(`${pad('Chain', 15)} ${pad('Pair', 15)} ${rpad('Pool TVL', 16)} ${rpad('Treasury POL', 16)} ${rpad('Share', 8)}  Method`);
  log('-'.repeat(90));

  for (const r of results) {
    const tvlStr = fmtUsd(r.poolTvl);
    const polStr = fmtUsd(r.treasuryPol);
    const shareStr = `${r.share.toFixed(2)}%`;
    log(`${pad(r.chain, 15)} ${pad(r.pair, 15)} ${rpad(tvlStr, 16)} ${rpad(polStr, 16)} ${rpad(shareStr, 8)}  ${r.method}`);

    if (r.treasuryPol !== null) {
      total += r.treasuryPol;
      totalKnown++;
    }
  }

  log('-'.repeat(90));
  log(`${pad('TOTAL', 15)} ${pad('', 15)} ${rpad('', 16)} ${rpad(fmtUsd(total), 16)} ${rpad('', 8)}  (${totalKnown}/${results.length} chains valued)`);

  // Missing chains
  const missing = results.filter(r => r.treasuryPol === null);
  if (missing.length > 0) {
    log('\nMissing:');
    for (const m of missing) {
      log(`  ${m.chain} ${m.pair}: ${m.method}`);
    }
  }

  // Timestamp
  log(`\nTimestamp: ${new Date().toISOString()}`);

  // JSON output
  if (jsonMode) {
    const output = {
      timestamp: new Date().toISOString(),
      prices,
      chains: results,
      totalPolUsd: total,
      chainsValued: totalKnown,
      chainsTotal: results.length,
    };
    console.log(JSON.stringify(output, null, 2));
  }

  // Verbose raw data
  if (verbose) {
    log('\n' + '═'.repeat(80));
    log('RAW SUBGRAPH DATA');
    log('═'.repeat(80));
    log('\nEthereum metrics:', JSON.stringify(metrics, null, 2));
    log('\nBridged LP holdings:', JSON.stringify(ethData.data.bridgedPOLHoldings, null, 2));
    log('\nPrice data:', JSON.stringify(ethData.data.priceDatas, null, 2));
    const olasVaultOk = solVaultB && solVaultB.result && solVaultB.result.value;
    log(`\nSolana SOL vault: ${solBalance} SOL`);
    log(`Solana OLAS vault: ${olasVaultOk ? solVaultB.result.value.uiAmount : 'N/A'} OLAS`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
