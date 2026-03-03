-- Phase 3-2 chat action-card projection schema

alter table public.chat_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists workflow_item_id uuid,
  add column if not exists projection_key text;

-- Ensure workflow reference is enforced even when column already existed from prior partial runs.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_workflow_item_id_fkey'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_workflow_item_id_fkey
      foreign key (workflow_item_id)
      references public.workflow_items(id)
      on delete set null;
  end if;
end
$$;

alter table public.chat_messages
  drop constraint if exists chk_chat_messages_message_type;

alter table public.chat_messages
  add constraint chk_chat_messages_message_type
  check (message_type in ('text', 'action_card', 'system'));

alter table public.chat_messages
  drop constraint if exists chk_chat_messages_action_card_fields;

alter table public.chat_messages
  add constraint chk_chat_messages_action_card_fields
  check (
    message_type <> 'action_card'
    or (
      workflow_item_id is not null
      and projection_key is not null
      and jsonb_typeof(metadata) = 'object'
      and metadata ->> 'projection_type' = 'workflow_action_card'
      and metadata ? 'workflow_item_id'
      and metadata ? 'workflow_status'
      and metadata ? 'expected_version'
      and metadata ? 'actions'
      and jsonb_typeof(metadata -> 'actions') = 'array'
    )
  );

alter table public.chat_messages
  drop constraint if exists chk_chat_messages_system_role;

alter table public.chat_messages
  add constraint chk_chat_messages_system_role
  check (
    message_type <> 'system'
    or role = 'assistant'
  );

create unique index if not exists idx_chat_messages_org_projection_key
  on public.chat_messages (org_id, projection_key);

create index if not exists idx_chat_messages_org_workflow_created
  on public.chat_messages (org_id, workflow_item_id, created_at desc)
  where workflow_item_id is not null;
