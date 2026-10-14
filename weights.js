
let DEV_WINDOW = "All";
let DEV_PRICE_SOURCE = 'closing';
let DEV_STAKING = 'flat';
const OPENING_PRESET_CACHE = new Map();

function presetFeed(page = PAGE, sport = SPORT) {
	const name = String(sport || '').toLowerCase();
	if (!/^(mlb|nhl|nfl|nba|wnba|ncaaf|ncaab|soccer|ufc)(?:_main)?$/.test(name)) return null;
	return /^(main|main_recap|preseason)$/.test(page) && !name.endsWith('_main') ? `${name}_main` : name;
}

// Opening presets are data only: loading them must never replace the live RECORD global.
function decodePresetRecords(packed) {
	const bad = () => { throw new Error('Invalid opening preset records'); };
	const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
	if (!object(packed) || packed.v !== 1 || !Array.isArray(packed.fields) || !Array.isArray(packed.windows) || !Array.isArray(packed.rows)) return bad();
	const metrics = new Set(['wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit', 'kelly', 'kelly_stake_units', 'roi', 'kelly_roi']);
	const periods = new Set(['All', 'SZN', 'L3', 'L7', 'L14', 'L30', 'L60']);
	for (const [schemas, allowed] of [[packed.fields, metrics], [packed.windows, periods]]) {
		if (!schemas.every(names => Array.isArray(names) && names.length && new Set(names).size === names.length && names.every(name => allowed.has(name)))) return bad();
	}
	const index = (value, list) => Number.isInteger(value) && value >= 0 && value < list.length;
	const row = id => {
		if (!index(id, packed.rows)) return bad();
		const values = packed.rows[id];
		if (!Array.isArray(values) || !index(values[0], packed.fields)) return bad();
		const names = packed.fields[values[0]];
		if (names.length !== values.length - 1 || values.slice(1).some(value => value !== null && !['number', 'string', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value))) return bad();
		return Object.fromEntries(names.map((name, i) => [name, values[i + 1]]));
	};
	// Check unused vectors too, so malformed data is never silently accepted.
	packed.rows.forEach((_, i) => row(i));
	const expand = (value, depth = 0) => {
		if (depth > 12) return bad();
		if (Array.isArray(value)) {
			if (!value.length) return bad();
			if (value[0] === null) return value.slice(1).map(item => expand(item, depth + 1));
			if (value.length === 1) return row(value[0]);
			const id = -1 - value[0];
			if (!Number.isInteger(value[0]) || !index(id, packed.windows) || packed.windows[id].length !== value.length - 1) return bad();
			return Object.fromEntries(packed.windows[id].map((name, i) => [name, row(value[i + 1])]));
		}
		if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) return bad();
			return [key, expand(item, depth + 1)];
		}));
		if (value !== null && !['number', 'string', 'boolean'].includes(typeof value)) return bad();
		return value;
	};
	const records = expand(packed.data);
	if (!object(records)) return bad();
	return records;
}

function validateOpeningPreset(payload, feed) {
	if (!payload || payload.schema_version !== 1 || payload.feed !== feed || payload.price_source !== 'opening'
		|| typeof payload.available !== 'boolean' || payload.kelly_metric !== 'units_per_100_settled'
		|| typeof payload.kelly_available !== 'boolean' || typeof payload.updated !== 'string' || !Number.isFinite(Date.parse(payload.updated))) {
		throw new Error('Invalid opening preset report');
	}
	if (payload.window !== null && (!payload.window || !/^\d{4}-\d{2}-\d{2}$/.test(payload.window.start)
		|| !/^\d{4}-\d{2}-\d{2}$/.test(payload.window.end) || payload.window.start > payload.window.end)) throw new Error('Invalid opening preset window');
	return { ...payload, records: decodePresetRecords(payload.records) };
}

function getPresetRecordSource() {
	if (DEV_PRICE_SOURCE === 'closing') return {
		status: 'ready', records: typeof RECORD === 'undefined' ? null : RECORD,
		updated: typeof RECORD_UPD === 'undefined' ? null : RECORD_UPD,
	};
	const feed = presetFeed();
	if (!feed) return { status: 'unavailable', records: null };
	const entry = OPENING_PRESET_CACHE.get(feed);
	if (!entry) return { status: 'idle', records: null };
	if (entry.status !== 'ready') return { status: entry.status, records: null };
	return { ...entry.report, updated: entry.report.source_updated || entry.report.updated,
		status: entry.report.available ? 'ready' : 'unavailable', records: entry.report.available ? entry.report.records : null };
}

function presetRecordStats(stats, staking = 'flat') {
	const number = value => value == null || typeof value === 'boolean' || String(value).trim() === '' ? null : Number(value);
	const kelly = number(stats?.kelly), kellyStakeUnits = number(stats?.kelly_stake_units);
	const isKelly = staking === 'quarter-kelly';
	// Legacy kelly_roi is profit per 100 bets. Only actual settled stakes can yield ROI.
	const roi = isKelly
		? Number.isFinite(kelly) && Number.isFinite(kellyStakeUnits) && kellyStakeUnits > 0 ? kelly / kellyStakeUnits * 100 : null
		: number(stats?.roi);
	const wins = number(stats?.wins ?? stats?.w), losses = number(stats?.losses ?? stats?.l);
	const pushes = number(stats?.pushes ?? 0);
	const hasRecord = Number.isFinite(roi) && Number.isFinite(wins) && Number.isFinite(losses) && wins >= 0 && losses >= 0
		&& (isKelly ? Number.isFinite(pushes) && pushes >= 0 && wins + losses + pushes > 0 : wins + losses > 0);
	return { hasRecord, roi: hasRecord ? roi : null, wins: hasRecord ? wins : null, losses: hasRecord ? losses : null,
		profit: hasRecord ? stats.profit : null, kelly: hasRecord ? kelly : null,
		kellyStakeUnits: hasRecord && Number.isFinite(kellyStakeUnits) ? kellyStakeUnits : null };
}

function presetMetricLabel(row) {
	if (!row.hasRecord) return row.staking === 'quarter-kelly'
		? `No ${row.recordWindow === 'All' ? '' : `${row.recordWindow} `}¼ Kelly data`
		: row.recordWindow === 'All' ? 'No record data' : `No ${row.recordWindow} data`;
	return `${row.roi > 0 ? '+' : ''}${row.roi.toLocaleString('en-US', { maximumFractionDigits: 2 })}% ROI`;
}

function presetProfitLabel(row) {
	if (!row.hasRecord || row.staking !== 'quarter-kelly' || !Number.isFinite(row.kelly)) return '';
	return `${row.kelly > 0 ? '+' : ''}${row.kelly.toLocaleString('en-US', { maximumFractionDigits: 2 })}u`;
}

function presetKellyTitle(row) {
	if (row.staking !== 'quarter-kelly') return '';
	if (!row.hasRecord) return 'Kelly ROI is unavailable without a positive total of settled stakes.';
	return `¼ Kelly: ${presetProfitLabel(row)} net profit on ${row.kellyStakeUnits.toLocaleString('en-US', { maximumFractionDigits: 2 })}u settled stake. Fixed 100u bankroll; no compounding.`;
}

function presetModeDescription() {
	const source = getPresetRecordSource();
	let description = '';
	if (DEV_PRICE_SOURCE === 'opening') {
		if (['idle', 'loading'].includes(source.status)) description = 'Loading opening presets…';
		else if (source.status === 'error') description = 'Opening presets could not load. Retry or select Closing.';
		else if (source.status === 'unavailable') description = 'No captured opening presets are available for this sport yet.';
		else if (source.window) description = `Opening history: ${source.window.start}–${source.window.end}. All-time covers this captured history only.`;
		else description = 'Opening presets use captured opening history only.';
		if (source.status === 'ready' && source.source_updated && Number.isFinite(Date.parse(source.source_updated))) description += ` Records updated ${source.source_updated.slice(0, 10)}.`;
		if (source.status === 'ready' && DEV_STAKING === 'quarter-kelly' && !source.kelly_available) description += ' ¼ Kelly results are unavailable for this opening history.';
	}
	if (DEV_STAKING === 'quarter-kelly') description += `${description ? ' ' : ''}¼ Kelly: ROI = net profit / settled stake; total profit shown in units. Fixed 100u bankroll (1u = 1%), no compounding. Live sizing is unchanged.`;
	return description;
}

function syncPresetModeControls() {
	document.querySelectorAll('[data-preset-mode]').forEach(select => {
		select.value = select.dataset.presetMode === 'prices' ? DEV_PRICE_SOURCE : DEV_STAKING;
	});
	const note = presetModeDescription();
	document.querySelectorAll('#dev-picker-row [data-preset-mode]').forEach(select => {
		select.title = [select.dataset.presetMode === 'prices' ? 'Preset prices' : 'Preset staking', note].filter(Boolean).join(' · ');
	});
	document.querySelectorAll('[data-preset-mode-note]').forEach(element => {
		element.textContent = note; element.hidden = !note;
	});
	document.querySelectorAll('[data-preset-retry]').forEach(button => {
		button.hidden = DEV_PRICE_SOURCE !== 'opening' || getPresetRecordSource().status !== 'error';
	});
}

function refreshPresetViews() {
	if (typeof initDevPicker === 'function') initDevPicker(getTopDevigs(BOOK || 'best'));
	const modal = document.getElementById('preloads-modal');
	const container = document.getElementById('preloads-list-container');
	if (modal?.style.display === 'flex' && container) renderPreloadsList(container, getTopDevigs(), ({ tds: 'attd', ftd: 'ftd', fgs: 'fgs' })[PAGE] || 'atgs');
	syncPresetModeControls();
}

function ensureOpeningPresets({ retry = false } = {}) {
	const feed = presetFeed();
	if (!feed) return Promise.resolve();
	const prior = OPENING_PRESET_CACHE.get(feed);
	if (prior && (prior.status !== 'error' || !retry)) return prior.promise || Promise.resolve(prior.report);
	const entry = { status: 'loading' };
	OPENING_PRESET_CACHE.set(feed, entry);
	entry.promise = (async () => {
		try {
			const response = await fetch(`presets/${feed}_opening.json`, { cache: 'no-cache' });
			if (!response.ok) throw new Error('Opening preset request failed');
			entry.report = validateOpeningPreset(await response.json(), feed);
			entry.status = 'ready';
		} catch (_) { entry.status = 'error'; }
		if (DEV_PRICE_SOURCE === 'opening' && presetFeed() === feed) refreshPresetViews();
	})();
	return entry.promise;
}

function setPresetMode(kind, value) {
	if (kind === 'prices' && ['closing', 'opening'].includes(value)) DEV_PRICE_SOURCE = value;
	else if (kind === 'staking' && ['flat', 'quarter-kelly'].includes(value)) DEV_STAKING = value;
	else return;
	if (DEV_PRICE_SOURCE === 'opening') ensureOpeningPresets();
	refreshPresetViews();
}

function appendPresetModeControls(container, prefix) {
	const controls = document.createElement('div');
	controls.className = 'dev-preset-modes';
	for (const [kind, label, choices] of [['prices', 'Prices', [['closing', 'Closing'], ['opening', 'Opening']]],
		['staking', 'Staking', [['flat', 'Flat 1u'], ['quarter-kelly', '¼ Kelly']]]]) {
		const wrapper = document.createElement('label');
		wrapper.htmlFor = `${prefix}-${kind}`;
		wrapper.className = 'dev-preset-control';
		const name = document.createElement('span'); name.textContent = label;
		const select = document.createElement('select');
		select.id = wrapper.htmlFor; select.dataset.presetMode = kind;
		select.className = 'dev-window-select';
		select.setAttribute('aria-describedby', `${prefix}-note`);
		for (const [value, text] of choices) {
			const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
		}
		select.addEventListener('change', () => setPresetMode(kind, select.value));
		wrapper.append(name, select); controls.appendChild(wrapper);
	}
	container.appendChild(controls);
	return controls;
}

function appendPresetModeNote(container, prefix) {
	const note = document.createElement('p');
	note.id = `${prefix}-note`; note.className = 'dev-preset-note'; note.dataset.presetModeNote = '';
	note.setAttribute('role', 'status'); note.hidden = true;
	const retry = document.createElement('button');
	retry.type = 'button'; retry.className = 'dev-preset-retry'; retry.dataset.presetRetry = ''; retry.textContent = 'Retry opening presets'; retry.hidden = true;
	retry.addEventListener('click', () => { ensureOpeningPresets({ retry: true }); refreshPresetViews(); });
	container.append(note, retry);
}

function presetProps(prop) {
	const available = [...document.querySelectorAll('#prop-options input[type="checkbox"]')].map(input => input.value);
	const match = /^(.*)team_total$/.exec(prop);
	const desired = match && !available.includes(prop) ? [`${match[1]}away_total`, `${match[1]}home_total`] : [prop];
	return available.length ? desired.filter(value => available.includes(value)) : desired;
}
const SESSION_WEIGHTS = {
	"tds-pn+circa": {
		pn: 0.4,
		circa: 0.6
	}
}
let TMP_WEIGHTS = {};
let RAW_WEIGHTS = {};
WEIGHTS = getDefaultWeights((DEVIG || "").split("+"));
let WEIGHT_LOADED = false;

function getDefaultWeights(books) {
	if (!books || books.includes("mkt") || books.includes("")) {
		books = ALL_WEIGHTABLE_BOOKS.filter(b => !["bv", "bol", "br", "re"].includes(b));
	}
	const defaultWeight = parseFloat((1 / books.length).toFixed(4));
	const weights = {};
	let remainder = 1;
	
	books.forEach(book => {
		weights[book] = 1;
	});
	return weights;
}

function getUserWeights() {
	let weights = {};
	const [selection, inlineWeights] = String(DEVIG || "").split(";");
	const books = selection.replace(/^only\+/, "");
	if (!books || books === "mkt") {
		weights = getDefaultWeights();
	} else {
		const selectedWeights = String(WEIGHT || inlineWeights || "").split("+");
		books.split("+").forEach((book, idx) => {
			weights[book] = parseFloat(selectedWeights[idx]);
		});
	}
	return Object.fromEntries(Object.entries(weights).filter(([book]) => !DEVIG_EXCLUDED.includes(book)));
}

function renderWeightSettings() {
	const inputsDiv = document.getElementById('book-weight-inputs');

	const devig = DEVIG || 'mkt';
	const currentDevigKey = `${PAGE}-${devig}`;
	const includedDevigs = devig.split("+");

	let marketWeights = getUserWeights();
	WEIGHTS = marketWeights;
	
	if (!inputsDiv) return;

	inputsDiv.innerHTML = '';

	renderWeightPieChart();
	
	ALL_WEIGHTABLE_BOOKS.forEach(book => {
		let bookImg = book == "best" ? "" : `<img class='book-img' style="width:32px;height:32px;" src='logos/${book}.png' alt='${book}' title='${book}' />`;
		const inputHtml = `
			<div class="weight-item" style="margin-bottom: 10px; color: #fff;">
				<div style="display:flex;gap:8px;align-items:end;">
					${bookImg}
					<div style="display:flex;flex-direction:column;">
						<span style="font-size:0.7rem;">${parseBook(book)}</span>
						<input 
							type="text" 
							inputmode="decimal"
							id="weight-${book}" 
							data-book="${book}" 
							value="${WEIGHTS[book] || ''}" 
						>
					</div>
				</div>
			</div>
		`;
		inputsDiv.insertAdjacentHTML('beforeend', inputHtml);
	});

	inputsDiv.querySelectorAll('.weight-item input').forEach(input => {
		input.addEventListener("input", debouncedWeightTotal);
	});
}

function fillRemaining(book) {

	const inputsDiv = document.getElementById('book-weight-inputs');

	let total = 0;
	inputsDiv.querySelectorAll('input[type="range"]').forEach(input => {
		const weight = parseFloat(input.value) || 0;
		if (input.dataset.book != book) {
			total += weight;
		}
	});

	const newWeight = 100 - total;
	document.getElementById(`display-${book}`).textContent = `${newWeight}%`;
	document.getElementById(`weight-${book}`).value = newWeight;
	updateWeightTotal();
}

function getLiveWeights() {
	const inputsDiv = document.getElementById('book-weight-inputs');
	const liveWeights = {};

	inputsDiv.querySelectorAll('.weight-item input').forEach(input => {
		const weight = parseFloat(input.value) || 0;
		liveWeights[input.dataset.book] = weight;
	});

	return liveWeights;
}

function updateWeightTotal() {
	let total = 0;
	let weights = {};
	let inputs = document.querySelectorAll('.weight-item input');
	inputs.forEach(input => {
		let weight = parseFloat(input.value || 0);
		weights[input.dataset.book] = weight;
		RAW_WEIGHTS[input.dataset.book] = weight;
		total += weight;
	});

	for (book in weights) {
		if (!total) {
			weights[book] = 1;
		} else {
			weights[book] = weights[book] / total;
		}
	}
	WEIGHTS = weights;

	renderWeightPieChart();
}

const debouncedWeightTotal = debounce(updateWeightTotal, 400);

function renderWeightPieChart() {
	const labels = [];
	const values = [];

	Object.entries(WEIGHTS).forEach(([book, weight]) => {
		if (weight > 0) {
			labels.push(book.toUpperCase());
			values.push(weight);
		}
	});

	const data = [{
		title: {
			font: { color: '#000' }
		},
		values: values,
		labels: labels,
		type: 'pie',
		marker: {
			// Optional: Define custom colors if you want consistency (e.g., 'pn' is always blue)
			// colors: ['#4285F4', '#DB4437', '#F4B400', '#0F9D58', '#4287f5'] 
		},
		// Display percentage inside the slice
		hovertemplate: "%{label}: %{value}%<extra></extra>",
		textinfo: "percent+label", 
		insidetextorientation: "radial",
	}];

	const layout = {
		height: 300,
		width: 300,
		margin: { t: 0, b: 0, l: 0, r: 0 },
		showlegend: false,
		paper_bgcolor: 'rgba(0,0,0,0)',
		plot_bgcolor: 'rgba(0,0,0,0)',
		font: {
			color: "#fff"
		}
	};

	if (typeof renderLazyChart === 'function') return renderLazyChart('weight-pie-chart', data, layout, {displayModeBar: false});
	Plotly.newPlot('weight-pie-chart', data, layout, {displayModeBar: false});
}

function openWeights() {
	const weightDiv = document.getElementById("weight-overlay");
	weightDiv.style.display = "flex";
	if (!WEIGHT_LOADED) {
		renderWeightSettings();
	}
	WEIGHT_LOADED = true;
}

function getWeightKey() {
	let raw = [], percs = [], books = [];
	let rawSet = new Set();
	let totalWeight = 0;
	let sortedData = [];

	Object.entries(RAW_WEIGHTS).forEach(([book, weight]) => {
        // Ensure weight is a number and is not zero/falsy after conversion
        const numWeight = parseFloat(weight); 
        if (!numWeight) return; 
        
        sortedData.push({ book: book, weight: numWeight });
        totalWeight += numWeight;
    });

    sortedData.sort((a, b) => b.weight - a.weight);

	for (const item of sortedData) {
        books.push(item.book);
        raw.push(item.weight);
        rawSet.add(item.weight);
        
        // Calculate and round the percentage
        percs.push(Math.round(item.weight * 100 / totalWeight));
    }

	let weightKey = raw.join("+");
	let bookKey = books.join("+");
	let text = `${books.map(book => book.toUpperCase()).join("/")}`;
	if (raw.length > 1 && rawSet.size == 1) {
		text += ` ${Math.round(100 / books.length)}% Equal`;
	} else {
		text += ` ${percs.map(p => p+"%").join("/")}`;
	}
	return `${bookKey};${weightKey};${text}`;
}

function getPercentWeights() {
	const weights = getUserWeights();

	let totalWeight = 0;
	let percents = {};
	Object.entries(weights).forEach(([book, weight]) => {
        // Ensure weight is a number and is not zero/falsy after conversion
        const numWeight = parseFloat(weight); 
        if (!numWeight) return; 
        
        percents[book] = numWeight;
        totalWeight += numWeight;
    });

    for (book in percents) {
    	percents[book] = Math.round(percents[book] * 100 / totalWeight);
    }
    return percents;
}

async function saveWeights() {
	const metadata = CURR_USER?.metadata || {};
	if (!metadata["weights"]) {
		metadata["weights"] = [];
	} else {
		metadata["weights"] = removeOnlyWeights(metadata["weights"]);
	}

	let key = getWeightKey();
	let [bookKey, weightKey, weightText] = key.split(";");

	if (!weightText) return;
	DEVIG = bookKey;
	DEVIG_EXCLUDED = [];
	WEIGHT = weightKey;
	REQUIRED = bookKey.replace("only+", "").split("+");
	if (typeof updateRequiredDropdown === 'function') updateRequiredDropdown();
	metadata["weights"].push(`${DEVIG};${WEIGHT}`);

	const devigSel = document.getElementById("devig-select");
	const customOption = document.getElementById("custom-devig-option");
	const fragment = document.createDocumentFragment();
	const option = document.createElement("option");
	option.value = `${DEVIG};${WEIGHT}`;
	option.textContent = weightText;
	fragment.appendChild(option);
	devigSel.insertBefore(fragment, customOption);

	if (CURR_USER) {
		const { error: updateError } = await SB.from('profiles')
			.update({metadata: metadata})
			.eq('id', CURR_SESSION.user.id);
	} else {
		WEIGHTS = metadata["weights"];
	}

	updateHeaders();
	document.getElementById('custom-devig-modal').remove();
	if (document.getElementById("devig-display-text")) {
		document.getElementById("devig-display-text").innerText = parseWeightKey(`${DEVIG};${WEIGHT}`);
	}
	changeFilter();
}

function clearWeights() {
	Array.from(document.querySelectorAll(".weight-item input")).forEach(input => {
		input.value = "";
	});
	updateWeightTotal();
}

function equalWeights() {
	Array.from(document.querySelectorAll(".weight-item input")).forEach(input => {
		input.value = "1";
	});
	updateWeightTotal();
}

function closeWeights() {
	document.getElementById("weight-overlay").style.display = "none";
}

// Start preload logic
function getTopDevigs(bookArg = null) {
	const list = [];
	const source = getPresetRecordSource();
	if (!source.records) return list;
	const selectedBooks = bookArg ? String(bookArg).split(",") : [];
	const books = source.records[METHOD || "worst"];
	if (!books) return list;
	for (const book in books) {
		if (selectedBooks.length && !selectedBooks.includes(book)) continue;
		const devigs = books[book];
		if (!devigs) continue;
		for (const devigKey in devigs) {
			const stats = devigs[devigKey]?.[DEV_WINDOW];
			const resolved = presetRecordStats(DEV_PRICE_SOURCE === 'opening' && DEV_STAKING === 'quarter-kelly' && !source.kelly_available ? null : stats, DEV_STAKING);
			const parts = devigKey.split("-vs-");
			const prop = parts[0] || devigKey;
			const [reference, embeddedWeights] = (parts[1] || devigKey).split(';');
			const weights = embeddedWeights?.split('+').map(Number);
			// Presets apply equal weights. Do not mislabel an unequal historical blend.
			if (weights && (weights.length !== reference.split('+').length || weights.some(weight => !Number.isFinite(weight) || weight <= 0 || weight !== weights[0]))) continue;
			
			if (PAGE == "atgs" && prop !== "atgs") continue;
			if (PAGE == "nhl" && ["2+goals", "3+goals", "no_goal"].includes(prop)) continue;
			if (PAGE == "fgs" && !["fgs", "lgs"].includes(prop)) continue;
			if (PAGE == "ftd" && !["ftd", "ltd"].includes(prop)) continue;
			if (PAGE == "tds" && prop !== "attd") continue;

			list.push({
				method: METHOD || "",
				book,
				devig: parts.length > 1 ? `${prop}-vs-${reference}` : reference,
				prop,
				recordWindow: DEV_WINDOW,
				priceSource: DEV_PRICE_SOURCE,
				staking: DEV_STAKING,
				...resolved,
			});
		}
	}
	list.sort((a,b) => Number(b.hasRecord) - Number(a.hasRecord) || (a.hasRecord ? b.roi - a.roi : 0));
	return list;
}

// wire up the Preloads button -> open separate Preloads window/modal
// `prop` parameter lets caller show preloads for any prop in RECORD (defaults to "atgs")
function openPreloadsWindow(limit = 0) {
	const devigModal = document.getElementById("devig-modal");
	const preloadsModal = document.getElementById("preloads-modal");
	const container = document.getElementById("preloads-list-container");
	if (!preloadsModal || !container) return;

	// hide the main devig modal and show preloads window
	if (devigModal) devigModal.style.display = "none";
	preloadsModal.style.display = "flex";

	const top = getTopDevigs();
	if (top && top.error) {
		container.innerHTML = `<div style="padding:1rem;color:#900">${top.error}</div>`;
		return;
	}
	renderPreloadsList(container, top || [], ({ tds: "attd", ftd: "ftd", fgs: "fgs" })[PAGE] || "atgs");
}

// close preloads and return to devig modal
function closePreloadsWindow() {
	const devigModal = document.getElementById("devig-modal");
	const preloadsModal = document.getElementById("preloads-modal");
	const container = document.getElementById("preloads-list-container");
	if (preloadsModal) preloadsModal.style.display = "none";
	if (devigModal) devigModal.style.display = "flex";
	if (container) container.innerHTML = "";
}

function filterDevPickerByProps(selectedProps) {
	const picker = document.getElementById('dev-picker');
	if (!picker) return;
	const allProps = document.querySelectorAll('#prop-options input');
	const totalProps = allProps.length;
	const showAll = !selectedProps || selectedProps.length === 0 || selectedProps.length === totalProps;

	picker.querySelectorAll('.dev-chip-wrap').forEach(wrap => {
		const prop = wrap.dataset.prop;
		const matches = presetProps(prop).some(value => selectedProps?.includes(value));
		wrap.style.display = (showAll || matches) ? '' : 'none';
	});
}

let preloadSelection = null;
function renderPreloadsList(container, items, prop = "atgs") {
	if (container.querySelector('#min-bets')) preloadSelection = {
		minimum: container.querySelector('#min-bets').value,
		book: container.querySelector('#preload-book-select').value,
		prop: container.querySelector('#preload-prop-select').value,
	};
	container.innerHTML = "";
	appendPresetModeControls(container, 'preload-preset');
	appendPresetModeNote(container, 'preload-preset');
	syncPresetModeControls();
	if (!items || items.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'dev-picker-empty';
		empty.textContent = DEV_PRICE_SOURCE === 'opening' && getPresetRecordSource().status !== 'ready'
			? ['idle', 'loading'].includes(getPresetRecordSource().status) ? 'Loading opening presets…' : 'Opening presets unavailable.'
			: `No ${prop.toUpperCase()} presets match this source.`;
		container.appendChild(empty);
		return;
	}

	const header = document.createElement("div");
	header.style.display = "flex";
	header.style.alignItems = "center";
	header.style.gap = "1rem";
	header.style.flexWrap = 'wrap';

	// build unique prop and book lists from items
	const uniqueProps = [...new Set(items.map(it => it.prop || "").filter(Boolean))].sort();
	const uniqueBooks = [...new Set(items.map(it => it.book || "").filter(Boolean))].sort();

	// book select
	const bookWrapper = document.createElement("div");
	bookWrapper.className = "select-wrapper";
	bookWrapper.innerHTML = `<label for="preload-book-select" class="select-label" style="font-size:.85rem">Book</label>`;
	const bookSelect = document.createElement("select");
	bookSelect.id = "preload-book-select";
	const allBookOpt = document.createElement("option"); allBookOpt.value = "all"; allBookOpt.text = "All"; bookSelect.appendChild(allBookOpt);
	uniqueBooks.forEach(b => {
		const opt = document.createElement("option"); opt.value = b; opt.text = (b || "").toUpperCase(); bookSelect.appendChild(opt);
	});
	bookWrapper.appendChild(bookSelect);
	header.appendChild(bookWrapper);

	bookSelect.value = uniqueBooks.includes(BOOK) ? BOOK : "all";
	if (preloadSelection && ['all', ...uniqueBooks].includes(preloadSelection.book)) bookSelect.value = preloadSelection.book;

	// prop select
	const propWrapper = document.createElement("div");
	propWrapper.className = "select-wrapper";
	propWrapper.innerHTML = `<label for="preload-prop-select" class="select-label" style="font-size:.85rem">Prop</label>`;
	const propSelect = document.createElement("select");
	propSelect.id = "preload-prop-select";
	const allPropOpt = document.createElement("option"); allPropOpt.value = "all"; allPropOpt.text = "All"; propSelect.appendChild(allPropOpt);
	uniqueProps.forEach(p => {
		const opt = document.createElement("option"); opt.value = p; opt.text = p.toUpperCase(); propSelect.appendChild(opt);
	});
	propWrapper.appendChild(propSelect);
	header.appendChild(propWrapper);
	if (preloadSelection && ['all', ...uniqueProps].includes(preloadSelection.prop)) propSelect.value = preloadSelection.prop;

	// min-bets select
	const minWrapper = document.createElement("div");
	minWrapper.className = "select-wrapper";
	minWrapper.innerHTML = `<label for="min-bets" class="select-label" style="font-size:.85rem">Min</label>`;
	const minSelect = document.createElement("select");
	minSelect.id = "min-bets";
	[0,1,10,20,50,100,200].forEach(v => {
		const opt = document.createElement("option");
		opt.value = v;
		opt.text = v === 0 ? "All" : v;
		if (v === 20) opt.selected = true;
		minSelect.appendChild(opt);
	});
	minWrapper.appendChild(minSelect);
	header.appendChild(minWrapper);
	if (preloadSelection) minSelect.value = preloadSelection.minimum;

	container.appendChild(header);

	const list = document.createElement("div");
	list.style.maxHeight = "420px";
	list.style.overflowY = "auto";
	list.style.padding = "0.25rem 0.5rem";
	container.appendChild(list);

	// builder that respects min-bets filter (wins + losses) and prop/book filters
	function buildList(minBets, selProp = "all", selBook = "all") {
		list.innerHTML = "";
		const filtered = items.filter(it => {
			const wins = Number(it.wins || 0);
			const losses = Number(it.losses || 0);
			if ((wins + losses) < (Number(minBets) || 0)) return false;
			if (selProp && selProp !== "all" && (it.prop || "") !== selProp) return false;
			if (selBook && selBook !== "all" && (it.book || "") !== selBook) return false;
			return true;
		});
		if (filtered.length === 0) {
			list.innerHTML = `<div style="padding:1rem">No devigs match filters (min-bets ≥ ${minBets}, prop: ${selProp}, book: ${selBook}).</div>`;
			return;
		}

		filtered.sort((a,b) => Number(b.hasRecord) - Number(a.hasRecord) || (a.hasRecord ? b.roi - a.roi : 0)).forEach((it, idx) => {
			const row = document.createElement("div");
			row.classList.add("preload-row");
			row.style.display = "flex";
			row.style.justifyContent = "space-between";
			row.style.alignItems = "center";
			row.style.padding = "0.4rem";
			row.style.borderBottom = "1px solid rgba(0,0,0,0.06)";

			let [p,d] = (it.devig || "").split("-vs-");
			const bookLabel = it.book ? it.book.toUpperCase() : "";
			const profitLabel = presetProfitLabel(it);
			const recordMarkup = it.hasRecord
				? `<div style="font-weight:600">${escapeHtml(presetMetricLabel(it))}${profitLabel ? ` <span class="dev-profit" title="${escapeHtml(presetKellyTitle(it))}">${escapeHtml(profitLabel)}</span>` : ''}</div><div style="font-size:.8rem;color:#666">${it.wins}W - ${it.losses}L</div>`
				: `<div style="font-size:.85rem;color:#666">${escapeHtml(presetMetricLabel(it))}</div>`;

			row.innerHTML = `
				<div style="min-width:260px">
					<div style="gap: 5px;display:flex;align-items:center">${bookLabel}${typeof getBookImgs === 'function' ? getBookImgs([it.book]) : ''}</div>
					<div style="display:flex;align-items:center;font-size:.85rem;color:#666;gap:5px;">${(it.prop||p||'').toUpperCase()} vs ${d ? d.toUpperCase() : it.devig} ${typeof getBookImgs === 'function' ? getBookImgs(d ? d.split("+") : []) : ''}</div>
				</div>
				<div class="preload-right" style="display:flex;gap:.5rem;align-items:center">
					<div class="preload-record">
						${recordMarkup}
					</div>
					<button class="btn-secondary preload-add-btn" data-idx="${idx}">Apply</button>
				</div>
			`;
			row.dataset.method = it.method || METHOD;
			row.dataset.book = it.book;
			row.dataset.devig = (d || it.devig);
			row.dataset.prop = it.prop || p;
			list.appendChild(row);
		});

		// attach handlers for add buttons
		list.querySelectorAll(".preload-add-btn").forEach(btn => {
			btn.addEventListener("click", (e) => {
				const row = e.target.closest(".preload-row");
				const devig = row?.dataset?.devig;
				const method = row?.dataset?.method;
				const book = row?.dataset?.book;
				const prop = row?.dataset?.prop;
				if (!devig) return;

				DEVIG = devig;
				DEVIG_EXCLUDED = [];
				WEIGHT = repeatOnes(devig).slice(1);
				REQUIRED = devig.replace("only+", "").split("+");
				setBookSelection(book === "best" ? "" : book);
				const props = presetProps(prop);
				if (props.length) { setOptions('prop-options', props); updatePropLabel(props); }
				if (typeof updateRequiredDropdown === 'function') updateRequiredDropdown();

				const preloadsModal = document.getElementById("preloads-modal");
				const devigModal = document.getElementById("devig-modal");
				if (preloadsModal) preloadsModal.style.display = "none";
				if (devigModal) devigModal.style.display = "none";

				const devigDisplay = document.getElementById("devig-display-text");
				if (devigDisplay) devigDisplay.innerText = parseWeightKey(`${devig}${repeatOnes(devig)}`);

				if (typeof changeFilter === 'function') {
					changeFilter();
				}
			});
		});
	}

	// initial render using default select values
	const initialMin = Number(minSelect.value || 20);
	buildList(initialMin, propSelect.value || "all", bookSelect.value || "all");

	// update when controls change
	[minSelect, propSelect, bookSelect].forEach(el => {
		el.addEventListener("change", () => {
			buildList(Number(minSelect.value || 20), propSelect.value || "all", bookSelect.value || "all");
		});
	});
}
function addPreloadToDevigOptions({method, book, devig}) {
	// set method select so user can see which method will be applied
	const methodSelect = document.getElementById("method-select");
	if (methodSelect) {
		methodSelect.value = method || "";
	}
	// create a simple devig entry in the devig-options-container
	const container = document.getElementById("devig-options-container");
	if (!container) return;
	const id = `preload-${method}-${book}-${devig}`.replace(/[^\w-]/g,"_");
	// avoid duplicates
	if (document.getElementById(id)) {
		flashMsg("Devig already added");
		return;
	}
	const row = document.createElement("div");
	row.id = id;
	row.style.display = "flex";
	row.style.justifyContent = "space-between";
	row.style.alignItems = "center";
	row.style.padding = "0.4rem";
	row.style.border = "1px solid rgba(0,0,0,0.06)";
	row.style.margin = "0.3rem 0";
	row.innerHTML = `
		<div style="display:flex;align-items:center;gap:.5rem">
			<input type="checkbox" id="${id}-cb" checked>
			<label for="${id}-cb" style="margin-left:.2rem">${devig} <small style="color:#666">(${method} • ${book})</small></label>
			<label style="font-size:.85rem;color:#666;margin-left:0.75rem">min-bets</label>
		</div>
		<div style="display:flex;gap:.5rem">
			<button class="btn-secondary" data-remove="${id}">Remove</button>
		</div>
	`;
	container.prepend(row);
	// remove handler
	row.querySelector("button[data-remove]").addEventListener("click", (e) => {
		row.remove();
	});
}


if (document.getElementById("load-predefined-devigs")) {
	document.getElementById("load-predefined-devigs").addEventListener("click", (e) => {
		openPreloadsWindow();
	});
	document.getElementById("close-preloads-modal").addEventListener("click", closePreloadsWindow);
	document.getElementById("preloads-close").addEventListener("click", closePreloadsWindow);
}
