let ALL_CARD_DATA = [];
let MASTER_DATA = [];
let CURRENT_CARD_INDEX = 0;
const CARDS_PER_LOAD = 20;
// Flag to prevent loading multiple batches simultaneously
let IS_LOADING_CARDS = false;

function cardStateKey(rowData) {
  const player = (rowData.player || "").trim();
  const prop   = (rowData.prop || "").trim();
  const line   = String(rowData.handicap ?? "");
  const side   = rowData.under ? "U" : "O";

  return `cardOpen:${player}|${prop}|${side}|${line}`;
}

function clearCardOpenState() {
  Object.keys(localStorage)
    .filter(k => k.startsWith("cardOpen:"))
    .forEach(k => localStorage.removeItem(k));
}

clearCardOpenState();

function initializeCards(data) {
	MASTER_DATA = data;
	applyFilters();
}

function applyFilters() {
	const searchTerm = document.getElementById("player-search").value.toLowerCase();

	const filtered = MASTER_DATA.filter(row => {
		return row.player.includes(searchTerm);
	});

	renderCards(filtered);
}

const debouncedApplyFilters = debounce(applyFilters, 400);
if (document.getElementById("player-search")) {
	document.getElementById("player-search").addEventListener("input", () => {
		debouncedApplyFilters();
	});
}

function loadMoreCards() {
	if (IS_LOADING_CARDS) return;
	
	const container = document.getElementById("card-container");
	const data = ALL_CARD_DATA;
	
	const endIndex = Math.min(CURRENT_CARD_INDEX + CARDS_PER_LOAD, data.length);
	
	if (CURRENT_CARD_INDEX >= data.length) {
		return;
	}
	
	IS_LOADING_CARDS = true;
	
	const fragment = document.createDocumentFragment();
	
	for (let i = CURRENT_CARD_INDEX; i < endIndex; i++) {
		const rowData = data[i];
		const uniqueId = `${rowData.player}-${rowData.prop}-${rowData.line}-${rowData.ouIdx}`;
		
		// Use the existing function to create the card
		const newCard = createNewCard(rowData, uniqueId);
		fragment.appendChild(newCard);
	}
	
	container.appendChild(fragment);
	
	CURRENT_CARD_INDEX = endIndex;
	IS_LOADING_CARDS = false;
	
	// Edge case: If the loaded cards don't fill the container (e.g., on a large monitor), 
	// immediately load the next batch until the container is full or all data is loaded.
	if (container.scrollHeight <= container.clientHeight && CURRENT_CARD_INDEX < data.length) {
		loadMoreCards();
	}
}

function handleScroll() {
	const container = document.getElementById("table-container");
	
	const scrollTriggerDistance = 200;
	const scrolledNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - scrollTriggerDistance;

	//console.log(scrolledNearBottom, CURRENT_CARD_INDEX)

	if (scrolledNearBottom && !IS_LOADING_CARDS && CURRENT_CARD_INDEX < ALL_CARD_DATA.length) {
		loadMoreCards();
	}
}

function plusMinusCardFormatter(cell) {
	let value = cell.getValue();
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	return `<span class="${colorClass}">${value}</span>`;
}

function evCardFormatter(row) {
	let value = row.ev;
	let colorClass = "negative";
	if (value >= 0) {
		colorClass = "positive";
		value = `+${value}`;
	}
	if (["outliers", "atgs2"].includes(PAGE)) {
		return `<span class="ev-value">${Math.round((row?.outlierPct || 0) * 100)}%</span><span style=""> from devig</span>`;
	}
	return `<span class="ev-value ${colorClass}">${value}%</span><span style="">EV</span>`;
}

function bookContent(cell) {
	const value = cell.getValue();
	return `<span></span>`;
}

let PREVIOUS_DATA = [];

function sliceLogs(logs, interval) {
	const start = Math.max(0, logs.length - interval);
	const slicedLogs = logs.slice(start);
	const slicedIndices = Array.from({ length: slicedLogs.length }, (_, i) => i + 1);
	
	return { slicedLogs, slicedIndices };
}

function renderTrends(trends) {
	const LABELS = {
		lyr: "'24-25",
		szn: "'25-26"
	};
	const ORDER = ["lyr", "szn", "L5", "L10", "L20"];
	const pills = ORDER
		.filter(k => trends?.[k])
		.map(k => {
			const { w = 0, t = 0, p = 0 } = trends[k];
			const label = LABELS[k] ?? k;

			const tone =
				p >= 60 ? "good" :
				p >= 45 ? "mid"  :
				"bad";

			return `
				<div class="trend-pill">
				  <div class="trend-label">${label}</div>
				  <div class="trend-box ${tone}">
					<div class="trend-frac">${w}/${t}</div>
					<div class="trend-pct">${p}%</div>
				  </div>
				</div>
			`;
		})
		.join("");

	return `<div class="trend-row">${pills}</div>`;
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
	
	header.addEventListener('click', (e) => {
		const collapsedBody = header.querySelector('.card-body-collapsed');
		if (e.target.closest('.all-books-row')) {
			//return; 
		}

		const isVisible = collapsedBody.classList.toggle("visible");
		card.classList.toggle("expanded", isVisible);

		const uniqueId = card.dataset.uniqueId;

		const logs = rowData.logs;
		const handicap = rowData.handicap;

		const key = cardStateKey(rowData);
		localStorage.setItem(key, collapsedBody.classList.contains("visible") ? "1" : "0");

		if (collapsedBody.classList.contains('visible')) {
			const intervalSelect = document.getElementById(`log-interval-${uniqueId}`);
			const interval = intervalSelect ? parseInt(intervalSelect.value) : 15;
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
		'cz', 'fn', 'hr', 'bv', 'kambi', 'bol', 're', 'fl',
		'nv', 'kal', 'px', 'poly'
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

	const book = rowData.book;
	const pre = rowData.ouIdx == 1 ? "u" : "o";

	const evContent = evCardFormatter(rowData);
	const sport = rowData.sport || SPORT || "nba";
	const avgMin = PAGE == "nhl" ? rowData.avgTOI : rowData.avgMin;
	let team = rowData.teamId || rowData.team;
	let teamImg = getTeamImg(sport, team);
	let player = title(rowData.player);
	let gameImg = getGameImgs(rowData, {});
	if (PAGE.includes("ncaa")) {
		if (!["reb", "3ptm", "pts", "ast"].includes(rowData.prop)) {
			player = rowData.gameId || rowData.game;
		}
		teamImg = gameImg;
	}
	const playerRowContent = `
		<div class="player-content-stack">
			${teamImg}
			<div style="font-size: 0.7rem;display:flex;flex-direction:column;text-align:center;">
				<span class="pos">${rowData.pos || ""}</span>
				<span class="bats">${avgMin || ""}</span>
			</div>
			<span class="player-name">${player}</span>
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
		<div class="card-body-collapsed"></div>
		<!-- Top metrics -->
			<div class="expanded-metrics" style="display:flex; gap:8px; justify-content:space-between;">
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${rowData.fairVal > 0 ? "+"+rowData.fairVal : rowData.fairVal}</div>
					<div style="opacity:0.85; font-size:0.72rem;">Fair Value</div>
				</div>
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${Math.round(rowData.implied)}%</div>
					<div style="opacity:0.85; font-size:0.72rem;">Implied</div>
				</div>
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.8rem;">${rowData.ev < 0 ? "-" : (rowData?.kelly || 0).toFixed(2)+"u"}</div>
					<div style="opacity:0.85; font-size:0.72rem;">¼ Kelly</div>
				</div>
			</div>
		<div class="card-arrow-container">
			<svg class="toggle-arrow" viewBox="0 0 24 24" width="18" height="18">
				<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</div>
	`;
	
	const collapsedBody = card.querySelector('.card-body-collapsed');
	collapsedBody.innerHTML = `
		<div class="card-expanded" style="display:flex; flex-direction:column; gap:10px;">

			<!-- Matchup ranks -->
			<div class="expanded-ranks" style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
				<div class="metric-pill">
					<div style="font-weight:700; font-size:0.95rem;display: flex;">${gameImg.join("")}</div>
					<div style="opacity:0.85; font-size:0.72rem;">Game</div>
				</div>
				<div class="metric-pill" style="color:${getTDsOppRankColor(rowData.oppRank)}; font-weight:600; font-size:0.85rem;">
					${addSuffix(rowData.oppRank)} <span style="opacity:0.85; font-weight:500;">Opp Rank</span>
				</div>
				<div class="metric-pill" style="color:${getTDsOppRankColor(rowData.dvpRank)}; font-weight:600; font-size:0.85rem;">
					${addSuffix(rowData.dvpRank)} <span style="opacity:0.85; font-weight:500;">DvP Rank</span>
				</div>
			</div>

			<div class="expanded-trends-chart" style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
				<div class="expanded-trends" style="flex:1 1 160px; min-width:160px;">
					<div style="display:flex; justify-content:center; align-items:center;">
						<div style="opacity:0.9; font-size:0.78rem; font-weight:600;">Trends</div>
					</div>
					${renderTrends(rowData.hitRates || {})}
				</div>
			</div>
		</div>
	`;

	const key = cardStateKey(rowData);
	const shouldOpen = localStorage.getItem(key) === "1";

	collapsedBody.classList.toggle("visible", shouldOpen);
	card.classList.toggle("expanded", shouldOpen);

	if (collapsedBody.classList.contains('visible')) {
		//renderCardPlot(uniqueId, rowData.under, rowData.logs, rowData.handicap);
	}

	const previousRow = PREVIOUS_DATA.find(d => `${d.player}-${d.prop}-${d.line}` === card.dataset.uniqueId);
	if (previousRow && previousRow.ev !== rowData.ev) {
		card.style.transition = 'none';
		card.style.backgroundColor = 'rgba(100, 181, 246, 0.3)';
		setTimeout(() => {
			//card.style.transition = 'background-color 1s ease-out, transform 0.1s ease';
			//card.style.backgroundColor = '';
		}, 50);
	}
}

function renderCards(data) {
	if (PAGE == "outliers") {
		data = [...TABLE.getData()].sort((a,b) => {
			return parseFloat(b.outlier) - parseFloat(a.outlier);
		});
	} else {
		data = data.filter(r => r.ev != "" && r.ev != null).sort((a,b) => {
			return parseFloat(b.ev) - parseFloat(a.ev);
		});
	}

	const container = document.getElementById("card-container");
	container.innerHTML = "";

	ALL_CARD_DATA = data;
	PREVIOUS_DATA = data;
	CURRENT_CARD_INDEX = 0;

	loadMoreCards();

	const c = document.querySelector("#table-container");
	if (!c.dataset.scrollListenerAdded) {
		c.addEventListener('scroll', handleScroll);
		c.dataset.scrollListenerAdded = 'true';
	}
}