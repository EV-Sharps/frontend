// Run with Node: node tests/column-reorder.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const canonical = ['ev', 'roiRecord', 'book', 'player', 'fairVal', 'implied', 'bookOdds_fd', 'logs'];
const items = canonical.map(key => ({ key, label: key, cols: [{ field: key.replace('bookOdds_', 'bookOdds.') }] }));

function setup() {
    const list = {
        children: [],
        set innerHTML(value) { this.children = []; },
        appendChild(node) { this.children.push(node); },
        querySelectorAll() { return this.children; },
    };
    const modal = { style: {} };
    const state = { persisted: null, columns: null, cached: false };
    const context = vm.createContext({
        supportsOddsViews: () => false,
        PAGE: 'dingers',
        CURR_USER: { metadata: {} },
        CURR_SESSION: { user: { id: 'fixture' } },
        document: {
            getElementById: id => id === 'col-reorder-list' ? list : modal,
            createElement: () => ({ dataset: {}, style: {}, addEventListener() {} }),
        },
        SB: { from: () => ({ update: payload => ({ eq: async () => {
            state.persisted = plain(payload.metadata);
            return { error: null };
        } }) }) },
        TABLE: { setColumns: columns => { state.columns = plain(columns); } },
        cacheProfile: () => { state.cached = true; },
    });
    vm.runInContext(source.slice(source.indexOf('let _colReorderDragSrc = null;'),
        source.indexOf('function initChkddActions(')), context);
    vm.runInContext(source.slice(source.indexOf('function snapShareColumnOrder('),
        source.indexOf('const percentFormatter =')), context);
    const build = order => context.buildColumnsFromOrder(order, canonical, items);
    return { context, list, modal, state, build };
}

test('legacy Stacked orders restore missing Best Book beside Player', () => {
    const { build } = setup();
    const legacy = ['ev', 'roiRecord', 'player', 'bookOdds_fd', 'logs'];
    const fields = plain(build(legacy)).map(column => column.field);
    assert.deepEqual(fields, ['ev', 'roiRecord', 'book', 'player', 'fairVal', 'implied', 'bookOdds.fd', 'logs']);
    assert.deepEqual(legacy, ['ev', 'roiRecord', 'player', 'bookOdds_fd', 'logs'], 'Do not mutate saved metadata');
});

test('an explicit Compact Best Book position remains where the user put it', () => {
    const { context } = setup();
    const explicit = ['logs', 'ev', 'player', 'roiRecord', 'bookOdds_fd', 'fairVal', 'implied', 'book'];
    assert.deepEqual(plain(context.completeColumnOrder(explicit, canonical, items)), explicit);
});

test('football snap migration restores omitted Best Book before the shared builder sees it', () => {
    const { context } = setup();
    const defaults = ['ev', 'book', 'player', 'fairVal', 'bookOdds_fd', 'logs', 'snaps'];
    const legacy = ['ev', 'player', 'bookOdds_fd', 'roiRecord', 'logs'];
    const full = plain(context.snapShareColumnOrder(legacy, defaults));
    assert.equal(full.indexOf('book') + 1, full.indexOf('player'));
    assert.equal(full.indexOf('logs') + 1, full.indexOf('snaps'));
    assert.deepEqual(full.filter(key => legacy.includes(key)), legacy);
    const explicit = [...defaults.filter(key => key !== 'book'), 'book'];
    assert.deepEqual(plain(context.snapShareColumnOrder(explicit, defaults)), explicit);
});

test('missing columns preserve the relative order of explicitly reordered groups', () => {
    const { context } = setup();
    const saved = ['logs', 'player', 'ev', 'bookOdds_fd'];
    const full = plain(context.completeColumnOrder(saved, canonical, items));
    assert.deepEqual(full.filter(key => saved.includes(key)), saved);
    assert.equal(full.indexOf('book') + 1, full.indexOf('player'));
    assert.equal(full.length, canonical.length);
    assert.equal(new Set(full).size, full.length);
});

test('stale and duplicate keys cannot duplicate columns or displace fixed utility columns', () => {
    const { context } = setup();
    const columns = plain(context.buildColumnsFromOrder(['removed', 'ev', 'ev', 'player'], canonical, items,
        () => ({ field: '_watchlist' }), [{ field: 'game', visible: false }]));
    assert.equal(columns[0].field, '_watchlist');
    assert.equal(columns.at(-1).field, 'game');
    assert.equal(columns.filter(column => column.field === 'ev').length, 1);
    assert.equal(columns.some(column => column.field === 'removed'), false);
});

test('available groups outside the default order require an explicit saved position', () => {
    const { context } = setup();
    const available = [...items, { key: 'optional', cols: [{ field: 'optional' }] }];
    assert.deepEqual(plain(context.completeColumnOrder(null, canonical, available)), canonical);
    const saved = [...canonical, 'optional'];
    assert.deepEqual(plain(context.completeColumnOrder(saved, canonical, available)), saved);
});

test('saving a fresh Stacked reorder retains every hidden group in the persisted order', async () => {
    const { context, list, modal, state, build } = setup();
    const hidden = new Set(['book', 'fairVal', 'implied']);
    context.openColReorderModal(items, canonical, null, meta => !hidden.has(meta.key));
    assert.deepEqual(list.children.map(node => node.dataset.key), ['ev', 'roiRecord', 'player', 'bookOdds_fd', 'logs']);
    // Simulate dragging the visible book prices before Player.
    const node = list.children.find(item => item.dataset.key === 'bookOdds_fd');
    list.children.splice(list.children.indexOf(node), 1);
    list.children.splice(2, 0, node);
    let restored = false;
    await context.saveColReorderModal('dingers-order', build, () => { restored = true; });
    const full = state.persisted['dingers-order'];
    assert.deepEqual(full, ['ev', 'roiRecord', 'book', 'bookOdds_fd', 'fairVal', 'implied', 'player', 'logs']);
    assert.equal(full.indexOf('book'), canonical.indexOf('book'));
    assert.equal(full.indexOf('fairVal'), canonical.indexOf('fairVal'));
    assert.deepEqual(state.columns.map(column => column.field), full.map(key => key.replace('bookOdds_', 'bookOdds.')));
    assert.equal(restored, true);
    assert.equal(state.cached, true);
    assert.equal(modal.style.display, 'none');
});

test('resaving a legacy Stacked profile repairs omission and retains an explicit hidden position', async () => {
    const { context, state, build } = setup();
    const visible = meta => !['book', 'fairVal'].includes(meta.key);
    context.openColReorderModal(items, canonical, ['ev', 'player', 'bookOdds_fd', 'logs'], visible);
    await context.saveColReorderModal('dingers-order', build);
    assert.deepEqual(state.persisted['dingers-order'], canonical);
    const explicit = [...canonical.filter(key => key !== 'book'), 'book'];
    context.openColReorderModal(items, canonical, explicit, visible);
    await context.saveColReorderModal('dingers-order', build);
    assert.deepEqual(state.persisted['dingers-order'], explicit);
});
