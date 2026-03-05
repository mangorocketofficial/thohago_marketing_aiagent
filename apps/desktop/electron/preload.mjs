import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");
const { contextBridge, ipcRenderer } = electron;

const subscribe = (channel, cb) => {
  const listener = (_, payload) => cb(payload);
  ipcRenderer.on(channel, listener);

  // Return unsubscribe for renderer cleanup.
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld("desktopRuntime", {
  platform: process.platform,
  app: {
    getConfig: () => ipcRenderer.invoke("app:get-config"),
    setLanguage: (language) => ipcRenderer.invoke("app:set-language", { language })
  },
  auth: {
    getStoredSession: () => ipcRenderer.invoke("auth:get-stored-session"),
    saveSession: (payload) => ipcRenderer.invoke("auth:save-session", payload),
    clearSession: () => ipcRenderer.invoke("auth:clear-session"),
    startGoogleOAuth: () => ipcRenderer.invoke("auth:start-google-oauth")
  },
  watcher: {
    onFileIndexed: (cb) => subscribe("file:indexed", cb),
    onFileDeleted: (cb) => subscribe("file:deleted", cb),
    onScanComplete: (cb) => subscribe("file:scan-complete", cb),
    onStatusChanged: (cb) => subscribe("watcher:status-changed", cb),
    onShowOnboarding: (cb) => subscribe("app:show-onboarding", cb),
    getStatus: () => ipcRenderer.invoke("watcher:get-status"),
    getFiles: () => ipcRenderer.invoke("watcher:get-files"),
    openFolder: () => ipcRenderer.invoke("watcher:open-folder")
  },
  content: {
    saveBody: (payload) => ipcRenderer.invoke("content:save-body", payload),
    saveInstagramMetadata: (payload) => ipcRenderer.invoke("content:save-instagram-metadata", payload),
    saveLocal: (payload) => ipcRenderer.invoke("content:save-local", payload),
    listInstagramTemplates: () => ipcRenderer.invoke("content:list-instagram-templates"),
    composeLocal: (payload) => ipcRenderer.invoke("content:compose-local", payload),
    loadActivityThumbnails: (payload) => ipcRenderer.invoke("content:load-activity-thumbnails", payload),
    downloadImage: (payload) => ipcRenderer.invoke("content:download-image", payload)
  },
  onboarding: {
    onCrawlProgress: (cb) => subscribe("onboarding:crawl-progress", cb),
    onCrawlComplete: (cb) => subscribe("onboarding:crawl-complete", cb),
    saveDraft: (draftPatch) => ipcRenderer.invoke("onboarding:save-draft", { draftPatch }),
    setOrgId: (orgId) => ipcRenderer.invoke("onboarding:set-org-id", { orgId }),
    bootstrapOrg: (payload) => ipcRenderer.invoke("onboarding:bootstrap-org", payload),
    getCrawlState: () => ipcRenderer.invoke("onboarding:get-crawl-state"),
    startCrawl: (payload) => ipcRenderer.invoke("onboarding:start-crawl", payload),
    saveInterview: (payload) => ipcRenderer.invoke("onboarding:save-interview", payload),
    synthesize: (payload) => ipcRenderer.invoke("onboarding:synthesize", payload),
    getLastSynthesis: () => ipcRenderer.invoke("onboarding:get-last-synthesis"),
    chooseFolder: () => ipcRenderer.invoke("onboarding:choose-folder"),
    createFolder: () => ipcRenderer.invoke("onboarding:create-folder"),
    complete: (payload) => ipcRenderer.invoke("onboarding:complete", payload)
  },
  chat: {
    onActionResult: (cb) => subscribe("chat:action-result", cb),
    onActionError: (cb) => subscribe("chat:action-error", cb),
    getConfig: () => ipcRenderer.invoke("chat:get-config"),
    listSkills: () => ipcRenderer.invoke("chat:list-skills"),
    getActiveSession: () => ipcRenderer.invoke("chat:get-active-session"),
    listSessions: (payload) => ipcRenderer.invoke("chat:list-sessions", payload),
    listInboxItems: (payload) => ipcRenderer.invoke("chat:list-inbox-items", payload),
    listScheduledContent: (payload) => ipcRenderer.invoke("chat:list-scheduled-content", payload),
    listScheduledContentDay: (payload) => ipcRenderer.invoke("chat:list-scheduled-content-day", payload),
    rescheduleSlot: (payload) => ipcRenderer.invoke("chat:reschedule-slot", payload),
    listActiveCampaignSummaries: () => ipcRenderer.invoke("chat:list-active-campaign-summaries"),
    listFolderUpdates: (payload) => ipcRenderer.invoke("chat:list-folder-updates", payload),
    acknowledgeFolderUpdates: (payload) => ipcRenderer.invoke("chat:acknowledge-folder-updates", payload),
    createSession: (payload) => ipcRenderer.invoke("chat:create-session", payload),
    getRecommendedSession: (payload) => ipcRenderer.invoke("chat:get-recommended-session", payload),
    sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
    approveCampaign: (payload) => ipcRenderer.invoke("chat:approve-campaign", payload),
    approveContent: (payload) => ipcRenderer.invoke("chat:approve-content", payload),
    reject: (payload) => ipcRenderer.invoke("chat:reject", payload),
    dispatchAction: (payload) => ipcRenderer.invoke("chat:dispatch-action", payload)
  }
});
