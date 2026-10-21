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

const tableRefreshControllers = new WeakMap();
let activeTableRefreshController;

// One scheduler and control for the page, shared by polling and live updates.
function startTableRefresh(refresh, { intervalMs = 30000 } = {}) {
	const existing = tableRefreshControllers.get(refresh);
	if (existing) {
		existing.refreshNow();
		return existing;
	}
	activeTableRefreshController?.dispose();
	// Pausing applies only to the current page visit, never to the next page.
	let enabled = true;
	let busy = false, failed = false, stopped = false, disposed = false;
	let nextAt = null, timer = null, ticker = null, running = null, activity = 0;
	const visible = () => document.visibilityState !== 'hidden' && !stopped;
	const controls = document.createElement('div');
	controls.id = 'table-refresh-controls';
	controls.className = 'table-refresh-controls';
	controls.setAttribute('role', 'group');
	controls.setAttribute('aria-label', 'Table refresh');
	controls.innerHTML = `<span class="table-refresh-status"></span>
		<button type="button" class="table-refresh-now">Refresh now</button>
		<label class="table-refresh-auto"><input type="checkbox" aria-label="Auto-refresh table"> Auto</label>`;
	const status = controls.querySelector('.table-refresh-status');
	const button = controls.querySelector('.table-refresh-now');
	const toggle = controls.querySelector('input');
	controls.title = 'Checks for updates every 30 seconds while this tab is visible. Live updates may arrive sooner.';
	const footer = document.querySelector('.site-footer') || document.querySelector('footer');
	if (footer) {
		footer.classList.add('has-table-refresh');
		footer.append(controls);
	} else {
		(document.getElementById('table-container') || document.getElementById('table')).after(controls);
	}

	function render() {
		// Do not announce every countdown tick to screen readers.
		status.textContent = busy ? 'Refreshing…' : !enabled ? 'Auto off' : !visible() ? 'Waiting for tab'
			: `${failed ? 'Retry' : 'Next'} in ${Math.max(0, Math.ceil(((nextAt ?? Date.now()) - Date.now()) / 1000))}s`;
		button.disabled = busy;
		toggle.checked = enabled;
		controls.dataset.state = busy ? 'refreshing' : enabled ? 'auto' : 'paused';
		controls.setAttribute('aria-busy', String(busy));
	}
	function clearSchedule() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		nextAt = null;
	}
	function schedule() {
		clearSchedule();
		if (!disposed && enabled && visible() && !busy) {
			nextAt = Date.now() + intervalMs;
			timer = setTimeout(() => {
				timer = null;
				if (enabled && visible() && !disposed) run();
			}, intervalMs);
		}
		render();
	}
	function setRefreshing(value, succeeded = true) {
		if (disposed) return;
		activity++;
		busy = value;
		if (busy) { failed = false; clearSchedule(); render(); }
		else { failed = !succeeded; schedule(); }
	}
	function run() {
		if (disposed) return Promise.resolve();
		if (running) return running;
		setRefreshing(true);
		const requestActivity = activity;
		let succeeded = true;
		running = Promise.resolve().then(() => refresh()).then(() => {
			succeeded = refresh.lastRefreshSucceeded !== false;
		}).catch(error => {
			succeeded = false;
			showDataStatus('Unable to update data. Any previously loaded results are still shown.', run);
			console.error(error);
		}).finally(() => {
			running = null;
			// Shared loaders report completion themselves. An SSE follow-up may
			// already be running, so this earlier request must not clear its state.
			if (activity === requestActivity) setRefreshing(false, succeeded);
		});
		return running;
	}
	function setEnabled(value) {
		if (disposed || enabled === !!value) return;
		enabled = !!value;
		refresh.autoRefreshEnabled = enabled;
		clearSchedule();
		oddsLiveWatchers.get(refresh)?.setEnabled();
		if (enabled) run();
		else render();
	}
	function visibilityChanged() {
		if (visible() && enabled) run();
		else { clearSchedule(); render(); }
	}
	function pageHidden() {
		stopped = true;
		clearSchedule();
		clearInterval(ticker);
		ticker = null;
		render();
	}
	function pageShown() {
		if (!stopped) return;
		stopped = false;
		ticker = setInterval(render, 1000);
		// Back/forward navigation can restore this controller from the page cache.
		enabled = true;
		refresh.autoRefreshEnabled = true;
		oddsLiveWatchers.get(refresh)?.setEnabled();
		visibilityChanged();
	}
	const controller = {
		refreshNow: run, setEnabled, setRefreshing,
		dispose() {
			disposed = true;
			refresh.autoRefreshEnabled = false;
			oddsLiveWatchers.get(refresh)?.setEnabled();
			clearSchedule();
			clearInterval(ticker);
			document.removeEventListener('visibilitychange', visibilityChanged);
			window.removeEventListener('pagehide', pageHidden);
			window.removeEventListener('pageshow', pageShown);
			controls.remove();
			footer?.classList.remove('has-table-refresh');
			tableRefreshControllers.delete(refresh);
			if (activeTableRefreshController === controller) activeTableRefreshController = null;
		}
	};
	tableRefreshControllers.set(refresh, controller);
	activeTableRefreshController = controller;
	refresh.autoRefreshEnabled = enabled;
	oddsLiveWatchers.get(refresh)?.setEnabled();
	button.addEventListener('click', run);
	toggle.addEventListener('change', () => setEnabled(toggle.checked));
	document.addEventListener('visibilitychange', visibilityChanged);
	window.addEventListener('pagehide', pageHidden);
	window.addEventListener('pageshow', pageShown);
	ticker = setInterval(render, 1000);
	// Load immediately, then schedule the next refresh after rendering completes.
	run();
	return controller;
}

// Keep periodic refreshes from overlapping; the returned promise covers rendering.
function createDataRefresh(url, applyData, onUnchanged = () => {}) {
	let pending;
	let lastPayload;
	let lastUrl;
	let lastToken;
	const refresh = function refresh() {
		if (pending) return pending;
		tableRefreshControllers.get(refresh)?.setRefreshing(true);
		refresh.lastRefreshSucceeded = false;
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
				refresh.lastRefreshSucceeded = true;
			} catch (error) {
				showDataStatus('Unable to update data. Any previously loaded results are still shown.', refresh);
				console.error(error);
			} finally {
				clearTimeout(timeout);
				pending = null;
				tableRefreshControllers.get(refresh)?.setRefreshing(false, refresh.lastRefreshSucceeded);
			}
		})();
		return pending;
	};
	// An invalidation during an in-flight fetch must cause a subsequent fetch.
	refresh.requestLatest = (allowed = () => true) => {
		const request = () => allowed() ? refresh() : Promise.resolve();
		return pending ? pending.then(request) : request();
	};
	registerOddsLiveRefresh(refresh, null);
	return refresh;
}

function refreshDataTimestamps(data) {
	UPDATED[PAGE] = data.updated;
	RES.updated = data.updated;
	updateHeaders();
}

// One connection per shared data loader. The countdown is the polling fallback.
const oddsLiveWatchers = new WeakMap();
function registerOddsLiveRefresh(refresh, dataset) {
	if (oddsLiveWatchers.has(refresh)) {
		oddsLiveWatchers.get(refresh).setDataset(dataset);
		return;
	}
	let currentDataset = dataset, source = null, timer = null, running = false, dirty = false;
	let stopped = false;
	const visible = () => document.visibilityState !== 'hidden';
	const allowed = () => visible() && !stopped && refresh.autoRefreshEnabled !== false;
	async function drain() {
		timer = null;
		if (running || !allowed()) return;
		running = true;
		try {
			while (dirty && allowed()) {
				dirty = false;
				await refresh.requestLatest(allowed);
			}
		} catch (error) { console.error('Live odds refresh failed', error); }
		finally { running = false; }
	}
	function request(immediate = false) {
		if (refresh.autoRefreshEnabled === false) return;
		dirty = true;
		if (!allowed() || running) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(drain, immediate ? 0 : 100);
	}
	function disconnect() { if (source) source.close(); source = null; }
	function connect() {
		if (source || !allowed() || !currentDataset || typeof EventSource === 'undefined') return;
		const url = new URL('/api/odds-events', API_BASE);
		url.searchParams.set('datasets', currentDataset);
		source = new EventSource(url.toString());
		// Reconcile updates published between the last fetch and this connection.
		source.addEventListener('ready', () => request());
		source.addEventListener('odds-update', event => {
			try {
				const message = JSON.parse(event.data);
				if (message.dataset === currentDataset) request();
			} catch (_) { /* Polling remains available for malformed events. */ }
		});
	}
	document.addEventListener('visibilitychange', () => {
		if (visible()) {
			connect();
			if (!tableRefreshControllers.has(refresh)) request(true);
		} else disconnect();
	});
	window.addEventListener('pagehide', () => {
		stopped = true; disconnect(); if (timer !== null) clearTimeout(timer);
	});
	window.addEventListener('pageshow', () => {
		if (stopped) {
			stopped = false; connect();
			if (!tableRefreshControllers.has(refresh)) request(true);
		}
	});
	oddsLiveWatchers.set(refresh, {
		setDataset(next) {
			if (currentDataset !== next) { currentDataset = next; disconnect(); connect(); }
		},
		setEnabled() {
			if (refresh.autoRefreshEnabled === false) {
				dirty = false;
				if (timer !== null) clearTimeout(timer);
				timer = null;
				disconnect();
			} else connect();
		}
	});
	connect();
}
