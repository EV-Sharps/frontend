/* Weekly NFL usage columns shared by the touchdown and player-prop tables. */
(function (root) {
	"use strict";
	if (root.document && !root.document.getElementById("nfl-usage-style")) {
		const style = root.document.createElement("style");
		style.id = "nfl-usage-style";
		// The site's base cell height is 24px; allow the week and history to fit.
		style.textContent = ".tabulator-row .tabulator-cell.nfl-usage-cell { height: auto; min-height: 52px; }";
		root.document.head.appendChild(style);
	}
	const specs = [
		{ key: "usage_snaps_tot", metric: "snaps", stat: "tot", label: "Snaps", title: "Snaps", description: "Offensive snap count." },
		{ key: "usage_targets_tot", metric: "targets", stat: "tot", label: "Targets", title: "Targets", description: "All-game receiving targets." },
		{ key: "usage_targets_pos_share", metric: "targets", stat: "pos_share", label: "Target position share", title: "Target %<br>Position", description: "Player's receiving targets divided by team targets at the same position." },
		{ key: "usage_targets_team_share", metric: "targets", stat: "team_share", label: "Target team share", title: "Target %<br>Team", description: "Player's receiving targets divided by team RB + WR + TE targets. QBs are excluded." },
		{ key: "usage_looks_tot", metric: "looks", stat: "tot", label: "RZ looks", title: "RZ looks", description: "Red-zone looks (carries plus targets)." },
		{ key: "usage_looks_pos_share", metric: "looks", stat: "pos_share", label: "RZ look position share", title: "RZ look %<br>Position", description: "Player's red-zone looks divided by team red-zone looks at the same position." },
		{ key: "usage_looks_team_share", metric: "looks", stat: "team_share", label: "RZ look team share", title: "RZ look %<br>Team", description: "Player's red-zone looks divided by team RB + WR + TE red-zone looks. QBs are excluded." }
	];
	const snapSpec = { key: "snaps", metric: "snaps", stat: "pct", label: "Snap share", title: "Snap %", description: "Player's offensive snap share." };
	const keys = specs.map(spec => spec.key);
	const isPercent = spec => spec.stat !== "tot";
	const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

	function number(value, percent) {
		if (typeof value !== "number" && typeof value !== "string") return null;
		const text = String(value).trim().replace(percent ? /%$/ : /$^/, "").trim();
		if (!/^\d+(\.\d+)?$/.test(text)) return null;
		const result = Number(text);
		return Number.isFinite(result) && result >= 0 && (!percent || result <= 100) ? result : null;
	}

	function series(row, spec) {
		const weeks = row?.usage?.weeks;
		const values = row?.usage?.[spec.metric]?.[spec.stat];
		if (!Array.isArray(weeks) || !Array.isArray(values) || weeks.length !== values.length ||
			!weeks.every(week => Number.isInteger(week) && week > 0) || new Set(weeks).size !== weeks.length) return [];
		return weeks.map((week, index) => ({ week, value: number(values[index], isPercent(spec)) }));
	}

	function latestEntry(row, spec) {
		const values = series(row, spec);
		return row?.usage?.latest_week == null ? values.at(-1)
			: values.find(item => item.week === row.usage.latest_week);
	}

	function latest(row, spec) {
		return latestEntry(row, spec)?.value ?? null;
	}

	function valueLabel(value, spec) {
		return value == null ? "-" : `${Number(value.toFixed(2))}${isPercent(spec) ? "%" : ""}`;
	}

	function render(row, spec) {
		const values = series(row, spec);
		const last = latestEntry(row, spec);
		const season = Number.isInteger(row?.usage?.year) ? `${row.usage.year} ` : "";
		const history = values.map(item => `W${item.week}: ${valueLabel(item.value, spec)}`).join("; ");
		const description = `${season}${spec.label}. ${spec.description} ${history || "No data"}`;
		const percent = isPercent(spec);
		const max = percent ? 100 : Math.max(1, ...values.map(item => item.value ?? 0));
		const bars = values.length > 1 && values.some(item => item.value != null)
			? `<span class="snap-history" aria-hidden="true">${values.slice(-5).map(item =>
				`<span class="snap-history-bar${item.week === last?.week ? " latest" : ""}${item.value == null ? " missing" : ""}" style="height:${item.value == null ? 0 : 100 * item.value / max}%"></span>`
			).join("")}</span>` : "";
		return `<span class="snap-share${row?.blurred ? " blurred" : ""}"${row?.blurred ? "" : ` title="${escape(description)}"`}><span style="display:inline-flex;flex-direction:column;line-height:1.25"><strong>${valueLabel(last?.value, spec)}</strong>${last ? `<small style="font-size:9px;opacity:.65">W${last.week}</small>` : ""}</span>${bars}</span>`;
	}

	function sortRows(first, second, spec, direction) {
		const a = latest(first, spec), b = latest(second, spec);
		return compareValues(a, b, direction);
	}

	function compareValues(a, b, direction) {
		if (a == null && b == null) return 0;
		if (a == null) return direction === "asc" ? 1 : -1;
		if (b == null) return direction === "asc" ? -1 : 1;
		return a - b;
	}

	function column(spec) {
		return {
			title: `${spec.title}<br>Latest week`, field: `usage.${spec.metric}.${spec.stat}`, width: isPercent(spec) ? 100 : 90, variableHeight: true, cssClass: "nfl-usage-cell",
			headerTooltip: `${spec.description} Latest published team week; hover for weekly history. Missing values stay blank (-).`,
			formatter: cell => render(cell.getRow().getData(), spec),
			sorter: (a, b, aRow, bRow, col, direction) => sortRows(aRow.getData(), bRow.getData(), spec, direction)
		};
	}

	function items() {
		return specs.map(spec => ({ key: spec.key, label: spec.label, cols: [column(spec)] }));
	}

	function snapColumn(legacyColumn) {
		return {
			...legacyColumn,
			title: "Snap %<br>Latest week",
			variableHeight: true,
			cssClass: "nfl-usage-cell",
			headerTooltip: "Offensive snap share for the latest published team week. Hover for week-labelled history; older feeds show game history.",
			formatter: cell => cell.getRow().getData().usage
				? render(cell.getRow().getData(), snapSpec) : legacyColumn.formatter(cell),
			sorter: (a, b, aRow, bRow, col, direction) => {
				// The usage-aware rows retain null slots. Legacy feeds keep their existing sorter.
				if (!aRow.getData().usage && !bRow.getData().usage) return legacyColumn.sorter(a, b, aRow, bRow, col, direction);
				const snapValue = row => row.usage ? latest(row, snapSpec)
					: number(Array.isArray(row.snaps) ? row.snaps.at(-1) : row.snaps, true);
				return compareValues(snapValue(aRow.getData()), snapValue(bRow.getData()), direction);
			}
		};
	}

	function columnOrder(savedOrder, defaultOrder, baseOrder) {
		const saved = new Set(savedOrder || []);
		const missing = keys.filter(key => !saved.has(key));
		const order = [...new Set([...(baseOrder || savedOrder || []), ...defaultOrder])].filter(key => !missing.includes(key));
		const anchor = order.indexOf("snaps");
		order.splice(anchor < 0 ? order.length : anchor + 1, 0, ...missing);
		return order;
	}

	function migrateProfile(user, page) {
		const metadata = user?.metadata;
		if (!metadata || metadata[`${page}-usage-columns-version`]) return;
		if (Array.isArray(metadata[page])) metadata[page] = [...new Set([...metadata[page], ...keys])];
		// Existing settings saves persist this marker along with visibility preferences.
		metadata[`${page}-usage-columns-version`] = 1;
	}

	const api = { keys, specs, snapSpec, number, series, latest, render, sortRows, items, snapColumn, columnOrder, migrateProfile };
	root.NflUsage = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
