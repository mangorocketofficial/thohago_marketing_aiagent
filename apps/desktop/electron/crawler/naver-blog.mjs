import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15_000;
const POST_TIMEOUT_MS = 10_000;
const MAX_POSTS = 8;
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
    if (!detailByIndex.has(index)) {
      return {
        ...post,
        content_snippet: null,
        date: null
      };
    }

    const detail = detailByIndex.get(index);
    return {
      ...post,
      content_snippet: detail?.content_snippet ?? null,
      date: detail?.date ?? null
    };
  });
};

export const crawlNaverBlog = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("naver blog url is missing.");
  }

  const response = await withTimeout(normalizedUrl, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Naver Blog crawl failed with status ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const title = clampText($("title").first().text(), 160);
  const description = clampText(
    $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "",
    300
  );

  const recentPosts = [];
  const seen = new Set();
  $("a").each((_, node) => {
    if (recentPosts.length >= MAX_POSTS) {
      return false;
    }

    const href = toAbsoluteUrl(normalizedUrl, $(node).attr("href"));
    const text = clampText($(node).text());
    if (!href || !text) {
      return true;
    }
    if (!/blog\.naver\.com/i.test(href) && !/\/PostView\.naver/i.test(href) && !/m\.blog\.naver\.com/i.test(href)) {
      return true;
    }

    const dedupeKey = `${href}|${text}`;
    if (seen.has(dedupeKey)) {
      return true;
    }
    seen.add(dedupeKey);

    recentPosts.push({
      title: text,
      url: href
    });
    return true;
  });

  const categories = pickTextList($, $(".blog_category a, .area_category a, .cm-col1 .list_category a"), 10, 80);
  const enrichedPosts = await enrichRecentPosts(recentPosts);

  return {
    url: normalizedUrl,
    title,
    description,
    categories,
    recent_posts: enrichedPosts
  };
};
