-- Phase 2-3: subscription entitlement foundation

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'subscription_status'
  ) then
    create type public.subscription_status as enum ('trial', 'active', 'past_due', 'canceled');
  end if;
end $$;

create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('manual', 'stripe', 'paddle')) default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  status public.subscription_status not null,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

drop trigger if exists org_subscriptions_updated_at on public.org_subscriptions;
create trigger org_subscriptions_updated_at
before update on public.org_subscriptions
for each row execute function public.update_updated_at();

create index if not exists idx_org_subscriptions_org_status
  on public.org_subscriptions (org_id, status);

alter table public.org_subscriptions enable row level security;
alter table public.org_subscriptions force row level security;

drop policy if exists "org members can read subscriptions" on public.org_subscriptions;
create policy "org members can read subscriptions"
  on public.org_subscriptions
  for select
  using (
    org_id in (
      select om.org_id
      from public.organization_members om
      where om.user_id = auth.uid()
    )
  );
