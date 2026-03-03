import type { Campaign, ChatMessage } from "@repo/types";

type AgentChatPageProps = {
  messages: ChatMessage[];
  chatInput: string;
  chatNotice: string;
  chatConfigMessage: string;
  activeSessionId: string | null;
  campaignToReview: Campaign | null;
  isActionPending: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  onApproveCampaign: (campaignId: string) => void;
  onRejectCampaign: (campaignId: string) => void;
};

export const AgentChatPage = ({
  messages,
  chatInput,
  chatNotice,
  chatConfigMessage,
  activeSessionId,
  campaignToReview,
  isActionPending,
  formatDateTime,
  onChatInputChange,
  onSendMessage,
  onApproveCampaign,
  onRejectCampaign
}: AgentChatPageProps) => (
  <div className="app-shell ui-dashboard-shell">
    <section className="panel">
      <p className="eyebrow">Agent Chat</p>
      <h1>Conversation</h1>
      <p className="description">Realtime assistant conversation and action approvals.</p>
    </section>

    <section className="panel">
      <article className="subpanel">
        {chatConfigMessage ? <p className="notice">{chatConfigMessage}</p> : null}

        <div className="chat-list">
          {messages.length === 0 ? (
            <p className="empty">No chat messages yet.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`chat-item chat-${message.role}`}>
                <div className="chat-head">
                  <strong>{message.role}</strong>
                  <span>{formatDateTime(message.created_at)}</span>
                </div>
                <p>{message.content}</p>
              </div>
            ))
          )}
        </div>

        {campaignToReview ? (
          <div className="campaign-card">
            <h3>Campaign Approval</h3>
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
        ) : null}

        {!activeSessionId ? (
          <p className="empty">
            No active session yet. Add a file under an activity folder (example:{" "}
            <code>tanzania-activity/photo01.jpg</code>) or place a file at watch-root.
          </p>
        ) : null}

        <div className="chat-input-row">
          <input
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            placeholder="Type a reply for the assistant..."
            disabled={isActionPending}
          />
          <button className="primary" disabled={isActionPending || !chatInput.trim()} onClick={onSendMessage}>
            Send
          </button>
        </div>

        {chatNotice ? <p className="notice">{chatNotice}</p> : null}
      </article>
    </section>
  </div>
);

