/* Compare the available lines for one player, game, and prop. */
(function (root) {
	"use strict";
	const bookOrder = ["circa", "pn", "kal", "nv", "px", "poly", "fd", "dk", "b365", "mgm", "espn", "cz", "fn", "br", "hr", "bv", "kambi", "re", "fl", "bol"];
	const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
	const canOpen = (page, row) => ["mlb", "nfl", "nhl"].includes(page) && !!row?.player && !!row.prop && row.prop !== "separator" && !row.blurred;
	const payout = price => price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);

	function parsePrice(value) {
		const text = String(value ?? "").trim();
		if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
		const price = Number(text);
		return Number.isFinite(price) && Math.abs(price) >= 100 ? price : null;
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
			if (!byLine.has(line)) byLine.set(line, { line, prices: new Map() });
			const entry = byLine.get(line);
			for (const [book, raw] of Object.entries(row.bookOdds || {})) {
				if (book === "circa" && row.circa_blurred) continue;
				// Feeds store over/under in this order, even on a row selected for its under.
				const parts = String(raw ?? "").split("/");
				const prices = [parsePrice(parts[0]), parsePrice(parts[1])];
				if (prices.every(price => price === null)) continue;
				const merged = entry.prices.get(book) || [null, null];
				prices.forEach((price, side) => { if (merged[side] === null) merged[side] = price; });
				entry.prices.set(book, merged);
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
			const display = price === null ? "&mdash;" : escape(options.formatOdds(price > 0 ? `+${price}` : String(price)));
			const best = price !== null && payout(price) === entry.best[side];
			return `<span class="player-lines-price${best ? " is-best" : ""}"><span title="${side ? "Under" : "Over"}${best ? ' · Highest listed price' : ''}">${display}</span></span>`;
		};
		const selectedLine = line => selected.handicap != null && line === Number(selected.handicap);
		const table = lines.length && books.length ? `<div class="player-lines-scroll" tabindex="0" role="region" aria-label="Prices by sportsbook and line">
			<table><caption>Over prices on top, under prices below. Green marks the highest listed price for each side.</caption>
			<thead><tr><th scope="col">Line</th>${books.map(book => `<th scope="col"><span class="player-lines-book">${bookOrder.includes(book) ? `<img src="logos/${book}.png" alt="" width="18" height="18">` : ""}${escape(book.toUpperCase())}</span></th>`).join("")}</tr></thead>
			<tbody>${lines.map(entry => `<tr${selectedLine(entry.line) ? ' class="is-selected"' : ""}><th scope="row"${selectedLine(entry.line) ? ' aria-label="Selected line ' + escape(entry.line) + '"' : ""}>${escape(entry.line)}</th>${books.map(book => `<td>${priceHtml(entry, book, 0)}${priceHtml(entry, book, 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="player-lines-empty">No prices are available for this player and prop.</p>';
		dialog.innerHTML = `<header class="player-lines-header"><div><p>Line comparison</p><h2 id="player-lines-title">${escape(options.player)} <span>&middot; ${escape(options.prop)}</span></h2><p>${escape(String(selected.game || selected.gameId || "").toUpperCase())}${lines.length ? ` &middot; ${lines.length} line${lines.length === 1 ? "" : "s"}` : ""}</p></div><button type="button" class="player-lines-close" aria-label="Close line comparison" autofocus>&times;</button></header>${table}`;
		dialog.querySelector(".player-lines-close").addEventListener("click", () => dialog.close());
		if (!dialog.open) dialog.showModal();
	}

	const api = { canOpen, collect, open, escape };
	root.PlayerLines = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
