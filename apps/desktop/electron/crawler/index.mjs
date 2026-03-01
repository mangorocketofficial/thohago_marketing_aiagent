import { crawlNaverBlog } from "./naver-blog.mjs";
import { crawlWebsite } from "./website.mjs";

const nowIso = () => new Date().toISOString();

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
    const data = await run(source.url);
    source.status = "done";
    source.finished_at = nowIso();
    source.error = null;
    source.data = data;
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
  return {
    state: "idle",
    started_at: null,
    finished_at: null,
    sources: {
      website: buildSource("website", websiteUrl),
      naver_blog: buildSource("naver_blog", naverBlogUrl)
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
    })
  ]);

  return finalizeState(state);
};
