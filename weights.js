
const ALL_WEIGHTABLE_BOOKS = ["circa", "pn", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "bv", "cz", "fl"];
const SESSION_WEIGHTS = {
	"tds-only+pn+circa": {
		pn: 0.4,
		circa: 0.6
	}
}
let TMP_WEIGHTS = {};
let RAW_WEIGHTS = {};
WEIGHTS = getDefaultWeights((DEVIG || "").replace("only+", "").split("+"));
let WEIGHT_LOADED = false;

function getDefaultWeights(books) {
	if (!books || books.includes("mkt") || books.includes("")) {
		books = ALL_WEIGHTABLE_BOOKS.filter(b => !["bv", "bol"].includes(b));
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
		return getDefaultWeights()
	}
	DEVIG.replace("only+", "").split("+").map((book, idx) => {
		weights[book] = parseFloat(WEIGHT.split("+")[idx]);
	});
	return weights;
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

function renderWeightSettings() {
	const inputsDiv = document.getElementById('book-weight-inputs');

	const devig = DEVIG || 'mkt';
	const currentDevigKey = `${PAGE}-${devig}`;
	const includedDevigs = devig.replace("only+", "").split("+");

	let marketWeights = getUserWeights();
	WEIGHTS = marketWeights;
	
	if (!inputsDiv) return;

	inputsDiv.innerHTML = '';

	renderWeightPieChart();
	
	ALL_WEIGHTABLE_BOOKS.forEach(book => {
		const inputHtml = `
			<div class="weight-item" style="margin-bottom: 10px; color: #fff;">
				<div style="display:flex;gap:8px;align-items:end;">
					<img class='book-img' style="width:32px;height:32px;" src='logos/${book}.png' alt='${book}' title='${book}' />
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
		height: MOBILE ? 250 : 250,
		width: MOBILE ? 250 : 250,
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

	const mode = document.querySelector('input[name="cd-mode"]:checked').value;
	if (mode == "only") {
		books.push("only");
	}
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
	let text = "";

	if (mode == "only") {
		text += "Only ";
	}
	text += `${books.map(book => book.toUpperCase()).join("/").replace("ONLY/", "")}`;
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

function closeWeights() {
	document.getElementById("weight-overlay").style.display = "none";
}