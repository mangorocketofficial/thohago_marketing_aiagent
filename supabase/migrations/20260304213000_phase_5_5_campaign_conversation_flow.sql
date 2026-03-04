-- Phase 5-5: campaign planning conversation flow
-- 1) Normalize legacy await_campaign_approval sessions
-- 2) Remove await_campaign_approval from current_step check constraint

update public.orchestrator_sessions
set
  current_step = 'await_user_input',
  status = case when status = 'running' then 'paused' else status end,
  state = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(state, '{}'::jsonb), '{campaign_survey}', 'null'::jsonb, true),
        '{campaign_draft_version}',
        '0'::jsonb,
        true
      ),
      '{campaign_chain_data}',
      'null'::jsonb,
      true
    ),
    '{campaign_plan_document}',
    'null'::jsonb,
    true
  )
where current_step = 'await_campaign_approval';

do $$
declare
  target record;
begin
  for target in
    select conname
    from pg_constraint
    where conrelid = 'public.orchestrator_sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%current_step%'
  loop
    execute format('alter table public.orchestrator_sessions drop constraint if exists %I', target.conname);
  end loop;
end
$$;

alter table public.orchestrator_sessions
  add constraint orchestrator_sessions_current_step_check
  check (
    current_step in (
      'detect',
      'await_user_input',
      'generate_content',
      'await_content_approval',
      'publish',
      'done'
    )
  );

