
let CURR_USER, CURR_SESSION;
let ENABLE_AUTH = true;
let SAVE_DISCORD;
let SB;

try {
	SB = supabase.createClient(
		'https://nkdhryqpiulrepmphwmt.supabase.co',
		'sb_publishable_mMniM5v3auOHfF72hlVL_w_LUNlh3yt'
	);
} catch (e) {

}

// Seed CURR_USER synchronously from the last successful profile fetch so page-init
// code that reads CURR_USER.metadata (saved column order, excluded books, devig/sort
// prefs) has something correct to use on first paint, instead of waiting on a live
// `profiles` round-trip that can be slow. upsertProfile() refreshes this in the background.
try {
	const cachedProfile = localStorage.getItem('cached_profile');
	if (cachedProfile) CURR_USER = JSON.parse(cachedProfile);
} catch (e) {}

function cacheProfile(data) {
	try {
		if (data) localStorage.setItem('cached_profile', JSON.stringify(data));
	} catch (e) {}
}

async function logout() {
	await SB.auth.signOut();
	try { localStorage.removeItem('cached_profile'); } catch (e) {}
	location.reload();
}

async function upsertProfile(session) {
	const { data, error } = await SB.from('profiles')
		.select('*')
		.eq('id', session.user.id)
		.maybeSingle();

	CURR_SESSION = session;
	CURR_USER = data;
	cacheProfile(data);
	// Sync page favorites from Supabase into localStorage
	if (data?.metadata?.page_favorites?.length) {
		localStorage.setItem("page_favorites", JSON.stringify(data.metadata.page_favorites));
	}
	if (error) {
		console.error("Error fetching profile: ", error);
		return;
	}

	// default tier
	let tier = "free";
	let discordId = null;
	let discordUsername = null;
	// check identities array for discord
	const discordIdentity = session.user.identities?.find(
		(id) => id.provider === "discord"
	);
	if (discordIdentity) {
		discordId = discordIdentity.identity_data?.provider_id;
		discordUsername = discordIdentity.identity_data?.user_name || discordIdentity.identity_data?.full_name;
	}
	if (!data) {
		const { d, error: insertError } = await SB.from('profiles').insert([{
				id: session.user.id,
				tier: tier,
				discord_id: discordId,
				discord_username: discordUsername
			}])
			.select()
			.single();
			CURR_USER = d;
			cacheProfile(d);
		if (insertError) {
			console.error("Insert profile error: ", insertError);
		}
	} else {
		tier = data.tier;
		// if discord not yet saved but now available
		if (!data.discord_username && discordUsername) {
			const { error: updateError } = await SB.from('profiles')
				.update({ discord_id: discordId, discord_username: discordUsername })
				.eq('id', session.user.id);
			if (updateError) console.error('Update profile error:', updateError);
		}
	}

	// Signed in and logged in DB
	let t = "🆓";
	if (tier == "analyst") {
		t = "💻";
	} else if (tier == "sharp") {
		t = "🎯";
	}

	if (tier != "sharp" && document.querySelector("#upgrade")) {
		document.querySelector("#upgrade").style.display = "initial";
	}

	if (tier == "sharp" && document.querySelector("#customize")) {
		document.querySelector("#customize").style.display = "initial";
	}
	
	if (document.querySelector(".profile-badge")) {
		for (el of document.querySelectorAll(".profile-badge")) {
			el.innerText = t;
		}
	}
	// maybe make logo separate and larger
	if (document.getElementById("username")) {
		document.getElementById("username").innerText = `${t} ${session.user.email.split("@")[0]}`;
	}
	if (window.location.pathname.includes("/profile")) {
		fillProfile(data, CURR_USER.discord_username, tier, session);
	} else if (window.location.pathname.includes("/pricing")) {
		fillPricing(tier);
	}
}

const tierOrder = {
	free: 0,
	analyst: 1,
	sharp: 2
};

function fillPricing(tier) {
	const currentLevel = tierOrder[tier];

	document.querySelectorAll('.pricing-card').forEach(card => {
		const btn = card.querySelector('.select-btn');
		const btnText = btn.querySelector(".btn-text");
		if (!btn) return;
		const cardTier = card.dataset.tier;
		const cardLevel = tierOrder[cardTier];

		if (cardTier === tier) {
			btnText.textContent = 'Current';
			btn.disabled = true;
			btn.classList.add('current-btn');
		} else if (cardLevel < currentLevel) {
			btnText.textContent = 'Downgrade';
			btn.disabled = false;
			btn.classList.remove('current-btn');
		} else {
			//btnText.textContent = 'Upgrade';
			btn.disabled = false;
			btn.classList.remove('current-btn');
		}
	});
}

async function savePageFavorites(favs) {
	if (!CURR_USER || !CURR_SESSION) return;
	const metadata = { ...CURR_USER.metadata, page_favorites: favs };
	const { error } = await SB.from('profiles')
		.update({ metadata })
		.eq('id', CURR_SESSION.user.id);
	if (error) console.error('savePageFavorites error:', error);
	else {
		CURR_USER.metadata = metadata;
		cacheProfile(CURR_USER);
	}
}

async function saveCustomDevigs() {
	if (!CURR_USER) {
		return;
	}
	const metadata = CURR_USER?.metadata || {};
	if (!metadata["custom_devigs"]) {
		metadata["custom_devigs"] = [];
	}
	if (!metadata["custom_devigs"].includes(DEVIG)) {
		metadata["custom_devigs"].push(DEVIG);
	}
	const { error: updateError } = await SB.from('profiles')
		.update({
			metadata: metadata
		})
		.eq('id', CURR_SESSION.user.id);
}

async function saveTableSettings() {
	const saveBtn = document.querySelector("#save-table");
	const saveStatus = document.querySelector("#save-status");

	if (!CURR_USER) {
		return;
	}

	saveStatus.textContent = "Saving...";
	saveBtn.disabled = true;

	const fields = {};
	fields[PAGE] = [];
	if (document.querySelector("#sort-select")) {
		fields[`${PAGE}-sort`] = document.querySelector("#sort-select").value;
	}
	if (document.querySelector("#filter-select")) {
		fields[`${PAGE}-filter`] = document.querySelector("#filter-select").value;
	}
	fields[`${PAGE}-devig`] = document.querySelector("#custom-devig-select").value;
	document.querySelectorAll('#items input[type="checkbox"]:checked').forEach((input) => {
		const key = input.id.replace(/^custom_/, '');
		fields[PAGE].push(key);
	});
	const newData = { ...CURR_USER.metadata, ...fields };
	const { error: updateError } = await SB.from('profiles')
		.update({
			metadata: newData
		})
		.eq('id', CURR_SESSION.user.id);
	if (updateError) {
		console.error('Update profile error:', updateError);
		saveStatus.textContent = "Error Saving";
	} else {
		saveStatus.textContent = "✅ Saved!";
	}

	CURR_USER.metadata = newData;
	cacheProfile(CURR_USER);

  setTimeout(() => {
    saveStatus.textContent = '';
    saveBtn.disabled = false;
  }, 3000);
}

function initExcluded() {
	if (!CURR_USER) return;

	let excluded = CURR_USER?.metadata?.[`${PAGE}-exclude`] || [];
	const checkboxes = document.querySelectorAll('#exclude-dd input[type="checkbox"]');
	checkboxes.forEach(checkbox => {
		checkbox.checked = excluded.includes(checkbox.value);
	});
}

async function saveExcludeHelper(key) {
	if (!CURR_USER) {
		return;
	}

	const saveBtn = document.querySelector("#save-exclude");
	const saveStatus = document.querySelector("#exclude-status");

	saveStatus.textContent = "Saving...";
	saveBtn.disabled = true;

	const data = {};
	const excluded = getExcludedBooks();

	if (key == "all") {
		for (k of ["atgs", "atgs2", "dingers2", "dingers", "live", "main", "mlb", "nba", "wnba", "ncaaf", "ncaafprops", "nhl", "pts", "threes", "outliers", "soccer", "tds"]) {
			data[`${k}-exclude`] = excluded;
		}
	} else {
		data[`${key}-exclude`] = excluded;
	}
	const newData = { ...CURR_USER.metadata, ...data };
	const { error: updateError } = await SB.from('profiles')
		.update({
			metadata: newData
		})
		.eq('id', CURR_SESSION.user.id);
	if (updateError) {
		console.error('Update profile error:', updateError);
		saveStatus.textContent = "Error Saving";
	} else {
		saveStatus.textContent = "✅ Saved!";
	}

	CURR_USER.metadata = newData;
	cacheProfile(CURR_USER);

  setTimeout(() => {
    saveStatus.textContent = '';
    saveBtn.disabled = false;
  }, 3000);
}

async function saveState() {
	if (!CURR_USER) return;
	const state = document.querySelector("#state-select").value;
	const status = document.querySelector("#state-save-status");
	status.textContent = "Saving...";
	const newData = { ...CURR_USER.metadata, state };
	const { error } = await SB.from('profiles')
		.update({ metadata: newData })
		.eq('id', CURR_SESSION.user.id);
	if (error) {
		status.textContent = "Error saving";
	} else {
		CURR_USER.metadata = newData;
		cacheProfile(CURR_USER);
		status.textContent = "✅ Saved!";
		setTimeout(() => status.textContent = "", 3000);
	}
}

async function saveOddsFormat() {
	const odds_format = document.querySelector("#odds-format-select").value;
	const status = document.querySelector("#odds-format-save-status");
	if (!CURR_USER) {
		// Not signed in — for local testing only, since there's no profile row to persist to.
		try { localStorage.setItem("odds_format", odds_format); } catch (e) {}
		status.textContent = "✅ Saved locally (not signed in)";
		setTimeout(() => status.textContent = "", 3000);
		return;
	}
	status.textContent = "Saving...";
	const newData = { ...CURR_USER.metadata, odds_format };
	const { error } = await SB.from('profiles')
		.update({ metadata: newData })
		.eq('id', CURR_SESSION.user.id);
	if (error) {
		status.textContent = "Error saving";
	} else {
		CURR_USER.metadata = newData;
		cacheProfile(CURR_USER);
		status.textContent = "✅ Saved!";
		setTimeout(() => status.textContent = "", 3000);
	}
}

async function saveAllExcludeBooks() {
	saveExcludeHelper("all");
}

async function saveExcludeBooks() {
	saveExcludeHelper(PAGE);
}

function fillProfile(data, discordUsername, tier, session) {
	if (document.querySelector("#profile-username")) {
		document.querySelector("#profile-username").innerText = `${session.user.email}`;
	}
	if (document.querySelector("#profile-plan")) {
		document.querySelector("#profile-plan").innerText = `${title(tier)}`;
	}
	if (document.querySelector("#discord-username") && discordUsername) {
		document.querySelector("#discord-username").innerText = discordUsername;
	}
	if (data.next_renewal) {
		let d = new Date(data.next_renewal);
		const options = {year: 'numeric', month: 'short', day: 'numeric'};
		document.querySelector("#next-renewal").innerText = d.toLocaleDateString("en-US", options);

	}

	if (data.metadata && data.metadata?.canceled) {
		document.querySelector("#next-renewal-label").innerText = "Canceling:";
	} else {
		document.querySelector("#next-renewal-label").innerText = "Next Renewal:";
	}
}

async function loginWithGoogle() {
	const { data, error } = await SB.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: window.location.origin+`/profile${HTML}`,
			queryParams: { prompt: "select_account" }
		}
	});

	if (error) {
		console.error('Google OAuth error', error);
	}
}

async function loginWithDiscord() {
	const { data, error } = await SB.auth.signInWithOAuth({
		provider: 'discord',
		options: {
				//redirectTo: window.location.origin+ `/profile${HTML}?saveDiscord`
				redirectTo: window.location.origin+`/profile${HTML}`
		}
	});

	console.log('SB URL:', SB.restUrl || SB.supabaseUrl);
	console.log('Auth URL:', data.url);

	if (error) {
		console.error('Discord OAuth error', error);
	}
}

async function saveDiscordToProfile() {
	const { data: { user } } = await SB.auth.getUser();

	console.log(user);
	if (user && user.app_metadata?.provider === 'discord') {
		const discordId = user.user_metadata.provider_id;
		const discordName = user.user_metadata.full_name;

		console.log(discordId, discordName);
		const { data, error } = await SB.from('profiles')
			.update({
				discord_id: discordId,
				discord_username: discordName
			})
			.eq('id', user.id);

		if (error) {
			console.error('❌ Failed to save Discord info', error);
		} else {
			console.log('✅ Discord info saved to profile', data);
		}
	}
}

async function upgrade(tier) {
	const response = await fetch(`${API_BASE}/api/stripe-portal`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ACCESS_TOKEN}`,
			Tier: tier
		}
	});
	const data = await response.json();
	if (data.url) {
		window.location.href = data.url;
	} else {
		alert('Error starting checkout. Contact plusevsharps@gmail.com');
	}
}

// Auth + the page's own data fetch used to run strictly sequentially: getSession()
// then await upsertProfile() (a `profiles` SELECT/INSERT round-trip that can be slow
// under Supabase load) and only then would the page's actual content start loading.
// Now the content fetch (initPageData) starts as soon as we have ACCESS_TOKEN, in
// parallel with the profile fetch. CURR_USER is pre-seeded from a localStorage cache
// (see top of file) so init code that reads CURR_USER.metadata still has last-known
// values on first paint; hydrateAfterProfileLoad() reconciles once the live profile
// fetch actually resolves.
async function handleSession() {
	let session = null;
	if (ENABLE_AUTH) {
		document.querySelector("#auth-buttons").style.display = "flex";
		const res = await SB.auth.getSession();
		session = res.data?.session;
		if (session) {
			if (session.access_token) {
				ACCESS_TOKEN = session.access_token;
			}
			// Discard a cached profile that belongs to a different account (e.g. a
			// shared browser, or switching accounts) so we never render someone
			// else's saved settings/tier while the real profile fetch is in flight.
			if (CURR_USER && CURR_USER.id !== session.user.id) {
				CURR_USER = null;
			}
			Array.from(document.querySelectorAll(".loggedOut")).map(x => x.style.display = "none");
		} else {
			// No Session
			CURR_USER = null;
			Array.from(document.querySelectorAll(".loggedIn")).map(x => x.style.display = "none");
		}
	}	else {
		// TEST. No Auth
		Array.from(document.querySelectorAll(".loggedIn")).map(x => x.style.display = "none");
		Array.from(document.querySelectorAll(".loggedOut")).map(x => x.style.display = "none");
		if (document.querySelector("#pricing")) {
			document.querySelector("#pricing").style.display = "none";
		}
	}

	initPageData();

	if (ENABLE_AUTH && session) {
		// make sure row exists in profile; runs in the background, doesn't block content above
		await upsertProfile(session);
		hydrateAfterProfileLoad();
	}
}

// Re-applies anything that depends on a live (not cached) CURR_USER, once upsertProfile()
// resolves. Safe/idempotent to call again after initPageData() already rendered defaults.
function hydrateAfterProfileLoad() {
	if (["dingers", "dingers2", "charts"].includes(PAGE) && CURR_USER?.metadata) {
		const today = new Date().toISOString().slice(0, 10);
		const allWL = CURR_USER.metadata.watchlist || [];
		const freshWL = allWL.filter(w => (w.dt || w) === today);
		const allBets = CURR_USER.metadata.bets || [];
		const freshBets = allBets.filter(b => b.dt === today);
		CURR_USER.metadata = { ...CURR_USER.metadata, watchlist: freshWL, bets: freshBets };
		if ((freshWL.length !== allWL.length || freshBets.length !== allBets.length) && CURR_SESSION) {
			SB.from('profiles').update({ metadata: CURR_USER.metadata }).eq('id', CURR_SESSION.user.id);
			cacheProfile(CURR_USER);
		}
	}
	if (typeof initExcluded === "function") initExcluded();
	if (typeof restoreFilterBuilder === "function") restoreFilterBuilder();
	if (typeof changeFilter === "function") changeFilter();
}

function initPageData() {
	if (PAGE === "barrels") {
		fetchBarrelsData();
	} else if (PAGE == "bvp") {
		fetchBVPData();
	} else if (PAGE == "stats") {
		fetchStatsData();
	} else if (PAGE == "pitcher_mix") {
		fetchMixData();
	} else if (["preview", "preview_k", "ranks"].includes(PAGE)) {
		fetchPreviewData();
	} else if (PAGE == "pricing") {
		document.querySelector("#pricing").style.display = "none";
	} else if (PAGE === "props") {
		fetchPropsData();
	} else if (PAGE == "bases") {
		renderTable([]);
		fetchBasesData();
	} else if (PAGE == "feed") {
		runFeed();
	} else if (PAGE == "sb") {
		renderTable([]);
		fetchSBData();
	} else if (PAGE == "recap" || PAGE == "main_recap") {
		initChkddActions();
		fetchProps();
		renderFilters();
		initExcluded();
		renderTable([]);
	} else if (PAGE == "tracker") {
		fetchTrackerData();
		renderTable([]);
	} else if (PAGE == "bets" || PAGE == "movement") {
		fetchPlays();
		renderTable([]);
		setInterval(() => {
			if (document.hasFocus()) {
				fetchPlays();
			}
		}, 30 * 1000);
	} else if (["mlb", "outliers", "nhl", "atgs", "atgs2", "kotc", "nba", "wnba", "pts", "threes", "analysis", "ncaab", "baseball_ncaa", "tds", "tds2", "live", "nfl", "ncaaf", "ncaafprops", "strikeouts", "futures", "ufc", "wbc", "cup"].includes(PAGE)) {
		initChkddActions();
		fetchProps();
		renderFilters();
		initExcluded();
		renderTable([]);
		if (PAGE != "analysis") {
			setInterval(() => {
				if (document.hasFocus()) {
					fetchProps();
				}
			}, 30 * 1000);
		}
	} else if (PAGE == "main" || PAGE == "soccer" || PAGE == "preseason") {
		initChkddActions();
		fetchMain();
		renderFilters();
		initExcluded();
		renderTable([]);
		setInterval(() => {
			if (document.hasFocus()) {
				fetchMain();
			}
		}, 30 * 1000);
	} else if (["dingers", "dingers2", "charts"].includes(PAGE)) {
		initChkddActions();
		fetchDingersData();
		//countdown();
		renderFilters();
		initExcluded();
		renderTable([]);
		setInterval(() => {
			if (document.hasFocus()) {
				fetchDingersData();
			}
		}, 30 * 1000);
	}
}