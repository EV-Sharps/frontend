const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const context = vm.createContext({ PAGE: 'nba', SPORT: 'nba' });
vm.runInContext(source.slice(source.indexOf('let FB_CONFIG = {};'), source.indexOf('function getSavedFilterBuilders()')), context);
vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = config; };', context);
const position = value => ({ position: { enabled: true, value } });
const lineup = value => ({ lineup: { enabled: true, value } });
function matches(config, row, { page = 'nba', sport = 'nba' } = {}) {
    context.PAGE = page;
    context.SPORT = sport;
    context.setConfig(config);
    return context.passesFilterBuilder(row);
}

test('NBA positions select each exact role and guard or forward groups', () => {
    const rows = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', '', 'LW', 'D'];
    const selected = value => rows.filter(pos => matches(position(value), { pos }));
    for (const value of ['PG', 'SG', 'SF', 'PF', 'C']) {
        assert.deepEqual(selected(value), [value]);
    }
    assert.deepEqual(selected('G'), ['PG', 'SG', 'G']);
    assert.deepEqual(selected('F'), ['SF', 'PF', 'F']);
    for (const pos of [undefined, null, '', ' ', [], 'unknown']) {
        assert.equal(matches(position('PG'), { pos }), false);
    }
});

test('NBA position aliases and multiple roles match without substring guesses', () => {
    for (const [pos, selected] of [
        [' point guard ', 'PG'], ['Shooting Guard', 'SG'], ['small forward', 'SF'],
        ['POWER FORWARD', 'PF'], ['Center', 'C'], ['centre', 'C'],
        ['Guard', 'G'], ['Forward', 'F'],
        ['pg/sg', 'SG'], ['SF-PF', 'PF'], ['C,PF', 'PF'],
        ['SG;SF', 'SF'], ['PG|SG', 'SG'], [['PG', 'SF/PF'], 'PF'],
    ]) {
        assert.equal(matches(position(selected), { pos }), true, JSON.stringify({ pos, selected }));
    }
    assert.equal(matches(position('PG'), { pos: 'Guard' }), false);
    assert.equal(matches(position('SF'), { pos: 'Forward' }), false);
    assert.equal(matches(position('G'), { pos: 'PF-C' }), false);
    assert.equal(matches(position('F'), { pos: ['PG', 'C'] }), false);
    assert.equal(matches(position('C'), { pos: 'CENTERFIELD' }), false);
});

test('the lineup role overrides the coarse listed role, with a fallback when absent', () => {
    const starter = { pos: 'PG', lineupPosition: 'SG', starting: true };
    assert.equal(matches(position('SG'), starter), true);
    assert.equal(matches(position('PG'), starter), false);
    assert.equal(matches(position('G'), starter), true);
    for (const lineupPosition of [undefined, null, '']) {
        assert.equal(matches(position('PF'), { pos: 'PF', lineupPosition, starting: false }), true);
        assert.equal(matches(position('SG'), { pos: 'PF', lineupPosition }), false);
    }
    assert.equal(matches(position('SF'), { lineupPosition: 'SF' }), true);
});

test('NBA page support and sport fallback preserve NHL matching and isolate lineup rules', () => {
    for (const page of ['nba', 'pts', 'threes', 'fb']) {
        context.PAGE = page;
        assert.equal(context.isNbaTeamTotalPage(), true, page);
        assert.equal(matches(position('G'), { pos: 'SG' }, { page }), true);
        assert.equal(matches(lineup('confirmed'), { lineupStatus: 'confirmed' }, { page }), true);
    }
    for (const page of ['nhl', 'atgs', 'fgs', 'nfl', 'wnba', 'cup', 'kotc']) {
        context.PAGE = page;
        assert.equal(context.isNbaTeamTotalPage(), false, page);
    }
    assert.equal(matches(position('G'), { sport: 'NBA', pos: 'SG' }, { page: 'nhl', sport: 'nhl' }), true);
    assert.equal(matches(position('F'), { sport: 'nhl', pos: 'C', lineupPosition: 'SG' }), true);
    assert.equal(matches(position('F'), { sport: 'nba', pos: 'C' }, { page: 'nhl', sport: 'nhl' }), false);
    assert.equal(matches(position('W'), { pos: 'LW/RW' }, { page: 'nhl', sport: 'nhl' }), true);
    assert.equal(matches(position('G'), { sport: 'nhl', pos: 'SG' }), false);
    for (const sport of ['nhl', 'nfl', 'wnba', 'soccer']) {
        for (const status of ['confirmed', 'unconfirmed']) {
            assert.equal(matches(lineup(status), { sport, confirmed: true, lineupStatus: 'confirmed' }), false);
        }
    }
    assert.equal(matches(lineup('confirmed'), { confirmed: true }, { page: 'nba', sport: undefined }), true);
    assert.equal(matches(lineup('confirmed'), { confirmed: true }, { page: 'nba', sport: '' }), false);
});

test('explicit lineup status takes precedence over legacy confirmation booleans', () => {
    for (const row of [
        { lineupStatus: 'confirmed', confirmed: false },
        { lineupStatus: ' CONFIRMED ', confirmed: null },
        { lineupStatus: 'confirmed' },
        { confirmed: true },
        { lineupStatus: '', confirmed: true },
        { lineupStatus: ' ', confirmed: true },
    ]) {
        assert.equal(matches(lineup('confirmed'), row), true, JSON.stringify(row));
        assert.equal(matches(lineup('unconfirmed'), row), false, JSON.stringify(row));
    }
    for (const lineupStatus of ['expected', ' EXPECTED ', 'unconfirmed', 'unknown']) {
        const row = { lineupStatus, confirmed: true };
        assert.equal(matches(lineup('confirmed'), row), false, lineupStatus);
        assert.equal(matches(lineup('unconfirmed'), row), true, lineupStatus);
    }
    assert.equal(matches(lineup('unsupported'), { lineupStatus: 'confirmed' }), false);
});

test('unconfirmed includes expected and unknown data, while confirmation includes bench players', () => {
    for (const row of [{}, { confirmed: false }, { confirmed: null }, { confirmed: 'true' },
        { lineupStatus: '', starting: null }, { lineupStatus: 'expected', starting: true },
        { lineupStatus: 'expected', starting: false }]) {
        assert.equal(matches(lineup('unconfirmed'), row), true, JSON.stringify(row));
        assert.equal(matches(lineup('confirmed'), row), false, JSON.stringify(row));
    }
    for (const starting of [true, false, null, undefined]) {
        assert.equal(matches(lineup('confirmed'), { lineupStatus: 'confirmed', starting }), true);
    }
});

test('disabled and absent NBA rules do not remove rows', () => {
    const disabled = { position: { enabled: false, value: 'PG' }, lineup: { enabled: false, value: 'confirmed' } };
    for (const row of [{}, { pos: 'C', lineupStatus: 'expected' }, { sport: 'nhl', pos: 'D' }]) {
        assert.equal(matches(disabled, row), true);
        assert.equal(matches({}, row), true);
    }
});

test('NBA position and confirmation combine with existing odds and EV-side liquidity rules', () => {
    const config = {
        ...position('G'), ...lineup('confirmed'),
        line: { enabled: true, min: '100', max: '150' },
        liquidityEV: { enabled: true, book: 'px', amount: '50' },
    };
    const row = { pos: 'PG', lineupPosition: 'SG', lineupStatus: 'confirmed', starting: false,
        line: 125, under: true, liquidity: { px: [0, 50] } };
    assert.equal(matches(config, row), true);
    for (const extra of [
        { lineupPosition: 'PF' }, { lineupStatus: 'expected' }, { line: 99 }, { line: 151 },
        { line: undefined }, { liquidity: { px: [50, 49] } }, { under: false },
    ]) {
        assert.equal(matches(config, { ...row, ...extra }), false, JSON.stringify(extra));
    }
    for (const line of [100, 150]) assert.equal(matches(config, { ...row, line }), true);
    assert.equal(matches(config, { ...row, under: false, liquidity: { px: [50, 0] } }), true);
});
