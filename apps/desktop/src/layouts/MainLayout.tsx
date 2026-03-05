import type { ReactNode } from "react";
import { GlobalChatPanel } from "../components/chat/GlobalChatPanel";
import { TopBarNav } from "../components/TopBarNav";
import { useNavigation } from "../context/NavigationContext";
import type { PageId } from "../types/navigation";

type MainLayoutProps = {
  schedulerPage: ReactNode;
  dashboardPage: ReactNode;
  brandReviewPage: ReactNode;
  analyticsPage: ReactNode;
  emailAutomationPage: ReactNode;
  settingsPage: ReactNode;
};

const resolvePageNode = (props: MainLayoutProps, pageId: PageId): ReactNode => {
  switch (pageId) {
    case "scheduler":
      return props.schedulerPage;
    case "dashboard":
      return props.dashboardPage;
    case "brand-review":
      return props.brandReviewPage;
    case "analytics":
      return props.analyticsPage;
    case "email-automation":
      return props.emailAutomationPage;
    case "settings":
      return props.settingsPage;
    default:
      return props.dashboardPage;
  }
};

export const MainLayout = (props: MainLayoutProps) => {
  const { activePage } = useNavigation();

  return (
    <div className="ui-main-layout">
      <TopBarNav />

      <div className="ui-main-body">
        <main className="ui-main-content">{resolvePageNode(props, activePage)}</main>
        <GlobalChatPanel />
      </div>
    </div>
  );
};
