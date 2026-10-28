function createNbaHistoryLoader(root, { maxEntries = 48, maxPending = 8, timeoutMs = 15000 } = {}) {
	const fields = ['careerLogs', 'bvtLogs', 'awayLogs', 'homeLogs'];
	const cache = new Map(), pending = new Map();
	let currentToken;
	return function load(key) {
		if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return Promise.reject(new Error('Invalid history key'));
		const token = typeof ACCESS_TOKEN === 'string' ? ACCESS_TOKEN : '';
		if (token !== currentToken) { cache.clear(); pending.clear(); currentToken = token; }
		if (cache.has(key)) {
			const data = cache.get(key);
			cache.delete(key); cache.set(key, data);
			return Promise.resolve(data);
		}
		if (pending.has(key)) return pending.get(key);
		if (pending.size >= maxPending) return Promise.reject(new Error('History requests busy'));
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const work = Promise.resolve().then(async () => {
			const url = new URL('/api/nba-history', API_BASE);
			url.searchParams.set('key', key);
			const response = await root.fetch(url.toString(), {
				headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
			});
			if (!response.ok) {
				const error = new Error('History request failed');
				if (response.status === 404) error.code = 'history_not_found';
				throw error;
			}
			const data = await response.json();
			if (data?.key !== key || !fields.every(field => Array.isArray(data[field])
				&& data[field].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))) {
				throw new Error('Invalid history response');
			}
			const result = Object.freeze(Object.fromEntries(fields.map(field => [field, Object.freeze([...data[field]])])));
			if (currentToken === token) {
				cache.set(key, result);
				while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
			}
			return result;
		}).finally(() => {
			clearTimeout(timer);
			if (pending.get(key) === work) pending.delete(key);
		});
		pending.set(key, work);
		return work;
	};
}

function createPlayerHistory(root, { prefix, views, props, lineOf = row => row.handicap, roundPercent = Math.round, loadHistory }) {
	const logFields = { logs: 'logs', career: 'careerLogs', bvt: 'bvtLogs', away: 'awayLogs', home: 'homeLogs' };
	const colors = { hit: '#36d399', miss: '#c57580', push: '#94a3b8', gap: '#659be8', current: '#c388ff', average: '#f2bd60', median: '#5dd8cf' };
	const numeric = value => typeof value === 'number' && Number.isFinite(value);
	const logsOf = value => Array.isArray(value) ? value.filter(numeric) : [];
	const display = value => Number.isInteger(value) ? String(value) : Number(value.toFixed(1)).toString();
	let dialog, selected, view, range = '20', opener, priceHistory, orderBooks;
	let historyGeneration = 0, historyState;
	const longHistory = () => !['logs', 'pricehistory', 'orderbooks', 'due'].includes(view);

	function loadSelectedHistory() {
		const row = selected, generation = historyGeneration;
		historyState = 'loading';
		loadHistory(row.historyKey).then(history => {
			if (generation !== historyGeneration || selected !== row || !dialog?.open) return;
			Object.assign(row, history); // Modal-only copy; never enlarge the polled odds rows.
			historyState = 'ready';
			if (longHistory()) render();
		}).catch(error => {
			if (generation !== historyGeneration || selected !== row || !dialog?.open) return;
			historyState = error?.code === 'history_not_found' ? 'expired' : 'error';
			if (longHistory()) render();
		});
	}

	function dueOf(row) {
		// Goal-gap history describes any goal, not a 2+ or first-goal result.
		if (!views.due || row.prop !== 'atgs' || Number(row.handicap) !== 0.5 || row.under) return null;
		const due = row.due?.g;
		const gaps = logsOf(due?.btwn).filter(value => Number.isInteger(value) && value >= 0);
		return gaps.length && numeric(due.streak) && due.streak >= 0 ? { ...due, gaps } : null;
	}

	function purgeChart() {
		const chart = dialog?.querySelector(`#${prefix}-chart`);
		if (chart && root.Plotly) root.Plotly.purge(chart);
		chart?.remove(); // Disconnect pending lazy renders before changing the view/player.
	}

	function destroyPriceHistory() {
		priceHistory?.destroy();
		priceHistory = null;
		dialog?.querySelector('.player-history-price-host')?.replaceChildren();
		orderBooks?.destroy();
		orderBooks = null;
		dialog?.querySelector('.player-history-depth-host')?.replaceChildren();
	}

	function close() {
		historyGeneration++;
		purgeChart();
		destroyPriceHistory();
		if (dialog?.open) dialog.close();
	}

	function ensureDialog() {
		if (dialog) return;
		dialog = document.createElement('dialog');
		dialog.id = `${prefix}-dialog`;
		dialog.className = 'player-history-dialog';
		dialog.setAttribute('aria-labelledby', `${prefix}-title`);
		dialog.innerHTML = `
			<header class="nhl-history-header">
				<div><h2 id="${prefix}-title" class="player-history-title"></h2><p class="nhl-history-context"></p></div>
				<button type="button" class="nhl-history-close" aria-label="Close player history">&times;</button>
			</header>
			<div class="nhl-history-toolbar">
				<div class="nhl-history-tabs" role="tablist" aria-label="Player history">
					${Object.entries(views).map(([key, label]) => `<button type="button" id="${prefix}-tab-${key}" role="tab" aria-controls="${prefix}-panel" data-history-view="${key}">${label}</button>`).join('')}
					<button type="button" id="${prefix}-tab-pricehistory" role="tab" aria-controls="${prefix}-panel" data-history-view="pricehistory" hidden>Price history</button>
					<button type="button" id="${prefix}-tab-orderbooks" role="tab" aria-controls="${prefix}-panel" data-history-view="orderbooks" hidden>Order books</button>
				</div>
				<div class="nhl-history-ranges" role="group" aria-label="Games shown">
					<button type="button" data-history-range="10">L10</button>
					<button type="button" data-history-range="20">L20</button>
					<button type="button" data-history-range="all">All</button>
				</div>
			</div>
			<section id="${prefix}-panel" class="player-history-panel" role="tabpanel" tabindex="0">
				<div class="player-history-game-content">
					<div class="nhl-history-stats"></div>
					<p class="nhl-history-note"></p>
					<div class="nhl-history-plot-scroll"></div>
					<p class="nhl-history-empty" hidden></p>
					<div class="nhl-history-legend"></div>
				</div>
				<div id="${prefix}-price-history" class="player-history-price-host" hidden></div>
				<div class="player-history-depth-host" hidden></div>
			</section>
			<footer class="nhl-history-footer">
				<button type="button" data-history-action="prices">Compare prices</button>
				<button type="button" data-history-action="card">Play card</button>
			</footer>`;
		document.body.append(dialog);
		dialog.querySelector('.nhl-history-close').onclick = close;
		dialog.addEventListener('click', event => {
			if (event.target !== dialog) return;
			const box = dialog.getBoundingClientRect();
			if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
		});
		dialog.addEventListener('close', () => {
			if (dialog.open) return;
			historyGeneration++;
			purgeChart();
			destroyPriceHistory();
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		});
		dialog.addEventListener('cancel', () => {
			historyGeneration++;
			purgeChart();
			destroyPriceHistory();
		});
		dialog.querySelectorAll('[data-history-view]').forEach(button => {
			button.onclick = () => {
				if (button.hidden || button.disabled) return;
				view = button.dataset.historyView;
				render();
			};
			button.onkeydown = event => {
				if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				const tabs = [...dialog.querySelectorAll('[data-history-view]')].filter(tab => !tab.disabled && !tab.hidden);
				let index = tabs.indexOf(button);
				index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
				tabs[index].focus();
				tabs[index].click();
			};
		});
		dialog.querySelectorAll('[data-history-range]').forEach(button => {
			button.onclick = () => { range = button.dataset.historyRange; render(); };
		});
		dialog.querySelector('[data-history-action="prices"]').onclick = () => {
			const data = selected;
			close();
			const rows = typeof root.goalComparisonInputRows === 'function' ? root.goalComparisonInputRows(data, RES) : RES?.data || [];
			const comparisonRow = row => lineOf(row) === row.handicap ? row : { ...row, handicap: lineOf(row) };
			root.PlayerLines.open(comparisonRow(data), rows.map(comparisonRow), { player: title(data.player), formatProp: convertProp, formatOdds: oddsDisplay });
		};
		dialog.querySelector('[data-history-action="card"]').onclick = () => {
			const data = selected;
			close();
			showCardModal(data);
		};
	}

	function summary(items) {
		const container = dialog.querySelector('.nhl-history-stats');
		container.replaceChildren(...items.map(([label, value, detail]) => {
			const item = document.createElement('div');
			const name = document.createElement('span');
			name.textContent = label;
			const metric = document.createElement('strong');
			metric.textContent = value;
			const content = document.createElement('div');
			content.className = 'nhl-history-value';
			content.append(metric);
			if (detail) {
				const badge = document.createElement('small');
				badge.className = 'nhl-history-z';
				badge.textContent = detail.text;
				badge.title = detail.title;
				badge.setAttribute('aria-label', detail.title);
				content.append(badge);
			}
			item.append(name, content);
			return item;
		}));
	}

	function draw(traces, layout, count = 0) {
		const scroll = dialog.querySelector('.nhl-history-plot-scroll');
		const chart = document.createElement('div');
		chart.id = `${prefix}-chart`;
		chart.className = 'player-history-chart';
		chart.style.width = `${Math.max(scroll.clientWidth, count * 15 + 65)}px`;
		chart.setAttribute('role', 'img');
		chart.setAttribute('aria-label', `${views[view]} for ${title(selected.player)}. ${dialog.querySelector('.nhl-history-note').textContent}`);
		scroll.replaceChildren(chart);
		const base = {
			autosize: true, height: innerWidth < 600 ? 280 : 330,
			margin: { l: 40, r: 16, t: 28, b: 48 },
			paper_bgcolor: '#111b27', plot_bgcolor: '#111b27',
			font: { color: '#bdcddd', family: 'Arial, sans-serif', size: 11 },
			showlegend: false, dragmode: false, bargap: 0.28,
			...layout
		};
		renderLazyChart(chart, traces, base, { responsive: true, displayModeBar: false, scrollZoom: false }).then(() => {
			if (chart.isConnected) scroll.scrollLeft = scroll.scrollWidth;
		});
	}

	function renderDue(due) {
		const counts = new Map();
		due.gaps.forEach(gap => counts.set(gap, (counts.get(gap) || 0) + 1));
		const x = [...counts.keys()].sort((a, b) => a - b);
		const y = x.map(gap => counts.get(gap));
		const sorted = [...due.gaps].sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		// The feed can leave med/avg at zero for a single gap; use the plotted sample.
		const median = (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2;
		const average = due.gaps.reduce((a, b) => a + b, 0) / due.gaps.length;
		const sd = due.gaps.length > 1 ? Math.sqrt(due.gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / (due.gaps.length - 1)) : 0;
		// The feed's mean-based score is `z`; zero is a placeholder when SD is zero.
		const score = sd > 0 ? (numeric(due.z) ? due.z : (due.streak - average) / sd) : null;
		const z = numeric(score) ? Number(score.toFixed(2)) : null;
		const zDetail = z === null
			? { text: 'Z N/A', title: 'Z-score unavailable: at least two completed gaps with variation are needed.' }
			: { text: `Z ${z > 0 ? '+' : ''}${z.toFixed(2)}`, title: z === 0 ? 'Z-score: current gap is at the average gap.' : `Z-score: current gap is ${Math.abs(z).toFixed(2)} standard deviations ${z < 0 ? 'below' : 'above'} the average gap.` };
		summary([['Current gap', `${display(due.streak)} games`], ['Median gap', `${display(median)} games`], ['Average gap', `${display(average)} games`, zDetail]]);
		const markers = [];
		for (const [label, value, color, dash] of [
			['Current', due.streak, colors.current, 'dash'],
			['Average', average, colors.average, 'dashdot'],
			['Median', median, colors.median, 'dot']
		]) {
			const existing = markers.find(marker => Math.abs(marker.value - value) < 1e-9);
			if (existing) existing.labels.push(label);
			else markers.push({ labels: [label], value, color, dash });
		}
		dialog.querySelector('.nhl-history-legend').replaceChildren(...markers.map(marker => {
			const label = document.createElement('span');
			label.className = 'history-reference';
			label.style.setProperty('--reference-color', marker.color);
			label.style.setProperty('--reference-style', marker.dash === 'dot' ? 'dotted' : 'dashed');
			label.textContent = `${marker.labels.join(' / ')} ${display(marker.value)}`;
			return label;
		}));
		dialog.querySelector('.nhl-history-note').textContent = `Career games between goals · ${due.gaps.length} completed gaps. Lines mark the current, average and median gaps.`;
		draw([{
			type: 'bar', x, y, text: y.map(String), textposition: 'outside', cliponaxis: false,
			marker: { color: x.map(gap => gap === due.streak ? colors.current : colors.gap) },
			hovertemplate: '%{x} games between goals<br>%{y} occurrences<extra></extra>'
		}], {
			xaxis: { title: { text: 'Games between goals' }, range: [-0.8, Math.max(...x, due.streak) + 0.8], showgrid: false, fixedrange: true, dtick: Math.max(...x, due.streak) < 20 ? 1 : undefined },
			yaxis: { title: { text: 'Occurrences' }, range: [0, Math.max(...y) * 1.25 + 0.5], gridcolor: '#263445', zeroline: false, fixedrange: true },
			shapes: markers.map(marker => ({ type: 'line', x0: marker.value, x1: marker.value, y0: 0, y1: 1, yref: 'paper', line: { color: marker.color, dash: marker.dash, width: 2 } })),
			annotations: [{ x: due.streak, y: 1.04, yref: 'paper', text: `Current ${display(due.streak)}`, showarrow: false, font: { color: colors.current } }]
		});
	}

	function renderLogs() {
		const empty = dialog.querySelector('.nhl-history-empty');
		const note = dialog.querySelector('.nhl-history-note');
		if (longHistory() && historyState && historyState !== 'ready') {
			summary([]);
			note.textContent = '';
			empty.textContent = historyState === 'loading' ? 'Loading player history…'
				: historyState === 'expired' ? 'History for this table is no longer available. Refresh the page and try again. '
				: 'Unable to load player history. ';
			empty.setAttribute('role', 'status');
			if (historyState !== 'loading') {
				const retry = document.createElement('button');
				retry.type = 'button';
				retry.textContent = 'Retry';
				retry.onclick = () => { loadSelectedHistory(); render(); };
				empty.append(retry);
			}
			empty.hidden = false;
			return;
		}
		const all = logsOf(selected[logFields[view]]);
		const values = range === 'all' ? all : all.slice(-Number(range));
		const opponent = String(selected.opp || '').toUpperCase();
		const venue = view === 'away' || view === 'home' ? view : '';
		const games = view === 'bvt' ? `meetings vs ${opponent || 'this opponent'}` : venue ? `${venue} games` : view === 'career' ? 'career games' : 'games';
		const rawLine = lineOf(selected);
		const line = rawLine === null || rawLine === undefined || rawLine === '' ? NaN : Number(rawLine);
		const hasLine = Number.isFinite(line);
		if (!values.length) {
			summary([]);
			note.textContent = '';
			empty.textContent = view === 'bvt' ? `No ${props[selected.prop] || selected.prop} history available against ${opponent || 'this opponent'}.` : `No ${venue ? `${venue} ` : view === 'career' ? 'career ' : ''}game logs available for this prop.`;
			empty.hidden = false;
			return;
		}
		const result = value => !hasLine ? 'push' : value === line ? 'push' : (selected.under ? value < line : value > line) ? 'hit' : 'miss';
		const hits = values.filter(value => result(value) === 'hit').length;
		const pushes = hasLine ? values.filter(value => value === line).length : 0;
		const average = values.reduce((a, b) => a + b, 0) / values.length;
		summary([...(hasLine ? [['Hit rate', `${roundPercent(hits * 100 / values.length)}% (${hits}/${values.length})`]] : []), ['Average', display(average)], ['Games', String(values.length)]]);
		note.textContent = `${values.length === all.length ? `All ${all.length} available` : `Last ${values.length} of ${all.length}`} ${games} · Oldest to latest${pushes ? ` · ${pushes} push${pushes === 1 ? '' : 'es'}` : ''}`;
		if (hasLine) dialog.querySelector('.nhl-history-legend').innerHTML = '<span class="history-hit">Hit</span><span class="history-miss">Miss</span><span class="history-push">Push</span><span>Dashed: selected line</span>';
		const x = values.map((_, index) => index + 1);
		const max = Math.max(...values, hasLine ? line : 0, 1);
		const min = Math.min(0, ...values);
		const labels = values.map((_, index) => index === values.length - 1 ? 'Latest' : `${values.length - index - 1} ago`);
		const step = Math.max(1, Math.ceil(values.length / (innerWidth < 600 ? 5 : 10)));
		const tickvals = x.filter((value, index) => index % step === 0 || value === values.length);
		draw([{
			type: 'bar', x, y: values, text: values.map(display), textposition: 'outside', cliponaxis: false,
			marker: { color: values.map(value => colors[result(value)]) },
			customdata: values.map((value, index) => [labels[index], hasLine ? result(value).toUpperCase() : '']),
			hovertemplate: '%{customdata[0]}<br>%{y} · %{customdata[1]}<extra></extra>'
		}], {
			xaxis: { title: { text: view === 'bvt' ? `Games vs ${opponent || 'opponent'}` : venue || view === 'career' ? `${views[view]} games` : 'Recent games' }, tickvals, ticktext: tickvals.map(value => labels[value - 1]), showgrid: false, fixedrange: true },
			yaxis: { title: { text: props[selected.prop] || convertProp(selected.prop) }, range: [min < 0 ? min - (max - min) * 0.12 - 0.5 : 0, max * 1.2 + 0.5], dtick: max < 10 ? 1 : undefined, gridcolor: '#263445', zeroline: false, fixedrange: true },
			shapes: hasLine ? [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: line, y1: line, line: { color: '#dbe7f3', dash: 'dash', width: 1.5 } }] : []
		}, values.length);
	}

	function render() {
		purgeChart();
		destroyPriceHistory();
		const hasPriceHistory = !!root.PriceHistory?.hasData(selected);
		dialog.querySelector('[data-history-view="pricehistory"]').hidden = !hasPriceHistory;
		if (view === 'pricehistory' && !hasPriceHistory) view = dueOf(selected) ? 'due' : 'logs';
		const showPrices = view === 'pricehistory';
		const hasOrderBooks = !!root.PlayerLines?.mountDepth;
		dialog.querySelector('[data-history-view="orderbooks"]').hidden = !hasOrderBooks;
		if (view === 'orderbooks' && !hasOrderBooks) view = dueOf(selected) ? 'due' : 'logs';
		const showBooks = view === 'orderbooks';
		dialog.querySelector('.player-history-game-content').hidden = showPrices || showBooks;
		const priceHost = dialog.querySelector('.player-history-price-host');
		priceHost.hidden = !showPrices;
		const depthHost = dialog.querySelector('.player-history-depth-host');
		depthHost.hidden = !showBooks;
		dialog.querySelector('.nhl-history-empty').hidden = true;
		dialog.querySelector('.nhl-history-legend').replaceChildren();
		dialog.querySelectorAll('[data-history-view]').forEach(button => {
			button.setAttribute('aria-selected', String(button.dataset.historyView === view));
			button.tabIndex = button.dataset.historyView === view ? 0 : -1;
		});
		dialog.querySelector(`#${prefix}-panel`).setAttribute('aria-labelledby', `${prefix}-tab-${view}`);
		dialog.querySelector('.nhl-history-ranges').hidden = view === 'due' || showPrices || showBooks;
		dialog.querySelectorAll('[data-history-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyRange === range)));
		if (showPrices) priceHistory = root.PriceHistory.mount(priceHost, selected);
		else if (showBooks) orderBooks = root.PlayerLines.mountDepth(depthHost, selected);
		else if (view === 'due') renderDue(dueOf(selected));
		else renderLogs();
	}

	function open(row) {
		if (!row?.player || row.blurred || row.prop === 'separator') return;
		ensureDialog();
		if (!dialog.open) opener = document.activeElement;
		historyGeneration++;
		const lazy = loadHistory && row.historyKey != null;
		selected = lazy ? { ...row } : row;
		historyState = lazy ? 'loading' : null;
		range = '20';
		const due = dueOf(row);
		view = due ? 'due' : 'logs';
		dialog.querySelector(`#${prefix}-title`).textContent = title(row.player);
		dialog.querySelector('.nhl-history-context').textContent = `${props[row.prop] || convertProp(row.prop)} · ${row.under ? 'Under' : 'Over'} ${lineOf(row) ?? ''} · ${String(row.game || row.opp || '').toUpperCase()}`;
		const dueButton = dialog.querySelector('[data-history-view="due"]');
		if (dueButton) {
			dueButton.disabled = !due;
			dueButton.title = due ? 'Career games between goals' : 'Goal-gap history is not available for this prop and line.';
		}
		dialog.querySelector('[data-history-action="prices"]').hidden = !root.PlayerLines;
		dialog.querySelector('[data-history-action="card"]').hidden = typeof showCardModal !== 'function';
		if (!dialog.open) dialog.showModal();
		render();
		if (lazy) loadSelectedHistory();
	}

	return { open, close };
}

window.NhlHistory = createPlayerHistory(window, {
	prefix: 'nhl-history',
	views: { due: 'Due', logs: 'Logs', bvt: 'Logs vs Opp', away: 'Away', home: 'Home' },
	props: { atgs: 'Goals', fgs: 'First goal', lgs: 'Last goal', sog: 'Shots on goal', ast: 'Assists', pts: 'Points', sv: 'Saves', bs: 'Blocked shots', pp_pts: 'Power play points' }
});
// Cards and the history dialog share the same bounded, session-aware cache.
const loadNbaPlayerHistory = createNbaHistoryLoader(window);
window.NbaHistory = createPlayerHistory(window, {
	prefix: 'nba-history',
	loadHistory: loadNbaPlayerHistory,
	views: { logs: 'Game logs', career: 'Career', bvt: 'Logs vs Opp', away: 'Away', home: 'Home' },
	// Match whole percentages from the NBA feed, including half-to-even ties.
	roundPercent: value => value % 1 === 0.5 ? Math.round(value / 2) * 2 : Math.round(value),
	props: {
		pts: 'Points', reb: 'Rebounds', ast: 'Assists', '3ptm': 'Made threes', stl: 'Steals', blk: 'Blocks',
		'pts+reb': 'Points + rebounds', 'pts+ast': 'Points + assists', 'reb+ast': 'Rebounds + assists',
		'pts+reb+ast': 'Points + rebounds + assists', 'blk+stl': 'Blocks + steals',
		dd: 'Double-doubles', td: 'Triple-doubles', fb: 'First basket', '1st pts': 'First basket'
	}
});
window.NflHistory = createPlayerHistory(window, {
	prefix: 'nfl-history',
	views: { logs: 'Game logs', bvt: 'Logs vs Opp', away: 'Away', home: 'Home' },
	props: {
		attd: 'Touchdowns', '2+td': 'Touchdowns', '3+td': 'Touchdowns', ftd: 'First touchdown', ltd: 'Last touchdown',
		pass_yd: 'Passing yards', pass_yds: 'Passing yards', pass_td: 'Passing touchdowns', pass_int: 'Interceptions thrown',
		pass_att: 'Pass attempts', pass_cmp: 'Completions', rush_yd: 'Rushing yards', rush_yds: 'Rushing yards',
		rush_att: 'Rush attempts', rec: 'Receptions', rec_yd: 'Receiving yards', rec_yds: 'Receiving yards',
		'rush+rec_yd': 'Rushing + receiving yards', 'rush+rec_yds': 'Rushing + receiving yards',
		longest_rec: 'Longest reception', longest_rush: 'Longest rush', 'tackles+ast': 'Tackles + assists'
	},
	lineOf: row => row.prop === '2+td' ? 1.5 : row.prop === '3+td' ? 2.5 : row.handicap
});
