import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;
const MAX_TEXT_LENGTH = 280;
const MAX_POSTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = MAX_TEXT_LENGTH) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

const toSafeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

const withTimeout = async (url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) => status === 429 || status >= 500;

const fetchWithRetry = async (url, init = {}, retryLimit = MAX_RETRIES) => {
  let lastError = null;
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      const response = await withTimeout(url, init, REQUEST_TIMEOUT_MS);
      if (!response.ok && isRetryableStatus(response.status) && attempt < retryLimit) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retryLimit) {
        break;
      }
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Instagram request failed.");
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

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const normalizeNumericId = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return /^[0-9]+$/.test(raw) ? raw : "";
};

const resolveGraphConfig = () => {
  const accessToken = readEnv(
    "Graph_META_ACCESS_TOKEN",
    "GRAPH_META_ACCESS_TOKEN",
    "INSTAGRAM_ACCESS_TOKEN",
    "Graph_INSTAGRAM_ACCESS_TOKEN",
    "GRAPH_INSTAGRAM_ACCESS_TOKEN"
  );
  const graphVersion = readEnv("INSTAGRAM_GRAPH_VERSION", "GRAPH_INSTAGRAM_API_VERSION", "GRAPH_API_VERSION") || "v23.0";
  const businessAccountId = normalizeNumericId(
    readEnv(
      "INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "GRAPH_INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "INSTAGRAM_IG_USER_ID",
      "GRAPH_INSTAGRAM_IG_USER_ID",
      "IG_BUSINESS_ACCOUNT_ID"
    )
  );
  const pageId = normalizeNumericId(readEnv("FACEBOOK_PAGE_ID", "INSTAGRAM_FACEBOOK_PAGE_ID", "GRAPH_FACEBOOK_PAGE_ID"));

  return {
    accessToken,
    graphVersion,
    businessAccountId,
    pageId
  };
};

const buildGraphBaseUrl = (version) => {
  const trimmed = String(version ?? "").trim();
  if (!trimmed) {
    return "https://graph.facebook.com";
  }
  return `https://graph.facebook.com/${trimmed}`;
};

const graphGetJson = async (params) => {
  const { baseUrl, path, query, accessToken } = params;
  const endpoint = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    endpoint.searchParams.set(key, String(value));
  }
  endpoint.searchParams.set("access_token", accessToken);

  const response = await fetchWithRetry(endpoint.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isPlainObject(body) && isPlainObject(body.error) && typeof body.error.message === "string"
        ? body.error.message
        : `Graph API request failed with status ${response.status}.`;
    throw new Error(`Graph API ${path} failed (${response.status}): ${message}`);
  }
  if (!isPlainObject(body)) {
    throw new Error(`Graph API ${path} returned non-JSON response.`);
  }
  return body;
};

const resolveGraphBusinessAccountId = async (params) => {
  const { baseUrl, accessToken, explicitBusinessAccountId, pageId, targetUsername } = params;

  if (explicitBusinessAccountId) {
    return explicitBusinessAccountId;
  }

  if (pageId) {
    try {
      const pagePayload = await graphGetJson({
        baseUrl,
        path: `/${pageId}`,
        query: {
          fields: "instagram_business_account{id,username}"
        },
        accessToken
      });
      const account = isPlainObject(pagePayload.instagram_business_account) ? pagePayload.instagram_business_account : null;
      const pageAccountId = normalizeNumericId(account?.id);
      if (pageAccountId) {
        return pageAccountId;
      }
    } catch {
      // ignore and continue with /me/accounts fallback
    }
  }

  try {
    const mePayload = await graphGetJson({
      baseUrl,
      path: "/me",
      query: {
        fields: "instagram_business_account{id,username}"
      },
      accessToken
    });
    const meAccount = isPlainObject(mePayload.instagram_business_account) ? mePayload.instagram_business_account : null;
    const meAccountId = normalizeNumericId(meAccount?.id);
    if (meAccountId) {
      return meAccountId;
    }
  } catch {
    // ignore and continue with /me/accounts fallback
  }

  try {
    const accountsPayload = await graphGetJson({
      baseUrl,
      path: "/me/accounts",
      query: {
        fields: "id,name,instagram_business_account{id,username}",
        limit: 100
      },
      accessToken
    });

    const pages = Array.isArray(accountsPayload.data) ? accountsPayload.data : [];
    const linkedAccounts = pages
      .map((entry) => (isPlainObject(entry) ? entry : null))
      .filter(Boolean)
      .map((entry) => (isPlainObject(entry.instagram_business_account) ? entry.instagram_business_account : null))
      .filter(Boolean)
      .map((entry) => ({
        id: normalizeNumericId(entry.id),
        username: clampText(entry.username, 40)
      }))
      .filter((entry) => entry.id);

    if (!linkedAccounts.length) {
      return "";
    }

    const byUsername = linkedAccounts.find(
      (entry) => entry.username && entry.username.toLowerCase() === targetUsername.toLowerCase()
    );
    if (byUsername?.id) {
      return byUsername.id;
    }

    return linkedAccounts[0]?.id ?? "";
  } catch {
    return "";
  }
};

const extractShortcodeFromPermalink = (permalink) => {
  const raw = String(permalink ?? "").trim();
  if (!raw) {
    return "";
  }
  const matched = raw.match(/\/(?:p|reel)\/([^/?#]+)/i);
  return matched?.[1] ? clampText(matched[1], 48) : "";
};

const mapGraphRecentPosts = (mediaRows) => {
  const rows = Array.isArray(mediaRows) ? mediaRows : [];
  return rows.slice(0, MAX_POSTS).map((entry) => {
    const row = isPlainObject(entry) ? entry : {};
    const permalink = clampText(row.permalink, 360);
    const shortcode = extractShortcodeFromPermalink(permalink);
    const caption = clampText(row.caption, 220);
    return {
      id: clampText(row.id, 80) || null,
      shortcode: shortcode || null,
      url: permalink || null,
      permalink: permalink || null,
      caption: caption || null,
      like_count: toSafeNumber(row.like_count),
      comment_count: toSafeNumber(row.comments_count),
      timestamp: typeof row.timestamp === "string" ? clampText(row.timestamp, 64) : null,
      media_type: clampText(row.media_type, 40) || null,
      media_url: clampText(row.media_url, 360) || null
    };
  });
};

const buildGraphProfileResult = (payload, fallbackUsername, businessAccountId) => {
  const discovery = isPlainObject(payload.business_discovery) ? payload.business_discovery : null;
  if (!discovery) {
    throw new Error("Graph API payload did not include business_discovery data.");
  }

  const username = clampText(typeof discovery.username === "string" ? discovery.username : fallbackUsername, 40) || fallbackUsername;
  const fullName = clampText(discovery.name, 120);
  const biography = clampText(discovery.biography, 500);
  const website = clampText(discovery.website, 320);
  const profilePictureUrl = clampText(discovery.profile_picture_url, 360);
  const followersCount = toSafeNumber(discovery.followers_count);
  const followingCount = toSafeNumber(discovery.follows_count);
  const postsCount = toSafeNumber(discovery.media_count);
  const recentPosts = mapGraphRecentPosts(isPlainObject(discovery.media) ? discovery.media.data : []);

  const hasCoreCounts = followersCount !== null && followingCount !== null && postsCount !== null;
  const hasSignal = Boolean(fullName || biography || website || profilePictureUrl || recentPosts.length > 0);
  const status = hasCoreCounts && hasSignal ? "done" : "partial";

  return {
    status,
    data: {
      source: "graph_api_business_discovery",
      profile_url: `https://www.instagram.com/${username}/`,
      username,
      full_name: fullName || null,
      biography: biography || null,
      meta_description: biography || null,
      external_url: website || null,
      followers_count: followersCount,
      following_count: followingCount,
      posts_count: postsCount,
      profile_picture_url: profilePictureUrl || null,
      business_account_id: businessAccountId,
      recent_posts: recentPosts
    },
    error: status === "partial" ? "Graph API returned partial Instagram profile data." : null
  };
};

const crawlViaGraphApi = async (username) => {
  const config = resolveGraphConfig();
  if (!config.accessToken) {
    return null;
  }

  const baseUrl = buildGraphBaseUrl(config.graphVersion);
  const businessAccountId = await resolveGraphBusinessAccountId({
    baseUrl,
    accessToken: config.accessToken,
    explicitBusinessAccountId: config.businessAccountId,
    pageId: config.pageId,
    targetUsername: username
  });
  if (!businessAccountId) {
    throw new Error(
      "Graph API token is available but Instagram business account id could not be resolved. Set INSTAGRAM_BUSINESS_ACCOUNT_ID or FACEBOOK_PAGE_ID."
    );
  }

  const fields = [
    `business_discovery.username(${username}){`,
    "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,",
    "media.limit(5){id,caption,like_count,comments_count,timestamp,media_type,media_url,permalink}",
    "}"
  ].join("");

  const payload = await graphGetJson({
    baseUrl,
    path: `/${businessAccountId}`,
    query: {
      fields
    },
    accessToken: config.accessToken
  });

  return buildGraphProfileResult(payload, username, businessAccountId);
};

const extractUserFromJson = (payload) => {
  if (!isPlainObject(payload)) {
    return null;
  }

  const top = payload;
  if (isPlainObject(top.graphql) && isPlainObject(top.graphql.user)) {
    return top.graphql.user;
  }
  if (isPlainObject(top.data) && isPlainObject(top.data.user)) {
    return top.data.user;
  }
  if (isPlainObject(top.user)) {
    return top.user;
  }
  return null;
};

const extractJsonProfile = (payload, fallbackUsername) => {
  const user = extractUserFromJson(payload);
  if (!isPlainObject(user)) {
    return null;
  }

  const username = clampText(
    typeof user.username === "string" ? user.username : fallbackUsername,
    40
  );
  const fullName = clampText(user.full_name, 120);
  const biography = clampText(user.biography, 300);
  const externalUrl = clampText(user.external_url, 300);

  const edgeFollowedBy = isPlainObject(user.edge_followed_by) ? user.edge_followed_by : {};
  const edgeFollow = isPlainObject(user.edge_follow) ? user.edge_follow : {};
  const edgeTimeline = isPlainObject(user.edge_owner_to_timeline_media) ? user.edge_owner_to_timeline_media : {};

  const followersCount = toSafeNumber(edgeFollowedBy.count);
  const followingCount = toSafeNumber(edgeFollow.count);
  const postsCount = toSafeNumber(edgeTimeline.count);

  const edges = Array.isArray(edgeTimeline.edges) ? edgeTimeline.edges : [];
  const recentPosts = [];
  for (const edge of edges.slice(0, MAX_POSTS)) {
    const node = isPlainObject(edge) && isPlainObject(edge.node) ? edge.node : {};
    const captionEdges =
      isPlainObject(node.edge_media_to_caption) && Array.isArray(node.edge_media_to_caption.edges)
        ? node.edge_media_to_caption.edges
        : [];
    const firstCaption =
      captionEdges[0] && isPlainObject(captionEdges[0].node) ? clampText(captionEdges[0].node.text, 220) : "";

    const likeCount =
      toSafeNumber(isPlainObject(node.edge_liked_by) ? node.edge_liked_by.count : null) ??
      toSafeNumber(isPlainObject(node.edge_media_preview_like) ? node.edge_media_preview_like.count : null);
    const commentCount = toSafeNumber(isPlainObject(node.edge_media_to_comment) ? node.edge_media_to_comment.count : null);
    const shortcode = clampText(node.shortcode, 32);

    recentPosts.push({
      shortcode: shortcode || null,
      url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
      caption: firstCaption || null,
      like_count: likeCount,
      comment_count: commentCount,
      timestamp: toSafeNumber(node.taken_at_timestamp)
    });
  }

  const hasMeaningfulProfile = Boolean(username || fullName || biography || externalUrl || followersCount !== null || postsCount !== null);
  if (!hasMeaningfulProfile) {
    return null;
  }

  return {
    source: "json_endpoint",
    profile_url: `https://www.instagram.com/${username || fallbackUsername}/`,
    username: username || fallbackUsername,
    full_name: fullName || null,
    biography: biography || null,
    external_url: externalUrl || null,
    followers_count: followersCount,
    following_count: followingCount,
    posts_count: postsCount,
    recent_posts: recentPosts
  };
};

const crawlViaJsonEndpoint = async (username) => {
  const endpoint = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
  const response = await fetchWithRetry(endpoint, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Instagram JSON endpoint returned status ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  const profile = extractJsonProfile(payload, username);
  if (!profile) {
    throw new Error("Instagram JSON payload did not include usable profile data.");
  }

  return {
    status: profile.recent_posts.length > 0 ? "done" : "partial",
    data: profile,
    error: null
  };
};

const crawlViaHtmlFallback = async (username) => {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const response = await fetchWithRetry(profileUrl, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Instagram HTML fallback returned status ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const title = clampText($("title").first().text(), 200);
  const metaDescription = clampText(
    $('meta[property="og:description"]').first().attr("content") ||
      $('meta[name="description"]').first().attr("content") ||
      "",
    320
  );
  const ogTitle = clampText($('meta[property="og:title"]').first().attr("content") || "", 200);
  const ogImage = clampText($('meta[property="og:image"]').first().attr("content") || "", 320);

  const hasAnyMeta = Boolean(title || metaDescription || ogTitle || ogImage);
  if (!hasAnyMeta) {
    throw new Error("Instagram HTML fallback returned empty metadata.");
  }

  return {
    status: "partial",
    data: {
      source: "html_fallback",
      profile_url: profileUrl,
      username,
      title: title || null,
      meta_description: metaDescription || null,
      og_title: ogTitle || null,
      og_image: ogImage || null,
      recent_posts: []
    },
    error: null
  };
};

const toFailedResult = (username, reason) => ({
  status: "failed",
  data: {
    source: "minimal_fallback",
    profile_url: username ? `https://www.instagram.com/${username}/` : null,
    username: username || null,
    recent_posts: []
  },
  error: clampText(reason || "Instagram crawl failed.", 260)
});

export const crawlInstagram = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("instagram url is missing.");
  }

  const username = parseInstagramUsername(normalizedUrl);
  if (!username) {
    return toFailedResult("", "Invalid Instagram URL or username.");
  }

  let graphErrorMessage = "";
  try {
    const graphResult = await crawlViaGraphApi(username);
    if (graphResult) {
      return graphResult;
    }
  } catch (graphError) {
    graphErrorMessage = graphError instanceof Error ? graphError.message : "unknown graph api error";
  }

  try {
    return await crawlViaJsonEndpoint(username);
  } catch (jsonError) {
    try {
      const htmlResult = await crawlViaHtmlFallback(username);
      const notices = [];
      if (graphErrorMessage) {
        notices.push(`Graph API unavailable (${graphErrorMessage}).`);
      }
      notices.push(`JSON endpoint unavailable (${jsonError instanceof Error ? jsonError.message : "unknown"}). Used HTML fallback.`);
      return {
        ...htmlResult,
        error: clampText(notices.join(" "), 260)
      };
    } catch (htmlError) {
      const reason = [];
      if (graphErrorMessage) {
        reason.push(`Graph API: ${graphErrorMessage}`);
      }
      reason.push(`JSON endpoint: ${jsonError instanceof Error ? jsonError.message : "unknown error"}`);
      reason.push(`HTML fallback: ${htmlError instanceof Error ? htmlError.message : "unknown error"}`);
      return toFailedResult(username, reason.join(" | "));
    }
  }
};
