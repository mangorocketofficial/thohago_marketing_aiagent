import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_HEADINGS = 8;
const MAX_PARAGRAPHS = 8;
const MAX_ITEM_LENGTH = 280;

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = MAX_ITEM_LENGTH) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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

const pickTextList = ($, $nodes, limit) => {
  const rows = [];
  $nodes.each((_, node) => {
    if (rows.length >= limit) {
      return false;
    }
    const value = clampText($(node).text());
    if (value) {
      rows.push(value);
    }
    return true;
  });
  return rows;
};

export const crawlWebsite = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("website url is missing.");
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
    throw new Error(`Website crawl failed with status ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = clampText($("title").first().text(), 160);
  const metaDescription = clampText(
    $('meta[name="description"]').first().attr("content") ||
      $('meta[property="og:description"]').first().attr("content") ||
      "",
    300
  );
  const headings = pickTextList($, $("h1, h2"), MAX_HEADINGS);
  const paragraphs = pickTextList($, $("main p, article p, section p, p"), MAX_PARAGRAPHS);

  return {
    url: normalizedUrl,
    title,
    meta_description: metaDescription,
    headings,
    paragraphs
  };
};
