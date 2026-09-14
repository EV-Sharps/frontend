// Run with Node: node tests/data-refresh.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function run() {
	let next, status, applications = 0, timestampUpdates = 0, failRender = false;
	let current;
	const context = vm.createContext({
		AbortController, setTimeout, clearTimeout,
		console: { error() {} },
		ACCESS_TOKEN: 'first-session', tableReady: Promise.resolve(),
		fetch: async () => {
			if (next instanceof Error) throw next;
			return { ok: true, json: async () => structuredClone(next) };
		},
	});
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../page-performance.js'), 'utf8'), context);
	context.showDataStatus = message => { status = message; };
	let url = '/api/ev';
	const refresh = context.createDataRefresh(() => url, async data => {
		applications++;
		if (failRender) throw new Error('Render failed');
		current = data;
		// Real filtering mutates server rows with calculated values.
		data.data.forEach(row => { row.ev = 123; });
	}, async data => { timestampUpdates++; current.updated = data.updated; });
	const payload = () => ({ data: [{ player: 'test', bookOdds: { fd: 200 } }], games: ['a @ b'], times: {}, updated: { fd: 1 } });
	next = payload();
	await refresh();
	assert.equal(applications, 1);
	const original = current;
	next = payload();
	await refresh();
	assert.equal(applications, 1, 'computed fields must not trigger a refresh');
	assert.equal(current, original, 'unchanged data must retain the existing rows');
	next.updated.fd = 2;
	await refresh();
	assert.equal(applications, 1, 'timestamps alone must not replace rows');
	assert.equal(current.updated.fd, 2);
	assert.equal(timestampUpdates, 2);
	next.data[0].bookOdds.fd = 250;
	await refresh();
	assert.equal(applications, 2, 'changed odds must render');
	next.games.push('c @ d');
	await refresh();
	assert.equal(applications, 3, 'changed dropdown content must render');
	next.times = { 'a @ b': '19:00' };
	await refresh();
	assert.equal(applications, 4, 'changed game times must render');
	context.ACCESS_TOKEN = 'second-session';
	await refresh();
	assert.equal(applications, 5, 'session changes must reapply even identical content');
	url = '/api/main?sport=mlb';
	await refresh();
	assert.equal(applications, 6, 'endpoint changes must reapply');
	next = { ...payload(), data: [] };
	await refresh();
	assert.equal(applications, 7, 'empty response must clear old data');
	await refresh();
	assert.equal(applications, 7, 'repeated empty responses must be skipped');
	next = payload();
	failRender = true;
	await refresh();
	assert.match(status, /Unable to update/);
	failRender = false;
	await refresh();
	assert.equal(applications, 9, 'failed application must not be cached');
	next = new Error('Network failure');
	await refresh();
	assert.match(status, /Unable to update/);
	next = payload();
	await refresh();
	assert.equal(applications, 9, 'network recovery with unchanged content need not render');
	assert.equal(status, '', 'successful unchanged response must clear error');
	let release;
	context.fetch = () => new Promise(resolve => { release = resolve; });
	const first = refresh();
	assert.equal(refresh(), first, 'overlapping requests must share one promise');
	release({ ok: true, json: async () => payload() });
	await first;
	// Analysis and KOTC return arrays instead of the usual { data: [...] } envelope.
	let arrayApplications = 0;
	context.fetch = async () => ({ ok: true, json: async () => [] });
	const refreshArray = context.createDataRefresh(() => '/api/analysis', async data => {
		assert.ok(Array.isArray(data));
		arrayApplications++;
	});
	await refreshArray();
	await refreshArray();
	assert.equal(arrayApplications, 1, 'unchanged array responses must also be skipped');
	console.log('Data refresh regression checks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
