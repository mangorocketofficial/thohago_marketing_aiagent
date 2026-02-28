# Architecture Pivot: Web + Daemon → Electron Desktop App

## Context

This document records the architectural decision made after completing Phase 1-1 and Phase 1-2, and defines the changes required going forward.

---

## Why We Pivoted

The core product goal is to act as a **junior marketing employee** — not a simple automation tool.

When we designed the initial architecture (web dashboard + Python daemon), we optimized for automation. But as the scope grew, a fundamental truth emerged:

> **A junior employee works with local files. So must this product.**

The more capabilities we added — image editing, video processing, document analysis, field interview transcription — the more workarounds we needed: thumbnail uploads, file streaming, daemon plugins, storage APIs. Each addition revealed that the web-based approach was fighting against the product's nature.

The breaking point was video. Video files (mp4, mov) can be hundreds of MB to several GB. Uploading them to a server every time the AI needs to process them is not viable. Local ffmpeg processing is the only realistic path.

And once local ffmpeg is required, a desktop app is the only correct container.

### The Architectural Principle We Derived

```
If the product goal is "automation tool"  → Web + Daemon is fine
If the product goal is "AI agent/employee" → Desktop app is required
```

Our goal is the latter. Therefore: **Electron**.

---

## New Architecture

### Electron Desktop App (Main)

The Electron app is the primary interface and runtime. Everything that touches local files lives here.

```
Electron App
├── Dashboard UI              (React, replaces apps/web)
├── AI Chat Interface         (in-app chat with the agent)
├── File Watcher              (chokidar, replaces services/daemon)
├── ffmpeg Processing         (local video/image processing)
└── Local File Storage        (completed content saved locally)
```

The user installs one app. The app runs in the background, watches the marketing folder, processes files locally, and surfaces results in the dashboard UI.

### Telegram Bot (Mobile Companion)

Telegram is not the core interface. It is a mobile companion that mirrors the Electron app's key functions for users who are away from their desktop.

```
Telegram Bot
├── Chat with AI agent        (same conversation, synced via Supabase)
└── Content approval          (approve/reject pending content on mobile)
```

This is possible and worth building because Supabase is already in the stack. It is not a hard requirement.

### Supabase (Cloud Layer)

Supabase serves two purposes:

1. **Electron ↔ Telegram sync** — the bridge between desktop and mobile
2. **Our data asset** — business-critical data that must not live only on a user's local machine

The data stored in Supabase is not for the user's local workflow. It is data that:
- Must be accessible from Telegram (outside the local machine)
- Must survive accidental local data loss (backup)
- Accumulates into our domain benchmark and AI training dataset over time

```
Supabase Tables
├── organizations     → org profile and basic info
├── contents          → AI-generated drafts pending approval
├── chat_messages     → conversation history (Electron ↔ Telegram sync)
├── campaigns         → campaign plans and strategy (Phase 3)
└── analytics         → published content performance data (Phase 3)
```

Everything else — raw files, processed outputs, thumbnails, temp files — stays local.

---

## What Changes from Phase 1-1 and 1-2

### Monorepo Structure

```
Before                          After
─────────────────────────────────────────────
apps/
  web/          (Next.js)   →   desktop/     (Electron + React)
  telegram/                 →   telegram/    (unchanged)

services/
  daemon/       (Python)    →   DELETED
                                (absorbed into Electron main process)

packages/
  types/                    →   unchanged
  db/                       →   unchanged
  config/                   →   unchanged
```

### Supabase Schema

```
Before                          After
─────────────────────────────────────────────
local_files     (table)     →   DELETED
                                (replaced by local filesystem)

organizations               →   unchanged
users                       →   unchanged
organization_members        →   unchanged
contents                    →   unchanged
chat_messages               →   unchanged
```

The `local_files` table is removed entirely. The Electron app reads the local filesystem directly — no indexing into a database required. File metadata lives in memory or local cache within the app.

### What Is Preserved

Everything built in Phase 1-1 and 1-2 that is not file-indexing related carries forward intact:

- All Supabase table schemas except `local_files`
- RLS policies
- `packages/types` — all types except `LocalFile`, `FileStatus`
- `packages/db` — all queries except `local-files.ts`
- `apps/telegram` scaffold
- Seed data (WFK org, test user)

---

## Local vs Cloud: The Decision Principle

The rule for deciding where data lives:

| Question | Answer | Storage |
|----------|--------|---------|
| Does Telegram need to access this? | Yes | Supabase |
| Is this a business asset we need? | Yes | Supabase |
| Does it need to survive local data loss? | Yes | Supabase |
| Is it a raw/processed local file? | Yes | Local filesystem |
| Is it a temp/intermediate file? | Yes | Local, deleted after use |

---

## Implications for Phase 1-3 and Beyond

Phase 1-3 (AI agent + content generation) proceeds with this architecture:

- The **Electron main process** handles file watching (chokidar) and triggers the AI pipeline
- The **AI agent** runs server-side (API calls to Claude/GPT) — no change
- Generated **content drafts** are saved to Supabase `contents` table — no change
- **Completed output files** (final images, videos) are saved locally
- **Telegram** receives approval notifications via Supabase Realtime — no change

The Realtime trigger decision (Supabase Realtime → server → orchestrator) remains valid. The only change is who initiates the trigger: Electron main process instead of the Python daemon.

---

## Summary

> The product goal of "junior marketing employee" requires direct local file access. Direct local file access requires a desktop app. Therefore, Electron is the correct foundation — not a workaround, but the architecturally honest choice for this product.
>
> Supabase remains in the stack not as a primary data store, but as the cloud sync layer that enables Telegram integration and protects against local data loss. These are legitimate cloud responsibilities. Everything else runs locally.

---

*Document version: v1.0*
*Type: Architecture Decision Record (ADR)*
*Affects: Phase 1-3 onward*
*Created: 2026-02-28*
