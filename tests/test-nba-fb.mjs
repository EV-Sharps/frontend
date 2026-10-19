import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const slice = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} source block`);
  return source.slice(a, b);
};
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const shared = read('shared.js'), weights = read('weights.js');
const context = vm.createContext({ PAGE: 'fb', SPORT: 'nba', METHOD: '', DEV_WINDOW: 'All',
  DEV_PRICE_SOURCE: 'closing', DEV_STAKING: 'flat',
  getPresetRecordSource: () => ({records: {worst: {fd: {
    'pts-vs-dk': {All: {wins: 3, losses: 2, roi: 10}},
    'fb-vs-pn': {All: {wins: 2, losses: 8, roi: 20}},
    '1st pts-vs-dk': {All: {wins: 2, losses: 8, roi: 15}},
  }}}}),
  window: {location: {pathname: '/nba.html', search: '?market=fb'}},
  PAGE_SECTIONS: [{pages: [{value: 'nba'}, {value: 'fb'}]}], URLSearchParams,
});
vm.runInContext(slice(weights, 'function presetFeed(', '// Opening presets'), context);
vm.runInContext(slice(weights, 'function presetRecordStats(', 'function presetMetricLabel('), context);
vm.runInContext(slice(weights, 'function getTopDevigs(', '// wire up the Preloads'), context);
vm.runInContext(slice(shared, 'function pagePickerValue(', 'function buildPagePicker('), context);
vm.runInContext(slice(shared, 'function convertProp(', '// Live NFL pairs'), context);
vm.runInContext(slice(shared, 'const propFormatter =', 'const kellyFormatter =') + '\nthis.propFormatter = propFormatter;', context);
eq(context.presetFeed(), 'nba');
eq(context.pagePickerValue(), 'fb');
eq(Array.from(context.getTopDevigs(), row => row.devig), ['fb-vs-pn', 'fb-vs-dk']);
eq(context.convertProp('fb'), 'First Basket');
eq(context.propFormatter({getRow: () => ({getData: () => ({prop: 'fb', under: false})})}), 'First Basket');
context.PAGE = 'nba';
eq(context.pagePickerValue(), 'nba');
eq(Array.from(context.getTopDevigs(), row => row.devig), ['pts-vs-dk']);
context.DEV_PRICE_SOURCE = 'opening';
context.PAGE = 'fb';
eq(Array.from(context.getTopDevigs(), row => row.prop), ['fb', 'fb']);

const api = fs.readFileSync(path.resolve(root, '../api/api.js'), 'utf8');
let handler;
const routeContext = vm.createContext({ app: {get: (route, callback) => {eq(route, '/api/fb'); handler = callback;}},
  DEV: false, TIER: {FREE: 'free', ANALYST: 'analyst', SHARP: 'sharp'},
  sendGzip: (res, data) => {res.sent = data;}, getTier: async token => token,
  getEV: async options => ({dataset: options.props + (options.free ? '_free' : '')}),
  downloadFile: async file => ({dataset: file}), console: {error() {}},
});
vm.runInContext(slice(api, 'app.get("/api/fb",', 'app.get("/api/threes",'), routeContext);
for (const [tier, dataset] of [['free', 'fb_free'], ['analyst', 'fb'], ['sharp', 'fb']]) {
  const res = {};
  await handler({headers: {authorization: tier}}, res);
  eq(res.sent.dataset, dataset);
}
routeContext.DEV = true;
const dev = {};
await handler({headers: {}}, dev);
eq(dev.sent.dataset, 'fb');
routeContext.DEV = false;
routeContext.getEV = async () => {throw Error('fixture');};
const failed = {status(code) {this.statusCode = code; return this;}, json(data) {this.body = data;}};
await handler({headers: {}}, failed);
eq(failed.statusCode, 500);
eq(failed.body.error, 'Server error');
console.log(`First Basket route, preset and label checks passed: ${checks}`);
