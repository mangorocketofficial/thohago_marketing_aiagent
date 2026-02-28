const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, cb) => {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);

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
  onboarding: {
    saveDraft: (draftPatch) => ipcRenderer.invoke("onboarding:save-draft", { draftPatch }),
    setOrgId: (orgId) => ipcRenderer.invoke("onboarding:set-org-id", { orgId }),
    bootstrapOrg: (payload) => ipcRenderer.invoke("onboarding:bootstrap-org", payload),
    chooseFolder: () => ipcRenderer.invoke("onboarding:choose-folder"),
    createFolder: () => ipcRenderer.invoke("onboarding:create-folder"),
    complete: (payload) => ipcRenderer.invoke("onboarding:complete", payload)
  },
  chat: {
    onActionResult: (cb) => subscribe("chat:action-result", cb),
    onActionError: (cb) => subscribe("chat:action-error", cb),
    getConfig: () => ipcRenderer.invoke("chat:get-config"),
    getActiveSession: () => ipcRenderer.invoke("chat:get-active-session"),
    sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
    approveCampaign: (payload) => ipcRenderer.invoke("chat:approve-campaign", payload),
    approveContent: (payload) => ipcRenderer.invoke("chat:approve-content", payload),
    reject: (payload) => ipcRenderer.invoke("chat:reject", payload)
  }
});
