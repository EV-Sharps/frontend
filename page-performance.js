// Optional chart code is shared across requests and can be retried after a failure.
let plotlyLoad;
function loadPlotly() {
	if (window.Plotly) return Promise.resolve(window.Plotly);
	if (!plotlyLoad) {
		plotlyLoad = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = 'plotly-3.0.0.min.js';
			script.onload = () => resolve(window.Plotly);
			script.onerror = () => {
				script.remove();
				plotlyLoad = null;
				reject(new Error('Unable to load charts. Please try again.'));
			};
			document.head.appendChild(script);
		});
	}
	return plotlyLoad;
}

const chartRequests = new WeakMap();
async function renderLazyChart(target, data, layout, config) {
	const element = typeof target === 'string' ? document.getElementById(target) : target;
	if (!element) return;
	const request = {};
	chartRequests.set(element, request);
	try {
		const plotly = await loadPlotly();
		if (!element.isConnected || chartRequests.get(element) !== request) return;
		await plotly.newPlot(element, data, layout, config);
		// Opening the detail panel changes the flex layout. Size the first plot
		// after the browser has laid out its newly visible container as well.
		await new Promise(resolve => requestAnimationFrame(resolve));
		if (element.isConnected && chartRequests.get(element) === request && element.getClientRects().length) {
			await plotly.Plots.resize(element);
		}
	} catch (error) {
		if (chartRequests.get(element) !== request) return;
		const message = document.createElement('p');
		message.textContent = 'Unable to load chart. ';
		const retry = document.createElement('button');
		retry.textContent = 'Retry';
		retry.onclick = () => renderLazyChart(element, data, layout, config);
		message.append(retry);
		element.replaceChildren(message);
		console.error(error);
	}
}

function showDataStatus(message, retry) {
	let status = document.getElementById('data-status');
	if (!status) {
		status = document.createElement('div');
		status.id = 'data-status';
		status.setAttribute('role', 'status');
		(document.getElementById('table-container') || document.getElementById('table')).before(status);
	}
	status.hidden = !message;
	status.textContent = message;
	if (retry) {
		const button = document.createElement('button');
		button.textContent = 'Retry';
		button.onclick = retry;
		status.append(' ', button);
	}
}

// Keep periodic refreshes from overlapping; the returned promise covers rendering.
function createDataRefresh(url, applyData, onUnchanged = () => {}) {
	let pending;
	let lastPayload;
	let lastUrl;
	let lastToken;
	const refresh = function refresh() {
		if (pending) return pending;
		pending = (async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20000);
			try {
				const requestUrl = url();
				const requestToken = ACCESS_TOKEN;
				const requestStarted = performance.now();
				const response = await fetch(requestUrl, {
					headers: { Authorization: `Bearer ${requestToken}` },
					signal: controller.signal
				});
				if (!response.ok) throw new Error(`Request failed (${response.status})`);
				const data = await response.json();
				const receivedAt = performance.now();
				if (!data || (!Array.isArray(data) && !Array.isArray(data.data))) throw new Error('Invalid data response');
				// Capture server values before filtering adds computed fields to RES.
				// Compare all content, including games/times/weather, except freshness metadata.
				const { updated, ...content } = data;
				const payload = JSON.stringify(Array.isArray(data) ? data : content);
				await tableReady;
				if (payload === lastPayload && requestUrl === lastUrl && requestToken === lastToken) {
					await onUnchanged(data);
				} else {
					await applyData(data);
					// Failed renders must remain retryable with the same response.
					lastPayload = payload;
					lastUrl = requestUrl;
					lastToken = requestToken;
				}
				const timing = {
					version: response.headers.get('X-Odds-Version'),
					publishedAt: response.headers.get('X-Odds-Published-At'),
					cachedAt: response.headers.get('X-Odds-Cached-At'),
					renderedAt: new Date().toISOString(),
					requestMs: Math.round(receivedAt - requestStarted),
					renderMs: Math.round(performance.now() - receivedAt)
				};
				window.LAST_ODDS_TIMING = timing;
				window.dispatchEvent(new CustomEvent('odds-rendered', {detail: timing}));
				registerOddsLiveRefresh(refresh, response.headers.get('X-Odds-Dataset'));
				showDataStatus('');
			} catch (error) {
				showDataStatus('Unable to update data. Any previously loaded results are still shown.', refresh);
				console.error(error);
			} finally {
				clearTimeout(timeout);
				pending = null;
			}
		})();
		return pending;
	};
	// An invalidation during an in-flight fetch must cause a subsequent fetch.
	refresh.requestLatest = () => pending ? pending.then(() => refresh()) : refresh();
	registerOddsLiveRefresh(refresh, null);
	return refresh;
}

function refreshDataTimestamps(data) {
	UPDATED[PAGE] = data.updated;
	RES.updated = data.updated;
	updateHeaders();
}

// One connection per shared data loader. Existing 30s polling remains the fallback.
const oddsLiveWatchers = new WeakMap();
function registerOddsLiveRefresh(refresh, dataset) {
	if (oddsLiveWatchers.has(refresh)) {
		oddsLiveWatchers.get(refresh).setDataset(dataset);
		return;
	}
	let currentDataset = dataset, source = null, timer = null, running = false, dirty = false;
	let stopped = false;
	const visible = () => document.visibilityState !== 'hidden';
	async function drain() {
		timer = null;
		if (running || !visible() || stopped) return;
		running = true;
		try {
			while (dirty && visible() && !stopped) {
				dirty = false;
				await refresh.requestLatest();
			}
		} catch (error) { console.error('Live odds refresh failed', error); }
		finally { running = false; }
	}
	function request(immediate = false) {
		dirty = true;
		if (!visible() || stopped || running) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(drain, immediate ? 0 : 100);
	}
	function disconnect() { if (source) source.close(); source = null; }
	function connect() {
		if (source || stopped || !visible() || !currentDataset || typeof EventSource === 'undefined') return;
		const url = new URL('/api/odds-events', API_BASE);
		url.searchParams.set('datasets', currentDataset);
		source = new EventSource(url.toString());
		// A reconnect may have missed updates. Always reconcile with the data route.
		source.addEventListener('ready', () => request());
		source.addEventListener('odds-update', event => {
			try {
				const message = JSON.parse(event.data);
				if (message.dataset === currentDataset) request();
			} catch (_) { /* Polling remains available for malformed events. */ }
		});
	}
	document.addEventListener('visibilitychange', () => {
		if (visible()) { connect(); request(true); } else disconnect();
	});
	window.addEventListener('pagehide', () => {
		stopped = true; disconnect(); if (timer !== null) clearTimeout(timer);
	});
	window.addEventListener('pageshow', () => {
		if (stopped) { stopped = false; connect(); request(true); }
	});
	oddsLiveWatchers.set(refresh, {setDataset(next) {
		if (currentDataset !== next) { currentDataset = next; disconnect(); connect(); }
	}});
	connect();
}
