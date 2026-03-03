export type PageId =
  | "dashboard"
  | "brand-review"
  | "campaign-plan"
  | "content-create"
  | "analytics"
  | "email-automation"
  | "agent-chat"
  | "settings";

export type ContextPanelMode = "page-context" | "agent-chat" | "hidden";

export type AgentChatHandoff = {
  focusWorkflowItemId?: string;
  focusContentId?: string;
  focusCampaignId?: string;
};

export type NavigateOptions = {
  contextPanelMode?: ContextPanelMode;
  agentChatHandoff?: AgentChatHandoff | null;
};

export type NavigationState = {
  activePage: PageId;
  contextPanelMode: ContextPanelMode;
  contextPanelCollapsed: boolean;
  agentChatHandoff: AgentChatHandoff | null;
};

export type NavItem = {
  id: PageId;
  label: string;
  icon: string;
  section: "primary" | "secondary";
};

export const FULL_WIDTH_PAGES: readonly PageId[] = ["agent-chat", "settings"] as const;

const FULL_WIDTH_PAGE_SET = new Set<PageId>(FULL_WIDTH_PAGES);

export const isFullWidthPage = (pageId: PageId): boolean => FULL_WIDTH_PAGE_SET.has(pageId);

export const defaultContextPanelModeForPage = (pageId: PageId): ContextPanelMode =>
  isFullWidthPage(pageId) ? "hidden" : "page-context";

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "DB", section: "primary" },
  { id: "brand-review", label: "Brand Review", icon: "BR", section: "primary" },
  { id: "campaign-plan", label: "Campaign Plan", icon: "CP", section: "primary" },
  { id: "content-create", label: "Content Create", icon: "CC", section: "primary" },
  { id: "analytics", label: "Analytics", icon: "AN", section: "primary" },
  { id: "email-automation", label: "Email Automation", icon: "EM", section: "primary" },
  { id: "agent-chat", label: "Agent Chat", icon: "AG", section: "secondary" },
  { id: "settings", label: "Settings", icon: "ST", section: "secondary" }
] as const;
