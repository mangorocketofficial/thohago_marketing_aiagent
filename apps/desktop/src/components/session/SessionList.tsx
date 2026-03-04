import type { OrchestratorSession } from "@repo/types";

type SessionListProps = {
  sessions: OrchestratorSession[];
  selectedSessionId: string | null;
  isBusy?: boolean;
  isLoading?: boolean;
  emptyMessage: string;
  loadingLabel: string;
  selectLabel: string;
  selectedLabel: string;
  onSelect: (session: OrchestratorSession) => void;
};

const workspaceLabel = (session: OrchestratorSession): string => {
  const type = typeof session.workspace_type === "string" && session.workspace_type.trim() ? session.workspace_type.trim() : "general";
  const scope = typeof session.scope_id === "string" && session.scope_id.trim() ? session.scope_id.trim() : "default";
  return `${type}:${scope}`;
};

const sessionTitle = (session: OrchestratorSession): string => {
  const title = typeof session.title === "string" ? session.title.trim() : "";
  return title || workspaceLabel(session);
};

const formatUpdatedAt = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const SessionList = ({
  sessions,
  selectedSessionId,
  isBusy = false,
  isLoading = false,
  emptyMessage,
  loadingLabel,
  selectLabel,
  selectedLabel,
  onSelect
}: SessionListProps) => {
  if (sessions.length === 0) {
    return <p className="empty">{isLoading ? loadingLabel : emptyMessage}</p>;
  }

  return (
    <div className="ui-session-list">
      {sessions.map((session) => (
        <div key={session.id} className="ui-session-list-row">
          <div className="ui-session-list-meta">
            <strong>{sessionTitle(session)}</strong>
            <p>{workspaceLabel(session)}</p>
            <p>
              {session.status} / {formatUpdatedAt(session.updated_at)}
            </p>
          </div>
          <button
            type="button"
            className={session.id === selectedSessionId ? "primary" : ""}
            disabled={isBusy || session.id === selectedSessionId}
            onClick={() => onSelect(session)}
          >
            {session.id === selectedSessionId ? selectedLabel : selectLabel}
          </button>
        </div>
      ))}
    </div>
  );
};
