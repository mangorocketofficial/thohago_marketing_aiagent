# Phase 1-1 Development Request
## Marketing AI Agent Platform - Foundation Setup

> Status update (2026-02-28): Superseded for runtime/interface direction by `docs/architecture-pivot-electron.md` from Phase 1-3 onward.  
> This document remains the historical source of truth for what was implemented in Phase 1-1.

---

## Canonical Source of Truth

For **Phase 1-1 only**, this document is the canonical implementation source.
If there is any mismatch with `docs/marketing-ai-agent-architecture_1.md`, this document takes precedence.

Resolved for Phase 1-1:
- Daemon location: `services/daemon` (not `apps/daemon`)
- Telegram scaffold stack: `grammy` (TypeScript)
- `packages/rag` and `packages/ai-agents` are intentionally deferred to later phases

---

## Overview

Phase 1-1 establishes the implementation foundation only:
- Monorepo structure (Turborepo + pnpm)
- Shared packages (`types`, `db`, `config`)
- Supabase schema + RLS + indexes
- Re-runnable seed data for local testing

No business logic is implemented in this phase.

---

## Objectives

- [ ] Initialize monorepo with Turborepo + pnpm
- [ ] Configure shared packages (`types`, `db`, `config`)
- [ ] Add Supabase migration and seed assets under `/supabase`
- [ ] Apply RLS policies with explicit `WITH CHECK` for multi-tenant safety
- [ ] Verify seed and RLS behavior through SQL + API-level tests

---

## 1. Monorepo Structure

```text
/marketing-ai-agent
│
├── apps/
│   ├── web/                    # Next.js 15 App Router scaffold
│   └── telegram/               # Telegram bot scaffold (grammy)
│
├── packages/
│   ├── types/                  # Shared TypeScript types
│   ├── db/                     # Supabase clients + query helpers
│   └── config/                 # Shared tsconfig + eslint flat config
│
├── services/
│   └── daemon/                 # Python local file watcher scaffold
│
├── supabase/
│   ├── migrations/
│   │   └── 20260227190000_phase_1_1_foundation.sql
│   ├── seed.sql
│   └── verify-rls.sql
│
├── scripts/
│   └── verify-rls.mjs          # API-level RLS behavior check
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

Note:
- Do not pre-create the 9 `services/*` module folders in this phase.

---

## 2. Package Configuration Requirements

### 2.1 `turbo.json`

- `build` depends on `^build`
- `dev` is persistent and uncached
- `type-check` depends on `^build`

### 2.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

### 2.3 `packages/config`

Provide:
- `tsconfig.base.json`
- `eslint.config.js` (flat config)

### 2.4 `packages/types`

Must export shared domain types for:
- organizations
- users
- organization members
- contents
- local files
- chat messages

### 2.5 `packages/db`

Must provide:
- anon client singleton for app usage
- service-role client singleton for server/admin operations
- table query helper exports for:
  - organizations
  - users
  - contents
  - local_files
  - chat_messages

---

## 3. Database Requirements (Supabase)

Use migration file:
- `supabase/migrations/20260227190000_phase_1_1_foundation.sql`

### 3.1 Schema Hardening Requirements

All tenant-critical columns must be `NOT NULL`, including:
- `org_id`, `user_id`, `role`, `channel`, `content_type`, `status`, `created_by`

`metadata` columns must be:
- `jsonb not null default '{}'::jsonb`

Add indexing for expected access paths:
- org-scoped reads (`org_id`)
- timeline sorting (`created_at`, `indexed_at`)
- status filtering (`contents.status`)

### 3.2 RLS Requirements

RLS must be enabled and forced on:
- `organizations`
- `users`
- `organization_members`
- `contents`
- `local_files`
- `chat_messages`

Policy requirements:
- `users`: self-read / self-insert / self-update
- org-scoped tables: membership-based access
- `FOR ALL` policies for `contents/local_files/chat_messages` must include explicit `WITH CHECK`

---

## 4. Seed Data Requirements

Use seed file:
- `supabase/seed.sql`

Seed targets:
- Organization: WFK (`a1b2c3d4-...0001`)
- User: dev test user (`a1b2c3d4-...0002`) if the auth user exists
- Membership: owner role mapping
- 3 content rows for UI testing

Seed behavior requirements:
- idempotent (`ON CONFLICT` based)
- safe when auth user is missing (notice + continue)

---

## 5. Environment Variables

Root `.env.example` must include:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=

# Development seed
SEED_ORG_ID=a1b2c3d4-0000-0000-0000-000000000001
SEED_USER_ID=a1b2c3d4-0000-0000-0000-000000000002

# Optional RLS verification
RLS_TEST_USER_TOKEN=
RLS_OTHER_ORG_ID=
```

---

## 6. Acceptance Criteria

Phase 1-1 is complete when all are verified:

- [ ] `pnpm install` succeeds from repo root
- [ ] `pnpm build` succeeds
- [ ] `pnpm dev` starts `apps/web` default page
- [ ] Migration applied: all 6 public tables exist
- [ ] RLS enabled and policies present (`supabase/verify-rls.sql`)
- [ ] Seed applied: WFK org + 3 content rows (+ user/membership when auth user exists)
- [ ] `@repo/types` imports correctly from `apps/web`
- [ ] `@repo/db` client can run a basic query
- [ ] `pnpm type-check` has no TypeScript errors
- [ ] API-level RLS behavior verified via `pnpm verify:rls` with test token(s)

---

## 7. Out of Scope for Phase 1-1

- Authentication UI flow
- AI orchestration (LangGraph)
- RAG/pgvector pipeline implementation
- Telegram bot business features
- Daemon file watch behavior
- Any non-scaffold UI beyond the default web page

---

## 8. Developer Notes

- Fixed UUID pattern: `a1b2c3d4-0000-0000-0000-00000000000X`
- Service role bypasses RLS by design; RLS behavior must be validated with anon/authenticated tokens
- Keep `contents.metadata` schema-flexible; do not add channel-specific columns in Phase 1-1

---

*Document version: v1.1*
*Phase: 1-1 Foundation Setup*
*Updated: 2026-02-27*
