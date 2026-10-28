const FAQ_TOPICS = [
	{ id: 'getting-started', label: 'Getting started' },
	{ id: 'odds-ev', label: 'Odds & EV' },
	{ id: 'prediction-markets', label: 'Prediction markets' },
	{ id: 'using-tools', label: 'Using the tools' },
	{ id: 'account', label: 'Your account' }
];

// Keep the original question IDs so existing shared FAQ links still work.
const FAQ = [
	{
		id: 'q-where-to-sign-up', topic: 'getting-started', q: 'How do I sign up?',
		answer: `<p>Open <a href="pricing.html">Pricing</a>, sign in with Discord or Google, and choose a membership. Paid plans continue to Stripe to complete checkout.</p><p>You can also explore selected free pages before subscribing. Your <a href="profile.html">profile</a> shows your membership and saved preferences.</p>`
	},
	{
		id: 'q-memberships', topic: 'getting-started', q: 'What is included in Free, Analyst, and Sharp?',
		answer: `<p><strong>Free</strong> includes selected pages and research previews. <strong>Analyst</strong> adds core player-prop pages, odds comparisons, custom devig settings, saved layouts, and CSV exports.</p><p><strong>Sharp</strong> includes Analyst features plus expanded props and alternate lines, main markets, and live pages. See <a href="pricing.html#pricing-cards">the plan comparison</a> for prices and details.</p>`
	},
	{
		id: 'q-live-pages', topic: 'getting-started', q: 'Which plan includes live pages?',
		answer: `<p><strong>Sharp</strong> includes live pages for MLB, NFL, NBA, and NHL. Open the <strong>Pages</strong> menu in the app, choose a sport, and select <strong>Live</strong>.</p><p>Games, books, and markets depend on current coverage. A live page can be empty when no supported in-game markets are available.</p>`
	},
	{
		id: 'q-book-coverage', topic: 'getting-started', q: 'Which sportsbooks and exchanges do you carry?',
		answer: `<p>Coverage includes sportsbooks such as FanDuel, DraftKings, bet365, BetMGM, Circa, and Pinnacle, alongside Kalshi, Novig, ProphetX, and Polymarket.</p><p>See the <a href="pricing.html#book-coverage">full book list</a>. Availability varies by sport, market, and region; every source is not available on every page.</p>`
	},
	{
		id: 'q-refresh-intervals', topic: 'odds-ev', q: 'How often do odds refresh?',
		answer: `<p>These are the configured intervals for checking the main odds feed. They do not guarantee that every sportsbook or market updates that often.</p>
		<div class="faq-refresh-panel">
			<table id="faq-refresh-table" class="faq-refresh-table" hidden><caption>Configured refresh intervals</caption><thead><tr><th scope="col">Sport</th><th scope="col">Interval</th></tr></thead><tbody id="faq-refresh-rows"></tbody></table>
			<p id="faq-refresh-status" class="faq-refresh-status" role="status" aria-live="polite">Loading configured intervals…</p>
			<p id="faq-refresh-updated" class="faq-refresh-updated" hidden>Configuration last changed: <time id="faq-refresh-config-time"></time>.</p>
			<button id="faq-refresh-retry" class="faq-refresh-retry" type="button" hidden>Try again</button>
		</div>
		<p>Odds-provider delays, processing, and page updates can add time before a change appears on the site.</p>`
	},
	{
		id: 'q-devig-basics', topic: 'odds-ev', q: 'What does devig mean?',
		answer: `<p>The <strong>vig</strong> is the margin built into a sportsbook's odds. <strong>Devigging</strong> removes an estimate of that margin to produce a fair probability for each outcome.</p><p>The <strong>Devig</strong> control lets you choose the reference books and weights used in the comparison. Changing those inputs or the devig method can change the fair value and EV shown.</p>`
	},
	{
		id: 'q-devig-methods', topic: 'odds-ev', q: 'How do the devig methods differ?',
		answer: `<p>Each method removes margin differently. The site uses <strong>Worst-Case</strong> by default; the other methods let you compare different probability estimates.</p>
		<dl class="faq-methods">
			<div><dt>Multiplicative</dt><dd>Divides each implied probability by the sum of both sides, scaling the total to 100%.<p class="faq-method-tip"><strong>Useful for:</strong> A simple baseline for spreads, totals, and props priced near even money. It preserves the original ratio between the two sides.</p></dd></div>
			<div><dt>Additive</dt><dd>Subtracts half of the excess probability from each side of a two-outcome market.<p class="faq-method-tip"><strong>Useful for:</strong> Comparing near-even, two-way lines when you assume each side carries the same margin in percentage points. That fixed deduction takes a larger percentage of a longshot's implied probability.</p></dd></div>
			<div><dt>Power</dt><dd>Applies a power transformation to the implied probabilities so the adjusted sides sum to 100%.<p class="faq-method-tip"><strong>Useful for:</strong> Comparing favorites with longshots, including home run and touchdown props. It removes proportionally more margin from the longshot, making it a useful candidate when you expect favorite-longshot bias.</p></dd></div>
			<div><dt>Probit</dt><dd>Transforms probabilities using the inverse normal distribution, adjusts them in that space, then converts them back.<p class="faq-method-tip"><strong>Useful for:</strong> A second nonlinear estimate for longshot props and extreme prices. Compare it with Power to see how much your EV depends on the margin model.</p></dd></div>
			<div><dt>Worst-Case</dt><dd>Takes the lowest probability estimate for the selected side from Power, Multiplicative, and Additive. Probit is not part of this comparison.<p class="faq-method-tip"><strong>Useful for:</strong> A conservative screen when you want a bet to show positive EV under all three included methods. It helps avoid relying on whichever estimate looks most favorable.</p></dd></div>
		</dl><p>These are starting points; no method is best for every book, market, or odds range. Use the <a href="methods.html">interactive method comparison</a> to see how the estimates change with the odds. Historical preset results describe past performance, not a guaranteed edge on the next play.</p>`
	},
	{
		id: 'q-fair-odds', topic: 'odds-ev', q: 'What are fair odds and implied probability?',
		answer: `<p><strong>Fair Value</strong> is the odds equivalent of the probability estimated from your selected devig books, weights, and method. <strong>Implied</strong> shows that estimate as a percentage.</p><p>For example, a 40% fair probability corresponds to <strong>+150</strong> American odds or <strong>2.50</strong> decimal odds. Fair value is an estimate based on the selected inputs.</p>`
	},
	{
		id: 'q-ev-calculation', topic: 'odds-ev', q: 'How is expected value (EV) calculated?',
		answer: `<p>EV compares the estimated chance of winning with the offered payout and the amount at risk.</p><p class="faq-formula">EV = (win probability &times; net profit if you win) &minus; (loss probability &times; stake)</p><p>For a $100 stake at +150 with an estimated 45% win probability, the calculation is <strong>0.45 &times; $150 &minus; 0.55 &times; $100 = $12.50</strong>, or +12.5% EV. That is an expected return based on the estimate, not the result of an individual bet.</p>`
	},
	{
		id: 'q-kelly-criterion', topic: 'odds-ev', q: 'What does the Kelly number mean?',
		answer: `<p>Kelly sizing uses the estimated edge and available odds to calculate a stake size. A fractional Kelly setting scales that calculation: <strong>&frac14; Kelly</strong> uses one quarter of the full calculation.</p><p>Set your default fraction and unit size in <a href="profile.html">Profile &rarr; Betting preferences</a>. The Kelly controls on an odds page let you choose a page-specific fraction and switch between units and dollar amounts. Dollar amounts use your saved unit size.</p>`
	},
	{
		id: 'q-what-is-z-score', topic: 'odds-ev', q: 'What does a Z-score tell me? Is a player due?',
		answer: `<p>A Z-score describes how far a value is from its historical average, measured in standard deviations. The meaning of a positive or negative score depends on the statistic being measured.</p><p>A long gap or unusual streak does not by itself make the next outcome more likely. Use the score as historical context alongside the market and player information, rather than as proof that a player is due.</p>`
	},
	{
		id: 'q-prediction-order-books', topic: 'prediction-markets', q: 'How do I read the Yes and No order books?',
		answer: `<p>Our order books show prices <strong>available for you to take</strong>. For a goal market, Yes means the player scores and No means they do not. Each available price is backed by resting orders on the opposite outcome.</p>
		<figure class="faq-market-example">
			<figcaption><strong>One goal market, two sides</strong><span>Illustration &middot; Before fees</span></figcaption>
			<div class="faq-market-sides">
				<div class="faq-market-side faq-market-yes"><span class="faq-market-label">You can take Yes &middot; Goal</span><strong class="faq-market-price">+900</strong><span>$687 available stake</span><div class="faq-market-counterparty"><span aria-hidden="true">&#8597;</span><p>Backed by orders buying <strong>No around &minus;900</strong>.</p></div></div>
				<div class="faq-market-side faq-market-no"><span class="faq-market-label">You can take No &middot; No goal</span><strong class="faq-market-price">&minus;1011</strong><span>$546 available stake</span><div class="faq-market-counterparty"><span aria-hidden="true">&#8597;</span><p>Backed by orders buying <strong>Yes around +1011</strong>, with about <strong>$54</strong> at risk.</p></div></div>
			</div>
		</figure>
		<p>The $546 on No &minus;1011 means you can stake that amount on <strong>No</strong> against waiting Yes buyers. Those buyers want +1011; you cannot instantly take Yes +1011 from their orders. You could place a similar Yes order and wait for a match. The available Yes price in this example is +900.</p>
		<p>The two sides risk different amounts for the same contracts, which is why $546 of available No stake corresponds to about $54 on the opposing Yes orders. These are <strong>unfilled offers</strong>, not completed betting volume. See <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener noreferrer">Kalshi&rsquo;s explanation of the two sides</a>.</p>`
	},
	{
		id: 'q-prediction-devig', topic: 'prediction-markets', q: 'How do exchange quotes become fair value and EV?',
		answer: `<p>We convert the quoted Yes and No prices into implied probabilities, apply your selected devig method, and combine your selected reference books using their weights. On an exchange, the excess over 100% in a pair of available prices reflects the <strong>bid/ask spread</strong> before fees.</p>
		<figure class="faq-market-example">
			<figcaption><strong>Where does a +1000 offer fit?</strong><span>Cost of a Yes contract paying $1 if it wins</span></figcaption>
			<div class="faq-market-spread" role="img" aria-label="Yes buyers bid about 9 cents, sellers ask 10 cents. A +1000 offer costs about 9.09 cents, inside the spread and close to the bid.">
				<div class="faq-market-endpoints"><span><strong>9&cent;</strong>Buyers bid<br>Yes +1011</span><span><strong>10&cent;</strong>Sellers ask<br>Yes +900</span></div>
				<div class="faq-market-track"><span></span></div>
				<p class="faq-market-offer"><span aria-hidden="true">&#9679;</span> Your +1000 offer costs about <strong>9.09&cent;</strong></p>
			</div>
		</figure>
		<p>Using only the rounded Kalshi quotes <strong>+900 / &minus;1011</strong> as the reference, the estimates differ:</p>
		<table class="faq-market-table"><caption>Estimated EV at a fee-free +1000 offer</caption><thead><tr><th scope="col">Method</th><th scope="col">Fair odds</th><th scope="col">EV</th></tr></thead><tbody><tr><th scope="row">Multiplicative</th><td>+910</td><td>+8.9%</td></tr><tr><th scope="row">Additive</th><td>+953</td><td>+4.5%</td></tr><tr><th scope="row">Power / Worst-Case</th><td>+978</td><td>+2.1%</td></tr></tbody></table>
		<p>At +1000, you need a <strong>9.09%</strong> win rate before fees. Power estimates about <strong>9.28%</strong> here. The gap produces the estimated edge, but the order book does not establish the true win probability. Fees on your offered bet reduce that edge and can turn it negative.</p>
		<p><strong>Worst-Case</strong> takes the lowest probability from Power, Multiplicative, and Additive; it is not a guaranteed lower bound on the true probability. The order book&rsquo;s <strong>average payout odds</strong> summarize available liquidity and are separate from this devig estimate.</p>`
	},
	{
		id: 'q-prediction-liquidity', topic: 'prediction-markets', q: 'Does more liquidity make the devig more reliable?',
		answer: `<p>More size means more contracts can be matched at that quote while the orders remain available. It can help you assess the quote, but <strong>size alone does not prove that the price is accurate</strong>. A large order may belong to just one participant.</p>
		<div class="faq-market-example faq-liquidity-demo" aria-label="Liquidity example">
			<p class="faq-market-demo-title"><strong>Change the size, keep the same prices</strong><span>Yes +900 / No &minus;1011 &middot; Illustrative only</span></p>
			<div class="faq-market-size-options" role="group" aria-label="Example available No stake"><button type="button" data-faq-liquidity="1" aria-pressed="true">$546 on No</button><button type="button" data-faq-liquidity="10" aria-pressed="false">$5,460 on No</button></div>
			<div class="faq-market-metrics" role="status" aria-live="polite" aria-atomic="true"><div><span>Opposing Yes orders</span><strong id="faq-example-yes-stake">About $54</strong><span>Waiting for +1011</span></div><div><span>Power / Worst-Case EV</span><strong>+2.1%</strong><span>At a fee-free +1000</span></div></div>
			<p class="faq-market-demo-note">More size at the same prices leaves the estimated fair odds at <strong>+978</strong>. Our devig calculation uses the quotes, method, and reference weights; it does not automatically weight by order-book size.</p>
		</div>
		<p>When assessing a reference, look for <strong>meaningful size on both sides near the best prices</strong>, a tight spread, fresh quotes that remain available across updates, and agreement with independent markets. These can support confidence in the reference without guaranteeing an edge.</p>
		<p>More money at No &minus;1011 means more orders waiting to buy Yes around +1011. Those buyers are seeking a slightly better payout than your +1000, so their size alone does not establish that +1000 is profitable.</p>`
	},
	{
		id: 'q-customize-views', topic: 'using-tools', q: 'How do I change the layout or visible columns?',
		answer: `<p>Use <strong>View</strong> to switch between <strong>Compact</strong>, <strong>Stacked</strong>, and <strong>Mobile</strong> cards. Stacked view places fair value under EV and the best book's odds under the player.</p><p>Open <strong>Customize</strong> to show or hide columns. On pages with <strong>Reorder Columns</strong>, drag the entries into your preferred order. Sign in and save your choices to keep your layout.</p>`
	},
	{
		id: 'q-filtering', topic: 'using-tools', q: 'How do prop, player, and liquidity filters work?',
		answer: `<p>Use the <strong>Prop</strong> and <strong>Game</strong> dropdowns to narrow the slate. Search under the <strong>Player</strong> column in a table, or use the player search in Mobile view. On the TDs page, the <strong>ATTD</strong> button selects only anytime touchdowns.</p><p>On pages with liquidity filters, set the over- and under-side requirements separately. Combine them with <strong>All (AND)</strong> when both must match, or <strong>Any (OR)</strong> when either can match. The book and amount controls determine each requirement.</p>`
	},
	{
		id: 'q-record-column', topic: 'using-tools', q: 'What does the Record column show?',
		answer: `<p>In Stacked view, <strong>Record</strong> shows historical wins, losses, and ROI for the row's prop, book, and devig selection, grouped into <strong>100-point American odds ranges</strong> and <strong>1-percentage-point EV ranges</strong>.</p><p>For example, +525 odds and 8.4% EV use the +500 to below +600 odds group and the 8% to below 9% EV group. A dash means there is no matching history. Show or hide the column under <strong>Customize &rarr; Record (Stacked)</strong>.</p>`
	},
	{
		id: 'q-logs-snaps', topic: 'using-tools', q: 'Where can I find game logs and snap share?',
		answer: `<p>On supported prop pages, open <strong>Customize</strong> and enable <strong>Game Logs</strong> to see recent results beside the odds.</p><p>On NFL pages, <strong>Snap %</strong> shows the latest game's snap share. Its small bars show recent games from oldest to newest; hover for the available history. Missing data is shown as a dash.</p>`
	},
	{
		id: 'q-player-favorites', topic: 'using-tools', q: 'How do player stars and the watchlist work?',
		answer: `<p>Sign in, then select the <strong>star beside a player</strong> on a prop page to add or remove that prop from your watchlist. Favorites are separate for each page and prop, so starring a player's doubles does not star their singles or total bases. A favorite on Dingers also stays separate from MLB Props.</p><p>Open the <a href="tracker.html">bet tracker</a> to see favorites from each page alongside your tracked bets.</p>`
	},
	{
		id: 'q-download-csv', topic: 'using-tools', q: 'How do I download a CSV?',
		answer: `<p>On pages that support CSV export, add <code>?csv</code> to the page URL. If the URL already has a question mark and other settings, append <code>&amp;csv</code> instead.</p><p>For example, <code>tds.html?csv</code> starts an export when the data loads. The export uses the data available to your account and the page's current settings.</p>`
	},
	{
		id: 'q-link-discord', topic: 'account', q: "Why can't I see my Discord channels?",
		answer: `<ol><li><a href="https://discord.gg/QJdYDk3KBm" target="_blank" rel="noopener noreferrer">Join the Discord server</a>.</li><li>Sign in to the website and open <a href="profile.html">Your profile</a>.</li><li>Choose <strong>Connect Discord</strong> in the Discord card and link the account you use on the server.</li></ol><p>If you joined the server after subscribing, choose <strong>Reconnect Discord</strong> to refresh your membership roles. Channel access depends on your plan.</p>`
	},
	{
		id: 'q-change-payment-method', topic: 'account', q: 'How do I update my payment method?',
		answer: `<p>Open <a href="profile.html">Your profile</a> and choose <strong>Manage billing</strong> on your membership card. Stripe's billing portal lets you update payment details for your active subscription.</p><p>If the billing button is unavailable or you need help with a canceled subscription, <a href="mailto:plusevsharps@gmail.com">email support</a>.</p>`
	},
	{
		id: 'q-cancel-subscription', topic: 'account', q: 'How do I cancel or change my subscription?',
		answer: `<p>For an active paid membership, go to <a href="profile.html">Your profile &rarr; Manage billing</a> to change or cancel your subscription through Stripe.</p><p>If cancellation is scheduled, your profile shows <strong>Access ends</strong> and the date instead of a renewal date. To compare memberships, visit <a href="pricing.html">Pricing</a>.</p>`
	},
	{
		id: 'q-profile-preferences', topic: 'account', q: 'Where do I save my state, unit size, and odds format?',
		answer: `<p>Sign in and open <a href="profile.html">Your profile &rarr; Betting preferences</a>. Set your state for direct betslip links, unit size for Kelly dollar amounts, odds format, and default Kelly fraction.</p><p>Choose <strong>Save preferences</strong> to save the settings together. <strong>Reset</strong> restores your last saved values if you change your mind before saving.</p>`
	}
];

const faqSearch = document.getElementById('faq-search');
const faqResults = document.getElementById('faq-results');
const faqTopics = document.getElementById('faq-topics');
const faqClear = document.getElementById('faq-clear');
const faqExpand = document.getElementById('expand-all');
const faqCollapse = document.getElementById('collapse-all');
const faqRows = new Map();
const faqGroups = new Map();
let selectedTopic = 'all';

const normalizeFaqText = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

for (const topic of [{ id: 'all', label: 'All topics' }, ...FAQ_TOPICS]) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'faq-topic';
	button.dataset.topic = topic.id;
	button.setAttribute('aria-controls', 'faq-results');
	button.innerHTML = `<span>${topic.label}</span><span class="faq-topic-count"></span>`;
	button.addEventListener('click', () => { selectedTopic = topic.id; filterFaq(); });
	faqTopics.append(button);
}

for (const topic of FAQ_TOPICS) {
	const group = document.createElement('section');
	group.className = 'faq-group';
	group.setAttribute('aria-labelledby', `faq-topic-${topic.id}`);
	group.innerHTML = `<div class="faq-group-heading"><h2 id="faq-topic-${topic.id}">${topic.label}</h2><span class="faq-group-count"></span></div>`;
	for (const item of FAQ.filter(item => item.topic === topic.id)) {
		const details = document.createElement('details');
		details.className = 'faq-question';
		details.id = item.id;
		details.innerHTML = `<summary><h3>${item.q}</h3></summary><div class="faq-answer">${item.answer}<div class="faq-share"><button type="button" class="faq-copy-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 14 4-4m-6 2-2 2a4 4 0 0 0 6 6l2-2m-4-12 2-2a4 4 0 0 1 6 6l-2 2"/></svg>Copy link</button><span class="faq-copy-status" role="status" aria-live="polite"></span><input class="faq-share-url" aria-label="Link to this answer" readonly hidden></div></div>`;
		const text = document.createElement('div');
		text.innerHTML = item.answer;
		faqRows.set(item.id, { element: details, topic: item.topic, text: normalizeFaqText(`${item.q} ${text.textContent}`) });
		details.querySelector('.faq-copy-link').addEventListener('click', event => copyFaqLink(item.id, event.currentTarget));
		group.append(details);
	}
	faqGroups.set(topic.id, group);
	faqResults.append(group);
}

// This illustration changes size only; the quotes and devig estimate stay fixed.
for (const button of document.querySelectorAll('[data-faq-liquidity]')) {
	button.addEventListener('click', () => {
		const demo = button.closest('.faq-liquidity-demo');
		for (const option of demo.querySelectorAll('[data-faq-liquidity]')) {
			option.setAttribute('aria-pressed', String(option === button));
		}
		demo.querySelector('#faq-example-yes-stake').textContent = button.dataset.faqLiquidity === '10' ? 'About $540' : 'About $54';
	});
}

function filterFaq() {
	const terms = normalizeFaqText(faqSearch.value).trim().split(/\s+/).filter(Boolean);
	const counts = Object.fromEntries(FAQ_TOPICS.map(topic => [topic.id, 0]));
	let visible = 0;
	for (const row of faqRows.values()) {
		const matchesSearch = terms.every(term => row.text.includes(term));
		if (matchesSearch) counts[row.topic]++;
		row.element.hidden = !matchesSearch || (selectedTopic !== 'all' && selectedTopic !== row.topic);
		if (!row.element.hidden) visible++;
	}
	for (const [topic, group] of faqGroups) {
		group.hidden = counts[topic] === 0 || (selectedTopic !== 'all' && selectedTopic !== topic);
		group.querySelector('.faq-group-count').textContent = counts[topic];
	}
	for (const button of faqTopics.querySelectorAll('button')) {
		const topic = button.dataset.topic;
		button.setAttribute('aria-pressed', String(topic === selectedTopic));
		button.querySelector('.faq-topic-count').textContent = topic === 'all' ? Object.values(counts).reduce((sum, n) => sum + n, 0) : counts[topic];
	}
	document.getElementById('faq-result-count').textContent = `${visible} question${visible === 1 ? '' : 's'}${terms.length ? ' found' : ''}`;
	document.getElementById('faq-empty').hidden = visible !== 0;
	faqClear.hidden = !faqSearch.value;
	faqExpand.disabled = faqCollapse.disabled = visible === 0;
}

async function copyFaqLink(id, button) {
	const url = new URL(window.location.href);
	url.searchParams.set('faq', id);
	url.hash = '';
	const share = button.closest('.faq-share');
	const status = share.querySelector('.faq-copy-status');
	const fallback = share.querySelector('.faq-share-url');
	button.disabled = true;
	try {
		if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
		await navigator.clipboard.writeText(url.href);
		fallback.hidden = true;
		status.textContent = 'Link copied';
	} catch (error) {
		status.textContent = 'Copy the link below:';
		fallback.value = url.href;
		fallback.hidden = false;
		fallback.focus();
		fallback.select();
	} finally { button.disabled = false; }
}

function openFaqLink() {
	const params = new URLSearchParams(window.location.search);
	let hash = '';
	try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch (error) {}
	const row = faqRows.get(hash) || faqRows.get(params.get('faq'));
	if (!row) return;
	selectedTopic = 'all';
	faqSearch.value = '';
	filterFaq();
	row.element.open = true;
	requestAnimationFrame(() => {
		row.element.querySelector('summary').focus({ preventScroll: true });
		row.element.scrollIntoView({ block: 'start' });
	});
}

faqSearch.addEventListener('input', filterFaq);
faqClear.addEventListener('click', () => { faqSearch.value = ''; filterFaq(); faqSearch.focus(); });
document.getElementById('faq-reset').addEventListener('click', () => {
	selectedTopic = 'all'; faqSearch.value = ''; filterFaq(); faqSearch.focus();
});
faqExpand.addEventListener('click', () => { for (const row of faqRows.values()) if (!row.element.hidden) row.element.open = true; });
faqCollapse.addEventListener('click', () => { for (const row of faqRows.values()) if (!row.element.hidden) row.element.open = false; });
window.addEventListener('hashchange', openFaqLink);
filterFaq();
openFaqLink();

// This public help page does not load the authenticated odds-page scripts.
// Match their API routing without starting a session or odds subscriptions.
function faqRefreshApiBase() {
	if (typeof API_BASE !== 'undefined' && typeof API_BASE === 'string') return API_BASE.replace(/\/$/, '');
	if (window.EV_APP_CONFIG?.packaged === true) return String(window.EV_APP_CONFIG.apiBase || 'https://api-production-3a3b.up.railway.app').replace(/\/$/, '');
	return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
		? 'http://localhost:5001' : 'https://api-production-3a3b.up.railway.app';
}

function formatRefreshInterval(seconds) {
	const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
	const minutes = Math.floor(seconds / 60);
	const remainder = Number((seconds % 60).toFixed(3));
	if (!minutes) return `${number(seconds)} sec`;
	return `${number(minutes)} min${remainder ? ` ${number(remainder)} sec` : ''}`;
}

function validateRefreshIntervals(value) {
	if (!value || value.version !== 1 || typeof value.configured_at !== 'string'
		|| !Number.isFinite(Date.parse(value.configured_at)) || !Array.isArray(value.sports)) throw new Error('Invalid refresh intervals');
	const seen = new Set();
	for (const row of value.sports) {
		if (!row || typeof row.sport !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.sport)
			|| seen.has(row.sport) || typeof row.label !== 'string' || !row.label.trim()
			|| typeof row.interval_seconds !== 'number' || !Number.isFinite(row.interval_seconds) || row.interval_seconds <= 0) throw new Error('Invalid refresh interval row');
		seen.add(row.sport);
	}
	return value;
}

const refreshIntervalTable = document.getElementById('faq-refresh-table');
const refreshIntervalRows = document.getElementById('faq-refresh-rows');
const refreshIntervalStatus = document.getElementById('faq-refresh-status');
const refreshIntervalUpdated = document.getElementById('faq-refresh-updated');
const refreshIntervalRetry = document.getElementById('faq-refresh-retry');
let refreshIntervalsInFlight = false;
let refreshIntervalsLastChecked = null;

function refreshIntervalTimestamp(value) {
	return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function updateRefreshSearchText() {
	const row = faqRows.get('q-refresh-intervals');
	if (!row) return;
	row.text = normalizeFaqText(`${row.element.querySelector('summary').textContent} ${row.element.querySelector('.faq-answer').textContent}`);
	filterFaq();
}

async function loadRefreshIntervals() {
	if (refreshIntervalsInFlight || document.visibilityState === 'hidden') return;
	refreshIntervalsInFlight = true;
	refreshIntervalRetry.disabled = true;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);
	try {
		const response = await fetch(`${faqRefreshApiBase()}/api/refresh-intervals`, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
		if (!response.ok) throw new Error('Refresh intervals unavailable');
		const report = validateRefreshIntervals(await response.json());
		const fragment = document.createDocumentFragment();
		for (const sport of report.sports) {
			const row = document.createElement('tr');
			const name = document.createElement('th');
			name.scope = 'row'; name.textContent = sport.label;
			const interval = document.createElement('td'); interval.textContent = formatRefreshInterval(sport.interval_seconds);
			row.append(name, interval); fragment.appendChild(row);
		}
		refreshIntervalRows.replaceChildren(fragment);
		refreshIntervalTable.hidden = !report.sports.length;
		refreshIntervalsLastChecked = new Date().toISOString();
		refreshIntervalStatus.textContent = report.sports.length
			? `Last checked ${refreshIntervalTimestamp(refreshIntervalsLastChecked)}.`
			: 'No configured refresh intervals are currently available.';
		refreshIntervalStatus.classList.remove('is-unavailable');
		const configTime = document.getElementById('faq-refresh-config-time');
		configTime.dateTime = report.configured_at;
		configTime.textContent = refreshIntervalTimestamp(report.configured_at);
		refreshIntervalUpdated.hidden = false;
		refreshIntervalRetry.hidden = true;
	} catch (_) {
		refreshIntervalStatus.textContent = refreshIntervalsLastChecked && !refreshIntervalTable.hidden
			? `Current settings could not be confirmed. Showing intervals last checked ${refreshIntervalTimestamp(refreshIntervalsLastChecked)}.`
			: 'Configured refresh intervals are unavailable right now. Please try again.';
		refreshIntervalStatus.classList.add('is-unavailable');
		refreshIntervalRetry.hidden = false;
	} finally {
		clearTimeout(timeout);
		refreshIntervalsInFlight = false;
		refreshIntervalRetry.disabled = false;
		updateRefreshSearchText();
	}
}

refreshIntervalRetry.addEventListener('click', loadRefreshIntervals);
window.addEventListener('focus', loadRefreshIntervals);
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') loadRefreshIntervals(); });
setInterval(() => { if (document.visibilityState !== 'hidden') loadRefreshIntervals(); }, 60000);
loadRefreshIntervals();
