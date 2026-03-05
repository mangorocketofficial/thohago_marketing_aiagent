
# Agent Workflow Notes

## Phase Completion Rule

각 phase 개발 완료 후 아래를 반드시 수행한다.

### 1. 문서 작성

- 인덱스  
  `docs/progress/phase-index.md`

- 완료 보고서  
  `docs/progress/phase-<phase>-completion.md`  
  예: `phase-1-1-completion.md`

### 2. 저장소 반영

- 변경사항 커밋
- 원격 저장소 푸시


# Minimum Completion Checklist

- [ ] `phase-index.md`에 해당 phase 상태/완료일/보고서 링크 반영
- [ ] `phase-<phase>-completion.md` 작성 완료
- [ ] `git add .`
- [ ] `git commit -m "<phase 요약 메시지>"`
- [ ] `git push`


# Document Structure Rules

프로젝트 문서는 다음 4가지 타입으로 유지한다.

### 1️⃣ Phase Index

`docs/progress/phase-index.md`

역할

- 전체 phase 상태 추적
- completion 문서 링크
- 최신 상태 확인

이 문서가 **Single Source of Truth**.

---

### 2️⃣ Phase Completion

`docs/progress/phase-<phase>-completion.md`

역할

- 해당 phase에서 **무엇이 바뀌었는지 기록**
- 코드가 설명하지 못하는 설계 의도 기록

Completion 문서는 **프로젝트 스냅샷 역할**을 한다.

---

### 3️⃣ Phase Thread (진행중 작업)

`docs/progress/phase-<phase>-thread.md`

역할

- 작업 메모
- TODO
- 실험 기록
- 구현 과정 로그

중요:

**Thread 문서는 작업용이며 completion으로 승격된 후에는 참조용으로만 남긴다.**

---

### 4️⃣ Decision Index

`docs/architecture/decision-index.md`

역할

- 모든 설계 결정 모음
- AI가 프로젝트 의도를 이해하는 핵심 문서

---


# Legacy Document Rule

Decision Log Rule은 **기존 문서 작성 이후에 도입되었다.**

따라서 기존 completion 문서는 수정하지 않는다.

대신 문서 상단에 다음 주석을 추가할 수 있다.

NOTE  
This document was written before the Decision Log rule was introduced.  
Decisions may appear inline instead of the standardized "Decisions" block.

기존 문서 수정은 **선택 사항이며 필수 아님**.

---


# Decision Log Rule

각 completion 문서의 **Follow-up 아래**에 `### Decisions` 블록을 추가한다.

코드가 말할 수 없는 것만 적는다.

- 왜 이 설계를 선택했는지
- 어떤 대안을 버렸는지
- 어디서 막혔는지
- 어떤 기술 부채가 생겼는지

예시:

### Decisions

[D-XXX]

Why this approach:
핵심 설계 선택 1-3문장

Alternatives considered:
- 대안 A — 탈락 이유

Blockers hit:
- 증상 → 시도한 것 → 실제 원인 → 해결

Tech debt introduced:
- 무엇 — 왜 지금은 괜찮은지 → affects Phase X.Y

---


# Decision ID System

모든 설계 결정에는 **Decision ID**를 부여한다.

형식

D-001  
D-002  
D-003  

그리고 반드시 `decision-index.md`에 기록한다.

예

## D-014

Phase  
S5a

Decision  
Workspace uses Inbox + Chat + Session Rail layout

Reason  
Approval queue must not block user chat flow

---


# Tech Debt Register Rule

기술 부채는 completion 문서에만 남기지 않는다.

다음 문서에도 기록한다.

`docs/architecture/debt-register.md`

형식

DEBT-012

Description  
action_card client filtering

Reason  
backend projection not implemented yet

Affects  
S5b

Completion 문서에서는 다음처럼 참조한다.

Tech debt introduced:
- DEBT-012 action_card client filtering → affects S5b

---


# Completion Writing Rules

Completion 문서는 **코드 설명이 아니라 변화 기록**이다.

### 적어야 하는 것

- 행동 변화
- API 계약 변화
- UX 흐름 변화
- 설계 결정

### 적지 말아야 하는 것

- 파일 나열
- 코드 설명
- 구현 상세

---


# Writing Constraints

1️⃣ 섹션당 **5줄 이내**

넘으면 over-explaining.

2️⃣ 해당 없는 섹션은 **삭제**

"없음" 쓰지 말 것.

3️⃣ 결정이 다른 phase에 영향을 주면 반드시 표시

→ affects Phase X.Y

---


# Phase Session Example

## Phase Session S5a Completion (2026-03-04)

### Summary

- Step S5a 개발 완료.
- Workspace 중심 UX로 전환: `Inbox + Chat + Session Rail` 3보드 운영.

### API Behavior Update

- 승인 대기 스텝에서 user_message를 더 이상 거절하지 않음.

### Validation

- `pnpm --filter api type-check` 통과
- `pnpm --filter desktop type-check` 통과

### Follow-up

- S5b: backend projection/action_card 데이터 모델 고도화
- S5c: Canvas artifact preview/editor 도입

### Decisions

[D-014]

Why this approach:
Workspace 3보드 구조 채택 — 승인 대기 상태에서도 채팅을 막지 않기 위해 승인 큐와 채팅 흐름을 분리.

Alternatives considered:
- 채팅 + 승인 모달 구조 — UX 복잡

Blockers hit:
- 승인 상태에서 user_message 409 발생 → backend 응답 경로 수정

Tech debt introduced:
- DEBT-012 action_card client filtering → affects S5b

---


# Development Philosophy

이 프로젝트는 다음 개발 패턴을 따른다.

small step implementation  
→ documentation accumulation  
→ prototype completion  
→ AI reconstruction  

1차 목표는 **동작하는 프로토타입**.

2차 목표는 **문서를 기반으로 clean rebuild**.

---


# Structure Summary

phase index  
↓  
completion docs  
↓  
decision index  
↓  
debt register
