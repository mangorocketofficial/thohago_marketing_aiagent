-- Phase 2-1: RAG embeddings infrastructure (multi-profile)

create extension if not exists vector with schema extensions;

drop table if exists public.org_rag_embeddings cascade;

create table if not exists public.org_rag_embeddings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check (source_type in ('brand_profile', 'content', 'local_doc', 'chat_pattern')),
  source_id text not null,
  chunk_index int not null default 0,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding_model text not null check (embedding_model in ('text-embedding-3-small', 'text-embedding-3-large')),
  embedding_dim smallint not null check (embedding_dim in (512, 768, 1536)),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rag_embeddings_hnsw
  on public.org_rag_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_rag_embeddings_org_source_profile
  on public.org_rag_embeddings (org_id, source_type, embedding_model, embedding_dim);

create unique index if not exists uq_rag_embeddings_org_source_chunk_profile
  on public.org_rag_embeddings (
    org_id,
    source_type,
    source_id,
    chunk_index,
    embedding_model,
    embedding_dim
  );

drop trigger if exists org_rag_embeddings_updated_at on public.org_rag_embeddings;
create trigger org_rag_embeddings_updated_at
before update on public.org_rag_embeddings
for each row execute function public.update_updated_at();

alter table public.org_rag_embeddings enable row level security;
alter table public.org_rag_embeddings force row level security;

drop policy if exists "org members can read own embeddings" on public.org_rag_embeddings;
create policy "org members can read own embeddings"
  on public.org_rag_embeddings
  for select
  using (
    org_id in (
      select om.org_id
      from public.organization_members om
      where om.user_id = auth.uid()
    )
  );

drop function if exists public.match_rag_embeddings(
  extensions.vector,
  uuid,
  text,
  int,
  text[],
  jsonb,
  double precision,
  int
);

drop function if exists public.match_rag_embeddings(
  extensions.vector(1536),
  uuid,
  text,
  int,
  text[],
  jsonb,
  double precision,
  int
);

create or replace function public.match_rag_embeddings(
  query_embedding extensions.vector(1536),
  query_org_id uuid,
  query_embedding_model text,
  query_embedding_dim int,
  query_source_types text[] default null,
  query_metadata_filter jsonb default '{}'::jsonb,
  match_threshold double precision default 0.65,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.org_rag_embeddings e
  where e.org_id = query_org_id
    and e.embedding_model = query_embedding_model
    and e.embedding_dim = query_embedding_dim
    and (query_source_types is null or e.source_type = any(query_source_types))
    and (query_metadata_filter = '{}'::jsonb or e.metadata @> query_metadata_filter)
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke all on function public.match_rag_embeddings(
  extensions.vector(1536),
  uuid,
  text,
  int,
  text[],
  jsonb,
  double precision,
  int
) from public, anon, authenticated;

grant execute on function public.match_rag_embeddings(
  extensions.vector(1536),
  uuid,
  text,
  int,
  text[],
  jsonb,
  double precision,
  int
) to service_role;
