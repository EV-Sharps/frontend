'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { drawCard } = require('../devig-results-share.js');

function documentFixture() {
  const calls = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left',
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: Array.from(String(value)).length * size * .57 };
    },
    scale(x, y) { calls.push({ type: 'scale', x, y }); },
    fillRect(x, y, width, height) { calls.push({ type: 'rect', x, y, width, height, color: this.fillStyle }); },
    fillText(value, x, y) {
      calls.push({ type: 'text', value, x, y, width: this.measureText(value).width,
        size: Number(this.font.match(/([\d.]+)px/)[1]), align: this.textAlign, color: this.fillStyle });
    },
  };
  const canvas = { width: 0, height: 0, style: {}, attrs: {}, getContext: () => context,
    setAttribute(key, value) { this.attrs[key] = value; } };
  return { calls, canvas, document: { createElement(name) { assert.equal(name, 'canvas'); return canvas; } } };
}
const references = [
  { id: 'circa;1', label: 'Circa' }, { id: 'pn;1', label: 'Pinnacle' },
  { id: 'circa+pn;1+1', label: 'Circa + Pinnacle' }, { id: 'kal;1', label: 'Kalshi' },
  { id: 'nv;1', label: 'Novig' }, { id: 'px;1', label: 'ProphetX' },
  { id: 'poly;1', label: 'Polymarket' }, { id: 'mb;1', label: 'Matchbook' },
  { id: 'circa+fd;1+1', label: 'Circa + FanDuel' }, { id: 'pn+dk;1+1', label: 'Pinnacle + DraftKings' },
  { id: 'b365;1', label: 'bet365' }, { id: 'fd;1', label: 'FanDuel' },
];
function entry(changes = {}) {
  return { referenceLabel: 'Never repeat this reference', methodLabel: 'Never repeat this method', rank: 9,
    recordLabel: '7–5–0', settled: 12, profitLabel: '+8.75u', roiLabel: '+72.92%',
    hitLabel: 'A +650', hitDetail: 'ATTD · Oct 11', profit: 8.75, roi: 72.92, ...changes };
}
function model(count = 3, columns = references.slice(0, 8)) {
  return {
    sport: 'nfl', title: 'Devigs by betting book', subtitle: 'NFL · ATTD · Devig Results',
    description: 'Probit · Short EV · Odds below +400',
    period: 'Oct 11, 2026', scope: 'All betting books · Sharp references first',
    criteria: 'Any settled selections · One selected method for every cell',
    pageLabel: 'Books 1–3 of 17 · Devigs 1–4 of 12', generated: 'Updated Oct 12, 2026, 10:00 AM ET',
    footnotes: ['Saved-price replay; not placed bets. Net units include modeled exchange fees.',
      'Flat 1u risk per settled selection. Pending and ungraded selections excluded from ROI.',
      'Retrospective results describe this sample and do not predict future performance.'],
    columns: columns.map(column => ({ ...column })),
    rows: Array.from({ length: count }, (_, index) => ({ book: `book-${index}`,
      bookLabel: `B${index}`, bookName: `Betting book ${index}`, cells: columns.map(column => ({
        reference: column.id, emptyLabel: 'No settled sample.', entry: entry(),
      })) })),
  };
}
function labels(fixture) { return fixture.calls.filter(call => call.type === 'text'); }
function insideCanvas(fixture) {
  for (const call of labels(fixture)) {
    assert.ok(call.y + call.size <= fixture.canvas.height / 2, `Inside height: ${call.value}`);
    const left = call.align === 'right' ? call.x - call.width : call.x;
    assert.ok(left >= 32 - .01, `Inside left margin: ${call.value}`);
    assert.ok(left + call.width <= fixture.canvas.width / 2 - 32 + .01, `Inside right margin: ${call.value}`);
  }
}

test('dense 4, 8 and 12-column matrices retain every book, result and label at 2x', () => {
  for (const columnCount of [4, 8, 12]) for (const count of [0, 1, 3, 6, 17]) {
    const fixture = documentFixture(), source = model(count, references.slice(0, columnCount));
    const result = drawCard(source, fixture.document);
    const width = Math.max(1200, 64 + 100 + columnCount * 150);
    assert.equal(result, fixture.canvas);
    assert.equal(result.width, width * 2);
    assert.equal(result.height % 2, 0);
    assert.equal(result.style.width, `${width}px`);
    assert.deepEqual(fixture.calls.find(call => call.type === 'scale'), { type: 'scale', x: 2, y: 2 });
    const text = labels(fixture);
    for (const label of ['Devigs by betting book', '+EV', 'SHARPS', source.description, source.pageLabel]) {
      assert.equal(text.filter(call => call.value === label).length, 1, label);
    }
    for (const column of source.columns) {
      const width = (result.width / 2 - 164) / columnCount;
      const x = 140 + source.columns.indexOf(column) * width;
      assert.equal(text.filter(call => call.x === x && call.size === 13).map(call => call.value).join(' ').replaceAll(' ', ''),
        column.label.replaceAll(' ', ''));
    }
    assert.equal(text.filter(call => call.value === 'ROI +72.92%').length, count * columnCount);
    assert.equal(text.filter(call => call.value === 'Net +8.75u').length, count * columnCount);
    assert.equal(text.filter(call => /^B\d+$/.test(call.value)).length, count);
    assert.equal(text.filter(call => call.value === 'A +650').length, count * columnCount);
    assert.equal(text.filter(call => call.value === source.rows[0]?.cells[0]?.entry.recordLabel + ' \u00b7 n=12').length, count * columnCount);
    assert.ok(!text.some(call => call.value.includes('Never repeat') || call.value.startsWith('9. ')));
    assert.ok(!text.some(call => call.value === 'ATTD \u00b7 Oct 11'), 'Hit dates stay in the table tooltip, not the dense image.');
    if (!count) assert.ok(text.some(call => call.value === 'No performers match these filters.'));
    if (count === 17) assert.ok(result.height < 4500, 'All books stay compact without cutting rows.');
    insideCanvas(fixture);
  }
});

test('one through twelve columns fill the image and resolve cells by ID, not array position', () => {
  for (const count of [1, 2, 3, 4, 8, 12]) {
    const fixture = documentFixture(), source = model(2, references.slice(0, count));
    source.rows.forEach(row => {
      row.cells.forEach((cell, index) => { cell.entry.profitLabel = `+${index + 1}.00u`; });
      row.cells.reverse();
    });
    source.columns.reverse();
    drawCard(source, fixture.document);
    const text = labels(fixture), width = (fixture.canvas.width / 2 - 164) / count;
    source.columns.forEach((column, index) => {
      const x = 140 + index * width;
      const cells = text.filter(call => call.value === `Net +${references.findIndex(reference => reference.id === column.id) + 1}.00u`);
      assert.equal(cells.length, 2);
      assert.ok(cells.every(call => Math.abs(call.x - x) < .001));
      assert.ok(cells[0].y < cells[1].y);
    });
    insideCanvas(fixture);
  }
});

test('blank cells use a dash, while report rebuild requirements stay explicit', () => {
  const fixture = documentFixture(), source = model(1, references.slice(0, 4));
  source.rows[0].cells[1].entry = null;
  source.rows[0].cells[1].emptyLabel = '\u2014';
  source.rows[0].cells[1].emptyDetail = 'No Probit selections.';
  source.rows[0].cells[2].entry = null;
  source.rows[0].cells[2].emptyLabel = 'Rebuild report';
  source.rows[0].cells.pop();
  drawCard(source, fixture.document);
  const text = labels(fixture);
  for (const [x, label] of [[399, '\u2014'], [658, 'Rebuild report'], [917, '\u2014']]) {
    assert.equal(text.filter(call => call.x === x && call.size === 12).map(call => call.value).join(' '), label);
  }
  assert.equal(text.filter(call => call.value === 'Net +8.75u').length, 1);
  assert.ok(!text.some(call => /No Probit|n=0|Net 0/.test(call.value)));
  insideCanvas(fixture);
});

test('height follows book count and long headers, player names and numbers wrap inside dense columns', () => {
  const heights = [1, 3, 6, 17].map(count => {
    const fixture = documentFixture();
    return drawCard(model(count), fixture.document).height;
  });
  assert.ok(heights.every((height, index) => !index || height > heights[index - 1]));
  for (const columnCount of [4, 8, 12]) {
    const fixture = documentFixture(), source = model(1, references.slice(0, columnCount));
    source.subtitle = 'NHL ATGS ' + 'long descriptive metadata '.repeat(12);
    source.rows[0].bookName = 'An unusually long betting book name with enough words to wrap';
    source.columns[0].label = 'Pinnacle+Circa+Bet365+FanDuel+DraftKings+Kalshi+Novig+Polymarket'.repeat(3);
    source.rows[0].cells[1].entry.hitLabel = 'AReallyLongPlayerNameWithoutSpaces'.repeat(6) + ' +1450';
    source.rows[0].cells[2].entry.profitLabel = '+100000000000000.00u';
    source.footnotes.push('Long footnotes also wrap correctly. '.repeat(20));
    const snapshot = JSON.stringify(source);
    drawCard(source, fixture.document);
    assert.equal(JSON.stringify(source), snapshot, 'Renderer must not recalculate or mutate any cell.');
    const text = labels(fixture), width = (fixture.canvas.width / 2 - 164) / columnCount;
    const header = text.filter(call => call.x === 140 && call.size === 13).map(call => call.value).join('');
    assert.equal(header, source.columns[0].label);
    const longHit = text.filter(call => call.x === 140 + width && call.size === 11 && call.color === '#e8edf0').map(call => call.value).join('');
    assert.equal(longHit.replaceAll(' ', ''), source.rows[0].cells[1].entry.hitLabel.replaceAll(' ', ''));
    for (let index = 0; index < columnCount; index++) {
      const x = 140 + index * width;
      for (const call of text.filter(call => Math.abs(call.x - x) < .001)) {
        assert.ok(call.x + call.width <= x + width - 16 + .01, `Text within its column: ${call.value}`);
      }
    }
    insideCanvas(fixture);
  }
});

test('profit and ROI signs retain independent colors, with profit as fallback when numeric ROI is omitted', () => {
  const fixture = documentFixture(), source = model(1, references.slice(0, 4));
  source.rows[0].cells[0].entry = entry({ profit: -10.5, profitLabel: '-10.50u', roi: -35, roiLabel: '-35.00%' });
  source.rows[0].cells[1].entry = entry({ profit: 0, profitLabel: '0.00u', roi: 0, roiLabel: '0.00%' });
  source.rows[0].cells[2].entry = entry({ profit: -1, profitLabel: '-1.00u', roiLabel: '-8.33%' });
  delete source.rows[0].cells[2].entry.roi;
  drawCard(source, fixture.document);
  const text = labels(fixture);
  assert.ok(text.some(call => call.value === 'Net -10.50u' && call.color === '#ff9b9b'));
  assert.ok(text.some(call => call.value === 'ROI -35.00%' && call.color === '#ff9b9b'));
  assert.ok(text.some(call => call.value === 'ROI -8.33%' && call.color === '#ff9b9b'));
  assert.ok(text.some(call => call.value === 'Net +8.75u' && call.color === '#82e5b3'));
  assert.ok(text.some(call => call.value === 'Net 0.00u' && call.color === '#e8edf0'));
  assert.equal(text.filter(call => call.value.endsWith('n=12')).length, 4);
});

test('empty comparison columns are safe and excessive columns are rejected instead of silently dropped', () => {
  const fixture = documentFixture();
  drawCard(model(1, []), fixture.document);
  assert.ok(labels(fixture).some(call => call.value === 'B0'));
  assert.ok(!labels(fixture).some(call => call.value.startsWith('Net ')));
  insideCanvas(fixture);
  assert.throws(() => drawCard(model(1, [...references, { id: 'extra;1', label: 'Extra' }]), documentFixture().document), /twelve devig columns/);
});

test('renderer rejects missing model/context and exposes its browser global', () => {
  assert.throws(() => drawCard(null, documentFixture().document), /model/);
  assert.throws(() => drawCard({ rows: [] }, documentFixture().document), /columns/);
  assert.throws(() => drawCard(model(), {}), /document/);
  assert.throws(() => drawCard(model(), { createElement: () => ({ getContext: () => null }) }), /create the share image/);
  assert.equal(globalThis.DevigResultsShare.drawCard, drawCard);
});
