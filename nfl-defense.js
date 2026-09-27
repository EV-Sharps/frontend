/* Position-specific opponent context shared by the TD and NFL prop tables. */
(function (root) {
	"use strict";
	const keys = ["dvpRank", "dvpAllowed", "dvpGames"];
	const defaultKeys = ["dvpRank"];
	const stats = {
		pass_cmp: ["passing completions", "cmp/g"], pass_att: ["passing attempts", "pass att/g"],
		pass_yd: ["passing yards", "pass yd/g"], pass_td: ["passing TDs", "pass TD/g"],
		pass_int: ["interceptions thrown", "INT/g"], rush_att: ["rushing attempts", "carries/g"],
		rush_yd: ["rushing yards", "rush yd/g"], rush_td: ["rushing TDs", "rush TD/g"],
		tgt: ["receiving targets", "targets/g"], rec: ["receptions", "rec/g"],
		rec_yd: ["receiving yards", "rec yd/g"], rec_td: ["receiving TDs", "rec TD/g"],
		attd: ["rushing + receiving TDs", "TD/g"], td_scorers: ["distinct TD scorers", "scorers/g"],
		"rush_+_rec_yd": ["rushing + receiving yards", "rush+rec yd/g"],
		"pass_+_rush_yd": ["passing + rushing yards", "pass+rush yd/g"]
	};
	const tdContext = new Set(["ftd", "ltd", "2+td", "3+td"]);
	const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
	const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;
	const positiveInt = value => Number.isInteger(value) && value > 0 ? value : null;
	const numberFormat = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});
	const format = value => numberFormat.format(value);
	let defense = null;

	function info(row) {
		const opp = String(row.opp || "").toLowerCase();
		const rawPos = String(row.pos || "").toUpperCase();
		const position = defense?.position_aliases?.[rawPos] || ({FB:"RB", HB:"RB"})[rawPos] || rawPos;
		const team = defense?.team_aliases?.[opp] || opp;
		const sample = defense?.data?.[team]?.[position];
		const context = row.dvpContext === true || tdContext.has(row.prop);
		const metric = (context ? defense?.context_metrics?.[row.prop] || "attd"
			: defense?.prop_metrics?.[row.prop] || ({cmp:"pass_cmp", targets:"tgt"})[row.prop] || row.prop);
		return {opp, position, sample, context, metric, stat: stats[metric] || ["production", "per game"],
			teams: positiveInt(sample?.ranked_teams_by_metric?.[metric] ?? sample?.ranked_teams)};
	}

	function setFeed(feed) {
		defense = feed?.defenseVsPosition || null;
		// Also support a prepared shared lookup before per-row columns are published.
		// This copies precomputed values once per refresh, without calculating stats.
		for (const row of feed?.data || []) {
			if (row.blurred || Object.hasOwn(row, "dvpAllowed")) continue;
			const {sample, metric, context} = info(row);
			if (!positiveInt(sample?.games) || finite(sample?.per_game?.[metric]) == null) continue;
			row.dvpRank = positiveInt(sample.ranks?.[metric]);
			row.dvpAllowed = sample.per_game[metric];
			row.dvpGames = sample.games;
			if (context) row.dvpContext = true;
		}
		const dialog = root.document?.getElementById("nfl-defense-dialog");
		if (dialog?.open) dialog.close();
	}

	function value(row, key) {
		if (row.blurred || !positiveInt(row.dvpGames)) return null;
		return key === "dvpAllowed" ? finite(row[key]) : positiveInt(row[key]);
	}

	function description(row) {
		const {opp, position, context, stat, teams, metric} = info(row);
		const rank = value(row, "dvpRank"), allowed = value(row, "dvpAllowed"), games = value(row, "dvpGames");
		if (row.blurred || games == null || allowed == null) return "No defense-vs-position data for this prop.";
		const lines = [
			`${opp.toUpperCase()} vs ${position || "position"} - ${stat[0]}`,
			`${format(allowed)} per defensive game across ${games} completed ${games === 1 ? "game" : "games"}.`,
			rank == null ? "Rank unavailable." : `Rank ${rank}${teams ? ` of ${teams}` : ""}; 1 means fewest allowed. Ties share a rank.`,
			"Totals cover all opposing players at this position, including games with zero production."
		];
		if (context) lines.push(`${String(row.prop).toUpperCase()}: general TD context only. This is not a ${String(row.prop).toUpperCase()} hit rate.`);
		if (metric === "attd") lines.push("TDs include rushing and receiving scores; passing TDs are excluded.");
		if (games < 5) lines.push("Small sample: fewer than 5 games.");
		if (defense?.as_of) lines.push(`Season data through ${defense.as_of}${defense.partial ? "; incomplete coverage" : ""}.`);
		return lines.join("\n\n");
	}

	function render(row, key) {
		const number = value(row, key);
		if (number == null) return '<span class="nfl-defense-empty">-</span>';
		const {context, teams, stat} = info(row);
		let main, caption;
		if (key === "dvpRank") {
			main = `#${number}${teams ? `<span class="nfl-defense-total">/${teams}</span>` : ""}`;
		} else if (key === "dvpAllowed") {
			main = format(number);
			caption = context ? "TD context" : escape(stat[1]);
		} else {
			main = String(number);
			caption = "games";
		}
		const detail = escape(description(row));
		const color = key === "dvpRank" ? root.getTDsOppRankColor?.(number) : "";
		return `<button type="button" class="nfl-defense-value${context ? " nfl-defense-context" : ""}" title="${detail}" aria-label="${detail}"><strong${color ? ` style="color:${escape(color)}"` : ""}>${main}</strong>${caption ? `<small>${caption}</small>` : ""}</button>`;
	}

	function compare(a, b, key, direction) {
		const x = value(a, key), y = value(b, key);
		if (x == null && y == null) return 0;
		if (x == null) return direction === "asc" ? 1 : -1;
		if (y == null) return direction === "asc" ? -1 : 1;
		return x - y;
	}

	function items() {
		return [
			["dvpRank", "Opponent vs position rank", "Vs position<br>Rank", 105],
			["dvpAllowed", "Allowed per game vs position", "Allowed<br>/ game", 112],
			["dvpGames", "Defense sample games", "Sample<br>Games", 70]
		].map(([key, label, title, width]) => ({key, label, cols: [{
			field: key, title, width, variableHeight: true, cssClass: "nfl-defense-cell",
			visible: defaultKeys.includes(key), headerSortStartingDir: key === "dvpRank" ? "asc" : "desc",
			headerTooltip: "Opponent production vs the player's position. 1 = fewest allowed. Tap or hover a value for the stat and sample. TD context is labeled separately.",
			formatter: cell => render(cell.getRow().getData(), key),
			sorter: (a, b, aRow, bRow, column, direction) => compare(aRow.getData(), bRow.getData(), key, direction)
		}]}));
	}

	function columnOrder(savedOrder, baseOrder) {
		const saved = new Set(savedOrder || []), missing = keys.filter(key => !saved.has(key));
		const order = [...new Set([...(baseOrder || []), ...keys])].filter(key => !missing.includes(key));
		const anchor = order.indexOf("opp");
		order.splice(anchor < 0 ? order.length : anchor + 1, 0, ...missing);
		return order;
	}

	function migrateProfile(user, page) {
		const meta = user?.metadata, marker = `${page}-defense-columns-version`;
		if (!meta || meta[marker]) return;
		if (Array.isArray(meta[page])) meta[page] = [...new Set([...meta[page], ...defaultKeys])];
		meta[marker] = 1;
	}

	if (root.document) root.document.addEventListener("click", event => {
		const button = event.target.closest?.(".nfl-defense-value");
		if (!button) return;
		event.stopPropagation();
		let dialog = root.document.getElementById("nfl-defense-dialog");
		if (!dialog) {
			dialog = root.document.createElement("dialog");
			dialog.id = "nfl-defense-dialog";
			dialog.setAttribute("aria-labelledby", "nfl-defense-heading");
			dialog.innerHTML = '<h2 id="nfl-defense-heading">Opponent vs position</h2><p></p><form method="dialog"><button autofocus>Close</button></form>';
			root.document.body.appendChild(dialog);
			dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
		}
		dialog.querySelector("p").textContent = button.title;
		dialog.showModal();
	});

	const api = {keys, defaultKeys, setFeed, info, value, description, render, compare, items, columnOrder, migrateProfile};
	root.NflDefense = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
