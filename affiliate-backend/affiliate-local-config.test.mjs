import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../auth.js', import.meta.url), 'utf8').split('// Seed CURR_USER')[0];
const config = { url: 'https://affiliate-test.supabase.co/', publishableKey: 'sb_publishable_fixture' };
const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
function initialize({ hostname = 'localhost', saved, packaged = false, storageError = false } = {}) {
  const calls = [], errors = [], clients = [];
  const context = {
    window: { location: { hostname }, EV_APP_CONFIG: { packaged }, EVNative: { setAuthClient: client => clients.push(client) } },
    localStorage: { getItem: () => { if (storageError) throw new Error('Storage blocked'); return saved; } },
    supabase: { createClient: (...args) => { calls.push(args); return 'client'; } },
    console: { error: (...args) => errors.push(args) }, URL, atob,
  };
  vm.runInNewContext(source, context);
  return { calls, errors, clients };
}

test('localhost can use a separate test Supabase project', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const result = initialize({ hostname, saved: JSON.stringify(config) });
    assert.equal(result.calls[0][0], 'https://affiliate-test.supabase.co');
    assert.equal(result.calls[0][1], config.publishableKey);
    assert.equal(result.errors.length, 0);
  }
});
test('live websites ignore local development overrides', () => {
  for (const hostname of ['evsharps.com', 'www.evsharps.com', 'localhost.example.com']) {
    const result = initialize({ hostname, saved: JSON.stringify(config) });
    assert.equal(result.calls[0][0], 'https://nkdhryqpiulrepmphwmt.supabase.co');
  }
});
test('packaged app retains its production project and PKCE configuration', () => {
  const result = initialize({ packaged: true, saved: JSON.stringify(config) });
  assert.equal(result.calls[0][0], 'https://nkdhryqpiulrepmphwmt.supabase.co');
  assert.equal(result.calls[0][2].auth.flowType, 'pkce');
  assert.deepEqual(result.clients, ['client']);
});
test('malformed test configuration fails without silently using production', () => {
  for (const saved of ['{broken', '{}', JSON.stringify({ ...config, url: 'http://remote.example' }),
    JSON.stringify({ ...config, publishableKey: 'sb_secret_not_for_browsers' }),
    JSON.stringify({ ...config, publishableKey: jwt('service_role') })]) {
    const result = initialize({ saved });
    assert.equal(result.calls.length, 0);
    assert.equal(result.errors.length, 1);
  }
});
test('legacy anon keys and loopback Supabase URLs work', () => {
  const result = initialize({ saved: JSON.stringify({ url: 'http://127.0.0.1:54321', publishableKey: jwt('anon') }) });
  assert.equal(result.calls[0][0], 'http://127.0.0.1:54321');
  assert.equal(result.errors.length, 0);
});
test('existing sign-in works when no override is set or storage is blocked', () => {
  for (const settings of [{}, { storageError: true }]) {
    assert.equal(initialize(settings).calls[0][0], 'https://nkdhryqpiulrepmphwmt.supabase.co');
  }
});
