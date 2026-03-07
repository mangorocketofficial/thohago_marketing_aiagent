import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCampaignPlanPreferences,
  buildFallbackAudienceFromPlan,
  buildFallbackCalendarFromPlan,
  buildFallbackChannelStrategyFromPlan,
  buildFallbackExecutionFromPlan,
  normalizePreferredChannels,
  resolveDurationDaysFromText
} from "../src/orchestrator/skills/campaign-plan/fallback";
import type { CampaignPlan } from "../src/orchestrator/types";

const basePlan: CampaignPlan = {
  objective: "Test objective",
  channels: ["instagram"],
  duration_days: 7,
  post_count: 2,
  content_types: ["text"],
  suggested_schedule: [
    { day: 1, channel: "instagram", type: "text" },
    { day: 4, channel: "instagram", type: "text" }
  ]
};

describe("campaign plan fallback helpers", () => {
  it("parses month duration text", () => {
    assert.equal(resolveDurationDaysFromText("기간 1개월"), 30);
    assert.equal(resolveDurationDaysFromText("for 2 weeks"), 14);
  });

  it("normalizes preferred channels", () => {
    const channels = normalizePreferredChannels(["Instagram, Naver Blog", "youtube"]);
    assert.deepEqual(channels, ["instagram", "naver_blog", "youtube"]);
  });

  it("expands schedule when calendar is unavailable", () => {
    const adjusted = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays: 30,
      preferredChannels: ["instagram", "youtube"],
      calendarAvailable: false
    });

    assert.equal(adjusted.duration_days, 30);
    assert.equal(adjusted.channels.includes("youtube"), true);
    assert.ok(adjusted.post_count >= 10);
    assert.equal(adjusted.suggested_schedule.length, adjusted.post_count);
  });

  it("keeps schedule when calendar is available", () => {
    const adjusted = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays: 30,
      preferredChannels: ["instagram", "youtube"],
      calendarAvailable: true
    });

    assert.equal(adjusted.duration_days, basePlan.duration_days);
    assert.equal(adjusted.post_count, basePlan.post_count);
  });

  it("builds non-empty fallback calendar and execution", () => {
    const adjusted = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays: 30,
      preferredChannels: ["instagram"],
      calendarAvailable: false
    });

    const calendar = buildFallbackCalendarFromPlan(adjusted);
    const execution = buildFallbackExecutionFromPlan(adjusted);

    assert.ok(calendar.weeks.length > 0);
    assert.ok(calendar.weeks[0]?.items.length > 0);
    assert.ok(execution.required_assets.length > 0);
    assert.ok(execution.kpi_primary.length > 0);
    assert.ok(execution.next_steps.length > 0);
  });

  it("builds fallback audience and channel strategy from plan", () => {
    const adjusted = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays: 30,
      preferredChannels: ["instagram", "youtube"],
      calendarAvailable: false
    });
    const audience = buildFallbackAudienceFromPlan(adjusted);
    const channels = buildFallbackChannelStrategyFromPlan(adjusted);

    assert.ok(audience.primary_audience.label.length > 0);
    assert.ok(audience.core_message.length > 0);
    assert.ok(Object.keys(audience.channel_tone_guide).length > 0);
    assert.ok(channels.owned_channels.length >= 2);
    assert.equal(channels.paid_reference, null);
  });
});
