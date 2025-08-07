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
  let result = template.replace(/{{ network }}/g, network);

  for (const [contractName, contractData] of Object.entries(networkData)) {
    result = result.replace(
      new RegExp(`{{ ${contractName}\\.address }}`, 'g'),
      contractData.address
    );
    result = result.replace(
      new RegExp(`{{ ${contractName}\\.startBlock }}`, 'g'),
      contractData.startBlock.toString()
    );
  }

  return result;
}

// Generate configs
Object.entries(networksData).forEach(([network, networkData]) => {
  const config = replacePlaceholders(template, network, networkData);
  const outputPath = path.join(basePath, `subgraph.${network}.yaml`);
  fs.writeFileSync(outputPath, config);
  console.log(`Generated ${outputPath}`);
});