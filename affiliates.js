(() => {
  'use strict';
  PAGE = 'affiliates';
  const $ = id => document.getElementById(id);
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
  const date = value => value ? new Date(value).toLocaleDateString('en-US') : '-';
  let session = null, generation = 0, paying = null;
  $('account-link').href = `profile${HTML}`;
  function status(message, error = false) { $('aff-status').textContent = message; $('aff-status').dataset.error = String(error); }
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${API_BASE}/api/affiliates${path}`, {
      method, headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store',
    });
    if (path === '/admin/export' && response.ok) return response.blob();
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load the affiliate program. Please try again.');
    return result;
  }
  function cell(row, value) { const td = document.createElement('td'); td.textContent = String(value ?? '-'); row.appendChild(td); return td; }
  function button(parent, text, action, disabled = false) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.disabled = disabled;
    node.addEventListener('click', () => run(node, action)); parent.appendChild(node); return node;
  }
  async function run(control, action) {
    control.disabled = true; status('');
    try { await action(); } catch (error) {
      status(error.message, true);
      if ($('aff-pay-dialog').open) $('aff-pay-status').textContent = error.message;
    }
    finally { if (control.isConnected) control.disabled = false; }
  }
  function empty(tbody, columns, message) {
    const row = document.createElement('tr'); cell(row, message).colSpan = columns; tbody.appendChild(row);
  }
  function renderPartner(data) {
    const partner = data.partner, summary = data.summary || {};
    $('aff-link').value = partner.referral_url || `${location.origin}/pricing${HTML}?ref=${encodeURIComponent(partner.code)}`;
    $('aff-code').textContent = partner.code; $('aff-query').textContent = `?ref=${partner.code}`;
    $('aff-partner-state').textContent = partner.active ? 'Active code' : 'Code disabled for new referrals';
    const metrics = [['Signups', summary.signups || 0], ['Paid customers', summary.conversions || 0], ['Pending · 30-day hold', money(summary.pending_cents)], ['Available for payout', money(summary.available_cents)], ['Reserved for payout', money(summary.reserved_cents)], ['Paid to you', money(summary.paid_cents)]];
    $('aff-metrics').replaceChildren(...metrics.map(([label, value]) => {
      const node = document.createElement('div'); node.className = 'aff-metric';
      const caption = document.createElement('span'); caption.textContent = label;
      const total = document.createElement('strong'); total.textContent = value; node.append(caption, total); return node;
    }));
    const body = $('aff-payout-history'); body.replaceChildren();
    for (const payout of data.payouts || []) {
      const row = document.createElement('tr'); [date(payout.created_at), money(payout.amount_cents), payout.status, date(payout.paid_at), payout.external_reference || '-'].forEach(value => cell(row, value)); body.appendChild(row);
    }
    if (!body.children.length) empty(body, 5, 'No payouts yet.');
    $('aff-partner').hidden = false;
  }
  function renderAdmin(data) {
    const partners = data.partners || [], names = new Map(partners.map(p => [p.id, p.code]));
    const body = $('aff-admin-partners'); body.replaceChildren();
    for (const partner of partners) {
      const summary = partner.summary || partner;
      const row = document.createElement('tr'); cell(row, partner.code);
      cell(row, partner.email || '-'); cell(row, partner.user_id || '-');
      cell(row, partner.active ? 'Active' : 'Disabled');
      cell(row, summary.signups || 0); cell(row, summary.conversions || 0); cell(row, money(summary.available_cents));
      const actions = cell(row, '');
      button(actions, partner.active ? 'Disable code' : 'Enable code', async () => { await api(`/admin/partners/${encodeURIComponent(partner.id)}`, 'PATCH', { active: !partner.active }); await load(session); });
      button(actions, 'Reserve payout', async () => { await api('/admin/payouts', 'POST', { partner_id: partner.id }); await load(session); status('Batch reserved. Send payment outside the site, then record its reference.'); }, Number(summary.available_cents || 0) < 2500);
      body.appendChild(row);
    }
    if (!body.children.length) empty(body, 8, 'No partners yet. Create your first invitation above.');
    const payouts = $('aff-admin-payouts'); payouts.replaceChildren();
    for (const payout of data.payouts || []) {
      const row = document.createElement('tr');
      [payout.code || names.get(payout.partner_id || payout.affiliate_id) || 'Partner', date(payout.created_at), money(payout.amount_cents), payout.status, payout.external_reference || '-'].forEach(value => cell(row, value));
      const actions = cell(row, '');
      if (['reserved', 'pending'].includes(payout.status)) {
        button(actions, 'Record payment', () => {
          paying = payout; $('aff-pay-reference').value = '';
          $('aff-pay-status').textContent = '';
          $('aff-pay-description').textContent = `${money(payout.amount_cents)} for ${payout.code || names.get(payout.partner_id || payout.affiliate_id) || 'this partner'}. Batch ${payout.id}.`;
          $('aff-pay-dialog').showModal();
        });
        button(actions, 'Cancel batch', async () => { await api(`/admin/payouts/${encodeURIComponent(payout.id)}/cancel`, 'POST', {}); await load(session); });
      }
      payouts.appendChild(row);
    }
    if (!payouts.children.length) empty(payouts, 6, 'No payout batches yet.');
    $('aff-admin').hidden = false;
  }
  async function load(nextSession) {
    const version = ++generation; session = nextSession; ACCESS_TOKEN = session?.access_token || '';
    paying = null; $('aff-pay-dialog').close();
    for (const id of ['aff-guest', 'aff-uninvited', 'aff-partner', 'aff-admin']) $(id).hidden = true;
    for (const id of ['aff-admin-partners', 'aff-admin-payouts', 'aff-payout-history', 'aff-metrics']) $(id).replaceChildren();
    $('aff-link').value = ''; $('aff-code').textContent = '';
    for (const id of ['aff-query', 'aff-partner-state', 'aff-pay-description', 'aff-pay-status']) $(id).textContent = '';
    $('aff-pay-reference').value = '';
    if (!session) { $('aff-guest').hidden = false; status(''); return; }
    status('Loading referrals and earnings…');
    try {
      const data = await api('/me'); if (version !== generation) return;
      if (data.invited) renderPartner(data); else if (!data.admin) $('aff-uninvited').hidden = false;
      if (data.admin) { const admin = await api('/admin'); if (version !== generation) return; renderAdmin(admin); }
      status('');
    } catch (error) { if (version === generation) status(error.message, true); }
  }
  $('aff-refresh').addEventListener('click', () => load(session));
  for (const [id, value] of [['aff-copy-link', () => $('aff-link').value], ['aff-copy-code', () => $('aff-code').textContent]]) {
    $(id).addEventListener('click', () => run($(id), async () => {
      if (!navigator.clipboard?.writeText) { $('aff-link').focus(); $('aff-link').select(); throw new Error('Select and copy the link or code above.'); }
      await navigator.clipboard.writeText(value()); status('Copied.');
    }));
  }
  $('aff-invite').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    run(form.querySelector('button'), async () => {
      await api('/admin/partners', 'POST', { user_id: form.elements.user_id.value.trim(), code: form.elements.code.value.trim().toUpperCase(), active: true });
      form.reset(); await load(session); status('Partner created. Their code is available in their affiliate dashboard.');
    });
  });
  $('aff-export').addEventListener('click', () => run($('aff-export'), async () => {
    const blob = await api('/admin/export'), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `affiliate-payouts-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $('aff-pay-cancel').addEventListener('click', () => $('aff-pay-dialog').close());
  $('aff-pay-form').addEventListener('submit', event => {
    event.preventDefault(); if (!paying) return;
    const payout = paying, reference = $('aff-pay-reference').value.trim(); if (!reference) return;
    run(event.currentTarget.querySelector('button[type="submit"]'), async () => {
      await api(`/admin/payouts/${encodeURIComponent(payout.id)}/paid`, 'POST', { external_reference: reference });
      $('aff-pay-dialog').close(); await load(session); status('Payment recorded.');
    });
  });
  async function boot() {
    if (typeof SB === 'undefined' || !SB) { status('Sign-in is unavailable. Refresh and try again.', true); $('aff-guest').hidden = false; return; }
    SB.auth.onAuthStateChange((_event, next) => { if (next?.access_token !== session?.access_token) load(next); });
    const { data, error } = await SB.auth.getSession(); if (error) { status('Could not load your account. Refresh and try again.', true); return; }
    await load(data.session);
  }
  boot().catch(() => status('Could not load your account. Refresh and try again.', true));
})();
