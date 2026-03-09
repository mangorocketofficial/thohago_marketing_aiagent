import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoryMd, computeMemoryFreshnessKey } from "@repo/rag";
import type { LatestAnalysisSummary, OrgBrandSettings } from "@repo/types";

const buildBrandSettings = (): OrgBrandSettings => ({
  org_id: "org-1",
  website_url: null,
  naver_blog_url: null,
  instagram_url: null,
  facebook_url: null,
  youtube_url: null,
  threads_url: null,
  crawl_status: {
    state: "idle",
    started_at: null,
    finished_at: null,
    sources: {
      website: {
        source: "website",
        url: "",
        status: "pending",
        started_at: null,
        finished_at: null,
        error: null,
        data: null
      },
      naver_blog: {
        source: "naver_blog",
        url: "",
        status: "pending",
        started_at: null,
        finished_at: null,
        error: null,
        data: null
      },
      instagram: {
        source: "instagram",
        url: "",
        status: "pending",
        started_at: null,
        finished_at: null,
        error: null,
        data: null
      }
    }
  },
  crawl_payload: {},
  interview_answers: {
    q1: "",
    q2: "",
    q3: "",
    q4: ""
  },
  detected_tone: "신뢰감 있고 차분한 톤",
  tone_description: "후원자에게 안정감 있게 설명합니다.",
  target_audience: ["후원자", "자원봉사자"],
  key_themes: ["교육", "현장 이야기"],
  forbidden_words: [],
  forbidden_topics: [],
  campaign_seasons: [],
  brand_summary: "국제개발 NGO로서 교육 지원 활동을 소개합니다.",
  result_document: null,
  memory_md: null,
  memory_md_generated_at: null,
  memory_freshness_key: null,
  rag_indexed_at: null,
  rag_source_hash: null,
  accumulated_insights: {
    best_publish_times: {},
    top_cta_phrases: [],
    content_pattern_summary: "",
    channel_recommendations: {},
    user_edit_preference_summary: "",
    generated_at: "2026-03-09T00:00:00.000Z",
    content_count_at_generation: 0
  },
  rag_ingestion_status: "pending",
  rag_ingestion_started_at: null,
  rag_ingestion_error: null,
  created_at: "2026-03-09T00:00:00.000Z",
  updated_at: "2026-03-09T00:00:00.000Z"
});

const latestAnalysis: LatestAnalysisSummary = {
  summary: "인스타그램 릴스와 블로그 사례형 콘텐츠가 가장 안정적으로 반응했습니다.",
  key_actions: ["릴스 업로드 빈도를 유지합니다.", "블로그 CTA를 본문 상단에도 배치합니다."],
  analyzed_at: "2026-03-09T10:00:00.000Z",
  content_count: 18
};

describe("phase 8-3 memory builder", () => {
  it("includes the latest analysis summary in memory markdown", () => {
    const memory = buildMemoryMd(buildBrandSettings(), [], null, latestAnalysis, {
      generatedAt: "2026-03-09T12:00:00.000Z",
      tokenBudget: 4000
    });

    assert.match(memory.markdown, /Latest Performance Analysis/);
    assert.match(memory.markdown, /인스타그램 릴스와 블로그 사례형 콘텐츠가 가장 안정적으로 반응했습니다\./);
    assert.match(memory.markdown, /릴스 업로드 빈도를 유지합니다\./);
    assert.match(memory.markdown, /블로그 CTA를 본문 상단에도 배치합니다\./);
    assert.equal(memory.generated_at, "2026-03-09T12:00:00.000Z");
  });

  it("changes the freshness key when the latest analysis changes", () => {
    const brandSettings = buildBrandSettings();
    const baseline = computeMemoryFreshnessKey(brandSettings, [], null, latestAnalysis);
    const changed = computeMemoryFreshnessKey(brandSettings, [], null, {
      ...latestAnalysis,
      analyzed_at: "2026-03-10T10:00:00.000Z"
    });

    assert.notEqual(baseline, changed);
  });
});
