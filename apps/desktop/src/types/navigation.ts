export type PageId =
  | "dashboard"
  | "brand-review"
  | "campaign-plan"
  | "content-create"
  | "analytics"
  | "email-automation"
  | "agent-chat"
  | "settings";

export type NavItem = {
  id: PageId;
  label: string;
  icon: string;
  section: "primary" | "secondary";
};

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
