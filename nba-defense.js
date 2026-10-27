/* Current-season opponent production per 36 combined minutes by source position group. */
(function (root) {
  'use strict';
  const keys = ['dvpRank', 'dvpAllowed36', 'dvpAllowed', 'dvpGames', 'dvpMinutes'];
  const defaultKeys = ['dvpRank', 'dvpAllowed36'];
  const pages = ['nba', 'pts', 'threes'];
  const stats = {
    pts:['points','pts/g'], reb:['rebounds','reb/g'], ast:['assists','ast/g'],
    '3ptm':['made three-pointers','3PM/g'], stl:['steals','stl/g'], blk:['blocks','blk/g'], to:['turnovers','TO/g'],
    'pts+reb':['points + rebounds','P+R/g'], 'pts+ast':['points + assists','P+A/g'],
    'reb+ast':['rebounds + assists','R+A/g'], 'pts+reb+ast':['points + rebounds + assists','PRA/g'],
    'stl+blk':['steals + blocks','S+B/g'], 'blk+stl':['blocks + steals','B+S/g']
  };
  const positions = {G:'guards', F:'forwards', C:'centers', PG:'point guards', SG:'shooting guards', SF:'small forwards', PF:'power forwards'};
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const positive = value => finite(value) > 0 ? value : null;
  const integer = value => Number.isInteger(value) && value > 0 ? value : null;
  const metricValue = (values, metric, fallback) => values != null && Object.hasOwn(values, metric) ? values[metric] : fallback;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const format = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(value);
  const ordinal = value => root.addSuffix ? root.addSuffix(value) : `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'})[value % 10] || 'th'}`;
  let defense = null;

  function info(row) {
    const rawOpp = String(row.opp || '').toLowerCase();
    const opp = defense?.team_aliases?.[rawOpp] || rawOpp;
    const rawPosition = String(row.dvpPosition || '').toUpperCase();
    const position = defense?.position_aliases?.[rawPosition] || rawPosition;
    const metric = defense?.prop_metrics?.[row.prop] || row.prop;
    const sample = defense?.data?.[opp]?.[position];
    return {opp, position, positionLabel:positions[position] || position || 'this position', metric, sample,
      stat:stats[metric], teams:integer(metricValue(sample?.ranked_teams_by_metric, metric, sample?.ranked_teams))};
  }

  function setFeed(feed) {
    const metadata = feed?.defenseVsPosition;
    defense = metadata?.schema_version === 2 && metadata?.rank_basis === 'per_36'
      && metadata?.window === 'season' && metadata?.season_type === 'regular'
      && metadata?.position_basis === 'source_groups' ? metadata : null;
    for (const row of feed?.data || []) {
      // Explicit new fields (including nulls) remain authoritative. An old row
      // can only gain /36 fields from compatible metadata and a known group.
      if (row.blurred || !row.dvpPosition || ['dvpAllowed36','dvpMinutes','dvpRankBasis'].some(key => Object.hasOwn(row, key))) continue;
      const {sample, metric, position, stat, teams} = info(row);
      const games = integer(metricValue(sample?.games_by_metric, metric, sample?.games));
      if (!defense || !['G','F','C'].includes(position) || !stat || !games
        || finite(sample?.per_game?.[metric]) == null || finite(sample?.per_36?.[metric]) == null || positive(sample?.minutes) == null) continue;
      const rank = integer(sample.ranks?.[metric]);
      row.dvpRank = rank && teams && rank <= teams && teams <= 30 ? rank : null;
      row.dvpAllowed36 = sample.per_36[metric];
      row.dvpAllowed = sample.per_game[metric];
      row.dvpMinutes = sample.minutes;
      row.dvpRankBasis = 'per_36';
      row.dvpGames = games;
      row.dvpPosition = position;
    }
    const dialog = root.document?.getElementById('nba-defense-dialog');
    if (dialog?.open) dialog.close();
  }

  function value(row, key) {
    // Neither a legacy rank nor a new label proves that the rate uses minutes.
    const context = info(row);
    if (row.blurred || row.dvpRankBasis !== 'per_36' || !row.dvpPosition || !context.opp
      || !['G','F','C'].includes(context.position) || !context.stat || !integer(row.dvpGames)
      || positive(row.dvpMinutes) == null || finite(row.dvpAllowed36) == null || finite(row.dvpAllowed) == null) return null;
    if (key === 'dvpAllowed36' || key === 'dvpAllowed') return finite(row[key]);
    if (key === 'dvpMinutes') return positive(row[key]);
    if (key === 'dvpRank') {
      const rank = integer(row[key]);
      return rank && rank <= (context.teams || 30) && rank <= 30 ? rank : null;
    }
    return key === 'dvpGames' ? integer(row[key]) : null;
  }

  function description(row) {
    const rank = value(row, 'dvpRank'), allowed36 = value(row, 'dvpAllowed36'), allowed = value(row, 'dvpAllowed');
    const games = value(row, 'dvpGames'), minutes = value(row, 'dvpMinutes');
    if (allowed36 == null || games == null || minutes == null) return 'No current-season defense-vs-position data per 36 minutes for this prop.';
    const {opp, positionLabel, stat, teams} = info(row);
    const lines = [`${opp.toUpperCase()} vs ${positionLabel} — ${stat[0]}`,
      `${format(allowed36)} allowed per 36 minutes. ${format(allowed)} allowed per game across ${games} completed regular-season ${games === 1 ? 'game' : 'games'}.`,
      rank == null ? 'Rank unavailable.' : `Rank ${rank}${teams ? ` of ${teams}` : ''}; 1 means fewest allowed per 36 minutes. Ties share a rank.`,
      `Rate = total production by all opposing ${positionLabel} / their ${format(minutes)} combined actual minutes × 36, including zero production.`,
      '36 minutes is the display unit, not an assumed playing time. This is not an individual player projection or a prop hit rate.'];
    if (games < 5) lines.push('Early sample: fewer than 5 completed games.');
    if (defense?.season != null) lines.push(`Season: ${defense.season}.`);
    if (defense?.as_of) lines.push(`Season data through ${defense.as_of}${defense.partial ? '; incomplete coverage' : ''}.`);
    else if (defense?.partial) lines.push('Season coverage is incomplete.');
    return lines.join('\n\n');
  }

  function render(row, key) {
    const number = value(row, key);
    if (number == null) return '<span class="nba-defense-empty">-</span>';
    const {stat} = info(row);
    const main = key === 'dvpRank' ? ordinal(number) : format(number);
    const caption = key === 'dvpRank' ? ''
      : key === 'dvpAllowed36' ? stat[1].replace('/g','/36') : key === 'dvpAllowed' ? stat[1]
      : key === 'dvpMinutes' ? 'minutes' : number < 5 ? 'early sample' : 'games';
    const color = key === 'dvpRank' ? root.getTDsOppRankColor?.(number) : null;
    const detail = escape(description(row));
    const classes = `nba-defense-value${key === 'dvpRank' ? ' nba-defense-context' : ''}${row.dvpGames < 5 ? ' nba-defense-early' : ''}`;
    return `<button type="button" class="${classes}" title="${detail}" aria-label="${detail}"><strong${color ? ` style="color:${escape(color)}"` : ''}>${escape(main)}</strong>${caption ? `<small>${escape(caption)}</small>` : ''}</button>`;
  }

  function compare(a, b, key, direction) {
    const x = value(a, key), y = value(b, key);
    if (x == null && y == null) return 0;
    if (x == null) return direction === 'asc' ? 1 : -1;
    if (y == null) return direction === 'asc' ? -1 : 1;
    return x - y;
  }

  function items() {
    return [['dvpRank','Opponent vs position rank by per-36 rate','Vs Pos<br>Rank',50],
      ['dvpAllowed36','Allowed per 36 minutes vs position','Allowed<br>/ 36 min',110],
      ['dvpAllowed','Allowed per game vs position','Allowed<br>/ game',100],
      ['dvpGames','Defense sample games','Sample<br>Games',80],
      ['dvpMinutes','Defense sample minutes','Sample<br>Minutes',90]].map(([key,label,title,width]) => ({key,label,cols:[{
        field:key,title,width,variableHeight:true,cssClass:'nba-defense-cell',visible:defaultKeys.includes(key),
        headerSortStartingDir:key === 'dvpRank' ? 'asc' : 'desc',
        headerTooltip:'Current-season opponent production per 36 combined actual minutes played by opposing players in this position group. Rank 1 = fewest allowed per 36; ties share a rank. Tap or hover for the stat, games and minutes.',
        formatter:cell => render(cell.getRow().getData(),key),
        sorter:(a,b,aRow,bRow,column,direction) => compare(aRow.getData(),bRow.getData(),key,direction)
      }]}));
  }

  function migrateOrder(order) {
    return Array.isArray(order) ? [...new Set(order.map(key => key === 'oppPosRank' ? 'dvpRank' : key))] : order;
  }

  function columnOrder(saved, defaults) {
    const migrated = migrateOrder(saved);
    const order = [...new Set([...(migrated || []), ...defaults])];
    const missing = keys.filter(key => !migrated?.includes(key));
    const result = order.filter(key => !missing.includes(key));
    const anchor = result.indexOf('opp');
    result.splice(anchor < 0 ? result.length : anchor + 1, 0, ...missing);
    return result;
  }

  function migrateProfile(user,page) {
    if (!pages.includes(page) || !user?.metadata) return;
    const meta = user.metadata, marker = `${page}-nba-defense-columns-version`;
    if (meta[marker]) return;
    // Preserve explicit hiding as well as the former rank column's saved position.
    if (Array.isArray(meta[page])) meta[page] = migrateOrder(meta[page]);
    if (Array.isArray(meta[`${page}-order`])) meta[`${page}-order`] = migrateOrder(meta[`${page}-order`]);
    meta[marker] = 1;
  }

  function renderCard(row, visibleKeys=defaultKeys) {
    if (row.blurred) return '';
    return keys.filter(key => visibleKeys.includes(key)).map(key => key === 'dvpRank'
      ? `<div class="metric-pill nba-defense-card nba-defense-card-rank">${render(row,key)}<span>DvP per 36min</span></div>`
      : `<div class="metric-pill nba-defense-card"><span>${escape(items().find(item => item.key === key).label)}</span>${render(row,key)}</div>`).join('');
  }

  if (root.document) root.document.addEventListener('click', event => {
    const button = event.target.closest?.('.nba-defense-value');
    if (!button) return;
    event.stopPropagation();
    let dialog = root.document.getElementById('nba-defense-dialog');
    if (!dialog) {
      dialog = root.document.createElement('dialog');
      dialog.id = 'nba-defense-dialog';
      dialog.setAttribute('aria-labelledby','nba-defense-heading');
      dialog.innerHTML = '<h2 id="nba-defense-heading">Opponent vs position</h2><p></p><form method="dialog"><button autofocus>Close</button></form>';
      root.document.body.appendChild(dialog);
      dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    }
    dialog.querySelector('p').textContent = button.title;
    dialog.showModal();
  }, true);
  const api = {keys,defaultKeys,pages,setFeed,info,value,description,render,compare,items,columnOrder,migrateProfile,renderCard};
  root.NbaDefense = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
