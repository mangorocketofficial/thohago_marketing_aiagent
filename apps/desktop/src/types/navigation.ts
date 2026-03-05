export type PageId =
  | "scheduler"
  | "dashboard"
  | "brand-review"
  | "analytics"
  | "email-automation"
  | "settings";

export type ContextPanelMode = "page-context" | "agent-chat" | "hidden";

export type WorkspaceHandoff = {
  focusWorkflowItemId?: string;
  focusSessionId?: string;
  focusContentId?: string;
};

export type NavigateOptions = {
  contextPanelMode?: ContextPanelMode;
  workspaceHandoff?: WorkspaceHandoff | null;
};

export type NavigationState = {
  activePage: PageId;
  contextPanelMode: ContextPanelMode;
  contextPanelCollapsed: boolean;
  workspaceHandoff: WorkspaceHandoff | null;
};

export type NavItem = {
  id: PageId;
  label: string;
  icon: string;
  section: "primary" | "secondary";
};

export const FULL_WIDTH_PAGES: readonly PageId[] = ["scheduler", "settings"] as const;

const FULL_WIDTH_PAGE_SET = new Set<PageId>(FULL_WIDTH_PAGES);

export const isFullWidthPage = (pageId: PageId): boolean => FULL_WIDTH_PAGE_SET.has(pageId);

export const defaultContextPanelModeForPage = (pageId: PageId): ContextPanelMode =>
  isFullWidthPage(pageId) ? "hidden" : "page-context";

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "scheduler", label: "Scheduler", icon: "SC", section: "primary" },
  { id: "dashboard", label: "Dashboard", icon: "DB", section: "primary" },
  { id: "brand-review", label: "Brand Review", icon: "BR", section: "primary" },
  { id: "analytics", label: "Analytics", icon: "AN", section: "primary" },
  { id: "settings", label: "Settings", icon: "ST", section: "secondary" }
] as const;
