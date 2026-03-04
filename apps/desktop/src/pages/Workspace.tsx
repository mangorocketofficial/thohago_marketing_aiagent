import { useState } from "react";
import { InboxPanel } from "../components/workspace/InboxPanel";
import { SessionRailPanel } from "../components/workspace/SessionRailPanel";
import { WorkspaceChatPanel } from "../components/workspace/WorkspaceChatPanel";

type WorkspacePageProps = {
  formatDateTime: (iso: string | null | undefined) => string;
};

export const WorkspacePage = ({ formatDateTime }: WorkspacePageProps) => {
  const [isSessionRailHidden, setIsSessionRailHidden] = useState(false);
  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-workspace-shell-wrap">
        <div className={`ui-workspace-shell${isSessionRailHidden ? " is-session-rail-hidden" : ""}`}>
          <InboxPanel formatDateTime={formatDateTime} />
          <WorkspaceChatPanel formatDateTime={formatDateTime} />
          {!isSessionRailHidden ? (
            <SessionRailPanel onHide={() => setIsSessionRailHidden(true)} />
          ) : null}
        </div>
        {isSessionRailHidden ? (
          <button
            type="button"
            className="ui-session-rail-toggle-button ui-session-rail-show-toggle"
            aria-label="Show session rail"
            onClick={() => setIsSessionRailHidden(false)}
          >
            {">"}
          </button>
        ) : null}
      </section>
    </div>
  );
};
