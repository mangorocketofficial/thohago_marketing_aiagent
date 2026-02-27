-- RLS verification queries for Phase 1-1

-- 1) RLS enabled check
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'organizations',
    'users',
    'organization_members',
    'contents',
    'local_files',
    'chat_messages'
  )
order by tablename;

-- 2) Policy check
select tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'organizations',
    'users',
    'organization_members',
    'contents',
    'local_files',
    'chat_messages'
  )
order by tablename, policyname;

-- 3) Seed row sanity check
select
  (select count(*) from public.organizations where id = 'a1b2c3d4-0000-0000-0000-000000000001') as org_count,
  (select count(*) from public.contents where org_id = 'a1b2c3d4-0000-0000-0000-000000000001') as content_count;

-- 4) API-level RLS behavior must be verified via scripts/verify-rls.mjs
-- Required envs:
-- NEXT_PUBLIC_SUPABASE_URL
-- NEXT_PUBLIC_SUPABASE_ANON_KEY
-- RLS_TEST_USER_TOKEN
-- Optional: RLS_OTHER_ORG_ID
