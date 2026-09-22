/* Compare the available lines for one player, game, and prop. */
(function (root) {
	"use strict";
	const bookOrder = ["circa", "pn", "kal", "nv", "px", "poly", "fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "kambi", "re", "fl", "bol"];
	const predictionBooks = new Set(["kal", "nv", "px", "poly"]);
	const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
	const canOpen = (page, row) => ["mlb", "nfl", "nhl"].includes(page) && !!row?.player && !!row.prop && row.prop !== "separator" && !row.blurred;
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

	function collect(selected, rows) {
		const byLine = new Map();
		const availableBooks = new Set();
		for (const row of rows) {
			if (row.blurred || row.player !== selected.player || row.prop !== selected.prop || row.game !== selected.game) continue;
			if (row.gameId != null && selected.gameId != null && row.gameId !== selected.gameId) continue;
			if (row.date != null && selected.date != null && row.date !== selected.date) continue;
			if (row.sport && selected.sport && row.sport !== selected.sport) continue;
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

	function open(selected, rows, options) {
		if (selected.blurred) return;
		const { books, lines } = collect(selected, rows);
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
		dialog.innerHTML = `<header class="player-lines-header"><div><p>Line comparison</p><h2 id="player-lines-title">${escape(options.player)} <span>&middot; ${escape(options.prop)}</span></h2><p>${escape(String(selected.game || selected.gameId || "").toUpperCase())}${lines.length ? ` &middot; ${lines.length} line${lines.length === 1 ? "" : "s"}` : ""}</p></div><button type="button" class="player-lines-close" aria-label="Close line comparison" autofocus>&times;</button></header>${table}`;
		dialog.style.setProperty('--player-lines-width', `${Math.max(520, tableWidth + 2)}px`);
		dialog.querySelector(".player-lines-close").addEventListener("click", () => dialog.close());
		if (!dialog.open) dialog.showModal();
	}

	const api = { canOpen, collect, open, escape };
	root.PlayerLines = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
