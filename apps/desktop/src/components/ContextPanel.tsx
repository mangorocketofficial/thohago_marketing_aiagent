import type { ContextPanelMode, PageId } from "../types/navigation";

type ContextPanelProps = {
  activePage: PageId;
  mode: ContextPanelMode;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
};

const PAGE_CONTEXT_LABELS: Record<PageId, string> = {
  dashboard: "Dashboard Context",
  "brand-review": "Brand Profile Context",
  "campaign-plan": "Campaign Context",
  "content-create": "Content Preview Context",
  analytics: "Analytics Context",
  "email-automation": "Email Context",
  "agent-chat": "Agent Chat Context",
  settings: "Settings Context"
};

export const ContextPanel = ({ activePage, mode, isCollapsed, onToggleCollapsed }: ContextPanelProps) => {
  return (
    <aside className={`ui-context-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        className="ui-context-toggle"
        onClick={onToggleCollapsed}
        aria-label={isCollapsed ? "Expand context panel" : "Collapse context panel"}
      >
        {isCollapsed ? "<" : ">"}
      </button>

      {!isCollapsed ? (
        <div className="ui-context-inner">
          <h3>{PAGE_CONTEXT_LABELS[activePage]}</h3>
          <p className="ui-context-mode">Mode: {mode}</p>
          <p>
            UI-1 provides the shell only. Page-specific context cards and mini agent chat will be delivered in later UI
            phases.
          </p>
        </div>
      ) : null}
    </aside>
  );
};
