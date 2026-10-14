const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the browser script itself; loading presets must not need the DOM,
// an authenticated session, or a request to the production API.
function runtime() {
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, debounce: fn => fn,
    DEVIG: 'pn', ALL_WEIGHTABLE_BOOKS: ['pn', 'circa', 'bm', 'b365', 'fd', 'dk'],
    PAGE: 'tds', SPORT: 'nfl', METHOD: 'probit', RECORD: {},
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} },
    fetch: async () => { throw new Error('Unexpected network request'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'weights.js'), 'utf8'), context,
    { filename: 'weights.js' });
  return {
    context,
    run(expression) { return vm.runInContext(expression, context); },
    set(name, value) {
      context.__presetTestValue = value;
      vm.runInContext(`${name} = __presetTestValue`, context);
      delete context.__presetTestValue;
    },
    call(name, ...args) { return context[name](...args); },
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const stats = (roi, kellyRoi, extra = {}) => ({
  wins: 12, losses: 8, roi, profit: roi / 5,
  kelly_roi: kellyRoi, kelly: kellyRoi / 5, kelly_stake_units: 20, ...extra,
});
function records(source = 'closing') {
  const flat = source === 'opening' ? [20, 10, 40, 30] : [40, 30, 20, 10];
  const kelly = source === 'opening' ? [30, 20, 10, 40] : [10, 40, 30, 20];
  const devigs = Object.fromEntries(['pn', 'circa', 'bm', 'b365'].map((book, i) => [
    `attd-vs-${book}`, { All: stats(flat[i], kelly[i]), L7: stats(5 + i, 8 - i) },
  ]));
  return {
    probit: {
      fd: devigs,
      dk: { 'attd-vs-pn': { All: stats(75, 80), L7: stats(25, 35) } },
    },
    worst: { fd: { 'attd-vs-pn': { All: stats(7, 9), L7: stats(2, 3) } } },
  };
}
function installOpening(env, report = { records: records('opening') }, feed = 'nfl') {
  env.context.__presetOpening = { status: 'ready', report: { available: true, kelly_available: true, window: null, ...report } };
  env.run(`OPENING_PRESET_CACHE.set(${JSON.stringify(feed)}, __presetOpening)`);
  delete env.context.__presetOpening;
}

function packedRecords() {
  return {
    v: 1,
    fields: [['wins', 'losses', 'roi', 'profit', 'kelly_roi', 'kelly', 'kelly_stake_units']],
    windows: [['All', 'L7']],
    rows: [[0, 12, 8, 40, 8, 10, 2, 20], [0, 6, 4, -20, -2, 0, 0, 20]],
    data: { probit: { fd: { 'attd-vs-pn': [-1, 0, 1], 'attd-vs-circa': [-1, 1, 0] } } },
  };
}
function openingPayload(feed = 'nfl') {
  return { schema_version: 1, feed, price_source: 'opening', available: true,
    updated: '2026-10-14T10:00:00Z', window: { start: '2026-09-01', end: '2026-10-13' },
    kelly_metric: 'units_per_100_settled', kelly_available: true, records: packedRecords() };
}

test('preset feeds preserve sport scope and distinguish main lines', () => {
  const env = runtime();
  for (const [page, sport, expected] of [
    ['dingers', 'mlb', 'mlb'], ['mlb', 'mlb', 'mlb'], ['strikeouts', 'mlb', 'mlb'],
    ['atgs', 'nhl', 'nhl'], ['fgs', 'nhl', 'nhl'], ['nhl', 'nhl', 'nhl'],
    ['tds', 'nfl', 'nfl'], ['ftd', 'nfl', 'nfl'], ['nfl', 'nfl', 'nfl'],
    ['main', 'mlb', 'mlb_main'], ['main', 'nhl', 'nhl_main'], ['main_recap', 'nfl', 'nfl_main'],
    ['preseason', 'nfl', 'nfl_main'], ['main', 'nfl_main', 'nfl_main'], ['main', 'NHL', 'nhl_main'],
    ['main', 'not-a-sport', null], ['tds', '../../private', null],
  ]) assert.equal(env.call('presetFeed', page, sport), expected, `${page}/${sport}`);
});

test('compact opening records decode pooled vectors and windows without mutating input', () => {
  const env = runtime(), packed = packedRecords(), before = JSON.stringify(packed);
  const decoded = plain(env.call('decodePresetRecords', packed));
  assert.deepEqual(decoded, { probit: { fd: {
    'attd-vs-pn': { All: stats(40, 10), L7: stats(-20, 0, { wins: 6, losses: 4, profit: -2 }) },
    'attd-vs-circa': { All: stats(-20, 0, { wins: 6, losses: 4, profit: -2 }), L7: stats(40, 10) },
  } } });
  assert.equal(JSON.stringify(packed), before);
  const report = env.call('validateOpeningPreset', openingPayload(), 'nfl');
  assert.deepEqual(plain(report.records), decoded);
  assert.equal(report.kelly_metric, 'units_per_100_settled');
});

test('older packed records still support flat staking without inventing Kelly stakes', () => {
  const env = runtime(), payload = openingPayload();
  payload.records.fields[0].pop();
  payload.records.rows.forEach(row => row.pop());
  const report = env.call('validateOpeningPreset', payload, 'nfl');
  const record = report.records.probit.fd['attd-vs-pn'].All;
  assert.equal(record.kelly_stake_units, undefined);
  assert.equal(env.call('presetRecordStats', record, 'flat').roi, 40);
  assert.equal(env.call('presetRecordStats', record, 'quarter-kelly').roi, null);
});

test('compact records reject bad indexes, schema ambiguity and malformed unused rows', () => {
  const env = runtime();
  const mutations = [
    value => { value.v = 2; },
    value => { value.data.probit.fd['attd-vs-pn'] = [-1, 99, 0]; },
    value => { value.data.probit.fd['attd-vs-pn'] = [-1, 0.5, 0]; },
    value => { value.data.probit.fd['attd-vs-pn'] = [-2, 0, 1]; },
    value => { value.data.probit.fd['attd-vs-pn'] = [-1, 0, 1, 0]; },
    value => { value.rows[0][0] = 1; },
    value => { value.rows[0].push(0); },
    value => { value.rows.push([0, 1, 1, Infinity, 1, 1, 1, 1]); },
    value => { value.rows.push([0, 1, 1, {}, 1, 1, 1, 1]); },
    value => { value.rows[0][7] = Infinity; },
    value => { value.fields[0][1] = 'wins'; },
    value => { value.fields[0][1] = 'unexpected'; },
    value => { value.windows[0][1] = 'All'; },
    value => { value.windows[0][1] = 'Tomorrow'; },
  ];
  for (const mutate of mutations) {
    const packed = packedRecords(); mutate(packed);
    assert.throws(() => env.call('decodePresetRecords', packed), /Invalid opening preset records/);
  }
});

test('compact records reject prototype keys and excessive nesting', () => {
  const env = runtime();
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const packed = packedRecords();
    packed.data = JSON.parse(`{"probit":{"${key}":{"polluted":true}}}`);
    assert.throws(() => env.call('decodePresetRecords', packed), /Invalid opening preset records/);
  }
  const packed = packedRecords();
  for (let depth = 0; depth < 15; depth++) packed.data = { nested: packed.data };
  assert.throws(() => env.call('decodePresetRecords', packed), /Invalid opening preset records/);
  assert.equal({}.polluted, undefined);
});

test('opening report retains its version and legacy metric metadata while validating feed and source', () => {
  const env = runtime();
  for (const change of [{ feed: 'nhl' }, { price_source: 'closing' }, { schema_version: 2 },
    { available: 1 }, { kelly_available: 'yes' }, { kelly_metric: 'roi' }, { updated: 'bad date' },
    { window: { start: '2026-10-14', end: '2026-10-01' } }, { window: { start: '10/01/2026', end: '10/14/2026' } }]) {
    assert.throws(() => env.call('validateOpeningPreset', { ...openingPayload(), ...change }, 'nfl'), /Invalid opening preset/);
  }
});

test('flat and Kelly stats select their own metric and preserve zero or negative returns', () => {
  const env = runtime();
  const record = stats(0, -10);
  const flat = env.call('presetRecordStats', record, 'flat');
  const kelly = env.call('presetRecordStats', record, 'quarter-kelly');
  assert.equal(flat.hasRecord, true);
  assert.equal(flat.roi, 0);
  assert.equal(kelly.hasRecord, true);
  assert.equal(kelly.roi, -10);
  assert.equal(kelly.wins, 12);
  assert.equal(kelly.losses, 8);
});

test('Kelly displays stake ROI and a separate signed profit in units', () => {
  const env = runtime();
  const row = { hasRecord: true, roi: 12.5, kelly: 2.5, kellyStakeUnits: 20, recordWindow: 'All' };
  assert.equal(env.call('presetMetricLabel', { ...row, staking: 'flat' }), '+12.5% ROI');
  assert.equal(env.call('presetMetricLabel', { ...row, staking: 'quarter-kelly' }), '+12.5% ROI');
  assert.equal(env.call('presetProfitLabel', { ...row, staking: 'quarter-kelly' }), '+2.5u');
  assert.equal(env.call('presetProfitLabel', { ...row, staking: 'quarter-kelly', kelly: -2.5 }), '-2.5u');
  assert.equal(env.call('presetProfitLabel', { ...row, staking: 'quarter-kelly', kelly: 0 }), '0u');
  assert.equal(env.call('presetProfitLabel', { ...row, staking: 'flat' }), '');
  assert.equal(env.call('presetProfitLabel', { ...row, staking: 'quarter-kelly', hasRecord: false }), '');
});

test('Kelly ROI uses profit divided by actual stakes and ignores legacy Kelly ROI', () => {
  const env = runtime();
  for (const legacy of [undefined, null, '', 999, -999, Infinity]) {
    const selected = env.call('presetRecordStats', stats(35, legacy, { kelly: 7.5, kelly_stake_units: 30 }), 'quarter-kelly');
    assert.equal(selected.hasRecord, true);
    assert.equal(selected.roi, 25);
    assert.equal(selected.kelly, 7.5);
    assert.equal(selected.kellyStakeUnits, 30);
  }
  const selected = env.call('presetRecordStats', { w: '3', l: '2', kelly: '-1.5', kelly_stake_units: '12' }, 'quarter-kelly');
  assert.equal(selected.hasRecord, true);
  assert.equal(selected.roi, -12.5);
  assert.equal(selected.kelly, -1.5);
  assert.equal(selected.kellyStakeUnits, 12);
});

test('missing, zero, negative, or nonfinite Kelly stakes never produce a fake ROI', () => {
  const env = runtime();
  for (const stake of [undefined, null, '', '  ', 0, -1, Infinity, -Infinity, NaN, 'bad', true]) {
    const record = stats(35, 99, { kelly_stake_units: stake });
    assert.equal(env.call('presetRecordStats', record, 'flat').hasRecord, true, `flat data survives ${stake}`);
    const selected = env.call('presetRecordStats', record, 'quarter-kelly');
    assert.equal(selected.hasRecord, false, `invalid stake ${stake}`);
    assert.equal(selected.roi, null, `invalid stake ${stake}`);
    assert.equal(env.call('presetProfitLabel', { ...selected, staking: 'quarter-kelly' }), '');
  }
  const legacy = { wins: 12, losses: 8, roi: 35, kelly_roi: 99, kelly: 4 };
  assert.equal(env.call('presetRecordStats', legacy, 'flat').roi, 35);
  assert.equal(env.call('presetRecordStats', legacy, 'quarter-kelly').hasRecord, false);
});

test('Kelly profit must be finite, but a measured zero profit is valid', () => {
  const env = runtime();
  for (const profit of [undefined, null, '', '  ', Infinity, -Infinity, NaN, 'bad', true]) {
    const selected = env.call('presetRecordStats', stats(35, 99, { kelly: profit }), 'quarter-kelly');
    assert.equal(selected.hasRecord, false, `invalid profit ${profit}`);
    assert.equal(selected.roi, null);
  }
  const zero = env.call('presetRecordStats', stats(35, 99, { kelly: 0 }), 'quarter-kelly');
  assert.equal(zero.hasRecord, true);
  assert.equal(zero.roi, 0);
  assert.equal(zero.kelly, 0);
  assert.equal(env.call('presetRecordStats', stats(35, 99, { kelly: 0, kelly_stake_units: 0 }), 'quarter-kelly').roi, null);
  assert.equal(env.call('presetRecordStats', stats(35, 99, { kelly: Number.MAX_VALUE, kelly_stake_units: Number.MIN_VALUE }), 'quarter-kelly').hasRecord, false);
});

test('Kelly permits settled pushes but never treats pending results as settled stakes', () => {
  const env = runtime();
  const record = stats(0, 99, { wins: 0, losses: 0, pushes: 2, kelly: 0, kelly_stake_units: 5 });
  const selected = env.call('presetRecordStats', record, 'quarter-kelly');
  assert.equal(selected.hasRecord, true);
  assert.equal(selected.roi, 0);
  assert.equal(env.call('presetRecordStats', record, 'flat').hasRecord, false);
  for (const pushes of [0, -1, Infinity, 'bad']) {
    const pending = { ...record, pushes, pending: 10, ungraded: 5 };
    assert.equal(env.call('presetRecordStats', pending, 'quarter-kelly').hasRecord, false);
  }
});

test('only finite returns with at least one settled result have a record', () => {
  const env = runtime();
  for (const record of [null, {}, stats(10, 20, { wins: 0, losses: 0 }),
    stats(10, 20, { wins: -1 }), stats(Infinity, 20), stats('bad', 20)]) {
    assert.equal(env.call('presetRecordStats', record, 'flat').hasRecord, false);
  }
  const aliases = env.call('presetRecordStats', { w: '3', l: '2', roi: '12.5', kelly_roi: '6' }, 'flat');
  assert.equal(aliases.hasRecord, true);
  assert.equal(aliases.roi, 12.5);
  assert.equal(aliases.wins, 3);
  assert.equal(aliases.losses, 2);
});

for (const [source, staking, order] of [
  ['closing', 'flat', ['pn', 'circa', 'bm', 'b365']],
  ['closing', 'quarter-kelly', ['circa', 'bm', 'b365', 'pn']],
  ['opening', 'flat', ['bm', 'b365', 'pn', 'circa']],
  ['opening', 'quarter-kelly', ['b365', 'pn', 'circa', 'bm']],
]) {
  test(`${source}/${staking}: ranking and chip metrics come from the same selected records`, () => {
    const env = runtime(), closed = records(), opened = records('opening');
    env.set('RECORD', closed);
    installOpening(env, { records: opened });
    env.set('DEV_PRICE_SOURCE', source);
    env.set('DEV_STAKING', staking);
    const actual = plain(env.call('getTopDevigs', 'fd'));
    assert.deepEqual(actual.map(row => row.devig), order.map(book => `attd-vs-${book}`));
    for (const row of actual) {
      const selected = (source === 'opening' ? opened : closed).probit.fd[row.devig].All;
      assert.equal(row.roi, staking === 'quarter-kelly' ? selected.kelly / selected.kelly_stake_units * 100 : selected.roi);
      assert.equal(row.kelly, selected.kelly);
      assert.equal(row.kellyStakeUnits, selected.kelly_stake_units);
      assert.equal(row.wins, selected.wins);
      assert.equal(row.losses, selected.losses);
      assert.equal(row.recordWindow, 'All');
      assert.equal(row.book, 'fd');
      assert.equal(row.priceSource, source);
      assert.equal(row.staking, staking);
    }
    assert.deepEqual(closed, records(), 'Opening mode must not overwrite closing RECORD');
  });
}

test('Kelly ranking follows stake ROI even when legacy returns and total profits rank oppositely', () => {
  const env = runtime();
  env.set('RECORD', { probit: { fd: {
    'attd-vs-pn': { All: stats(40, 900, { kelly: 9, kelly_stake_units: 90 }) },
    'attd-vs-circa': { All: stats(30, 5, { kelly: 5, kelly_stake_units: 10 }) },
    'attd-vs-bm': { All: stats(20, 999, { kelly: 10, kelly_stake_units: 0 }) },
    'attd-vs-b365': { All: stats(10, 500, { kelly: -2, kelly_stake_units: 10 }) },
  } } });
  env.set('DEV_STAKING', 'quarter-kelly');
  const rows = plain(env.call('getTopDevigs', 'fd'));
  assert.deepEqual(rows.map(row => [row.devig, row.roi]), [
    ['attd-vs-circa', 50], ['attd-vs-pn', 10], ['attd-vs-b365', -20], ['attd-vs-bm', null],
  ]);
  assert.equal(rows[0].kelly, 5);
  assert.equal(rows[0].kellyStakeUnits, 10);
});

test('the method, window, and betting book all scope the chosen price source', () => {
  const env = runtime();
  env.set('RECORD', records());
  installOpening(env);
  env.set('DEV_PRICE_SOURCE', 'opening');
  env.set('DEV_STAKING', 'quarter-kelly');
  env.set('DEV_WINDOW', 'L7');
  assert.deepEqual(plain(env.call('getTopDevigs', 'dk')).map(row => [row.book, row.roi, row.recordWindow]),
    [['dk', 35, 'L7']]);
  env.set('METHOD', 'worst');
  assert.deepEqual(plain(env.call('getTopDevigs', 'fd')).map(row => [row.method, row.roi]), [['worst', 3]]);
  assert.deepEqual(plain(env.call('getTopDevigs', 'dk')), []);
  env.set('METHOD', 'probit');
  assert.equal(env.call('getTopDevigs', 'fd,dk').length, 5);
  env.set('DEV_WINDOW', 'L3');
  assert.ok(env.call('getTopDevigs', 'fd').every(row => !row.hasRecord && row.roi === null));
});

test('missing opening records never silently rank closing results', () => {
  const env = runtime();
  env.set('RECORD', records());
  env.set('DEV_PRICE_SOURCE', 'opening');
  const missing = env.call('getTopDevigs', 'fd');
  assert.ok(missing.error || (Array.isArray(missing) && missing.every(row => !row.hasRecord)));
  env.set('DEV_PRICE_SOURCE', 'closing');
  assert.equal(env.call('getTopDevigs', 'fd')[0].roi, 40);
});

test('opening cache entries isolate sport and main-line feeds', () => {
  const env = runtime();
  env.set('DEV_PRICE_SOURCE', 'opening');
  for (const [feed, roi] of [['nfl', 10], ['nfl_main', 20], ['nhl', 30]]) {
    installOpening(env, { records: { probit: { fd: { 'total-vs-pn': { All: stats(roi, roi / 2) } } } } }, feed);
  }
  for (const [page, sport, roi] of [['nfl', 'nfl', 10], ['main', 'nfl', 20], ['nhl', 'nhl', 30]]) {
    env.set('PAGE', page); env.set('SPORT', sport);
    assert.equal(env.call('getTopDevigs', 'fd')[0].roi, roi);
  }
  env.set('SPORT', 'mlb');
  assert.equal(env.call('getTopDevigs', 'fd').length, 0);
});

test('unavailable opening and Kelly flags explicitly block otherwise present metrics', () => {
  const env = runtime();
  env.set('RECORD', records()); env.set('DEV_PRICE_SOURCE', 'opening');
  installOpening(env, { available: false, records: records('opening') });
  assert.equal(env.call('getTopDevigs', 'fd').length, 0);
  assert.equal(env.call('getPresetRecordSource').status, 'unavailable');
  installOpening(env, { kelly_available: false, records: records('opening') });
  env.set('DEV_STAKING', 'quarter-kelly');
  assert.ok(env.call('getTopDevigs', 'fd').every(row => !row.hasRecord && row.roi === null));
  env.set('DEV_STAKING', 'flat');
  assert.equal(env.call('getTopDevigs', 'fd')[0].roi, 40);
});

test('single-market pages retain their scope in opening mode', () => {
  const env = runtime();
  const all = { probit: { fd: Object.fromEntries(['atgs', 'fgs', 'lgs', 'attd', 'ftd', 'ltd', 'rec_yd', 'sog']
    .map((prop, i) => [`${prop}-vs-pn`, { All: stats(10 + i, 20 - i) }])) } };
  installOpening(env, { records: all }, 'nfl'); installOpening(env, { records: all }, 'nhl');
  env.set('DEV_PRICE_SOURCE', 'opening');
  for (const [page, sport, expected] of [
    ['atgs', 'nhl', ['atgs']], ['fgs', 'nhl', ['fgs', 'lgs']], ['tds', 'nfl', ['attd']], ['ftd', 'nfl', ['ftd', 'ltd']],
  ]) {
    env.set('PAGE', page); env.set('SPORT', sport);
    assert.deepEqual(plain(env.call('getTopDevigs', 'fd')).map(row => row.prop).sort(), expected.sort());
  }
});

test('unequal or malformed historical weights are not presented as equal-weight presets', () => {
  const env = runtime();
  const refs = ['pn+circa;1+1', 'pn+bm;2+2', 'pn+b365;1+2', 'pn+fd;1', 'pn+dk;0+0', 'pn+circa;bad+bad'];
  env.set('RECORD', { probit: { fd: Object.fromEntries(refs.map(ref => [`attd-vs-${ref}`, { All: stats(10, 10) }])) } });
  assert.deepEqual(plain(env.call('getTopDevigs', 'fd')).map(row => row.devig), ['attd-vs-pn+circa', 'attd-vs-pn+bm']);
});

test('opening loads once per feed, decodes its records, and leaves closing data untouched', async () => {
  const env = runtime(), closed = records(), calls = [];
  env.set('RECORD', closed);
  let release;
  env.context.fetch = (url, options) => {
    calls.push([url, options.cache]);
    return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => openingPayload() }); });
  };
  const first = env.call('ensureOpeningPresets'), duplicate = env.call('ensureOpeningPresets');
  assert.equal(first, duplicate);
  assert.equal(calls.length, 1);
  release(); await first;
  await env.call('ensureOpeningPresets');
  assert.deepEqual(calls, [['presets/nfl_opening.json', 'no-cache']]);
  assert.deepEqual(closed, records());
  env.set('DEV_PRICE_SOURCE', 'opening');
  assert.equal(env.call('getPresetRecordSource').status, 'ready');
  assert.equal(env.call('getTopDevigs', 'fd')[0].roi, 40);
});

test('failed opening requests require an explicit retry and never reuse closing data', async () => {
  const env = runtime();
  env.set('RECORD', records());
  let calls = 0;
  env.context.fetch = async () => { calls++; return { ok: calls > 1, json: async () => openingPayload() }; };
  await env.call('ensureOpeningPresets');
  env.set('DEV_PRICE_SOURCE', 'opening');
  assert.equal(env.call('getPresetRecordSource').status, 'error');
  assert.equal(env.call('getTopDevigs', 'fd').length, 0);
  await env.call('ensureOpeningPresets');
  assert.equal(calls, 1);
  await env.call('ensureOpeningPresets', { retry: true });
  assert.equal(calls, 2);
  assert.equal(env.call('getPresetRecordSource').status, 'ready');
});
