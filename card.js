let ALL_CARD_DATA = [];

// ── Watchlist ────────────────────────────────────────────────────────────────
function _normPlayer(p) { return (p || "").toLowerCase().trim(); }

function isWatchlisted(player) {
	const p = _normPlayer(player);
	return (CURR_USER?.metadata?.watchlist || []).some(w => _normPlayer(w.player ?? w) === p);
}

function isTracked(player) {
	const p = _normPlayer(player);
	return (CURR_USER?.metadata?.bets || []).some(b => {
		const bp = _normPlayer(b.player);
		return p.includes(bp) || bp.includes(p);
	});
}

function _starColor(player) {
	if (isWatchlisted(player)) return "#f59e0b";
	if (isTracked(player)) return "#3b82f6";
	return "#6b7280";
}

async function toggleWatchlist(e, player) {
	e.stopPropagation();
	if (!CURR_USER || !CURR_SESSION) return;
	const star = e.currentTarget;
	const p = _normPlayer(player);
	const watchlist = [...(CURR_USER.metadata?.watchlist || [])];
	const idx = watchlist.findIndex(w => _normPlayer(w.player ?? w) === p);
	if (idx >= 0) watchlist.splice(idx, 1);
	else watchlist.push({ player: p, dt: new Date().toISOString().slice(0, 10) });
	CURR_USER.metadata = { ...(CURR_USER.metadata || {}), watchlist };
	await SB.from('profiles').update({ metadata: CURR_USER.metadata }).eq('id', CURR_SESSION.user.id);
	if (star && star.classList.contains('watchlist-star')) {
		star.textContent = isWatchlisted(player) || isTracked(player) ? "★" : "☆";
		star.style.color = _starColor(player);
	}
}

let MASTER_DATA = [];
let CURRENT_CARD_INDEX = 0;
const CARDS_PER_LOAD = 20;
// Flag to prevent loading multiple batches simultaneously
let IS_LOADING_CARDS = false;

function cardStateKey(rowData) {
  const player = (rowData.player || "").trim();
  const prop   = (rowData.prop || "").trim();
  const line   = String(rowData.handicap ?? "");
  const side   = rowData.under ? "U" : "O";

  return `cardOpen:${player}|${prop}|${side}|${line}`;
}

function clearCardOpenState() {
  Object.keys(localStorage)
    .filter(k => k.startsWith("cardOpen:"))
    .forEach(k => localStorage.removeItem(k));
}

clearCardOpenState();

function initializeCards(data) {
	MASTER_DATA = data;
	populateHandicapFilter(data);
	applyFilters();
}

function populateHandicapFilter(data) {
	const sel = document.getElementById("handicap-filter");
	if (!sel) return;
	const current = sel.value;
	const values = [...new Set(data.map(r => r.handicap).filter(h => h != null))].sort((a, b) => parseFloat(a) - parseFloat(b));
	sel.innerHTML = `<option value="">All Lines</option>` + values.map(v => `<option value="${v}">${v}</option>`).join("");
	if (values.includes(parseFloat(current)) || current === "") sel.value = current;
}

function applyFilters() {
	const searchTerm = document.getElementById("player-search").value.toLowerCase();
	const handicapSel = document.getElementById("handicap-filter");
	const handicap = handicapSel ? handicapSel.value : "";

	const filtered = MASTER_DATA.filter(row => {
		if (row.player && !row.player.includes(searchTerm)) return false;
		if (handicap !== "" && String(row.handicap) !== String(handicap)) return false;
		return true;
	});

	renderCards(filtered);
}

const debouncedApplyFilters = debounce(applyFilters, 400);
if (document.getElementById("player-search")) {
	document.getElementById("player-search").addEventListener("input", () => {
		debouncedApplyFilters();
	});
}

// Inject handicap dropdown next to player search
(function injectHandicapFilter() {
	const search = document.getElementById("player-search");
	if (!search || document.getElementById("handicap-filter")) return;
	const sel = document.createElement("select");
	sel.id = "handicap-filter";
	sel.innerHTML = `<option value="">All Lines</option>`;
	sel.addEventListener("change", applyFilters);
	search.parentNode.insertBefore(sel, search.nextSibling);
})();

function loadMoreCards() {
	if (IS_LOADING_CARDS) return;
	
	const container = document.getElementById("card-container");
	const data = ALL_CARD_DATA;
	
	const endIndex = Math.min(CURRENT_CARD_INDEX + CARDS_PER_LOAD, data.length);
	
	if (CURRENT_CARD_INDEX >= data.length) {
		return;
	}
	
	IS_LOADING_CARDS = true;
	
	const fragment = document.createDocumentFragment();
	
	for (let i = CURRENT_CARD_INDEX; i < endIndex; i++) {
		const rowData = data[i];
		const uniqueId = `${rowData.player}-${rowData.prop}-${rowData.line}-${rowData.ouIdx}`;
		
		// Use the existing function to create the card
		const newCard = createNewCard(rowData, uniqueId);
		fragment.appendChild(newCard);
	}
	
	container.appendChild(fragment);
	
	CURRENT_CARD_INDEX = endIndex;
	IS_LOADING_CARDS = false;
	
	// Edge case: If the loaded cards don't fill the container (e.g., on a large monitor), 
	// immediately load the next batch until the container is full or all data is loaded.
	if (container.scrollHeight <= container.clientHeight && CURRENT_CARD_INDEX < data.length) {
		loadMoreCards();
	}
}

function handleScroll() {
	const container = document.getElementById("table-container");
	
	const scrollTriggerDistance = 200;
	const scrolledNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - scrollTriggerDistance;

	//console.log(scrolledNearBottom, CURRENT_CARD_INDEX)

	if (scrolledNearBottom && !IS_LOADING_CARDS && CURRENT_CARD_INDEX < ALL_CARD_DATA.length) {
		loadMoreCards();
	}
}

function dMetricPill(label, value, color) {
	if (value === undefined || value === null || value === "") return "";
	const colorStyle = color ? `color:${color};` : "";
	return `<div class="metric-pill" style="min-width:48px;">
		<div style="font-weight:600;font-size:0.8rem;${colorStyle}">${value}</div>
		<div style="opacity:0.75;font-size:0.68rem;">${label}</div>
	</div>`;
}

function dPctPill(label, value, pct, invertPct) {
	if (value === undefined || value === null || value === "") return "";
	const p = invertPct ? (pct ? 100 - pct : null) : pct;
	const color = getPercentileColor(label, p);
	const display = typeof value === "number" && value < 1 && value > 0
		? String(value.toFixed(3)).replace(/^0/, "")
		: (typeof value === "number" ? value.toFixed(1) : value);
	return dMetricPill(label, display, color);
}

function renderDingersMetrics(r) {
	const pd = r.pitcherData || {};
	const sv = r.savant || {};
	const bp = r.batter_percs || {};
	const pc = r.percs || {};

	// ERA color: low is bad for HR (green ERA = bad for batter)
	function eraColor(v) {
		const n = parseFloat(v);
		if (!n) return "";
		if (n <= 3.5) return "#e53935";
		if (n >= 4.5) return "#33cc66";
		return "#aaaaaa";
	}

	// xwOBA/xBA: higher = better for batter
	function xwobaColor(v) {
		const n = parseFloat(v);
		if (!n) return "";
		if (n >= 0.370) return "#33cc66";
		if (n < 0.310) return "#e53935";
		return "#aaaaaa";
	}
	function xwobaColorInv(v) {
		const n = parseFloat(v);
		if (!n) return "";
		if (n >= 0.370) return "#e53935";
		if (n < 0.310) return "#33cc66";
		return "#aaaaaa";
	}
	function fmtWoba(v) {
		const n = parseFloat(v);
		return n ? String(n.toFixed(3)).replace(/^0/, "") : "";
	}

	const pitcherSection = r.pitcher ? `
		<div style="display:flex;flex-direction:column;gap:4px;">
			<div style="font-size:0.7rem;font-weight:600;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;">Pitcher: ${title(r.pitcher)} (${r.pitcherLR})</div>
			<div style="display:flex;gap:6px;flex-wrap:wrap;">
				${dMetricPill("ERA", pd.p_era || "", eraColor(pd.p_era))}
				${dPctPill("OPS", pd.on_base_plus_slg, 100 - pd.on_base_plus_slgPercentile, false)}
				${dMetricPill("xwOBA", fmtWoba(pd.xwoba), xwobaColor(pd.xwoba))}
				${dMetricPill("HR/PA%", pc.hr_pa !== undefined ? pc.hr_pa : "", getPercentileColor("percs.hr_pa", pc.hr_rate_percentile))}
				${dMetricPill("HRs", pc.home_run !== undefined ? pc.home_run : "", "")}
				${dMetricPill("BvP", r.bvp || "", "")}
				${dPctPill("Fly%", pd.flyballs_percent, pd.flyballs_percentPercentile, false)}
				${dPctPill("Pull%", pd.pull_percent, 100 - pd.pull_percentPercentile, false)}
				${dPctPill("Avg LA", pd.launch_angle_avg, pd.launch_angle_avgPercentile, false)}
				${dPctPill("SwSp%", pd.sweet_spot_percent, 100 - pd.sweet_spot_percentPercentile, false)}
				${dPctPill("EVelo", pd.exit_velocity_avg, pd.exit_velocity_avgPercentile, false)}
				${dPctPill("HH%", pd.hard_hit_percent, 100 - pd.hard_hit_percentPercentile, false)}
				${dPctPill("BRL%", pd.barrel_batted_rate, 100 - pd.barrel_batted_ratePercentile, false)}
			</div>
		</div>
	` : "";

	const batterSection = `
		<div style="display:flex;flex-direction:column;gap:4px;">
			<div style="font-size:0.7rem;font-weight:600;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;">Batter</div>
			<div style="display:flex;gap:6px;flex-wrap:wrap;">
				${dPctPill("OPS", sv.on_base_plus_slg, 100 - sv.on_base_plus_slgPercentile, false)}
				${dMetricPill("HR/PA%", bp.hr_pa !== undefined ? bp.hr_pa : "", getPercentileColor("batter_percs.hr_pa", bp.hr_rate_percentile))}
				${dMetricPill("HRs", bp.home_run !== undefined ? bp.home_run : "", "")}
				${dMetricPill("xwOBA", fmtWoba(sv.est_woba), xwobaColor(sv.est_woba))}
				${dPctPill("Fly%", sv.flyballs_percent, sv.flyballs_percentPercentile, false)}
				${dPctPill("Pull%", sv.pull_percent, 100 - sv.pull_percentPercentile, false)}
				${dPctPill("Avg LA", sv.launch_angle_avg, sv.launch_angle_avgPercentile, false)}
				${dPctPill("SwSp%", sv.sweet_spot_percent, sv.sweet_spot_percentPercentile, false)}
				${dPctPill("EVelo", sv.exit_velocity_avg, sv.exit_velocity_avgPercentile, false)}
				${dPctPill("HH%", sv.hard_hit_percent, sv.hard_hit_percentPercentile, false)}
				${dPctPill("BRL%", sv.barrels_per_bip, sv.barrels_per_bipPercentile, false)}
			</div>
		</div>
	`;

	return `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0;">${pitcherSection}${batterSection}</div>`;
}

function plusMinusCardFormatter(cell) {
	let value = cell.getValue();
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	return `<span class="${colorClass}">${value}</span>`;
}

function evCardFormatter(row) {
	let value = row.ev;
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	if (["outliers", "atgs2", "dingers2"].includes(PAGE)) {
		return `<span class="ev-value">${Math.round((row?.outlierPct || 0) * 100)}%</span><span style=""> from devig</span>`;
	}
	return `<span class="ev-value ${colorClass}">${value}%</span><span style="">EV</span>`;
}

function bookContent(cell) {
	const value = cell.getValue();
	return `<span></span>`;
}

let PREVIOUS_DATA = [];

function sliceLogs(logs, interval) {
	const start = Math.max(0, logs.length - interval);
	const slicedLogs = logs.slice(start);
	const slicedIndices = Array.from({ length: slicedLogs.length }, (_, i) => i + 1);
	
	return { slicedLogs, slicedIndices };
}

function renderTrends(trends, prop) {
	const LABELS = {
		lyr: "Last Yr",
		szn: "Year"
	};
	const ORDER = ["lyr", "szn", "L5", "L10", "L20"];
	const isHomer = prop === 'hr';
	const pills = ORDER
		.filter(k => trends?.[k])
		.map(k => {
			const { w = 0, t = 0, p = 0 } = trends[k];
			const label = LABELS[k] ?? k;

			const tone = isHomer
				? (p >= 30 ? "good" : p >= 15 ? "mid" : "bad")
				: (p >= 60 ? "good" : p >= 45 ? "mid" : "bad");

			return `
				<div class="trend-pill">
				  <div class="trend-label">${label}</div>
				  <div class="trend-box ${tone}">
					<div class="trend-frac">${w}/${t}</div>
					<div class="trend-pct">${p}%</div>
				  </div>
				</div>
			`;
		})
		.join("");

	return `<div class="trend-row">${pills}</div>`;
}

function renderDue(pa) {
	if (!pa) return "";
	const { streak, avg, med, sd, z_median } = pa;
	const items = [
		{ label: "Streak", value: streak },
		{ label: "Avg", value: avg?.toFixed(1) },
		{ label: "Median", value: med },
		{ label: "SD", value: sd?.toFixed(2) },
		{ label: "Med Z", value: z_median?.toFixed(2) },
	];
	const zColor = z_median != null ? getZColor(z_median) : "";
	const pills = items.map(({ label, value }) => {
		const style = (label === "Med Z" && zColor) ? ` style="color:${zColor};font-weight:600;"` : "";
		return `
			<div class="trend-pill">
				<div class="trend-label">${label}</div>
				<div class="trend-box"${style}>${value ?? "—"}</div>
			</div>
		`;
	}).join("");
	return `
		<div class="expanded-trends" style="min-width:160px;">
			<div style="display:flex; justify-content:center; align-items:center;">
				<div style="opacity:0.9; font-size:0.78rem; font-weight:600;">Due (in Plate Appearances)</div>
			</div>
			<div class="trend-row">${pills}</div>
		</div>
	`;
}

function renderCardPlot(uniqueId, under, logs, handicap, interval) {
	if (!logs || logs.length === 0) {
		const chartDiv = document.getElementById(`card-chart-${uniqueId}`);
		if (chartDiv) {
			chartDiv.innerHTML = '<div style="text-align:center; padding:10px; font-style:italic;">No recent game logs available.</div>';
		}
		return;
	}

	const colors = logs.map(value => {
		let cond = parseFloat(value) > parseFloat(handicap);
		if (under) {
			cond = parseFloat(value) < parseFloat(handicap);
		}
		return cond ? "rgba(65, 131, 215, 0.9)" : "rgba(242, 120, 75, 0.9)";
	});
	const tableData = {
		x: Array.from({ length: logs.length }, (_, i) => i + 1),
		y: logs.map(v => v != "0" ? v : 0.25),
		type: "bar",
		text: logs,
		textposition: "inside",
		marker: {
			color: colors
		}
	};
	const layout = {
		height: 120,
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		height: "200px",
		dragmode: 'pan',
		margin: { l: 0, r: 0, t: 20, b: 20 },
		xaxis: {
			showgrid: false,
			type: "category",
			//tickmode: "array",
			//tickvals: [dtSplits[0],dtSplits.at(-1)],
			//ticktext: [dtSplits[0],dtSplits.at(-1)],
			//range: [-0.5, parseFloat(dtSplits.length)+0.5],
			rangeslider: {
				visible: false
			},
			//range: [dtSplits.length-15.6,dtSplits.length-0.5]
		},
		yaxis: {
			showgrid: false,
			tickmode: "linear",
			dtick: 1,
			fixedrange: true,
			showticklabels: false,
			title: {
				text: ""
			}
		},
		shapes: [
			/*
			{
				type: "line",
				x0: -0.25, x1: logs.length,
				y0: handicap,
				line: {
					color: "#5A5A5A",
					dash: "dash"
				}
			}
			*/
		]
	};

	//Plotly.newPlot(`card-chart-${uniqueId}`, [tableData], layout, { responsive: true});
	setTimeout(() => {
		//Plotly.Plots.resize(`card-chart-${uniqueId}`)
	}, 100);
}

function showCardModal(rowData) {
	const overlay = document.getElementById('card-modal-overlay');
	const inner = document.getElementById('card-modal-inner');
	// Remove previous card if any
	inner.querySelectorAll('.data-card').forEach(el => el.remove());

	const uniqueId = `modal-${rowData.player}-${rowData.prop}-${rowData.handicap}-${rowData.under ? 1 : 0}`;
	const card = createNewCard(rowData, uniqueId);
	// Auto-expand the collapsed body so trends/ranks show immediately
	const body = card.querySelector('.card-body-collapsed');
	if (body) {
		body.classList.add('visible');
		card.classList.add('expanded');
		renderCardPlot(uniqueId, rowData.under, rowData.logs, rowData.handicap, 15);
	}
	inner.appendChild(card);
	overlay.classList.add('open');
}

function createNewCard(rowData, uniqueId) {
	const card = document.createElement('div');
	card.className = 'data-card';
	card.dataset.uniqueId = uniqueId;

	const header = document.createElement('div');
	header.className = 'card-header';
	card.appendChild(header);
	
	header.addEventListener('click', (e) => {
		if (e.target.closest('.watchlist-star')) return;
		const collapsedBody = header.querySelector('.card-body-collapsed');
		if (e.target.closest('.all-books-row')) {
			//return;
		}

		const isVisible = collapsedBody.classList.toggle("visible");
		card.classList.toggle("expanded", isVisible);

		const uniqueId = card.dataset.uniqueId;

		const logs = rowData.logs;
		const handicap = rowData.handicap;

		const key = cardStateKey(rowData);
		localStorage.setItem(key, collapsedBody.classList.contains("visible") ? "1" : "0");

		if (collapsedBody.classList.contains('visible')) {
			const intervalSelect = document.getElementById(`log-interval-${uniqueId}`);
			const interval = intervalSelect ? parseInt(intervalSelect.value) : 15;
			renderCardPlot(uniqueId, rowData.under, logs, handicap, interval);
		}
	});

	// Run the update logic to populate the content
	updateExistingCard(card, rowData);

	return card;
}

function renderAllBooks(bookOdds, bestBook, links, liquidity) {
	const orderedKeys = [
		'circa', 'fd', 'dk', 'mgm', 'espn', 'pn', 'br', 'b365',
		'cz', 'fn', 'hr', 'bv', 'kambi', 'bol', 're', 'fl',
		'nv', 'kal', 'px', 'poly'
	];

	let html = '';

	if (!bookOdds || typeof bookOdds !== 'object') {
		return '';
	}

	const devigBooks = (typeof DEVIG === 'string' && DEVIG)
		? DEVIG.split(";")[0].split("+").filter(Boolean)
		: [];

	for (const bookKey of orderedKeys) {
		const odds = bookOdds[bookKey];
		if (odds !== null && odds !== undefined && odds !== "") {
			const isBest = bookKey === bestBook ? 'is-best-book' : '';
			const isDevig = devigBooks.includes(bookKey) ? 'is-devig-book' : '';
			const liq = liquidity?.[bookKey];
			const liqHtml = Array.isArray(liq) && liq.length >= 2
				? `<span class="book-odd-liq">$${liq[0]}/$${liq[1]}</span>`
				: '';
			const link = typeof resolveLink === 'function' ? resolveLink(links?.[bookKey]) : null;
			const betslipLink = link
				? `<a href="${link}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="book-betslip-card" title="Add to betslip">+</a>`
				: '';
			html += `
				<div class="book-odd-item ${isBest} ${isDevig}">
					<img class="book-logo-small" src='logos/${bookKey}.png' alt='${bookKey}' title='${bookKey}' />
					<span style="display:flex;align-items:center;gap:2px;"><span class='book-odd-value ${isBest}'>${plusFormatter(odds)}</span>${betslipLink}</span>
					${liqHtml}
				</div>
			`;
		}
	}

	return html;
}

function renderCardRecord(rowData) {
	try {
		if (typeof RECORD === 'undefined' || !RECORD || !DEVIG) return '';
		const method = (typeof METHOD !== 'undefined' && METHOD) || "worst";
		const book = rowData.book;
		const prop = rowData.prop;
		if (!book || !prop) return '';
		const key = `${prop}-vs-${DEVIG}`;
		const rec = RECORD[method]?.[book]?.[key];
		if (!rec) return '';

		const WINDOWS = [
			{ key: "All", label: "Season" },
			{ key: "L7", label: "L7" },
			{ key: "L14", label: "L14" },
			{ key: "L30", label: "L30" },
			{ key: "L60", label: "L60" },
		];

		const pills = WINDOWS.map(({ key: wk, label }) => {
			const s = rec[wk];
			if (!s) return '';
			const w = s.wins ?? 0, l = s.losses ?? 0;
			if (w + l === 0) return '';
			const roi = typeof s.roi === 'number' ? s.roi : null;
			const roiStr = roi !== null ? `${roi > 0 ? '+' : ''}${roi}%` : '';
			const tone = roi > 0 ? 'good' : roi >= -5 ? 'mid' : 'bad';
			return `
				<div class="trend-pill">
					<div class="trend-label">${label}</div>
					<div class="trend-box ${tone}">
						<div class="trend-frac">${w}-${l}</div>
						<div class="trend-pct">${roiStr}</div>
					</div>
				</div>
			`;
		}).filter(Boolean).join('');

		if (!pills) return '';

		return `
			<div class="expanded-trends" style="min-width:160px;">
				<div style="display:flex; justify-content:center; align-items:center;">
					<div style="opacity:0.9; font-size:0.78rem; font-weight:600;">Record (${book.toUpperCase()} vs ${DEVIG.toUpperCase()})</div>
				</div>
				<div class="trend-row">${pills}</div>
			</div>
		`;
	} catch (e) { return ''; }
}

function updateExistingCard(card, rowData) {
	const uniqueId = card.dataset.uniqueId;
	const header = card.querySelector('.card-header');

	const book = rowData.book;
	let pre = rowData.ouIdx == 1 ? "u" : "o";
	if (rowData.ouIdx == undefined) {
		pre = rowData.under ? "u" : "o";
	}

	const evContent = evCardFormatter(rowData);
	const sport = rowData.sport || SPORT || "nba";
	const avgMin = PAGE == "nhl" ? rowData.avgTOI : rowData.avgMin;
	let team = rowData.teamId || rowData.team;
	let teamImg = getTeamImg(sport, team);
	let player = title(rowData.player);
	let gameImg = getGameImgs(rowData, {});
	if (gameImg) {
		gameImg = gameImg.join(" @ ");
	}
	let propDisplay = rowData.prop.toUpperCase();

	const isTeamTotal = rowData.prop === "home_total" || rowData.prop === "away_total";
	if (isTeamTotal) {
		const game = rowData.game || rowData.gameId || "";
		const [awayTeam, homeTeam] = game.split(" @ ");
		const teamTotalTeam = rowData.prop === "away_total" ? awayTeam : homeTeam;
		if (teamTotalTeam) {
			team = teamTotalTeam.trim().toLowerCase();
			teamImg = getTeamImg(sport, team);
			player = teamTotalTeam.trim().toUpperCase();
		}
		propDisplay = "TEAM TOTAL";
	} else if (rowData.prop.includes("total")) {
		teamImg = gameImg;
	} else if (PAGE.includes("ncaa")) {
		if (!["reb", "3ptm", "pts", "ast"].includes(rowData.prop)) {
			player = rowData.gameId || rowData.game;
		}
		teamImg = gameImg;
	}
	const _rp = rowData.player || "";
	const _starred = isWatchlisted(_rp) || isTracked(_rp);
	const _starSpan = `<span class="watchlist-star" data-player="${_rp.replace(/"/g, '&quot;')}" onclick="toggleWatchlist(event,this.dataset.player)" style="cursor:pointer;font-size:1.1rem;color:${_starColor(_rp)};line-height:1;padding:2px 4px;" title="${isTracked(_rp) ? 'In tracker' : (isWatchlisted(_rp) ? 'Watchlisted' : 'Add to watchlist')}">${_starred ? "★" : "☆"}</span>`;

	const playerRowContent = `
		<div class="player-content-stack">
			${teamImg}
			<div style="font-size: 0.7rem;display:flex;flex-direction:column;text-align:center;">
				<span class="pos">${rowData.pos || ""}</span>
				<span class="bats">${(PAGE === "dingers") ? rowData.bats : avgMin || ""}</span>
			</div>
			<span class="player-name">${player}</span>
			${_starSpan}
		</div>
		<div class="prop-content-stack">
			<span class="prop-line">${pre}${rowData.handicap}</span>
			<span class="prop-type">${propDisplay}</span>
		</div>
	`;
	
	const evBookRowContent = `
		<div class="ev-section">${evContent}</div>
		<div class="best-book-section">
			<img class="book-img-large" src='logos/${book}.png' alt='${book}' title='${book}' />
			<span class='evbook-odds-large'>${plusFormatter(rowData.line)}</span>
		</div>
	`;

	const allBooksHtml = renderAllBooks(rowData.bookOdds, book, rowData.links, rowData.liquidity);

	header.innerHTML = `
		<div class="card-row player-prop-row">${playerRowContent}</div>
		<div class="card-row ev-book-row">${evBookRowContent}</div>
		<div class="card-row all-books-row">${allBooksHtml}</div>
		
		<!-- Top metrics -->
		<div class="expanded-metrics" style="display:flex; gap:8px; justify-content:space-between;">
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${rowData.fairVal > 0 ? "+"+rowData.fairVal : rowData.fairVal}</div>
					<div style="opacity:0.85; font-size:0.72rem;">Fair Value</div>
				</div>
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${Math.round(rowData.implied)}%</div>
					<div style="opacity:0.85; font-size:0.72rem;">Implied</div>
				</div>
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${rowData.ev < 0 ? "-" : formatKellyValue(rowData.kelly || 0)}</div>
					<div style="opacity:0.85; font-size:0.72rem;">¼ Kelly</div>
				</div>
			</div>
		<div class="card-body-collapsed"></div>
		<div class="card-arrow-container">
			<svg class="toggle-arrow" viewBox="0 0 24 24" width="18" height="18">
				<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</div>
	`;
	
	const collapsedBody = card.querySelector('.card-body-collapsed');
	const dvp = rowData.dvpRank === undefined ? rowData.oppPosRank : rowData.dvpRank;
	const dvpPill = dvp ? `<div class="metric-pill" style="color:${getTDsOppRankColor(dvp)}; font-weight:600; font-size:0.85rem;">
					${addSuffix(dvp)} <span style="opacity:0.85; font-weight:500;">DvP Rank</span>
				</div>`: "";
	const stadiumPill = (PAGE === "dingers") ? `<div class="metric-pill">L:${rowData.stadiumRankLeft} R:${rowData.stadiumRankRight} B:${rowData.stadiumRank}<span style="opacity:0.85; font-weight:500;">Stadium</span></div>` : "";
	const bppPill = (PAGE === "dingers" && rowData.bpp) ? `<div class="metric-pill" style="color:${getHRFactorColor(parseInt(rowData.bpp))}; font-weight:600; font-size:0.85rem;">
					${rowData.bpp} <span style="opacity:0.85; font-weight:500;">BPP</span>
				</div>` : "";
	const _w = (typeof RES !== "undefined" && RES?.weather?.[rowData.game]) || rowData.weather;
	const weatherPill = (PAGE === "dingers" && _w) ? (
		_w.wind === "roof"
			? `<div class="metric-pill" style="font-size:0.85rem;">Roof</div>`
			: `<div class="metric-pill" style="font-weight:600; font-size:0.85rem;"><img class="wind" src="logos/${_w.windLogo}" style="height:14px;vertical-align:middle;"> ${_w.wind} mph ${_w.temp}</div>`
	) : "";
	collapsedBody.innerHTML = `
		<div class="card-expanded" style="display:flex; flex-direction:column; gap:10px;">

			<!-- Matchup ranks -->
			<div class="expanded-ranks" style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.95rem;display: flex;">${gameImg}</div>
					<div style="opacity:0.85; font-size:0.72rem;">Game</div>
				</div>
				<div class="metric-pill" style="color:${getTDsOppRankColor(rowData.oppRank)}; font-weight:600; font-size:0.85rem;">
					${addSuffix(rowData.oppRank)} <span style="opacity:0.85; font-weight:500;">Opp Rank</span>
				</div>
				${dvpPill}
				${stadiumPill}
				${bppPill}
				${weatherPill}
			</div>

			${PAGE === "dingers" ? renderDingersMetrics(rowData) : ""}

			<div class="expanded-trends-chart" style="display:flex; flex-direction:column; gap:10px;">
				<div class="expanded-trends" style="min-width:160px;">
					<div style="display:flex; justify-content:center; align-items:center;">
						<div style="opacity:0.9; font-size:0.78rem; font-weight:600;">Trends</div>
					</div>
					${renderTrends(rowData.hitRates || {}, rowData.prop)}
				</div>
				${renderCardRecord(rowData)}
				${PAGE === "dingers" ? renderDue(rowData.homerLogs?.pa) : ""}
			</div>
		</div>
	`;

	const key = cardStateKey(rowData);
	const shouldOpen = localStorage.getItem(key) === "1";

	collapsedBody.classList.toggle("visible", shouldOpen);
	card.classList.toggle("expanded", shouldOpen);

	if (collapsedBody.classList.contains('visible')) {
		//renderCardPlot(uniqueId, rowData.under, rowData.logs, rowData.handicap);
	}

	const previousRow = PREVIOUS_DATA.find(d => `${d.player}-${d.prop}-${d.line}` === card.dataset.uniqueId);
	if (previousRow && previousRow.ev !== rowData.ev) {
		card.style.transition = 'none';
		card.style.backgroundColor = 'rgba(100, 181, 246, 0.3)';
		setTimeout(() => {
			//card.style.transition = 'background-color 1s ease-out, transform 0.1s ease';
			//card.style.backgroundColor = '';
		}, 50);
	}
}

function renderCards(data) {
	if (PAGE == "outliers") {
		data = [...TABLE.getData()].sort((a,b) => {
			return parseFloat(b.outlier) - parseFloat(a.outlier);
		});
	} else {
		data = data.filter(r => r.ev != "" && r.ev != null).sort((a,b) => {
			return parseFloat(b.ev) - parseFloat(a.ev);
		});
	}

	const container = document.getElementById("card-container");
	container.innerHTML = "";

	ALL_CARD_DATA = data;
	PREVIOUS_DATA = data;
	CURRENT_CARD_INDEX = 0;

	loadMoreCards();

	const c = document.querySelector("#table-container");
	if (!c.dataset.scrollListenerAdded) {
		c.addEventListener('scroll', handleScroll);
		c.dataset.scrollListenerAdded = 'true';
	}
}