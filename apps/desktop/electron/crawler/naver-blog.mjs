import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_POSTS = 6;
const MAX_TEXT_LENGTH = 260;

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = MAX_TEXT_LENGTH) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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

export const crawlNaverBlog = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("naver blog url is missing.");
  }

  const response = await withTimeout(normalizedUrl, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
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
    if (!/blog\.naver\.com/i.test(href) && !/\/PostView\.naver/i.test(href)) {
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

  return {
    url: normalizedUrl,
    title,
    description,
    recent_posts: recentPosts
  };
};

