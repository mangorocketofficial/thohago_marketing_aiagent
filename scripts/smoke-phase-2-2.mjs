import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import path from "node:path";
import {
  assert,
  createReport,
  createUserWithToken,
  loadEnvFile,
  nowIso,
  readSupabaseStatusEnv,
  requestJson,
  sleep,
  startApiServer,
  stopProcessTree,
  tailLines,
  waitForHealth,
  withCheck,
  writeJsonReport
} from "./lib/smoke-harness.mjs";

const PASSWORD = "Phase22Smoke!12345";
const API_START_TIMEOUT_MS = 120_000;
const INGESTION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_500;
const REPORT_PATH = path.join("docs", "reports", "phase-2-2-test-result.json");

const normalizeForDedup = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"\\?<>[\]|+]/g, "")
    .trim();

const writeReport = (report) =>
  writeJsonReport({
    report,
    latestPath: REPORT_PATH,
    timestampPrefix: "phase-2-2-test-result"
  });

const main = async () => {
  const cwd = process.cwd();
  const report = createReport();
  const cleanupErrors = [];
  let apiServer = null;
  let admin = null;
  let cleanup = {
    orgIds: [],
    userIds: []
  };

  try {
    loadEnvFile(path.join(cwd, ".env"));
    loadEnvFile(path.join(cwd, ".env.local"));

    const status = await withCheck(report, "supabase_status_env", async () => {
      const statusEnv = await readSupabaseStatusEnv({ cwd });
      assert(statusEnv.API_URL, "Missing API_URL from `supabase status -o env`.");
      assert(statusEnv.ANON_KEY, "Missing ANON_KEY from `supabase status -o env`.");
      assert(statusEnv.SERVICE_ROLE_KEY, "Missing SERVICE_ROLE_KEY from `supabase status -o env`.");
      return {
        api_url: statusEnv.API_URL,
        anon_key: statusEnv.ANON_KEY,
        service_role_key: statusEnv.SERVICE_ROLE_KEY,
        anon_key_present: !!statusEnv.ANON_KEY,
        service_role_key_present: !!statusEnv.SERVICE_ROLE_KEY
      };
    });

    const supabaseUrl = status.api_url;
    const anonKey = status.anon_key;
    const serviceRoleKey = status.service_role_key;
    const apiSecret = (process.env.API_SECRET ?? "").trim();
    const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();

    await withCheck(report, "required_env", async () => {
      assert(apiSecret, "Missing API_SECRET in environment.");
      assert(openAiApiKey, "Missing OPENAI_API_KEY in environment.");
      assert(
        !/^OPENAI_API_KEY/i.test(openAiApiKey),
        "OPENAI_API_KEY looks like a placeholder value. Set a real key (for example, starts with sk-...)."
      );
      return {
        api_secret_present: true,
        openai_key_present: true,
        anthropic_key_present: !!(process.env.ANTHROPIC_API_KEY ?? "").trim()
      };
    });

    const apiPort = 39000 + Math.floor(Math.random() * 1000);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    const apiEnv = {
      ...process.env,
      API_PORT: String(apiPort),
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
    };

    await withCheck(report, "api_startup", async () => {
      apiServer = startApiServer({ cwd, env: apiEnv });
      await waitForHealth({ baseUrl: apiBaseUrl, timeoutMs: API_START_TIMEOUT_MS });
      return {
        api_base_url: apiBaseUrl
      };
    });

    report.environment = {
      api_base_url: apiBaseUrl,
      supabase_url: supabaseUrl
    };

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const runTag = Date.now();
    const orgId = crypto.randomUUID();
    const outsiderOrgId = crypto.randomUUID();
    cleanup.orgIds.push(orgId, outsiderOrgId);

    const ownerEmail = `phase22-owner-${runTag}@example.com`;
    const outsiderEmail = `phase22-outsider-${runTag}@example.com`;

    let ownerAccessToken = "";
    let outsiderAccessToken = "";

    const dataSetup = await withCheck(report, "seed_users_and_orgs", async () => {
      const { error: orgInsertError } = await admin.from("organizations").insert([
        {
          id: orgId,
          name: `Phase 2-2 Smoke Org ${runTag}`,
          org_type: "ngo"
        },
        {
          id: outsiderOrgId,
          name: `Phase 2-2 Smoke Outsider Org ${runTag}`,
          org_type: "ngo"
        }
      ]);
      assert(!orgInsertError, `Failed to insert organizations: ${orgInsertError?.message}`);

      const owner = await createUserWithToken({
        adminClient: admin,
        anonClient: anon,
        email: ownerEmail,
        password: PASSWORD
      });
      const outsider = await createUserWithToken({
        adminClient: admin,
        anonClient: anon,
        email: outsiderEmail,
        password: PASSWORD
      });
      cleanup.userIds.push(owner.userId, outsider.userId);
      ownerAccessToken = owner.accessToken;
      outsiderAccessToken = outsider.accessToken;

      const { error: usersError } = await admin.from("users").upsert(
        [
          { id: owner.userId, email: ownerEmail, name: "Phase 2-2 Owner" },
          { id: outsider.userId, email: outsiderEmail, name: "Phase 2-2 Outsider" }
        ],
        { onConflict: "id" }
      );
      assert(!usersError, `Failed to upsert public.users rows: ${usersError?.message}`);

      const { error: membershipsError } = await admin.from("organization_members").upsert(
        [
          {
            id: crypto.randomUUID(),
            org_id: orgId,
            user_id: owner.userId,
            role: "owner"
          },
          {
            id: crypto.randomUUID(),
            org_id: outsiderOrgId,
            user_id: outsider.userId,
            role: "owner"
          }
        ],
        { onConflict: "org_id,user_id" }
      );
      assert(!membershipsError, `Failed to insert memberships: ${membershipsError?.message}`);

      return {
        org_id: orgId,
        outsider_org_id: outsiderOrgId,
        owner_user_id: owner.userId,
        outsider_user_id: outsider.userId
      };
    });

    const synthPayload = {
      org_id: orgId,
      crawl_result: {
        state: "done",
        started_at: nowIso(),
        finished_at: nowIso(),
        sources: {
          website: {
            source: "website",
            status: "done",
            data: {
              headings: ["Impact stories", "Volunteer growth"],
              paragraphs: [
                "We provide education support for local communities.",
                "Monthly donor updates and volunteer stories are published."
              ]
            }
          },
          naver_blog: {
            source: "naver_blog",
            status: "done",
            data: {
              recent_posts: [{ title: "Monthly donor letter" }, { title: "Volunteer impact recap" }]
            }
          },
          instagram: {
            source: "instagram",
            status: "partial",
            data: {
              username: "phase22-smoke",
              recent_posts: [{ caption: "Volunteer day highlights" }]
            }
          }
        }
      },
      interview_answers: {
        q1: "Use a warm and factual tone. Avoid hype claims.",
        q2: `audience-main-${runTag}, audience-secondary-${runTag}`,
        q3: `forbidden-one-${runTag}, forbidden-two-${runTag}`,
        q4: `season-spring-${runTag}, season-winter-${runTag}`
      }
    };

    const synthResult = await withCheck(report, "onboarding_synthesize", async () => {
      const started = Date.now();
      const response = await requestJson(`${apiBaseUrl}/onboarding/synthesize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${ownerAccessToken}`
        },
        body: JSON.stringify(synthPayload)
      });
      assert(response.ok, `Synthesize failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.ok === true, "Synthesize response missing ok=true.");
      assert(typeof response.json?.review_markdown === "string", "Synthesize response missing review_markdown.");
      return {
        http_status: response.status,
        elapsed_ms: Date.now() - started,
        review_markdown_length: response.json.review_markdown.length,
        detected_tone: response.json?.brand_profile?.detected_tone ?? null
      };
    });
    report.metrics.synthesize_response_ms = synthResult.elapsed_ms;

    const statusTimeline = [];
    const ingestionDone = await withCheck(report, "rag_ingestion_done", async () => {
      const started = Date.now();
      let latest = null;

      while (Date.now() - started < INGESTION_TIMEOUT_MS) {
        const { data, error } = await admin
          .from("org_brand_settings")
          .select("rag_ingestion_status, rag_ingestion_error, rag_source_hash, rag_indexed_at")
          .eq("org_id", orgId)
          .maybeSingle();

        assert(!error, `Failed to read ingestion status: ${error?.message}`);
        assert(data, "org_brand_settings row was not found after synthesize.");

        latest = data;
        statusTimeline.push({
          at: nowIso(),
          status: data.rag_ingestion_status,
          error: data.rag_ingestion_error ?? null
        });

        if (data.rag_ingestion_status === "done") {
          assert(!!data.rag_source_hash, "rag_source_hash is empty after done status.");
          assert(!!data.rag_indexed_at, "rag_indexed_at is empty after done status.");
          return {
            wait_ms: Date.now() - started,
            final_status: data.rag_ingestion_status,
            rag_indexed_at: data.rag_indexed_at
          };
        }

        if (data.rag_ingestion_status === "failed") {
          throw new Error(`Ingestion failed: ${data.rag_ingestion_error ?? "unknown"}`);
        }

        await sleep(POLL_INTERVAL_MS);
      }

      throw new Error(
        `Timed out waiting for ingestion done. Last status=${latest?.rag_ingestion_status ?? "unknown"}, error=${
          latest?.rag_ingestion_error ?? "none"
        }`
      );
    });
    report.metrics.ingestion_wait_ms = ingestionDone.wait_ms;
    report.artifacts.ingestion_status_timeline = statusTimeline;

    const embeddingDetails = await withCheck(report, "brand_profile_embeddings", async () => {
      const { data, error } = await admin
        .from("org_rag_embeddings")
        .select("source_id, chunk_index, content, metadata")
        .eq("org_id", orgId)
        .eq("source_type", "brand_profile")
        .order("source_id", { ascending: true })
        .order("chunk_index", { ascending: true });
      assert(!error, `Failed to read brand_profile embeddings: ${error?.message}`);

      const rows = Array.isArray(data) ? data : [];
      const reviewRows = rows.filter((row) => row.source_id === "review");
      const interviewRows = rows.filter((row) => row.source_id === "interview");
      assert(reviewRows.length > 0, "No brand_profile/review embeddings found.");

      const reviewNormalized = reviewRows.map((row) => normalizeForDedup(row.content)).join("\n");
      const duplicateInterviewRows = interviewRows.filter((row) => {
        const normalized = normalizeForDedup(row.content);
        return normalized && reviewNormalized.includes(normalized);
      });
      assert(
        duplicateInterviewRows.length === 0,
        `Interview dedupe failed: ${duplicateInterviewRows.length} duplicate chunks still overlap with review markdown.`
      );

      return {
        total_brand_profile_chunks: rows.length,
        review_chunk_count: reviewRows.length,
        interview_chunk_count: interviewRows.length,
        duplicate_interview_chunk_count: duplicateInterviewRows.length
      };
    });
    report.metrics.embedding_counts = embeddingDetails;

    const memoryUrl = `${apiBaseUrl}/orgs/${orgId}/memory`;

    const memoryFirst = await withCheck(report, "memory_first_request", async () => {
      const response = await requestJson(memoryUrl, {
        headers: {
          Authorization: `Bearer ${ownerAccessToken}`
        }
      });
      assert(response.ok, `First memory request failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.ok === true, "First memory response missing ok=true.");
      assert(typeof response.json?.memory_md === "string" && response.json.memory_md.length > 0, "memory_md is empty.");
      assert(typeof response.json?.token_count === "number", "token_count is missing.");
      assert(response.json.token_count <= 2000, `token_count exceeds budget: ${response.json.token_count}`);
      assert(response.json.cache_hit === false, "First memory request expected cache_hit=false.");
      return {
        cache_hit: response.json.cache_hit,
        token_count: response.json.token_count,
        freshness_key: response.json.freshness_key
      };
    });

    const memorySecond = await withCheck(report, "memory_cache_hit", async () => {
      let latest = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(700);
        const response = await requestJson(memoryUrl, {
          headers: {
            Authorization: `Bearer ${ownerAccessToken}`
          }
        });
        assert(response.ok, `Follow-up memory request failed: HTTP ${response.status} ${response.text}`);
        assert(response.json?.ok === true, "Follow-up memory response missing ok=true.");
        latest = response.json;
        if (response.json.cache_hit === true) {
          break;
        }
      }
      assert(latest?.cache_hit === true, "Cache did not warm up within retry window.");
      assert(
        latest?.freshness_key === memoryFirst.freshness_key,
        "Freshness key changed unexpectedly without source updates."
      );
      return {
        cache_hit: latest.cache_hit,
        freshness_key: latest.freshness_key
      };
    });

    await withCheck(report, "memory_internal_token", async () => {
      const response = await requestJson(memoryUrl, {
        headers: {
          "x-api-token": apiSecret
        }
      });
      assert(response.ok, `Internal token memory request failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.ok === true, "Internal token memory response missing ok=true.");
      return {
        cache_hit: response.json.cache_hit
      };
    });

    await withCheck(report, "memory_forbidden_outsider", async () => {
      const response = await requestJson(memoryUrl, {
        headers: {
          Authorization: `Bearer ${outsiderAccessToken}`
        }
      });
      assert(response.status === 403, `Expected 403 for outsider. Received HTTP ${response.status} ${response.text}`);
      return {
        http_status: response.status,
        error: response.json?.error ?? null
      };
    });

    const memoryAfterUpdate = await withCheck(report, "memory_freshness_invalidation", async () => {
      const newTheme = `freshness-theme-${runTag}`;
      const { error: updateError } = await admin
        .from("org_brand_settings")
        .update({
          key_themes: ["Impact stories", "Volunteer growth", newTheme]
        })
        .eq("org_id", orgId);
      assert(!updateError, `Failed to update org_brand_settings: ${updateError?.message}`);

      const firstAfterUpdate = await requestJson(memoryUrl, {
        headers: {
          Authorization: `Bearer ${ownerAccessToken}`
        }
      });
      assert(
        firstAfterUpdate.ok,
        `Memory request after source update failed: HTTP ${firstAfterUpdate.status} ${firstAfterUpdate.text}`
      );
      assert(firstAfterUpdate.json?.cache_hit === false, "Expected cache miss after source update.");
      assert(
        firstAfterUpdate.json?.freshness_key !== memorySecond.freshness_key,
        "Freshness key did not change after source update."
      );

      await sleep(700);
      const secondAfterUpdate = await requestJson(memoryUrl, {
        headers: {
          Authorization: `Bearer ${ownerAccessToken}`
        }
      });
      assert(secondAfterUpdate.ok, `Second memory request after update failed: HTTP ${secondAfterUpdate.status}`);
      assert(secondAfterUpdate.json?.cache_hit === true, "Expected cache hit on second request after refresh.");

      return {
        first_cache_hit: firstAfterUpdate.json?.cache_hit,
        second_cache_hit: secondAfterUpdate.json?.cache_hit,
        new_freshness_key: firstAfterUpdate.json?.freshness_key
      };
    });
    report.metrics.memory_after_update = memoryAfterUpdate;

    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    const safeCleanup = async (label, fn) => {
      try {
        await fn();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    if (admin) {
      await safeCleanup("delete_org_rag_embeddings", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("org_rag_embeddings").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_org_brand_settings", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("org_brand_settings").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_campaigns", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("campaigns").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_memberships", async () => {
        if (cleanup.userIds.length) {
          await admin.from("organization_members").delete().in("user_id", cleanup.userIds);
        }
        if (cleanup.orgIds.length) {
          await admin.from("organization_members").delete().in("org_id", cleanup.orgIds);
        }
      });
      await safeCleanup("delete_public_users", async () => {
        if (!cleanup.userIds.length) {
          return;
        }
        await admin.from("users").delete().in("id", cleanup.userIds);
      });
      await safeCleanup("delete_organizations", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("organizations").delete().in("id", cleanup.orgIds);
      });
      await safeCleanup("delete_auth_users", async () => {
        for (const userId of cleanup.userIds) {
          await admin.auth.admin.deleteUser(userId);
        }
      });
    }

    await stopProcessTree(apiServer?.child);
    if (apiServer) {
      report.artifacts.api_log_tail = tailLines(apiServer.getLogs());
    }
    report.artifacts.cleanup_errors = cleanupErrors;
    report.finished_at = nowIso();

    const written = writeReport(report);
    report.artifacts.report_paths = written;

    console.log(`Phase 2-2 smoke report written: ${written.latest}`);
    console.log(`Phase 2-2 smoke report (timestamped): ${written.timestamped}`);
    console.log(`Phase 2-2 smoke success: ${report.success}`);
  }

  if (!report.success) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Phase 2-2 smoke runner crashed:", error);
  process.exit(1);
});
