
const CHKDD_STATE = {};
const ALL_POSSIBLE_BOOKS = ["circa", "pn", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "hr_az", "bv", "cz", "fl", "br", "re", "kal", "nv", "px", "poly"];

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
		const act = e.target?.dataset?.act; // "all" | "none" | "today" | "attd"
		if (!act) return;

		if (act === "today") {
			const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
			menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
				cb.checked = cb.dataset.date === today;
			});
		} else if (act === "attd") {
			menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
				cb.checked = cb.value === "attd";
			});
		} else {
			const state = act === "all";
			menu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = state);
		}
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
	if (menu.dataset.wired === "1") return; // The menu already handled this event.

	onChkddChange(menu);
});

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
	const dateStr = gameTime ? new Date(gameTime).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "";
	label.innerHTML = `<input type="checkbox" value="${val}" checked data-date="${dateStr}"> ${display}`;
	container.appendChild(label);
};

const populateGameOptions = (games, times, container) => {
	let lastDate = null;
	[...games].sort((a, b) => {
		const ta = new Date(times?.[a]).getTime();
		const tb = new Date(times?.[b]).getTime();
		if (isNaN(ta)) return 1;
		if (isNaN(tb)) return -1;
		return ta - tb;
	}).forEach(p => {
		const t = times?.[p];
		if (t) {
			const dateLabel = new Date(t).toLocaleDateString("en-US", {
				timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric"
			});
			if (dateLabel !== lastDate) {
				const sep = document.createElement('div');
				sep.className = 'chkdd-date-sep';
				sep.textContent = dateLabel;
				container.appendChild(sep);
				lastDate = dateLabel;
			}
		}
		createGameOption(p, t, container);
	});
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
	const rightAligned = MOBILE || CURRENT_VIEW === "mobile";
	menu.style.position = "fixed";
	menu.style.top = `${r.bottom + 6}px`;
	menu.style.left = rightAligned ? 'auto' : `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	menu.style.right = rightAligned ? '8px' : 'auto';
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

function toggleBookOddsColumns() {
	const columns = TABLE.getColumns().filter(col => col.getField()?.startsWith('bookOdds.'));
	const visible = columns.some(col => col.isVisible());
	columns.forEach(col => visible ? col.hide() : col.show());
	syncBookOddsToggle();
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

		if (book == "kal") {
			html += `<a href='https://kalshi.com/r/evdingers' target='_blank' rel='noopener' onclick='event.stopPropagation()' style='position:absolute;bottom:13px;left:0;font-size:10px;color:#9ca3af;text-decoration:none;'>Referral</a>`;
		} else if (book == "px") {
			html += `<a href='https://prophetx.onelink.me/Z8Ks/EV_DINGERS' target='_blank' rel='noopener' onclick='event.stopPropagation()' style='position:absolute;bottom:13px;left:0;font-size:10px;color:#9ca3af;text-decoration:none;'>Referral</a>`;
		}

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
	initKellyToggle();
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

document.getElementById('overlay')?.addEventListener('change', event => {
	const checkbox = event.target;
	if (checkbox.matches('input[type="checkbox"]')) {
		const field = checkbox.id.replace(/^custom_/, "").replace("bookOdds_", "bookOdds.").replace("savant_", "savant.").replace("batter_percs_", "batter_percs.").replace("percs_", "percs.").replace("pitcherData_", "pitcherData.").replace("homerLogs_pa_", "homerLogs.pa.").replace("hitRates_", "hitRates.");;
		if (checkbox.checked) {
			TABLE.getColumn(field)?.show();
		} else {
			TABLE.getColumn(field)?.hide();
		}
	}
});

function openMenu() {
	const r = excludeBtn.getBoundingClientRect();
	const rightAligned = MOBILE || CURRENT_VIEW === "mobile";
	menu.style.position = 'fixed';
	menu.style.top = `${r.bottom + 6}px`;
	menu.style.left = rightAligned ? 'auto' : `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	menu.style.right = rightAligned ? '8px' : 'auto';
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
  e?.stopPropagation();
  const panel = document.getElementById("range-panel");
  if (!panel) return;
  const hidden = panel.classList.toggle("hidden");
  document.getElementById("range-btn")?.setAttribute("aria-expanded", String(!hidden));
}

function closeRange() {
  document.getElementById("range-panel")?.classList.add("hidden");
  document.getElementById("range-btn")?.setAttribute("aria-expanded", "false");
}

const rangeButton = document.getElementById("range-btn");
rangeButton?.setAttribute("aria-controls", "range-panel");
rangeButton?.setAttribute("aria-expanded", "false");
// Capture also catches other dropdown buttons that stop click propagation.
document.addEventListener("click", event => {
  const panel = document.getElementById("range-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (!panel.contains(event.target) && !rangeButton?.contains(event.target)) closeRange();
}, true);
document.addEventListener("keydown", event => {
  const panel = document.getElementById("range-panel");
  if (event.key !== "Escape" || !panel || panel.classList.contains("hidden")) return;
  closeRange();
  rangeButton?.focus({ preventScroll: true });
});

function applyRange() {
  const min = document.getElementById("range-min").value;
  const max = document.getElementById("range-max").value;

  document.getElementById("min-odds").value = min;
  document.getElementById("max-odds").value = max;

  updateRangeLabel(min, max);
  closeRange();

  changeFilter();
}

function clearRange() {
  document.getElementById("range-min").value = "";
  document.getElementById("range-max").value = "";
  document.getElementById("min-odds").value = "";
  document.getElementById("max-odds").value = "";

  updateRangeLabel();
  closeRange();

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

if (document.getElementById("filterbuilder-dd")) {
	// Close the custom filter dropdown when clicking elsewhere
	document.addEventListener('click', (e) => {
		const filterBtn = document.getElementById("filterbuilder-dd-button");
		const filterMenu = document.getElementById("filterbuilder-options");

		if (filterMenu && filterMenu.style.display === 'block' &&
		    !filterMenu.contains(e.target) && !filterBtn.contains(e.target)) {
			filterMenu.style.display = "none";
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
			DEVIG_EXCLUDED = [];
			if (!DEVIG.includes("+")) {
				WEIGHT = "1";
			}
			REQUIRED = DEVIG.replace("only+", "").split("+").filter(Boolean);
			updateRequiredDropdown();
			changeFilter();
		}
	});
}

function updateRequiredLabel(requiredBooks) {
	const button = document.getElementById("required-button");
	if (!button) return;
	const available = getDevigReferenceBooks().filter(book => !DEVIG_EXCLUDED.includes(book));
	let label = requiredBooks.length === 0 ? "Any" : `${requiredBooks.length} required`;
	if (available.length && requiredBooks.length === available.length) label = "All";
	if (!available.length) label = "None";
	button.replaceChildren(document.createTextNode(label));
	if (DEVIG_EXCLUDED.length) {
		const excluded = document.createElement("span");
		excluded.className = "devig-excluded-count";
		excluded.textContent = `${DEVIG_EXCLUDED.length} excluded`;
		button.appendChild(excluded);
	}
	button.title = `Required: ${requiredBooks.map(parseBook).join(", ") || "None"}. Excluded from devig: ${DEVIG_EXCLUDED.map(parseBook).join(", ") || "None"}.`;
}

function getRequiredBooks() {
	const menu = document.getElementById("required-options");
	if (!menu) return [];
	
	return Array.from(menu.querySelectorAll('input[data-book][value="required"]:checked'))
		.map(input => input.dataset.book);
}

function updateRequiredDropdown() {
	const menu = document.getElementById("required-options");
	if (!menu) return;
	
	const devigBooks = getDevigReferenceBooks();
	DEVIG_EXCLUDED = DEVIG_EXCLUDED.filter(book => devigBooks.includes(book));
	REQUIRED = (Array.isArray(REQUIRED) ? REQUIRED : String(REQUIRED || "").split(","))
		.filter(book => devigBooks.includes(book) && !DEVIG_EXCLUDED.includes(book));
	const label = document.querySelector('label[for="required-button"]');
	if (label) label.textContent = "Devig books";
	menu.innerHTML = `
		<div class="devig-reference-header">
			<div class="chkdd-actions">
				<button type="button" data-act="all" title="Require every included book">All</button>
				<button type="button" data-act="any" title="Use any included book when available">Any</button>
				<button type="button" data-act="reset" title="Clear requirements and exclusions">Reset</button>
			</div>
			<p id="devig-reference-help"><b>Use</b> if priced &middot; <b>Req</b> must be priced<br><b>Excl</b> ignore &middot; All / Any keep exclusions</p>
		</div>
	`;
	const saveSelection = () => {
		const selections = [...menu.querySelectorAll("input[data-book]:checked")];
		REQUIRED = getRequiredBooks();
		DEVIG_EXCLUDED = selections.filter(input => input.value === "excluded").map(input => input.dataset.book);
		selections.forEach(input => input.closest(".devig-reference-row").dataset.state = input.value);
		updateRequiredLabel(REQUIRED);
		const empty = !selections.some(input => input.value !== "excluded");
		menu.querySelector(".devig-reference-empty").hidden = !empty;
		debouncedChangeFilter();
	};

	devigBooks.forEach(book => {
		const row = document.createElement("div");
		row.className = "devig-reference-row";
		row.dataset.book = book;
		row.dataset.state = DEVIG_EXCLUDED.includes(book) ? "excluded" : REQUIRED.includes(book) ? "required" : "optional";
		const name = document.createElement("span");
		name.className = "devig-reference-name";
		const logo = document.createElement("img");
		logo.className = "book-img";
		logo.src = `logos/${book.replace(/^hr_(az|oh)$/, "hr")}.png`;
		logo.alt = "";
		name.append(logo, document.createTextNode(parseBook(book)));
		const choices = document.createElement("div");
		choices.className = "devig-reference-choices";
		choices.setAttribute("role", "radiogroup");
		choices.setAttribute("aria-label", `${parseBook(book)} devig reference`);
		choices.setAttribute("aria-describedby", "devig-reference-help");
		[["optional", "Use", "Use if available"], ["required", "Req", "Required"], ["excluded", "Excl", "Excluded"]].forEach(([value, text, description]) => {
			const choice = document.createElement("label");
			choice.className = "devig-reference-choice";
			choice.title = description;
			const input = document.createElement("input");
			input.type = "radio";
			input.name = `devig-reference-${book}`;
			input.dataset.book = book;
			input.value = value;
			input.checked = row.dataset.state === value;
			input.setAttribute("aria-label", description);
			input.addEventListener("change", saveSelection);
			const caption = document.createElement("span");
			caption.textContent = text;
			choice.append(input, caption);
			choices.appendChild(choice);
		});
		row.append(name, choices);
		menu.appendChild(row);
	});
	const empty = document.createElement("p");
	empty.className = "devig-reference-empty";
	empty.setAttribute("role", "status");
	empty.textContent = "All reference books are excluded. Include a book to calculate EV.";
	empty.hidden = devigBooks.some(book => !DEVIG_EXCLUDED.includes(book));
	menu.appendChild(empty);

	menu.querySelectorAll(".chkdd-actions button").forEach(button => {
		button.addEventListener("click", () => {
			const action = button.dataset.act;
			menu.querySelectorAll(".devig-reference-row").forEach(row => {
				if (action !== "reset" && row.dataset.state === "excluded") return;
				row.querySelector(`input[value="${action === "all" ? "required" : "optional"}"]`).checked = true;
			});
			saveSelection();
		});
	});
	updateRequiredLabel(REQUIRED);
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
		syncBookPicker();
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
	CURRENT_VIEW = view;
	document.querySelectorAll('#custom-view-select, #header-view-select').forEach(select => { select.value = view; });
	applyOddsTableView();
	const cardContainer = document.getElementById("card-container");
	const table = document.getElementById("table");
	const playerFilter = document.querySelector(".filter-wrapper");
	if (view === "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		playerFilter.style.display = "flex";
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
		playerFilter.style.display = "none";
	}
	// Both views must use the active filters, not the unfiltered API response.
	// Reuse the existing table so switching back also preserves its settings.
	if (RES && TABLE) return changeFilter();
}

if (document.getElementById("custom-view-select")) {
	const customViewSelect = document.getElementById('custom-view-select');
	const header = document.getElementById('header');
	const viewSelects = [customViewSelect];
	if (header && !header.contains(customViewSelect)) {
		const control = document.createElement('div');
		control.id = 'view-toggle-container';
		control.innerHTML = `<div class="select-wrapper">
			<label for="header-view-select" class="select-label">View</label>
			<select id="header-view-select">${customViewSelect.innerHTML}</select>
			<svg class="select-arrow" viewBox="0 0 20 20"><path d="M7 7l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
		</div>`;
		header.appendChild(control);
		viewSelects.push(control.querySelector('select'));
	}
	const selectView = (event) => {
		CURRENT_VIEW = event.target.value;
		try { localStorage.setItem('odds-view', CURRENT_VIEW); } catch (e) {}
		const params = new URLSearchParams(window.location.search);
		params.set("view", CURRENT_VIEW);
		const newUrl = `${window.location.pathname}?${params.toString()}`;
		history.pushState({}, '', newUrl);
		changeView(event.target.value);
	};
	viewSelects.forEach(select => {
		select.value = CURRENT_VIEW;
		select.addEventListener('change', selectView);
	});
}

if (supportsOddsViews() && typeof tableReady !== 'undefined') {
	tableReady.then(() => initializeOddsTableView(TABLE));
}

const DEFAULT_DEVIGS = [
	{ name: "FD", value: "fd;1", group: "100% Weight" },
	{ name: "DK", value: "dk;1", group: "100% Weight" },
	{ name: "PN", value: "pn;1", group: "100% Weight" },
	{ name: "Circa", value: "circa;1", group: "100% Weight" },
	{ name: "ESPN", value: "espn;1", group: "100% Weight" },
	{ name: "HR", value: "hr;1", group: "100% Weight" },
	{ name: "CZ", value: "cz;1", group: "100% Weight" },
	{ name: "MGM", value: "mgm;1", group: "100% Weight" },
	{ name: "BOL", value: "bol;1", group: "100% Weight" },
	{ name: "B365", value: "b365;1", group: "100% Weight" },
	{ name: "BV", value: "bv;1", group: "100% Weight" },
	{ name: "KAL", value: "kal;1", group: "100% Weight" },
	{ name: "NV", value: "nv;1", group: "100% Weight" },
	{ name: "PX", value: "px;1", group: "100% Weight" },

	{ name: "FD/DK 50% Equal", value: "fd+dk;1+1", group: "Split Weights" },
	{ name: "PN/Circa 50% Equal", value: "pn+circa;1+1", group: "Split Weights" },
	{ name: "ESPN/HR 50% Equal", value: "espn+hr;1+1", group: "Split Weights" },
	{ name: "CIRC/PN/FD/DK 25% Equal", value: "circa+pn+fd+dk;1+1+1+1", group: "Split Weights" },
	{ name: "CIRC/NV/PN 33% Equal", value: "circa+nv+pn;1+1+1", group: "Split Weights" }
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

const MAX_FAVORITES = 15;

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

let devigWindowCategory = "all";

function initDevigWindow() {
	if (!devigModal || devigModal.classList.contains("devig-window")) return;
	const panel = devigModal.querySelector(".devig-panel");
	const header = panel?.querySelector(".modal-header");
	const search = document.getElementById("devig-search");
	const method = devigModal.querySelector("#method-select")?.closest(".select-wrapper");
	const footer = panel?.querySelector(".action-footer");
	if (!panel || !header || !search || !footer) return;
	devigModal.classList.add("devig-window");
	devigModal.setAttribute("role", "dialog");
	devigModal.setAttribute("aria-modal", "true");
	devigModal.setAttribute("aria-labelledby", "devig-window-title");
	const title = header.querySelector("h3");
	const heading = document.createElement("div");
	if (title) { title.id = "devig-window-title"; title.textContent = "Devig reference"; heading.appendChild(title); }
	const subtitle = document.createElement("p");
	subtitle.className = "dv-subtitle";
	subtitle.textContent = "Choose the books behind your fair odds.";
	heading.appendChild(subtitle);
	header.prepend(heading);
	const close = document.getElementById("close-devig-modal");
	close?.setAttribute("aria-label", "Close devig window");
	if (close) close.type = "button";
	const oldControls = search.parentElement;
	const toolbar = document.createElement("div");
	toolbar.className = "dv-toolbar";
	if (method) toolbar.appendChild(method);
	const current = document.createElement("div");
	current.className = "dv-current";
	current.innerHTML = '<span>Active</span><strong></strong>';
	toolbar.appendChild(current);
	header.after(toolbar);
	const tabs = document.createElement("div");
	tabs.className = "dv-tabs";
	tabs.setAttribute("role", "group");
	tabs.setAttribute("aria-label", "Devig presets");
	for (const [key, name] of [["all", "All"], ["favorites", "Favorites"], ["custom", "Custom"], ["single", "Single books"], ["blends", "Blends"]]) {
		const button = document.createElement("button");
		button.type = "button"; button.className = "dv-tab"; button.dataset.category = key;
		button.textContent = name;
		button.addEventListener("click", () => { devigWindowCategory = key; renderDevigOptions(search.value); });
		tabs.appendChild(button);
	}
	toolbar.after(tabs);
	footer.classList.add("dv-footer");
	const searchWrap = document.createElement("div");
	searchWrap.className = "dv-search-wrap";
	search.type = "search"; search.placeholder = "Search books or weights";
	search.setAttribute("aria-label", "Search devig books, weights or tags");
	search.autocomplete = "off";
	searchWrap.appendChild(search); footer.prepend(searchWrap);
	footer.querySelectorAll("button").forEach(button => {
		button.type = "button";
		if (button.id === "add-custom-devig") button.textContent = "+ Custom mix";
		else if (button.id !== "load-predefined-devigs") button.remove();
	});
	if (oldControls !== panel && oldControls !== footer && !oldControls.children.length) oldControls.remove();
	devigModal.addEventListener("click", event => { if (event.target === devigModal) closeDevig(); });
	devigModal.addEventListener("keydown", event => {
		if (event.key !== "Tab") return;
		const controls = [...panel.querySelectorAll('button, input, select, a[href], [tabindex="0"]')]
			.filter(el => !el.disabled && el.getClientRects().length);
		const first = controls[0], last = controls[controls.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
	});
}

function devigBookWeights(value) {
	const [bookKey, weightKey = ""] = value.split(";");
	const books = bookKey.replace(/^only\+/, "").split("+").filter(Boolean);
	const weights = weightKey.split("+");
	const values = books.map((book, index) => {
		const weight = weights[index] == null || weights[index] === "" ? 1 : Number(weights[index]);
		return { book, weight: Number.isFinite(weight) && weight > 0 ? weight : 0 };
	});
	const total = values.reduce((sum, item) => sum + item.weight, 0);
	return values.map(item => ({ ...item, percent: total ? Math.round(item.weight * 100 / total) : 0 }));
}

function renderDevigOptions(searchTerm = "") {
	if (!devigOptionsContainer) return;
	initDevigWindow();
	const customKeys = new Set(getCustomDevigs());
	const favoriteKeys = getFavoriteDevigs();
	const favorites = new Set(favoriteKeys);
	const aliases = getDevigAlias();
	const allLabels = getAllDevigLabels();
	const options = new Map([["", { value: "", name: "Market Avg", group: "Default" }]]);
	DEFAULT_DEVIGS.forEach(option => options.set(option.value, { ...option,
		name: option.group === "100% Weight" ? parseBook(option.value.split(";")[0]) : option.name }));
	[...customKeys, ...favoriteKeys].forEach(value => {
		const preset = options.get(value);
		options.set(value, preset || { value, name: getDevigDisplayName(value), group: "Your Custom Devigs" });
	});
	const currentKey = DEVIG ? `${DEVIG.replace(/^only\+/, "")};${WEIGHT || DEVIG.replace(/^only\+/, "").split("+").map(() => "1").join("+")}` : "";
	const currentName = aliases[currentKey] || options.get(currentKey)?.name || getDevigDisplayName(currentKey);
	const current = devigModal.querySelector(".dv-current strong");
	if (current) { current.textContent = currentName; current.title = currentName; }
	devigModal.querySelectorAll(".dv-tab").forEach(tab => tab.setAttribute("aria-pressed", String(tab.dataset.category === devigWindowCategory)));
	const words = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
	const groups = new Map(["Default", "Favorites", "Your Custom Devigs", "100% Weight", "Split Weights"].map(name => [name, []]));
	for (const option of options.values()) {
		const parts = devigBookWeights(option.value);
		const custom = customKeys.has(option.value);
		const favorite = favorites.has(option.value);
		if (devigWindowCategory === "favorites" && !favorite || devigWindowCategory === "custom" && !custom
			|| devigWindowCategory === "single" && parts.length !== 1 || devigWindowCategory === "blends" && parts.length < 2) continue;
		const name = aliases[option.value] || option.name;
		const labels = allLabels[option.value] || [];
		const terms = `${name} ${option.value} ${labels.join(" ")} ${parts.map(part => `${parseBook(part.book)} ${part.percent}%`).join(" ")}`.toLowerCase();
		if (!words.every(word => terms.includes(word))) continue;
		const group = ["all", "favorites"].includes(devigWindowCategory) && favorite ? "Favorites" : custom ? "Your Custom Devigs" : option.group;
		groups.get(group).push({ ...option, name, parts, labels, custom, favorite });
	}
	if (devigWindowCategory === "all" || devigWindowCategory === "favorites") {
		groups.get("Favorites").sort((a, b) => favoriteKeys.indexOf(a.value) - favoriteKeys.indexOf(b.value));
	}
	devigOptionsContainer.replaceChildren();
	let index = 0;
	for (const [group, entries] of groups) {
		if (!entries.length) continue;
		const heading = document.createElement("h4");
		heading.className = "devig-group-header";
		heading.textContent = ({ Default: "Market", "Your Custom Devigs": "Custom mixes", "100% Weight": "Single books", "Split Weights": "Blends" }[group] || group) + ` (${entries.length})`;
		devigOptionsContainer.appendChild(heading);
		const container = document.createElement("div");
		container.className = `devig-group-container${group === "100% Weight" ? " dv-single-books" : ""}`;
		for (const option of entries) {
			const item = document.createElement("div");
			item.className = `devig-radio-item${option.value === currentKey ? " is-selected" : ""}`;
			item.id = `devig-label-${option.value}`; item.dataset.value = option.value;
			const id = `devig-choice-${index++}`;
			const weights = option.parts.filter(part => part.weight > 0).map(part => `<span class="dv-book-weight" title="${escapeHtml(parseBook(part.book))}: ${part.percent}%"><img class="book-img" src="logos/${encodeURIComponent(part.book)}.png" alt="${escapeHtml(parseBook(part.book))}"><span>${part.percent}%</span></span>`).join("");
			const labels = option.labels.map(label => `<span class="devig-label">${escapeHtml(parseLabel(label))}</span>`).join("");
			item.innerHTML = `<label class="dv-option-main" for="${id}"><input id="${id}" type="radio" name="devig-selection" value="${escapeHtml(option.value)}"${option.value === currentKey ? " checked" : ""}><div class="dv-option-info"><span class="devig-name-text" title="${escapeHtml(option.name)}">${escapeHtml(option.name)}</span>${weights ? `<div class="dv-book-weights">${weights}</div>` : '<div class="dv-market-copy">Equal weight across eligible books</div>'}${labels ? `<div class="devig-labels-container">${labels}</div>` : ""}</div></label><div class="dv-option-actions"></div>`;
			const actions = item.querySelector(".dv-option-actions");
			function addAction(className, title, icon, handler) {
				const button = document.createElement("button");
				button.type = "button"; button.className = className; button.dataset.devig = option.value;
				button.title = title; button.setAttribute("aria-label", `${title}: ${option.name}`); button.innerHTML = icon;
				button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); handler(button); });
				actions.appendChild(button); return button;
			}
			const star = addAction("dv-favorite-btn", option.favorite ? "Remove favorite" : "Add favorite", option.favorite ? "&#9733;" : "&#9734;", () => {
				const scroll = devigOptionsContainer.scrollTop;
				toggleFavorite(option.value);
				devigOptionsContainer.scrollTop = scroll;
				const updated = document.getElementById(`devig-label-${option.value}`)?.querySelector(".dv-favorite-btn");
				(updated || devigModal.querySelector('.dv-tab[aria-pressed="true"]'))?.focus({ preventScroll: true });
			});
			star.setAttribute("aria-pressed", String(option.favorite));
			if (option.custom || option.favorite) {
				const editor = document.createElement("div"); editor.className = "devig-edit-wrap"; editor.hidden = true;
				editor.innerHTML = `<input class="devig-name-input" type="text" value="${escapeHtml(option.name)}" aria-label="Devig name"><button type="button" class="devig-save-btn">Save</button><button type="button" class="devig-cancel-btn">Cancel</button>`;
				item.appendChild(editor);
				const input = editor.querySelector("input");
				const edit = addAction("devig-edit-btn", "Rename", "&#9998;", () => { editor.hidden = false; input.focus(); input.select(); });
				const cancel = () => { editor.hidden = true; input.value = option.name; edit.focus(); };
				const save = async () => {
					await setDevigAlias(option.value, input.value.trim());
					if (currentKey === option.value && devigDisplay) devigDisplay.textContent = getDevigAlias()[option.value] || option.name;
					renderDevigOptions(document.getElementById("devig-search").value);
					document.getElementById(`devig-label-${option.value}`)?.querySelector(".devig-edit-btn")?.focus();
				};
				editor.querySelector(".devig-save-btn").addEventListener("click", save);
				editor.querySelector(".devig-cancel-btn").addEventListener("click", cancel);
				editor.addEventListener("keydown", event => {
					if (event.key === "Enter") { event.preventDefault(); save(); }
					if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
				});
			}
			if (option.parts.length > 1 || option.custom || option.favorite) addAction("add-prop-btn", "Prop tags", "+", () => {
				renderPropOptions(option.value.replace("only+", "")); openPropSelectorModal();
			});
			if (option.custom && !option.favorite) addAction("dv-delete-btn", "Delete custom mix", "&times;", async () => {
				await deleteDevig(option.value); renderDevigOptions(document.getElementById("devig-search").value);
			});
			item.querySelector('input[type="radio"]').addEventListener("change", () => {
				[DEVIG, WEIGHT] = option.value.split(";");
				DEVIG_EXCLUDED = [];
				if (!DEVIG.includes("+")) WEIGHT = "1";
				if (devigDisplay) devigDisplay.textContent = option.name;
				REQUIRED = DEVIG.replace("only+", "").split("+").filter(Boolean);
				updateRequiredDropdown(); changeFilter();
				const chip = document.getElementById(`devig-btn-${cssSafeId(DEVIG)}`);
				if (chip) {
					document.querySelectorAll(".dev-chip").forEach(el => el.classList.toggle("active", el === chip));
					chip.scrollIntoView({ inline: "nearest", block: "nearest" });
				}
				closeDevig();
			});
			container.appendChild(item);
		}
		devigOptionsContainer.appendChild(container);
	}
	if (!index) {
		const empty = document.createElement("div"); empty.className = "dv-empty";
		empty.textContent = words.length ? "No matching devigs. Try a book, percentage or prop tag."
			: devigWindowCategory === "favorites" ? "Star a devig to keep it here." : devigWindowCategory === "custom" ? "Create a custom mix to choose your own book weights." : "No devigs in this category.";
		devigOptionsContainer.appendChild(empty);
	}
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
		"attd", "ftd", "ltd",
		"main", "props"
	],
	nhl: [
		"atgs", "fgs", "lgs", "pts", "ast", "sog", "sv", "bs",
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
	if (!devigModal) return;
	devigWindowCategory = "all";
	const search = document.getElementById("devig-search");
	if (search) search.value = "";
	renderDevigOptions();
	devigModal.style.display = 'flex';
	document.getElementById("close-devig-modal")?.focus({ preventScroll: true });
});

function closeDevig() {
	if (!devigModal) return;
	devigModal.style.display = 'none';
	document.getElementById("devig-button")?.focus({ preventScroll: true });
}
document.getElementById('close-devig-modal')?.addEventListener('click', () => {
	closeDevig();
});

// Backdrop clicks are handled by the window; sibling dialogs keep their own clicks.
document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape' || !devigModal || devigModal.style.display !== 'flex') return;
	if (propSelectorModal?.style.display === 'flex') closePropSelectorModal();
	else closeDevig();
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
	} else if (["atgs", "fgs", "lgs", "nhl-pts", "nhl-ast", "sog"].includes(label)) {
		return "nhl";
	} else if (["attd", "ftd", "ltd"].includes(label)) {
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

let lastRenderedBookDevig;

function changeFilter(render = true) {
	let renderComplete;
	let [w,l,profit,kellyProfit] = [0,0,0,0];
	let devigBook = DEVIG;
	if (devigBook.includes(";")) {
		[devigBook, WEIGHT] = devigBook.split(";");
	}
	let boost = document.getElementById("boost-select").value;
	let book = document.getElementById("book-select").value;
	const selectedBooks = parseBookFilter(book);
	syncBookPicker();
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
	if (DEVIG_EXCLUDED.length) params.set("devig_excluded", DEVIG_EXCLUDED.join(","));
	else params.delete("devig_excluded");
	params.set("weight", WEIGHT.replaceAll("+", "-"));
	params.set("game", games.join(","));
	params.set("book", book);
	params.set("prop", props.join(","));
	params.set("ou", ou);
	params.set("min", MIN);
	params.set("max", MAX);

	if (PAGE.includes("main") || PAGE === "live") {
		params.set("sport", SPORT);
	}

	if (!RES) {
		return;
	}

	const weights = getUserWeights();
	const referenceBooks = getDevigReferenceBooks().filter(book => !DEVIG_EXCLUDED.includes(book));
	RES.data.forEach(row => {
		const bookOdds = { ...row.bookOdds };
		let avg = getAverageImplied(bookOdds, row.under);
		if (avg == null) {
			row["ev"] = null;
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			row["book"] = null;
			row["line"] = null;
			return;
		}
		const presentBooks = referenceBooks.filter(k => bookOdds[k]).length;
		row["present"] = presentBooks;

		if (requiredBooks.length > 0) {
			const hasAllRequired = requiredBooks.every(book => bookOdds[book]);
			if (!hasAllRequired) {
				row["ev"] = null;
				row["fairVal"] = "";
				row["implied"] = "";
				row["kelly"] = "";
				row["book"] = null;
				row["line"] = null;
				return;
			}
		}

		let ex = [...excluded];
		ex.push("pn"); ex.push("circa");
		if (devigBook) {
			ex.push(devigBook);
		}
		if (book) {
			ex = ex.filter(b => !selectedBooks.includes(b));
		}
		const highest = highestOver(bookOdds, ex, boost, book, row.under, row);
		if (!isFinite(highest.value)) {
			row["ev"] = null;
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			row["book"] = null;
			row["line"] = null;
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
			row["book"] = null;
			row["line"] = null;
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
	// changeFilter() now also runs on charts/dingers/dingers2's 30s auto-refresh
	// (to reapply the selected devig after renderTable() rebuilds the table),
	// not just on user-driven filter changes - skip the push when nothing
	// actually changed so that timer doesn't spam browser history.
	if (newUrl !== `${window.location.pathname}${window.location.search}`) {
		history.pushState({}, '', newUrl);
	}
	const filters = [];

	if (!["outliers", "atgs2", "dingers2", "tds2"].includes(PAGE)) {
		filters.push({field: "ev", type: "!=", value: null});
	} else {
		
	}

	TABLE.clearFilter();

	if (filters.length > 0) {
		TABLE.setFilter(filters);
	}

	// Filters
	let filtered = [...RES.data].filter(r => {
		if (selectedBooks.length && !selectedBooks.some(book => r.bookOdds?.[book])) return false;
		if (OU != "ou") {
			if (r.under !== (OU === "u")) return false;
		}
		if (!["outliers", "atgs2", "dingers2", "tds2", "analysis"].includes(PAGE) || (PAGE == "analysis" && VIG != "0")) {
			if (r.ev === null) return false;
		}
		if (minOdds && !(r.line > parseInt(minOdds, 10))) return false;
		if (maxOdds && !(r.line < parseInt(maxOdds, 10))) return false;
		if (props.length && !props.includes(r.prop)) return false;
		if (games.length && !games.includes(r.game)) return false;
		if (typeof passesFilterBuilder === "function" && !passesFilterBuilder(r)) return false;
		return true;
	});

	if (!filtered.length) {
		let t = "No data for this devig. Adjust Devig books or your filters.";
		TABLE.options.placeholder = t;
		TABLE.redraw(true);
	}

	const table = document.getElementById("table");
	const cardContainer = document.getElementById("card-container");
	// Compare applied selections so chips, dropdowns, and preloads behave alike.
	const bookDevig = JSON.stringify([book, DEVIG, WEIGHT]);
	const resetScroll = lastRenderedBookDevig !== undefined && lastRenderedBookDevig !== bookDevig;
	lastRenderedBookDevig = bookDevig;
	if (CURRENT_VIEW == "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		initializeCards(filtered);
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
		// Let Tabulator reset its virtual rows along with the scroll position.
		// replaceData preserves the previous row window for background refreshes.
		const update = resetScroll ? TABLE.setData(filtered) : TABLE.replaceData(filtered);
		renderComplete = update.then(() => {
			if (typeof restoreSelectedRow === 'function') restoreSelectedRow();
		});
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
	initKellyToggle();

	if (typeof ODDS_HIDDEN !== 'undefined' && ODDS_HIDDEN) {
		TABLE.getColumns().forEach(col => {
			if (col.getField()?.startsWith('bookOdds.')) col.hide();
		});
	}
	return Promise.resolve(renderComplete).then(() => {
		if (!resetScroll || lastRenderedBookDevig !== bookDevig) return;
		// The table reset is handled by setData; cards use their DOM scroller.
		if (CURRENT_VIEW === "mobile") {
			cardContainer.scrollTop = 0;
		}
		const container = document.getElementById('table-container');
		if (container) container.scrollTop = 0;
	});
}
