-- Phase 5-3: campaign plan chain storage
-- Adds structured chain output and assembled markdown document.

alter table public.campaigns
  add column if not exists plan_chain_data jsonb,
  add column if not exists plan_document text;
