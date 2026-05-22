import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('nba.html', encoding='utf-8') as f:
    content = f.read()

assert '<header id="header">' in content
assert '<button onclick="closeOverlay();">Close</button>' in content
assert 'let loaded = false;' in content
assert '{field: "game", visible: false}' in content

# ============================================================
# 1. Add col-reorder-modal before <header>
# ============================================================
MODAL = '''\t\t<div id="col-reorder-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:2000;justify-content:center;align-items:center;">
\t\t\t<div class="overlay-content" style="max-width:400px;width:90%;padding:20px;border-radius:8px;max-height:80vh;display:flex;flex-direction:column;">
\t\t\t\t<h3 style="margin:0 0 12px">Reorder Columns</h3>
\t\t\t\t<p style="font-size:0.8rem;color:#9ca3af;margin:0 0 10px">Drag to reorder. Saved order applies when you click Save.</p>
\t\t\t\t<ul id="col-reorder-list" style="list-style:none;padding:0;margin:0;overflow-y:auto;flex:1;"></ul>
\t\t\t\t<div style="display:flex;justify-content:center;gap:8px;margin-top:12px;">
\t\t\t\t\t<button onclick="saveColReorder()">Save</button>
\t\t\t\t\t<button onclick="closeColReorder()">Cancel</button>
\t\t\t\t</div>
\t\t\t</div>
\t\t</div>
\t\t'''
content = content.replace('<header id="header">', MODAL + '<header id="header">', 1)
print("Step 1 done")

# ============================================================
# 2. Add Reorder button in overlay footer
# ============================================================
CLOSE_BTN = '<button onclick="closeOverlay();">Close</button>'
idx = content.find(CLOSE_BTN)
line_start = content.rfind('\n', 0, idx) + 1
close_indent = ''
for ch in content[line_start:]:
    if ch in ' \t':
        close_indent += ch
    else:
        break
content = content.replace(CLOSE_BTN,
    f'<button onclick="openColReorder()">Reorder</button>\n{close_indent}{CLOSE_BTN}', 1)
print("Step 2 done")

# ============================================================
# 3. Detect indentation + build new JS functions
# ============================================================
idx = content.find('let loaded = false;')
line_start = content.rfind('\n', 0, idx) + 1
I = ''
for ch in content[line_start:]:
    if ch in ' \t':
        I += ch
    else:
        break
T = '\t'
I2 = I + T
I3 = I2 + T
I4 = I3 + T
I5 = I4 + T

print(f"Detected indent: {repr(I)}")

NEW_JS = f"""
{I}const NBA_DEFAULT_COL_ORDER = [
{I2}'ev', 'book', 'player', 'handicap', 'prop', 'fairVal', 'implied', 'kelly',
{I2}'opp', 'oppRank', 'oppPosRank',
{I2}'bookOdds_circa', 'bookOdds_fd', 'bookOdds_dk', 'bookOdds_b365', 'bookOdds_mgm',
{I2}'bookOdds_espn', 'bookOdds_cz', 'bookOdds_fn', 'bookOdds_br', 'bookOdds_hr',
{I2}'bookOdds_hr_az', 'bookOdds_bv', 'bookOdds_re', 'bookOdds_fl', 'bookOdds_kambi',
{I2}'bookOdds_bol', 'bookOdds_kal', 'bookOdds_nv', 'bookOdds_px', 'bookOdds_poly',
{I2}'bookOdds_pn', 'logs', 'hitRate', 'hitRateLYR'
{I}];

{I}function getNbaColumnItems() {{
{I2}return [
{I3}{{ key: 'ev', label: 'EV', cols: [
{I4}{{title: "Expected<br>Value", field: "ev", width: MOBILE ? 40 : 60, sorter: "number", formatter: evFormatter, responsive: 0}}
{I3}]}},
{I3}{{ key: 'book', label: 'Best Book', cols: [
{I4}{{title: `Best Book<br><br><button id='toggle-bookodds-btn' onclick="event.preventDefault(); event.stopPropagation(); toggleBookOddsColumns();"><span id="book-odds-toggle">−</span> Hide Odds</button>`, field: "book", vertAlign: "bottom", width: MOBILE ? 75 : 75, formatter: bestBookFormatter, formatterParams: {{book: BOOK}}, responsive: 0}}
{I3}]}},
{I3}{{ key: 'player', label: 'Player', cols: [
{I4}{{title: "Player (L5 min/g)", field: "player", headerFilter: "input", formatter: playerFormatter, width: MOBILE ? 100 : 140, formatterParams: {{sport: SPORT, noProp: true, fullName: true}}, hozAlign: "left", responsive: 0, frozen: true}}
{I3}]}},
{I3}{{ key: 'handicap', label: 'Line', cols: [
{I4}{{title: "Line", field: "handicap", formatter: function(cell) {{
{I5}const data = cell.getRow().getData();
{I5}let ou = data.under ? "u" : "o";
{I5}return `<div style='position: relative;width:100%;height:100%;'>${{ou}}${{cell.getValue()}}</div>`;
{I4}}}, headerFilter: "list", headerFilterParams: {{valuesLookup: true, clearable: true, placeholder: "All Props", sort: "asc"}}, headerFilterFunc: function(headerValue, rowValue) {{
{I5}if (headerValue == "All") {{ return true; }}
{I5}return rowValue === headerValue;
{I4}}}}}
{I3}]}},
{I3}{{ key: 'prop', label: 'Prop', cols: [
{I4}{{title: "Prop", field: "prop", formatter: function(cell) {{
{I5}return cell.getValue().replace("pts+reb+ast", "p+r+a");
{I4}}}, headerFilter: "list", headerFilterParams: {{valuesLookup: true, clearable: true, placeholder: "All Props", sort: "asc"}}, headerFilterFunc: function(headerValue, rowValue) {{
{I5}if (headerValue == "All") {{ return true; }}
{I5}return rowValue === headerValue;
{I4}}}}}
{I3}]}},
{I3}{{ key: 'fairVal', label: 'Fair Value', cols: [
{I4}{{title: "Fair<br>Value", field: "fairVal", width: MOBILE ? 40 : 60, sorter: "number", formatter: plusMinusFormatter, responsive: 0}}
{I3}]}},
{I3}{{ key: 'implied', label: 'Implied', cols: [
{I4}{{title: "Implied", field: "implied", width: MOBILE ? 40 : 60, sorter: "number", formatter: impliedFormatter, responsive: 0, visible: MOBILE ? false : true}}
{I3}]}},
{I3}{{ key: 'kelly', label: '¼ Kelly', cols: [
{I4}{{title: "¼ Kelly", field: "kelly", width: MOBILE ? 40 : 60, sorter: "number", formatter: function(cell) {{
{I5}if (!cell.getValue()) {{ return ""; }}
{I5}return `${{cell.getValue().toFixed(2)}}u`;
{I4}}}, responsive: 0, visible: MOBILE ? false : true}}
{I3}]}},
{I3}{{ key: 'opp', label: 'Opp', cols: [
{I4}{{title: "Opp", field: "opp", formatter: oppFormatter, formatterParams: {{is_pitcher: false}}, hozAlign: "left", width: 80}}
{I3}]}},
{I3}{{ key: 'oppRank', label: 'Opp Rank', cols: [
{I4}{{title: "Opp<br>Rank", field: "oppRank", formatter: rankingFormatter, width: 50}}
{I3}]}},
{I3}{{ key: 'oppPosRank', label: 'DvP Rank', cols: [
{I4}{{title: "DvP<br>Rank", field: "oppPosRank", formatter: rankingFormatter, width: 50}}
{I3}]}},
{I3}{{ key: 'bookOdds_circa', label: 'Circa', cols: [
{I4}{{title: `Circa<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["circa"], short=true)}}`, field: "bookOdds.circa", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_fd', label: 'FD', cols: [
{I4}{{title: `FD<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["fd"], short=true)}}`, field: "bookOdds.fd", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_dk', label: 'DK', cols: [
{I4}{{title: `DK<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["dk"], short=true)}}`, field: "bookOdds.dk", width: 70, sorter: "number", responsive: 6, formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_b365', label: 'B365', cols: [
{I4}{{title: `B365<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["b365"], short=true)}}`, field: "bookOdds.b365", hozAlign: "center", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_mgm', label: 'MGM', cols: [
{I4}{{title: `MGM<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["mgm"], short=true)}}`, field: "bookOdds.mgm", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_espn', label: 'ESPN', cols: [
{I4}{{title: `ESPN*<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["espn"], short=true)}}`, field: "bookOdds.espn", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_cz', label: 'CZ', cols: [
{I4}{{title: `CZ<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["cz"], short=true)}}`, field: "bookOdds.cz", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_fn', label: 'FN', cols: [
{I4}{{title: `FN<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["fn"], short=true)}}`, field: "bookOdds.fn", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_br', label: 'BetRivers', cols: [
{I4}{{title: `Betrivers<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["br"], short=true)}}`, field: "bookOdds.br", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_hr', label: 'HR', cols: [
{I4}{{title: `HR<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["hr"], short=true)}}`, field: "bookOdds.hr", width: 70, sorter: "number", visible: true, formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_hr_az', label: 'HR AZ', cols: [
{I4}{{title: `HR AZ<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["hr_az"], short=true)}}`, field: "bookOdds.hr_az", width: 70, sorter: "number", visible: false, formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_bv', label: 'Bovada', cols: [
{I4}{{title: `Bovada<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["bv"], short=true)}}`, field: "bookOdds.bv", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_re', label: 'RE', cols: [
{I4}{{title: `RE<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["re"], short=true)}}`, field: "bookOdds.re", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_fl', label: 'FL', cols: [
{I4}{{title: `FL<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["fl"], short=true)}}`, field: "bookOdds.fl", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_kambi', label: 'Kambi', cols: [
{I4}{{title: `Kambi<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["kambi"], short=true)}}`, field: "bookOdds.kambi", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_bol', label: 'BOL', cols: [
{I4}{{title: `BOL<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["bol"], short=true)}}`, field: "bookOdds.bol", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_kal', label: 'Kalshi', cols: [
{I4}{{title: `Kalshi<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["kal"], short=true)}}`, field: "bookOdds.kal", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_nv', label: 'NoVig', cols: [
{I4}{{title: `NoVig<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["nv"], short=true)}}`, field: "bookOdds.nv", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_px', label: 'ProphetX', cols: [
{I4}{{title: `ProphetX<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["px"], short=true)}}`, field: "bookOdds.px", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'bookOdds_poly', label: 'Polymarket', cols: [
{I4}{{title: `Polymarket<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["poly"], short=true)}}`, field: "bookOdds.poly", width: 70, sorter: "number", formatter: evOddsFormatter, visible: false}}
{I3}]}},
{I3}{{ key: 'bookOdds_pn', label: 'PN', cols: [
{I4}{{title: `PN<br>${{timeAgo(UPDATED ? 0 : UPDATED[PAGE]["pn"], short=true)}}`, field: "bookOdds.pn", width: 70, sorter: "number", formatter: evOddsFormatter}}
{I3}]}},
{I3}{{ key: 'logs', label: 'Game Logs', cols: [
{I4}{{title: "Game Logs<br> ➡️ Most Recent", field: "logs", width: 160, formatter: chartFormatter, formatterParams: {{type: "bar"}}, responsive: 3, visible: MOBILE ? false : true}}
{I3}]}},
{I3}{{ key: 'hitRate', label: 'Hit Rate', cols: [
{I4}{{title: "Season</br>Hit Rate", field: "hitRate", sorter: "number", formatter: percentFormatterLYR, width: MOBILE ? 40 : 60, responsive: 2}}
{I3}]}},
{I3}{{ key: 'hitRateLYR', label: 'Hit Rate LYR', cols: [
{I4}{{title: "Last Year</br>Hit Rate", field: "hitRateLYR", sorter: "number", formatter: percentFormatterLYR, width: MOBILE ? 40 : 60, responsive: 2}}
{I3}]}}
{I2}];
{I}}}

{I}function buildNbaColumns(savedOrder) {{
{I2}return buildColumnsFromOrder(
{I3}savedOrder, NBA_DEFAULT_COL_ORDER, getNbaColumnItems(), null,
{I3}[{{field: "game", visible: false}}]
{I2});
{I}}}

{I}function openColReorder() {{
{I2}const savedOrder = CURR_USER?.metadata?.["nba-order"];
{I2}const isVisible = (key) => {{
{I3}const items = getNbaColumnItems();
{I3}const item = items.find(i => i.key === key);
{I3}if (!item) return true;
{I3}return item.cols.every(c => c.visible !== false);
{I2}}};
{I2}openColReorderModal(getNbaColumnItems(), NBA_DEFAULT_COL_ORDER, savedOrder, isVisible);
{I}}}

{I}function closeColReorder() {{ closeColReorderModal(); }}

{I}function saveColReorder() {{
{I2}saveColReorderModal('nba-order', buildNbaColumns, () => showHideUserTable(true));
{I}}}

"""

content = content.replace('let loaded = false;', NEW_JS + 'let loaded = false;', 1)
print("Step 3 done")

# ============================================================
# 4. Replace columns array in renderTable
# ============================================================
render_start = content.find('function renderTable')
start_idx = content.find('columns: [', render_start)
assert start_idx != -1, "columns: [ not found"

game_idx = content.find('{field: "game", visible: false}', start_idx)
assert game_idx != -1, "game field not found"

close_idx = content.find(']', game_idx)
assert close_idx != -1, "closing ] not found"

old_block = content[start_idx:close_idx+1]
new_block = 'columns: buildNbaColumns(CURR_USER?.metadata?.["nba-order"])'
content = content[:start_idx] + new_block + content[close_idx+1:]
print(f"Step 4 done: replaced {len(old_block)} chars")

with open('nba.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
