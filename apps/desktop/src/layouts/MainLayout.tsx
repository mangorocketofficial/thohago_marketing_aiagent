import type { ReactNode } from "react";
import { ContextPanel } from "../components/ContextPanel";
import { Sidebar } from "../components/Sidebar";
import { useNavigation } from "../context/NavigationContext";
import type { PageId } from "../types/navigation";

type MainLayoutProps = {
  dashboardPage: ReactNode;
  brandReviewPage: ReactNode;
  campaignPlanPage: ReactNode;
  contentCreatePage: ReactNode;
  analyticsPage: ReactNode;
  emailAutomationPage: ReactNode;
  agentChatPage: ReactNode;
  settingsPage: ReactNode;
};

const resolvePageNode = (props: MainLayoutProps, pageId: PageId): ReactNode => {
  switch (pageId) {
    case "dashboard":
      return props.dashboardPage;
    case "brand-review":
      return props.brandReviewPage;
    case "campaign-plan":
      return props.campaignPlanPage;
    case "content-create":
      return props.contentCreatePage;
    case "analytics":
      return props.analyticsPage;
    case "email-automation":
      return props.emailAutomationPage;
    case "agent-chat":
      return props.agentChatPage;
    case "settings":
      return props.settingsPage;
    default:
      return props.dashboardPage;
  }
};

export const MainLayout = (props: MainLayoutProps) => {
  const {
    activePage,
    contextPanelMode,
    contextPanelCollapsed,
    isContextPanelHidden,
    setContextPanelMode,
    toggleContextPanelCollapsed
  } = useNavigation();

  return (
    <div className="ui-main-layout">
      <Sidebar activePage={activePage} />

      <main className="ui-main-content">{resolvePageNode(props, activePage)}</main>

      {!isContextPanelHidden ? (
        <ContextPanel
          activePage={activePage}
          mode={contextPanelMode}
          isCollapsed={contextPanelCollapsed}
          onModeChange={setContextPanelMode}
          onToggleCollapsed={toggleContextPanelCollapsed}
        />
      ) : null}
    </div>
  );
};
