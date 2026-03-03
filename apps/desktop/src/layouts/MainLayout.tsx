import { useState, type ReactNode } from "react";
import { ContextPanel } from "../components/ContextPanel";
import { Sidebar } from "../components/Sidebar";
import type { PageId } from "../types/navigation";

type MainLayoutProps = {
  children: ReactNode;
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

export const MainLayout = ({ children }: MainLayoutProps) => {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [isContextCollapsed, setIsContextCollapsed] = useState(false);

  return (
    <div className="ui-main-layout">
      <Sidebar activePage={activePage} onSelectPage={setActivePage} />

      <main className="ui-main-content">
        {activePage === "dashboard" ? (
          children
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

      <ContextPanel
        activePage={activePage}
        isCollapsed={isContextCollapsed}
        onToggleCollapsed={() => setIsContextCollapsed((previous) => !previous)}
      />
    </div>
  );
};

