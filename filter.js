
const CHKDD_STATE = {};
const ALL_POSSIBLE_BOOKS = ["circa", "pn", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "hr_az", "bv", "cz", "fl", "br", "re"];

function restoreChkddState(menu) {
	wireChkddMenu(menu);

	const saved = CHKDD_STATE[menu.id];
	if (!saved) return;

	menu.querySelectorAll("input[type=checkbox]").forEach(cb => {
		cb.checked = saved.includes(cb.value);
	});
}

function wireChkddMenu(menu, onChange = onChkddChange) {
	// prevent duplicate listeners when menu is rebuilt/refreshed
	if (menu.dataset.wired === "1") return;
	menu.dataset.wired = "1";

	menu.addEventListener("click", (e) => {
		const act = e.target?.dataset?.act; // "all" | "none"
		if (!act) return;

		const state = act === "all";
		menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = state);
		onChange(menu);
	});

	menu.addEventListener("change", (e) => {
		if (e.target?.matches('input[type="checkbox"]')) {
			onChange(menu);
		}
	});
}

function onChkddChange(menu) {
	const id = menu.id;
	if (!id) return;

	CHKDD_STATE[id] = [...menu.querySelectorAll("input[type=checkbox]")]
		.filter(cb => cb.checked)
		.map(cb => cb.value);

	if (id.includes("game")) {
		updateGameLabel(CHKDD_STATE[id]);
	} else {
		updatePropLabel(CHKDD_STATE[id]);
		if (typeof filterDevPickerByProps === 'function') {
			filterDevPickerByProps(CHKDD_STATE[id]);
		}
	}
	if (typeof TABLE !== 'undefined' && TABLE) changeFilter?.();
}

document.addEventListener("change", (e) => {
	const cb = e.target;
	if (cb.type !== "checkbox") return;

	const menu = cb.closest(".chkdd-menu");
	if (!menu) return;

	onChkddChange(menu);
});

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

function updateGameLabel(props) {
	const all_props = document.querySelectorAll("#game-options input").length;
	const btn = document.getElementById("game-dd-button");

	if (props.length == 0) {
		btn.innerText = "No Games";
	} else if (props.length == all_props) {
		btn.innerText = "All Games";
	} else if (props.length == 1) {
		btn.innerText = props[0].toUpperCase();
	} else {
		btn.innerText = `${props.length} Games`;
	}
}

function updatePropLabel(props) {
	const all_props = document.querySelectorAll("#prop-options input").length;
	const btn = document.getElementById("prop-dd-button");

	if (!btn) return;

	if (props.length == 0) {
		btn.innerText = "No Props";
	} else if (props.length == all_props) {
		btn.innerText = "All Props";
	} else if (props.length == 1) {
		btn.innerText = props[0].toUpperCase();
	} else {
		btn.innerText = `${props.length} Props`;
	}
}

const createGameOption = (val, gameTime, container) => {
	const label = document.createElement('label');
	label.setAttribute("onclick", "event.stopPropagation()")

	let display = val.toUpperCase();
	if (gameTime) {
		let dt = new Date(gameTime);
		dt = dt.toLocaleString("en-US", {
			timeZone: "America/New_York",
			hour: "numeric",
			minute: "numeric",
			hour12: true
		}).split(", ").at(-1);
		display += ` (${dt})`;
	}
	label.innerHTML = `<input type="checkbox" value="${val}" checked> ${display}`;
	container.appendChild(label);
};

const createOption = (val, container) => {
	const label = document.createElement('label');
	label.setAttribute("onclick", "event.stopPropagation()")
	label.innerHTML = `<input type="checkbox" value="${val}" checked> ${val.toUpperCase()}`;
	container.appendChild(label);
};

function closeDropdown(dd, menu) {
	menu.style.display = "none";
	dd.appendChild(menu);
	dd.setAttribute('aria-expanded','false');
}

function openDropdown(id, menu) {
	const r = document.getElementById(id).getBoundingClientRect();
	menu.style.position = "fixed";
	menu.style.top = `${r.bottom + 6}px`;
	menu.style.left = MOBILE ? 0 : `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	menu.style.right = 'auto';
	document.body.appendChild(menu);
	menu.style.display = 'block';
	document.getElementById(id).setAttribute('aria-expanded','true');
}

function toggleDropdown(id, event) {
	if (event) event.stopPropagation();
	const menu = document.querySelector(`#${id.split("-")[0]}-options`);
	const isVisible = menu.style.display === 'block';
	document.querySelectorAll('.chkdd-menu').forEach(m => m.style.display = 'none');
	menu.style.display = isVisible ? 'none' : 'block';

	isVisible ? closeDropdown(document.getElementById(id), menu) : openDropdown(id, menu);
}

function renderBookSelect() {
	let exclude = document.querySelector("#exclude-dd .chkdd-menu");
	let bookSel = document.getElementById("book-select");

	let books = ["fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "fl", "re", "bol", "kambi", "pn", "kal", "nv", "px", "poly"];

	if (["dingers", "dingers2", "mlb"].includes(PAGE)) {
		books.push("hr_oh");
	} else if (["nba", "threes", "pts"]) {
		books.push("hr_az");
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

function renderFilters() {
	renderBookSelect();
	initDevPicker(getTopDevigs(BOOK||"best"));
	if (typeof loadHeatmapData === "function") {
		loadHeatmapData();
	}
}

function toggleBookOddsColumns() {
	const bookOddsFields = ["bookOdds.circa", "bookOdds.fd", "bookOdds.b365", "bookOdds.dk",
		"bookOdds.mgm", "bookOdds.espn", "bookOdds.cz", "bookOdds.fn",
		"bookOdds.br", "bookOdds.hr", "bookOdds.bv", "bookOdds.re",
		"bookOdds.fl", "bookOdds.kambi", "bookOdds.bol", "bookOdds.pn",
		"bookOdds.px", "bookOdds.nv", "bookOdds.poly", "bookOdds.kal"
	];
	
	const circaCol = TABLE.getColumn("bookOdds.circa");
	if (!circaCol) return;
	
	const isVisible = circaCol.isVisible();
	
	// Toggle all bookOdds columns
	bookOddsFields.forEach(field => {
		const col = TABLE.getColumn(field);
		if (col) {
			if (isVisible) {
				col.hide();
			} else {
				col.show();
			}
		}
	});
	
	// Update the toggle button
	const toggleBtn = document.querySelector("#toggle-bookodds-btn");
	if (toggleBtn) {
		if (isVisible) {
			toggleBtn.innerHTML = '<span id="book-odds-toggle">+</span> Show Odds';
		} else {
			toggleBtn.innerHTML = '<span id="book-odds-toggle">−</span> Hide Odds';
		}
	}
}

function updateHeaders() {
	const weights = (typeof devigDisplay !== "undefined") ? getPercentWeights() : {};
	for (book in UPDATED[PAGE]) {
		if (!UPDATED[PAGE][book]) {
			continue;
		}

		if (!TABLE.getColumn(`bookOdds.${book}`)) {
			continue;
		}
		let html = `${book.toUpperCase()}<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' style='height:12px;width:12px;' />`;

		let ta = timeAgo(UPDATED[PAGE][book], short=true);
		if (ta) {
			html += `<span class='time-hdrs' style='font-size:0.7rem;'>${ta.replace(" ago", "")}</span>`;
		}
		html += `<span id='${book}-weight-hdr' class='weight-hdrs' style='font-size:0.7rem;'>`;
		if (weights[book]) {
			html += `⚖️<br>${Math.round(weights[book])}%`;
		}
		html += '</span>';
		let el = TABLE.getColumn(`bookOdds.${book}`).getElement();
		let title = el.querySelector(".tabulator-col-title");
		title.style.height = "48px";
		title.innerHTML = html;
	}
}

function updateWeightHeader() {
	const weights = getPercentWeights();
	Array.from(document.getElementsByClassName("weight-hdrs")).forEach(hdr => {
		hdr.textContent = "";
	});
	Object.entries(weights).forEach(([book, weight]) => {
		const el = document.getElementById(`${book}-weight-hdr`);
		if (el && weight) {
			el.innerHTML = `⚖️<br>${weight}%`;
		}
	});
}

// Exclude
const dd = document.getElementById('exclude-dd');
const excludeBtn = dd?.querySelector('.chkdd-btn');
let menu = dd?.querySelector('.chkdd-menu');
let boxes = [];
if (dd) {
	boxes = [...dd.querySelectorAll('input[type="checkbox"]')];
}

// Wrap scrollable content so action buttons stay visible
if (menu && !menu.querySelector('.chkdd-scroll')) {
	const scroll = document.createElement('div');
	scroll.className = 'chkdd-scroll';
	const actions = [...menu.querySelectorAll(':scope > .chkdd-actions, :scope > div:last-child')];
	const toWrap = [...menu.childNodes].filter(n => !actions.includes(n));
	toWrap.forEach(n => scroll.appendChild(n));
	menu.insertBefore(scroll, menu.firstChild);
}

function getExcludedBooks() {
	return boxes.filter(b => b.checked).map(b => b.value);
}

const PREDICTION_MARKET_BOOKS = ["kal", "poly", "px", "nv"];
function togglePredictionMarkets() {
	const menu = document.getElementById('exclude-dd')?.querySelector('.chkdd-menu') || document.body;
	const predBoxes = PREDICTION_MARKET_BOOKS.map(v => menu.querySelector(`input[value="${v}"]`)).filter(Boolean);
	const allChecked = predBoxes.every(b => b.checked);
	predBoxes.forEach(b => { b.checked = !allChecked; });
	changeFilter();
}
if (excludeBtn) {
	excludeBtn.addEventListener("click", (e) => {
		//const open = dd.classList.toggle("open");
		//excludeBtn.setAttribute("aria-expanded", open ? true : false);
		e.stopPropagation();
		const open = excludeBtn.getAttribute('aria-expanded') === 'true';
		open ? closeMenu() : openMenu();
	});
}

if (menu) {
	document.addEventListener('click', (e) => {
		if (menu.style.display === 'block' && !menu.contains(e.target)) closeMenu();
	});
	boxes.forEach(b => b.addEventListener('change', () => {
		changeFilter();
	}));
	
	menu.addEventListener('click', (e) => {
		const act = e.target?.dataset?.act;
		if (!act) return;
		const state = act === 'all';
		boxes.forEach(b => b.checked = state);
		changeFilter();
	});
}

document.querySelectorAll("#overlay input[type=checkbox]").forEach(checkbox => {
	checkbox.addEventListener("change", () => {
		const field = checkbox.id.replace(/^custom_/, "").replace("bookOdds_", "bookOdds.").replace("savant_", "savant.").replace("batter_percs_", "batter_percs.").replace("percs_", "percs.").replace("pitcherData_", "pitcherData.").replace("homerLogs_pa_", "homerLogs.pa.");
		if (checkbox.checked) {
			TABLE.getColumn(field)?.show();
		} else {
			TABLE.getColumn(field)?.hide();
		}
	});
});

function openMenu() {
	const r = excludeBtn.getBoundingClientRect();
	menu.style.position = 'fixed';
	menu.style.top = `${r.bottom + 6}px`;
	menu.style.left = MOBILE ? 0 : `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	menu.style.right = 'auto';
	document.body.appendChild(menu);
	menu.style.display = 'block';
	excludeBtn.setAttribute('aria-expanded','true');
}

function closeMenu() {
	menu.style.display = 'none';
	dd.appendChild(menu);                  // put it back (optional)
	excludeBtn.setAttribute('aria-expanded','false');
}

const boostSel = document.getElementById('boost-select');
const boostCustom = document.getElementById('boost-custom');

if (boostSel) {
	boostSel.value = BOOST || 0;
	if (BOOST == "custom") {
		boostCustom.style.display = "";
	}
	boostSel.addEventListener("change", (event) => {
		boostCustom.style.display = (event.target.value === "custom") ? '' : 'none';
		changeFilter();
	});

	boostCustom.addEventListener("input", () => {
		changeFilter();
	});
}

function toggleRange(e) {
  e.stopPropagation();
  document.getElementById("range-panel").classList.toggle("hidden");
}

function applyRange() {
  const min = document.getElementById("range-min").value;
  const max = document.getElementById("range-max").value;

  document.getElementById("min-odds").value = min;
  document.getElementById("max-odds").value = max;

  updateRangeLabel(min, max);
  document.getElementById("range-panel").classList.add("hidden");

  changeFilter();
}

function clearRange() {
  document.getElementById("range-min").value = "";
  document.getElementById("range-max").value = "";
  document.getElementById("min-odds").value = "";
  document.getElementById("max-odds").value = "";

  updateRangeLabel();
  document.getElementById("range-panel").classList.add("hidden");

  changeFilter();
}

function updateRangeLabel(min, max) {
  const btn = document.getElementById("range-btn");
  if (!min && !max) {
	btn.textContent = "Any";
  } else if (min && max) {
	btn.textContent = `${min} → ${max}`;
  } else if (min) {
	btn.textContent = `≥ ${min}`;
  } else {
	btn.textContent = `≤ ${max}`;
  }
}

const debouncedChangeFilter = debounce(changeFilter, 400);
if (document.getElementById("min-odds")) {
	document.getElementById("min-odds").value = MIN;
	document.getElementById("min-odds").addEventListener("input", debouncedChangeFilter);
	document.getElementById("max-odds").value = MAX;
	document.getElementById("max-odds").addEventListener("input", debouncedChangeFilter);
}

const devigSel = document.getElementById("devig-select");
if (devigSel) {
	devigSel.value = DEVIG ? `${DEVIG};${WEIGHT}` : DEVIG;
	if (!WEIGHT && !DEVIG.includes("+")) {
		WEIGHT = "1";
	}
}

if (document.getElementById("required-dd")) {
	updateRequiredDropdown();
	
	// Close required-dd when clicking elsewhere
	document.addEventListener('click', (e) => {
		const requiredDD = document.getElementById("required-dd");
		const requiredBtn = document.getElementById("required-button");
		const requiredMenu = document.getElementById("required-options");
		
		if (requiredMenu && requiredMenu.style.display === 'block' && 
		    !requiredMenu.contains(e.target) && !requiredBtn.contains(e.target)) {
			requiredMenu.style.display = "none";
		}
	});
}

if (document.getElementById("devig-display-text") && typeof parseWeightKey === 'function') {
	document.getElementById("devig-display-text").innerText = parseWeightKey(`${DEVIG};${WEIGHT}`);
}

if (devigSel) {
	devigSel.addEventListener("change", (event) => {
		if (event.target.value == "custom") {
			openCustomDevig();
		} else {
			[DEVIG, WEIGHT] = event.target.value.split(";");
			if (!DEVIG.includes("+")) {
				WEIGHT = "1";
			}
			changeFilter();
		}
	});
}

function updateRequiredLabel(requiredBooks) {
	const button = document.getElementById("required-button");
	if (!button) return;
	
	if (requiredBooks.length === 0) {
		button.textContent = "Any";
	} else if (DEVIG && requiredBooks.length === DEVIG.split("+").length) {
		button.textContent = `All`;
	} else {
		const booksHTML = requiredBooks.map(book => {
			return `<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />`;
		}).join("");
		button.innerHTML = booksHTML;
	}
}

function getRequiredBooks() {
	const menu = document.getElementById("required-options");
	if (!menu) return [];
	
	const checkboxes = menu.querySelectorAll("input[type='checkbox']:checked");
	return Array.from(checkboxes).map(cb => cb.value);
}

function updateRequiredDropdown() {
	const menu = document.getElementById("required-options");
	if (!menu) return;
	
	// Get current devig books
	let devigBook = DEVIG || "";
	if (devigBook.includes(";")) {
		devigBook = devigBook.split(";")[0];
	}
	
	let devigBooks = devigBook ? devigBook.split("+").filter(Boolean) : [];

	if (!devigBooks.length) {
		devigBooks = ALL_POSSIBLE_BOOKS;
	} else if (devigBooks.length == 1) {
		REQUIRED = devigBooks;
	}
	
	// Clear existing options (keep action buttons)
	const actionsDiv = menu.querySelector(".chkdd-actions");
	menu.innerHTML = "";
	if (actionsDiv) {
		menu.appendChild(actionsDiv);
	} else {
		menu.innerHTML = `
			<div class="chkdd-actions">
				<button type="button" data-act="all">All</button>
				<button type="button" data-act="any">Any</button>
			</div>
		`;
	}
	
	// If no devig or market avg, show message
	if (devigBooks.length === 0) {
		const msg = document.createElement("div");
		msg.style.padding = "8px";
		msg.style.textAlign = "center";
		msg.style.color = "#999";
		msg.textContent = "Required Books";
		menu.appendChild(msg);
		updateRequiredLabel([]);
		return;
	}
	
	// Create checkbox for each devig book
	devigBooks.forEach(book => {
		const label = document.createElement("label");
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.value = book;
		checkbox.addEventListener("change", () => {
			REQUIRED = getRequiredBooks();
			updateRequiredLabel(REQUIRED);
			debouncedChangeFilter();
		});
		
		const bookName = parseBook(book);
		label.appendChild(checkbox);
		label.appendChild(document.createTextNode(` ${bookName}`));
		menu.appendChild(label);
	});
	
	// Wire up All/Any buttons
	const actionsButtons = menu.querySelectorAll(".chkdd-actions button");
	actionsButtons.forEach(btn => {
		btn.addEventListener("click", (e) => {
			const act = e.target.dataset.act;
			const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
			
			if (act === "all") {
				checkboxes.forEach(cb => cb.checked = true);
			} else if (act === "any") {
				checkboxes.forEach(cb => cb.checked = false);
			}
			
			REQUIRED = getRequiredBooks();
			updateRequiredLabel(REQUIRED);
			debouncedChangeFilter();
		});
	});
	
	// Restore previously selected books
	if (REQUIRED.includes(",")) {
		REQUIRED = REQUIRED.split(",");
	} else if (typeof REQUIRED === "string" && REQUIRED.length > 0) {
		REQUIRED = [REQUIRED];
	}
	const savedRequired = REQUIRED || [];
	savedRequired.forEach(book => {
		const checkbox = menu.querySelector(`input[value="${book}"]`);
		if (checkbox) checkbox.checked = true;
	});
	
	updateRequiredLabel(savedRequired);
}

if (document.getElementById("ou-select")) {
	document.querySelector("#ou-select").value = OU;
	document.querySelector("#ou-select").addEventListener("change", (event) => {
		changeFilter();
	});
}

if (document.getElementById("game-select")) {
	document.querySelector("#game-select").value = GAME || "";
	document.querySelector("#game-select").addEventListener("change", (event) => {
		GAME = event.target.value;
		const params = new URLSearchParams(window.location.search);
		params.set("game", GAME);
		const newUrl = `${window.location.pathname}?${params.toString()}`;
		history.pushState({}, '', newUrl);
		TABLE.clearFilter();
		changeFilter();
	});
}

if (document.getElementById("book-select")) {
	document.querySelector("#book-select").value = BOOK || "";
	document.querySelector("#book-select").addEventListener("change", (event) => {
		BOOK = event.target.value;
		if (PAGE === "heatmap") {
			updateHeatmap();
		} else {
			initDevPicker(getTopDevigs(BOOK||"best"));
			changeFilter();
		}
	});
}

async function saveMethod() {
	if (!CURR_USER) return;
	const metadata = CURR_USER?.metadata || {};

	metadata[`${PAGE}-method`] = METHOD;
	if (CURR_USER) {
		const { error: updateError } = await SB.from('profiles')
			.update({metadata: metadata})
			.eq('id', CURR_SESSION.user.id);
	}
}

const methodInit = document.getElementById("method-select");
if (methodInit) {
	methodInit.value = METHOD;
	methodInit.addEventListener("change", (event) => {
		METHOD = event.target.value;
		setUrlParams({method: METHOD});

		if (PAGE === "heatmap") {
			init();
		} else if (PAGE === "cheat") {
			initFilters();
			renderDashboard();
		} else {
			saveMethod();
			initDevPicker(getTopDevigs(BOOK || "best"));
			loadHeatmapData().then(() => {
				changeFilter();
			});
		}
	});
}

function changeView(view) {
	const cardContainer = document.getElementById("card-container");
	const table = document.getElementById("table");
	const playerFilter = document.querySelector(".filter-wrapper");
	if (view === "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		playerFilter.style.display = "flex";
		initializeCards(RES.data);
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
		playerFilter.style.display = "none";
		renderTable(RES.data);
	}
}

if (document.getElementById("view-select")) {
	document.querySelector("#view-select").value = CURRENT_VIEW || "";
	document.querySelector("#view-select").addEventListener("change", (event) => {
		CURRENT_VIEW = event.target.value;
		const params = new URLSearchParams(window.location.search);
		params.set("view", CURRENT_VIEW);
		const newUrl = `${window.location.pathname}?${params.toString()}`;
		history.pushState({}, '', newUrl);
		changeView(event.target.value);
	});
}

const DEFAULT_DEVIGS = [
	{ name: "FD", value: "fd;1", group: "100% Weight" },
	{ name: "DK", value: "dk;1", group: "100% Weight" },
	{ name: "PN", value: "pn;1", group: "100% Weight" },
	{ name: "Circa", value: "circa;1", group: "100% Weight" },
	{ name: "ESPN", value: "espn;1", group: "100% Weight" },
	{ name: "HR", value: "hr;1", group: "100% Weight" },
	{ name: "MGM", value: "mgm;1", group: "100% Weight" },
	{ name: "BOL", value: "bol;1", group: "100% Weight" },
	{ name: "B365", value: "b365;1", group: "100% Weight" },
	{ name: "BV", value: "bv;1", group: "100% Weight" },

	{ name: "FD/DK 50% Equal", value: "fd+dk;1+1", group: "Split Weights" },
	{ name: "PN/Circa 50% Equal", value: "pn+circa;1+1", group: "Split Weights" },
	{ name: "ESPN/HR 50% Equal", value: "espn+hr;1+1", group: "Split Weights" },
	{ name: "CIRC/PN/FD/DK 25% Equal", value: "circa+pn+fd+dk;1+1+1+1", group: "Split Weights" }
];

const devigModal = document.getElementById('devig-modal');
const devigDisplay = document.getElementById('devig-display-text');
const devigOptionsContainer = document.getElementById('devig-options-container');

function getDevigNameFromValue(value) {
	const customDevigs = getCustomDevigs();
	const customMatch = customDevigs.find(key => key === value);
	if (customMatch) return getDevigDisplayName(customMatch);

	const defaultMatch = DEFAULT_DEVIGS.find(d => d.value === value);
	if (defaultMatch) return defaultMatch.name;

	return "Market Avg";
}

function getDevigAlias() {
	const meta = CURR_USER?.metadata || {};
	return meta["alias"] || {};
}

function getDevigDisplayName(devigKey) {
	if (!devigKey) return "Market Avg";
	const names = getDevigAlias();
	return names[devigKey] || parseWeightKey(devigKey);
}

const MAX_FAVORITES = 7;

function toggleFavorite(devigKey) {
	let favorites = getFavoriteDevigs();
	const index = favorites.indexOf(devigKey);

	if (index > -1) {
		// unfavorited
		favorites.splice(index, 1);
	} else {
		if (favorites.length < MAX_FAVORITES) {
			favorites.push(devigKey);
		} else {
			alert(`You can only have a maximum of ${MAX_FAVORITES} favorites.`)
			return;
		}
	}

	setFavoriteDevigs(favorites);
	renderDevigOptions(document.getElementById("devig-search").value);
}

function renderDevigOptions(searchTerm = "") {
	const customDevigs = getCustomDevigs().map(key => ({
		name: getDevigDisplayName(key),
		value: key,
		group: "Your Custom Devigs"
	}));

	const currentFavorites = new Set(getFavoriteDevigs());

	const favorites = getFavoriteDevigs().map(key => ({
		name: getDevigDisplayName(key),
		value: key,
		group: "Favorites"
	}));

	const allOptions = [
		{ name: "Market Avg", value: "", group: "Default" },
		...favorites,
		...DEFAULT_DEVIGS,
		...customDevigs.filter(opt => !currentFavorites.has(opt.value))
	];

	const allLabels = getAllDevigLabels();
	devigOptionsContainer.innerHTML = '';

	const filteredOptions = allOptions.filter(opt => {
		const nameMatch = opt.name.toLowerCase().includes(searchTerm.toLowerCase());
		const devigLabels = allLabels[opt.value] || [];
		const labelMatch = devigLabels.some(label => 
			label.toLowerCase().includes(searchTerm.toLowerCase())
		);
		return nameMatch || labelMatch;
	});

	const groupedOptions = filteredOptions.reduce((acc, opt) => {
		acc[opt.group] = acc[opt.group] || [];
		acc[opt.group].push(opt);
		return acc;
	}, {});

	for (const group in groupedOptions) {
		// Create collapsible group header
		const groupHeader = document.createElement('h4');
		groupHeader.textContent = group == "Favorites" ? `Favorites (${MAX_FAVORITES} max)` : group;;
		groupHeader.classList.add('devig-group-header');
		devigOptionsContainer.appendChild(groupHeader);

		// Create container for the options in this group
		const groupContainer = document.createElement('div');
		groupContainer.classList.add('devig-group-container');

		if (group == "100% Weight") {
			groupContainer.style.display = "flex";
			groupContainer.style.flexWrap = "wrap";
			groupContainer.style.justifyContent = "space-evenly";
		}

		groupedOptions[group].forEach(opt => {
			let [books,weight] = opt.value.split(";");
			const isChecked = (DEVIG === opt.value.split(";")[0] && (WEIGHT || "1") === (opt.value.split(";")[1] || "1"));
			const isFavorite = currentFavorites.has(opt.value);
			const isCustom = (opt.group === "Your Custom Devigs" || opt.group === "Favorites");

			const labels = allLabels[opt.value] || [];

			const labelsHTML = labels.map(label => {
				const devigSport = getSportFromLabel(label);
				const sportClass = devigSport ? ` sport-${devigSport}` : '';	
				return `<span class="devig-label">${parseLabel(label)}</span>`
			}).join('');

			const item = document.createElement('label');
			item.classList.add('devig-radio-item');
			item.id = `devig-label-${opt.value}`;

			let html = "";
			if (opt.group == "100% Weight") {
				item.style.width = "max-content";
				item.style.border = "0";
				item.style.flexDirection = "column";
				html += `
					<input type="radio" name="devig-selection" value="${opt.value}" ${isChecked ? 'checked' : ''}>
					<span style="display:flex;gap:5px;align-items:center;">${opt.name} <img class='book-img' src='logos/${books}.png' alt='${books}' title='${books}' /></span>
				`;
			} else {
				let booksHTML = books.replace("only+", "").split("+").map(book => {
					if (book) {
						return `<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />`
					}
					return "";
				});
				const barHTML = renderWeightBar(books, weight);
				html += `
					<input type="radio" name="devig-selection" value="${opt.value}" ${isChecked ? 'checked' : ''}>
					<div style="display:flex;flex-direction:column;width:80%">
						<div class="devig-selection-container" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
							<div style="display:flex;align-items:center;gap:8px;min-width:0;">
								<span class="devig-name-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
									${escapeHtml(opt.name)}
								</span>

								${isCustom ? `
									<button class="devig-edit-btn"
										data-devig="${opt.value}"
										title="Rename"
										style="background:none;border:none;cursor:pointer;opacity:0.85;font-size:14px;padding:2px 4px;">
										✎
									</button>

									<span class="devig-edit-wrap" style="display:none;align-items:center;gap:6px;">
										<input class="devig-name-input"
											type="text"
											value="${escapeHtml(opt.name)}"
										/>
										<button class="devig-save-btn"
											title="Save"
											style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px 4px;">
											✓
										</button>
										<button class="devig-cancel-btn"
											title="Cancel"
											style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px 4px;">
											✕
										</button>
									</span>
								` : ``}
							</div>

							<!-- <div>${booksHTML.join("")}</div> -->
						</div>
						${barHTML}
				`;

				if (!["Default", "100% Weight"].includes(opt.group)) {
					html += `
					<div class="devig-labels-container">
						${labelsHTML}
						<button class="add-prop-btn" title="Add another prop to this devig" data-devig="${opt.value}">+</button>
					</div>`;

				}

				html += "</div>";
			}

			if (!["Default", "100% Weight"].includes(group)) {
				const starColor = isFavorite ? '#FFD700' : '#ccc';

				html += `
					<button 
						onclick="event.stopPropagation(); toggleFavorite('${opt.value}');" 
						style="position:absolute; right: ${opt.group == "Your Custom Devigs" ? '30px' : '0'}; 
								 background: none; color: ${starColor}; border: none;
								 padding: 4px 8px; cursor: pointer; font-size: 16px; 
								 line-height: 1; z-index: 10;">
						${isFavorite ? '★' : '☆'}
					</button>
				`;
			}

			if (opt.group == "Your Custom Devigs") {
				html += `
					<button 
						onclick="event.stopPropagation(); deleteDevig('${opt.value}')" 
						style="position:absolute;right:0;background-color: #f44336; color: white; border: none; 
								 padding: 4px 8px; cursor: pointer; border-radius: 4px; 
								 font-weight: bold; line-height: 1;">
						&times;
					</button>
				`;
			}
			item.innerHTML = html;

			if (["Your Custom Devigs", "Favorites"].includes(opt.group)) {
				const editBtn = item.querySelector(".devig-edit-btn");
				const editWrap = item.querySelector(".devig-edit-wrap");
				const nameText = item.querySelector(".devig-name-text");
				const input = item.querySelector(".devig-name-input");
				const saveBtn = item.querySelector(".devig-save-btn");
				const cancelBtn = item.querySelector(".devig-cancel-btn");

				const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

				[editBtn, input, saveBtn, cancelBtn].forEach(el => {
					if (!el) return;
					el.addEventListener("click", stop);
					el.addEventListener("mousedown", stop);
				});

				editBtn?.addEventListener("click", () => {
					editBtn.style.display = "none";
					nameText.style.display = "none";
					editWrap.style.display = "inline-flex";
					input.focus();
					input.select();
				});

				cancelBtn?.addEventListener("click", () => {
					input.value = opt.name; // revert
					editWrap.style.display = "none";
					nameText.style.display = "";
					editBtn.style.display = "";
				});

				saveBtn?.addEventListener("click", async () => {
					const newName = input.value.trim();
					await setDevigAlias(opt.value, newName);

					const currentKey = `${DEVIG};${WEIGHT}`;
					if (currentKey === opt.value) {
						devigDisplay.textContent = newName || parseWeightKey(opt.value);
					}

					renderDevigOptions(document.getElementById("devig-search").value);
				});
			}

			item.querySelector('input').addEventListener('change', (event) => {
				const value = event.target.value;
				[DEVIG, WEIGHT] = value.split(";");
				if (!DEVIG.includes("+")) {
					WEIGHT = "1";
				}

				devigDisplay.textContent = opt.name;
				//REQUIRED = DEVIG.split("+");
				REQUIRED = []; // require any by default
				updateRequiredDropdown();
				changeFilter();
				const el = document.getElementById(`devig-btn-${cssSafeId(DEVIG)}`);
				if (el) {
					document.querySelectorAll('.dev-chip').forEach(c => c.classList.toggle('active', c === el));
					el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
				}
				devigModal.style.display = 'none';
			});

			groupContainer.appendChild(item);
		});
		
		devigOptionsContainer.appendChild(groupContainer);
	}

	Array.from(document.querySelectorAll(".add-prop-btn")).map(btn => {
		btn.onclick = function(event) {
			event.stopPropagation();
			renderPropOptions(btn.dataset.devig.replace("only+", ""));
			openPropSelectorModal();
		}
	});
}

const propSelectorModal = document.getElementById('prop-selector-modal');
const propOptionsContainer = document.getElementById('prop-selector-options-container');

function openPropSelectorModal() {
	propSelectorModal.style.display = 'flex';
}

function closePropSelectorModal() {
	propSelectorModal.style.display = 'none';
}

const AVAILABLE_PROPS = {
	nba: [
		"pts", "reb", "ast", "3ptm", "dd", "td", "pa", "pr", "ra", "pra", "stl", "blk", 
		"main", "ml", "props"
	],
	nfl: [
		"attd",
		"main", "props"
	],
	nhl: [
		"atgs", "pts", "ast", "sog", "sv", "bs",
		"main", "ml", "props"
	]
}

async function addPropLabel(sport, devig, prop) {
	const meta = CURR_USER?.metadata || {};
	if (!meta["tags"]) {
		meta["tags"] = {};
	}
	if (!meta["tags"][devig]) {
		meta["tags"][devig] = [];
	}

	if (meta["tags"][devig].includes(`${sport}-${prop}`)) {
		meta["tags"][devig] = meta["tags"][devig].filter(x => x != `${sport}-${prop}`);
	} else {
		meta["tags"][devig].push(`${sport}-${prop}`);
	}

	closePropSelectorModal();
	renderDevigOptions();

	if (!CURR_USER) return;

	const { error: updateError } = await SB.from('profiles')
	.update({
		metadata: meta
	})
	.eq('id', CURR_SESSION.user.id);
}

async function setDevigAlias(devigKey, name) {
	if (!CURR_USER) return;

	if (!CURR_USER.metadata) CURR_USER.metadata = {};
	if (!CURR_USER.metadata["alias"]) CURR_USER.metadata["alias"] = {};

	const trimmed = (name || "").trim();
	if (!trimmed) {
		delete CURR_USER.metadata["alias"][devigKey];
	} else {
		CURR_USER.metadata["alias"][devigKey] = trimmed;
	}

	await SB.from('profiles')
		.update({ metadata: CURR_USER.metadata })
		.eq('id', CURR_SESSION.user.id);
}

function renderPropOptions(devig) {
	const allTags = getAllDevigLabels();
	const tags = allTags[devig] || [];
	const existingTags = new Set(tags);

	document.getElementById("prop-selector-devig").textContent = `Devig: ${parseWeightKey(devig)}`;
	propOptionsContainer.innerHTML = '';

	Object.entries(AVAILABLE_PROPS).forEach(([sport, props]) => {
		let logo = "🏈";
		if (sport == "nhl") logo = "🏒";
		else if (sport == "nba") logo = "🏀";

		const hdr = document.createElement("h3");
		hdr.textContent = `${logo} ${sport.toUpperCase()}`;
		propOptionsContainer.appendChild(hdr);

		const btns = document.createElement("div");
		btns.classList.add("prop-selector-buttons");

		props.forEach(prop => {
			const button = document.createElement('button');
			button.classList.add('prop-select-button');
			button.innerHTML = prop.toUpperCase();

			const fullTagKey = `${sport}-${prop.toLowerCase()}`;
			if (existingTags.has(fullTagKey)) {
				button.classList.add("selected-prop");
			}

			button.onclick = () => addPropLabel(sport, devig, prop);
			btns.appendChild(button);
		});

		propOptionsContainer.appendChild(btns);
	});
}

document.getElementById('devig-button')?.addEventListener('click', () => {
	renderDevigOptions();
	devigModal.style.display = 'flex';
});

function closeDevig() {
	devigModal.style.display = 'none';
}
document.getElementById('close-devig-modal')?.addEventListener('click', () => {
	closeDevig();
});

// Close devig modal when clicking outside of it
document.addEventListener('click', (e) => {
	if (devigModal && devigModal.style.display === 'flex' && 
	    !devigModal.contains(e.target) && !e.target.closest('#devig-button')) {
		closeDevig();
	}
});

// Close devig modal on escape key
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && devigModal && devigModal.style.display === 'flex') {
		closeDevig();
	}
});

// 3. Search Filter
document.getElementById('devig-search')?.addEventListener('input', (event) => {
	renderDevigOptions(event.target.value);
});

// 4. Custom Devig Button
document.getElementById('add-custom-devig')?.addEventListener('click', () => {
	devigModal.style.display = 'none';
	openCustomDevig();
});

if (devigDisplay) {
	let devig = DEVIG;
	if (devig && !devig.includes(";")) {
		devig += repeatOnes(devig);
	}
	devigDisplay.textContent = parseWeightKey(devig);
}

function getSportFromLabel(label) {
	if (["nba-pts", "nba-ast", "reb", "3ptm", "dd"].includes(label)) {
		return "nba";
	} else if (["atgs", "nhl-pts", "nhl-ast", "sog"].includes(label)) {
		return "nhl";
	} else if (["attd"].includes(label)) {
		return "nfl";
	}
}

function getDevigLabels(devig) {
	return ["nba-reb", "nhl-pts", "nba-pts"];
}

function removeOnlyTags(tags) {
	let j = {};
	for (const [key, value] of Object.entries(tags)) {
		j[key.replace("only+", "")] = value;
	}
	return j;
}

function getAllDevigLabels() {
	const meta = CURR_USER?.metadata || {};
	return removeOnlyTags(meta["tags"] || {});
}

function parseLabel(label) {
	let [sport, prop] = label.split("-");
	let sportLogo = "🏈";
	if (sport == "nhl") sportLogo = "🏒";
	else if (sport == "nba") sportLogo = "🏀";
	
	return `${sportLogo} ${prop.toUpperCase()}`;
}

function removeOnlyWeights(arr) {
	let seen = {};
	let newArr = [];	
	for (devig of arr) {
		devig = devig.replace("only+", "");
		if (!seen[devig]) {
			newArr.push(devig);
		}
		seen[devig] = true;
	}
	return newArr;
}

function getCustomDevigs() {
	const meta = CURR_USER?.metadata || {};
	let weights = removeOnlyWeights(meta["weights"] || []);
	return weights;
}

async function setFavoriteDevigs(favorites) {
	const metadata = CURR_USER?.metadata || {};
	metadata["favorites"] = removeOnlyWeights(favorites);

	if (CURR_USER) {
		const { error: updateError } = await SB.from('profiles')
			.update({metadata: metadata})
			.eq('id', CURR_SESSION.user.id);
	}
}

function getFavoriteDevigs() {
	const meta = CURR_USER?.metadata || {};
	let arr = removeOnlyWeights(meta["favorites"] || []);
	return arr;
}

function renderWeightBar(books, weights) {

	if (!books) return "";
	let html = "<div class='book-weight-bar'>";

	const totalWeight = weights.split("+").reduce((sum, w) => sum + parseInt(w), 0);

	if (totalWeight > 0) {
		let idx = 0;
		for (book of books.replace("only+", "").split("+")) {
			const weightValue = weights.split("+")[idx];
			
			if (weightValue === 0) continue;

			const percentage = (weightValue / totalWeight) * 100;
			const bookInfo = book.toUpperCase();

			if (bookInfo) {
				// Only show the label if the segment is wide enough
				const displayLabel = percentage > 10 ? `${bookInfo} ${Math.round(percentage)}%` : '';

				let div = `<div class='book-segment ${bookInfo}' style='width:${percentage}%'>${displayLabel}</div>`;
				html += div;
			}

			idx += 1;
		}
	}
	return html+"</div>";
}

function populateCustomDevigSelect() {
	const devigSelect = document.getElementById("custom-devig-select");
	const customDevigs = getCustomDevigs();
}

let EDITING_ALIAS = null;

function startRenameDevig(key) {
	EDITING_ALIAS = key;
	renderCustomDevigList();
}

function cancelRenameDevig() {
	EDITING_ALIAS = null;
	renderCustomDevigList();
}

async function saveRenameDevig(key) {
	const input = document.getElementById(`devig-rename-input-${cssSafeId(key)}`);
	const name = input ? input.value : "";
	await setDevigDisplayName(key, name);

	EDITING_ALIAS = null;

	// refresh both the delete overlay list + the main devig picker UI
	renderCustomDevigList();
	renderDevigOptions(document.getElementById("devig-search")?.value || "");

	// if they renamed the currently-selected devig, update the header text too
	if (typeof devigDisplay !== "undefined" && devigDisplay && DEVIG) {
		const currentKey = WEIGHT ? `${DEVIG};${WEIGHT}` : `${DEVIG}${repeatOnes(DEVIG)}`;
		devigDisplay.textContent = getDevigDisplayName(currentKey);
	}
}

// tiny helper so keys with + ; etc don’t break element ids
function cssSafeId(s) {
	return String(s).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function renderCustomDevigList() {
	const container = document.getElementById("custom-devig-list-container");
	const devigs = getCustomDevigs();

	if (devigs.length === 0) {
		container.innerHTML = "<p>No custom devig settings found.</p>";
		return;
	}

	container.innerHTML = devigs.map(key => {
		const isEditing = EDITING_ALIAS === key;
		const safe = cssSafeId(key);

		return `
			<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px; border-bottom:1px solid #eee;">
				<div class="devig-name-wrap">
					<span
						style="font-weight:bold; cursor:text;"
						title="Rename devig"
						onclick="startRenameDevig('${key}')"
					>
						${getDevigDisplayName(key)}
					</span>

					<span
						class="devig-edit"
						title="Edit name"
						onclick="startRenameDevig('${key}')"
					>✏️</span>
				</div>

				<button
					onclick="deleteDevig('${key}')"
					title="Delete"
					style="background-color:#f44336; color:white; border:none; padding:4px 8px; cursor:pointer; border-radius:6px; font-weight:bold;"
				>
					&times;
				</button>
			</div>
		`;
	}).join('');
}

async function deleteDevig(keyToDelete) {
	const meta = CURR_USER?.metadata || {};
	const customDevigs = meta["weights"] || [];

	const newDevigs = customDevigs.filter(devig => devig != keyToDelete);
	if (newDevigs.length == customDevigs.length) return;

	if (!CURR_USER) return
	if (!CURR_USER.metadata) CURR_USER.metadata = {};

	CURR_USER.metadata["weights"] = newDevigs;

	const { error: updateError } = await SB.from('profiles')
		.update({
			metadata: CURR_USER.metadata
		})
		.eq('id', CURR_SESSION.user.id);

	document.getElementById(`devig-label-${keyToDelete}`)?.remove();
}

const setOptions = (containerId, options) => {
	CHKDD_STATE[containerId] = options;
	const all = Array.from(document.querySelectorAll(`#${containerId} input`))
	all.forEach(cb => {
		cb.checked = options.includes(cb.value);
	});
};

const getOptions = (containerId) => {
	const all = Array.from(document.querySelectorAll(`#${containerId} input`))
	const checked = all.filter(cb => cb.checked);

	if (checked.length == 0 || checked.length == all.length) {
		return [];
	}

	return checked.map(cb => cb.value);
};

let DEFAULT_COLS = [];
function reorderOddsColumns(book, devig) {

	
	return;


	if (!TABLE) return;

	if (!DEFAULT_COLS.length) {
		DEFAULT_COLS = [...TABLE.getColumnLayout()];
	}

	const devigBooks = devig.split("+");
	const odds = [];
	const [pre, post] = [[], []];
	let seenOdds = false;
	DEFAULT_COLS.forEach(col => {
		if (!col.field || !TABLE.getColumn(col.field)._column.visible) return;

		if (col.field.startsWith("bookOdds.")) {
			seenOdds = true;
			odds.push(col);
		} else if (!seenOdds) {
			pre.push(col);
		} else {
			post.push(col);
		}
	});

	//const bookOdds = odds.filter(x => x.field.split(".").at(-1) === book);
	const bookOdds = [];
	const devigOdds = odds.filter(x => devigBooks.includes(x.field.split(".").at(-1)));
	const rest = odds.filter(x => !devigBooks.includes(x.field.split(".").at(-1)));

	TABLE.setColumnLayout([... new Set([...pre, ...bookOdds, ...devigOdds, ...rest, ...post])]);
	updateHeaders();
}

function changeFilter(render = true) {
	let [w,l,profit,kellyProfit] = [0,0,0,0];
	let devigBook = DEVIG;
	if (devigBook.includes(";")) {
		[devigBook, WEIGHT] = devigBook.split(";");
	}
	let boost = document.getElementById("boost-select").value;
	let book = document.getElementById("book-select").value;
	let ou = document.getElementById("ou-select").value;
	let minOdds = document.getElementById("min-odds").value;
	let maxOdds = document.getElementById("max-odds").value;
	const requiredBooks = getRequiredBooks();
	let props = getOptions("prop-options");
	let games = getOptions("game-options");
	let excluded = [...getExcludedBooks()];
	if (boost === "custom") {
		boost = boostCustom.value;
	}

	BOOK = book;
	OU = ou;
	MIN = minOdds;
	MAX = maxOdds;

	let url = new URL(window.location.href);
	const params = new URLSearchParams(window.location.search);
	params.set("boost", boost);
	params.set("devig", devigBook.replaceAll("+", "-").split(";")[0]);
	params.set("required", requiredBooks.join(","));
	params.set("weight", WEIGHT.replaceAll("+", "-"));
	params.set("game", games.join(","));
	params.set("book", book);
	params.set("prop", props.join(","));
	params.set("ou", ou);
	params.set("min", MIN);
	params.set("max", MAX);

	if (PAGE.includes("main")) {
		params.set("sport", SPORT);
	}

	if (!RES) {
		return;
	}

	const weights = getUserWeights();
	RES.data.forEach(row => {
		const bookOdds = { ...row.bookOdds };
		let avg = getAverageImplied(bookOdds, row.under);
		if (avg == null) {
			row["ev"] = null;
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}
		const comboList = devigBook ? devigBook.split("+").filter(Boolean) : Object.keys(bookOdds);
		const presentBooks = comboList.filter(k => bookOdds[k]).length;
		row["present"] = presentBooks;

		if (requiredBooks.length > 0) {
			const hasAllRequired = requiredBooks.every(book => bookOdds[book]);
			if (!hasAllRequired) {
				row["ev"] = null;
				row["fairVal"] = "";
				row["implied"] = "";
				row["kelly"] = "";
				return;
			}
		}

		let ex = [...excluded];
		ex.push("pn"); ex.push("circa");
		if (devigBook) {
			ex.push(devigBook);
		}
		if (book) {
			ex = ex.filter(b => b !== book);
		}
		const highest = highestOver(bookOdds, ex, boost, book, row.under);
		if (!isFinite(highest.value)) {
			row["ev"] = null;
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}

		let ou = avg.avgAmerican.toString();
		let avgDevig = averageDevigs(bookOdds, highest.book, row.under, weights);

		if (row.player == "ian cole" && row.prop == "atgs" && row.handicap == "0.5" && row.ouIdx == 0) {
			//console.log(row.bookOdds, avgDevig)
		}

		if (!isFinite(avgDevig)) {
			row["ev"] = null;
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}

		let line = highest.value >= 0 ? highest.value : 10000 / Math.abs(highest.value);
		let ev = avgDevig * line + (1 - avgDevig) * -100;
		let fairVal;
		const dec = 1 / avgDevig;
		if (dec >= 2) {
			row["fairVal"] = Math.round((dec - 1) * 100);
		} else {
			row["fairVal"] = Math.round(-100 / (dec - 1));
		}
	
		if (boost == "no-sweat") {
			x = 0.70;
			ev = (100 * (line / 100 + 1)) * avgDevig - 100 + (100 * x);
		}

		row["book"] = highest.book;
		row["line"] = highest.value;
		row["ev"] = ev.toFixed(1);
		row["implied"] = round2(avgDevig * 100);
		row["kelly"] = getKelly(highest.value, ev);

		if (ev >= 0 && row.result != undefined && (!props.length || props.includes(row.prop)) && (OU == "ou" || OU == (row.under ? "u" : "o")) && (!MIN || highest.value >= parseInt(MIN)) && (!MAX || highest.value <= parseInt(MAX))) {
			if (row["hit"]) {
				w += 1;
				let dec = Math.abs(row.line < 0 ? 100 / row.line : row.line / 100);
				profit += dec;
				kellyProfit += dec * parseFloat(row["kelly"]);
			} else {
				l += 1;
				profit -= 1;
				kellyProfit -= parseFloat(row["kelly"]);
			}
		}
	});

	if (PAGE == "analysis") {
		document.getElementById("wins").textContent = w;
		document.getElementById("losses").textContent = l;
		document.getElementById("profit").textContent = profit.toFixed(2);
		document.getElementById("kelly").textContent = kellyProfit.toFixed(2);

		if (!render) {
			return;
		}
	}

	const newUrl = `${window.location.pathname}?${params.toString()}`;
	history.pushState({}, '', newUrl);
	const filters = [];

	if (!["outliers", "atgs2", "dingers2"].includes(PAGE)) {
		filters.push({field: "ev", type: "!=", value: null});
	} else {
		
	}

	TABLE.clearFilter();

	if (filters.length > 0) {
		TABLE.setFilter(filters);
	}

	// Filters
	let filtered = [...RES.data].filter(r => {
		if (OU != "ou") {
			if (r.under !== (OU === "u")) return false;
		}
		if (!["outliers", "atgs2", "dingers2", "analysis"].includes(PAGE) || (PAGE == "analysis" && VIG != "0")) {
			if (r.ev === null) return false;
		}
		if (minOdds && !(r.line > parseInt(minOdds, 10))) return false;
		if (maxOdds && !(r.line < parseInt(maxOdds, 10))) return false;
		if (props.length && !props.includes(r.prop)) return false;
		if (games.length && !games.includes(r.game)) return false;
		return true;
	});

	if (!filtered.length) {
		let t = "No data for this devig. Try adjusting your filters.";
		TABLE.options.placeholder = t;
		TABLE.redraw(true);
	}

	const table = document.getElementById("table");
	const cardContainer = document.getElementById("card-container");
	if (CURRENT_VIEW == "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		initializeCards(filtered);
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
		TABLE.replaceData(filtered);
	}

	if (VIG == "0") {
		TABLE.clearFilter();
		TABLE.hideColumn("ev");
		TABLE.showColumn("outlier");
		TABLE.setSort([{column: "outlier", dir: "desc"}]);
	} else {
		if (TABLE.getSorters().length == 0) {
			TABLE.setSort([{column: "ev", dir: "desc"}]);
		}
	}

	reorderOddsColumns(BOOK, DEVIG);
	updateWeightHeader();

	if (typeof ODDS_HIDDEN !== 'undefined' && ODDS_HIDDEN) {
		TABLE.getColumns().forEach(col => {
			if (col.getField()?.startsWith('bookOdds.')) col.hide();
		});
	}
}