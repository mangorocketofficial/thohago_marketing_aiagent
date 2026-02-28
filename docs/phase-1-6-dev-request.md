# Phase 1-6 Development Request
## 또하고 (Ddohago) — Onboarding Flow

---

## Overview

This document defines the full scope of **Phase 1-6**: the first-run onboarding experience for 또하고.

Onboarding is the first thing a user sees. It is not a setup wizard — it is the moment the user meets their new marketing colleague, 또대리 (Ddo-Daeri), for the first time. The experience should feel like welcoming a new junior employee, not configuring software.

When Phase 1-6 is complete, a new user can go from cold launch to a fully initialized AI agent — with org context, brand voice, and a watched folder — in under 10 minutes.

**The onboarding flow this phase must deliver:**

```
App first launch
      ↓
Step 0: 또대리 introduction (fullscreen)
      ↓
Step 1: URL input (website + Instagram + Naver Blog)
      ↓
Step 2: Auto-analysis (crawling + AI brand extraction)
      ↓
Step 3: AI interview — 4 questions via chat (brand voice + forbidden words)
      ↓
Step 4: Marketing folder setup
      ↓
Step 5: Completion screen → main dashboard
```

**Depends on:** Phase 1-5b (Frontend Integration) — Electron renderer, IPC bridge, and Supabase Realtime must be operational.

---

## 1. Key Design Decisions

| Decision | Choice |
|----------|--------|
| UI pattern | Fullscreen step flow — completely separate from main dashboard |
| Default language | Korean |
| Language options | Korean / English (togglable from Step 0) |
| Agent name | 또대리 (Ddo-Daeri) |
| Service name | 또하고 (Ddohago) |
| Onboarding trigger | `electron-store` key `onboardingCompleted: false` |
| Re-entry | Settings → Brand Review (separate menu, not re-running onboarding) |
| Crawl targets (MVP) | Website + Naver Blog (full), Instagram (public posts only) |
| Crawl targets (deferred) | Facebook, YouTube — store URLs only, process later |
| Interview length | 4 questions, target under 5 minutes |

---

## 2. i18n Setup

Use `react-i18next` for all UI text. Apply from Step 0 onward — this is the foundation for all future UI text in 또하고.

### Structure

```
apps/desktop/src/
└── i18n/
    ├── index.ts           ← i18next initialization
    └── locales/
        ├── ko.json        ← Korean (default)
        └── en.json        ← English
```

### Initialization

```typescript
// apps/desktop/src/i18n/index.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from './locales/ko.json'
import en from './locales/en.json'

i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: 'ko',           // Korean default
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
})

export default i18n
```

### Language Persistence

Language selection stored in `electron-store`:

```typescript
store.get('language')  // 'ko' | 'en', default 'ko'
```

Language toggle available on Step 0 and in Settings after onboarding.

### Key Translation Entries (Korean / English)

```json
// ko.json (excerpt)
{
  "onboarding": {
    "step0": {
      "greeting": "안녕하세요!",
      "intro": "저는 오늘부터 마케팅 업무를 맡게 된\n또대리입니다.",
      "promise": "콘텐츠 기획부터 발행까지 열심히 일할게요!",
      "sign": "잘 부탁드립니다 🙌",
      "cta": "함께 시작하기"
    },
    "step1": {
      "title": "우리 기관을 알려주세요",
      "subtitle": "채널 정보를 바탕으로 브랜드를 분석할게요",
      "website": "웹사이트 URL",
      "instagram": "인스타그램 URL",
      "naverBlog": "네이버 블로그 URL",
      "optional": "(선택)",
      "next": "다음"
    },
    "step2": {
      "title": "열심히 공부하고 있어요...",
      "website": "웹사이트 분석 중",
      "instagram": "인스타그램 포스트 분석 중",
      "naverBlog": "네이버 블로그 분석 중",
      "building": "브랜드 보이스 구축 중",
      "done": "분석 완료!"
    },
    "step3": {
      "title": "몇 가지만 여쭤볼게요",
      "subtitle": "4가지 질문으로 브랜드를 완성해요"
    },
    "step4": {
      "title": "마케팅 폴더를 설정해요",
      "subtitle": "이 폴더에 프로젝트 자료를 넣으면 또대리가 감지해요",
      "example": "예시 구조",
      "chooseFolder": "폴더 선택",
      "createFolder": "새 폴더 만들기"
    },
    "step5": {
      "title": "준비 완료! 🎉",
      "message": "이제 또대리가 마케팅을 함께할 준비가 됐어요",
      "cta": "시작하기"
    }
  }
}
```

```json
// en.json (excerpt)
{
  "onboarding": {
    "step0": {
      "greeting": "Hello!",
      "intro": "I'm Ddo-Daeri, your new\nmarketing assistant.",
      "promise": "I'll work hard on everything from content planning to publishing!",
      "sign": "Nice to meet you 🙌",
      "cta": "Let's get started"
    }
  }
}
```

---

## 3. Onboarding Flow: Step by Step

### Step 0 — 또대리 Introduction

Fullscreen. Dark or brand-colored background. Agent character centered.

```
┌─────────────────────────────────────────┐
│                              [KO | EN]  │  ← language toggle top-right
│                                         │
│                                         │
│              [ 또대리 avatar ]           │
│                                         │
│          안녕하세요!                     │
│   저는 오늘부터 마케팅 업무를 맡게 된    │
│           또대리입니다.                  │
│                                         │
│  콘텐츠 기획부터 발행까지 열심히 일할게요!│
│          잘 부탁드립니다 🙌              │
│                                         │
│                                         │
│         [ 함께 시작하기  →  ]           │
│                                         │
└─────────────────────────────────────────┘
```

**Notes:**
- Avatar is a simple illustrated character (not a photo). Placeholder SVG acceptable for MVP.
- Text appears with a simple fade-in or typewriter animation.
- Language toggle (KO/EN) top-right. Changing language instantly re-renders all text.
- No progress dots on this step — it is a pre-step intro.

---

### Step 1 — URL Input

```
┌─────────────────────────────────────────┐
│  ● ● ○ ○ ○                    [KO | EN] │
│                                         │
│  우리 기관을 알려주세요                  │
│  채널 정보를 바탕으로 브랜드를 분석할게요 │
│                                         │
│  웹사이트 URL *                          │
│  [ https://www.wfk.or.kr           ]   │
│                                         │
│  인스타그램 URL (선택)                   │
│  [ https://instagram.com/wfk_      ]   │
│                                         │
│  네이버 블로그 URL (선택)                │
│  [ https://blog.naver.com/wfk      ]   │
│                                         │
│  ─────────────────────────────────────  │
│  페이스북 / 유튜브는 나중에 추가할 수 있어요 │
│                                         │
│                          [ 다음 → ]    │
└─────────────────────────────────────────┘
```

**Validation:**
- Website URL is required. Instagram and Naver Blog are optional but at least one SNS URL recommended.
- Basic URL format validation before proceeding.
- If only website provided: proceed but note SNS analysis will be limited.

---

### Step 2 — Auto Analysis

Triggered immediately after Step 1. User waits while backend processes.

```
┌─────────────────────────────────────────┐
│  ● ● ● ○ ○                    [KO | EN] │
│                                         │
│      열심히 공부하고 있어요... 📚        │
│                                         │
│   ✅  웹사이트 분석 완료                 │
│   ✅  인스타그램 포스트 분석 완료         │
│   ⏳  네이버 블로그 분석 중...           │
│   ○   브랜드 보이스 구축 중              │
│                                         │
│   약 30초 정도 걸려요                   │
│                                         │
└─────────────────────────────────────────┘
```

**What happens in the background:**

```
1. Website crawl
   → Extract: org name, mission/vision, key programs, target audience
   → Tool: cheerio (Node.js HTML parser) via Electron main process

2. Naver Blog crawl
   → Extract: recent 10 posts titles + content snippets
   → Identify: posting tone, recurring themes, keywords

3. Instagram
   → Extract: recent post captions (public profile scraping)
   → Identify: hashtag patterns, tone, content themes

4. AI brand analysis (Claude Opus)
   → Input: all crawled content
   → Output: structured brand profile JSON
      {
        "detected_tone": "warm_professional",
        "tone_description": "따뜻하고 전문적인 톤...",
        "key_themes": ["해외봉사", "국제개발", "청년"],
        "target_audience": ["잠재 봉사자", "후원자"],
        "suggested_hashtags": ["#WFK", "#해외봉사"],
        "brand_summary": "..."
      }
```

**Error handling:**
- If a URL fails to crawl: mark as failed, continue with available data, note in Step 3.
- If all crawls fail: skip to Step 3 with empty context, let interview fill the gaps.
- Never block the user — always proceed.

---

### Step 3 — AI Interview (Chat)

4 questions only. 또대리 speaks first, presenting the analysis result, then asks questions one by one.

```
┌─────────────────────────────────────────┐
│  ● ● ● ● ○                    [KO | EN] │
│  몇 가지만 여쭤볼게요                    │
├─────────────────────────────────────────┤
│                                         │
│  🤖 분석 완료했어요! WFK는 따뜻하고      │
│     전문적인 톤을 주로 사용하는 것 같아요.│
│     맞나요? 조정이 필요하면 말씀해 주세요.│
│                                         │
│                      👤 네, 맞아요.     │
│                         조금 더 친근하게 │
│                         해주세요.       │
│                                         │
│  🤖 알겠어요! 다음 질문이에요.           │
│     주로 어떤 분들에게 말하고 있나요?    │
│     (예: 잠재 봉사자, 후원자, 일반 대중) │
│                                         │
│  [                              ] [전송] │
└─────────────────────────────────────────┘
```

**4 Interview Questions (in order):**

```
Q1: Brand tone confirmation
  또대리: "분석 결과, [detected_tone]을 주로 사용하시는 것 같아요.
          맞나요? 조정이 필요하면 말씀해 주세요."

Q2: Target audience
  또대리: "주로 어떤 분들에게 이야기하고 있나요?
          (예: 잠재 봉사자, 후원자, 일반 대중)"

Q3: Forbidden words/topics
  또대리: "콘텐츠에서 절대 쓰면 안 되는 단어나
          다루지 말아야 할 주제가 있나요?"

Q4: Key campaign seasons
  또대리: "마케팅이 가장 활발한 시기가 언제예요?
          (예: 봉사단 모집 시즌, 연말 후원 캠페인)"
```

**After Q4:**
또대리: "감사해요! 이걸로 브랜드 프로필을 완성할게요. 👍"
→ Auto-advance to Step 4 after short delay.

**Interview state is saved to Supabase `org_brand_settings` as answers come in (not only at the end).**

---

### Step 4 — Folder Setup

```
┌─────────────────────────────────────────┐
│  ● ● ● ● ●                    [KO | EN] │
│                                         │
│  마케팅 폴더를 설정해요                  │
│  이 폴더에 프로젝트 자료를 넣으면        │
│  또대리가 바로 감지해요                  │
│                                         │
│  예시 구조                              │
│  📁 WFK_Marketing/                      │
│    📁 탄자니아교육봉사/                  │
│       🖼 현장사진01.jpg                 │
│       📄 활동보고서.hwp                 │
│    📁 봉사단원모집/                      │
│       🖼 포스터.png                     │
│                                         │
│  [ 📁 새 폴더 만들기 ]                  │
│  [ 📂 기존 폴더 선택 ]                  │
│                                         │
│  선택된 폴더:                           │
│  ~/Documents/WFK_Marketing      ✅      │
│                                         │
└─────────────────────────────────────────┘
```

- "새 폴더 만들기" → native save dialog, creates folder, sets as watch path
- "기존 폴더 선택" → native open dialog
- Selected path shown with checkmark
- Confirm button appears after folder is selected → auto-advances to Step 5

---

### Step 5 — Completion

```
┌─────────────────────────────────────────┐
│                              [KO | EN]  │
│                                         │
│           [ 또대리 avatar — 😊 ]        │
│                                         │
│           준비 완료! 🎉                 │
│                                         │
│  이제 또대리가 마케팅을 함께할           │
│       준비가 됐어요.                    │
│                                         │
│  ✅  WFK 브랜드 프로필 완성             │
│  ✅  마케팅 폴더 설정 완료              │
│  ✅  또대리 활성화                      │
│                                         │
│         [ 시작하기  →  ]               │
│                                         │
└─────────────────────────────────────────┘
```

"시작하기" → sets `onboardingCompleted: true` in `electron-store` → loads main dashboard.

---

## 4. New Supabase Table: `org_brand_settings`

**Migration file:** `supabase/migrations/20260228120000_phase_1_6_brand_settings.sql`

```sql
create table org_brand_settings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade not null unique,
  website_url         text,
  instagram_url       text,
  naver_blog_url      text,
  facebook_url        text,
  youtube_url         text,
  detected_tone       text,
  tone_description    text,
  target_audience     jsonb not null default '[]'::jsonb,
  key_themes          jsonb not null default '[]'::jsonb,
  forbidden_words     jsonb not null default '[]'::jsonb,
  forbidden_topics    jsonb not null default '[]'::jsonb,
  campaign_seasons    jsonb not null default '[]'::jsonb,
  suggested_hashtags  jsonb not null default '[]'::jsonb,
  brand_summary       text,
  crawl_status        jsonb not null default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create trigger org_brand_settings_updated_at
  before update on org_brand_settings
  for each row execute function update_updated_at();

alter table org_brand_settings enable row level security;

create policy "org members can manage brand settings"
  on org_brand_settings for all
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  )
  with check (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  );
```

### `crawl_status` JSON Structure

```json
{
  "website":    { "status": "done",   "crawled_at": "2026-02-28T..." },
  "instagram":  { "status": "done",   "crawled_at": "2026-02-28T..." },
  "naver_blog": { "status": "failed", "error": "Connection timeout" },
  "facebook":   { "status": "skipped" },
  "youtube":    { "status": "skipped" }
}
```

---

## 5. Crawling Implementation

Crawling runs in the **Electron main process** (Node.js), not in the renderer.

### Dependencies

```json
// apps/desktop/package.json additions
{
  "dependencies": {
    "cheerio": "^1.0.0",
    "node-fetch": "^3.3.0"
  }
}
```

### Crawl Module Structure

```
apps/desktop/electron/
└── crawler/
    ├── index.mjs          ← orchestrates all crawls, returns combined result
    ├── website.mjs        ← generic website crawler (cheerio)
    ├── instagram.mjs      ← Instagram public profile scraper
    └── naver-blog.mjs     ← Naver Blog crawler
```

### Website Crawler (Core)

```javascript
// apps/desktop/electron/crawler/website.mjs

export async function crawlWebsite(url) {
  const html = await fetch(url).then(r => r.text())
  const $ = cheerio.load(html)

  return {
    title: $('title').text(),
    description: $('meta[name="description"]').attr('content'),
    headings: $('h1, h2').map((_, el) => $(el).text()).get().slice(0, 20),
    paragraphs: $('p').map((_, el) => $(el).text()).get()
      .filter(t => t.length > 50)
      .slice(0, 30),
  }
}
```

### IPC Channel for Crawling

```
renderer → main: 'onboarding:start-crawl'  { urls: { website, instagram, naverBlog } }
main → renderer: 'onboarding:crawl-progress'  { step: 'website' | 'instagram' | 'naver_blog' | 'ai_analysis', status: 'running' | 'done' | 'failed' }
main → renderer: 'onboarding:crawl-complete'  { brandProfile: {...} }
```

---

## 6. AI Brand Analysis

Runs server-side in `apps/api` after crawling is complete. Electron sends crawled data to API endpoint.

### Endpoint

```
POST /onboarding/analyze
Body: { org_id, crawled_data: { website, instagram, naver_blog } }
Returns: { brand_profile }
```

### Prompt (Claude Opus)

```typescript
const prompt = `
You are analyzing a Korean NGO/nonprofit organization's online presence.

Crawled data:
${JSON.stringify(crawledData, null, 2)}

Extract and return a JSON brand profile with this exact structure:
{
  "detected_tone": "warm_professional | professional | friendly | urgent",
  "tone_description": "2-3 sentence description in Korean",
  "key_themes": ["theme1", "theme2", ...],
  "target_audience": ["audience1", "audience2", ...],
  "suggested_hashtags": ["#tag1", "#tag2", ...],
  "brand_summary": "3-4 sentence org summary in Korean"
}

Return JSON only. No markdown, no explanation.
`
```

---

## 7. Updated Shared Types

Add to `packages/types/src/index.ts`:

```typescript
export type CrawlStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type OrgBrandSettings = {
  id: string
  org_id: string
  website_url: string | null
  instagram_url: string | null
  naver_blog_url: string | null
  facebook_url: string | null
  youtube_url: string | null
  detected_tone: string | null
  tone_description: string | null
  target_audience: string[]
  key_themes: string[]
  forbidden_words: string[]
  forbidden_topics: string[]
  campaign_seasons: string[]
  suggested_hashtags: string[]
  brand_summary: string | null
  crawl_status: Record<string, { status: CrawlStatus; crawled_at?: string; error?: string }>
  created_at: string
  updated_at: string
}

export type OnboardingStep =
  | 'intro'
  | 'url_input'
  | 'analyzing'
  | 'interview'
  | 'folder_setup'
  | 'complete'
```

---

## 8. electron-store Keys

```typescript
store.get('onboardingCompleted')  // boolean, default false
store.get('language')             // 'ko' | 'en', default 'ko'
store.get('watchPath')            // string, set in Step 4
store.get('orgId')                // string, set during onboarding
```

---

## 9. Monorepo / Package Updates

- Add `react-i18next` and `i18next` to `apps/desktop`
- Add `cheerio` and `node-fetch` to `apps/desktop`
- Add `/onboarding/analyze` route to `apps/api`
- Add `org_brand_settings` queries to `packages/db`

---

## 10. Acceptance Criteria

Phase 1-6 is complete when the following scenario runs end-to-end:

- [ ] Fresh install (clear `electron-store`) → onboarding screen appears, not main dashboard
- [ ] Step 0: 또대리 avatar and intro text rendered correctly in Korean
- [ ] Language toggle (KO/EN) on Step 0 switches all text instantly
- [ ] Step 1: URL input validates format, website required, SNS optional
- [ ] Step 2: crawl progress updates in real time (each step lights up as done)
- [ ] Step 2: if one URL fails, flow continues without blocking
- [ ] Step 3: 또대리 sends first message with detected tone from crawl result
- [ ] Step 3: all 4 interview questions asked and answered
- [ ] Step 3: answers persisted to `org_brand_settings` in Supabase incrementally
- [ ] Step 4: native folder dialog opens, selected path shown with checkmark
- [ ] Step 5: completion screen shows 3 checkmarks, "시작하기" loads main dashboard
- [ ] After completion: `onboardingCompleted: true` in `electron-store`
- [ ] Re-launch: onboarding does NOT appear, main dashboard loads directly
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
- [ ] Migration applies cleanly on top of Phase 1-5

---

## 11. Out of Scope for Phase 1-6

- RAG / pgvector embedding of brand settings (Phase 2)
- Brand Review re-entry flow in Settings (Phase 2)
- Facebook / YouTube crawling
- Deep Instagram API integration (public scraping only for now)
- Avatar animation beyond simple fade-in
- Onboarding skip option (all users must complete onboarding)

---

## Notes for Developer

- 또대리's avatar is a placeholder SVG for Phase 1-6. Final character design comes later. Use a simple rounded robot or person icon — something warm, not cold/corporate.
- Crawling happens in Electron main process (Node.js), not renderer. Send progress updates to renderer via IPC as each step completes.
- AI brand analysis runs in `apps/api` (server), not in Electron. Keep AI logic server-side.
- Interview answers are saved incrementally to Supabase after each Q&A pair — do not wait until all 4 are answered.
- `org_brand_settings` has a unique constraint on `org_id` — use upsert, not insert.
- Korean text with line breaks in i18n values: use `\n` and render with `white-space: pre-line` in CSS.
- The onboarding flow is linear — no back navigation. If user needs to fix something, they go to Settings → Brand Review after completing onboarding.

---

*Document version: v1.0*
*Phase: 1-6 Onboarding Flow*
*Service name: 또하고 (Ddohago)*
*Agent name: 또대리 (Ddo-Daeri)*
*Depends on: Phase 1-5b (Frontend Integration)*
*Created: 2026-02-28*
