# Supabase CLI Workflow

This repository uses a pinned local Supabase CLI via `devDependencies`:

- `supabase@2.76.15`
- all commands run through `pnpm exec supabase`

## 1) One-Time Setup

```bash
pnpm install
pnpm supabase:init
```

`supabase init` has already been run in this repo and created:

- `supabase/config.toml`
- `supabase/.gitignore`

## 2) Local Database Workflow

```bash
pnpm supabase:start
pnpm supabase:status
pnpm supabase:status:env
pnpm supabase:db:reset
pnpm verify:rls
pnpm supabase:stop
```

`pnpm supabase:db:reset` applies all migrations in `supabase/migrations` and then runs `supabase/seed.sql`.

## 3) Environment Variable Mapping

After `pnpm supabase:start`, run:

```bash
pnpm supabase:status:env
```

Copy values into `.env` or `.env.local`:

- `API_URL` -> `NEXT_PUBLIC_SUPABASE_URL`
- `ANON_KEY` -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SERVICE_ROLE_KEY` -> `SUPABASE_SERVICE_ROLE_KEY`

## 4) Migration Workflow

Create a new migration:

```bash
pnpm supabase:migration:new <migration_name>
```

Apply migrations to local DB:

```bash
pnpm supabase:db:push
```

For clean verification from scratch:

```bash
pnpm supabase:db:reset
```
