
S5a: Workspace Shell + Queue/Chat Policy Separation
Context
Session S1~S4 완료로 멀티세션 기반이 구축되었으나, 현재 UX에는 근본적 문제가 남아있다:

Action card가 채팅을 차단: 미승인 항목이 있으면 일반 대화도 불가
세션 인식 어려움: 어떤 세션에서 작업 중인지 유저가 알기 어려움
페이지별 미니챗 분절: 작업보드마다 채팅이 나뉜다는 오해 유발
워크플로우 불명확: 캠페인 파이프라인(A)과 온디맨드 컨텐츠(B)의 경로가 UI에서 구분되지 않음
제품 원칙: Chat AI Agent = 유저의 유일한 작업 인터페이스. UI = 상황 이해 및 의사결정 보조 도구.

목표: Workspace 페이지를 도입하여 Inbox(작업대) + Chat + Session Rail의 3패널 구성으로 통합. Action card는 채팅에서 제거하고 Inbox에서만 표시/승인.

변경 범위
1. Navigation 타입 변경
File: apps/desktop/src/types/navigation.ts

PageId union에서 "campaign-plan", "content-create", "agent-chat" 제거, "workspace" 추가
FULL_WIDTH_PAGES를 ["workspace", "settings"]로 변경
NAV_ITEMS 업데이트:
primary: workspace, dashboard, brand-review, analytics, email-automation
secondary: settings
AgentChatHandoff → WorkspaceHandoff로 rename (focusWorkflowItemId만 유지)
2. NavigationContext 업데이트
File: apps/desktop/src/context/NavigationContext.tsx

INITIAL_NAVIGATION_STATE.activePage를 "workspace"로 변경
navigate 콜백에서 pageId === "agent-chat" → pageId === "workspace" 변경
agentChatHandoff → workspaceHandoff로 rename
clearAgentChatHandoff → clearWorkspaceHandoff로 rename
3. Workspace 페이지 생성
File: apps/desktop/src/pages/Workspace.tsx (NEW)

3패널 A-B-C 레이아웃:


┌──────────┬─────────────────┬──────────┐
│  Inbox   │     Chat        │ Session  │
│  (A)     │     (B)         │  Rail    │
│  320px   │     flex        │  (C)     │
│          │                 │  280px   │
│ workflow │ 세션 채팅 타임라인 │ 세션정보  │
│ items    │ (action_card    │ 세션전환  │
│ 목록     │  필터링 제외)     │ 새세션   │
│ 승인/거절│                 │ 추천세션  │
└──────────┴─────────────────┴──────────┘
4. InboxPanel 컴포넌트 생성
File: apps/desktop/src/components/workspace/InboxPanel.tsx (NEW)

ChatContext에서 draftCampaigns, pendingContents, campaignWorkflowHints, pendingContentWorkflowHints 사용
workflow_items status="proposed" 기준으로 승인 대기 항목 렌더링
각 항목에 승인/수정요청/거절 버튼 (기존 AgentChat.tsx의 action card 렌더링 로직 추출)
dispatchCardAction 호출 시 campaignId/contentId를 workflow hint에서 직접 전달
isActionPending은 Inbox 버튼 비활성화에만 사용 (Chat 입력에는 영향 없음)
핵심 변경 - dispatchCardAction 시그니처:

현재: selectedSessionId !== payload.sessionId 가드가 있음 → Inbox에서는 선택된 세션과 무관하게 action dispatch 가능해야 함
ChatContext.tsx의 dispatchCardAction에서 session-match 가드 제거
campaignId/contentId를 selectedSession.state에서 가져오는 대신, Inbox에서 직접 전달할 수 있도록 시그니처 변경
5. WorkspaceChatPanel 컴포넌트 생성
File: apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx (NEW)

AgentChat.tsx의 채팅 타임라인/입력 부분 추출
action_card 메시지 필터링: messages.filter(m => m.message_type !== "action_card") 적용
Chat 입력 disabled 조건: isSessionMutating || !selectedSessionId 만 (isActionPending 제거)
uiContext.source를 "workspace-chat"으로 변경
action card 관련 state 모두 제거 (collapsedCards, reasonByCard, editByCard 등)
legacy message 토글 유지
6. SessionRailPanel 컴포넌트 생성
File: apps/desktop/src/components/workspace/SessionRailPanel.tsx (NEW)

AgentChat.tsx의 세션 허브 사이드바 로직 추출
현재 세션 정보, workspace context, 새 세션/새로고침 버튼
추천 세션 배너
최근 세션 목록 (SessionList 컴포넌트 재사용)
전체 세션 보기 + 페이지네이션
7. ChatContext 정책 변경
File: apps/desktop/src/context/ChatContext.tsx

dispatchCardAction 시그니처 변경:

// Before: Omit<ChatActionCardDispatchInput, "campaignId" | "contentId">
// After: ChatActionCardDispatchInput (campaignId/contentId 직접 전달 가능)
selectedSessionId !== sessionId 가드 제거 (Inbox에서 독립적으로 dispatch)
selectedSession.state.campaign_id/content_id 폴백은 유지하되 payload에 직접 전달된 값 우선
ChatUiContext.source 타입에 "workspace-chat" 추가
8. MainLayout 업데이트
File: apps/desktop/src/layouts/MainLayout.tsx

MainLayoutProps에서 campaignPlanPage, contentCreatePage, agentChatPage 제거
workspacePage 추가
resolvePageNode switch에서 대응 케이스 변경
9. App.tsx 업데이트
File: apps/desktop/src/App.tsx

CampaignPlanPage, ContentCreatePage, AgentChatPage import 제거
WorkspacePage import 추가
MainLayout에 workspacePage={<WorkspacePage formatDateTime={formatDateTime} />} 전달
10. SessionSelectorContext 업데이트
File: apps/desktop/src/context/SessionSelectorContext.tsx

resolveWorkspaceContext에서 "campaign-plan", "content-create", "agent-chat" case 제거
"workspace" case 추가 (기존 agent-chat과 동일 로직)
11. AgentChatWidget 업데이트
File: apps/desktop/src/components/AgentChatWidget.tsx

"Open Hub" 버튼의 navigate 대상을 "workspace"로 변경
메시지 목록에서 action_card 메시지 필터링 추가
ChatUiContext.source를 "context-panel-widget" 유지
12. ContextPanel 업데이트
File: apps/desktop/src/components/ContextPanel.tsx

i18n 키에서 campaign-plan, content-create, agent-chat 관련 제거 (또는 fallback 유지)
13. 기존 페이지 파일 처리
apps/desktop/src/pages/AgentChat.tsx → 삭제 (로직은 Workspace 하위 컴포넌트로 이동 완료)
apps/desktop/src/pages/CampaignPlan.tsx → 삭제
apps/desktop/src/pages/ContentCreate.tsx → 삭제
14. i18n 업데이트
Files: apps/desktop/src/i18n/locales/en.json, ko.json

ui.nav.workspace: "Workspace" / "워크스페이스"
ui.pages.workspace.*: eyebrow, inboxTitle, inboxEmpty, chatTitle, sessionRailTitle
campaign-plan, content-create, agent-chat 네비게이션 키 제거
15. CSS 스타일
File: apps/desktop/src/styles.css

.ui-workspace-shell: 3컬럼 grid (320px / 1fr / 280px)
.ui-workspace-inbox: 좌측 패널 스타일
.ui-workspace-chat: 중앙 채팅 패널 스타일
.ui-workspace-session-rail: 우측 세션 레일 스타일
Inbox 카드 스타일 (기존 .chat-action-card 스타일 재활용/적응)
구현 순서
Navigation 타입 + Context (Steps 1, 2, 10) → 컴파일 깨짐, 순방향 수정
MainLayout + App.tsx (Steps 8, 9) → Workspace 슬롯 추가, 이전 페이지 제거
Workspace 셸 (Step 3) → 빈 3패널 레이아웃
WorkspaceChatPanel (Step 5) → AgentChat에서 채팅 로직 추출, action_card 필터링
SessionRailPanel (Step 6) → AgentChat에서 세션 허브 로직 추출
ChatContext 정책 (Step 7) → dispatchCardAction 시그니처 변경, 세션 매치 가드 제거
InboxPanel (Step 4) → AgentChat에서 action card 렌더링 추출, Inbox UI 구성
AgentChatWidget (Step 11) → navigate 대상 변경, action_card 필터링
ContextPanel + 기존 페이지 삭제 (Steps 12, 13)
i18n + CSS (Steps 14, 15)
백엔드 변경 (S5a에서는 최소)
chat-projection.ts: S5a에서는 변경하지 않음 (action card는 계속 chat_messages에 삽입됨)
프론트엔드에서 message_type !== "action_card" 필터로 타임라인에서 제외
추후 S5b에서 백엔드 projection을 system notification으로 전환 검토
주의사항
dispatchCardAction의 세션 독립성: Inbox에서 action dispatch 시, 현재 선택된 채팅 세션과 무관하게 해당 workflow item의 세션으로 dispatch. campaignId/contentId는 workflow hint 데이터에서 직접 전달.

기존 action_card 메시지: DB에 이미 존재하는 action_card 메시지들은 필터링으로 숨김. 삭제하지 않음.

Dashboard 페이지: 변경 없음. 기존 대시보드 유지.

Backend lock: org 레벨 lock 유지 (S5a에서는 변경하지 않음).

검증 계획
pnpm type-check → PASS
Workspace 페이지 렌더링 확인:
3패널 레이아웃 정상 표시
Inbox에 workflow_items(campaigns draft + contents pending_approval) 표시
Chat에 action_card 메시지 미표시
Session Rail에 세션 선택/전환 동작
Inbox 승인/거절 동작:
승인 → workflow_item status 변경 → Inbox에서 항목 사라짐
Chat 입력은 승인 대기 중에도 자유롭게 가능
Navigation 확인:
Workspace가 기본 랜딩 페이지
Campaign Plan, Content Create, Agent Chat 네비게이션 항목 미표시
다른 페이지의 ContextPanel 미니챗 정상 동작
pnpm smoke:s3 (환경 가능 시)