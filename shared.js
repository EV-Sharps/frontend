let TOGGLE_PERCENTILE;
let HTML = "";
let TEAM = "";
let PAGE = "";
let CURRENT_VIEW = "table";
const MOBILE_BREAKPOINT = 600;
let MOBILE = window.innerWidth <= MOBILE_BREAKPOINT;
function getMobileDropdownAlignment() {
	return typeof CURR_USER !== 'undefined' && CURR_USER?.metadata?.mobile_dropdown_alignment === 'left' ? 'left' : 'right';
}
function getDropdownLeft(anchorLeft, panelWidth, viewportLeft = 0, viewportWidth = window.innerWidth) {
	const leftEdge = viewportLeft + 8;
	const rightEdge = viewportLeft + viewportWidth - panelWidth - 8;
	if (window.innerWidth <= MOBILE_BREAKPOINT) {
		return getMobileDropdownAlignment() === 'left' ? leftEdge : Math.max(leftEdge, rightEdge);
	}
	return Math.max(leftEdge, Math.min(anchorLeft, rightEdge));
}
let ACCESS_TOKEN = "";
const IS_PACKAGED_APP = window.EV_APP_CONFIG?.packaged === true;
const IS_LOCALHOST = !IS_PACKAGED_APP && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
let API_BASE = "http://localhost:5001";
let UPDATED = {};
let WEIGHTS = {};
let HEATMAP = {};
let CUP_TEAMS = {};
let TEST;
let RES, TABLE;
let CSV_DOWNLOADED = false;
let ALL, PROP, DATE, MARK, GAME, TODAY, SPORT, PLAYER, DEVIG, WEIGHT, BOOST, PRETTY, IMP, DUE, CSV, BOOK, VIG, MIN, MAX, OU, SIDE, TEAMS, METHOD, REQUIRED, PLAYERS, HARD_HIT, L3, EXIT_VELO, DERBY, STREAM;
let DEVIG_EXCLUDED = [];
const ALL_WEIGHTABLE_BOOKS = ["circa", "pn", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "hr_az", "hr_oh", "bv", "cz", "fl", "br", "re", "kal", "nv", "poly", "px"];
let KELLY_DOLLARS = false;
const KELLY_FRACTIONS = [[1, 'Full'], [0.5, '½'], [0.25, '¼'], [0.125, '⅛'], [0.0625, '¹⁄₁₆']];
const kellyPageOverrides = new Map();
function validKellyFraction(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 && number <= 1;
}
function getProfileKellyFraction() {
	if (CURR_USER) return validKellyFraction(CURR_USER.metadata?.kelly_fraction) ? Number(CURR_USER.metadata.kelly_fraction) : 0.25;
	try {
		const saved = localStorage.getItem('kelly_fraction');
		if (validKellyFraction(saved)) return Number(saved);
	} catch (e) {}
	return 0.25;
}
function kellyPageKey() {
	return `kelly_fraction:${CURR_USER?.id || 'guest'}:${PAGE}:${SPORT || ''}`;
}
function getPageKellyOverride() {
	const key = kellyPageKey();
	if (!kellyPageOverrides.has(key)) {
		let value = null;
		try { value = localStorage.getItem(key); } catch (e) {}
		kellyPageOverrides.set(key, validKellyFraction(value) ? Number(value) : null);
	}
	return kellyPageOverrides.get(key);
}
function getKellyFraction() {
	return getPageKellyOverride() ?? getProfileKellyFraction();
}
function kellyFractionLabel(value = getKellyFraction()) {
	return KELLY_FRACTIONS.find(([fraction]) => fraction === value)?.[1] || `${Number((value * 100).toFixed(4))}%`;
}
function kellyFractionOptions(includeDefault = false) {
	return (includeDefault ? `<option value="default">Use profile default (${kellyFractionLabel(getProfileKellyFraction())})</option>` : '') +
		KELLY_FRACTIONS.map(([value, label]) => `<option value="${value}">${label} Kelly</option>`).join('') + '<option value="custom">Custom percentage</option>';
}
function initKellyFractionFields(select, custom, value) {
	select.value = value === null ? 'default' : KELLY_FRACTIONS.some(([fraction]) => fraction === value) ? String(value) : 'custom';
	custom.value = Number(((value ?? getProfileKellyFraction()) * 100).toFixed(4));
	const update = () => {
		custom.parentElement.hidden = select.value !== 'custom';
		custom.disabled = select.value !== 'custom';
		custom.required = select.value === 'custom';
	};
	select.onchange = update;
	update();
}
function readKellyFractionFields(select, custom) {
	if (select.value === 'default') return null;
	const value = select.value === 'custom' ? Number(custom.value) / 100 : Number(select.value);
	if (!validKellyFraction(value)) throw new Error('Enter a percentage greater than 0 and at most 100.');
	return value;
}
async function refreshKellySizing() {
	if (RES?.data && TABLE && typeof changeFilter === 'function') await changeFilter();
	else if (TABLE) {
		TABLE.getRows().forEach(row => {
			const data = row.getData();
			if (data.line && Number.isFinite(Number(data.ev))) data.kelly = getKelly(data.line, data.ev);
			row.reformat();
		});
	}
	initKellyToggle();
}
function openKellySettings(event) {
	event?.stopPropagation();
	let dialog = document.getElementById('kelly-settings');
	if (!dialog) {
		dialog = document.createElement('dialog');
		dialog.id = 'kelly-settings';
		dialog.setAttribute('aria-labelledby', 'kelly-settings-title');
		dialog.innerHTML = `<form><h3 id="kelly-settings-title">Kelly sizing</h3>
			<p>This page only. Your profile default stays unchanged.</p>
			<label for="page-kelly-fraction">Fraction</label><select id="page-kelly-fraction"></select>
			<label class="kelly-custom">Percentage of full Kelly <input id="page-kelly-custom" type="number" min="0.0001" max="100" step="any"> %</label>
			<p class="kelly-status" role="status"></p>
			<div class="kelly-actions"><button type="button" class="kelly-cancel">Cancel</button><button type="submit">Apply</button></div></form>`;
		document.body.appendChild(dialog);
		dialog.querySelector('.kelly-cancel').onclick = () => dialog.close();
		dialog.querySelector('form').onsubmit = async event => {
			event.preventDefault();
			try {
				const value = readKellyFractionFields(dialog.querySelector('select'), dialog.querySelector('input'));
				const key = kellyPageKey();
				kellyPageOverrides.set(key, value);
				try {
					if (value === null) localStorage.removeItem(key);
					else localStorage.setItem(key, value);
				} catch (e) {}
				await refreshKellySizing();
				dialog.close();
			} catch (error) { dialog.querySelector('.kelly-status').textContent = error.message; }
		};
	}
	dialog.querySelector('select').innerHTML = kellyFractionOptions(true);
	initKellyFractionFields(dialog.querySelector('select'), dialog.querySelector('input'), getPageKellyOverride());
	dialog.querySelector('.kelly-status').textContent = '';
	dialog.showModal();
}
function getUnitSize() {
	return CURR_USER?.metadata?.unit_size || 100;
}
if (IS_PACKAGED_APP || window.location.protocol == "file:" || IS_LOCALHOST) {
	HTML = ".html";
}
if (!IS_LOCALHOST) {
	API_BASE = IS_PACKAGED_APP && window.EV_APP_CONFIG.apiBase || "https://api-production-3a3b.up.railway.app";
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
			{ label: "💣 Dingers", value: "dingers", tier: "analyst" },
			{ label: "Homer Parlays", value: "parlays", tier: "analyst" },
			{ label: "💨 Ks (FREE)", value: "strikeouts", tier: "free" },
			{ label: "⚾ Props", value: "mlb", tier: "sharp" },
			{ label: "🏆 MLB Main", value: "main?sport=mlb", tier: "sharp" },
			{ label: "📝 Main Recap", value: "main_recap?sport=mlb", tier: "free" },
			{ label: "⚾ Live", value: "live?sport=mlb", tier: "sharp" },
			{ label: "💣💣 2+ HR", value: "dingers2", tier: "analyst" },
			{ label: "🔮 Futures", value: "futures", tier: "sharp" },
			{ label: "🆚 BvP", value: "bvp", tier: "free" },
			{ label: "🆚 Matchups", value: "matchups", tier: "free" },
			{ label: "📊 Stats", value: "stats", tier: "free" },
			{ label: "🏏 Barrels", value: "barrels", tier: "free" },
			{ label: "🔍 Pitcher Preview", value: "preview", tier: "free" },
			{ label: "💨 Pitcher Ks Preview", value: "preview_k", tier: "free" },
			{ label: "📰 Pitcher Mix", value: "pitcher_mix", tier: "free" },
			{ label: "🔥 Top 3 Pitches", value: "top_pitches", tier: "free" },
			{ label: "📡 Feed", value: "feed", tier: "free" },
			{ label: "📊 Trends", value: "trends", tier: "free" },
			{ label: "📉 Movement", value: "movement?sport=mlb", tier: "sharp" },
			{ label: "🎟️ Bets", value: "bets?sport=mlb", tier: "sharp" },
			{ label: "📝 Recap", value: "recap", tier: "free" }
		]
	},
	{
		key: "nba", label: "🏀 NBA",
		pages: [
			{ label: "🏀 All Props", value: "nba", tier: "sharp" },
			{ label: "🏆 Main", value: "main?sport=nba", tier: "sharp" },
			{ label: "📝 Main Recap", value: "main_recap?sport=nba", tier: "free" },
			{ label: "Line Movement", value: "movement?sport=nba", tier: "sharp" },
			{ label: "🏀 Live", value: "live?sport=nba", tier: "sharp" },
			{ label: "🏀 KOTC", value: "kotc", tier: "free" },
			{ label: "📊 Results", value: "analysis?sport=nba", tier: "free" },
			{ label: "3PTM (Free)", value: "threes", tier: "free" },
			{ label: "PTS/REB/AST", value: "pts", tier: "analyst" },
			{ label: "🏀 CBB", value: "ncaab", tier: "sharp" },
			{ label: "🏆 WNBA Main", value: "main?sport=wnba", tier: "sharp" },
			{ label: "🏀 WNBA", value: "wnba", tier: "analyst" },
		]
	},
	{
		key: "nfl", label: "🏈 NFL",
		pages: [
			{ label: "🏈 TDs", value: "tds", tier: "analyst" },
			{ label: "🏈 Props", value: "nfl", tier: "sharp" },
			{ label: "First / Last TD", value: "ftd", tier: "analyst" },
			{ label: "🏈🏈 2+TD", value: "tds2", tier: "analyst" },
			{ label: "ATTD Parlays", value: "parlays?market=attd", tier: "analyst" },
			{ label: "🏈 Live", value: "live?sport=nfl", tier: "sharp" },
			{ label: "🏆 Main", value: "main?sport=nfl", tier: "sharp" },
			{ label: "🏈 NFL Game Tracker", value: "nfl_tracker", tier: "free" },
			{ label: "🏈 College Game Tracker", value: "nfl_tracker?sport=ncaaf", tier: "free" },
			{ label: "📝 Main Recap", value: "main_recap?sport=nfl", tier: "free" },
			{ label: "Line Movement", value: "movement?sport=nfl", tier: "sharp" },
			{ label: "🏈 Preseason", value: "preseason", tier: "sharp" },
			{ label: "🔮 Futures", value: "nfl_futures", tier: "free" },
			{ label: "🏈 CFB", value: "ncaaf", tier: "sharp" },
			{ label: "🏆 CFB Main", value: "main?sport=ncaaf", tier: "sharp" },
		]
	},
	{
		key: "nhl", label: "🏒 NHL",
		pages: [
			{ label: "🏒 Goals", value: "atgs", tier: "analyst" },
			{ label: "🏒 2+ Goals", value: "atgs2", tier: "analyst" },
			{ label: "First Goals", value: "fgs", tier: "analyst" },
			{ label: "🏒 Props", value: "nhl", tier: "sharp" },
			{ label: "🏒 Live", value: "live?sport=nhl", tier: "sharp" },
			{ label: "🏒 NHL Game Tracker", value: "nfl_tracker?sport=nhl", tier: "free" },
			{ label: "🏒 Main", value: "main?sport=nhl", tier: "sharp" },
			{ label: "📝 Main Recap", value: "main_recap?sport=nhl", tier: "free" },
			{ label: "ATGS Parlays", value: "parlays?market=atgs", tier: "analyst" },
			{ label: "ATGS Grades", value: "atgs-grades", tier: "analyst" },
			{ label: "Longshots", value: "longshots", tier: "sharp" },
			{ label: "Devig Results", value: "devig-results", tier: "sharp" },
			{ label: "Line Movement", value: "movement?sport=nhl", tier: "sharp" },
			{ label: "📊 Results", value: "analysis?sport=nhl", tier: "free" },
		]
	},
	{
		key: "other", label: "🌐 Other",
		pages: [
			{ label: "🎯 Recommendations", value: "recommendations", tier: "sharp" },
			{ label: "Bonus Bet Hedges", value: "hedge", tier: "analyst" },
			{ label: "Arbs & Middles", value: "arb", tier: "sharp" },
			{ label: "Calculators", value: "calculators", tier: "free" },
			{ label: "Line Movement / All Sports", value: "movement?sport=soccer", tier: "sharp" },
			{ label: "⚾ NCAA", value: "baseball_ncaa", tier: "sharp" },
			{ label: "⚽ Soccer", value: "soccer", tier: "analyst" },
			{ label: "🌍 World Cup", value: "cup", tier: "sharp" },
			{ label: "🥊 UFC", value: "ufc", tier: "analyst" },
			{ label: "🗺️ Heat Map", value: "heatmap", tier: "free" },
			{ label: "📋 Cheat Sheets", value: "cheat", tier: "free" },
			{ label: "⚾ Outliers", value: "outliers?sport=mlb", tier: "sharp" },
			{ label: "🏀 Outliers", value: "outliers?sport=nba", tier: "sharp" },
			{ label: "🏒 Outliers", value: "outliers?sport=nhl", tier: "sharp" },
		]
	},
	{
		key: "account", label: "👤",
		pages: [
			{ label: "⭐ Watchlist/Bets", value: "tracker", tier: "sharp" },
			{ label: "❓ FAQ", value: "faq" },
			{ label: "👤 Profile", value: "profile" },
			{ label: "💳 Pricing", value: "pricing" },
		]
	}
];

let _ppRenderGrid = null;

function getPageFavorites() {
	let saved;
	if (typeof CURR_USER !== 'undefined' && Array.isArray(CURR_USER?.metadata?.page_favorites)) saved = CURR_USER.metadata.page_favorites;
	else { try { saved = JSON.parse(localStorage.getItem("page_favorites") || "[]"); } catch(e) {} }
	return Array.isArray(saved) ? [...new Set(saved.filter(value => typeof value === "string"))] : [];
}

function setPageFavorites(favs) {
	try { localStorage.setItem("page_favorites", JSON.stringify(favs)); } catch(e) {}
	if (typeof CURR_USER !== 'undefined' && CURR_USER) {
		if (!CURR_USER.metadata) CURR_USER.metadata = {};
		CURR_USER.metadata.page_favorites = favs;
		if (typeof savePageFavorites === "function") savePageFavorites(favs);
	}
}

function togglePageFav(value) {
	let favs = getPageFavorites();
	favs = favs.includes(value) ? favs.filter(f => f !== value) : [...favs, value];
	setPageFavorites(favs);
	document.querySelectorAll("#page-picker-panel .pp-star").forEach(btn => {
		const starred = favs.includes(btn.dataset.val);
		btn.classList.toggle("starred", starred);
		btn.innerHTML = starred ? "&#9733;" : "&#9734;";
		btn.setAttribute("aria-pressed", String(starred));
		btn.setAttribute("aria-label", `${starred ? "Unstar" : "Star"} ${btn.dataset.label}`);
		btn.title = starred ? "Remove from favorites" : "Add to favorites";
	});
	const activeTab = document.querySelector("#page-picker-panel .pp-tab.active");
	if (activeTab?.dataset.key === "favorites" && _ppRenderGrid) {
		const restoreFocus = document.activeElement?.classList.contains("pp-star");
		_ppRenderGrid("favorites");
		if (restoreFocus) (document.querySelector("#page-picker-grid .pp-star") || document.getElementById("page-picker-search"))?.focus({ preventScroll: true });
	}
}

// Wait for each page's inline setup to set PAGE and SPORT before choosing its tab.
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", buildPagePicker, { once: true });
} else {
	setTimeout(buildPagePicker, 0);
}

function pagePickerValue() {
	const filename = window.location.pathname.split("/").pop().replace(/\.html$/, "");
	const knownFile = PAGE_SECTIONS.some(section => section.pages.some(page => page.value.split("?")[0] === filename));
	let page = knownFile ? filename : PAGE;
	if (PAGE === "props") page = SPORT;
	if (["main", "main_recap", "outliers", "live", "analysis", "movement", "bets"].includes(page)) {
		return `${page}?sport=${SPORT || new URLSearchParams(window.location.search).get("sport") || "mlb"}`;
	}
	if (page === "nfl_tracker" && ["nhl", "ncaaf"].includes(SPORT)) return `${page}?sport=${SPORT}`;
	if (page === "parlays") return SPORT === "nfl" ? "parlays?market=attd" : SPORT === "nhl" ? "parlays?market=atgs" : "parlays";
	return page;
}

function buildPagePicker() {
	const selectEl = document.getElementById("page-select");
	if (!selectEl || document.getElementById("page-picker-btn")) return;
	const wrapper = selectEl.closest(".select-wrapper") || selectEl.parentElement;
	if (!wrapper) return;
	const cleanLabel = label => label.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s*\(free\)/ig, "").trim();
	const names = { dingers: "Home runs", dingers2: "2+ home runs", strikeouts: "Strikeouts", tds: "Anytime touchdowns", tds2: "2+ touchdowns", ftd: "First / last touchdown", atgs: "Anytime goals", atgs2: "2+ goals", fgs: "First goal", tracker: "Watchlist & bets" };
	const aliases = { dingers: "dingers homer home runs hr baseball", dingers2: "dingers homer home runs hr", strikeouts: "ks pitcher strikeouts", tds: "attd touchdowns football", tds2: "touchdowns football", ftd: "ftd touchdowns football", atgs: "atgs anytime goal scorer goalscorer hockey", atgs2: "goalscorer hockey", fgs: "goalscorer hockey", tracker: "saved picks favorites bets", threes: "three pointers 3ptm", pts: "points rebounds assists", ncaaf: "college football cfb", ncaab: "college basketball cbb", mlb: "baseball", nfl: "football", nhl: "hockey", heatmap: "heat map history roi profit" };
	const entries = PAGE_SECTIONS.flatMap(section => section.pages.map(page => ({ ...page,
		section: section.key, sectionLabel: section.key === "account" ? "Account" : section.key === "other" ? "More" : cleanLabel(section.label),
		name: names[page.value] || cleanLabel(page.label),
		terms: `${section.key} ${section.label} ${page.label} ${page.value} ${aliases[page.value.split("?")[0]] || ""}`.toLowerCase()
	})));
	const currentEntry = () => entries.find(page => page.value === pagePickerValue());
	const validFavorites = () => getPageFavorites().filter(value => entries.some(page => page.value === value));
	let activeTab = validFavorites().length ? "favorites" : currentEntry()?.section || ({ ncaaf: "nfl", ncaab: "nba", wnba: "nba" }[SPORT] || SPORT || "other");
	if (!["favorites", ...PAGE_SECTIONS.map(section => section.key)].includes(activeTab)) activeTab = "other";
	const btn = document.createElement("button");
	btn.id = "page-picker-btn";
	btn.type = "button";
	btn.setAttribute("aria-haspopup", "dialog");
	btn.setAttribute("aria-controls", "page-picker-panel");
	btn.setAttribute("aria-expanded", "false");
	btn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg><span>Pages</span><svg class="pp-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>';
	wrapper.replaceWith(btn);
	const panel = document.createElement("div");
	panel.id = "page-picker-panel";
	panel.className = "pp-menu";
	panel.hidden = true;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-labelledby", "page-picker-title");
	panel.setAttribute("aria-describedby", "page-picker-tier-note");
	panel.innerHTML = `<div class="pp-heading"><div><strong id="page-picker-title">Explore pages</strong><span class="pp-context"></span><span class="pp-tier-note" id="page-picker-tier-note">Sharp includes all Analyst pages. All plans include Free.</span></div><button type="button" class="pp-close" aria-label="Close pages">&times;</button></div>
		<div id="page-picker-tabs" role="group" aria-label="Page sections"></div>
		<div class="pp-results-header"><strong id="page-picker-section"></strong><span id="page-picker-count" role="status" aria-live="polite"></span></div>
		<div id="page-picker-grid"></div><div class="pp-footer" id="page-picker-reorder-help">Star pages to keep them in Favorites.</div>
		<div class="pp-search-row"><div class="pp-search-wrap"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="page-picker-search" type="search" placeholder="Search pages or sports" aria-label="Search all pages" autocomplete="off" spellcheck="false"><button type="button" class="pp-search-clear" aria-label="Clear page search" hidden>&times;</button></div><button type="button" class="pp-reorder-toggle" aria-pressed="false" aria-controls="page-picker-grid" hidden>Reorder</button></div><span class="pp-reorder-status" role="status" aria-live="polite"></span>`;
	document.body.appendChild(panel);
	const search = panel.querySelector("#page-picker-search");
	const clear = panel.querySelector(".pp-search-clear");
	const grid = panel.querySelector("#page-picker-grid");
	const reorderButton = panel.querySelector(".pp-reorder-toggle");
	const tabs = [{ key: "favorites", label: "Favorites" }, ...PAGE_SECTIONS.map(section => ({ key: section.key, label: section.key === "account" ? "Account" : section.key === "other" ? "More" : cleanLabel(section.label) }))];
	panel.querySelector("#page-picker-tabs").innerHTML = tabs.map(tab => `<button type="button" class="pp-tab" data-key="${tab.key}" aria-pressed="false">${tab.label}</button>`).join("");

	function updateReorderControls(enabled = panel.classList.contains("pp-reordering")) {
		const canReorder = activeTab === "favorites" && !search.value.trim() && validFavorites().length > 1;
		const reordering = canReorder && enabled;
		panel.classList.toggle("pp-reordering", reordering);
		reorderButton.hidden = !canReorder;
		reorderButton.textContent = reordering ? "Done" : "Reorder";
		reorderButton.setAttribute("aria-pressed", String(reordering));
		reorderButton.setAttribute("aria-label", reordering ? "Finish reordering favorites" : "Reorder favorites");
		panel.querySelector(".pp-footer").textContent = reordering ? "Drag to reorder. Saves automatically. Keyboard: Alt + Up / Down."
			: canReorder ? "Choose Reorder to arrange your favorites." : "Star pages to keep them in Favorites.";
	}
	const tierLabels = { free: "Free", analyst: "Analyst", sharp: "Sharp" };
	function makeRow(page, reorderable = false) {
		const isCurrent = page.value === pagePickerValue();
		const starred = getPageFavorites().includes(page.value);
		const badge = page.tier ? `<span class="pp-badge pp-${page.tier}">${tierLabels[page.tier]}</span>` : "";
		return `<div class="pp-page-btn${isCurrent ? " current-page" : ""}${page.tier ? " pp-" + page.tier : ""}"${reorderable ? ` data-favorite="${escapeHtml(page.value)}"` : ''}>
			<a class="pp-page-link" data-page="${escapeHtml(page.value)}" href="${escapeHtml(getPageUrl(page.value))}"${isCurrent ? ' aria-current="page"' : ''}${reorderable ? ' draggable="false" aria-describedby="page-picker-reorder-help"' : ''}>${reorderable ? '<span class="pp-drag-grip" aria-hidden="true"><svg viewBox="0 0 16 20"><path d="M5 4h.01M11 4h.01M5 10h.01M11 10h.01M5 16h.01M11 16h.01"/></svg></span>' : ''}<span class="pp-label">${reorderable ? `<span class="pp-page-name" title="${escapeHtml(page.name)}">${escapeHtml(page.name)}</span><span class="pp-page-meta"><span class="pp-page-sport">${escapeHtml(page.sectionLabel)}</span>${badge}</span>` : escapeHtml(page.name)}</span>${reorderable ? '' : badge}${isCurrent ? '<span class="pp-current-dot" title="Current page" aria-hidden="true"></span>' : ''}</a>
			<button type="button" class="pp-star${starred ? " starred" : ""}" data-val="${escapeHtml(page.value)}" data-label="${escapeHtml(page.sectionLabel + ' ' + page.name)}" aria-label="${starred ? "Unstar" : "Star"} ${escapeHtml(page.sectionLabel + ' ' + page.name)}" aria-pressed="${starred}" title="${starred ? "Remove from favorites" : "Add to favorites"}">${starred ? "&#9733;" : "&#9734;"}</button></div>`;
	}
	function groupFor(page) {
		if (search.value.trim() || activeTab === "favorites") return page.sectionLabel;
		const route = page.value.split("?")[0];
		if (activeTab === "account") return "Your account";
		if (["live", "nfl_tracker", "feed"].includes(route)) return "Live & tracking";
		if (["recap", "main_recap", "analysis", "bets"].includes(route)) return "Results";
		if (["bvp", "matchups", "stats", "barrels", "preview", "preview_k", "pitcher_mix", "top_pitches", "trends", "movement", "longshots", "kotc", "recommendations", "heatmap", "cheat", "outliers", "atgs-grades", "arb", "calculators"].includes(route)) return "Research & tools";
		return "Markets";
	}
	function renderGrid(key = activeTab) {
		grid.dispatchEvent(new Event("pagepickercancel"));
		activeTab = key;
		const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
		const favorites = validFavorites();
		const reorderable = !words.length && activeTab === "favorites";
		const pages = reorderable ? favorites.map(value => entries.find(page => page.value === value)) : entries.filter(page => words.length ? words.every(word => `${page.terms} ${page.name.toLowerCase()}`.includes(word)) : page.section === activeTab);
		panel.querySelectorAll(".pp-tab").forEach(tab => {
			const selected = !words.length && tab.dataset.key === activeTab;
			tab.classList.toggle("active", selected);
			tab.setAttribute("aria-pressed", String(selected));
		});
		panel.querySelector("#page-picker-section").textContent = words.length ? "Search results" : tabs.find(tab => tab.key === activeTab)?.label || "Pages";
		panel.querySelector("#page-picker-count").textContent = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;
		clear.hidden = !search.value;
		updateReorderControls();
		const groups = new Map();
		pages.forEach(page => { const group = groupFor(page); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(page); });
		grid.innerHTML = (reorderable && pages.length ? `<div class="pp-favorites-list">${pages.map(page => makeRow(page, true)).join("")}</div>` : [...groups].map(([name, pages]) => `<section class="pp-group"><h3>${escapeHtml(name)}</h3><div class="pp-group-pages">${pages.map(page => makeRow(page)).join("")}</div></section>`).join("")) || `<div class="pp-empty"><strong>${words.length ? "No pages found" : "Your shortcuts start here"}</strong><p>${words.length ? "Try a sport, market, or page name." : "Choose a sport and star a page to save it here."}</p></div>`;
		grid.scrollTop = 0;
	}
	_ppRenderGrid = renderGrid;
	renderGrid();
	initPageFavoriteDrag(panel, grid, () => renderGrid("favorites"), updateReorderControls);
	panel.addEventListener("pagepickerclose", () => updateReorderControls(false));
	reorderButton.addEventListener("click", () => {
		grid.dispatchEvent(new Event("pagepickercancel"));
		updateReorderControls(!panel.classList.contains("pp-reordering"));
	});
	function positionPanel() {
		if (panel.hidden) return;
		const viewport = window.visualViewport;
		const width = viewport?.width || window.innerWidth;
		const height = viewport?.height || window.innerHeight;
		panel.classList.toggle("pp-tight", height < 500);
		const leftOffset = viewport?.offsetLeft || 0;
		const topOffset = viewport?.offsetTop || 0;
		const rect = btn.getBoundingClientRect();
		const top = Math.max(topOffset + 8, Math.min(rect.bottom + 8, topOffset + height - 220));
		panel.style.maxWidth = `${width - 16}px`;
		panel.style.maxHeight = `${Math.min(680, Math.max(80, topOffset + height - top - 8))}px`;
		panel.style.top = `${top}px`;
		panel.style.left = `${getDropdownLeft(rect.left, panel.offsetWidth, leftOffset, width)}px`;
	}
	btn.addEventListener("click", event => {
		event.stopPropagation();
		if (!panel.hidden) { closePicker(); return; }
		const current = currentEntry();
		panel.querySelector(".pp-context").textContent = current ? `${current.sectionLabel} / ${current.name}` : "Find your next market";
		search.value = "";
		renderGrid();
		panel.hidden = false;
		panel.style.display = "flex";
		btn.setAttribute("aria-expanded", "true");
		positionPanel();
		if (!MOBILE && CURRENT_VIEW !== "mobile") search.focus({ preventScroll: true });
	});
	panel.addEventListener("click", event => {
		event.stopPropagation();
		const star = event.target.closest(".pp-star");
		if (star) { togglePageFav(star.dataset.val); return; }
		const tab = event.target.closest(".pp-tab");
		if (tab) { search.value = ""; renderGrid(tab.dataset.key); return; }
		const link = event.target.closest(".pp-page-link");
		if (link && panel.classList.contains("pp-reordering")) { event.preventDefault(); return; }
		if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
			event.preventDefault(); closePicker(); changePage(link.dataset.page);
		}
	});
	search.addEventListener("input", () => renderGrid());
	clear.addEventListener("click", () => { search.value = ""; renderGrid(); search.focus(); });
	panel.querySelector(".pp-close").addEventListener("click", () => closePicker(true));
	panel.addEventListener("keydown", event => {
		if (event.defaultPrevented) return;
		const links = [...grid.querySelectorAll(".pp-page-link")];
		if (event.key === "ArrowDown" && event.target === search && links.length) { event.preventDefault(); links[0].focus(); }
		else if (["ArrowDown", "ArrowUp"].includes(event.key) && event.target.matches(".pp-page-link")) {
			event.preventDefault(); const index = links.indexOf(event.target) + (event.key === "ArrowDown" ? 1 : -1);
			(links[index] || search).focus();
		}
	});
	document.addEventListener("click", event => { if (!panel.contains(event.target) && !btn.contains(event.target)) closePicker(); });
	document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); closePicker(true); } });
	document.addEventListener("focusin", event => { if (!panel.hidden && !panel.contains(event.target) && !btn.contains(event.target)) closePicker(); });
	window.addEventListener("resize", positionPanel);
	window.visualViewport?.addEventListener("resize", positionPanel);
	window.visualViewport?.addEventListener("scroll", positionPanel);
	document.getElementById('header')?.addEventListener('scroll', event => {
		if (panel.hidden) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const rect = btn.getBoundingClientRect();
		if (rect.right <= bounds.left || rect.left >= bounds.right) closePicker();
		else positionPanel();
	}, { passive: true });
}

function initPageFavoriteDrag(panel, grid, render, setReordering) {
	let session = null;
	let blockDragClick = false;
	const isReordering = () => panel.classList.contains("pp-reordering");
	const rows = () => [...grid.querySelectorAll("[data-favorite]")];
	const announce = text => { panel.querySelector(".pp-reorder-status").textContent = text; };
	const saveOrder = order => setPageFavorites([...order, ...getPageFavorites().filter(value => !order.includes(value))]);
	const restoreLink = value => [...grid.querySelectorAll(".pp-page-link")].find(link => link.dataset.page === value)?.focus({ preventScroll: true });
	function finish(commit = false) {
		const drag = session;
		if (!drag) return;
		session = null;
		cancelAnimationFrame(drag.frame);
		grid.classList.remove("pp-dragging");
		drag.row.classList.remove("pp-drag-source");
		drag.rows.forEach(row => row.style.removeProperty("order"));
		drag.layer?.remove();
		if (drag.kind === "pointer" && grid.hasPointerCapture?.(drag.id)) grid.releasePointerCapture(drag.id);
		if (!drag.active) return;
		blockDragClick = true;
		const changed = drag.order.some((value, index) => value !== drag.original[index]);
		if (commit && changed) saveOrder(drag.order);
		const scroll = grid.scrollTop;
		render();
		grid.scrollTop = scroll;
		if (drag.kind === "pointer") restoreLink(drag.value);
		announce(commit ? `${drag.name} at position ${drag.order.indexOf(drag.value) + 1} of ${drag.order.length}.` : "Reorder canceled.");
	}
	function preview() {
		const drag = session;
		if (!drag?.active) return;
		drag.ghost.style.left = `${drag.x - drag.offsetX}px`;
		drag.ghost.style.top = `${drag.y - drag.offsetY}px`;
		// Include the source slot so a placed card stays put until the pointer reaches another slot.
		const slots = drag.rows.map(row => ({ row, rect: row.getBoundingClientRect() }))
			.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
		let index = 0, closest = Infinity;
		slots.forEach(({ rect }, position) => {
			const dx = Math.max(rect.left - drag.x, 0, drag.x - rect.right);
			const dy = Math.max(rect.top - drag.y, 0, drag.y - rect.bottom);
			const distance = dx * dx + dy * dy;
			if (distance < closest) { closest = distance; index = position; }
		});
		if (slots[index].row === drag.row) return;
		drag.order = slots.filter(slot => slot.row !== drag.row).map(slot => slot.row.dataset.favorite);
		drag.order.splice(index, 0, drag.value);
		drag.rows.forEach(row => { row.style.order = drag.order.indexOf(row.dataset.favorite); });
	}
	function scrollFrame() {
		const drag = session;
		if (!drag?.active) return;
		const rect = grid.getBoundingClientRect();
		const edge = Math.min(40, rect.height / 3);
		const speed = drag.y < rect.top + edge ? -Math.min(10, (rect.top + edge - drag.y) / 4)
			: drag.y > rect.bottom - edge ? Math.min(10, (drag.y - rect.bottom + edge) / 4) : 0;
		if (speed && drag.moved) { grid.scrollTop += speed; preview(); }
		drag.frame = requestAnimationFrame(scrollFrame);
	}
	function begin(drag) {
		if (session !== drag || panel.hidden || !drag.row.isConnected) return;
		drag.active = true;
		blockDragClick = true;
		const rect = drag.row.getBoundingClientRect();
		drag.offsetX = drag.x - rect.left;
		drag.offsetY = drag.y - rect.top;
		drag.layer = document.createElement("div");
		drag.layer.id = "page-picker-drag-layer";
		drag.layer.setAttribute("aria-hidden", "true");
		drag.layer.inert = true;
		drag.ghost = drag.row.cloneNode(true);
		drag.ghost.classList.add("pp-drag-ghost");
		drag.ghost.removeAttribute("data-favorite");
		drag.ghost.style.width = `${rect.width}px`;
		drag.ghost.style.height = `${rect.height}px`;
		drag.layer.appendChild(drag.ghost);
		document.body.appendChild(drag.layer);
		drag.row.classList.add("pp-drag-source");
		grid.classList.add("pp-dragging");
		if (drag.kind === "pointer") grid.setPointerCapture?.(drag.id);
		preview();
		announce(`Moving ${drag.name}. Release to place it; Escape cancels.`);
		drag.frame = requestAnimationFrame(scrollFrame);
	}
	function prepare(target, id, x, y, kind) {
		finish(false);
		blockDragClick = false;
		if (!isReordering()) return;
		const row = target.closest("[data-favorite]");
		const cards = rows();
		if (!row || target.closest(".pp-star") || cards.length < 2) return;
		const order = cards.map(card => card.dataset.favorite);
		const drag = { row, rows: cards, id, kind, x, y, startX: x, startY: y, value: row.dataset.favorite,
			name: row.querySelector(".pp-label").firstChild.textContent.trim(), order, original: order.slice(), active: false };
		session = drag;
		begin(drag);
	}
	function move(x, y, event) {
		if (!session?.active) return;
		session.x = x; session.y = y;
		if (event.cancelable) event.preventDefault();
		session.moved = session.moved || Math.hypot(x - session.startX, y - session.startY) > 3;
		preview();
	}
	function inside(x, y) {
		const rect = grid.getBoundingClientRect();
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}
	grid.addEventListener("pointerdown", event => {
		if (event.pointerType !== "touch" && event.button === 0 && event.isPrimary) prepare(event.target, event.pointerId, event.clientX, event.clientY, "pointer");
	});
	document.addEventListener("pointermove", event => { if (session?.kind === "pointer" && session.id === event.pointerId) move(event.clientX, event.clientY, event); });
	document.addEventListener("pointerup", event => { if (session?.kind === "pointer" && session.id === event.pointerId) finish(inside(event.clientX, event.clientY)); });
	document.addEventListener("pointercancel", event => { if (session?.kind === "pointer" && session.id === event.pointerId) finish(false); });
	grid.addEventListener("lostpointercapture", () => { if (session?.kind === "pointer") finish(false); });
	// Browse mode keeps swipes native; Reorder mode starts touch dragging immediately. 
	grid.addEventListener("touchstart", event => {
		if (event.touches.length !== 1) { finish(false); return; }
		const touch = event.touches[0];
		prepare(event.target, touch.identifier, touch.clientX, touch.clientY, "touch");
		if (session?.active && event.cancelable) event.preventDefault();
	}, { passive: false });
	grid.addEventListener("touchmove", event => {
		if (session?.kind !== "touch") return;
		const touch = [...event.touches].find(touch => touch.identifier === session.id);
		if (touch) move(touch.clientX, touch.clientY, event);
	}, { passive: false });
	grid.addEventListener("touchend", event => {
		if (session?.kind !== "touch") return;
		const touch = [...event.changedTouches].find(touch => touch.identifier === session.id);
		if (!touch) return;
		if (session.active && event.cancelable) event.preventDefault();
		finish(inside(touch.clientX, touch.clientY));
	}, { passive: false });
	grid.addEventListener("touchcancel", () => { if (session?.kind === "touch") finish(false); });
	grid.addEventListener("click", event => { if (blockDragClick) { blockDragClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
	grid.addEventListener("contextmenu", event => { if (session) event.preventDefault(); });
	grid.addEventListener("dragstart", event => { if (event.target.closest("[data-favorite]")) event.preventDefault(); });
	grid.addEventListener("pagepickercancel", () => finish(false));
	panel.addEventListener("keydown", event => {
		if (event.key === "Escape" && isReordering()) {
			event.preventDefault(); event.stopImmediatePropagation();
			if (session?.active) finish(false);
			else {
				setReordering(false);
				panel.querySelector(".pp-reorder-toggle").focus({ preventScroll: true });
				announce("Reordering finished.");
			}
			return;
		}
		blockDragClick = false;
		const row = event.target.closest("[data-favorite]");
		if (!isReordering() || !row || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
		event.preventDefault(); event.stopImmediatePropagation();
		const order = rows().map(card => card.dataset.favorite);
		const index = order.indexOf(row.dataset.favorite);
		const next = index + (event.key === "ArrowUp" ? -1 : 1);
		if (next < 0 || next >= order.length) return;
		[order[index], order[next]] = [order[next], order[index]];
		saveOrder(order); render(); restoreLink(row.dataset.favorite);
		announce(`Moved to position ${next + 1} of ${order.length}.`);
	});
	window.addEventListener("blur", () => finish(false));
	document.addEventListener("visibilitychange", () => { if (document.hidden) finish(false); });
}

function closePicker(restoreFocus = false) {
	const panel = document.getElementById("page-picker-panel");
	if (!panel) return;
	panel.querySelector("#page-picker-grid")?.dispatchEvent(new Event("pagepickercancel"));
	panel.dispatchEvent(new Event("pagepickerclose"));
	panel.hidden = true;
	panel.style.display = "none";
	const button = document.getElementById("page-picker-btn");
	button?.setAttribute("aria-expanded", "false");
	if (restoreFocus) button?.focus({ preventScroll: true });
}

function openProfile() { changePage("profile"); }

function changePage(page) {
	if (IS_PACKAGED_APP && window.EVNative) return window.EVNative.navigate(page);
	window.location.href = getPageUrl(page);
}

function getPageUrl(page) {
	const [target, hash] = String(page).split("#");
	let [route, query = ""] = target.split("?");
	route = route.replace(/\.html$/, "");
	const params = new URLSearchParams(query);
	if (route === "historical" && !params.has("historical")) params.set("historical", "z");
	if (route === "kambi") { route = "dingers"; params.set("kambi", "true"); }
	const defaults = { main: "mlb", main_recap: "mlb", bets: "mlb", live: "attd", analysis: "nba", outliers: "nba", cheat: "nba", movement: "atgs" };
	if (defaults[route] && !params.has("sport")) params.set("sport", defaults[route]);
	const suffix = params.toString();
	return `./${route}${HTML}${suffix ? `?${suffix}` : ""}${hash ? `#${hash}` : ""}`;
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
		HR_OH: "Hardrock (OH)",
		MGM: "BetMGM",
		BR: "BetRivers",
		FL: "Fliff",
		RE: "ReBet",
		KAL: "Kalshi",
		NV: "NoVig",
		PX: "ProphetX",
		POLY: "Polymarket",
		KAMBI: "Kambi",
		ESPN: "ESPN"
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

// Display-only conversion - EV/fairVal comparisons everywhere else stay in American odds.
// Named distinctly from the existing americanToDecimal() (used for probability/EV math
// further down this file) since duplicate `function` declarations in the same scope
// silently overwrite each other - that collision was why toFixed(2) wasn't taking effect.
function oddsAmericanToDecimal(american) {
	const n = parseInt(american, 10);
	if (isNaN(n)) return american;
	const dec = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
	return dec.toFixed(2);
}

function oddsDisplay(val) {
	// Signed-in users read from their profile; logged-out falls back to the local-only
	// preference saveOddsFormat() writes when there's no CURR_USER to persist to.
	let format = CURR_USER?.metadata?.odds_format;
	if (!format && !CURR_USER) {
		try { format = localStorage.getItem("odds_format"); } catch (e) {}
	}
	if ((format || "american") !== "decimal") return val;
	return oddsAmericanToDecimal(val);
}

// One browser preference shared by the odds screens. URL views override it.
function supportsOddsViews() {
	return !!document.getElementById('custom-view-select');
}

function getSavedOddsView(requested) {
	const normalize = view => view === 'stacked' ? 'table' : ['table', 'compact', 'mobile'].includes(view) ? view : null;
	if (!supportsOddsViews()) return requested || 'table';
	let saved;
	try {
		saved = localStorage.getItem('odds-view');
		if (!saved && localStorage.getItem('dingers-odds-layout') === 'compact') saved = 'compact';
	} catch (e) {}
	return normalize(requested) || normalize(saved) || 'table';
}

function isStackedOddsCell(cell) {
	return supportsOddsViews() && CURRENT_VIEW === 'table' && cell.getTable().element.id === 'table';
}

function recordColumnVisible() {
	const metadata = CURR_USER?.metadata;
	if (!metadata?.[PAGE]) return true;
	// Dingers already offered this column; retain its existing saved preference.
	if (PAGE !== 'dingers' && !metadata[`${PAGE}-record-column-version`]) return true;
	return metadata[PAGE].includes('roiRecord');
}

const OPENING_PRICE_DESCRIPTION = 'Earliest captured price after at least four sportsbooks quoted this selection and line. Same book as the current price, without boosts; not a verified sportsbook opener.';

function openingColumnVisible() {
	const metadata = CURR_USER?.metadata;
	if (!metadata) return true;
	if (metadata[PAGE]?.includes('openingPrice')) return true;
	// Existing layouts opt in through Customize; a reorder includes hidden keys too.
	if (metadata[PAGE] || metadata[`${PAGE}-opening-column-version`]) return false;
	const orderKey = `${PAGE === 'preseason' ? 'main' : PAGE}-order`;
	// NHL added reordering after Open, so an order alone is not a legacy layout.
	return PAGE === 'nhl' || !metadata[orderKey]?.length;
}

function openingPriceQuote(data) {
	if (!data || data.blurred) return null;
	const { book } = displayedBestBookQuote(data, PAGE, false);
	if (!book || (book === 'circa' && data.circa_blurred)) return null;
	// The backend can supply an explicit index when it projects a multiway market.
	const side = data.openingSide ?? data.ouIdx ?? (data.under ? 1 : 0);
	if (!Number.isInteger(side) || side < 0) return null;
	const checkpoint = data.opening?.[side];
	const price = checkpoint?.books?.[book];
	if (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price) < 100) return null;
	return { book, price, checkpoint };
}

function renderOpeningPrice(data) {
	const quote = openingPriceQuote(data);
	if (!quote) return '-';
	const display = price => oddsDisplay(price > 0 ? `+${price}` : String(price));
	const time = value => {
		const date = new Date(value);
		return value && !isNaN(date) ? date.toLocaleString(undefined, { timeZoneName: 'short' }) : 'unavailable';
	};
	const { book, price, checkpoint } = quote;
	const quotes = Object.entries(checkpoint.books)
		.filter(([key, value]) => !(key === 'circa' && data.circa_blurred) && typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= 100)
		.map(([key, value]) => `${key.toUpperCase()}: ${display(value)}`).join('; ');
	const element = document.createElement('span');
	element.className = 'opening-price';
	element.textContent = display(price);
	element.title = `${book.toUpperCase()} opening capture: ${time(checkpoint.captured)}\n${OPENING_PRICE_DESCRIPTION}\n${quotes}`;
	if (checkpoint.updated?.[book]) element.title += `\n${book.toUpperCase()} quote updated: ${time(checkpoint.updated[book])}`;
	return element.outerHTML;
}

function openingPriceColumn() {
	return {
		title: 'Open', field: 'openingPrice', width: 75, minWidth: 65, responsive: 0,
		visible: openingColumnVisible(), headerTooltip: OPENING_PRICE_DESCRIPTION,
		formatter: cell => renderOpeningPrice(cell.getRow().getData()),
		sorter: (a, b, aRow, bRow, column, dir) => {
			const left = openingPriceQuote(aRow.getData())?.price;
			const right = openingPriceQuote(bRow.getData())?.price;
			if (left == null && right == null) return 0;
			if (left == null) return dir === 'asc' ? 1 : -1;
			if (right == null) return dir === 'asc' ? -1 : 1;
			return left - right;
		}
	};
}

function ensureOpeningColumnControl(table = TABLE) {
	const column = table?.getColumns().find(col => col.getField() === 'openingPrice');
	const items = document.getElementById('items');
	if (!column || !items) return;
	let checkbox = document.getElementById('custom_openingPrice');
	if (!checkbox) {
		const control = document.createElement('div');
		control.innerHTML = '<input id="custom_openingPrice" type="checkbox"><label for="custom_openingPrice">Open</label>';
		control.title = OPENING_PRICE_DESCRIPTION;
		const bookControl = items.querySelector('#custom_book')?.parentElement;
		if (bookControl) bookControl.after(control);
		else items.appendChild(control);
		checkbox = control.querySelector('input');
	}
	checkbox.checked = column.isVisible();
}

function recordROIColumn() {
	return {
		title: 'Record<br><span style="font-size: 10px; font-weight: normal;">100-odds bins<br>1% EV bins</span>',
		field: 'roiRecord', width: 80, minWidth: 80, headerSort: false,
		formatter: recordROIFormatter, visible: recordColumnVisible(),
		headerTooltip: 'Historical W\u2013L and ROI grouped into 100-point American odds ranges and 1-percentage-point EV ranges, e.g. +500 to below +600 odds and 8% to below 9% EV.'
	};
}

function ensureRecordColumnControl() {
	if (document.getElementById('custom_roiRecord')) return;
	const evControl = document.getElementById('custom_ev')?.parentElement;
	if (!evControl) return;
	const control = document.createElement('div');
	control.innerHTML = '<input id="custom_roiRecord" type="checkbox"><label for="custom_roiRecord">Record (Stacked)</label>';
	evControl.after(control);
}

function ensureLineColumnControl() {
	if (!TABLE) return;
	const column = TABLE.getColumns().find(col => col.getField() === 'handicap');
	const items = document.getElementById('items');
	if (!column || !items) return;
	let checkbox = items.querySelector('#custom_handicap');
	if (!checkbox) {
		const control = document.createElement('div');
		control.innerHTML = '<input id="custom_handicap" type="checkbox"><label for="custom_handicap">Line</label>';
		const playerControl = items.querySelector('#custom_player')?.parentElement;
		if (playerControl) playerControl.after(control);
		else items.appendChild(control);
		checkbox = control.querySelector('input');
	}
	checkbox.checked = column.isVisible();
}

function syncBookOddsToggle(table = TABLE) {
	if (!table) return;
	const columns = table.getColumns();
	const oddsColumns = columns.filter(col => col.getField()?.startsWith('bookOdds.'));
	if (!oddsColumns.length) return;
	let button = table.element.querySelector('#toggle-bookodds-btn');
	if (supportsOddsViews()) {
		const hostField = CURRENT_VIEW === 'table' ? 'ev' : 'book';
		const host = columns.find(col => col.getField() === hostField);
		const title = host?.getElement().querySelector('.tabulator-col-title');
		if (title) {
			if (!button) {
				button = document.createElement('button');
				button.id = 'toggle-bookodds-btn';
			}
			if (button.parentElement !== title) title.appendChild(button);
		}
	}
	if (!button) return;
	button.type = 'button';
	button.onclick = event => {
		event.preventDefault();
		event.stopPropagation();
		toggleBookOddsColumns();
	};
	const visible = oddsColumns.some(col => col.isVisible());
	const expanded = String(visible);
	if (button.getAttribute('aria-expanded') !== expanded) {
		button.innerHTML = `<span id="book-odds-toggle">${visible ? '\u2212' : '+'}</span> ${visible ? 'Hide' : 'Show'} Odds`;
		button.setAttribute('aria-expanded', expanded);
		button.title = `${visible ? 'Hide' : 'Show'} sportsbook odds columns`;
	}
}

const oddsTableViewStates = new WeakMap();
function syncOddsSummaryColumns(table = TABLE) {
	const state = oddsTableViewStates.get(table);
	if (!state || state.syncing) return;
	state.syncing = true;
	try {
		const columns = new Map(table.getColumns().map(col => [col.getField(), col]));
		const record = columns.get('roiRecord');
		if (record) {
			const stacked = CURRENT_VIEW === 'table';
			if (stacked && state.visibility.roiRecord !== false) record.show();
			else record.hide();
			const checkbox = document.getElementById('custom_roiRecord');
			if (checkbox) {
				checkbox.disabled = !stacked;
				checkbox.checked = state.visibility.roiRecord !== false;
				checkbox.parentElement.title = stacked ? '' : 'Available in Stacked view.';
			}
		}
		for (const [field, host, label, formatter] of [
			['fairVal', 'ev', 'Expected Value', evFormatter],
			['book', 'player', 'Player', playerFormatter]
		]) {
			const column = columns.get(field), parent = columns.get(host);
			if (!column || !parent || parent.getDefinition().formatter !== formatter) continue;
			const combined = CURRENT_VIEW === 'table' && parent.isVisible();
			if (combined || state.visibility[field] === false) column.hide();
			else column.show();
			const checkbox = document.getElementById(`custom_${field}`);
			if (checkbox) {
				checkbox.disabled = combined;
				checkbox.checked = state.visibility[field] !== false;
				checkbox.parentElement.title = combined ? `Shown underneath ${label} in Stacked view.` : '';
			}
		}
	} finally { state.syncing = false; }
}

function applyOddsTableView(table = TABLE) {
	if (!supportsOddsViews()) return;
	const tableElement = document.getElementById('table');
	tableElement?.classList.toggle('stacked-odds', CURRENT_VIEW === 'table');
	const mobile = CURRENT_VIEW === 'mobile';
	document.getElementById('table-container')?.classList.toggle('card-view', mobile);
	if (tableElement) tableElement.style.display = mobile ? 'none' : 'initial';
	const cards = document.getElementById('card-container');
	if (cards) cards.style.display = mobile ? 'grid' : 'none';
	const playerFilter = document.querySelector('.filter-wrapper');
	if (playerFilter) playerFilter.style.display = mobile ? 'flex' : 'none';
	const state = oddsTableViewStates.get(table);
	if (!state) return;
	for (const col of table.getColumns()) {
		const original = state.widths.get(col.getField());
		if (!original) continue;
		const stacked = CURRENT_VIEW === 'table';
		const width = stacked ? Math.max(110, original.width) : original.width;
		const def = col.getDefinition();
		def.minWidth = stacked ? Math.max(110, original.minWidth) : original.minWidth;
		def.width = width;
		if (col.getWidth() !== width) col.setWidth(width);
	}
	syncOddsSummaryColumns(table);
	syncBookOddsToggle(table);
	table.getRows().forEach(row => { row.reformat(); row.normalizeHeight(); });
	table.redraw(true);
}

function initializeOddsTableView(table) {
	if (!supportsOddsViews() || oddsTableViewStates.has(table)) return;
	if (typeof initializeCardBookOrder === 'function') initializeCardBookOrder(table);
	const state = { visibility: {}, widths: new Map(), syncing: false };
	oddsTableViewStates.set(table, state);
	let addingRecord = false;
	const capture = async () => {
		if (addingRecord) return;
		const columns = table.getColumns();
		if (!columns.some(col => col.getField() === 'roiRecord') &&
			columns.some(col => col.getField() === 'ev') &&
			columns.some(col => col.getDefinition().formatter === playerFormatter)) {
			addingRecord = true;
			try { await table.addColumn(recordROIColumn(), false, 'ev'); }
			finally { addingRecord = false; }
		}
		if (table.getColumns().some(col => col.getField() === 'roiRecord')) ensureRecordColumnControl();
		if (!table.getColumns().some(col => col.getField() === 'openingPrice') && columns.some(col => col.getField() === 'ev')) {
			addingRecord = true;
			try { await table.addColumn(openingPriceColumn(), false, columns.some(col => col.getField() === 'book') ? 'book' : 'ev'); }
			finally { addingRecord = false; }
		}
		ensureOpeningColumnControl(table);
		state.widths.clear();
		for (const col of table.getColumns()) {
			const field = col.getField();
			// Rebuilds can finish after Stacked has hidden these separate columns.
			// Keep the user's preference instead of capturing that temporary layout.
			if (['fairVal', 'book', 'roiRecord'].includes(field) && state.visibility[field] === undefined) {
				state.visibility[field] = col.isVisible();
			}
			if (['bookOdds.kal', 'bookOdds.nv', 'bookOdds.px', 'bookOdds.poly'].includes(field)) {
				state.widths.set(field, { width: col.getWidth(), minWidth: col.getDefinition().minWidth || 40 });
			}
		}
		applyOddsTableView(table);
	};
	table.on('columnVisibilityChanged', (column, visible) => {
		if (state.syncing) return;
		const field = column.getField();
		if (['fairVal', 'book'].includes(field)) state.visibility[field] = visible;
		if (field === 'roiRecord') state.visibility.roiRecord = visible;
		if (['ev', 'player', 'book', 'fairVal', 'roiRecord'].includes(field)) syncOddsSummaryColumns(table);
		if (field?.startsWith('bookOdds.')) syncBookOddsToggle(table);
	});
	table.on('columnsLoaded', capture);
	// Open depends on book, side and checkpoint fields, not its synthetic field.
	table.on('rowUpdated', row => row.reformat());
	return capture();
}

// ── Watchlist ────────────────────────────────────────────────────────────────
function _normPlayer(p) { return (p || "").toLowerCase().trim(); }
function watchlistSport(sport) {
	return ({ k: "mlb", atgs: "nhl", props: "nfl" })[sport] || sport || "";
}

function watchlistPage(entry) {
	// Older favorites have no source page; MLB's original home was Dingers.
	const sport = watchlistSport(entry.sport) || "mlb";
	return entry.page || (sport === "mlb" ? "dingers" : sport);
}

function watchlistProp(entry) {
	// Only infer a missing prop for pages dedicated to a single market.
	const legacyProp = ({ dingers: "hr", strikeouts: "k" })[watchlistPage(entry)];
	return (entry.prop || legacyProp || "").toLowerCase().trim();
}

function watchlistQuoteNumber(value) {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (!/^[+-]?\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function sanitizeWatchlistQuote(quote) {
	if (!quote || typeof quote !== "object") return null;
	const book = typeof quote.book === "string" ? quote.book.trim().toLowerCase() : "";
	const odds = watchlistQuoteNumber(quote.odds);
	if (!/^[a-z0-9_-]+$/.test(book) || odds == null || Math.abs(odds) < 100) return null;
	const result = { book, odds, under: quote.under === true };
	const handicap = watchlistQuoteNumber(quote.handicap);
	if (handicap != null) result.handicap = handicap;
	if (typeof quote.game === "string" && quote.game.trim()) result.game = quote.game.trim();
	return result;
}

// Use the same price as Best Book, including its selected side and exchange fee.
function displayedBestBookQuote(data, page = PAGE, applyFees = true) {
	const outlier = ["outliers", "atgs2", "tds2"].includes(page);
	const book = outlier ? data.outlierBook : data.book;
	let line = outlier ? data.outlierLine : data.line;
	const feeFn = applyFees && typeof BOOK_FEE_FUNCTIONS !== "undefined" && BOOK_FEE_FUNCTIONS[book];
	if (line != null && feeFn && data.bookOdds?.[book]) {
		const feeParts = String(feeFn(data.bookOdds[book], data, page)).split("/");
		const feePick = data.under && feeParts.length > 1 ? feeParts[1] : feeParts[0];
		const feeNum = parseInt(feePick.replace("+", ""), 10);
		if (!isNaN(feeNum)) line = feeNum;
	}
	return { book, line };
}

function watchlistQuote(data, page = PAGE, applyFees = true) {
	if (!data || data.blurred) return null;
	const { book, line } = displayedBestBookQuote(data, page, applyFees);
	return sanitizeWatchlistQuote({ book, odds: line, handicap: data.handicap,
		under: data.under, game: data.game });
}

function watchlistQuoteFromStar(star) {
	if (star.watchlistRow) return watchlistQuote(star.watchlistRow.getData(), star.dataset.page);
	try { return sanitizeWatchlistQuote(JSON.parse(star.dataset.quote || "null")); }
	catch { return null; }
}

function watchlistMatches(entry, player, sport, page, prop = "") {
	return _normPlayer(entry.player ?? entry) === _normPlayer(player)
		&& (!entry.sport || !sport || watchlistSport(entry.sport) === watchlistSport(sport))
		&& watchlistPage(entry) === page
		&& watchlistProp(entry) === watchlistProp({ page, prop });
}

function isWatchlisted(player, sport = SPORT, page = PAGE, prop = "") {
	const p = _normPlayer(player);
	sport = watchlistSport(sport);
	if (!p) return false;
	return (CURR_USER?.metadata?.watchlist || []).some(w => watchlistMatches(w, p, sport, page, prop));
}

function isTracked(player, sport = SPORT) {
	const p = _normPlayer(player);
	sport = watchlistSport(sport);
	if (!p) return false;
	return (CURR_USER?.metadata?.bets || []).some(b => {
		const bp = _normPlayer(b.player);
		return bp && (!b.sport || !sport || b.sport === sport) && (p.includes(bp) || bp.includes(p));
	});
}

function _starColor(player, sport = SPORT, page = PAGE, prop = "") {
	if (isWatchlisted(player, sport, page, prop)) return "#f59e0b";
	if (isTracked(player, sport)) return "#3b82f6";
	return "#6b7280";
}

const pendingWatchlistPlayers = new Set();
let watchlistSaveQueue = Promise.resolve();
let watchlistStatusTimer;

function updateWatchlistStar(star) {
	const { player, sport, page = PAGE, prop = "" } = star.dataset;
	const watched = isWatchlisted(player, sport, page, prop);
	const tracked = isTracked(player, sport);
	const signedIn = !!(CURR_USER && CURR_SESSION);
	star.textContent = watched || tracked ? "★" : "☆";
	star.style.color = _starColor(player, sport, page, prop);
	star.disabled = !signedIn || pendingWatchlistPlayers.has(JSON.stringify([page, sport, player, prop]));
	star.title = !signedIn ? "Sign in to add to your watchlist" : watched ? "Remove from watchlist" : tracked ? "In tracker; add to watchlist" : "Add to watchlist";
	star.setAttribute("aria-label", `${star.title}: ${player}${prop ? ` ${convertProp(prop)}` : ""}`);
	star.setAttribute("aria-pressed", String(watched));
}

function refreshWatchlistStars() {
	document.querySelectorAll('.watchlist-star[data-player]').forEach(updateWatchlistStar);
}

function createWatchlistStar(data, { row = null, quotePage = PAGE, applyFees = true } = {}) {
	const player = _normPlayer(data.player);
	if (!player || data.prop === "separator") return null;
	const star = document.createElement("button");
	star.type = "button";
	star.className = "watchlist-star";
	star.dataset.player = player;
	star.dataset.sport = watchlistSport(data.sport || SPORT);
	star.dataset.team = data.team || "";
	star.dataset.page = PAGE;
	star.dataset.prop = watchlistProp({ page: PAGE, prop: data.prop });
	star.dataset.quote = JSON.stringify(watchlistQuote(data, quotePage, applyFees));
	star.watchlistRow = row;
	star.setAttribute("onclick", "toggleWatchlist(event, this.dataset.player, this.dataset.sport, this.dataset.team, this.dataset.page, this.dataset.prop, watchlistQuoteFromStar(this))");
	updateWatchlistStar(star);
	return star;
}

function watchlistColumn() {
	return {
		title: "", field: "_watchlist", width: 30, minWidth: 30, maxWidth: 30,
		headerSort: false, frozen: true, responsive: 0, hozAlign: "center",
		formatter: cell => createWatchlistStar(cell.getRow().getData(), { row: cell.getRow() }) || ""
	};
}

const watchlistTables = new WeakSet();
function initializeWatchlistTable(table) {
	if (!table || watchlistTables.has(table)) return;
	watchlistTables.add(table);
	let adding = false;
	const ensureColumn = async () => {
		if (adding || table.getColumns().some(col => col.getField() === "_watchlist")) return;
		const hasPlayers = table.getColumns().some(col => col.getDefinition().formatter === playerFormatter);
		if (!hasPlayers) return;
		adding = true;
		try { await table.addColumn(watchlistColumn(), true); }
		finally { adding = false; }
	};
	table.on("columnsLoaded", ensureColumn);
	return ensureColumn();
}

function showWatchlistError() {
	let status = document.getElementById("watchlist-status");
	if (!status) {
		status = document.createElement("div");
		status.id = "watchlist-status";
		status.setAttribute("role", "alert");
		document.body.appendChild(status);
	}
	status.textContent = "Could not save your watchlist. Please try again.";
	status.hidden = false;
	clearTimeout(watchlistStatusTimer);
	watchlistStatusTimer = setTimeout(() => { status.hidden = true; }, 5000);
}

function toggleWatchlist(e, player, sport = SPORT, team = "", page = PAGE, prop = "", quote = null) {
	e?.stopPropagation();
	const p = _normPlayer(player);
	sport = watchlistSport(sport);
	prop = watchlistProp({ page, prop });
	if (!p || !CURR_USER || !CURR_SESSION) return Promise.resolve(false);
	const key = JSON.stringify([page, sport || "", p, prop]);
	if (pendingWatchlistPlayers.has(key)) return Promise.resolve(false);
	const userId = CURR_SESSION.user.id;
	// Copy now: an odds refresh while another star is saving must not change this price.
	const savedQuote = sanitizeWatchlistQuote(quote);
	pendingWatchlistPlayers.add(key);
	refreshWatchlistStars();
	// Serialize changes so quickly starring two props cannot overwrite either save.
	watchlistSaveQueue = watchlistSaveQueue.then(async () => {
		try {
			if (CURR_SESSION?.user?.id !== userId) return false;
			const watchlist = [...(CURR_USER.metadata?.watchlist || [])];
			const idx = watchlist.findIndex(w => watchlistMatches(w, p, sport, page, prop));
			if (idx >= 0) watchlist.splice(idx, 1);
			else watchlist.push({ player: p, sport, team, page, prop,
				...(savedQuote ? { quote: savedQuote } : {}), dt: new Date().toISOString().slice(0, 10) });
			const metadata = { ...(CURR_USER.metadata || {}), watchlist };
			const { error } = await SB.from('profiles').update({ metadata }).eq('id', userId);
			if (error) throw error;
			if (CURR_SESSION?.user?.id !== userId) return false;
			CURR_USER.metadata = { ...(CURR_USER.metadata || {}), watchlist };
			if (typeof cacheProfile === "function") cacheProfile(CURR_USER);
			return true;
		} catch (error) {
			console.error("Watchlist update failed:", error);
			showWatchlistError();
			return false;
		} finally {
			pendingWatchlistPlayers.delete(key);
			refreshWatchlistStars();
		}
	});
	return watchlistSaveQueue;
}

const evFormatter = function(cell, params, rendered) {
	const ev = baseEVFormatter(cell, params, rendered);
	const data = cell.getRow().getData();
	if (!isStackedOddsCell(cell) || data.prop === 'separator') return ev;
	const display = ev || (cell.getValue() === 0 ? '<span class="ev">0%</span>' : '<span>-</span>');
	const fair = data.fairVal == null || data.fairVal === '' ? '-' : plusMinusFormatter({ getValue: () => data.fairVal });
	return `<div class="stacked-ev-summary">${display}<span class="stacked-fair-value" title="Fair Value">FV ${fair}</span></div>`;
};

const playerFormatter = function(cell, params, rendered) {
	const player = basePlayerFormatter(cell, params, rendered);
	if (!isStackedOddsCell(cell) || cell.getRow().getData().prop === 'separator') return player;
	const best = bestBookFormatter(cell, { book: BOOK, hideRecord: cell.getTable().getColumns().some(col => col.getField() === 'roiRecord') }, rendered);
	return `<div class="stacked-player-summary">${player}${best || '<span></span>'}</div>`;
};

const evOddsFormatter = function(cell, params = {}) {
	params = { ...params, stackedOdds: params.stackedOdds ?? isStackedOddsCell(cell) };
	const data = cell.getRow().getData();
	const odds = cell.getValue();

	if (!odds) return "";
	const blurOdds = data.blurred || params.blurOdds || (cell.getField() === "bookOdds.circa" && data.circa_blurred);
	if (blurOdds && !params.stackedOdds) return `<div class='blurred'>${odds}</div>`;

	const field = cell.getField();
	const bookKey = field.startsWith("bookOdds.") ? field.split(".")[1] : null;
	const liq = bookKey ? data.liquidity?.[bookKey] : null;
	const inlineLiquidity = params.stackedOdds && ["kal", "nv", "px", "poly"].includes(bookKey);
	let link = null;
	if (data.links && field.startsWith("bookOdds.")) {
		const book = field.split(".")[1];
		link = resolveLink(data.links[book]) || null;
	}

	// Display the raw quote, but evaluate its selected side after the book's fees,
	// using the same fee calculation and market context as Best Book.
	const isPair = odds.includes("/");
	const [oRaw, uRaw] = isPair ? odds.split("/") : [odds, null];
	let res = isPair ? `${oddsDisplay(oRaw)}/${oddsDisplay(uRaw)}` : oddsDisplay(odds);
	const idx = data.under ? 1 : 0;
	const feeFn = BOOK_FEE_FUNCTIONS[bookKey];
	const bettingOdds = feeFn ? feeFn(odds, data) : odds;
	const bettingPrice = Number(String(bettingOdds).split("/")[idx]);
	const fairPrice = Number(data.fairVal);
	const highlighted = data.ev && data.ev >= 0
		&& Number.isFinite(bettingPrice) && Math.abs(bettingPrice) >= 100
		&& Number.isFinite(fairPrice) && Math.abs(fairPrice) >= 100
		&& americanToDecimal(bettingPrice) >= americanToDecimal(fairPrice);
	if (highlighted) {
		const cls = "#00ff66";
		if (isPair) {
			res = data.under
				? `<span>${oddsDisplay(oRaw)}</span>/<span style='color:${cls}'>${oddsDisplay(uRaw)}</span>`
				: `<span style='color:${cls}'>${oddsDisplay(oRaw)}</span>/<span>${oddsDisplay(uRaw)}</span>`;
		} else {
			res = `<span style='color:${cls}'>${oddsDisplay(odds)}</span>`;
		}
	}

	if (params.stackedOdds) {
		const price = (raw, side) => {
			const signed = Number(raw) > 0 && !String(raw).startsWith('+') ? `+${raw}` : raw;
			const value = raw ? oddsDisplay(signed) : '-';
			const color = !raw || raw === '-' ? ' stacked-odds-missing' : highlighted && idx === side ? ' odds-positive' : '';
			const amount = inlineLiquidity && raw ? numFrom(liq?.[side]) : null;
			const liquidity = amount === null ? '' : ` <span class="stacked-odds-liquidity">($${amount.toLocaleString('en-US')})</span>`;
			return `<span class="stacked-odds-line${color}" title="${side ? 'Under' : 'Over'}" aria-label="${side ? 'Under' : 'Over'} ${value}">${value}${liquidity}</span>`;
		};
		res = `<span class="stacked-odds-stack">${price(oRaw, 0)}${price(uRaw, 1)}</span>`;
		if (blurOdds) return `<div class="blurred">${res}</div>`;
	}

	// Compact rows and other tables keep the hover/tap liquidity tip.
	if (!inlineLiquidity && Array.isArray(liq) && liq.length >= 2) {
		const fmtLiq = n => numFrom(n)?.toLocaleString('en-US') ?? n;
		res = `<span class="liq-host" onclick="if(typeof MOBILE!=='undefined'&&MOBILE){event.stopPropagation();this.classList.toggle('liq-open');}"><span class="liq-odds">${res}</span><span class="liq-tip">$${fmtLiq(liq[0])}/$${fmtLiq(liq[1])}</span></span>`;
	}

	if (link) {
		return `<div style="position:relative;display:inline-block;width:100%;">
			${res}
			<a class="odds-betslip-link" href="${link}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
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

// Snap shares arrive oldest to newest as percentages, e.g. ["62%", "76%"].
function snapShareValues(snaps) {
	return (Array.isArray(snaps) ? snaps : snaps == null ? [] : [snaps]).map(value => {
		if (typeof value !== "number" && typeof value !== "string") return null;
		const text = String(value).trim().replace(/%$/, "").trim();
		if (!/^\d+(\.\d+)?$/.test(text)) return null;
		const percent = Number(text);
		return percent >= 0 && percent <= 100 ? percent : null;
	});
}

function renderSnapShare(snaps, blurred = false) {
	const values = snapShareValues(snaps);
	const label = value => value == null ? "-" : `${value}%`;
	const latest = label(values.at(-1));
	const description = `Snap share (oldest to newest): ${values.map(label).join(" → ") || "No data"}`;
	const history = values.length > 1 && values.some(value => value != null)
		? `<span class="snap-history" aria-hidden="true">${values.slice(-5).map((value, index, recent) =>
			`<span class="snap-history-bar${index === recent.length - 1 ? " latest" : ""}${value == null ? " missing" : ""}" style="height:${value == null ? 0 : value}%"></span>`
		).join("")}</span>` : "";
	return `<span class="snap-share${blurred ? " blurred" : ""}"${blurred ? "" : ` title="${description}"`}><strong>${latest}</strong>${history}</span>`;
}

function snapShareColumn() {
	return {
		title: "Snap %<br>Last game", field: "snaps", width: 85,
		headerTooltip: "Last game's snap share. Bars show up to five games, oldest to newest; hover for the full history.",
		formatter: cell => renderSnapShare(cell.getValue(), cell.getRow().getData().blurred),
		sorter: (a, b, aRow, bRow, column, dir) => {
			const first = snapShareValues(a).at(-1), second = snapShareValues(b).at(-1);
			if (first == null && second == null) return 0;
			if (first == null) return dir === "asc" ? 1 : -1;
			if (second == null) return dir === "asc" ? -1 : 1;
			return first - second;
		}
	};
}

function snapShareColumnOrder(savedOrder, defaultOrder) {
	const keys = [...new Set([...(savedOrder || []), ...defaultOrder])];
	const order = completeColumnOrder(savedOrder, defaultOrder, keys.map(key => ({ key })));
	if (CURR_USER?.metadata?.[`${PAGE}-snaps-order-version`]) return order;
	// Move the new column beside logs in layouts saved before this placement.
	const withoutSnaps = order.filter(key => key !== "snaps");
	withoutSnaps.splice(withoutSnaps.indexOf("logs") + 1, 0, "snaps");
	return withoutSnaps;
}

const percentFormatter = function(cell, params, rendered) {
	if (!cell.getValue()) {
		if (["tds", "tds2", "ftd", "fgs", "nfl"].includes(PAGE) && cell.getRow().getData().logs?.length > 0) {
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

// Fixed, non-cycled color per pitch code so the same pitch reads the same
// color everywhere on the site (top_pitches.html's chips/legend, the HRs
// Today table on charts.html, etc.) - not just within one page.
const PITCH_COLORS = {
	FF: '#ef4444', SI: '#f97316', FC: '#b45309', SL: '#eab308', ST: '#f472b6',
	SV: '#c084fc', CU: '#3b82f6', KC: '#60a5fa', CH: '#22c55e', CS: '#4ade80',
	FS: '#a855f7', FO: '#7c3aed', SC: '#14b8a6', KN: '#94a3b8', EP: '#64748b'
};
function pitchColor(code) { return PITCH_COLORS[(code || '').toUpperCase()] || '#9ca3af'; }

function pitchChip(code) {
	if (!code) return '';
	code = code.toUpperCase();
	return `<span class="pitch-chip" style="color:${pitchColor(code)}" title="${pitchMap[code] || code}">${code}</span>`;
}

// Renders a legend (swatch + code + full name) into `el` (an element or id)
// for every code in `codes`, deduped and sorted. Pass just the codes that are
// actually present in whatever's currently shown, not the full pitchMap.
function renderPitchLegend(el, codes) {
	if (typeof el === 'string') el = document.getElementById(el);
	if (!el) return;
	const unique = [...new Set(codes.map(c => (c || '').toUpperCase()))].filter(Boolean).sort();
	el.innerHTML = unique.map(code => `
		<span class="pitch-legend-item">
			<span class="pitch-swatch" style="background:${pitchColor(code)}"></span>
			<strong>${code}</strong> ${pitchMap[code] || code}
		</span>`).join('');
}

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
	} else if (["tds", "tds2", "ftd", "nfl"].includes(PAGE)) {
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
		} else if (["tds", "ftd"].includes(PAGE)) {
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
	return oddsDisplay(ev);
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

const baseEVFormatter = function(cell, params, rendered) {
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

function hitRatePercent(value) {
	if (value?.t != null && !(Number(value.t) > 0)) return null;
	if (value?.p == null || value.p === "") return null;
	const percent = Number(value.p);
	return Number.isFinite(percent) ? percent : null;
}

const hitRateFormatter = function(cell) {
	const percent = hitRatePercent(cell.getValue());
	if (percent === null) return "";
	return cell.getRow().getData().blurred ? `<div class="blurred">${percent}%</div>` : `${percent}%`;
}

function hitRateSorter(a, b, aRow, bRow, column, dir) {
	const first = hitRatePercent(a), second = hitRatePercent(b);
	if (first === null && second === null) return 0;
	if (first === null) return dir === "asc" ? 1 : -1;
	if (second === null) return dir === "asc" ? -1 : 1;
	return first - second;
}

function getPropHitRateColumnItems() {
	return [["szn", "Season"], ["L10", "L10"], ["L20", "L20"], ["lyr", "LYR"]].map(([key, label]) => ({
		key: `hitRates_${key}`, label: `${label} Hit Rate`,
		cols: [{
			title: `${label}<br>Hit Rate`, field: `hitRates.${key}`, width: 60, responsive: 2,
			formatter: hitRateFormatter,
			sorter: hitRateSorter
		}]
	}));
}

function getNhlOpponentHitRateColumnItem() {
	return {
		key: "hitRates_bvt", label: "vs Opp Hit Rate",
		cols: [{
			title: "vs Opp<br>Hit Rate", field: "hitRates.bvt", width: 60, responsive: 2,
			formatter: hitRateFormatter, sorter: hitRateSorter,
			headerTooltip: "Hit rate against this opponent for the current prop, line and Over/Under side.",
			tooltip: (event, cell) => {
				if (cell.getRow().getData().blurred) return "";
				const rate = cell.getValue();
				return hitRatePercent(rate) === null ? "" : `${rate.w}/${rate.t} games hit this line against this opponent`;
			}
		}]
	};
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
	const quote = displayedBestBookQuote(data);
	const book = quote.book;
	let cls = data.blurred ? "blurred" : "";
	let line = quote.line;
	if (line == null) return "";

	if (parseInt(line || 0) > 0) {
		line = `+${line}`;
	}
	line = oddsDisplay(line);
	const img = book ? `<img class='book-img' src='logos/${book.replace('kambi', 'parx').replace("hr_az", "hr").replace("hr_oh", "hr")}.png' alt='${book}' title='${book}' />` : "";
	
	// Get ROI color for vertical slice and W-L record
	let extra = "";
	let borderColor = 'transparent';
	const roiData = params?.hideRecord ? null : getRowROI(data);
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
	if (String(params.book || "").includes(",")) params = { ...params, book: data.book };
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
	let ev = params.circa ? data["vs-circa_ev"] : data.ev;
	const kelly = getKelly(data.line, parseFloat(ev));
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
	if (!el) return;
	const title = el.querySelector('.tabulator-col-title');
	if (title) {
		let fractionButton = title.querySelector('.kelly-fraction-button');
		if (!fractionButton) {
			fractionButton = document.createElement('button');
			fractionButton.type = 'button';
			fractionButton.className = 'kelly-fraction-button';
			fractionButton.onclick = openKellySettings;
			title.replaceChildren(fractionButton);
		}
		fractionButton.textContent = `${kellyFractionLabel()} Kelly`;
		fractionButton.title = 'Change Kelly fraction for this page';
		// Reserve room for the full label, header padding, and sort arrow.
		const headerWidth = supportsOddsViews()
			? Math.max(65, Math.ceil(fractionButton.scrollWidth) + 16)
			: Math.max(90, Math.ceil(fractionButton.scrollWidth) + 36);
		const definition = col.getDefinition();
		definition.minWidth = Math.max(definition.minWidth || 0, headerWidth);
		definition.width = Math.max(Number(definition.width) || 0, headerWidth);
		if (col.getWidth() < headerWidth) col.setWidth(headerWidth);
	}
	document.querySelectorAll('label[for="custom_kelly"]').forEach(label => { label.textContent = `${kellyFractionLabel()} Kelly`; });
	if (el.querySelector('#kelly-toggle-btn')) return;
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

function playerLinesName(data, label) {
	if (typeof PlayerLines === "undefined" || !PlayerLines.canOpen(PAGE, data)) return label;
	return `<button type="button" class="player-lines-trigger" aria-haspopup="dialog" title="Compare all lines and prices">${PlayerLines.escape(label)}</button>`;
}

function openPlayerLines(data) {
	if (typeof PlayerLines === "undefined" || !PlayerLines.canOpen(PAGE, data)) return;
	if (PAGE === 'main') {
		PlayerLines.open(data, Array.isArray(RES?.data) ? RES.data : [], {
			mode: 'game', player: String(data.game || data.gameId || '').toUpperCase(), formatOdds: oddsDisplay
		});
		return;
	}
	PlayerLines.open(data, goalComparisonInputRows(data, RES), { player: title(data.player), formatProp: convertProp, formatOdds: oddsDisplay });
}

function lineComparisonFormatter(formatter) {
	return (cell, params, rendered) => {
		const content = formatter(cell, params, rendered);
		const data = cell.getRow().getData();
		if (typeof PlayerLines === 'undefined' || !PlayerLines.canOpen(PAGE, data)) return content;
		if (typeof rendered === 'function') rendered(() => {
			const trigger = cell.getElement().querySelector('.player-lines-trigger');
			if (trigger) trigger.onclick = event => {
				if (event.shiftKey || event.ctrlKey || event.metaKey) return;
				event.stopPropagation();
				openPlayerLines(cell.getRow().getData());
			};
		});
		return `<button type="button" class="player-lines-trigger" aria-haspopup="dialog" title="Compare all lines and prices">${content}</button>`;
	};
}

const basePlayerFormatter = function(cell, params, rendered) {
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

	let team = data.teamId || data.team;
	if (team == undefined) {
		team = "";
	}
	let isPlayerProp = true;

	if (player == "") {
		isPlayerProp = false;
		player = data.prop.replace("_", " ").toUpperCase();
		if (data.prop.includes("ml")) {
			const g = data.game.toUpperCase();
			player = data.under ? g.split(" @ ")[1] : g.split(" @ ")[0];
		} else if (data.prop == "total" && SPORT == "ncaab") {
			player = `Total (${data.gameId.toUpperCase()})`;
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
	if (!["feed", "dingers", "dingers2", "tds2", "recap", "strikeouts", "backfields", "tracker", "top_pitches"].includes(PAGE) && !params.noProp) {
		prop = propFormatter(cell);
	}
	let gameContainer = "";
	if (isPlayerProp || ["feed", "dingers", "dingers2", "tds2", "barrels", "top_pitches"].includes(PAGE)) {
		let s = ["feed", "dingers", "dingers2", "barrels", "top_pitches"].includes(PAGE) ? "mlb" : sport;
		if (s == "ncaaf") s = "ncaab";
		else if (s == "baseball_ncaa") s = "ncaab";
		else if (s == "atgs") s = "nhl";

		let t = data.teamId || data.team?.replace("-gm2", "");
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
	} else if (["atgs", "fgs"].includes(PAGE)) {
		bats = data.avgTOI;
	} else if (["tds", "tds2", "ftd", "nfl", "ncaaf"].includes(PAGE)) {
		bats = data.pos;
	}

	let pos = "";
	if (["nba", "threes", "atgs", "fgs", "kotc"].includes(PAGE)) {
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
	if (typeof PlayerLines !== "undefined" && PlayerLines.canOpen(PAGE, data) && typeof rendered === "function") rendered(() => {
		const trigger = cell.getElement().querySelector(".player-lines-trigger");
		if (trigger) trigger.onclick = event => {
			if (event.shiftKey || event.ctrlKey || event.metaKey) return;
			event.stopPropagation();
			openPlayerLines(cell.getRow().getData());
		};
	});
	return `
		<div class="player-cell">
			<div class='game-container'>${gameContainer}</div>
			${playerLinesName(data, p)}${lineupCircles} ${prop}
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

function getNhlTeamTotalColumn() {
	return {
		title: "Est. Team<br>Goals", field: "teamTotal", width: 60,
		sorter: "number", sorterParams: {alignEmptyValues: "bottom"}, responsive: 0,
		headerTooltip: "Estimated full-game goals for the player's team. Over/under odds are devigged and fitted to a Poisson model; the median across books is shown.",
		formatter: function(cell) {
			const value = cell.getValue();
			return value == null || value === "" || !Number.isFinite(Number(value)) ? "-" : Number(value).toFixed(2);
		}
	};
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
	if (!data.game && !data.awayTeamId) {
		return "";
	}
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

function renderGameLogChart(logs, data, height = 34, { neutral = false, label: chartLabel = "Game logs" } = {}) {
	const recent = (Array.isArray(logs) ? logs : String(logs ?? "").split(",")).slice(-15).map(value => {
		if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	});
	if (!recent.some(value => value !== null)) return "";

	const width = 145;
	const label = value => value === null ? "-" : String(value);
	// Keep values legible within the existing column, including three-digit yardage.
	const labelWidth = Math.max(...recent.map(value => label(value).length)) * 5.5 + 4;
	const values = recent.slice(-Math.max(1, Math.floor(width / labelWidth)));
	const numbers = values.filter(value => value !== null);
	const low = Math.min(0, ...numbers);
	const high = Math.max(0, ...numbers) || (low === 0 ? 1 : 0);
	const plotTop = 11, plotBottom = height - 1;
	const y = value => plotTop + (high - value) / (high - low) * (plotBottom - plotTop);
	const baseline = y(0);
	const line = Number(data.playerHandicap ?? data.handicap ?? data.daily?.line ?? 0);
	const hasLine = !neutral && Number.isFinite(line);
	const step = width / values.length;
	const barWidth = Math.min(18, step - 3);
	const description = `Showing last ${values.length} ${neutral ? "recorded entries" : "games"}, oldest to newest. Recent ${chartLabel.toLowerCase()}: ${recent.map(label).join(", ")}.${hasLine ? ` ${data.under ? "Under" : "Over"} ${line}; gold indicates a push.` : ""}`;
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", `game-log-chart${data.blurred ? " blurred" : ""}`);
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("width", width);
	svg.setAttribute("height", height);
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", data.blurred ? chartLabel : description);
	const title = document.createElementNS(svg.namespaceURI, "title");
	title.textContent = data.blurred ? chartLabel : description;
	svg.appendChild(title);
	let chart = `<rect class="game-log-latest" x="${width - step}" y="0" width="${step}" height="${height}" rx="2" />`;
	chart += `<line class="game-log-baseline" x1="0" x2="${width}" y1="${baseline}" y2="${baseline}" />`;
	if (hasLine && line > low && line < high) {
		chart += `<line class="game-log-line" x1="0" x2="${width}" y1="${y(line)}" y2="${y(line)}" />`;
	}
	values.forEach((value, index) => {
		const center = step * (index + 0.5);
		const top = Math.min(baseline, y(value ?? 0));
		const barHeight = Math.max(2, Math.abs(baseline - y(value ?? 0)));
		const barY = Math.min(top, plotBottom - barHeight);
		const outcome = value === null ? "missing" : neutral ? "neutral" : !hasLine ? "missing" : value === line ? "push"
			: (data.under ? value < line : value > line) ? "hit" : "miss";
		const latest = index === values.length - 1;
		const entryLabel = neutral ? (latest ? "Most recent entry" : `${values.length - 1 - index} entries ago`)
			: (latest ? "Most recent game" : `${values.length - 1 - index} games ago`);
		chart += `<g class="game-log-game${latest ? " latest" : ""}">
			${data.blurred ? "" : `<title>${entryLabel}: ${label(value)}${value === null ? " (no data)" : hasLine ? ` (${outcome})` : ""}</title>`}
			<rect class="game-log-bar ${outcome}" x="${center - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="1.5" />
			<text class="game-log-value" x="${center}" y="${Math.max(8, barY - 2)}" text-anchor="middle">${label(value)}</text>
		</g>`;
	});
	svg.insertAdjacentHTML("beforeend", chart);
	return svg;
}

const chartFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if ((cell.getField() === "logs" || params.neutral) && params.type === "bar") {
		return renderGameLogChart(cell.getValue(), data, isStackedOddsCell(cell) ? 34 : 18, params);
	}
	const content = document.createElement("span");
	if (!cell.getValue()) {
		return "";
	}
	let values = typeof(cell.getValue()) == "string" ? cell.getValue().split(",") : cell.getValue();
	if (!values.length) return "";

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
			let line = data.playerHandicap ?? data.handicap ?? data.daily?.line ?? 0;
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
	if (typeof renderLazyChart === "function") return renderLazyChart("log-chart", [tableData], layout, { responsive: true });
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
	// Renders into #feed-arsenal-content, a dedicated child of #feed-arsenal -
	// #feed-arsenal itself also holds #feed-toggle as a sibling (kept there so
	// it shares #feed-arsenal's width), which an innerHTML overwrite directly
	// on #feed-arsenal would wipe out on every re-render.
	const el = document.getElementById("feed-arsenal-content");
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
			<div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">${title(pitcher)} (${throws}) Top Pitches</div>
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
			{title: "", field: "dt", formatter: dtFormatter, formatterParams: {noYear: true}, hozAlign: "center", width: 50},
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
			{title: "Exit<br>Velocity", field: "evo", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, formatter: summaryFormatter},
			{title: "Launch<br>Angle", field: "la", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, formatter: summaryFormatter},
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

function plotHRGap(showGames = false, mode = "pa") {
	const data = TABLE.getSelectedData()[0];
	let dueData = PAGE == "atgs" ? data.due.g : data.homerLogs[mode];
	const abBtwn = PAGE == "atgs" ? data.due.g.btwn : data.homerLogs[mode].btwn;
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
	const modeLabel = mode === "bbe" ? "BBE" : "PA";
	let t = `${title(data.player)} Career ${modeLabel} Btwn HR`;
	let xAxisTitle = `${modeLabel} btwn HR`;
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
				text: `${dueData.streak} ${PAGE == "atgs" ? "GM" : modeLabel}`,
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
	if (typeof renderLazyChart === "function") return renderLazyChart("chart", [graph], layout, { responsive: true, displayModeBar: false });
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
	tds: [...DEFAULT_SHARED, "oppRank", "snaps"],
	ftd: [...DEFAULT_SHARED, "oppRank", "snaps"],
	tds2: [...DEFAULT_SHARED, "oppRank", "snaps"],
	atgs: [...DEFAULT_SHARED, "hitRateCareer", "hitRates_bvt", "oppRank", "dvpRank", "goalie", "ppLine"],
	atgs2: [...DEFAULT_SHARED, "hitRateCareer", "hitRates_bvt", "oppRank", "dvpRank", "goalie", "ppLine"],
	fgs: [...DEFAULT_SHARED, "hitRateCareer", "hitRates_bvt", "oppRank", "dvpRank", "goalie", "ppLine", "teamTotal"],
	nfl: [...DEFAULT_SHARED.filter(key => !["hitRate", "hitRateLYR"].includes(key)), "handicap", "oppRank", "snaps", ...getPropHitRateColumnItems().map(item => item.key)],
	nhl: [...DEFAULT_SHARED, "hitRates_bvt", "handicap", "oppRank", "dvpRank", "goalie", "ppLine"],
	strikeouts: [...DEFAULT_SHARED, "handicap", "oppRank", "hitRates_szn", "hitRates_lyr", "hitRates_L5", "hitRates_L10"],
	mlb: [...DEFAULT_SHARED.filter(key => !["hitRate", "hitRateLYR"].includes(key)), "handicap", ...getPropHitRateColumnItems().map(item => item.key)],
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
	const params = new URLSearchParams(url.search);
	
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
	const previousDevig = DEVIG;
	const params = new URL(window.location.href).searchParams;
	const explicitDevig = params.has("devig") || params.has("devig_excluded");
	if (!explicitDevig) DEVIG = DEVIG || CURR_USER.metadata[`${PAGE}-devig`] || "";
	if (DEVIG && DEVIG.includes("only+")) {
		DEVIG = DEVIG.replace("only+", "");
	} else if (DEVIG.includes(";")) {
		[DEVIG, WEIGHT] = DEVIG.split(";");
	}

	METHOD = METHOD || CURR_USER.metadata[`${PAGE}-method`] || "";
	// loadHeatmapData() needs TABLE to already have real rows (it reads off TABLE.getData()
	// to know which props to fetch) - this fires on the table's dataLoaded event, so it's
	// the reliable time to call it. Keep it outside the METHOD check below, which only
	// gates syncing the method-select UI - METHOD defaults to "" (Worst-Case), and skipping
	// the heatmap fetch whenever no explicit method is set left ROI coloring permanently off
	// for anyone on the default method.
	loadHeatmapData();
	if (METHOD) {
		document.getElementById("method-select").value = METHOD;
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
	if (DEVIG !== previousDevig && typeof updateRequiredDropdown === 'function') updateRequiredDropdown();
}

function showHideUserTable(loaded) {
	initKellyToggle();
	ensureLineColumnControl();
	ensureOpeningColumnControl();
	if (ENABLE_AUTH && CURR_USER && CURR_USER?.metadata) {
		if (!loaded && typeof parseWeightKey === 'function') {
			loadWeights();
		}
		if (!CURR_USER.metadata[PAGE]) {
			// Profiles with only a saved reorder can arrive after the table is built.
			if (!openingColumnVisible()) {
				TABLE.getColumns().find(col => col.getField() === 'openingPrice')?.hide();
				ensureOpeningColumnControl();
			}
			return;
		}
		const allowed = new Set(CURR_USER.metadata[PAGE]);
		if (PAGE === "ncaaf" && !CURR_USER.metadata['ncaaf-carries-version'] && allowed.has('logs')) {
			allowed.add('carries');
		}
		if (["nhl", "atgs", "fgs"].includes(PAGE) && !CURR_USER.metadata[`${PAGE}-team-total-version`]) {
			allowed.add("teamTotal");
		}

		if (["mlb", "nfl"].includes(PAGE) && !CURR_USER.metadata[`${PAGE}-hit-rates-version`]) {
			getPropHitRateColumnItems().forEach(item => allowed.add(item.key));
		}
		if (["nhl", "atgs", "atgs2", "fgs"].includes(PAGE) && !CURR_USER.metadata[`${PAGE}-bvt-hit-rate-version`]) {
			allowed.add("hitRates_bvt");
		}
		if (recordColumnVisible()) allowed.add('roiRecord');
		if (openingColumnVisible()) allowed.add('openingPrice');
		const viewState = oddsTableViewStates.get(TABLE);
		if (viewState) {
			// Already-hidden Stacked columns do not emit another hide event.
			for (const field of ['fairVal', 'book', 'roiRecord']) viewState.visibility[field] = allowed.has(field);
		}
		const customColumns = ["ncaaf", "main"].includes(PAGE);
		if (customColumns && !CURR_USER.metadata[`${PAGE}-columns-version`]) {
			// These columns could not be customized in older saved layouts.
			["handicap", "prop", "opp"].forEach(field => allowed.add(field));
		}
		if (!customColumns && !CURR_USER.metadata[`${PAGE}-line-column-version`]) {
			// Line was always visible before these pages offered its toggle.
			allowed.add('handicap');
		}
		const defs = TABLE.getColumnDefinitions();
		const nestedFields = getNestedFields(defs);

		nestedFields.forEach(field => {
			if (field === "_watchlist") return;
			const metaKey = field.replace(/\./g, "_");
			const keepVisible = !customColumns && ["opp", "prop"].includes(metaKey);
			if (!allowed.has(metaKey) && !keepVisible && !metaKey.includes("due")) {
				TABLE.getColumn(field)?.hide();
			} else {
				TABLE.getColumn(field)?.show();
			}
		});
		syncOddsSummaryColumns();
	}
}

function customizeColumnField(id) {
	return id.replace(/^custom_/, '').replace('bookOdds_', 'bookOdds.').replace('savant_', 'savant.')
		.replace('batter_percs_', 'batter_percs.').replace('percs_', 'percs.').replace('pitcherData_', 'pitcherData.')
		.replace('homerLogs_pa_', 'homerLogs.pa.').replace('hitRates_', 'hitRates.');
}

function decorateCustomizeColumnRow(checkbox) {
	const row = checkbox.parentElement;
	if (row.classList.contains('cx-column-row')) return;
	const book = checkbox.id.startsWith('custom_bookOdds_');
	row.classList.add('cx-column-row');
	const label = row.querySelector(`label[for="${checkbox.id}"]`);
	if (book && label) {
		const img = document.createElement('img');
		img.src = `logos/${checkbox.id.replace('custom_bookOdds_', '')}.png`;
		img.alt = ''; img.width = 16; img.height = 16;
		img.addEventListener('error', () => { img.hidden = true; });
		label.prepend(img);
	}
	row.addEventListener('click', event => {
		if (event.target.closest('input, label, button, a') || checkbox.disabled) return;
		checkbox.click();
	});
}

function initCustomizeWindow() {
	const overlay = document.getElementById('overlay');
	const panel = overlay?.querySelector('.overlay-content');
	const items = panel?.querySelector('#items');
	if (!panel || !items || overlay.classList.contains('customize-window')) return;
	const originalRows = [...items.querySelectorAll('input[type="checkbox"]')].map(checkbox => {
		const row = checkbox.parentElement;
		const group = row.parentElement.querySelector('h3')?.textContent.trim() || 'Stats';
		return { checkbox, row, group };
	});
	const selects = [...panel.querySelectorAll('select')];
	const controls = selects.map(select => ({ select, label: panel.querySelector(`label[for="${select.id}"]`)?.textContent.trim() || select.id }));
	const save = panel.querySelector('#save-table');
	const status = panel.querySelector('#save-status');
	const reorder = [...panel.querySelectorAll('button')].find(button => /openColReorder/.test(button.getAttribute('onclick') || ''));
	const close = [...panel.querySelectorAll('button')].find(button => /closeOverlay/.test(button.getAttribute('onclick') || ''));
	const guest = [...panel.querySelectorAll('.loggedOut')];
	const shell = document.createElement('div');
	shell.innerHTML = `
		<header class="cx-header"><div><h2 id="cx-title">Customize</h2><p class="cx-subtitle">Your view, columns and saved defaults.</p></div><button type="button" class="cx-close" aria-label="Close customize">&times;</button></header>
		<div class="cx-toolbar"></div>
		<div class="cx-tabs" role="group" aria-label="Customize categories"></div>
		<div class="cx-body"><p id="cx-empty" hidden>No matching columns.</p><section class="cx-defaults" hidden><h3>Saved defaults</h3><p>Use Save to keep these preferences for this page.</p><div class="cx-settings-grid"></div></section></div>
		<footer class="cx-footer"><div class="cx-search-row"><input id="cx-column-search" type="search" placeholder="Search columns" aria-label="Find a column or book" autocomplete="off"><button type="button" class="cx-show-all" title="Show all matching columns" aria-label="Show matching columns">Show</button><button type="button" class="cx-hide-all" title="Hide all matching columns" aria-label="Hide matching columns">Hide</button></div><div class="cx-footer-bottom"><div class="cx-feedback"><span id="cx-column-count"></span></div><div class="cx-actions"></div></div></footer>`;
	const toolbar = shell.querySelector('.cx-toolbar');
	const defaults = shell.querySelector('.cx-settings-grid');
	for (const { select, label } of controls) {
		const wrap = document.createElement('label');
		wrap.className = 'cx-setting';
		wrap.htmlFor = select.id;
		const name = document.createElement('span');
		name.textContent = select.id === 'custom-devig-select' ? 'Default devig' : select.id === 'custom-ou-select' ? 'Side' : label;
		wrap.append(name, select);
		const live = ['custom-view-select', 'custom-ou-select'].includes(select.id);
		(live ? toolbar : defaults).appendChild(wrap);
	}
	if (reorder) { reorder.classList.add('cx-reorder'); toolbar.appendChild(reorder); }
	if (!toolbar.children.length) toolbar.hidden = true;
	const tabs = shell.querySelector('.cx-tabs');
	for (const [key, name] of [['all', 'All'], ['columns', 'Columns'], ['books', 'Books'], ['stats', 'Stats'], ['defaults', 'Defaults']]) {
		if (key === 'defaults' && !defaults.children.length) continue;
		const tab = document.createElement('button');
		tab.type = 'button'; tab.dataset.category = key;
		tab.textContent = name;
		tab.setAttribute('aria-pressed', String(key === 'all'));
		tab.addEventListener('click', () => {
			overlay.dataset.category = key;
			refreshCustomizeWindow();
			panel.querySelector('.cx-body').scrollTop = 0;
		});
		tabs.appendChild(tab);
	}
	items.removeAttribute('style');
	items.replaceChildren();
	const groups = new Map();
	for (const { checkbox, row, group } of originalRows) {
		const book = checkbox.id.startsWith('custom_bookOdds_');
		const basic = /^(custom_(ev|roiRecord|openingPrice|player|book|handicap|prop|opp|fairVal|implied|kelly|curr_implied|curr_kelly))$/.test(checkbox.id);
		const category = book ? 'books' : basic || /expected value|player.*odds/i.test(group) ? 'columns' : 'stats';
		const name = book ? 'Sportsbooks' : category === 'columns' ? 'Display' : group;
		const key = `${category}:${name}`;
		if (!groups.has(key)) {
			const section = document.createElement('section');
			section.className = 'cx-column-group'; section.dataset.category = category;
			const heading = document.createElement('h3'); heading.textContent = name;
			const grid = document.createElement('div'); grid.className = 'cx-column-grid';
			section.append(heading, grid);
			groups.set(key, section);
		}
		decorateCustomizeColumnRow(checkbox);
		groups.get(key).querySelector('.cx-column-grid').appendChild(row);
	}
	// Put display controls before books, followed by each page's own stat sections.
	for (const category of ['columns', 'books', 'stats']) {
		for (const section of groups.values()) if (section.dataset.category === category) items.appendChild(section);
	}
	shell.querySelector('.cx-body').prepend(items);
	const actions = shell.querySelector('.cx-actions');
	if (save) { save.classList.add('cx-save'); actions.appendChild(save); }
	if (close) actions.appendChild(close);
	const feedback = shell.querySelector('.cx-feedback');
	if (status) { status.setAttribute('role', 'status'); status.removeAttribute('style'); feedback.appendChild(status); }
	for (const notice of guest) { notice.classList.add('cx-guest'); feedback.appendChild(notice); }
	panel.replaceChildren(...shell.childNodes);
	panel.classList.add('cx-panel');
	panel.removeAttribute('style');
	overlay.classList.add('customize-window');
	// Some pages nest Customize inside the table's stacking context.
	document.body.appendChild(overlay);
	overlay.dataset.category = 'all';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-labelledby', 'cx-title');
	panel.querySelector('.cx-close').addEventListener('click', closeOverlay);
	panel.querySelector('#cx-column-search').addEventListener('input', refreshCustomizeWindow);
	for (const [selector, checked] of [['.cx-show-all', true], ['.cx-hide-all', false]]) {
		panel.querySelector(selector).addEventListener('click', () => {
			items.querySelectorAll('.cx-column-group:not([hidden]) .cx-column-row:not([hidden]) input').forEach(input => {
				if (!input.disabled && input.checked !== checked) {
					input.checked = checked;
					input.dispatchEvent(new Event('change', { bubbles: true }));
				}
			});
			refreshCustomizeWindow();
		});
	}
	const side = document.getElementById('custom-ou-select');
	const mainSide = document.getElementById('ou-select');
	if (side && mainSide) side.addEventListener('change', () => {
		mainSide.value = side.value;
		mainSide.dispatchEvent(new Event('change', { bubbles: true }));
	});
	overlay.addEventListener('change', refreshCustomizeWindow);
	new MutationObserver(refreshCustomizeWindow).observe(items, { childList: true, subtree: true });
	overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
	const reorderModal = document.getElementById('col-reorder-modal');
	if (reorderModal) {
		document.body.appendChild(reorderModal);
		reorderModal.classList.add('customize-reorder');
		reorderModal.querySelector('.modal-content')?.style.removeProperty('max-width');
		reorderModal.setAttribute('role', 'dialog'); reorderModal.setAttribute('aria-modal', 'true');
		reorderModal.setAttribute('aria-label', 'Reorder columns');
		reorderModal.addEventListener('click', event => { if (event.target === reorderModal) closeColReorderModal(); });
		new MutationObserver(() => {
			const open = reorderModal.style.display !== 'none' && reorderModal.getClientRects().length > 0;
			panel.inert = open;
			if (open) reorderModal.querySelector('button')?.focus({ preventScroll: true });
			else if (overlay.style.display !== 'none') { refreshCustomizeWindow(); reorder?.focus({ preventScroll: true }); }
		}).observe(reorderModal, { attributes: true, attributeFilter: ['style'] });
	}
	document.addEventListener('keydown', event => {
		if (overlay.style.display === 'none' || !overlay.getClientRects().length) return;
		const nested = reorderModal && reorderModal.style.display !== 'none' && reorderModal.getClientRects().length;
		if (event.key === 'Escape') {
			event.preventDefault();
			if (nested) closeColReorderModal(); else closeOverlay();
		} else if (event.key === 'Tab') {
			const activePanel = nested ? reorderModal : panel;
			const focusable = [...activePanel.querySelectorAll('button, input, select, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
			const first = focusable[0], last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
		}
	});
}

function refreshCustomizeWindow() {
	const overlay = document.getElementById('overlay');
	if (!overlay?.classList.contains('customize-window')) return;
	// Late table initialization can add Open, Record, or Line controls.
	overlay.querySelectorAll('#items input[type="checkbox"]').forEach(checkbox => {
		decorateCustomizeColumnRow(checkbox);
		if (!checkbox.closest('.cx-column-group')) overlay.querySelector('.cx-column-grid')?.appendChild(checkbox.parentElement);
	});
	const category = overlay.dataset.category || 'all';
	const search = document.getElementById('cx-column-search');
	const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
	// Keep the bottom search field still while the result list gets shorter.
	const panel = overlay.querySelector('.cx-panel');
	if (words.length) {
		overlay._customizeSearchHeight ||= panel.getBoundingClientRect().height;
		panel.style.height = category === 'defaults' ? '' : `${overlay._customizeSearchHeight}px`;
	} else {
		delete overlay._customizeSearchHeight;
		panel.style.removeProperty('height');
	}
	let matches = 0, selected = 0, total = 0;
	overlay.querySelectorAll('.cx-column-group').forEach(group => {
		let count = 0;
		group.querySelectorAll('.cx-column-row').forEach(row => {
			const checkbox = row.querySelector('input[type="checkbox"]');
			const text = `${row.textContent} ${checkbox.id.replace(/^custom_/, '').replaceAll('_', ' ')}`.toLowerCase();
			const match = (category === 'all' || category === group.dataset.category) && words.every(word => text.includes(word));
			row.hidden = !match;
			row.classList.toggle('is-checked', checkbox.checked);
			row.classList.toggle('is-disabled', checkbox.disabled);
			if (match) count++;
			if (checkbox.checked) selected++;
			total++;
		});
		group.hidden = !count;
		matches += count;
	});
	overlay.querySelectorAll('.cx-tabs button').forEach(tab => {
		tab.setAttribute('aria-pressed', String(tab.dataset.category === category));
		if (!['all', 'defaults'].includes(tab.dataset.category)) tab.hidden = !overlay.querySelector(`.cx-column-group[data-category="${tab.dataset.category}"]`);
	});
	overlay.querySelector('.cx-defaults').hidden = category !== 'defaults';
	overlay.querySelector('.cx-search-row').hidden = category === 'defaults';
	document.getElementById('items').hidden = category === 'defaults';
	document.getElementById('cx-empty').hidden = matches > 0 || category === 'defaults';
	document.getElementById('cx-column-count').textContent = category === 'defaults' ? 'Defaults for this page' : words.length ? `${matches} matching columns` : `${selected} of ${total} selected`;
}

function closeOverlay() {
	const overlay = document.getElementById('overlay');
	if (!overlay) return;
	overlay.style.display = 'none';
	if (overlay._customizeScrollLock != null) {
		document.body.style.overflow = overlay._customizeScrollLock;
		delete overlay._customizeScrollLock;
	}
	(overlay._customizeTrigger || document.getElementById('customize'))?.focus({ preventScroll: true });
}

function openOverlay() {
	const overlay = document.getElementById('overlay');
	if (!overlay) return;
	const metadata = CURR_USER?.metadata || {};
	const table = typeof TABLE !== 'undefined' ? TABLE : null;
	if (table) {
		ensureLineColumnControl();
		ensureOpeningColumnControl();
	}
	const items = document.getElementById('items');
	const fields = new Set(table ? getNestedFields(table.getColumnDefinitions()) : []);
	const state = table ? oddsTableViewStates.get(table) : null;
	const saved = new Set(metadata[PAGE] || DEFAULT_FIELDS[PAGE] || DEFAULT_SHARED);
	items?.querySelectorAll('input[type="checkbox"]').forEach(input => {
		const field = customizeColumnField(input.id);
		input.checked = fields.has(field) ? state?.visibility[field] ?? table.getColumn(field).isVisible() : input.disabled || saved.has(input.id.replace(/^custom_/, ''));
	});
	syncOddsSummaryColumns();
	initCustomizeWindow();
	const select = document.getElementById('custom-devig-select');
	if (select) {
		const favorites = typeof getFavoriteDevigs === 'function' ? getFavoriteDevigs() : [];
		const custom = typeof getCustomDevigs === 'function' ? getCustomDevigs() : [];
		const options = new Map([['', { value: '', name: 'Market Avg' }]]);
		if (typeof DEFAULT_DEVIGS !== 'undefined') DEFAULT_DEVIGS.forEach(option => options.set(option.value, option));
		[...favorites, ...custom].forEach(value => { if (!options.has(value)) options.set(value, { value, name: parseWeightKey(value) }); });
		let preferred = metadata[`${PAGE}-devig`] || '';
		if (preferred && !preferred.includes(';')) preferred += repeatOnes(preferred);
		if (preferred && !options.has(preferred)) options.set(preferred, { value: preferred, name: parseWeightKey(preferred) });
		select.replaceChildren();
		options.forEach(option => { const el = document.createElement('option'); el.value = option.value; el.textContent = option.name; select.appendChild(el); });
		select.value = preferred;
	}
	const side = document.getElementById('custom-ou-select');
	if (side && document.getElementById('ou-select')) side.value = document.getElementById('ou-select').value;
	overlay._customizeTrigger = document.activeElement;
	if (overlay._customizeScrollLock == null) overlay._customizeScrollLock = document.body.style.overflow;
	document.body.style.overflow = 'hidden';
	overlay.dataset.category = 'all';
	const search = document.getElementById('cx-column-search');
	if (search) search.value = '';
	overlay.style.display = 'flex';
	refreshCustomizeWindow();
	overlay.querySelector('.cx-body')?.scrollTo(0, 0);
	overlay.querySelector('.cx-close')?.focus({ preventScroll: true });
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
	const selectedBooks = parseBookFilter(document.getElementById("book-select").value);
	if (!bookOdds || (selectedBooks.length && !selectedBooks.some(book => bookOdds[book]))) return { book: null, value: null, deviation: 0, pct: 0 };

	const legIndex = rowData.under ? 1 : 0;

	let entries, avgP;
	let excluded = [...getExcludedBooks()];
	excluded.push("pn"); excluded.push("circa");

	const requiredBooks = (Array.isArray(REQUIRED) ? REQUIRED : String(REQUIRED || "").split(","))
		.filter(book => book && !DEVIG_EXCLUDED.includes(book));
	if (requiredBooks.length > 0) {
		const hasAllRequired = requiredBooks.every(book => bookOdds[book]);
		if (!hasAllRequired) {
			return { book: null, value: null, deviation: 0, pct: 0 };
		}
	}

	if (DEVIG) {
		let p_devig;
		const devigBooks = getDevigReferenceBooks().filter(book => !DEVIG_EXCLUDED.includes(book));
		if (!devigBooks.length) return { book: null, value: null, deviation: 0, pct: 0 };

		if (DEVIG.includes("+")) {
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
			const devigVal = bookOdds[devigBooks[0]];
			
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
		devigBooks.forEach(b => excluded.push(b));
		
		Object.entries(bookOdds)
			.filter(([book]) => !excluded.includes(book) && (!selectedBooks.length || selectedBooks.includes(book)))
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

		// Reference exclusions do not remove a book's offered price from the candidates.
		const references = entries.filter(([book]) => !DEVIG_EXCLUDED.includes(book));
		if (!references.length) return { book: null, value: null, deviation: 0, pct: 0 };
		avgP = references.reduce((a, [, , p]) => a + p, 0) / references.length;

		let best = { book: null, value: null, deviation: -Infinity, pct: 0 };

		entries.forEach(([book, american, p]) => {
			if ((selectedBooks.length && !selectedBooks.includes(book)) || excluded.includes(book)) {
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

  // Find the best (lowest implied probability) - our reference
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
		if (["atgs2", "tds2"].includes(PAGE)) {
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

  const kelly = ((p * b - (1 - p)) / b) * getKellyFraction();
  return Number(kelly.toFixed(2));
}

function getKelly(finalOdds, ev) {
  let p = finalOdds / 100;
  if (finalOdds < 0) {
	p = 100 / finalOdds;
  }
  
  return ev / Math.abs(p) * getKellyFraction();
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

function getDevigReferenceBooks() {
	const selected = String(DEVIG || "").split(";")[0].replace(/^only\+/, "");
	if (selected && selected !== "mkt") return [...new Set(selected.split("+").filter(Boolean))];
	const defaults = ALL_WEIGHTABLE_BOOKS.filter(book => !["bv", "bol", "br", "re"].includes(book));
	// These pages also compare against the raw market average, which includes books
	// outside the standard EV weights. Keep them available in the reference controls.
	const rawMarketPages = ["outliers", "dingers2", "atgs2", "tds2", "atgs", "fgs", "tds", "ftd", "wbc", "olympics", "analysis"];
	if (!rawMarketPages.includes(PAGE)) return defaults;
	const rows = Array.isArray(RES) ? RES : RES?.data;
	const available = Array.isArray(rows) ? rows.flatMap(row => Object.keys(row.bookOdds || {})) : [];
	const known = typeof ALL_POSSIBLE_BOOKS !== "undefined" ? ALL_POSSIBLE_BOOKS : [];
	return [...new Set([...ALL_WEIGHTABLE_BOOKS, ...known, ...available])];
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
	const devig = String(DEVIG || "").split(";")[0].replace(/^only\+/, "");
	const devigBooks = devig.split("+");
	Object.entries(bookOdds)
		//.filter(([book, val]) => val && book != highest && (!DEVIG || devigBooks.includes(book)))
		.filter(([book, val]) => val && !DEVIG_EXCLUDED.includes(book) && (!devig || (!devig.includes("+") || book != highest) || devigBooks.includes(book)))
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

// bookOdds.kal is the raw fee-free price The Odds API reports for Kalshi -- correct for
// display and devigging everywhere, but not what you'd actually pay if Kalshi is the book
// you're betting at. addKalshiFee() computes that fee-inclusive price on demand (no
// pre-computed "kal_fee" field stored anywhere, so nothing needs to guard against it showing
// up as a phantom 20th book in a generic bookOdds iteration).
//
// Kalshi's series API (verified 2026-09-28) gives NFL props (KXNFLTD, KXNFLREC,
// passing/rushing/receiving yards, attempts, etc.) a fee_multiplier of 1, while
// KXMLBHR uses 0.5. The taker formula is multiplier * 0.07 * C * P * (1-P):
// https://kalshi.com/docs/kalshi-fee-schedule.pdf
// NFL and NHL markets use the full rate. Keep the existing reduced rate elsewhere;
// row context also identifies football and hockey props outside their dedicated pages.
const KALSHI_FEE_RATE = 0.035;

function kalshiFeeRate(data = {}, page = PAGE) {
	const link = String(data.links?.kal || "").toLowerCase();
	if (/\/kx(?:nfl|nhl)[a-z0-9]*(?:[/-]|$)/.test(link)) return 0.07;
	if (/\/kxmlbhr(?:[/-]|$)/.test(link)) return KALSHI_FEE_RATE;
	const sport = String(data.sport || (typeof SPORT !== "undefined" ? SPORT : "") || "").toLowerCase();
	const prop = String(data.prop || "").toLowerCase();
	return ["nfl", "nhl"].includes(sport)
		|| ["nfl", "tds", "tds2", "ftd", "nhl", "atgs", "atgs2", "fgs"].includes(page)
		|| ["attd", "ftd", "atgs", "fgs", "lgs"].includes(prop)
		? 0.07 : KALSHI_FEE_RATE;
}

function kalshiCentsFromFeeFreeAmerican(odds) {
	if (odds > 0) return 10000 / (odds + 100);
	return 100 * (-odds) / (100 - odds);
}

function addKalshiFee(ou, data = {}, page = PAGE) {
	const rate = kalshiFeeRate(data, page);
	const addOne = (oddsStr) => {
		const odds = parseInt(oddsStr, 10);
		if (isNaN(odds)) return oddsStr;
		const cents = kalshiCentsFromFeeFreeAmerican(odds);
		if (cents == null || cents <= 0 || cents >= 100) return oddsStr;
		const f = rate * cents * (100 - cents) / 100;
		const cost = cents + f;
		const profit = 100 - cost;
		if (cost <= 0 || profit <= 0) return oddsStr;
		const raw = profit >= cost ? (profit / cost * 100) : (-cost / profit * 100);
		return String(Math.floor(raw));
	};

	const s = String(ou);
	if (s.includes("/")) {
		const [over, under] = s.split("/");
		return `${over ? addOne(over) : over}/${under ? addOne(under) : under}`;
	}
	return addOne(s);
}

// ProphetX ("px") charges a flat 2% commission on net winnings, unlike Kalshi's price-
// dependent fee -- the risk side is untouched, only the payout on a win gets cut by 2%.
// bookOdds.px is the raw fee-free price (same convention as bookOdds.kal); addPXFee()
// computes the fee-inclusive price on demand, same as addKalshiFee().
const PX_FEE_RATE = 0.02;

function addPXFee(ou) {
	const addOne = (oddsStr) => {
		const odds = parseInt(oddsStr, 10);
		if (isNaN(odds)) return oddsStr;
		// normalize to a (risk, profit) pair on a $100 quantum, same convention American
		// odds already use: positive odds risk $100 to win `odds`; negative odds risk
		// `-odds` to win $100.
		const risk = odds > 0 ? 100 : -odds;
		const profit = odds > 0 ? odds : 100;
		const feeProfit = profit * (1 - PX_FEE_RATE);
		if (risk <= 0 || feeProfit <= 0) return oddsStr;
		const raw = feeProfit >= risk ? (feeProfit / risk * 100) : (-risk / feeProfit * 100);
		return String(Math.floor(raw));
	};

	const s = String(ou);
	if (s.includes("/")) {
		const [over, under] = s.split("/");
		return `${over ? addOne(over) : over}/${under ? addOne(under) : under}`;
	}
	return addOne(s);
}

// Dispatch of book -> "compute this book's fee-inclusive price from its stored fee-free
// price" function. Only books whose stored bookOdds value is fee-free need an entry here;
// every other book's stored price is already what you'd actually pay. Add future fee-
// charging books here rather than repeating the per-book branch at each call site below.
const BOOK_FEE_FUNCTIONS = {
	kal: addKalshiFee,
	//px: addPXFee,
};

function parseBookFilter(value, preserveBest = typeof PAGE !== "undefined" && PAGE === "heatmap") {
	return [...new Set(String(value || "").split(",").map(book => book.trim().toLowerCase()).filter(book => book && (preserveBest || book !== "best")))];
}

function highestOver(bookOdds, excluded, boost, book, under, data = {}) {
	const selectedBooks = parseBookFilter(book);
	if (!boost) {
		boost = 0;
	}

	const parseSide = (value) => {
		const parts = String(value).split("/");
		if (under && parts.length <= 1) return null;
		const pick = under && parts.length > 1 ? parts[1] : parts[0];
		const num = parseInt(pick.replace("+", ""), 10);
		return isNaN(num) ? null : { num, pick };
	};

	const best = Object.entries(bookOdds)
		.filter(([key, value]) =>
		  // exclude list
		  !excluded.includes(key) &&
		  // Compare only selected books; an empty selection value means All.
		  (!selectedBooks.length || selectedBooks.includes(key)) &&
		  value !== undefined && value !== null && value !== ""
		)
		.reduce(
		  (max, [key, value]) => {
			// Compare the actual fee-inclusive betting prices, keeping bookOdds raw
			// for the book columns and devig calculations.
			const feeFn = BOOK_FEE_FUNCTIONS[key];
			const parsed = parseSide(feeFn ? feeFn(value, data) : value);
			if (!parsed) return max;

			// apply your profit boost (works for +/- American)
			const num = applyProfitBoost(parsed.num, boost);

			return num > max.value ? { book: key, value: num, raw: parsed.pick } : max;
		  },
		  { book: null, value: -Infinity, raw: null }
	);

	return best;
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

// Keep alternate goals prices separate from the full rows used by the main table.
function goalComparisonRows(playerData, payload) {
	if (!playerData || playerData.blurred) return [];
	const byLine = new Map();
	const add = (handicap, bookOdds, circaBlurred = false) => {
		if (handicap == null || String(handicap).trim() === "") return;
		const line = Number(handicap);
		if (!Number.isFinite(line) || !bookOdds || typeof bookOdds !== "object" || Array.isArray(bookOdds)) return;
		const key = String(line);
		if (!byLine.has(key)) byLine.set(key, { handicap: key, bookOdds: {} });
		const target = byLine.get(key).bookOdds;
		for (const [book, quote] of Object.entries(bookOdds)) {
			if (book === "circa" && (playerData.circa_blurred || circaBlurred)) continue;
			if (!Object.hasOwn(target, book)) target[book] = quote;
		}
	};
	for (const row of Array.isArray(payload?.data) ? payload.data : []) {
		if (!row || row.blurred || row.player !== playerData.player || row.game !== playerData.game || row.prop !== playerData.prop) continue;
		add(row.handicap, row.bookOdds, row.circa_blurred);
	}
	// This compact map contains ATGS only; never reuse it for first/last goal props.
	if (playerData.prop === "atgs") {
		const prices = payload?.comparisonOdds?.[playerData.game]?.[playerData.player];
		if (prices && typeof prices === "object" && !Array.isArray(prices)) {
			for (const [handicap, bookOdds] of Object.entries(prices)) {
				if (Number.isFinite(Number(handicap)) && Number(handicap) > 0.5) add(handicap, bookOdds);
			}
		}
	}
	return [...byLine.values()];
}

// Keep complete base rows for liquidity and prop switching; append only quote rows.
function goalComparisonInputRows(playerData, payload) {
	if (!playerData || playerData.blurred) return [];
	const rows = (Array.isArray(payload?.data) ? payload.data : []).map(row =>
		playerData.circa_blurred && row?.player === playerData.player && row?.game === playerData.game && row?.prop === playerData.prop
			? { ...row, circa_blurred: true } : row);
	if (playerData.prop === "atgs") {
		for (const prices of goalComparisonRows(playerData, payload)) {
			rows.push({ player: playerData.player, game: playerData.game, prop: playerData.prop,
				...prices, circa_blurred: !!playerData.circa_blurred });
		}
	}
	return rows;
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
	const playerRows = goalComparisonRows(playerData, RES);

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

// Heatmap files are split per-prop server-side (results.py) - a page only ever colors
// rows for whichever prop(s) are actually loaded into TABLE, so fetch just those slices
// instead of the whole sport/method file (which covers every prop, book and dev combo).
async function loadHeatmapData(_retriesLeft = 10) {
	if (["outliers", "analysis"].includes(PAGE)) return;
	if (typeof pako === 'undefined') return;

	let props = [];
	try {
		if (typeof TABLE !== 'undefined' && TABLE && typeof TABLE.getData === 'function') {
			props = [...new Set(TABLE.getData().map(r => r.prop).filter(Boolean))];
		}
	} catch (e) { props = []; }
	if (!props.length) {
		// Reading TABLE.getData() for props only works once the table has real rows, but
		// this gets called (via renderFilters()) before the page's initial data fetch has
		// resolved - TABLE may not even exist yet. Retry instead of silently giving up, so
		// ROI coloring doesn't depend on some other code path calling this again later.
		if (_retriesLeft > 0) setTimeout(() => loadHeatmapData(_retriesLeft - 1), 300);
		return;
	}

	if (!HEATMAP) HEATMAP = {};
	if (!HEATMAP.xy) HEATMAP.xy = {};

	await Promise.all(props.map(async prop => {
		try {
			const response = await fetch(`/heatmaps/${SPORT}_${METHOD || "worst"}_${prop}.json.gz`);
			if (!response.ok) return;
			const buffer = await response.arrayBuffer();
			const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
			const heatmapData = JSON.parse(decompressed);
			HEATMAP.xy[prop] = heatmapData.xy;
			HEATMAP.grid = HEATMAP.grid || heatmapData.grid;
		} catch (e) {
			console.warn(`Failed to load heatmap data for prop ${prop}:`, e);
		}
	}));
	// Rows can render before the heatmap requests finish. Re-run their formatters
	// now that the record and ROI data is available, including compact ROI bars.
	if (typeof TABLE !== 'undefined' && TABLE && typeof TABLE.getRows === 'function') {
		TABLE.getRows().forEach(row => row.reformat());
	}
}

function recordROIFormatter(cell) {
	const data = cell.getRow().getData();
	if (data.prop === 'separator') return '';
	const record = getRowROI(data);
	if (!record) return '<span title="No historical record for this EV and odds range">-</span>';
	const roi = `${record.roi > 0 ? '+' : ''}${(record.roi * 100).toFixed(1)}% ROI`;
	return `<div class="stacked-record-summary${data.blurred ? ' blurred' : ''}"><span>${record.wins}W–${record.losses}L</span><span class="record-roi" style="color: ${roiToColor(record.roi)}">${roi}</span></div>`;
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

// Heatmap data ships pre-binned from the server (see results.py HEATMAP_GRID) as
// evIdx -> oddsIdx -> [wins, losses, profitSum], at a finer resolution (ev step 1,
// odds step per HEATMAP.grid.oddsStep) than this function displays at (ev step 1,
// odds step 100). Since wins/losses/profit are additive, the display bin's stats are
// just the sum of the fine odds-bins it covers - no raw per-bet data needed.
function getRowROI(rowData) {
	try {
		if (DEVIG_EXCLUDED.length) return null;
		if (typeof HEATMAP === 'undefined' || !HEATMAP || !HEATMAP.xy || !HEATMAP.grid) return null;

		const propData = HEATMAP.xy[rowData.prop];
		if (!propData) return null;

		const bookData = propData[rowData.book] || propData['best'];
		if (!bookData) return null;

		let devigData = bookData[DEVIG];
		if (!devigData && DEVIG) {
			const matchKey = Object.keys(bookData).find(k => devigSetEquals(k, DEVIG));
			if (matchKey) devigData = bookData[matchKey];
		}
		if (!devigData) return null;

		const g = HEATMAP.grid;
		const ev = Number(rowData.ev) || 0;
		const odds = Number(rowData.line) || 0;

		// Same acceptance window the old per-bet implementation used.
		if (ev < -5 || ev > 30 || odds < 100 || odds > 3000) return null;
		// Server only stores bins for ev >= 0 (negative-EV bets are filtered out at write
		// time) - don't clamp a negative ev into bin 0, that would misattribute a
		// negative-EV row's ROI to real ev-in-[0,1) history.
		if (ev < g.evMin) return null;

		const evIdx = Math.min(g.evBins - 1, Math.floor((ev - g.evMin) / g.evStep));
		const evBins = devigData[String(evIdx)];
		if (!evBins) return null;

		// Display odds step is fixed at 100; group that many fine odds-bins together.
		const groupSize = Math.max(1, Math.round(100 / g.oddsStep));
		const fineOddsIdx = Math.max(0, Math.min(g.oddsBins - 1, Math.floor((odds - g.oddsMin) / g.oddsStep)));
		const groupStart = Math.floor(fineOddsIdx / groupSize) * groupSize;

		let wins = 0, losses = 0, profit = 0;
		for (let i = groupStart; i < groupStart + groupSize; i++) {
			const cell = evBins[String(i)];
			if (!cell) continue;
			wins += cell[0];
			losses += cell[1];
			profit += cell[2];
		}

		const total = wins + losses;
		if (!total) return null;

		return { roi: profit / total, wins, losses };
	} catch(e) {
		console.error('Error calculating ROI:', e);
	}
	return null;
}

const HELP_ITEMS = [
	{
		title: "Expected Value (EV%)",
		desc: "Your edge over the market. Calculated by comparing the best available odds to the fair value from your chosen devig books. Green = positive edge - start here.",
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
		title: "Kelly sizing",
		desc: "Bet size using your selected fraction of the Kelly Criterion. Click the Kelly header to change the fraction for this page.",
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
		desc: "Choose one or more sportsbooks. Each play uses the best price among your selected books to calculate EV. All restores the full pool with your Exclude settings.",
		getEl: () => document.getElementById("book-filter-button") || document.getElementById("book-select")
	},
	{
		title: "Exclude Books",
		desc: "Remove books from best book entirely - for this page or all pages. Use this if you don't have an account at a book.",
		getEl: () => document.getElementById("exclude-dd")
	},
	{
		title: "Devig Filter",
		desc: "The sharp books used to calculate Fair Value. Only their lines are used to strip the vig. Circa and Pinnacle are recommended starting points. Customize any combo of devigs here.",
		getEl: () => document.getElementById("devig-button")
	},
	{
		title: "Devig books",
		desc: "Optional books are used when priced, Required books must have a price, and Excluded books are left out of the reference average. The separate Exclude Books control chooses which books can be the best betting price.",
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
	DEVIG_EXCLUDED = [...new Set((URLParams.get("devig_excluded") || "").split(",").map(book => book.trim()).filter(Boolean))];
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
	CURRENT_VIEW = getSavedOddsView(URLParams.get("view"));
	document.getElementById("table")?.classList.toggle("stacked-odds", supportsOddsViews() && CURRENT_VIEW === "table");
	TEAM = URLParams.get("team") || "det";
	ALL = URLParams.get("all");
	PLAYERS = URLParams.get("players") || "";
	HARD_HIT = URLParams.get("HH");
	DERBY = URLParams.get("derby");
	STREAM = URLParams.get("stream");
	// Hides #username via a CSS !important rule (see style.css) rather than
	// setting style.display here directly - auth.js sets .loggedIn/.loggedOut
	// elements' display via JS itself once the session resolves, which would
	// silently undo a plain inline-style hide applied before that runs.
	document.body?.classList.toggle("stream-mode", STREAM != null);

	function defaultOU() {
		if (["atgs", "fgs", "tds", "tds2", "ftd", "dingers"].includes(PAGE)) return "o";
		return "ou";
	}
	OU = URLParams.get("ou") || defaultOU();
}
// ── Generic column-reorder helpers ───────────────────────────────────────────

let _colReorderDragSrc = null;

function withRecordColumnOrder(savedOrder, defaultOrder, items) {
	if (!supportsOddsViews() || !items.some(item => item.key === 'ev') ||
		!items.some(item => item.cols.some(col => col.formatter === playerFormatter))) {
		return { savedOrder, defaultOrder, items };
	}
	if (!items.some(item => item.key === 'roiRecord')) {
		items = [...items, { key: 'roiRecord', label: 'Record', cols: [recordROIColumn()] }];
	}
	const insertRecord = order => {
		if (!order?.length || order.includes('roiRecord')) return order;
		const next = [...order];
		next.splice(Math.max(0, next.indexOf('ev') + 1), 0, 'roiRecord');
		return next;
	};
	return { savedOrder: insertRecord(savedOrder), defaultOrder: insertRecord(defaultOrder), items };
}

function withOpeningColumnOrder(savedOrder, defaultOrder, items) {
	if (!items.some(item => item.key === 'ev')) return { savedOrder, defaultOrder, items };
	if (!items.some(item => item.key === 'openingPrice')) {
		items = [...items, { key: 'openingPrice', label: 'Open', cols: [openingPriceColumn()] }];
	}
	const insert = order => {
		if (!order?.length || order.includes('openingPrice')) return order;
		const next = [...order];
		const anchor = next.includes('book') ? 'book' : 'ev';
		next.splice(Math.max(0, next.indexOf(anchor) + 1), 0, 'openingPrice');
		return next;
	};
	return { savedOrder: insert(savedOrder), defaultOrder: insert(defaultOrder), items };
}

function completeColumnOrder(savedOrder, defaultOrder, items) {
	const validKeys = new Set(items.map(item => item.key));
	const canonical = [...new Set(defaultOrder)];
	const order = [...new Set(savedOrder?.length ? savedOrder : canonical)]
		.filter(key => validKeys.has(key));
	// Older Stacked layouts saved only visible groups, omitting Best Book and
	// Fair Value. Restore missing groups beside their canonical neighbors while
	// leaving every explicitly ordered group in its chosen relative position.
	canonical.forEach((key, index) => {
		if (!validKeys.has(key) || order.includes(key)) return;
		const next = canonical.slice(index + 1).find(candidate => order.includes(candidate));
		if (next !== undefined) {
			order.splice(order.indexOf(next), 0, key);
			return;
		}
		const previous = canonical.slice(0, index).reverse().find(candidate => order.includes(candidate));
		order.splice(previous === undefined ? order.length : order.indexOf(previous) + 1, 0, key);
	});
	return order;
}

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
	({ savedOrder, defaultOrder, items } = withRecordColumnOrder(savedOrder, defaultOrder, items));
	({ savedOrder, defaultOrder, items } = withOpeningColumnOrder(savedOrder, defaultOrder, items));
	const itemMap = Object.fromEntries(items.map(i => [i.key, i]));
	const order = completeColumnOrder(savedOrder, defaultOrder, items);
	const cols = [];
	if (starColFn) cols.push(starColFn());
	for (const key of order) {
		cols.push(...itemMap[key].cols);
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
	({ savedOrder, defaultOrder, items } = withRecordColumnOrder(savedOrder, defaultOrder, items));
	({ savedOrder, defaultOrder, items } = withOpeningColumnOrder(savedOrder, defaultOrder, items));
	const itemMap = Object.fromEntries(items.map(i => [i.key, i]));
	const displayOrder = completeColumnOrder(savedOrder, defaultOrder, items);
	const list = document.getElementById('col-reorder-list');
	list.innerHTML = '';
	list._fullColumnOrder = displayOrder;
	displayOrder.forEach(key => {
		const meta = itemMap[key];
		if (!meta) return;
		if (isItemVisible && !isItemVisible(meta)) return;
		const item = document.createElement('div');
		item.dataset.key = key;
		item.draggable = true;
		item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#172027;border:1px solid rgba(59,130,246,0.25);border-radius:4px;cursor:grab;user-select:none;font-size:13px;touch-action:none;';
		const label = meta.key === 'kelly' ? `${kellyFractionLabel()} Kelly` : meta.label;
		item.innerHTML = `<span style="color:#555;font-size:16px;line-height:1;">⋮⋮</span><span>${label}</span>`;
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
		// Native HTML5 drag-and-drop (dragstart/dragover/drop) doesn't fire on touch
		// devices, so mobile needs its own pointer-based reorder using touch events.
		item.addEventListener('touchstart', () => {
			_colReorderDragSrc = item;
			item.style.opacity = '0.4';
		}, { passive: true });
		item.addEventListener('touchmove', e => {
			if (_colReorderDragSrc !== item) return;
			e.preventDefault();
			const touch = e.touches[0];
			const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-key]');
			if (target && target !== item && target.parentElement === list) {
				const rect = target.getBoundingClientRect();
				const before = touch.clientY < rect.top + rect.height / 2;
				list.insertBefore(item, before ? target : target.nextSibling);
			}
		}, { passive: false });
		const endTouchReorder = () => {
			if (_colReorderDragSrc !== item) return;
			_colReorderDragSrc = null;
			item.style.opacity = '1';
		};
		item.addEventListener('touchend', endTouchReorder);
		item.addEventListener('touchcancel', endTouchReorder);
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
	const visibleOrder = [...list.querySelectorAll('[data-key]')].map(i => i.dataset.key);
	const visibleKeys = new Set(visibleOrder);
	let visibleIndex = 0;
	// Reorder the displayed groups without discarding the hidden groups' slots.
	// Switching views can make those groups visible again after this save.
	const newOrder = (list._fullColumnOrder || visibleOrder)
		.map(key => visibleKeys.has(key) ? visibleOrder[visibleIndex++] : key);
	if (CURR_USER?.metadata) {
		CURR_USER.metadata[storageKey] = newOrder;
		if (["tds-order", "tds2-order", "ftd-order", "nfl-order"].includes(storageKey)) {
			CURR_USER.metadata[`${PAGE}-snaps-order-version`] = 1;
		}
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

function setBookSelection(value) {
	const select = document.getElementById("book-select");
	if (!select) return;
	const books = parseBookFilter(value);
	BOOK = books.join(",");
	select.querySelectorAll('option[data-book-group]').forEach(option => option.remove());
	if (![...select.options].some(option => option.value === BOOK)) {
		const option = new Option(BOOK, BOOK);
		option.dataset.bookGroup = "true";
		select.appendChild(option);
	}
	select.value = BOOK;
	syncBookPicker();
}

function syncBookPicker() {
	const select = document.getElementById("book-select");
	const button = document.getElementById("book-filter-button");
	if (!select || !button) return;
	const selected = parseBookFilter(select.value);
	const all = selected.length === 0;
	document.querySelectorAll('#book-options input[type="checkbox"]').forEach(input => {
		input.checked = all || selected.includes(input.value);
	});
	document.getElementById("book-filter-value").textContent = all ? "All" : select.value === "none" ? "None"
		: selected.length <= 2 ? selected.map(book => book.toUpperCase()).join(" + ") : `${selected.length} books`;
	button.title = all ? "Best price across all books, using your Exclude settings" : select.value === "none" ? "No books selected"
		: `Best price among ${selected.map(parseBook).join(", ")}`;
	if (PAGE === "heatmap") button.title = all ? "Show all book histories" : select.value === "none" ? "No books selected"
		: `Historical results for ${selected.map(parseBook).join(", ")}`;
}

function renderBookSelect(availableBooks = null) {
	const bookSel = document.getElementById("book-select");
	if (!bookSel) return;

	let books = ["fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "fl", "re", "bol", "kambi", "pn", "kal", "nv", "px", "poly"];

	if (["dingers", "dingers2", "mlb"].includes(PAGE)) {
		books.push("hr_oh");
	} else if (["nba", "threes", "pts"].includes(PAGE)) {
		books.push("hr_az");
	} else if (PAGE == "cup") {
		books = books.concat(["mb", "bw", "bs", "myb"]);
	}

	if (PAGE === "main" || PAGE === "main_recap") {
		books.push("hr_oh");
		if (!books.includes("hr_az")) books.push("hr_az");
	}
	if (Array.isArray(availableBooks)) books = [...new Set(availableBooks)].filter(book => /^[a-z][a-z0-9_]*$/.test(book));

	bookSel.innerHTML = `<option value="">All</option><option value="none">None</option>` +
		books.map(book => `<option value="${book}">${book.toUpperCase()}</option>`).join("");
	const wrapper = bookSel.parentElement;
	let menu = document.getElementById("book-options");
	if (!menu) {
		wrapper.classList.add("book-filter");
		bookSel.hidden = true;
		bookSel.style.display = "none";
		const label = wrapper.querySelector('label[for="book-select"]');
		if (label) { label.htmlFor = "book-filter-button"; label.textContent = "Books"; }
		const button = document.createElement("button");
		button.id = "book-filter-button";
		button.type = "button";
		button.setAttribute("aria-label", "Choose betting books");
		button.setAttribute("aria-controls", "book-options");
		button.setAttribute("aria-expanded", "false");
		button.innerHTML = '<span id="book-filter-value">All</span>';
		wrapper.appendChild(button);
		menu = document.createElement("div");
		menu.id = "book-options";
		menu.className = "chkdd-menu book-filter-menu";
		menu.dataset.wired = "1";
		menu.setAttribute("role", "group");
		menu.setAttribute("aria-label", "Betting books");
		wrapper.appendChild(menu);
		const close = () => {
			menu.style.display = "none";
			button.setAttribute("aria-expanded", "false");
			wrapper.appendChild(menu);
		};
		const apply = value => {
			setBookSelection(value);
			bookSel.dispatchEvent(new Event("change", { bubbles: true }));
		};
		const position = () => {
			const rect = button.getBoundingClientRect();
			menu.style.top = `${rect.bottom + 6}px`;
			menu.style.left = `${getDropdownLeft(rect.left, menu.offsetWidth)}px`;
			menu.style.maxHeight = `${Math.max(80, window.innerHeight - rect.bottom - 14)}px`;
		};
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (menu.style.display === "block") { close(); return; }
			document.body.appendChild(menu);
			menu.style.display = "block";
			position();
			button.setAttribute("aria-expanded", "true");
			menu.querySelector("button")?.focus({ preventScroll: true });
		});
		menu.addEventListener("click", event => {
			event.stopPropagation();
			const action = event.target.closest("button")?.dataset.bookAction;
			if (action === "all") apply("");
			else if (action === "none") apply("none");
		});
		menu.addEventListener("change", event => {
			event.stopPropagation();
			if (!event.target.matches('input[type="checkbox"]')) return;
			// All is the starting pool; the first choice starts a custom selection.
			if (!parseBookFilter(bookSel.value).length) {
				apply(event.target.value);
				return;
			}
			const inputs = [...menu.querySelectorAll('input[type="checkbox"]')];
			const selected = inputs.filter(input => input.checked).map(input => input.value);
			apply(selected.length === inputs.length ? "" : selected.join(",") || "none");
		});
		document.addEventListener("click", event => {
			if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
		});
		document.addEventListener("keydown", event => {
			if (event.key === "Escape" && menu.style.display === "block") { close(); button.focus(); }
		});
		document.addEventListener("focusin", event => {
			if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
		});
		window.addEventListener("resize", close);
		const followScroll = event => {
			if (menu.style.display !== 'block') return;
			const bounds = event.currentTarget.getBoundingClientRect();
			const rect = button.getBoundingClientRect();
			if (rect.right <= bounds.left || rect.left >= bounds.right) close();
			else position();
		};
		['center-dropdown', 'header'].forEach(id => {
			document.getElementById(id)?.addEventListener('scroll', followScroll, { passive: true });
		});
	}
	menu.innerHTML = `<p>${PAGE === "heatmap" ? "Show a chart for each checked book." : "Best price among checked books."} From All, pick one book, then add more.</p>
		<div class="chkdd-actions"><button type="button" data-book-action="all">All</button><button type="button" data-book-action="none">None</button></div>
		<div class="book-filter-list">${books.map(book => `<label><input type="checkbox" value="${book}">${book === "best" ? '<span aria-hidden="true" style="width:18px;text-align:center">★</span>Best book' : `<img src="logos/${book}.png" alt="">${parseBook(book)}`}</label>`).join("")}</div>`;
	setBookSelection(BOOK || "");
}

function syncTopFilterStates() {
	const header = document.querySelector('#header.table-filter-header');
	if (!header) return;
	const value = id => document.getElementById(id)?.value || '';
	const text = id => document.getElementById(id)?.textContent.trim() || '';
	const states = {
		'book-filter-button': !!value('book-select'),
		'devig-button': !!DEVIG,
		'required-button': text('required-button') !== 'All',
		'boost-select': !['', '0'].includes(value('boost-select')),
		'prop-dd-button': !['', 'All Props'].includes(text('prop-dd-button')),
		'ou-select': !['', 'ou'].includes(value('ou-select')),
		'game-dd-button': !['', 'All Games'].includes(text('game-dd-button')),
		'range-btn': !!(value('min-odds') || value('max-odds')),
		'min-odds': !!value('min-odds'),
		'max-odds': !!value('max-odds'),
		'filterbuilder-dd-button': !['', 'None'].includes(text('filterbuilder-dd-button'))
	};
	Object.entries(states).forEach(([id, active]) => {
		const control = document.getElementById(id);
		if (control && header.contains(control)) (control.closest('.tf-field') || control).classList.toggle('tf-is-active', active);
	});
	const devig = document.getElementById('devig-button');
	if (devig) devig.title = text('devig-display-text');
}

// Reveal a control without letting scrollIntoView move the hidden page root.
function revealHorizontalControl(container, control) {
	if (!container || !control || !container.contains(control)) return;
	const bounds = container.getBoundingClientRect();
	const rect = control.getBoundingClientRect();
	const left = bounds.left + container.clientLeft;
	const right = left + container.clientWidth;
	if (rect.left < left) container.scrollLeft += rect.left - left;
	else if (rect.right > right) container.scrollLeft += Math.min(rect.left - left, rect.right - right);
}

function initOddsAppViewport() {
	if (!document.querySelector('#app > main #table') ||
		document.documentElement.classList.contains('odds-app')) return;
	document.documentElement.classList.add('odds-app');
	let frame = 0;
	let retry;
	const restoreRoot = () => {
		frame = 0;
		const viewport = window.visualViewport;
		// Leave pinch zoom and the browser's keyboard/focus positioning alone.
		if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
		const active = document.activeElement;
		if (active?.isContentEditable || (active?.matches('input, textarea') &&
			!active.disabled && !active.readOnly &&
			!['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(active.type))) return;
		// overflow:hidden still permits focus and session restoration to scroll
		// these ancestors, leaving the header unreachable by touch scrolling.
		if (window.scrollX || window.scrollY || viewport?.offsetTop || viewport?.offsetLeft) {
			window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
		}
		for (const root of [document.documentElement, document.body]) {
			if (root.scrollTop) root.scrollTop = 0;
			if (root.scrollLeft) root.scrollLeft = 0;
		}
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(restoreRoot);
		clearTimeout(retry);
		// iOS can finish restoring its viewport after pageshow/focusout fires.
		retry = setTimeout(restoreRoot, 300);
	};
	window.addEventListener('pageshow', schedule);
	window.addEventListener('resize', schedule);
	window.addEventListener('scroll', schedule, { passive: true });
	document.body.addEventListener('scroll', schedule, { passive: true });
	document.addEventListener('focusout', schedule);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) schedule();
	});
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	schedule();
}

function initTopFilterLayout() {
	const header = document.getElementById('header');
	const strip = document.getElementById('center-dropdown');
	if (!header || !strip || !header.contains(strip) || !document.getElementById('table') ||
		!strip.querySelector('#devig-button') || header.classList.contains('table-filter-header')) return;
	header.classList.add('table-filter-header');
	strip.setAttribute('role', 'group');
	strip.setAttribute('aria-label', 'Table filters');
	const title = header.querySelector('#title');
	const pages = document.getElementById('page-picker-btn');
	if (title && pages) title.insertBefore(pages, title.querySelector('.help-btn'));
	const discord = header.querySelector('#auth-buttons .discord-login');
	const discordLabel = discord?.querySelector('.btn-text');
	if (discordLabel) {
		discord.setAttribute('aria-label', discordLabel.textContent.trim());
		discordLabel.classList.add('tf-auth-label-full');
		const mobileLabel = document.createElement('span');
		mobileLabel.className = 'tf-auth-label-short';
		mobileLabel.textContent = 'Sign in';
		mobileLabel.setAttribute('aria-hidden', 'true');
		discord.appendChild(mobileLabel);
	}
	const google = header.querySelector('#auth-buttons .gsi-material-button');
	if (google) google.setAttribute('aria-label', 'Sign in with Google');
	const hideAccount = header.querySelector('#auth-buttons #hide-username');
	if (hideAccount) {
		const auth = hideAccount.parentElement;
		const originalNext = hideAccount.nextSibling;
		const mobile = window.matchMedia('(max-width: 600px)');
		// Keep keyboard navigation in the same order as the visible actions.
		const placeHideAction = () => auth.insertBefore(hideAccount, mobile.matches ? null : originalNext);
		placeHideAction();
		mobile.addEventListener('change', placeHideAction);
	}
	const view = header.querySelector('#view-toggle-container');
	if (view) strip.insertBefore(view, strip.querySelector(':scope > #customize'));
	const outerControl = control => {
		if (!control || !strip.contains(control)) return null;
		while (control.parentElement !== strip) control = control.parentElement;
		return control;
	};
	// Keep market filters together, followed by pricing and display controls.
	const boost = outerControl(document.getElementById('boost-select'));
	const range = outerControl(document.getElementById('range-btn') || document.getElementById('min-odds'));
	if (boost && range) {
		strip.insertBefore(boost, range);
		const customBoost = document.getElementById('boost-custom');
		if (customBoost?.parentElement === strip) strip.insertBefore(customBoost, range);
	}
	for (const outer of strip.children) {
		const field = outer.matches('.select-wrapper, .chkdd') ? outer : outer.querySelector(':scope > .select-wrapper, :scope > .chkdd');
		if (field) {
			const label = field.querySelector(':scope > .select-label');
			if (label) field.classList.add('tf-field');
			field.querySelectorAll(':scope > select, :scope > button, :scope > input').forEach(control => {
				control.classList.add(label ? 'tf-input' : 'tf-action');
				if (label && !label.htmlFor && control.id) label.htmlFor = control.id;
			});
		} else if (outer.matches('button')) outer.classList.add('tf-action');
		else if (outer.matches('input')) outer.classList.add('tf-input', 'tf-standalone');
	}
	['devig-button', 'prop-dd-button', 'boost-select', 'header-view-select'].forEach(id => {
		outerControl(document.getElementById(id))?.classList.add('tf-group-start');
	});
	strip.addEventListener('change', syncTopFilterStates);
	strip.addEventListener('input', syncTopFilterStates);
	strip.addEventListener('focusin', event => {
		if (event.target.matches('.tf-input, .tf-action')) {
			revealHorizontalControl(strip, event.target);
		}
	});
	syncTopFilterStates();
}

// Older pages initialize data independently of renderFilters(). Upgrade their
// Book control as well, after page-specific globals and handlers have loaded.
document.addEventListener("DOMContentLoaded", () => {
	if (PAGE !== "heatmap" && document.getElementById("book-select") && !document.getElementById("book-filter-button")) {
		renderBookSelect();
	}
	initTopFilterLayout();
	initOddsAppViewport();
});

// Devig keys are "+"-joined book lists (e.g. "circa+pn+kal"); the same set of
// books can come back in a different order (e.g. "pn+circa+kal"), so compare
// as sets rather than as exact strings.
function devigSetEquals(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	const setA = a.split("+").filter(Boolean).sort();
	const setB = b.split("+").filter(Boolean).sort();
	return setA.length === setB.length && setA.every((v, i) => v === setB[i]);
}

let devPickerSelectionKey = '';

function syncDevPickerSelection({ reveal = false } = {}) {
	const picker = document.getElementById('dev-picker');
	if (!picker || !picker.closest('#dev-picker-row')) return;
	const buttons = [...picker.querySelectorAll('.dev-chip')];
	const [dev, embeddedWeights] = String(DEVIG || '').split(';');
	const weights = String(embeddedWeights || WEIGHT || '').split('+').map(Number);
	const equalWeights = weights.length === dev.split('+').length && weights.every(w => w > 0 && w === weights[0]);
	const books = parseBookFilter(BOOK);
	const propInputs = [...document.querySelectorAll('#prop-options input[type="checkbox"]')];
	const props = propInputs.filter(input => input.checked).map(input => input.value);
	const candidates = equalWeights && !DEVIG_EXCLUDED.length ? buttons.filter(button => {
		const propMatch = !propInputs.length || !props.length || (button.dataset.prop === 'team_total'
			? props.includes('away_total') && props.includes('home_total') : props.includes(button.dataset.prop));
		const bookMatch = books.length ? books.includes(button.dataset.book) : button.dataset.book === 'best';
		return propMatch && bookMatch && devigSetEquals(button.dataset.value, dev);
	}) : [];
	const active = candidates.find(button => button.dataset.key === devPickerSelectionKey) || candidates[0];
	buttons.forEach(button => {
		const selected = button === active;
		button.classList.toggle('active', selected);
		button.setAttribute('aria-pressed', String(selected));
	});
	if (active) {
		devPickerSelectionKey = active.dataset.key;
		if (reveal) revealHorizontalControl(picker, active);
	}
}

async function initDevPicker(data) {
	const picker = document.getElementById('dev-picker');
	const hidden = document.getElementById('devig-select');
	const recordNumber = value => value == null || String(value).trim() === '' ? null : Number(value);
	if (!picker) return;

	// Keep the toolbar mounted while the record window rebuilds the cards.
	if (!document.getElementById('dev-picker-row')) {
		const section = document.createElement('section');
		section.id = 'dev-picker-row';
		section.setAttribute('aria-label', 'Devig presets');
		picker.parentElement.insertBefore(section, picker);
		const toolbar = document.createElement('div');
		toolbar.className = 'dev-picker-col';
		toolbar.innerHTML = `<span class="dev-picker-title">Devig presets</span>
			<label class="dev-window-control" for="dev-window-select"><span>Record window</span>
				<select id="dev-window-select" class="dev-window-select"></select></label>
			<span id="dev-record-upd" class="dev-record-upd"></span>
			<div class="dev-picker-actions"><button type="button" class="dev-manage-btn" aria-label="Manage devig presets" aria-haspopup="dialog">Manage</button></div>`;
		section.appendChild(toolbar);
		const select = toolbar.querySelector('select');
		select.innerHTML = ['All', 'SZN', 'L3', 'L7', 'L14', 'L30', 'L60'].map(value =>
			`<option value="${value}"${value === 'SZN' ? ' title="Current season"' : ''}>${value === 'All' ? 'All-time' : value}</option>`).join('');
		select.addEventListener('change', () => {
			DEV_WINDOW = select.value;
			initDevPicker(getTopDevigs(BOOK || 'best'));
		});
		toolbar.querySelector('.dev-manage-btn').addEventListener('click', event => openDevig(event.currentTarget));
		picker.setAttribute('role', 'group');
		picker.setAttribute('aria-label', 'Select a devig preset');
		picker.addEventListener('keydown', event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches('.dev-chip')) return;
			const buttons = [...picker.querySelectorAll('.dev-chip')].filter(button => button.getClientRects().length);
			const index = buttons.indexOf(event.target);
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
				: Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
			event.preventDefault();
			buttons[next]?.focus({ preventScroll: true });
			revealHorizontalControl(picker, buttons[next]);
		});
		section.appendChild(picker);
	}
	document.getElementById('dev-window-select').value = DEV_WINDOW;
	const updated = document.getElementById('dev-record-upd');
	updated.textContent = '';
	if (typeof RECORD_UPD !== 'undefined' && RECORD_UPD) {
		const date = new Date(RECORD_UPD);
		if (!Number.isNaN(date.getTime())) updated.textContent = `Updated ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
	}
	document.getElementById('dev-window-select').title = ['Record window', updated.textContent].filter(Boolean).join(' · ');
	document.getElementById('dev-window-select').setAttribute('aria-describedby', 'dev-record-upd');
	picker.replaceChildren();
	if (hidden) hidden.innerHTML = '';
	if (!Array.isArray(data) || !data.length) {
		const empty = document.createElement('span');
		empty.className = 'dev-picker-empty';
		empty.textContent = 'No presets for these books. Choose a devig in Manage.';
		picker.appendChild(empty);
		return;
	}

	for (const row of data) {
		const [prop, dev] = row.devig.includes('-vs-') ? row.devig.split('-vs-') : ['hr', row.devig];
		if (PAGE === 'nhl' && ['atgs', 'fgs', 'lgs'].includes(prop)) continue;
		if (PAGE === 'threes' && prop !== '3ptm') continue;
		if (PAGE === 'pts' && !['pts', 'reb', 'ast'].includes(prop)) continue;
		if (['dingers', 'dingers2', 'recap'].includes(PAGE) && prop !== 'hr') continue;
		if (PAGE === 'mlb' && prop === 'hr') continue;
		if (PAGE === 'strikeouts' && prop !== 'k') continue;

		// A card keeps the mix, context and its record in one click target.
		const wrap = document.createElement('div');
		wrap.className = 'dev-chip-wrap';
		wrap.dataset.prop = prop;
		wrap.dataset.book = row.book;
		const button = document.createElement('button');
		button.type = 'button';
		button.id = `devig-btn-${cssSafeId(`${prop}-${row.book}-${dev}`)}`;
		button.className = 'dev-chip';
		button.dataset.value = dev;
		button.dataset.prop = prop;
		button.dataset.book = row.book;
		button.dataset.key = `${prop}|${row.book}|${dev.split('+').sort().join('+')}`;
		button.setAttribute('aria-pressed', 'false');
		button.title = `${dev.split('+').map(parseBook).join(' + ')} · Equal weights`;
		const heading = document.createElement('span');
		heading.className = 'dev-chip-heading';
		const name = document.createElement('span');
		name.className = 'dev-chip-name';
		name.textContent = dev.split('+').map(book => book.toLowerCase() === 'circa' ? 'Circa' : book.toUpperCase()).join(' + ');
		const check = document.createElement('span');
		check.className = 'dev-chip-check';
		check.textContent = '✓';
		check.setAttribute('aria-hidden', 'true');
		heading.append(name, check);
		button.appendChild(heading);
		const context = [];
		if (!['atgs', 'tds', 'tds2', 'dingers', 'dingers2', 'strikeouts', 'threes'].includes(PAGE)) context.push(prop.toUpperCase());
		if (parseBookFilter(BOOK).length > 1) context.push(`Betting at ${row.book.toUpperCase()}`);
		if (context.length) {
			const label = document.createElement('span');
			label.className = 'dev-chip-context';
			label.textContent = context.join(' · ');
			button.appendChild(label);
		}
		const info = document.createElement('span');
		info.className = 'dev-subinfo';
		const record = typeof RECORD !== 'undefined' ? RECORD?.[METHOD || 'worst']?.[row.book]?.[`${prop}-vs-${dev}`]?.[DEV_WINDOW] : null;
		const wins = recordNumber(record?.wins ?? record?.w);
		const losses = recordNumber(record?.losses ?? record?.l);
		const roi = recordNumber(record?.roi);
		if (Number.isFinite(roi) && Number.isFinite(wins) && Number.isFinite(losses) && wins >= 0 && losses >= 0 && wins + losses > 0) {
			const roiLabel = document.createElement('span');
			roiLabel.className = `dev-roi ${roi > 0 ? 'positive' : roi < 0 ? 'negative' : 'neutral'}`;
			roiLabel.textContent = `${roi > 0 ? '+' : ''}${roi.toLocaleString('en-US', { maximumFractionDigits: 2 })}% ROI`;
			const recordLabel = document.createElement('span');
			recordLabel.className = 'dev-record';
			recordLabel.textContent = `${wins}W–${losses}L`;
			info.append(roiLabel, recordLabel);
		} else {
			info.classList.add('dev-no-record');
			info.textContent = DEV_WINDOW === 'All' ? 'No record data' : `No ${DEV_WINDOW} data`;
		}
		button.appendChild(info);
		button.addEventListener('click', () => {
			DEVIG = dev;
			DEVIG_EXCLUDED = [];
			if (hidden) hidden.value = dev;
			devPickerSelectionKey = button.dataset.key;
			WEIGHT = repeatOnes(DEVIG).slice(1);
			REQUIRED = DEVIG.split('+');
			document.getElementById('devig-display-text').innerText = parseWeightKey(`${DEVIG};${WEIGHT}`);
			// A preset retains a selected betting-book group.
			if (parseBookFilter(BOOK).length <= 1) setBookSelection(row.book === 'best' ? '' : row.book);
			const props = prop === 'team_total' ? ['away_total', 'home_total'] : [prop];
			setOptions('prop-options', props);
			updatePropLabel(props);
			updateRequiredDropdown();
			changeFilter();
			syncDevPickerSelection({ reveal: true });
		});
		wrap.appendChild(button);
		picker.appendChild(wrap);
	}
	const propInputs = [...document.querySelectorAll('#prop-options input[type="checkbox"]')];
	if (propInputs.length && typeof filterDevPickerByProps === 'function') {
		filterDevPickerByProps(propInputs.filter(input => input.checked).map(input => input.value));
	}
	syncDevPickerSelection({ reveal: true });
}

// ── Custom filter builder (Custom Filter dropdown) ──────────────────────────
// Every criterion is available at once, each independently enabled via its own
// checkbox. FB_CONFIG only updates (and the table only re-filters) when the user
// clicks Apply. Named combinations can be saved/recalled via Supabase profile
// metadata. Active filters only last for the current page visit.

let FB_CONFIG = {};

const PITCHER_STAT_FIELDS = [
	"barrel_batted_rate", "barrel_batted_ratePercentile", "exit_velocity_avg", "exit_velocity_avgPercentile",
	"flyballs_percent", "flyballs_percentPercentile", "hard_hit_percent", "hard_hit_percentPercentile",
	"launch_angle_avg", "on_base_percent", "on_base_percentPercentile", "on_base_plus_slg", "on_base_plus_slgPercentile",
	"p_era", "pull_percent", "pull_percentPercentile", "slg_percent", "slg_percentPercentile",
	"sweet_spot_percent", "sweet_spot_percentPercentile", "woba", "wobacon", "xba", "xwoba"
];

const BATTER_STAT_FIELDS = [
	"avg_swing_speed", "avg_swing_speedPercentile", "ba", "barrel_ct", "barrels_per_bip", "barrels_per_bipPercentile",
	"barrels_per_pa", "bip", "blasts_swing", "blasts_swingPercentile", "distance_avg", "distance_hr_avg", "distance_max",
	"est_ba", "est_slg", "est_woba", "est_wobaPercentile", "est_wobacon", "exit_velocity_avg", "exit_velocity_avgPercentile",
	"exit_velocity_max", "flyballs_percent", "flyballs_percentPercentile", "hard_hit_ct", "hard_hit_percent",
	"hard_hit_percentPercentile", "launch_angle_avg", "launch_angle_avgPercentile", "meatball_percent", "meatball_percentPercentile",
	"on_base_percent", "on_base_percentPercentile", "on_base_plus_slg", "on_base_plus_slgPercentile", "pa", "pull_percent",
	"pull_percentPercentile", "slg", "slg_percent", "slg_percentPercentile", "squared_up_swing", "squared_up_swingPercentile",
	"sweet_spot_percent", "woba", "wobacon"
];

function statLabel(key) {
	return key.replace(/Percentile$/, " Percentile").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Coerces numbers stored as strings (".291", "89.3", "+10%") to a float, or null if unusable.
function numFrom(v) {
	if (v === null || v === undefined || v === "") return null;
	const n = parseFloat(v);
	return isNaN(n) ? null : n;
}

// Books checked by the liquidity filter criteria's "either"/"both" options.
const LIQUIDITY_BOOKS = ["nv", "px", "kal"];

function initLiquidityFilterUI() {
	const over = document.getElementById("fb-liquidity-over-enabled")?.closest("label");
	const under = document.getElementById("fb-liquidity-enabled")?.closest("label");
	if (!over || !under || document.getElementById("fb-liquidity-ev-enabled")) return;
	const overFields = over.nextElementSibling;
	const underFields = under.nextElementSibling;
	const group = document.createElement("fieldset");
	group.className = "fb-liquidity-group";
	group.innerHTML = `
		<legend>Liquidity</legend>
		<label class="fb-liquidity-logic" for="fb-liquidity-match">
			Match
			<select id="fb-liquidity-match">
				<option value="all">All rules (AND)</option>
				<option value="any">Any rule (OR)</option>
			</select>
		</label>
		<label><input type="checkbox" id="fb-liquidity-ev-enabled"> EV row liquidity</label>
		<div class="fb-subrow">
			<input id="fb-liquidity-ev-amount" type="number" value="50" min="0" step="1" aria-label="Minimum EV-side liquidity in dollars">
			<select id="fb-liquidity-ev-book" aria-label="EV-side liquidity market">${overFields.querySelector("select").innerHTML}</select>
		</div>
		<p class="fb-stat-hint">Requires at least this amount on the EV row's Over or Under side at the selected market.</p>
	`;
	group.addEventListener("click", event => event.stopPropagation());
	over.before(group);
	group.querySelector("#fb-liquidity-ev-enabled").closest("label").before(over, overFields, under, underFields);
}

function passesLiquidityRule(row, config, side, inclusive = false) {
	const min = numFrom(config.amount) ?? (inclusive ? 50 : 200);
	const book = config.book || "nv";
	const clearsBook = key => {
		const liquidity = row.liquidity?.[key];
		if (!Array.isArray(liquidity)) return false;
		const amount = numFrom(liquidity[side]);
		return amount !== null && (inclusive ? amount >= min : amount > min);
	};
	return book === "both" ? LIQUIDITY_BOOKS.every(clearsBook)
		: book === "either" ? LIQUIDITY_BOOKS.some(clearsBook)
		: clearsBook(book);
}

// DOM element ids for each criterion's fields, keyed by role within that criterion's config object.
const FB_FIELDS = {
	liquidity:     { enabled: "fb-liquidity-enabled", book: "fb-liquidity-book", amount: "fb-liquidity-amount" },
	liquidityOver: { enabled: "fb-liquidity-over-enabled", book: "fb-liquidity-over-book", amount: "fb-liquidity-over-amount" },
	liquidityEV:   { enabled: "fb-liquidity-ev-enabled", book: "fb-liquidity-ev-book", amount: "fb-liquidity-ev-amount" },
	homerRate:   { enabled: "fb-homerrate-enabled", window: "fb-homerrate-window", min: "fb-homerrate-min" },
	bpp:         { enabled: "fb-bpp-enabled", min: "fb-bpp-min" },
	due:         { enabled: "fb-due-enabled" },
	line:        { enabled: "fb-line-enabled", min: "fb-line-min", max: "fb-line-max" },
	hrVsPitcher: { enabled: "fb-hrvspitcher-enabled" },
	position:    { enabled: "fb-position-enabled", value: "fb-position-value" },
	teamTotal:   { enabled: "fb-teamtotal-enabled", min: "fb-teamtotal-min" },
	ttoi:        { enabled: "fb-ttoi-enabled", min: "fb-ttoi-min" },
};

const NHL_HIT_RATE_WINDOWS = { szn: 'Season', L5: 'Last 5', L10: 'Last 10', L20: 'Last 20', lyr: 'Last year', career: 'Career' };

// Stat filters are multi-row (add as many field/cmp/value constraints as you want,
// each with an X to remove it), so they're handled separately from the flat FB_FIELDS types.
const FB_STAT_TYPES = {
	pitcherStat: { enabledId: "fb-pitcherstat-enabled", rowsId: "fb-pitcherstat-rows", fields: () => PITCHER_STAT_FIELDS },
	batterStat:  { enabledId: "fb-batterstat-enabled", rowsId: "fb-batterstat-rows", fields: () => BATTER_STAT_FIELDS },
	hitRate:     { enabledId: "fb-hitrate-enabled", rowsId: "fb-hitrate-rows", fields: () => Object.keys(NHL_HIT_RATE_WINDOWS), labels: NHL_HIT_RATE_WINDOWS },
};

function initNhlFilterUI() {
	if (!["nhl", "atgs", "atgs2", "fgs"].includes(PAGE) || document.getElementById('fb-hitrate-enabled')) return;
	const menu = document.getElementById('filterbuilder-options');
	if (!menu) return;
	const section = document.createElement('div');
	section.innerHTML = `
		<label><input type="checkbox" id="fb-hitrate-enabled"> Hit rate (%)</label>
		<div id="fb-hitrate-rows"></div>
		<button type="button" class="fb-add-btn">Add hit-rate rule</button>
		<p class="fb-stat-hint">All hit-rate rules must match. Uses the row's Over or Under side; missing history does not match.</p>
		<label><input type="checkbox" id="fb-position-enabled"> Position</label>
		<div class="fb-subrow">
			<select id="fb-position-value" aria-label="Player position">
				<option value="C">C - Center</option>
				<option value="LW">LW - Left wing</option>
				<option value="RW">RW - Right wing</option>
				<option value="D">D - Defenseman</option>
				<option value="G">G - Goalie</option>
				<option value="W">Wings (LW / RW)</option>
				<option value="F">All forwards (C / LW / RW)</option>
			</select>
		</div>
		${PAGE === 'atgs' ? `
			<label><input type="checkbox" id="fb-teamtotal-enabled"> Est. Team Goals</label>
			<div class="fb-subrow">
				<input id="fb-teamtotal-min" type="number" value="3" min="0" step="0.1" placeholder="Min">
			</div>
			<label><input type="checkbox" id="fb-ttoi-enabled"> TTOI (min)</label>
			<div class="fb-subrow">
				<input id="fb-ttoi-min" type="number" value="20" min="0" step="0.1" placeholder="Min">
			</div>` : ''}<hr>`;
	section.addEventListener('click', event => event.stopPropagation());
	const enabled = section.querySelector('#fb-hitrate-enabled');
	section.querySelector('.fb-add-btn').addEventListener('click', () => {
		enabled.checked = true;
		addStatFilterRow('hitRate', { field: 'szn', cmp: 'gte', value: '50' });
	});
	enabled.addEventListener('change', () => {
		if (enabled.checked && !document.getElementById('fb-hitrate-rows').children.length) {
			addStatFilterRow('hitRate', { field: 'szn', cmp: 'gte', value: '50' });
		}
	});
	const separator = menu.querySelector('hr');
	if (separator) separator.after(section);
	else menu.prepend(section);
}

// Keep the original controls and handlers; pages expose different sets of criteria.
function initFilterBuilderWindow() {
	const menu = document.getElementById('filterbuilder-options');
	if (!menu || menu.classList.contains('fb-window')) return;
	const shell = document.createElement('div');
	shell.className = 'fb-window-shell';
	shell.innerHTML = `
		<div class="fb-window-header">
			<div class="fb-title-wrap"><h2 id="fb-window-title">Filters</h2><span id="fb-active-summary" class="fb-count"></span></div>
			<button type="button" class="fb-close" aria-label="Close filters">&times;</button>
		</div>
		<div class="fb-window-body"></div>
		<div class="fb-window-footer"><span id="fb-draft-status" role="status"></span><div class="fb-footer-actions"></div></div>`;
	const getControl = id => shell.querySelector(`#${id}`) || menu.querySelector(`#${id}`) || document.getElementById(id);
	const body = shell.querySelector('.fb-window-body');
	const section = (title, className = '') => {
		const el = document.createElement('section');
		el.className = `fb-section ${className}`.trim();
		if (title) {
			const heading = document.createElement('h3');
			heading.textContent = title;
			el.appendChild(heading);
		}
		body.appendChild(el);
		return el;
	};
	const liquidity = menu.querySelector('.fb-liquidity-group');
	if (liquidity) {
		section('', 'fb-liquidity-section').appendChild(liquidity);
		[['liquidityOver', 'Over'], ['liquidity', 'Under'], ['liquidityEV', 'EV row']].forEach(([type, title]) => {
			const ids = FB_FIELDS[type];
			const checkbox = getControl(ids.enabled);
			const label = checkbox.closest('label');
			const fields = label.nextElementSibling;
			const rule = document.createElement('div');
			rule.className = 'fb-rule fb-liquidity-rule';
			label.before(rule);
			label.className = 'fb-rule-toggle';
			label.replaceChildren(checkbox, document.createTextNode(title));
			fields.classList.add('fb-liquidity-fields');
			const book = getControl(ids.book);
			book.setAttribute('aria-label', `${title} liquidity market`);
			for (const option of book.options) {
				if (option.value === 'either') option.textContent = 'Any market';
				if (option.value === 'both') option.textContent = 'All markets';
			}
			book.title = 'Any market: NV, PX, or KAL. All markets: NV, PX, and KAL.';
			const amount = getControl(ids.amount);
			amount.setAttribute('aria-label', `${title} liquidity in dollars`);
			const amountWrap = document.createElement('span');
			amountWrap.className = 'fb-amount-wrap';
			amountWrap.innerHTML = '<span class="fb-currency" aria-hidden="true">$</span>';
			amountWrap.appendChild(amount);
			fields.replaceChildren(book, amountWrap);
			rule.append(label, fields);
		});
		liquidity.querySelector('.fb-stat-hint').textContent = "EV row follows the play's Over / Under side.";
	}
	const rules = section('Player & odds');
	const titles = { line: 'Odds range', homerRate: 'Recent hits', bpp: 'BPP minimum', due: 'Due for HR', hrVsPitcher: 'HR vs pitcher', position: 'Position', teamTotal: 'Est. Team Goals', ttoi: 'TTOI (min)' };
	const labels = {
		'fb-line-min': 'Minimum American odds', 'fb-line-max': 'Maximum American odds',
		'fb-homerrate-min': 'Minimum hits', 'fb-homerrate-window': 'Recent hit period', 'fb-bpp-min': 'Minimum BPP percentage',
		'fb-teamtotal-min': 'Minimum estimated team goals', 'fb-ttoi-min': 'Minimum L5 average time on ice in minutes'
	};
	['line', 'position', 'teamTotal', 'ttoi', 'homerRate', 'bpp', 'due', 'hrVsPitcher'].forEach(type => {
		const checkbox = getControl(FB_FIELDS[type].enabled);
		if (!checkbox) return;
		const label = checkbox.closest('label');
		const fields = label.nextElementSibling?.matches('.fb-subrow') ? label.nextElementSibling : null;
		const rule = document.createElement('div');
		rule.className = 'fb-rule';
		label.className = 'fb-rule-toggle';
		// The hit-count criterion is also used on non-HR pages.
		const title = type === 'homerRate' && ['dingers', 'dingers2', 'barrels', 'charts'].includes(PAGE) ? 'Recent homers' : titles[type];
		label.replaceChildren(checkbox, document.createTextNode(title));
		if (type === 'line') label.title = 'Filter the play\'s American odds';
		if (type === 'due') label.title = 'Positive HR gap z-score';
		if (type === 'hrVsPitcher') label.title = 'Has hit a home run against this pitcher';
		if (type === 'teamTotal') label.title = 'Minimum estimated full-game goals for the player\'s team';
		if (type === 'ttoi') label.title = 'Minimum L5 average time on ice per game, in minutes';
		rule.appendChild(label);
		if (fields) rule.appendChild(fields);
		rules.appendChild(rule);
	});
	Object.entries(labels).forEach(([id, label]) => getControl(id)?.setAttribute('aria-label', label));
	Object.entries(FB_STAT_TYPES).forEach(([type, def]) => {
		const checkbox = getControl(def.enabledId);
		const rows = getControl(def.rowsId);
		if (!checkbox || !rows) return;
		const label = checkbox.closest('label');
		const addButton = rows.nextElementSibling;
		const hint = addButton?.nextElementSibling?.matches('.fb-stat-hint') ? addButton.nextElementSibling : null;
		const rule = document.createElement('div');
		rule.className = 'fb-rule fb-stat-rule';
		rule.dataset.statType = type;
		const header = document.createElement('div');
		header.className = 'fb-rule-header';
		label.className = 'fb-rule-toggle';
		header.appendChild(label);
		if (addButton?.matches('.fb-add-btn')) header.appendChild(addButton);
		rows.classList.add('fb-stat-rows');
		rule.append(header, rows);
		if (hint) rule.appendChild(hint);
		rules.appendChild(rule);
	});
	if (rules.children.length === 1) rules.remove();
	else if (!liquidity && !getControl('fb-line-enabled')) rules.querySelector('h3').textContent = 'Stats';

	const presets = section('Saved filters', 'fb-presets');
	menu.querySelectorAll('.fb-toprow').forEach(row => presets.appendChild(row));
	const savedSelect = getControl('fb-saved-select');
	savedSelect?.setAttribute('aria-label', 'Saved filter');
	getControl('fb-name-input')?.setAttribute('aria-label', 'Filter name');
	const saveStatus = getControl('fb-save-status');
	if (saveStatus) {
		saveStatus.setAttribute('role', 'status');
		presets.appendChild(saveStatus);
	}
	const actions = shell.querySelector('.fb-footer-actions');
	[['clearFilterBuilder()', 'fb-clear'], ['applyFilterBuilder()', 'fb-apply']].forEach(([handler, className]) => {
		const button = menu.querySelector(`button[onclick="${handler}"]`);
		if (button) { button.classList.add(className); actions.appendChild(button); }
	});
	menu.replaceChildren(shell);
	menu.classList.add('fb-window');
	['width', 'max-height', 'overflow-y'].forEach(property => menu.style.removeProperty(property));
	menu.setAttribute('role', 'dialog');
	menu.setAttribute('aria-labelledby', 'fb-window-title');
	menu.tabIndex = -1;
	menu.addEventListener('click', event => event.stopPropagation());
	menu.addEventListener('input', refreshFilterBuilderWindow);
	menu.addEventListener('change', refreshFilterBuilderWindow);
	shell.querySelector('.fb-close').addEventListener('click', () => closeFilterBuilderWindow(true));
	const button = getControl('filterbuilder-dd-button');
	button.setAttribute('onclick', 'toggleFilterBuilderWindow(event)');
	button.setAttribute('aria-haspopup', 'dialog');
	button.setAttribute('aria-controls', menu.id);
	button.setAttribute('aria-expanded', 'false');
	document.addEventListener('click', event => {
		if (menu.style.display === 'block' && !menu.contains(event.target) && !button.contains(event.target)) closeFilterBuilderWindow();
	}, true);
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && menu.style.display === 'block') {
			event.preventDefault();
			closeFilterBuilderWindow(true);
		}
	});
	window.addEventListener('resize', positionFilterBuilderWindow);
	document.getElementById('header')?.addEventListener('scroll', positionFilterBuilderWindow, { passive: true });
	window.visualViewport?.addEventListener('resize', positionFilterBuilderWindow);
	new ResizeObserver(positionFilterBuilderWindow).observe(menu);
	// Other dropdowns hide this menu too; keep the trigger's state in sync.
	new MutationObserver(() => {
		const expanded = String(menu.style.display === 'block');
		button.setAttribute('aria-expanded', expanded);
		getControl('filterbuilder-dd').setAttribute('aria-expanded', expanded);
	}).observe(menu, { attributes: true, attributeFilter: ['style'] });
}

function filterBuilderRuleCount(config) {
	let count = Object.keys(FB_FIELDS).filter(type => config[type]?.enabled).length;
	Object.keys(FB_STAT_TYPES).forEach(type => {
		if (config[type]?.enabled) count += Math.max(1, (config[type].rows || []).length);
	});
	return count;
}

function refreshFilterBuilderWindow() {
	const menu = document.getElementById('filterbuilder-options');
	if (!menu?.classList.contains('fb-window')) return;
	menu.querySelectorAll('.fb-rule').forEach(rule => {
		rule.classList.toggle('is-enabled', !!rule.querySelector('input[id$="-enabled"]')?.checked);
	});
	// Values in unchecked rules do not affect the table or mark the draft as changed.
	const activeConfig = config => {
		const enabled = {};
		Object.keys({ ...FB_FIELDS, ...FB_STAT_TYPES }).forEach(type => {
			if (config[type]?.enabled) enabled[type] = config[type];
		});
		if (['liquidity', 'liquidityOver', 'liquidityEV'].some(type => enabled[type])) enabled.liquidityMatch = config.liquidityMatch || 'all';
		return JSON.stringify(enabled);
	};
	const dirty = activeConfig(readFilterBuilderFromDOM()) !== activeConfig(FB_CONFIG);
	const count = filterBuilderRuleCount(FB_CONFIG);
	document.getElementById('fb-active-summary').textContent = count ? `${count} active` : 'None active';
	const status = document.getElementById('fb-draft-status');
	status.textContent = dirty ? 'Changes not applied' : count ? 'Filters applied' : 'Choose rules above';
	status.classList.toggle('is-dirty', dirty);
	menu.querySelector('.fb-apply')?.classList.toggle('has-changes', dirty);
}

function positionFilterBuilderWindow() {
	const menu = document.getElementById('filterbuilder-options');
	if (!menu || menu.style.display !== 'block') return;
	const anchor = document.getElementById('filterbuilder-dd-button').getBoundingClientRect();
	const viewport = window.visualViewport;
	const bottom = (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0);
	const top = viewport?.offsetTop || 0;
	const below = bottom - anchor.bottom - 14;
	const above = anchor.top - top - 14;
	const opensAbove = below < 200 && above > below;
	const available = Math.max(100, Math.min(bottom - top - 16, opensAbove ? above : below));
	menu.style.setProperty('--fb-available-height', `${available}px`);
	const width = menu.getBoundingClientRect().width;
	menu.style.left = `${getDropdownLeft(anchor.left, width)}px`;
	menu.style.right = 'auto';
	menu.style.top = `${Math.max(top + 8, opensAbove ? anchor.top - menu.offsetHeight - 6 : Math.min(anchor.bottom + 6, bottom - menu.offsetHeight - 8))}px`;
}

function closeFilterBuilderWindow(returnFocus = false) {
	const menu = document.getElementById('filterbuilder-options');
	const dd = document.getElementById('filterbuilder-dd');
	if (!menu || !dd) return;
	menu.style.display = 'none';
	dd.appendChild(menu);
	dd.setAttribute('aria-expanded', 'false');
	const button = document.getElementById('filterbuilder-dd-button');
	button?.setAttribute('aria-expanded', 'false');
	if (returnFocus) button?.focus({ preventScroll: true });
}

function toggleFilterBuilderWindow(event) {
	event?.stopPropagation();
	const menu = document.getElementById('filterbuilder-options');
	if (!menu) return;
	if (menu.style.display === 'block') return closeFilterBuilderWindow();
	document.querySelectorAll('.chkdd-menu').forEach(other => { other.style.display = 'none'; });
	document.body.appendChild(menu);
	menu.style.position = 'fixed';
	menu.style.display = 'block';
	refreshFilterBuilderWindow();
	positionFilterBuilderWindow();
	menu.focus({ preventScroll: true });
}

function matchesNhlPosition(value, selected) {
	const aliases = { L: 'LW', R: 'RW', CENTER: 'C', CENTRE: 'C', 'LEFT WING': 'LW', 'RIGHT WING': 'RW', DEFENSEMAN: 'D', DEFENCEMAN: 'D', GOALIE: 'G' };
	const positions = (Array.isArray(value) ? value : [value]).flatMap(pos => String(pos || '').toUpperCase().split(/[/,;|]/))
		.map(pos => aliases[pos.trim()] || pos.trim());
	const allowed = selected === 'F' ? ['C', 'LW', 'RW', 'F', 'W'] : selected === 'W' ? ['LW', 'RW', 'W'] : [selected];
	return positions.some(pos => pos && allowed.includes(pos));
}

function nhlFilterHitRate(row, window) {
	const rate = row.hitRates?.[window];
	const validPercent = value => value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
	if (rate != null) {
		const total = numFrom(rate.t);
		if (total !== null && total <= 0) return null;
		const percent = numFrom(typeof rate === 'object' ? rate.p : rate);
		if (validPercent(percent)) return percent;
		const wins = numFrom(rate.w);
		if (total > 0 && wins !== null && wins >= 0 && wins <= total) return 100 * wins / total;
	}
	const field = { szn: 'hitRate', lyr: 'hitRateLYR', career: 'hitRateCareer' }[window];
	const percent = field ? numFrom(row[field]) : null;
	if (!validPercent(percent)) return null;
	// The legacy career field is always the Over rate; other rates already follow the row's side.
	return window === 'career' && row.under ? 100 - percent : percent;
}

// 25th/50th/75th percentile values for a raw stat field, e.g. RES.thresholds.batters.ba.
// Percentile-suffixed fields (already expressed as a percentile) have no entry.
function getStatThresholds(type, field) {
	if (!["pitcherStat", "batterStat"].includes(type) || !field || field.endsWith("Percentile")) return null;
	const bucket = type === "pitcherStat" ? "pitchers" : "batters";
	return RES?.thresholds?.[bucket]?.[field] || null;
}

function createStatFilterRow(type, initial = {}) {
	const def = FB_STAT_TYPES[type];
	const wrapper = document.createElement("div");
	wrapper.className = "fb-stat-row-wrap";
	wrapper.addEventListener("click", e => e.stopPropagation());

	const row = document.createElement("div");
	row.className = "fb-subrow fb-stat-row";

	const fieldSel = document.createElement("select");
	fieldSel.className = "fb-stat-field";
	def.fields().forEach(f => {
		const opt = document.createElement("option");
		opt.value = f;
		opt.textContent = def.labels?.[f] || statLabel(f);
		fieldSel.appendChild(opt);
	});
	if (initial.field) fieldSel.value = initial.field;

	const cmpSel = document.createElement("select");
	cmpSel.className = "fb-stat-cmp";
	cmpSel.innerHTML = `<option value="gte">Above</option><option value="lte">Below</option>`;
	if (type === 'hitRate') cmpSel.innerHTML = '<option value="gte">At least</option><option value="lte">At most</option>';
	if (initial.cmp) cmpSel.value = initial.cmp;

	const valInput = document.createElement("input");
	valInput.type = "number";
	valInput.step = "0.1";
	valInput.className = "fb-stat-value";
	if (type === 'hitRate') {
		valInput.min = '0';
		valInput.max = '100';
		valInput.setAttribute('aria-label', 'Hit rate percentage');
		fieldSel.setAttribute('aria-label', 'Hit rate period');
		cmpSel.setAttribute('aria-label', 'Hit rate comparison');
	}
	if (type !== 'hitRate') {
		const prefix = type === 'pitcherStat' ? 'Pitcher' : 'Batter';
		fieldSel.setAttribute('aria-label', `${prefix} stat`);
		cmpSel.setAttribute('aria-label', `${prefix} stat comparison`);
		valInput.setAttribute('aria-label', `${prefix} stat threshold`);
	}
	if (initial.value != null) valInput.value = initial.value;

	const removeBtn = document.createElement("button");
	removeBtn.type = "button";
	removeBtn.className = "fb-row-remove";
	removeBtn.title = "Remove this filter";
	removeBtn.textContent = "✕";
	removeBtn.addEventListener("click", e => { e.stopPropagation(); wrapper.remove(); refreshFilterBuilderWindow(); });

	row.append(fieldSel, cmpSel, valInput, removeBtn);

	const hint = document.createElement("div");
	hint.className = "fb-stat-hint";
	const updateHint = () => {
		const t = getStatThresholds(type, fieldSel.value);
		if (!t) {
			hint.style.display = "none";
			hint.textContent = "";
			return;
		}
		hint.style.display = "";
		hint.textContent = `${t[25]} (25th) · ${t[50]} (50th) · ${t[75]} (75th)`;
	};
	fieldSel.addEventListener("change", updateHint);
	updateHint();

	wrapper.append(row, hint);
	return wrapper;
}

function addStatFilterRow(type, initial) {
	const def = FB_STAT_TYPES[type];
	const container = document.getElementById(def?.rowsId);
	if (!container) return;
	container.appendChild(createStatFilterRow(type, initial));
	refreshFilterBuilderWindow();
}

function readStatFilterRows(type) {
	const def = FB_STAT_TYPES[type];
	const container = document.getElementById(def?.rowsId);
	if (!container) return [];
	return [...container.querySelectorAll(".fb-stat-row")].map(row => ({
		field: row.querySelector(".fb-stat-field")?.value,
		cmp: row.querySelector(".fb-stat-cmp")?.value,
		value: row.querySelector(".fb-stat-value")?.value,
	}));
}

function applyStatFilterRows(type, rows) {
	const def = FB_STAT_TYPES[type];
	const container = document.getElementById(def?.rowsId);
	if (!container) return;
	container.innerHTML = "";
	(rows || []).forEach(r => container.appendChild(createStatFilterRow(type, r)));
}

function readFilterBuilderFromDOM() {
	const config = { liquidityMatch: document.getElementById("fb-liquidity-match")?.value || "all" };
	Object.entries(FB_FIELDS).forEach(([type, ids]) => {
		const entry = {};
		Object.entries(ids).forEach(([key, id]) => {
			const el = document.getElementById(id);
			if (!el) return;
			entry[key] = key === "enabled" ? el.checked : el.value;
		});
		config[type] = entry;
	});
	Object.entries(FB_STAT_TYPES).forEach(([type, def]) => {
		config[type] = {
			enabled: document.getElementById(def.enabledId)?.checked || false,
			rows: readStatFilterRows(type),
		};
	});
	return config;
}

function applyFilterBuilderToDOM(config) {
	const liquidityMatch = document.getElementById("fb-liquidity-match");
	if (liquidityMatch) liquidityMatch.value = config?.liquidityMatch === "any" ? "any" : "all";
	Object.entries(FB_FIELDS).forEach(([type, ids]) => {
		const entry = config?.[type] || {};
		Object.entries(ids).forEach(([key, id]) => {
			const el = document.getElementById(id);
			if (!el) return;
			if (key === "enabled") el.checked = !!entry.enabled;
			else if (entry[key] != null) el.value = entry[key];
		});
	});
	Object.entries(FB_STAT_TYPES).forEach(([type, def]) => {
		const entry = config?.[type] || {};
		const enabledEl = document.getElementById(def.enabledId);
		if (enabledEl) enabledEl.checked = !!entry.enabled;
		applyStatFilterRows(type, entry.rows);
	});
}

function passesFilterBuilder(row) {
	const c = FB_CONFIG;
	for (const [type, field, defaultMin] of [['teamTotal', 'teamTotal', 3], ['ttoi', 'avgTOI', 20]]) {
		if (!c[type]?.enabled) continue;
		const min = numFrom(c[type].min) ?? defaultMin;
		const value = numFrom(row[field]);
		if (!Number.isFinite(value) || !Number.isFinite(min) || value < min) return false;
	}
	if (c.position?.enabled && !matchesNhlPosition(row.pos, c.position.value)) return false;
	if (c.hitRate?.enabled) {
		for (const rule of (c.hitRate.rows || [])) {
			const threshold = numFrom(rule.value);
			if (!rule.field || threshold === null) continue;
			const percent = nhlFilterHitRate(row, rule.field);
			if (percent === null || !(rule.cmp === 'lte' ? percent <= threshold : percent >= threshold)) return false;
		}
	}
	const liquidityMatches = [];
	if (c.liquidityOver?.enabled) liquidityMatches.push(passesLiquidityRule(row, c.liquidityOver, 0));
	if (c.liquidity?.enabled) liquidityMatches.push(passesLiquidityRule(row, c.liquidity, 1));
	if (c.liquidityEV?.enabled) liquidityMatches.push(passesLiquidityRule(row, c.liquidityEV, row.under ? 1 : 0, true));
	if (liquidityMatches.length) {
		// Older saved filters without an operator retain their AND behavior.
		const matches = c.liquidityMatch === "any" ? liquidityMatches.some(Boolean) : liquidityMatches.every(Boolean);
		if (!matches) return false;
	}

	if (c.homerRate?.enabled) {
		const hr = row.hitRates?.[c.homerRate.window || "L5"];
		const min = numFrom(c.homerRate.min) ?? 1;
		if (!(hr && numFrom(hr.w) >= min)) return false;
	}

	if (c.bpp?.enabled) {
		const min = numFrom(c.bpp.min) ?? 0;
		const bpp = numFrom(row.bpp);
		if (!(bpp !== null && bpp >= min)) return false;
	}

	if (c.due?.enabled) {
		const z = numFrom(row.homerLogs?.pa?.z);
		if (!(z !== null && z > 0)) return false;
	}

	if (c.line?.enabled) {
		const min = numFrom(c.line.min);
		const max = numFrom(c.line.max);
		const line = numFrom(row.line);
		if (line === null) return false;
		if (min !== null && line < min) return false;
		if (max !== null && line > max) return false;
	}

	if (c.hrVsPitcher?.enabled) {
		const m = String(row.bvp || "").match(/(\d+)\s*HR/i);
		if (!(m && parseInt(m[1], 10) > 0)) return false;
	}

	if (c.pitcherStat?.enabled) {
		for (const r of (c.pitcherStat.rows || [])) {
			const val = numFrom(r.value);
			if (!r.field || val === null) continue;
			const stat = numFrom(row.pitcherData?.[r.field]);
			if (stat === null) return false;
			if (!(r.cmp === "lte" ? stat <= val : stat >= val)) return false;
		}
	}

	if (c.batterStat?.enabled) {
		for (const r of (c.batterStat.rows || [])) {
			const val = numFrom(r.value);
			if (!r.field || val === null) continue;
			const stat = numFrom(row.savant?.[r.field]);
			if (stat === null) return false;
			if (!(r.cmp === "lte" ? stat <= val : stat >= val)) return false;
		}
	}

	return true;
}

function updateFilterBuilderButtonLabel() {
	const btn = document.getElementById("filterbuilder-dd-button");
	if (!btn) return;
	const n = filterBuilderRuleCount(FB_CONFIG);
	btn.textContent = n === 0 ? "None" : `${n} Filter${n === 1 ? "" : "s"}`;
}

function getSavedFilterBuilders() {
	return CURR_USER?.metadata?.[`${PAGE}-savedFilters`] || [];
}

function populateSavedFilterBuilderSelect() {
	const sel = document.getElementById("fb-saved-select");
	if (!sel) return;
	sel.innerHTML = '<option value="">Load saved filter...</option>';
	getSavedFilterBuilders().forEach((f, i) => {
		const opt = document.createElement("option");
		opt.value = String(i);
		opt.textContent = f.name;
		sel.appendChild(opt);
	});
}

function loadSavedFilterBuilder(idx) {
	const entry = getSavedFilterBuilders()[idx];
	if (!entry) return;
	applyFilterBuilderToDOM(entry.config);
	const nameInput = document.getElementById("fb-name-input");
	if (nameInput) nameInput.value = entry.name;
	applyFilterBuilder();
}

async function saveFilterBuilder() {
	const status = document.getElementById("fb-save-status");
	const name = document.getElementById("fb-name-input")?.value?.trim();
	if (!name) {
		if (status) status.textContent = "Enter a name first";
		return;
	}
	if (!CURR_USER || !CURR_SESSION) {
		if (status) status.textContent = "Log in to save filters";
		return;
	}
	const config = readFilterBuilderFromDOM();
	const saved = [...getSavedFilterBuilders()];
	const idx = saved.findIndex(f => f.name === name);
	if (idx >= 0) saved[idx] = { name, config }; else saved.push({ name, config });

	const metadata = { ...CURR_USER.metadata, [`${PAGE}-savedFilters`]: saved };
	if (status) status.textContent = "Saving...";
	const { error } = await SB.from('profiles').update({ metadata }).eq('id', CURR_SESSION.user.id);
	if (error) {
		if (status) status.textContent = "Error saving";
		return;
	}
	CURR_USER.metadata = metadata;
	if (typeof cacheProfile === "function") cacheProfile(CURR_USER);
	populateSavedFilterBuilderSelect();
	if (status) { status.textContent = "✅ Saved!"; setTimeout(() => status.textContent = "", 2000); }
}

async function deleteSavedFilterBuilder() {
	const sel = document.getElementById("fb-saved-select");
	const status = document.getElementById("fb-save-status");
	if (!sel || sel.value === "") return;
	if (!CURR_USER || !CURR_SESSION) return;
	const saved = [...getSavedFilterBuilders()];
	saved.splice(Number(sel.value), 1);
	const metadata = { ...CURR_USER.metadata, [`${PAGE}-savedFilters`]: saved };
	const { error } = await SB.from('profiles').update({ metadata }).eq('id', CURR_SESSION.user.id);
	if (!error) {
		CURR_USER.metadata = metadata;
		if (typeof cacheProfile === "function") cacheProfile(CURR_USER);
		populateSavedFilterBuilderSelect();
		if (status) { status.textContent = "Deleted"; setTimeout(() => status.textContent = "", 2000); }
	}
}

function clearFilterBuilder() {
	document.querySelectorAll('#filterbuilder-options input[id$="-enabled"]').forEach(cb => cb.checked = false);
	const liquidityMatch = document.getElementById("fb-liquidity-match");
	if (liquidityMatch) liquidityMatch.value = "all";
	Object.keys(FB_STAT_TYPES).forEach(type => applyStatFilterRows(type, []));
	const nameInput = document.getElementById("fb-name-input");
	if (nameInput) nameInput.value = "";
	applyFilterBuilder();
}

// Apply for this page visit. Only Save As persists a filter for later use.
function applyFilterBuilder() {
	FB_CONFIG = readFilterBuilderFromDOM();
	updateFilterBuilderButtonLabel();
	refreshFilterBuilderWindow();
	if (typeof changeFilter === "function") return changeFilter();
}

function initFilterBuilderUI() {
	const dd = document.getElementById("filterbuilder-dd");
	if (!dd || dd.dataset.filterBuilderInit) return;
	dd.dataset.filterBuilderInit = "1";
	initLiquidityFilterUI();
	initNhlFilterUI();
	initFilterBuilderWindow();

	// filter.js has a document-level "change" listener that treats any checkbox inside any
	// .chkdd-menu as a Prop/Game filter checkbox (onChkddChange). This panel reuses .chkdd-menu
	// purely for shared dropdown styling/positioning, so stop change events from bubbling past
	// it to avoid corrupting the Prop label / devig picker with this panel's checkbox states.
	document.getElementById("filterbuilder-options")?.addEventListener("change", e => e.stopPropagation());

	document.getElementById("fb-saved-select")?.addEventListener("change", e => {
		if (e.target.value !== "") loadSavedFilterBuilder(Number(e.target.value));
	});

	// Ignore legacy activeFilter metadata, including the synchronously cached profile.
	FB_CONFIG = {};
	applyFilterBuilderToDOM(FB_CONFIG);
	updateFilterBuilderButtonLabel();
	populateSavedFilterBuilderSelect();
	refreshFilterBuilderWindow();
}

function renderFilters() {
	renderBookSelect();
	initDevPicker(getTopDevigs(BOOK||"best"));
	if (typeof loadHeatmapData === "function") {
		loadHeatmapData();
	}
	initFilterBuilderUI();
}
