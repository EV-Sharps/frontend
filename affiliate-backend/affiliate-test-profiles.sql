-- TEST PROJECTS ONLY. Never run this fixture in your production Supabase project.
-- This is a minimal baseline for testing sign-in, profiles, Stripe checkout, and
-- affiliate accounting in a NEW, ISOLATED Supabase project. It is not a copy of
-- your production app schema or a migration for an existing profiles table.
-- Run before affiliate-schema.sql. Sign in normally to create test profiles.
-- Use Google sign-in for this test and leave Discord unlinked unless you have
-- configured separate test Discord credentials on the API.

begin;

do $$
begin
  if to_regclass('public.profiles') is not null then
    raise exception 'TEST FIXTURE REFUSED: public.profiles already exists. This file is only for a fresh test project; it never replaces existing profiles.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'TEST FIXTURE REFUSED: Supabase auth.users was not found.';
  end if;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'analyst', 'sharp')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  discord_id text,
  discord_username text,
  stripe_customer_id text unique,
  next_renewal timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Revoke any inherited table defaults before granting the browser only what
-- auth.js/profile.js require. Billing fields are writable only by the API's
-- service-role client. tier is accepted on INSERT because auth.js sends 'free';
-- the INSERT policy below rejects any attempted paid-tier assignment.
revoke all on public.profiles from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant select on public.profiles to authenticated;
grant insert (id, tier, metadata, discord_id, discord_username)
  on public.profiles to authenticated;
grant update (metadata, discord_id, discord_username)
  on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy affiliate_test_profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy affiliate_test_profiles_insert_free_own on public.profiles
  for insert to authenticated
  with check (
    id = (select auth.uid())
    and tier = 'free'
    and stripe_customer_id is null
    and next_renewal is null
    and cancel_at_period_end = false
  );

create policy affiliate_test_profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

comment on table public.profiles is
  'TEST-ONLY minimal profiles fixture for local affiliate checkout verification. Not the production app schema.';

commit;
