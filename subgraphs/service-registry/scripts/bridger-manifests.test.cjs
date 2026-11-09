const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
for (const file of fs.readdirSync(root).filter(f => /^subgraph\..*\.yaml$/.test(f))) {
  test(`${file}: subscribes to wallet-clearing events where the bridger exists`, () => {
    const manifest = yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
    const bridger = manifest.dataSources.find(s => s.name === 'IdentityRegistryBridger');
    if (file === 'subgraph.mode-mainnet.yaml') {
      assert.equal(bridger, undefined); // Mode has no deployed bridger
      return;
    }
    assert(bridger, `${file}: missing IdentityRegistryBridger source`);
    assert(bridger.mapping.eventHandlers.some(h => h.event === 'AgentMultisigUpdated(indexed uint256,indexed uint256,address,indexed address)' && h.handler === 'handleAgentMultisigUpdated'));
    const abi = bridger.mapping.abis.find(a => a.name === bridger.source.abi);
    const artifact = JSON.parse(fs.readFileSync(path.resolve(root, abi.file), 'utf8'));
    const event = (Array.isArray(artifact) ? artifact : artifact.abi).find(e => e.type === 'event' && e.name === 'AgentMultisigUpdated');
    assert.deepEqual(event.inputs.map(i => [i.name, i.type, i.indexed]), [['serviceId', 'uint256', true], ['agentId', 'uint256', true], ['oldMultisig', 'address', false], ['newMultisig', 'address', true]]);
    const mapping = fs.readFileSync(path.resolve(root, bridger.mapping.file), 'utf8');
    assert(mapping.includes('export function handleAgentMultisigUpdated('));
  });
}
