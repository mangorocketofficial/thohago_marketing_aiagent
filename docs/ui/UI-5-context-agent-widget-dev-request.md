# UI-5 Development Request
## Context Panel Agent Widget Integration

---

## Goal

Enable an agent mini-chat mode inside the context panel that reuses the same chat session as the full Agent Chat page.

---

## Scope

### In Scope

- Implement `AgentChatWidget` for right-panel mini mode.
- Add toggle entry from page-context panel to mini chat mode.
- Share the same message source/session as full Agent Chat page.
- Include current page metadata in outgoing mini-chat messages.
- Add close action to return mini mode to page-context mode.

### Out of Scope

- New chat backend features.
- Independent chat session model.
- Multi-thread chat UI.

---

## Target File Additions

- `apps/desktop/src/components/AgentChatWidget.tsx`
- `apps/desktop/src/context/ChatContext.tsx` (if not already introduced in UI-3)

## Target File Updates

- `apps/desktop/src/components/ContextPanel.tsx`
- `apps/desktop/src/pages/AgentChat.tsx`
- `apps/desktop/src/hooks/useChat.ts`
- `apps/desktop/src/i18n/locales/ko.json`
- `apps/desktop/src/i18n/locales/en.json`

---

## Acceptance Criteria

1. User can open mini chat from context panel on non-chat pages.
2. Mini chat send/receive works with same data source as full page chat.
3. Opening full Agent Chat reflects messages sent from mini widget.
4. Closing mini chat returns context panel to page-specific content.
5. `pnpm --filter @repo/desktop type-check` passes.
6. `pnpm --filter @repo/desktop build` passes.

---

## Risks and Controls

- Risk: duplicated chat state between widget and full page.
- Control: single chat source of truth through shared hook/context.

