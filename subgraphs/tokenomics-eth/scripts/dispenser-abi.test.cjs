const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readAbi = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../../../abis', name + '.json'), 'utf8'));
const legacy = readAbi('DispenserV2');
const proxy = readAbi('DispenserProxy');

// Every proxy event except its unique upgrade event uses legacy positional getters.
for (const event of proxy.filter(item => item.type === 'event' && item.name !== 'ImplementationUpdated')) {
  test(`${event.name} preserves the legacy positional ABI layout`, () => {
    const matches = legacy.filter(item => item.type === 'event' && item.name === event.name);
    assert.equal(matches.length, 1, 'Expected one legacy event');
    assert.equal(event.anonymous, matches[0].anonymous);
    assert.deepEqual(event.inputs, matches[0].inputs);
  });
}
