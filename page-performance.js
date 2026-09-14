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
	return function refresh() {
		if (pending) return pending;
		pending = (async () => {
			// Background checks should not insert a banner and shift the table.
			if (lastPayload === undefined) showDataStatus('Updating data…');
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20000);
			try {
				const requestUrl = url();
				const requestToken = ACCESS_TOKEN;
				const response = await fetch(requestUrl, {
					headers: { Authorization: `Bearer ${requestToken}` },
					signal: controller.signal
				});
				if (!response.ok) throw new Error(`Request failed (${response.status})`);
				const data = await response.json();
				if (!Array.isArray(data.data) || !data.games) throw new Error('Invalid data response');
				// Capture server values before filtering adds computed fields to RES.
				// Compare all content, including games/times/weather, except freshness metadata.
				const { updated, ...content } = data;
				const payload = JSON.stringify(content);
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
}

function refreshDataTimestamps(data) {
	UPDATED[PAGE] = data.updated;
	RES.updated = data.updated;
	updateHeaders();
}
