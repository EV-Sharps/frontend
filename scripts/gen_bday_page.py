import json
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parent.parent
data = json.loads((root / "bday_analysis.json").read_text(encoding="utf-8"))

TODAY = date(2026, 7, 11)
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
</style>
</head>
<body>
<div class="wrap">
  <h1>Birthday Homers</h1>
  <p class="subtitle">Every individual birthday game &middot; <b>{hit_count}/{total_entries}</b> games had a bday homer ({hit_count/total_entries*100:.0f}%)</p>
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
<script>
  function showView(which) {{
    document.getElementById('view-day').classList.toggle('hidden', which !== 'day');
    document.getElementById('view-date').classList.toggle('hidden', which !== 'date');
    document.getElementById('btn-day').classList.toggle('active', which === 'day');
    document.getElementById('btn-date').classList.toggle('active', which === 'date');
  }}
</script>
</body>
</html>
"""

out = root / "bday_homers.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out}: {len(day_groups)} calendar days / {len(year_groups_list)} years, {total_entries} games ({hit_count} check, {total_entries-hit_count} x)")
