-- Phase 1-1 seed data

insert into public.organizations (id, name, org_type, description, website)
values (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'World Friends Korea (WFK)',
  'ngo',
  'Korean government-run overseas volunteer program used for local development and testing.',
  'http://www.worldfriendskorea.or.kr'
)
on conflict (id) do update
set
  name = excluded.name,
  org_type = excluded.org_type,
  description = excluded.description,
  website = excluded.website;

do $$
begin
  if exists (
    select 1
    from auth.users
    where id = 'a1b2c3d4-0000-0000-0000-000000000002'
  ) then
    insert into public.users (id, email, name, telegram_id)
    values (
      'a1b2c3d4-0000-0000-0000-000000000002',
      'dev@test.com',
      'WFK Marketing Owner',
      null
    )
    on conflict (id) do update
    set
      email = excluded.email,
      name = excluded.name,
      telegram_id = excluded.telegram_id;

    insert into public.organization_members (id, org_id, user_id, role)
    values (
      'a1b2c3d4-0000-0000-0000-000000000010',
      'a1b2c3d4-0000-0000-0000-000000000001',
      'a1b2c3d4-0000-0000-0000-000000000002',
      'owner'
    )
    on conflict (org_id, user_id) do update
    set role = excluded.role;
  else
    raise notice 'auth.users row not found for seed user a1b2c3d4-0000-0000-0000-000000000002. Create auth user first.';
  end if;
end $$;

insert into public.contents (id, org_id, channel, content_type, status, body, metadata, created_by)
values
  (
    'a1b2c3d4-0000-0000-0000-000000000003',
    'a1b2c3d4-0000-0000-0000-000000000001',
    'instagram',
    'text',
    'pending_approval',
    'WFK March field activity update. Health education campaign reached 200 participants in Tanzania.',
    '{"hashtags": ["#WFK", "#NGO", "#Volunteer"]}'::jsonb,
    'ai'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000004',
    'a1b2c3d4-0000-0000-0000-000000000001',
    'threads',
    'text',
    'draft',
    'Volunteer recruitment is open for Korean nationals age 19 and above.',
    '{}'::jsonb,
    'ai'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000005',
    'a1b2c3d4-0000-0000-0000-000000000001',
    'naver_blog',
    'text',
    'published',
    '2025 WFK KOICA-NGO deployment report: 52 NGOs and 95 volunteers dispatched.',
    '{"title": "2025 WFK Activity Report", "tags": ["volunteer", "oda", "development"]}'::jsonb,
    'user'
  )
on conflict (id) do update
set
  channel = excluded.channel,
  content_type = excluded.content_type,
  status = excluded.status,
  body = excluded.body,
  metadata = excluded.metadata,
  created_by = excluded.created_by;
