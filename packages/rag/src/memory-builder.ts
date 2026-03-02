import type { Campaign, MemoryMd, OrgBrandSettings } from "@repo/types";

const listToMarkdown = (items: string[]): string => {
  if (!items.length) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
};

const formatCampaignLine = (campaign: Campaign): string =>
  `- ${campaign.title} (${campaign.status}) / channels: ${campaign.channels.join(", ")}`;

export const estimateTokenCount = (value: string): number => Math.ceil(value.length / 4);

export const buildMemoryMd = (
  brandSettings: OrgBrandSettings,
  activeCampaigns: Campaign[],
  generatedAt = new Date().toISOString()
): MemoryMd => {
  const sections: string[] = [];
  const title = brandSettings.brand_summary?.trim() ? `${brandSettings.brand_summary} Marketing Memory` : "Marketing Memory";

  sections.push(`# ${title}`);
  sections.push("");

  sections.push("## Long-Term Brand Rules");
  sections.push(`Tone: ${brandSettings.detected_tone ?? "unknown"}`);
  sections.push(`Tone detail: ${brandSettings.tone_description ?? "none"}`);
  sections.push("");
  sections.push("### Forbidden words");
  sections.push(listToMarkdown(brandSettings.forbidden_words));
  sections.push("");
  sections.push("### Forbidden topics");
  sections.push(listToMarkdown(brandSettings.forbidden_topics));
  sections.push("");
  sections.push("### Key themes");
  sections.push(listToMarkdown(brandSettings.key_themes));
  sections.push("");

  sections.push("## Current Active Campaigns");
  if (!activeCampaigns.length) {
    sections.push("- none");
  } else {
    sections.push(activeCampaigns.map(formatCampaignLine).join("\n"));
  }
  sections.push("");

  sections.push("## Retrieval Notes");
  sections.push("- Prioritize forbidden expression enforcement.");
  sections.push("- Prefer high-performance historical patterns when metadata is available.");
  sections.push("");
  sections.push(`Generated at: ${generatedAt}`);

  const markdown = sections.join("\n").trim();
  return {
    markdown,
    token_estimate: estimateTokenCount(markdown),
    generated_at: generatedAt
  };
};
