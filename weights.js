
const ALL_WEIGHTABLE_BOOKS = ["pn", "circa", "fd", "dk", "espn", "mgm", "bol", "fn", "hr", "bv", "br", "cz"];
const SESSION_WEIGHTS = {
	'tds-mkt': {
		pn: 0.2,
		circa: .5,
		fd: .15,
		dk: .15
	}
}

function getDefaultWeights() {
	const books = ALL_WEIGHTABLE_BOOKS.slice(0, 4); // Use first 4 books
	const defaultWeight = Math.floor(100 / books.length);
	const weights = {};
	let remainder = 100;
	
	books.forEach(book => {
		weights[book] = defaultWeight;
		remainder -= defaultWeight;
	});
	// Add any remainder to the first book to ensure it sums to 100%
	if (books.length > 0) {
		weights[books[0]] += remainder; 
	}
	return weights;
}

function renderWeightSettings() {
	const inputsDiv = document.getElementById('book-weight-inputs');

	// Create a key based on the current page (e.g., "nba-devigs")
	const currentDevigKey = `${PAGE}-${DEVIG || 'mkt'}`;

	// Get the current weights for this market, or the defaults if not set
	const marketWeights = SESSION_WEIGHTS[currentDevigKey] || {};
	
	if (!inputsDiv) return;

	inputsDiv.innerHTML = '';

	const bookWeightArray = ALL_WEIGHTABLE_BOOKS.map(book => {
		const weight = marketWeights[book] || 0;
		return { book, weight };
	});

	bookWeightArray.sort((a,b) => {
		if (b.weight != a.weight) return b.weight - a.weight;
		return a.book.localeCompare(b.book);
	})

	renderWeightPieChart();
	
	bookWeightArray.forEach(({ book, weight: weightValue }) => {
		const inputHtml = `
			<div class="weight-item" style="display:flex; justify-content:space-between; flex-direction: column; margin-bottom: 12px; color: #fff;">
				<label for="weight-${book}" style="justify-content: space-between;width: 120px;">
					<span>${book.toUpperCase()}:</span>
					<span id="display-${book}" class="weight-display">${weightValue * 100}%</span>
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
			document.getElementById(`display-${e.target.dataset.book}`).textContent = `${e.target.value}%`;
			updateWeightTotal(); // Check total validity
		});
	});
}

function updateWeightTotal() {
	const inputsDiv = document.getElementById('book-weight-inputs');
	let total = 0;
	const liveWeights = {};

	inputsDiv.querySelectorAll('input[type="range"]').forEach(input => {
		const weight = parseInt(input.value) || 0;
		total += weight;
		liveWeights[input.dataset.book] = weight;
	});

	renderWeightPieChart()
	const totalEl = document.getElementById('weight-total');
	const statusEl = document.getElementById('weight-status');
	const saveBtn = document.getElementById('save-weights');
	
	totalEl.textContent = `${total}%`;

	if (total === 100) {
		statusEl.textContent = '✅';
		totalEl.style.color = "#00e676";
		saveBtn.disabled = false;
	} else {
		statusEl.textContent = `⚠️ Adjust!`;
		statusEl.style.color = 'yellow';
		totalEl.style.color = "yellow";
		saveBtn.disabled = true;
	}
}

function renderWeightPieChart() {

	const labels = [];
	const values = [];

	const inputsDiv = document.getElementById('book-weight-inputs');
	inputsDiv.querySelectorAll('input[type="range"]').forEach(input => {
		const weight = parseInt(input.value) || 0;
		if (weight > 0) {
			labels.push(input.dataset.book.toUpperCase());
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
		height: 250,
		width: 250,
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
	renderWeightSettings();
}

function saveWeights() {

}

function closeWeights() {
	document.getElementById("weight-overlay").style.display = "none";
}