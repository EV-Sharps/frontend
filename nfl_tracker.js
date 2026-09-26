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
  let touchdownGameId = null, touchdownHTML = null, touchdownScroll = null;
  let allScorersOpen = false;
  let statsHTML = null, statsScroll = null, statsGameOptions = null, statsCategoryOptions = null;
  const statCategories = {
    passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', defensive: 'Defense',
    fumbles: 'Fumbles', kicking: 'Kicking', kickReturns: 'Kick returns', puntReturns: 'Punt returns', punting: 'Punting',
  };
  const statLabel = category => statCategories[category] || String(category).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  const summaryDelayed = game => game.freshness?.summary_stale || (game.status?.state === 'in' && age(game.freshness?.summary_updated) > Math.max(60, (number(snapshot?.summary_interval_seconds) || 30) * 2));

  function touchdowns(game) {
    const details = game.details;
    const source = Array.isArray(details?.scoring_plays) ? details.scoring_plays : (details?.plays || []).filter(play => play.scoring_play === true);
    const unique = new Map();
    source.forEach((play, index) => { if (play && play.id != null) unique.set(String(play.id), { ...play, index }); });
    const clockSeconds = clock => /^\d+:\d{2}$/.test(clock || '') ? clock.split(':').reduce((minutes, seconds) => Number(minutes) * 60 + Number(seconds)) : null;
    return [...unique.values()].filter(play => {
      if (play.scoring_play === false) return false;
      const kind = String(play.scoring_type || '').toLowerCase();
      if (kind) return kind === 'touchdown' || kind === 'td';
      const value = number(play.score_value);
      if (value !== null && value > 0) return value === 6;
      return /touchdown/i.test(play.type || '') || (play.scoring_play === true && /\b(?:touchdown|td)\b/i.test(play.text || ''));
    }).sort((a, b) => {
      const ap = number(a.period), bp = number(b.period), ac = clockSeconds(a.clock), bc = clockSeconds(b.clock);
      if (ap !== null && bp !== null && ap !== bp) return ap - bp;
      if (ap === bp && ac !== null && bc !== null && ac !== bc) return bc - ac;
      return a.index - b.index;
    });
  }

  function touchdownKind(play) {
    const type = String(play.type || '');
    if (/interception/i.test(type)) return 'Interception return TD';
    if (/fumble/i.test(type)) return 'Fumble TD';
    if (/kickoff|kick return/i.test(type)) return 'Kick return TD';
    if (/punt/i.test(type)) return 'Punt return TD';
    if (/rush/i.test(type)) return 'Rushing TD';
    if (/pass|recep/i.test(type)) return 'Receiving TD';
    return 'Touchdown';
  }

  function gameScoreStatus(game) {
    const scores = game.status?.state === 'pre' ? '' : `${abbrev(game.away)} ${number(game.away?.score) ?? '-'} · ${abbrev(game.home)} ${number(game.home?.score) ?? '-'} / `;
    return `${scores}${game.status?.detail || kickoff(game)}`;
  }

  function touchdownGameStatus(game, plays) {
    return `${gameScoreStatus(game)} / ${plays.length} touchdown${plays.length === 1 ? '' : 's'} reported`;
  }

  function touchdownList(game, plays) {
    return `<ol class="gt-td-list">${plays.map((play, index) => {
      const team = [game.away, game.home].find(team => team?.id != null && String(team.id) === String(play.team_id));
      const logo = safeURL(team?.logo, true);
      const period = number(play.period);
      const when = [period ? period > 4 ? `${period === 5 ? '' : period - 4}OT` : `Q${period}` : '', play.clock].filter(Boolean).join(' / ') || 'Time not reported';
      const away = number(play.away_score), home = number(play.home_score);
      return `<li class="gt-td-play" data-play-id="${escape(play.id)}">
        <div class="gt-td-marker">${logo ? `<img class="gt-team-logo" src="${escape(logo)}" alt="" data-abbr="${escape(abbrev(team))}" referrerpolicy="no-referrer">` : `<span class="gt-team-monogram">${escape(team ? abbrev(team) : 'TD')}</span>`}<span>TD ${index + 1}</span></div>
        <div class="gt-td-copy"><div class="gt-td-play-heading"><strong>${escape(team ? abbrev(team) : 'Team not reported')} <span>${escape(touchdownKind(play))}</span></strong><span>${escape(when)}</span></div>
        <p>${escape(play.text || touchdownKind(play))}</p>${away !== null && home !== null ? `<small class="gt-td-score">${escape(abbrev(game.away))} ${away} <span aria-hidden="true">·</span> ${escape(abbrev(game.home))} ${home}</small>` : ''}</div></li>`;
    }).join('')}</ol>`;
  }

  function orderedGames() {
    return [...(snapshot?.data || [])].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')) || String(a.game || '').localeCompare(String(b.game || '')));
  }

  function renderTouchdowns() {
    if (touchdownGameId === null && !allScorersOpen) return;
    const content = $('touchdown-content');
    let html;
    if (allScorersOpen) {
      const games = orderedGames();
      const groups = games.map(game => ({ game, plays: touchdowns(game) })).filter(group => group.plays.length);
      const total = groups.reduce((sum, group) => sum + group.plays.length, 0);
      $('touchdown-title').textContent = 'All scorers';
      $('touchdown-game-status').textContent = `${league} / ${$('slate-date').textContent} / ${total} touchdown${total === 1 ? '' : 's'} reported in ${groups.length} game${groups.length === 1 ? '' : 's'}`;
      html = groups.length ? groups.map(({ game, plays }, index) => `<section class="gt-td-group" data-scoring-game="${escape(game.id)}" aria-labelledby="scoring-game-${index}">
        <div class="gt-td-group-heading"><h3 id="scoring-game-${index}">${escape(abbrev(game.away))} at ${escape(abbrev(game.home))}</h3><p>${escape(touchdownGameStatus(game, plays))}</p></div>
        ${touchdownList(game, plays)}</section>`).join('') : `<p class="gt-td-empty">${!games.length ? 'No games scheduled for this date.' : games.every(game => game.status?.state === 'pre') ? 'Touchdown scorers will appear here after kickoff.' : 'No touchdowns reported yet. Scorers will appear here as game summaries update.'}</p>`;
    } else {
      const game = cards.get(touchdownGameId)?.game;
      if (!game) { $('touchdown-dialog').close(); return; }
      const plays = touchdowns(game);
      $('touchdown-title').textContent = `${abbrev(game.away)} at ${abbrev(game.home)}`;
      $('touchdown-game-status').textContent = touchdownGameStatus(game, plays);
      html = plays.length ? touchdownList(game, plays) : `<p class="gt-td-empty">${game.status?.state === 'pre' ? 'Touchdowns will appear here after kickoff.' : !game.details ? 'Touchdown details are not available yet. This will update with the game feed.' : 'No touchdowns reported for this game yet.'}</p>`;
    }
    if (html !== touchdownHTML) {
      const top = content.scrollTop;
      content.innerHTML = html;
      content.scrollTop = top;
      touchdownHTML = html;
    }
    updateTouchdownFreshness();
  }

  function updateTouchdownFreshness() {
    const status = $('touchdown-feed-status');
    if (allScorersOpen) {
      const started = (snapshot?.data || []).filter(game => game.status?.state !== 'pre');
      const waiting = started.filter(game => !game.details).length;
      const delayed = started.filter(game => game.details && summaryDelayed(game)).length;
      status.classList.toggle('is-delayed', Boolean(requestFailed || delayed));
      status.textContent = [
        requestFailed ? 'Updates interrupted.' : '',
        delayed ? `${delayed} game ${delayed === 1 ? 'summary is' : 'summaries are'} delayed.` : '',
        waiting ? `Waiting for scoring details from ${waiting} game${waiting === 1 ? '' : 's'}.` : '',
        'Includes all games in this slate. Updates automatically.',
      ].filter(Boolean).join(' ');
      return;
    }
    if (touchdownGameId === null) return;
    const game = cards.get(touchdownGameId)?.game;
    if (!game) return;
    const freshness = game.freshness || {}, seconds = age(freshness.summary_updated);
    const delayed = summaryDelayed(game);
    status.classList.toggle('is-delayed', Boolean(requestFailed || delayed));
    status.textContent = game.status?.state === 'pre' ? 'Updates automatically once the game starts.' : !game.details ? 'Waiting for the scoring summary.' : `${requestFailed ? 'Updates interrupted. ' : delayed ? 'Scoring summary delayed. ' : ''}Summary fetched ${elapsed(seconds)} ago. Updates automatically.`;
  }

  function openTouchdowns(id = null) {
    if (id === null ? !snapshot : !cards.has(id)) return;
    allScorersOpen = id === null;
    touchdownGameId = id;
    touchdownHTML = null;
    touchdownScroll = { x: window.scrollX, y: window.scrollY };
    renderTouchdowns();
    $('touchdown-content').scrollTop = 0;
    document.documentElement.classList.add('gt-dialog-open');
    $('touchdown-dialog').showModal();
  }

  function playerStatGroups(game) {
    const groups = new Map();
    for (const player of Array.isArray(game.details?.players) ? game.details.players : []) {
      for (const [category, values] of Object.entries(player.categories || {})) {
        if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) continue;
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push({ player, values });
      }
    }
    return groups;
  }

  function statsTable(game, category, rows, captionId) {
    // Use the feed's labeled columns, which differ between NFL and college games.
    const columns = [...new Set(rows.flatMap(row => Object.keys(row.values)))];
    const key = escape(JSON.stringify([String(game.id), category]));
    return `<div class="gt-stat-table-wrap" data-stats-table="${key}" tabindex="0" role="region" aria-label="${escape(abbrev(game.away))} at ${escape(abbrev(game.home))}: ${escape(statLabel(category))}">
      <table class="gt-stat-table"><caption id="${captionId}">${escape(statLabel(category))}</caption>
      <thead><tr><th scope="col">Player</th><th scope="col">Team</th>${columns.map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(({ player, values }) => {
        const team = [game.away, game.home].find(team => (team?.id != null && String(team.id) === String(player.team_id)) || (team?.key && team.key === player.team));
        const logo = safeURL(team?.logo, true);
        const teamName = team ? abbrev(team) : String(player.team || '?').toUpperCase();
        const meta = [player.position, player.jersey != null ? '#' + player.jersey : ''].filter(Boolean).join(' / ');
        return `<tr data-player-id="${escape(player.id)}"><th scope="row">${escape(player.name || player.player || 'Player not reported')}${meta ? `<small class="gt-stat-player-meta">${escape(meta)}</small>` : ''}</th>
          <td><span class="gt-stat-team">${logo ? `<img class="gt-team-logo" src="${escape(logo)}" alt="" data-abbr="${escape(teamName)}" loading="lazy" referrerpolicy="no-referrer">` : ''}${escape(teamName)}</span></td>
          ${columns.map(label => `<td${label.toUpperCase() === 'TD' && number(values[label]) > 0 ? ' class="gt-stat-td"' : ''}>${escape(values[label] == null || values[label] === '' ? '-' : values[label])}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function selectedStatsGames() {
    return orderedGames().filter(game => !$('stats-game').value || String(game.id) === $('stats-game').value);
  }

  function renderStats() {
    if (!$('stats-dialog').open) return;
    const games = orderedGames(), gameSelect = $('stats-game'), categorySelect = $('stats-category');
    const allGroups = games.map(game => ({ game, groups: playerStatGroups(game) }));
    const gameOptions = '<option value="">All games</option>' + games.map(game => `<option value="${escape(game.id)}">${escape(abbrev(game.away))} at ${escape(abbrev(game.home))} / ${escape(kickoff(game))}</option>`).join('');
    if (gameOptions !== statsGameOptions) {
      const selected = gameSelect.value;
      gameSelect.innerHTML = gameOptions;
      gameSelect.value = games.some(game => String(game.id) === selected) ? selected : '';
      statsGameOptions = gameOptions;
    }
    const available = new Set(allGroups.flatMap(({ groups }) => [...groups.keys()]));
    if (categorySelect.value) available.add(categorySelect.value);
    const categories = [...Object.keys(statCategories).filter(category => available.has(category)), ...[...available].filter(category => !Object.hasOwn(statCategories, category)).sort()];
    const categoryOptions = '<option value="">All stats</option>' + categories.map(category => `<option value="${escape(category)}">${escape(statLabel(category))}</option>`).join('');
    if (categoryOptions !== statsCategoryOptions) {
      const selected = categorySelect.value;
      categorySelect.innerHTML = categoryOptions;
      categorySelect.value = selected;
      statsCategoryOptions = categoryOptions;
    }
    const selectedGroups = allGroups.filter(({ game }) => !gameSelect.value || String(game.id) === gameSelect.value).map(({ game, groups }) => ({
      game, categories: categories.filter(category => (!categorySelect.value || categorySelect.value === category) && groups.has(category)), groups,
    }));
    const reported = selectedGroups.filter(group => group.categories.length);
    $('stats-slate-status').textContent = `${league} / ${$('slate-date').textContent} / Stats available for ${reported.length} of ${selectedGroups.length} game${selectedGroups.length === 1 ? '' : 's'}`;
    const html = reported.length ? reported.map(({ game, categories, groups }, index) => `<section class="gt-stats-group" data-stats-game="${escape(game.id)}" aria-labelledby="stats-game-heading-${index}">
      <div class="gt-td-group-heading"><h3 id="stats-game-heading-${index}">${escape(abbrev(game.away))} at ${escape(abbrev(game.home))}</h3><p>${escape(gameScoreStatus(game))}</p></div>
      ${categories.map((category, ci) => statsTable(game, category, groups.get(category), `stats-caption-${index}-${ci}`)).join('')}</section>`).join('') : `<p class="gt-td-empty">${!games.length ? 'No games scheduled for this date.' : selectedGroups.every(({ game }) => game.status?.state === 'pre') ? 'Player stats will appear here after kickoff.' : `No ${categorySelect.value ? escape(statLabel(categorySelect.value).toLowerCase()) + ' ' : 'player '}stats reported yet. This will update with the game feed.`}</p>`;
    if (html !== statsHTML) {
      const content = $('stats-content'), top = content.scrollTop;
      const tables = new Map([...content.querySelectorAll('[data-stats-table]')].map(table => [table.dataset.statsTable, table.scrollLeft]));
      const focused = document.activeElement?.dataset.statsTable;
      content.innerHTML = html;
      for (const table of content.querySelectorAll('[data-stats-table]')) {
        table.scrollLeft = tables.get(table.dataset.statsTable) || 0;
        if (table.dataset.statsTable === focused) table.focus({ preventScroll: true });
      }
      content.scrollTop = top;
      statsHTML = html;
    }
    updateStatsFreshness();
  }

  function updateStatsFreshness() {
    if (!$('stats-dialog').open) return;
    const started = selectedStatsGames().filter(game => game.status?.state !== 'pre');
    const waiting = started.filter(game => !playerStatGroups(game).size).length;
    const delayed = started.filter(game => game.details && summaryDelayed(game)).length;
    const status = $('stats-feed-status');
    status.classList.toggle('is-delayed', Boolean(requestFailed || delayed));
    status.textContent = [requestFailed ? 'Updates interrupted.' : '',
      delayed ? `${delayed} game ${delayed === 1 ? 'summary is' : 'summaries are'} delayed.` : '',
      waiting ? `Player stats pending for ${waiting} game${waiting === 1 ? '' : 's'}.` : '',
      'Updates automatically. Game filters on the tracker do not limit this view.',
    ].filter(Boolean).join(' ');
  }

  function openStats() {
    if (!snapshot) return;
    statsHTML = null;
    statsScroll = { x: window.scrollX, y: window.scrollY };
    $('stats-game').value = '';
    $('stats-category').value = '';
    document.documentElement.classList.add('gt-dialog-open');
    $('stats-dialog').showModal();
    renderStats();
    $('stats-content').scrollTop = 0;
  }

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
    const tdCount = game.details ? touchdowns(game).length : null;
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
      <div class="gt-game-foot"><span class="gt-game-age"></span><div class="gt-game-actions"><button type="button" class="gt-touchdowns" data-touchdowns="${escape(game.id)}" aria-haspopup="dialog" aria-controls="touchdown-dialog" aria-label="Touchdowns for ${escape(abbrev(game.away))} at ${escape(abbrev(game.home))}">Touchdowns${tdCount === null ? '' : ` <span>${tdCount}</span>`}</button>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Game details ↗</a>` : '<span>ESPN</span>'}</div></div>`;
  }

  function render() {
    if (!snapshot) return;
    $('all-scorers').disabled = false;
    $('all-stats').disabled = false;
    const counts = { all: snapshot.data.length, in: 0, pre: 0, post: 0 };
    for (const game of snapshot.data) if (game.status?.state in counts && game.status.state !== 'all') counts[game.status.state]++;
    for (const [key, count] of Object.entries(counts)) $('count-' + key).textContent = count;
    $('game-count').textContent = `${counts.all} game${counts.all === 1 ? '' : 's'}`;
    const day = new Date(snapshot.date + 'T12:00:00Z');
    $('slate-date').textContent = Number.isFinite(day.getTime()) ? day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : `${league} slate`;
    const keep = new Set(snapshot.data.map(game => String(game.id)));
    for (const [id, entry] of cards) if (!keep.has(id)) { entry.element.remove(); cards.delete(id); }
    let visible = 0;
    const ordered = orderedGames();
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
    renderTouchdowns();
    renderStats();
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
    updateTouchdownFreshness();
    updateStatsFreshness();
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
  $('games').addEventListener('click', event => {
    const button = event.target.closest('button[data-touchdowns]');
    if (button) openTouchdowns(button.dataset.touchdowns);
  });
  $('all-scorers').addEventListener('click', () => openTouchdowns());
  $('all-stats').addEventListener('click', openStats);
  for (const id of ['stats-game', 'stats-category']) $(id).addEventListener('change', () => {
    renderStats();
    $('stats-content').scrollTop = 0;
  });
  $('stats-close').addEventListener('click', () => $('stats-dialog').close());
  $('stats-dialog').addEventListener('click', event => {
    if (event.target !== $('stats-dialog')) return;
    const bounds = event.target.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close();
  });
  $('stats-dialog').addEventListener('close', () => {
    statsHTML = null;
    document.documentElement.classList.remove('gt-dialog-open');
    $('all-stats').focus({ preventScroll: true });
    if (statsScroll) window.scrollTo({ left: statsScroll.x, top: statsScroll.y, behavior: 'instant' });
    statsScroll = null;
  });
  $('touchdown-close').addEventListener('click', () => $('touchdown-dialog').close());
  $('touchdown-dialog').addEventListener('click', event => {
    if (event.target !== $('touchdown-dialog')) return;
    const bounds = event.target.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close();
  });
  $('touchdown-dialog').addEventListener('close', () => {
    const button = allScorersOpen ? $('all-scorers') : cards.get(touchdownGameId)?.element.querySelector('[data-touchdowns]');
    allScorersOpen = false;
    touchdownGameId = null;
    touchdownHTML = null;
    document.documentElement.classList.remove('gt-dialog-open');
    if (button && !button.closest('[hidden]')) button.focus({ preventScroll: true });
    if (touchdownScroll) window.scrollTo({ left: touchdownScroll.x, top: touchdownScroll.y, behavior: 'instant' });
    touchdownScroll = null;
  });
  function logoError(event) {
    if (event.target.matches('img.gt-team-logo')) {
      const fallback = document.createElement('span'); fallback.className = 'gt-team-monogram';
      fallback.textContent = event.target.dataset.abbr; event.target.replaceWith(fallback);
    }
  }
  $('games').addEventListener('error', logoError, true);
  $('touchdown-dialog').addEventListener('error', logoError, true);
  $('stats-dialog').addEventListener('error', logoError, true);
  registerOddsLiveRefresh(refresh, dataset);
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 15000);
  setInterval(updateFreshness, 5000);
  refresh();
})();
