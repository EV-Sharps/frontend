let _summaryRecord = null;
let _summaryMethod = 'probit';
let _summaryWindow = 'All';
let _summarySport = 'mlb';
let _summaryDisplay = 'roi';
let _summaryBetting = 'flat';
let _summarySeasonFn = null;

function initRecordSummary() {
	if (document.getElementById('record-summary-modal')) return;
	const modal = document.createElement('div');
	modal.id = 'record-summary-modal';
	modal.onclick = function(e) { if (e.target === this) this.classList.remove('open'); };
	const btnStyle = 'background:#172027;border:1px solid rgba(59,130,246,0.35);color:var(--text-main);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;';
	modal.innerHTML = `
		<div id="record-summary-inner">
			<h3>
				<span>Record Summary</span>
				<span style="display:flex;align-items:center;gap:8px;">
					<span id="record-summary-toggle" style="display:flex;gap:4px;">
						<button data-method="probit" onclick="_summaryMethod='probit';_renderSummaryTable()" style="${btnStyle}">Probit</button>
						<button data-method="worst" onclick="_summaryMethod='worst';_renderSummaryTable()" style="${btnStyle}">Worst</button>
					</span>
					<button onclick="document.getElementById('record-summary-modal').classList.remove('open')" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1;">&times;</button>
				</span>
			</h3>
			<div id="record-sport-toggle" style="display:none;gap:4px;margin-bottom:6px;">
				<button data-sport="mlb"      onclick="_summarySport='mlb';      if(typeof _summarySeasonFn==='function'){var r=_summarySeasonFn();if(r)renderRecordSummary(r);}" style="${btnStyle}">MLB</button>
				<button data-sport="mlb_open" onclick="_summarySport='mlb_open'; if(typeof _summarySeasonFn==='function'){var r=_summarySeasonFn();if(r)renderRecordSummary(r);}" style="${btnStyle}">MLB Open</button>
			</div>
			<div id="record-window-toggle" style="display:flex;gap:4px;margin-bottom:6px;">
				<button data-window="All"  onclick="_summaryWindow='All'; _renderSummaryTable()" style="${btnStyle}">All</button>
				<button data-window="L3"   onclick="_summaryWindow='L3';  _renderSummaryTable()" style="${btnStyle}">L3</button>
				<button data-window="L7"   onclick="_summaryWindow='L7';  _renderSummaryTable()" style="${btnStyle}">L7</button>
				<button data-window="L14"  onclick="_summaryWindow='L14'; _renderSummaryTable()" style="${btnStyle}">L14</button>
				<button data-window="L30"  onclick="_summaryWindow='L30'; _renderSummaryTable()" style="${btnStyle}">L30</button>
				<button data-window="L60"  onclick="_summaryWindow='L60'; _renderSummaryTable()" style="${btnStyle}">L60</button>
			</div>
			<div style="display:flex;gap:12px;margin-bottom:8px;">
				<div id="record-display-toggle" style="display:flex;gap:4px;">
					<button data-display="roi"   onclick="_summaryDisplay='roi';   _renderSummaryTable()" style="${btnStyle}">ROI</button>
					<button data-display="units" onclick="_summaryDisplay='units'; _renderSummaryTable()" style="${btnStyle}">Units</button>
				</div>
				<div id="record-betting-toggle" style="display:flex;gap:4px;">
					<button data-betting="flat"  onclick="_summaryBetting='flat';  _renderSummaryTable()" style="${btnStyle}">Flat</button>
					<button data-betting="kelly" onclick="_summaryBetting='kelly'; _renderSummaryTable()" style="${btnStyle}">Kelly</button>
				</div>
			</div>
			<table id="record-summary-table"></table>
		</div>
	`;
	document.body.appendChild(modal);
}

function renderRecordSummary(record) {
	_summaryRecord = record;
	_renderSummaryTable();
}

function _renderSummaryTable() {
	const record = _summaryRecord;
	if (!record) return;
	const win = _summaryWindow || 'All';
	const m = _summaryMethod;
	const table = document.getElementById('record-summary-table');
	const toggle = document.getElementById('record-summary-toggle');
	if (toggle) toggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.method === m ? '1' : '0.4';
	});
	const winToggle = document.getElementById('record-window-toggle');
	if (winToggle) winToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.window === win ? '1' : '0.4';
	});
	const sportToggle = document.getElementById('record-sport-toggle');
	if (sportToggle) sportToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.sport === _summarySport ? '1' : '0.4';
	});
	const bookSet = new Set();
	const devigSet = new Set();
	const methodBooks = record[m] || {};
	Object.keys(methodBooks).forEach(b => {
		if (b !== 'best') bookSet.add(b);
		Object.keys(methodBooks[b] || {}).forEach(d => devigSet.add(d));
	});
	const books = ['best', ...bookSet];
	const devigs = [...devigSet].sort();
	const displayToggle = document.getElementById('record-display-toggle');
	if (displayToggle) displayToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.display === _summaryDisplay ? '1' : '0.4';
	});
	const bettingToggle = document.getElementById('record-betting-toggle');
	if (bettingToggle) bettingToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.betting === _summaryBetting ? '1' : '0.4';
	});
	const roiCell = (book, devig) => {
		const stats = record[m]?.[book]?.[devig];
		const s = stats ? (stats[win] ?? null) : null;
		if (!s) return `<td>—</td>`;
		const w = s.wins ?? 0, l = s.losses ?? 0;
		if (w+l == 0) return `<td>—</td>`;
		let val, suffix, isRoi;
		if (_summaryDisplay === 'roi') {
			val = _summaryBetting === 'kelly' ? (s.kelly_roi ?? null) : (s.roi ?? null);
			suffix = '%';
			isRoi = true;
		} else {
			val = _summaryBetting === 'kelly' ? (s.kelly ?? null) : (s.profit ?? null);
			suffix = 'u';
			isRoi = false;
		}
		if (val === null || val === undefined) return `<td>—</td>`;
		const cls = val > 0 ? 'roi-pos' : val < 0 ? 'roi-neg' : '';
		const sign = val > 0 ? '+' : '';
		const disp = isRoi ? `${sign}${val}${suffix}` : `${sign}${val.toFixed(2)}${suffix}`;
		return `<td class="${cls}"><div>${disp}</div><div style="font-size:9px;opacity:0.6;">${w}W-${l}L</div></td>`;
	};
	const fmtDevig = d => d.replace(/^[^-]+-vs-/, '');
	let html = '<thead><tr><th class="devig-name">Book ↓ &nbsp; Devig →</th>';
	devigs.forEach(d => { html += `<th>${fmtDevig(d)}</th>`; });
	html += '</tr></thead><tbody>';
	books.forEach(b => {
		html += `<tr><td class="devig-name">${b.toUpperCase()}</td>`;
		devigs.forEach(d => { html += roiCell(b, d); });
		html += '</tr>';
	});
	html += '</tbody>';
	table.innerHTML = html;
}

// Filter sourceRecord to only keys starting with propPrefix+'-'
function buildSeasonRecord(propPrefix, sourceRecord) {
	if (!sourceRecord) return null;
	const filtered = {};
	Object.keys(sourceRecord).forEach(method => {
		filtered[method] = {};
		Object.keys(sourceRecord[method] || {}).forEach(book => {
			const keys = Object.keys(sourceRecord[method][book] || {}).filter(k => k.startsWith(propPrefix + '-'));
			if (!keys.length) return;
			filtered[method][book] = {};
			keys.forEach(k => { filtered[method][book][k] = sourceRecord[method][book][k]; });
		});
	});
	return filtered;
}

// Add Yest/Season buttons to the dev-picker-col, under dev-record-upd.
// containerEl: optional explicit container (used when dev-record-upd has been cleared)
// showSportToggle: show the MLB/MLB_Open sport switcher in the modal when Season is opened
function addRecordSummaryButtons(yesterdayRecord, seasonFn, { showSportToggle = false, containerEl = null } = {}) {
	initRecordSummary();
	const col = containerEl || document.getElementById('dev-record-upd')?.parentElement || document.querySelector('.dev-picker-col');
	if (!col) return;
	col.querySelectorAll('.record-summary-btn').forEach(b => b.remove());

	if (yesterdayRecord) {
		const btn = document.createElement('button');
		btn.className = 'record-summary-btn';
		btn.textContent = 'Yest';
		btn.onclick = () => {
			document.getElementById('record-sport-toggle').style.display = 'none';
			renderRecordSummary(yesterdayRecord);
			document.getElementById('record-summary-modal').classList.add('open');
		};
		col.appendChild(btn);
	}

	if (seasonFn) {
		const btnSeason = document.createElement('button');
		btnSeason.className = 'record-summary-btn';
		btnSeason.textContent = 'Season';
		btnSeason.onclick = () => {
			_summarySeasonFn = seasonFn;
			const rec = seasonFn();
			if (!rec) return;
			document.getElementById('record-sport-toggle').style.display = showSportToggle ? 'flex' : 'none';
			renderRecordSummary(rec);
			document.getElementById('record-summary-modal').classList.add('open');
		};
		col.appendChild(btnSeason);
	}
}
