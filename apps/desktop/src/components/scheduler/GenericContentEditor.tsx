import { useMemo, useState } from "react";
import type { ContentEditorProps } from "./ContentEditor";
import { SLOT_STATUS_LABEL } from "./status-model";

/**
 * Keeps the existing approval/revision/reject workflow editor for non-blog channels.
 */
export const GenericContentEditor = ({
  content,
  workflowHint,
  slotStatus,
  selectedSessionId,
  isActionPending,
  onBack,
  onSubmitAction
}: ContentEditorProps) => {
  const [editedBody, setEditedBody] = useState(content.body ?? "");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");

  const sessionId = useMemo(
    () => workflowHint?.sessionId ?? selectedSessionId ?? "",
    [selectedSessionId, workflowHint?.sessionId]
  );
  const canDispatch = !!workflowHint?.workflowItemId && workflowHint.workflowStatus === "proposed";

  const submitApprove = async () => {
    if (!workflowHint || !sessionId) {
      setNotice("No workflow/session context is available for this content.");
      return;
    }

    setNotice("");
    await onSubmitAction({
      sessionId,
      workflowItemId: workflowHint.workflowItemId,
      expectedVersion: workflowHint.version,
      actionId: "approve",
      eventType: "content_approved",
      contentId: content.id,
      editedBody: editedBody.trim() ? editedBody : undefined
    });
  };

  const submitRevision = async () => {
    if (!workflowHint || !sessionId) {
      setNotice("No workflow/session context is available for this content.");
      return;
    }
    if (!reason.trim()) {
      setNotice("Revision reason is required.");
      return;
    }

    setNotice("");
    await onSubmitAction({
      sessionId,
      workflowItemId: workflowHint.workflowItemId,
      expectedVersion: workflowHint.version,
      actionId: "request_revision",
      eventType: "content_rejected",
      contentId: content.id,
      mode: "revision",
      reason: reason.trim()
    });
  };

  const submitReject = async () => {
    if (!workflowHint || !sessionId) {
      setNotice("No workflow/session context is available for this content.");
      return;
    }

    setNotice("");
    await onSubmitAction({
      sessionId,
      workflowItemId: workflowHint.workflowItemId,
      expectedVersion: workflowHint.version,
      actionId: "reject",
      eventType: "content_rejected",
      contentId: content.id,
      reason: reason.trim() || undefined
    });
  };

  return (
    <section className="ui-content-editor">
      <div className="ui-content-editor-head">
        <div>
          <h2>{content.channel} editor</h2>
          <p className="sub-description">
            Status: <strong>{SLOT_STATUS_LABEL[slotStatus]}</strong> | Type: {content.content_type}
          </p>
        </div>
        <button className="ui-content-editor-back-button" type="button" onClick={onBack}>
          Back to Schedule
        </button>
      </div>

      <div className="ui-content-editor-preview">
        <p className="ui-content-editor-label">Preview</p>
        <p>{(content.body ?? "").trim() || "(No content body)"}</p>
      </div>

      <label className="ui-content-editor-label" htmlFor="content-editor-body">
        Direct edit
      </label>
      <textarea
        id="content-editor-body"
        className="chat-card-editor"
        value={editedBody}
        onChange={(event) => setEditedBody(event.target.value)}
        placeholder="Edit text directly. Click Approve to persist edited body."
      />

      <label className="ui-content-editor-label" htmlFor="content-editor-reason">
        Revision / reject reason
      </label>
      <textarea
        id="content-editor-reason"
        className="chat-card-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Required for Request Revision"
      />

      {workflowHint ? (
        <p className="sub-description">
          Workflow v{workflowHint.version} ({workflowHint.workflowStatus})
        </p>
      ) : (
        <p className="sub-description">No workflow link available for this item.</p>
      )}

      <div className="button-row">
        <button type="button" className="primary" disabled={!canDispatch || isActionPending} onClick={() => void submitApprove()}>
          Approve
        </button>
        <button type="button" disabled={!canDispatch || isActionPending} onClick={() => void submitRevision()}>
          Request Revision
        </button>
        <button type="button" disabled={!canDispatch || isActionPending} onClick={() => void submitReject()}>
          Reject
        </button>
      </div>

      {notice ? <p className="notice">{notice}</p> : null}
    </section>
  );
};
