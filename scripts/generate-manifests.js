const fs = require('fs');
const path = require('path');

// Parse named argument --path=...
const pathArg = process.argv.find(arg => arg.startsWith('--path='));

if (!pathArg) {
  console.error('Usage: node generate.js --path=/path/to/folder');
  process.exit(1);
}

const basePath = pathArg.split('=')[1];
const networksPath = path.join(basePath, 'networks.json');
const templatePath = path.join(basePath, 'subgraph.template.yaml');

// Read files
let networksData, template;

try {
  networksData = JSON.parse(fs.readFileSync(networksPath, 'utf8'));
  template = fs.readFileSync(templatePath, 'utf8');
} catch (err) {
  console.error(`Failed to read files from ${basePath}:`, err.message);
  process.exit(1);
}

// Replace placeholders
function replacePlaceholders(template, network, networkData) {
  // Support a "network" override field for cases where the manifest key
  // differs from the Graph Node network name (e.g. "base-weth" → "base")
  const graphNetwork = networkData.network || network;
  let result = template.replace(/{{ network }}/g, graphNetwork);

  for (const [contractName, contractData] of Object.entries(networkData)) {
    // Skip non-contract fields (e.g. "network" override)
    if (typeof contractData !== 'object' || contractData === null) continue;
    // Skip arrays (e.g. "erc20Tokens") — handled by the marker below.
    if (Array.isArray(contractData)) continue;
    result = result.replace(
      new RegExp(`{{ ${contractName}\\.address }}`, 'g'),
      contractData.address
    );
    result = result.replace(
      new RegExp(`{{ ${contractName}\\.startBlock }}`, 'g'),
      contractData.startBlock.toString()
    );
  }

  // Expand the optional per-network ERC-20 Transfer data sources into the
  // {{ erc20TokenDataSources }} marker. Lets a network declare a variable
  // number of plain ERC-20 Transfer sources (e.g. stablecoins, which
  // differ in count per chain) without a fixed placeholder per token.
  // No-op for templates without the marker and networks without the array.
  result = result.replace(
    /{{ erc20TokenDataSources }}/g,
    renderErc20TokenDataSources(graphNetwork, networkData)
  );

  return result;
}

// renderErc20TokenDataSources — build one `Transfer → handleErc20Transfer`
// data source per entry in networkData.erc20Tokens ([{name, address}]).
// All such tokens share the same handler/ABI/entities; the only per-token
// fields are name + address. Start block = the chain's ServiceRegistryL2
// deploy block: no Pearl Safe predates it, so it's a provably-safe lower
// bound (plan Open Q #7) without needing a per-token deploy block.
//
// Maintenance notes for `erc20Tokens` in networks.json:
//   - Treat the array as APPEND-ONLY. The generated data-source order
//     follows the array order; reordering existing entries between
//     deploys can disturb grafting / partial-reindex. Add new tokens at
//     the end; reorder only via a fresh deploy.
//   - Every entry must have a matching branch in `getStablecoinSymbol`
//     (src/constants.ts) or its Token rows fall back to UNKNOWN/18 — the
//     handler logs `log.critical` if that happens (src/utils.ts).
function renderErc20TokenDataSources(graphNetwork, networkData) {
  const tokens = networkData.erc20Tokens;
  if (!Array.isArray(tokens) || tokens.length === 0) return '';
  const startBlock = networkData.ServiceRegistryL2.startBlock;
  return tokens
    .map(
      (t) => `  - kind: ethereum
    name: ${t.name}
    network: ${graphNetwork}
    source:
      address: "${t.address}"
      abi: ERC20
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - FundsMovement
        - TokenBalance
        - Token
        - AgentFundingEvent
      abis:
        - name: ERC20
          file: ../../abis/ERC20Detailed.json
      eventHandlers:
        - event: Transfer(indexed address,indexed address,uint256)
          handler: handleErc20Transfer
      file: ./src/erc20.ts`
    )
    .join('\n');
}

// Generate configs
Object.entries(networksData).forEach(([network, networkData]) => {
  const config = replacePlaceholders(template, network, networkData);
  const outputPath = path.join(basePath, `subgraph.${network}.yaml`);
  fs.writeFileSync(outputPath, config);
  console.log(`Generated ${outputPath}`);
});