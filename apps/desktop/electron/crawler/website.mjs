import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15_000;
const SUBPAGE_TIMEOUT_MS = 10_000;
const MAX_HEADINGS = 15;
const MAX_PARAGRAPHS = 15;
const MAX_ITEM_LENGTH = 280;
const MAX_NAV_ITEMS = 12;
const MAX_CTA_BUTTONS = 8;
const MAX_SUBPAGES = 2;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MISSION_KEYWORDS = /(미션|비전|소개|인사말|mission|vision|about)/i;
const CTA_KEYWORDS = /(참여|후원|신청|문의|자세히|지원|바로가기|donate|join|apply|contact|learn more|start|signup|register)/i;
const NOISE_TEXT = /^(로고|POPUP|메뉴|닫기|검색|홈|HOME|TOP|CLOSE|더보기)$/i;

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = MAX_ITEM_LENGTH) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
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

const toAbsoluteUrl = (baseUrl, maybeRelative) => {
  const raw = String(maybeRelative ?? "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) {
    return "";
  }
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
};

const isUiNoise = (text) => {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }
  if (normalized.length < 5) {
    return true;
  }
  return NOISE_TEXT.test(normalized);
};

const removeUiNoiseElements = ($) => {
  $("script, style, noscript, svg, form, input, select, option").remove();
  $('.popup, #popup, [class*="popup"], [class*="banner"], .skip-nav').remove();
};

const pickTextList = ($, $nodes, limit, maxLength = MAX_ITEM_LENGTH) => {
  const rows = [];
  const seen = new Set();
  $nodes.each((_, node) => {
    if (rows.length >= limit) {
      return false;
    }
    const value = clampText($(node).text(), maxLength);
    if (!value || isUiNoise(value)) {
      return true;
    }
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    rows.push(value);
    return true;
  });
  return rows;
};

const findContactPage = ($) => {
  let found = false;
  $("a[href]").each((_, node) => {
    const href = String($(node).attr("href") ?? "").trim();
    const text = normalizeWhitespace($(node).text());
    if (/(contact|문의|연락|ask)/i.test(href) || /(문의|연락|contact)/i.test(text)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
};

const extractMissionSection = ($) => {
  const chunks = [];
  const seen = new Set();

  $("h1, h2, h3, h4, strong").each((_, node) => {
    const heading = normalizeWhitespace($(node).text());
    if (!heading || !MISSION_KEYWORDS.test(heading)) {
      return true;
    }

    const container = $(node).closest("section, article, div");
    const text = clampText(container.text() || heading, 320);
    if (!text || text.length < 30 || seen.has(text)) {
      return true;
    }
    seen.add(text);
    chunks.push(text);
    if (chunks.length >= 3) {
      return false;
    }
    return true;
  });

  if (!chunks.length) {
    const bodyText = clampText($("main, article, body").first().text(), 1200);
    if (MISSION_KEYWORDS.test(bodyText)) {
      chunks.push(bodyText);
    }
  }

  return clampText(chunks.join(" "), 600);
};

const extractCtaButtons = ($) => {
  const ctas = [];
  const seen = new Set();

  $("a, button").each((_, node) => {
    if (ctas.length >= MAX_CTA_BUTTONS) {
      return false;
    }
    const text = clampText($(node).text(), 80);
    if (!text || isUiNoise(text)) {
      return true;
    }

    const className = String($(node).attr("class") ?? "");
    const isCta = CTA_KEYWORDS.test(text) || /btn|button|cta/i.test(className);
    if (!isCta || seen.has(text)) {
      return true;
    }
    seen.add(text);
    ctas.push(text);
    return true;
  });

  return ctas;
};

const pickSubpageUrls = ($, baseUrl) => {
  const urls = [];
  const seen = new Set();
  const base = (() => {
    try {
      return new URL(baseUrl);
    } catch {
      return null;
    }
  })();

  $("a[href]").each((_, node) => {
    if (urls.length >= MAX_SUBPAGES) {
      return false;
    }
    const href = String($(node).attr("href") ?? "").trim();
    const linkText = normalizeWhitespace($(node).text());
    const absolute = toAbsoluteUrl(baseUrl, href);
    if (!absolute) {
      return true;
    }

    let parsed = null;
    try {
      parsed = new URL(absolute);
    } catch {
      return true;
    }
    if (!base || parsed.origin !== base.origin) {
      return true;
    }

    const marker = `${parsed.pathname} ${linkText}`.toLowerCase();
    const looksRelevant = /(about|introduce|mission|vision|greeting|소개|미션|비전|인사말)/i.test(marker);
    if (!looksRelevant || seen.has(parsed.toString())) {
      return true;
    }

    seen.add(parsed.toString());
    urls.push(parsed.toString());
    return true;
  });

  return urls.slice(0, MAX_SUBPAGES);
};

const crawlSubPage = async (url) => {
  const response = await withTimeout(
    url,
    {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    },
    SUBPAGE_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Subpage crawl failed with status ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  removeUiNoiseElements($);

  return {
    url,
    title: clampText($("title").first().text(), 160),
    headings: pickTextList($, $("h1, h2, h3"), 10, 220),
    paragraphs: pickTextList($, $("main p, article p, section p, p"), 10, 240),
    mission_section: extractMissionSection($)
  };
};

export const crawlWebsite = async (url) => {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) {
    throw new Error("website url is missing.");
  }

  const response = await withTimeout(normalizedUrl, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Website crawl failed with status ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  removeUiNoiseElements($);

  const title = clampText($("title").first().text(), 160);
  const metaDescription = clampText(
    $('meta[name="description"]').first().attr("content") ||
      $('meta[property="og:description"]').first().attr("content") ||
      "",
    300
  );
  const headings = pickTextList($, $("h1, h2"), MAX_HEADINGS);
  const paragraphs = pickTextList($, $("main p, article p, section p, p"), MAX_PARAGRAPHS);
  const navItems = pickTextList($, $("nav a"), MAX_NAV_ITEMS, 80);
  const footerText = clampText($("footer").text(), 500);
  const hasContactPage = findContactPage($);
  const missionSection = extractMissionSection($);
  const ctaButtons = extractCtaButtons($);

  const subpageUrls = pickSubpageUrls($, normalizedUrl);
  const subpageResults = await Promise.allSettled(subpageUrls.map((subUrl) => crawlSubPage(subUrl)));
  const subPages = subpageResults
    .filter((row) => row.status === "fulfilled")
    .map((row) => row.value);

  return {
    url: normalizedUrl,
    title,
    meta_description: metaDescription,
    headings,
    paragraphs,
    nav_items: navItems,
    footer_text: footerText || null,
    has_contact_page: hasContactPage,
    mission_section: missionSection || null,
    cta_buttons: ctaButtons,
    sub_pages: subPages
  };
};
