// Offline, deterministic controller/SSE checks: node --test tests/table-refresh.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = () => fs.readFileSync(path.join(__dirname, '../page-performance.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  dispatchEvent(event) {
    event.target ||= this;
    this[`on${event.type}`]?.(event);
    for (const listener of [...(this.events.get(event.type) || [])]) listener(event);
  }
  emit(type, extra = {}) { this.dispatchEvent({ type, ...extra }); }
}

// Only the DOM operations used to mount/update the refresh controls are needed.
class Element extends Events {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; this.id = '';
    this.style = {}; this.dataset = {}; this.textContent = ''; this.checked = false; this.disabled = false;
    this.classList = { add: name => { this.className += ` ${name}`; }, remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); },
      toggle: (name, value) => { if (value) this.classList.add(name); else this.classList.remove(name); }, contains: name => this.className.split(' ').includes(name) };
  }
  append(...nodes) { nodes.filter(node => typeof node !== 'string').forEach(node => { node.remove(); node.parentElement = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  insertBefore(node, before) { this.append(node); if (before && this.children.includes(before)) { this.children.pop(); this.children.splice(this.children.indexOf(before), 0, node); } }
  before(node) { this.parentElement?.insertBefore(node, this); }
  after(node) { const parent = this.parentElement; if (parent) parent.insertBefore(node, parent.children[parent.children.indexOf(this) + 1]); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this[key === 'class' ? 'className' : key] = String(value); }
  getAttribute(key) { return this[key === 'class' ? 'className' : key] ?? null; }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('#')) return node.id === value.slice(1);
      if (value.startsWith('.')) return node.className.split(/\s+/).includes(value.slice(1));
      return node.tagName.toLowerCase() === value;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(html) {
    this.replaceChildren();
    for (const match of html.matchAll(/<(button|input|span|label|div)\b([^>]*)>/g)) {
      const node = new Element(match[1]);
      for (const attr of match[2].matchAll(/([\w-]+)=["']([^"']*)["']/g)) node.setAttribute(attr[1], attr[2]);
      node.checked = /\bchecked\b/.test(match[2]); this.append(node);
    }
  }
}

function harness({ stored = null, storageBlocked = false, holdInitial = false } = {}) {
  let now = 0, id = 0, active = 0, maxActive = 0, holdNext = holdInitial, failNext = false;
  const timers = new Map(), requests = [], sources = [], storedValues = new Map();
  if (stored !== null) storedValues.set('ev_table_auto_refresh', stored);
  const schedule = (fn, delay, repeat = false) => { const key = ++id; timers.set(key, { fn, at: now + Number(delay || 0), repeat, delay: Number(delay || 0) }); return key; };
  async function tick(amount) {
    const end = now + amount;
    for (let steps = 0; ; steps++) {
      assert.ok(steps < 10000, 'Timer loop did not settle');
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [key, timer] = next; now = timer.at;
      if (timer.repeat) timer.at += Math.max(1, timer.delay); else timers.delete(key);
      timer.fn(); await flush();
    }
    now = end; await flush();
  }
  const document = new Events(); document.visibilityState = 'visible'; document.body = new Element('body'); document.head = new Element('head');
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.querySelector(selector);
  document.getElementById = key => document.querySelector(`#${key}`);
  const main = new Element('main'), holder = new Element(); holder.id = 'table-container';
  const table = new Element(); table.id = 'table'; holder.append(table); main.append(holder); document.body.append(main);
  const window = new Events();
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class EventSource extends Events {
    constructor(url) { super(); this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({ document, window, EventSource, Date: FakeDate, URL, AbortController,
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: key => timers.delete(key),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: key => timers.delete(key),
    performance: { now: () => now }, console: { error() {}, warn() {} }, ACCESS_TOKEN: 'fixture', API_BASE: 'http://localhost:3000', tableReady: Promise.resolve(),
    localStorage: { getItem(key) { if (storageBlocked) throw Error('blocked'); return storedValues.get(key) ?? null; }, setItem(key, value) { if (storageBlocked) throw Error('blocked'); storedValues.set(key, String(value)); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: () => {
      active++; maxActive = Math.max(maxActive, active);
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const response = { ok: true, headers: { get: key => key === 'X-Odds-Dataset' ? 'nba' : 'version' }, json: async () => ({ data: [], updated: {} }) };
      const request = { finish(error = false) { active--; if (error) reject(Error('offline')); else resolve(response); } };
      requests.push(request);
      if (holdNext) holdNext = false; else { request.finish(failNext); failNext = false; }
      return promise;
    },
  });
  window.localStorage = context.localStorage;
  vm.runInContext(source(), context);
  context.showDataStatus = () => {};
  const refresh = context.createDataRefresh(() => '/api/nba', async () => {});
  context.testRefresh = refresh;
  return { context, document, window, refresh, requests, sources, storedValues, tick,
    start: options => context.startTableRefresh(refresh, options),
    hold: () => { holdNext = true; }, fail: () => { failNext = true; }, maxActive: () => maxActive,
    watcher: () => vm.runInContext('oddsLiveWatchers.get(testRefresh)', context),
    hide() { document.visibilityState = 'hidden'; document.emit('visibilitychange'); },
    show() { document.visibilityState = 'visible'; document.emit('visibilitychange'); },
  };
}

test('initial load, manual refresh, completion-based countdown and failed polling never overlap', async () => {
  const h = harness({ holdInitial: true }), controller = h.start({ intervalMs: 2000 });
  await flush(); assert.equal(h.requests.length, 1);
  assert.ok(h.document.getElementById('table-refresh-controls'));
  assert.ok(h.document.querySelector('.table-refresh-now'));
  assert.equal(h.document.getElementById('table-refresh-controls').querySelector('input').checked, true);
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Refreshing…');
  assert.equal(h.document.querySelector('.table-refresh-now').disabled, true);
  assert.equal(h.refresh.autoRefreshEnabled, true);
  controller.refreshNow(); await flush(); assert.equal(h.requests.length, 1);
  await h.tick(3000); assert.equal(h.requests.length, 1, 'Poll waits for the initial request');
  h.requests[0].finish(); await flush();
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Next in 2s');
  assert.equal(h.document.querySelector('.table-refresh-now').disabled, false);
  await h.tick(1999); assert.equal(h.requests.length, 1, 'Countdown starts at completion');
  await h.tick(1); assert.equal(h.requests.length, 2);
  h.fail(); await h.tick(2000); assert.equal(h.requests.length, 3);
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Retry in 2s');
  await h.tick(1999); assert.equal(h.requests.length, 3);
  await h.tick(1); assert.equal(h.requests.length, 4, 'Polling recovers after a failed fetch');
  assert.equal(h.maxActive(), 1); controller.dispose();
});

test('saved Off allows initial/manual loads, blocks every automatic trigger and enables immediately', async () => {
  const h = harness({ stored: 'false' }), controller = h.start(); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.refresh.autoRefreshEnabled, false);
  assert.equal(h.document.getElementById('table-refresh-controls').querySelector('input').checked, false);
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Auto off');
  assert.equal(h.sources.length, 0);
  await h.tick(90000); h.hide(); h.show(); h.window.emit('pagehide'); h.window.emit('pageshow'); await h.tick(500);
  assert.equal(h.requests.length, 1);
  h.document.querySelector('.table-refresh-now').emit('click'); await flush();
  assert.equal(h.requests.length, 2, 'Refresh button remains usable with Auto off');
  const checkbox = h.document.getElementById('table-refresh-controls').querySelector('input'); checkbox.checked = true; checkbox.emit('change'); await flush();
  assert.equal(h.requests.length, 3, 'Turning Auto on refreshes immediately');
  assert.equal(h.refresh.autoRefreshEnabled, true); assert.equal(h.storedValues.get('ev_table_auto_refresh'), 'true');
  assert.equal(h.sources.filter(source => !source.closed).length, 1);
  controller.setEnabled(false); await flush();
  assert.equal(h.storedValues.get('ev_table_auto_refresh'), 'false');
  assert.ok(h.sources.every(source => source.closed));
  await h.tick(90000); assert.equal(h.requests.length, 3); controller.dispose();
});

test('turning Off cancels queued SSE ready/update work, including invalidation waiting on a request', async () => {
  const h = harness(), controller = h.start(); await flush();
  assert.equal(typeof h.watcher().setEnabled, 'function');
  const source = h.sources.at(-1);
  source.emit('ready'); source.emit('odds-update', { data: JSON.stringify({ dataset: 'nba' }) });
  controller.setEnabled(false); await h.tick(500); assert.equal(h.requests.length, 1);
  controller.setEnabled(true); await flush(); assert.equal(h.requests.length, 2);
  h.hold(); const manual = controller.refreshNow(); await flush(); assert.equal(h.requests.length, 3);
  const latest = h.sources.at(-1);
  latest.emit('odds-update', { data: JSON.stringify({ dataset: 'nba' }) }); await h.tick(100);
  assert.equal(h.requests.length, 3);
  controller.setEnabled(false); h.requests[2].finish(); await manual; await flush();
  source.emit('ready'); latest.emit('odds-update', { data: JSON.stringify({ dataset: 'nba' }) }); await h.tick(500);
  assert.equal(h.requests.length, 3, 'A queued invalidation must not fetch after Auto is disabled');
  assert.equal(h.maxActive(), 1); controller.dispose();
});

test('SSE batches matching invalidations and ignores malformed or unrelated datasets', async () => {
  const h = harness(), controller = h.start(); await flush();
  const source = h.sources.at(-1);
  source.emit('odds-update', { data: '{bad json' });
  source.emit('odds-update', { data: JSON.stringify({ dataset: 'nhl' }) }); await h.tick(100);
  assert.equal(h.requests.length, 1);
  source.emit('ready'); source.emit('odds-update', { data: JSON.stringify({ dataset: 'nba' }) });
  await h.tick(99); assert.equal(h.requests.length, 1); await h.tick(1); assert.equal(h.requests.length, 2);
  h.hold(); const manual = controller.refreshNow(); await flush();
  source.emit('ready'); await h.tick(100);
  assert.equal(h.requests.length, 3, 'Ready waits for an existing refresh');
  h.requests[2].finish(); await manual; await flush();
  assert.equal(h.requests.length, 4, 'Ready reconciles after the existing refresh completes');
  assert.equal(h.maxActive(), 1);
  controller.dispose();
});

test('queued SSE follow-up retains busy controls until it finishes, then starts the countdown', async () => {
  const h = harness(), controller = h.start({ intervalMs: 2000 }); await flush();
  h.hold(); const manual = controller.refreshNow(); await flush();
  h.sources.at(-1).emit('odds-update', { data: JSON.stringify({ dataset: 'nba' }) });
  await h.tick(100); assert.equal(h.requests.length, 2);
  h.hold(); h.requests[1].finish(); await manual; await flush();
  assert.equal(h.requests.length, 3, 'The invalidation starts its own fetch after the manual refresh');
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Refreshing…');
  assert.equal(h.document.querySelector('.table-refresh-now').disabled, true);
  assert.equal(h.document.getElementById('table-refresh-controls').getAttribute('aria-busy'), 'true');
  await h.tick(3000); assert.equal(h.requests.length, 3, 'No poll is scheduled while the SSE follow-up is pending');
  h.requests[2].finish(); await flush();
  assert.equal(h.document.querySelector('.table-refresh-status').textContent, 'Next in 2s');
  assert.equal(h.document.querySelector('.table-refresh-now').disabled, false);
  await h.tick(1999); assert.equal(h.requests.length, 3);
  await h.tick(1); assert.equal(h.requests.length, 4);
  assert.equal(h.maxActive(), 1); controller.dispose();
});

test('hidden/pagehide pause polling and live work; resume reconciles once and disposal stops both', async () => {
  const h = harness(), controller = h.start({ intervalMs: 2000 }); await flush();
  h.hide(); await h.tick(10000); assert.equal(h.requests.length, 1); assert.ok(h.sources.every(source => source.closed));
  h.show(); await h.tick(0); assert.equal(h.requests.length, 2);
  h.window.emit('pagehide'); await h.tick(10000); assert.equal(h.requests.length, 2);
  h.window.emit('pageshow'); await h.tick(0); assert.equal(h.requests.length, 3);
  controller.dispose();
  h.hide(); h.show(); h.window.emit('pagehide'); h.window.emit('pageshow');
  for (const source of h.sources) source.emit('ready');
  await h.tick(10000); assert.equal(h.requests.length, 3); assert.ok(h.sources.every(source => source.closed));
});

test('requestLatest rechecks its allowed predicate after a pending request settles', async () => {
  const h = harness({ holdInitial: true }); let allowed = true;
  const initial = h.refresh(), queued = h.refresh.requestLatest(() => allowed); await flush();
  allowed = false; h.requests[0].finish(); await Promise.all([initial, queued]);
  assert.equal(h.requests.length, 1);
});

test('blocked preference storage keeps manual/auto controls usable', async () => {
  const h = harness({ storageBlocked: true }), controller = h.start(); await flush();
  assert.equal(h.refresh.autoRefreshEnabled, true); controller.setEnabled(false);
  await controller.refreshNow(); assert.equal(h.requests.length, 2);
  controller.setEnabled(true); await flush(); assert.equal(h.requests.length, 3);
  controller.dispose();
});
