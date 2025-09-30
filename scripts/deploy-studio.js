#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Network configurations
const networkTypes = {
  '1': {
    name: 'Tokenomics',
    description: 'Tokenomics Subgraphs',
    networks: {
      'mainnet': {
        path: 'subgraphs/tokenomics/tokenomics-eth/subgraph.yaml',
        description: 'Ethereum Mainnet - Full tokenomics + OLAS holders',
        buildCommand: 'yarn build-tokenomics:ethereum'
      },
      'arbitrum': {
        path: 'subgraphs/tokenomics/tokenomics-arbitrum/subgraph.arbitrum.yaml',
        description: 'Arbitrum Network',
        buildCommand: 'yarn build-tokenomics:arbitrum'
      },
      'base': {
        path: 'subgraphs/tokenomics/tokenomics-base/subgraph.base.yaml',
        description: 'Base Network',
        buildCommand: 'yarn build-tokenomics:base'
      },
      'celo': {
        path: 'subgraphs/tokenomics/tokenomics-celo/subgraph.celo.yaml',
        description: 'Celo Network',
        buildCommand: 'yarn build-tokenomics:celo'
      },
      'gnosis': {
        path: 'subgraphs/tokenomics/tokenomics-gnosis/subgraph.gnosis.yaml',
        description: 'Gnosis Chain',
        buildCommand: 'yarn build-tokenomics:gnosis'
      },
      'optimism': {
        path: 'subgraphs/tokenomics/tokenomics-optimism/subgraph.optimism.yaml',
        description: 'Optimism Network',
        buildCommand: 'yarn build-tokenomics:optimism'
      },
      'polygon': {
        path: 'subgraphs/tokenomics/tokenomics-polygon/subgraph.polygon.yaml',
        description: 'Polygon Network',
        buildCommand: 'yarn build-tokenomics:polygon'
      }
    }
  },
  '2': {
    name: 'Service Registry',
    description: 'Service Registry Subgraphs',
    networks: {
      'ethereum': {
        path: 'subgraphs/service-registry/service-registry-eth/subgraph.yaml',
        description: 'Ethereum Mainnet',
        buildCommand: 'yarn build-service-registry:ethereum'
      },
      'optimism': {
        path: 'subgraphs/service-registry/service-registry-optimism/subgraph.optimism.yaml',
        description: 'Optimism Network',
        buildCommand: 'yarn build-service-registry:optimism'
      },
      'base': {
        path: 'subgraphs/service-registry/service-registry-base/subgraph.base.yaml',
        description: 'Base Network',
        buildCommand: 'yarn build-service-registry:base'
      },
      'gnosis': {
        path: 'subgraphs/service-registry/service-registry-gnosis/subgraph.gnosis.yaml',
        description: 'Gnosis Chain',
        buildCommand: 'yarn build-service-registry:gnosis'
      },
      'arbitrum': {
        path: 'subgraphs/service-registry/service-registry-arbitrum/subgraph.arbitrum.yaml',
        description: 'Arbitrum Network',
        buildCommand: 'yarn build-service-registry:arbitrum'
      },
      'celo': {
        path: 'subgraphs/service-registry/service-registry-celo/subgraph.celo.yaml',
        description: 'Celo Network',
        buildCommand: 'yarn build-service-registry:celo'
      },
      'polygon': {
        path: 'subgraphs/service-registry/service-registry-polygon/subgraph.polygon.yaml',
        description: 'Polygon Network',
        buildCommand: 'yarn build-service-registry:polygon'
      }
    }
  },
  '3': {
    name: 'Legacy Mech Fees',
    description: 'Legacy Mech Fees Subgraphs',
    networks: {
      'gnosis': {
        path: 'subgraphs/legacy-mech-fees-gnosis/subgraph.yaml',
        description: 'Gnosis Chain',
        buildCommand: 'yarn build-legacy-mech-fees:gnosis'
      }
    }
  },
  '4': {
    name: 'New Mech Fees',
    description: 'Consolidated per-chain manifests (native+nvm+token) for new-mech-fees',
    networks: {
      'gnosis': {
        path: 'subgraphs/new-mech-fees/mech-fees-gnosis/subgraph.yaml',
        description: 'Consolidated Gnosis (xdai)',
        buildCommand: 'yarn build-new-mech-fees:gnosis'
      },
      'base': {
        path: 'subgraphs/new-mech-fees/mech-fees-base/subgraph.yaml',
        description: 'Consolidated Base',
        buildCommand: 'yarn build-new-mech-fees:base'
      }
    }
  },
  '5': {
    name: 'Predict',
    description: 'Olas Predict Subgraph',
    networks: {
      'gnosis': {
        path: 'subgraphs/predict/subgraph.yaml',
        description: 'Gnosis Chain',
        buildCommand: 'yarn build-predict:gnosis'
      }
    }
  },
  '6': {
    name: 'Governance',
    description: 'Olas Governance Subgraph',
    networks: {
      'mainnet': {
        path: 'subgraphs/governance/subgraph.yaml',
        description: 'Ethereum Mainnet',
        buildCommand: 'yarn build-governance:mainnet'
      }
    }
  },
  '7': {
    name: 'Staking',
    description: 'Olas Staking Subgraph',
    networks: {
      'mainnet': {
        path: 'subgraphs/staking/subgraph.mainnet.yaml',
        description: 'Ethereum Mainnet',
        buildCommand: 'yarn build-staking:mainnet'
      },
      'gnosis': {
        path: 'subgraphs/staking/subgraph.gnosis.yaml',
        description: 'Gnosis Chain',
        buildCommand: 'yarn build-staking:gnosis'
      },
      'arbitrum': {
        path: 'subgraphs/staking/subgraph.arbitrum-one.yaml',
        description: 'Arbitrum One',
        buildCommand: 'yarn build-staking:arbitrum'
      },
      'polygon': {
        path: 'subgraphs/staking/subgraph.matic.yaml',
        description: 'Polygon',
        buildCommand: 'yarn build-staking:polygon'
      },
      'optimism': {
        path: 'subgraphs/staking/subgraph.optimism.yaml',
        description: 'Optimism',
        buildCommand: 'yarn build-staking:optimism'
      },
      'base': {
        path: 'subgraphs/staking/subgraph.base.yaml',
        description: 'Base',
        buildCommand: 'yarn build-staking:base'
      },
      'celo': {
        path: 'subgraphs/staking/subgraph.celo.yaml',
        description: 'Celo',
        buildCommand: 'yarn build-staking:celo'
      },
    }
  },
  '8': {
    name: 'Liquidity',
    description: 'Liquidity Pool Tracking Subgraphs',
    networks: {
      'ethereum': {
        path: 'subgraphs/liquidity/liquidity-eth/subgraph.yaml',
        description: 'Ethereum Mainnet - OLAS/ETH LP tracking',
        buildCommand: 'yarn build-liquidity:ethereum'
      }
    }
  },
  '9': {
    name: 'Babydegen',
    description: 'Agent funding and portfolio tracking',
    networks: {
      'optimism': {
        path: 'subgraphs/babydegen/babydegen-optimism/subgraph.yaml',
        description: 'Optimism Network',
        buildCommand: 'yarn build-babydegen-optimism'
      }
    }
  }
};

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  try {
    console.log('🚀 Autonolas Subgraph Studio Deployment\n');
    
    // Show network types
    console.log('Select subgraph type:');
    Object.keys(networkTypes).forEach(type => {
      console.log(`  ${type}. ${networkTypes[type].name} - ${networkTypes[type].description}`);
    });
    console.log('');
    
    // Ask for network type
    const networkTypeKey = await askQuestion(`Enter subgraph type (${Object.keys(networkTypes).join(' / ')}): `);
    const networkType = networkTypes[networkTypeKey];
    
    if (!networkType) {
      console.error(`❌ Invalid subgraph type: ${networkTypeKey}`);
      process.exit(1);
    }
    
    let selectedNetwork;
    let networkConfig;
    
    const availableNetworks = Object.keys(networkType.networks);

    // Auto-select if only one network is available
    if (availableNetworks.length === 1) {
      selectedNetwork = availableNetworks[0];
      networkConfig = networkType.networks[selectedNetwork];
      console.log(`✅ Only one network available. Auto-selected: ${selectedNetwork}`);
    } else {
      // Multiple networks available – show list
      console.log(`\nAvailable networks for ${networkType.name}:`);
      availableNetworks.forEach((network, index) => {
        console.log(`  ${index + 1}. ${network}: ${networkType.networks[network].description}`);
      });
      console.log('');
    
      const networkIndexStr = await askQuestion(`Enter network number (1-${availableNetworks.length}): `);
      const networkIndex = parseInt(networkIndexStr, 10) - 1;
    
      if (networkIndex >= 0 && networkIndex < availableNetworks.length) {
        selectedNetwork = availableNetworks[networkIndex];
        networkConfig = networkType.networks[selectedNetwork];
      }
    
      if (!networkConfig) {
        console.error(`❌ Invalid network selection: ${networkIndexStr}`);
        process.exit(1);
      }
    }
    
    // Ask for subgraph name
    const subgraphName = await askQuestion('Enter subgraph name (e.g., olas-tokenomics-mainnet): ');
    
    if (!subgraphName) {
      console.error('❌ Subgraph name is required');
      process.exit(1);
    }
    
    // Ask for version (optional)
    const version = await askQuestion('Enter version (default: v0.0.1): ') || 'v0.0.1';
    
    // Ask for deployment platform
    const platform = await askQuestion('Enter deployment platform (1. Graph Studio, 2. Alchemy): ') || '1';

    rl.close();
    
    console.log(`\n📦 Preparing deployment...`);
    console.log(`Subgraph Type: ${networkType.name}`);
    console.log(`Network: ${selectedNetwork}`);
    console.log(`Subgraph Name: ${subgraphName}`);
    console.log(`Version: ${version}`);
    console.log(`Platform: ${platform === '1' ? 'Graph Studio' : 'Alchemy'}`);
    console.log(`Config: ${networkConfig.path}\n`);
    
    // Determine build command based on network type
    const buildCommand = networkConfig.buildCommand;

    console.log(`🔨 Building subgraph with: ${buildCommand}`);
    execSync(buildCommand, {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    console.log(`\n🚀 Deploying to ${platform === '1' ? 'Graph Studio' : 'Alchemy'}...`);

    // Build the deployment command based on the selected platform
    let deployCommand;

    if (platform === '1') { // Graph Studio
      if (!process.env.GRAPH_DEPLOY_KEY) {
        console.error(`❌ GRAPH_DEPLOY_KEY environment variable is not set`);
        console.log(`\n📝 To fix this:`);
        console.log(`1. Go to https://thegraph.com/studio/`);
        console.log(`2. Create or select your subgraph`);
        console.log(`3. Copy your deploy key`);
        console.log(`4. Set it as an environment variable:`);
        console.log(`   export GRAPH_DEPLOY_KEY=your_deploy_key_here\n`);
        process.exit(1);
      }
      deployCommand = `graph deploy --deploy-key ${process.env.GRAPH_DEPLOY_KEY} --version-label ${version} ${subgraphName} ${networkConfig.path}`;
    } else if (platform === '2') { // Alchemy
      if (!process.env.ALCHEMY_DEPLOY_KEY) {
        console.error(`❌ ALCHEMY_DEPLOY_KEY environment variable is not set`);
        console.log(`\n📝 To fix this:`);
        console.log(`1. Go to your Alchemy dashboard`);
        console.log(`2. Navigate to the Subgraphs section`);
        console.log(`3. Find your deploy key`);
        console.log(`4. Set it as an environment variable:`);
        console.log(`   export ALCHEMY_DEPLOY_KEY=your_deploy_key_here\n`);
        process.exit(1);
      }
      deployCommand = `graph deploy --node https://subgraphs.alchemy.com/api/subgraphs/deploy --ipfs https://ipfs.satsuma.xyz --deploy-key ${process.env.ALCHEMY_DEPLOY_KEY} --version-label ${version} ${subgraphName} ${networkConfig.path}`;
    } else {
      console.error(`❌ Invalid deployment platform: ${platform}`);
      process.exit(1);
    }
    
    // Execute deployment
    execSync(deployCommand, { 
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    // Cleanup temporary files for L2 builds
    if (networkTypeKey === '2') {
      console.log(`\n🧹 Cleaning up temporary files...`);
      try {
        execSync('rm -rf generated-l2', { stdio: 'pipe' });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    if (platform === '1') {
      console.log(`\n✅ Successfully deployed to Studio!`);
      console.log(`📊 Dashboard: https://thegraph.com/studio/subgraph/${subgraphName}`);
    } else {
      console.log(`\n✅ Successfully deployed to Alchemy!`);
      console.log(`📊 Dashboard: Check your Alchemy dashboard for subgraph details.`);
    }
    
  } catch (error) {
    console.error(`❌ Deployment failed: ${error.message}`);
    process.exit(1);
  }
}

main();
