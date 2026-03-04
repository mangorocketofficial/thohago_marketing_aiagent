Campaign Planning Conversation Flow Redesign (v2)

## Context

현재 캠페인 플래닝 스킬은 "캠페인 만들어줘" 한 마디에 4-step chain을 즉시 실행하고, 결과를 inbox에 넣어 승인/거절을 기다리는 구조이다. 이는 근본적으로 나쁜 UX이다:

- 사전 인터뷰/서베이 없이 풀 플랜을 생성
- 대화로 다듬어야 할 플랜을 승인 큐에 밀어넣음
- 캠페인 플래닝은 협업 대화를 통해 완성해야 하며, 승인 큐가 아님

**Goal:** survey → draft → 대화형 정제 → 확정 → DB 저장 전체를 단일 채팅 세션 내에서 완료. 멀티세션 pause/resume 지원.

---

## Design Principles

1. **Adaptive Survey** — 고정 질문 리스트가 아닌, 유저의 최초 메시지에서 이미 파악된 정보를 추출하고 부족한 것만 질문
2. **Early Exit** — 필수 질문만 답하면 선택 질문은 auto-fill로 넘어갈 수 있음 ("이 정도면 됐어" → chain 실행)
3. **Skill-local State** — survey/draft 상태는 `SessionState.campaign_survey` 안에서 관리. `SkillOutcome`에 skill-specific 값을 추가하지 않음
4. **Explicit Confirmation** — AI가 "이 계획을 최종 승인하여 캠페인으로 진행하시겠습니까?"라고 명시적으로 묻고, 그에 대한 긍정 응답만 confirm으로 처리

---

## New State Machine

```
await_user_input  (intent detected: "plan a campaign")
       |
  survey_active   (AI asks questions, user answers — adaptive, 1~4 turns)
       |  ← user says "진행해" with required questions answered: skip remaining
  draft_review    (chain runs → plan draft presented in chat)
       |  ← on revision request: re-run chain, stay in draft_review
       |  ← AI asks: "이 계획을 최종 승인하여 캠페인으로 진행하시겠습니까?"
       |  ← user confirms → save to DB, transition to done
      done
```

### Relationship to Existing States

| Existing | New | Notes |
|----------|-----|-------|
| `await_user_input` | Keep | Entry point |
| `await_campaign_approval` | Remove | DB migration으로 기존 세션 정리 후 제거 |
| `generate_content` | Keep (future) | Out of scope |
| — | `survey_active` | New (skill-local) |
| — | `draft_review` | New (skill-local) |

**`plan_finalized` 상태 제거:** confirm 시 `draft_review`에서 DB 저장 + 바로 `done`으로 전환. 중간 상태 불필요.

---

## 1. Type Changes

### `apps/api/src/orchestrator/types.ts`

```typescript
// OrchestratorStep — 추가 없음!
// survey_active, draft_review는 skill-local state로 관리

// SessionState에 추가
campaign_survey: CampaignSurveyState | null;
campaign_draft_version: number;
```

### New type definitions (same file or dedicated types file)

```typescript
export type SurveyQuestionId =
  | "campaign_goal"
  | "channels"
  | "duration"
  | "content_source";

export type SurveyQuestionPriority = "required" | "optional";

export type SurveyQuestion = {
  id: SurveyQuestionId;
  priority: SurveyQuestionPriority;
  label: string;                    // AI가 질문할 때 사용하는 한국어 문구
  choices?: string[];               // 선택지 (없으면 자유 입력)
  auto_fill_source?: string;        // RAG에서 자동 채울 수 있는 소스 키
};

export type SurveyAnswer = {
  question_id: SurveyQuestionId;
  answer: string;
  source: "user" | "auto_filled" | "extracted_from_initial_message";
  answered_at: string;
};

export type CampaignSurveyState = {
  started_at: string;
  phase: "survey_active" | "draft_review";   // skill-local phase
  pending_questions: SurveyQuestionId[];     // 아직 답변되지 않은 질문 목록
  answers: SurveyAnswer[];
  auto_fill_applied: boolean;
  completed_at: string | null;
};
```

### `apps/api/src/orchestrator/skills/types.ts`

```typescript
// SkillOutcome — skill-specific 값 추가하지 않음
// 기존 값만 사용:
//   "no_transition"    → survey/draft 진행 중 (skill-local state로 분기)
//   "session_done"     → plan 확정 완료
//   "session_failed"   → 에러
```

**SkillOutcome 변경 없음.** skill 내부 phase는 `state.campaign_survey.phase`로 관리.

---

## 2. Survey Module (New File)

### `apps/api/src/orchestrator/skills/campaign-plan/survey.ts`

#### Core Survey Questions (4개)

| # | ID | Question | Priority | Choices | Auto-fill Source |
|---|-----|----------|----------|---------|-----------------|
| 1 | `campaign_goal` | 캠페인의 목적과 목표는 무엇인가요? | required | Awareness / Engagement / Conversion / Other | — |
| 2 | `channels` | 어떤 채널에서 진행하시겠어요? | required | Instagram / Blog / Facebook / Threads / etc. | Brand review |
| 3 | `duration` | 캠페인 진행 기간은 어떻게 되나요? | optional | 1주 / 2주 / 1개월 / 직접 입력 | — |
| 4 | `content_source` | 활용할 컨텐츠 소스가 있나요? (기존 사진/영상/문서 등) | optional | 있음 / 없음 / 일부 있음 | Folder summary |

#### Adaptive Logic

1. **Initial Message Extraction:** 유저의 첫 메시지를 LLM으로 파싱하여 이미 답변된 정보 추출
   - "인스타 인지도 캠페인 만들어줘" → `campaign_goal: "awareness"`, `channels: ["instagram"]` 자동 추출
   - 추출된 답변은 `source: "extracted_from_initial_message"`로 기록
2. **Auto-fill from RAG:** `buildEnrichedCampaignContext()`에서 채울 수 있는 항목은 제안
   - "기존 설정 기반: X. 이대로 진행할까요, 변경하시겠어요?"
   - 유저 확인 → skip; 유저가 새 입력 → override
3. **Early Exit:** required 질문이 모두 답변되면, 나머지 optional은 스킵 가능
   - AI: "추가로 진행 기간이나 컨텐츠 소스에 대해 알려주실 내용이 있으시면 말씀해주세요. 아니면 '진행해'라고 해주시면 바로 계획을 세워드릴게요."
   - 유저: "진행해" → optional은 auto-fill 또는 AI 판단으로 채움

#### Key Functions

```typescript
SURVEY_QUESTIONS: SurveyQuestion[]                           // 4개 질문 상수
extractAnswersFromInitialMessage(message: string, ragContext): Promise<SurveyAnswer[]>
                                                              // LLM으로 첫 메시지 파싱
buildPendingQuestions(allQuestions, extractedAnswers): SurveyQuestionId[]
                                                              // 아직 답 안 된 질문 필터
buildSurveyPrompt(pendingQuestions, autoFillData, answeredSoFar): string
                                                              // 다음 질문 메시지 생성
parseSurveyAnswer(userMessage, pendingQuestions): Promise<SurveyAnswer[]>
                                                              // 유저 응답 파싱 (복수 답변 가능)
isSurveyComplete(state): boolean                              // required 모두 답변 + (optional 답변 or early exit)
canEarlyExit(state): boolean                                  // required만 답변된 상태 체크
buildChainInputFromSurvey(answers, ragContext): ChainInput    // survey 답변 → chain input 변환
```

---

## 3. Step Handlers (New File)

### `apps/api/src/orchestrator/steps/campaign-survey.ts`

#### `handleSurveyStart(context)`

1. Load brand data via `buildEnrichedCampaignContext()`
2. Extract answers from user's initial message via `extractAnswersFromInitialMessage()`
3. Build `pending_questions` from remaining unanswered questions
4. If all required answered from initial message → skip survey, run chain immediately → go to `draft_review`
5. Otherwise: send first pending question as chat message
6. Return: `outcome: "no_transition"`, `statePatch: { campaign_survey: { phase: "survey_active", ... } }`

#### `handleSurveyAnswer(context)`

1. Read `state.campaign_survey.phase` — must be `"survey_active"`
2. Parse user response → append to answers, remove from `pending_questions`
3. Check for early exit intent ("진행해", "이 정도면 됐어", "바로 만들어줘")
   - If early exit + `canEarlyExit(state)` → auto-fill remaining → run chain
4. If questions remain → send next question, `outcome: "no_transition"`
5. If survey complete → run chain → present plan draft as chat message
   - Reuse `assembleCampaignPlanDocument()` (assembler.ts)
   - Insert with `messageType: "text"` (not `action_card`)
   - Follow-up: "계획을 검토해주세요. 수정할 부분이 있으면 말씀해주세요."
6. Return: `outcome: "no_transition"`, `statePatch: { campaign_survey: { phase: "draft_review", ...completed }, campaign_plan, campaign_draft_version: 1 }`

#### `handleDraftReviewMessage(context)`

1. Read `state.campaign_survey.phase` — must be `"draft_review"`
2. Classify user message:
   - **Revision intent** (reuse existing `isCampaignRevisionIntent`): → partial chain re-run, present updated draft, increment `campaign_draft_version`, `outcome: "no_transition"`
   - **Satisfaction signal** ("괜찮아", "좋아", "마음에 들어" 등 — 확정은 아님):
     → AI 응답: **"이 계획을 최종 승인하여 캠페인으로 진행하시겠습니까?"**
     → `outcome: "no_transition"` (confirmation prompt 대기)
   - **Explicit confirm** (위 확인 질문에 대한 긍정 응답: "네", "승인", "진행해주세요"):
     → `handlePlanFinalization()`
   - **Question / discussion** (anything else): → `generateGeneralAssistantReply()` with campaign context, `outcome: "no_transition"`

#### `handlePlanFinalization(context)`

1. INSERT into `campaigns` table (status: `"approved"` — 채팅에서 이미 확인됨)
2. Send confirmation message: "캠페인 계획이 확정되었습니다! 다음 단계를 안내드리겠습니다."
3. **Do NOT create `workflow_items`** (inbox 사용 안 함)
4. Return: `outcome: "session_done"` → session transitions to `done`

---

## 4. Skill Routing Changes

### `apps/api/src/orchestrator/skills/campaign-plan/index.ts`

`execute()` 내 `user_message` 분기 재구성:

```typescript
case "user_message": {
  const step = context.session.current_step;
  const surveyPhase = context.state.campaign_survey?.phase ?? null;

  // New: entry → start survey (adaptive)
  if (step === "await_user_input") {
    return handleSurveyStart(context);
  }

  // New: skill-local phase routing
  if (surveyPhase === "survey_active") {
    return handleSurveyAnswer(context);
  }

  if (surveyPhase === "draft_review") {
    return handleDraftReviewMessage(context);
  }

  // Legacy fallback (await_content_approval)
  if (step === "await_content_approval") {
    return handleGeneralMessageDuringApproval(context);
  }
}
```

**`campaign_approved` / `campaign_rejected` handlers:** 완전 제거. 기존 `await_campaign_approval` 세션은 DB migration으로 정리.

---

## 5. Service Layer Changes

### `apps/api/src/orchestrator/service.ts`

- `resolveTransitionFromSkillOutcome()`: **변경 없음.** `"no_transition"`, `"session_done"` 기존 매핑 그대로 사용.
  - `"no_transition"` → step 유지, `status: "paused"` (기존 동작)
  - `"session_done"` → `step: "done"`, `status: "done"` (기존 동작)
- `parseState()`: `campaign_survey` (default `null`), `campaign_draft_version` (default `0`) 초기값 처리 추가.

---

## 6. `campaign_draft_version` 활용

- 세션 state에 `campaign_draft_version: number` 저장 (초기값 0, chain 실행 시 1, revision마다 +1)
- **프론트엔드 표시 용도:** 채팅 세션 UI에서 현재 플랜 버전을 보여줌
  - 예: "📋 캠페인 계획 v2" (revision 1회 후)
  - draft_review 중 AI 메시지에 버전 표시: "수정된 계획입니다 (v2). 검토해주세요."
- chat_message metadata에 `{ draft_version: number }` 포함하여 프론트엔드에서 버전별 필터/비교 가능

---

## 7. Reused Existing Code

| Module | File | How Reused |
|--------|------|-----------|
| 4-Step Chain | `chain.ts`, `chain-steps.ts` | survey 완료 후 실행 + revision 시 재실행 |
| Assembler | `assembler.ts` | plan document markdown 생성 |
| RAG Context | `rag-context.ts` | survey auto-fill + chain context |
| Intent Detection | `index.ts` — `isCampaignRevisionIntent`, `inferCampaignRerunStep` | draft_review 중 revision intent 감지 |
| Chat Insert | `chat-projection.ts` — `insertChatMessage` | 모든 메시지 삽입 |
| General Reply | `ai.ts` — `generateGeneralAssistantReply` | draft_review 중 일반 질문 응답 |

---

## 8. Untouched Code

- `chain.ts`, `chain-types.ts`, `chain-steps.ts` — 변경 없음
- `assembler.ts` — 변경 없음
- `rag-context.ts` — 변경 없음
- `steps/content.ts` — out of scope

---

## 9. Removed Code (Breaking Changes)

- `await_campaign_approval` step: orchestrator에서 완전 제거
- `campaign_approved` / `campaign_rejected` event handling: skill에서 제거
- `steps/campaign.ts`의 `applyCampaignApprovedStep`, `applyCampaignRejectStep`, `applyCampaignRevisionStep`, `applyCampaignTerminalRejectStep`: 제거
- **사전 조건:** production DB에서 `current_step = 'await_campaign_approval'`인 세션이 없음을 확인, 또는 migration으로 정리

---

## 10. Multi-Session Support

기존 메커니즘으로 충분. 추가 인프라 불필요:

- `SessionState.campaign_survey` → `pending_questions` + `answers` + `phase` 보존
- Session `status: "paused"` → 유저 재진입 시 `resumeSession()`
- `routeSkill()` → `active_skill = "campaign_plan"` → 같은 skill로 라우팅
- skill 내부에서 `campaign_survey.phase`로 분기 → 이전 진행 지점에서 재개

---

## 11. Implementation Order

| Phase | Task | Files |
|-------|------|-------|
| 1 | Type 추가 (CampaignSurveyState, SurveyQuestion 등) | `types.ts` |
| 2 | Survey module 생성 | `skills/campaign-plan/survey.ts` (new) |
| 3 | Step handlers 생성 | `steps/campaign-survey.ts` (new) |
| 4 | Skill routing 재구성 | `skills/campaign-plan/index.ts` |
| 5 | Service layer 업데이트 | `service.ts` |
| 6 | Legacy 코드 제거 | `steps/campaign.ts`, `types.ts`, skill event handlers |
| 7 | Tests | New test file |

---

## 12. Verification

| Test Case | Verification |
|-----------|-------------|
| **Adaptive survey** | "인스타 인지도 캠페인" → goal/channel 자동 추출 → 나머지만 질문 |
| **Early exit** | required 2개 답변 후 "진행해" → optional auto-fill → chain 실행 |
| **Full survey** | 4개 질문 모두 답변 → chain 실행 → draft 표시 |
| **Multi-session** | 3번째 질문에서 나감 → 재진입 → 이전 답변 유지, 다음 질문부터 재개 |
| **Revision loop** | draft 후 "채널 전략 바꿔줘" → step_b 재실행 → 업데이트된 draft (v2) 표시 |
| **Explicit confirmation** | "좋아" → AI: "최종 승인하시겠습니까?" → "네" → campaigns 테이블 approved, session done |
| **No inbox** | 새 세션에서 workflow_items 생성 안 됨 |
| **Version display** | revision 후 chat message metadata에 `draft_version: 2` 포함 |

---

## Implementation Addendum (Applied Before Coding)

To align design and implementation safety, the following are explicitly applied:

1. **DB step constraint migration first**
   - `orchestrator_sessions.current_step` check constraint removes `await_campaign_approval`.
   - Legacy rows in `await_campaign_approval` are migrated to `await_user_input` before constraint update.

2. **Shared type / desktop event route alignment**
   - Session resume API no longer accepts campaign approval/rejection events for new 5-5 flow.
   - Desktop dispatch path is aligned to avoid sending deprecated campaign approval events.

3. **Chain data persistence strategy**
   - Session state persists `campaign_chain_data` and `campaign_plan_document` during draft/revision.
   - Draft revision reruns use state-stored chain data instead of reading a pre-finalized campaign row.

---

## 13. Completion Report (2026-03-04)

### 13.1 Implemented Scope (Done)

- 5-5 conversation-first campaign planning flow is implemented end-to-end:
  - `await_user_input -> survey_active -> draft_review -> done`
- Campaign planning no longer depends on inbox approval cards:
  - no `campaign_approved/campaign_rejected` resume event path in the new flow
  - finalization happens in chat, then DB save, then session close (`done`)
- Skill-local survey/draft state is persisted in `SessionState`:
  - `campaign_survey`, `campaign_draft_version`, `campaign_chain_data`, `campaign_plan_document`
- DB constraint migration for step cleanup is applied:
  - removed `await_campaign_approval` from allowed `current_step`
  - legacy rows are migrated before constraint replacement

### 13.2 This Session Updates (Critical Fixes)

- Fixed root issue where final approval phrases were missed and fell back to generic reply.
- Added LLM-based contextual intent classification for `draft_review`:
  - new classifier in `apps/api/src/orchestrator/ai.ts`
  - intents: `revision | satisfaction | confirm | discussion`
  - low-confidence/parse-fail falls back to existing deterministic rules
- Updated `handleDraftReviewMessage` to use:
  - LLM intent (primary) + keyword intent (fallback)
  - and preserve explicit final-confirmation gate behavior
- Expanded fallback lexicon to reduce false misses:
  - examples: `좋다`, `좋아요`, `좋습니다`, `최종승인`, `승인할게`, `확정할게`
- Added regression test:
  - `apps/api/tests/phase-5-5-campaign-intent.test.ts`

### 13.3 Desktop Reliability Updates Included

- `chat:send-message` idempotency key changed to per-send unique key
  - prevents identical-text user prompts from being silently treated as already processed
- Session selector now avoids auto-selecting closed sessions (`done/failed`)
- Chat send is blocked when selected session is closed, with explicit notice to user

### 13.4 Verification Completed

- Type checks:
  - `pnpm --filter @repo/types type-check`
  - `pnpm --filter @repo/api type-check`
  - `pnpm --filter @repo/desktop type-check`
- Unit tests:
  - `pnpm --filter @repo/api test:unit` (pass)
- Integration smoke:
  - `node scripts/smoke-phase-5-5.mjs` (pass)
- Manual runtime validation:
  - `좋다!` -> final confirmation question
  - `최종승인할게` -> `session.status=done`, `campaigns.status=approved`

### 13.5 Operational Notes

- Draft-review intent classification uses OpenAI (`gpt-4o-mini`) when available.
- If model call fails or confidence is low, deterministic rule fallback is used.
- Explicit two-step confirmation policy remains:
  - satisfaction signal -> confirmation prompt
  - confirmation intent -> finalize and close session
