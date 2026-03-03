import { useTranslation } from "react-i18next";
import { useChatContext } from "../context/ChatContext";
import type { RuntimeSummary } from "../types/runtime";

type SettingsPageProps = {
  orgId: string;
  watchPath: string;
  language: string;
  userEmail: string;
  runtimeSummary: RuntimeSummary;
  isAuthPending: boolean;
  onOpenWatchFolder: () => void;
  onSignOut: () => void;
  onChangeLanguage: (language: "ko" | "en") => void;
};

export const SettingsPage = ({
  orgId,
  watchPath,
  language,
  userEmail,
  runtimeSummary,
  isAuthPending,
  onOpenWatchFolder,
  onSignOut,
  onChangeLanguage
}: SettingsPageProps) => {
  const { t } = useTranslation();
  const { isActionPending } = useChatContext();

  return (
    <div className="app-shell ui-dashboard-shell">
      <section className="panel">
        <p className="eyebrow">{t("ui.pages.settings.eyebrow")}</p>
        <h1>{t("ui.pages.settings.title")}</h1>
        <p className="description">{t("ui.pages.settings.description")}</p>
        <div className="meta-grid">
          <p>
            Organization ID: <strong>{orgId}</strong>
          </p>
          <p>
            Signed-in User: <strong>{userEmail}</strong>
          </p>
          <p>
            Watch Folder: <strong>{watchPath}</strong>
          </p>
          <p>
            Platform: <strong>{runtimeSummary.platform}</strong>
          </p>
          <p>
            Watcher Running: <strong>{runtimeSummary.isRunning ? "Yes" : "No"}</strong>
          </p>
          <p>
            Active Files: <strong>{runtimeSummary.fileCount}</strong>
          </p>
          <p>
            Last Scan Count: <strong>{runtimeSummary.scanCount}</strong>
          </p>
          <p>
            Active Session: <strong>{runtimeSummary.activeSessionId}</strong>
          </p>
        </div>
        <div className="button-row">
          <button className={language === "ko" ? "primary" : ""} onClick={() => onChangeLanguage("ko")}>
            Korean
          </button>
          <button className={language === "en" ? "primary" : ""} onClick={() => onChangeLanguage("en")}>
            English
          </button>
        </div>
        <div className="button-row">
          <button onClick={onOpenWatchFolder}>Open Watch Folder</button>
          <button disabled={isActionPending || isAuthPending} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
};
