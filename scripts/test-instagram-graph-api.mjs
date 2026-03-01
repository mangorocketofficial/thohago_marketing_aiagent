import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const nowIso = () => new Date().toISOString();
const toCompactDate = (value) => value.replace(/[:.]/g, "-");
const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const redactAccessTokenInUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl ?? ""));
    const sensitiveKeys = ["access_token", "input_token", "token", "fb_exchange_token"];
    for (const key of sensitiveKeys) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "<redacted>");
      }
    }
    return parsed.toString();
  } catch {
    return String(rawUrl ?? "");
  }
};

const clampText = (value, maxLength = 260) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const parseDotEnv = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  const output = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    output[key] = value;
  }
  return output;
};

const loadEnv = async () => {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
    path.resolve(cwd, "../../.env"),
    path.resolve(cwd, "../../.env.local")
  ];

  const merged = {};
  for (const candidate of candidates) {
    try {
      const parsed = await parseDotEnv(candidate);
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in merged)) {
          merged[key] = value;
        }
      }
    } catch {
      // no-op
    }
  }

  const read = (key, fallback = "") => {
    const direct = process.env[key];
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
    const fromFile = merged[key];
    if (typeof fromFile === "string" && fromFile.trim()) {
      return fromFile.trim();
    }
    return fallback;
  };

  return {
    instagramAccessToken:
      read("GRAPH_META_ACCESS_TOKEN") ||
      read("Graph_META_ACCESS_TOKEN") ||
      read("INSTAGRAM_ACCESS_TOKEN") ||
      read("GRAPH_INSTAGRAM_ACCESS_TOKEN") ||
      read("Graph_INSTAGRAM_ACCESS_TOKEN"),
    instagramBusinessAccountId:
      read("INSTAGRAM_BUSINESS_ACCOUNT_ID") || read("INSTAGRAM_IG_USER_ID") || read("IG_BUSINESS_ACCOUNT_ID"),
    facebookPageId: read("FACEBOOK_PAGE_ID"),
    graphVersion: read("INSTAGRAM_GRAPH_VERSION", "v23.0"),
    metaAppId: read("GRAPH_META_APP_ID") || read("Graph_META_APP_ID") || read("META_APP_ID") || read("INSTAGRAM_APP_ID"),
    metaAppSecret:
      read("GRAPH_META_APP_SECRET") ||
      read("Graph_META_APP_SECRET") ||
      read("META_APP_SECRET") ||
      read("META_APP_SECRET_ID") ||
      read("INSTAGRAM_APP_SECRET")
  };
};

const maskToken = (value) => {
  const token = String(value ?? "").trim();
  if (!token) {
    return "";
  }
  if (token.length <= 14) {
    return `${token.slice(0, 4)}...`;
  }
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
};

const parseInstagramUsername = (input) => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }

  const stripDecorators = (value) =>
    value
      .replace(/^@+/, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .trim();

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (!/instagram\.com$/i.test(parsed.hostname) && !/\.instagram\.com$/i.test(parsed.hostname)) {
        return "";
      }

      const segments = parsed.pathname
        .split("/")
        .map((item) => item.trim())
        .filter(Boolean);
      const first = stripDecorators(segments[0] ?? "");
      if (!first) {
        return "";
      }
      if (["p", "reel", "explore", "stories", "accounts"].includes(first.toLowerCase())) {
        return "";
      }
      return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first : "";
    } catch {
      return "";
    }
  }

  const normalized = stripDecorators(raw);
  if (!normalized) {
    return "";
  }
  return /^[A-Za-z0-9._]{1,30}$/.test(normalized) ? normalized : "";
};

const graphGet = async (baseUrl, endpointPath, params, accessToken) => {
  const url = new URL(`${baseUrl}${endpointPath}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    url: redactAccessTokenInUrl(url.toString()),
    body
  };
};

const instagramBasicGet = async (endpointPath, params, accessToken) => {
  const url = new URL(`https://graph.instagram.com${endpointPath}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    url: redactAccessTokenInUrl(url.toString()),
    body
  };
};

const resolveGraphBaseUrl = async (graphVersion, accessToken) => {
  const candidates = [graphVersion, "v22.0", "v21.0", "v20.0", ""];
  const unique = [...new Set(candidates.map((item) => String(item ?? "").trim()))];
  const probes = [];

  for (const version of unique) {
    const baseUrl = version ? `https://graph.facebook.com/${version}` : "https://graph.facebook.com";
    const probe = await graphGet(baseUrl, "/me", { fields: "id,name" }, accessToken);
    probes.push({
      version: version || "unversioned",
      status: probe.status,
      ok: probe.ok,
      error: probe.body?.error?.message ?? null
    });
    if (probe.ok) {
      return {
        baseUrl,
        resolvedVersion: version || "unversioned",
        probe,
        probes
      };
    }
  }

  return {
    baseUrl: graphVersion ? `https://graph.facebook.com/${graphVersion}` : "https://graph.facebook.com",
    resolvedVersion: graphVersion || "unversioned",
    probe: null,
    probes
  };
};

const resolveBusinessAccount = async (params) => {
  const { baseUrl, accessToken, explicitBusinessAccountId, facebookPageId, targetUsername } = params;

  const attempts = [];
  if (explicitBusinessAccountId) {
    return {
      igBusinessAccountId: explicitBusinessAccountId,
      source: "env_business_account_id",
      attempts
    };
  }

  if (facebookPageId) {
    const pageRes = await graphGet(
      baseUrl,
      `/${facebookPageId}`,
      { fields: "id,name,instagram_business_account{id,username}" },
      accessToken
    );
    attempts.push({
      stage: "page_lookup",
      status: pageRes.status,
      ok: pageRes.ok,
      error: pageRes.body?.error?.message ?? null
    });

    const igId = pageRes.body?.instagram_business_account?.id;
    if (typeof igId === "string" && igId.trim()) {
      return {
        igBusinessAccountId: igId.trim(),
        source: "facebook_page_lookup",
        attempts
      };
    }
  }

  const pagesRes = await graphGet(
    baseUrl,
    "/me/accounts",
    { fields: "id,name,instagram_business_account{id,username}", limit: 100 },
    accessToken
  );
  attempts.push({
    stage: "me_accounts",
    status: pagesRes.status,
    ok: pagesRes.ok,
    error: pagesRes.body?.error?.message ?? null
  });

  const pages = Array.isArray(pagesRes.body?.data) ? pagesRes.body.data : [];
  const withIg = pages
    .filter((row) => row?.instagram_business_account?.id)
    .map((row) => ({
      page_id: row.id ?? null,
      page_name: row.name ?? null,
      ig_id: row.instagram_business_account?.id ?? null,
      ig_username: row.instagram_business_account?.username ?? null
    }));

  if (!withIg.length) {
    return {
      igBusinessAccountId: "",
      source: "not_found",
      attempts,
      candidates: withIg
    };
  }

  if (targetUsername) {
    const matched = withIg.find((row) => String(row.ig_username ?? "").toLowerCase() === targetUsername.toLowerCase());
    if (matched?.ig_id) {
      return {
        igBusinessAccountId: matched.ig_id,
        source: "me_accounts_username_match",
        attempts,
        candidates: withIg
      };
    }
  }

  return {
    igBusinessAccountId: String(withIg[0].ig_id ?? ""),
    source: "me_accounts_first_match",
    attempts,
    candidates: withIg
  };
};

const callBusinessDiscovery = async (params) => {
  const { baseUrl, accessToken, igBusinessAccountId, targetUsername } = params;
  const fields = [
    `business_discovery.username(${targetUsername}){`,
    "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,",
    "media.limit(5){id,caption,like_count,comments_count,timestamp,media_type,media_url,permalink}",
    "}"
  ].join("");

  return graphGet(baseUrl, `/${igBusinessAccountId}`, { fields }, accessToken);
};

const normalizeDiscovery = (responseBody) => {
  const data = responseBody?.business_discovery;
  if (!data || typeof data !== "object") {
    return null;
  }

  const mediaRows = Array.isArray(data.media?.data)
    ? data.media.data.map((row) => ({
        id: row?.id ?? null,
        media_type: row?.media_type ?? null,
        permalink: row?.permalink ?? null,
        timestamp: row?.timestamp ?? null,
        like_count: typeof row?.like_count === "number" ? row.like_count : null,
        comments_count: typeof row?.comments_count === "number" ? row.comments_count : null,
        caption: row?.caption ? clampText(row.caption, 220) : null
      }))
    : [];

  const out = {
    username: data.username ?? null,
    name: data.name ?? null,
    biography: data.biography ?? null,
    website: data.website ?? null,
    profile_picture_url: data.profile_picture_url ?? null,
    followers_count: typeof data.followers_count === "number" ? data.followers_count : null,
    follows_count: typeof data.follows_count === "number" ? data.follows_count : null,
    media_count: typeof data.media_count === "number" ? data.media_count : null,
    recent_posts: mediaRows
  };

  const missingFields = [];
  for (const key of [
    "username",
    "biography",
    "followers_count",
    "follows_count",
    "media_count",
    "profile_picture_url"
  ]) {
    if (out[key] === null || out[key] === "") {
      missingFields.push(key);
    }
  }

  return {
    ...out,
    missing_fields: missingFields
  };
};

const toJson = (value, maxLength = 240_000) => {
  const serialized = JSON.stringify(value ?? null, null, 2);
  if (serialized.length <= maxLength) {
    return serialized;
  }
  return `${serialized.slice(0, maxLength)}\n... (truncated ${serialized.length - maxLength} chars)`;
};

const buildReportMarkdown = (params) => {
  const {
    generatedAt,
    targetInput,
    targetUsername,
    envSummary,
    baseResolution,
    basicProfileProbe,
    tokenDebugRes,
    businessAccountResolution,
    discoveryResponse,
    normalized
  } = params;

  const canUseCoreFields = Boolean(
    normalized &&
      normalized.username &&
      typeof normalized.followers_count === "number" &&
      typeof normalized.follows_count === "number" &&
      typeof normalized.media_count === "number"
  );

  return `# Instagram Graph API Independent Test

- Generated At: ${generatedAt}
- Target Input: ${targetInput}
- Parsed Username: ${targetUsername || "(invalid)"}
- Result: ${canUseCoreFields ? "PASS (core fields collected)" : "FAIL/PARTIAL (core fields missing)"}

## 1) Env Summary

\`\`\`json
${toJson(envSummary, 12_000)}
\`\`\`

## 2) Graph Version Resolution

\`\`\`json
${toJson(baseResolution, 30_000)}
\`\`\`

## 3) graph.instagram.com Probe (Basic path)

\`\`\`json
${toJson(basicProfileProbe, 30_000)}
\`\`\`

## 4) Token Debug (optional)

\`\`\`json
${toJson(tokenDebugRes, 40_000)}
\`\`\`

## 5) IG Business Account Resolution

\`\`\`json
${toJson(businessAccountResolution, 60_000)}
\`\`\`

## 6) Business Discovery Raw Response

\`\`\`json
${toJson(discoveryResponse, 200_000)}
\`\`\`

## 7) Normalized Output

\`\`\`json
${toJson(normalized, 80_000)}
\`\`\`
`;
};

const run = async () => {
  const startedAt = nowIso();
  const targetInputRaw = process.argv.slice(2).join(" ").trim();
  const targetInput = targetInputRaw || "worldfriendskorea_";
  const targetUsername = parseInstagramUsername(targetInput);

  const env = await loadEnv();
  if (!env.instagramAccessToken) {
    throw new Error("Missing GRAPH_META_ACCESS_TOKEN (or INSTAGRAM_ACCESS_TOKEN alias) in env.");
  }
  if (!targetUsername) {
    throw new Error(`Invalid Instagram username or URL input: ${targetInput}`);
  }

  const baseResolution = await resolveGraphBaseUrl(env.graphVersion, env.instagramAccessToken);
  const baseUrl = baseResolution.baseUrl;
  const basicProfileProbe = await instagramBasicGet(
    "/me",
    { fields: "id,username,account_type,media_count" },
    env.instagramAccessToken
  );

  let tokenDebugRes = {
    skipped: true,
    reason: "GRAPH_META_APP_ID or GRAPH_META_APP_SECRET missing"
  };
  if (env.metaAppId && env.metaAppSecret && baseResolution.probe) {
    const debugRes = await graphGet(
      baseUrl,
      "/debug_token",
      {
        input_token: env.instagramAccessToken
      },
      `${env.metaAppId}|${env.metaAppSecret}`
    );
    tokenDebugRes = debugRes;
  }

  let businessAccountResolution = {
    igBusinessAccountId: "",
    source: "skipped",
    attempts: [],
    candidates: [],
    reason: "graph.facebook.com token probe failed"
  };
  let discoveryResponse = {
    ok: false,
    status: 0,
    url: "",
    body: {
      skipped: true,
      reason: "missing ig_business_account_id or graph.facebook.com token compatibility issue"
    }
  };
  let normalized = null;
  let igBusinessAccountId = "";

  if (baseResolution.probe) {
    businessAccountResolution = await resolveBusinessAccount({
      baseUrl,
      accessToken: env.instagramAccessToken,
      explicitBusinessAccountId: env.instagramBusinessAccountId,
      facebookPageId: env.facebookPageId,
      targetUsername
    });

    igBusinessAccountId = String(businessAccountResolution.igBusinessAccountId ?? "").trim();
    if (igBusinessAccountId) {
      discoveryResponse = await callBusinessDiscovery({
        baseUrl,
        accessToken: env.instagramAccessToken,
        igBusinessAccountId,
        targetUsername
      });
      normalized = normalizeDiscovery(discoveryResponse.body);
    }
  }

  const generatedAt = nowIso();
  const envSummary = {
    graph_version_requested: env.graphVersion,
    graph_base_resolved: baseUrl,
    has_instagram_access_token: Boolean(env.instagramAccessToken),
    masked_instagram_access_token: maskToken(env.instagramAccessToken),
    has_meta_app_id: Boolean(env.metaAppId),
    has_meta_app_secret: Boolean(env.metaAppSecret),
    has_business_account_id: Boolean(env.instagramBusinessAccountId),
    has_facebook_page_id: Boolean(env.facebookPageId),
    business_account_id_source_value: env.instagramBusinessAccountId || null
  };

  const reportMarkdown = buildReportMarkdown({
    generatedAt,
    targetInput,
    targetUsername,
    envSummary,
    baseResolution,
    basicProfileProbe,
    tokenDebugRes,
    businessAccountResolution,
    discoveryResponse,
    normalized
  });

  const reportDir = path.join(process.cwd(), "docs", "reports");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(
    reportDir,
    `instagram-graph-api-test-${targetUsername}-${toCompactDate(generatedAt)}.md`
  );
  await fs.writeFile(reportPath, reportMarkdown, "utf8");

  const coreFieldsReady = Boolean(
    normalized &&
      normalized.username &&
      typeof normalized.followers_count === "number" &&
      typeof normalized.follows_count === "number" &&
      typeof normalized.media_count === "number"
  );

  console.log(
    JSON.stringify(
      {
        ok: discoveryResponse.ok,
        started_at: startedAt,
        finished_at: generatedAt,
        target_username: targetUsername,
        graph_base: baseUrl,
        ig_business_account_id: igBusinessAccountId || null,
        graph_facebook_token_compatible: Boolean(baseResolution.probe),
        graph_instagram_probe_ok: basicProfileProbe.ok,
        core_fields_ready: coreFieldsReady,
        normalized_preview: normalized
          ? {
              username: normalized.username,
              followers_count: normalized.followers_count,
              follows_count: normalized.follows_count,
              media_count: normalized.media_count,
              missing_fields: normalized.missing_fields
            }
          : null,
        discovery_error: discoveryResponse.body?.error?.message ?? null,
        report_path: reportPath
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
