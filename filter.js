
// Exclude
const dd = document.getElementById('exclude-dd');
const excludeBtn = dd.querySelector('.chkdd-btn');
let menu = dd.querySelector('.chkdd-menu');
const boxes = [...dd.querySelectorAll('input[type="checkbox"]')];

function getExcludedBooks() {
  return boxes.filter(b => b.checked).map(b => b.value);
}
excludeBtn.addEventListener("click", (e) => {
	//const open = dd.classList.toggle("open");
	//excludeBtn.setAttribute("aria-expanded", open ? true : false);
	e.stopPropagation();
	const open = excludeBtn.getAttribute('aria-expanded') === 'true';
	open ? closeMenu() : openMenu();
});
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
  document.body.appendChild(menu);       // move out of the scroller
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

const debouncedChangeFilter = debounce(changeFilter, 400);
document.getElementById("min-odds").value = MIN;
document.getElementById("min-odds").addEventListener("input", debouncedChangeFilter);
document.getElementById("max-odds").value = MAX;
document.getElementById("max-odds").addEventListener("input", debouncedChangeFilter);

document.querySelector("#devig-select").value = DEVIG || "";
document.querySelector("#devig-select").addEventListener("change", (event) => {
	if (event.target.value == "custom") {
		openCustomDevig();
	} else if (event.target.value == "delete") {
		openDeleteCustomDevigOverlay();
	} else {
		changeFilter();
	}
});

document.querySelector("#ou-select").value = OU;
document.querySelector("#ou-select").addEventListener("change", (event) => {
	changeFilter();
});

document.querySelector("#prop-select").value = PROP || "";
document.querySelector("#prop-select").addEventListener("change", (event) => {
	PROP = event.target.value;
	const params = new URLSearchParams(window.location.search);
	params.set("prop", PROP);
	const newUrl = `${window.location.pathname}?${params.toString()}`;
	history.pushState({}, '', newUrl);
	changeFilter();
});

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

document.querySelector("#book-select").value = BOOK || "";
document.querySelector("#book-select").addEventListener("change", (event) => {
	BOOK = event.target.value;
	changeFilter();
});

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

document.querySelector("#view-select").addEventListener("change", (event) => {
	CURRENT_VIEW = event.target.value;
	changeView(event.target.value);
});

function getCustomDevigs() {
	const meta = CURR_USER?.metadata || {};
	return meta["custom_devigs"] || [];
}

function populateCustomDevigSelect() {
    const devigSelect = document.getElementById("custom-devig-select");
    const customDevigs = getCustomDevigs();
    
    // Clear old options (you need to decide which options are always present)
    // For this example, we'll assume the select is only for custom devigs + 'delete'
    // You'd need to re-add your default options (Market Avg, vs FD, etc.) here.
    
    // Example: Reloading based on what's in local storage
    // *** NOTE: You need to adapt this to your existing code ***
    // For now, we'll skip the actual repopulation of the main devig select.
}


// Function to open the deletion modal
function openDeleteCustomDevigOverlay() {
    // 1. Show the overlay
    document.getElementById("delete-custom-devig-overlay").style.display = "flex";
    
    // 2. Render the list of deletable items
    renderCustomDevigList();
    
    // 3. Reset the main custom select to the default option after triggering
    document.getElementById("custom-devig-select").value = "";
}

// Function to close the deletion modal
function closeDeleteCustomDevigOverlay() {
    document.getElementById("delete-custom-devig-overlay").style.display = "none";
    document.getElementById("devig-select").value = DEVIG;
}

// Function to render the list inside the deletion modal
function renderCustomDevigList() {
    const container = document.getElementById("custom-devig-list-container");
    const devigs = getCustomDevigs();

    if (devigs.length === 0) {
        container.innerHTML = "<p>No custom devig settings found.</p>";
        return;
    }

    container.innerHTML = devigs.map(key => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #eee;">
            <span style="font-weight: bold;">${key}</span>
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

// Function to handle the actual deletion of a custom devig
async function deleteDevig(keyToDelete) {
	const meta = CURR_USER?.metadata || {};
	const customDevigs = meta["custom_devigs"] || [];

	const newDevigs = customDevigs.filter(devig => devig != keyToDelete);
	if (newDevigs.length == customDevigs.length) return;

	if (!CURR_USER) return
	if (!CURR_USER.metadata) CURR_USER.metadata = {};

	CURR_USER.metadata["custom_devigs"] = newDevigs;

	const { error: updateError } = await SB.from('profiles')
		.update({
			metadata: CURR_USER.metadata
		})
		.eq('id', CURR_SESSION.user.id);

	document.querySelector(`option[value='${keyToDelete}']`)?.remove();
	renderCustomDevigList();
}

function changeFilter() {
	let devigBook = document.getElementById("devig-select").value;
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
	if (["custom", "delete"].includes(devigBook)) {
		devigBook = DEVIG;
	}
	DEVIG = devigBook;
	BOOK = book;
	GAME = game;
	OU = ou;
	MIN = minOdds;
	MAX = maxOdds;
	let url = new URL(window.location.href);
	const params = new URLSearchParams(window.location.search);
	params.set("boost", boost);
	params.set("devig", devigBook);
	params.set("game", game);
	params.set("book", book);
	params.set("prop", prop);
	params.set("ou", ou);
	params.set("min", MIN);
	params.set("max", MAX);

	if (!RES) {
		return;
	}

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
		if (row.under) {
			// If under, swap priority
			if (devigBook.includes("+")) {
				// Fallback to averageSharps for unders if combining books
				ou = averageCustomSharps(bookOdds, devigBook, row.under);
			} else if (devigBook) {
				// Use the book's under odds if available
				const val = bookOdds[devigBook];
				ou = val;
				if (val && String(val).includes("/")) {
					let [o,u] = String(val).split("/");
					ou = `${u}/${o}`;
				}
				//ou = val && String(val).includes("/") ? String(val).split("/")[1] : val;
			} else {
				ou = buildOU(bookOdds, row.under);
			}
		} else {
			// Normal over-first logic
			if (devigBook.includes("+")) {
				ou = averageCustomSharps(bookOdds, devigBook);
			} else if (devigBook) {
				ou = bookOdds[devigBook];
			}
		}
		if (!ou) {
			row["ev"] = "";
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}

		let d = devig(ou, highest.value, boost, row.under, VIG);
		if (!d) {
			row["ev"] = "";
			row["fairVal"] = "";
			row["implied"] = "";
			row["kelly"] = "";
			return;
		}
		row["book"] = highest.book;
		row["line"] = highest.value;
		row["ev"] = d.ev;
		row["fairVal"] = d.fairVal;
		row["implied"] = d.implied;
		row["kelly"] = d.kelly;
	});
	const newUrl = `${window.location.pathname}?${params.toString()}`;
	history.pushState({}, '', newUrl);
	const filters = [
		{field: "ev", type: "!=", value: null}
	];

	let data = MOBILE && CURRENT_VIEW == "mobile" ? [...RES.data] : [];
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

	if (MOBILE && CURRENT_VIEW == "mobile") {
		renderCards(data);
	} else {
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
}