import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Campaign } from "@repo/types";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { useNavigation } from "../context/NavigationContext";

type CampaignPlanPageProps = {
  supabase: SupabaseClient | null;
  orgId: string | null;
  dataAccessMessage: string;
  formatDateTime: (iso: string | null | undefined) => string;
};

export const CampaignPlanPage = ({ supabase, orgId, dataAccessMessage, formatDateTime }: CampaignPlanPageProps) => {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    if (!supabase || !orgId) {
      setCampaigns([]);
      setNotice(dataAccessMessage || t("ui.pages.campaignPlan.dataAccessUnavailable"));
      return;
    }

    setIsLoading(true);
    setNotice("");
    try {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        setCampaigns([]);
        setNotice(`${t("ui.pages.campaignPlan.loadFailed")} ${error.message}`);
        return;
      }

      setCampaigns((data ?? []) as Campaign[]);
    } finally {
      setIsLoading(false);
    }
  }, [dataAccessMessage, orgId, supabase, t]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (campaigns.length === 0) {
      setSelectedCampaignId(null);
      return;
    }

    if (!selectedCampaignId || !campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0] ?? null,
    [campaigns, selectedCampaignId]
  );
  const selectedCampaignPlanDocument = (selectedCampaign?.plan_document ?? "").trim();

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.campaignPlan.eyebrow")}</p>
        <h1>{t("ui.pages.campaignPlan.title")}</h1>
        <p className="description">{t("ui.pages.campaignPlan.description")}</p>
        <div className="ui-meta-row">
          <button type="button" onClick={() => void loadCampaigns()} disabled={isLoading}>
            {t("ui.common.refresh")}
          </button>
        </div>
      </section>

      <section className="panel ui-page-panel ui-campaign-plan-board">
        <div className="ui-campaign-plan-top-row">
          <article className="subpanel ui-campaign-plan-list-panel">
            <h2>{t("ui.pages.campaignPlan.listTitle")}</h2>
            <p className="sub-description">{t("ui.pages.campaignPlan.listDescription")}</p>
            <div className="ui-campaign-plan-list">
              {isLoading ? (
                <p className="empty">{t("ui.pages.campaignPlan.loading")}</p>
              ) : campaigns.length === 0 ? (
                <p className="empty">{t("ui.pages.campaignPlan.empty")}</p>
              ) : (
                campaigns.map((campaign) => {
                  const isActive = selectedCampaign?.id === campaign.id;
                  return (
                    <button
                      key={campaign.id}
                      type="button"
                      className={`ui-campaign-plan-item ${isActive ? "is-active" : ""}`}
                      onClick={() => setSelectedCampaignId(campaign.id)}
                    >
                      <p>
                        <strong>{campaign.title}</strong>
                      </p>
                      <p>{campaign.activity_folder || "-"}</p>
                      <p>
                        {campaign.plan.post_count} posts / {campaign.plan.duration_days} days
                      </p>
                      <p>{formatDateTime(campaign.created_at)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </article>

          <article className="subpanel ui-campaign-plan-summary-panel">
            <h2>{t("ui.pages.campaignPlan.detailTitle")}</h2>
            <p className="sub-description">{t("ui.pages.campaignPlan.detailDescription")}</p>

            {!selectedCampaign ? (
              <p className="empty">{t("ui.pages.campaignPlan.empty")}</p>
            ) : (
              <div className="campaign-card">
                <p>
                  <strong>{selectedCampaign.title}</strong>
                </p>
                <p>
                  {t("ui.pages.campaignPlan.fields.activityFolder")}: {selectedCampaign.activity_folder || "-"}
                </p>
                <p>
                  {t("ui.pages.campaignPlan.fields.channels")}: {selectedCampaign.channels.join(", ") || "-"}
                </p>
                <p>
                  {t("ui.pages.campaignPlan.fields.schedule")}: {selectedCampaign.plan.post_count} posts /{" "}
                  {selectedCampaign.plan.duration_days} days
                </p>
                <p>
                  {t("ui.pages.campaignPlan.fields.createdAt")}: {formatDateTime(selectedCampaign.created_at)}
                </p>
                <p>
                  {t("ui.pages.campaignPlan.fields.updatedAt")}: {formatDateTime(selectedCampaign.updated_at)}
                </p>
                <div className="queue-item-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => navigate("scheduler")}
                  >
                    {t("ui.pages.campaignPlan.openInScheduler")}
                  </button>
                </div>
              </div>
            )}
          </article>
        </div>

        <article className="subpanel ui-campaign-plan-document-panel">
          <h2>{t("ui.pages.campaignPlan.detailContentTitle")}</h2>
          <p className="sub-description">{t("ui.pages.campaignPlan.detailContentDescription")}</p>

          {!selectedCampaign ? (
            <p className="empty">{t("ui.pages.campaignPlan.empty")}</p>
          ) : selectedCampaignPlanDocument ? (
            <article className="markdown-card ui-markdown-card">
              <div className="markdown-viewer ui-markdown-viewer">
                <ReactMarkdown>{selectedCampaignPlanDocument}</ReactMarkdown>
              </div>
            </article>
          ) : (
            <p className="empty">{t("ui.pages.campaignPlan.noDetail")}</p>
          )}
        </article>
      </section>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  );
};
