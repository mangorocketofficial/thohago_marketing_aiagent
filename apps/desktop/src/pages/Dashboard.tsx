import type { Campaign, Content } from "@repo/types";

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

type DashboardPageProps = {
  runtimeSummary: RuntimeSummary;
  notice: string;
  sortedFiles: IndexedFile[];
  pendingContents: Content[];
  campaignToReview: Campaign | null;
  contentEdits: Record<string, string>;
  isActionPending: boolean;
  isAuthPending: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
  onOpenWatchFolder: () => void;
  onRefreshActiveSession: () => void;
  onSignOut: () => void;
  onApproveCampaign: (campaignId: string) => void;
  onRejectCampaign: (campaignId: string) => void;
  onUpdateContentEdit: (contentId: string, nextBody: string) => void;
  onApproveContent: (contentId: string, editedBody?: string) => void;
  onRejectContent: (contentId: string) => void;
};

export const DashboardPage = ({
  runtimeSummary,
  notice,
  sortedFiles,
  pendingContents,
  campaignToReview,
  contentEdits,
  isActionPending,
  isAuthPending,
  formatDateTime,
  onOpenWatchFolder,
  onRefreshActiveSession,
  onSignOut,
  onApproveCampaign,
  onRejectCampaign,
  onUpdateContentEdit,
  onApproveContent,
  onRejectContent
}: DashboardPageProps) => (
  <div className="app-shell ui-dashboard-shell">
    <section className="panel">
      <p className="eyebrow">Runtime</p>
      <h1>Dashboard</h1>
      <p className="description">Live runtime status, approvals, and indexed files.</p>
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
        <h2>Campaign Approval</h2>
        {campaignToReview ? (
          <div className="campaign-card">
            <p>
              <strong>{campaignToReview.title}</strong>
            </p>
            <p>Channels: {campaignToReview.channels.join(", ") || "-"}</p>
            <p>
              {campaignToReview.plan.post_count} posts / {campaignToReview.plan.duration_days} days
            </p>
            <div className="button-row">
              <button className="primary" disabled={isActionPending} onClick={() => onApproveCampaign(campaignToReview.id)}>
                Approve Campaign
              </button>
              <button disabled={isActionPending} onClick={() => onRejectCampaign(campaignToReview.id)}>
                Reject Campaign
              </button>
            </div>
          </div>
        ) : (
          <p className="empty">No draft campaign awaiting approval.</p>
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
            pendingContents.map((content) => (
              <div key={content.id} className="queue-item">
                <div className="queue-meta">
                  <p>
                    <strong>{content.channel}</strong> · {content.content_type}
                  </p>
                  <p>Campaign: {content.campaign_id ?? "-"}</p>
                  <p>Created: {formatDateTime(content.created_at)}</p>
                </div>
                <textarea
                  className="queue-editor"
                  value={contentEdits[content.id] ?? content.body ?? ""}
                  onChange={(event) => onUpdateContentEdit(content.id, event.target.value)}
                  placeholder="Edit draft before approval..."
                  disabled={isActionPending}
                />
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={isActionPending}
                    onClick={() => onApproveContent(content.id, contentEdits[content.id] ?? content.body ?? "")}
                  >
                    Approve
                  </button>
                  <button disabled={isActionPending} onClick={() => onRejectContent(content.id)}>
                    Reject
                  </button>
                </div>
              </div>
            ))
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
