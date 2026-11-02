import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function boot(env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/server.js')"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3049', PUBLIC_BASE_URL: 'http://127.0.0.1:3049', SESSION_SECRET: '', ...env },
  });
}

test('invalid room capacity fails during startup', () => {
  const result = boot({ MAX_ROOMS: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MAX_ROOMS must be a whole number/);
});
test('production requires a strong session secret and HTTPS origin', () => {
  const noSecret = boot({ NODE_ENV: 'production', SESSION_SECRET: '', PUBLIC_BASE_URL: 'https://show.example' });
  assert.notEqual(noSecret.status, 0);
  assert.match(noSecret.stderr, /SESSION_SECRET must contain at least 32 characters/);
  const insecureUrl = boot({ NODE_ENV: 'production', SESSION_SECRET: 'development-test-secret-with-enough-length-123', PUBLIC_BASE_URL: 'http://show.example' });
  assert.notEqual(insecureUrl.status, 0);
  assert.match(insecureUrl.stderr, /PUBLIC_BASE_URL must be an HTTPS origin/);
});
test('production refuses verbose debug logging', () => {
  const result = boot({ NODE_ENV: 'production', SESSION_SECRET: 'development-test-secret-with-enough-length-123', PUBLIC_BASE_URL: 'https://show.example', LOG_LEVEL: 'debug' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LOG_LEVEL must not be debug or trace in production/);
});
