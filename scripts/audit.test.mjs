import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/audit.mjs');
function runAudit(rows, exitCode) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin/yarn'), `#!/bin/sh\ncat <<'AUDIT_JSON'\n${rows.map(JSON.stringify).join('\n')}\nAUDIT_JSON\nexit ${exitCode}\n`, { mode: 0o755 });
    return spawnSync(process.execPath, [script], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('registry errors fail instead of reporting a clean audit', () => {
  const result = runAudit([{ type: 'error', data: 'Registry unavailable' }], 1);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /did not complete successfully/);
  assert.doesNotMatch(result.stdout, /audit: OK/);
});

test('incomplete audit output fails even when Yarn exits zero', () => {
  assert.equal(runAudit([{ type: 'info', data: 'Starting audit' }], 0).status, 2);
});

test('completed clean audits pass', () => {
  assert.equal(runAudit([{ type: 'auditSummary', data: { vulnerabilities: {} } }], 0).status, 0);
});

test('completed audits with unlisted high findings fail', () => {
  const result = runAudit([
    { type: 'auditAdvisory', data: { advisory: { id: 123, severity: 'high', module_name: 'example', vulnerable_versions: '<2', patched_versions: '>=2', title: 'Example finding' }, resolution: { path: 'parent>example' } } },
    { type: 'auditSummary', data: { vulnerabilities: { high: 1 } } },
  ], 8);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not allowlisted/);
});
