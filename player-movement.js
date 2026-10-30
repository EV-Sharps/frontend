/* On-demand daily price movement for player dialogs. */
(function (root) {
    'use strict';
    const names = { circa: 'Circa', pn: 'Pinnacle', fd: 'FanDuel', dk: 'DraftKings', b365: 'bet365', mgm: 'BetMGM', cz: 'Caesars', br: 'BetRivers', espn: 'ESPN BET', fn: 'Fanatics', hr: 'Hard Rock', bv: 'Bovada', bol: 'BetOnline', bm: 'BookMaker', nv: 'Novig', px: 'ProphetX', kal: 'Kalshi', poly: 'Polymarket', kambi: 'Kambi', re: 'Rebet', fl: 'Fliff', hr_az: 'Hard Rock AZ', hr_oh: 'Hard Rock OH' };
    const exchanges = new Set(['nv', 'px', 'kal', 'poly', 'bfx', 'sm', 'mb', 'novig', 'prophetx', 'kalshi', 'polymarket', 'smarkets', 'matchbook', 'betfair', 'betfair_ex_uk', 'betfair_ex_eu', 'betfair_ex_au']);
    const palette = ['#78b7fa', '#efbc77', '#b49ae9', '#f18cb2', '#68cbd0', '#e4d570', '#b5ccd9', '#f29669', '#d6a4ff', '#8acde8', '#edb5bb', '#9babf7', '#c8cc9c', '#df95c9', '#d4c4a1', '#65d7bb'];
    const sports = new Set(['mlb', 'nfl', 'preseason', 'nhl', 'nba', 'wnba', 'ncaaf', 'ncaab', 'baseball_ncaa', 'soccer', 'cup', 'ufc']);
    const bookName = book => names[book] || book.toUpperCase();
    const norm = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const gameKey = value => norm(value).replace(/\s*@\s*/g, '@');
    const finiteLine = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
    const odds = value => value == null ? '-' : `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
    const validOdds = value => Number.isInteger(value) && Math.abs(value) >= 100 && Math.abs(value) <= 1e7 && ![-100000, -20000, -10660].includes(value);
    const probability = value => validOdds(value) ? (value > 0 ? 100 / (100 + value) : -value / (100 - value)) : null;
    const american = p => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
    const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const dayOf = value => Number.isFinite(new Date(value).getTime()) ? dayFormat.format(new Date(value)) : '';
    const timeOf = value => Number.isFinite(new Date(value).getTime()) ? `${timeFormat.format(new Date(value))} ET` : '';
    const tokenOf = () => typeof ACCESS_TOKEN === 'string' ? ACCESS_TOKEN : '';
    const cache = new Map(), bookChoices = new Map();
    let cacheToken;

    function sportOf(row) {
        const sport = row?.sport || (typeof SPORT === 'string' ? SPORT : '');
        return sports.has(sport) ? sport : '';
    }
    function matches(row, item, start) {
        if (norm(row.player) !== norm(item.player) || row.prop !== item.prop) return false;
        if (row.game && gameKey(row.game) !== gameKey(item.game)) return false;
        // Match an event's scheduled instant when available, otherwise its Eastern game date.
        if (start && Number.isFinite(Date.parse(start)) && Date.parse(start) !== Date.parse(item.start)) return false;
        const date = row.dt || row.date;
        if (!start && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && dayOf(item.start) !== date) return false;
        return true;
    }
    function pairedProbability(pair, side) {
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        const ps = pair.map(probability);
        if (ps.some(p => p === null)) return null;
        const total = ps[0] + ps[1];
        // Same proportional devig and quote sanity bounds as the movement API.
        return total >= .995 - 1e-10 && total <= 1.35 + 1e-10 ? ps[side] / total : null;
    }
    function joinDetails(over, under, row) {
        if (over.day !== under.day || over.updated !== under.updated || over.selection?.id !== under.selection?.id) throw new Error('Captures changed while loading. Refresh to try again.');
        const opposite = new Map((under.points || []).map(point => [point.ts, point]));
        const books = new Set();
        const points = (over.points || []).filter(point => dayOf(point.ts) === over.day).map(point => {
            const other = opposite.get(point.ts), pairs = {};
            // Never combine two captures taken at different times.
            const aligned = other && other.observed_at === point.observed_at;
            for (const book of new Set([...Object.keys(point.prices || {}), ...Object.keys(other?.prices || {})])) {
                if (!/^[a-z0-9][a-z0-9_]{0,39}$/.test(book) || (book === 'circa' && row.circa_blurred)) continue;
                const pair = [point.prices?.[book], aligned ? other.prices?.[book] : null].map(value => validOdds(value) ? value : null);
                pairs[book] = pair;
                if (pair.some(value => value !== null)) books.add(book);
            }
            return { ts: point.ts, pairs };
        }).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
        const order = Object.keys(names);
        return { points, books: [...books].sort((a, b) => (order.includes(a) ? order.indexOf(a) : 999) - (order.includes(b) ? order.indexOf(b) : 999) || a.localeCompare(b)) };
    }
    function fairSeries(points, selected, side) {
        const groups = new Set();
        const references = [...selected].sort().filter(book => {
            if (exchanges.has(book) || !points.some(point => pairedProbability(point.pairs[book], side) !== null)) return false;
            const group = book === 'hr' || book.startsWith('hr_') ? 'hr' : book === 'br' || book === 'kambi' ? 'br' : book;
            if (groups.has(group)) return false;
            groups.add(group); return true;
        });
        const values = points.map(point => {
            const ps = references.map(book => pairedProbability(point.pairs[book], side));
            return ps.length && ps.every(p => p !== null) ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
        });
        return { references, values };
    }
    async function request(query, controller, force) {
        const token = tokenOf();
        if (token !== cacheToken) { cache.clear(); cacheToken = token; }
        const base = typeof API_BASE === 'string' ? API_BASE : root.location.origin;
        const url = `${base}/api/line-movement?${query}`;
        const key = `${dayOf(Date.now())}:${url}`;
        const stored = cache.get(key);
        if (!force && stored && Date.now() - stored.at < 60000) return stored.data;
        const response = await root.fetch(url, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to view movement.' : response.status === 403 ? 'Movement requires a Sharp subscription.' : response.status === 404 ? 'No captures for this line today.' : 'Movement is temporarily unavailable. Try again.');
        const data = await response.json();
        if (tokenOf() !== token) throw new Error('Your session changed. Reopen Movement to continue.');
        if (!controller.signal.aborted) {
            cache.set(key, { at: Date.now(), data });
            while (cache.size > 48) cache.delete(cache.keys().next().value);
        }
        return data;
    }
    function ticks(low, high, count) {
        const values = Array.from({ length: count + 2 }, (_, index) => {
            const price = american((low + (high - low) * index / (count + 1)) / 100), amount = Math.abs(price);
            const step = amount < 200 ? 5 : amount < 500 ? 10 : amount < 1000 ? 25 : amount < 2500 ? 50 : 10 ** (Math.floor(Math.log10(amount)) - 1);
            return Math.sign(price) * Math.max(100, Math.round(amount / step) * step);
        });
        return [...new Set(values)].map(price => ({ p: probability(price) * 100, text: odds(price) })).filter(tick => tick.p >= low && tick.p <= high);
    }
    function mount(host, row) {
        let destroyed = false, controller, timer, chart, observer, generation = 0;
        let candidates = [], current, model, selectedBooks, side = row.under || Number(row.ouIdx) === 1 ? 1 : 0, scale = 'odds';
        const section = document.createElement('section');
        section.className = 'player-movement';
        section.setAttribute('aria-label', 'Daily player price movement');
        section.innerHTML = `<div class="pm-toolbar"><label>Line <select data-pm-line aria-label="Movement line"></select></label><label>Side <select data-pm-side aria-label="Movement side"><option value="0">Over</option><option value="1">Under</option></select></label><label>Scale <select data-pm-scale aria-label="Movement scale"><option value="odds">Odds</option><option value="probability">Implied %</option></select></label><button type="button" data-pm-refresh>Refresh</button></div>
            <p class="pm-status" role="status"></p><div class="pm-body" hidden>
            <div class="pm-metrics"><div><span>First fair</span><strong data-pm-first></strong><small data-pm-first-time></small></div><div><span>Latest fair</span><strong data-pm-last></strong><small data-pm-last-time></small></div><div><span>Fair move</span><strong data-pm-move></strong><small data-pm-direction></small></div></div>
            <div class="pm-plot"></div><p class="pm-reference"></p>
            <fieldset class="pm-picker"><legend>Books to track</legend><div class="pm-actions"><button type="button" data-pm-all>All</button><button type="button" data-pm-none>None</button></div><div class="pm-books"></div></fieldset>
            <p class="pm-footnote">Today's pregame captures, Eastern Time. Prices before fees. Fair value uses proportional devig of the selected sportsbooks' paired prices; exchanges are price-only. Shared book feeds count once. Gaps mean a reference price is missing.</p></div>`;
        host.append(section);
        const $ = selector => section.querySelector(selector);
        $('[data-pm-side]').value = String(side);
        function clearChart() { if (chart) { chart.remove(); if (chart.data && root.Plotly) root.Plotly.purge(chart); chart = null; } }
        function status(message) { $('.pm-status').textContent = message; $('.pm-status').hidden = !message; }
        function begin() {
            controller?.abort(); clearTimeout(timer); clearChart();
            controller = new AbortController(); const version = ++generation;
            timer = setTimeout(() => controller.abort(), 15000);
            $('.pm-body').hidden = true; status('Loading today\'s captured prices...');
            return { version, abort: controller };
        }
        function failed(error, version) {
            if (destroyed || version !== generation) return;
            controller?.abort();
            status(error.name === 'AbortError' ? 'Movement took too long to load. Try Refresh.' : error.message);
        }
        const params = extras => new URLSearchParams({ sport: sportOf(row), window: 'today', ...extras });
        async function loadCatalog(force = false) {
            const { version, abort } = begin();
            try {
                if (!sportOf(row) || row.blurred || !row.player || !row.prop) throw new Error('Movement is not available for this selection.');
                const start = row.start || (typeof RES !== 'undefined' ? RES?.times?.[row.game] : null);
                const all = [];
                for (let offset = 0; ; offset += 200) {
                    const data = await request(params({ query: row.player, props: row.prop, side, limit: 200, offset }), abort, force);
                    if (destroyed || version !== generation) return;
                    all.push(...(data.rows || []).filter(item => matches(row, item, start)));
                    if (!data.rows?.length || offset + 200 >= data.total) break;
                    if (offset >= 1800) throw new Error('Too many matching captures. Narrow the player selection.');
                }
                // Do not silently pick a different event if a feed lacks game metadata.
                if (new Set(all.map(item => `${item.event_id || item.game}:${item.start}`)).size > 1) throw new Error('Multiple games match this player. Open a play with its game selected.');
                candidates = all.sort((a, b) => Number(a.handicap) - Number(b.handicap));
                const line = /^[234]\+td$/.test(row.prop) ? Number(row.prop[0]) - .5 : row.handicap;
                current = candidates.find(item => finiteLine(line) && Number(item.handicap) === Number(line)) || (!finiteLine(line) ? candidates[0] : null);
                $('[data-pm-line]').replaceChildren(...candidates.map(item => new Option(item.handicap, item.id)));
                if (!current) {
                    const label = finiteLine(line) ? `${line} (no captures)` : 'No captures';
                    $('[data-pm-line]').prepend(new Option(label, ''));
                    $('[data-pm-line]').value = '';
                    status('No captured prices for this player, game and line today.');
                    return;
                }
                $('[data-pm-line]').value = current.id;
                clearTimeout(timer);
                await loadDetail(force);
            } catch (error) { failed(error, version); }
            finally { if (version === generation) clearTimeout(timer); }
        }
        async function loadDetail(force = false) {
            const { version, abort } = begin();
            const chosen = current;
            try {
                let details = await Promise.all([0, 1].map(value => request(params({ id: chosen.id, side: value }), abort, force)));
                if (details[0].updated !== details[1].updated) details = await Promise.all([0, 1].map(value => request(params({ id: chosen.id, side: value }), abort, true)));
                if (destroyed || version !== generation) return;
                if (details.some(data => data.selection?.id !== chosen.id || !Array.isArray(data.points))) throw new Error('No captures for this line today.');
                model = joinDetails(details[0], details[1], row);
                if (!model.books.length) throw new Error('No recorded prices for this line today.');
                current = { ...chosen, ...details[side].selection };
                selectedBooks = new Set(model.books.filter(book => bookChoices.get(book) !== false));
                $('.pm-books').replaceChildren();
                for (const book of model.books) {
                    const label = document.createElement('label');
                    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selectedBooks.has(book); input.dataset.pmBook = book;
                    const img = document.createElement('img'); img.src = `logos/${book === 'kambi' ? 'parx' : book.startsWith('hr_') ? 'hr' : book}.png`; img.alt = ''; img.width = img.height = 15; img.onerror = () => { img.hidden = true; };
                    const name = document.createElement('span'); name.textContent = bookName(book);
                    const price = document.createElement('strong'); price.dataset.pmPrice = book;
                    label.style.setProperty('--pm-book-color', palette[model.books.indexOf(book) % palette.length]);
                    label.append(input, img, name, price); $('.pm-books').append(label);
                    input.onchange = () => { bookChoices.set(book, input.checked); input.checked ? selectedBooks.add(book) : selectedBooks.delete(book); render(); };
                }
                $('.pm-body').hidden = false;
                render();
            } catch (error) { failed(error, version); }
            finally { if (version === generation) clearTimeout(timer); }
        }
        function render() {
            if (destroyed || !model || $('.pm-body').hidden) return;
            clearChart();
            const { points, books } = model;
            const fair = fairSeries(points, selectedBooks, side);
            const firstIndex = fair.values.findIndex(value => value !== null), first = fair.values[firstIndex], last = fair.values.at(-1);
            $('[data-pm-first]').textContent = firstIndex < 0 ? '-' : odds(american(first));
            $('[data-pm-last]').textContent = last === null ? '-' : odds(american(last));
            $('[data-pm-first-time]').textContent = firstIndex < 0 ? 'No paired quotes' : timeOf(points[firstIndex].ts);
            $('[data-pm-last-time]').textContent = timeOf(points.at(-1)?.ts);
            const change = firstIndex >= 0 && last !== null && firstIndex < points.length - 1 ? (last - first) * 100 : null;
            $('[data-pm-move]').textContent = change === null ? '-' : `${change > 0 ? '+' : ''}${change.toFixed(2)} pp`;
            $('[data-pm-direction]').textContent = change === null ? 'Awaiting paired captures' : Math.abs(change) < .005 ? 'Unchanged' : change > 0 ? 'Shorter odds' : 'Longer odds';
            $('.pm-reference').textContent = fair.references.length ? `Fair value: ${fair.references.map(bookName).join(', ')}. ${fair.references.length === 1 ? 'Single-book reference.' : 'Same books at every point.'}` : 'Select a sportsbook with paired prices to show fair value.';
            const messages = [];
            if (!selectedBooks.size) messages.push('Choose books below to plot prices.');
            else if (firstIndex < 0) messages.push('Fair value unavailable: selected books have no complete paired quotes at the same capture.');
            if (points.length === 1) messages.push('One capture so far; movement appears after the next capture.');
            if (Date.parse(current.start) <= Date.now()) messages.push('Game started; showing captured pregame prices.');
            else if (Date.now() - Date.parse(points.at(-1)?.ts) > 60 * 60000) messages.push('Last capture is over an hour old.');
            status(messages.join(' '));
            section.querySelectorAll('[data-pm-price]').forEach(node => {
                const value = points.at(-1)?.pairs[node.dataset.pmPrice]?.[side];
                node.textContent = odds(value); node.title = `Latest capture ${timeOf(points.at(-1)?.ts)}`;
            });
            const traces = books.filter(book => selectedBooks.has(book)).map(book => ({
                type: 'scatter', mode: 'lines+markers', name: bookName(book), meta: { book },
                x: points.map(point => Date.parse(point.ts)), y: points.map(point => { const p = probability(point.pairs[book]?.[side]); return p === null ? null : p * 100; }),
                customdata: points.map(point => [timeOf(point.ts), odds(point.pairs[book]?.[side])]),
                line: { shape: 'hv', width: 1.8, color: palette[books.indexOf(book) % palette.length], dash: books.indexOf(book) >= palette.length ? 'dot' : 'solid' }, marker: { size: 3 }, connectgaps: false,
                hovertemplate: '<b>%{fullData.name} %{customdata[1]}</b><br>%{customdata[0]}<extra></extra>'
            }));
            if (firstIndex >= 0) traces.push({ type: 'scatter', mode: 'lines+markers', name: 'Fair value', meta: { fair: true },
                x: points.map(point => Date.parse(point.ts)), y: fair.values.map(p => p === null ? null : p * 100),
                customdata: points.map((point, index) => [timeOf(point.ts), fair.values[index] === null ? '-' : odds(american(fair.values[index]))]),
                line: { color: '#ffffff', width: 3.5, shape: 'hv' }, marker: { size: 5 }, connectgaps: false,
                hovertemplate: '<b>Fair value %{customdata[1]}</b><br>%{customdata[0]}<br>Probability %{y:.2f}%<extra></extra>' });
            const values = traces.flatMap(trace => trace.y).filter(value => value !== null);
            if (!values.length) return;
            const min = Math.min(...values), max = Math.max(...values), padding = Math.max(.3, (max - min) * .13);
            const low = Math.max(.001, min - padding), high = Math.min(99.999, max + padding);
            const count = host.clientWidth < 500 ? 4 : 6, axisTicks = ticks(low, high, count);
            const indices = [...new Set(Array.from({ length: Math.min(count, points.length) }, (_, i) => Math.round(i * (points.length - 1) / Math.max(1, Math.min(count, points.length) - 1))))];
            chart = document.createElement('div'); chart.className = 'pm-chart'; chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Today's ${side ? 'under' : 'over'} ${current.handicap} prices and fair value`);
            $('.pm-plot').append(chart);
            const layout = { height: host.clientWidth < 500 ? 260 : 315, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#a9bfd4' },
                margin: { l: 58, r: 12, t: 12, b: 44 }, showlegend: false, hovermode: 'closest', dragmode: 'zoom',
                hoverlabel: { bgcolor: '#152638', font: { color: '#f1f6fb' } },
                xaxis: { type: 'linear', tickvals: indices.map(i => Date.parse(points[i].ts)), ticktext: indices.map(i => timeFormat.format(new Date(points[i].ts))), gridcolor: '#293d50', zeroline: false, ...(points.length === 1 ? { range: [Date.parse(points[0].ts) - 900000, Date.parse(points[0].ts) + 900000] } : {}) },
                yaxis: { fixedrange: true, range: scale === 'odds' ? [high, low] : [low, high], gridcolor: '#293d50', zeroline: false, ...(scale === 'odds' ? { tickvals: axisTicks.map(t => t.p), ticktext: axisTicks.map(t => t.text) } : { ticksuffix: '%', tickformat: '.1f' }) }
            };
            if (typeof root.renderLazyChart === 'function') root.renderLazyChart(chart, traces, layout, { responsive: true, displayModeBar: false, scrollZoom: false });
            else chart.textContent = 'The chart could not load. Refresh the page to try again.';
        }
        $('[data-pm-line]').onchange = event => { current = candidates.find(item => item.id === event.target.value); if (current) { event.target.querySelector('option[value=""]')?.remove(); loadDetail(); } };
        $('[data-pm-side]').onchange = event => { side = Number(event.target.value); render(); };
        $('[data-pm-scale]').onchange = event => { scale = event.target.value; render(); };
        $('[data-pm-refresh]').onclick = () => current ? loadDetail(true) : loadCatalog(true);
        for (const [selector, checked] of [['[data-pm-all]', true], ['[data-pm-none]', false]]) $(selector).onclick = () => {
            selectedBooks = new Set(checked ? model.books : []);
            section.querySelectorAll('[data-pm-book]').forEach(input => { input.checked = checked; bookChoices.set(input.dataset.pmBook, checked); }); render();
        };
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => { if (!destroyed && chart?.data && root.Plotly) root.Plotly.Plots.resize(chart); }); observer.observe(host);
        }
        loadCatalog();
        return { destroy() { destroyed = true; generation++; controller?.abort(); clearTimeout(timer); observer?.disconnect(); clearChart(); section.remove(); } };
    }
    const api = { mount, matches, joinDetails, fairSeries, pairedProbability, sportOf };
    root.PlayerMovement = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
