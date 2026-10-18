(function (root) {
	'use strict';
	const names = { fd: 'FanDuel', dk: 'DraftKings', circa: 'Circa', pn: 'Pinnacle', b365: 'bet365', mgm: 'BetMGM', cz: 'Caesars', br: 'BetRivers', espn: 'ESPN BET', fn: 'Fanatics', hr: 'Hard Rock', hr_az: 'Hard Rock AZ', hr_oh: 'Hard Rock OH', bv: 'Bovada', bol: 'BetOnline', bm: 'BookMaker', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', kambi: 'Kambi', re: 'Rebet', fl: 'Fliff' };
	const palette = ['#74b8ff', '#f4b76a', '#80ddba', '#c5a1ff', '#f28cac', '#5dd9df', '#d3d884', '#a4bdde'];
	const mounts = new WeakMap();
	const bookName = book => Object.hasOwn(names, book) ? names[book] : book.toUpperCase();
	const odds = value => `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
	const probability = value => value > 0 ? 100 / (100 + value) : -value / (100 - value);
	const american = p => p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
	const validOdds = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= 100 && Math.abs(value) <= 1e7 && ![-100000, -20000, -10660].includes(value);
	const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
	const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
	const title = value => String(value || '').replace(/\b\w/g, char => char.toUpperCase());

	function normalize(row) {
		if (!row || row.blurred || !Array.isArray(row.oddsChart)) return { books: [], points: [] };
		const under = !!row.under || Number(row.ouIdx) === 1;
		const byTime = new Map(), books = new Set();
		for (const capture of row.oddsChart) {
			if (!capture || typeof capture.ts !== 'string') continue;
			const ts = Date.parse(capture.ts);
			if (!Number.isFinite(ts)) continue;
			const point = byTime.get(ts) || { ts, prices: {} };
			for (const [key, value] of Object.entries(capture)) {
				if (key === 'ts' || !/^[a-z][a-z0-9_]{0,30}$/.test(key) || key.endsWith('_under') !== under) continue;
				const book = under ? key.slice(0, -6) : key;
				if (!book || (book === 'circa' && row.circa_blurred)) continue;
				point.prices[book] = validOdds(value) ? value : null;
				if (validOdds(value)) books.add(book);
			}
			byTime.set(ts, point);
		}
		const order = Object.keys(names);
		const points = [...byTime.values()].sort((a, b) => a.ts - b.ts);
		return {
			books: [...books].filter(book => points.some(point => validOdds(point.prices[book]))).sort((a, b) => (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b)) || a.localeCompare(b)),
			points
		};
	}

	function mount(host, row) {
		mounts.get(host)?.destroy();
		const { books, points } = normalize(row);
		const section = document.createElement('section');
		section.className = 'price-history';
		section.setAttribute('aria-label', 'Recorded sportsbook price history');
		host.append(section);
		let selected = books[0], scale = 'odds', compare = true, chart, observer, resizeFrame, destroyed = false;
		function clearChart() {
			if (!chart) return;
			chart.remove(); // Disconnect lazy Plotly work before replacing or closing a view.
			if (root.Plotly && chart.data) root.Plotly.purge(chart);
			chart = null;
		}
		const handle = { destroy() {
			if (destroyed) return;
			destroyed = true;
			observer?.disconnect();
			cancelAnimationFrame(resizeFrame);
			clearChart();
			section.remove();
			if (mounts.get(host) === handle) mounts.delete(host);
		} };
		mounts.set(host, handle);
		if (!books.length) {
			const empty = document.createElement('p');
			empty.className = 'price-history-empty';
			empty.textContent = 'No recorded prices for this selection.';
			section.append(empty);
			return handle;
		}

		section.innerHTML = `
			<header class="price-history-heading">
				<div><h3>Price history</h3><p class="price-history-context"></p></div>
				<div class="price-history-scales" role="group" aria-label="Price chart scale">
					<button type="button" data-price-scale="odds" aria-pressed="true">Odds</button>
					<button type="button" data-price-scale="probability" aria-pressed="false">Implied %</button>
				</div>
			</header>
			<div class="price-history-books" role="group" aria-label="Focus a sportsbook" tabindex="0"></div>
			<div class="price-history-focus-row">
				<p class="price-history-focus"></p>
				<label class="price-history-compare"><input type="checkbox" data-price-compare checked> Compare books</label>
			</div>
			<div class="price-history-metrics" aria-live="polite">
				<div><span>First captured</span><strong data-price-first></strong><small data-price-first-time></small></div>
				<div><span>Last captured</span><strong data-price-last></strong><small data-price-last-time></small></div>
				<div><span>Probability move</span><strong data-price-move></strong><small data-price-direction></small></div>
			</div>
			<div class="price-history-plot"></div>
			<p class="price-history-note"></p>
			<p class="price-history-footnote">Recorded book prices before fees. Gaps mean no captured quote. Times are Eastern.</p>`;
		const $ = selector => section.querySelector(selector);
		const side = row.under || Number(row.ouIdx) === 1 ? 'Under' : 'Over';
		const line = row.handicap == null ? '' : ` ${row.handicap}`;
		$('.price-history-context').textContent = `${title(row.player)} · ${side}${line}`;
		const colorOf = book => palette[books.indexOf(book) % palette.length];
		const captures = Object.fromEntries(books.map(book => [book, points.filter(point => validOdds(point.prices[book]))]));
		for (const book of books) {
			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.priceBook = book;
			button.style.setProperty('--price-book-color', colorOf(book));
			button.setAttribute('aria-pressed', String(book === selected));
			button.setAttribute('aria-label', `Focus ${bookName(book)}`);
			const img = document.createElement('img');
			img.src = `logos/${book === 'kambi' ? 'parx' : book.startsWith('hr_') ? 'hr' : book}.png`;
			img.alt = '';
			img.width = img.height = 18;
			img.onerror = () => { img.hidden = true; };
			const label = document.createElement('span');
			label.textContent = bookName(book);
			const price = document.createElement('strong');
			price.textContent = odds(captures[book].at(-1).prices[book]);
			button.title = `Last captured ${timeFormat.format(captures[book].at(-1).ts)} ET`;
			button.append(img, label, price);
			button.onclick = () => { selected = book; render(); };
			$('.price-history-books').append(button);
		}
		section.querySelectorAll('[data-price-scale]').forEach(button => {
			button.onclick = () => { scale = button.dataset.priceScale; render(); };
		});
		$('[data-price-compare]').onchange = event => { compare = event.target.checked; render(); };
		$('.price-history-compare').hidden = books.length < 2;

		function render() {
			if (destroyed) return;
			clearChart();
			section.querySelectorAll('[data-price-book]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.priceBook === selected)));
			section.querySelectorAll('[data-price-scale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.priceScale === scale)));
			const first = captures[selected][0], last = captures[selected].at(-1);
			const change = (probability(last.prices[selected]) - probability(first.prices[selected])) * 100;
			const one = first.ts === last.ts;
			$('.price-history-focus').textContent = `${bookName(selected)} · ${captures[selected].length} capture${captures[selected].length === 1 ? '' : 's'}`;
			$('.price-history-focus').style.setProperty('--price-book-color', colorOf(selected));
			$('[data-price-first]').textContent = odds(first.prices[selected]);
			$('[data-price-last]').textContent = odds(last.prices[selected]);
			$('[data-price-first-time]').textContent = timeFormat.format(first.ts);
			$('[data-price-last-time]').textContent = timeFormat.format(last.ts);
			$('[data-price-move]').textContent = one ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)} pp`;
			$('[data-price-direction]').textContent = one ? 'One capture' : Math.abs(change) < 0.005 ? 'Unchanged' : change > 0 ? 'Shorter odds' : 'Longer odds';
			$('.price-history-note').textContent = one ? 'One captured price at this book. Movement will appear after another capture.' : last.ts < points.at(-1).ts ? 'This book has no quote at the latest capture. Its last recorded price is shown above.' : '';
			$('.price-history-note').hidden = !$('.price-history-note').textContent;

			const plottedBooks = compare ? [...books.filter(book => book !== selected), selected] : [selected];
			const traces = plottedBooks.map(book => ({
				type: 'scatter', mode: 'lines+markers', name: bookName(book), meta: { book },
				x: points.map(point => point.ts),
				y: points.map(point => validOdds(point.prices[book]) ? probability(point.prices[book]) * 100 : null),
				customdata: points.map(point => [timeFormat.format(point.ts), validOdds(point.prices[book]) ? odds(point.prices[book]) : '—']),
				line: { color: colorOf(book), width: book === selected ? 3 : 1.5, shape: 'hv', dash: books.indexOf(book) >= palette.length ? 'dot' : 'solid' },
				marker: { size: book === selected ? 5 : 3 }, opacity: book === selected ? 1 : 0.35,
				connectgaps: false,
				hovertemplate: '<b>%{fullData.name} %{customdata[1]}</b><br>%{customdata[0]} ET<br>Implied probability: %{y:.2f}%<extra></extra>'
			}));
			const values = traces.flatMap(trace => trace.y).filter(value => value !== null);
			const min = Math.min(...values), max = Math.max(...values);
			const padding = Math.max(0.3, (max - min) * 0.14);
			const low = Math.max(0.001, min - padding), high = Math.min(99.999, max + padding);
			const count = host.clientWidth < 500 ? 4 : 6;
			const tickIndices = [...new Set(Array.from({ length: Math.min(count, points.length) }, (_, i) => Math.round(i * (points.length - 1) / Math.max(1, Math.min(count, points.length) - 1))))];
			const multiDay = dayFormat.format(points[0].ts) !== dayFormat.format(points.at(-1).ts);
			const ticks = Array.from({ length: count }, (_, i) => low + (high - low) * (i + 0.5) / count);
			chart = document.createElement('div');
			chart.className = 'price-history-chart';
			chart.setAttribute('role', 'img');
			chart.setAttribute('aria-label', `${bookName(selected)} price history, from ${odds(first.prices[selected])} to ${odds(last.prices[selected])}. ${scale === 'odds' ? 'American odds' : 'Implied probability'} scale.`);
			$('.price-history-plot').append(chart);
			const layout = {
				height: host.clientWidth < 500 ? 245 : 295,
				paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
				font: { family: 'Inter, system-ui, sans-serif', color: '#9fb4ca', size: 11 },
				margin: { l: 57, r: 14, t: 18, b: multiDay ? 63 : 46 },
				showlegend: false, hovermode: 'closest', dragmode: false,
				hoverlabel: { bgcolor: '#152638', bordercolor: '#59748e', font: { color: '#f1f6fb', size: 12 } },
				xaxis: { type: 'linear', fixedrange: true, tickvals: tickIndices.map(i => points[i].ts), ticktext: tickIndices.map(i => multiDay ? `${dayFormat.format(points[i].ts)}<br>${clockFormat.format(points[i].ts)}` : clockFormat.format(points[i].ts)), gridcolor: '#243548', zeroline: false, ...(points.length === 1 ? { range: [points[0].ts - 900000, points[0].ts + 900000] } : {}) },
				// Plot in probability space to keep +100/-100 adjacent without a false jump through zero.
				yaxis: { fixedrange: true, range: scale === 'odds' ? [high, low] : [low, high], gridcolor: '#243548', zeroline: false, ...(scale === 'odds' ? { tickvals: ticks, ticktext: ticks.map(p => odds(american(p / 100))) } : { ticksuffix: '%', tickformat: '.1f' }) }
			};
			if (typeof root.renderLazyChart === 'function') root.renderLazyChart(chart, traces, layout, { responsive: true, displayModeBar: false, scrollZoom: false });
			else chart.textContent = 'The price chart could not load. Refresh to try again.';
		}
		if (typeof ResizeObserver !== 'undefined') {
			let width;
			observer = new ResizeObserver(entries => {
				const next = entries[0].contentRect.width;
				if (next === width || next <= 0) return;
				width = next;
				cancelAnimationFrame(resizeFrame);
				resizeFrame = requestAnimationFrame(() => {
					if (!destroyed && chart?.isConnected && chart.data && root.Plotly) root.Plotly.Plots.resize(chart);
				});
			});
			observer.observe(host);
		}
		render();
		return handle;
	}
	root.PriceHistory = { hasData: row => normalize(row).books.length > 0, normalize, mount };
})(window);
