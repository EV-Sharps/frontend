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
					<button id="record-summary-export-btn" onclick="exportSummaryImage()" style="${btnStyle}">Copy Image</button>
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
	const displayToggle = document.getElementById('record-display-toggle');
	if (displayToggle) displayToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.display === _summaryDisplay ? '1' : '0.4';
	});
	const bettingToggle = document.getElementById('record-betting-toggle');
	if (bettingToggle) bettingToggle.querySelectorAll('button').forEach(b => {
		b.style.opacity = b.dataset.betting === _summaryBetting ? '1' : '0.4';
	});
	const grid = _summaryComputeGrid();
	const { books, devigs } = grid;
	const fmtDevig = d => d.replace(/^[^-]+-vs-/, '');
	let html = '<thead><tr><th class="devig-name">Book ↓ &nbsp; Devig →</th>';
	devigs.forEach(d => { html += `<th>${fmtDevig(d)}</th>`; });
	html += '</tr></thead><tbody>';
	books.forEach(b => {
		html += `<tr><td class="devig-name">${b.toUpperCase()}</td>`;
		devigs.forEach(d => {
			const c = _summaryCell(grid, b, d);
			if (!c) { html += '<td>—</td>'; return; }
			const cls = c.pos ? 'roi-pos' : c.neg ? 'roi-neg' : '';
			html += `<td class="${cls}"><div>${c.disp}</div><div style="font-size:9px;opacity:0.6;">${c.w}W-${c.l}L</div></td>`;
		});
		html += '</tr>';
	});
	html += '</tbody>';
	table.innerHTML = html;
}

// Books/devigs present for the current record + method, and a cell-value lookup.
function _summaryComputeGrid() {
	const record = _summaryRecord;
	const win = _summaryWindow || 'All';
	const m = _summaryMethod;
	const bookSet = new Set();
	const devigSet = new Set();
	const methodBooks = record[m] || {};
	Object.keys(methodBooks).forEach(b => {
		if (b !== 'best') bookSet.add(b);
		Object.keys(methodBooks[b] || {}).forEach(d => devigSet.add(d));
	});
	return { record, win, m, books: ['best', ...bookSet], devigs: [...devigSet].sort() };
}

// Resolved display value (ROI/units, flat/kelly) + W-L for one book/devig cell, or null if no data.
function _summaryCell(grid, book, devig) {
	const stats = grid.record[grid.m]?.[book]?.[devig];
	const s = stats ? (stats[grid.win] ?? null) : null;
	if (!s) return null;
	const w = s.wins ?? 0, l = s.losses ?? 0;
	if (w + l === 0) return null;
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
	if (val === null || val === undefined) return null;
	const sign = val > 0 ? '+' : '';
	const disp = isRoi ? `${sign}${val}${suffix}` : `${sign}${val.toFixed(2)}${suffix}`;
	return { val, disp, w, l, pos: val > 0, neg: val < 0 };
}

function _summaryFilterLabel() {
	const sportLabel = _summarySport === 'mlb_open' ? 'MLB Open' : 'MLB';
	const methodLabel = _summaryMethod === 'worst' ? 'Worst' : 'Probit';
	const displayLabel = _summaryDisplay === 'units' ? 'Units' : 'ROI';
	const bettingLabel = _summaryBetting === 'kelly' ? 'Kelly' : 'Flat';
	const winLabel = _summaryWindow || 'All';
	const sportToggle = document.getElementById('record-sport-toggle');
	const showSport = sportToggle && sportToggle.style.display !== 'none';
	return `${showSport ? sportLabel + ' · ' : ''}${winLabel} · ${displayLabel} (${bettingLabel}) · ${methodLabel}`;
}

function _flashExportStatus(msg) {
	const btn = document.getElementById('record-summary-export-btn');
	if (!btn) return;
	if (btn.dataset.resetTimer) clearTimeout(+btn.dataset.resetTimer);
	const original = 'Copy Image';
	btn.textContent = msg;
	const timer = setTimeout(() => { btn.textContent = original; }, 1500);
	btn.dataset.resetTimer = timer;
}

// Draws the current filtered record-summary grid to a canvas (dropping rows/cols with
// no data for this filter) and copies it to the clipboard as a PNG for pasting into Discord.
async function exportSummaryImage() {
	if (!_summaryRecord) return;
	const grid = _summaryComputeGrid();
	const { books, devigs } = grid;
	const fmtDevig = d => d.replace(/^[^-]+-vs-/, '');

	const cellMap = new Map();
	books.forEach(b => devigs.forEach(d => cellMap.set(`${b}|${d}`, _summaryCell(grid, b, d))));

	const usedBooks = books.filter(b => devigs.some(d => cellMap.get(`${b}|${d}`)));
	const usedDevigs = devigs.filter(d => usedBooks.some(b => cellMap.get(`${b}|${d}`)));

	if (!usedBooks.length || !usedDevigs.length) {
		_flashExportStatus('No data');
		return;
	}

	const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
	const font = `12px ${fontFamily}`;
	const boldFont = `600 12px ${fontFamily}`;
	const mctx = document.createElement('canvas').getContext('2d');

	const pad = 12;
	const rowLabelPad = 14;
	const cellPadX = 10;

	mctx.font = boldFont;
	let rowLabelW = mctx.measureText('BEST').width;
	usedBooks.forEach(b => { rowLabelW = Math.max(rowLabelW, mctx.measureText(b.toUpperCase()).width); });
	rowLabelW += rowLabelPad * 2;

	const colW = {};
	usedDevigs.forEach(d => {
		mctx.font = boldFont;
		let w = mctx.measureText(fmtDevig(d)).width;
		usedBooks.forEach(b => {
			const c = cellMap.get(`${b}|${d}`);
			mctx.font = boldFont;
			if (c) w = Math.max(w, mctx.measureText(c.disp).width);
			mctx.font = font;
			w = Math.max(w, mctx.measureText(c ? `${c.w}W-${c.l}L` : '—').width);
		});
		colW[d] = Math.max(w + cellPadX * 2, 56);
	});

	const rowH = 34, headerH = 26, titleH = 46, footerH = 22;
	const tableW = rowLabelW + usedDevigs.reduce((s, d) => s + colW[d], 0);
	const cssW = pad * 2 + tableW;
	const cssH = titleH + headerH + usedBooks.length * rowH + footerH + pad;

	const dpr = window.devicePixelRatio || 1;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	const ctx = canvas.getContext('2d');
	ctx.scale(dpr, dpr);

	const bg = '#0f1923', border = '#1c2b38', dim = '#8899a6', main = '#e6edf3', pos = '#4ade80', neg = '#f87171';

	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, cssW, cssH);
	ctx.textBaseline = 'top';

	let y = pad;
	ctx.fillStyle = main;
	ctx.font = `600 15px ${fontFamily}`;
	ctx.fillText('Record Summary', pad, y);
	ctx.fillStyle = dim;
	ctx.font = `11px ${fontFamily}`;
	ctx.fillText(_summaryFilterLabel(), pad, y + 20);
	y += titleH;

	ctx.fillStyle = '#131f2a';
	ctx.fillRect(pad, y, tableW, headerH);
	ctx.strokeStyle = border;
	ctx.strokeRect(pad, y, tableW, headerH);
	ctx.fillStyle = dim;
	ctx.font = boldFont;
	let x = pad + rowLabelW;
	usedDevigs.forEach(d => {
		ctx.fillText(fmtDevig(d), x + cellPadX, y + 7);
		x += colW[d];
	});
	y += headerH;

	usedBooks.forEach((b, i) => {
		if (i % 2 === 1) {
			ctx.fillStyle = 'rgba(255,255,255,0.02)';
			ctx.fillRect(pad, y, tableW, rowH);
		}
		ctx.strokeStyle = border;
		ctx.strokeRect(pad, y, tableW, rowH);

		ctx.fillStyle = main;
		ctx.font = boldFont;
		ctx.fillText(b.toUpperCase(), pad + rowLabelPad, y + 11);

		let cx = pad + rowLabelW;
		usedDevigs.forEach(d => {
			const c = cellMap.get(`${b}|${d}`);
			if (c) {
				ctx.fillStyle = c.pos ? pos : c.neg ? neg : main;
				ctx.font = boldFont;
				ctx.fillText(c.disp, cx + cellPadX, y + 5);
				ctx.fillStyle = dim;
				ctx.font = font;
				ctx.fillText(`${c.w}W-${c.l}L`, cx + cellPadX, y + 19);
			} else {
				ctx.fillStyle = dim;
				ctx.font = font;
				ctx.fillText('—', cx + cellPadX, y + 11);
			}
			cx += colW[d];
		});
		y += rowH;
	});

	ctx.fillStyle = dim;
	ctx.font = `10px ${fontFamily}`;
	ctx.textAlign = 'right';
	ctx.fillText('+EV Sharps', pad + tableW, y + 6);
	ctx.textAlign = 'left';

	canvas.toBlob(async (blob) => {
		if (!blob) return;
		try {
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			_flashExportStatus('Copied!');
		} catch (err) {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'record-summary.png';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			_flashExportStatus('Downloaded');
		}
	}, 'image/png');
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
