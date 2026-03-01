import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15_000;
const POST_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 8_000;
const RSS_TIMEOUT_MS = 8_000;
const MAX_POSTS = 8;
const MAX_SEARCH_RESULTS = 20;
const MAX_TEXT_LENGTH = 260;
const MAX_SNIPPET_LENGTH = 500;
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

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const stripHtmlTags = (value) => String(value ?? "").replace(/<[^>]*>/g, " ");

const decodeHtmlEntities = (value) => {
  const input = String(value ?? "");
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  return input
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number.parseInt(digits, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z]+);/gi, (matched, name) => named[name.toLowerCase()] ?? matched);
};

const extractTagText = (source, tagName) => {
  const safeTag = String(tagName ?? "").trim();
  if (!safeTag) {
    return "";
  }

  const cdataPattern = new RegExp(`<${safeTag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${safeTag}>`, "i");
  const cdataMatched = String(source ?? "").match(cdataPattern);
  if (cdataMatched?.[1]) {
    return cdataMatched[1];
  }

  const plainPattern = new RegExp(`<${safeTag}[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, "i");
  const plainMatched = String(source ?? "").match(plainPattern);
  return plainMatched?.[1] ?? "";
};

const normalizeNaverPostDate = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  const asDate = new Date(raw);
  if (Number.isFinite(asDate.getTime())) {
    return asDate.toISOString().slice(0, 10);
  }
  return clampText(raw, 40) || null;
};

const toAbsoluteUrl = (baseUrl, maybeRelative) => {
  const raw = String(maybeRelative ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
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

const pickTextList = ($, $nodes, limit, maxLength = 80) => {
  const rows = [];
  const seen = new Set();

  $nodes.each((_, node) => {
    if (rows.length >= limit) {
      return false;
    }
    const value = clampText($(node).text(), maxLength);
    if (!value || seen.has(value)) {
      return true;
    }
    seen.add(value);
    rows.push(value);
    return true;
  });

  return rows;
};

const parseDateFromDocument = ($) => {
  const candidates = [
    $("time").first().attr("datetime"),
    $(".se_publishDate").first().text(),
    $(".date").first().text(),
    $(".blog_date").first().text(),
    $("meta[property='article:published_time']").first().attr("content")
  ];

  for (const candidate of candidates) {
    const parsed = clampText(candidate ?? "", 40);
    if (parsed) {
      return parsed;
    }
  }
  return null;
};

const extractContentFromDocument = ($) => {
  const content =
    clampText($(".se-main-container").first().text(), MAX_SNIPPET_LENGTH) ||
    clampText($("#postViewArea").first().text(), MAX_SNIPPET_LENGTH) ||
    clampText($("article").first().text(), MAX_SNIPPET_LENGTH);

  return content || null;
};

const toMobileBlogUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (/^m\.blog\.naver\.com$/i.test(parsed.hostname)) {
      return parsed.toString();
    }
    if (/(^|\.)blog\.naver\.com$/i.test(parsed.hostname)) {
      parsed.hostname = "m.blog.naver.com";
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
};

const parseBlogIdFromUrl = (url) => {
  try {
    const parsed = new URL(String(url ?? "").trim());
    if (!/(^|\.)blog\.naver\.com$/i.test(parsed.hostname)) {
      return "";
    }

    if (/postview\.naver$/i.test(parsed.pathname)) {
      const blogId = String(parsed.searchParams.get("blogId") ?? "").trim();
      return /^[A-Za-z0-9._-]{2,40}$/.test(blogId) ? blogId : "";
    }

    const segments = parsed.pathname
      .split("/")
      .map((row) => row.trim())
      .filter(Boolean);
    const candidate = segments[0] ?? "";
    return /^[A-Za-z0-9._-]{2,40}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
};

const parseLogNoFromUrl = (url) => {
  try {
    const parsed = new URL(String(url ?? "").trim());
    if (!/(^|\.)blog\.naver\.com$/i.test(parsed.hostname)) {
      return "";
    }

    if (/postview\.naver$/i.test(parsed.pathname)) {
      const logNo = String(parsed.searchParams.get("logNo") ?? "").trim();
      return /^\d{5,20}$/.test(logNo) ? logNo : "";
    }

    const segments = parsed.pathname
      .split("/")
      .map((row) => row.trim())
      .filter(Boolean);
    const candidate = segments[1] ?? "";
    return /^\d{5,20}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
};

const normalizeNaverPostUrl = (url, fallbackBlogId = "") => {
  try {
    const parsed = new URL(String(url ?? "").trim());
    if (!/(^|\.)blog\.naver\.com$/i.test(parsed.hostname)) {
      return "";
    }

    const blogId = parseBlogIdFromUrl(parsed.toString()) || String(fallbackBlogId ?? "").trim();
    const logNo = parseLogNoFromUrl(parsed.toString());
    if (blogId && logNo) {
      return `https://blog.naver.com/${blogId}/${logNo}`;
    }

    parsed.hash = "";
    if (parsed.searchParams.has("redirect")) {
      parsed.searchParams.delete("redirect");
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

const buildPostDedupeKey = (post) => {
  const normalized = normalizeNaverPostUrl(post?.url ?? "", post?.blog_id ?? "");
  if (normalized) {
    return normalized.toLowerCase();
  }
  const title = clampText(post?.title, 120).toLowerCase();
  return `${title}|${clampText(post?.date, 24).toLowerCase()}`;
};

const resolveNaverSearchCredentials = () => {
  const clientId = readEnv("NAVER_SEARCH_CLIENT_ID", "NAVER_CLIENT_ID");
  const clientSecret = readEnv("NAVER_SEARCH_CLIENT_SECRET", "NAVER_CLIENT_SECRET");
  return {
    clientId,
    clientSecret
  };
};

const callNaverBlogSearchApi = async (params) => {
  const { query, display = MAX_SEARCH_RESULTS, sort = "date", clientId, clientSecret } = params;
  const endpoint = new URL("https://openapi.naver.com/v1/search/blog.json");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("display", String(Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(display) || MAX_SEARCH_RESULTS))));
  endpoint.searchParams.set("sort", sort === "sim" ? "sim" : "date");

  const response = await withTimeout(
    endpoint.toString(),
    {
      method: "GET",
      headers: {
        "x-naver-client-id": clientId,
        "x-naver-client-secret": clientSecret,
        accept: "application/json",
        "user-agent": USER_AGENT
      }
    },
    SEARCH_TIMEOUT_MS
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.errorMessage === "string"
        ? payload.errorMessage
        : `status ${response.status}`;
    throw new Error(`Naver blog search API request failed (${message}).`);
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Naver blog search API returned invalid payload.");
  }

  return payload.items;
};

const mapSearchItemToPost = (item, targetBlogId) => {
  const rawLink = clampText(item?.link, 500);
  const bloggerLink = clampText(item?.bloggerlink, 500);
  const normalizedUrl = normalizeNaverPostUrl(rawLink, targetBlogId) || normalizeNaverPostUrl(bloggerLink, targetBlogId) || rawLink;
  const blogId = parseBlogIdFromUrl(normalizedUrl) || parseBlogIdFromUrl(bloggerLink) || targetBlogId || "";
  const title = clampText(decodeHtmlEntities(stripHtmlTags(item?.title)), 180);
  const summary = clampText(decodeHtmlEntities(stripHtmlTags(item?.description)), MAX_SNIPPET_LENGTH);
  const date = normalizeNaverPostDate(item?.postdate);

  if (!normalizedUrl || !title) {
    return null;
  }

  return {
    title,
    url: normalizedUrl,
    summary: summary || null,
    content_snippet: summary || null,
    date,
    source: "naver_search_api",
    blog_id: blogId || null
  };
};

const fetchRecentPostsFromSearchApi = async (params) => {
  const { targetBlogId, pageTitle } = params;
  const credentials = resolveNaverSearchCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    return {
      posts: [],
      warnings: ["Naver search credentials are missing; skipped search API."]
    };
  }

  const queryCandidates = [];
  if (targetBlogId) {
    queryCandidates.push(`blog.naver.com/${targetBlogId}`);
    queryCandidates.push(targetBlogId);
  }
  if (pageTitle) {
    queryCandidates.push(pageTitle);
  }

  const uniqueQueries = [...new Set(queryCandidates.map((query) => query.trim()).filter(Boolean))];
  if (!uniqueQueries.length) {
    return {
      posts: [],
      warnings: ["Could not build search query for Naver search API."]
    };
  }

  const merged = [];
  const warnings = [];
  for (const query of uniqueQueries) {
    try {
      const items = await callNaverBlogSearchApi({
        query,
        display: MAX_SEARCH_RESULTS,
        sort: "date",
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret
      });

      const mapped = items
        .map((item) => mapSearchItemToPost(item, targetBlogId))
        .filter(Boolean);
      for (const row of mapped) {
        merged.push(row);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      warnings.push(`Search API query "${query}" failed: ${reason}`);
    }
  }

  const filtered = targetBlogId
    ? merged.filter((post) => String(post.blog_id ?? "").toLowerCase() === targetBlogId.toLowerCase())
    : merged;
  const candidates = filtered.length ? filtered : merged;

  const deduped = [];
  const seen = new Set();
  for (const post of candidates) {
    if (deduped.length >= MAX_POSTS) {
      break;
    }
    const key = buildPostDedupeKey(post);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(post);
  }

  return {
    posts: deduped,
    warnings
  };
};

const fetchRecentPostsFromRss = async (blogId) => {
  const normalizedBlogId = String(blogId ?? "").trim();
  if (!normalizedBlogId) {
    return {
      posts: [],
      warnings: []
    };
  }

  const rssUrl = `https://rss.blog.naver.com/${normalizedBlogId}.xml`;
  try {
    const response = await withTimeout(
      rssUrl,
      {
        method: "GET",
        headers: {
          accept: "application/rss+xml, application/xml, text/xml",
          "user-agent": USER_AGENT
        }
      },
      RSS_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const xml = await response.text();
    const itemBlocks = String(xml ?? "").match(/<item>[\s\S]*?<\/item>/gi) ?? [];
    const posts = [];
    const seen = new Set();

    for (const block of itemBlocks) {
      if (posts.length >= MAX_POSTS) {
        break;
      }

      const title = clampText(decodeHtmlEntities(stripHtmlTags(extractTagText(block, "title"))), 180);
      const link = normalizeNaverPostUrl(extractTagText(block, "link"), normalizedBlogId);
      const description = clampText(
        decodeHtmlEntities(stripHtmlTags(extractTagText(block, "description"))),
        MAX_SNIPPET_LENGTH
      );
      const date = normalizeNaverPostDate(extractTagText(block, "pubDate"));
      if (!title || !link) {
        continue;
      }

      const key = `${link}|${title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      posts.push({
        title,
        url: link,
        summary: description || null,
        content_snippet: description || null,
        date,
        source: "rss_feed",
        blog_id: normalizedBlogId
      });
    }

    return {
      posts,
      warnings: []
    };
  } catch (error) {
    return {
      posts: [],
      warnings: [`RSS fallback failed: ${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
};

const fetchPostSnippet = async (url) => {
  const requestInit = {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    }
  };

  const response = await withTimeout(url, requestInit, POST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Post fetch failed with status ${response.status}.`);
  }

  const html = await response.text();
  const $outer = cheerio.load(html);
  const iframeSrc = String($outer("iframe#mainFrame").attr("src") ?? "").trim();
  const fallbackMetaDescription = clampText(
    $outer('meta[property="og:description"]').first().attr("content") ||
      $outer('meta[name="description"]').first().attr("content") ||
      "",
    MAX_SNIPPET_LENGTH
  );

  if (iframeSrc) {
    const frameUrl = toAbsoluteUrl(url, iframeSrc);
    if (frameUrl) {
      const frameResponse = await withTimeout(frameUrl, requestInit, POST_TIMEOUT_MS);
      if (frameResponse.ok) {
        const frameHtml = await frameResponse.text();
        const $frame = cheerio.load(frameHtml);
        const frameContent = extractContentFromDocument($frame);
        const frameDate = parseDateFromDocument($frame);
        if (frameContent) {
          return {
            content_snippet: frameContent,
            date: frameDate
          };
        }
      }
    }
  }

  const directContent = extractContentFromDocument($outer);
  if (directContent) {
    return {
      content_snippet: directContent,
      date: parseDateFromDocument($outer)
    };
  }

  const mobileUrl = toMobileBlogUrl(url);
  if (mobileUrl) {
    const mobileResponse = await withTimeout(mobileUrl, requestInit, POST_TIMEOUT_MS);
    if (mobileResponse.ok) {
      const mobileHtml = await mobileResponse.text();
      const $mobile = cheerio.load(mobileHtml);
      const mobileContent = extractContentFromDocument($mobile);
      if (mobileContent) {
        return {
          content_snippet: mobileContent,
          date: parseDateFromDocument($mobile)
        };
      }
    }
  }

  return {
    content_snippet: fallbackMetaDescription || null,
    date: null
  };
};

const enrichRecentPosts = async (recentPosts) => {
  const target = recentPosts.slice(0, 3);
  const results = await Promise.allSettled(
    target.map((post) =>
      fetchPostSnippet(post.url).catch(() => ({
        content_snippet: null,
        date: null
      }))
    )
  );

  const detailByIndex = new Map();
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "fulfilled") {
      detailByIndex.set(index, result.value);
    }
  }

  return recentPosts.map((post, index) => {
    const baseSnippet = clampText(post?.content_snippet ?? post?.summary ?? "", MAX_SNIPPET_LENGTH) || null;
    const baseDate = normalizeNaverPostDate(post?.date);
    if (!detailByIndex.has(index)) {
      return {
        ...post,
        content_snippet: baseSnippet,
        date: baseDate
      };
    }

    const detail = detailByIndex.get(index);
    return {
      ...post,
      content_snippet: detail?.content_snippet ?? baseSnippet,
      date: detail?.date ?? baseDate
    };
  });
};

const extractRecentPostsFromPage = ($, normalizedUrl) => {
  const targetBlogId = parseBlogIdFromUrl(normalizedUrl);
  const recentPosts = [];
  const seen = new Set();
  $("a").each((_, node) => {
    if (recentPosts.length >= MAX_POSTS) {
      return false;
    }

    const href = toAbsoluteUrl(normalizedUrl, $(node).attr("href"));
    const text = clampText($(node).text(), 180);
    if (!href || !text) {
      return true;
    }

    const normalizedPostUrl = normalizeNaverPostUrl(href, targetBlogId);
    if (!normalizedPostUrl) {
      return true;
    }

    const postBlogId = parseBlogIdFromUrl(normalizedPostUrl);
    if (targetBlogId && postBlogId && postBlogId.toLowerCase() !== targetBlogId.toLowerCase()) {
      return true;
    }

    const dedupeKey = `${normalizedPostUrl}|${text}`;
    if (seen.has(dedupeKey)) {
      return true;
    }
    seen.add(dedupeKey);

    recentPosts.push({
      title: text,
      url: normalizedPostUrl,
      summary: null,
      content_snippet: null,
      date: null,
      source: "page_links",
      blog_id: postBlogId || targetBlogId || null
    });
    return true;
  });

  return recentPosts;
};

const mergeRecentPostCollections = (collections, maxPosts = MAX_POSTS) => {
  const merged = [];
  const seen = new Set();

  for (const collection of collections) {
    const rows = Array.isArray(collection) ? collection : [];
    for (const post of rows) {
      if (!post || typeof post !== "object") {
        continue;
      }
      if (merged.length >= maxPosts) {
        return merged;
      }
      const key = buildPostDedupeKey(post);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(post);
    }
  }

  return merged;
};

export const crawlNaverBlog = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("naver blog url is missing.");
  }

  let title = "";
  let description = "";
  let categories = [];
  let pageRecentPosts = [];
  const pageWarnings = [];
  try {
    const response = await withTimeout(normalizedUrl, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    title = clampText($("title").first().text(), 160);
    description = clampText(
      $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "",
      300
    );
    categories = pickTextList($, $(".blog_category a, .area_category a, .cm-col1 .list_category a"), 10, 80);
    pageRecentPosts = extractRecentPostsFromPage($, normalizedUrl);
  } catch (error) {
    pageWarnings.push(`Page crawl failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const targetBlogId = parseBlogIdFromUrl(normalizedUrl);
  const searchApiResult = await fetchRecentPostsFromSearchApi({
    targetBlogId,
    pageTitle: title
  });
  const rssResult = await fetchRecentPostsFromRss(targetBlogId);
  const mergedRecentPosts = mergeRecentPostCollections(
    [searchApiResult.posts, pageRecentPosts, rssResult.posts],
    MAX_POSTS
  );
  const enrichedPosts = await enrichRecentPosts(mergedRecentPosts);
  const warnings = [...pageWarnings, ...searchApiResult.warnings, ...rssResult.warnings]
    .slice(0, 8)
    .map((row) => clampText(row, 180));

  if (!title && targetBlogId) {
    title = `${targetBlogId} : NAVER Blog`;
  }
  if (!enrichedPosts.length) {
    throw new Error("Naver Blog crawl returned no recent posts from page, search API, or RSS.");
  }
  if (!description) {
    description = clampText(enrichedPosts[0]?.content_snippet ?? enrichedPosts[0]?.summary ?? "", 300);
  }

  return {
    url: normalizedUrl,
    title,
    description,
    categories,
    recent_posts: enrichedPosts,
    collection_metadata: {
      blog_id: targetBlogId || null,
      source_order: ["naver_search_api", "page_links", "rss_feed"],
      source_counts: {
        naver_search_api: searchApiResult.posts.length,
        page_links: pageRecentPosts.length,
        rss_feed: rssResult.posts.length,
        merged: mergedRecentPosts.length
      }
    },
    warnings
  };
};
