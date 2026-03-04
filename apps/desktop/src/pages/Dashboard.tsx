import type { WorkflowStatus } from "@repo/types";
import { useTranslation } from "react-i18next";
import { useChatContext } from "../context/ChatContext";
import { useNavigation } from "../context/NavigationContext";
import type { RuntimeSummary } from "../types/runtime";
import { WORKFLOW_STATUS_LABEL } from "../types/workflow";

type IndexedFile = {
  relativePath: string;
  activityFolder: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type DashboardPageProps = {
  runtimeSummary: RuntimeSummary;
  notice: string;
  sortedFiles: IndexedFile[];
  isAuthPending: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
  onOpenWatchFolder: () => void;
  onRefreshActiveSession: () => void;
  onSignOut: () => void;
};

const WorkflowHintBadge = ({
  hint
}: {
  hint:
    | {
        workflowItemId: string;
        workflowStatus: WorkflowStatus;
        version: number;
      }
    | null
    | undefined;
}) => {
  if (!hint) {
    return <span className="queue-badge">Workflow: unavailable</span>;
  }

  return (
    <span className={`queue-badge is-${hint.workflowStatus}`}>
      Workflow: {WORKFLOW_STATUS_LABEL[hint.workflowStatus]} v{hint.version}
    </span>
  );
};

export const DashboardPage = ({
  runtimeSummary,
  notice,
  sortedFiles,
  isAuthPending,
  formatDateTime,
  onOpenWatchFolder,
  onRefreshActiveSession,
  onSignOut
}: DashboardPageProps) => {
  const { t } = useTranslation();
  const {
    pendingContents,
    pendingContentWorkflowHints,
    campaignToReview,
    campaignWorkflowHints,
    isActionPending
  } = useChatContext();
  const { navigate } = useNavigation();

  const campaignWorkflowHint = campaignToReview ? campaignWorkflowHints[campaignToReview.id] ?? null : null;

  return (
    <div className="app-shell ui-dashboard-shell">
      <section className="panel">
        <p className="eyebrow">{t("ui.pages.dashboard.eyebrow")}</p>
        <h1>{t("ui.pages.dashboard.title")}</h1>
        <p className="description">{t("ui.pages.dashboard.description")}</p>
        <div className="meta-grid">
          <p>
            Platform: <strong>{runtimeSummary.platform}</strong>
          </p>
          <p>
            Watch Path: <strong>{runtimeSummary.watchPath}</strong>
          </p>
          <p>
            Running: <strong>{runtimeSummary.isRunning ? "Yes" : "No"}</strong>
          </p>
          <p>
            Active Files: <strong>{runtimeSummary.fileCount}</strong>
          </p>
          <p>
            Last Scan Count: <strong>{runtimeSummary.scanCount}</strong>
          </p>
        </div>
        <div className="button-row">
          <button onClick={onOpenWatchFolder}>Open Watch Folder</button>
          <button onClick={onRefreshActiveSession}>Refresh Active Session</button>
          <button disabled={isActionPending || isAuthPending} onClick={onSignOut}>
            Sign out
          </button>
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
      </section>

      <section className="panel panel-split">
        <article className="subpanel">
          <h2>Campaign Pending View</h2>
          <p className="sub-description">Read-only status view. Approval decisions execute in Workspace Inbox.</p>
          {campaignToReview ? (
            <div className="campaign-card">
              <p>
                <strong>{campaignToReview.title}</strong>
              </p>
              <p>Channels: {campaignToReview.channels.join(", ") || "-"}</p>
              <p>
                {campaignToReview.plan.post_count} posts / {campaignToReview.plan.duration_days} days
              </p>
              <WorkflowHintBadge hint={campaignWorkflowHint} />
              <div className="queue-item-actions">
                <button
                  className="primary"
                  onClick={() =>
                    navigate("workspace", {
                      workspaceHandoff: {
                        focusWorkflowItemId: campaignWorkflowHint?.workflowItemId
                      }
                    })
                  }
                >
                  Open in Workspace
                </button>
              </div>
            </div>
          ) : (
            <p className="empty">No draft campaign awaiting review.</p>
          )}
        </article>

        <article className="subpanel">
          <h2>Approval Queue</h2>
          <p className="sub-description">
            Pending items from <code>contents.status = pending_approval</code>.
          </p>
          <div className="queue-list">
            {pendingContents.length === 0 ? (
              <p className="empty">No pending contents.</p>
            ) : (
              pendingContents.map((content) => {
                const workflowHint = pendingContentWorkflowHints[content.id];
                return (
                  <div key={content.id} className="queue-item">
                    <div className="queue-meta">
                      <p>
                        <strong>{content.channel}</strong> | {content.content_type}
                      </p>
                      <p>Status: {content.status}</p>
                      <p>Campaign: {content.campaign_id ?? "-"}</p>
                      <p>Created: {formatDateTime(content.created_at)}</p>
                    </div>
                    <WorkflowHintBadge hint={workflowHint} />
                    <div className="queue-item-actions">
                      <button
                        className="primary"
                        onClick={() =>
                          navigate("workspace", {
                            workspaceHandoff: {
                              focusWorkflowItemId: workflowHint?.workflowItemId
                            }
                          })
                        }
                      >
                        Open in Workspace
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <h2>Indexed Files</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.length === 0 ? (
                <tr>
                  <td colSpan={4}>No active files indexed yet.</td>
                </tr>
              ) : (
                sortedFiles.map((entry) => (
                  <tr key={entry.relativePath}>
                    <td>{entry.activityFolder}</td>
                    <td>{entry.fileName}</td>
                    <td>{entry.fileType}</td>
                    <td>{entry.fileSize.toLocaleString()} B</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
