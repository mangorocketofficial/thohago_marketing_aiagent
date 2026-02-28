import { contextBridge, ipcRenderer } from "electron";

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
    chooseFolder: () => ipcRenderer.invoke("onboarding:choose-folder"),
    createFolder: () => ipcRenderer.invoke("onboarding:create-folder"),
    complete: (watchPath) => ipcRenderer.invoke("onboarding:complete", { watchPath })
  }
});
