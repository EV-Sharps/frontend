
let CURR_USER, CURR_SESSION;
const ENABLE_AUTH = false;
let SAVE_DISCORD;
const SB = supabase.createClient(
	'https://nkdhryqpiulrepmphwmt.supabase.co',
	'sb_publishable_mMniM5v3auOHfF72hlVL_w_LUNlh3yt'
);

async function logout() {
	await SB.auth.signOut();
	location.reload();
}

async function upsertProfile(session) {
	const { data, error } = await SB.from('profiles')
		.select('*')
		.eq('id', session.user.id)
		.maybeSingle();

	CURR_SESSION = session;
	CURR_USER = data;
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

	if (tier != "free" && document.querySelector("#customize")) {
		document.querySelector("#customize").style.display = "initial";
	}
	
	if (document.querySelector(".profile-badge")) {
		for (el of document.querySelectorAll(".profile-badge")) {
			el.innerText = t;
		}
	}
	// maybe make logo separate and larger
	if (document.getElementById("username")) {
		document.getElementById("username").innerText = `${t} ${session.user.email}`;
	}
	if (window.location.pathname.includes("/profile")) {
		fillProfile(data, discordUsername, tier, session);
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
			btnText.textContent = 'Upgrade';
			btn.disabled = false;
			btn.classList.remove('current-btn');
		}
	});
}

async function saveTableSettings() {
	const saveBtn = document.querySelector("#save-table");
	const saveStatus = document.querySelector("#save-status");

	saveStatus.textContent = "Saving...";
	saveBtn.disabled = true;

	const fields = {};
	fields[PAGE] = [];
	fields[`${PAGE}-sort`] = document.querySelector("#sort-select").value;
	fields[`${PAGE}-filter`] = document.querySelector("#filter-select").value;
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

  setTimeout(() => {
    saveStatus.textContent = '';
    saveBtn.disabled = false;
  }, 3000);
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
}

async function loginWithDiscord() {
	const { data, error } = await SB.auth.signInWithOAuth({
		provider: 'discord',
		options: {
				//redirectTo: window.location.origin+ `/profile${HTML}?saveDiscord`
				redirectTo: window.location.origin+ `/profile${HTML}`
		}
	});

	if (error) {
		console.error('Discord OAuth error', error);
	}
}

function loginWithDiscord2() {
	const clientId = "";
	const redirectUri = encodeURIComponent(`${API_BASE}/api/discord/callback`);
	//const state = encodeURIComponent(userId);

	window.location.href =
	`https://discord.com/oauth2/authorize?client_id=${clientId}` +
	`&redirect_uri=${redirectUri}` +
	`&response_type=code` +
	`&scope=identify`;
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

async function handleSession() {
	if (ENABLE_AUTH) {
		const { data: { session }, error } = await SB.auth.getSession();
		if (session) {
			if (session.access_token) {
				ACCESS_TOKEN = session.access_token;
			}
			Array.from(document.querySelectorAll(".loggedOut")).map(x => x.style.display = "none");
			// make sure row exists in profile
			await upsertProfile(session);
		} else {
			// No Session
			Array.from(document.querySelectorAll(".loggedIn")).map(x => x.style.display = "none");
			if (PAGE == "profile") {
				//window.location = `/pricing${HTML}`;
			}
		}
	}	else {
		// TEST. No Auth
		Array.from(document.querySelectorAll(".loggedIn")).map(x => x.style.display = "none");
		Array.from(document.querySelectorAll(".loggedOut")).map(x => x.style.display = "none");
		if (document.querySelector("#pricing")) {
			document.querySelector("#pricing").style.display = "none";
		}
	}

	if (PAGE === "barrels") {
		fetchBarrelsData();
	} else if (PAGE == "bvp") {
		fetchBVPData();
	} else if (PAGE == "stats") {
		fetchStatsData();
	} else if (PAGE == "pitcher_mix") {
		fetchMixData();
	} else if (PAGE == "preview") {
		fetchPreviewData();
	} else if (PAGE == "pricing") {
		document.querySelector("#pricing").style.display = "none";
	} else if (PAGE === "props") {
		fetchPropsData();
	} else if (PAGE == "dingers") {
		fetchDingersData();
		setInterval(() => {
			if (!MOBILE || document.hasFocus()) {
				fetchDingersData(render=false);
			}
		}, 60 * 1000);
	}
}