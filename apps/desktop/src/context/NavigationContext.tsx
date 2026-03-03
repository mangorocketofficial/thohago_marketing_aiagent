import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import type {
  AgentChatHandoff,
  ContextPanelMode,
  NavigateOptions,
  NavigationState,
  PageId
} from "../types/navigation";
import { defaultContextPanelModeForPage, isFullWidthPage } from "../types/navigation";

type NavigationContextValue = NavigationState & {
  isContextPanelHidden: boolean;
  navigate: (pageId: PageId, options?: NavigateOptions) => void;
  clearAgentChatHandoff: () => void;
  setContextPanelMode: (mode: ContextPanelMode) => void;
  setContextPanelCollapsed: (value: boolean) => void;
  toggleContextPanelCollapsed: () => void;
};

const INITIAL_NAVIGATION_STATE: NavigationState = {
  activePage: "dashboard",
  contextPanelMode: defaultContextPanelModeForPage("dashboard"),
  contextPanelCollapsed: false,
  agentChatHandoff: null
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<NavigationState>(INITIAL_NAVIGATION_STATE);

  const navigate = useCallback((pageId: PageId, options?: NavigateOptions) => {
    const nextHandoff: AgentChatHandoff | null =
      pageId === "agent-chat" ? (options?.agentChatHandoff ?? null) : null;

    setState((previous) => ({
      ...previous,
      activePage: pageId,
      contextPanelMode: options?.contextPanelMode ?? defaultContextPanelModeForPage(pageId),
      agentChatHandoff: nextHandoff
    }));
  }, []);

  const clearAgentChatHandoff = useCallback(() => {
    setState((previous) => ({
      ...previous,
      agentChatHandoff: null
    }));
  }, []);

  const setContextPanelMode = useCallback((mode: ContextPanelMode) => {
    setState((previous) => ({
      ...previous,
      contextPanelMode: mode
    }));
  }, []);

  const setContextPanelCollapsed = useCallback((value: boolean) => {
    setState((previous) => ({
      ...previous,
      contextPanelCollapsed: value
    }));
  }, []);

  const toggleContextPanelCollapsed = useCallback(() => {
    setState((previous) => ({
      ...previous,
      contextPanelCollapsed: !previous.contextPanelCollapsed
    }));
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({
      ...state,
      isContextPanelHidden: state.contextPanelMode === "hidden" || isFullWidthPage(state.activePage),
      navigate,
      clearAgentChatHandoff,
      setContextPanelMode,
      setContextPanelCollapsed,
      toggleContextPanelCollapsed
    }),
    [clearAgentChatHandoff, navigate, setContextPanelCollapsed, setContextPanelMode, state, toggleContextPanelCollapsed]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): NavigationContextValue => {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error("useNavigation must be used within NavigationProvider.");
  }
  return value;
};
