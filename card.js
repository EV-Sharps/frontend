function plusMinusCardFormatter(cell) {
	let value = cell.getValue();
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	return `<span class="${colorClass}">${value}</span>`;
}

function evCardFormatter(cell) {
	let value = cell.getValue();
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	return `<span class="ev-value ${colorClass}">${value}%</span><span style="">EV</span>`;
}

function bookContent(cell) {
	const value = cell.getValue();
	return `<span></span>`;
}

let PREVIOUS_DATA = [];

function sliceLogs(logs, interval) {
    // Determine the starting index for slicing to get the last 'interval' games
    const start = Math.max(0, logs.length - interval);
    const slicedLogs = logs.slice(start);
    // Create game index numbers (e.g., 1, 2, 3, ... 15)
    const slicedIndices = Array.from({ length: slicedLogs.length }, (_, i) => i + 1);
    
    return { slicedLogs, slicedIndices };
}

function renderCardPlot(uniqueId, under, logs, handicap, interval) {
	if (!logs || logs.length === 0) {
        const chartDiv = document.getElementById(`card-chart-${uniqueId}`);
        if (chartDiv) {
            chartDiv.innerHTML = '<div style="text-align:center; padding:10px; font-style:italic;">No recent game logs available.</div>';
        }
        return;
    }

	const colors = logs.map(value => {
		let cond = parseFloat(value) > parseFloat(handicap);
		if (under) {
			cond = parseFloat(value) < parseFloat(handicap);
		}
		return cond ? "rgba(65, 131, 215, 0.9)" : "rgba(242, 120, 75, 0.9)";
	});
	const tableData = {
		x: Array.from({ length: logs.length }, (_, i) => i + 1),
		y: logs.map(v => v != "0" ? v : 0.25),
		type: "bar",
		text: logs,
		textposition: "inside",
		marker: {
			color: colors
		}
	};
	const layout = {
		height: 120,
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		height: "200px",
		dragmode: 'pan',
		margin: { l: 0, r: 0, t: 20, b: 20 },
		xaxis: {
			showgrid: false,
			type: "category",
			//tickmode: "array",
			//tickvals: [dtSplits[0],dtSplits.at(-1)],
			//ticktext: [dtSplits[0],dtSplits.at(-1)],
			//range: [-0.5, parseFloat(dtSplits.length)+0.5],
			rangeslider: {
				visible: false
			},
			//range: [dtSplits.length-15.6,dtSplits.length-0.5]
		},
		yaxis: {
			showgrid: false,
			tickmode: "linear",
			dtick: 1,
			fixedrange: true,
			showticklabels: false,
			title: {
				text: ""
			}
		},
		shapes: [
			/*
			{
				type: "line",
				x0: -0.25, x1: logs.length,
				y0: handicap,
				line: {
					color: "#5A5A5A",
					dash: "dash"
				}
			}
			*/
		]
	};

	//Plotly.newPlot(`card-chart-${uniqueId}`, [tableData], layout, { responsive: true});
	setTimeout(() => {
		//Plotly.Plots.resize(`card-chart-${uniqueId}`)
	}, 100);
}

function createNewCard(rowData, uniqueId) {
	const card = document.createElement('div');
	card.className = 'data-card';
	card.dataset.uniqueId = uniqueId;

	const header = document.createElement('div');
	header.className = 'card-header';
	card.appendChild(header);

	const collapsedBody = document.createElement('div');
	collapsedBody.className = 'card-body-collapsed';
	card.appendChild(collapsedBody);
	
	header.addEventListener('click', () => {
		collapsedBody.classList.toggle('visible');
		const uniqueId = card.dataset.uniqueId;
	    const logs = rowData.logs;
	    const handicap = rowData.handicap;

	    if (collapsedBody.classList.contains('visible')) {
	        // Get current selected interval, default to 15 if not set
	        const intervalSelect = document.getElementById(`log-interval-${uniqueId}`);
	        const interval = intervalSelect ? parseInt(intervalSelect.value) : 15;
	        
	        // Render the chart using the current interval
	        renderCardPlot(uniqueId, rowData.under, logs, handicap, interval);
	    }
	});

	// Run the update logic to populate the content
	updateExistingCard(card, rowData);

	return card;
}

function renderAllBooks(bookOdds, bestBook) {
	const orderedKeys = [
		'circa', 'fd', 'dk', 'mgm', 'espn', 'pn', 'br', 'b365', 
		'cz', 'fn', 'hr', 'bv', 'kambi', 'bol'
	];

	let html = '';
	
	if (!bookOdds || typeof bookOdds !== 'object') {
		return '';
	}

	for (const bookKey of orderedKeys) {
		const odds = bookOdds[bookKey];
		// Only render if the odds are available (not null, undefined, or empty string)
		if (odds !== null && odds !== undefined && odds !== "") {
			const isBest = bookKey === bestBook ? 'is-best-book' : '';
			html += `
				<div class="book-odd-item ${isBest}">
					<img class="book-logo-small" src='logos/${bookKey}.png' alt='${bookKey}' title='${bookKey}' />
					<span class='book-odd-value ${isBest}'>${plusFormatter(odds)}</span>
				</div>
			`;
		}
	}
	
	return html;
}

function updateExistingCard(card, rowData) {
	const uniqueId = card.dataset.uniqueId;
	const header = card.querySelector('.card-header');
	const collapsedBody = card.querySelector('.card-body-collapsed');

	const book = rowData.book;
	const evCell = { getValue: () => rowData.ev };
	const pre = rowData.ouIdx == 1 ? "u" : "o";

	const evContent = evCardFormatter(evCell);
	const sport = rowData.sport || SPORT || "nba";
	const avgMin = sport == "nhl" ? rowData.avgTOI : rowData.avgMin;
	const playerRowContent = `
		<div class="player-content-stack">
			${getTeamImg(sport, rowData.team)}
			<div style="font-size: 0.7rem;display:flex;flex-direction:column;text-align:center;">
				<span class="pos">${rowData.pos}</span>
				<span class="bats">${avgMin}</span>
			</div>
			<span class="player-name">${title(rowData.player)}</span>
		</div>
		<div class="prop-content-stack">
			<span class="prop-line">${pre}${rowData.handicap}</span>
			<span class="prop-type">${rowData.prop.toUpperCase()}</span>
		</div>
	`;
	
	const evBookRowContent = `
		<div class="ev-section">${evContent}</div>
		<div class="best-book-section">
			<img class="book-img-large" src='logos/${book}.png' alt='${book}' title='${book}' />
			<span class='evbook-odds-large'>${plusFormatter(rowData.line)}</span>
		</div>
	`;

	const allBooksHtml = renderAllBooks(rowData.bookOdds, book);

	header.innerHTML = `
		<div class="card-row player-prop-row">${playerRowContent}</div>
		<div class="card-row ev-book-row">${evBookRowContent}</div>
		<div class="card-row all-books-row">${allBooksHtml}</div>
	`;
	
	collapsedBody.innerHTML = `
		<div style="display:flex;justify-content: space-evenly;">
			<div>${rowData.fairVal} Fair Val</div>
			<div>${rowData.implied}% Implied</div>
		</div>
		<div style="display:flex;justify-content: center; gap: 10px;">
			<div style="color:${getTDsOppRankColor(rowData.oppRank)}">${addSuffix(rowData.oppRank)} Opp Rank</div>
			<div style="color:${getTDsOppRankColor(rowData.dvpRank)}">${addSuffix(rowData.dvpRank)} DvP Rank</div>
		</div>
		<div id="card-chart-${uniqueId}" style="height: 120px">

		</div>
	`;

	if (collapsedBody.classList.contains('visible')) {
		renderCardPlot(uniqueId, rowData.under, rowData.logs, rowData.handicap);
	}

	const previousRow = PREVIOUS_DATA.find(d => `${d.player}-${d.prop}-${d.line}` === card.dataset.uniqueId);
	if (previousRow && previousRow.ev !== rowData.ev) {
		card.style.transition = 'none';
		card.style.backgroundColor = 'rgba(100, 181, 246, 0.3)'; // Light flash color
		setTimeout(() => {
			card.style.transition = 'background-color 1s ease-out, transform 0.1s ease';
			card.style.backgroundColor = ''; // Revert to CSS defined color
		}, 50);
	}
}

function renderCards(data) {
	data = data.filter(r => r.ev != "" && r.ev != null).sort((a,b) => {
		return parseFloat(b.ev) - parseFloat(a.ev);
	});

	const container = document.getElementById("card-container");

	const existingCards = {};
	container.querySelectorAll('.data-card').forEach(card => {
		const uniqueId = card.dataset.uniqueId;
		existingCards[uniqueId] = card;
	});

	const newContainerContent = document.createDocumentFragment();
	const newUniqueIds = new Set();

	data.forEach(rowData => {
		const uniqueId = `${rowData.player}-${rowData.prop}-${rowData.line}-${rowData.ouIdx}`; 
		newUniqueIds.add(uniqueId);
		
		const existingCard = existingCards[uniqueId];
		
		if (existingCard) {
			updateExistingCard(existingCard, rowData);
			newContainerContent.appendChild(existingCard);
			delete existingCards[uniqueId]; // Mark as processed
		} else {
			const newCard = createNewCard(rowData, uniqueId);
			newContainerContent.appendChild(newCard);
		}
	});

	for (const id in existingCards) {
		existingCards[id].remove();
	}

	// Clear any previous content
	container.innerHTML = '';
	container.appendChild(newContainerContent);

	PREVIOUS_DATA = data;
}