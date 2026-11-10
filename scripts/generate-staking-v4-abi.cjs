// ABI-only compilation of the staking release reviewed on 5 November 2026.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const [sourceRoot, toolsRoot] = process.argv.slice(2);
if (!sourceRoot || !toolsRoot) throw new Error('Usage: node scripts/generate-staking-v4-abi.cjs <registries-checkout> <compiler-package-directory>');
const revision = '0e065705af0ca8df84f75f7a19b814c21fa2d083';
const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], {encoding: 'utf8'}).trim();
if (git('rev-parse', 'HEAD') !== revision || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Expected clean pinned registries checkout');
const submodule = execFileSync('git', ['-C', path.join(sourceRoot, 'lib/solmate'), 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
if (git('rev-parse', 'HEAD:lib/solmate') !== submodule) throw new Error('Expected pinned solmate submodule');
const solc = require(path.resolve(toolsRoot, 'node_modules/solc'));
if (!solc.version().startsWith('0.8.30+commit.73712a01')) throw new Error('Expected solc 0.8.30');
const file = 'contracts/staking/StakingToken.sol';
const input = {language: 'Solidity', sources: {[file]: {content: fs.readFileSync(path.join(sourceRoot, file), 'utf8')}}, settings: {optimizer: {enabled: true, runs: 1000000}, evmVersion: 'prague', outputSelection: {'*': {'*': ['abi']}}}};
const output = JSON.parse(solc.compile(JSON.stringify(input), {import: file => {
  const source = path.join(sourceRoot, file);
  return fs.existsSync(source) ? {contents: fs.readFileSync(source, 'utf8')} : {error: `Missing import ${file}`};
}}));
const errors = (output.errors || []).filter(e => e.severity === 'error');
if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
fs.writeFileSync(path.resolve(__dirname, '../abis/StakingTokenV4.json'), JSON.stringify(output.contracts[file].StakingToken.abi, null, 2) + '\n');
console.log(`Generated StakingTokenV4 with ${solc.version()} from ${revision}`);
