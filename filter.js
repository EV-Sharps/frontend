
function renderBookSelect() {
	let exclude = document.querySelector("#exclude-dd .chkdd-menu");
	let bookSel = document.getElementById("book-select");

	let books = ["fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "fl", "re", "kambi"];

	bookSel.innerHTML = `
		<option value="" selected>All</option>
		${books.map(book => `<option value='${book}'>${book.toUpperCase()}</option>`)};
	`;
	bookSel.value = BOOK || "";
}

function renderFilters() {
	renderBookSelect();
}

function updateHeaders() {
	const weights = getPercentWeights();
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
	boxes = [...dd.querySelectorAll('input[type="checkbox"]')]
}

function getExcludedBooks() {
  return boxes.filter(b => b.checked).map(b => b.value);
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
document.addEventListener('click', (e) => {
	if (menu.style.display === 'block' && !menu.contains(e.target)) closeMenu();
});
boxes.forEach(b => b.addEventListener('change', () => {
  changeFilter();
}));

if (menu) {
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

if (document.getElementById("devig-display-text") && typeof parseWeightKey === 'function') {
	document.getElementById("devig-display-text").innerText = parseWeightKey(`${DEVIG};${WEIGHT}`);
}

if (devigSel) {
	devigSel.addEventListener("change", (event) => {
		if (event.target.value == "custom") {
			openCustomDevig();
		} else if (event.target.value == "delete") {
			openDeleteCustomDevigOverlay();
		} else {
			[DEVIG, WEIGHT] = event.target.value.split(";");
			if (!DEVIG.includes("+")) {
				WEIGHT = "1";
			}
			changeFilter();
		}
	});
}

if (document.getElementById("ou-select")) {
	document.querySelector("#ou-select").value = OU;
	document.querySelector("#ou-select").addEventListener("change", (event) => {
		changeFilter();
	});
}

if (document.getElementById("prop-select")) {
	document.querySelector("#prop-select").value = PROP || "";
	document.querySelector("#prop-select").addEventListener("change", (event) => {
		PROP = event.target.value;
		const params = new URLSearchParams(window.location.search);
		params.set("prop", PROP);
		const newUrl = `${window.location.pathname}?${params.toString()}`;
		history.pushState({}, '', newUrl);
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
		changeFilter();
	});
}

function changeView(view) {
	const cardContainer = document.getElementById("card-container");
	const table = document.getElementById("table");
	if (view === "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		renderCards(RES.data);
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
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
	{ name: "BV", value: "bv;1", group: "100% Weight" },

	{ name: "Only FD/DK 50% Equal", value: "only+fd+dk;1+1", group: "Split Weights" },
	{ name: "PN/Circa 50% Equal", value: "pn+circa;1+1", group: "Split Weights" },
	{ name: "CIRC/PN/FD/DK 25% Equal", value: "circa+pn+fd+dk;1+1+1+1", group: "Split Weights" }
];

const devigModal = document.getElementById('devig-modal');
const devigDisplay = document.getElementById('devig-display-text');
const devigOptionsContainer = document.getElementById('devig-options-container');

// Helper to determine the display name from the value (since we're no longer using <option> text)
function getDevigNameFromValue(value) {
	// Check custom devigs first
	const customDevigs = getCustomDevigs();
	const customMatch = customDevigs.find(key => key === value);
	if (customMatch) return parseWeightKey(customMatch);

	// Check default devigs
	const defaultMatch = DEFAULT_DEVIGS.find(d => d.value === value);
	if (defaultMatch) return defaultMatch.name;

	return "Market Avg"; // Fallback
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
		name: parseWeightKey(key),
		value: key,
		group: "Your Custom Devigs"
	}));

	const currentFavorites = new Set(getFavoriteDevigs());

	const favorites = getFavoriteDevigs().map(key => ({
		name: parseWeightKey(key),
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
					<div style="display:flex;flex-direction:column;width:75%">
						<div class="devig-selection-container">
							${opt.name}
							<div>${booksHTML.join("")}</div>
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

			item.querySelector('input').addEventListener('change', (event) => {
				const value = event.target.value;
				[DEVIG, WEIGHT] = value.split(";");
				if (!DEVIG.includes("+")) {
					WEIGHT = "1";
				}

				devigDisplay.textContent = opt.name;
				changeFilter();
				devigModal.style.display = 'none';
			});

			groupContainer.appendChild(item);
		});
		
		devigOptionsContainer.appendChild(groupContainer);
	}

	Array.from(document.querySelectorAll(".add-prop-btn")).map(btn => {
		btn.onclick = function(event) {
			event.stopPropagation();
			renderPropOptions(btn.dataset.devig);
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
		"pts", "reb", "ast", "3ptm", "dd", "td", "pa", "pr", "ra", "pra",
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

function getAllDevigLabels() {
	const meta = CURR_USER?.metadata || {};
	return meta["tags"] || {};
}

function parseLabel(label) {
	let [sport, prop] = label.split("-");
	let sportLogo = "🏈";
	if (sport == "nhl") sportLogo = "🏒";
	else if (sport == "nba") sportLogo = "🏀";
	
	return `${sportLogo} ${prop.toUpperCase()}`;
}

function getCustomDevigs() {
	const meta = CURR_USER?.metadata || {};
	return meta["weights"] || [];
}

async function setFavoriteDevigs(favorites) {
	const metadata = CURR_USER?.metadata || {};
	metadata["favorites"] = favorites;

	if (CURR_USER) {
		const { error: updateError } = await SB.from('profiles')
			.update({metadata: metadata})
			.eq('id', CURR_SESSION.user.id);
	}
}

function getFavoriteDevigs() {
	const meta = CURR_USER?.metadata || {};
	return meta["favorites"] || [];
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

function openDeleteCustomDevigOverlay() {
	document.getElementById("delete-custom-devig-overlay").style.display = "flex";
	renderCustomDevigList();
	document.getElementById("custom-devig-select").value = "";
}

function closeDeleteCustomDevigOverlay() {
	document.getElementById("delete-custom-devig-overlay").style.display = "none";
	document.getElementById("devig-select").value = DEVIG;
}

function renderCustomDevigList() {
	const container = document.getElementById("custom-devig-list-container");
	const devigs = getCustomDevigs();

	if (devigs.length === 0) {
		container.innerHTML = "<p>No custom devig settings found.</p>";
		return;
	}

	container.innerHTML = devigs.map(key => `
		<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #eee;">
			<span style="font-weight: bold;">${parseWeightKey(key)}</span>
			<button 
				onclick="deleteDevig('${key}')" 
				style="background-color: #f44336; color: white; border: none; 
					   padding: 4px 8px; cursor: pointer; border-radius: 4px; 
					   font-weight: bold; line-height: 1;">
				&times;
			</button>
		</div>
	`).join('');
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

function changeFilter(render = true) {
	let [w,l,profit,kellyProfit] = [0,0,0,0];
	let devigBook = DEVIG;
	if (devigBook.includes(";")) {
		[devigBook, WEIGHT] = devigBook.split(";");
	}
	let boost = document.getElementById("boost-select").value;
	let game = document.getElementById("game-select").value;
	let book = document.getElementById("book-select").value;
	let prop = document.getElementById("prop-select").value;
	let ou = document.getElementById("ou-select").value;
	let minOdds = document.getElementById("min-odds").value;
	let maxOdds = document.getElementById("max-odds").value;
	let excluded = getExcludedBooks();
	if (boost === "custom") {
		boost = boostCustom.value;
	}

	BOOK = book;
	GAME = game;
	OU = ou;
	MIN = minOdds;
	MAX = maxOdds;

	let url = new URL(window.location.href);
	const params = new URLSearchParams(window.location.search);
	params.set("boost", boost);
	params.set("devig", devigBook.replaceAll("+", "-").split(";")[0]);
	params.set("weight", WEIGHT.replaceAll("+", "-"));
	params.set("game", game);
	params.set("book", book);
	params.set("prop", prop);
	params.set("ou", ou);
	params.set("min", MIN);
	params.set("max", MAX);

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
		const isOnlyCombo = devigBook && devigBook.startsWith("only+");
		const comboList = devigBook ? devigBook.replace(/^only\+/, "").split("+").filter(Boolean) : [];
		if (!avg || (isOnlyCombo && comboList.some(k => !bookOdds[k]))) {
			row["ev"] = "";
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}
		const ex = excluded;
		ex.push("pn"); ex.push("circa");
		if (devigBook) {
			ex.push(devigBook);
		}
		const highest = highestOver(bookOdds, ex, boost, book, row.under);
		if (!isFinite(highest.value)) {
			row["ev"] = "";
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}

		let ou = avg.avgAmerican.toString();
		let avgDevig = averageDevigs(bookOdds, highest.book, row.under, weights);

		if (!isFinite(avgDevig)) {
			row["ev"] = "";
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

		if (ev >= 0 && row.result != undefined && (!prop || row.prop == prop) && (OU == "ou" || OU == (row.under ? "u" : "o")) && (!MIN || highest.value >= parseInt(MIN)) && (!MAX || highest.value <= parseInt(MAX))) {
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
	const filters = [
		{field: "ev", type: "!=", value: null}
	];

	let data = CURRENT_VIEW == "mobile" ? [...RES.data] : [];
	TABLE.clearFilter();
	if (game) {
		filters.push({field:"game", type:"=", value: game.replace("-", " @ ")});
		data = data.filter(r => r.game == game.replace("-", " @ "));
	}
	if (prop) {
		filters.push({field:"prop", type:"=", value: prop});
		data = data.filter(r => r.prop == prop);
	}
	if (OU != "ou") {
		filters.push({field: "under", type: "=", value: OU == "u" ? true : false});
		data = data.filter(r => r.under == (OU == "u") ? true : false);
	}
	if (minOdds) {
		filters.push({field: "line", type: ">", value: parseInt(minOdds)})
	}
	if (maxOdds) {
		filters.push({field: "line", type: "<", value: parseInt(maxOdds)})
	}
	if (filters.length > 0) {
		TABLE.setFilter(filters);
	}

	const table = document.getElementById("table");
	const cardContainer = document.getElementById("card-container");
	if (CURRENT_VIEW == "mobile") {
		table.style.display = "none";
		cardContainer.style.display = "grid";
		renderCards(data);
	} else {
		table.style.display = "initial";
		cardContainer.style.display = "none";
		TABLE.replaceData(RES.data);
	}

	if (VIG == "0") {
		TABLE.hideColumn("ev");
		TABLE.showColumn("outlier");
		TABLE.setSort([{column: "outlier", dir: "desc"}]);
	} else {
		if (TABLE.getSorters().length == 0) {
			TABLE.setSort([{column: "ev", dir: "desc"}]);
		}
	}

	updateWeightHeader();
}