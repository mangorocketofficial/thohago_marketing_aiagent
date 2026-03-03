import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";

type BrandReviewPageProps = {
  supabase: SupabaseClient | null;
  orgId: string | null;
  dataAccessMessage: string;
  formatDateTime: (iso: string | null | undefined) => string;
};

type BrandSettingsRow = {
  result_document: unknown;
  memory_md: string | null;
  updated_at: string | null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const extractReviewMarkdown = (row: BrandSettingsRow | null): string => {
  if (!row) {
    return "";
  }

  const resultDocument = toRecord(row.result_document);
  const nestedReview =
    typeof resultDocument.review_markdown === "string" ? resultDocument.review_markdown.trim() : "";
  if (nestedReview) {
    return nestedReview;
  }

  const memoryMarkdown = typeof row.memory_md === "string" ? row.memory_md.trim() : "";
  return memoryMarkdown;
};

export const BrandReviewPage = ({
  supabase,
  orgId,
  dataAccessMessage,
  formatDateTime
}: BrandReviewPageProps) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [row, setRow] = useState<BrandSettingsRow | null>(null);

  const markdown = useMemo(() => extractReviewMarkdown(row), [row]);

  const loadBrandReview = async () => {
    if (!supabase || !orgId) {
      setRow(null);
      setNotice(dataAccessMessage || t("ui.pages.brandReview.dataAccessUnavailable"));
      return;
    }

    setIsLoading(true);
    setNotice("");
    try {
      const { data, error } = await supabase
        .from("org_brand_settings")
        .select("result_document,memory_md,updated_at")
        .eq("org_id", orgId)
        .maybeSingle();

      if (error) {
        setRow(null);
        setNotice(`${t("ui.pages.brandReview.loadFailed")} ${error.message}`);
        return;
      }

      setRow((data ?? null) as BrandSettingsRow | null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBrandReview();
    // Intentionally reload when data-access identity changes.
  }, [supabase, orgId]);

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.brandReview.eyebrow")}</p>
        <h1>{t("ui.pages.brandReview.title")}</h1>
        <p className="description">{t("ui.pages.brandReview.description")}</p>
        <div className="ui-meta-row">
          <p className="meta">
            {t("ui.pages.brandReview.lastUpdated")}:{" "}
            <strong>{row?.updated_at ? formatDateTime(row.updated_at) : t("ui.common.notAvailable")}</strong>
          </p>
          <button type="button" onClick={() => void loadBrandReview()} disabled={isLoading}>
            {t("ui.common.refresh")}
          </button>
        </div>
      </section>

      <section className="panel ui-page-panel">
        <h2>{t("ui.pages.brandReview.documentTitle")}</h2>
        {isLoading ? <p className="empty">{t("ui.pages.brandReview.loading")}</p> : null}

        {!isLoading && markdown ? (
          <article className="markdown-card ui-markdown-card">
            <div className="markdown-viewer ui-markdown-viewer">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          </article>
        ) : null}

        {!isLoading && !markdown ? <p className="empty">{t("ui.pages.brandReview.empty")}</p> : null}
        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </div>
  );
};
