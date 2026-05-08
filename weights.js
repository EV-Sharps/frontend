
const ALL_WEIGHTABLE_BOOKS = ["circa", "pn", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "hr_az", "hr_oh", "bv", "cz", "fl", "br", "re", "kal", "nv", "poly", "px"];
let DEV_WINDOW = "All";
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
	if (!DEVIG) {
		return getDefaultWeights();
	}
	DEVIG.split("+").map((book, idx) => {
		weights[book] = parseFloat(WEIGHT.split("+")[idx]);
	});
	return weights;
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
	WEIGHT = weightKey;
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
	if (typeof RECORD === "undefined" || !RECORD) {
		return { error: "RECORD not available" };
	}
	const list = [];
	const books = RECORD[METHOD || "worst"];
	if (!books) return list;
	for (const book in books) {
		if (bookArg && book !== bookArg) continue;
		const devigs = books[book];
		if (!devigs) continue;
		for (const devigKey in devigs) {
			let stats = devigs[devigKey][DEV_WINDOW] || devigs[devigKey]["All"];
			if (!stats) continue;
			const parts = devigKey.split("-vs-");
			const prop = parts[0] || devigKey;
			
			if (PAGE == "atgs" && !["atgs", "fgs", "lgs"].includes(prop)) continue;
			if (PAGE == "tds" && prop !== "attd") continue;

			list.push({
				method: METHOD || "",
				book,
				devig: devigKey,
				prop,
				roi: typeof stats.roi === "number" ? stats.roi : Number(stats.roi),
				wins: stats.wins,
				losses: stats.losses,
				profit: stats.profit,
				kelly: stats.kelly,
			});
		}
	}
	list.sort((a,b) => b.roi - a.roi);
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
	renderPreloadsList(container, top || []);
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

function filterDevPickerByProps(selectedProps) {
	const picker = document.getElementById('dev-picker');
	if (!picker) return;
	const allProps = document.querySelectorAll('#prop-options input');
	const totalProps = allProps.length;
	const showAll = !selectedProps || selectedProps.length === 0 || selectedProps.length === totalProps;

	picker.querySelectorAll('.dev-chip-wrap').forEach(wrap => {
		const prop = wrap.dataset.prop;
		wrap.style.display = (showAll || selectedProps.includes(prop)) ? '' : 'none';
	});
}

function renderPreloadsList(container, items, prop = "atgs") {
	container.innerHTML = "";
	if (!items || items.length === 0) {
		container.innerHTML = `<div style="padding:1rem">No ${prop.toUpperCase()} devigs found in RECORD.</div>`;
		return;
	}

	const header = document.createElement("div");
	header.style.display = "flex";
	header.style.alignItems = "center";
	header.style.gap = "1rem";

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

	bookSelect.value = BOOK || "all";

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

	// min-bets select
	const minWrapper = document.createElement("div");
	minWrapper.className = "select-wrapper";
	minWrapper.innerHTML = `<label for="min-bets" class="select-label" style="font-size:.85rem">Min</label>`;
	const minSelect = document.createElement("select");
	minSelect.id = "min-bets";
	[1,10,20,50,100,200].forEach(v => {
		const opt = document.createElement("option");
		opt.value = v;
		opt.text = v;
		if (v === 20) opt.selected = true;
		minSelect.appendChild(opt);
	});
	minWrapper.appendChild(minSelect);
	header.appendChild(minWrapper);

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

		filtered.sort((a,b) => b.roi - a.roi).forEach((it, idx) => {
			const row = document.createElement("div");
			row.classList.add("preload-row");
			row.style.display = "flex";
			row.style.justifyContent = "space-between";
			row.style.alignItems = "center";
			row.style.padding = "0.4rem";
			row.style.borderBottom = "1px solid rgba(0,0,0,0.06)";

			let [p,d] = (it.devig || "").split("-vs-");
			const bookLabel = it.book ? it.book.toUpperCase() : "";

			row.innerHTML = `
				<div style="min-width:260px">
					<div style="gap: 5px;display:flex;align-items:center">${bookLabel}${typeof getBookImgs === 'function' ? getBookImgs([it.book]) : ''}</div>
					<div style="display:flex;align-items:center;font-size:.85rem;color:#666;gap:5px;">${(it.prop||p||'').toUpperCase()} vs ${d ? d.toUpperCase() : it.devig} ${typeof getBookImgs === 'function' ? getBookImgs(d ? d.split("+") : []) : ''}</div>
				</div>
				<div class="preload-right" style="display:flex;gap:.5rem;align-items:center">
					<div class="preload-record">
						<div style="font-weight:600">${it.roi >= 0 ? '+'+it.roi+'%' : it.roi+'%'}</div>
						<div style="font-size:.8rem;color:#666">${it.wins}W - ${it.losses}L</div>
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
				WEIGHT = repeatOnes(devig).slice(1);
				REQUIRED = [];
				const bookSelectEl = document.getElementById("book-select");
				if (bookSelectEl) bookSelectEl.value = book.replace("best", "") || "";
				setOptions("prop-options", [prop]);
				updatePropLabel([prop]);

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