const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'shared.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
const environmentSource = shared.slice(0, shared.indexOf('function getToday()'));
const navigationSource = shared.slice(shared.indexOf('function changePage(page)'), shared.indexOf('function parseBook(book)'));
const production = 'https://api-production-3a3b.up.railway.app';

function setup({ packaged = false, hostname = 'localhost', apiBase = production } = {}) {
  const calls = { options: null, authClient: null, providers: [], navigation: [], external: [], sessions: 0, init: 0 };
  let releaseAuth;
  const authReady = new Promise(resolve => { releaseAuth = resolve; });
  const client = { auth: {
    getSession: async () => { calls.sessions++; return { data: { session: null } }; },
    signInWithOAuth: async options => { calls.providers.push(options); return { data: {}, error: null }; },
  } };
  const location = { hostname, host: hostname, protocol: 'https:', origin: `https://${hostname}`, href: '' };
  const context = vm.createContext({
    window: { innerWidth: 390, location, EV_APP_CONFIG: { packaged, apiBase }, EVNative: {
      authReady,
      setAuthClient: value => { calls.authClient = value; },
      navigate: value => { calls.navigation.push(value); },
      signIn: async provider => { calls.providers.push(provider); },
      openExternal: async url => { calls.external.push(url); },
    } },
    location, calls, console, URLSearchParams,
    localStorage: { getItem: () => null },
    document: { querySelector: () => ({ style: {} }), querySelectorAll: () => [] },
    supabase: { createClient: (_url, _key, options) => { calls.options = options; return client; } },
    fetch: async () => ({ json: async () => ({ url: 'https://billing.example/session' }) }),
  });
  vm.runInContext(environmentSource + navigationSource + auth, context);
  vm.runInContext('initPageData = () => { calls.init++; };', context);
  return { context, calls, client, releaseAuth, get: expression => vm.runInContext(expression, context) };
}

test('packaged localhost uses production API, bundled routes and bridge navigation', () => {
  const runtime = setup({ packaged: true });
  assert.equal(runtime.get('IS_PACKAGED_APP'), true);
  assert.equal(runtime.get('IS_LOCALHOST'), false);
  assert.equal(runtime.get('HTML'), '.html');
  assert.equal(runtime.get('API_BASE'), production);
  runtime.get("changePage('main?sport=nhl')");
  assert.deepEqual(runtime.calls.navigation, ['main?sport=nhl']);
  assert.equal(runtime.context.location.href, '');
  const custom = setup({ packaged: true, apiBase: 'https://api.example.test' });
  assert.equal(custom.get('API_BASE'), 'https://api.example.test');
});

test('website and local development retain their routes and API selection', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'www.evsharps.com']) {
    const runtime = setup({ hostname, apiBase: 'https://ignored.example.test' });
    const local = hostname !== 'www.evsharps.com';
    assert.equal(runtime.get('IS_PACKAGED_APP'), false);
    assert.equal(runtime.get('IS_LOCALHOST'), local);
    assert.equal(runtime.get('API_BASE'), local ? 'http://localhost:5001' : production);
    runtime.get("changePage('main?sport=nhl')");
    assert.equal(runtime.context.location.href, `./main${local ? '.html' : ''}?sport=nhl`);
    assert.deepEqual(runtime.calls.navigation, []);
    assert.equal(runtime.calls.options, undefined);
    assert.equal(runtime.calls.authClient, null);
  }
});

test('native PKCE client waits for pending callback before checking its session', async () => {
  const runtime = setup({ packaged: true });
  assert.equal(runtime.calls.options.auth.flowType, 'pkce');
  assert.equal(runtime.calls.options.auth.detectSessionInUrl, false);
  assert.equal(runtime.calls.authClient, runtime.client);
  const pending = runtime.get('handleSession()');
  await Promise.resolve();
  assert.equal(runtime.calls.sessions, 0);
  assert.equal(runtime.calls.init, 0);
  runtime.releaseAuth();
  await pending;
  assert.equal(runtime.calls.sessions, 1);
  assert.equal(runtime.calls.init, 1);
});

test('auth client construction also supports pages loading auth before shared', () => {
  let options, registered;
  const client = {};
  const context = vm.createContext({ window: { EV_APP_CONFIG: { packaged: true }, EVNative: {
    setAuthClient: value => { registered = value; },
  } }, localStorage: { getItem: () => null },
  supabase: { createClient: (_url, _key, opts) => { options = opts; return client; } } });
  vm.runInContext(auth, context);
  assert.equal(options.auth.flowType, 'pkce');
  assert.equal(registered, client);
});

test('native provider login and billing hand off without replacing the WebView', async () => {
  const runtime = setup({ packaged: true });
  await runtime.get('loginWithGoogle()');
  await runtime.get('loginWithDiscord()');
  await runtime.get("upgrade('sharp')");
  assert.deepEqual(runtime.calls.providers, ['google', 'discord']);
  assert.deepEqual(runtime.calls.external, ['https://billing.example/session']);
  assert.equal(runtime.context.location.href, '');
});

test('web login uses its existing OAuth callback and never waits for the native bridge', async () => {
  const runtime = setup({ hostname: 'www.evsharps.com' });
  await runtime.get('handleSession()');
  await runtime.get('loginWithGoogle()');
  await runtime.get('loginWithDiscord()');
  assert.equal(runtime.calls.sessions, 1);
  assert.deepEqual(runtime.calls.providers.map(options => options.provider), ['google', 'discord']);
  assert(runtime.calls.providers.every(options => options.options.redirectTo === 'https://www.evsharps.com/profile'));
  await runtime.get("upgrade('sharp')");
  assert.equal(runtime.context.location.href, 'https://billing.example/session');
  assert.deepEqual(runtime.calls.external, []);
});
