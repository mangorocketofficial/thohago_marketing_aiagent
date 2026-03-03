import type { ReactNode } from "react";
import { ContextPanel } from "../components/ContextPanel";
import { Sidebar } from "../components/Sidebar";
import { useNavigation } from "../context/NavigationContext";
import type { PageId } from "../types/navigation";

type MainLayoutProps = {
  dashboardPage: ReactNode;
  agentChatPage: ReactNode;
  settingsPage: ReactNode;
};

const PLACEHOLDER_TITLES: Record<Exclude<PageId, "dashboard">, string> = {
  "brand-review": "Brand Review",
  "campaign-plan": "Campaign Plan",
  "content-create": "Content Create",
  analytics: "Analytics",
  "email-automation": "Email Automation",
  "agent-chat": "Agent Chat",
  settings: "Settings"
};

export const MainLayout = ({ dashboardPage, agentChatPage, settingsPage }: MainLayoutProps) => {
  const {
    activePage,
    navigate,
    contextPanelMode,
    contextPanelCollapsed,
    isContextPanelHidden,
    toggleContextPanelCollapsed
  } = useNavigation();

  return (
    <div className="ui-main-layout">
      <Sidebar activePage={activePage} onSelectPage={navigate} />

      <main className="ui-main-content">
        {activePage === "dashboard" ? (
          dashboardPage
        ) : activePage === "agent-chat" ? (
          agentChatPage
        ) : activePage === "settings" ? (
          settingsPage
        ) : (
          <div className="app-shell ui-dashboard-shell">
            <section className="panel ui-page-placeholder">
              <p className="eyebrow">UI-1 Shell</p>
              <h1>{PLACEHOLDER_TITLES[activePage]}</h1>
              <p className="description">
                This page is intentionally a placeholder in UI-1. Functional page migration will be delivered in later
                UI phases.
              </p>
            </section>
          </div>
        )}
      </main>

      {!isContextPanelHidden ? (
        <ContextPanel
          activePage={activePage}
          mode={contextPanelMode}
          isCollapsed={contextPanelCollapsed}
          onToggleCollapsed={toggleContextPanelCollapsed}
        />
      ) : null}
    </div>
  );
};
