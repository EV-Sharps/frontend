const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const comparisonSource = source.slice(source.indexOf('function goalComparisonRows('), source.indexOf('function closeRightPanel()'));
assert.ok(comparisonSource.startsWith('function goalComparisonRows('));
const selected = { player: 'one player', game: 'buf @ cbj', prop: 'atgs', handicap: '0.5' };
const base = { ...selected, bookOdds: { fd: '250/-300', circa: '240/-310' } };
const fixture = () => ({ data: [base], comparisonOdds: { 'buf @ cbj': {
    'one player': { '1.5': { fd: '1000', dk: '1100' }, '2.5': { dk: '4000' }, '3.5': { fd: '9000' } },
    'other player': { '1.5': { fd: '8888' } },
}, 'nyr @ bos': { 'one player': { '1.5': { fd: '7777' } } } } });
function environment(payload) {
    const elements = new Map();
    elements.set('#right-body', { appendChild: el => elements.set('#' + el.id, el) });
    const context = vm.createContext({ RES: payload, MOBILE: false, title: s => s, convertProp: s => s,
        document: { querySelector: selector => elements.get(selector), createElement: () => ({ innerHTML: '' }) } });
    vm.runInContext(comparisonSource, context);
    return { context, html: () => elements.get('#goal-props-table')?.innerHTML || '' };
}
const plain = value => JSON.parse(JSON.stringify(value));
function rows(payload, row = selected) {
    return plain(environment(payload).context.goalComparisonRows(row, payload));
}
function render(payload, row = selected) {
    const env = environment(payload);
    env.context.renderGoalPropsTable(row);
    return env.html();
}

test('compact prices render 1+, 2+, 3+, and 4+ while keeping the main data unchanged', () => {
    const payload = fixture(), before = JSON.stringify(payload);
    const html = render(payload);
    for (const label of ['1+', '2+', '3+', '4+']) assert.ok(html.includes(`>${label}</th>`));
    for (const price of [250, 1000, 1100, 4000, 9000]) assert.ok(html.includes(`+${price}</td>`));
    assert.equal(payload.data.length, 1);
    assert.equal(JSON.stringify(payload), before);
});

test('comparison never mixes a different player or game', () => {
    const payload = fixture();
    payload.data.push({ ...base, player: 'other player', handicap: '1.5', bookOdds: { fd: '6666' } });
    payload.data.push({ ...base, game: 'nyr @ bos', handicap: '1.5', bookOdds: { fd: '5555' } });
    const html = render(payload);
    for (const price of [8888, 7777, 6666, 5555]) assert.ok(!html.includes(`+${price}`));
    assert.deepEqual(rows(payload, { ...selected, game: 'unknown' }), []);
});

test('legacy full rows and the separate atgs2 page still render', () => {
    const payload = { data: [base, { ...base, handicap: '1.5', bookOdds: { fd: '1000' } }] };
    assert.ok(render(payload).includes('>2+</th>'));
    assert.ok(render(payload, { ...selected, handicap: '1.5' }).includes('+1000</td>'));
    assert.deepEqual(rows(payload).map(row => row.handicap), ['0.5', '1.5']);
});

test('paired legacy rows and compact numeric line variants do not duplicate columns', () => {
    const payload = fixture();
    payload.data.push({ ...base, handicap: '1.50', bookOdds: { fd: '950' } });
    payload.data.push({ ...base, handicap: 1.5, under: true, bookOdds: { fd: '950' } });
    const result = rows(payload), alt = result.find(row => row.handicap === '1.5');
    assert.equal(result.length, 4);
    assert.deepEqual(alt.bookOdds, { fd: '950', dk: '1100' }, 'legacy prices take precedence during mixed-feed rollout');
    assert.equal((render(payload).match(/>2\+<\/th>/g) || []).length, 1);
});

test('first/last goal comparisons cannot consume ATGS compact prices', () => {
    const payload = fixture();
    for (const prop of ['fgs', 'lgs']) {
        const row = { ...base, prop, bookOdds: { fd: '700' } };
        payload.data.push(row);
        assert.deepEqual(rows(payload, row), [{ handicap: '0.5', bookOdds: { fd: '700' } }]);
        assert.ok(!render(payload, row).includes('>2+</th>'));
    }
});

test('a blurred selection clears existing comparison content and never reveals compact odds', () => {
    const payload = fixture(), env = environment(payload);
    env.context.renderGoalPropsTable(selected);
    assert.ok(env.html().includes('+1000'));
    env.context.renderGoalPropsTable({ ...selected, blurred: true });
    assert.equal(env.html(), '');
    assert.deepEqual(rows(payload, { ...selected, blurred: true }), []);
});

test('Circa-masked selections hide Circa at every level, preserving other books', () => {
    const payload = fixture();
    payload.comparisonOdds['buf @ cbj']['one player']['1.5'].circa = '9999';
    const result = rows(payload, { ...selected, circa_blurred: true });
    assert.ok(result.every(row => !Object.hasOwn(row.bookOdds, 'circa')));
    const html = render(payload, { ...selected, circa_blurred: true });
    assert.ok(!html.includes('+9999'));
    assert.ok(!html.includes('+240'));
    assert.ok(html.includes('+1100'));
});

test('legacy blurred rows and masked Circa prices remain hidden', () => {
    const payload = { data: [base,
        { ...base, handicap: '1.5', blurred: true, bookOdds: { fd: '9999' } },
        { ...base, handicap: '2.5', circa_blurred: true, bookOdds: { circa: '8888', fd: '4000' } },
    ] };
    const html = render(payload);
    assert.ok(!html.includes('+9999'));
    assert.ok(!html.includes('+8888'));
    assert.ok(html.includes('+4000'));
});

test('malformed compact values and a compact 0.5 line cannot override regular prices', () => {
    const payload = { data: [base], comparisonOdds: { 'buf @ cbj': { 'one player': {
        '0.5': { fd: '9999' }, 'NaN': { fd: '8888' }, '1.5': null, '2.5': [], '3.5': 'bad',
    } } } };
    assert.deepEqual(rows(payload), [{ handicap: '0.5', bookOdds: base.bookOdds }]);
    assert.deepEqual(rows({}), []);
    assert.deepEqual(rows(null), []);
});


test('active dialog input preserves base exchange liquidity and all props while adding compact quote rows', () => {
    const playerLines = require('../player-lines.js');
    const payload = fixture();
    payload.data[0] = { ...base, bookOdds: { ...base.bookOdds, nv: '270/-320' }, liquidity: { nv: [123, 456] }, logs: [1, 0] };
    payload.data.push({ ...selected, prop: 'sog', handicap: '2.5', bookOdds: { fd: '-110/-110' } });
    const input = plain(environment(payload).context.goalComparisonInputRows(selected, payload));
    const result = playerLines.collect(selected, input);
    assert.deepEqual(result.lines.map(row => row.line), [0.5, 1.5, 2.5, 3.5]);
    assert.deepEqual(result.lines[0].liquidity.get('nv'), [123, 456]);
    assert.deepEqual(playerLines.availableProps(selected, input), ['atgs', 'sog']);
    assert.ok(input.filter(row => Number(row.handicap) === 1.5).every(row => !Object.hasOwn(row, 'logs') && !Object.hasOwn(row, 'liquidity')));
    assert.equal(payload.data.length, 2);
});

test('active dialog input masks Circa in full and compact rows without changing other books', () => {
    const playerLines = require('../player-lines.js');
    const payload = fixture();
    payload.comparisonOdds['buf @ cbj']['one player']['1.5'].circa = '9999';
    const row = { ...selected, circa_blurred: true };
    const input = plain(environment(payload).context.goalComparisonInputRows(row, payload));
    assert.ok(!playerLines.collect(row, input).books.includes('circa'));
    assert.equal(payload.data[0].bookOdds.circa, '240/-310');
    assert.deepEqual(plain(environment(payload).context.goalComparisonInputRows({ ...row, blurred: true }, payload)), []);
});
