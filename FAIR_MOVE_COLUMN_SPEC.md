# Fair Move Table Column

Status: Proposed; saved for future implementation. No feature implementation is included in this spec.

## Goal

Add a sortable column that shows how a play's estimated fair probability changed over a selected period, using the table's active devig configuration. Users should be able to find the biggest increases, biggest decreases, or smallest movements without opening individual price charts.

## Proposed user experience

- Column label: **Fair Move**, with the selected period in the header, such as **Fair Move · 1h**.
- Period choices: **1h, 3h, 6h, Today**. Proposed initial period: **1h**.
- Primary value: signed probability-point change, such as **+2.00 pp**.
- Secondary value: earlier and latest fair American odds, such as **+400 → +355**.
- Example: fair probability rising from 20% to 22% is a **+2.00 percentage-point** move. It is not a 2% relative change.
- Positive means the selected side became more likely; negative means it became less likely. Over and under rows must use their own side.
- Use green for positive, red for negative, and neutral styling for unchanged values. Preserve the sign and text so meaning does not depend on color.
- Hover/tap details show the actual observation times, reference books and weights, devig method, and any freshness or coverage limitations.
- Clicking a valid cell opens the player's Movement view for the same game, prop, line, side, period, and reference configuration.
- Add the column to Customize show/hide and reorder controls. Proposed default: hidden until enabled.
- Save the period and sort preference with the page's existing profile settings. Keep reference settings tied to the active devig; do not create a separate competing devig selector.

### Sorting

Provide numeric sorting, using unrounded values:

1. Largest increase: signed change descending.
2. Largest decrease: signed change ascending.
3. Largest movement: absolute change descending.
4. Least movement: absolute change ascending.

Missing, stale, and incomparable values sort after valid values in every mode. Only a valid unchanged comparison is zero. Sorting must cover all rows in the current result set, including rows outside the rendered viewport or current pagination page.

## Fair-value calculation

At each endpoint, use the same calculation semantics as the table's active devig configuration:

- Selected reference books and custom weights.
- Devig method, including the table's existing worst-method behavior.
- Required, optional, and excluded reference rules.
- Market-average and custom-mix behavior.
- Any row-specific reference exclusions, including exclusion of the offered book where the current table logic does that.
- The table's reference-price treatment and book alias rules.

Do not substitute the existing Movement page's proportional, equal-weight consensus for a custom weighted reference. Do not average American odds directly or change the order of blending and devigging relative to the table.

For comparable endpoints:

    change_pp = 100 * (latest_fair_probability - baseline_fair_probability)
    absolute_change_pp = abs(change_pp)

Calculate with full precision. Round only for display. Represent +100/-100 continuously in probability space.

### Prevent false movement from changing coverage

Determine the effective reference books and normalized weights at the latest eligible capture, then hold that exact reference configuration fixed for the baseline calculation. Both endpoints must satisfy the required-book rules and have the paired prices needed by that reference.

- An optional book absent from the latest reference must not appear only in the baseline blend.
- If a latest-reference book is missing from the baseline, mark the comparison unavailable instead of silently reducing the reference set.
- Freeze row-specific reference exclusions at both endpoints as well. A change in the offered best book must not itself become a fair-probability move.
- Do not reconstruct missing historical opposing prices with an assumed vig.
- Preserve the table's book-family handling; do not introduce different duplicate-feed weighting just for this column.

The latest historical fair value may differ from the live table's current fair value because captures are less frequent than live odds updates. Label observation times clearly; do not imply that the latest capture is a live quote.

## Time and history rules

The current capture implementation defaults to a **30-minute interval**, stores quote changes plus observation metadata, and resets its history at **Eastern midnight**. It tracks pregame prices. These constraints make hourly windows a sensible first version.

- For hourly periods, target the requested time in the past and use the latest eligible observation at or before that boundary, within the configured freshness tolerance.
- Use the latest eligible captured observation as the comparison endpoint.
- Never use a later observation as though it were the requested historical baseline.
- If a selection has insufficient history for the requested hourly window, report that explicitly. Do not label ten minutes of history as a one-hour move.
- For Today, use the first eligible observation from the current Eastern day and show its timestamp.
- Do not carry history across Eastern midnight. Handle daylight-saving transitions using the Eastern calendar, not a fixed UTC offset.
- Determine freshness from observation metadata, not merely the last price-change timestamp. An unchanged price can still have been observed recently.
- A valid zero requires distinct eligible observations. One observation is insufficient history.
- Started games may expose their historical comparison as pregame history, but must be marked started and excluded from a default current-movers ranking.

## Selection identity

Join movement to the exact sport, event, player, prop, normalized handicap, and side. Include event/date identity so doubleheaders, similarly named players, and future fixtures cannot cross-match.

Prefer exposing a stable movement selection key on EV rows or resolving keys once in a batch. Do not search the movement catalog separately for every rendered row. Preserve distinctions such as anytime, first scorer, and alternate scoring lines; never substitute another line when exact history is missing.

## Efficient data flow

1. When the column is enabled, collect the selection identities for the table's complete current result set.
2. Send a batch request containing those identities, the period, and the normalized active devig configuration.
3. The backend calculates endpoint summaries from the already captured history.
4. Return only the values, timestamps, statuses, and reference metadata needed by the column.
5. Merge summaries into row data by stable identity and apply sorting without resetting filters or scroll position.
6. Load full chart history only when the user opens Movement.

Do not download one full chart per row, make one request per row, or calculate history inside cell formatters. If request limits require chunks, use bounded batches and do not present a partially loaded ranking as complete.

### Caching and refresh

- Cache parsed capture data by snapshot version, reusing the existing movement cache pattern.
- Cache computed summaries using sport, history day/snapshot version, period boundary, side/selection identity, and the full normalized reference configuration.
- Include method, weights, required/excluded books, and relevant row-specific exclusions in the cache identity.
- Bound custom-reference caches with an eviction policy; arbitrary weight combinations must not grow memory indefinitely.
- Recalculate only when the relevant snapshot, period boundary, selection set, or reference settings change.
- Debounce rapid devig/period changes. Cancel or ignore obsolete responses so an old reference cannot overwrite a newer one.
- Pause refreshes while the page is hidden and refresh as needed on return. Disable automatic movement requests while the column is hidden.
- Keep browser caches session-aware. Preserve existing Sharp authorization and data-access restrictions.

## Proposed API contract

A new batch endpoint, for example **POST /api/line-movement/batch**, would avoid long query strings for large selection sets. The route name and field names are provisional.

Request fields:

- Sport and period.
- Bounded list of selection keys with sides.
- Reference mode, book weights, devig method, required books, and excluded books.
- Row-specific reference context where needed for parity with the table.

Response metadata:

- Snapshot/version, Eastern history day, update time, capture interval, and freshness policy.
- A canonical reference signature and the requested period.

Each selection summary:

- Selection key and side.
- Status and a machine-readable reason when unavailable.
- Baseline/latest observation timestamps.
- Baseline/latest fair probabilities and fair American odds.
- Signed `change_pp` and `absolute_change_pp`.
- Effective reference books and normalized weights.
- Started/stale flags and actual available history span.

Validate supported methods, book IDs, finite positive weights, selection counts, and period values. Restrict summary output to the authorized requested selections. Existing chart and summary consumers should remain compatible.

## Empty and error states

Use explicit states such as **Loading**, **No history**, **Insufficient history**, **Missing reference**, **Stale**, **Game started**, and **Unavailable**. A tooltip can carry the detailed reason without widening the column.

Never turn unavailable data into zero, a fabricated fair price, or a sortable artificial mover. A transient movement request failure should leave the ordinary odds table usable.

## Existing code to build on

- `../odds/line_movement.py`: capture scheduling, daily history, quote deltas, and observation metadata.
- `../api/line_movement.mjs`: history preparation, time windows, endpoint summaries, reference coverage, and caching. Current references support a single book or equal-weight sportsbook consensus using proportional devig.
- `../api/line_movement_route.mjs`: Sharp access checks and snapshot loading.
- `shared.js`: table fair-value calculations and reference selection, including `getFairValue`, `averageDevigs`, `getDevigReferenceBooks`, and Customize/profile integration.
- `weights.js` and `filter.js`: selected weights, market reference rules, and devig controls.
- `player-movement.js`: the existing popup's daily chart and book controls. It currently uses proportional devig; it needs reference/period support to match this column when opened from a cell.
- `player-lines.js` and `player-history.js`: existing Movement entry points.

## Implementation order

1. Audit the current table devig pipeline and define a canonical reference configuration, including row-specific behavior.
2. Implement or extract pure calculation helpers with parity fixtures for every supported method and reference mode.
3. Add the batch endpoint, identity mapping, endpoint eligibility rules, and bounded caches.
4. Add the column, period/sort controls, Customize support, and profile persistence.
5. Connect cell clicks to the matching Movement view.
6. Validate correctness and benchmark representative large slates before enabling the column broadly.

## Acceptance criteria

- Single-book, weighted custom-mix, market-average, and worst-method results match the table calculation for identical complete paired inputs.
- A 20% to 22% fair-probability change displays +2.00 pp; the equivalent fair prices display approximately +400 to +355.
- Side selection follows the table's actual method, including methods whose over/under results need not be complementary.
- Changing reference settings recomputes both endpoints and rejects late responses from the old settings.
- Missing quotes, suspended prices, new listings, stale captures, and changing coverage cannot create false movers.
- Identical valid prices across distinct observations display zero.
- Doubleheaders, alternate lines, first-scorer markets, and separate dates never cross-match.
- All four sorting modes operate over the complete result set, with unavailable rows last.
- The column can be hidden and reordered, and profile preferences restore correctly.
- Midnight rollover, daylight-saving transitions, hidden tabs, and session changes are handled correctly.
- Mobile/zoomed tables remain readable; clicking a cell opens the exact comparison without resetting table scroll.
- Measure cold/warm batch latency, payload size, cache memory, and browser sorting/rendering time on representative large slates. Establish numerical performance targets from those measurements.

## Decisions to confirm when implementation resumes

- Confirm the proposed 1h default and hidden-by-default column.
- Confirm initial page coverage and retention of Sharp-only access.
- Confirm whether strict paired historical coverage is preferred whenever the live table can estimate fair value from a one-sided market.
- Decide whether finer-than-30-minute periods warrant changing the capture schedule. Longer-than-today comparisons require a separate retention change.
