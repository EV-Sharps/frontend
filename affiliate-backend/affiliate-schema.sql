-- Run once in the production Supabase SQL editor after reviewing/backing up.
-- These tables are intentionally unavailable to browser clients. The API uses
-- its existing service-role client after validating the caller's identity.
begin;

create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  commission_bps integer not null default 2000 check (commission_bps between 0 and 10000),
  discount_percent integer not null default 20 check (discount_percent = 20),
  created_at timestamptz not null default now()
);

create table public.affiliate_visits (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '720 hours')
);
create index affiliate_visits_partner_created on public.affiliate_visits(affiliate_id, created_at);
create index affiliate_visits_expiry on public.affiliate_visits(expires_at);

create table public.affiliate_referrals (
  user_id uuid primary key references auth.users(id),
  affiliate_id uuid not null references public.affiliates(id),
  visit_id uuid references public.affiliate_visits(id),
  source text not null default 'link' check (source in ('link', 'code')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '720 hours'),
  first_paid_at timestamptz,
  first_paid_invoice_id text,
  commission_bps integer check (commission_bps between 0 and 10000),
  check ((first_paid_at is null and first_paid_invoice_id is null and commission_bps is null)
    or (first_paid_at is not null and first_paid_invoice_id is not null and commission_bps is not null))
);
create index affiliate_referrals_partner on public.affiliate_referrals(affiliate_id);

create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id),
  user_id uuid not null references auth.users(id),
  stripe_invoice_id text not null unique,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  currency text not null default 'usd' check (currency = 'usd'),
  paid_at timestamptz not null,
  available_at timestamptz not null check (available_at = paid_at + interval '720 hours'),
  revenue_cents bigint not null check (revenue_cents >= 0 and revenue_cents <= 9007199254740991),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0 and refunded_cents <= revenue_cents),
  disputed boolean not null default false,
  dispute_updated_at timestamptz,
  commission_bps integer not null check (commission_bps between 0 and 10000),
  commission_cents bigint not null check (commission_cents >= 0 and commission_cents <= revenue_cents),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index affiliate_commissions_partner_hold on public.affiliate_commissions(affiliate_id, available_at);
create index affiliate_commissions_charge on public.affiliate_commissions(stripe_charge_id);
create index affiliate_commissions_intent on public.affiliate_commissions(stripe_payment_intent_id);

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id),
  status text not null default 'reserved' check (status in ('reserved', 'paid', 'cancelled')),
  currency text not null default 'usd' check (currency = 'usd'),
  total_cents bigint not null check (total_cents >= 2500),
  external_reference text,
  created_by uuid not null references auth.users(id),
  completed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  check (status <> 'paid' or (paid_at is not null and completed_by is not null
    and external_reference is not null and length(trim(external_reference)) > 0))
);
create index affiliate_payouts_partner on public.affiliate_payouts(affiliate_id, created_at);
-- One outstanding manual transfer per partner makes reconciliation unambiguous.
create unique index affiliate_payouts_one_reserved on public.affiliate_payouts(affiliate_id) where status = 'reserved';

create table public.affiliate_payout_items (
  payout_id uuid not null references public.affiliate_payouts(id),
  commission_id uuid not null references public.affiliate_commissions(id),
  amount_cents bigint not null check (amount_cents <> 0),
  primary key (payout_id, commission_id)
);

create table public.affiliate_webhook_events (
  event_id text primary key,
  stripe_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);

alter table public.affiliates enable row level security;
alter table public.affiliate_visits enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_payout_items enable row level security;
alter table public.affiliate_webhook_events enable row level security;

revoke all on public.affiliates, public.affiliate_visits, public.affiliate_referrals,
  public.affiliate_commissions, public.affiliate_payouts, public.affiliate_payout_items,
  public.affiliate_webhook_events from public, anon, authenticated;
grant all on public.affiliates, public.affiliate_visits, public.affiliate_referrals,
  public.affiliate_commissions, public.affiliate_payouts, public.affiliate_payout_items,
  public.affiliate_webhook_events to service_role;

create function public.affiliate_set_referral(
  p_user_id uuid,
  p_affiliate_id uuid,
  p_visit_id uuid default null,
  p_source text default 'link'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_existing public.affiliate_referrals%rowtype;
  v_visit public.affiliate_visits%rowtype;
  v_created timestamptz := now();
  v_expires timestamptz := now() + interval '720 hours';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 9871));
  select * into v_existing from public.affiliate_referrals where user_id = p_user_id;
  if v_existing.first_paid_at is not null then return to_jsonb(v_existing); end if;
  if p_source not in ('code', 'link') then raise exception 'Invalid referral source'; end if;
  if p_source = 'link' and v_existing.source = 'code' and v_existing.expires_at > now() then
    return to_jsonb(v_existing);
  end if;
  select * into v_affiliate from public.affiliates where id = p_affiliate_id for update;
  if not found or v_affiliate.status <> 'active' then raise exception 'Affiliate is not active'; end if;
  if v_affiliate.owner_user_id = p_user_id then raise exception 'Self referrals are not allowed'; end if;
  if p_source = 'link' then
    select * into v_visit from public.affiliate_visits
      where id = p_visit_id and affiliate_id = p_affiliate_id and expires_at > now();
    if not found then raise exception 'Referral link expired'; end if;
    v_created := v_visit.created_at;
    v_expires := v_visit.expires_at;
  end if;
  insert into public.affiliate_referrals (user_id, affiliate_id, visit_id, source, created_at, expires_at)
    values (p_user_id, p_affiliate_id, case when p_source = 'link' then p_visit_id else null end,
      p_source, v_created, v_expires)
    on conflict (user_id) do update set affiliate_id = excluded.affiliate_id,
      visit_id = excluded.visit_id, source = excluded.source,
      created_at = excluded.created_at, expires_at = excluded.expires_at
    returning * into v_existing;
  return to_jsonb(v_existing);
end;
$$;

-- Stripe events are claimed in the SAME transaction as the ledger change. An
-- exception rolls both back, so Stripe retries cannot lose a commission.
-- p_affiliate_id + p_attributed_at are trusted checkout metadata captured by
-- the API, preserving the purchased code if a later browser visit changes it.
create function public.affiliate_record_invoice(
  p_event_id text,
  p_event_created_at timestamptz,
  p_user_id uuid,
  p_invoice_id text,
  p_paid_at timestamptz,
  p_revenue_cents bigint,
  p_refunded_cents bigint default 0,
  p_disputed boolean default null,
  p_currency text default 'usd',
  p_affiliate_id uuid default null,
  p_attributed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_referral public.affiliate_referrals%rowtype;
  v_affiliate public.affiliates%rowtype;
  v_commission public.affiliate_commissions%rowtype;
  v_affiliate_id uuid;
  v_attributed_at timestamptz;
  v_expires_at timestamptz;
  v_claimed integer;
  v_target bigint;
begin
  if nullif(trim(p_event_id), '') is null or p_event_created_at is null
    or p_user_id is null or nullif(trim(p_invoice_id), '') is null or p_paid_at is null
    or p_currency is null or p_currency <> 'usd' or p_revenue_cents is null or p_revenue_cents < 0
    or p_revenue_cents > 9007199254740991 or p_refunded_cents is null or p_refunded_cents < 0 then
    raise exception 'Invalid invoice accounting input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 9871));
  insert into public.affiliate_webhook_events(event_id, stripe_created_at)
    values (p_event_id, p_event_created_at) on conflict do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return jsonb_build_object('recorded', false, 'duplicate', true); end if;
  select * into v_commission from public.affiliate_commissions where stripe_invoice_id = p_invoice_id;
  if found then
    if v_commission.user_id <> p_user_id or v_commission.revenue_cents <> p_revenue_cents
      or v_commission.currency <> p_currency or v_commission.paid_at <> p_paid_at then
      raise exception 'Invoice accounting identity changed';
    end if;
    v_affiliate_id := v_commission.affiliate_id;
  else
    select * into v_referral from public.affiliate_referrals where user_id = p_user_id;
    v_affiliate_id := case when v_referral.first_paid_at is not null then v_referral.affiliate_id
      else coalesce(p_affiliate_id, v_referral.affiliate_id) end;
  end if;
  if v_affiliate_id is null then return jsonb_build_object('recorded', false, 'reason', 'no_referral'); end if;
  select * into v_affiliate from public.affiliates where id = v_affiliate_id for update;
  if not found or v_affiliate.owner_user_id = p_user_id then
    return jsonb_build_object('recorded', false, 'reason', 'invalid_referral');
  end if;
  if v_commission.id is null then
    if v_referral.first_paid_at is null then
      if v_affiliate.status <> 'active' then return jsonb_build_object('recorded', false, 'reason', 'disabled'); end if;
      v_attributed_at := case when p_affiliate_id is not null then p_attributed_at else v_referral.created_at end;
      v_expires_at := case when p_affiliate_id is not null then p_attributed_at + interval '720 hours'
        else v_referral.expires_at end;
      -- Stripe timestamps have second precision; PostgreSQL defaults include
      -- microseconds. A valid payment in the referral's first second qualifies.
      if v_attributed_at is null or p_paid_at < date_trunc('second', v_attributed_at)
        or p_paid_at >= v_expires_at or p_revenue_cents = 0 then
        return jsonb_build_object('recorded', false, 'reason', 'expired_or_ineligible');
      end if;
      insert into public.affiliate_referrals(user_id, affiliate_id, source, created_at, expires_at,
        first_paid_at, first_paid_invoice_id, commission_bps)
        values(p_user_id, v_affiliate_id, coalesce(v_referral.source, 'code'), v_attributed_at, v_expires_at,
          p_paid_at, p_invoice_id, v_affiliate.commission_bps)
        on conflict(user_id) do update set affiliate_id = excluded.affiliate_id,
          visit_id = case when public.affiliate_referrals.affiliate_id = excluded.affiliate_id
            then public.affiliate_referrals.visit_id else null end,
          created_at = excluded.created_at, expires_at = excluded.expires_at,
          first_paid_at = excluded.first_paid_at, first_paid_invoice_id = excluded.first_paid_invoice_id,
          commission_bps = excluded.commission_bps
        returning * into v_referral;
    end if;
    if p_paid_at < v_referral.first_paid_at
      or p_paid_at >= (((v_referral.first_paid_at at time zone 'UTC') + interval '12 months') at time zone 'UTC') then
      return jsonb_build_object('recorded', false, 'reason', 'outside_commission_window');
    end if;
    insert into public.affiliate_commissions(affiliate_id, user_id, stripe_invoice_id, currency, paid_at,
      available_at, revenue_cents, refunded_cents, disputed, dispute_updated_at, commission_bps, commission_cents)
      values(v_affiliate_id, p_user_id, p_invoice_id, p_currency, p_paid_at,
        p_paid_at + interval '720 hours', p_revenue_cents, least(p_revenue_cents, p_refunded_cents),
        coalesce(p_disputed, false), case when p_disputed is not null then p_event_created_at end,
        v_referral.commission_bps, 0)
      returning * into v_commission;
  end if;
  -- Stripe can deliver older partial-refund events after a full-refund event.
  v_commission.refunded_cents := greatest(v_commission.refunded_cents, least(p_revenue_cents, p_refunded_cents));
  if p_disputed is not null and (v_commission.dispute_updated_at is null or p_event_created_at >= v_commission.dispute_updated_at) then
    v_commission.disputed := p_disputed;
    v_commission.dispute_updated_at := p_event_created_at;
  end if;
  v_target := case when v_commission.disputed then 0 else
    round((v_commission.revenue_cents - v_commission.refunded_cents)::numeric * v_commission.commission_bps / 10000)::bigint end;
  update public.affiliate_commissions set refunded_cents = v_commission.refunded_cents,
    disputed = v_commission.disputed, dispute_updated_at = v_commission.dispute_updated_at,
    commission_cents = v_target, updated_at = now()
    where id = v_commission.id returning * into v_commission;
  return jsonb_build_object('recorded', true, 'commission', to_jsonb(v_commission));
end;
$$;

-- Reservation snapshots signed balances, including reversals of commissions
-- already paid. Refunds after reservation become a negative future balance;
-- they never rewrite an already queued or completed external transfer.
create function public.affiliate_reserve_payout(p_affiliate_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_payout public.affiliate_payouts%rowtype;
  v_total bigint;
begin
  if p_actor_user_id is null then raise exception 'Payout operator is required'; end if;
  select * into v_affiliate from public.affiliates where id = p_affiliate_id for update;
  if not found then raise exception 'Affiliate not found'; end if;
  select * into v_payout from public.affiliate_payouts where affiliate_id = p_affiliate_id and status = 'reserved';
  if found then return to_jsonb(v_payout); end if;
  select coalesce(sum(balance), 0) into v_total from (
    select c.id, c.available_at, c.commission_cents - coalesce((
      select sum(i.amount_cents) from public.affiliate_payout_items i
      join public.affiliate_payouts p on p.id = i.payout_id
      where i.commission_id = c.id and p.status in ('reserved', 'paid')
    ), 0) as balance from public.affiliate_commissions c where c.affiliate_id = p_affiliate_id
  ) balances where balance < 0 or available_at <= now();
  if v_total < 2500 then raise exception 'Available balance is below the $25 payout minimum'; end if;
  insert into public.affiliate_payouts(affiliate_id, total_cents, created_by)
    values(p_affiliate_id, v_total, p_actor_user_id) returning * into v_payout;
  insert into public.affiliate_payout_items(payout_id, commission_id, amount_cents)
    select v_payout.id, id, balance from (
      select c.id, c.available_at, c.commission_cents - coalesce((
        select sum(i.amount_cents) from public.affiliate_payout_items i
        join public.affiliate_payouts p on p.id = i.payout_id
        where i.commission_id = c.id and p.status in ('reserved', 'paid')
      ), 0) as balance from public.affiliate_commissions c where c.affiliate_id = p_affiliate_id
    ) balances where balance <> 0 and (balance < 0 or available_at <= now());
  return to_jsonb(v_payout);
end;
$$;

create function public.affiliate_finish_payout(
  p_payout_id uuid,
  p_actor_user_id uuid,
  p_external_reference text default null,
  p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payout public.affiliate_payouts%rowtype;
  v_affiliate_id uuid;
begin
  if p_actor_user_id is null or p_cancel is null then raise exception 'Invalid payout completion input'; end if;
  select affiliate_id into v_affiliate_id from public.affiliate_payouts where id = p_payout_id;
  if not found then raise exception 'Payout not found'; end if;
  perform 1 from public.affiliates where id = v_affiliate_id for update;
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if p_cancel and v_payout.status = 'cancelled' then return to_jsonb(v_payout); end if;
  if not p_cancel and v_payout.status = 'paid' and v_payout.external_reference = trim(p_external_reference) then
    return to_jsonb(v_payout);
  end if;
  if v_payout.status <> 'reserved' then raise exception 'Payout is already finalized'; end if;
  if not p_cancel and nullif(trim(p_external_reference), '') is null then raise exception 'Transfer reference is required'; end if;
  update public.affiliate_payouts set status = case when p_cancel then 'cancelled' else 'paid' end,
    external_reference = case when p_cancel then null else trim(p_external_reference) end,
    completed_by = p_actor_user_id, paid_at = case when p_cancel then null else now() end,
    cancelled_at = case when p_cancel then now() else null end
    where id = p_payout_id returning * into v_payout;
  return to_jsonb(v_payout);
end;
$$;

revoke all on function public.affiliate_set_referral(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.affiliate_record_invoice(text, timestamptz, uuid, text, timestamptz, bigint, bigint, boolean, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.affiliate_reserve_payout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.affiliate_finish_payout(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.affiliate_set_referral(uuid, uuid, uuid, text) to service_role;
grant execute on function public.affiliate_record_invoice(text, timestamptz, uuid, text, timestamptz, bigint, bigint, boolean, text, uuid, timestamptz) to service_role;
grant execute on function public.affiliate_reserve_payout(uuid, uuid) to service_role;
grant execute on function public.affiliate_finish_payout(uuid, uuid, text, boolean) to service_role;

commit;
