# Phase Session Design

- Date: 2026-03-03
- Scope: Chat session model redesign before Phase 5-1 (Folder-as-Project)
- Status: Draft for implementation

## 1) 배경과 현재 상태

현재 채팅 흐름은 아래 구조로 동작한다.

`User -> Desktop Chat UI -> Electron IPC -> API Orchestrator Service -> DB (+ optional AI call)`

핵심 구현 사실:

- `Agent Chat` 페이지와 mini chat 위젯은 같은 `ChatProvider`와 같은 active session을 공유한다.
- 서버/DB는 org 기준 active session 1개만 허용한다.
- 채팅 메시지 조회는 실질적으로 org 단위이며, session 단위 분리가 약하다.

이 구조는 구현 단순성은 높지만, 실제 UX(작업별 mini chat 사용)와 충돌한다.

## 2) 문제 정의

1. 사용자 기대와 시스템 모델 불일치
- UI는 작업별 대화를 유도하지만, 내부는 org 단일 세션이다.

2. 맥락 혼합
- 캠페인 기획/콘텐츠 제작/기타 상담 맥락이 하나의 타임라인에 섞인다.

3. 세션 가시성 부족
- 사용자는 지금 어느 세션에서 대화 중인지, 이전 작업 세션으로 어떻게 돌아가는지 직관적으로 알기 어렵다.

4. Phase 5-1 선행 조건 미충족
- 폴더 기반 세션 재개/갱신을 안정적으로 하려면 먼저 멀티세션 기반이 필요하다.

## 3) 설계 목표

1. org 내 다중 세션 허용
2. "같은 작업이면 기존 세션 재개" 가능
3. 사용자가 원하면 같은 작업에서도 새 세션 생성 가능
4. 페이지 이동 시 자동 세션 전환 금지 (추천만)
5. 모든 mini chat이 같은 세션 풀을 공유
6. Agent Chat의 역할을 "세션 관리 가능한 채팅 허브"로 명확화

## 4) 비목표 (Out of Scope)

1. 다중 사용자 협업 정책(동시 편집/락 충돌 정책의 완전한 재설계)
2. 텔레그램 채널 UX 동시 개편
3. AI 프롬프트/체인 품질 개선 자체

## 5) 핵심 결정사항

### 5.1 세션 선택 모델

- `selectedSessionId`를 사용자 기준 현재 선택 세션으로 둔다.
- 모든 mini chat과 Agent Chat은 동일한 `selectedSessionId`를 공유한다.
- 페이지 이동만으로 세션을 바꾸지 않는다.

### 5.2 작업 재개 모델

- 작업 식별 키를 사용한다: `workspace_key = workspace_type + ":" + scope_id`
- 예시:
  - `campaign_plan:campaign_<id>`
  - `content_create:content_<id>`
  - `folder:<activity_folder>`
  - `general:default`
- 페이지 진입 시 `workspace_key` 기준 "추천 세션"을 계산해 제안만 한다.

### 5.3 새 세션 생성 정책

- 사용자가 명시적으로 `New Session`을 누를 때만 생성한다.
- 자동 생성은 시스템 이벤트(예: 추후 folder system flow)에서만 제한적으로 허용한다.

## 6) UX 디자인 원칙

## 6.1 Mini Chat (Codex 스타일)

mini chat 상단에 세션 컨트롤을 둔다.

- 현재 세션 표시 (title, workspace badge)
- 최근 5개 세션 dropdown
- `Review all tasks` 클릭 시 전체 세션 목록(스크롤) 오픈
- 액션:
  - `Continue current`
  - `Switch to recommended` (있을 때만)
  - `New session`

중요 원칙:

- 자동 전환 없음
- 사용자가 명시적으로 선택/생성
- UI를 바꿔도 선택 세션은 유지 가능

## 6.2 Agent Chat

`글로벌 단일 채팅창`이 아니라 `세션 허브가 가능한 채팅 화면`으로 정의한다.

- 기본은 기존처럼 타임라인 중심
- 필요 시 세션 목록 패널/드롭다운으로 전환
- 항상 "현재 세션이 무엇인지" 노출

## 7) 데이터 모델 변경안

## 7.1 `orchestrator_sessions` 확장

추가 필드:

- `workspace_type text not null default 'general'`
- `scope_id text null`
- `workspace_key text generated or stored` (e.g. `campaign_plan:campaign_123`)
- `title text null`
- `created_by_user_id uuid null`
- `archived_at timestamptz null`

변경:

- org active 1개 제한 유니크 인덱스 제거
- 조회 인덱스 추가:
  - `(org_id, updated_at desc)`
  - `(org_id, workspace_type, scope_id, updated_at desc)`
  - `(org_id, status, updated_at desc)`

## 7.2 `chat_messages` 확장

추가 필드:

- `session_id uuid not null references orchestrator_sessions(id)`

이유:

- 메시지 조회/실시간 동기화를 session 단위로 분리하기 위해 필수

백필:

- 기존 action_card는 `metadata.session_id` 기반 backfill
- 나머지 텍스트 메시지는 org의 당시 active session 기준으로 매핑하거나 legacy session으로 묶음

## 8) API 계약 변경안

신규/변경:

1. `GET /orgs/:orgId/sessions`
- 세션 목록 조회 (recent, pagination, filters)

2. `POST /orgs/:orgId/sessions`
- 새 세션 생성 (workspace_type, scope_id, title)

3. `GET /orgs/:orgId/sessions/recommended?workspace_type=&scope_id=`
- 해당 작업의 최근 세션 추천

4. `POST /sessions/:sessionId/resume`
- 기존 유지 (핵심 이벤트 엔드포인트)

5. `GET /sessions/:sessionId/messages`
- session scoped message fetch (or Supabase query scope replacement)

Deprecated:

- `GET /orgs/:orgId/sessions/active`를 점진적으로 축소

## 9) Orchestrator 처리 변경안

1. Lock 단위 변경
- `org:<orgId>` -> `session:<sessionId>` 중심으로 전환

2. Queue 단위 변경
- org 글로벌 대기열 -> 세션 단위 처리

3. Trigger 라우팅(5-1 선행 준비)
- 단일 active session 가정 제거
- folder/workspace 기준 세션 조회 또는 생성 경로 준비

## 10) 페이지 이동/세션 전환 규칙

1. 페이지 이동 시:
- 현재 세션 유지
- 해당 페이지의 workspace 추천 세션이 있으면 배너 제안

2. 사용자 선택:
- `Keep current` -> 유지
- `Switch` -> 추천 세션으로 전환
- `New` -> 해당 workspace로 신규 세션 생성 후 전환

3. 자동 규칙:
- 시스템은 자동 전환하지 않음
- 시스템은 사용자 명시 없이 신규 세션을 만들지 않음 (단, 추후 시스템 folder flow 제외)

## 11) 단계별 구현 순서

### Step S1: DB/API 기반

- 세션/메시지 스키마 확장
- 세션 목록/생성/추천 API 추가
- org-active 단일 가정 제거

### Step S2: Desktop Session Selector

- mini chat 상단 세션 바 구현
- 최근 5개 + Review all tasks + New session
- selectedSessionId 전역 공유

### Step S3: Session-scoped Chat Data

- 메시지 조회/구독을 session_id 기준으로 전환
- Action dispatch/sendMessage 모두 selectedSessionId 기준으로 고정

### Step S4: Agent Chat 정리

- Agent Chat에서 세션 컨텍스트를 명확히 표시
- 필요 시 전체 세션 패널 연결

### Step S5: Phase 5-1 착수

- Folder-as-Project 흐름을 session_key=`folder:<activity_folder>` 기준으로 안전 연결

## 12) 수용 기준 (Acceptance Criteria)

1. org 내에서 복수 세션을 동시에 생성/보유할 수 있다.
2. mini chat과 Agent Chat은 동일한 selected session을 공유한다.
3. 페이지 이동만으로 세션이 자동 변경되지 않는다.
4. 사용자는 mini chat에서 최근 세션 5개 전환, 새 세션 생성, 전체 세션 탐색이 가능하다.
5. 같은 작업(workspace_key)에 대해 기존 세션 추천이 동작한다.
6. 메시지/타임라인이 session 단위로 분리되어 맥락 혼합이 사라진다.
7. 기존 `resume` 이벤트 플로우(idempotency 포함)가 세션 단위로 유지된다.
8. 이후 Phase 5-1 구현 시 folder 세션 라우팅과 충돌하지 않는다.

## 13) 결정 요약

- 먼저 세션 시스템을 멀티세션 기반으로 재설계한다.
- UX는 Codex 스타일의 가벼운 세션 선택 바를 mini chat 공통으로 사용한다.
- "자동 전환 금지 + 추천 전환 + 명시적 새 세션" 규칙을 고정한다.
- 이 기반 위에서 Phase 5-1 Folder-as-Project를 진행한다.

