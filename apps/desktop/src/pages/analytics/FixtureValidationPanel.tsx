import { toOrderedAnalyticsChannels } from "@repo/analytics";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveChannelPresentation } from "../../components/scheduler/card-presentation";
import { runWfkFixtureValidation, type FixtureValidationReport } from "./fixture-validation";

const formatScore = (value: number | null): string => (typeof value === "number" ? value.toFixed(1) : "-");

const truncate = (text: string | null, max: number): string => {
  if (!text) {
    return "-";
  }
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const formatDate = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
};

const scoreClass = (score: number | null): string => {
  if (typeof score !== "number") {
    return "";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 45) {
    return "mid";
  }
  return "low";
};

export const FixtureValidationPanel = () => {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<FixtureValidationReport | null>(null);
  const [showQa, setShowQa] = useState(false);

  const runFixtureValidation = async () => {
    setIsRunning(true);
    setNotice("");
    try {
      const response = await window.desktopRuntime.metrics.loadWfkFixtures();
      if (!response.ok || !response.fixtures) {
        setReport(null);
        setNotice(response.message || t("ui.pages.analytics.fixture.loadFailed"));
        return;
      }

      const nextReport = runWfkFixtureValidation(response.fixtures);
      setReport(nextReport);
      const passed = nextReport.checks.filter((row) => row.passed).length;
      setNotice(
        t("ui.pages.analytics.fixture.completed", {
          passed,
          total: nextReport.checks.length
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t("ui.pages.analytics.fixture.loadFailed");
      setNotice(message);
    } finally {
      setIsRunning(false);
    }
  };

  const passedCount = useMemo(() => report?.checks.filter((row) => row.passed).length ?? 0, [report]);
  const failedCount = useMemo(() => report?.checks.filter((row) => !row.passed).length ?? 0, [report]);

  const avgScore = useMemo(() => {
    if (!report) {
      return null;
    }
    const scored = report.scoredRows.filter((row) => typeof row.performance_score === "number");
    if (scored.length === 0) {
      return null;
    }
    return scored.reduce((sum, row) => sum + (row.performance_score ?? 0), 0) / scored.length;
  }, [report]);

  const channels = useMemo(() => {
    if (!report) {
      return [];
    }
    return toOrderedAnalyticsChannels([
      ...Object.keys(report.derived.best_publish_times),
      ...Object.keys(report.derived.channel_recommendations)
    ]);
  }, [report]);

  const topScored = useMemo(
    () =>
      report
        ? [...report.scoredRows]
            .filter((row) => typeof row.performance_score === "number")
            .sort((left, right) => (right.performance_score ?? 0) - (left.performance_score ?? 0))
        : [],
    [report]
  );

  return (
    <>
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.analytics.fixture.eyebrow")}</p>
        <h2>{t("ui.pages.analytics.fixture.title")}</h2>
        <p className="sub-description">{t("ui.pages.analytics.fixture.description")}</p>

        <div className="button-row">
          <button type="button" className="primary" onClick={() => void runFixtureValidation()} disabled={isRunning}>
            {isRunning ? t("ui.pages.analytics.fixture.running") : t("ui.pages.analytics.fixture.runButton")}
          </button>
        </div>
      </section>

      {report ? (
        <>
          <section className="panel ui-page-panel ui-grid-3">
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.fixture.stat.totalContents")}</p>
              <p className="ui-insight-stat-value">{report.fixturesMeta.publishedCount}</p>
            </article>
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.fixture.stat.avgScore")}</p>
              <p className="ui-insight-stat-value">{avgScore !== null ? avgScore.toFixed(1) : "-"}</p>
            </article>
            <article className="ui-insight-stat-card">
              <p className="ui-insight-stat-label">{t("ui.pages.analytics.fixture.stat.trackedChannels")}</p>
              <p className="ui-insight-stat-value">{channels.length}</p>
            </article>
          </section>

          <section className="panel ui-page-panel ui-grid-2">
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.bestPublishTimesTitle")}</h2>
              <div className="table-wrap ui-insight-table-wrap">
                <table className="ui-insight-table">
                  <thead>
                    <tr>
                      <th>{t("ui.pages.analytics.table.channel")}</th>
                      <th>{t("ui.pages.analytics.table.bestTime")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.derived.best_publish_times).length === 0 ? (
                      <tr>
                        <td colSpan={2}>{t("ui.pages.analytics.channelRecommendationEmpty")}</td>
                      </tr>
                    ) : (
                      channels.map((channel) => (
                        <tr key={channel}>
                          <td>{resolveChannelPresentation(channel).label}</td>
                          <td>{report.derived.best_publish_times[channel] ?? t("ui.common.notAvailable")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.topCtaTitle")}</h2>
              {report.derived.top_cta_phrases.length === 0 ? (
                <p className="empty">{t("ui.pages.analytics.channelRecommendationEmpty")}</p>
              ) : (
                <ol className="ui-insight-list">
                  {report.derived.top_cta_phrases.map((phrase) => (
                    <li key={phrase}>{phrase}</li>
                  ))}
                </ol>
              )}
            </article>
          </section>

          <section className="panel ui-page-panel ui-grid-2">
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.contentPatternTitle")}</h2>
              <p className="ui-insight-summary">{report.derived.content_pattern_summary || "-"}</p>
            </article>
            <article className="ui-insight-card">
              <h2>{t("ui.pages.analytics.fixture.stat.topCtaCount")}</h2>
              <p className="ui-insight-stat-value">{report.derived.top_cta_phrases.length}</p>
            </article>
          </section>

          <section className="panel ui-page-panel">
            <h2>{t("ui.pages.analytics.channelRecommendationsTitle")}</h2>
            {channels.length === 0 ? (
              <p className="empty">{t("ui.pages.analytics.channelRecommendationEmpty")}</p>
            ) : (
              <div className="ui-insight-recommendation-grid">
                {channels.map((channel) => (
                  <article key={channel} className="ui-insight-card ui-insight-recommendation-card">
                    <div className="ui-insight-recommendation-head">
                      <h3>{resolveChannelPresentation(channel).label}</h3>
                    </div>
                    <p>{report.derived.channel_recommendations[channel] ?? "-"}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel ui-page-panel">
            <h2>{t("ui.pages.analytics.fixture.scoredContents.title")}</h2>
            <div className="table-wrap ui-insight-table-wrap">
              <table className="ui-insight-table">
                <thead>
                  <tr>
                    <th>{t("ui.pages.analytics.fixture.scoredContents.channel")}</th>
                    <th>{t("ui.pages.analytics.fixture.scoredContents.body")}</th>
                    <th>{t("ui.pages.analytics.fixture.scoredContents.publishedAt")}</th>
                    <th>{t("ui.pages.analytics.fixture.scoredContents.score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topScored.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={`ui-channel-badge ${row.channel}`}>
                          {resolveChannelPresentation(row.channel).label}
                        </span>
                      </td>
                      <td className="ui-fixture-body-cell">{truncate(row.body ?? null, 60)}</td>
                      <td>{formatDate(row.published_at ?? null)}</td>
                      <td>
                        <span className={`ui-fixture-score-badge ${scoreClass(row.performance_score)}`}>
                          {formatScore(row.performance_score)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel ui-page-panel">
            <button type="button" className="ui-fixture-qa-toggle" onClick={() => setShowQa((prev) => !prev)}>
              {t("ui.pages.analytics.fixture.qaSection.toggle", {
                passed: passedCount,
                total: report.checks.length
              })}
              <span className={`ui-fixture-qa-indicator ${failedCount === 0 ? "pass" : "fail"}`}>
                {failedCount === 0 ? "PASS" : `${failedCount} failed`}
              </span>
            </button>

            {showQa ? (
              <div className="table-wrap ui-insight-table-wrap">
                <table className="ui-insight-table">
                  <thead>
                    <tr>
                      <th>{t("ui.pages.analytics.fixture.qaSection.checkId")}</th>
                      <th>{t("ui.pages.analytics.fixture.qaSection.result")}</th>
                      <th>{t("ui.pages.analytics.fixture.qaSection.description")}</th>
                      <th>{t("ui.pages.analytics.fixture.qaSection.detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.checks.map((check) => (
                      <tr key={check.id}>
                        <td>{check.id}</td>
                        <td>
                          <span className={`ui-fixture-pill ${check.passed ? "pass" : "fail"}`}>
                            {check.passed
                              ? t("ui.pages.analytics.fixture.result.pass")
                              : t("ui.pages.analytics.fixture.result.fail")}
                          </span>
                        </td>
                        <td>{check.title}</td>
                        <td>{check.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="panel ui-page-panel">
          <p className="empty">{t("ui.pages.analytics.fixture.empty")}</p>
        </section>
      )}

      {notice ? <p className="notice">{notice}</p> : null}
    </>
  );
};
