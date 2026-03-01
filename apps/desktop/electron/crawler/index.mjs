import { crawlNaverBlog } from "./naver-blog.mjs";
import { crawlInstagram } from "./instagram.mjs";
import { crawlWebsite } from "./website.mjs";

const nowIso = () => new Date().toISOString();
const MAX_SOURCE_JSON_CHARS = 32_000;
const SOURCE_STATUS_SET = new Set(["done", "partial", "failed"]);

const buildSource = (source, url) => ({
  source,
  url: String(url ?? "").trim(),
  status: "pending",
  started_at: null,
  finished_at: null,
  error: null,
  data: null
});

const finalizeState = (state) => ({
  ...state,
  state: "done",
  finished_at: nowIso()
});

const normalizeWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clampText = (value, maxLength = 600) => {
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

const sanitizeForPayload = (
  value,
  options = {
    depth: 0,
    maxDepth: 4,
    maxArray: 24,
    maxKeys: 28,
    maxStringLength: 600
  }
) => {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string") {
    return clampText(value, options.maxStringLength);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (options.depth >= options.maxDepth) {
    if (Array.isArray(value)) {
      return [];
    }
    if (isPlainObject(value)) {
      return {};
    }
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArray)
      .map((item) =>
        sanitizeForPayload(item, {
          ...options,
          depth: options.depth + 1
        })
      );
  }

  if (isPlainObject(value)) {
    const next = {};
    for (const key of Object.keys(value).slice(0, options.maxKeys)) {
      next[key] = sanitizeForPayload(value[key], {
        ...options,
        depth: options.depth + 1
      });
    }
    return next;
  }

  return clampText(String(value), options.maxStringLength);
};

const capSourceData = (value) => {
  const attemptA = sanitizeForPayload(value);
  const sizeA = JSON.stringify(attemptA ?? null).length;
  if (sizeA <= MAX_SOURCE_JSON_CHARS) {
    return attemptA;
  }

  const attemptB = sanitizeForPayload(value, {
    depth: 0,
    maxDepth: 3,
    maxArray: 8,
    maxKeys: 16,
    maxStringLength: 220
  });
  const sizeB = JSON.stringify(attemptB ?? null).length;
  if (sizeB <= MAX_SOURCE_JSON_CHARS) {
    return attemptB;
  }

  return {
    truncated: true,
    reason: "source_payload_too_large",
    preview: clampText(JSON.stringify(attemptB ?? null), 1_200)
  };
};

const normalizeRunResult = (result) => {
  if (isPlainObject(result) && SOURCE_STATUS_SET.has(String(result.status))) {
    return {
      status: String(result.status),
      data: capSourceData(result.data ?? null),
      error: result.error ? clampText(result.error, 220) : null
    };
  }

  return {
    status: "done",
    data: capSourceData(result ?? null),
    error: null
  };
};

const runSource = async (params) => {
  const { state, sourceKey, run, onProgress } = params;
  const source = state.sources[sourceKey];
  if (!source.url) {
    source.status = "skipped";
    source.started_at = nowIso();
    source.finished_at = nowIso();
    source.error = null;
    source.data = null;
    onProgress(sourceKey, source, state);
    return;
  }

  source.status = "running";
  source.started_at = nowIso();
  source.finished_at = null;
  source.error = null;
  source.data = null;
  onProgress(sourceKey, source, state);

  try {
    const result = await run(source.url);
    const normalized = normalizeRunResult(result);
    source.status = normalized.status;
    source.finished_at = nowIso();
    source.error = normalized.error;
    source.data = normalized.data;
    onProgress(sourceKey, source, state);
  } catch (error) {
    source.status = "failed";
    source.finished_at = nowIso();
    source.error = error instanceof Error ? error.message : "Unknown crawl error.";
    source.data = null;
    onProgress(sourceKey, source, state);
  }
};

export const createInitialCrawlState = (urls = {}) => {
  const websiteUrl = String(urls.websiteUrl ?? "").trim();
  const naverBlogUrl = String(urls.naverBlogUrl ?? "").trim();
  const instagramUrl = String(urls.instagramUrl ?? "").trim();
  return {
    state: "idle",
    started_at: null,
    finished_at: null,
    sources: {
      website: buildSource("website", websiteUrl),
      naver_blog: buildSource("naver_blog", naverBlogUrl),
      instagram: buildSource("instagram", instagramUrl)
    }
  };
};

export const runOnboardingCrawl = async (params) => {
  const state = createInitialCrawlState(params?.urls ?? {});
  state.state = "running";
  state.started_at = nowIso();
  state.finished_at = null;

  const onProgress =
    typeof params?.onSourceProgress === "function"
      ? params.onSourceProgress
      : () => {
          // no-op
        };

  await Promise.all([
    runSource({
      state,
      sourceKey: "website",
      run: crawlWebsite,
      onProgress
    }),
    runSource({
      state,
      sourceKey: "naver_blog",
      run: crawlNaverBlog,
      onProgress
    }),
    runSource({
      state,
      sourceKey: "instagram",
      run: crawlInstagram,
      onProgress
    })
  ]);

  return finalizeState(state);
};
