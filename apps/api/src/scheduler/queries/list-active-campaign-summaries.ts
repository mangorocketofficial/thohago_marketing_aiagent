import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";

export type ActiveCampaignSummary = {
  id: string;
  title: string;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const listActiveCampaignSummaries = async (orgId: string): Promise<ActiveCampaignSummary[]> => {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("id,title,status")
    .eq("org_id", orgId)
    .in("status", ["draft", "approved", "active"])
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load active campaign summaries: ${error.message}`);
  }

  return ((data as Record<string, unknown>[] | null) ?? [])
    .map((row) => {
      const id = asString(row.id).trim();
      if (!id) {
        return null;
      }
      const title = asString(row.title).trim() || "Untitled campaign";
      return {
        id,
        title
      } satisfies ActiveCampaignSummary;
    })
    .filter((row): row is ActiveCampaignSummary => !!row);
};
