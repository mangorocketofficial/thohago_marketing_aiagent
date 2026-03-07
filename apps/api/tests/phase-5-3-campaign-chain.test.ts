import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleCampaignPlanDocument } from "../src/orchestrator/skills/campaign-plan/assembler";
import { runCampaignPlanChain } from "../src/orchestrator/skills/campaign-plan/chain";
import { buildLegacyPlanFields } from "../src/orchestrator/skills/campaign-plan/chain-types";
import type { EnrichedCampaignContext } from "../src/orchestrator/rag-context";

const baseContext: EnrichedCampaignContext = {
  contextLevel: "full",
  memoryMd: "Memory context for NGO",
  brandReviewMd: "Brand review summary",
  interviewAnswers: {
    q1: "Warm and trustworthy",
    q2: "Young monthly donors",
    q3: "Avoid political framing",
    q4: "Spring and year-end"
  },
  folderSummary: "Folder: Project Alpha",
  documentExtracts: "[report.md]\nimpact summary",
  meta: {
    context_level: "full",
    memory_md_generated_at: "2026-03-04T00:00:00.000Z",
    tier2_sources: [],
    total_context_tokens: 800,
    retrieval_avg_similarity: null
  }
};

describe("Phase 5-3 campaign chain", () => {
  it("runs 4-step chain with compact context policy", async () => {
    const prompts: string[] = [];
    const outputs = [
      JSON.stringify({
        primary_audience: {
          label: "Young donors",
          description: "Age 20-34",
          pain_points: ["Trust gap", "Low transparency"],
          active_platforms: ["instagram", "threads"]
        },
        secondary_audience: null,
        funnel_alignment: {
          awareness: "Visibility",
          consideration: "Proof",
          decision: "Donation"
        },
        core_message: "Support creates measurable local impact.",
        support_messages: [
          {
            message: "Your support reaches families directly.",
            target_pain_point: "Trust gap",
            evidence: "Quarterly field reports"
          }
        ],
        channel_tone_guide: {
          instagram: "warm",
          threads: "direct"
        }
      }),
      JSON.stringify({
        owned_channels: [
          {
            channel: "instagram",
            rationale: "Strong engagement",
            content_format: "carousel",
            effort_level: "medium",
            key_strategy: "Impact storytelling"
          }
        ],
        earned_channels: [
          {
            channel: "community_partners",
            rationale: "Trust transfer",
            execution: "Cross-post weekly",
            effort_level: "low"
          }
        ],
        paid_reference: null
      }),
      JSON.stringify({
        weeks: [
          {
            week_number: 1,
            theme: "Introduce field impact",
            phase: "awareness",
            items: [
              {
                day: 1,
                day_label: "D1",
                content_title: "Impact snapshot",
                content_description: "Summary of project outcome",
                channel: "instagram",
                format: "carousel",
                owner_hint: "marketing",
                status: "draft"
              }
            ]
          }
        ],
        dependencies: []
      }),
      JSON.stringify({
        required_assets: [
          {
            id: 1,
            name: "Impact chart",
            asset_type: "design",
            description: "Monthly impact visual",
            priority: "must",
            deadline_hint: "Before D1"
          }
        ],
        kpi_primary: [
          {
            metric: "Donation clicks",
            target: "150",
            measurement: "UTM link",
            reporting_cadence: "weekly"
          }
        ],
        kpi_secondary: [],
        reporting_plan: {
          daily: "track comments",
          weekly: "review CTR",
          post_campaign: "retrospective"
        },
        budget_breakdown: null,
        risks: [
          {
            risk: "Low reach",
            likelihood: "medium",
            mitigation: "Partner reposts"
          }
        ],
        next_steps: [
          {
            action: "Finalize creative brief",
            timing: "today"
          }
        ],
        approval_required: ["Campaign manager"]
      })
    ];

    const result = await runCampaignPlanChain({
      activityFolder: "Project Alpha",
      userMessage: "Create a campaign plan",
      context: baseContext,
      invokeModel: async (prompt) => {
        prompts.push(prompt);
        return {
          text: outputs[prompts.length - 1] ?? null,
          promptTokens: 100,
          completionTokens: 120,
          errorCode: null,
          errorMessage: null
        };
      }
    });

    assert.equal(prompts.length, 4);
    assert.match(prompts[0] ?? "", /RAG CONTEXT/);
    assert.match(prompts[1] ?? "", /COMPACT FACT PACK/);
    assert.match(prompts[2] ?? "", /MICRO FACT PACK/);

    assert.equal(result.chainData.step_meta.step_a.state, "ok");
    assert.equal(result.chainData.step_meta.step_b.state, "ok");
    assert.equal(result.chainData.step_meta.step_c.state, "ok");
    assert.equal(result.chainData.step_meta.step_d.state, "ok");
    assert.equal(result.chainData.context_policy.step_a, "full_rag");
    assert.equal(result.chainData.context_policy.step_b, "compact_fact_pack");
  });

  it("marks downstream steps as blocked when Step A fails after repair retries", async () => {
    let callCount = 0;
    const result = await runCampaignPlanChain({
      activityFolder: "Project Beta",
      userMessage: "Create campaign plan",
      context: baseContext,
      invokeModel: async () => {
        callCount += 1;
        return {
          text: "not a valid json response",
          promptTokens: 50,
          completionTokens: 50,
          errorCode: null,
          errorMessage: null
        };
      }
    });

    assert.equal(callCount, 3);
    assert.equal(result.chainData.step_meta.step_a.state, "failed");
    assert.equal(result.chainData.step_meta.step_a.retry_count, 2);
    assert.equal(result.chainData.step_meta.step_b.state, "blocked_by_dependency");
    assert.equal(result.chainData.step_meta.step_c.state, "blocked_by_dependency");
    assert.equal(result.chainData.step_meta.step_d.state, "blocked_by_dependency");
  });

  it("assembles markdown with placeholder sections when chain data is missing", () => {
    const chainData = {
      audience: null,
      channels: null,
      calendar: null,
      execution: null
    };
    const legacy = buildLegacyPlanFields("Project Gamma", null, chainData);
    const markdown = assembleCampaignPlanDocument({
      plan: legacy,
      audience: null,
      channels: null,
      calendar: null,
      execution: null,
      orgName: "Test Org",
      generatedAt: "2026-03-04T12:00:00.000Z"
    });

    assert.match(markdown, /## 2\. Target Audiences/);
    assert.match(markdown, /This section is unavailable due to step failure or dependency block\./);
  });
});
