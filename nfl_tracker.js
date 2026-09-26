/* The collector supplies game clocks. Never run a simulated clock in the browser. */
PAGE = 'nfl_tracker';
SPORT = new URLSearchParams(window.location.search).get('sport') === 'ncaaf' ? 'ncaaf' : 'nfl';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const sport = SPORT;
  const league = sport === 'ncaaf' ? 'College football' : 'NFL';
  const dataset = `${sport}_tracker`;
  document.title = `${league} Game Tracker | +EV Sharps`;
  $('league-name').textContent = sport === 'ncaaf' ? 'COLLEGE FOOTBALL' : 'NFL';
  $('tracker-footer-label').textContent = `${league} Game Tracker`;
  $('games').setAttribute('aria-label', `${league} games`);
  $('league-coverage').hidden = sport !== 'ncaaf';
  for (const link of document.querySelectorAll('[data-league]')) {
    if (link.dataset.league === sport) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const age = value => Number.isFinite(Date.parse(value)) ? Math.max(0, (Date.now() - Date.parse(value)) / 1000) : Infinity;
  const elapsed = seconds => !Number.isFinite(seconds) ? 'unknown' : seconds < 60 ? `${Math.floor(seconds)}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  const abbrev = team => String(team?.abbreviation || team?.key || '?').toUpperCase();
  const cards = new Map();
  let snapshot = null, filter = 'all', pending = null, requestFailed = false;

  function safeURL(value, image = false) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (url.protocol === 'https:' && (image ? host === 'a.espncdn.com' : host === 'espn.com' || host.endsWith('.espn.com'))) return url.href;
    } catch (_) { /* No link is preferable to an invalid source URL. */ }
    return '';
  }

  function kickoff(game) {
    const date = new Date(game.start);
    if (!Number.isFinite(date.getTime())) return 'Time TBD';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  }

  function offense(game) {
    if (game.status?.state !== 'in' || /HALFTIME|SUSPEND|DELAY|END_PERIOD/.test(game.status?.name || '')) return null;
    const s = game.situation || {};
    for (const side of ['away', 'home']) {
      const team = game[side];
      if (team && ((s.possession_team_id != null && team.id != null && String(s.possession_team_id) === String(team.id)) ||
          (s.possession && team.key && s.possession === team.key))) return side;
    }
    return null;
  }

  // Away always defends the left end of this schematic. Use ESPN's named field
  // position, not raw yard_line: that number's orientation differs across feeds.
  function fieldPosition(game, side) {
    if (!side) return null;
    const s = game.situation || {};
    const text = String(s.possession_text || '').trim();
    if (/^(?:MIDFIELD|50(?: YD(?: LINE)?)?)$/i.test(text)) return 50;
    const match = text.match(/^([A-Z0-9]+)\s+(\d{1,2})(?:\s*(?:YD|YARD)(?: LINE)?)?$/i);
    if (match) {
      const yards = Number(match[2]);
      if (yards <= 50) {
        const spot = match[1].toUpperCase();
        for (const end of ['away', 'home']) {
          const team = game[end];
          if ([abbrev(team), String(team?.key || '').toUpperCase()].includes(spot)) return end === 'away' ? yards : 100 - yards;
        }
      }
    }
    // Only use summary coordinates when its exact play matches the current board
    // and the endpoint still belongs to the team now in possession.
    const last = game.last_play;
    if (!last?.id) return null;
    const detail = (game.details?.plays || []).find(play => String(play.id) === String(last.id));
    for (const play of [last, detail]) {
      const end = play?.end;
      const yards = number(end?.yards_to_endzone);
      if (end?.team_id != null && game[side]?.id != null && String(end.team_id) === String(game[side].id) && yards !== null && yards >= 0 && yards <= 100) {
        return side === 'away' ? 100 - yards : yards;
      }
    }
    return null;
  }

  function teamRow(game, side, possession) {
    const team = game[side] || {};
    const logo = safeURL(team.logo, true);
    const score = game.status?.state === 'pre' ? null : number(team.score);
    const name = team.short_name || team.name || abbrev(team);
    return `<div class="gt-team" data-team="${side}">
      ${logo ? `<img class="gt-team-logo" src="${escape(logo)}" alt="" data-abbr="${escape(abbrev(team))}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="gt-team-monogram">${escape(abbrev(team))}</span>`}
      <div class="gt-team-name">${escape(name)}<small>${escape(abbrev(team))} <span aria-hidden="true">·</span> ${side.toUpperCase()}</small></div>
      <span>${possession === side ? '<span class="gt-possession"><i class="gt-football" aria-hidden="true"></i> BALL</span>' : ''}</span>
      <span class="gt-score${score === null ? ' is-dim' : ''}" aria-label="${escape(abbrev(team))} score ${score ?? 'not started'}">${score ?? '—'}</span>
    </div>`;
  }

  function gameHTML(game) {
    const status = game.status || {}, s = game.situation || {};
    const side = offense(game), down = number(s.down), distance = number(s.distance);
    const normalDown = down !== null && down >= 1 && down <= 4;
    const x = fieldPosition(game, side);
    const gain = x !== null && normalDown && distance !== null && distance > 0 ? Math.max(0, Math.min(100, x + (side === 'away' ? distance : -distance))) : null;
    const red = Boolean(side && normalDown && s.red_zone);
    const live = status.state === 'in';
    const phase = status.detail || (live ? 'In progress' : status.state === 'post' ? 'Final' : 'Scheduled');
    const downText = normalDown ? (s.down_distance_text || `${['', '1st', '2nd', '3rd', '4th'][down]} & ${distance ?? '?'}`) : null;
    const situation = live ? downText || (/HALFTIME/.test(status.name || '') ? 'Halftime' : 'Awaiting next possession') : status.state === 'post' ? 'Game complete' : 'Kickoff ' + kickoff(game);
    const direction = side ? `${escape(abbrev(game[side]))} moving ${side === 'away' ? 'right →' : '← left'}` : 'Possession not reported';
    const last = game.last_play;
    const playClock = last?.clock ? `${last.period > 4 ? 'OT' : last.period ? 'Q' + last.period : ''} ${last.clock}`.trim() : '';
    const playText = last?.text || (status.state === 'pre' ? 'The latest play will appear here once the game gets underway.' : 'Waiting for ESPN to report the latest play.');
    const url = safeURL(game.url);
    return `<div class="gt-game-head"><span class="gt-phase ${live ? 'in' : ''}">${live ? '<i class="gt-live-dot" aria-hidden="true"></i>' : ''}${escape(phase)}</span>
      ${red ? '<span class="gt-red-zone">RED ZONE</span>' : `<span class="gt-kickoff">${escape(kickoff(game))}</span>`}</div>
      <div class="gt-scoreboard">${teamRow(game, 'away', side)}${teamRow(game, 'home', side)}</div>
      <div class="gt-situation"><strong>${escape(situation)}</strong><span>${side ? escape(abbrev(game[side])) + ' ball' : ''}</span></div>
      <div class="gt-field-wrap"><div class="gt-field" role="img" aria-label="${escape(x === null ? 'Field position unavailable' : `${s.possession_text || 'Ball on field'}, ${abbrev(game[side])} possession`)}">
        <div class="gt-endzone">${escape(abbrev(game.away))}</div><div class="gt-field-yardage">
          ${red ? `<div class="gt-field-zone" style="${side === 'away' ? 'right' : 'left'}:0"></div>` : ''}
          ${[10, 30, 50, 70, 90].map(n => `<span class="gt-yard-label" style="left:${n}%">${n > 50 ? 100 - n : n}</span>`).join('')}
          ${gain !== null ? `<i class="gt-line gain" style="left:${gain}%"></i>` : ''}
          ${x !== null ? `<i class="gt-line los" style="left:${x}%"></i><i class="gt-ball" style="left:${x}%"></i>` : ''}
        </div><div class="gt-endzone">${escape(abbrev(game.home))}</div>
        ${x === null ? `<span class="gt-field-unknown">${live ? 'Field position unavailable' : status.state === 'post' ? 'Final' : 'Pregame'}</span>` : ''}</div>
        <div class="gt-field-caption"><span>${live ? direction : status.state === 'post' ? 'Final score' : 'Waiting for kickoff'}</span><span>${x !== null ? escape(s.possession_text || '') : '—'}</span></div>
      </div>
      <section class="gt-last-play"><div class="gt-play-heading"><h3>LAST PLAY</h3><span>${escape(playClock)}</span></div><p class="gt-play-text">${escape(playText)}</p></section>
      <div class="gt-game-foot"><span class="gt-game-age"></span>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Game details ↗</a>` : '<span>ESPN</span>'}</div>`;
  }

  function render() {
    if (!snapshot) return;
    const counts = { all: snapshot.data.length, in: 0, pre: 0, post: 0 };
    for (const game of snapshot.data) if (game.status?.state in counts && game.status.state !== 'all') counts[game.status.state]++;
    for (const [key, count] of Object.entries(counts)) $('count-' + key).textContent = count;
    $('game-count').textContent = `${counts.all} game${counts.all === 1 ? '' : 's'}`;
    const day = new Date(snapshot.date + 'T12:00:00Z');
    $('slate-date').textContent = Number.isFinite(day.getTime()) ? day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : `${league} slate`;
    const keep = new Set(snapshot.data.map(game => String(game.id)));
    for (const [id, entry] of cards) if (!keep.has(id)) { entry.element.remove(); cards.delete(id); }
    let visible = 0;
    const ordered = [...snapshot.data].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')) || String(a.game || '').localeCompare(String(b.game || '')));
    ordered.forEach((game, index) => {
      const id = String(game.id), html = gameHTML(game);
      let entry = cards.get(id);
      if (!entry) {
        const element = document.createElement('article');
        element.className = 'gt-game'; element.dataset.gameId = id;
        entry = { element, html: null }; cards.set(id, entry);
      }
      entry.game = game;
      if (entry.html !== html) { entry.element.innerHTML = html; entry.html = html; }
      entry.element.setAttribute('aria-label', String(game.game || `${abbrev(game.away)} at ${abbrev(game.home)}`));
      entry.element.classList.toggle('is-red-zone', Boolean(offense(game) && game.situation?.down >= 1 && game.situation?.down <= 4 && game.situation?.red_zone));
      entry.element.hidden = filter !== 'all' && game.status?.state !== filter;
      if (!entry.element.hidden) visible++;
      // Do not replace unchanged cards on every poll (preserves keyboard focus).
      if ($('games').children[index] !== entry.element) $('games').insertBefore(entry.element, $('games').children[index] || null);
    });
    $('empty-state').hidden = visible > 0;
    $('empty-state').textContent = counts.all ? 'No games in this view. Try All games.' : `No ${league === 'NFL' ? 'NFL' : 'college football'} games scheduled for this date.`;
    $('games').setAttribute('aria-busy', 'false');
    updateFreshness();
  }

  function updateFreshness() {
    if (!snapshot) return;
    const seconds = age(snapshot.scoreboard_updated), threshold = Math.max(45, (number(snapshot.poll_interval_seconds) || 15) * 3);
    const stale = snapshot.scoreboard_stale || seconds > threshold;
    $('connection').textContent = requestFailed ? 'Updates interrupted' : stale ? 'Feed delayed' : 'Auto-refresh on';
    $('connection').className = 'gt-connection ' + (stale || requestFailed ? 'is-stale' : 'is-current');
    $('feed-age').textContent = `Scoreboard fetched ${elapsed(seconds)} ago · 15s refresh`;
    $('freshness-status').hidden = !stale;
    $('freshness-status').textContent = 'The scoreboard feed is delayed. Scores, possession and clock show the last received update.';
    for (const entry of cards.values()) {
      const freshness = entry.game.freshness || {};
      const gameAge = age(freshness.scoreboard_updated || snapshot.scoreboard_updated);
      const gameStale = freshness.scoreboard_stale || gameAge > threshold;
      const label = entry.element.querySelector('.gt-game-age');
      label.textContent = `${gameStale ? 'Delayed · ' : ''}Fetched ${elapsed(gameAge)} ago`;
      label.classList.toggle('gt-game-stale', gameStale);
    }
  }

  async function load() {
    $('refresh').disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${API_BASE}/api/${sport}-tracker`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error('unavailable');
      const next = await response.json();
      if (next?.schema_version !== 1 || next.sport !== sport || !Array.isArray(next.data) || !Number.isFinite(Date.parse(next.updated)) ||
          next.data.some(game => !game || !game.id) || new Set(next.data.map(game => String(game.id))).size !== next.data.length) throw Error('invalid snapshot');
      if (snapshot && Date.parse(next.updated) < Date.parse(snapshot.updated)) throw Error('older snapshot');
      snapshot = next; requestFailed = false;
      $('request-status').hidden = !snapshot.partial || Boolean(snapshot.scoreboard_stale);
      $('request-status').textContent = 'Some game details are delayed. Scores and last plays use the latest available scoreboard.';
      render();
    } catch (_) {
      requestFailed = true;
      $('request-status').hidden = false;
      $('request-status').textContent = snapshot ? 'Could not refresh. Showing the last received games; retrying automatically.' : 'The game tracker is unavailable right now. Retrying automatically.';
      if (!snapshot) {
        $('connection').textContent = 'Waiting for the feed'; $('connection').className = 'gt-connection is-stale';
        $('feed-age').textContent = 'Retrying every 15 seconds';
        $('empty-state').textContent = 'Games will appear when the feed is available.';
        $('games').setAttribute('aria-busy', 'false');
      }
      updateFreshness();
    } finally { clearTimeout(timeout); $('refresh').disabled = false; }
  }

  function refresh() {
    if (!pending) pending = load().finally(() => { pending = null; });
    return pending;
  }
  refresh.requestLatest = () => pending ? pending.then(() => refresh()) : refresh();
  window.refreshNFLTracker = refresh;
  $('refresh').addEventListener('click', refresh);
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  });
  $('games').addEventListener('error', event => {
    if (event.target.matches('img.gt-team-logo')) {
      const fallback = document.createElement('span'); fallback.className = 'gt-team-monogram';
      fallback.textContent = event.target.dataset.abbr; event.target.replaceWith(fallback);
    }
  }, true);
  registerOddsLiveRefresh(refresh, dataset);
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 15000);
  setInterval(updateFreshness, 5000);
  refresh();
})();
