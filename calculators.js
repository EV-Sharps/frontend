(() => {
  'use strict';
  PAGE = 'calculators';
  SPORT = '';
  const $ = id => document.getElementById(id);
  const form = $('arb-form');
  const oddsInputs = [0, 1].map(side => $(`arb-odds-${side}`));
  const stakeInputs = [0, 1].map(side => $(`arb-stake-${side}`));
  const payouts = [0, 1].map(side => $(`arb-payout-${side}`));
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  let stakeSide = 0;

  function calculate() {
    [...oddsInputs, ...stakeInputs].forEach(input => input.removeAttribute('aria-invalid'));
    let invalid = null;
    for (const input of oddsInputs) {
      if (!input.validity.valid || !Number.isSafeInteger(input.valueAsNumber) || Math.abs(input.valueAsNumber) < 100) {
        input.setAttribute('aria-invalid', 'true');
        invalid = 'Enter American odds of +100 or higher, or -100 or lower.';
      }
    }
    const stakeInput = stakeInputs[stakeSide];
    if (!stakeInput.validity.valid || !Number.isFinite(stakeInput.valueAsNumber)) {
      stakeInput.setAttribute('aria-invalid', 'true');
      invalid = 'Enter a stake from $0 to $1,000,000,000, using up to two decimal places.';
    }
    try {
      if (invalid) throw new Error(invalid);
      const result = CalculatorsMath.calculateArbitrage({
        odds: oddsInputs.map(input => input.valueAsNumber), stake: stakeInput.valueAsNumber, stakeSide,
      });
      stakeInputs[1 - stakeSide].value = result.stakes[1 - stakeSide].toFixed(2);
      payouts.forEach((input, side) => { input.value = result.payouts[side].toFixed(2); });
      $('arb-total-stake').textContent = money(result.totalStake);
      $('arb-total-payout').textContent = money(result.totalPayout);
      $('arb-profit').textContent = money(result.profit);
      $('arb-profit-percent').textContent = result.totalPayout === 0 && result.totalStake > 0 ? '' : `(${result.profitPercent.toFixed(2)}%)`;
      form.dataset.result = result.profit > 0 ? 'positive' : result.profit < 0 ? 'negative' : 'neutral';
      $('arb-status').textContent = result.totalStake === 0 ? 'Enter a stake to calculate your return.'
        : result.profit > 0 ? 'Positive profit on either outcome.'
        : result.profit < 0 ? 'No arbitrage with these stakes and odds.' : 'Break-even after rounding.';
    } catch (error) {
      stakeInputs[1 - stakeSide].value = '';
      payouts.forEach(input => { input.value = ''; });
      ['arb-total-stake', 'arb-total-payout', 'arb-profit'].forEach(id => { $(id).textContent = '\u2014'; });
      $('arb-profit-percent').textContent = '';
      form.dataset.result = 'invalid';
      $('arb-status').textContent = error.message;
    }
  }

  oddsInputs.forEach(input => input.addEventListener('input', calculate));
  stakeInputs.forEach((input, side) => input.addEventListener('input', () => { stakeSide = side; calculate(); }));
  form.addEventListener('submit', event => event.preventDefault());
  $('arb-reset').addEventListener('click', () => { form.reset(); stakeSide = 0; calculate(); });
  calculate();

  const converterForm = $('odds-form');
  const converterFields = Object.fromEntries(['fraction', 'decimal', 'american', 'probability'].map(format => [format, $(`odds-${format}`)]));
  const betAmount = $('odds-amount');
  let oddsSource = 'american';

  function convertedValue(value, format) {
    const rounded = value.toFixed(2);
    // Keep very short/long odds on the valid side of zero, 1.00, and 100%.
    if (Number(rounded) === 0 || (format === 'decimal' && Number(rounded) === 1) || (format === 'probability' && Number(rounded) === 100)) return String(value);
    return format === 'american' ? String(Number(rounded)) : rounded;
  }
  function clearConverterPayout() {
    $('odds-to-win').value = '';
    $('odds-payout').value = '';
  }
  function converterError(message) {
    converterForm.dataset.result = 'invalid';
    $('odds-status').textContent = message;
    $('odds-status').hidden = false;
    clearConverterPayout();
  }
  function convert() {
    Object.values(converterFields).forEach(input => input.removeAttribute('aria-invalid'));
    betAmount.removeAttribute('aria-invalid');
    const source = { format: oddsSource, value: converterFields[oddsSource].valueAsNumber };
    try {
      const formats = CalculatorsMath.convertOdds({ ...source, stake: 0 });
      for (const [format, input] of Object.entries(converterFields)) {
        if (format !== oddsSource) input.value = convertedValue(formats[format], format);
      }
    } catch (error) {
      converterFields[oddsSource].setAttribute('aria-invalid', 'true');
      Object.entries(converterFields).forEach(([format, input]) => { if (format !== oddsSource) input.value = ''; });
      converterError(error.message);
      return;
    }
    try {
      if (!betAmount.validity.valid || !Number.isFinite(betAmount.valueAsNumber)) throw new Error('Enter a bet amount from $0 to $1,000,000,000, using up to two decimal places.');
      const result = CalculatorsMath.convertOdds({ ...source, stake: betAmount.valueAsNumber });
      $('odds-to-win').value = result.toWin.toFixed(2);
      $('odds-payout').value = result.payout.toFixed(2);
      converterForm.dataset.result = 'valid';
      $('odds-status').textContent = '';
      $('odds-status').hidden = true;
    } catch (error) {
      betAmount.setAttribute('aria-invalid', 'true');
      converterError(error.message);
    }
  }
  Object.entries(converterFields).forEach(([format, input]) => input.addEventListener('input', () => { oddsSource = format; convert(); }));
  betAmount.addEventListener('input', convert);
  converterForm.addEventListener('submit', event => event.preventDefault());
  $('odds-reset').addEventListener('click', () => { converterForm.reset(); oddsSource = 'american'; convert(); });
  convert();

  const calculatorTabs = [...document.querySelectorAll('.calc-tabs [role="tab"]')];
  function selectCalculator(name, updateURL = true) {
    const active = calculatorTabs.find(tab => tab.id === `calc-tab-${name}`) || calculatorTabs[0];
    calculatorTabs.forEach(tab => {
      const selected = tab === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
    });
    if (updateURL) {
      const url = new URL(window.location.href);
      url.hash = active.id.replace('calc-tab-', '');
      history.replaceState(null, '', url);
    }
  }
  calculatorTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectCalculator(tab.id.replace('calc-tab-', '')));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % calculatorTabs.length;
      else if (event.key === 'ArrowLeft') next = (index + calculatorTabs.length - 1) % calculatorTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = calculatorTabs.length - 1;
      else return;
      event.preventDefault();
      calculatorTabs[next].focus();
      selectCalculator(calculatorTabs[next].id.replace('calc-tab-', ''));
    });
  });
  window.addEventListener('hashchange', () => selectCalculator(window.location.hash.slice(1), false));
  selectCalculator(window.location.hash.slice(1), false);

  const account = $('account-link');
  account.href = `profile${HTML}`;
  function updateAccount(session) {
    CURR_SESSION = session;
    ACCESS_TOKEN = session?.access_token || '';
    if (!session || CURR_USER?.id !== session.user?.id) CURR_USER = null;
    account.textContent = ACCESS_TOKEN ? 'My account' : 'Sign in';
  }
  if (SB?.auth) {
    SB.auth.onAuthStateChange((_event, session) => updateAccount(session));
    SB.auth.getSession().then(({ data }) => updateAccount(data?.session)).catch(() => {});
  }
})();
