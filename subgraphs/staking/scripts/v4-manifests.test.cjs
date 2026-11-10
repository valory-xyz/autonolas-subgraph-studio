const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const release = JSON.parse(fs.readFileSync(path.join(root, '../../abis/StakingTokenV4.json')));
const legacyArtifact = JSON.parse(fs.readFileSync(path.join(root, '../../abis/StakingProxy.json')));
const legacy = legacyArtifact.abi || legacyArtifact;
const signature = e => `${e.name}(${e.inputs.map(i => `${i.indexed ? 'indexed ' : ''}${i.type}`).join(',')})`;
for (const file of fs.readdirSync(root).filter(f => /^subgraph\..*\.yaml$/.test(f))) {
  test(`${file}: versioned templates cover their exact event interfaces`, () => {
    const manifest = yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.deepEqual(manifest.templates.map(t => t.name).sort(), ['StakingProxy', 'StakingProxyV4']);
    for (const [name, abi] of [['StakingProxy', legacy], ['StakingProxyV4', release]]) {
      const template = manifest.templates.find(t => t.name === name);
      const configured = template.mapping.eventHandlers.map(h => h.event.replace(/\s+/g, ''));
      const expected = abi.filter(e => e.type === 'event').map(e => signature(e).replace(/\s+/g, ''));
      assert.deepEqual(configured.sort(), expected.sort());
    }
  });
}
test('compiled v0.4 release has recipient arrays and three baseline events', () => {
  const reward = release.find(e => e.type === 'event' && e.name === 'RewardClaimed');
  assert.deepEqual(reward.inputs.slice(-2).map(i => [i.name, i.type]), [['receivers', 'address[]'], ['rewardAmounts', 'uint256[]']]);
  for (const name of ['ServicesRebaselined', 'ServiceBaselineMissing', 'ServiceBaselineRecovered']) assert(release.some(e => e.type === 'event' && e.name === name));
});
