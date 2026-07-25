let TOGGLE_PERCENTILE;
let HTML = "";
let TEAM = "";
let PAGE = "";
let CURRENT_VIEW = "table";
const MOBILE_BREAKPOINT = 600;
let MOBILE = window.innerWidth <= MOBILE_BREAKPOINT;
let ACCESS_TOKEN = "";
let API_BASE = "http://localhost:5001";
let UPDATED = {};
let WEIGHTS = {};
let HEATMAP = {};
let CUP_TEAMS = {};
let TEST;
let RES, TABLE;
let CSV_DOWNLOADED = false;
let ALL, PROP, DATE, MARK, GAME, TODAY, SPORT, PLAYER, DEVIG, WEIGHT, BOOST, PRETTY, IMP, DUE, CSV, BOOK, VIG, MIN, MAX, OU, SIDE, TEAMS, METHOD, REQUIRED, PLAYERS, HARD_HIT, L3, EXIT_VELO, DERBY;
let KELLY_DOLLARS = false;
function getUnitSize() {
	return CURR_USER?.metadata?.unit_size || 100;
}
if (window.location.protocol == "file:" || window.location.host.includes("localhost")) {
	HTML = ".html";
}
if (!window.location.host.includes("localhost")) {
	API_BASE = `https://api-production-3a3b.up.railway.app`;
}

function getToday() {
	let today = new Date();
	today = today.toLocaleDateString("en-US", {day: "2-digit", month: "2-digit", year: "numeric"});
	let [M,D,Y] = today.split("/");
	return `${Y}-${M}-${D}`;
}

/*
<option value="profile">👤 Profile</option>
	<option value="pricing">💳 Pricing</option>
	*/
const PAGE_SECTIONS = [
	{
		key: "mlb", label: "⚾ MLB",
		pages: [
			{ label: "💣 Dingers", value: "dingers" },
			{ label: "💨 Ks (FREE)", value: "strikeouts" },
			{ label: "🎯 Props", value: "mlb", sharp: true },
			{ label: "🏆 Main", value: "main?sport=mlb", sharp: true },
			{ label: "⚾ Live", value: "live?sport=mlb", sharp: true },
			{ label: "💣💣 2+ HR", value: "dingers2" },
			{ label: "🔮 Futures", value: "futures" },
			{ label: "🆚 BvP", value: "bvp" },
			{ label: "📊 Stats", value: "stats" },
			{ label: "🏏 Barrels", value: "barrels" },
			{ label: "🔍 Pitcher Preview", value: "preview" },
			{ label: "💨 Pitcher Ks Preview", value: "preview_k" },
			{ label: "📰 Pitcher Mix", value: "pitcher_mix" },
			{ label: "📡 Feed", value: "feed" },
			{ label: "📊 Trends", value: "trends" },
			{ label: "📉 Movement", value: "movement?sport=mlb", sharp: true },
			{ label: "🎟️ Bets", value: "bets?sport=mlb", sharp: true },
			{ label: "📝 Recap", value: "recap" }
		]
	},
	{
		key: "nba", label: "🏀 NBA",
		pages: [
			{ label: "🏀 All Props", value: "nba", sharp: true },
			{ label: "🏆 Main", value: "main?sport=nba", sharp: true },
			{ label: "🏀 Live", value: "live?sport=nba", sharp: true },
			{ label: "🏀 KOTC", value: "kotc" },
			{ label: "📊 Results", value: "analysis?sport=nba" },
			{ label: "3PTM (Free)", value: "threes" },
			{ label: "PTS/REB/AST", value: "pts" },
			{ label: "🏀 CBB", value: "ncaab" },
			{ label: "🏆 WNBA Main", value: "main?sport=wnba" },
			{ label: "🏀 WNBA", value: "wnba" },
		]
	},
	{
		key: "nhl", label: "🏒 NHL",
		pages: [
			{ label: "🏒 Goals", value: "atgs" },
			{ label: "🏒 2+ Goals", value: "atgs2" },
			{ label: "🏒 Props", value: "nhl", sharp: true },
			{ label: "🏒 Main", value: "main?sport=nhl", sharp: true },
			{ label: "🏒 Live", value: "live?sport=nhl", sharp: true },
			{ label: "📊 Results", value: "analysis?sport=nhl" },
		]
	},
	{
		key: "other", label: "🌐 Other",
		pages: [
			{ label: "⚾ NCAA", value: "baseball_ncaa" },
			{ label: "⚽ Soccer", value: "soccer" },
			{ label: "🌍 World Cup", value: "cup", sharp: true },
			{ label: "🥊 UFC", value: "ufc" },
			{ label: "🗺️ Heat Map", value: "heatmap" },
			{ label: "📋 Cheat Sheets", value: "cheat" },
			{ label: "⚾ Outliers", value: "outliers?sport=mlb" },
			{ label: "🏀 Outliers", value: "outliers?sport=nba" },
			{ label: "🏒 Outliers", value: "outliers?sport=nhl" },
		]
	},
	{
		key: "account", label: "👤",
		pages: [
			{ label: "⭐ Watchlist/Bets", value: "tracker" },
			{ label: "❓ FAQ", value: "faq" },
			{ label: "👤 Profile", value: "profile" },
			{ label: "💳 Pricing", value: "pricing" },
		]
	}
];

let _ppRenderGrid = null;

function getPageFavorites() {
	if (CURR_USER && CURR_USER?.metadata?.page_favorites?.length) return CURR_USER.metadata.page_favorites;
	try { return JSON.parse(localStorage.getItem("page_favorites") || "[]"); } catch(e) { return []; }
}

function togglePageFav(value) {
	let favs = getPageFavorites();
	favs = favs.includes(value) ? favs.filter(f => f !== value) : [...favs, value];
	localStorage.setItem("page_favorites", JSON.stringify(favs));
	if (CURR_USER) {
		if (!CURR_USER.metadata) CURR_USER.metadata = {};
		CURR_USER.metadata.page_favorites = favs;
		if (typeof savePageFavorites === "function") savePageFavorites(favs);
	}
	// Update all star buttons in panel for this value
	document.querySelectorAll("#page-picker-panel .pp-star").forEach(btn => {
		if (btn.dataset.val === value) btn.classList.toggle("starred", favs.includes(value));
	});
	// Re-render if currently on favorites tab
	const activeTabEl = document.querySelector("#page-picker-panel .pp-tab.active");
	if (activeTabEl?.dataset.key === "favorites" && _ppRenderGrid) {
		_ppRenderGrid("favorites");
	}
}

setTimeout(() => {
	buildPagePicker();
}, 200);

function buildPagePicker() {
	const selectEl = document.getElementById("page-select");
	if (!selectEl) return;
	const wrapper = selectEl.closest(".select-wrapper") || selectEl.parentElement;
	if (!wrapper) return;

	// Current page value for highlighting
	let currentVal = PAGE;
	if (PAGE === "props") currentVal = SPORT;
	else if (PAGE === "outliers") currentVal = `outliers?sport=${SPORT}`;
	else if (PAGE === "live") currentVal = `live?sport=${SPORT}`;
	else if (PAGE === "analysis") currentVal = `analysis?sport=${SPORT}`;
	else if (PAGE === "movement") currentVal = `movement?sport=${SPORT}`;
	else if (PAGE === "bets" && SPORT === "nfl") currentVal = "bets?sport=nfl";
	else if (PAGE === "main") currentVal = `main?sport=${SPORT}`;

	// Active tab: favorites if any saved, else current sport
	const sportToTab = { mlb: "mlb", nba: "nba", nhl: "nhl", ncaab: "nba" };
	const hasFavs = getPageFavorites().length > 0;
	const activeTab = hasFavs ? "favorites" : (sportToTab[SPORT] || "mlb");

	// Create trigger button (replaces select wrapper)
	const btn = document.createElement("button");
	btn.id = "page-picker-btn";
	btn.innerHTML = `Pages <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;vertical-align:middle;margin-left:2px"><path d="M5 8l5 5 5-5"/></svg>`;
	wrapper.replaceWith(btn);

	// Build panel
	const panel = document.createElement("div");
	panel.id = "page-picker-panel";

	const ALL_TABS = [{ key: "favorites", label: "⭐" }, ...PAGE_SECTIONS];

	const tabsEl = document.createElement("div");
	tabsEl.id = "page-picker-tabs";
	ALL_TABS.forEach(section => {
		const tab = document.createElement("button");
		tab.className = "pp-tab" + (section.key === activeTab ? " active" : "");
		tab.dataset.key = section.key;
		tab.textContent = section.label;
		tab.addEventListener("click", () => {
			panel.querySelectorAll(".pp-tab").forEach(t => t.classList.remove("active"));
			tab.classList.add("active");
			renderGrid(section.key);
		});
		tabsEl.appendChild(tab);
	});
	panel.appendChild(tabsEl);

	const grid = document.createElement("div");
	grid.id = "page-picker-grid";
	panel.appendChild(grid);
	document.body.appendChild(panel);

	function makeRow(page) {
		const isCurrent = page.value === currentVal;
		const isStarred = getPageFavorites().includes(page.value);
		return `<button class="pp-page-btn${isCurrent ? " current-page" : ""}${page.sharp ? " pp-sharp" : ""}" onclick="changePage('${page.value}');closePicker()">
			<span class="pp-label">${page.label}</span>
			<span class="pp-star${isStarred ? " starred" : ""}" data-val="${page.value}" onclick="event.stopPropagation();togglePageFav('${page.value}')">★</span>
		</button>`;
	}

	function renderGrid(sportKey) {
		if (sportKey === "favorites") {
			const favVals = getPageFavorites();
			if (favVals.length === 0) {
				const mlbPages = PAGE_SECTIONS.find(s => s.key === "mlb")?.pages || [];
				grid.innerHTML = `<div class="pp-fav-hint">Star pages to save favorites</div>` +
					mlbPages.map(makeRow).join("");
			} else {
				const pages = favVals.map(val => {
					for (const s of PAGE_SECTIONS) {
						const found = s.pages.find(p => p.value === val);
						if (found) return found;
					}
					return null;
				}).filter(Boolean);
				grid.innerHTML = pages.map(makeRow).join("");
			}
		} else {
			const section = PAGE_SECTIONS.find(s => s.key === sportKey);
			if (!section) return;
			grid.innerHTML = section.pages.map(makeRow).join("");
		}
	}

	_ppRenderGrid = renderGrid;
	renderGrid(activeTab);

	btn.addEventListener("click", e => {
		e.stopPropagation();
		if (panel.style.display === "block") {
			panel.style.display = "none";
		} else {
			// Re-render active tab to pick up fresh auth/favorites data
			const activeTabEl = panel.querySelector(".pp-tab.active");
			if (activeTabEl) renderGrid(activeTabEl.dataset.key);
			panel.style.display = "block";
			const rect = btn.getBoundingClientRect();
			const pw = panel.offsetWidth;
			let left = rect.left + rect.width / 2 - pw / 2;
			left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
			panel.style.left = left + "px";
			panel.style.top = (rect.bottom + 6) + "px";
		}
	});

	document.addEventListener("click", () => { panel.style.display = "none"; });
	panel.addEventListener("click", e => e.stopPropagation());
}

function closePicker() {
	const panel = document.getElementById("page-picker-panel");
	if (panel) panel.style.display = "none";
}

function openProfile() {
	changePage("profile");
}

function changePage(page) {
	if (page == "historical") {
		window.location.href = `./historical${HTML}?historical=z`;
	} else if (page == "kambi") {
		window.location.href = `./dingers${HTML}?kambi=true`;
	} else if (page.includes("main")) { 
		let sport = !page.includes("sport=") ? "mlb" : page.split("?sport=")[1];
		window.location.href = `./main${HTML}?sport=${sport}`;
	} else if (page.includes("bets")) { 
		let sport = !page.includes("sport=") ? "mlb" : page.split("?sport=")[1];
		window.location.href = `./bets${HTML}?sport=${sport}`;
	} else if (page.includes("live")) { 
		let sport = !page.includes("sport=") ? "attd" : page.split("?sport=")[1];
		window.location.href = `./live${HTML}?sport=${sport}`;
	} else if (page.includes("analysis")) { 
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./analysis${HTML}?sport=${sport}`;
	} else if (page.includes("outliers")) {
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./outliers${HTML}?sport=${sport}`;
	} else if (page.includes("cheat")) {
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./cheat${HTML}?sport=${sport}`;
	} else if (page.includes("movement")) {
		let sport = !page.includes("sport=") ? "atgs" : page.split("?sport=")[1];
		window.location.href = `./movement${HTML}?sport=${sport}`;
	} else {
		window.location.href = `./${page}${HTML}`;
	}
}

function parseBook(book) {
	let conv = {
		PN: "Pinnacle",
		B365: "Bet365",
		BOL: "BetOnline",
		BV: "Bovada",
		CZ: "Caesars",
		DK: "Draftkings",
		FD: "Fanduel",
		FN: "Fanatics",
		HR: "Hardrock",
		MGM: "BetMGM",
		BR: "BetRivers",
		FL: "Fliff",
		RE: "ReBet"
	}
	return conv[book.toUpperCase()] || title(book);
}

function isBarrel(row) {
	const ev = parseFloat(row["evo"] || 0);
	const la = parseInt(row["la"] || 0);
	return (ev * 1.5 - la) >= 117 && (ev + la) >= 124 && la <= 50 && ev >= 98
}

function isBarrel2(row) {
	const evo = Math.round(parseFloat(row["evo"] || 0));
	const la = parseInt(row["la"] || 0);
	const thresh = {
		98: [26, 30], 99: [25, 31],
		100: [24, 33], 101: [23, 34],
		102: [22, 35], 103: [21, 36],
		104: [20, 37], 105: [19, 38],
		106: [18, 39], 107: [17, 40],
		108: [16, 41], 109: [15, 42],
		110: [14, 43], 111: [13, 44], 112: [12, 45],
		113: [11, 46], 114: [10, 47],
		115: [9, 48], 116: [8, 50]
	};

	if (evo < 98) return false;
	if (evo > 116) return la >= thresh[116][0] && la <= thresh[116][1];
	return la >= thresh[evo][0] && la <= thresh[evo][1];
}

function downloadCSV() {
	// excel-friendly
	TABLE.download("csv", `${PAGE}.csv`, { bom: true });
}

const timeAgoFormatter = function(cell) {
	return timeAgo(cell.getValue(), true);
}

function timeAgo(timestamp, short=false) {

	if (timestamp === 0) {
		return "";	
	}

	const now = new Date();
	const past = new Date(timestamp);
	const diff = Math.floor((now - past) / 1000);

	if (diff < 0) {
		return "";
	}

	if (diff < 60) {
		if (short) return `${diff}s ago`;
		return `${diff} second${diff === 1 ? "" : "s"} ago`;
	}
	let minutes = Math.floor(diff / 60);
	if (minutes < 60) {
		if (short) return `${minutes}m ago`;
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	let hours = Math.floor(minutes / 60);
	if (hours < 24) {
		if (short) return `${hours}h ago`;
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	let days = Math.floor(hours / 24);
	if (short) return `${days}d ago`;
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

function groupByGame() {
	if (!TABLE.options.groupBy) {
		TABLE.setGroupBy("game");
		TABLE.setSort([
			{column: `ev`, dir: "desc"},
			{column: "start", dir: "asc"},
		])
	} else {
		TABLE.setGroupBy();
		TABLE.setSort([
			{column: `ev`, dir: "desc"}
		]);
	}
}

function resolveLink(url) {
	if (!url) return url;
	const state = CURR_USER?.metadata?.state || "ny";
	let link = state ? url.replaceAll("{state}", state) : url;
	if (link && url.includes("fanduel") && !url.includes(`${state}.sportsbook`)) {
		link = link.replace("sportsbook", `${state}.sportsbook`);
	}
	return link;
}

const evOddsFormatter = function(cell) {
	const data = cell.getRow().getData();
	const odds = cell.getValue();

	if (!odds) return "";
	if (data.blurred) return `<div class='blurred'>${odds}</div>`;

	const field = cell.getField();
	let link = null;
	if (data.links && field.startsWith("bookOdds.")) {
		const book = field.split(".")[1];
		link = resolveLink(data.links[book]) || null;
	}

	// Build odds display (highlight +EV side)
	let res = odds;
	const idx = data.under ? 1 : 0;
	if (data.ev && data.ev >= 0 && parseInt(odds.split("/")[idx]) >= parseInt(data.fairVal || 0)) {
		const cls = "#00ff66";
		if (odds.includes("/")) {
			let [o,u] = odds.split("/");
			res = data.under
				? `<span>${o}</span>/<span style='color:${cls}'>${u}</span>`
				: `<span style='color:${cls}'>${o}</span>/<span>${u}</span>`;
		} else {
			res = `<span style='color:${cls}'>${odds}</span>`;
		}
	}

	// Liquidity tip: hover on desktop, tap on mobile
	const bookKey = field.startsWith("bookOdds.") ? field.split(".")[1] : null;
	const liq = bookKey ? data.liquidity?.[bookKey] : null;
	if (Array.isArray(liq) && liq.length >= 2) {
		res = `<span class="liq-host" onclick="if(typeof MOBILE!=='undefined'&&MOBILE){event.stopPropagation();this.classList.toggle('liq-open');}"><span class="liq-odds">${res}</span><span class="liq-tip">$${liq[0]}/$${liq[1]}</span></span>`;
	}

	if (link) {
		return `<div style="position:relative;display:inline-block;width:100%;">
			${res}
			<a href="${link}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
				style="position:absolute;bottom:0px;right:0px;font-size:10px;font-weight:700;line-height:1;text-decoration:none;color:#6b7280;" title="Add to betslip">+</a>
		</div>`;
	}
	return res;
}

const oddsFormatter = function(cell) {
	let odds = cell.getValue();
	if (!odds) {
		return "";
	}
	if (odds.includes("/")) {
		let [o,u] = odds.split("/");
		return `<div>
		<mfrac>
			<mn>${o}</mn>
			<mn>${u}</mn>
		</mfrac></div>`;
	} else {
		return odds;
	}
}

const sportFormatter = function(cell) {
	let sport = "";
	if (cell.getValue() == "nba") {
		sport = "🏀";
	} else if (cell.getValue() == "mlb") {
		sport = "⚾";
	} else if (cell.getValue() == "nhl") {
		sport = "🏒";
	}
	return `<div>${sport}</div>`;
}

const percentFormatter = function(cell, params, rendered) {
	if (!cell.getValue()) {
		if (["tds", "nfl"].includes(PAGE) && cell.getRow().getData().logs.length != 0) {
			return "0%";
		}
		return "";
	}
	if (cell.getRow().getData().blurred) {
		return "<div class='blurred'>"+cell.getValue()+"</div>";
	}
	return cell.getValue()+"%";
}

const percentFormatterLYR = function(cell, params, rendered) {
	if (!cell.getValue()) {
		return "";
	}
	if (cell.getRow().getData().blurred) {
		return "<div class='blurred'>"+cell.getValue()+"</div>";
	}
	return cell.getValue()+"%";
}

const decimalFormatter = function(cell) {
	if (!cell.getValue()) {
		return "";
	}
	return parseFloat(cell.getValue()).toFixed(2);
}

function addPlus(value) {
	if (parseFloat(value) > 0) {
		return "+"+value;
	}
	return value;
}

const pitchMap = {
	CH: "Changeup",
	CU: "Curveball",
	FC: "Cutter",
	EP: "Eephus",
	FO: "Forkball",
	FF: "Fastball",
	KN: "Knuckleball",
	KC: "Knuckle-curve",
	SC: "Screwball",
	SI: "Sinker",
	SL: "Slider",
	SV: "Slurve",
	FS: "Splitter",
	ST: "Sweeper",
	CS: "Circle Change"
};

const pitchFormatter = function(cell) {
	const data = cell.getRow().getData();
	const pitch = cell.getValue();
	return `
	<div class="mix-cell">
		${pitchMap[pitch]}
		<span class="right">${data.pitch_num || ""}</span>
	</div>`;
}

function getMixField(field) {
	if (field == "hr") {
		return "home_run";
	} else if (field == "hh") {
		return "is_hard_hit";
	} else if (field == "brl") {
		return "is_barrel";
	}
	return field;
}

const mixFormatter = function(cell) {
	const data = cell.getRow().getData();
	const pitchNum = cell.getField().split("_")[0];
	let field = getMixField(cell.getField().split("_")[1]);
	const pitch = data[pitchNum+"_type"];
	const left = data.pitch.l[pitch][field] || 0;
	const right = data.pitch.r[pitch][field] || 0;

	return `
		<div class="mix-cell">
			<span>${cell.getValue() || 0}</span>
		</div>
	`;
}

const mixFormatter2 = function(cell) {
	const data = cell.getRow().getData();
	const pitchNum = cell.getField().split("_")[0];
	let field = getMixField(cell.getField().split("_")[1]);
	const pitch = data[pitchNum+"_type"];
	const left = data.pitch.l[pitch][field] || 0;
	const right = data.pitch.r[pitch][field] || 0;
	return `
		<div class="mix-cell">
			<span class="left">${left}</span>
			<span class="right">${right}</span>
			<span>${cell.getValue() || 0}</span>
		</div>
	`;
}

const allowedFormatter = function(cell) {
	const data = cell.getRow().getData();
	const [which, field] = cell.getField().split(".");

	if (data.blurred) {
		return `<div class="blurred">${cell.getValue()}</div>`
	}

	let percent = "";
	let p = "";
	if (PAGE == "ranks" && !data[which]) {
		return "";
	}
	let percentile = data[which][field+"_percentile"];
	if (field == "hr_pa") {
		p = "_rate";
		//percent = "%";
		percentile = data[which]["hr_rate_percentile"];
	}
	const color = getPercentileColor(field, percentile);
	const left = data[which][`hr_l${p}`] || 0;
	const right = data[which][`hr_r${p}`] || 0;

	const leftColor = getPercentileColor(`hr_l${p}`, data[which][`hr_l${p}_percentile`]);
	const rightColor = getPercentileColor(`hr_r${p}`, data[which][`hr_r${p}_percentile`]);
	return `
		<div class="mix-cell">
			<span class="left" style="color:${leftColor}">${left}${percent}</span>
			<span class="right" style="color:${rightColor}">${right}${percent}</span>
			<span style="color:${color}">${cell.getValue() || 0}${percent}</span>
		</div>
	`;
}

function getPitchPercentileColor(value) {
	if (!value) return "";
	// bright green
	if (value >= 90) return '#00ff66';
	if (value >= 80) return '#33cc66';
	if (value >= 60) return '#66cc99';
	if (value >= 55) return '#aaaaaa';
	if (value >= 50) return '#e57373';
	if (value >= 30)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const pitchPercentileFormatter= function(cell) {
	const data = cell.getRow().getData();
	let avg = cell.getValue();
	let field = cell.getField();
	if (field.includes("rate")) {
		avg += "%";
	} else if (["hr"].includes(field)) {
		avg = cell.getValue();
	} else {
		avg = avgFormatter(cell);
	}
	const percentile = data[cell.getField()+"_pct"];
	const color = getPitchPercentileColor(percentile);
	return `
		<div style="color: ${color}">
			${avg}
		</div>
	`;
}

const avgFormatter = function(cell) {
	let v = cell.getValue();
	if (v === "-") {
		return "-";
	}
	v = parseFloat(v);
	if (!Number.isFinite(v)) {
	  return "";
	}
	if (v === 0) {
		return ".000";
	}
	// Keep values >= 1 fully intact, slice only if < 1
	return v < 1 ? String(v.toFixed(3)).slice(1) : v.toFixed(3);
};

const eraFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v <= 3.50) {
		cls = "negative";
	} else if (v >= 4.50) {
		cls = "positive";
	}
	return `<div class="${cls}">${cell.getValue()}</div>`;
}

const lastDiffFormatter = function(cell) {
	const data = cell.getRow().getData();
	let diff = cell.getValue();
	if (!diff) {
		return "0";
	}
	diff = diff.toFixed(1);
	if (data.blurred && cell.getField() == "homerLogs.pa.z") {
		return `<div class='blurred'>${diff}</div>`;
	}
	if (diff > 0) {
		return `<div class="positive">+${diff}</div>`;
	}
	return `<div class="">${diff}</div>`;
}

const gapFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `${cell.getValue()}`;
}

function getPercentileColor(field, value) {
	if (!value) return "";
	if (["preview", "preview_k"].includes(PAGE) && ["barrel_batted_rate", "hard_hit_percent", "sweet_spot_percent", "p_swinging_strike", "pull_percent", "blasts_swing", "squared_up_swing", "avg_swing_speed", "on_base_plus_slg"].includes(field)) {
		value = 100 - value;
	} else if (field.includes("pitcherData") && ["barrel_batted_rate", "hard_hit_percent", "sweet_spot_percent", "on_base_percent", "slg_percent", "on_base_plus_slg"].includes(field.split(".").at(-1))) {
		value = 100 - value;
	} else if ((field.includes("savant") || PAGE == "barrels") && (["avg_swing_speed", "blasts_swing", "meatball_percent", "ba", "on_base_percent", "slg_percent", "on_base_plus_slg"].includes(field.split(".").at(-1)))) {
		value = 100 - value;
	}
	// bright green
	if (value >= 95) return '#00ff66';
	if (value >= 80) return '#33cc66';
	if (value >= 60) return '#66cc99';
	if (value >= 40) return '#aaaaaa';
	if (value >= 20) return '#e57373';
	if (value >= 5)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const percentileFormatter = function(cell) {
	const data = cell.getRow().getData();
	let field = cell.getField();

	if (data.blurred && !["barrels_per_bip", "hard_hit_percent"].includes(field)) {
		return `<div class='blurred'>${cell.getValue()}</div>`;
	}

	if (!cell.getValue()) {
		if (["game_trends.barrels_per_bip.5G", "game_trends.hard_hit_percent.5G"].includes(field)) {
			return "0";
		}
		return `<div class="negative">0</div>`;
	}

	let cls = "";
	let percentile = data[field+"Percentile"];
	if (["savant", "pitcherData"].includes(field.split(".")[0])) {
		let [_,k] = field.split(".");
		if (field.includes("savant")) {
			percentile = data["savant"][k+"Percentile"];
		} else {
			percentile = data["pitcherData"][k+"Percentile"];
		}
	} else if (field.includes("percs.")) {
		let [_,p] = field.split(".");
		if (field == "percs.hr_pa") {
			p = "hr_rate";
		}
		percentile = data["percs"][p+"_percentile"];
	} else if (field.includes(".")) {
		let [_,k,p] = field.split(".");
		percentile = data["game_trends"][k][p+"Percentile"];
	} else if (field == "pitcherHR_PA") {
		percentile = data["pitcher_hr_rate_percentile"];
	} else if (["hr_pa", "hr_l", "hr_r", "hr_l_rate", "hr_r_rate", "home_run"].includes(field)) {
		percentile = data[`${field}_percentile`];
	} else if (PAGE == "barrels" && field == "on_base_plus_slg") {
		percentile = data.batter_percs[`${field}_percentile`];
	}

	const color = getPercentileColor(field, percentile);
	if (percentile >= 80) {
		cls = "positive";
	} else if (percentile <= 20) {
		cls = "negative";
	}
	cls = "";
	let v = "";

	if (TOGGLE_PERCENTILE) {
		v = `${addSuffix(percentile)}`;
	} else {
		let suffix = "";
		if (field.includes("distance")) {
			suffix = " ft";
		} else if (field.includes("percent") || ["barrels_per_bip", "barrel_batted_rate", "hr_pa", "hr_l_rate", "hr_r_rate", "pitcherHR_PA"].includes(field.split(".").at(-1))) {
			suffix = "%";
		}
		v = `${cell.getValue()}${suffix}`;
	}

	if (field.includes("on_base") || field.includes("slg") || ["savant.ba"].includes(field)) {
		v = parseFloat(v.replace("%", "")).toFixed(3).replace(/^0/, "");
	}
	return `
		<div class="${cls}" style="color:${color}">${v}</div>
	`;
}

const blurCircaFormatter = function(cell) {
	if (!cell.getRow().getData().circa_blurred) {
		return cell.getValue();
	}
	return `<div class="blurred">${cell.getValue()}</div>`;
}

const blurFormatter = function(cell) {
	if (!cell.getRow().getData().blurred) {
		return cell.getValue();
	}
	return `<div class="blurred">${cell.getValue()}</div>`;
}

const thresholds = {
	"exit_velocity_avg": [87.6, 90.8],
	"la": [0, 26],
	"evo": [0, 95],
	"dist": [0, 300],
	"hard_hit_percent": [35.5, 45.5],
	"barrel_batted_rate": [5.7,11.6],
	"barrels_per_bip": [5.7,11.6],
	"sweet_spot_percent": [29.4, 39.1],
	"flyballs_percent": [20.7, 32.4],
	// strikeout
	"k_percent": [18.5, 26.3],
	"whiff_percent": [22.2, 29],
	"oz_swing_miss_percent": [38.5, 51.6],
	"z_swing_miss_percent": [13.5, 21],
	"oz_contact_percent": [48, 60.6]
};

const summaryFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	let field = cell.getField();
	if (field.includes(".")) {
		field = field.split(".")[1];
	}
	let switched = ["oz_contact_percent"].includes(field);
	if (thresholds[field]) {
		if (thresholds[field][0] && v <= thresholds[field][0]) {
			cls = switched ? "positive" : "negative";
		} else if (field == "la") {
			if (isBarrel(data)) {
				cls = switched ? "negative" : "positive";
			}
		} else if (v >= thresholds[field][1]) {
			cls = switched ? "negative" : "positive";
		}
	}
	const p = (field.includes("rate") || field.includes("percent") || field.includes("barrel")) ? "%" : "";
	let suffix = field == "dist" ? " ft" : "";
	if (field.includes("rate") || field.includes("percent") || field.includes("barrel")) {
		suffix = "%";
	}
	if (data.blurred) {
		cls = "blurred";
	}

	if (field == "la") {
		suffix += "°";
	}
	return `<div class="${cls}">${cell.getValue()}${suffix}</div>`;
}

const laFormatter = function(cell) {
	return cell.getValue()+"°";
}

const baFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v < .250) {
		cls = "negative";
	} else if (v >= .300) {
		cls = "positive";
	}
	return `<div class="${cls}">${v.toFixed(3).replace(/^0/, "")}</div>`;
}

const xwobaFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v < .310) {
		cls = "negative";
	} else if (v >= .370) {
		cls = "positive";
	}
	return `<div class="${cls}">${v.toFixed(3).replace(/^0/, "")}</div>`;
}

const bppPlayerFormatter = function(cell) {
	const data = cell.getRow().getData();
	const val = parseFloat(cell.getValue());
	let cls = "";
	if (val >= 1.01) {
		cls = "positive";
	} else if (val < 0.90) {
		cls = "negative";
	}
	return `
		<div class="${cls}">
			${cell.getValue()}
		</div>
	`;
}

function getHRFactorColor(pct) {
	if (pct == null) return "";
	if (pct >= 20)  return '#00ff66'; // elite boost
	if (pct >= 10)  return '#33cc66'; // strong boost
	if (pct >= 5)   return '#66cc99'; // mild boost
	if (pct > 0)    return '#99ffcc'; // slight boost
	if (pct >= -1)  return '#aaaaaa'; // neutral
	if (pct >= -4)  return '#e57373'; // slight suppress
	if (pct >= -9)  return '#e53935'; // mild suppress
	if (pct >= -19) return '#d32f2f'; // strong suppress
	return '#ff0000';                  // extreme suppress
}

const bppFormatter = function(cell) {
	const data = cell.getRow().getData();
	const val = parseInt(cell.getValue().replace("%", ""));
	const color = getHRFactorColor(parseInt(cell.getValue()));
	let cls = "";
	if (val >= 10) {
		cls = "positive";
	} else if (val <= -10) {
		cls = "negative";
	}
	return `
		<div style="color: ${color}">
			${cell.getValue()}
		</div>
	`;
}

const impliedFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!cell.getValue()) {
		return "";
	}
	let cls = "";
	//const cls = data.mostLikely == cell.getField().split(".").at(-1) ? "positive" : "";
	return `
		<div class="${cls}">
			${(parseFloat(cell.getValue())).toFixed(1)}%
		</div>
	`;
}

const oppFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}

	const ah = `<span style="width: 12px;text-align:center;">
		${data.game.split(" @ ")[0] != cell.getValue() ? "@" : "v"}
	</span>`;
	let team = data.oppId || data.opp;
	let sport = data.sport || SPORT;
	if (params.prop == "k" || params.is_pitcher || sport.includes("ncaa") || sport == "nhl" || sport == "nba" || sport == "wnba") {
		let t = team?.toUpperCase() || "";
		return `<div class="opp-cell">
			${ah}
			${getTeamImg(sport, team)}
			${t}
		</div>`;
	}
	let pitcher = "";
	if (PAGE == "preview") {
		pitcher = cell.getValue().toUpperCase();
	} else if (PAGE == "tds" || PAGE == "nfl") {
		pitcher = data.opp.toUpperCase();
	} else if (data.pitcher) {
		pitcher = MOBILE || params.lastName ? title(data.pitcher).split(" ")[1] : title(data.pitcher);
	}
	const badge = data.doubleheader || data.team?.includes("gm2") ? 
		"<span class='dbl-badge'>2</span>" : "";
	const gameContainer = badge ? `<div style='position:relative;'>${badge}${getTeamImg(sport, team)}</div>` : `${getTeamImg(sport, team)}`;
	let pitcherLR = data.pitcherLR || "";
	return `
		<div class="opp-cell" aria-label="${data.pitcherSummary}">
			${ah}
			${gameContainer}
			${pitcher}
			<div class="bats">${pitcherLR}</div>
		</div>
	`;
}

const feedPitcherFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	return `<div class="opp-cell">
			${title(cell.getValue()?.split(" ").at(-1))}
		<span class="bats">${data.p_throws || ""}</span>
		</div>`;
}

const pitcherFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}

	let cls = data.blurred ? "blurred" : "";
	let [a,h] = data.game.split(" @ ");

	let opp = data.opp;
	if (!opp) {
		opp = a == data.team ? h : a;
	}

	const ah = `<span style="width: 12px;text-align:center;">
		${data.game.split(" @ ")[0] != data.team ? "@" : "v"}
	</span>`;
	return `<div class="opp-cell ${cls}">
			${getTeamImg(SPORT, opp.replace("-gm2", ""))}
			${title(cell.getValue()?.split(" ").at(-1))}
		<span class="bats">${data.pitcherLR || ""}</span>
		</div>`;
}

function addSuffix(num) {
	let j = num % 10, k = num % 100;
	
	if (j == 1 && k != 11) return num + "st";
	if (j == 2 && k != 12) return num + "nd";
	if (j == 3 && k != 13) return num + "rd";
	return num + "th";
}

function getZColorRed(value) {
	if (!value) return "";
	if (value >= 2.0) return '#00ff66'; // bright green
	if (value >= 1.5) return '#33cc66'; // medium green
	if (value >= 1.0) return '#66cc99'; // light green
	if (value >= 0) return '#99ffcc';
	return '#aaaaaa';
}

function getZColor(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const f = parseFloat(value);
  const v = Number(value);

  // Lightness values (kept in readable range for dark bg)
  const L0 = 82; // near 0
  const Lmax = 46; // at |2|

  if (f >= -0.24 && f <= -0.1) {
	return "";
  }

  if (f >= -0.1) {
	// Clamp positives 0–2 → blue scale
	const clamped = Math.min(2, v);
	const L = L0 + (Lmax - L0) * (clamped / 2);
	return `hsl(210 100% ${L}%)`; // Blue
  } else {
	// Clamp negatives [0 → -1] → Orange
	const clamped = Math.max(-1, v); // don’t go below -1
	const L = L0 + (Lmax - L0) * (Math.abs(clamped) / 1); 
	return `hsl(30 100% ${L}%)`; // Orange
  }
}

// optional: readable text color on dark background
function pickTextForLightness(lightness) {
  return lightness >= 62 ? '#0b1220' : '#ffffff'; // dark text on very light cells
}

const homerLogFormatter = function(cell) {
	const data = cell.getRow().getData();
	const field = cell.getField();

	if (data.blurred) {
		return `<div class='blurred'>${cell.getValue()}</div>`;
	}
	if (field.split(".").at(-1).substr(0, 1) != "z") {
		return cell.getValue();
	}

	let z = cell.getValue();
	if (!z) return "0.0";

	z = z.toFixed(1);
	if (z > 0) {
		z = "+"+z;
	}

	const color = getZColor(parseFloat(cell.getValue()));
	return `<div style="color:${color};font-weight:600;">${z}</div>`;

	return `<div>${z}</div>`;
}

function getOppRankColor(value) {
	if (!value) return "";
	if (value >= 27) return '#ff0000';
	if (value >= 22) return '#e53935';
	if (value >= 16) return '#e57373';
	if (value >= 11) return '#aaaaaa';
	if (value >= 6) return '#66cc99';
	if (value >= 2)  return '#33cc66';
	return '#00ff66'; // very low percentile
}

function getTDsOppRankColor(value) {
	if (!value) return "";
	if (value >= 27) return '#00ff66';
	if (value >= 22) return '#33cc66';
	if (value >= 16) return '#66cc99';
	if (value >= 11) return '#aaaaaa';
	if (value >= 6) return '#e57373';
	if (value >= 2)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const stadiumRankFormatter = function(cell) {
	const data = cell.getRow().getData();
	const color = getOppRankColor(data.stadiumRank);
	let cls = "";
	if (data.blurred) {
		cls = "blurred";
	}
	const leftRank = data.stadiumRankLeft;
	const rightRank = data.stadiumRankRight;
	return `
	<div class='mix-cell ${cls}'>
		<div style="color: ${color}">${cell.getValue()}</div>
		<div class="left" style="color: ${getOppRankColor(data.stadiumRankLeft)}">${leftRank}</div>
		<div class="right" style="color: ${getOppRankColor(data.stadiumRankRight)}">${rightRank}</div>
	</div>
	`;
}

const rankingFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const field = cell.getField();
	if (!data.game || !cell.getValue()) {
		return "";
	}
	if (field == "oppRank" || ["nba", "nhl"].includes(SPORT)) {
		let cls;
		//cls = data.oppRankClass;
		if (data.blurred) {
			cls = "blurred";
		}
		let value = cell.getValue();
		let color;
		if (PAGE == "nfl") {
			const keys = {
				pass_yds: "opp-pass-yds",
				rec_yds: "opp-pass-yds",
				rush_yds: "opp-rush-yds",
				rec: "opp-cmp",
				pass_cmp: "opp-cmp",
				pass_td: "opp-pass-td",
				pass_att: "opp-pass-att",
				rush_att: "opp-rush-att"
			};
			let key = keys[data.prop];
			if (!key || !value[key]) {
				return "";
			}
			value = value[key]["rank"];
			color = getTDsOppRankColor(value);
		} else if (PAGE == "tds") {
			if (value[params.key] === undefined || data.player.includes("d/st")) {
				return "";
			}
			if (params.key == "home-away") {
				const ha = data.team == data.game.split(" ")[0] ? "home" : "away";
				value = value[params.key][ha];
			} else {
				value = value[params.key]["rank"];	
			}
			color = getTDsOppRankColor(value);
		} else if (["nhl", "nba"].includes(SPORT)) {
			color = getTDsOppRankColor(value);
		} else {
			color = getOppRankColor(value);
		}
		
		return `<div class='${cls}' style='color: ${color}'>${addSuffix(value)}</div>`;
	} else {
		if (data.team == "ath") {
			return "";
		}
		let cls = "";
		const color = getOppRankColor(data.stadiumRank);
		if (data.stadiumRank <= 10) {
			cls = "positive";
		} else if (data.stadiumRank >= 20) {
			cls = "negative";
		}
		cls = "";
		if (data.blurred) {
			cls = "blurred";
		}
		return `<div class='${cls}' style='color: ${color}'>${addSuffix(cell.getValue())}</div>`;
	}
}

const plusMinusFormatter = function(cell) {
	let ev = cell.getValue();
	if (parseFloat(ev) > 0) {
		ev = "+"+ev;
	}
	return ev;
}

const inningFormatter = function(cell) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}
	const icon = data.game.split(" @ ")[0] == data.team ? "▲" : "▼";
	return `
		<div style='display: flex;justify-content:center;align-items:center;gap:1px'>
			<span style='font-size: 0.5rem;margin-bottom:-2px;'>${icon}</span>
			${data.in}
		</div>
	`;
}

const evMutFormatter = function(cell) {
	const data = cell.getRow().getData();
	//const ev = cell.getValue();
	const pre = BOOK ? `${BOOK}_` : "";
	const ev = data[`${pre}ev`];
	if (ev === undefined) {
		return "";
	}
	if (parseFloat(ev) > 0) {
		return `<div class="positive">+${ev}%<div>`
	}
	return ev+"%";
}

const evFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let ev = cell.getValue();
	if (!ev || data.prop == "separator") return "";
	let cls = "";
	if (parseFloat(ev) > 0) {
		ev = "+"+ev;
		cls = "positive";
	}
	let ou = data.ou || data.daily?.ou || "";
	return `
		<div class='ev-cell'>
			<span class='ev ${cls}'>${ev}%</span>
			<span class='ou'>${ou}</span>
		</div>
	`;
}

const bvpFormatter = function(cell) {
	const data = cell.getRow().getData();

	let cls = "";
	if (data.blurred && !["bvp"].includes(PAGE)) {
		cls = "blurred";
	}
	return `
		<div class="bvp-cell ${cls}">
			<div class="bvp-pitcher">${title(data.pitcher).split(" ")[1]}</div>
			<div class="bvp-value">${cell.getValue()}</div>
		</div>
	`;
}

const hitRateFormatter = function(cell) {
	const data = cell.getRow().getData();
	const value = cell.getValue();
	if (!value?.p) return "";
	return `${value.p}%`;
}

const hedgeFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `$${data.hedge}`;
}

const hedgeBookFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `<div class='evbook-cell'>
		<span class='evbook-odds'>${data.hedgeLine}</span>
		<img class='book-img' src='logos/${data.book}.png' alt='${data.book}' title='${data.book}' />
	</div>`;
}

const bestBookFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const book = ["outliers", "atgs2"].includes(PAGE) ? data.outlierBook : data.book;
	let cls = data.blurred ? "blurred" : "";
	let line = data.line;
	if (["outliers", "atgs2"].includes(PAGE)) {
		line = data.outlierLine;
	}
	if (parseInt(line || 0) > 0) {
		line = `+${line}`;
	}
	const img = book ? `<img class='book-img' src='logos/${book.replace('kambi', 'parx').replace("hr_az", "hr").replace("hr_oh", "hr")}.png' alt='${book}' title='${book}' />` : "";
	
	// Get ROI color for vertical slice and W-L record
	let extra = "";
	let borderColor = 'transparent';
	const roiData = getRowROI(data);
	if (roiData !== null) {
		borderColor = roiToColor(roiData.roi);
		extra = `${roiData.wins}W-${roiData.losses}L`;
	}
	
	return `
		<div class='evbook-cell ${cls}' style='border-left: 2px solid ${borderColor};'>
			<span class='evbook-odds'>${line}</span>
			<span class='evbook-implied'>${extra}</span>
			${img}
		</div>
	`;
}

const evBookFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator" || !cell.getValue()) return "";

	if (PAGE == "dingers") {
		params.book = BOOK;
	}
	if (PAGE == "hedge") {
		let line = data.line;
		if (line > 0) {
			line = "+"+line;
		}
		return `<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<img class='book-img' src='logos/${params.book}.png' alt='${params.book}' title='${params.book}' />
			</div>`;
	}

	if (PAGE == "derby") {
		let line = data.line;
		if (line > 0) {
			line = "+"+line;
		}
		return `<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<img class='book-img' src='logos/mgm.png' alt='dk' title='dk' />
			</div>`;
	}

	if (params.book && (!params.book.includes("vs-") || params.book.includes("-vs-circa") || params.book.includes("-vs-fd"))) {
		const book = params.book.split("-")[0];
		let line = data.bookOdds[book] || "0";
		if (line.includes("/")) {
			line = line.split("/")[0];
		}
		const lineInt = parseInt(line);
		let implied = -lineInt / (-lineInt + 100);
		if (lineInt > 0 && !line.includes("+")) {
			line = "+"+line;
			implied = 100 / (lineInt + 100);
		}
		implied = parseInt(implied * 100);
		return `
			<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<span class='evbook-implied'>${implied}%</span>
				<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />
			</div>
		`;
	}

	const book = cell.getValue().replace("kambi", "parx").replace("-50%", "");
	let line = data.line === undefined ? "-" : data.line;
	if (window.location.href.includes("stats") || window.location.href.includes("bvp")) {
		line = data.daily.odds;
	} else if (PAGE == "bets") {
		line = data.odds;
	}
	let lineInt = parseInt(line);
	let implied = -lineInt / (-lineInt + 100);
	if (lineInt > 0) {
		line = "+"+line;
		implied = 100 / (lineInt + 100);
	}
	implied = parseInt(implied * 100);
	let cls = "evbook-cell";
	if (data.blurred && ![PAGE].includes("dingers")) {
		cls += " blurred";
	}
	return `
		<div class='${cls}'>
			<span class='evbook-odds'>${line}</span>
			<span class='evbook-implied'>${implied}%</span>
			<img class='book-img' src='logos/${book.replace("hr_az", "hr").replace("hr_oh", "hr")}.png' alt='${book}' title='${book}' />
		</div>
	`;
}

function convertProp(prop) {
	prop = prop
		.replace("single", "1b").replace("double", "2b").replace("triple", "3b")
		.replace("pts+", "p+").replace("+ast", "+a").replace("+reb", "+r")
	return prop.toUpperCase();
}

const propFormatter = function(cell) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const ou = data.under ? "u" : "o";
	if (["playoffs", "roty", "mvp", "division"].includes(data.prop)) {
		return data.under ? "No" : "Yes";
	} else if (data.prop == "rfi") {
		return data.under ? "NRFI" : "YRFI";
	} else if (["make_cut"].includes(data.prop)) {
		return data.under ? `MISS CUT` : "MAKE CUT";
	} else if (data.prop.includes("top_")) {
		return data.prop.toUpperCase().replace("_", " ");
	} else if (["atgs"].includes(data.prop)) {
		return data.under ? `u${data.prop.toUpperCase()}` : data.prop.toUpperCase();
	} else if (data.prop.includes("ml")) {
		return `${data.prop.toUpperCase()}`;
	} else if (data.prop.includes("total")) {
		return `${ou}${data.handicap}`;
	} else if (data.prop.includes("spread")) {
		let v = parseFloat(data.handicap);
		if (data.under) {
			v *= -1;
		}
		return v < 0 ? v : `+${v}`;
	}

	let prop = `${ou}${data.playerHandicap}`;
	if (!["team_wins"].includes(data.prop)) {
		prop += ` ${convertProp(data.prop)}`;
	}
	return prop;
}

const kellyFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	let dec = data.line / 100;
	if (data.line < 0) {
		dec = 100 / data.line;
	}
	let ev = params.circa ? data["vs-circa_ev"] : data.ev;
	const kelly = parseFloat(ev) / Math.abs(dec) / 4;
	if (KELLY_DOLLARS) {
		return `$${(kelly * getUnitSize()).toFixed(2)}`;
	}
	return `
		<div class='kelly-cell'>
			<div class='kelly'>${kelly.toFixed(2)}u</div>
			<div class='kelly-wager'>$${(kelly * getUnitSize()).toFixed(2)}</div>
		</div>
	`;
}

function formatKellyValue(kelly) {
	if (!kelly) return "";
	if (KELLY_DOLLARS) return `$${(kelly * getUnitSize()).toFixed(2)}`;
	return `${kelly.toFixed(2)}u`;
}

function toggleKellyDollars() {
	KELLY_DOLLARS = !KELLY_DOLLARS;
	const btn = document.getElementById('kelly-toggle-btn');
	if (btn) btn.textContent = KELLY_DOLLARS ? '$' : 'u';
	if (TABLE) TABLE.redraw(true);
	if (CURRENT_VIEW === "mobile" && typeof applyFilters === "function") applyFilters();
}

function initKellyToggle() {
	const col = TABLE?.getColumn("kelly");
	if (!col) return;
	const el = col.getElement();
	if (!el || el.querySelector('#kelly-toggle-btn')) return;
	const btn = document.createElement('button');
	btn.id = 'kelly-toggle-btn';
	btn.textContent = KELLY_DOLLARS ? '$' : 'u';
	btn.className = 'kelly-toggle';
	btn.title = 'Toggle units / dollars';
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		toggleKellyDollars();
	});
	el.querySelector('.tabulator-col-content').appendChild(btn);
}

const teamFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	return getTeamImg(SPORT, cell.getValue());
}

function getTeamImg(sport, team) {
	if (!team) {
		return "";
	}
	if (SPORT == "soccer") {
		const code = CUP_TEAMS[team.toLowerCase()];
		if (code) {
			return `<img class='team-img' src='logos/cup/${code}.png' alt='${code}' title='${team}' />`;
		}
	}
	return `<img class='team-img' src='logos/${sport.replace("ncaaf", "ncaab").replace("baseball_ncaa", "ncaab")}/${team.replace("-gm2", "")}.png' alt='${team}' title='${team}' />`;
}

function getBookImgs(books) {
	return books.map(book => book == "best" ? "" : `<img class='book-img' src='logos/${book.replace("hr_az", "hr").replace("hr_oh", "hr")}.png' alt='${book}' title='${book}' />`).join("");
}

const brlFormatter = function(cell) {
	const data = cell.getRow().getData();
	return isBarrel(data) ? "🏏" : "";
}

const hhFormatter = function(cell) {
	const data = cell.getRow().getData();
	return parseFloat(data.evo || "0") >= 95 ? "💥" : "";
}

const dtFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	if (!cell.getValue()) return "";
	let d = new Date(cell.getValue()+" 10:00");
	if (PLAYER || params.noYear) {
		return d.toLocaleDateString("en-US", {
			month: "short", day: "numeric"
		}).replace(", ", " '");
	} else {
		return d.toLocaleDateString("en-US", {
			month: "short", day: "numeric", year: "2-digit"
		}).replace(", ", " '");
	}
}

function getWindHTML(data) {
	if (!data.weather || !data.weather["wind speed"]) {
		return "";
	}
	if (data.roof) {
		return `Roof`;
	}
	let cond = data.weather["conditions"].toLowerCase().replace("mostlyclear", "clear").replace("mostlycloudy", "cloudy").replace("partlycloudy", "cloudy").replaceAll(" ", "_");
	if (cond == "breezy_and_mostly_cloudy") {
		cond = "breezy";
	} else if (cond == "possible_drizzle_and_breezy") {
		cond = "possible_drizzle";
	}
	return `
		<img class='weather' src='logos/weather/${cond}.png' alt='${data.weather["conditions"]}' title='${data.weather["conditions"]}'/>
		<span>${data.weather["wind speed"]}</span>
		<img class='wind' src='logos/wind-direction.png' alt='${data.weather["wind dir"]}' title='${data.weather["wind dir"]}' style='${data.weather["transform"]}' />
		<!-- <span>${data.weather["wind dir"]}</span> -->
		
	`;	
}

const windFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}

	let weather = data.weather;
	if (RES.weather) {
		weather = RES.weather[data.game];
	}

	if (!weather) return "";
	if (weather.wind == "roof") return `Roof`;

	return `
		<div>
			<img class="wind" src="logos/${weather.windLogo}" /> ${weather.wind} mph ${weather.temp}
		</div>
	`;
}

const ftFormatter = function(cell, params, rendered) {
	if (!cell.getValue()) {
		return "";
	}
	return cell.getValue()+" ft";
}

const playerFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const sport = params.sport || data.sport;
	let player = title(data.player);
	if (PLAYER) {
		player = title(PLAYER);
	}
	if (params.lastName || (MOBILE && cell.getTable().element.id == "table")) {
		player = player.split(" ");
		if (["Hernandez", "Lowe"].includes(player[player.length-1])) {
			player = player[0][0] + " " + player[player.length-1];
		} else if (data.player == "jaylin williams" && data.team == "okc") {
			player = "Jay Williams";
		} else if (data.player == "jalen williams" && data.team == "okc") {
			player = "Jal Williams";
		} else {
			player = player[player.length-1];
		}
	}

	if (sport && sport.includes("futures")) {
		if (data.prop == "team_wins") {
			return player.toUpperCase()+" Wins";
		} else if (["playoffs", "roty", "mvp", "division"].includes(data.prop)) {
			return `${player.toUpperCase()} ${title(data.prop)}`;
		}
		return player;
	}

	let team = SPORT.includes("ncaa") ? data.teamId : data.team;
	if (team == undefined) {
		team = "";
	}
	let isPlayerProp = true;

	if (player == "") {
		isPlayerProp = false;
		player = data.prop.replace("_", " ").toUpperCase();
		if (data.prop.includes("ml")) {
			const g = SPORT.includes("ncaa") ? title(data.game) : data.game.toUpperCase();
			player = data.under ? g.split(" @ ")[1] : g.split(" @ ")[0];
		} else if (data.prop == "total" && SPORT == "ncaab") {
			player = `Total (${data.gameId.toUpperCase()})`;
		} else if (data.prop == "total" && SPORT == "ncaaf") {
			player = `${data.gameId.toUpperCase()}`;
		} else if (data.prop.includes("away_total") || data.prop.includes("home_total")) {
			player = `${team.toUpperCase()} ${data.prop.replace("home_", "").replace("away_", "").toUpperCase()}`;
		} else if (data.prop.includes("spread")) {
			player = `${team.toUpperCase()} ${data.prop.toUpperCase()}`;
		} else if (data.prop.includes("corners")) {
			player = `${data.prop.toUpperCase()}`;
		} else if (["rfi", "gift"].includes(data.prop)) {
			player = "";
		}
	} else if (["movement"].includes(PAGE)) {
		isPlayerProp = false;
	}

	let prop = "";
	if (!["feed", "dingers", "dingers2", "recap", "strikeouts", "backfields", "tracker"].includes(PAGE) && !params.noProp) {
		prop = propFormatter(cell);
	}
	let gameContainer = "";
	if (isPlayerProp || ["feed", "dingers", "dingers2", "barrels"].includes(PAGE)) {
		let s = ["feed", "dingers", "dingers2", "barrels"].includes(PAGE) ? "mlb" : sport;
		if (s == "ncaaf") s = "ncaab";
		else if (s == "baseball_ncaa") s = "ncaab";
		let t = sport.includes("ncaa") ? data.teamId : data.team?.replace("-gm2", "");
		if (TEAM) {
			//t = TEAM;
		}
		let dbl = data.team?.includes("-gm2") ? "<span class='dbl-badge'>2</span>" : "";
		if (t) {
			if (SPORT == "soccer") {
				const code = CUP_TEAMS[t.toLowerCase()];
				if (code) {
					gameContainer = `<img class='team-img' src='logos/cup/${code}.png' alt='${code}' title='${t}' />`;
				}
			} else {
				gameContainer = `${dbl}<img class='team-img' src='logos/${s}/${t}.png' alt='${t}' title='${t}' />`;
			}
		}
	} else if (PAGE == "cup" && data.prop.includes("spread")) {
		gameContainer = getTeamImg(SPORT, data.team);
	} else {
		gameContainer = getGameImgs(data, params).join("");
	}
	let p = player.replace("TOTAL", "").replace("SPREAD", "");
	if (!params.fullName && p.length > 16) {
		p = p.substr(0,15)+"...";
	}
	let bats = data.bats?.replace("B", "S") || "";
	if (["pitcher_mix", "preview"].includes(PAGE)) {
		bats = data.pitch_hand;
	} else if (["pts", "nba", "threes", "kotc"].includes(PAGE)) {
		bats = data.avgMin;
	} else if (PAGE == "atgs") {
		bats = data.avgTOI;
	}
	let pos = "";
	if (["nba", "threes", "atgs", "ncaafprops", "kotc"].includes(PAGE)) {
		pos = data.pos;
	}
	let lineupCircles = "";
	const LINEUP_PROPS = ["1st_goal", "atgs", "sot", "shots", "ast", "score_ast", "tackles", "fouls"];
	if (PAGE == "cup" && LINEUP_PROPS.includes(data.prop) && (data.confirmed != null || data.starting != null)) {
		const color = data.starting ? "#4ade80" : "#475569";
		const dot = data.confirmed
			? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};vertical-align:middle;margin-left:4px;" title="${data.confirmed ? 'Confirmed' : 'Projected'} - ${data.starting ? 'Starting' : 'Not Starting'}"></span>`
			: `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:transparent;border:2px solid ${color};vertical-align:middle;margin-left:4px;" title="Projected - ${data.starting ? 'Starting' : 'Not Starting'}"></span>`;
		lineupCircles = dot;
	}
	return `
		<div class="player-cell">
			<div class='game-container'>${gameContainer}</div>
			${p}${lineupCircles} ${prop}
			<div class="bats">${bats || ""}</div>
			<div class="pos">${pos || ""}</div>
		</div>
	`
}

function getGoalieColor(key, val) {
	const v = parseFloat(val);
	if (Number.isNaN(v)) return "";

	if (key === "goalieSV") {
		if (v >= 0.915) return "color: #ff0000";
		if (v >= 0.905) return "color: #e57373";
		if (v <= 0.885) return "color: #00ff66";
		if (v <= 0.894) return "color: #33cc66";
	}

	if (key === "goalieGSAA") {
		if (v >= 10) return "color: #ff0000";
		if (v >= 4) return "color: #e57373";
		if (v <= -9) return "color: #00ff66";
		if (v <= -3) return "color: #33cc66";
	}

	return "";
}

const goalieFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let goalie = cell.getValue();
	if (goalie) {
		goalie = title(goalie).split(" ").at(-1);
	}
	let sv = "";
	if (data.goalieSV) {
		sv = `<div class="bats" style="${getGoalieColor('goalieSV', data.goalieSV)}">${data.goalieSV}</div>`;
	}
	let gsaa = "";
	if (data.goalieGSAA) {
		gsaa = `<div class="pos" style="${getGoalieColor('goalieGSAA', data.goalieGSAA)}">${data.goalieGSAA}</div>`;
	}
	return `
	<div class="goalie-cell">
		${goalie}
		${sv}
		${gsaa}
	</div>`;
}

const trendFormatter = function(cell, params, rendered) {
	const div = document.createElement("div");
	let val = cell.getValue();
	div.innerText = val;
	const data = cell.getRow().getData();
	let avgVal = data[cell.getField().replace("last", "").toLowerCase()];
	if (cell.getField() != "lastPts") {
		val = parseInt(val.replace("%", ""));
		avgVal = parseInt(avgVal.replace("%", ""));
	}
	if (data["lastSnap"].replace("%", "") != "0") {
		if (val > avgVal) {
			div.classList.add("positive");
		} else if (val < avgVal) {
			div.classList.add("negative");
		}
	}
	return div;
}

function getGameImgs(data, params) {
	let away = data.awayTeamId || data.game.split(" @ ")[0];
	let home = data.homeTeamId || data.game.split(" @ ")[1];
	if (SPORT == "soccer") {
		away = data.awayEspn?.short || data.game.split(" @ ")[0];
		home = data.homeEspn?.short || data.game.split(" @ ")[1];
	}
	if (!data.game) {
		return "";
	}
	let awayAlt = data.game.split(" @ ")[0].toUpperCase();
	let homeAlt = data.game.split(" @ ")[1].toUpperCase();
	if (SPORT.includes("ncaa")) {
		awayAlt = title(awayAlt);
		homeAlt = title(homeAlt);
	}
	if (SPORT == "soccer") {
		const awayCode = CUP_TEAMS[away.toLowerCase()];
		const homeCode = CUP_TEAMS[home.toLowerCase()];
		return [
			`<img class='game-img away' src='logos/cup/${awayCode || away.toLowerCase()}.png' alt='${awayAlt}' title='${awayAlt}' />`,
			`<img class='game-img home' src='logos/cup/${homeCode || home.toLowerCase()}.png' alt='${homeAlt}' title='${homeAlt}' />`
		];
	}
	let sport = params.sport || data.sport || SPORT;
	sport = sport.replace("dingers", "mlb").replace("k", "mlb").replace("feed", "mlb").replace("ncaaf", "ncaab").replace("baseball_ncaa", "ncaab").replace("atgs", "nhl");
	if (sport == "props") {
		sport = "nfl";
	}
	let badge1 = "", badge2 = "";
	if (data.game.includes("-gm2")) {
		badge1 = "<span class='dbl-badge'>2</span>";
		badge2 = "<span class='dbl-badge'>2</span>";
	}
	return [
		`${badge1}<img class='game-img away' src='logos/${sport}/${away.replace("-gm2", "")}.png' alt='${awayAlt}' title='${awayAlt}' />`,
		`${badge2}<img class='game-img home' src='logos/${sport}/${home.replace("-gm2", "")}.png' alt='${homeAlt}' title='${homeAlt}' />`
	];
}

const gameFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}
	const gameImgs = getGameImgs(data, params);
	let txt = "";
	if (params.text) {
		txt = ` ${data.game.toUpperCase()}`;
	}
	return `
		<div class='game-cell'>
			${gameImgs.join("")} ${txt}
		</div>
	`;
}

const lineFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const ou = data.under ? "u" : "o";
	return ou+cell.getValue();
}

const uppercaseFormatter = function(cell, params, rendered) {
	if (cell.getValue()) {
		return cell.getValue().toUpperCase();
	}
	return "";
}

function title(str) {
	if (!str) return "";
	return str.split(" ")
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

const titleFormatter = function(cell, params, rendered) {
	return title(cell.getValue());
}

const dtMutator = function(value) {
	return value.slice(0, -5);
}

function fetchFile(file, cb) {
	const url = "https://api.github.com/repos/dailyev/props/contents/static/"+file;
	fetch(url, {
		headers: { "Accept": "application/vnd.github.v3.raw" }
	}).then(response => response.json()).then(res => {
		cb(res)
	}).catch(err => console.log(err));
}

const chartFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const content = document.createElement("span");
	if (!cell.getValue()) {
		return "";
	}
	let values = typeof(cell.getValue()) == "string" ? cell.getValue().split(",") : cell.getValue();

	if (!cell.getField().includes("feed")) {
		values = values.slice(-15);
	}

	//if (params.invert) {
	//	values = values.map(val => val * -1);
	//}

	content.classList.add(params.type);
	content.innerHTML = values.join(",");

	const options = {
		width: 145
	}

	if (params.type == "line") {
		options.fill = "none";
		options.strokeWidth = 2;
		options.stroke = "#50fa7b";
	} else {
		options.fill = function(value) {
			let line = data.playerHandicap || data.handicap || data.daily.line || 0;
			if (cell.getField() == "feed.evo") {
				line = 100.0;
			} else if (cell.getField() == "feed.dist") {
				line = 300.0;
			}
			let cond = parseFloat(value) > parseFloat(line);
			if (data.under) {
				cond = parseFloat(value) < parseFloat(line);
			}
			return cond ? "rgb(56, 142, 60)" : "rgb(211, 47, 47)"
		}
	}

	rendered(function(){
		peity(content, params.type, options);
	});
	return content;
}

function plotMap(data, newX, newY) {
	const colors = newY.map(value => {
		let cond = parseFloat(value) > parseFloat(data.playerHandicap || data.handicap);
		if (data.under) {
			cond = parseFloat(value) < parseFloat(data.playerHandicap || data.handicap);
		}
		return cond ? "rgb(56, 142, 60)" : "rgb(211, 47, 47)";
	});
	const tableData = {
		x: newX,
		y: newY.map(v => v != "0" ? v : 0.25),
		type: "bar",
		text: newY,
		textposition: "inside",
		marker: {
			color: colors
		}
	};
	const layout = {
		title: "Game Logs",
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		dragmode: 'pan',
		margin: { l: 0, r: 0, t: 20, b: 20 },
		xaxis: {
			title: "Dates",
			showgrid: false,
			type: "category",
			rangeslider: {
				visible: true
			},
			range: [newX.length-15.6,newX.length-0.5]
		},
		yaxis: {
			showgrid: false,
			tickmode: "linear",
			dtick: 1,
			fixedrange: true,
			showticklabels: false,
			title: {
				text: data.prop.toUpperCase()
			}
		},
		shapes: [
			{
				type: "line",
				//x0: dtSplits[0], x1: dtSplits.at(-1),
				x0: -0.25, x1: newX.length,
				y0: data.playerHandicap || data.handicap, y1: data.playerHandicap || data.handicap,
				line: {
					color: "#5A5A5A",
					dash: "dash"
				}
			}
		]
	};
	Plotly.newPlot("log-chart", [tableData], layout, { responsive: true});
	setTimeout(() => {
		Plotly.Plots.resize("log-chart")
	}, 100);
}

function linearRegression(x, y) {
	let n = x.length;
	let sumX = math.sum(x);
	let sumY = math.sum(y);
	let sumXY = math.sum(x.map((xi, i) => xi * y[i]));
	let sumXX = math.sum(x.map(xi => xi * xi));

	let slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
	let intercept = (sumY - slope * sumX) / n;

	return { slope, intercept, predictedY: x.map(xi => slope * xi + intercept) };
}

function movingAverage(arr, windowSize) {
	return arr.map((val, idx, fullArr) => {
		let start = Math.max(0, idx-windowSize + 1);
		let subset = fullArr.slice(start, idx + 1);
		return subset.reduce((a,b) => a+b, 0) / subset.length;
	});
}

let FEED_DATA = [];
let FEED_PTHROWS = "all";
let FEED_BB = false;
let FEED_HAND = "both";
let FEED_ARSENAL_FILTER = new Set();

function filterFeedData(data) {
	let out = data;
	if (FEED_BB) {
		out = out.filter(row => parseFloat(row.evo || "0") > 0);
	}
	if (FEED_PTHROWS !== "all") {
		out = out.filter(row => (row.p_throws || "").toUpperCase() === FEED_PTHROWS);
	}
	if (FEED_ARSENAL_FILTER.size > 0) {
		out = out.filter(row => FEED_ARSENAL_FILTER.has(row.pitch_type));
	}
	return out;
}

function getFeedArsenal(pitcher) {
	const arsenal = RES?.arsenal?.[pitcher]?.arsenal?.[FEED_HAND] || [];
	return [...arsenal].sort((a, b) => b.pct - a.pct);
}

// "any" = no filter, full feed including pitches outside the arsenal.
// "all" = filter to any pitch in the pitcher's arsenal.
// "top3" = filter to just the pitcher's 3 most-used pitches.
function feedArsenalPreset(arsenal) {
	if (FEED_ARSENAL_FILTER.size === 0) return "any";
	const setEquals = types => types.length === FEED_ARSENAL_FILTER.size && types.every(t => FEED_ARSENAL_FILTER.has(t));
	if (setEquals(arsenal.map(p => p.pitch_type))) return "all";
	if (setEquals(arsenal.slice(0, 3).map(p => p.pitch_type))) return "top3";
	return "custom";
}

function renderFeedArsenal(pitcher, throws) {
	const el = document.getElementById("feed-arsenal");
	if (!el) return;
	if (!pitcher || !RES?.arsenal?.[pitcher]) {
		el.innerHTML = "";
		return;
	}
	const arsenal = getFeedArsenal(pitcher);
	const preset = feedArsenalPreset(arsenal);
	const handBtn = (hand, label) => `<button class="ps-btn hand-btn${FEED_HAND === hand ? " is-active" : ""}" data-hand="${hand}">${label}</button>`;
	const presetBtn = (p, label, tooltip) => `<button class="ps-btn preset-btn${preset === p ? " is-active" : ""}" data-preset="${p}" title="${tooltip}">${label}</button>`;
	el.innerHTML = `
		<div class="feed-arsenal-row">
			<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">${title(pitcher)} (${throws}) Top Pitches</div>
			<div class="batter-ps-toggle">
				${handBtn("both", "All")}
				${handBtn("vs_lhb", "LHB")}
				${handBtn("vs_rhb", "RHB")}
			</div>
		</div>
		<div class="feed-arsenal-row">
			<div style="font-size:10px;color:#6b7280;">click a pitch to filter the feed</div>
			<div class="batter-ps-toggle">
				${presetBtn("any", "Any", "Show every at-bat, including pitches outside this pitcher's arsenal")}
				${presetBtn("all", "All", "Only at-bats on a pitch in this pitcher's arsenal")}
				${presetBtn("top3", "Top 3", "Only at-bats on this pitcher's 3 most-used pitches")}
			</div>
		</div>
		<div class="feed-arsenal-chips">
			${arsenal.length ? arsenal.map(p => `<button class="ps-btn arsenal-chip${FEED_ARSENAL_FILTER.has(p.pitch_type) ? " is-active" : ""}" data-pitch="${p.pitch_type}">${pitchMap[p.pitch_type] || p.pitch_type} <span style="opacity:.65;">${p.pct.toFixed(1)}%</span></button>`).join("") : `<span style="font-size:11px;color:#6b7280;">No arsenal data.</span>`}
		</div>
	`;
}

function feedSetHand(hand) {
	FEED_HAND = hand;
	FEED_ARSENAL_FILTER = new Set();
	const data = TABLE.getSelectedRows()[0]?.getData();
	if (data) renderFeedArsenal(data.pitcher, data.pitcherLR);
	renderFeedTable(filterFeedData(FEED_DATA));
}

function feedSetArsenalPreset(preset) {
	const data = TABLE.getSelectedRows()[0]?.getData();
	if (!data) return;
	const arsenal = getFeedArsenal(data.pitcher);
	if (preset === "any") {
		FEED_ARSENAL_FILTER = new Set();
	} else if (preset === "all") {
		FEED_ARSENAL_FILTER = new Set(arsenal.map(p => p.pitch_type));
	} else if (preset === "top3") {
		FEED_ARSENAL_FILTER = new Set(arsenal.slice(0, 3).map(p => p.pitch_type));
	}
	renderFeedArsenal(data.pitcher, data.pitcherLR);
	renderFeedTable(filterFeedData(FEED_DATA));
}

function feedToggleArsenalPitch(pitchType) {
	if (FEED_ARSENAL_FILTER.has(pitchType)) {
		FEED_ARSENAL_FILTER.delete(pitchType);
	} else {
		FEED_ARSENAL_FILTER.add(pitchType);
	}
	const data = TABLE.getSelectedRows()[0]?.getData();
	if (data) renderFeedArsenal(data.pitcher, data.pitcherLR);
	renderFeedTable(filterFeedData(FEED_DATA));
}

function renderFeed(resetFilters = true) {
	const data = TABLE.getSelectedRows()[0].getData();
	let player = data.player;
	const nameEl = document.getElementById("feed-batter-name");
	if (nameEl) nameEl.textContent = title(player);
	if (resetFilters) {
		FEED_HAND = data.bats === "L" ? "vs_lhb" : data.bats === "R" ? "vs_rhb" : "both";
		FEED_ARSENAL_FILTER = new Set();
		FEED_PTHROWS = "all";
		FEED_BB = false;
		document.querySelectorAll("#feed-toggle [data-pthrows]").forEach(b => b.classList.toggle("is-active", b.dataset.pthrows === "all"));
		document.querySelectorAll("#feed-toggle [data-bb]").forEach(b => b.classList.remove("is-active"));
	}
	renderFeedArsenal(data.pitcher, data.pitcherLR);
	fetch(API_BASE+`/api/feed?team=${data.team}`, {
		headers: {
			Authorization: `Bearer ${ACCESS_TOKEN}`
		}
	}).then(
		response => response.json()
	).then(res => {
		const data = [];
		for (dt of Object.keys(res[player])) {
			let row = res[player][dt];
			let [y,m,d,p] = dt.split("-");
			row["id"] = dt;
			row["dt"] = `${y}-${m}-${d}`;
			row["player"] = player;
			data.push(row);
		}
		FEED_DATA = data;
		renderFeedTable(filterFeedData(data));
	});
}

function renderFeedTable(data) {
	let results = [...new Set(data.map(row => row.result))];
	FEED = new Tabulator("#chart", {
		tooltipsHeader: true,
		data: data,
		layout: "fitDataFill",
		initialSort: [
			//{column: "pa", dir: "desc"},
			{column: "dt", dir: "desc"},
		],
		groupHeader: function(value, count, data, group){
			return `<span style='color: #c8c3bc'>${value.toUpperCase()}</span>`;
		},
		columnDefaults: {
			resizable: false,
			headerSortStartingDir: "desc"
		},
		groupToggleElement: "header",
		columns: [
			{title: "", field: "dt", formatter: dtFormatter, formatterParams: {noYear: true}, hozAlign: "center"},
			{title: "Pitcher", field: "pitcher", headerFilter: "input", formatter: feedPitcherFormatter},
			{title: "Result", field: "result", width: MOBILE ? 70 : 85, editor:"input", headerFilter:"list",
				headerFilterParams:{
					values:["All", ...results]
				},
				headerFilterFunc: function(headerValue, rowValue) {
					if (headerValue == "All") {
						return true;
					}
					return rowValue === headerValue;
				}
			},
			{title: "Pitch<br><a target='new' href='https://www.mlb.com/glossary/pitch-types' onclick='event.stopPropagation()'>Types</a>", field: "pitch_type", hozAlign: "center",width: 40},
			{title: "Exit<br>Velocity", field: "evo", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, visible: MOBILE ? false : true, formatter: summaryFormatter},
			{title: "Launch<br>Angle", field: "la", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, visible: MOBILE ? false : true, formatter: summaryFormatter},
			{title: "Dist", field: "dist", hozAlign: "center", sorter: "number", formatter: summaryFormatter},
			{title: "HR/Park", field: "hr/park", hozAlign: "center", sorter: "number", width: 65},
			{title: "BRL", field: "brl", hozAlign: "center", width: 30, formatter: brlFormatter},
			{title: "HH", field: "hh", hozAlign: "center", width: 30, formatter: hhFormatter},
		],
		rowFormatter: function(row) {
			if (row.getData().result == "Home Run") {
				row.getCells().map(r => r.getElement().classList.add("homer"));
			}
		}
	});
}

function plotHRGap(showGames = false) {
	const data = TABLE.getSelectedData()[0];
	let dueData = PAGE == "atgs" ? data.due.g : data.homerLogs.pa;
	const abBtwn = PAGE == "atgs" ? data.due.g.btwn : data.homerLogs.pa.btwn;
	const maxAB = Math.max(...abBtwn);
	const counts = {};
	abBtwn.forEach(ab => {
		counts[ab] = (counts[ab] || 0) + 1
	});
	const arr = new Array(maxAB + 1).fill(0);
	Object.keys(counts).forEach(ab => {
		arr[ab] = counts[ab];
	});

	let x = Array.from({length: arr.length}, (_, i) => PAGE == "atgs" ? i : i+1);
	let y = arr;

	if (false) {
		x = [], y = [];
		for (ab of Object.keys(counts)) {
			y.push(ab);
			x.push(arr[ab]);
		}
	}
	const graph = {
		x: x, y: y,
		type: "bar",
		//orientation: "h"
	};
	let t = `${title(data.player)} Career PA Btwn HR`;
	let xAxisTitle = "PA btwn HR";
	if (PAGE == "atgs") {
		t = `${title(data.player)} Career Gm Btwn Goals`;
		xAxisTitle = "Gm btwn Goals"
	}
	let layout = {
		title: t,
		title: {
			text: t,
		},
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		dragmode: MOBILE ? 'pan' : "",
		margin: { l: 40, r: 0, t: 40, b: 40 },
		xaxis: {
			title: xAxisTitle,
			showgrid: false,
			//range: [0, 50],
			title: {
				text: xAxisTitle
			}
		},
		yaxis: {
			showgrid: false,
			//tickmode: "linear",
			//dtick: 1,
			//fixedrange: true,
			//showticklabels: false,
			title: {
				text: "Frequency"
			}
		},
		shapes: [
			{
				type: "line",
				x0: dueData.streak,
				x1: dueData.streak,
				y0: 0, y1: Math.max(...arr),
				line: {
					color: "#c388ff",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: dueData.med,
				x1: dueData.med,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: dueData.avg,
				x1: dueData.avg,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			}
		],
		annotations: [
			{
				x: dueData.streak,
				y: Math.max(...arr),
				text: `${dueData.streak} ${PAGE == "atgs" ? "GM" : "PA"}`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: dueData.med,
				y: Math.max(...arr) / 2,
				text: `${dueData.med} Median`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: dueData.avg,
				y: Math.max(...arr) / 4,
				text: `${dueData.avg} Avg`,
				showarrow: false,
				xanchor: "left"
			}
		]
	};
	Plotly.newPlot("chart", [graph], layout, { responsive: true, displayModeBar: false});
	setTimeout(() => {
		Plotly.Plots.resize("chart");
	}, 100);
}

const ecrFormatter = function(cell) {
	const data = cell.getRow().getData();
	const field = cell.getField();
	if (field == "ecr.rank_ecr") {
		return data.ecr.pos_rank;	
	}
	return data.pos_rank;
}

const plusFormatter = function(value) {
	if (value > 0 && !String(value).includes("+")) {
		return `+${value}`;
	}
	return value;
}

const diffFormatter = function(cell) {
	const data = cell.getRow().getData();
	let val = cell.getValue();
	let cls = "";
	if (parseInt(val) > 0) {
		cls = "positive";
		val = `+${val}`;
	} else if (parseInt(val) < 0) {
		cls = "negative";
	}
	return `<div class="${cls}">${val}</div>`;
}

const DEFAULT_FIELDS_ALL = [
	"ev", "fairVal", "implied", "kelly", "player", "book", "bookOdds_fd", "bookOdds_b365", "bookOdds_dk", "bookOdds_mgm", "bookOdds_cz", "bookOdds_fn", "bookOdds_hr", "bookOdds_br", "bookOdds_kambi", "bookOdds_pn", "bookOdds_circa", "order", "pitcher", "percs_hr_pa", "bvp", "bpp", "savant_exit_velocity_avg", "savant_barrels_per_bip", "pitcherData_flyballs_percent", "pitcherData_exit_velocity_avg", "pitcherData_barrel_batted_rate", "oppRank", "homerLogs_pa_streak", "homerLogs_pa_med", "homerLogs_pa_z_median", "weather",
	"stadiumRank", "stadiumRankLeft", "stadiumRankRight", "batter_percs_hr_pa", "batter_percs_home_run"
];

const DEFAULT_SHARED = [
	"ev", "book", "player", "fairVal", "implied", "kelly", "opp",
	"bookOdds_fd", "bookOdds_b365", "bookOdds_dk", "bookOdds_mgm", "bookOdds_cz", "bookOdds_fn", "bookOdds_hr", "bookOdds_br", "bookOdds_kambi", "bookOdds_pn", "bookOdds_circa", "bookOdds_espn", "bookOdds_bv", "bookOdds_bol", "bookOdds_fl", "bookOdds_re", "bookOdds_kal", "bookOdds_nv", "bookOdds_px", "logs", "hitRate", "hitRateLYR"
]
const DEFAULT_FIELDS = {
	dingers: [...DEFAULT_SHARED],
	tds: [...DEFAULT_SHARED, "oppRank"],
	atgs: [...DEFAULT_SHARED, "hitRateCareer", "oppRank", "dvpRank", "goalie", "ppLine"],
	nfl: [...DEFAULT_SHARED, "handicap", "oppRank"],
	nhl: [...DEFAULT_SHARED, "handicap", "oppRank", "dvpRank", "goalie", "ppLine"],
	strikeouts: [...DEFAULT_SHARED, "handicap", "oppRank", "hitRates_szn", "hitRates_lyr", "hitRates_L5", "hitRates_L10"],
	mlb: [...DEFAULT_SHARED, "handicap"],
	nba: [...DEFAULT_SHARED, "oppRank", "oppPosRank"]
};

function getNestedFields(defs, out = []) {
	defs.forEach(def => {
		if (def.columns) {
			getNestedFields(def.columns, out);
		} else if (def.field) {
			out.push(def.field);
		}
	});
	return out;
}

function parseWeightKey(key) {
	let [bookKey, weightKey] = key.split(";");
	if (!weightKey) {
		return "Mkt Avg";
	}
	let weights = weightKey.split("+");

	let totalWeight = weights.reduce((acc, val) => {
		return acc + parseFloat(val);
	}, 0);


	let raw = [], rawSet = new Set(), percs = [];
	weights.map((weight, idx) => {
		raw.push(weight);
		rawSet.add(weight);
		percs.push(Math.round(weight * 100 / totalWeight));
	});

	let text = "";
	if (bookKey.includes("only")) {
		text = "Only ";
	}

	const books = bookKey.replace("only+", "").split("+");
	text += `${books.map(book => book.toUpperCase()).join("/")}`;
	if (raw.length > 1 && rawSet.size == 1) {
		text += ` ${Math.round(100 / books.length)}% Equal`;
	} else {
		text += ` ${percs.map(p => p+"%").join("/")}`;
	}
	return text;
}

function setUrlParams(updates = {}) {
	let url = new URL(window.location.href);
	const params = new URLSearchParams(window.search);
	
	Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "") {
            params.delete(k);
        } else {
            params.set(k, String(v));
        }
    });
	const newUrl = `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
	history.pushState({}, '', newUrl);
	return newUrl;
}

function loadWeights() {
	DEVIG = DEVIG || CURR_USER.metadata[`${PAGE}-devig`] || "";
	if (DEVIG && DEVIG.includes("only+")) {
		DEVIG = DEVIG.replace("only+", "");
	} else if (DEVIG.includes(";")) {
		[DEVIG, WEIGHT] = DEVIG.split(";");
	}

	METHOD = METHOD || CURR_USER.metadata[`${PAGE}-method`] || "";
	if (METHOD) {
		document.getElementById("method-select").value = METHOD;
		loadHeatmapData();
		initDevPicker(getTopDevigs(BOOK || "best"));
		setUrlParams({method: METHOD});
	}

	if (!CURR_USER.metadata["weights"] || !Array.isArray(CURR_USER.metadata["weights"])) {
		CURR_USER.metadata["weights"] = [];
	}

	// legacy remove any old weights
	CURR_USER.metadata["weights"] = CURR_USER.metadata["weights"].filter(x => x.includes(";"));

	let userWeights = CURR_USER.metadata["weights"];

	// legacy to grab old saved devigs
	for (devig of (CURR_USER.metadata["custom_devigs"] || [])) {
		if (devig) {
			let newDevig = `${devig}${repeatOnes(devig)}`;
			if (!userWeights.includes(newDevig)) {
				userWeights.push(newDevig);
			}
		}
	}

	delete CURR_USER.metadata["custom_devigs"];

	if (document.getElementById("devig-display-text")) {
		document.getElementById("devig-display-text").textContent = parseWeightKey(`${DEVIG};${WEIGHT}`);
	} else {
		const customOption = document.getElementById("custom-devig-option");
		const devigSel = document.getElementById("devig-select");
		const fragment = document.createDocumentFragment();
		for (weight of userWeights) {
			const newOption = document.createElement("option");
			newOption.value = weight;
			newOption.textContent = parseWeightKey(weight);
			fragment.appendChild(newOption);
		}
		devigSel.insertBefore(fragment, customOption);
	}

	if (DEVIG) {
		reorderOddsColumns(BOOK, DEVIG);
	}
}

function showHideUserTable(loaded) {
	if (ENABLE_AUTH && CURR_USER && CURR_USER?.metadata) {
		if (!loaded && typeof parseWeightKey === 'function') {
			loadWeights();
		}
		if (!CURR_USER.metadata[PAGE]) {
			return;
		}
		const allowed = new Set(CURR_USER.metadata[PAGE]);
		const defs = TABLE.getColumnDefinitions();
		const nestedFields = getNestedFields(defs);

		nestedFields.forEach(field => {
			const metaKey = field.replace(/\./g, "_");
			if (!allowed.has(metaKey) && metaKey != "opp" && metaKey != "handicap" && metaKey != "prop" && !metaKey.includes("due")) {
				TABLE.getColumn(field)?.hide();
			} else {
				TABLE.getColumn(field)?.show();
			}
		});
	}
}

function closeOverlay() {
	document.querySelector("#overlay").style.display = "none";
	//showHideUserTable();
}

function openOverlay() {
	if (CURR_USER?.tier || "free" === "free") {
		//return;
	}
	const metadata = CURR_USER?.metadata || {};
	if (!metadata[PAGE]) {
		metadata[PAGE] = (typeof TABLE !== 'undefined' && TABLE)
			? TABLE.getColumns().filter(c => c.isVisible()).map(c => c.getField()).filter(Boolean).map(f => f.replaceAll('.', '_'))
			: DEFAULT_FIELDS[PAGE] || DEFAULT_SHARED;
		if (MOBILE) {
			metadata[PAGE] = metadata[PAGE].filter(x => x != "curr_kelly");
			metadata[PAGE] = metadata[PAGE].filter(x => x != "curr_implied");
		}
	}
	document.querySelector("#overlay").style.display = "flex";

	const items = document.querySelector("#items");
	//items.innerHTML = "";

	for (field of metadata[PAGE] || []) {
		const el = document.querySelector(`#custom_${field.replaceAll(".", "_")}`);
		if (el) {
			el.checked = true;
		}
	}

	const currentFavorites = new Set(getFavoriteDevigs());
	let customDevigs = getCustomDevigs().map(key => ({
		name: parseWeightKey(key),
		value: key,
		group: "custom"
	}));;
	let favorites = getFavoriteDevigs().map(key => ({
		name: parseWeightKey(key),
		value: key,
		group: "favorites"
	}));
	const allOptions = [...DEFAULT_DEVIGS, ...favorites, ...customDevigs.filter(opt => !currentFavorites.has(opt.value))];

	let customDevigSel = document.getElementById("custom-devig-select");
	customDevigSel.innerHTML = "<option disabled style='font-weight:bold; color:#ccc;'>Default</option>";

	for (opt of allOptions) {
		let o = document.createElement("option");
		o.value = opt.value;
		o.textContent = opt.name;
		customDevigSel.appendChild(o);
	}

	// legacy to transform saved devigs to new weighted
	// fd+circa -> fd+circa;1+1
	let oldCustomDevig = metadata[`${PAGE}-devig`] || "";
	if (oldCustomDevig && !oldCustomDevig.includes(";")) {
		oldCustomDevig += repeatOnes(oldCustomDevig);
	}
	customDevigSel.value = oldCustomDevig;
	if (typeof renderWeightSettings === "function") {
		renderWeightSettings();
	}
}

function repeatOnes(customDevig) {
	let repeat = "+1".repeat(customDevig.replace("only+", "").split("+").length - 1);
	return ";1"+repeat
}

function openCustomDevig() {
	// Available books (keep in sync with your data keys)
	const ALL_BOOKS = ["fd","dk","b365","mgm","espn","cz","fn","br","bv","hr","kambi","bol","pn","circa"];

	// build lightweight modal
	const wrap = document.createElement('div');
	wrap.id = 'custom-devig-modal';
	wrap.style.cssText = `
	position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
	background:rgba(0,0,0,.45);z-index:9999;
	`;
	const card = document.createElement('div');
	card.id = "custom-devig-card";
	card.style.cssText = `
	background:#111; color:#eee; border:1px solid #333; border-radius:10px;
	width:min(650px,92vw); max-height:90vh; overflow:auto; padding:16px 18px; box-shadow:0 10px 30px rgba(0,0,0,.4);
	`;
	card.innerHTML = `
	<h3 style="margin:0 0 8px">Custom Devig</h3>
	<div id="weighting-body" style="display:flex;gap: 20px;">
		<div style="display:flex;flex-direction:column;justify-content: center;align-items: center;gap:10px;">
			<div id="weight-chart-section" style="display: flex; justify-content: center;">
				<div id="weight-pie-chart" style="width:300px; height:300px;"></div>
			</div>
		</div>
		<div id="book-weight-inputs"></div>
	</div>

	<div style="display:flex;gap:8px;justify-content:flex-end">
		<button id="cd-apply">Add Devig</button>
		<button id="cd-equal">Equal</button>
		<button id="cd-clear">Clear</button>
		<button id="cd-cancel">Close</button>
	</div>
	`;

	wrap.appendChild(card);
	document.body.appendChild(wrap);

	if (typeof renderWeightSettings === 'function') {
		renderWeightSettings();
	}

	function closeModal() {
		wrap.remove();
		document.querySelector("#devig-select").value = DEVIG;
		changeFilter();
	}

	card.querySelector('#cd-cancel').onclick = closeModal;

	card.querySelector("#cd-clear").onclick = () => {
		clearWeights();
	}

	card.querySelector("#cd-equal").onclick = () => {
		equalWeights();
	}

	if (typeof saveWeights === 'function') {
		card.querySelector('#cd-apply').onclick = saveWeights;
	}
}

function fetchUpdated(repo="props", render=true) {
	const url = `https://api.github.com/repos/dailyev/${repo}/contents/updated.json`;
	fetch(url, {
		headers: { "Accept": "application/vnd.github.v3.raw" }
	}).then(response => response.json()).then(data => {
		if (repo == "lines") {
			data["dingers"] = data;
		}
		UPDATED = data;
		if (PAGE == "bvp") {
			initDatepicker(data["bvp"]);
		} else if (PAGE != "dingers") {
			const [datePart, timePart] = (data[PAGE] || data[SPORT]).split(" ");
			const formattedString = `${datePart}T${timePart.split(".")[0]}`;
			document.querySelector("#updated").innerText = `Updated: ${timeAgo(formattedString)}`;
		} else {
			// Dingers
			fetchData(render);
		}
	}).catch(err => console.log(err));
}

function getImpliedProbabilityFromOddsString(oddsString, legIndex) {
	if (!oddsString) return null;
	
	const isSplit = String(oddsString).includes('/');
	
	let token;
	if (isSplit) {
		token = String(oddsString).split('/')[legIndex];
	} else {
		if (legIndex === 1) return null;
		token = String(oddsString);
	}
	
	const num = Number(token);
	return isNaN(num) ? null : americanToImplied(num); 
}

function computeOutlierFromBookOdds(rowData) {
	const bookOdds = rowData.bookOdds;
	let bookFilter = document.getElementById("book-select").value;
	if (!bookOdds || (bookFilter && !bookOdds[bookFilter])) return { book: null, value: null, deviation: 0, pct: 0 };

	const legIndex = rowData.under ? 1 : 0;

	let entries, avgP;
	let excluded = getExcludedBooks();
	excluded.push("pn"); excluded.push("circa");

	if (REQUIRED.length > 0) {
		const hasAllRequired = REQUIRED.every(book => bookOdds[book]);
		if (!hasAllRequired) {
			return { book: null, value: null, deviation: 0, pct: 0 };
		}
	}

	if (DEVIG) {
		let p_devig;

		if (DEVIG.includes("+")) {
			const devigBooks = DEVIG.split("+");
			let sumImpliedP = 0;
			let count = 0;
			
			for (const book of devigBooks) {
				const oddsString = bookOdds[book];
				if (oddsString) {
					const p = getImpliedProbabilityFromOddsString(oddsString, legIndex);
					if (p != null) {
						sumImpliedP += p;
						count += 1;
					}
				}
			}

			if (count === 0) {
				return { book: null, value: null, deviation: 0, pct: 0 };
			}
			
			// Average implied probability across the composite books
			p_devig = sumImpliedP / count;
		} else {
			const devigVal = bookOdds[DEVIG];
			
			// Check for edge cases where odds are missing or invalid for a single book
			if (!devigVal || (rowData.under && !String(devigVal).includes("/") && !rowData.prop.includes("vs-"))) {
				 return { book: null, value: null, deviation: 0, pct: 0 };
			}

			p_devig = getImpliedProbabilityFromOddsString(devigVal, legIndex);
		}

		if (p_devig == null) {
			return { book: null, value: null, deviation: 0, pct: 0 };
		}

		let best = { book: null, value: null, deviation: -Infinity, pct: 0 };

		// Add the single book DEVIG to the excluded list to avoid comparing 
		// a book against itself if DEVIG is a single book.
		const devigExclusions = String(DEVIG).split("+");
		devigExclusions.forEach(b => excluded.push(b));
		
		Object.entries(bookOdds)
			.filter(([book]) => !excluded.includes(book) && (!bookFilter || bookFilter == book)) 
			.forEach(([book, val]) => {
				const p = getImpliedProbabilityFromOddsString(val, legIndex);

				if (p != null) {
					const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
					const num = Number(token);
					
					const dev = p_devig - p;
					const pct = p_devig !== 0 ? dev / p_devig : 0;  

					if (dev > best.deviation) {
						best = { book, value: num, deviation: dev, pct };
					}
				}
			});

		if (best.deviation <= 0) return { book: null, value: null, deviation: 0, pct: 0 };

		return best;
	} else {
		entries = Object.entries(bookOdds)
		.map(([book, val]) => {
			if (!String(val).includes("/") && legIndex == 1) {
				return [null, null, null];
			}
			const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
			const num = Number(token);
			const p = americanToImplied(num);
			return [book, num, p]; // [book, american, impliedProb]
		})
		.filter(([, num, p]) => !isNaN(num) && p != null);

		if (entries.length < 2) return { book: null, value: null, deviation: 0, pct: 0 };

		// Average implied probability across books
		avgP = entries.reduce((a, [, , p]) => a + p, 0) / entries.length;

		let best = { book: null, value: null, deviation: -Infinity, pct: 0 };

		entries.forEach(([book, american, p]) => {
			if ((bookFilter && book != bookFilter) || excluded.includes(book)) {
				return;
			}
			const dev = avgP - p;
			const pct = avgP !== 0 ? dev / avgP : 0;
			if (dev > best.deviation) {
			  best = { book, value: american, deviation: dev, pct };
			}
		});

		if (best.deviation <= 0) return { book: null, value: null, deviation: 0, pct: 0 };

		return best;
	}
}

function computeOutlierFromBookOddsLow(rowData) {
  const bookOdds = rowData.bookOdds;
  if (!bookOdds) return { book: null, value: null, deviation: 0, pct: 0, refBook: null, refValue: null };

  // pick Over (index 0) or Under (index 1) leg from "a/b" strings
  const legIndex = rowData.under ? 1 : 0;

  // Parse selected leg and convert to implied probability
  const entries = Object.entries(bookOdds)
	.map(([book, val]) => {
		if (rowData.under && !String(val).includes("/")) {
			return null;
		}
		const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
		const american = Number(token);
		const p = americanToImplied(american);
		return isNaN(american) || p == null ? null : [book, american, p];
	})
	.filter(Boolean);

  if (entries.length < 2) return { book: null, value: null, deviation: 0, pct: 0, refBook: null, refValue: null };

  // Find the best (lowest implied probability) — our reference
  let best = entries[0];
  for (const e of entries) if (e[2] < best[2]) best = e; // compare by implied prob
  const [refBook, refAmerican, refP] = best;

  // Deviation from the lowest book: gap = p - refP (in probability points)
  // Return the book with the *largest* gap (worst vs. best).
  let worst = { book: null, value: null, deviation: -Infinity, pct: 0, refBook, refValue: refAmerican };
  for (const [book, american, p] of entries) {
	const gap = p - refP;                    // ≥ 0; 0 for the best itself
	const pct = refP !== 0 ? gap / refP : 0; // relative to best's implied prob
	if (gap > worst.deviation) {
	  worst = { book, value: american, deviation: gap, pct, refBook, refValue: refAmerican };
	}
  }

  return worst; // 'deviation' is the gap vs. the best (lowest implied prob)
}

// --- probit helper functions (Acklam inverse CDF + erf-based CDF) ---
function inverseNormalCDF(p) {
	// Peter John Acklam's approximation
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a1 = -39.69683028665376, a2 = 220.9460984245205, a3 = -275.9285104469687, a4 = 138.3577518672690, a5 = -30.66479806614716, a6 = 2.506628277459239;
	const b1 = -54.47609879822406, b2 = 161.5858368580409, b3 = -155.6989798598866, b4 = 66.80131188771972, b5 = -13.28068155288572;
	const c1 = -0.007784894002430293, c2 = -0.3223964580411365, c3 = -2.400758277161838, c4 = -2.549732539343734, c5 = 4.374664141464968, c6 = 2.938163982698783;
	const d1 = 0.007784695709041462, d2 = 0.3224671290700398, d3 = 2.445134137142996, d4 = 3.754408661907416;
	const plow = 0.02425, phigh = 1 - plow;
	let q, r;
	if (p < plow) {
		q = Math.sqrt(-2 * Math.log(p));
		return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
				((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
	} else if (p > phigh) {
		q = Math.sqrt(-2 * Math.log(1 - p));
		return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
				((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
	} else {
		q = p - 0.5;
		r = q * q;
		return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
				(((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
	}
}

function erf(x) {
	// Abramowitz & Stegun approximation
	const sign = x < 0 ? -1 : 1;
	x = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * x);
	const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
	const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
	return sign * y;
}

function normalCDF(x) {
	return 0.5 * (1 + erf(x / Math.SQRT2));
}

function getProbit(impliedOver, impliedUnder) {
	let probit = NaN;
	try {
        const zOver = inverseNormalCDF(impliedOver);
        const zUnder = inverseNormalCDF(impliedUnder);
		const overDevigged = zOver - 0.5 * (zOver + zUnder);
		probit = normalCDF(overDevigged);
    } catch (e) {
        probit = NaN;
    }
	return probit;
}

function devig(ou, finalOdds, promo, isUnder = false, manualVig = "") {
	const parts = String(ou).split("/");
	if (!parts[0]) return;

	let over = parseInt(parts[0], 10);
	if (!Number.isFinite(over)) return;

	let impliedOver = americanToImplied(over);
	const bet = 100;
	let profit = (finalOdds >= 0)
		? (finalOdds * bet / 100)
		: (100 * bet) / Math.abs(finalOdds);

	let under;
	if (ou.indexOf("/") === -1 || parts.length < 2 || parts[1] === "") {
		let vig = 0.07;
		if (PAGE == "atgs2") {
			vig = 0;
		}
		if (manualVig != "") {
			vig = parseInt(manualVig);
		}
		if (vig >= impliedOver) {
			vig = Math.max(impliedOver - 0.01, 0);
		}
		let u = 1 + vig - impliedOver;
		if (u >= 1) return;

		if (over > 0) {
			under = Math.trunc((100*u) / (-1 + u));
		} else {
			under = Math.trunc((100 - 100 * u) / u);
		}
		if (isUnder) {
			let tmpUnder = under;
			under = over;
			over = tmpUnder;
			impliedOver = americanToImplied(over);
		}
	} else {
		under = parseInt(parts[1], 10);
	}

	if (!Number.isFinite(under)) return;
	let impliedUnder = americanToImplied(under);

	let x = impliedOver;
	let y = impliedUnder;
	let iter = 0;

	while (Math.abs((x + y) - 1) > 1e-8 && iter < 50) {
		const sum = x + y;
		const k = Math.log(2) / Math.log(2 / sum);
		x = Math.pow(x, k);
		y = Math.pow(y, k);
		iter += 1;
	}

	const implied = round2(x * 100);

	// Multiplicative and additive methods (your “mult” and “add”)
	const mult = impliedOver / (impliedOver + impliedUnder);
	const add = impliedOver - (impliedOver + impliedUnder - 1) / 2;

	// EV via each method, take the minimum (your approach)
	const methods = [x, mult, add];

	let fairVal = Math.min(...methods);
	const dec = 1 / fairVal;
	if (dec >= 2) {
		fairVal = Math.round((dec - 1) * 100);
	} else {
		fairVal = Math.round(-100 / (dec - 1));
	}

	const fairValue = Math.min(...methods);
	const evs = methods.map(m => {
		const ev = m * profit + (1 - m) * (-1 * bet);
		return round1(ev);
	});
	let ev = Math.min(...evs);

	if (promo == "no-sweat") {
		// Modest 70% conversion
		x = 0.70
		ev = ((100 * (finalOdds / 100 + 1)) * fairValue - 100 + (100 * x));
		ev = round1(ev);
	}

	const kelly = getKelly(finalOdds, ev);
	return { ev, fairVal, implied, kelly };
}

function getFV(val, under, method = "") {
	let fv;
	if (under) {
		if (val.includes("/")) {
			let [o,u] = val.split("/");
			val = `${u}/${o}`;
			fv = getFairValue(val);
		} else {
			val = parseInt(val);
			const implied = (val > 0)
				? 100 / (val+100) : -val / (-val+100);
			fv = 1 - implied;
		}
	} else {
		fv = getFairValue(val);
	}
	return fv;
}

function getFairValue(ou) {
	over = parseInt(ou.split("/")[0]);
	const impliedOver = (over > 0)
		? 100 / (over+100) : -over / (-over+100);

	let under = "";
	if (!ou.includes("/")) {
		let vigFV = 0.07;
		if (vigFV >= impliedOver) {
			vigFV = Math.max(impliedOver - 0.01, 0);
		}
		u = 1 + vigFV - impliedOver;
		if (u >= 1) return;
		under = (over > 0)
			? parseInt((100*u) / (-1+u)) : parseInt((100 - 100*u) / u);
	} else {
		under = parseInt(ou.split("/")[1]);
	}

	const impliedUnder = (under > 0)
		? 100 / (under+100) : -under / (-under+100);

	// power method
	let x = impliedOver;
	let y = impliedUnder;
	let iter = 0;

	while (Math.abs((x + y) - 1) > 1e-8 && iter < 50) {
		const sum = x + y;
		const k = Math.log(2) / Math.log(2 / sum);
		x = Math.pow(x, k);
		y = Math.pow(y, k);
		iter += 1;
	}

	const mult = impliedOver / (impliedOver + impliedUnder);
	const add = impliedOver - (impliedOver + impliedUnder - 1) / 2;

	const methods = [x, mult, add];
	const fairValue = Math.min(...methods);

	if (METHOD === "mult") {
		return mult;
	} else if (METHOD === "add") {
		return add;
	} else if (METHOD === "power") {
		return x;
	} else if (METHOD === "probit") {
		return getProbit(impliedOver, impliedUnder);
	}
	return fairValue;
}

function getKelly2(finalOdds, implied) {
  const p = implied / 100;
  let b;

  if (finalOdds > 0) {
	b = finalOdds / 100;
  } else {
	b = 100 / Math.abs(finalOdds);
  }

  const kelly = ((p * b - (1 - p)) / b) / 4; // quarter Kelly
  return Number(kelly.toFixed(2));
}

function getKelly(finalOdds, ev) {
  let p = finalOdds / 100;
  if (finalOdds < 0) {
	p = 100 / finalOdds;
  }
  
  return ev / Math.abs(p) / 4;
}

function averageCustomSharps(bookOdds, devigBook, isUnder = false) {
	let pn = bookOdds.pn;
	let circa = bookOdds.circa;
	let overs = [];
	let unders = [];

	for (book of devigBook.split("+")) {
		let odds = bookOdds[book];
		if (!odds) {
			continue;
		}
		if (odds.includes("/")) {
			let [o,u] = odds.split("/");
			overs.push(americanToImplied(o));
			unders.push(americanToImplied(u));
		} else {
			overs.push(americanToImplied(odds));
		}
	}
	
	if (overs && overs.length > 0) {
		overs = overs.reduce((sum, val) => sum + val, 0) / overs.length;
		overs = impliedToAmerican(overs);

		if (unders && unders.length > 0) {
			unders = unders.reduce((sum, val) => sum + val, 0) / unders.length;
			unders = impliedToAmerican(unders);
		}
		if (unders) {
			return isUnder ? `${unders}/${overs}` : `${overs}/${unders}`;
		} else {
			return unders;
		}
	}
	return "";
}

function averageSharps(bookOdds, isUnder = false) {
	let pn = bookOdds.pn;
	let circa = bookOdds.circa;
	let overs = [];
	let unders = [];
	if (pn) {
		let [o,u] = pn.split("/");
		overs.push(americanToImplied(o));
		unders.push(americanToImplied(u));
	}
	if (circa) {
		let [o,u] = circa.split("/");
		overs.push(americanToImplied(o));
		unders.push(americanToImplied(u));
	}
	
	if (overs && overs.length > 0) {
		overs = overs.reduce((sum, val) => sum + val, 0) / overs.length;
		overs = impliedToAmerican(overs);

		if (unders && unders.length > 0) {
			unders = unders.reduce((sum, val) => sum + val, 0) / unders.length;
			unders = impliedToAmerican(unders);
		}
		if (unders) {
			return isUnder ? `${unders}/${overs}` : `${overs}/${unders}`;
		} else {
			return unders;
		}
	}
	return "";
}

// Convert American odds → implied probability
function americanToImplied(odds) {
  odds = parseInt(odds, 10);
  if (isNaN(odds)) return null;
  return odds > 0
	? 100 / (odds + 100)
	: Math.abs(odds) / (Math.abs(odds) + 100);
}

// Convert implied probability → American odds
function impliedToAmerican(prob) {
  if (prob <= 0 || prob >= 1) return null;
  return prob >= 0.5
	? -Math.round((prob / (1 - prob)) * 100)
	: Math.round(((1 - prob) / prob) * 100);
}

function americanToDecimal(a) {
  a = Number(a);
  if (!Number.isFinite(a)) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
function decimalToAmerican(d) {
  if (!(d > 1)) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

function getAverageImplied(books, under) {
	const skipUnder = new Set(["kambi"]);
	const impliedProbs = Object.entries(books)
		.filter(([book, val]) => {
			if (val === null || val === "") return false;
			const hasSlash = String(val).includes("/");

			if (under) {
				if (skipUnder.has(book)) return false;
				if (!hasSlash) return false;
			}
			return true;
		})
		.map(([b, val]) => {
		  // Handle "over/under" format like "200/-250"
		  const parts = String(val).split("/");
		  const odd = under ? parts[parts.length - 1] : parts[0];
		  const num = parseInt(odd, 10);
		  if (Number.isNaN(num)) return null;
		  return americanToImplied(odd);
		})
		.filter((p) => p != null);

	if (impliedProbs.length === 0) return null;

	const avgProb = impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length;
	const avgAmerican = impliedToAmerican(avgProb);

	return { avgProb, avgAmerican };
}

function buildOU(books, isUnder) {
	const over = getAverageImplied(books, false)?.avgAmerican ?? "-";
	const under = getAverageImplied(books, true)?.avgAmerican ?? "-";

	let ou = isUnder ? `${under}/${over}` : `${over}/${under}`;

	// mirror:
	// if ou == "-/-" or startswith "-/" or "0/" → skip (return null)
	if (ou === "-/-" || ou.startsWith("-/") || ou.startsWith("0/")) return null;

	// if endswith "/-" or "/0" → keep only over side
	if (ou.endsWith("/-") || ou.endsWith("/0")) {
		ou = ou.split("/")[0];
	}
	return ou;
}

function averageDevigs(bookOdds, highest, isUnder, weights) {
	let totalWeight = 0;
	let fairVals = 0;
	const devigBooks = DEVIG.replace("only+", "").split("+");
	Object.entries(bookOdds)
		//.filter(([book, val]) => val && book != highest && (!DEVIG || devigBooks.includes(book)))
		.filter(([book, val]) => val && (!DEVIG || (!DEVIG.includes("+") || book != highest) || devigBooks.includes(book)))
		.forEach(([book, val]) => {
			let fv;

			if (isUnder) {
				if (val.includes("/")) {
					let [o,u] = val.split("/");
					val = `${u}/${o}`;
					fv = getFairValue(val);
				} else {
					val = parseInt(val);
					const implied = (val > 0)
						? 100 / (val+100) : -val / (-val+100);
					fv = 1 - implied;						
					//fv = (1.07 - implied) / 1.07;
				}
			} else {
				fv = getFairValue(val);
			}
			const weight = weights[book] || 0;

			if (weight) {
				totalWeight += weight;
				fairVals += weight * fv;
			}
		});

	if (totalWeight == 0) return NaN;

	return fairVals / totalWeight;
}

function applyProfitBoost(american, boost) {
	const D = americanToDecimal(american);
	if (D == null) return null;
	if (boost == "no-sweat") {
		boost = 0;
	}
	boost = boost / 100;
	const Dp = 1 + (D - 1) * (1 + boost);
	return decimalToAmerican(Dp);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

function highestOver(bookOdds, excluded, boost, book, under) {
	if (!boost) {
		boost = 0;
	}
	return Object.entries(bookOdds)
		.filter(([key, value]) =>
		  // exclude list
		  !excluded.includes(key) &&
		  // if a specific book is requested, only consider that one
		  (!book || key === book) &&
		  value !== undefined && value !== null && value !== ""
		)
		.reduce(
		  (max, [key, value]) => {
			// value can be "550" or "431/-655"
			const parts = String(value).split("/");
			if (under && parts.length <= 1) {
				return max;
			}
			const pick = under && parts.length > 1 ? parts[1] : parts[0];

			// parse "+375" -> 375, "-120" -> -120
			let num = parseInt(pick.replace("+", ""), 10);
			if (isNaN(num)) return max;

			// apply your profit boost (works for +/- American)
			num = applyProfitBoost(num, boost);

			return num > max.value ? { book: key, value: num, raw: pick } : max;
		  },
		  { book: null, value: -Infinity, raw: null }
	);
}

function rowClick(row) {
	const data = row.getData();
	const right = document.querySelector("#right-body");
	const left = document.querySelector("#table-container");
	const table = document.querySelector("#table");
	const tableContainer = document.querySelector("#table-container");
	const sel = TABLE.getSelectedRows();
	TABLE.deselectRow();
	if (sel.length > 0 && sel[0] == row) {
		right.style.display = "none";
		left.style.width = "100%";
		table.style.width = "100%";
		setTimeout(() => {
			table.style.width = "100%";
			tableContainer.style.width = "100%";
		}, 40);
	} else {
		row.select();
		left.style.width = MOBILE ? "100%" : "50%";
		right.style.display = "flex";
		right.style.flexDirection = "row-reverse";
		right.style.justifyContent = "center";
		right.style.gap = "1rem";
		table.style.width = "100%";
		tableContainer.style.width = "100%";
		if (["atgs"].includes(PAGE) && !MOBILE) {
			plotHRGap();
		}
		renderGoalPropsTable(data);
	}
}

function renderGoalPropsTable(playerData) {
	const rightBody = document.querySelector("#right-body");
	if (!rightBody) return;

	// Check if table already exists, if not create container
	let tableContainer = document.querySelector("#goal-props-table");
	if (!tableContainer) {
		tableContainer = document.createElement("div");
		tableContainer.id = "goal-props-table";
		rightBody.appendChild(tableContainer);
	}

	// Find all rows for this player+game with the SAME prop at different handicap levels
	const clickedProp = playerData.prop;
	const allRows = [...RES.data];
	const playerRows = allRows.filter(r => r.player === playerData.player && r.game === playerData.game && r.prop === clickedProp);

	// Group by handicap level to build columns (1+, 2+, 3+, etc.)
	const propMap = {};
	const columnKeys = [];
	const columnLabels = {};

	playerRows.forEach(r => {
		const h = parseFloat(r.handicap);
		const key = String(r.handicap);
		if (!propMap[key]) {
			propMap[key] = r;
			columnKeys.push(key);
			const threshold = Number.isFinite(h) ? Math.ceil(h) : key;
			columnLabels[key] = `${threshold}+`;
		}
	});

	// Sort columns by handicap value ascending
	columnKeys.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));

	if (columnKeys.length === 0) {
		tableContainer.innerHTML = '';
		return;
	}

	// Books to display
	const books = ["circa", "pn", 'fd', 'dk', 'b365', 'mgm', 'espn', 'cz', 'fn', 'br', 'hr', 'bv', 'kambi', 're', 'fl', 'bol'];

	// Find best odds for each column (highest positive or least negative)
	const bestByCol = {};
	columnKeys.forEach(key => {
		let bestValue = -Infinity;
		books.forEach(book => {
			let odds = propMap[key]?.bookOdds?.[book];
			if (odds != null) {
				odds = parseInt(String(odds).split("/")[0]);
				if (odds > bestValue) bestValue = odds;
			}
		});
		bestByCol[key] = bestValue > -Infinity ? bestValue : null;
	});

	// Build table HTML
	const headerCells = columnKeys.map(key =>
		`<th style="padding: ${MOBILE ? '0.5rem 0.25rem' : '0.75rem'}; text-align: center;">${columnLabels[key]}</th>`
	).join('');

	const mobilePad = MOBILE ? '0.5rem' : '1rem';
	const mobileFont = MOBILE ? 'font-size: 0.8rem;' : '';
	const cellPad = MOBILE ? '0.35rem 0.25rem' : '0.5rem';
	const headerPad = MOBILE ? '0.5rem 0.25rem' : '0.75rem';

	let html = `
		<div style="padding: ${mobilePad}; overflow-x: auto; overflow-y: auto; max-height: ${MOBILE ? '60vh' : '400px'}; max-width: 100vw; background: #0f1117; border-radius: 8px; position: relative; -webkit-overflow-scrolling: touch; ${mobileFont}">
			<div style="display: flex; justify-content: space-between; align-items: center; margin: 0 0 0.5rem 0; top: 0; background: #0f1117; padding-bottom: 0.5rem; z-index: 1;">
				<h3 style="margin: 0; font-size: ${MOBILE ? '0.95rem' : '1.17em'};">${title(playerData.player)} - ${convertProp(clickedProp)}</h3>
				<button onclick="closeRightPanel()" style="background: transparent; border: none; color: #e6e6e6; cursor: pointer; font-size: 24px; line-height: 1; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px;" onmouseover="this.style.background='#2a2e39'" onmouseout="this.style.background='transparent'">×</button>
			</div>
			<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
			<table style="min-width: ${MOBILE ? 'max-content' : '100%'}; width: 100%; border-collapse: collapse; background: #1a1d24; color: #e6e6e6; white-space: nowrap;">
				<thead style="background: #1a1d24; z-index: 1;">
					<tr style="border-bottom: 2px solid #3a3f4f;">
						<th style="padding: ${headerPad}; text-align: left;; left: 0; background: #1a1d24; z-index: 2;">Book</th>
						${headerCells}
					</tr>
				</thead>
				<tbody>
	`;

	const highlightStyle = "background: #2d5016; color: #a3e635; font-weight: 700;";

	books.forEach(book => {
		const bookName = book.toUpperCase();

		const cells = columnKeys.map(key => {
			let raw = propMap[key]?.bookOdds?.[book];
			let odds = null;
			if (raw != null) {
				odds = parseInt(String(raw).split("/")[0]);
			}
			const isBest = odds != null && odds === bestByCol[key];
			const display = odds != null ? (odds > 0 ? '+' + odds : odds) : '-';
			return `<td style="padding: ${cellPad}; text-align: center; ${isBest ? highlightStyle : ''}">${display}</td>`;
		}).join('');

		html += `
			<tr style="border-bottom: 1px solid #2a2e39;">
				<td style="padding: ${cellPad}; font-weight: 600;display:flex;align-items:center;gap:4px; position: sticky; left: 0; background: #1a1d24; z-index: 1;"><img class='book-img' style="width:16px;height:16px;" src='logos/${bookName.toLowerCase().replace("hr_az", "hr").replace("hr_oh", "hr")}.png' alt='${bookName}' title='${bookName}' />${bookName}</td>
				${cells}
			</tr>
		`;
	});

	html += `
				</tbody>
			</table>
			</div>
		</div>
	`;

	tableContainer.innerHTML = html;
}

function closeRightPanel() {
	const right = document.querySelector("#right-body");
	const left = document.querySelector("#table-container");
	const table = document.querySelector("#table");
	const tableContainer = document.querySelector("#table-container");
	
	TABLE.deselectRow();
	right.style.display = "none";
	left.style.width = "100%";
	table.style.width = "100%";
	setTimeout(() => {
		table.style.width = "100%";
		tableContainer.style.width = "100%";
	}, 40);
}


function parlay(ous) {
	let totalFV = 1;
	ous.forEach(ou => {
		const fv = getFairValue(ou);
		totalFV *= fv;
	});

	console.log(totalFV, impliedToAmerican(totalFV));
}

function escapeHtml(s="") {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function colHeader(field) {
	try {
	  const col = TABLE.getColumn(field);
	  if (!col) return null;
	  const el = col.getElement();
	  return el || null;
	} catch(e) { return null; }
}

function hideUsername() {
	document.getElementById("auth-buttons").style.display = "none";
}

async function loadHeatmapData() {
	if (["outliers", "analysis"].includes(PAGE)) return;
	try {
		// Load the compressed heatmap data
		const response = await fetch(`/heatmaps/${SPORT}_${METHOD || "worst"}.json.gz`);
		const buffer = await response.arrayBuffer();
		
		// Decompress if pako is available
		if (typeof pako !== 'undefined') {
			const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
			const heatmapData = JSON.parse(decompressed);
			
			// Store in HEATMAP for use in getRowROI
			if (!HEATMAP) HEATMAP = {};
			HEATMAP.xy = heatmapData.xy;
			HEATMAP.record = heatmapData.record;
		}
	} catch (e) {
		console.warn('Failed to load heatmap data for ROI coloring:', e);
	}
}

// Color interpolation matching heatmap colors
function roiToColor(roi) {
	// Heatmap colors: red (#b2182b) at -1, white (#f7f7f7) at 0, blue (#2166ac) at 1
	const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
	const normalized = clamp(roi, -1, 1); // clamp to [-1, 1]
	
	if (normalized < 0) {
		// Interpolate between red and white
		const t = (normalized + 1); // 0 to 1
		return interpolateColor('#b2182b', '#f7f7f7', t);
	} else {
		// Interpolate between white and blue
		const t = normalized; // 0 to 1
		return interpolateColor('#f7f7f7', '#2166ac', t);
	}
}

function interpolateColor(color1, color2, t) {
	const hex = (c) => parseInt(c, 16);
	const r1 = hex(color1.slice(1,3)), g1 = hex(color1.slice(3,5)), b1 = hex(color1.slice(5,7));
	const r2 = hex(color2.slice(1,3)), g2 = hex(color2.slice(3,5)), b2 = hex(color2.slice(5,7));
	const r = Math.round(r1 + (r2 - r1) * t);
	const g = Math.round(g1 + (g2 - g1) * t);
	const b = Math.round(b1 + (b2 - b1) * t);
	return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function findBin(value, bins) {
	if (value < bins[0] || value > bins[bins.length-1]) return -1;
	for(let i=0; i<bins.length-1; i++){
		const left = bins[i], right = bins[i+1];
		if (value >= left && value <= right) return i;
	}
	return -1;
}

function arange(start, stop, step) {
	const r = [];
	for(let v = start; v <= stop + 1e-9; v += step) r.push(v);
	return r;
}

function getRowROI(rowData) {
	// Define your bin ranges (match these to your heatmap settings)
	const evStep = 1, oddsStep = 100;
	let evRange = [-5, 30], oddsRange = [100, 3000];

	const evBins = arange(evRange[0], evRange[1], evStep);
	const oddsBins = arange(oddsRange[0], oddsRange[1], oddsStep);

	const evBin = findBin(rowData.ev || 0, evBins);
	const oddsBin = findBin(rowData.line || 0, oddsBins);

	if (evBin === -1 || oddsBin === -1) return null;

	// Look up in RECORD - you'll need to fetch heatmap data
	// This assumes you have RES loaded with the xy data structure
	try {
		if (typeof HEATMAP !== 'undefined' && HEATMAP && HEATMAP.xy) {
			const propData = HEATMAP.xy[rowData.prop];
			if (!propData) return null;
			
			const bookData = propData[rowData.book] || propData['best'];
			if (!bookData) return null;

			let devigData = bookData[DEVIG];
			if (!devigData && DEVIG && DEVIG.includes('+')) {
				const reversed = DEVIG.split('+').reverse().join('+');
				devigData = bookData[reversed];
			}
			if (!devigData) return null;

			// Convert columnar format {ev:[...], odds:[...], ...} → [{ev, odds, ...}, ...]
			if (!Array.isArray(devigData)) {
				const keys = Object.keys(devigData);
				const len = devigData[keys[0]]?.length || 0;
				devigData = Array.from({length: len}, (_, i) => {
					const row = {};
					keys.forEach(k => row[k] = devigData[k][i]);
					return row;
				});
			}

			// Find bets in this bin
			const betsInBin = devigData.filter(b => {
				const bEv = findBin(Number(b.ev), evBins);
				const bOd = findBin(Number(b.odds), oddsBins);
				return bEv === evBin && bOd === oddsBin;
			});

			if (betsInBin.length === 0) return null;

			// Calculate ROI and W-L
			let wins = 0, losses = 0;
			const profits = betsInBin.map(b => {
				const isWin = !!b.hit;
				if (isWin) wins++;
				else losses++;
				const profit = isWin ? (b.odds > 0 ? b.odds/100 : 100/Math.abs(b.odds)) : -1.0;
				return profit;
			});

			const avgROI = profits.reduce((a,b) => a+b, 0) / profits.length;
			return { roi: avgROI, wins: wins, losses: losses };
		}
	} catch(e) {
		console.error('Error calculating ROI:', e);
	}
	return null;
}

const HELP_ITEMS = [
	{
		title: "Expected Value (EV%)",
		desc: "Your edge over the market. Calculated by comparing the best available odds to the fair value from your chosen devig books. Green = positive edge — start here.",
		getEl: () => colHeader("ev")
	},
	{
		title: "Best Book",
		desc: "The sportsbook offering the best price driving the EV. This is where you should place the bet.",
		getEl: () => colHeader("book")
	},
	{
		title: "Fair Value (FV)",
		desc: "The true odds after removing the sportsbook's built-in margin (vig). Any line better than Fair Value is +EV.",
		getEl: () => colHeader("fairVal")
	},
	{
		title: "Implied %",
		desc: "Fair Value as a win probability. e.g. +200 FV = 33.3% implied. What the devig books believe this prop's true chance of hitting is.",
		getEl: () => colHeader("implied")
	},
	{
		title: "¼ Kelly (QK)",
		desc: "Recommended bet size using 25% of the Kelly Criterion. Balances growth and variance. Only shown when EV is positive.",
		getEl: () => colHeader("kelly")
	},
	{
		title: "Odds Columns",
		desc: "Each book's current price formatted as over/under (e.g. +450/-570). Cells highlighted in green are +EV lines at that book. + auto adds this play to your betslip.",
		getEl: () => colHeader("bookOdds.fd") || colHeader("bookOdds.dk")
	},
	{
		title: "Preset Devigs",
		desc: "Backtested devig combinations ranked by ROI. Each preset shows which books to devig against and the historical win/loss record at that prop. Click to load a preset instantly.",
		getEl: () => document.querySelector(".dev-chip-wrap")
	},
	{
		title: "Book Filter",
		desc: "Limit results to plays available at a specific sportsbook. Useful if you only have access to certain books.",
		getEl: () => document.getElementById("book-select")
	},
	{
		title: "Exclude Books",
		desc: "Remove books from best book entirely — for this page or all pages. Use this if you don't have an account at a book.",
		getEl: () => document.getElementById("exclude-dd")
	},
	{
		title: "Devig Filter",
		desc: "The sharp books used to calculate Fair Value. Only their lines are used to strip the vig. Circa and Pinnacle are recommended starting points. Customize any combo of devigs here.",
		getEl: () => document.getElementById("devig-button")
	},
	{
		title: "Required Books",
		desc: "Only show plays where all selected books have a price available to devig against.",
		getEl: () => document.getElementById("required-button")
	},
	{
		title: "Customize",
		desc: "Show or hide columns to fit your workflow. Set a default devig everytime the page loads. Settings can be saved to your profile so they persist across sessions.",
		getEl: () => document.getElementById("customize")
	}
];

function startHelpTour() {
	if (document.querySelector(".help-pin")) { endHelpTour(); return; }

	const scrollY = window.scrollY;
	const scrollX = window.scrollX;
	const active = HELP_ITEMS.map((item, i) => ({ item, el: item.getEl(), n: i + 1 })).filter(x => x.el);

	// Dim backdrop
	const backdrop = document.createElement("div");
	backdrop.className = "help-pin";
	backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9997;cursor:pointer;";
	backdrop.addEventListener("click", endHelpTour);
	document.body.appendChild(backdrop);

	// Ring + badge on each element
	active.forEach(({ el, n }) => {
		const rect = el.getBoundingClientRect();

		const ring = document.createElement("div");
		ring.className = "help-pin";
		ring.style.cssText = `
			position:absolute;
			top:${rect.top + scrollY - 3}px;left:${rect.left + scrollX - 3}px;
			width:${rect.width + 6}px;height:${rect.height + 6}px;
			border:2px solid #64b5f6;border-radius:5px;
			pointer-events:none;z-index:9999;
		`;
		document.body.appendChild(ring);

		const badge = document.createElement("div");
		badge.className = "help-pin help-badge";
		badge.textContent = n;
		badge.style.cssText = `
			position:absolute;
			top:${rect.top + scrollY - 10}px;left:${rect.right + scrollX - 10}px;
			z-index:10000;pointer-events:none;
		`;
		document.body.appendChild(badge);
	});

	// Fixed legend panel
	const panel = document.createElement("div");
	panel.className = "help-pin";
	panel.id = "help-legend";
	panel.innerHTML = `
		<div id="help-legend-header">
			<span>How It Works</span>
			<button id="help-legend-close">&times;</button>
		</div>
		<div id="help-legend-body">
			${active.map(({ item, n }) => `
				<div class="help-legend-row">
					<div class="help-badge help-badge-static">${n}</div>
					<div>
						<div class="help-legend-title">${item.title}</div>
						<div class="help-legend-desc">${item.desc}</div>
					</div>
				</div>
			`).join("")}
		</div>
	`;
	document.body.appendChild(panel);
	panel.querySelector("#help-legend-close").addEventListener("click", endHelpTour);

	const onKey = e => { if (e.key === "Escape") { endHelpTour(); document.removeEventListener("keydown", onKey); } };
	document.addEventListener("keydown", onKey);
}

function endHelpTour() {
	document.querySelectorAll(".help-pin").forEach(el => el.remove());
}


function debounce(fn, delay = 400) {
	let timeout;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn(...args), delay);
	};
}


function parseURLParams() {
	const windowURL = new URL(window.location.href);
	const URLParams = new URLSearchParams(windowURL.search);

	PROP = URLParams.get("prop") || "";

	METHOD = URLParams.get("method") || "";
	DATE = URLParams.get("date");
	MARK = URLParams.get("mark");
	GAME = URLParams.get("game") || "";
	TODAY = getToday();
	SPORT = URLParams.get("sport") || "mlb";
	PLAYER = URLParams.get("player");
	DEVIG = (URLParams.get("devig") || "").replaceAll("-","+");
	WEIGHT = (URLParams.get("weight") || "").replaceAll("-", "+");
	BOOST = URLParams.get("boost");
	PRETTY = URLParams.get("pretty");
	IMP = URLParams.get("imp");
	DUE = URLParams.get("due");
	CSV = URLParams.get("csv");
	BOOK = URLParams.get("book");
	VIG = URLParams.get("vig") || "";
	MIN = URLParams.get("min") || "";
	MAX = URLParams.get("max") || "";
	L3 = URLParams.get("L3");
	SIDE = URLParams.get("side") ?? "both";
	REQUIRED = URLParams.get("required") || "";
	TEAMS = URLParams.get("teams") || "";
	CURRENT_VIEW = URLParams.get("view") || "table";
	TEAM = URLParams.get("team") || "det";
	ALL = URLParams.get("all");
	PLAYERS = URLParams.get("players") || "";
	HARD_HIT = URLParams.get("HH");
	DERBY = URLParams.get("derby");

	function defaultOU() {
		if (["atgs", "tds", "dingers"].includes(PAGE)) return "o";
		return "ou";
	}
	OU = URLParams.get("ou") || defaultOU();
}
// ── Generic column-reorder helpers ───────────────────────────────────────────

let _colReorderDragSrc = null;

/**
 * Build a Tabulator columns array from a saved order.
 *
 * @param {string[]} savedOrder  - persisted key order (may be empty/null)
 * @param {string[]} defaultOrder - canonical fallback order
 * @param {Array}    items       - [{key, label, cols}] definitions
 * @param {Function|null} starColFn  - optional fn() → column def to prepend
 * @param {Array}    extraCols   - hidden utility columns to append
 */
function buildColumnsFromOrder(savedOrder, defaultOrder, items, starColFn = null, extraCols = []) {
	const itemMap = Object.fromEntries(items.map(i => [i.key, i]));
	const order = (savedOrder && savedOrder.length) ? savedOrder : defaultOrder;
	const seen = new Set();
	const cols = [];
	if (starColFn) cols.push(starColFn());
	for (const key of order) {
		if (itemMap[key]) { cols.push(...itemMap[key].cols); seen.add(key); }
	}
	for (const key of defaultOrder) {
		if (!seen.has(key) && itemMap[key]) cols.push(...itemMap[key].cols);
	}
	cols.push(...extraCols);
	return cols;
}

/**
 * Open the #col-reorder-modal and populate it with draggable items.
 *
 * @param {Array}    items          - [{key, label, cols}]
 * @param {string[]} defaultOrder
 * @param {string[]} savedOrder
 * @param {Function} isItemVisible  - (meta) => bool; omit hidden items
 */
function openColReorderModal(items, defaultOrder, savedOrder, isItemVisible) {
	const itemMap = Object.fromEntries(items.map(i => [i.key, i]));
	const seen = new Set(savedOrder);
	const displayOrder = [...savedOrder, ...defaultOrder.filter(k => !seen.has(k))];
	const list = document.getElementById('col-reorder-list');
	list.innerHTML = '';
	displayOrder.forEach(key => {
		const meta = itemMap[key];
		if (!meta) return;
		if (isItemVisible && !isItemVisible(meta)) return;
		const item = document.createElement('div');
		item.dataset.key = key;
		item.draggable = true;
		item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#172027;border:1px solid rgba(59,130,246,0.25);border-radius:4px;cursor:grab;user-select:none;font-size:13px;';
		item.innerHTML = `<span style="color:#555;font-size:16px;line-height:1;">⠣⠣</span><span>${meta.label}</span>`;
		item.addEventListener('dragstart', e => {
			_colReorderDragSrc = item;
			e.dataTransfer.effectAllowed = 'move';
			setTimeout(() => item.style.opacity = '0.4', 0);
		});
		item.addEventListener('dragend', () => {
			_colReorderDragSrc = null;
			list.querySelectorAll('[data-key]').forEach(i => { i.style.opacity = '1'; i.style.boxShadow = ''; });
		});
		item.addEventListener('dragover', e => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			list.querySelectorAll('[data-key]').forEach(i => i.style.boxShadow = '');
			item.style.boxShadow = '0 -2px 0 #3b82f6';
		});
		item.addEventListener('dragleave', () => { item.style.boxShadow = ''; });
		item.addEventListener('drop', e => {
			e.preventDefault();
			if (_colReorderDragSrc && _colReorderDragSrc !== item) {
				list.insertBefore(_colReorderDragSrc, item);
			}
			item.style.boxShadow = '';
		});
		list.appendChild(item);
	});
	document.getElementById('col-reorder-modal').style.display = 'flex';
}

function closeColReorderModal() {
	document.getElementById('col-reorder-modal').style.display = 'none';
}

/**
 * Read the reorder list, persist to Supabase, apply to TABLE, then close.
 *
 * @param {string}   storageKey   - metadata key, e.g. 'dingers-order'
 * @param {Function} buildColsFn  - (newOrder) => Tabulator columns array
 * @param {Function} [postSaveFn] - called after TABLE.setColumns()
 */
async function saveColReorderModal(storageKey, buildColsFn, postSaveFn) {
	const list = document.getElementById('col-reorder-list');
	const newOrder = [...list.querySelectorAll('[data-key]')].map(i => i.dataset.key);
	if (CURR_USER?.metadata) {
		CURR_USER.metadata[storageKey] = newOrder;
		await SB.from('profiles').update({ metadata: CURR_USER.metadata }).eq('id', CURR_SESSION.user.id);
		if (typeof cacheProfile === "function") cacheProfile(CURR_USER);
	}
	TABLE.setColumns(buildColsFn(newOrder));
	if (postSaveFn) postSaveFn();
	closeColReorderModal();
}

function initChkddActions(root = document) {
	const dd = document.getElementById("prop-dd");
	const menu = dd.querySelector(".chkdd-menu");

	const game_dd = document.getElementById("game-dd");
	const game_menu = game_dd.querySelector(".chkdd-menu");

	root.addEventListener('click', (e) => {
		if (menu.style.display === 'block' && !menu.contains(e.target)) {
			closeDropdown(dd, menu);
		}
		if (game_menu.style.display === "block" && !game_menu.contains(e.target)) {
			closeDropdown(game_dd, game_menu);
		}
	});

	if (PROP) {
		CHKDD_STATE["prop-options"] = PROP.split(",");
	}

	if (GAME) {
		CHKDD_STATE["game-options"] = GAME.split(",");
	}
}

function renderBookSelect() {
	let exclude = document.querySelector("#exclude-dd .chkdd-menu");
	let bookSel = document.getElementById("book-select");

	let books = ["fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "fl", "re", "bol", "kambi", "pn", "kal", "nv", "px", "poly"];

	if (["dingers", "dingers2", "mlb"].includes(PAGE)) {
		books.push("hr_oh");
	} else if (["nba", "threes", "pts"].includes(PAGE)) {
		books.push("hr_az");
	} else if (PAGE == "cup") {
		books = books.concat(["mb", "bw", "bs", "myb"]);
	}

	if (PAGE === "main") {
		books.push("hr_oh");
		if (!books.includes("hr_az")) books.push("hr_az");
	}

	bookSel.innerHTML = `
		<option value="" selected>All</option>
		${books.map(book => `<option value='${book}'>${book.toUpperCase()}</option>`)};
	`;
	bookSel.value = BOOK || "";
}

async function initDevPicker(data){
	const picker = document.getElementById('dev-picker');
	const hidden = document.getElementById('devig-select');
	if (!picker) return;

	// Build flex row wrapper once (select | updated label | picker)
	if (!document.getElementById('dev-picker-row')) {
		const row = document.createElement('div');
		row.id = 'dev-picker-row';
		picker.parentElement.insertBefore(row, picker);

		const col = document.createElement('div');
		col.className = 'dev-picker-col';
		row.appendChild(col);

		const sel = document.createElement('select');
		sel.id = 'dev-window-select';
		sel.className = 'dev-window-select';
		sel.innerHTML = ['All', 'L3', 'L7', 'L14','L30','L60'].map(w =>
			`<option value="${w}"${w === DEV_WINDOW ? ' selected' : ''}>${w}</option>`
		).join('');
		sel.addEventListener('change', () => {
			DEV_WINDOW = sel.value;
			initDevPicker(getTopDevigs(BOOK || "best"));
		});
		col.appendChild(sel);

		const upd = document.createElement('span');
		upd.id = 'dev-record-upd';
		upd.className = 'dev-record-upd';
		col.appendChild(upd);

		row.appendChild(picker);
	} else {
		document.getElementById('dev-window-select').value = DEV_WINDOW;
	}

	// Update the "Updated" label from RECORD_UPD global
	const updEl = document.getElementById('dev-record-upd');
	if (updEl) {
		try {
			if (typeof RECORD_UPD !== 'undefined' && RECORD_UPD) {
				const d = new Date(RECORD_UPD);
				const label = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour12: true });
				updEl.textContent = `upd: ${label}`;
			} else {
				updEl.textContent = '';
			}
		} catch(e) { updEl.textContent = ''; }
	}

	picker.innerHTML = '';
	if (hidden) hidden.innerHTML = '';

	if (!data || data.length === 0 || data.error) {
		return;
	}
	for (row of data) {
		let prop, dev;
		if (!row.devig.includes("-vs-")) {
			prop = "hr"; dev = row.devig;
		} else {
			[prop, dev] = row.devig.split("-vs-");
		}

		// wrapper holds the chip button and the small record line beneath
		const wrap = document.createElement('div');
		wrap.className = 'dev-chip-wrap';
		wrap.dataset.prop = prop;

		if (PAGE === "nhl" && ["atgs", "fgs", "lgs"].includes(prop)) {
			continue; // skip atgs/fgs/lgs for nhl page
		} else if (PAGE == "threes" && prop !== "3ptm") {
			continue;
		} else if (PAGE == "pts" && !["pts", "reb", "ast"].includes(prop)) {
			continue;
		} else if (["dingers", "dingers2", "recap"].includes(PAGE) && prop !== "hr") {
			continue;
		} else if (PAGE == "mlb" && prop === "hr") {
			continue;
		} else if (PAGE == "strikeouts" && prop !== "k") {
			continue;
		} else if (dev.includes("re")) {
			//continue;
		}

		// Add prop tag
		const propTag = document.createElement('div');
		propTag.className = 'dev-prop-tag';
		propTag.textContent = prop || '';
		if (!["atgs", "tds", "dingers"].includes(PAGE)) {
			wrap.appendChild(propTag);
		}

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.id = `devig-btn-${cssSafeId(dev)}`;
		btn.className = 'book-chip dev-chip';
		btn.dataset.value = dev;
		btn.textContent = dev.toUpperCase();
		wrap.appendChild(btn);

		// try to read record from RECORD global (by BOOK & dev key)
		const info = document.createElement('div');
		info.className = 'dev-subinfo';
		let recText = '';
		try {
			let rec = (typeof RECORD !== 'undefined' && RECORD && RECORD[METHOD||"worst"][BOOK||"best"]) ? RECORD[METHOD||"worst"][BOOK||"best"][`${prop}-vs-${dev}`] : null;
			if (rec) {
				rec = rec[DEV_WINDOW] || rec["All"];
				const wins = rec.wins ?? rec.w ?? 0;
				const losses = rec.losses ?? rec.l ?? 0;
				const roi = (typeof rec.roi === 'number') ? `${rec.roi > 0 ? '+' : ''}${rec.roi}%` : (rec.roi ?? '');
				recText = `${wins}W-${losses}L <span class="roi ${rec.roi > 0 ? 'positive' : 'negative'}">${roi}</span>`;
			}
		} catch (e) {
			recText = '';
		}
		info.innerHTML = recText;
		wrap.appendChild(info);

		// default selection logic: preserve DEVIG or pick first available
		if ((DEVIG === undefined && dev === (hidden && hidden.querySelector('option[selected]') ? hidden.querySelector('option[selected]').value : null)) || (DEVIG && dev === DEVIG)) {
			btn.classList.add('active');
			DEVIG = dev;
			if (hidden) hidden.value = dev;
		}

		btn.addEventListener('click', () => {
			DEVIG = dev;
			if (hidden) hidden.value = dev;
			// toggle active class only on buttons
			document.querySelectorAll('.dev-chip').forEach(c => c.classList.toggle('active', c === btn));
			btn.scrollIntoView({inline: 'nearest', block: 'nearest'});
			
			WEIGHT = repeatOnes(DEVIG).slice(1);
			REQUIRED = DEVIG.split("+");
			document.getElementById("devig-display-text").innerText = parseWeightKey(`${DEVIG};${WEIGHT}`);
			const bookSelectEl = document.getElementById("book-select");
			if (bookSelectEl) bookSelectEl.value = row.book.replace("best", "") || "";
			let props = [prop];
			if (prop == "team_total") {
				props = ["away_total", "home_total"];
			}
			setOptions("prop-options", props);
			updatePropLabel(props);
			updateRequiredDropdown();
			changeFilter();
		});

		picker.appendChild(wrap);
	}

	// ensure active visible
	const activeWrap = picker.querySelector('.dev-chip.active');
	if (activeWrap) {
		// if the active element is a button inside wrap, scroll its wrapper
		const btn = picker.querySelector('.dev-chip.active');
		if (btn && btn.parentElement) btn.parentElement.scrollIntoView({inline: 'nearest', block: 'nearest'});
	}
}

function renderFilters() {
	renderBookSelect();
	initDevPicker(getTopDevigs(BOOK||"best"));
	if (typeof loadHeatmapData === "function") {
		loadHeatmapData();
	}
}