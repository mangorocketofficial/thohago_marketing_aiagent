-- Phase 2-2: brand profile ingestion + memory cache columns

alter table public.org_brand_settings
  add column if not exists memory_md text,
  add column if not exists memory_md_generated_at timestamptz,
  add column if not exists memory_freshness_key text,
  add column if not exists rag_indexed_at timestamptz,
  add column if not exists rag_source_hash text,
  add column if not exists accumulated_insights jsonb not null default '{}'::jsonb,
  add column if not exists rag_ingestion_status text not null default 'pending'
    check (rag_ingestion_status in ('pending', 'processing', 'done', 'failed')),
  add column if not exists rag_ingestion_started_at timestamptz,
  add column if not exists rag_ingestion_error text;

create index if not exists idx_org_brand_settings_rag_ingestion_status
  on public.org_brand_settings (rag_ingestion_status);
