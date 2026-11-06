-- Run in the Supabase SQL editor before (or alongside) the tracker frontend update.
-- Adds play-level trending endpoints; existing player-only RPCs stay available.
-- Counts distinct profiles per player/sport/prop/line/side/game, across source pages.
-- Missing legacy lines/sides remain NULL rather than guessing a current market.
-- Only aggregate play details are returned; profile IDs and saved prices are not exposed.
BEGIN;

CREATE OR REPLACE FUNCTION public.popular_watchlist_plays(
    lim integer DEFAULT 15,
    dt date DEFAULT (pg_catalog.timezone('UTC', CURRENT_TIMESTAMP))::date
)
RETURNS TABLE (
    player text, sport text, page text, prop text,
    handicap numeric, under boolean, game text, count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH entries AS (
        SELECT p.id AS profile_id, e.value AS entry, e.value -> 'quote' AS quote
        FROM public.profiles AS p
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(p.metadata -> 'watchlist') = 'array'
                THEN p.metadata -> 'watchlist' ELSE '[]'::jsonb END
        ) AS e(value)
        WHERE pg_catalog.jsonb_typeof(e.value) = 'object'
          AND e.value ->> 'dt' = dt::text
    ), normalized AS (
        SELECT profile_id, entry, quote,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'player')), '') AS player,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'page')), '') AS source_page,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'sport')), '') AS source_sport
        FROM entries
    ), sports AS (
        SELECT *, CASE source_sport
            WHEN 'k' THEN 'mlb' WHEN 'atgs' THEN 'nhl' WHEN 'props' THEN 'nfl'
            ELSE COALESCE(source_sport, CASE
                WHEN source_page IN ('atgs','atgs2','fgs','nhl') THEN 'nhl'
                WHEN source_page IN ('tds','tds2','ftd','nfl') THEN 'nfl'
                WHEN source_page IN ('nba','pts','threes','fb','kotc') THEN 'nba'
                WHEN source_page IN ('ncaaf','ncaafprops') THEN 'ncaaf'
                WHEN source_page IN ('wnba','ncaab','baseball_ncaa','ufc','wbc') THEN source_page
                ELSE 'mlb' END)
            END AS sport
        FROM normalized
        WHERE player IS NOT NULL
    ), pages AS (
        SELECT *, COALESCE(source_page, CASE WHEN sport = 'mlb' THEN 'dingers' ELSE sport END) AS page
        FROM sports
    ), plays AS (
        SELECT profile_id, player, sport, page,
            COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'prop')), ''),
                CASE page WHEN 'dingers' THEN 'hr' WHEN 'strikeouts' THEN 'k' END) AS prop,
            CASE WHEN pg_catalog.btrim(quote ->> 'handicap') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
                THEN (quote ->> 'handicap')::numeric END AS handicap,
            CASE quote ->> 'under' WHEN 'true' THEN true WHEN 'false' THEN false END AS under,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(quote ->> 'game')), '') AS game
        FROM pages
    )
    SELECT player, sport, pg_catalog.min(page) AS page, prop, handicap, under, game,
        pg_catalog.count(DISTINCT profile_id) AS count
    FROM plays
    GROUP BY player, sport, prop, handicap, under, game
    ORDER BY count DESC, player, sport, prop, handicap, under, game
    LIMIT LEAST(GREATEST(COALESCE(lim, 15), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.popular_watchlist_plays(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_watchlist_plays(integer, date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.popular_bet_plays(
    lim integer DEFAULT 15,
    dt date DEFAULT (pg_catalog.timezone('UTC', CURRENT_TIMESTAMP))::date
)
RETURNS TABLE (
    player text, sport text, page text, prop text,
    handicap numeric, under boolean, game text, count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH entries AS (
        SELECT p.id AS profile_id, e.value AS entry, e.value AS quote
        FROM public.profiles AS p
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(p.metadata -> 'bets') = 'array'
                THEN p.metadata -> 'bets' ELSE '[]'::jsonb END
        ) AS e(value)
        WHERE pg_catalog.jsonb_typeof(e.value) = 'object'
          AND e.value ->> 'dt' = dt::text
    ), normalized AS (
        SELECT profile_id, entry, quote,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'player')), '') AS player,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'page')), '') AS source_page,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'sport')), '') AS source_sport
        FROM entries
    ), sports AS (
        SELECT *, CASE source_sport
            WHEN 'k' THEN 'mlb' WHEN 'atgs' THEN 'nhl' WHEN 'props' THEN 'nfl'
            ELSE COALESCE(source_sport, CASE
                WHEN source_page IN ('atgs','atgs2','fgs','nhl') THEN 'nhl'
                WHEN source_page IN ('tds','tds2','ftd','nfl') THEN 'nfl'
                WHEN source_page IN ('nba','pts','threes','fb','kotc') THEN 'nba'
                WHEN source_page IN ('ncaaf','ncaafprops') THEN 'ncaaf'
                WHEN source_page IN ('wnba','ncaab','baseball_ncaa','ufc','wbc') THEN source_page
                ELSE 'mlb' END)
            END AS sport
        FROM normalized
        WHERE player IS NOT NULL
    ), pages AS (
        SELECT *, COALESCE(source_page, CASE WHEN sport = 'mlb' THEN 'dingers' ELSE sport END) AS page
        FROM sports
    ), plays AS (
        SELECT profile_id, player, sport, page,
            COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(entry ->> 'prop')), ''),
                CASE page WHEN 'dingers' THEN 'hr' WHEN 'strikeouts' THEN 'k' END) AS prop,
            CASE WHEN pg_catalog.btrim(quote ->> 'handicap') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
                THEN (quote ->> 'handicap')::numeric END AS handicap,
            CASE quote ->> 'under' WHEN 'true' THEN true WHEN 'false' THEN false END AS under,
            NULLIF(pg_catalog.lower(pg_catalog.btrim(quote ->> 'game')), '') AS game
        FROM pages
    )
    SELECT player, sport, pg_catalog.min(page) AS page, prop, handicap, under, game,
        pg_catalog.count(DISTINCT profile_id) AS count
    FROM plays
    GROUP BY player, sport, prop, handicap, under, game
    ORDER BY count DESC, player, sport, prop, handicap, under, game
    LIMIT LEAST(GREATEST(COALESCE(lim, 15), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.popular_bet_plays(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_bet_plays(integer, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
