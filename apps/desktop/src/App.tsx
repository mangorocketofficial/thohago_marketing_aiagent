import { useEffect, useMemo, useState } from "react";

type UiMode = "loading" | "onboarding" | "dashboard";
type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];

const App = () => {
  const [mode, setMode] = useState<UiMode>("loading");
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [files, setFiles] = useState<RendererFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [notice, setNotice] = useState("");
  const [scanCount, setScanCount] = useState<number | null>(null);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        if (a.activityFolder !== b.activityFolder) {
          return a.activityFolder.localeCompare(b.activityFolder);
        }
        return b.detectedAt.localeCompare(a.detectedAt);
      }),
    [files]
  );

  useEffect(() => {
    const runtime = window.desktopRuntime;

    const init = async () => {
      const nextStatus = await runtime.watcher.getStatus();
      setStatus(nextStatus);
      const nextFiles = await runtime.watcher.getFiles();
      setFiles(nextFiles);
      setMode(nextStatus.requiresOnboarding ? "onboarding" : "dashboard");
    };

    void init();

    const offIndexed = runtime.watcher.onFileIndexed((entry) => {
      setFiles((prev) => {
        const withoutOld = prev.filter((item) => item.relativePath !== entry.relativePath);
        return [entry, ...withoutOld];
      });
    });

    const offDeleted = runtime.watcher.onFileDeleted(({ relativePath }) => {
      setFiles((prev) => prev.filter((item) => item.relativePath !== relativePath));
    });

    const offScan = runtime.watcher.onScanComplete(({ count }) => {
      setScanCount(count);
      setNotice(`Initial scan completed: ${count} file(s) indexed.`);
    });

    const offStatus = runtime.watcher.onStatusChanged((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.requiresOnboarding) {
        setMode("onboarding");
      } else {
        setMode("dashboard");
      }
    });

    const offShowOnboarding = runtime.watcher.onShowOnboarding(() => {
      setMode("onboarding");
    });

    return () => {
      offIndexed();
      offDeleted();
      offScan();
      offStatus();
      offShowOnboarding();
    };
  }, []);

  const chooseFolder = async () => {
    const path = await window.desktopRuntime.onboarding.chooseFolder();
    if (path) {
      setSelectedPath(path);
      setNotice("");
    }
  };

  const createFolder = async () => {
    const path = await window.desktopRuntime.onboarding.createFolder();
    if (path) {
      setSelectedPath(path);
      setNotice("");
    }
  };

  const completeOnboarding = async () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }

    try {
      const nextStatus = await window.desktopRuntime.onboarding.complete(selectedPath);
      setStatus(nextStatus);
      setMode("dashboard");
      const nextFiles = await window.desktopRuntime.watcher.getFiles();
      setFiles(nextFiles);
      setNotice("Watcher started successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete onboarding.";
      setNotice(message);
    }
  };

  const openWatchFolder = async () => {
    const result = await window.desktopRuntime.watcher.openFolder();
    if (!result.ok) {
      setNotice(result.message ?? "Failed to open watch folder.");
    }
  };

  if (mode === "loading") {
    return (
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">Phase 1-4</p>
          <h1>Preparing Desktop Runtime</h1>
          <p className="description">Loading watcher status...</p>
        </section>
      </main>
    );
  }

  if (mode === "onboarding") {
    return (
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">First Run Setup</p>
          <h1>Choose Marketing Folder</h1>
          <p className="description">
            Organize files by activity folder. Example: <code>탄자니아교육봉사/현장사진01.jpg</code>
          </p>
          <div className="button-row">
            <button onClick={() => void chooseFolder()}>Choose Existing Folder</button>
            <button onClick={() => void createFolder()}>Create New Folder</button>
          </div>
          <p className="meta">
            Selected: <strong>{selectedPath || "None"}</strong>
          </p>
          <div className="button-row">
            <button className="primary" onClick={() => void completeOnboarding()}>
              Save and Start Watcher
            </button>
          </div>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Phase 1-4 Runtime</p>
        <h1>Electron File Watcher</h1>
        <p className="description">
          Main process watches local files and emits live events to renderer via IPC.
        </p>
        <div className="meta-grid">
          <p>
            Platform: <strong>{window.desktopRuntime.platform}</strong>
          </p>
          <p>
            Watch Path: <strong>{status?.watchPath ?? "-"}</strong>
          </p>
          <p>
            Running: <strong>{status?.isRunning ? "Yes" : "No"}</strong>
          </p>
          <p>
            Active Files: <strong>{status?.fileCount ?? 0}</strong>
          </p>
          <p>
            Last Scan Count: <strong>{scanCount ?? 0}</strong>
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => void openWatchFolder()}>Open Watch Folder</button>
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiles.length === 0 ? (
                <tr>
                  <td colSpan={4}>No active files indexed yet.</td>
                </tr>
              ) : (
                sortedFiles.map((entry) => (
                  <tr key={entry.relativePath}>
                    <td>{entry.activityFolder}</td>
                    <td>{entry.fileName}</td>
                    <td>{entry.fileType}</td>
                    <td>{entry.fileSize.toLocaleString()} B</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

export default App;
