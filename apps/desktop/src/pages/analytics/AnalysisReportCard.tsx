import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { AnalysisReportRecord } from "@repo/types";

type AnalysisReportCardProps = {
  report: AnalysisReportRecord | null;
  notice: string;
  isLoading: boolean;
  isTriggering: boolean;
  onTriggerAnalysis: () => void;
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const AnalysisReportCard = ({
  report,
  notice,
  isLoading,
  isTriggering,
  onTriggerAnalysis
}: AnalysisReportCardProps) => {
  const { t } = useTranslation();
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  return (
    <>
      <section className="panel ui-page-panel">
        <div className="ui-insight-card">
          <div className="ui-analysis-report-head">
            <div>
              <h2>{t("ui.pages.analytics.analysis.title")}</h2>
              <p className="sub-description">{t("ui.pages.analytics.analysis.description")}</p>
            </div>
            <div className="ui-analysis-report-actions">
              <button type="button" onClick={onTriggerAnalysis} disabled={isTriggering}>
                {isTriggering
                  ? t("ui.pages.analytics.analysis.refreshing")
                  : t("ui.pages.analytics.analysis.refresh")}
              </button>
              <button type="button" onClick={() => setIsViewerOpen(true)} disabled={!report}>
                {t("ui.pages.analytics.analysis.viewFull")}
              </button>
            </div>
          </div>

          {notice ? <p className="notice">{notice}</p> : null}
          {isLoading ? <p className="empty">{t("ui.pages.analytics.analysis.loading")}</p> : null}
          {!isLoading && !report ? <p className="empty">{t("ui.pages.analytics.analysis.empty")}</p> : null}

          {!isLoading && report ? (
            <>
              <div className="ui-analysis-report-meta">
                <span>
                  {t("ui.pages.analytics.analysis.analyzedAt")}: <strong>{formatDateTime(report.analyzed_at)}</strong>
                </span>
                <span>
                  {t("ui.pages.analytics.analysis.contentCount")}: <strong>{report.content_count.toLocaleString()}</strong>
                </span>
                <span>
                  {t("ui.pages.analytics.analysis.model")}: <strong>{report.model_used}</strong>
                </span>
              </div>

              <p className="ui-analysis-report-summary">{report.summary}</p>

              {report.key_actions.length > 0 ? (
                <>
                  <h3>{t("ui.pages.analytics.analysis.keyActions")}</h3>
                  <ol className="ui-analysis-report-key-actions">
                    {report.key_actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ol>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {isViewerOpen && report ? (
        <div className="ui-session-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ui-session-modal ui-analysis-report-modal">
            <div className="ui-session-modal-head">
              <h4>{t("ui.pages.analytics.analysis.title")}</h4>
              <button type="button" onClick={() => setIsViewerOpen(false)}>
                {t("ui.pages.analytics.analysis.close")}
              </button>
            </div>

            <div className="ui-session-modal-body">
              <div className="ui-analysis-report-meta">
                <span>
                  {t("ui.pages.analytics.analysis.analyzedAt")}: <strong>{formatDateTime(report.analyzed_at)}</strong>
                </span>
                <span>
                  {t("ui.pages.analytics.analysis.contentCount")}: <strong>{report.content_count.toLocaleString()}</strong>
                </span>
                <span>
                  {t("ui.pages.analytics.analysis.model")}: <strong>{report.model_used}</strong>
                </span>
              </div>

              <article className="ui-analysis-report-markdown">
                <ReactMarkdown>{report.markdown}</ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
