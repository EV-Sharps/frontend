PAGE = 'profile';
ENABLE_AUTH = true;

const profileParams = new URLSearchParams(window.location.search);
SAVE_DISCORD = profileParams.get('saveDiscord');
const profileForm = document.getElementById('profile-preferences-form');
const profileFields = document.getElementById('profile-settings-fields');
const profileSave = document.getElementById('profile-save');
const profileReset = document.getElementById('profile-reset');
const profileSaveStatus = document.getElementById('profile-save-status');
let savedPreferenceValues = '';
let savingPreferences = false;

function profileStatus(element, message, tone = '') {
	element.textContent = message;
	element.dataset.tone = tone;
}

function showProfileState(state) {
	document.body.dataset.profileState = state;
	for (const [id, visible] of Object.entries({
		'profile-loading': state === 'loading', 'profile-guest': state === 'guest',
		'profile-dashboard': state === 'ready', 'profile-load-error': state === 'error'
	})) document.getElementById(id).hidden = !visible;
}

function preferenceValues() {
	return JSON.stringify(['state-select', 'odds-format-select', 'unit-size-input', 'profile-kelly-fraction', 'profile-kelly-custom'].map(id => document.getElementById(id).value));
}

function updatePreferenceState() {
	const dirty = preferenceValues() !== savedPreferenceValues;
	profileSave.disabled = savingPreferences || !dirty;
	profileReset.disabled = savingPreferences || !dirty;
	document.getElementById('odds-preview').textContent = document.getElementById('odds-format-select').value === 'decimal'
		? 'Example: 1.91 / 2.50' : 'Example: -110 / +150';
	return dirty;
}

function loadProfilePreferences() {
	const metadata = CURR_USER?.metadata || {};
	document.getElementById('state-select').value = (metadata.state || '').toUpperCase();
	document.getElementById('unit-size-input').value = metadata.unit_size || 100;
	document.getElementById('odds-format-select').value = metadata.odds_format === 'decimal' ? 'decimal' : 'american';
	const select = document.getElementById('profile-kelly-fraction');
	select.innerHTML = kellyFractionOptions();
	initKellyFractionFields(select, document.getElementById('profile-kelly-custom'), getProfileKellyFraction());
	savedPreferenceValues = preferenceValues();
	updatePreferenceState();
}

function renderProfileAccount() {
	const tier = ['analyst', 'sharp'].includes(CURR_USER.tier) ? CURR_USER.tier : 'free';
	const paid = tier !== 'free';
	const canceled = paid && !!CURR_USER.metadata?.canceled;
	const email = CURR_SESSION.user.email || 'Your account';
	document.getElementById('profile-username').textContent = email;
	document.getElementById('profile-avatar').textContent = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'EV';
	document.getElementById('profile-tier-badge').textContent = `${title(tier)} member`;
	document.getElementById('profile-plan').textContent = title(tier);
	const plans = {
		free: ['A place to start exploring.', ['Selected free pages', 'Basic stats and research previews', 'Free Discord channels']],
		analyst: ['Your core player-prop toolkit.', ['Core props and odds comparison', 'Custom devig and saved layouts', 'Analyst Discord channels']],
		sharp: ['The full slate, before and during the game.', ['Expanded props and alternate lines', 'Main markets and live pages', 'All Discord channels']]
	};
	document.getElementById('profile-plan-description').textContent = plans[tier][0];
	document.getElementById('profile-plan-benefits').replaceChildren(...plans[tier][1].map(text => {
		const li = document.createElement('li'); li.textContent = text; return li;
	}));
	const status = document.getElementById('profile-plan-status');
	profileStatus(status, canceled ? 'Ending' : paid ? 'Member' : 'Free plan', canceled ? 'warning' : paid ? 'success' : 'muted');
	const date = CURR_USER.next_renewal ? new Date(CURR_USER.next_renewal) : null;
	document.getElementById('next-renewal-label').textContent = !paid ? 'Billing' : canceled ? 'Access ends' : 'Next renewal';
	document.getElementById('next-renewal').textContent = !paid ? 'No subscription' : date && !Number.isNaN(date.getTime())
		? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not available';
	const billing = document.getElementById('profile-billing');
	billing.textContent = paid && !canceled ? 'Manage billing' : 'Explore plans';
	billing.dataset.action = paid && !canceled ? 'billing' : 'plans';
	const identity = CURR_SESSION.user.identities?.find(identity => identity.provider === 'discord');
	const connected = !!(CURR_USER.discord_id || identity);
	document.getElementById('discord-username').textContent = CURR_USER.discord_username || identity?.identity_data?.user_name || (connected ? 'Discord account linked' : 'Not connected yet');
	profileStatus(document.getElementById('profile-discord-status'), connected ? 'Connected' : 'Not linked', connected ? 'success' : 'muted');
	document.querySelector('#link-discord-btn .btn-text').textContent = connected ? 'Reconnect Discord' : 'Connect Discord';
	loadProfilePreferences();
}

async function loadProfilePage() {
	showProfileState('loading');
	try {
		await handleSession();
		if (!ACCESS_TOKEN) { showProfileState('guest'); return; }
		if (!CURR_USER || !CURR_SESSION) throw new Error('Profile unavailable');
		renderProfileAccount();
		showProfileState('ready');
	} catch (error) {
		showProfileState('error');
	}
}

profileForm.addEventListener('input', () => {
	if (!savingPreferences) profileStatus(profileSaveStatus, updatePreferenceState() ? 'You have unsaved changes.' : 'Your preferences are up to date.');
});
profileForm.addEventListener('change', () => {
	if (!savingPreferences) profileStatus(profileSaveStatus, updatePreferenceState() ? 'You have unsaved changes.' : 'Your preferences are up to date.');
});
profileReset.addEventListener('click', () => {
	loadProfilePreferences();
	profileStatus(profileSaveStatus, 'Changes reset. Your saved preferences are restored.');
});

profileForm.addEventListener('submit', async event => {
	event.preventDefault();
	if (savingPreferences || !CURR_USER || !CURR_SESSION || !profileForm.reportValidity()) return;
	try {
		const unitSize = Number(document.getElementById('unit-size-input').value);
		if (!Number.isSafeInteger(unitSize) || unitSize < 1) throw new Error('Enter a whole-dollar unit size of at least $1.');
		const fraction = readKellyFractionFields(document.getElementById('profile-kelly-fraction'), document.getElementById('profile-kelly-custom'));
		const metadata = {
			...CURR_USER.metadata,
			state: document.getElementById('state-select').value,
			odds_format: document.getElementById('odds-format-select').value,
			unit_size: unitSize, kelly_fraction: fraction
		};
		savingPreferences = true;
		profileFields.disabled = true;
		updatePreferenceState();
		profileSave.setAttribute('aria-busy', 'true');
		profileSave.textContent = 'Saving...';
		profileStatus(profileSaveStatus, 'Saving your preferences...');
		const { error } = await SB.from('profiles').update({ metadata }).eq('id', CURR_SESSION.user.id);
		if (error) throw new Error('Could not save your preferences. Please try again.');
		CURR_USER.metadata = metadata;
		cacheProfile(CURR_USER);
		savedPreferenceValues = preferenceValues();
		profileStatus(profileSaveStatus, 'All preferences saved.', 'success');
	} catch (error) {
		profileStatus(profileSaveStatus, error.message || 'Could not save. Please try again.', 'error');
	} finally {
		savingPreferences = false;
		profileFields.disabled = false;
		profileSave.removeAttribute('aria-busy');
		profileSave.textContent = 'Save preferences';
		updatePreferenceState();
	}
});

document.getElementById('profile-billing').addEventListener('click', async event => {
	const button = event.currentTarget;
	if (button.dataset.action === 'plans') { changePage('pricing'); return; }
	if (!ACCESS_TOKEN || !CURR_USER) return;
	const status = document.getElementById('profile-billing-status');
	button.disabled = true;
	button.setAttribute('aria-busy', 'true');
	button.textContent = 'Opening billing...';
	profileStatus(status, '');
	try {
		const response = await fetch(`${API_BASE}/api/stripe-portal`, { method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Tier: CURR_USER.tier } });
		if (!response.ok) throw new Error();
		const data = await response.json();
		if (!data.url) throw new Error();
		window.location.href = data.url;
	} catch (error) {
		profileStatus(status, 'Billing could not be opened. Please try again.', 'error');
	} finally {
		button.disabled = false;
		button.removeAttribute('aria-busy');
		button.textContent = 'Manage billing';
	}
});

document.getElementById('link-discord-btn').addEventListener('click', async event => {
	const button = event.currentTarget;
	const text = button.querySelector('.btn-text');
	const originalText = text.textContent;
	const spinner = button.querySelector('.spinner');
	const status = document.getElementById('discord-action-status');
	button.disabled = true;
	button.setAttribute('aria-busy', 'true');
	text.textContent = 'Connecting...';
	spinner.hidden = false;
	profileStatus(status, '');
	try {
		const { data, error } = await SB.auth.getSession();
		if (error || !data?.session?.user?.id) throw new Error();
		window.location.href = `${API_BASE}/api/discord/login?user_id=${encodeURIComponent(data.session.user.id)}`;
	} catch (error) {
		profileStatus(status, 'Could not connect. Sign in again and retry.', 'error');
		button.disabled = false;
		button.removeAttribute('aria-busy');
		text.textContent = originalText;
		spinner.hidden = true;
	}
});

const discordError = profileParams.get('discordError');
if (profileParams.has('discordSuccess') || discordError) {
	const notice = document.getElementById('profile-notice');
	const messages = {
		not_in_guild: 'Your Discord account is linked. Join our server using the link below, then reconnect Discord to refresh your membership roles.',
		cancelled: 'Discord connection was canceled. You can try again below.',
		missing_code: 'Discord could not be connected. Please try again below.'
	};
	profileStatus(notice, discordError ? messages[discordError] || 'Discord could not be connected. Please try again.' : 'Your Discord account is now connected.', discordError ? 'error' : 'success');
	notice.hidden = false;
	const url = new URL(window.location.href);
	url.searchParams.delete('discordError'); url.searchParams.delete('discordSuccess');
	history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

document.getElementById('profile-retry').addEventListener('click', loadProfilePage);
loadProfilePage();
