(function () {
  'use strict';
  if (window.EVAffiliateReferrals) return;
  const KEY = 'ev_affiliate_referral_v1';
  let fallback = null, pendingCapture = Promise.resolve(), pendingClaim = null;
  let verified = null, revision = 0, draftEdited = false;
  const normalize = value => String(value || '').trim().toUpperCase();
  function read() {
    let value = fallback;
    try { value = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (!value || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()) return null;
    return value;
  }
  function store(value) {
    fallback = value;
    try { value ? localStorage.setItem(KEY, JSON.stringify(value)) : localStorage.removeItem(KEY); } catch (_) {}
    document.dispatchEvent(new Event('affiliate-referral-change'));
  }
  async function request(path, options = {}, token = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try { response = await fetch(`${API_BASE}/api/affiliates${path}`, {
      ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal,
    }); } catch (error) {
      if (error.name === 'AbortError') throw new Error('Checking your code took too long. Please try again.');
      throw error;
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'The referral code could not be checked. Please try again.');
      error.status = response.status; error.code = data.code; throw error;
    }
    return data;
  }
  async function capture(code) {
    code = normalize(code);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code)) throw new Error('Enter a code using 3–24 letters, numbers, underscores, or hyphens.');
    const existing = read();
    if (existing?.code === code && existing.visit_token) return existing;
    const data = await request('/capture', { method: 'POST', body: JSON.stringify({ code }) });
    store(data);
    return data;
  }
  async function claimPending(session) {
    await pendingCapture;
    if (!session?.access_token || !session?.user?.id) return null;
    const entry = read();
    if (!entry || entry.claimed_user_id === session.user.id || (entry.claimed_user_id && !entry.visit_token)) return null;
    if (pendingClaim) return pendingClaim;
    const currentRevision = revision;
    pendingClaim = request('/claim', { method: 'POST', body: JSON.stringify(entry.visit_token ? { visit_token: entry.visit_token } : { code: entry.code }) }, session.access_token)
      .then(data => {
        if (revision === currentRevision) store({ ...entry, ...data, claimed_user_id: session.user.id });
        return data;
      }).catch(error => {
        if (revision === currentRevision && [404, 409, 410].includes(error.status)) store(null);
        return null;
      }).finally(() => { pendingClaim = null; });
    return pendingClaim;
  }
  async function check(code, token) {
    const data = await request('/claim', { method: 'POST', body: JSON.stringify({ code: normalize(code) }) }, token);
    verified = data;
    store({ code: data.code, expires_at: data.expires_at, explicit: true });
    return data;
  }
  async function prepareCheckout(token) {
    await pendingCapture;
    if (pendingClaim) await pendingClaim;
    const input = document.getElementById('affiliate-code');
    const entry = read();
    const code = normalize(input ? input.value : entry?.explicit ? entry.code : '');
    if (verified?.locked && (!code || code === verified.code)) return {};
    if (!draftEdited && entry?.visit_token && code === entry.code) return { visit_token: entry.visit_token };
    if (code) {
      const result = await check(code, token);
      renderPricing(result, 'Code applied. Your first month is 20% off.');
      return { code: result.code };
    }
    return entry?.visit_token ? { visit_token: entry.visit_token } : {};
  }
  async function beforeSignIn() {
    await pendingCapture;
    const input = document.getElementById('affiliate-code');
    if (draftEdited && normalize(input?.value)) {
      pendingCapture = capture(input.value).catch(() => null);
      await pendingCapture;
    }
  }
  function renderPricing(data, message) {
    const status = document.getElementById('affiliate-code-status');
    if (!status) return;
    const applied = !!data?.code && data.discount_percent === 20 && !data.locked;
    status.textContent = message || (applied ? `Code ${data.code} applied. Your first month is 20% off.` : 'Optional. Partner codes are for your first paid membership.');
    document.getElementById('affiliate-code-remove').hidden = !data?.code && !read();
    for (const tier of ['analyst', 'sharp']) {
      const hint = document.getElementById(`affiliate-price-${tier}`);
      if (!hint) continue;
      hint.hidden = !applied;
      hint.textContent = tier === 'analyst' ? '$8 first month, then $10/month' : '$20 first month, then $25/month';
    }
  }
  async function refreshPricing() {
    const input = document.getElementById('affiliate-code');
    if (!input) return;
    await pendingCapture;
    const currentRevision = revision;
    const saved = read();
    if (!input.value && saved) input.value = saved.code;
    if (typeof ACCESS_TOKEN === 'undefined' || !ACCESS_TOKEN) {
      renderPricing(null, saved ? 'Sign in to apply this partner code and check eligibility.' : undefined); return;
    }
    try {
      if (saved?.visit_token) await claimPending({ access_token: ACCESS_TOKEN, user: { id: typeof CURR_SESSION !== 'undefined' ? CURR_SESSION?.user?.id : '' } });
      const data = await request('/referral', {}, ACCESS_TOKEN);
      if (currentRevision !== revision) return;
      verified = data;
      if (verified.code) input.value = verified.code;
      renderPricing(verified, verified.locked ? 'Your referral is already recorded. The introductory offer applies only to your first month.' : undefined);
    } catch (error) {
      if (currentRevision !== revision) return;
      renderPricing(null, error.status === 503 || error.status === 404 ? 'Partner codes are not available yet.' : error.message);
    }
  }
  function bindPricing() {
    const form = document.getElementById('affiliate-code-form');
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        revision++;
        const code = document.getElementById('affiliate-code').value;
        if (!ACCESS_TOKEN) {
          pendingCapture = capture(code); await pendingCapture;
          renderPricing(null, 'Code saved. Sign in with Discord or Google to check eligibility.');
        } else { const data = await check(code, ACCESS_TOKEN); renderPricing(data); }
      }
      catch (error) { verified = null; renderPricing(null, error.message); }
      finally { pendingCapture = pendingCapture.catch(() => null); button.disabled = false; }
    });
    document.getElementById('affiliate-code').addEventListener('input', () => {
      revision++; draftEdited = true; verified = null; renderPricing(null, 'Apply your code to check eligibility.');
    });
    document.getElementById('affiliate-code-remove').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await pendingCapture;
        if (pendingClaim) await pendingClaim;
        if (ACCESS_TOKEN) await request('/referral', { method: 'DELETE' }, ACCESS_TOKEN);
        revision++; verified = null; draftEdited = false; store(null); document.getElementById('affiliate-code').value = '';
        const url = new URL(location.href); url.searchParams.delete('ref'); history.replaceState(history.state, '', url);
        renderPricing(null);
      } catch (error) { renderPricing(verified, error.message); }
      finally { button.disabled = false; }
    });
    refreshPricing();
    document.addEventListener('affiliate-session-ready', refreshPricing);
  }
  const code = new URLSearchParams(location.search).get('ref');
  if (code) pendingCapture = capture(code).catch(() => null);
  window.EVAffiliateReferrals = { read, capture, claimPending, prepareCheckout, refreshPricing, beforeSignIn };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPricing, { once: true });
  else bindPricing();
})();
