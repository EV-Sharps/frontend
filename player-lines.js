/* Compare the available lines for one player, game, and prop. */
(function (root) {
	"use strict";
	const bookOrder = ["circa", "pn", "kal", "nv", "px", "poly", "fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "kambi", "re", "fl", "bol"];
	const predictionBooks = new Set(["kal", "nv", "px", "poly"]);
	const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
	const canOpen = (page, row) => ["mlb", "nfl", "nhl", "ncaaf"].includes(page) && !!row?.player && !!row.prop && row.prop !== "separator" && !row.blurred;
	const payout = price => price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);

	function parsePrice(value) {
		const text = String(value ?? "").trim();
		if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
		const price = Number(text);
		return Number.isFinite(price) && Math.abs(price) >= 100 ? price : null;
	}

	function parseLiquidity(value) {
		if (typeof value !== "number" && typeof value !== "string") return null;
		const text = String(value).replace(/[$,]/g, "").trim();
		const amount = text === "" ? NaN : Number(text);
		return Number.isFinite(amount) && amount >= 0 ? amount : null;
	}

	function samePlayerGame(selected, row) {
		return row.player === selected.player && row.game === selected.game
			&& (row.gameId == null || selected.gameId == null || row.gameId === selected.gameId)
			&& (row.date == null || selected.date == null || row.date === selected.date)
			&& (!row.sport || !selected.sport || row.sport === selected.sport);
	}

	function availableProps(selected, rows) {
		const props = new Set();
		for (const row of [selected, ...rows]) {
			if (!row.blurred && samePlayerGame(selected, row) && typeof row.prop === "string" && row.prop && row.prop !== "separator") {
				props.add(row.prop);
			}
		}
		return [...props];
	}

	function collect(selected, rows) {
		const byLine = new Map();
		const availableBooks = new Set();
		for (const row of rows) {
			if (row.blurred || row.prop !== selected.prop || !samePlayerGame(selected, row)) continue;
			if (row.handicap == null || String(row.handicap).trim() === "") continue;
			const line = Number(row.handicap);
			if (!Number.isFinite(line)) continue;
			if (!byLine.has(line)) byLine.set(line, { line, prices: new Map(), liquidity: new Map() });
			const entry = byLine.get(line);
			for (const [book, raw] of Object.entries(row.bookOdds || {})) {
				if (book === "circa" && row.circa_blurred) continue;
				// Feeds store over/under in this order, even on a row selected for its under.
				const parts = String(raw ?? "").split("/");
				const prices = [parsePrice(parts[0]), parsePrice(parts[1])];
				if (prices.every(price => price === null)) continue;
				const merged = entry.prices.get(book) || [null, null];
				const amounts = entry.liquidity.get(book) || [null, null];
				const liquidity = Array.isArray(row.liquidity?.[book]) ? row.liquidity[book] : [];
				prices.forEach((price, side) => {
					if (price === null) return;
					if (merged[side] === null) merged[side] = price;
					// Only attach liquidity to the same price when duplicate rows fill gaps.
					if (predictionBooks.has(book) && merged[side] === price && amounts[side] === null) {
						amounts[side] = parseLiquidity(liquidity[side]);
					}
				});
				entry.prices.set(book, merged);
				if (predictionBooks.has(book)) entry.liquidity.set(book, amounts);
				availableBooks.add(book);
			}
		}
		const books = [...availableBooks].sort((a, b) => {
			const index = book => bookOrder.includes(book) ? bookOrder.indexOf(book) : bookOrder.length;
			return index(a) - index(b) || a.localeCompare(b);
		});
		const lines = [...byLine.values()].sort((a, b) => a.line - b.line);
		for (const entry of lines) {
			entry.best = [0, 1].map(side => {
				const prices = [...entry.prices.values()].map(pair => pair[side]).filter(price => price !== null);
				return prices.length ? Math.max(...prices.map(payout)) : null;
			});
		}
		return { books, lines };
	}

	function comparisonTable(selected, rows, options) {
		const { books, lines } = collect(selected, rows);
		const priceHtml = (entry, book, side) => {
			const price = entry.prices.get(book)?.[side] ?? null;
			if (price === null) return '<span class="player-lines-price is-missing" aria-hidden="true"></span>';
			const display = escape(options.formatOdds(price > 0 ? `+${price}` : String(price)));
			const best = payout(price) === entry.best[side];
			const amount = entry.liquidity.get(book)?.[side] ?? null;
			const liquidity = amount === null ? '' : `<small class="player-lines-liquidity" title="${side ? 'Under' : 'Over'} liquidity: $${amount.toLocaleString('en-US')}">($${amount.toLocaleString('en-US')})</small>`;
			return `<span class="player-lines-price${best ? " is-best" : ""}"><span title="${side ? "Under" : "Over"}${best ? ' · Highest listed price' : ''}">${display}</span>${liquidity}</span>`;
		};
		const selectedLine = line => selected.handicap != null && line === Number(selected.handicap);
		const columnWidth = book => predictionBooks.has(book) ? 104 : 64;
		const tableWidth = 44 + books.reduce((width, book) => width + columnWidth(book), 0);
		const table = lines.length && books.length ? `<p id="player-lines-legend" class="player-lines-legend">Over above / under below. Green = highest price. ($) = liquidity.</p><div class="player-lines-scroll" tabindex="0" role="region" aria-label="Prices by sportsbook and line">
			<table style="width:${tableWidth}px" aria-label="Line comparison" aria-describedby="player-lines-legend">
			<colgroup><col style="width:44px">${books.map(book => `<col style="width:${columnWidth(book)}px">`).join("")}</colgroup>
			<thead><tr><th scope="col">Line</th>${books.map(book => `<th scope="col"><span class="player-lines-book" title="${escape(book.toUpperCase())}">${bookOrder.includes(book) ? `<img src="logos/${book}.png" alt="" width="14" height="14">` : ""}${escape(book.toUpperCase())}</span></th>`).join("")}</tr></thead>
			<tbody>${lines.map(entry => `<tr${selectedLine(entry.line) ? ' class="is-selected"' : ""}><th scope="row"${selectedLine(entry.line) ? ' aria-label="Selected line ' + escape(entry.line) + '"' : ""}>${escape(entry.line)}</th>${books.map(book => `<td>${priceHtml(entry, book, 0)}${priceHtml(entry, book, 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="player-lines-empty">No prices are available for this player and prop.</p>';
		return { html: table, width: Math.max(520, tableWidth + 2), count: books.length ? lines.length : 0 };
	}

	function open(selected, rows, options) {
		if (selected.blurred) return;
		let dialog = root.document.getElementById("player-lines-dialog");
		if (!dialog) {
			dialog = root.document.createElement("dialog");
			dialog.id = "player-lines-dialog";
			dialog.setAttribute("aria-labelledby", "player-lines-title");
			root.document.body.appendChild(dialog);
			dialog.addEventListener("click", event => {
				if (event.target !== dialog) return;
				const rect = dialog.getBoundingClientRect();
				if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
			});
		}
		const formatProp = options.formatProp || (prop => prop === selected.prop && options.prop ? options.prop : prop.toUpperCase());
		const props = availableProps(selected, rows).sort((a, b) => formatProp(a).localeCompare(formatProp(b), undefined, { numeric: true }));
		dialog.innerHTML = `<header class="player-lines-header"><div class="player-lines-heading"><p>Line comparison</p><div class="player-lines-title-row"><h2 id="player-lines-title">${escape(options.player)}</h2><span aria-hidden="true">&middot;</span><select id="player-lines-prop" aria-label="Prop for ${escape(options.player)}">${props.map(prop => `<option value="${escape(prop)}">${escape(formatProp(prop))}</option>`).join('')}</select></div><p>${escape(String(selected.game || selected.gameId || "").toUpperCase())} &middot; <span id="player-lines-count" role="status"></span></p></div><button type="button" class="player-lines-close" aria-label="Close line comparison" autofocus>&times;</button></header><div class="player-lines-content"></div>`;
		const select = dialog.querySelector('#player-lines-prop');
		select.value = selected.prop;
		const renderProp = () => {
			const current = { ...selected, prop: select.value, handicap: select.value === selected.prop ? selected.handicap : null };
			const table = comparisonTable(current, rows, options);
			dialog.querySelector('.player-lines-content').innerHTML = table.html;
			dialog.querySelector('#player-lines-count').textContent = `${table.count} line${table.count === 1 ? '' : 's'}`;
			dialog.style.setProperty('--player-lines-width', `${table.width}px`);
		};
		select.addEventListener('change', renderProp);
		renderProp();
		dialog.querySelector(".player-lines-close").addEventListener("click", () => dialog.close());
		if (!dialog.open) dialog.showModal();
	}

	const api = { canOpen, collect, availableProps, open, escape };
	root.PlayerLines = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
