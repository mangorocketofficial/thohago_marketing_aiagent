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

  try {
    return await crawlViaJsonEndpoint(username);
  } catch (jsonError) {
    try {
      const htmlResult = await crawlViaHtmlFallback(username);
      return {
        ...htmlResult,
        error: clampText(
          `JSON endpoint unavailable (${jsonError instanceof Error ? jsonError.message : "unknown"}). Used HTML fallback.`,
          260
        )
      };
    } catch (htmlError) {
      const reason = [
        `JSON endpoint: ${jsonError instanceof Error ? jsonError.message : "unknown error"}`,
        `HTML fallback: ${htmlError instanceof Error ? htmlError.message : "unknown error"}`
      ].join(" | ");
      return toFailedResult(username, reason);
    }
  }
};
