import { Router } from "express";
import { requireUserJwt } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";

const MAX_TEXT_LENGTH = 4000;
const MAX_JSON_LENGTH = 120_000;
const MAX_URL_LENGTH = 1024;

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseRequiredString = (value: unknown, field: string, maxLength = 200): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "invalid_payload", `${field} is too long.`);
  }
  return trimmed;
};

const parseOptionalUrl = (value: unknown): string | null => {
  const direct = parseOptionalString(value);
  if (!direct) {
    return null;
  }
  if (direct.length > MAX_URL_LENGTH) {
    throw new HttpError(400, "invalid_payload", "URL is too long.");
  }
  try {
    const parsed = new URL(direct);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
    return direct;
  } catch {
    throw new HttpError(400, "invalid_payload", "Invalid URL format.");
  }
};

const parseObject = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const parseJsonSize = (value: unknown, field: string, maxLength = MAX_JSON_LENGTH): void => {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length > maxLength) {
    throw new HttpError(413, "payload_too_large", `${field} is too large.`);
  }
};

const resolveOrgName = (value: unknown, fallbackEmail: string | null): string => {
  const direct = parseOptionalString(value);
  if (direct) {
    return direct.slice(0, 120);
  }

  if (fallbackEmail) {
    const username = fallbackEmail.split("@")[0]?.trim();
    if (username) {
      return `${username} Organization`;
    }
  }

  return "My Organization";
};

const ensureUserProfile = async (params: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<void> => {
  const email = params.email ?? `${params.userId}@local.invalid`;
  const payload = {
    id: params.userId,
    email,
    name: params.name ?? null
  };

  const { error } = await supabaseAdmin.from("users").upsert(payload, {
    onConflict: "id"
  });

  if (error) {
    throw new HttpError(500, "db_error", `Failed to upsert user profile: ${error.message}`);
  }
};

type MembershipRow = {
  org_id: string;
  role: "owner" | "admin" | "member";
  organizations?: {
    id: string;
    name: string;
    org_type: string;
  } | null;
};

const getExistingMembership = async (userId: string): Promise<MembershipRow | null> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("org_id, role, organizations(id, name, org_type)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }

  return (data as MembershipRow | null) ?? null;
};

const requireOrgMembership = async (
  userId: string,
  orgId: string
): Promise<{ role: "owner" | "admin" | "member" }> => {
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to query organization membership: ${error.message}`);
  }
  if (!data?.role) {
    throw new HttpError(403, "forbidden", "You are not a member of this organization.");
  }

  return {
    role: data.role as "owner" | "admin" | "member"
  };
};

const createInitialOrg = async (params: {
  userId: string;
  orgName: string;
}): Promise<{ orgId: string; orgName: string; orgType: string }> => {
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: params.orgName,
      org_type: "nonprofit"
    })
    .select("id, name, org_type")
    .single();

  if (orgError || !org) {
    throw new HttpError(500, "db_error", `Failed to create organization: ${orgError?.message ?? "unknown"}`);
  }

  const { error: memberError } = await supabaseAdmin.from("organization_members").insert({
    org_id: org.id,
    user_id: params.userId,
    role: "owner"
  });

  if (memberError) {
    throw new HttpError(500, "db_error", `Failed to create organization membership: ${memberError.message}`);
  }

  return {
    orgId: org.id,
    orgName: org.name,
    orgType: org.org_type
  };
};

const defaultInterviewAnswers = () => ({
  q1: "",
  q2: "",
  q3: "",
  q4: ""
});

const parseInterviewAnswers = (value: unknown) => {
  const obj = parseObject(value, "interview_answers");
  const next = defaultInterviewAnswers();
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    const raw = obj[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== "string") {
      throw new HttpError(400, "invalid_payload", `interview_answers.${key} must be a string.`);
    }
    const trimmed = raw.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new HttpError(400, "invalid_payload", `interview_answers.${key} is too long.`);
    }
    next[key] = trimmed;
  }
  return next;
};

const parseDelimitedList = (value: string, maxItems = 10): string[] => {
  return value
    .split(/[,\n/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const parseStringArray = (value: unknown, maxItems = 12): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const fallbackToneFromText = (text: string): string => {
  const lower = text.toLowerCase();
  if (/(warm|friendly|친근|다정|공감)/i.test(lower)) {
    return "warm";
  }
  if (/(formal|professional|전문|공식)/i.test(lower)) {
    return "professional";
  }
  if (/(bold|energetic|강렬|활기)/i.test(lower)) {
    return "energetic";
  }
  return "balanced";
};

const toneGuardrailsFromTone = (tone: string): string[] => {
  if (tone === "warm") {
    return ["Use empathetic language.", "Prefer plain words over jargon.", "Keep sentence rhythm natural."];
  }
  if (tone === "professional") {
    return ["Prioritize clarity over hype.", "Support claims with concrete facts.", "Use consistent terminology."];
  }
  if (tone === "energetic") {
    return ["Lead with action verbs.", "Keep messages concise and vivid.", "Avoid exaggerated promises."];
  }
  return ["Keep claims accurate.", "Use consistent brand terms.", "Balance friendliness with clarity."];
};

const extractWebsiteSignals = (crawlResult: Record<string, unknown>) => {
  const sources = parseObject(crawlResult.sources ?? {}, "crawl_result.sources");
  const website = parseObject(sources.website ?? {}, "crawl_result.sources.website");
  const naverBlog = parseObject(sources.naver_blog ?? {}, "crawl_result.sources.naver_blog");
  const websiteData =
    website.data && typeof website.data === "object" && !Array.isArray(website.data)
      ? (website.data as Record<string, unknown>)
      : {};
  const naverData =
    naverBlog.data && typeof naverBlog.data === "object" && !Array.isArray(naverBlog.data)
      ? (naverBlog.data as Record<string, unknown>)
      : {};

  const headings = parseStringArray(websiteData.headings);
  const paragraphs = parseStringArray(websiteData.paragraphs);
  const blogTitles = parseStringArray(
    Array.isArray(naverData.recent_posts)
      ? naverData.recent_posts.map((row) =>
          row && typeof row === "object" && typeof (row as Record<string, unknown>).title === "string"
            ? ((row as Record<string, unknown>).title as string)
            : ""
        )
      : []
  );

  return {
    headings,
    paragraphs,
    blogTitles
  };
};

const synthesizeProfile = (params: {
  crawlResult: Record<string, unknown>;
  interviewAnswers: ReturnType<typeof defaultInterviewAnswers>;
  orgId: string;
}) => {
  const { headings, paragraphs, blogTitles } = extractWebsiteSignals(params.crawlResult);
  const seedText = [params.interviewAnswers.q1, ...headings, ...blogTitles, ...paragraphs.slice(0, 2)].join(" ");
  const tone = fallbackToneFromText(seedText);
  const keyThemes = [...headings, ...blogTitles].slice(0, 6);
  const targetAudience = parseDelimitedList(params.interviewAnswers.q2, 6);
  const forbidden = parseDelimitedList(params.interviewAnswers.q3, 10);
  const campaignSeasons = parseDelimitedList(params.interviewAnswers.q4, 10);
  const confidenceNotes: string[] = [];

  const crawlSources = parseObject(params.crawlResult.sources ?? {}, "crawl_result.sources");
  const websiteStatus = parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.status) ?? "unknown";
  const naverStatus =
    parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.status) ?? "unknown";
  if (websiteStatus !== "done") {
    confidenceNotes.push("Website crawl was incomplete.");
  }
  if (naverStatus !== "done") {
    confidenceNotes.push("Naver Blog crawl was incomplete.");
  }
  if (!targetAudience.length) {
    confidenceNotes.push("Target audience was inferred with limited interview detail.");
  }

  const organizationSummary = [
    `Org ${params.orgId} onboarding profile generated from provided URLs and interview inputs.`,
    keyThemes.length ? `Detected themes: ${keyThemes.join(", ")}.` : "Detected themes are limited.",
    targetAudience.length ? `Primary audience: ${targetAudience.join(", ")}.` : "Primary audience not explicitly provided."
  ].join(" ");

  const profile = {
    organization_summary: organizationSummary,
    detected_tone: tone,
    tone_guardrails: toneGuardrailsFromTone(tone),
    key_themes: keyThemes,
    target_audience: targetAudience,
    forbidden_words: forbidden,
    forbidden_topics: [] as string[],
    campaign_seasons: campaignSeasons,
    content_directions: keyThemes.length
      ? keyThemes.slice(0, 3).map((theme) => `Create educational posts around "${theme}".`)
      : ["Create a baseline mission-intro post.", "Create one audience FAQ post."],
    confidence_notes: confidenceNotes.length ? confidenceNotes : ["Synthesis confidence is medium."]
  };

  const document = {
    generated_at: new Date().toISOString(),
    organization_summary: profile.organization_summary,
    detected_tone: profile.detected_tone,
    suggested_tone_guardrails: profile.tone_guardrails,
    key_themes: profile.key_themes,
    target_audience: profile.target_audience,
    forbidden_words: profile.forbidden_words,
    forbidden_topics: profile.forbidden_topics,
    campaign_season_hints: profile.campaign_seasons,
    recommended_initial_content_directions: profile.content_directions,
    known_data_gaps: confidenceNotes,
    confidence_notes: profile.confidence_notes
  };

  return {
    profile,
    document
  };
};

export const onboardingRouter: Router = Router();

onboardingRouter.post("/onboarding/bootstrap-org", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const inputName = parseOptionalString(body.name);
    await ensureUserProfile({
      userId: user.userId,
      email: user.email,
      name: inputName ?? user.name
    });

    const existing = await getExistingMembership(user.userId);
    if (existing?.org_id) {
      res.json({
        ok: true,
        created: false,
        org: {
          id: existing.org_id,
          name: existing.organizations?.name ?? "Organization",
          org_type: existing.organizations?.org_type ?? "nonprofit"
        },
        membership: {
          role: existing.role
        }
      });
      return;
    }

    const created = await createInitialOrg({
      userId: user.userId,
      orgName: resolveOrgName(body.org_name, user.email)
    });

    res.json({
      ok: true,
      created: true,
      org: {
        id: created.orgId,
        name: created.orgName,
        org_type: created.orgType
      },
      membership: {
        role: "owner"
      }
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

onboardingRouter.post("/onboarding/interview", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = parseObject(req.body, "body");
    parseJsonSize(body, "body");

    const orgId = parseRequiredString(body.org_id, "org_id", 120);
    await requireOrgMembership(user.userId, orgId);
    const interviewAnswers = parseInterviewAnswers(body.interview_answers);

    const { error } = await supabaseAdmin.from("org_brand_settings").upsert(
      {
        org_id: orgId,
        interview_answers: interviewAnswers
      },
      {
        onConflict: "org_id"
      }
    );
    if (error) {
      throw new HttpError(500, "db_error", `Failed to upsert interview answers: ${error.message}`);
    }

    res.json({
      ok: true,
      org_id: orgId,
      interview_answers: interviewAnswers
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});

onboardingRouter.post("/onboarding/synthesize", async (req, res) => {
  const user = await requireUserJwt(req, res);
  if (!user) {
    return;
  }

  try {
    const body = parseObject(req.body, "body");
    parseJsonSize(body, "body");

    const orgId = parseRequiredString(body.org_id, "org_id", 120);
    await requireOrgMembership(user.userId, orgId);

    const crawlResult = parseObject(body.crawl_result, "crawl_result");
    parseJsonSize(crawlResult, "crawl_result", MAX_JSON_LENGTH);
    const interviewAnswers = parseInterviewAnswers(body.interview_answers);

    const urlMetadata =
      body.url_metadata && typeof body.url_metadata === "object" && !Array.isArray(body.url_metadata)
        ? (body.url_metadata as Record<string, unknown>)
        : {};

    const { profile, document } = synthesizeProfile({
      crawlResult,
      interviewAnswers,
      orgId
    });

    const crawlSources = parseObject(crawlResult.sources ?? {}, "crawl_result.sources");
    const crawlStatus = {
      state: parseOptionalString(crawlResult.state) ?? "done",
      started_at: parseOptionalString(crawlResult.started_at),
      finished_at: parseOptionalString(crawlResult.finished_at),
      sources: {
        website: {
          status: parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.status) ?? "unknown",
          error: parseOptionalString((crawlSources.website as Record<string, unknown> | undefined)?.error)
        },
        naver_blog: {
          status:
            parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.status) ?? "unknown",
          error: parseOptionalString((crawlSources.naver_blog as Record<string, unknown> | undefined)?.error)
        }
      }
    };

    const payloadForStore = {
      org_id: orgId,
      website_url: parseOptionalUrl(urlMetadata.website_url ?? body.website_url),
      naver_blog_url: parseOptionalUrl(urlMetadata.naver_blog_url ?? body.naver_blog_url),
      instagram_url: parseOptionalUrl(urlMetadata.instagram_url ?? body.instagram_url),
      facebook_url: parseOptionalUrl(urlMetadata.facebook_url ?? body.facebook_url),
      youtube_url: parseOptionalUrl(urlMetadata.youtube_url ?? body.youtube_url),
      threads_url: parseOptionalUrl(urlMetadata.threads_url ?? body.threads_url),
      crawl_status: crawlStatus,
      crawl_payload: crawlResult,
      interview_answers: interviewAnswers,
      detected_tone: profile.detected_tone,
      tone_description: profile.tone_guardrails.join(" "),
      target_audience: profile.target_audience,
      key_themes: profile.key_themes,
      forbidden_words: profile.forbidden_words,
      forbidden_topics: profile.forbidden_topics,
      campaign_seasons: profile.campaign_seasons,
      brand_summary: profile.organization_summary,
      result_document: document
    };
    parseJsonSize(payloadForStore, "synthesis_store_payload", MAX_JSON_LENGTH);

    const { error } = await supabaseAdmin.from("org_brand_settings").upsert(payloadForStore, {
      onConflict: "org_id"
    });
    if (error) {
      throw new HttpError(500, "db_error", `Failed to upsert org brand settings: ${error.message}`);
    }

    res.json({
      ok: true,
      org_id: orgId,
      brand_profile: profile,
      onboarding_result_document: document
    });
  } catch (error) {
    const httpError = toHttpError(error);
    res.status(httpError.status).json({
      ok: false,
      error: httpError.code,
      message: httpError.message
    });
  }
});
