# Agent Workflow Notes

## Phase Completion Rule

각 phase 개발 완료 후 아래를 반드시 수행한다.

1. 문서 작성
- 인덱스: `docs/progress/phase-index.md`
- 완료 보고서: `docs/progress/phase-<phase>-completion.md` (예: `phase-1-1-completion.md`)

2. 저장소 반영
- 변경사항 커밋
- 원격 저장소 푸시

## Minimum Completion Checklist

- [ ] `phase-index.md`에 해당 phase 상태/완료일/보고서 링크 반영
- [ ] `phase-<phase>-completion.md` 작성 완료
- [ ] `git add .`
- [ ] `git commit -m "<phase 요약 메시지>"`
- [ ] `git push`

## Phase Session S5a Completion (2026-03-04)

### Summary
- Step S5a 개발 완료.
- Workspace 중심 UX로 전환: `Inbox + Chat + Session Rail` 3보드 운영.
- 승인 큐(Inbox)와 채팅 입력 흐름 분리: 승인 대기 상태에서도 채팅 지속 가능.

### Implemented
- Navigation 구조 개편
  - `workspace` 페이지 도입 및 기본 랜딩 전환.
  - 기존 `campaign-plan`, `content-create`, `agent-chat` 제거.
- Workspace 구조화
  - `apps/desktop/src/pages/Workspace.tsx` 신규.
  - `InboxPanel`, `WorkspaceChatPanel`, `SessionRailPanel` 신규 구성.
- Chat/Action 정책 변경
  - 타임라인에서 `action_card` 메시지 숨김(클라이언트 필터).
  - `dispatchCardAction` 세션 매치 가드 제거, 직접 전달 ID 우선 처리.
  - ID 누락 시 방어 로그/가이드 메시지 추가.
- Session Rail UX 단순화
  - 최근 세션 단일 리스트 운영.
  - 세션 메타(워크스페이스/상태/시간) 제거, `제목 + 한 줄 미리보기` 표시.
  - Rail hide/show 토글 아이콘 적용.
- Layout/UI 개편
  - 좌측 사이드바 제거, Top bar 메뉴 전환.
  - 채팅 보드 타이틀을 `또대리`로 변경.
  - 채팅 메시지 버블형(유저 우측/어시스턴트 좌측), 역할 라벨/타임스탬프 제거.

### API Behavior Update
- 승인 대기 스텝(`await_campaign_approval`, `await_content_approval`)에서 `user_message`를 더 이상 409로 거절하지 않음.
- 해당 구간에서도 일반 대화 지속 가능하도록 `gpt-4o-mini` 기반 응답 경로 연결.

### Validation
- `pnpm --filter api type-check` 통과.
- `pnpm --filter desktop type-check` 통과.

### Follow-up
- S5b: backend projection/action_card 데이터 모델 고도화.
- S5c: Canvas artifact preview/editor 도입.
