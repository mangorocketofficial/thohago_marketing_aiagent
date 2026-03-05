# Phase 7-1b Patch Completion Report

- Phase: 7-1b Patch
- Title: Skill Trigger Guardrails + Golden Contracts
- Status: Done
- Completed On: 2026-03-05

## Summary

- Explicit skill 선택이 있어도 즉시 강제 실행하지 않고 LLM 맥락 판단으로 진입하도록 변경했다.
- 주제 없는 네이버 블로그 생성 요청은 생성 대신 주제 확인 질문으로 전환했다.
- 7-1b 골든 스냅샷을 추가해 save-body 파서와 라우팅 가드레일 계약을 고정했다.

## API Behavior Update

- `routeSkill`은 active skill/lock이 없으면 `skill_trigger`를 즉시 route 하지 않는다.
- LLM 라우팅은 `preferred_skill_hint`를 받아 선택 스킬을 우선 후보로 보되, 실행 가능성이 낮으면 `none`을 반환한다.
- `naverblog_generation`은 topic 추출 실패 시 content/slot 생성을 수행하지 않고 clarification 응답만 남긴다.

## UX Flow Update

- "네이버 블로그 글 작성해줘" 같은 일반 문구는 초안 생성 대신 "어떤 주제로 작성할까요?"를 응답한다.
- 사용자가 주제를 추가로 답하면 그 시점에 skill 생성 경로로 진입한다.
- 잘못된 즉시 생성으로 인한 주제 오염 가능성을 줄였다.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed.
- `phase-7-1b-golden`, `phase-7-1b-skill-routing` 신규 테스트 포함 52/52 통과했다.

## Follow-up

- 7-2a: generation 계열 skill 전반에 topic/actionability 기준 프롬프트를 공통화한다.
- 7-2a: chat-to-skill clarification 메시지 템플릿을 중앙화해 채널별 일관성을 높인다.
- explicit trigger + low-context 조합을 E2E 테스트로 고정한다.

### Decisions

[D-007]

Why this approach:
Explicit trigger를 강제 실행 신호가 아니라 "선호 힌트"로 다뤄야 사용자 문맥과 입력 충족도를 기준으로 안전하게 skill 실행을 제어할 수 있다.

Alternatives considered:
- `skill_trigger` 즉시 실행 유지 - 주제 없는 요청에서도 잘못된 생성이 발생해 탈락.
- 규칙 기반 키워드만으로 실행 결정 - 문맥 예외를 커버하지 못해 탈락.

Blockers hit:
- 기존 라우터가 explicit trigger를 LLM 판단 이전에 소비해 가드레일이 작동하지 않았고, 라우터 defer + preferred hint + mismatch 차단으로 해소했다.

Tech debt introduced:
- DEBT-007 topic clarification 문구가 service fallback과 skill handler에 중복 선언되어 있음 -> affects Phase 7-2a.
