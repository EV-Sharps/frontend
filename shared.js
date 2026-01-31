let TOGGLE_PERCENTILE;
let HTML = "";
let TEAM = "";
let PAGE = "";
let CURRENT_VIEW = "table";
const MOBILE_BREAKPOINT = 600;
let MOBILE = window.innerWidth <= MOBILE_BREAKPOINT;
let ACCESS_TOKEN = "";
let API_BASE = "http://localhost:5001";
let UPDATED = {};
let WEIGHTS = {};
let HEATMAP = {};
let TEST;
let RES, TABLE;
let CSV_DOWNLOADED = false;
let PROP, DATE, MARK, GAME, TODAY, SPORT, PLAYER, DEVIG, WEIGHT, BOOST, PRETTY, IMP, DUE, CSV, BOOK, VIG, MIN, MAX, OU, SIDE, TEAMS, METHOD, REQUIRED;
if (window.location.protocol == "file:" || window.location.host.includes("localhost")) {
	HTML = ".html";
}
if (!window.location.host.includes("localhost")) {
	API_BASE = `https://api-production-3a3b.up.railway.app`;
}

function getToday() {
	let today = new Date();
	today = today.toLocaleDateString("en-US", {day: "2-digit", month: "2-digit", year: "numeric"});
	let [M,D,Y] = today.split("/");
	return `${Y}-${M}-${D}`;
}

/*
<option value="profile">👤 Profile</option>
	<option value="pricing">💳 Pricing</option>
	*/
let PAGE_DROPDOWN = `
	<option disabled style="font-weight:bold; color:#ccc;text-align: center;">⚾⚾⚾ MLB ⚾⚾⚾</option>
	<option value="dingers">💣 Dingers</option>
	<option disabled style="font-weight:bold; color:#ccc;text-align: center;">🏈🏈🏈 NFL 🏈🏈🏈</option>
	<option value="tds">🏈 TDs (Free)</option>
	<option value="live?sport=nfl">🏈 Live (Sharps)</option>
	<option value="nfl">🎯 Props (Sharps)</option>
	<option value="analysis?sport=nfl">🏈 Results</option>
	<option value="main?sport=nfl">🏆 Main (Sharps)</option>
	<option value="bets?sport=nfl">🎟️ Bets (Sharps)</option>
	<option value="movement?sport=nfl">📉 Movement (Sharps)</option>
	<option value="backfields">🏈 Backfields</option>
	<!-- <option value="ranks">📋 Fantasy Ranks</option> -->
	<!-- <option value="futures">🔮 Futures</option> -->
	<!--
	 <option value="feed">📡 Feed</option>
	<option value="mlb">🎯 Props (Sharps)</option>
	<option value="main">🏆 Main (Sharps)</option>
	<option value="bets">🎟️ Bets (Sharps)</option>
	<option value="movement">📉 Movement (Sharps)</option>
	<option value="bvp">🆚 BvP</option>
	<option value="stats">📊 Stats</option>
	<option value="barrels">🏏 Barrels (due)</option>
	<option value="preview">🔍 Pitcher Preview</option>
	<option value="pitcher_mix">📰 Pitcher Mix</option>
	-->
	<option disabled style="font-weight:bold; color:#ccc;">🏒🏀 MISC ⛳⚽</option>
	<!-- <option value="golf">⛳ GOLF Props</option> -->
	<option value="atgs">🏒 Goals</option>
	<option value="live?sport=nhl">🏒 Live (Sharps)</option>
	<option value="atgs2">🏒 2+ Goals</option>
	<option value="nhl">🏒 NHL Props (Sharps)</option>
	<option value="main?sport=nhl">🏒 Main (Sharps)</option>
	<option value="analysis?sport=nhl">🏒 Results</option>
	<option value="threes">🏀 3PTM (Free) </option>
	<option value="pts">🏀 PTS/REB/AST (Analyst) </option>
	<option value="nba">🏀 All NBA Props (Sharps)</option>
	<option value="main?sport=nba">🏀 Main (Sharps)</option>
	<option value="kotc">🏀 KOTC</option>
	<option value="analysis?sport=nba">🏀 Results</option>
	<!-- 
	<option value="ncaafprops">🏈 CFB Props</option>
	<option value="ncaaf">🏈 CFB Main (Sharps)</option>
	-->
	<option value="ncaab">🏀 CBB (Sharps)</option>
	<option value="soccer">⚽ Soccer</option>
	<option value="outliers?sport=nba">🏀 Outliers</option>
	<option value="outliers?sport=nfl">🏈 Outliers</option>
	<option value="outliers?sport=nhl">🏒 Outliers</option>
	<option value="cheat">Cheat Sheets</option>
	<option value="heatmap">🗺️ Heat Map</option>
	<option disabled style="font-weight:bold; color:#ccc;">👤💳 Account 👤💳</option>
	<option value="faq">❓ FAQ</option>
	<option value="profile">👤 Profile</option>
	<option value="pricing">💳 Pricing</option>
`;

setTimeout(() => {
	let selectId = MOBILE ? "#mobile-header" : "#header";
	if (MOBILE && document.querySelectorAll("#mobile-header").length == 0) {
		selectId = "#header";
	}
	let select = document.querySelector(selectId+" #page-select");
	if (!select) {
		select = document.getElementById("page-select");
	}
	select.addEventListener("change", (event) => {
		const page = event.target.value;
		changePage(page);
	});

	if (PAGE == "disclaimer") {
		PAGE_DROPDOWN += `<option value="${PAGE}">${title(PAGE)}</option>`;
	}
	select.innerHTML = PAGE_DROPDOWN;
	if (PAGE == "props") {
		select.value = SPORT;
	} else if (PAGE == "dingers" && KAMBI) {
		select.value = "kambi";
	} else if (PAGE == "outliers") {
		select.value = `outliers?sport=${SPORT}`;
	} else if (PAGE == "live") {
		select.value = `live?sport=${SPORT}`;
	} else if (PAGE == "analysis") {
		select.value = `analysis?sport=${SPORT}`;
	} else if (PAGE == "movement") {
		select.value = `movement?sport=${SPORT}`;
	} else if (PAGE == "bets" && SPORT === "nfl") {
		select.value = "bets?sport=nfl";
	} else if (PAGE == "main" && SPORT === "nfl") {
		select.value = "main?sport=nfl";
	} else if (PAGE == "main" && SPORT === "nhl") {
		select.value = "main?sport=nhl";
	} else if (PAGE == "main" && SPORT === "nba") {
		select.value = "main?sport=nba";
	} else if (PAGE == "main" && SPORT === "ncaab") {
		select.value = "main?sport=ncaab";
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
	} else if (page.includes("main")) { 
		let sport = !page.includes("sport=") ? "mlb" : page.split("?sport=")[1];
		window.location.href = `./main${HTML}?sport=${sport}`;
	} else if (page.includes("bets")) { 
		let sport = !page.includes("sport=") ? "mlb" : page.split("?sport=")[1];
		window.location.href = `./bets${HTML}?sport=${sport}`;
	} else if (page.includes("live")) { 
		let sport = !page.includes("sport=") ? "attd" : page.split("?sport=")[1];
		window.location.href = `./live${HTML}?sport=${sport}`;
	} else if (page.includes("analysis")) { 
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./analysis${HTML}?sport=${sport}`;
	} else if (page.includes("outliers")) {
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./outliers${HTML}?sport=${sport}`;
	} else if (page.includes("cheat")) {
		let sport = !page.includes("sport=") ? "nba" : page.split("?sport=")[1];
		window.location.href = `./cheat${HTML}?sport=${sport}`;
	} else if (page.includes("movement")) {
		let sport = !page.includes("sport=") ? "atgs" : page.split("?sport=")[1];
		window.location.href = `./movement${HTML}?sport=${sport}`;
	} else {
		window.location.href = `./${page}${HTML}`;
	}
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

function downloadCSV() {
	// excel-friendly
	TABLE.download("csv", `${PAGE}.csv`, { bom: true });
}

const timeAgoFormatter = function(cell) {
	return timeAgo(cell.getValue(), short=true);
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

const evOddsFormatter = function(cell) {
	const data = cell.getRow().getData();
	const odds = cell.getValue();
	let cls = "";

	if (!odds) {
		return "";
	}

	if (data.blurred) {
		return `<div class='blurred'>${cell.getValue()}</div>`;
	}

	let res = odds;
	let idx = data.under ? 1 : 0;
	if (data.ev && data.ev >= 0 && parseInt(odds.split("/")[idx]) >= parseInt(data.fairVal || 0)) {
		cls = "#00ff66";
		if (odds.includes("/")) {
			let [o,u] = odds.split("/");
			if (data.under) {
				res = `<span>${o}</span>/<span style='color:${cls}'>${u}</span>`
			} else {
				res = `<span style='color:${cls}'>${o}</span>/<span>${u}</span>`
			}
			return res;
		}
		return `<span style='color:${cls}'>${odds}</span>`;
	}

	return res;
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
		if (["tds", "nfl"].includes(PAGE) && cell.getRow().getData().logs.length != 0) {
			return "0%";
		}
		return "";
	}
	if (cell.getRow().getData().blurred) {
		return "<div class='blurred'>"+cell.getValue()+"</div>";
	}
	return cell.getValue()+"%";
}

const percentFormatterLYR = function(cell, params, rendered) {
	if (!cell.getValue()) {
		return "";
	}
	if (cell.getRow().getData().blurred) {
		return "<div class='blurred'>"+cell.getValue()+"</div>";
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

const pitchMap = {
	CH: "Changeup",
	CU: "Curveball",
	FC: "Cutter",
	EP: "Eephus",
	FO: "Forkball",
	FF: "Fastball",
	KN: "Knuckleball",
	KC: "Knuckle-curve",
	SC: "Screwball",
	SI: "Sinker",
	SL: "Slider",
	SV: "Slurve",
	FS: "Splitter",
	ST: "Sweeper",
	CS: "Circle Change"
};

const pitchFormatter = function(cell) {
	const data = cell.getRow().getData();
	const pitch = cell.getValue();
	return `
	<div class="mix-cell">
		${pitchMap[pitch]}
		<span class="right">${data.pitch_num || ""}</span>
	</div>`;
}

function getMixField(field) {
	if (field == "hr") {
		return "home_run";
	} else if (field == "hh") {
		return "is_hard_hit";
	} else if (field == "brl") {
		return "is_barrel";
	}
	return field;
}

const mixFormatter = function(cell) {
	const data = cell.getRow().getData();
	const pitchNum = cell.getField().split("_")[0];
	let field = getMixField(cell.getField().split("_")[1]);
	const pitch = data[pitchNum+"_type"];
	const left = data.pitch.l[pitch][field] || 0;
	const right = data.pitch.r[pitch][field] || 0;

	return `
		<div class="mix-cell">
			<span>${cell.getValue() || 0}</span>
		</div>
	`;
}

const mixFormatter2 = function(cell) {
	const data = cell.getRow().getData();
	const pitchNum = cell.getField().split("_")[0];
	let field = getMixField(cell.getField().split("_")[1]);
	const pitch = data[pitchNum+"_type"];
	const left = data.pitch.l[pitch][field] || 0;
	const right = data.pitch.r[pitch][field] || 0;
	return `
		<div class="mix-cell">
			<span class="left">${left}</span>
			<span class="right">${right}</span>
			<span>${cell.getValue() || 0}</span>
		</div>
	`;
}

const allowedFormatter = function(cell) {
	const data = cell.getRow().getData();
	const [which, field] = cell.getField().split(".");

	if (data.blurred) {
		return `<div class="blurred">${cell.getValue()}</div>`
	}

	let percent = "";
	let p = "";
	let percentile = data[which][field+"_percentile"];
	if (field == "hr_pa") {
		p = "_rate";
		//percent = "%";
		percentile = data[which]["hr_rate_percentile"];
	}
	const color = getPercentileColor(field, percentile);
	const left = data[which][`hr_l${p}`] || 0;
	const right = data[which][`hr_r${p}`] || 0;

	const leftColor = getPercentileColor(`hr_l${p}`, data[which][`hr_l${p}_percentile`]);
	const rightColor = getPercentileColor(`hr_r${p}`, data[which][`hr_r${p}_percentile`]);
	return `
		<div class="mix-cell">
			<span class="left" style="color:${leftColor}">${left}${percent}</span>
			<span class="right" style="color:${rightColor}">${right}${percent}</span>
			<span style="color:${color}">${cell.getValue() || 0}${percent}</span>
		</div>
	`;
}

function getPitchPercentileColor(value) {
	if (!value) return "";
	// bright green
	if (value >= 90) return '#00ff66';
	if (value >= 80) return '#33cc66';
	if (value >= 60) return '#66cc99';
	if (value >= 55) return '#aaaaaa';
	if (value >= 50) return '#e57373';
	if (value >= 30)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const pitchPercentileFormatter= function(cell) {
	const data = cell.getRow().getData();
	let avg = cell.getValue();
	let field = cell.getField();
	if (field.includes("rate")) {
		avg += "%";
	} else if (["hr"].includes(field)) {
		avg = cell.getValue();
	} else {
		avg = avgFormatter(cell);
	}
	const percentile = data[cell.getField()+"_pct"];
	const color = getPitchPercentileColor(percentile);
	return `
		<div style="color: ${color}">
			${avg}
		</div>
	`;
}

const avgFormatter = function(cell) {
	let v = cell.getValue();
	if (v === "-") {
		return "-";
	}
	v = parseFloat(v);
	if (!Number.isFinite(v)) {
	  return "";
	}
	if (v === 0) {
		return ".000";
	}
	// Keep values >= 1 fully intact, slice only if < 1
	return v < 1 ? String(v.toFixed(3)).slice(1) : v.toFixed(3);
};

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
	if (data.blurred && cell.getField() == "homerLogs.pa.z") {
		return `<div class='blurred'>${diff}</div>`;
	}
	if (diff > 0) {
		return `<div class="positive">+${diff}</div>`;
	}
	return `<div class="">${diff}</div>`;
}

const gapFormatter = function(cell) {
	const data = cell.getRow().getData();
	return `${cell.getValue()}`;
}

function getPercentileColor(field, value) {
	if (!value) return "";
	if (["preview"].includes(PAGE) && ["barrel_batted_rate", "hard_hit_percent", "sweet_spot_percent"].includes(field)) {
		value = 100 - value;
	} else if (field.includes("pitcherData") && ["barrel_batted_rate", "hard_hit_percent", "sweet_spot_percent"].includes(field.split(".").at(-1))) {
		value = 100 - value;
	}
	// bright green
	if (value >= 95) return '#00ff66';
	if (value >= 80) return '#33cc66';
	if (value >= 60) return '#66cc99';
	if (value >= 40) return '#aaaaaa';
	if (value >= 20) return '#e57373';
	if (value >= 5)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const percentileFormatter = function(cell) {
	const data = cell.getRow().getData();
	let field = cell.getField();

	if (data.blurred && !["barrels_per_bip", "hard_hit_percent"].includes(field)) {
		return `<div class='blurred'>${cell.getValue()}</div>`;
	}

	if (!cell.getValue()) {
		if (["game_trends.barrels_per_bip.5G", "game_trends.hard_hit_percent.5G"].includes(field)) {
			return "0";
		}
		return `<div class="negative">0</div>`;
	}

	let cls = "";
	let percentile = data[field+"Percentile"];
	if (["savant", "pitcherData"].includes(field.split(".")[0])) {
		let [_,k] = field.split(".");
		if (field.includes("savant")) {
			percentile = data["savant"][k+"Percentile"];
		} else {
			percentile = data["pitcherData"][k+"Percentile"];
		}
	} else if (field.includes("percs.")) {
		let [_,p] = field.split(".");
		if (field == "percs.hr_pa") {
			p = "hr_rate";
		}
		percentile = data["percs"][p+"_percentile"];
	} else if (field.includes(".")) {
		let [_,k,p] = field.split(".");
		percentile = data["game_trends"][k][p+"Percentile"];
	} else if (field == "pitcherHR_PA") {
		percentile = data["pitcher_hr_rate_percentile"];
	} else if (["hr_pa", "hr_l", "hr_r", "hr_l_rate", "hr_r_rate", "home_run"].includes(field)) {
		percentile = data[`${field}_percentile`];
	}

	const color = getPercentileColor(field, percentile);
	if (percentile >= 80) {
		cls = "positive";
	} else if (percentile <= 20) {
		cls = "negative";
	}
	cls = "";
	let v = "";

	if (TOGGLE_PERCENTILE) {
		v = `${addSuffix(percentile)}`;
	} else {
		let suffix = "";
		if (field.includes("distance")) {
			suffix = " ft";
		} else if (field.includes("percent") || ["barrels_per_bip", "barrel_batted_rate", "hr_pa", "hr_l_rate", "hr_r_rate", "pitcherHR_PA"].includes(field.split(".").at(-1))) {
			suffix = "%";
		}
		v = `${cell.getValue()}${suffix}`;
	}
	return `
		<div class="${cls}" style="color:${color}">${v}</div>
	`;
}

const blurCircaFormatter = function(cell) {
	if (!cell.getRow().getData().circa_blurred) {
		return cell.getValue();
	}
	return `<div class="blurred">${cell.getValue()}</div>`;
}

const blurFormatter = function(cell) {
	if (!cell.getRow().getData().blurred) {
		return cell.getValue();
	}
	return `<div class="blurred">${cell.getValue()}</div>`;
}

const thresholds = {
	"exit_velocity_avg": [87.6, 90.8],
	"la": [0, 26],
	"evo": [0, 95],
	"dist": [0, 300],
	"hard_hit_percent": [35.5, 45.5],
	"barrel_batted_rate": [5.7,11.6],
	"barrels_per_bip": [5.7,11.6],
	"sweet_spot_percent": [29.4, 39.1],
	"flyballs_percent": [20.7, 32.4],
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
	if (data.blurred) {
		cls = "blurred";
	}

	if (field == "la") {
		suffix += "°";
	}
	return `<div class="${cls}">${cell.getValue()}${suffix}</div>`;
}

const laFormatter = function(cell) {
	return cell.getValue()+"°";
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

function getHRFactorColor(pct) {
	if (pct == null) return "";
	if (pct >= 20)  return '#00ff66'; // elite boost
	if (pct >= 10)  return '#33cc66'; // strong boost
	if (pct >= 5)   return '#66cc99'; // mild boost
	if (pct > 0)    return '#99ffcc'; // slight boost
	if (pct >= -1)  return '#aaaaaa'; // neutral
	if (pct >= -4)  return '#e57373'; // slight suppress
	if (pct >= -9)  return '#e53935'; // mild suppress
	if (pct >= -19) return '#d32f2f'; // strong suppress
	return '#ff0000';                  // extreme suppress
}

const bppFormatter = function(cell) {
	const data = cell.getRow().getData();
	const val = parseInt(cell.getValue().replace("%", ""));
	const color = getHRFactorColor(parseInt(cell.getValue()));
	let cls = "";
	if (val >= 10) {
		cls = "positive";
	} else if (val <= -10) {
		cls = "negative";
	}
	return `
		<div style="color: ${color}">
			${cell.getValue()}
		</div>
	`;
}

const impliedFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!cell.getValue()) {
		return "";
	}
	let cls = "";
	//const cls = data.mostLikely == cell.getField().split(".").at(-1) ? "positive" : "";
	return `
		<div class="${cls}">
			${(parseFloat(cell.getValue())).toFixed(1)}%
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
	let team = data.oppId || data.opp;
	let sport = data.sport || SPORT;
	if (params.prop == "k" || params.is_pitcher || sport.includes("ncaa") || sport == "nhl" || sport == "nba") {
		let t = team.toUpperCase();
		return `<div class="opp-cell">
			${ah}
			${getTeamImg(sport, team)}
			${t}
		</div>`;
	}
	let pitcher = "";
	if (PAGE == "preview") {
		pitcher = cell.getValue().toUpperCase();
	} else if (PAGE == "tds" || PAGE == "nfl") {
		pitcher = data.opp.toUpperCase();
	} else if (data.pitcher) {
		pitcher = MOBILE || params.lastName ? title(data.pitcher).split(" ")[1] : title(data.pitcher);
	}
	const badge = data.doubleheader || data.team?.includes("gm2") ? 
		"<span class='dbl-badge'>2</span>" : "";
	const gameContainer = badge ? `<div style='position:relative;'>${badge}${getTeamImg(sport, team)}</div>` : `${getTeamImg(sport, team)}`;
	let pitcherLR = data.pitcherLR || "";
	return `
		<div class="opp-cell" aria-label="${data.pitcherSummary}">
			${ah}
			${gameContainer}
			${pitcher}
			<div class="bats">${pitcherLR}</div>
		</div>
	`;
}

const pitcherFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}

	let cls = data.blurred ? "blurred" : "";
	let [a,h] = data.game.split(" @ ");

	let opp = data.opp;
	if (!opp) {
		opp = a == data.team ? h : a;
	}

	const ah = `<span style="width: 12px;text-align:center;">
		${data.game.split(" @ ")[0] != data.team ? "@" : "v"}
	</span>`;
	return `<div class="opp-cell ${cls}">
			${getTeamImg(SPORT, opp.replace("-gm2", ""))}
			${title(cell.getValue()?.split(" ").at(-1))}
		<span class="bats">${data.pitcherLR || ""}</span>
		</div>`;
}

function addSuffix(num) {
	let j = num % 10, k = num % 100;
	
	if (j == 1 && k != 11) return num + "st";
	if (j == 2 && k != 12) return num + "nd";
	if (j == 3 && k != 13) return num + "rd";
	return num + "th";
}

function getZColorRed(value) {
	if (!value) return "";
	if (value >= 2.0) return '#00ff66'; // bright green
	if (value >= 1.5) return '#33cc66'; // medium green
	if (value >= 1.0) return '#66cc99'; // light green
	if (value >= 0) return '#99ffcc';
	return '#aaaaaa';
}

function getZColor(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const f = parseFloat(value);
  const v = Number(value);

  // Lightness values (kept in readable range for dark bg)
  const L0 = 82; // near 0
  const Lmax = 46; // at |2|

  if (f >= -0.24 && f <= -0.1) {
	return "";
  }

  if (f >= -0.1) {
	// Clamp positives 0–2 → blue scale
	const clamped = Math.min(2, v);
	const L = L0 + (Lmax - L0) * (clamped / 2);
	return `hsl(210 100% ${L}%)`; // Blue
  } else {
	// Clamp negatives [0 → -1] → Orange
	const clamped = Math.max(-1, v); // don’t go below -1
	const L = L0 + (Lmax - L0) * (Math.abs(clamped) / 1); 
	return `hsl(30 100% ${L}%)`; // Orange
  }
}

// optional: readable text color on dark background
function pickTextForLightness(lightness) {
  return lightness >= 62 ? '#0b1220' : '#ffffff'; // dark text on very light cells
}

const homerLogFormatter = function(cell) {
	const data = cell.getRow().getData();
	const field = cell.getField();

	if (data.blurred) {
		return `<div class='blurred'>${cell.getValue()}</div>`;
	}
	if (field.split(".").at(-1).substr(0, 1) != "z") {
		return cell.getValue();
	}

	let z = cell.getValue();
	if (!z) return "0.0";

	z = z.toFixed(1);
	if (z > 0) {
		z = "+"+z;
	}

	const color = getZColor(parseFloat(cell.getValue()));
	return `<div style="color:${color};font-weight:600;">${z}</div>`;

	return `<div>${z}</div>`;
}

function getOppRankColor(value) {
	if (!value) return "";
	if (value >= 27) return '#ff0000';
	if (value >= 22) return '#e53935';
	if (value >= 16) return '#e57373';
	if (value >= 11) return '#aaaaaa';
	if (value >= 6) return '#66cc99';
	if (value >= 2)  return '#33cc66';
	return '#00ff66'; // very low percentile
}

function getTDsOppRankColor(value) {
	if (!value) return "";
	if (value >= 27) return '#00ff66';
	if (value >= 22) return '#33cc66';
	if (value >= 16) return '#66cc99';
	if (value >= 11) return '#aaaaaa';
	if (value >= 6) return '#e57373';
	if (value >= 2)  return '#e53935';
	return '#ff0000'; // very low percentile
}

const stadiumRankFormatter = function(cell) {
	const data = cell.getRow().getData();
	const color = getOppRankColor(data.stadiumRank);
	let cls = "";
	if (data.blurred) {
		cls = "blurred";
	}
	const leftRank = data.stadiumRankLeft;
	const rightRank = data.stadiumRankRight;
	return `
	<div class='mix-cell ${cls}'>
		<div style="color: ${color}">${cell.getValue()}</div>
		<div class="left" style="color: ${getOppRankColor(data.stadiumRankLeft)}">${leftRank}</div>
		<div class="right" style="color: ${getOppRankColor(data.stadiumRankRight)}">${rightRank}</div>
	</div>
	`;
}

const rankingFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	const field = cell.getField();
	if (!data.game || !cell.getValue()) {
		return "";
	}
	if (field == "oppRank" || ["nba", "nhl"].includes(SPORT)) {
		let cls;
		//cls = data.oppRankClass;
		if (data.blurred) {
			cls = "blurred";
		}
		let value = cell.getValue();
		let color;
		if (PAGE == "nfl") {
			const keys = {
				pass_yds: "opp-pass-yds",
				rec_yds: "opp-pass-yds",
				rush_yds: "opp-rush-yds",
				rec: "opp-cmp",
				pass_cmp: "opp-cmp",
				pass_td: "opp-pass-td",
				pass_att: "opp-pass-att",
				rush_att: "opp-rush-att"
			};
			let key = keys[data.prop];
			if (!key || !value[key]) {
				return "";
			}
			value = value[key]["rank"];
			color = getTDsOppRankColor(value);
		} else if (PAGE == "tds") {
			if (value[params.key] === undefined || data.player.includes("d/st")) {
				return "";
			}
			if (params.key == "home-away") {
				const ha = data.team == data.game.split(" ")[0] ? "home" : "away";
				value = value[params.key][ha];
			} else {
				value = value[params.key]["rank"];	
			}
			color = getTDsOppRankColor(value);
		} else if (["nhl", "nba"].includes(SPORT)) {
			color = getTDsOppRankColor(value);
		} else {
			color = getOppRankColor(value);
		}
		
		return `<div class='${cls}' style='color: ${color}'>${addSuffix(value)}</div>`;
	} else {
		if (data.team == "ath") {
			return "";
		}
		let cls = "";
		const color = getOppRankColor(data.stadiumRank);
		if (data.stadiumRank <= 10) {
			cls = "positive";
		} else if (data.stadiumRank >= 20) {
			cls = "negative";
		}
		cls = "";
		if (data.blurred) {
			cls = "blurred";
		}
		return `<div class='${cls}' style='color: ${color}'>${addSuffix(cell.getValue())}</div>`;
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
	//const ev = cell.getValue();
	const pre = BOOK ? `${BOOK}_` : "";
	const ev = data[`${pre}ev`];
	if (ev === undefined) {
		return "";
	}
	if (parseFloat(ev) > 0) {
		return `<div class="positive">+${ev}%<div>`
	}
	return ev+"%";
}

const evFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let ev = cell.getValue();
	if (!ev || data.prop == "separator") return "";
	let cls = "";
	if (parseFloat(ev) > 0) {
		ev = "+"+ev;
		cls = "positive";
	}
	let ou = data.ou || data.daily?.ou || "";

	// Get ROI color for vertical slice
	let borderColor = 'transparent';
	if (["atgs"].includes(PAGE)) {
		const roi = getRowROI(data);
		if (roi !== null) {
			borderColor = roiToColor(roi);
		}
	}
	return `
		<div class='ev-cell' style='border-left: 4px solid ${borderColor};'>
			<span class='ev ${cls}'>${ev}%</span>
			<span class='ou'>${ou}</span>
		</div>
	`;
}

const bvpFormatter = function(cell) {
	const data = cell.getRow().getData();

	let cls = "";
	if (data.blurred && !["bvp"].includes(PAGE)) {
		cls = "blurred";
	}
	return `
		<div class="bvp-cell ${cls}">
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

const bestBookFormatter = function(cell) {
	const data = cell.getRow().getData();
	const book = ["outliers", "atgs2"].includes(PAGE) ? data.outlierBook : data.book;
	let cls = data.blurred ? "blurred" : "";
	let line = data.line;
	if (["outliers", "atgs2"].includes(PAGE)) {
		line = data.outlierLine;
	}
	if (parseInt(line || 0) > 0) {
		line = `+${line}`;
	}
	const img = book ? `<img class='book-img' src='logos/${book.replace('kambi', 'parx')}.png' alt='${book}' title='${book}' />` : "";
	return `
		<div class='evbook-cell ${cls}'>
			<span class='evbook-odds'>${line}</span>
			${img}
		</div>
	`;
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

	if (params.book && (!params.book.includes("vs-") || params.book.includes("-vs-circa") || params.book.includes("-vs-fd"))) {
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
	} else if (PAGE == "bets") {
		line = data.odds;
	}
	let lineInt = parseInt(line);
	let implied = -lineInt / (-lineInt + 100);
	if (lineInt > 0) {
		line = "+"+line;
		implied = 100 / (lineInt + 100);
	}
	implied = parseInt(implied * 100);
	let cls = "evbook-cell";
	if (data.blurred && ![PAGE].includes("dingers")) {
		cls += " blurred";
	}
	return `
		<div class='${cls}'>
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
	let ev = params.circa ? data["vs-circa_ev"] : data.ev;
	const kelly = parseFloat(ev) / Math.abs(dec) / 4;
	return `
		<div class='kelly-cell'>
			<div class='kelly'>${kelly.toFixed(2)}u</div>
			<div class='kelly-wager'>$${(kelly * 50).toFixed(2)}</div>
		</div>
	`;
}

const teamFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (data.prop == "separator") return "";
	return getTeamImg(SPORT, cell.getValue());
}

function getTeamImg(sport, team) {
	if (!team) {
		return "";
	}
	return `<img class='team-img' src='logos/${sport.replace("ncaaf", "ncaab")}/${team.replace("-gm2", "")}.png' alt='${team}' title='${team}' />`;
}

function getBookImgs(books) {
	return books.map(book => book == "best" ? "" : `<img class='book-img' src='logos/${book}.png' alt='${book}' title='${book}' />`).join("");
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
	let cond = data.weather["conditions"].toLowerCase().replace("mostlyclear", "clear").replace("mostlycloudy", "cloudy").replace("partlycloudy", "cloudy").replaceAll(" ", "_");
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
	if (data.blurred) {
		return "<div class='blurred'>"+cell.getValue()+"</div>";
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
	const sport = params.sport || data.sport;
	let player = title(data.player);
	if (PLAYER) {
		player = title(PLAYER);
	}
	if (params.lastName || (MOBILE && cell.getTable().element.id == "table")) {
		player = player.split(" ");
		if (["Hernandez", "Lowe"].includes(player[player.length-1])) {
			player = player[0][0] + " " + player[player.length-1];
		} else if (data.player == "jaylin williams" && data.team == "okc") {
			player = "Jay Williams";
		} else if (data.player == "jalen williams" && data.team == "okc") {
			player = "Jal Williams";
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

	let team = SPORT.includes("ncaa") ? data.teamId : data.team;
	if (team == undefined) {
		team = "";
	}
	let isPlayerProp = true;

	if (player == "") {
		isPlayerProp = false;
		player = data.prop.replace("_", " ").toUpperCase();
		if (data.prop.includes("ml")) {
			const g = SPORT.includes("ncaa") ? title(data.game) : data.game.toUpperCase();
			player = data.under ? g.split(" @ ")[1] : g.split(" @ ")[0];
		} else if (data.prop == "total" && SPORT == "ncaab") {
			player = `Total (${data.gameId.toUpperCase()})`;
		} else if (data.prop == "total" && SPORT == "ncaaf") {
			player = `${data.gameId.toUpperCase()}`;
		} else if (data.prop.includes("away_total") || data.prop.includes("home_total")) {
			player = `${team.toUpperCase()} ${data.prop.replace("home_", "").replace("away_", "").toUpperCase()}`;
		} else if (data.prop.includes("spread")) {
			player = `${team.toUpperCase()} ${data.prop.toUpperCase()}`;
		} else if (data.prop.includes("corners")) {
			player = `${data.prop.toUpperCase()}`;
		} else if (["rfi", "gift"].includes(data.prop)) {
			player = "";
		}
	} else if (["movement"].includes(PAGE)) {
		isPlayerProp = false;
	}

	let prop = "";
	if (!["feed", "dingers", "strikeouts", "backfields"].includes(PAGE) && !params.noProp) {
		prop = propFormatter(cell);
	}
	let gameContainer = "";
	if (["feed", "dingers", "barrels"].includes(PAGE) || isPlayerProp) {
		let s = ["feed", "dingers", "barrels"].includes(PAGE) ? "mlb" : sport;
		if (s == "ncaaf") s = "ncaab";
		let t = sport.includes("ncaa") ? data.teamId : data.team;
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
	let bats = data.bats?.replace("B", "S") || "";
	if (["pitcher_mix", "preview"].includes(PAGE)) {
		bats = data.pitch_hand;
	} else if (["pts", "nba", "threes"].includes(PAGE)) {
		bats = data.avgMin;
	} else if (PAGE == "atgs") {
		bats = data.avgTOI;
	}
	let pos = "";
	if (["nba", "threes", "atgs", "ncaafprops"].includes(PAGE)) {
		pos = data.pos;
	}
	return `
		<div class="player-cell">
			<div class='game-container'>${gameContainer}</div>
			${p} ${prop}
			<div class="bats">${bats || ""}</div>
			<div class="pos">${pos || ""}</div>
		</div>
	`
}

function getGoalieColor(key, val) {
	const v = parseFloat(val);
	if (Number.isNaN(v)) return "";

	if (key === "goalieSV") {
		if (v >= 0.915) return "color: #ff0000";
		if (v >= 0.905) return "color: #e57373";
		if (v <= 0.885) return "color: #00ff66";
		if (v <= 0.894) return "color: #33cc66";
	}

	if (key === "goalieGSAA") {
		if (v >= 10) return "color: #ff0000";
		if (v >= 4) return "color: #e57373";
		if (v <= -9) return "color: #00ff66";
		if (v <= -3) return "color: #33cc66";
	}

	return "";
}

const goalieFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	let goalie = cell.getValue();
	if (goalie) {
		goalie = title(goalie).split(" ").at(-1);
	}
	let sv = "";
	if (data.goalieSV) {
		sv = `<div class="bats" style="${getGoalieColor('goalieSV', data.goalieSV)}">${data.goalieSV}</div>`;
	}
	let gsaa = "";
	if (data.goalieGSAA) {
		gsaa = `<div class="pos" style="${getGoalieColor('goalieGSAA', data.goalieGSAA)}">${data.goalieGSAA}</div>`;
	}
	return `
	<div class="goalie-cell">
		${goalie}
		${sv}
		${gsaa}
	</div>`;
}

const trendFormatter = function(cell, params, rendered) {
	const div = document.createElement("div");
	let val = cell.getValue();
	div.innerText = val;
	const data = cell.getRow().getData();
	let avgVal = data[cell.getField().replace("last", "").toLowerCase()];
	if (cell.getField() != "lastPts") {
		val = parseInt(val.replace("%", ""));
		avgVal = parseInt(avgVal.replace("%", ""));
	}
	if (data["lastSnap"].replace("%", "") != "0") {
		if (val > avgVal) {
			div.classList.add("positive");
		} else if (val < avgVal) {
			div.classList.add("negative");
		}
	}
	return div;
}

function getGameImgs(data, params) {
	let away = data.awayTeamId || data.game.split(" @ ")[0];
	let home = data.homeTeamId || data.game.split(" @ ")[1];
	if (PAGE == "soccer") {
		away = data.awayEspn.short;
		home = data.homeEspn.short;
	}
	if (!data.game) {
		return "";
	}
	let awayAlt = data.game.split(" @ ")[0].toUpperCase();
	let homeAlt = data.game.split(" @ ")[1].toUpperCase();
	if (SPORT.includes("ncaa")) {
		awayAlt = title(awayAlt);
		homeAlt = title(homeAlt);
	}
	let sport = params.sport || data.sport || SPORT;
	sport = sport.replace("dingers", "mlb").replace("k", "mlb").replace("feed", "mlb").replace("ncaaf", "ncaab").replace("atgs", "nhl");
	if (sport == "props") {
		sport = "nfl";
	}
	return [
		`<img class='game-img away' src='logos/${sport}/${away}.png' alt='${awayAlt}' title='${awayAlt}' />`,
		`<img class='game-img home' src='logos/${sport}/${home}.png' alt='${homeAlt}' title='${homeAlt}' />`
	];
}

const gameFormatter = function(cell, params, rendered) {
	const data = cell.getRow().getData();
	if (!data.game) {
		return "";
	}
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
	fetch(API_BASE+`/api/feed?team=${data.team}`, {
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
	let dueData = PAGE == "atgs" ? data.due.g : data.homerLogs.pa;
	const abBtwn = PAGE == "atgs" ? data.due.g.btwn : data.homerLogs.pa.btwn;
	const maxAB = Math.max(...abBtwn);
	const counts = {};
	abBtwn.forEach(ab => {
		counts[ab] = (counts[ab] || 0) + 1
	});
	const arr = new Array(maxAB + 1).fill(0);
	Object.keys(counts).forEach(ab => {
		arr[ab] = counts[ab];
	});

	let x = Array.from({length: arr.length}, (_, i) => PAGE == "atgs" ? i : i+1);
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
	let t = `${title(data.player)} Career PA Btwn HR`;
	let xAxisTitle = "PA btwn HR";
	if (PAGE == "atgs") {
		t = `${title(data.player)} Career Gm Btwn Goals`;
		xAxisTitle = "Gm btwn Goals"
	}
	let layout = {
		title: t,
		title: {
			text: t,
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
			title: xAxisTitle,
			showgrid: false,
			//range: [0, 50],
			title: {
				text: xAxisTitle
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
				x0: dueData.streak,
				x1: dueData.streak,
				y0: 0, y1: Math.max(...arr),
				line: {
					color: "#c388ff",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: dueData.med,
				x1: dueData.med,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			},
			{
				type: "line",
				x0: dueData.avg,
				x1: dueData.avg,
				y0: 0, y1: Math.max(...arr) / 2,
				line: {
					color: "#ffcc00",
					dash: "dash"
				}
			}
		],
		annotations: [
			{
				x: dueData.streak,
				y: Math.max(...arr),
				text: `${dueData.streak} ${PAGE == "atgs" ? "GM" : "PA"}`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: dueData.med,
				y: Math.max(...arr) / 2,
				text: `${dueData.med} Median`,
				showarrow: false,
				xanchor: "left"
			},
			{
				x: dueData.avg,
				y: Math.max(...arr) / 4,
				text: `${dueData.avg} Avg`,
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
	const field = cell.getField();
	if (field == "ecr.rank_ecr") {
		return data.ecr.pos_rank;	
	}
	return data.pos_rank;
}

const plusFormatter = function(value) {
	if (value > 0 && !String(value).includes("+")) {
		return `+${value}`;
	}
	return value;
}

const diffFormatter = function(cell) {
	const data = cell.getRow().getData();
	let val = cell.getValue();
	let cls = "";
	if (parseInt(val) > 0) {
		cls = "positive";
		val = `+${val}`;
	} else if (parseInt(val) < 0) {
		cls = "negative";
	}
	return `<div class="${cls}">${val}</div>`;
}

const DEFAULT_FIELDS_ALL = [
	"ev", "fairVal", "implied", "kelly", "player", "book", "bookOdds_fd", "bookOdds_b365", "bookOdds_dk", "bookOdds_mgm", "bookOdds_cz", "bookOdds_fn", "bookOdds_hr", "bookOdds_br", "bookOdds_kambi", "bookOdds_pn", "bookOdds_circa", "order", "pitcher", "percs_hr_pa", "bvp", "bpp", "savant_exit_velocity_avg", "savant_barrels_per_bip", "pitcherData_flyballs_percent", "pitcherData_exit_velocity_avg", "pitcherData_barrel_batted_rate", "oppRank", "homerLogs_pa_streak", "homerLogs_pa_med", "homerLogs_pa_z_median", "weather",
	"stadiumRank", "stadiumRankLeft", "stadiumRankRight", "batter_percs_hr_pa", "batter_percs_home_run"
];

const DEFAULT_SHARED = [
	"ev", "book", "player", "fairVal", "implied", "kelly", "opp",
	"bookOdds_fd", "bookOdds_b365", "bookOdds_dk", "bookOdds_mgm", "bookOdds_cz", "bookOdds_fn", "bookOdds_hr", "bookOdds_br", "bookOdds_kambi", "bookOdds_pn", "bookOdds_circa", "bookOdds_espn", "bookOdds_bv", "bookOdds_bol", "bookOdds_fl", "bookOdds_re", "logs", "hitRate", "hitRateLYR"
]
const DEFAULT_FIELDS = {
	tds: [...DEFAULT_SHARED, "oppRank"],
	atgs: [...DEFAULT_SHARED, "hitRateCareer", "oppRank", "dvpRank", "goalie", "ppLine"],
	nfl: [...DEFAULT_SHARED, "handicap", "oppRank"],
	nhl: [...DEFAULT_SHARED, "handicap", "oppRank", "dvpRank", "goalie", "ppLine"],
	strikeouts: [...DEFAULT_SHARED, "handicap", "oppRank"],
	mlb: [...DEFAULT_SHARED, "handicap"],
	nba: [...DEFAULT_SHARED, "oppRank", "oppPosRank"]
};

function getNestedFields(defs, out = []) {
	defs.forEach(def => {
		if (def.columns) {
			getNestedFields(def.columns, out);
		} else if (def.field) {
			out.push(def.field);
		}
	});
	return out;
}

function parseWeightKey(key) {
	let [bookKey, weightKey] = key.split(";");
	if (!weightKey) {
		return "Mkt Avg";
	}
	let weights = weightKey.split("+");

	let totalWeight = weights.reduce((acc, val) => {
		return acc + parseFloat(val);
	}, 0);


	let raw = [], rawSet = new Set(), percs = [];
	weights.map((weight, idx) => {
		raw.push(weight);
		rawSet.add(weight);
		percs.push(Math.round(weight * 100 / totalWeight));
	});

	let text = "";
	if (bookKey.includes("only")) {
		text = "Only ";
	}

	const books = bookKey.replace("only+", "").split("+");
	text += `${books.map(book => book.toUpperCase()).join("/")}`;
	if (raw.length > 1 && rawSet.size == 1) {
		text += ` ${Math.round(100 / books.length)}% Equal`;
	} else {
		text += ` ${percs.map(p => p+"%").join("/")}`;
	}
	return text;
}

function setUrlParams(updates = {}) {
	let url = new URL(window.location.href);
	const params = new URLSearchParams(window.search);
	
	Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "") {
            params.delete(k);
        } else {
            params.set(k, String(v));
        }
    });
	const newUrl = `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
	history.pushState({}, '', newUrl);
	return newUrl;
}

function loadWeights() {
	DEVIG = DEVIG || CURR_USER.metadata[`${PAGE}-devig`] || "";
	if (DEVIG && DEVIG.includes("only+")) {
		DEVIG = DEVIG.replace("only+", "");
	} else if (DEVIG.includes(";")) {
		[DEVIG, WEIGHT] = DEVIG.split(";");
	}

	METHOD = METHOD || CURR_USER.metadata[`${PAGE}-method`] || "";
	if (METHOD) {
		document.getElementById("method-select").value = METHOD;
		setUrlParams({method: METHOD});
	}

	if (!CURR_USER.metadata["weights"] || !Array.isArray(CURR_USER.metadata["weights"])) {
		CURR_USER.metadata["weights"] = [];
	}

	// legacy remove any old weights
	CURR_USER.metadata["weights"] = CURR_USER.metadata["weights"].filter(x => x.includes(";"));

	let userWeights = CURR_USER.metadata["weights"];

	// legacy to grab old saved devigs
	for (devig of (CURR_USER.metadata["custom_devigs"] || [])) {
		if (devig) {
			let newDevig = `${devig}${repeatOnes(devig)}`;
			if (!userWeights.includes(newDevig)) {
				userWeights.push(newDevig);
			}
		}
	}

	delete CURR_USER.metadata["custom_devigs"];

	if (document.getElementById("devig-display-text")) {
		document.getElementById("devig-display-text").textContent = parseWeightKey(`${DEVIG};${WEIGHT}`);
	} else {
		const customOption = document.getElementById("custom-devig-option");
		const devigSel = document.getElementById("devig-select");
		const fragment = document.createDocumentFragment();
		for (weight of userWeights) {
			const newOption = document.createElement("option");
			newOption.value = weight;
			newOption.textContent = parseWeightKey(weight);
			fragment.appendChild(newOption);
		}
		devigSel.insertBefore(fragment, customOption);
	}

	if (DEVIG) {
		reorderOddsColumns(BOOK, DEVIG);
	}
}

function showHideUserTable(loaded) {
	if (ENABLE_AUTH && CURR_USER && CURR_USER?.metadata) {
		if (!loaded && typeof parseWeightKey === 'function') {
			loadWeights();
		}
		if (!CURR_USER.metadata[PAGE]) {
			return;
		}
		const allowed = new Set(CURR_USER.metadata[PAGE]);
		const defs = TABLE.getColumnDefinitions();
		const nestedFields = getNestedFields(defs);

		nestedFields.forEach(field => {
			const metaKey = field.replace(/\./g, "_");
			if (!allowed.has(metaKey) && metaKey != "opp" && metaKey != "handicap" && metaKey != "prop" && !metaKey.includes("due")) {
				TABLE.getColumn(field)?.hide();
			} else {
				TABLE.getColumn(field)?.show();
			}
		});
	}
}

function closeOverlay() {
	document.querySelector("#overlay").style.display = "none";
	//showHideUserTable();
}

function openOverlay() {
	if (CURR_USER?.tier || "free" === "free") {
		//return;
	}
	const metadata = CURR_USER?.metadata || {};
	if (!metadata[PAGE]) {
		metadata[PAGE] = DEFAULT_FIELDS[PAGE] || DEFAULT_SHARED;
		if (MOBILE) {
			metadata[PAGE] = metadata[PAGE].filter(x => x != "curr_kelly");
			metadata[PAGE] = metadata[PAGE].filter(x => x != "curr_implied");
		}
	}
	document.querySelector("#overlay").style.display = "flex";

	const items = document.querySelector("#items");
	//items.innerHTML = "";

	for (field of metadata[PAGE] || []) {
		const el = document.querySelector(`#custom_${field.replaceAll(".", "_")}`);
		if (el) {
			el.checked = true;
		}
	}

	const currentFavorites = new Set(getFavoriteDevigs());
	let customDevigs = getCustomDevigs().map(key => ({
		name: parseWeightKey(key),
		value: key,
		group: "custom"
	}));;
	let favorites = getFavoriteDevigs().map(key => ({
		name: parseWeightKey(key),
		value: key,
		group: "favorites"
	}));
	const allOptions = [...DEFAULT_DEVIGS, ...favorites, ...customDevigs.filter(opt => !currentFavorites.has(opt.value))];

	let customDevigSel = document.getElementById("custom-devig-select");
	customDevigSel.innerHTML = "<option disabled style='font-weight:bold; color:#ccc;'>Default</option>";

	for (opt of allOptions) {
		let o = document.createElement("option");
		o.value = opt.value;
		o.textContent = opt.name;
		customDevigSel.appendChild(o);
	}

	// legacy to transform saved devigs to new weighted
	// fd+circa -> fd+circa;1+1
	let oldCustomDevig = metadata[`${PAGE}-devig`] || "";
	if (oldCustomDevig && !oldCustomDevig.includes(";")) {
		oldCustomDevig += repeatOnes(oldCustomDevig);
	}
	customDevigSel.value = oldCustomDevig;
	if (typeof renderWeightSettings === "function") {
		renderWeightSettings();
	}
}

function repeatOnes(customDevig) {
	let repeat = "+1".repeat(customDevig.replace("only+", "").split("+").length - 1);
	return ";1"+repeat
}

function openCustomDevig() {
	// Available books (keep in sync with your data keys)
	const ALL_BOOKS = ["fd","dk","b365","mgm","espn","cz","fn","br","bv","hr","kambi","bol","pn","circa"];

	// build lightweight modal
	const wrap = document.createElement('div');
	wrap.id = 'custom-devig-modal';
	wrap.style.cssText = `
	position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
	background:rgba(0,0,0,.45);z-index:9999;
	`;
	const card = document.createElement('div');
	card.id = "custom-devig-card";
	card.style.cssText = `
	background:#111; color:#eee; border:1px solid #333; border-radius:10px;
	width:min(560px,92vw); max-height:90vh; overflow:auto; padding:16px 18px; box-shadow:0 10px 30px rgba(0,0,0,.4);
	`;
	card.innerHTML = `
	<h3 style="margin:0 0 8px">Custom Devig</h3>
	<div id="weighting-body" style="display:flex;gap: 20px;">
		<div style="display:flex;flex-direction:column;justify-content: center;align-items: center;gap:10px;">
			<div id="weight-chart-section" style="display: flex; justify-content: center;">
				<div id="weight-pie-chart" style="width:250px; height:250px;"></div>
			</div>
		</div>
		<div id="book-weight-inputs"></div>
	</div>

	<div style="display:flex;gap:8px;justify-content:flex-end">
		<button id="cd-apply">Add Devig</button>
		<button id="cd-equal">Equal</button>
		<button id="cd-clear">Clear</button>
		<button id="cd-cancel">Close</button>
	</div>
	`;

	wrap.appendChild(card);
	document.body.appendChild(wrap);

	if (typeof renderWeightSettings === 'function') {
		renderWeightSettings();
	}

	function closeModal() {
		wrap.remove();
		document.querySelector("#devig-select").value = DEVIG;
		changeFilter();
	}

	card.querySelector('#cd-cancel').onclick = closeModal;

	card.querySelector("#cd-clear").onclick = () => {
		clearWeights();
	}

	card.querySelector("#cd-equal").onclick = () => {
		equalWeights();
	}

	if (typeof saveWeights === 'function') {
		card.querySelector('#cd-apply').onclick = saveWeights;
	}
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

function getImpliedProbabilityFromOddsString(oddsString, legIndex) {
	if (!oddsString) return null;
	
	const isSplit = String(oddsString).includes('/');
	
	let token;
	if (isSplit) {
		token = String(oddsString).split('/')[legIndex];
	} else {
		if (legIndex === 1) return null;
		token = String(oddsString);
	}
	
	const num = Number(token);
	return isNaN(num) ? null : americanToImplied(num); 
}

function computeOutlierFromBookOdds(rowData) {
	const bookOdds = rowData.bookOdds;
	let bookFilter = document.getElementById("book-select").value;
	if (!bookOdds || (bookFilter && !bookOdds[bookFilter])) return { book: null, value: null, deviation: 0, pct: 0 };

	const legIndex = rowData.under ? 1 : 0;

	let entries, avgP;
	let excluded = getExcludedBooks();
	excluded.push("pn"); excluded.push("circa");

	if (REQUIRED.length > 0) {
		const hasAllRequired = REQUIRED.every(book => bookOdds[book]);
		if (!hasAllRequired) {
			return { book: null, value: null, deviation: 0, pct: 0 };
		}
	}

	if (DEVIG) {
		let p_devig;

		if (DEVIG.includes("+")) {
			const devigBooks = DEVIG.split("+");
			let sumImpliedP = 0;
			let count = 0;
			
			for (const book of devigBooks) {
				const oddsString = bookOdds[book];
				if (oddsString) {
					const p = getImpliedProbabilityFromOddsString(oddsString, legIndex);
					if (p != null) {
						sumImpliedP += p;
						count += 1;
					}
				}
			}

			if (count === 0) {
				return { book: null, value: null, deviation: 0, pct: 0 };
			}
			
			// Average implied probability across the composite books
			p_devig = sumImpliedP / count;
		} else {
			const devigVal = bookOdds[DEVIG];
			
			// Check for edge cases where odds are missing or invalid for a single book
			if (!devigVal || (rowData.under && !String(devigVal).includes("/") && !rowData.prop.includes("vs-"))) {
				 return { book: null, value: null, deviation: 0, pct: 0 };
			}

			p_devig = getImpliedProbabilityFromOddsString(devigVal, legIndex);
		}

		if (p_devig == null) {
			return { book: null, value: null, deviation: 0, pct: 0 };
		}

		let best = { book: null, value: null, deviation: -Infinity, pct: 0 };

		// Add the single book DEVIG to the excluded list to avoid comparing 
		// a book against itself if DEVIG is a single book.
		const devigExclusions = String(DEVIG).split("+");
		devigExclusions.forEach(b => excluded.push(b));
		
		Object.entries(bookOdds)
			.filter(([book]) => !excluded.includes(book) && (!bookFilter || bookFilter == book)) 
			.forEach(([book, val]) => {
				const p = getImpliedProbabilityFromOddsString(val, legIndex);

				if (p != null) {
					const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
					const num = Number(token);
					
					const dev = p_devig - p;
					const pct = p_devig !== 0 ? dev / p_devig : 0;  

					if (dev > best.deviation) {
						best = { book, value: num, deviation: dev, pct };
					}
				}
			});

		if (best.deviation <= 0) return { book: null, value: null, deviation: 0, pct: 0 };

		return best;
	} else {
		entries = Object.entries(bookOdds)
		.map(([book, val]) => {
			if (!String(val).includes("/") && legIndex == 1) {
				return [null, null, null];
			}
			const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
			const num = Number(token);
			const p = americanToImplied(num);
			return [book, num, p]; // [book, american, impliedProb]
		})
		.filter(([, num, p]) => !isNaN(num) && p != null);

		if (entries.length < 2) return { book: null, value: null, deviation: 0, pct: 0 };

		// Average implied probability across books
		avgP = entries.reduce((a, [, , p]) => a + p, 0) / entries.length;

		let best = { book: null, value: null, deviation: -Infinity, pct: 0 };

		entries.forEach(([book, american, p]) => {
			if ((bookFilter && book != bookFilter) || excluded.includes(book)) {
				return;
			}
			const dev = avgP - p;
			const pct = avgP !== 0 ? dev / avgP : 0;
			if (dev > best.deviation) {
			  best = { book, value: american, deviation: dev, pct };
			}
		});

		if (best.deviation <= 0) return { book: null, value: null, deviation: 0, pct: 0 };

		return best;
	}
}

function computeOutlierFromBookOddsLow(rowData) {
  const bookOdds = rowData.bookOdds;
  if (!bookOdds) return { book: null, value: null, deviation: 0, pct: 0, refBook: null, refValue: null };

  // pick Over (index 0) or Under (index 1) leg from "a/b" strings
  const legIndex = rowData.under ? 1 : 0;

  // Parse selected leg and convert to implied probability
  const entries = Object.entries(bookOdds)
	.map(([book, val]) => {
		if (rowData.under && !String(val).includes("/")) {
			return null;
		}
		const token = String(val).includes('/') ? String(val).split('/')[legIndex] : String(val);
		const american = Number(token);
		const p = americanToImplied(american);
		return isNaN(american) || p == null ? null : [book, american, p];
	})
	.filter(Boolean);

  if (entries.length < 2) return { book: null, value: null, deviation: 0, pct: 0, refBook: null, refValue: null };

  // Find the best (lowest implied probability) — our reference
  let best = entries[0];
  for (const e of entries) if (e[2] < best[2]) best = e; // compare by implied prob
  const [refBook, refAmerican, refP] = best;

  // Deviation from the lowest book: gap = p - refP (in probability points)
  // Return the book with the *largest* gap (worst vs. best).
  let worst = { book: null, value: null, deviation: -Infinity, pct: 0, refBook, refValue: refAmerican };
  for (const [book, american, p] of entries) {
	const gap = p - refP;                    // ≥ 0; 0 for the best itself
	const pct = refP !== 0 ? gap / refP : 0; // relative to best's implied prob
	if (gap > worst.deviation) {
	  worst = { book, value: american, deviation: gap, pct, refBook, refValue: refAmerican };
	}
  }

  return worst; // 'deviation' is the gap vs. the best (lowest implied prob)
}

// --- probit helper functions (Acklam inverse CDF + erf-based CDF) ---
function inverseNormalCDF(p) {
	// Peter John Acklam's approximation
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a1 = -39.69683028665376, a2 = 220.9460984245205, a3 = -275.9285104469687, a4 = 138.3577518672690, a5 = -30.66479806614716, a6 = 2.506628277459239;
	const b1 = -54.47609879822406, b2 = 161.5858368580409, b3 = -155.6989798598866, b4 = 66.80131188771972, b5 = -13.28068155288572;
	const c1 = -0.007784894002430293, c2 = -0.3223964580411365, c3 = -2.400758277161838, c4 = -2.549732539343734, c5 = 4.374664141464968, c6 = 2.938163982698783;
	const d1 = 0.007784695709041462, d2 = 0.3224671290700398, d3 = 2.445134137142996, d4 = 3.754408661907416;
	const plow = 0.02425, phigh = 1 - plow;
	let q, r;
	if (p < plow) {
		q = Math.sqrt(-2 * Math.log(p));
		return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
				((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
	} else if (p > phigh) {
		q = Math.sqrt(-2 * Math.log(1 - p));
		return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
				((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
	} else {
		q = p - 0.5;
		r = q * q;
		return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
				(((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
	}
}

function erf(x) {
	// Abramowitz & Stegun approximation
	const sign = x < 0 ? -1 : 1;
	x = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * x);
	const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
	const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
	return sign * y;
}

function normalCDF(x) {
	return 0.5 * (1 + erf(x / Math.SQRT2));
}

function getProbit(impliedOver, impliedUnder) {
	let probit = NaN;
	try {
        const zOver = inverseNormalCDF(impliedOver);
        const zUnder = inverseNormalCDF(impliedUnder);
		const overDevigged = zOver - 0.5 * (zOver + zUnder);
		probit = normalCDF(overDevigged);
    } catch (e) {
        probit = NaN;
    }
	return probit;
}

function devig(ou, finalOdds, promo, isUnder = false, manualVig = "") {
	const parts = String(ou).split("/");
	if (!parts[0]) return;

	let over = parseInt(parts[0], 10);
	if (!Number.isFinite(over)) return;

	let impliedOver = americanToImplied(over);
	const bet = 100;
	let profit = (finalOdds >= 0)
		? (finalOdds * bet / 100)
		: (100 * bet) / Math.abs(finalOdds);

	let under;
	if (ou.indexOf("/") === -1 || parts.length < 2 || parts[1] === "") {
		let vig = (promo == "vs-fd") ? 0.05 : 0.07;
		if (PAGE == "atgs2") {
			vig = 0;
		}
		if (manualVig != "") {
			vig = parseInt(manualVig);
		}
		const u = 1 + vig - impliedOver;
		if (u >= 1) return;

		if (over > 0) {
			under = Math.trunc((100*u) / (-1 + u));
		} else {
			under = Math.trunc((100 - 100 * u) / u);
		}
		if (isUnder) {
			let tmpUnder = under;
			under = over;
			over = tmpUnder;
			impliedOver = americanToImplied(over);
		}
	} else {
		under = parseInt(parts[1], 10);
	}

	if (!Number.isFinite(under)) return;
	let impliedUnder = americanToImplied(under);

	let x = impliedOver;
	let y = impliedUnder;
	let iter = 0;

	while (Math.abs((x + y) - 1) > 1e-8 && iter < 50) {
		const sum = x + y;
		const k = Math.log(2) / Math.log(2 / sum);
		x = Math.pow(x, k);
		y = Math.pow(y, k);
		iter += 1;
	}

	const implied = round2(x * 100);

	// Multiplicative and additive methods (your “mult” and “add”)
	const mult = impliedOver / (impliedOver + impliedUnder);
	const add = impliedOver - (impliedOver + impliedUnder - 1) / 2;

	// EV via each method, take the minimum (your approach)
	const methods = [x, mult, add];

	let fairVal = Math.min(...methods);
	const dec = 1 / fairVal;
	if (dec >= 2) {
		fairVal = Math.round((dec - 1) * 100);
	} else {
		fairVal = Math.round(-100 / (dec - 1));
	}

	const fairValue = Math.min(...methods);
	const evs = methods.map(m => {
		const ev = m * profit + (1 - m) * (-1 * bet);
		return round1(ev);
	});
	let ev = Math.min(...evs);

	if (promo == "no-sweat") {
		// Modest 70% conversion
		x = 0.70
		ev = ((100 * (finalOdds / 100 + 1)) * fairValue - 100 + (100 * x));
		ev = round1(ev);
	}

	const kelly = getKelly(finalOdds, ev);
	return { ev, fairVal, implied, kelly };
}

function getFV(val, under, method = "") {
	let fv;
	if (under) {
		if (val.includes("/")) {
			let [o,u] = val.split("/");
			val = `${u}/${o}`;
			fv = getFairValue(val);
		} else {
			val = parseInt(val);
			const implied = (val > 0)
				? 100 / (val+100) : -val / (-val+100);
			fv = 1 - implied;
		}
	} else {
		fv = getFairValue(val);
	}
	return fv;
}

function getFairValue(ou) {
	over = parseInt(ou.split("/")[0]);
	const impliedOver = (over > 0)
		? 100 / (over+100) : -over / (-over+100);

	let under = "";
	if (!ou.includes("/")) {
		u = 1.07 - impliedOver;
		if (u > 1) return;
		under = (over > 0)
			? parseInt((100*u) / (-1+u)) : parseInt((100 - 100*u) / u);
	} else {
		under = parseInt(ou.split("/")[1]);
	}

	const impliedUnder = (under > 0)
		? 100 / (under+100) : -under / (-under+100);

	// power method
	let x = impliedOver;
	let y = impliedUnder;
	let iter = 0;

	while (Math.abs((x + y) - 1) > 1e-8 && iter < 50) {
		const sum = x + y;
		const k = Math.log(2) / Math.log(2 / sum);
		x = Math.pow(x, k);
		y = Math.pow(y, k);
		iter += 1;
	}

	const mult = impliedOver / (impliedOver + impliedUnder);
	const add = impliedOver - (impliedOver + impliedUnder - 1) / 2;

	const methods = [x, mult, add];
	const fairValue = Math.min(...methods);

	if (METHOD === "mult") {
		return mult;
	} else if (METHOD === "add") {
		return add;
	} else if (METHOD === "power") {
		return x;
	} else if (METHOD === "probit") {
		return getProbit(impliedOver, impliedUnder);
	}
	return fairValue;
}

function getKelly2(finalOdds, implied) {
  const p = implied / 100;
  let b;

  if (finalOdds > 0) {
	b = finalOdds / 100;
  } else {
	b = 100 / Math.abs(finalOdds);
  }

  const kelly = ((p * b - (1 - p)) / b) / 4; // quarter Kelly
  return Number(kelly.toFixed(2));
}

function getKelly(finalOdds, ev) {
  let p = finalOdds / 100;
  if (finalOdds < 0) {
	p = 100 / finalOdds;
  }
  
  return ev / Math.abs(p) / 4;
}

function averageCustomSharps(bookOdds, devigBook, isUnder = false) {
	let pn = bookOdds.pn;
	let circa = bookOdds.circa;
	let overs = [];
	let unders = [];

	for (book of devigBook.split("+")) {
		let odds = bookOdds[book];
		if (!odds) {
			continue;
		}
		if (odds.includes("/")) {
			let [o,u] = odds.split("/");
			overs.push(americanToImplied(o));
			unders.push(americanToImplied(u));
		} else {
			overs.push(americanToImplied(odds));
		}
	}
	
	if (overs && overs.length > 0) {
		overs = overs.reduce((sum, val) => sum + val, 0) / overs.length;
		overs = impliedToAmerican(overs);

		if (unders && unders.length > 0) {
			unders = unders.reduce((sum, val) => sum + val, 0) / unders.length;
			unders = impliedToAmerican(unders);
		}
		if (unders) {
			return isUnder ? `${unders}/${overs}` : `${overs}/${unders}`;
		} else {
			return unders;
		}
	}
	return "";
}

function averageSharps(bookOdds, isUnder = false) {
	let pn = bookOdds.pn;
	let circa = bookOdds.circa;
	let overs = [];
	let unders = [];
	if (pn) {
		let [o,u] = pn.split("/");
		overs.push(americanToImplied(o));
		unders.push(americanToImplied(u));
	}
	if (circa) {
		let [o,u] = circa.split("/");
		overs.push(americanToImplied(o));
		unders.push(americanToImplied(u));
	}
	
	if (overs && overs.length > 0) {
		overs = overs.reduce((sum, val) => sum + val, 0) / overs.length;
		overs = impliedToAmerican(overs);

		if (unders && unders.length > 0) {
			unders = unders.reduce((sum, val) => sum + val, 0) / unders.length;
			unders = impliedToAmerican(unders);
		}
		if (unders) {
			return isUnder ? `${unders}/${overs}` : `${overs}/${unders}`;
		} else {
			return unders;
		}
	}
	return "";
}

// Convert American odds → implied probability
function americanToImplied(odds) {
  odds = parseInt(odds, 10);
  if (isNaN(odds)) return null;
  return odds > 0
	? 100 / (odds + 100)
	: Math.abs(odds) / (Math.abs(odds) + 100);
}

// Convert implied probability → American odds
function impliedToAmerican(prob) {
  if (prob <= 0 || prob >= 1) return null;
  return prob >= 0.5
	? -Math.round((prob / (1 - prob)) * 100)
	: Math.round(((1 - prob) / prob) * 100);
}

function americanToDecimal(a) {
  a = Number(a);
  if (!Number.isFinite(a)) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
function decimalToAmerican(d) {
  if (!(d > 1)) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

function getAverageImplied(books, under) {
	const skipUnder = new Set(["kambi"]);
	const impliedProbs = Object.entries(books)
		.filter(([book, val]) => {
			if (val === null || val === "") return false;
			const hasSlash = String(val).includes("/");

			if (under) {
				if (skipUnder.has(book)) return false;
				if (!hasSlash) return false;
			}
			return true;
		})
		.map(([b, val]) => {
		  // Handle "over/under" format like "200/-250"
		  const parts = String(val).split("/");
		  const odd = under ? parts[parts.length - 1] : parts[0];
		  const num = parseInt(odd, 10);
		  if (Number.isNaN(num)) return null;
		  return americanToImplied(odd);
		})
		.filter((p) => p != null);

	if (impliedProbs.length === 0) return null;

	const avgProb = impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length;
	const avgAmerican = impliedToAmerican(avgProb);

	return { avgProb, avgAmerican };
}

function buildOU(books, isUnder) {
	const over = getAverageImplied(books, false)?.avgAmerican ?? "-";
	const under = getAverageImplied(books, true)?.avgAmerican ?? "-";

	let ou = isUnder ? `${under}/${over}` : `${over}/${under}`;

	// mirror:
	// if ou == "-/-" or startswith "-/" or "0/" → skip (return null)
	if (ou === "-/-" || ou.startsWith("-/") || ou.startsWith("0/")) return null;

	// if endswith "/-" or "/0" → keep only over side
	if (ou.endsWith("/-") || ou.endsWith("/0")) {
		ou = ou.split("/")[0];
	}
	return ou;
}

function averageDevigs(bookOdds, highest, isUnder, weights) {
	let totalWeight = 0;
	let fairVals = 0;
	const devigBooks = DEVIG.replace("only+", "").split("+");
	Object.entries(bookOdds)
		//.filter(([book, val]) => val && book != highest && (!DEVIG || devigBooks.includes(book)))
		.filter(([book, val]) => val && (!DEVIG || (!DEVIG.includes("+") || book != highest) || devigBooks.includes(book)))
		.forEach(([book, val]) => {
			let fv;

			if (isUnder) {
				if (val.includes("/")) {
					let [o,u] = val.split("/");
					val = `${u}/${o}`;
					fv = getFairValue(val);
				} else {
					val = parseInt(val);
					const implied = (val > 0)
						? 100 / (val+100) : -val / (-val+100);
					fv = 1 - implied;						
					//fv = (1.07 - implied) / 1.07;
				}
			} else {
				fv = getFairValue(val);
			}
			const weight = weights[book] || 0;

			if (weight) {
				totalWeight += weight;
				fairVals += weight * fv;
			}
		});

	if (totalWeight == 0) return NaN;

	return fairVals / totalWeight;
}

function applyProfitBoost(american, boost) {
	const D = americanToDecimal(american);
	if (D == null) return null;
	if (boost == "no-sweat") {
		boost = 0;
	}
	boost = boost / 100;
	const Dp = 1 + (D - 1) * (1 + boost);
	return decimalToAmerican(Dp);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

function highestOver(bookOdds, excluded, boost, book, under) {
	if (!boost) {
		boost = 0;
	}
	return Object.entries(bookOdds)
		.filter(([key, value]) =>
		  // exclude list
		  !excluded.includes(key) &&
		  // if a specific book is requested, only consider that one
		  (!book || key === book) &&
		  value !== undefined && value !== null && value !== ""
		)
		.reduce(
		  (max, [key, value]) => {
			// value can be "550" or "431/-655"
			const parts = String(value).split("/");
			if (under && parts.length <= 1) {
				return max;
			}
			const pick = under && parts.length > 1 ? parts[1] : parts[0];

			// parse "+375" -> 375, "-120" -> -120
			let num = parseInt(pick.replace("+", ""), 10);
			if (isNaN(num)) return max;

			// apply your profit boost (works for +/- American)
			num = applyProfitBoost(num, boost);

			return num > max.value ? { book: key, value: num, raw: pick } : max;
		  },
		  { book: null, value: -Infinity, raw: null }
	);
}


function parlay(ous) {
	let totalFV = 1;
	ous.forEach(ou => {
		const fv = getFairValue(ou);
		totalFV *= fv;
	});

	console.log(totalFV, impliedToAmerican(totalFV));
}

function escapeHtml(s="") {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function colHeader(field) {
	try {
	  const col = TABLE.getColumn(field);
	  if (!col) return null;
	  const el = col.getElement();
	  return el || null;
	} catch(e) { return null; }
}

function hideUsername() {
	document.getElementById("auth-buttons").style.display = "none";
}

function buildTourSteps() {
	const steps = [];

	const evEl = colHeader("ev");
	const book = colHeader("book");
	const bookSel = document.getElementById("book-select");
	const devigSel = document.getElementById("devig-button");
	const requiredInput = document.getElementById("required-button");
	const exclude = document.getElementById("exclude-dd");
	const fv = colHeader("fairVal");
	const implied = colHeader("implied");
	const kelly = colHeader("kelly");
	const hr_pa = colHeader("percs.hr_pa");
	const fd = colHeader("bookOdds.fd");

	steps.push({
		element: document.querySelector("#table"),
		title: "How to use this table",
		intro: "This is a +Expected Value (+EV) odds finder.",
		position: "right"
	});

	if (evEl) steps.push({
		element: evEl,
		title: "Expected Value (EV%)",
		intro: "Your edge vs the market based on sportsbook's projections & current best line. Green = positive edge. Start here",
		position: "right"
	});

	if (book) steps.push({
		element: book,
		title: "Best Book",
		intro: "Which sportsbook price is driving the EV. Use it to know where to place the bet.",
		position: "right"
	});

	if (bookSel) steps.push({
		element: bookSel,
		title: "Book Filter",
		intro: "Show prices from one book only.",
		position: "bottom"
	});

	if (exclude) steps.push({
		element: exclude,
		title: "Exclude Books",
		intro: "Remove books you don't have access to for this table or all tables.",
		position: "bottom"
	});

	if (devigSel) steps.push({
		element: devigSel,
		title: "Devig Filter",
		intro: "Choose the sharp sportsbooks (devig books) you trust to set the most accurate odds and remove the vigorish (vig) and determine the true 'Fair Value' line.<br>Circa and Pinnacle are a good start.",
		position: "bottom"
	});

	if (requiredInput) steps.push({
		element: requiredInput,
		title: "Required Books",
		intro: "Only show plays where these books have prices available. Useful for ensuring access to lines.",
		position: "bottom"
	});

	if (fv) steps.push({
		element: fv,
		title: "Fair Value (FV)",
		intro: "Fair odds after removing the sportsbook inbuilt \"fees\" (vig). Odds above the fair value = +EV",
		position: "right"
	});

	if (implied) steps.push({
		element: implied,
		title: "Implied",
		intro: "Fair Value formatted as an implied percentage. This is what the devig book thinks this play has of hitting",
		position: "right"
	});

	if (kelly) steps.push({
		element: kelly,
		title: "¼ Kelly (QK)",
		intro: "Stake sizing with 25% Kelly for steadier growth and lower variance.",
		position: "right"
	});

	if (fd) steps.push({
		element: fd,
		title: "Odds",
		intro: "Formatted as over/under. Highlighted in green indicates a +EV line.",
		position: "right"
	});

	if (hr_pa) steps.push({
		element: hr_pa,
		title: "Pitcher HR/PA %",
		intro: "Home Runs allowed to batters per plate appearance showing LHB - Total - RHB splits.",
		position: "right"
	});

	return steps;
}

function startHelpTour() {
	const steps = buildTourSteps();
	const tour = introJs.tour().setOptions({
		steps,
		showButtons: true,
		showStepNumbers: true,
		exitOnOverlayClick: true,
		//tooltipClass: "introjs-modern",
		//highlightClass: "introjs-highlight"
	});
	tour.start();
}

function debounce(fn, delay = 400) {
	let timeout;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn(...args), delay);
	};
}


function parseURLParams() {
	const windowURL = new URL(window.location.href);
	const URLParams = new URLSearchParams(windowURL.search);

	PROP = URLParams.get("prop") || "";

	METHOD = URLParams.get("method") || "";
	DATE = URLParams.get("date");
	MARK = URLParams.get("mark");
	GAME = URLParams.get("game") || "";
	TODAY = getToday();
	SPORT = URLParams.get("sport") || "nba";
	PLAYER = URLParams.get("player");
	DEVIG = (URLParams.get("devig") || "").replaceAll("-","+");
	WEIGHT = (URLParams.get("weight") || "").replaceAll("-", "+");
	BOOST = URLParams.get("boost");
	PRETTY = URLParams.get("pretty");
	IMP = URLParams.get("imp");
	DUE = URLParams.get("due");
	CSV = URLParams.get("csv");
	BOOK = URLParams.get("book");
	VIG = URLParams.get("vig") || "";
	MIN = URLParams.get("min") || "";
	MAX = URLParams.get("max") || "";
	SIDE = URLParams.get("side") ?? "both";
	REQUIRED = URLParams.get("required") || "";
	TEAMS = URLParams.get("teams") || "";
	CURRENT_VIEW = URLParams.get("view") || "table";
	TEAM = URLParams.get("team") || "det";

	function defaultOU() {
		if (["atgs", "tds"].includes(PAGE)) return "o";
		return "ou";
	}
	OU = URLParams.get("ou") || defaultOU();
}