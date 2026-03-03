import type { Campaign, Content, WorkflowStatus } from "@repo/types";
import { useNavigation } from "../context/NavigationContext";

type RuntimeSummary = {
  platform: string;
  watchPath: string;
  isRunning: boolean;
  fileCount: number;
  scanCount: number;
  activeSessionId: string;
  sessionStep: string;
  sessionStatus: string;
};

type IndexedFile = {
  relativePath: string;
  activityFolder: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type WorkflowLinkHint = {
  workflowItemId: string;
  workflowStatus: WorkflowStatus;
  version: number;
};

type DashboardPageProps = {
  runtimeSummary: RuntimeSummary;
  notice: string;
  sortedFiles: IndexedFile[];
  pendingContents: Content[];
  pendingContentWorkflowHints: Record<string, WorkflowLinkHint | undefined>;
  campaignToReview: Campaign | null;
  campaignWorkflowHint: WorkflowLinkHint | null;
  isActionPending: boolean;
  isAuthPending: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
  onOpenWatchFolder: () => void;
  onRefreshActiveSession: () => void;
  onSignOut: () => void;
};

const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  proposed: "Proposed",
  revision_requested: "Revision Requested",
  approved: "Approved",
  rejected: "Rejected"
};

const WorkflowHintBadge = ({ hint }: { hint: WorkflowLinkHint | null | undefined }) => {
  if (!hint) {
    return (
      <span className="queue-badge">
        Workflow: unavailable
      </span>
    );
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
  pendingContents,
  pendingContentWorkflowHints,
  campaignToReview,
  campaignWorkflowHint,
  isActionPending,
  isAuthPending,
  formatDateTime,
  onOpenWatchFolder,
  onRefreshActiveSession,
  onSignOut
}: DashboardPageProps) => {
  const { navigate } = useNavigation();

  return (
    <div className="app-shell ui-dashboard-shell">
      <section className="panel">
        <p className="eyebrow">Runtime</p>
        <h1>Dashboard</h1>
        <p className="description">Live runtime status, pending visibility, and indexed files.</p>
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
          <p>
            Active Session: <strong>{runtimeSummary.activeSessionId}</strong>
          </p>
          <p>
            Session Step: <strong>{runtimeSummary.sessionStep}</strong>
          </p>
          <p>
            Session Status: <strong>{runtimeSummary.sessionStatus}</strong>
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
          <p className="sub-description">
            Read-only status view. Approval decisions execute in Agent Chat action-cards.
          </p>
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
                    navigate("agent-chat", {
                      agentChatHandoff: {
                        focusWorkflowItemId: campaignWorkflowHint?.workflowItemId,
                        focusCampaignId: campaignToReview.id
                      }
                    })
                  }
                >
                  Open in Chat
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
                          navigate("agent-chat", {
                            agentChatHandoff: {
                              focusWorkflowItemId: workflowHint?.workflowItemId,
                              focusContentId: content.id,
                              ...(content.campaign_id ? { focusCampaignId: content.campaign_id } : {})
                            }
                          })
                        }
                      >
                        Open in Chat
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

