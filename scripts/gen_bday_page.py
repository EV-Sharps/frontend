import json
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parent.parent
data = json.loads((root / "bday_analysis.json").read_text(encoding="utf-8"))

TODAY = date(2026, 8, 25)
REF_YEAR = 2024  # leap year so Feb 29 birthdays are valid

def ordinal(month, day):
    return date(REF_YEAR, month, day).toordinal()

today_ord = ordinal(TODAY.month, TODAY.day)

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# flatten every individual birthday-game log entry, dropping exact duplicate
# log rows (the source data has a handful of games double-logged, e.g. some
# 2026 season-opener entries appear twice with identical stat lines)
entries = []
for p in data["players"]:
    seen = set()
    for g in p["bday_game_log"]:
        key = (g["dt"], g["h"], g["ab"], g["hr"])
        if key in seen:
            continue
        seen.add(key)
        y, m, d = g["dt"].split("-")
        entries.append({
            "player": p["player"].title(),
            "month": int(m),
            "day": int(d),
            "year": y,
            "hr": g["hr"],
        })

def days_ago(e):
    return (today_ord - ordinal(e["month"], e["day"])) % 366

# group entries by calendar day (month, day)
groups = {}
for e in entries:
    key = (e["month"], e["day"])
    groups.setdefault(key, []).append(e)

# order groups starting today, going backward through the calendar
ordered_keys = sorted(groups.keys(), key=lambda k: (today_ord - ordinal(*k)) % 366)

day_groups = []
for key in ordered_keys:
    items = sorted(groups[key], key=lambda e: e["year"], reverse=True)
    day_groups.append((key, items))

total_entries = len(entries)
hit_count = sum(1 for e in entries if e["hr"] > 0)
min_year = min(int(e["year"]) for e in entries)
max_year = max(int(e["year"]) for e in entries)

# waffle-grid data (one cell per individual birthday game) for the rarity
# section — same entries as day_groups, in that same calendar-day-from-today
# order, reshaped to what buildRarityWaffle() in the page's own script
# expects. Rendered client-side (not templated server-side) so the
# tooltip/hover logic has real per-cell data to read off dataset attrs.
waffle_data = json.dumps([
    {
        "hit": e["hr"] > 0,
        "name": e["player"],
        "year": e["year"],
        "day": f"{MONTHS[key[0]-1]} {key[1]}",
    }
    for key, items in day_groups
    for e in items
], separators=(",", ":"))

def render_group(key, items):
    m, d = key
    label = f"{MONTHS[m-1]} {d}"
    rows = []
    for e in items:
        hit = e["hr"] > 0
        icon_class = "check" if hit else "x"
        icon = "&#10003;" if hit else "&#10007;"
        rows.append(
            f'<div class="row {icon_class}"><span class="icon">{icon}</span>'
            f'<span class="name">{e["player"]}</span><span class="year">{e["year"]}</span></div>'
        )
    return f'<div class="group"><div class="day-label">{label}</div>{"".join(rows)}</div>'

rendered_groups = [render_group(key, items) for key, items in day_groups]

# --- view 2: grouped by year, most recent year first, dates descending within year ---
year_groups = {}
for e in entries:
    year_groups.setdefault(e["year"], []).append(e)

def full_ord(e):
    return ordinal(e["month"], e["day"])

ordered_years = sorted(year_groups.keys(), reverse=True)
year_groups_list = []
for y in ordered_years:
    items = sorted(year_groups[y], key=full_ord, reverse=True)
    year_groups_list.append((y, items))

def render_year_group(year, items):
    rows = []
    for e in items:
        hit = e["hr"] > 0
        icon_class = "check" if hit else "x"
        icon = "&#10003;" if hit else "&#10007;"
        label = f"{MONTHS[e['month']-1]} {e['day']}"
        rows.append(
            f'<div class="row {icon_class}"><span class="icon">{icon}</span>'
            f'<span class="name">{e["player"]}</span><span class="year">{label}</span></div>'
        )
    return f'<div class="group"><div class="day-label">{year}</div>{"".join(rows)}</div>'

rendered_year_groups = [render_year_group(y, items) for y, items in year_groups_list]

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Birthday Homers: How Uncommon Are They?</title>
<style>
  :root {{
    color-scheme: light dark;
    --bg: #0b0d12;
    --panel: #12151c;
    --border: #232733;
    --text: #e8eaf0;
    --muted: #8b90a0;
    --green: #35c46a;
    --red: #ef5a5a;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{
      --bg: #f5f6f9;
      --panel: #ffffff;
      --border: #e3e5ec;
      --text: #1a1c23;
      --muted: #64687a;
      --green: #1e9e52;
      --red: #d63c3c;
    }}
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }}
  .wrap {{
    padding: 16px 20px 24px;
  }}
  h1 {{
    font-size: 1.25rem;
    margin: 0 0 2px;
    letter-spacing: -0.01em;
  }}
  .subtitle {{
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0 0 12px;
  }}
  .subtitle b {{ color: var(--text); }}
  .toggle {{
    display: inline-flex;
    gap: 2px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
    margin-bottom: 14px;
  }}
  .toggle button {{
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--muted);
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
  }}
  .toggle button.active {{
    background: var(--border);
    color: var(--text);
  }}
  .cols {{
    columns: 260px;
    column-gap: 22px;
  }}
  .cols.hidden {{
    display: none;
  }}
  .group {{
    break-inside: avoid;
    margin-bottom: 8px;
  }}
  .day-label {{
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    padding: 4px 0 2px;
    margin-bottom: 2px;
  }}
  .row {{
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 1.5px 0;
    line-height: 1.25;
  }}
  .icon {{
    flex: none;
    width: 13px;
    font-weight: 700;
    font-size: 0.8rem;
  }}
  .row.check .icon {{ color: var(--green); }}
  .row.x .icon {{ color: var(--red); }}
  .name {{
    flex: 1;
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .row.x .name {{ color: var(--muted); }}
  .year {{
    flex: none;
    color: var(--muted);
    font-size: 0.65rem;
    font-variant-numeric: tabular-nums;
  }}

  .rarity {{
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }}
  .rarity-head {{
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }}
  .rarity-figure {{
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }}
  .rarity-label {{
    font-size: 0.85rem;
    font-weight: 600;
  }}
  .rarity-sub {{
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 2px;
  }}
  .rarity-year-toggle {{
    margin-left: auto;
    margin-bottom: 0;
  }}
  .rarity-legend {{
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
    font-size: 0.7rem;
    color: var(--muted);
  }}
  .lg-item {{
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }}
  .lg-swatch {{
    width: 9px;
    height: 9px;
    border-radius: 2px;
    display: inline-block;
  }}
  .lg-swatch.hit {{ background: var(--green); }}
  .lg-swatch.miss {{ background: var(--border); }}
  .waffle {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10px, 1fr));
    gap: 3px;
    max-width: 620px;
  }}
  .cell {{
    aspect-ratio: 1;
    border-radius: 2px;
    background: var(--border);
    cursor: default;
  }}
  .cell.hit {{ background: var(--green); }}
  .cell:focus-visible {{
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }}
  .waffle-tip {{
    position: fixed;
    pointer-events: none;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 9px;
    font-size: 0.72rem;
    color: var(--text);
    box-shadow: 0 6px 18px rgba(0,0,0,0.3);
    z-index: 50;
    transform: translate(-50%, -125%);
    white-space: nowrap;
  }}
  .waffle-tip[hidden] {{ display: none; }}
  .waffle-tip .tip-name {{ font-weight: 700; margin-bottom: 1px; }}
  .waffle-tip .tip-detail {{ color: var(--muted); }}
  .waffle-tip.hit .tip-detail {{ color: var(--green); }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Birthday Homers</h1>
  <p class="subtitle">Every individual birthday game, {min_year}&ndash;{max_year}</p>

  <section class="rarity">
    <div class="rarity-head">
      <div class="rarity-figure" id="rarity-figure">&nbsp;</div>
      <div>
        <div class="rarity-label" id="rarity-label">&nbsp;</div>
        <div class="rarity-sub" id="rarity-sub">&nbsp;</div>
      </div>
      <div class="toggle rarity-year-toggle">
        <button id="rarity-btn-all" class="active" onclick="setRarityYear('all')">All Years</button>
        <button id="rarity-btn-2026" onclick="setRarityYear('2026')">2026 Only</button>
      </div>
    </div>
    <div class="rarity-legend">
      <span class="lg-item"><span class="lg-swatch hit"></span><span id="lg-hit-count">Home run</span></span>
      <span class="lg-item"><span class="lg-swatch miss"></span><span id="lg-miss-count">No home run</span></span>
    </div>
    <div class="waffle" id="waffle" role="img" aria-label="Grid of every birthday game; most did not include a home run"></div>
  </section>

  <div class="toggle">
    <button id="btn-day" class="active" onclick="showView('day')">By Calendar Day</button>
    <button id="btn-date" onclick="showView('date')">By Date (2026 first)</button>
  </div>
  <div class="cols" id="view-day">
    {"".join(rendered_groups)}
  </div>
  <div class="cols hidden" id="view-date">
    {"".join(rendered_year_groups)}
  </div>
</div>
<div class="waffle-tip" id="waffle-tip" hidden></div>
<script>
  function showView(which) {{
    document.getElementById('view-day').classList.toggle('hidden', which !== 'day');
    document.getElementById('view-date').classList.toggle('hidden', which !== 'date');
    document.getElementById('btn-day').classList.toggle('active', which === 'day');
    document.getElementById('btn-date').classList.toggle('active', which === 'date');
  }}

  const WAFFLE_DATA = {waffle_data};

  function renderWaffle(data) {{
    const total = data.length;
    const hits = data.filter(function (d) {{ return d.hit; }}).length;
    const pct = total ? Math.round((hits / total) * 100) : 0;

    document.getElementById('rarity-figure').textContent = pct + '%';
    document.getElementById('rarity-label').textContent = 'of birthday games included a home run';
    document.getElementById('rarity-sub').textContent = hits + ' of ' + total + ' individual birthday games';
    document.getElementById('lg-hit-count').textContent = 'Home run (' + hits + ')';
    document.getElementById('lg-miss-count').textContent = 'No home run (' + (total - hits) + ')';

    const grid = document.getElementById('waffle');
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    data.forEach(function (d) {{
      const cell = document.createElement('div');
      cell.className = 'cell' + (d.hit ? ' hit' : '');
      cell.tabIndex = 0;
      cell.dataset.name = d.name;
      cell.dataset.year = d.year;
      cell.dataset.day = d.day;
      cell.dataset.hit = d.hit ? '1' : '0';
      frag.appendChild(cell);
    }});
    grid.appendChild(frag);
  }}

  function setRarityYear(year) {{
    document.getElementById('rarity-btn-all').classList.toggle('active', year === 'all');
    document.getElementById('rarity-btn-2026').classList.toggle('active', year === '2026');
    renderWaffle(year === 'all' ? WAFFLE_DATA : WAFFLE_DATA.filter(function (d) {{ return d.year === year; }}));
  }}

  renderWaffle(WAFFLE_DATA);

  // Tooltip listeners live on the grid container itself (event delegation via
  // closest('.cell')), not on individual cells — so they keep working across
  // renderWaffle() re-renders that replace all of the grid's children, and
  // only need to be wired up once here.
  (function initWaffleTooltip() {{
    const grid = document.getElementById('waffle');
    const tip = document.getElementById('waffle-tip');
    const tipName = document.createElement('div');
    tipName.className = 'tip-name';
    const tipDetail = document.createElement('div');
    tipDetail.className = 'tip-detail';
    tip.appendChild(tipName);
    tip.appendChild(tipDetail);

    function positionTip(e) {{
      const x = e.clientX, y = e.clientY;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }}

    function showTip(e, cell) {{
      const isHit = cell.dataset.hit === '1';
      tipName.textContent = cell.dataset.name;
      tipDetail.textContent = cell.dataset.day + " '" + cell.dataset.year.slice(-2) + ' · ' + (isHit ? 'Home run' : 'No home run');
      tip.classList.toggle('hit', isHit);
      tip.hidden = false;
      positionTip(e);
    }}

    grid.addEventListener('pointermove', function (e) {{
      const cell = e.target.closest('.cell');
      if (cell) showTip(e, cell);
      else tip.hidden = true;
    }});
    grid.addEventListener('pointerleave', function () {{ tip.hidden = true; }});
    grid.addEventListener('focusin', function (e) {{
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = cell.getBoundingClientRect();
      showTip({{ clientX: r.left + r.width / 2, clientY: r.top }}, cell);
    }});
    grid.addEventListener('focusout', function () {{ tip.hidden = true; }});
  }})();
</script>
</body>
</html>
"""

out = root / "bday_homers.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out}: {len(day_groups)} calendar days / {len(year_groups_list)} years, {total_entries} games ({hit_count} check, {total_entries-hit_count} x)")
