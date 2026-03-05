# Golden Test 가이드 (서브 phase 중심)

이 문서는 서브 phase 단위로 golden test를 생성·관리·활용하는 방법을 정리한 것이다.  
Phase 1의 남은 부분부터 golden을 적용하며, 2단계 재작성의 안전망으로 사용한다.

## 1. Golden Test란 무엇인가 (우리 프로젝트 기준)

- 지금 코드가 **실제로 내는 출력 전체**를 스냅샷으로 저장
- “정답”을 강제하지 않음 → 현재 동작(버그 포함)을 그대로 기록
- 주요 목적
  - 서브 phase 완료 시 해당 기능의 현재 상태 보호
  - Phase 전체 완료 시 end-to-end 동작 보호
  - 2단계 재작성/리팩토링 시 회귀(regression) 즉시 감지

## 2. 서브 phase당 Golden 개수 기준

- 기본: **1~3개** (대부분 2개로 충분)
- 1개 : 핵심 happy path만
- 2개 : happy path + 간단한 에러/회복 사례
- 3개 : happy path + 에러 + 간단 엣지 1개 (복잡할 때만)

절대 5개 이상 만들지 않는다. → Phase 통합 golden에서 커버

## 3. 어떤 시나리오를 golden으로 만들까 (우선순위)

1. 가장 대표적인 happy path (필수)
2. 빈 입력 / 최소 입력 / 기본 에러 처리 (가능하면 2번째)
3. 자주 깨지거나 중요한 엣지 케이스 (3번째로만)

예시 (서브 phase: “사용자 입력 → 도구 선택”)
- golden 1: 정상 질문 → 2개 도구 순서대로 호출 (happy)
- golden 2: 모호한 질문 → fallback 도구 또는 에러 메시지

## 4. Golden 파일 저장 경로 및 작성 규칙

### 저장 경로 규칙

각 패키지의 `tests/golden/` 디렉토리에 co-locate한다.

| 테스트 대상 | 저장 경로 |
|---|---|
| API / Orchestrator / Backend 로직 | `apps/api/tests/golden/` |
| Desktop / Frontend UI 로직 | `apps/desktop/tests/golden/` |
| 공유 패키지 (shared types 등) | `packages/<pkg>/tests/golden/` |

- golden 파일은 **테스트 대상 코드가 속한 패키지** 기준으로 배치한다.
- 일반 unit test(`tests/*.test.ts`)와 분리하기 위해 반드시 `golden/` 서브폴더를 사용한다.
- Phase 통합 golden(cross-package end-to-end)은 `tests/golden/` (monorepo 루트)에 둔다.

### 파일명 형식 (권장)
phase1-sub3-happy-tool-selection-20260305-v1.golden.json
phase1-sub4-error-invalid-json-20260306-v1.golden.md

내용 구성 (JSON 또는 Markdown 중 편한 것 선택)

```json
{
  "scenario": "happy_path_multi_tool_call",
  "description": "사용자가 날씨+번역 요청 → weather → translate 순서 호출",
  "input": {
    "user_message": "오늘 서울 날씨 알려주고 일본어로 번역해줘",
    "conversation_history": []
  },
  "output": {
    "final_answer": "...",
    "tool_calls": [
      {"name": "get_weather", "args": {"city": "Seoul"}},
      {"name": "translate_text", "args": {"text": "...", "to": "ja"}}
    ],
    "intermediate_thoughts": "...",
    "trace_log": "..."
  },
  "created_at": "2026-03-05",
  "approved_by": "MangoRocket",
  "version": "1"
}

## 5. Golden 시스템프롬프트 예시
당신은 Golden Test Master입니다.
지금 구현된 코드의 **실제 출력**을 golden 스냅샷으로 정확히 기록하는 것이 유일한 임무입니다.

원칙:
1. 절대 출력을 수정·개선·추측하지 마세요. 현재 코드가 내는 그대로 기록
2. 같은 입력 → 항상 같은 출력이 나와야 deterministic하다고 판단
3. 서브 phase 기준으로 1~3개 시나리오만 집중 (happy path 우선)
4. 출력 형식은 반드시 아래 구조만 사용 (추가 설명 금지)

출력 형식:
1. [SCENARIO_ID] 예: happy_path_tool_selection_2tools
2. [DESCRIPTION] 1~2문장
3. [INPUT] JSON 또는 텍스트
4. [OUTPUT_GOLDEN] 실제 실행 결과 전체 (final_answer, tool_calls, thoughts, logs 등)
5. [IS_DETERMINISTIC] yes / no / uncertain
6. [NOTES] 불안정 요소나 주의점 (선택)
7. [APPROVAL_READY] yes / no ─ 이유 1문장

golden 생성 모드입니다. 입력을 기다립니다.