'use strict';
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
function model(count = 5) {
  return {
    sport: 'nfl', title: 'Best performers', subtitle: 'NFL · ATTD · Devig Results',
    period: 'Oct 11, 2026', scope: 'All betting books · All references · All methods',
    criteria: `Ranked by ROI · Min. 10 settled · Top ${count} · Profitable only`,
    generated: 'Updated Oct 12, 2026, 10:00 AM ET',
    footnotes: ['Saved-price replay; not placed bets. Net units include modeled exchange fees.',
      'Flat 1u risk per settled selection. Pending and ungraded selections excluded from ROI.',
      'Retrospective rankings describe this sample and do not predict future performance.'],
    rows: Array.from({ length: count }, (_, index) => ({ rank: index + 1,
      bookLabel: index % 2 ? 'FanDuel' : 'Hard Rock Bet', marketLabel: 'ATTD',
      referenceLabel: 'Pinnacle + Circa', methodLabel: 'Multiplicative', recordLabel: '7–5–0',
      settled: 12, profitLabel: '+8.75u', roiLabel: '+72.92%',
      unresolvedLabel: '1 pending · 2 ungraded', profit: 8.75, roi: 72.92 })),
  };
}

for (const count of [0, 5, 10, 15]) {
  const fixture = documentFixture();
  const result = drawCard(model(count), fixture.document);
  assert.equal(result, fixture.canvas);
  assert.equal(result.width, 2400);
  assert.equal(result.height % 2, 0);
  assert.equal(result.style.width, '1200px');
  assert.deepEqual(fixture.calls.find(call => call.type === 'scale'), { type: 'scale', x: 2, y: 2 });
  const labels = fixture.calls.filter(call => call.type === 'text');
  assert.ok(labels.some(call => call.value === 'Best performers'));
  assert.ok(labels.some(call => call.value === '+EV'));
  assert.ok(labels.some(call => call.value === 'SHARPS'));
  assert.equal(labels.filter(call => call.value === '+72.92%').length, count);
  if (!count) assert.ok(labels.some(call => call.value === 'No performers match these filters.'));
  for (const call of labels) {
    assert.ok(call.y + call.size <= result.height / 2, `Text must remain inside height: ${call.value}`);
    const left = call.align === 'right' ? call.x - call.width : call.x;
    assert.ok(left >= 44 - .01, `Text must stay inside left margin: ${call.value}`);
    assert.ok(left + call.width <= 1156 + .01, `Text must stay inside right margin: ${call.value}`);
  }
}

const heights = [5, 10, 15].map(count => {
  const fixture = documentFixture();
  return drawCard(model(count), fixture.document).height;
});
assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);

{
  const fixture = documentFixture();
  const source = model(1);
  source.subtitle = 'NHL · ATGS · ' + 'long descriptive metadata '.repeat(12);
  source.scope += ' · ' + 'a long applied filter scope '.repeat(10);
  source.rows[0].referenceLabel = 'Pinnacle+Circa+Bet365+FanDuel+DraftKings+Kalshi+Novig+Polymarket+ProphetX'.repeat(3);
  source.rows[0].profit = -10.5;
  source.rows[0].profitLabel = '-10.50u';
  source.rows[0].roi = -35;
  source.rows[0].roiLabel = '-35.00%';
  source.footnotes.push('Long footnotes also wrap correctly. '.repeat(20));
  const snapshot = JSON.stringify(source);
  const result = drawCard(source, fixture.document);
  assert.equal(JSON.stringify(source), snapshot, 'Renderer must not mutate or recalculate the leaderboard.');
  const labels = fixture.calls.filter(call => call.type === 'text');
  assert.ok(labels.some(call => call.value === '-10.50u' && call.color === '#ff9b9b'));
  assert.ok(labels.some(call => call.value === '-35.00%' && call.color === '#ff9b9b'));
  const blend = labels.filter(call => call.x === 350 && call.size === 24).map(call => call.value).join('');
  assert.equal(blend, source.rows[0].referenceLabel, 'Long blend must wrap without dropping characters.');
  assert.ok(labels.every(call => call.y + call.size < result.height / 2));
}

assert.throws(() => drawCard(null, documentFixture().document), /model/);
assert.throws(() => drawCard(model(), {}), /document/);
assert.throws(() => drawCard(model(), { createElement: () => ({ getContext: () => null }) }), /create the share image/);
assert.equal(globalThis.DevigResultsShare.drawCard, drawCard);
console.log('Devig Results share canvas tests passed.');
