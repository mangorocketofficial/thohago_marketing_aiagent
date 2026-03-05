# Phase 7-1a: Naver Blog Content Generation — Backend Core

- Date: 2026-03-05
- Status: Planning
- Scope: `naverblog_generation` skill registration, RAG-based blog generation, LLM fallback, contents/slot persistence, local file save
- Depends on: Phase 6-3a (scheduler data integration), Phase 5-0 (skill router), Phase 5-2 (enriched RAG context)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

After a campaign plan is approved, `schedule_slots` rows are created with date/channel/title metadata — but no actual content body exists. Users also need to generate blog content on-demand outside campaigns. There is currently no skill or pipeline that produces Naver blog text content from RAG context + brand profile.

---

## 2) Goals

1. **Register `naverblog_generation` skill** in the skill router with intent matching for blog generation requests.
2. **Support two generation routes**:
   - **Campaign-scheduled**: triggered from an existing `schedule_slot` where `channel = 'naver_blog'`.
   - **On-demand**: triggered by user chat request (e.g., "네이버 블로그 글 써줘") — creates a slot with `source: "ondemand"`.
3. **Generate blog content** using RAG context (brand profile, activity folder files, conversation memory) + channel-specific system prompt.
4. **LLM fallback**: Claude (primary) → GPT-4o-mini (fallback on credit exhaustion).
5. **Persist generated content** to `contents` table and link to `schedule_slots.content_id`.
6. **Save generated content as local file** in the user's watch folder with organized folder structure.

---

## 3) Skill Architecture

### 3.1 Skill registration

File: `apps/api/src/orchestrator/skills/naverblog-generation/index.ts` (new)

```typescript
export const createNaverBlogGenerationSkill = (): Skill => ({
  id: "naverblog_generation",
  displayName: "Naver Blog Generation",
  version: "7.1.0",
  priority: 90, // below campaign_plan (100)
  handlesEvents: ["user_message"],
  matchIntent: matchNaverBlogIntent,
  execute: executeNaverBlogGeneration,
});
```

File: `apps/api/src/orchestrator/skills/router.ts` (modify)

```typescript
export const getSkillRegistry = (): SkillRegistry => {
  const registry = new SkillRegistry();
  registry.register(createCampaignPlanSkill());
  registry.register(createNaverBlogGenerationSkill()); // NEW
  singletonRegistry = registry;
  return registry;
};
```

### 3.2 Intent matching

File: `apps/api/src/orchestrator/skills/naverblog-generation/intent.ts` (new)

Signal keywords:

| Category | Keywords | Confidence |
|---|---|---|
| Strong phrases | "블로그 글 써줘", "블로그 포스트 작성", "네이버 블로그 생성", "write blog post" | 0.95 |
| Blog nouns | "블로그", "포스트", "포스팅", "blog", "post" | — |
| Action terms | "써줘", "작성", "생성", "만들어", "write", "create", "generate" | — |
| Combined (noun + action) | — | 0.88 |
| Query terms (exclude) | "조회", "확인", "상태", "목록" | negative signal |

Logic:
- If `active_skill === "naverblog_generation"` → confidence 1.0 (continue active session).
- If strong phrase matched → 0.95.
- If blog noun + action term → 0.88.
- Blog noun alone without action → 0.0 (user might be asking about blog, not requesting generation).

### 3.3 Generation routes

#### Route A: Campaign-scheduled generation

Trigger: Skill receives context with `schedule_slot` reference containing `channel: "naver_blog"`.

Flow:
1. Load slot metadata: `campaign_id`, `title`, `scheduled_date`, `metadata.suggested_type`.
2. Load campaign plan from `campaigns.plan` → extract topic/theme for this slot.
3. Build generation prompt with campaign context.
4. Generate → persist → link.

#### Route B: On-demand generation

Trigger: User sends blog generation request via chat without slot context.

Flow:
1. Extract topic from user message (or ask clarifying question if vague).
2. Create `schedule_slots` row: `slot_status: "generating"`, `source: "ondemand"` in metadata, `scheduled_date: today`.
3. Build generation prompt with on-demand context.
4. Generate → persist → link.

---

## 4) Blog Generation Pipeline

### 4.1 Context assembly

File: `apps/api/src/orchestrator/skills/naverblog-generation/context.ts` (new)

```typescript
type BlogGenerationContext = {
  brandProfile: string;       // from RAG brand_profile type
  activityFiles: string;      // from RAG local_files type
  conversationMemory: string; // session summary + preferences
  campaignContext: string | null; // campaign plan excerpt (Route A only)
  topic: string;              // extracted from slot title or user message
  channel: "naver_blog";
};
```

Assembly order:
1. **Brand profile** — `buildEnrichedCampaignContext()` reuse (Phase 5-2 RAG).
2. **Activity folder files** — relevant documents from watch folder via RAG retrieval.
3. **Conversation memory** — session summary + preference context (Phase 6-1).
4. **Campaign context** (Route A only) — campaign plan audience/channel strategy for this slot.

### 4.2 System prompt

File: `apps/api/src/orchestrator/skills/naverblog-generation/prompt.ts` (new)

Core prompt structure:

```
[ROLE]
You are a professional Korean blog content writer for Naver Blog.

[BRAND_CONTEXT]
{brandProfile}

[TOPIC]
{topic}

[CONTENT_GUIDELINES]
- Write in natural Korean suitable for Naver Blog readers.
- Structure: 제목 → 도입부 → 본문 (2-4 소제목) → 마무리.
- Length: 1500-3000 characters.
- Include relevant hashtags at the end (5-10 tags).
- Tone: match brand voice from brand profile.
- SEO: include topic keywords naturally in title and first paragraph.

[REFERENCE_MATERIALS]
{activityFiles}
{campaignContext}

[OUTPUT_FORMAT]
Return the blog post as structured markdown:
# 제목
(본문)
---
#태그1 #태그2 ...
```

### 4.3 LLM invocation

File: `apps/api/src/orchestrator/skills/naverblog-generation/generate.ts` (new)

Reuse existing LLM wrapper pattern from `ai.ts`:

```typescript
const generateBlogContent = async (params: {
  orgId: string;
  prompt: string;
  maxTokens: number; // default 4096 for blog-length content
}): Promise<{ text: string; model: string; tokens: { prompt: number; completion: number } }> => {
  // 1. Try Claude (env.anthropicModel)
  const result = await callAnthropicWithUsage(params.prompt, params.maxTokens, { orgId: params.orgId });

  if (result.text && !isAnthropicCreditExhaustedError(result)) {
    return { text: result.text, model: "claude", tokens: { ... } };
  }

  // 2. Fallback to GPT-4o-mini
  const fallback = await callOpenAiWithUsage(params.prompt, params.maxTokens, { orgId: params.orgId });
  return { text: fallback.text, model: "gpt-4o-mini", tokens: { ... } };
};
```

Note: The existing `callAnthropicWithUsage` and `callOpenAiCampaignChainWithUsage` functions in `ai.ts` should be extracted to a shared LLM client module to avoid duplication. This is a prerequisite refactor.

### 4.4 Streaming consideration

For blog-length content (1500-3000 chars), generation can take 10-20 seconds. Streaming the response to the frontend via the existing chat message projection would improve perceived speed. However, streaming adds complexity to the skill result contract.

**Decision for 7-1a**: Non-streaming first. Return complete text. Add streaming in a follow-up phase if latency is unacceptable.

---

## 5) Persistence

### 5.1 Contents table write

After successful generation:

```typescript
const { data: content } = await supabaseAdmin
  .from("contents")
  .insert({
    org_id: orgId,
    channel: "naver_blog",
    content_type: "text",
    status: "draft",          // Naver blog has no auto-publish → stays draft
    body: generatedText,
    metadata: {
      generation_model: modelUsed,
      generation_tokens: { prompt: promptTokens, completion: completionTokens },
      topic: topic,
      source: isOnDemand ? "ondemand" : "campaign",
      campaign_id: campaignId ?? null,
      hashtags: extractedHashtags,
    },
    scheduled_at: slot.scheduled_date,
    created_by: "ai",
  })
  .select("id")
  .single();
```

### 5.2 Schedule slot linking

```typescript
await supabaseAdmin
  .from("schedule_slots")
  .update({
    content_id: content.id,
    slot_status: "draft",     // "generating" → "draft" (content ready for review)
    updated_at: new Date().toISOString(),
  })
  .eq("id", slotId)
  .eq("lock_version", currentLockVersion); // optimistic concurrency
```

Status transition: `scheduled` → `generating` → `draft`.

### 5.3 On-demand slot creation (Route B)

```typescript
const { data: slot } = await supabaseAdmin
  .from("schedule_slots")
  .insert({
    org_id: orgId,
    session_id: sessionId,
    campaign_id: null,        // no campaign association
    channel: "naver_blog",
    content_type: "text",
    title: extractedTopic,
    scheduled_date: new Date().toISOString().split("T")[0], // today
    slot_status: "generating",
    metadata: {
      source: "ondemand",
      requested_at: new Date().toISOString(),
    },
  })
  .select("id, lock_version")
  .single();
```

---

## 6) Local File Save

### 6.1 Folder structure

Generated blog content is saved as a markdown file in the user's watch folder:

```
{watch_root}/
  contents/
    {campaign_title}/                          ← Campaign-scheduled (Route A)
      {YYYY-MM-DD}_naver-blog_{slug}.md
    ondemand/                                  ← On-demand (Route B)
      {YYYY-MM-DD}_naver-blog_{slug}.md
```

Examples:
```
활동폴더/contents/봄맞이_캠페인/2026-03-10_naver-blog_봄나들이코스.md
활동폴더/contents/ondemand/2026-03-05_naver-blog_신메뉴소개.md
```

### 6.2 IPC handler

File: `apps/desktop/electron/main.mjs` (modify)

New IPC handler:

```javascript
ipcMain.handle("content:save-local", async (_, payload) => {
  // payload: { relativePath, fileName, body, encoding }
  const watchPath = getDesktopConfig().watch_path;
  if (!watchPath) return { ok: false, error: "no_watch_path" };

  const targetDir = path.join(watchPath, payload.relativePath);
  await fs.mkdir(targetDir, { recursive: true });

  const filePath = path.join(targetDir, payload.fileName);
  await fs.writeFile(filePath, payload.body, payload.encoding ?? "utf8");

  return { ok: true, filePath };
});
```

File: `apps/desktop/electron/preload.mjs` / `preload.cjs` (modify)

```javascript
content: {
  saveLocal: (payload) => ipcRenderer.invoke("content:save-local", payload),
}
```

### 6.3 Save trigger

After content is persisted to DB, the API response includes the content body. The desktop renderer calls `content.saveLocal()` to write the file locally. This is fire-and-forget — local file save failure does not block the generation flow.

---

## 7) Skill Result Contract

The skill returns a `SkillResult` consistent with the existing contract:

```typescript
// On successful generation
return {
  handled: true,
  outcome: "no_transition", // session stays active for further interaction
  statePatch: {
    last_generated_content_id: content.id,
    last_generated_slot_id: slot.id,
  },
  chatReply: `네이버 블로그 글이 생성되었습니다.\n\n**${topic}**\n\n에디터에서 확인하고 복사해주세요.`,
};

// On generation failure
return {
  handled: true,
  outcome: "no_transition",
  statePatch: {},
  chatReply: "블로그 글 생성 중 오류가 발생했습니다. 다시 시도해주세요.",
};
```

---

## 8) LLM Client Refactor (Prerequisite)

The existing `callAnthropicWithUsage` and `callOpenAiCampaignChainWithUsage` in `ai.ts` are campaign-plan-specific in naming but generic in function. Before 7-1a implementation:

1. Extract to `apps/api/src/orchestrator/llm-client.ts` (new shared module).
2. Rename to `callAnthropic()` and `callOpenAi()`.
3. Add `callWithFallback()` wrapper: Claude → GPT-4o-mini automatic fallback.
4. Update `ai.ts` campaign chain to import from shared module.
5. `naverblog-generation` skill imports from the same shared module.

This prevents duplicating ~200 lines of LLM call/cache/retry logic.

---

## 9) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/orchestrator/llm-client.ts` | Create | Shared LLM call wrapper (extracted from ai.ts) |
| `apps/api/src/orchestrator/ai.ts` | Modify | Import LLM calls from shared module |
| `apps/api/src/orchestrator/skills/naverblog-generation/index.ts` | Create | Skill definition + execute entry point |
| `apps/api/src/orchestrator/skills/naverblog-generation/intent.ts` | Create | Intent matching keywords/logic |
| `apps/api/src/orchestrator/skills/naverblog-generation/context.ts` | Create | RAG context assembly for blog generation |
| `apps/api/src/orchestrator/skills/naverblog-generation/prompt.ts` | Create | System prompt template |
| `apps/api/src/orchestrator/skills/naverblog-generation/generate.ts` | Create | LLM invocation + content persistence |
| `apps/api/src/orchestrator/skills/router.ts` | Modify | Register `naverblog_generation` skill |
| `apps/desktop/electron/main.mjs` | Modify | Add `content:save-local` IPC handler |
| `apps/desktop/electron/preload.mjs` | Modify | Expose `content.saveLocal()` |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |
| `apps/desktop/src/global.d.ts` | Modify | Update `DesktopRuntime` type |

---

## 10) Acceptance Criteria

1. User can request "네이버 블로그 글 써줘" in chat → skill activates with confidence >= 0.88.
2. Blog content is generated using RAG context + brand profile + system prompt.
3. Claude is primary LLM; on credit exhaustion, falls back to GPT-4o-mini transparently.
4. Generated content is saved to `contents` table with `channel: "naver_blog"`, `status: "draft"`.
5. A `schedule_slots` row is created (on-demand) or updated (campaign) with `content_id` linked.
6. Slot status transitions: `scheduled` → `generating` → `draft`.
7. Generated markdown file is saved to user's local watch folder.
8. Campaign-scheduled generation uses campaign plan topic/theme context.
9. On-demand generation creates slot with `metadata.source: "ondemand"`.
10. LLM client module is shared between campaign-plan and naverblog-generation skills.

---

## 11) Verification Plan

1. `pnpm --filter @repo/api type-check` — pass
2. `pnpm --filter desktop type-check` — pass
3. `pnpm --filter @repo/api test:unit` — new tests for intent matching, context assembly, content persistence
4. Manual: send "네이버 블로그 글 써줘" in chat → verify skill activates, content generated, saved to DB
5. Manual: verify local file created in watch folder with correct path
6. Manual: verify schedule_slots row created with correct status and content_id link
7. Manual: verify Claude → GPT-4o-mini fallback by temporarily disabling Anthropic key

---

## 12) Decisions

**Why skill-based approach:**
Reuses the existing skill router (Phase 5-0) pattern. Intent matching ensures blog generation requests are routed correctly without interfering with campaign planning skill.

**Why on-demand also creates slots:**
Unified scheduler view — all generated content appears on the board regardless of origin. `metadata.source` distinguishes campaign vs on-demand.

**Why non-streaming first:**
Streaming adds complexity to the skill result contract and chat projection. Blog generation latency (~10-20s) is acceptable for v1 with a loading indicator.

**Why local file save via IPC:**
Keeps the file write in the Electron main process (has filesystem access). Renderer triggers save after API response. Failure is non-blocking.

---

## 13) Hardening Patch (2026-03-05)

The following 5 hardening items are mandatory for implementation in 7-1a:

1. **Encoding correctness (Korean keywords/prompt text)**
   - Intent keywords, prompt templates, and user-visible replies must be stored and reviewed as UTF-8.
   - Add unit tests that verify representative Korean trigger phrases route to `naverblog_generation`.

2. **Atomic persistence for content + slot link**
   - Prevent partial success where `contents` insert succeeds but `schedule_slots` link fails.
   - Implement either:
     - single DB transaction (preferred), or
     - compensating rollback (delete inserted content on slot link failure).
   - Include optimistic concurrency check using `lock_version` when updating the slot row.

3. **Fallback policy broadening**
   - Fallback to GPT-4o-mini is not limited to credit exhaustion.
   - Also fallback on retryable/transient Anthropic failures:
     - HTTP 5xx,
     - timeout/network request errors,
     - HTTP 429 rate-limit.
   - Keep non-retryable request validation errors visible in logs.

4. **Electron IPC path traversal defense**
   - `content:save-local` must reject path-escape attempts:
     - `..` segments,
     - absolute paths,
     - reserved/unsafe file names.
   - Resolve and compare final target path against normalized watch root before writing.

5. **On-demand idempotency**
   - Avoid duplicate slot/content creation on retried requests.
   - Use event idempotency key in slot metadata and check existing `ondemand` slot before insert.
   - If already processed, return existing content/slot reference instead of creating new rows.
