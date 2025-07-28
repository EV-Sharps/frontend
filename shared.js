let HTML = "";
let TEAM = "";
let PAGE = "";
let MOBILE = window.innerWidth <= 600;
let ACCESS_TOKEN = "";
let UPDATED = {};
if (window.location.protocol == "file:" || window.location.host.includes("localhost")) {
	HTML = ".html";
}

function getToday() {
	let today = new Date();
	today = today.toLocaleDateString("en-US", {day: "2-digit", month: "2-digit", year: "numeric"});
	let [M,D,Y] = today.split("/");
	return `${Y}-${M}-${D}`;
}

const PAGE_DROPDOWN = `
	<option value="dingers">⚾ Dingers</option>
	<option value="feed">⚾ Feed</option>
	<option value="bvp">⚾ BvP</option>
	<option value="stats">⚾ Stats</option>
	<option value="barrels">⚾ Barrels</option>
	<option value="trends">⚾ Trends</option>
	<option value="mlb">⚾ Props</option>
	<option value="golf">⛳ Props</option>
	<option value="nfl">🏈 Props</option>
	<option value="ranks">🏈 Fantasy Ranks</option>
	<option value="futures">🏈 Futures</option>
	<option value="nhl">🏒 Props</option>
	<option value="nba">🏀 Props</option>
	<option value="ncaab">🏀 CBB Props</option>
	<option value="historical">⚾ Dingers (H)</option>
	<option value="kambi">⚾ Dingers (K)</option>
	<option value="preview">⚾ Preview</option>
`;

setTimeout(() => {
	let selectId = MOBILE ? "#mobile-header" : "#header";
	if (MOBILE && document.querySelectorAll("#mobile-header").length == 0) {
		selectId = "#header";
	}
	const select = document.querySelector(selectId+" #page-select");
	select.addEventListener("change", (event) => {
		const page = event.target.value;
		changePage(page);
	});
	select.innerHTML = PAGE_DROPDOWN;
	if (PAGE == "props") {
		select.value = SPORT;
	} else if (PAGE == "dingers" && KAMBI) {
		select.value = "kambi";
	} else {
		select.value = PAGE;
	}
}, 200);

function openProfile() {
	changePage("profile");
}

function changePage(page) {
	if (page == "historical") {
		window.location.href = `./historical${HTML}?historical=z`;
	} else if (page == "kambi") {
		window.location.href = `./dingers${HTML}?kambi=true`;
	} else if (["mlb", "nba", "nfl", "nhl"].includes(page)) {
		window.location.href = `./props${HTML}?sport=${page}`;
	} else {
		window.location.href = `./${page}${HTML}`;
	}
}

function isBarrel(row) {
	const ev = parseFloat(row["evo"] || 0);
	const la = parseInt(row["la"] || 0);
	return (ev * 1.5 - la) >= 117 && (ev + la) >= 124 && la <= 50 && ev >= 98
}

function isBarrel2(row) {
	const evo = Math.round(parseFloat(row["evo"] || 0));
	const la = parseInt(row["la"] || 0);
	const thresh = {
		98: [26, 30], 99: [25, 31],
		100: [24, 33], 101: [23, 34],
		102: [22, 35], 103: [21, 36],
		104: [20, 37], 105: [19, 38],
		106: [18, 39], 107: [17, 40],
		108: [16, 41], 109: [15, 42],
		110: [14, 43], 111: [13, 44], 112: [12, 45],
		113: [11, 46], 114: [10, 47],
		115: [9, 48], 116: [8, 50]
	};

	if (evo < 98) return false;
	if (evo > 116) return la >= thresh[116][0] && la <= thresh[116][1];
	return la >= thresh[evo][0] && la <= thresh[evo][1];
}

function timeAgo(timestamp, short=false) {

	if (timestamp === 0) {
		return "";	
	}

	const now = new Date();
	const past = new Date(timestamp);
	const diff = Math.floor((now - past) / 1000);

	if (diff < 0) {
		return "";
	}

	if (diff < 60) {
		if (short) return `${diff}s ago`;
		return `${diff} second${diff === 1 ? "" : "s"} ago`;
	}
	let minutes = Math.floor(diff / 60);
	if (minutes < 60) {
		if (short) return `${minutes}m ago`;
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	let hours = Math.floor(minutes / 60);
	if (hours < 24) {
		if (short) return `${hours}h ago`;
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	let days = Math.floor(hours / 24);
	if (short) return `${days}d ago`;
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

function groupByGame() {
	if (!TABLE.options.groupBy) {
		TABLE.setGroupBy("game");
		TABLE.setSort([
			{column: `ev`, dir: "desc"},
			{column: "start", dir: "asc"},
		])
	} else {
		TABLE.setGroupBy();
		TABLE.setSort([
			{column: `ev`, dir: "desc"}
		]);
	}
}

const oddsFormatter = function(cell) {
	let odds = cell.getValue();
	if (!odds) {
		return "";
	}
	if (odds.includes("/")) {
		let [o,u] = odds.split("/");
		return `<div>
		<mfrac>
			<mn>${o}</mn>
			<mn>${u}</mn>
		</mfrac></div>`;
	} else {
		return odds;
	}
}

const sportFormatter = function(cell) {
	let sport = "";
	if (cell.getValue() == "nba") {
		sport = "🏀";
	} else if (cell.getValue() == "mlb") {
		sport = "⚾";
	} else if (cell.getValue() == "nhl") {
		sport = "🏒";
	}
	return `<div>${sport}</div>`;
}


const percentFormatter = function(cell, params, rendered) {
	if (!cell.getValue()) {
		return "";
	}
	return cell.getValue()+"%";
}

const decimalFormatter = function(cell) {
	if (!cell.getValue()) {
		return "";
	}
	return parseFloat(cell.getValue()).toFixed(2);
}

function addPlus(value) {
	if (parseFloat(value) > 0) {
		return "+"+value;
	}
	return value;
}

const avgFormatter= function(cell) {
	if (cell.getValue() == "-") {
		return "-";
	}
	return parseFloat(cell.getValue()).toFixed(3).replace(/^0/, '');
}

const eraFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v <= 3.50) {
		cls = "negative";
	} else if (v >= 4.50) {
		cls = "positive";
	}
	return `<div class="${cls}">${cell.getValue()}</div>`;
}

const lastDiffFormatter = function(cell) {
	const data = cell.getRow().getData();
	let diff = cell.getValue();
	if (!diff) {
		return "0";
	}
	diff = diff.toFixed(1);
	if (diff > 0) {
		return `<div class="positive">+${diff}</div>`;
	}
	return `<div class="">${diff}</div>`;
}

const gapFormatter = function(cell) {
	const data = cell.getRow().getData();

	return `${cell.getValue()}`;
}

const percentileFormatter = function(cell) {
	const data = cell.getRow().getData();
	let field = cell.getField();

	if (!cell.getValue()) {
		if (["game_trends.barrels_per_bip.5G", "game_trends.hard_hit_percent.5G"].includes(field)) {
			return "0";
		}
		return `<div class="negative">0</div>`;
	}

	let cls = "";
	let percentile = data[field+"Percentile"];
	if (field.includes(".")) {
		let [_,k,p] = field.split(".");
		percentile = data["game_trends"][k][p+"Percentile"];
	}
	if (percentile >= 80) {
		cls = "positive";
	} else if (percentile <= 20) {
		cls = "negative";
	}
	//cls = "";
	let v = "";

	if (TOGGLE_PERCENTILE) {
		v = `${addSuffix(percentile)}`;
	} else {
		let suffix = "";
		if (field.includes("distance")) {
			suffix = " ft";
		} else if (field.includes("percent") || field.includes("barrels_per_bip")) {
			suffix = "%";
		}
		v = `${cell.getValue()}${suffix}`;
	}
	return `
		<div class="${cls}">${v}</div>
	`;
}

const thresholds = {
	"exit_velocity_avg": [87.6, 90.8],
	"la": [0, 26],
	"evo": [0, 95],
	"dist": [0, 300],
	"hard_hit_percent": [35.5, 45.5],
	"barrel_batted_rate": [5,10.5],
	"barrels_per_bip": [5,10.5],
	"sweet_spot_percent": [28.3, 37.5],
	"flyballs_percent": [21, 32],
	// strikeout
	"k_percent": [18.5, 26.3],
	"whiff_percent": [22.2, 29],
	"oz_swing_miss_percent": [38.5, 51.6],
	"z_swing_miss_percent": [13.5, 21],
	"oz_contact_percent": [48, 60.6]
};

const summaryFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	let field = cell.getField();
	if (field.includes(".")) {
		field = field.split(".")[1];
	}
	let switched = ["oz_contact_percent"].includes(field);
	if (thresholds[field]) {
		if (thresholds[field][0] && v <= thresholds[field][0]) {
			cls = switched ? "positive" : "negative";
		} else if (field == "la") {
			if (isBarrel(data)) {
				cls = switched ? "negative" : "positive";
			}
		} else if (v >= thresholds[field][1]) {
			cls = switched ? "negative" : "positive";
		}
	}
	const p = (field.includes("rate") || field.includes("percent") || field.includes("barrel")) ? "%" : "";
	let suffix = field == "dist" ? " ft" : "";
	if (field.includes("rate") || field.includes("percent") || field.includes("barrel")) {
		suffix = "%";
	}
	return `<div class="${cls}">${cell.getValue()}${suffix}</div>`;
}

const baFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v < .250) {
		cls = "negative";
	} else if (v >= .300) {
		cls = "positive";
	}
	return `<div class="${cls}">${v.toFixed(3).replace(/^0/, "")}</div>`;
}

const xwobaFormatter = function(cell) {
	const data = cell.getRow().getData();
	let v = parseFloat(cell.getValue());
	if (!v) {
		return "";
	}
	let cls = "";
	if (v < .310) {
		cls = "negative";
	} else if (v >= .370) {
		cls = "positive";
	}
	return `<div class="${cls}">${v.toFixed(3).replace(/^0/, "")}</div>`;
}

const bppPlayerFormatter = function(cell) {
	const data = cell.getRow().getData();
	const val = parseFloat(cell.getValue());
	let cls = "";
	if (val >= 1.01) {
		cls = "positive";
	} else if (val < 0.90) {
		cls = "negative";
	}
	return `
		<div class="${cls}">
			${cell.getValue()}
		</div>
	`;
}

const bppFormatter = function(cell) {
	const data = cell.getRow().getData();
	const val = parseInt(cell.getValue().replace("%", ""));
	let cls = "";
	if (val >= 10) {
		cls = "positive";
	} else if (val <= -10) {
		cls = "negative";
	}
	return `
		<div class="${cls}">
			${cell.getValue()}
		</div>
	`;
}

const impliedFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!cell.getValue()) {
		return "";
	}
	const cls = data.mostLikely == cell.getField().split(".").at(-1) ? "positive" : "";
	return `
		<div class="${cls}">
			${(parseFloat(cell.getValue()) * 100).toFixed(1)}%
		</div>
	`;
}

const oppFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}

	const ah = `<span style="width: 12px;text-align:center;">
		${data.game.split(" @ ")[0] != cell.getValue() ? "@" : "v"}
	</span>`;
	if (params.prop == "k" || params.is_pitcher) {
		return `<div class="opp-cell">
			${ah}
			${getTeamImg(SPORT, cell.getValue())}
			${cell.getValue().toUpperCase()}
		</div>`;
	}
	let pitcher = "";
	if (PAGE == "preview") {
		pitcher = cell.getValue().toUpperCase();
	} else {
		pitcher = MOBILE || params.lastName ? title(data.pitcher).split(" ")[1] : title(data.pitcher);
	}
	const badge = data.doubleheader ? 
		"<span class='dbl-badge'>2</span>" : "";
	const gameContainer = badge ? `<div style='position:relative;'>${badge}${getTeamImg(SPORT, cell.getValue())}</div>` : `${getTeamImg(SPORT, cell.getValue())}`;
	return `
		<div class="opp-cell" aria-label="${data.pitcherSummary}">
			${ah}
			${gameContainer}
			${pitcher}
		</div>
	`;
}

function addSuffix(num) {
	let j = num % 10, k = num % 100;
	
	if (j == 1 && k != 11) return num + "st";
	if (j == 2 && k != 12) return num + "nd";
	if (j == 3 && k != 13) return num + "rd";
	return num + "th";
}

const rankingFormatter = function(cell) {
	const data = cell.getRow().getData();
	const field = cell.getField();
	if (!data.game || !cell.getValue()) {
		return "";
	}
	if (field == "oppRank" || ["nba"].includes(SPORT)) {
		return `<div class='${data.oppRankClass}'>${cell.getValue()}</div>`;
	} else {
		if (data.team == "ath") {
			return "";
		}
		let cls = "";
		if (data.stadiumRank <= 10) {
			cls = "positive";
		} else if (data.stadiumRank >= 20) {
			cls = "negative";
		}
		return `<div class='${cls}'>${addSuffix(cell.getValue())}</div>`;
	}
}

const plusMinusFormatter = function(cell) {
	let ev = cell.getValue();
	if (parseFloat(ev) > 0) {
		ev = "+"+ev;
	}
	return ev;
}

const inningFormatter = function(cell) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}
	const icon = data.game.split(" @ ")[0] == data.team ? "▲" : "▼";
	return `
		<div style='display: flex;justify-content:center;align-items:center;gap:1px'>
			<span style='font-size: 0.5rem;margin-bottom:-2px;'>${icon}</span>
			${data.in}
		</div>
	`;
}

const evMutFormatter = function(cell) {
	const data = cell.getRow().getData();
	const ev = cell.getValue();
	if (parseFloat(ev) > 0) {
		return `<div class="positive">+${ev}%<div>`
	}
	return ev+"%";
}

const evFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let ev = cell.getValue();
	if (!ev || data.prop == "separator") return "";
	if (parseFloat(ev) > 0) {
		ev = "+"+ev;
	}

	let ou = data.ou || data.daily.ou;
	return `
		<div class='ev-cell'>
			<span class='ev'>${ev}%</span>
			<span class='ou'>${ou}</span>
		</div>
	`;
}

const bvpFormatter = function(cell) {
	const data = cell.getRow().getData();

	return `
		<div class="bvp-cell">
			<div class="bvp-pitcher">${title(data.pitcher).split(" ")[1]}</div>
			<div class="bvp-value">${cell.getValue()}</div>
		</div>
	`;
}

const hedgeFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `$${data.hedge}`;
}

const hedgeBookFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `<div class='evbook-cell'>
		<span class='evbook-odds'>${data.hedgeLine}</span>
		<img class='book-img' src='logos/${data.book}.png' alt='${data.book}' title='${data.book}' />
	</div>`;
}

const evBookFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator" || !cell.getValue()) return "";

	if (PAGE == "dingers") {
		params.book = BOOK;
	}
	if (PAGE == "hedge") {
		let line = data.line;
		if (line > 0) {
			line = "+"+line;
		}
		return `<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<img class='book-img' src='logos/${params.book}.png' alt='${params.book}' title='${params.book}' />
			</div>`;
	}

	if (PAGE == "derby") {
		let line = data.line;
		if (line > 0) {
			line = "+"+line;
		}
		return `<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<img class='book-img' src='logos/mgm.png' alt='dk' title='dk' />
			</div>`;
	}

	if (params.book && (!params.book.includes("vs-") || params.book.includes("-vs-circa"))) {
		const book = params.book.split("-")[0];
		let line = data.bookOdds[book] || "0";
		if (line.includes("/")) {
			line = line.split("/")[0];
		}
		const lineInt = parseInt(line);
		let implied = -lineInt / (-lineInt + 100);
		if (lineInt > 0 && !line.includes("+")) {
			line = "+"+line;
			implied = 100 / (lineInt + 100);
		}
		implied = parseInt(implied * 100);
		return `
			<div class='evbook-cell'>
				<span class='evbook-odds'>${line}</span>
				<span class='evbook-implied'>${implied}%</span>
				<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />
			</div>
		`;
	}

	const book = cell.getValue().replace("kambi", "parx").replace("-50%", "");
	let line = data.line === undefined ? "-" : data.line;
	if (window.location.href.includes("stats") || window.location.href.includes("bvp")) {
		line = data.daily.odds;
	}
	let lineInt = parseInt(line);
	let implied = -lineInt / (-lineInt + 100);
	if (lineInt > 0) {
		line = "+"+line;
		implied = 100 / (lineInt + 100);
	}
	implied = parseInt(implied * 100);
	return `
		<div class='evbook-cell'>
			<span class='evbook-odds'>${line}</span>
			<span class='evbook-implied'>${implied}%</span>
			<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />
		</div>
	`;
}

function convertProp(prop) {
	prop = prop
		.replace("single", "1b").replace("double", "2b").replace("triple", "3b")
		.replace("pts+", "p+").replace("+ast", "+a").replace("+reb", "+r")
	return prop.toUpperCase();
}

const propFormatter = function(cell) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const ou = data.under ? "u" : "o";
	if (["playoffs", "roty", "mvp", "division"].includes(data.prop)) {
		return data.under ? "No" : "Yes";
	} else if (data.prop == "rfi") {
		return data.under ? "NRFI" : "YRFI";
	} else if (["make_cut"].includes(data.prop)) {
		return data.under ? `MISS CUT` : "MAKE CUT";
	} else if (data.prop.includes("top_")) {
		return data.prop.toUpperCase().replace("_", " ");
	} else if (["atgs"].includes(data.prop)) {
		return data.under ? `u${data.prop.toUpperCase()}` : data.prop.toUpperCase();
	} else if (data.prop.includes("ml")) {
		return `${data.prop.toUpperCase()}`;
	} else if (data.prop.includes("total")) {
		return `${ou}${data.handicap}`;
	} else if (data.prop.includes("spread")) {
		let v = parseFloat(data.handicap);
		if (data.under) {
			v *= -1;
		}
		return v < 0 ? v : `+${v}`;
	}

	let prop = `${ou}${data.playerHandicap}`;
	if (!["team_wins"].includes(data.prop)) {
		prop += ` ${convertProp(data.prop)}`;
	}
	return prop;
}

const kellyFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	let dec = data.line / 100;
	if (data.line < 0) {
		dec = 100 / data.line;
	}
	const kelly = parseFloat(data.ev) / Math.abs(dec) / 4;
	return `
		<div class='kelly-cell'>
			<div class='kelly'>${kelly.toFixed(2)}u</div>
			<div class='kelly-wager'>$${(kelly * 10).toFixed(2)}</div>
		</div>
	`;
}

const teamFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	return getTeamImg(SPORT, cell.getValue());
}

function getTeamImg(sport, team) {
	return `<img class='team-img' src='logos/${sport}/${team}.png' alt='${team}' title='${team}' />`;
}

const brlFormatter = function(cell) {
	const data = cell.getRow().getData();
	return isBarrel(data) ? "🏏" : "";
}

const hhFormatter = function(cell) {
	const data = cell.getRow().getData();
	return parseFloat(data.evo || "0") >= 95 ? "💥" : "";
}

const dtFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	if (!cell.getValue()) return "";
	let d = new Date(cell.getValue()+" 10:00");
	if (PLAYER || params.noYear) {
		return d.toLocaleDateString("en-US", {
			month: "short", day: "numeric"
		}).replace(", ", " '");
	} else {
		return d.toLocaleDateString("en-US", {
			month: "short", day: "numeric", year: "2-digit"
		}).replace(", ", " '");
	}
}

function getWindHTML(data) {
	if (!data.weather || !data.weather["wind speed"]) {
		return "";
	}
	if (data.roof) {
		return `Roof`;
	}
	let cond = data.weather["conditions"].toLowerCase().replaceAll(" ", "_");
	if (cond == "breezy_and_mostly_cloudy") {
		cond = "breezy";
	} else if (cond == "possible_drizzle_and_breezy") {
		cond = "possible_drizzle";
	}
	return `
		<img class='weather' src='logos/weather/${cond}.png' alt='${data.weather["conditions"]}' title='${data.weather["conditions"]}'/>
		<span>${data.weather["wind speed"]}</span>
		<img class='wind' src='logos/wind-direction.png' alt='${data.weather["wind dir"]}' title='${data.weather["wind dir"]}' style='${data.weather["transform"]}' />
		<!-- <span>${data.weather["wind dir"]}</span> -->
		
	`;	
}

const windFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	if (!data.game) {
		return "";
	}
	return getWindHTML(data);
}

const ftFormatter = function(cell, params, rendered) {
	if (!cell.getValue()) {
		return "";
	}
	return cell.getValue()+" ft";
}

const playerFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const sport = params.sport || data.sport;
	let player = title(data.player);
	if (PLAYER) {
		player = title(PLAYER);
	}
	if (params.lastName || (MOBILE && cell.getTable().element.id == "table")) {
		player = player.split(" ");
		if (player[player.length-1] == "Hernandez") {
			player = player[0][0] + " " + player[player.length-1];

		} else {
			player = player[player.length-1];
		}
	}

	if (sport && sport.includes("futures")) {
		if (data.prop == "team_wins") {
			return player.toUpperCase()+" Wins";
		} else if (["playoffs", "roty", "mvp", "division"].includes(data.prop)) {
			return `${player.toUpperCase()} ${title(data.prop)}`;
		}
		return player;
	}

	let team = SPORT == "ncaab" ? data.teamId : data.team;
	if (team == undefined) {
		team = "";
	}
	let isPlayerProp = true;

	if (player == "") {
		isPlayerProp = false;
		player = data.prop.replace("_", " ").toUpperCase();
		if (data.prop.includes("ml")) {
			const g = SPORT == "ncaab" ? title(data.game) : data.game.toUpperCase();
			player = data.under ? g.split(" @ ")[1] : g.split(" @ ")[0];
		} else if (data.prop == "total" && SPORT == "ncaab") {
			player = `Total (${data.gameId.toUpperCase()})`;
		} else if (data.prop.includes("away_total") || data.prop.includes("home_total")) {
			player = `${team.toUpperCase()} ${data.prop.replace("home_", "").replace("away_", "").toUpperCase()}`;
		} else if (data.prop.includes("spread")) {
			player = `${team.toUpperCase()} ${data.prop.toUpperCase()}`;
		} else if (["rfi", "gift"].includes(data.prop)) {
			player = "";
		}
	}

	let prop = "";
	if (!["feed", "dingers"].includes(sport) && !params.noProp) {
		prop = propFormatter(cell);
	}
	let gameContainer = "";
	if (["feed", "dingers", "barrels"].includes(sport) || isPlayerProp) {
		let s = ["feed", "dingers", "barrels"].includes(sport) ? "mlb" : sport;
		let t = sport == "ncaab" ? data.teamId : data.team;
		if (TEAM) {
			//t = TEAM;
		}
		if (t) {
			gameContainer = `<img class='team-img' src='logos/${s}/${t}.png' alt='${t}' title='${t}' />`;
		}
	} else {
		gameContainer = getGameImgs(data, params).join("");
	}
	let p = player.replace("TOTAL", "").replace("SPREAD", "");
	if (!params.fullName && p.length > 16) {
		p = p.substr(0,15)+"...";
	}
	return `
		<div class="player-cell">
			<div class='game-container'>${gameContainer}</div>
			${p} ${prop}
		</div>
	`
}

function getGameImgs(data, params) {
	let away = data.awayTeamId || data.game.split(" @ ")[0];
	let home = data.homeTeamId || data.game.split(" @ ")[1];
	let awayAlt = data.game.split(" @ ")[0].toUpperCase();
	let homeAlt = data.game.split(" @ ")[1].toUpperCase();
	if (SPORT == "ncaab") {
		awayAlt = title(awayAlt);
		homeAlt = title(homeAlt);
	}
	let sport = params.sport || data.sport;
	sport = sport.replace("dingers", "mlb").replace("feed", "mlb");
	return [
		`<img class='game-img away' src='logos/${sport}/${away}.png' alt='${awayAlt}' title='${awayAlt}' />`,
		`<img class='game-img home' src='logos/${sport}/${home}.png' alt='${homeAlt}' title='${homeAlt}' />`
	];
}

const gameFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const gameImgs = getGameImgs(data, params);
	return `
		<div class='game-cell'>
			${gameImgs.join("")}
		</div>
	`;
}

const lineFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	const ou = data.under ? "u" : "o";
	return ou+cell.getValue();
}

const uppercaseFormatter = function(cell, params, rendered) {
	if (cell.getValue()) {
		return cell.getValue().toUpperCase();
	}
	return "";
}

function title(str) {
	if (!str) return "";
	return str.split(" ")
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

const titleFormatter = function(cell, params, rendered) {
	return title(cell.getValue());
}

const dtMutator = function(value) {
	return value.slice(0, -5);
}

function fetchFile(file, cb) {
	const url = "https://api.github.com/repos/dailyev/props/contents/static/"+file;
	fetch(url, {
		headers: { "Accept": "application/vnd.github.v3.raw" }
	}).then(response => response.json()).then(res => {
		cb(res)
	}).catch(err => console.log(err));
}

const chartFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const content = document.createElement("span");
	if (!cell.getValue()) {
		return "";
	}
	let values = typeof(cell.getValue()) == "string" ? cell.getValue().split(",") : cell.getValue();

	if (!cell.getField().includes("feed")) {
		values = values.slice(-15);
	}

	//if (params.invert) {
	//	values = values.map(val => val * -1);
	//}

	content.classList.add(params.type);
	content.innerHTML = values.join(",");

	const options = {
		width: 145
	}

	if (params.type == "line") {
		options.fill = "none";
		options.strokeWidth = 2;
		options.stroke = "#50fa7b";
	} else {
		options.fill = function(value) {
			let line = data.playerHandicap || data.handicap || data.daily.line || 0;
			if (cell.getField() == "feed.evo") {
				line = 100.0;
			} else if (cell.getField() == "feed.dist") {
				line = 300.0;
			}
			let cond = parseFloat(value) > parseFloat(line);
			if (data.under) {
				cond = parseFloat(value) < parseFloat(line);
			}
			return cond ? "rgb(56, 142, 60)" : "rgb(211, 47, 47)"
		}
	}

	rendered(function(){
		peity(content, params.type, options);
	});
	return content;
}

function plotMap(data, newX, newY) {
	const colors = newY.map(value => {
		let cond = parseFloat(value) > parseFloat(data.playerHandicap || data.handicap);
		if (data.under) {
			cond = parseFloat(value) < parseFloat(data.playerHandicap || data.handicap);
		}
		return cond ? "rgb(56, 142, 60)" : "rgb(211, 47, 47)";
	});
	const tableData = {
		x: newX,
		y: newY.map(v => v != "0" ? v : 0.25),
		type: "bar",
		text: newY,
		textposition: "inside",
		marker: {
			color: colors
		}
	};
	const layout = {
		title: "Game Logs",
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		dragmode: 'pan',
		margin: { l: 0, r: 0, t: 20, b: 20 },
		xaxis: {
			title: "Dates",
			showgrid: false,
			type: "category",
			rangeslider: {
				visible: true
			},
			range: [newX.length-15.6,newX.length-0.5]
		},
		yaxis: {
			showgrid: false,
			tickmode: "linear",
			dtick: 1,
			fixedrange: true,
			showticklabels: false,
			title: {
				text: data.prop.toUpperCase()
			}
		},
		shapes: [
			{
				type: "line",
				//x0: dtSplits[0], x1: dtSplits.at(-1),
				x0: -0.25, x1: newX.length,
				y0: data.playerHandicap || data.handicap, y1: data.playerHandicap || data.handicap,
				line: {
					color: "#5A5A5A",
					dash: "dash"
				}
			}
		]
	};
	Plotly.newPlot("log-chart", [tableData], layout, { responsive: true});
	setTimeout(() => {
		Plotly.Plots.resize("log-chart")
	}, 100);
}

function linearRegression(x, y) {
	let n = x.length;
	let sumX = math.sum(x);
	let sumY = math.sum(y);
	let sumXY = math.sum(x.map((xi, i) => xi * y[i]));
	let sumXX = math.sum(x.map(xi => xi * xi));

	let slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
	let intercept = (sumY - slope * sumX) / n;

	return { slope, intercept, predictedY: x.map(xi => slope * xi + intercept) };
}

function movingAverage(arr, windowSize) {
	return arr.map((val, idx, fullArr) => {
		let start = Math.max(0, idx-windowSize + 1);
		let subset = fullArr.slice(start, idx + 1);
		return subset.reduce((a,b) => a+b, 0) / subset.length;
	});
}

function renderFeed() {
	const data = TABLE.getSelectedRows()[0].getData();
	let player = data.player;
	let url = `http://localhost:5000`;
	if (!window.location.host.includes("localhost")) {
		url = `https://api-production-3a3b.up.railway.app`;
	}
	fetch(url+`/api/feed?team=${data.team}`, {
		headers: {
			Authorization: `Bearer ${ACCESS_TOKEN}`
		}
	}).then(
		response => response.json()
	).then(res => {

		const data = [];
		for (dt of Object.keys(res[player])) {
			let row = res[player][dt];
			let [y,m,d,p] = dt.split("-");
			row["id"] = dt;
			row["dt"] = `${y}-${m}-${d}`;
			row["player"] = player;
			data.push(row);
		}
		renderFeedTable(data);
	});
}

function renderFeedTable(data) {
	let results = [...new Set(data.map(row => row.result))];
	FEED = new Tabulator("#chart", {
		tooltipsHeader: true,
		data: data,
		layout: "fitDataFill",
		initialSort: [
			//{column: "pa", dir: "desc"},
			{column: "dt", dir: "desc"},
		],
		groupHeader: function(value, count, data, group){
			return `<span style='color: #c8c3bc'>${value.toUpperCase()}</span>`;
		},
		columnDefaults: {
			resizable: false,
			headerSortStartingDir: "desc"
		},
		groupToggleElement: "header",
		columns: [
			{title: "", field: "dt", formatter: dtFormatter, formatterParams: {noYear: true}, hozAlign: "center"},
			{title: "Result", field: "result", width: MOBILE ? 70 : 85, editor:"input", headerFilter:"list",
				headerFilterParams:{
					values:["All", ...results]
				},
				headerFilterFunc: function(headerValue, rowValue) {
					if (headerValue == "All") {
						return true;
					}
					return rowValue === headerValue;
				}
			},
			{title: "Exit<br>Velocity", field: "evo", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, visible: MOBILE ? false : true, formatter: summaryFormatter},
			{title: "Launch<br>Angle", field: "la", hozAlign: "center", sorter: "number", width: MOBILE ? 45 : 60, visible: MOBILE ? false : true, formatter: summaryFormatter},
			{title: "Dist", field: "dist", hozAlign: "center", sorter: "number", formatter: summaryFormatter},
			{title: "HR/Park", field: "hr/park", hozAlign: "center", sorter: "number", width: 65},
			{title: "BRL", field: "brl", hozAlign: "center", width: 30, formatter: brlFormatter},
			{title: "HH", field: "hh", hozAlign: "center", width: 30, formatter: hhFormatter},
		],
		rowFormatter: function(row) {
			if (row.getData().result == "Home Run") {
				row.getCells().map(r => r.getElement().classList.add("homer"));
			}
		}
	});
}

function plotHRGap(showGames = false) {
	const data = TABLE.getSelectedData()[0];
	const abBtwn = data.homerLogs.pa.btwn;
	const maxAB = Math.max(...abBtwn);
	const counts = {};
	abBtwn.forEach(ab => {
		counts[ab] = (counts[ab] || 0) + 1
	});
	const arr = new Array(maxAB + 1).fill(0);
	Object.keys(counts).forEach(ab => {
		arr[ab] = counts[ab];
	});

	let x = Array.from({length: arr.length}, (_, i) => i+1);
	let y = arr;

	if (false) {
		x = [], y = [];
		for (ab of Object.keys(counts)) {
			y.push(ab);
			x.push(arr[ab]);
		}
	}
	const graph = {
		x: x, y: y,
		type: "bar",
		//orientation: "h"
	};
	let layout = {
		title: `${title(data.player)} Career PA Btwn HR`,
		title: {
			text: `${title(data.player)} Career PA Btwn HR`,
		},
		autosize: true,
		showlegend: false,
		responsive: true,
		plot_bgcolor: '#181a1b',
		paper_bgcolor: "#181a1b",
		font: {
			color: "#e8e6e3"
		},
		width: '100%',
		dragmode: MOBILE ? 'pan' : "",
		margin: { l: 40, r: 0, t: 40, b: 40 },
		xaxis: {
			title: "PA btwn HR",
			showgrid: false,
			//range: [0, 50],
			title: {
				text: "PA Between HR"
			}
		},
		yaxis: {
			showgrid: false,
			//tickmode: "linear",
			//dtick: 1,
			//fixedrange: true,
			//showticklabels: false,
			title: {
				text: "Frequency"
			}
		},
		shapes: [
			{
				type: "line",
				x0: data.homerLogs.pa.streak,
				x1: data.homerLogs.pa.streak,
				y0: 0, y1: Math.max(...arr),
				line: {
					color: "#c388ff",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: data.homerLogs.pa.med,
				x1: data.homerLogs.pa.med,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: data.homerLogs.pa.avg,
				x1: data.homerLogs.pa.avg,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			}
		],
		annotations: [
			{
				x: data.homerLogs.pa.streak,
				y: Math.max(...arr),
				text: `${data.homerLogs.pa.streak} PA`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: data.homerLogs.pa.med,
				y: Math.max(...arr) / 2,
				text: `${data.homerLogs.pa.med} Median`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: data.homerLogs.pa.avg,
				y: Math.max(...arr) / 4,
				text: `${data.homerLogs.pa.avg} Avg`,
				showarrow: false,
				xanchor: "left"
			}
		]
	};
	Plotly.newPlot("chart", [graph], layout, { responsive: true, displayModeBar: false});
	setTimeout(() => {
		Plotly.Plots.resize("chart");
	}, 100);
}

const ecrFormatter = function(cell) {
	const data = cell.getRow().getData();
	return data.ecr.pos_rank;
}

function fetchUpdated(repo="props", render=true) {
	const url = `https://api.github.com/repos/dailyev/${repo}/contents/updated.json`;
	fetch(url, {
		headers: { "Accept": "application/vnd.github.v3.raw" }
	}).then(response => response.json()).then(data => {
		if (repo == "lines") {
			data["dingers"] = data;
		}
		UPDATED = data;
		if (PAGE == "bvp") {
			initDatepicker(data["bvp"]);
		} else if (PAGE != "dingers") {
			const [datePart, timePart] = (data[PAGE] || data[SPORT]).split(" ");
			const formattedString = `${datePart}T${timePart.split(".")[0]}`;
			document.querySelector("#updated").innerText = `Updated: ${timeAgo(formattedString)}`;
		} else {
			// Dingers
			fetchData(render);
		}
	}).catch(err => console.log(err));
}