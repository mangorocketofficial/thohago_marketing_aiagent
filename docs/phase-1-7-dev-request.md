# Phase 1-7 Development Request
## 또하고 (Ddohago) — Brand Review Synthesis

---

## Overview

This document defines the full scope of **Phase 1-7**: upgrading the brand review synthesis from a rule-based heuristic output to a professional-grade multi-channel brand audit report.

The target output quality is defined by the reference document `월드프렌즈코리아_브랜드리뷰.md`. That document covers a single channel (Instagram). Phase 1-7 produces an equivalent report covering **three channels simultaneously**: website, Instagram, and Naver Blog — with cross-channel consistency analysis added on top.

When Phase 1-7 is complete, the onboarding synthesis step produces a structured Korean Markdown document that a marketing manager at an NGO could immediately act on.

**Depends on:** Phase 1-6b (Brand Review + Interview + Synthesis MVP)

---

## 1. Target Output Document Structure

The synthesized brand review must match this exact section structure:

```
# 브랜드 리뷰: [기관명]

[header metadata]
[data coverage notice]

---

## 종합 요약
- 전체 평가 (2-3 sentences)
- 강점 (bullet)
- 핵심 개선사항 (bullet)

---

## 채널별 상세 분석

### 1. 웹사이트
  - 1-1. 구조 및 탐색성       (table: 이슈 | 위치 | 심각도 | 개선 제안)
  - 1-2. 미션/비전 명확성      (prose)
  - 1-3. 콘텐츠 전문성         (prose)

### 2. 인스타그램
  - 2-1. 프로필 및 바이오      (table)
  - 2-2. 명확성                (prose)
  - 2-3. 일관성                (prose)
  - 2-4. 전문성                (prose)

### 3. 네이버 블로그
  - 3-1. 프로필 및 구성        (table)
  - 3-2. 콘텐츠 전략           (prose)
  - 3-3. SEO 및 검색 최적화    (prose)

---

## 채널 간 브랜드 일관성 분석
  - 브랜드 톤 일관성
  - 핵심 메시지 일관성
  - 비주얼 아이덴티티 일관성
  - 채널별 역할 정의 현황

---

## 법적 / 컴플라이언스 플래그
  (table: 플래그 | 상세 내용 | 권장 조치)
  NGO/소셜벤처/정부기관 특수 사항 포함

---

## 수정 제안 (주요 항목)
  채널별 Before / After (code block format)

---

## 2026년 통합 전략 제안
  채널별 + 크로스채널 전략

---

[footer: 데이터 수집 범위 및 한계]
```

---

## 2. Data Collection Upgrade

### 2.1 Instagram Crawler (New)

Add `apps/desktop/electron/crawler/instagram.mjs`.

Instagram blocks most scraping. Use a best-effort approach with graceful fallback.

**Primary method: public profile JSON endpoint**

```javascript
// apps/desktop/electron/crawler/instagram.mjs

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
]

export async function crawlInstagram(profileUrl) {
  const username = extractUsername(profileUrl)
  if (!username) return { status: 'failed', error: 'Invalid URL', data: null }

  // Attempt 1: public JSON endpoint
  try {
    const res = await fetch(
      `https://www.instagram.com/${username}/?__a=1&__d=dis`,
      {
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (res.ok) {
      const json = await res.json()
      const user = json?.graphql?.user
      if (user) {
        return {
          status: 'done',
          data: {
            username: user.username,
            full_name: user.full_name,
            biography: user.biography,
            external_url: user.external_url,
            followers: user.edge_followed_by?.count,
            following: user.edge_follow?.count,
            posts_count: user.edge_owner_to_timeline_media?.count,
            is_verified: user.is_verified,
            recent_posts: extractRecentPosts(user),
          }
        }
      }
    }
  } catch (e) {
    // fall through to attempt 2
  }

  // Attempt 2: HTML scrape (extract meta tags + ld+json)
  try {
    const html = await fetch(`https://www.instagram.com/${username}/`, {
      headers: { 'User-Agent': USER_AGENTS[0] },
      signal: AbortSignal.timeout(10000),
    }).then(r => r.text())

    const $ = cheerio.load(html)
    const description = $('meta[name="description"]').attr('content') ?? ''
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? ''

    // Instagram meta description format: "X Followers, Y Following, Z Posts"
    const followers = extractFollowerCount(description)

    return {
      status: 'partial',
      note: 'Limited data — JSON endpoint blocked. Meta tags only.',
      data: {
        username,
        full_name: ogTitle.replace(' • Instagram', ''),
        biography: null,
        followers,
        following: null,
        posts_count: null,
        is_verified: null,
        recent_posts: [],
      }
    }
  } catch (e) {
    return {
      status: 'failed',
      error: e.message,
      data: { username, biography: null, followers: null, recent_posts: [] }
    }
  }
}

function extractRecentPosts(user) {
  return (user.edge_owner_to_timeline_media?.edges ?? [])
    .slice(0, 12)
    .map(e => ({
      caption: e.node.edge_media_to_caption?.edges[0]?.node?.text ?? null,
      likes: e.node.edge_liked_by?.count ?? null,
      type: e.node.__typename,  // GraphImage | GraphVideo | GraphSidecar
      timestamp: e.node.taken_at_timestamp,
    }))
}

function extractUsername(url) {
  const match = url.match(/instagram\.com\/([^/?#]+)/)
  return match ? match[1].replace('@', '') : null
}
```

**Fallback behavior:**

| Crawl Result | What AI receives | Report note |
|---|---|---|
| `status: done` | Full profile + posts | Full analysis |
| `status: partial` | Username + follower count | "일부 데이터만 수집됨" note added |
| `status: failed` | Username only | "접근 불가 — 수동 검토 필요" note added |

### 2.2 Website Crawler Upgrade

Extend existing `website.mjs` to extract more structured data:

```javascript
// Additional extractions
return {
  ...existing,
  // Navigation structure
  nav_items: $('nav a').map((_, el) => $(el).text().trim()).get().filter(Boolean),
  // Contact info presence
  has_contact_page: $('a[href*="contact"], a[href*="연락"]').length > 0,
  // CTA buttons
  cta_buttons: $('a.btn, button, .cta').map((_, el) => $(el).text().trim()).get().slice(0, 10),
  // Mission/vision text (look for common Korean NGO patterns)
  mission_section: extractSection($, ['미션', '비전', 'mission', 'vision', '설립목적']),
  // Footer: copyright, registration info
  footer_text: $('footer').text().trim().slice(0, 500),
  // Language: detect if bilingual
  has_english: $('html').attr('lang') === 'en' || $('[lang="en"]').length > 0,
}
```

### 2.3 Naver Blog Crawler Upgrade

Extend existing `naver-blog.mjs` to extract more structured data:

```javascript
return {
  ...existing,
  // Post frequency analysis
  post_dates: extractPostDates($),       // array of recent post dates
  // Category structure
  categories: extractCategories($),      // blog categories if visible
  // Average post length
  avg_content_length: calculateAvgLength(posts),
  // Comment/reaction signals
  has_engagement: posts.some(p => p.comment_count > 0),
}
```

---

## 3. API: Brand Review Synthesis Endpoint

### Endpoint

```
POST /onboarding/synthesize
Authorization: Bearer {user_jwt}
Body: {
  org_id: string,
  crawl_result: {
    state: 'running' | 'done',
    sources: {
      website: CrawlResult,
      naver_blog: CrawlResult,
      instagram?: CrawlResult, // optional best-effort
    }
  },
  interview_answers: {
    q1: string,
    q2: string,
    q3: string,
    q4: string,
  },
  url_metadata?: {
    website_url?: string,
    naver_blog_url?: string,
    instagram_url?: string,
    facebook_url?: string,
    youtube_url?: string,
    threads_url?: string,
  },
  synthesis_mode?: 'phase_1_7'
}
Returns: {
  brand_profile: BrandProfile,
  onboarding_result_document: OnboardingResultDocument,
  review_markdown?: string, // full Korean Markdown
}
```

Use the existing endpoint and extend payload/response in a backward-compatible way.

### Claude Opus Prompt

This is the core of Phase 1-7. The prompt must produce a document matching the reference quality.

```typescript
// apps/api/src/routes/onboarding.ts

const BRAND_REVIEW_SYSTEM_PROMPT = `
당신은 한국 NGO·소셜벤처·사회적기업 전문 디지털 마케팅 컨설턴트입니다.
10년 이상의 경험을 바탕으로 온라인 채널 감사, 브랜드 전략 수립, 
콘텐츠 마케팅을 전문으로 합니다.

작성 원칙:
- 구체적인 수치와 예시를 반드시 포함하세요
- 모호한 표현 대신 실행 가능한 제안을 작성하세요
- 한국 NGO/소셜벤처 환경의 특수성을 반영하세요 (제한된 예산, 소규모 팀, 공익적 미션)
- 각 이슈의 심각도를 **높음/중간/낮음** 중 하나로 반드시 분류하세요
- 수정 제안은 반드시 Before/After 형식으로 제공하세요
- 2026년 현재 SNS 트렌드를 반영하세요
`

const buildBrandReviewPrompt = (org, crawlResults, interviewAnswers) => `
다음 기관의 온라인 채널을 종합 감사하고 전문적인 브랜드 리뷰 보고서를 작성해주세요.

---
## 수집된 데이터

### 기관 기본 정보
- 기관명: ${org.name}
- 기관 유형: ${org.org_type}
- 웹사이트: ${org.website}

### 웹사이트 크롤링 결과
${JSON.stringify(crawlResults.website, null, 2)}

### 인스타그램 크롤링 결과
${JSON.stringify(crawlResults.instagram, null, 2)}

### 네이버 블로그 크롤링 결과
${JSON.stringify(crawlResults.naver_blog, null, 2)}

### 유저 인터뷰 답변
- 브랜드 톤: ${interviewAnswers.tone_confirmation}
- 타겟 오디언스: ${interviewAnswers.target_audience}
- 금지 단어/주제: ${interviewAnswers.forbidden_words}
- 주요 마케팅 시즌: ${interviewAnswers.campaign_seasons}

---
## 작성할 보고서 구조

아래 구조를 정확히 따라 한국어 마크다운 문서를 작성하세요.
크롤링에 실패한 채널은 "데이터 수집 불가" 표시 후 가능한 범위 내에서 분석하세요.

# 브랜드 리뷰: ${org.name}

**작성일:** ${new Date().toLocaleDateString('ko-KR')}
**검토 채널:** 웹사이트, 인스타그램, 네이버 블로그
**리뷰 유형:** 종합 브랜드 감사
**데이터 수집 범위:** [수집된 채널과 한계를 1-2문장으로 명시]

---

## 종합 요약

**전체 평가:** [3-4문장. 기관 규모와 미션 대비 현재 디지털 마케팅 상태를 평가]

**강점:**
- [구체적 강점 2-3개]

**핵심 개선사항:**
- [우선순위 순으로 개선사항 3-4개]

---

## 채널별 상세 분석

### 1. 웹사이트

#### 1-1. 구조 및 탐색성

| 이슈 | 위치 | 심각도 | 개선 제안 |
|------|------|--------|-----------|
[이슈 3-5개]

#### 1-2. 미션/비전 명확성
[2-3단락 산문 분석]

#### 1-3. 콘텐츠 전문성
[2-3단락 산문 분석]

### 2. 인스타그램

#### 2-1. 프로필 및 바이오

| 이슈 | 위치 | 심각도 | 개선 제안 |
|------|------|--------|-----------|
[이슈 4-6개]

#### 2-2. 명확성
[2-3단락 산문 분석]

#### 2-3. 일관성
[2-3단락 산문 분석]

#### 2-4. 전문성
[2-3단락 산문 분석. 팔로워 수, 게시물 수, 팔로잉 비율 등 수치 포함]

### 3. 네이버 블로그

#### 3-1. 프로필 및 구성

| 이슈 | 위치 | 심각도 | 개선 제안 |
|------|------|--------|-----------|
[이슈 3-5개]

#### 3-2. 콘텐츠 전략
[2-3단락 산문 분석]

#### 3-3. SEO 및 검색 최적화
[2-3단락 산문 분석]

---

## 채널 간 브랜드 일관성 분석

### 브랜드 톤 일관성
[채널별 톤 차이 비교 분석]

### 핵심 메시지 일관성
[채널별 핵심 메시지 일치 여부 분석]

### 채널별 역할 정의 현황
[각 채널이 명확한 역할을 갖고 있는지 평가]

---

## 법적 / 컴플라이언스 플래그

| 플래그 | 상세 내용 | 권장 조치 |
|--------|-----------|-----------|
[NGO/소셜벤처 특수 사항 포함하여 3-5개]

---

## 수정 제안 (주요 항목)

[채널별로 가장 임팩트 높은 Before/After 제안 각 1-2개]

### [채널명] — [항목명] 현재:
\`\`\`
[현재 텍스트]
\`\`\`

### [채널명] — [항목명] 수정안:
\`\`\`
[수정안 텍스트]
\`\`\`

**변경 사항:**
- [변경 이유 bullet points]

---

## 2026년 통합 전략 제안

[채널별 + 크로스채널 전략 5-7개. 각 제안에 실행 난이도 표시: 🟢쉬움/🟡보통/🔴어려움]

---

*본 리뷰는 [데이터 수집 방법과 한계를 1문장으로 명시]. 
각 채널에 대한 심층 분석을 위해서는 직접 접근 권한이 필요합니다.*
`
```

---

## 4. Output Handling

### 4.1 Storage

The generated Markdown document is stored in two places:

```typescript
// 1. Supabase org_brand_settings
await supabaseAdmin
  .from('org_brand_settings')
  .upsert({
    org_id,
    detected_tone: extractedProfile.detected_tone,
    tone_description: extractedProfile.tone_guardrails.join(' '),
    target_audience: extractedProfile.target_audience,
    key_themes: extractedProfile.key_themes,
    forbidden_words: extractedProfile.forbidden_words,
    forbidden_topics: extractedProfile.forbidden_topics,
    campaign_seasons: extractedProfile.campaign_seasons,
    brand_summary: extractedProfile.organization_summary,
    result_document: {
      version: 'phase_1_7',
      format: 'markdown',
      review_markdown: reviewMarkdown,
      template_ref: 'docs/월드프렌즈코리아_브랜드리뷰.md',
      generated_at: new Date().toISOString(),
    }, // keep JSONB shape compatible with existing schema
    updated_at: new Date().toISOString(),
  })

// 2. Local marketing folder export
// Written to: {watchPath}/브랜드리뷰_{YYYY-MM-DD}.md
await ipcMain.emit('export-brand-review', {
  watchPath: store.get('watchPath'),
  content: reviewMarkdown,
  filename: `브랜드리뷰_${dateStr}.md`
})
```

### 4.2 Extracted Brand Profile (for AI context)

After generating the Markdown, extract a structured JSON profile that the orchestrator uses when generating campaigns and content:

```typescript
// apps/api/src/routes/onboarding.ts

// Second Claude call: extract structured profile from the review document
const profileExtractionPrompt = `
다음 브랜드 리뷰 문서에서 AI 마케팅 에이전트가 사용할 구조화된 프로필을 추출하세요.

[브랜드 리뷰 문서]
${reviewMarkdown}

JSON 형식으로만 응답하세요:
{
  "brand_tone": string,
  "tone_description": string,
  "target_audience": string[],
  "key_themes": string[],
  "forbidden_words": string[],
  "forbidden_topics": string[],
  "campaign_seasons": string[],
  "suggested_hashtags": string[],
  "channel_roles": {
    "instagram": string,
    "naver_blog": string,
    "website": string
  },
  "top_priorities": string[]   // top 3 improvement priorities
}
`
```

---

## 5. Onboarding Step 5 UI Update

Step 5 (synthesis) in the onboarding renderer needs to show the brand review document in a readable format.

```
┌─────────────────────────────────────────────────────┐
│  브랜드 리뷰 완성! 📋                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  # 브랜드 리뷰: 월드프렌즈코리아             │   │
│  │                                             │   │
│  │  ## 종합 요약                               │   │
│  │  전체 평가: WFK의 디지털 채널은...          │   │
│  │  강점: 바이오의 세 가지 콘텐츠 축...        │   │
│  │                                             │   │
│  │  [스크롤 가능한 마크다운 뷰어]              │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  📁 마케팅 폴더에 저장됨:                           │
│     ~/WFK_Marketing/브랜드리뷰_2026-02-28.md       │
│                                                     │
│  [ 다음 → ]                                        │
└─────────────────────────────────────────────────────┘
```

Use `react-markdown` to render the document in the renderer.

---

## 6. Dependencies to Add

```json
// apps/desktop/package.json
{
  "dependencies": {
    "react-markdown": "^9.0.0"
  }
}
```

---

## 7. Updated Shared Types

Keep the existing `BrandProfile` and `OnboardingResultDocument` contracts from Phase 1-6b.
For Phase 1-7, add only optional fields (non-breaking):

- `OnboardingResultDocument.review_markdown?: string`
- `OnboardingResultDocument.report_version?: 'phase_1_7'`
- `OnboardingResultDocument.template_ref?: '월드프렌즈코리아_브랜드리뷰.md'`
- `OnboardingResultDocument.data_coverage_notice?: string`
- `BrandProfile.channel_roles?: { instagram?: string; naver_blog?: string; website?: string }`
- `BrandProfile.top_priorities?: string[]`
- `BrandProfile.suggested_hashtags?: string[]`

Do not rename or remove existing fields such as `detected_tone`, `organization_summary`, and `confidence_notes`.

---

## 8. Acceptance Criteria

Phase 1-7 is complete when:

- [ ] Instagram crawler attempts JSON endpoint first, falls back to meta tags, degrades gracefully to username-only
- [ ] Crawl results passed to `POST /onboarding/synthesize` (extended payload)
- [ ] Claude Opus generates Korean Markdown matching the target document structure (all 6 sections present)
- [ ] Generated document contains: issue tables with severity ratings, prose analysis sections, before/after suggestions, strategy recommendations
- [ ] Document saved to Supabase `org_brand_settings.result_document`
- [ ] Document exported to local watch folder as `브랜드리뷰_{date}.md`
- [ ] Structured `brand_profile` JSON extracted and saved alongside document
- [ ] Step 5 renderer displays the Markdown document with `react-markdown`
- [ ] Step 5 does not expose a "다시 생성하기" action
- [ ] No schema-breaking DB change from existing `org_brand_settings` structure
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

### Quality Gate

Run the full onboarding flow with WFK test data. The generated document must contain:
- [ ] At least 5 issues in the issue tables (across all channels)
- [ ] At least 1 before/after suggestion per channel
- [ ] At least 5 strategy recommendations with difficulty ratings
- [ ] Compliance/legal flags section with NGO-specific items
- [ ] Cross-channel consistency analysis section

---

## 9. Out of Scope for Phase 1-7

- Facebook / YouTube crawling
- Scheduled brand review refresh (periodic re-audit)
- Brand Review re-run from Settings menu
- Competitor analysis
- Engagement rate calculation (requires post-level data)
- RAG ingestion of brand review document (Phase 2)

---

## Notes for Developer

- Instagram crawling is best-effort. The endpoint `/?__a=1&__d=dis` has been intermittently available for years but is not officially supported. Always degrade gracefully — never block onboarding on Instagram crawl failure.
- Claude Opus is the right model here. This is a complex, long-form document generation task requiring judgment and domain knowledge. Do not substitute with a cheaper model for this step.
- The prompt instructs Claude to use `\`\`\`` code blocks for before/after suggestions. Ensure the generated Markdown is valid and renders correctly in `react-markdown`.
- The brand profile JSON extraction is a second, separate Claude call on the completed document — not part of the main generation call. This ensures the structured data is cleanly extracted without interfering with document formatting.
- Export to local folder uses the same `watchPath` from `electron-store`. If `watchPath` is not set yet (unlikely at Step 5 but possible), skip local export silently.
- `result_document` in Supabase follows the existing JSONB contract. Store Markdown under a nested field (for example `review_markdown`) to avoid schema mismatch.
- Use `docs/월드프렌즈코리아_브랜드리뷰.md` as the style/section reference when validating prompt outputs.

---

*Document version: v1.0*
*Phase: 1-7 Brand Review Synthesis*
*Service name: 또하고 (Ddohago)*
*Agent name: 또대리 (Ddo-Daeri)*
*Reference output: 월드프렌즈코리아_브랜드리뷰.md*
*Depends on: Phase 1-6b (Brand Review + Interview + Synthesis MVP)*
*Created: 2026-03-01*
