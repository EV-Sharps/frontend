
const ALL_WEIGHTABLE_BOOKS = ["pn", "circa", "fd", "dk", "b365", "espn", "mgm", "bol", "fn", "hr", "bv", "br", "cz"];
const SESSION_WEIGHTS = {
	"tds-only+pn+circa": {
		pn: 0.4,
		circa: 0.6
	}
}
WEIGHTS = getDefaultWeights((DEVIG || "").replace("only+", "").split("+"));

function getDefaultWeights(books) {
	if (!books || books.includes("mkt") || books.includes("")) {
		books = ALL_WEIGHTABLE_BOOKS;
	}
	const defaultWeight = parseFloat((1 / books.length).toFixed(4));
	const weights = {};
	let remainder = 1;
	
	books.forEach(book => {
		weights[book] = defaultWeight;
		remainder -= defaultWeight;
	});
	// Add any remainder to the first book to ensure it sums to 100%
	if (books.length > 0) {
		//weights[books[0]] += remainder;
	}
	return weights;
}

function splitEqual() {
	const liveWeights = Object.entries(WEIGHTS);
	const defaultWeight = parseFloat((100 / liveWeights.length).toFixed(2));

	liveWeights.forEach(([book, weight]) => {
		document.getElementById(`display-${book}`).textContent = `${defaultWeight}%`;
		document.getElementById(`weight-${book}`).value = defaultWeight;
		WEIGHTS[book] = defaultWeight / 100;
	});
	updateWeightTotal();
}

function getUserWeights() {
	const devig = DEVIG || 'mkt';
	const currentDevigKey = `${PAGE}-${devig}`;
	const includedDevigs = devig.replace("only+", "").split("+");

	let weights = CURR_USER?.metadata?.weights?.[currentDevigKey] || {};
	let marketWeights = weights[currentDevigKey] || getDefaultWeights(includedDevigs);
	return marketWeights || {};
}

function renderWeightSettings() {
	const inputsDiv = document.getElementById('book-weight-inputs');

	const devig = DEVIG || 'mkt';
	const currentDevigKey = `${PAGE}-${devig}`;
	const includedDevigs = devig.replace("only+", "").split("+");

	let marketWeights = getUserWeights();
	SESSION_WEIGHTS[currentDevigKey] = marketWeights;
	
	if (!inputsDiv) return;

	inputsDiv.innerHTML = '';

	const bookWeightArray = ALL_WEIGHTABLE_BOOKS.map(book => {
		if (WEIGHTS[book] == undefined) return;
		const weight = WEIGHTS[book] || 0;
		return { book, weight };
	});

	bookWeightArray.sort((a,b) => {
		if (b.weight != a.weight) return b.weight - a.weight;
		return a.book.localeCompare(b.book);
	})

	renderWeightPieChart();
	
	bookWeightArray.forEach(({ book, weight: weightValue }) => {
		if (devig != "mkt" && !includedDevigs.includes(book)) {
			return;
		}

		const inputHtml = `
			<div class="weight-item" style="margin-bottom: 12px; color: #fff;">
				<label for="weight-${book}" style="">
					<div style="display:flex;gap:4px;align-items:center;">
						<img class='book-img' style="width:16px;height:16px;" src='logos/${book}.png' alt='${book}' title='${book}' />
						<span>${book.toUpperCase()}:</span>
						<span id="display-${book}" class="weight-display">${(weightValue * 100).toFixed(2)}%</span>
					</div>

					<div style="display:flex;gap:4px;">
						<button class="fill-button" style="padding:2px 6px;" onclick="fillRemaining('${book}');">Fill</button>
						<button class="remove-weight" onclick="removeWeight('${book}');">X</button>
					</div>
				</label>

				<input 
					type="range" 
					id="weight-${book}" 
					data-book="${book}" 
					value="${weightValue * 100}" 
					min="0" 
					max="100"
					step="5" 
					style="width: 100%; margin-top: 5px;"
				>
			</div>
		`;
		inputsDiv.insertAdjacentHTML('beforeend', inputHtml);
	});

	// Update the total and status display
	updateWeightTotal();

	inputsDiv.querySelectorAll('input[type="range"]').forEach(input => {
		// Handle slider movement (input event fires continuously)
		input.addEventListener('input', (e) => {
			// Update the adjacent percentage display in real-time
			const book = e.target.dataset.book;
			const val = e.target.value;
			WEIGHTS[book] = parseFloat(val) / 100;
			document.getElementById(`display-${book}`).textContent = `${val}%`;
			updateWeightTotal();
		});
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

	inputsDiv.querySelectorAll('input[type="range"]').forEach(input => {
		const weight = parseFloat(input.value) || 0;
		liveWeights[input.dataset.book] = weight / 100;
	});

	return liveWeights;
}

function updateWeightTotal() {
	const fills = Array.from(document.getElementsByClassName('fill-button'));
	let total = 0;
	Object.entries(WEIGHTS).forEach(([book, weight]) => {
		total += weight * 100;
	});

	renderWeightPieChart();
	const totalEl = document.getElementById('weight-total');
	const statusEl = document.getElementById('weight-status');
	const saveBtn = document.getElementById('save-weights');
	
	totalEl.textContent = `${Math.round(total)}%`;

	if (Math.round(total) === 100) {
		statusEl.textContent = '✅';
		totalEl.style.color = "#00e676";
		saveBtn.disabled = false;
		fills.forEach(el => el.disabled = true);
	} else {
		statusEl.textContent = `⚠️ Adjust!`;
		statusEl.style.color = 'yellow';
		totalEl.style.color = "yellow";
		saveBtn.disabled = true;
		if (total < 100) {
			fills.forEach(el => el.disabled = false);
		}
	}
}

function renderWeightPieChart() {
	const labels = [];
	const values = [];

	Object.entries(WEIGHTS).forEach(([book, weight]) => {

		if (weight > 0) {
			labels.push(book.toUpperCase());
			values.push(weight * 100);
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
		height: MOBILE ? 230 : 250,
		width: MOBILE ? 230 : 250,
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

function removeWeight(book) {
	document.getElementById(`weight-${book}`).parentElement.remove();
	delete WEIGHTS[book];
	updateWeightTotal();
}

function openWeights() {
	const weightDiv = document.getElementById("weight-overlay");
	weightDiv.style.display = "flex";
	renderWeightSettings();
}

async function saveWeights() {
	const currentDevigKey = `${PAGE}-${DEVIG || 'mkt'}`;

	const metadata = CURR_USER?.metadata || {};
	if (!metadata["weights"]) {
		metadata["weights"] = {};
	}
	metadata["weights"][currentDevigKey] = WEIGHTS;
	if (CURR_USER) {
		const { error: updateError } = await SB.from('profiles')
			.update({metadata: metadata})
			.eq('id', CURR_SESSION.user.id);
	}
	updateHeaders();
	changeFilter();
	closeWeights();
}

function closeWeights() {
	document.getElementById("weight-overlay").style.display = "none";
}