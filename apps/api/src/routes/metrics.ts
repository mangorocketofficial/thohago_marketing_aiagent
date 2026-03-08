import { parseAccumulatedInsights } from "@repo/analytics";
import { Router } from "express";
import type { Channel, ContentMetricsRow, PublishedContentWithMetrics } from "@repo/types";
import { requireApiSecret } from "../lib/auth";
import { HttpError, toHttpError } from "../lib/errors";
import { parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";
import { supabaseAdmin } from "../lib/supabase-admin";
import { computePerformanceScore, loadOrgChannelStats, type OrgChannelStats } from "../rag/performance-scorer";
import {
  MAX_LIST_LIMIT,
  PUBLISHED_STATUSES,
  SYNC_FOLLOWUP_ENTRY_LIMIT,
  buildMetricsCursorFilter,
  encodeMetricsCursor,
  parseMetricsCursor,
  parseMetricsEntries,
  parseOptionalChannel,
  parsePositiveInt,
  parseRequestIdempotencyKey,
  runMetricsFollowUp,
  sendMetricsError,
  toCanonicalMetrics
} from "./metrics-helpers";

export const metricsRouter: Router = Router();

metricsRouter.get("/orgs/:orgId/metrics/insights", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const { data, error } = await supabaseAdmin
      .from("org_brand_settings")
      .select("accumulated_insights,updated_at")
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "db_error", `Failed to load accumulated insights: ${error.message}`);
    }

    const insights = parseAccumulatedInsights(data?.accumulated_insights ?? null);
    res.json({
      ok: true,
      insights,
      updated_at: typeof data?.updated_at === "string" ? data.updated_at : null,
      source: insights ? "live" : "empty"
    });
  } catch (error) {
    sendMetricsError(res, error);
  }
});

metricsRouter.get("/orgs/:orgId/metrics/published-contents", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const limit = parsePositiveInt(req.query.limit, "limit", 20, MAX_LIST_LIMIT);
    const channel = parseOptionalChannel(req.query.channel, "channel");
    const cursor = parseMetricsCursor(req.query.cursor);

    let query = supabaseAdmin
      .from("contents")
      .select("id,channel,body,published_at,created_at")
      .eq("org_id", orgId)
      .in("status", [...PUBLISHED_STATUSES])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (channel) {
      query = query.eq("channel", channel);
    }
    if (cursor) {
      query = query.or(buildMetricsCursorFilter(cursor));
    }

    const { data, error } = await query;
    if (error) {
      throw new HttpError(500, "db_error", `Failed to list published contents: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const contentIds = pageRows
      .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
      .filter((id) => !!id);

    const latestMetricsByContent = new Map<string, ContentMetricsRow>();
    if (contentIds.length > 0) {
      const { data: metricsData, error: metricsError } = await supabaseAdmin
        .from("content_metrics")
        .select(
          "id,org_id,content_id,channel,likes,views,comments,shares,saves,follower_delta,performance_score,collection_source,idempotency_key,collected_at,created_at"
        )
        .eq("org_id", orgId)
        .in("content_id", contentIds)
        .order("collected_at", { ascending: false });

      if (metricsError) {
        throw new HttpError(500, "db_error", `Failed to load content metrics: ${metricsError.message}`);
      }

      for (const row of Array.isArray(metricsData) ? metricsData : []) {
        const contentId = typeof row.content_id === "string" ? row.content_id.trim() : "";
        if (!contentId || latestMetricsByContent.has(contentId)) {
          continue;
        }
        latestMetricsByContent.set(contentId, row as ContentMetricsRow);
      }
    }

    const items: PublishedContentWithMetrics[] = pageRows.map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      channel: (typeof row.channel === "string" ? row.channel : "instagram") as Channel,
      body: typeof row.body === "string" ? row.body : null,
      published_at: typeof row.published_at === "string" ? row.published_at : null,
      created_at: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
      latest_metrics: latestMetricsByContent.get(typeof row.id === "string" ? row.id : "") ?? null
    }));

    const last = items[items.length - 1];
    res.json({
      ok: true,
      items,
      next_cursor: hasMore && last ? encodeMetricsCursor({ created_at: last.created_at, id: last.id }) : null
    });
  } catch (error) {
    sendMetricsError(res, error);
  }
});

metricsRouter.post("/orgs/:orgId/metrics/batch", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const entries = parseMetricsEntries(body.entries);
    const requestIdempotencyKey = parseRequestIdempotencyKey(body);
    const contentIds = entries.map((entry) => entry.content_id);

    const { data: contentRows, error: contentsError } = await supabaseAdmin
      .from("contents")
      .select("id,channel,status")
      .eq("org_id", orgId)
      .in("id", contentIds);

    if (contentsError) {
      throw new HttpError(500, "db_error", `Failed to validate content ownership: ${contentsError.message}`);
    }

    const contentById = new Map<string, { channel: Channel; status: string }>();
    for (const row of Array.isArray(contentRows) ? contentRows : []) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const channel = typeof row.channel === "string" ? (row.channel.trim().toLowerCase() as Channel) : "";
      const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
      if (id && channel) {
        contentById.set(id, { channel, status });
      }
    }

    const uniqueChannels = new Set<Channel>();
    for (const entry of entries) {
      const content = contentById.get(entry.content_id);
      if (content && (content.status === "published" || content.status === "historical")) {
        uniqueChannels.add(content.channel);
      }
    }

    const statsByChannel = new Map<Channel, OrgChannelStats>();
    await Promise.all(
      [...uniqueChannels].map(async (channel) => {
        statsByChannel.set(channel, await loadOrgChannelStats(orgId, channel));
      })
    );

    const idempotencyKeyByContent = new Map<string, string>();
    if (requestIdempotencyKey) {
      for (const entry of entries) {
        idempotencyKeyByContent.set(entry.content_id, `metrics:${requestIdempotencyKey}:${entry.content_id}`);
      }
    }

    const existingByIdempotencyKey = new Map<string, number | null>();
    if (idempotencyKeyByContent.size > 0) {
      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from("content_metrics")
        .select("idempotency_key,performance_score")
        .eq("org_id", orgId)
        .in("idempotency_key", [...idempotencyKeyByContent.values()]);
      if (existingError) {
        throw new HttpError(500, "db_error", `Failed to read idempotent metrics rows: ${existingError.message}`);
      }
      for (const row of Array.isArray(existingRows) ? existingRows : []) {
        const key = typeof row.idempotency_key === "string" ? row.idempotency_key : "";
        const score = typeof row.performance_score === "number" ? row.performance_score : null;
        if (key) {
          existingByIdempotencyKey.set(key, score);
        }
      }
    }

    let saved = 0;
    let failed = 0;
    const scoresByContent = new Map<string, number>();

    for (const entry of entries) {
      const content = contentById.get(entry.content_id);
      if (!content || (content.status !== "published" && content.status !== "historical")) {
        failed += 1;
        continue;
      }

      const stats = statsByChannel.get(content.channel);
      if (!stats) {
        failed += 1;
        continue;
      }

      const idempotencyKey = idempotencyKeyByContent.get(entry.content_id) ?? null;
      if (idempotencyKey && existingByIdempotencyKey.has(idempotencyKey)) {
        saved += 1;
        const score = existingByIdempotencyKey.get(idempotencyKey);
        if (typeof score === "number" && Number.isFinite(score)) {
          scoresByContent.set(entry.content_id, score);
        }
        continue;
      }

      const metrics = toCanonicalMetrics(content.channel, entry);
      const performanceScore = computePerformanceScore(metrics, content.channel, stats);
      const { error: insertError } = await supabaseAdmin.from("content_metrics").insert({
        org_id: orgId,
        content_id: entry.content_id,
        channel: content.channel,
        likes: metrics.likes ?? null,
        views: metrics.views ?? null,
        comments: metrics.comments ?? null,
        shares: metrics.shares ?? null,
        saves: metrics.saves ?? null,
        follower_delta: metrics.follower_delta ?? null,
        performance_score: performanceScore,
        collection_source: "api_batch",
        idempotency_key: idempotencyKey,
        collected_at: new Date().toISOString()
      });

      if (insertError) {
        if ((insertError as { code?: string }).code === "23505" && idempotencyKey) {
          saved += 1;
          continue;
        }
        failed += 1;
        continue;
      }

      saved += 1;
      if (typeof performanceScore === "number" && Number.isFinite(performanceScore)) {
        scoresByContent.set(entry.content_id, performanceScore);
      }
    }

    let insightsRefreshed = false;
    if (saved > 0) {
      if (scoresByContent.size <= SYNC_FOLLOWUP_ENTRY_LIMIT) {
        await runMetricsFollowUp(orgId, scoresByContent);
        insightsRefreshed = true;
      } else {
        queueMicrotask(() => {
          void runMetricsFollowUp(orgId, scoresByContent).catch((error) => {
            console.warn(
              `[METRICS] Async follow-up failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        });
      }
    }

    res.json({
      ok: true,
      saved,
      failed,
      insights_refreshed: insightsRefreshed
    });
  } catch (error) {
    sendMetricsError(res, error);
  }
});
