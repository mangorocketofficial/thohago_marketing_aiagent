import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PASSWORD = "Phase25aSmoke!12345";
const API_START_TIMEOUT_MS = 120_000;
const BACKGROUND_WAIT_TIMEOUT_MS = 30_000;
const REPORT_PATH = path.join("docs", "reports", "phase-2-5a-test-result.json");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }
    process.env[key] = value;
  }
};

const runCommandCapture = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], options)
        : spawn(command, args, options);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}): ${stderr || stdout}`));
    });
  });

const parseEnvMap = (raw) => {
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const rawValue = rest.join("=").trim();
    const value =
      rawValue.startsWith("\"") && rawValue.endsWith("\"") ? rawValue.slice(1, rawValue.length - 1) : rawValue;
    map[key] = value;
  }
  return map;
};

const sleep = async (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const nowIso = () => new Date().toISOString();

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    text,
    json
  };
};

const startApiServer = ({ cwd, env }) => {
  const args = ["--filter", "@repo/api", "dev"];
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"]
        })
      : spawn("pnpm", args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"]
        });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  return {
    child,
    getLogs: () => logs
  };
};

const stopApiServer = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await runCommandCapture("taskkill", ["/pid", String(child.pid), "/t", "/f"]).catch(() => {});
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(undefined);
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
  });
};

const waitForHealth = async (baseUrl) => {
  const deadline = Date.now() + API_START_TIMEOUT_MS;
  let lastError = "health check not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`API health check timed out (${lastError})`);
};

const tailLines = (value, maxLines = 50) => {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
};

const createReport = () => ({
  run_id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  started_at: nowIso(),
  finished_at: null,
  success: false,
  checks: [],
  metrics: {},
  environment: {},
  artifacts: {},
  error: null
});

const addCheck = (report, name, pass, details = {}) => {
  report.checks.push({
    name,
    pass,
    checked_at: nowIso(),
    ...details
  });
};

const withCheck = async (report, name, fn) => {
  const started = Date.now();
  try {
    const details = (await fn()) ?? {};
    addCheck(report, name, true, { duration_ms: Date.now() - started, details });
    return details;
  } catch (error) {
    addCheck(report, name, false, {
      duration_ms: Date.now() - started,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
};

const writeReport = (report) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const timestampedPath = path.join("docs", "reports", `phase-2-5a-test-result-${timestamp}.json`);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const serialized = JSON.stringify(report, null, 2);
  fs.writeFileSync(REPORT_PATH, serialized, "utf8");
  fs.writeFileSync(timestampedPath, serialized, "utf8");
  return {
    latest: REPORT_PATH,
    timestamped: timestampedPath
  };
};

const createUserWithToken = async ({ adminClient, anonClient, email, password }) => {
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create auth user (${email}): ${createError?.message ?? "unknown"}`);
  }

  const { data: signedIn, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password
  });
  if (signInError || !signedIn.session?.access_token) {
    throw new Error(`Failed to sign in user (${email}): ${signInError?.message ?? "unknown"}`);
  }

  return {
    userId: created.user.id,
    accessToken: signedIn.session.access_token
  };
};

const waitForBackground = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await sleep(800);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const main = async () => {
  const cwd = process.cwd();
  const report = createReport();
  const cleanupErrors = [];
  let apiServer = null;
  let admin = null;
  const cleanup = {
    orgIds: [],
    userIds: []
  };

  try {
    loadEnvFile(path.join(cwd, ".env"));
    loadEnvFile(path.join(cwd, ".env.local"));

    const status = await withCheck(report, "supabase_status_env", async () => {
      const { stdout } = await runCommandCapture("pnpm", ["exec", "supabase", "status", "-o", "env"], { cwd });
      const statusEnv = parseEnvMap(stdout);
      assert(statusEnv.API_URL, "Missing API_URL from `supabase status -o env`.");
      assert(statusEnv.ANON_KEY, "Missing ANON_KEY from `supabase status -o env`.");
      assert(statusEnv.SERVICE_ROLE_KEY, "Missing SERVICE_ROLE_KEY from `supabase status -o env`.");
      return {
        api_url: statusEnv.API_URL,
        anon_key_present: !!statusEnv.ANON_KEY,
        service_role_key_present: !!statusEnv.SERVICE_ROLE_KEY
      };
    });

    const supabaseUrl = status.api_url;
    const { stdout } = await runCommandCapture("pnpm", ["exec", "supabase", "status", "-o", "env"], { cwd });
    const statusEnv = parseEnvMap(stdout);
    const anonKey = statusEnv.ANON_KEY;
    const serviceRoleKey = statusEnv.SERVICE_ROLE_KEY;
    const apiSecret = (process.env.API_SECRET ?? "").trim();
    const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();

    await withCheck(report, "required_env", async () => {
      assert(apiSecret, "Missing API_SECRET in environment.");
      assert(openAiApiKey, "Missing OPENAI_API_KEY in environment.");
      return {
        api_secret_present: true,
        openai_key_present: true
      };
    });

    const apiPort = 41000 + Math.floor(Math.random() * 1000);
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
      await waitForHealth(apiBaseUrl);
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
    const orgActiveId = crypto.randomUUID();
    const orgBlockedId = crypto.randomUUID();
    cleanup.orgIds.push(orgActiveId, orgBlockedId);

    const ownerEmail = `phase25a-owner-${runTag}@example.com`;
    const owner = await withCheck(report, "seed_owner_user", async () => {
      const result = await createUserWithToken({
        adminClient: admin,
        anonClient: anon,
        email: ownerEmail,
        password: PASSWORD
      });
      cleanup.userIds.push(result.userId);

      const { error: userRowError } = await admin.from("users").upsert(
        [{ id: result.userId, email: ownerEmail, name: "Phase 2-5a Smoke Owner" }],
        { onConflict: "id" }
      );
      assert(!userRowError, `Failed to upsert users row: ${userRowError?.message}`);
      return {
        userId: result.userId,
        access_token_present: !!result.accessToken
      };
    });

    await withCheck(report, "seed_orgs_and_subscription", async () => {
      const { error: orgInsertError } = await admin.from("organizations").insert([
        { id: orgActiveId, name: `Phase 2-5a Active Org ${runTag}`, org_type: "ngo" },
        { id: orgBlockedId, name: `Phase 2-5a Blocked Org ${runTag}`, org_type: "ngo" }
      ]);
      assert(!orgInsertError, `Failed to insert organizations: ${orgInsertError?.message}`);

      const { error: memberError } = await admin.from("organization_members").upsert(
        [
          {
            id: crypto.randomUUID(),
            org_id: orgActiveId,
            user_id: owner.userId,
            role: "owner"
          },
          {
            id: crypto.randomUUID(),
            org_id: orgBlockedId,
            user_id: owner.userId,
            role: "owner"
          }
        ],
        { onConflict: "org_id,user_id" }
      );
      assert(!memberError, `Failed to insert memberships: ${memberError?.message}`);

      const { error: subscriptionError } = await admin.from("org_subscriptions").upsert(
        [
          {
            org_id: orgActiveId,
            provider: "manual",
            status: "active",
            trial_ends_at: null
          },
          {
            org_id: orgBlockedId,
            provider: "manual",
            status: "past_due",
            trial_ends_at: null
          }
        ],
        { onConflict: "org_id" }
      );
      assert(!subscriptionError, `Failed to seed subscriptions: ${subscriptionError?.message}`);

      const { error: brandSettingsError } = await admin.from("org_brand_settings").upsert(
        [
          {
            org_id: orgActiveId,
            memory_md: "# cached",
            memory_md_generated_at: new Date().toISOString(),
            memory_freshness_key: "seed-freshness-key",
            accumulated_insights: {}
          }
        ],
        { onConflict: "org_id" }
      );
      assert(!brandSettingsError, `Failed to seed org_brand_settings: ${brandSettingsError?.message}`);

      return {
        org_active_id: orgActiveId,
        org_blocked_id: orgBlockedId
      };
    });

    await withCheck(report, "auth_guard_embed_pending_content", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/embed-pending-content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgActiveId })
      });
      assert(response.status === 401, `Expected 401, got ${response.status}: ${response.text}`);
      return { http_status: response.status };
    });

    await withCheck(report, "subscription_guard_embed_pending_content", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/embed-pending-content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({ org_id: orgBlockedId })
      });
      assert(response.status === 402, `Expected 402, got ${response.status}: ${response.text}`);
      return { http_status: response.status, error: response.json?.error ?? null };
    });

    const contentIds = {
      published: crypto.randomUUID(),
      historical: crypto.randomUUID(),
      shortHistorical: crypto.randomUUID()
    };

    await withCheck(report, "seed_pending_content_rows", async () => {
      const { error } = await admin.from("contents").insert([
        {
          id: contentIds.published,
          org_id: orgActiveId,
          channel: "instagram",
          content_type: "text",
          status: "published",
          body: "지역 아동 교육 프로그램 현장 소식과 참여 안내를 담은 게시글입니다.",
          metadata: { source: "smoke" },
          created_by: "ai"
        },
        {
          id: contentIds.historical,
          org_id: orgActiveId,
          channel: "naver_blog",
          content_type: "text",
          status: "historical",
          body: "작년 봉사활동 후기와 참여자 인터뷰 요약입니다. 지역 학교 협력 사례를 포함합니다.",
          metadata: { source: "smoke", original_url: "https://example.com/historical-post" },
          created_by: "onboarding_crawl"
        },
        {
          id: contentIds.shortHistorical,
          org_id: orgActiveId,
          channel: "instagram",
          content_type: "text",
          status: "historical",
          body: "짧은글",
          metadata: { source: "smoke" },
          created_by: "onboarding_crawl"
        }
      ]);
      assert(!error, `Failed to seed contents: ${error?.message}`);
      return { seeded: 3 };
    });

    const firstBackfill = await withCheck(report, "embed_pending_content_batch", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/embed-pending-content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          batch_limit: 100
        })
      });
      assert(response.ok, `Backfill endpoint failed: HTTP ${response.status} ${response.text}`);
      assert((response.json?.embedded_count ?? 0) >= 3, `Expected embedded_count>=3, got ${response.json?.embedded_count}`);
      assert((response.json?.remaining ?? 0) === 0, `Expected remaining=0, got ${response.json?.remaining}`);
      return response.json;
    });

    await withCheck(report, "embedded_at_and_metadata_validation", async () => {
      const { data: contentRows, error: contentError } = await admin
        .from("contents")
        .select("id, embedded_at")
        .in("id", [contentIds.published, contentIds.historical, contentIds.shortHistorical]);
      assert(!contentError, `Failed to read contents: ${contentError?.message}`);
      const rows = Array.isArray(contentRows) ? contentRows : [];
      assert(rows.length === 3, `Expected 3 content rows, got ${rows.length}`);
      assert(rows.every((row) => !!row.embedded_at), "Expected embedded_at to be set for all seeded rows.");

      const { data: embeddingRows, error: embeddingError } = await admin
        .from("org_rag_embeddings")
        .select("source_id, metadata")
        .eq("org_id", orgActiveId)
        .eq("source_type", "content")
        .in("source_id", [contentIds.published, contentIds.historical, contentIds.shortHistorical]);
      assert(!embeddingError, `Failed to read content embeddings: ${embeddingError?.message}`);
      const embedded = Array.isArray(embeddingRows) ? embeddingRows : [];
      const sourceIds = new Set(embedded.map((row) => row.source_id));
      assert(sourceIds.has(contentIds.published), "Missing published content embedding.");
      assert(sourceIds.has(contentIds.historical), "Missing historical content embedding.");
      assert(!sourceIds.has(contentIds.shortHistorical), "Short content should not create RAG embedding row.");

      const publishedRow = embedded.find((row) => row.source_id === contentIds.published);
      assert(
        publishedRow?.metadata?.channel === "instagram",
        `Expected metadata.channel=instagram, got ${JSON.stringify(publishedRow?.metadata ?? null)}`
      );
      return {
        content_rows: rows.length,
        embedding_rows: embedded.length
      };
    });

    await withCheck(report, "embed_pending_content_idempotent", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/embed-pending-content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          batch_limit: 100
        })
      });
      assert(response.ok, `Second backfill request failed: HTTP ${response.status} ${response.text}`);
      assert((response.json?.embedded_count ?? -1) === 0, `Expected embedded_count=0, got ${response.json?.embedded_count}`);
      assert((response.json?.attempted_count ?? -1) === 0, `Expected attempted_count=0, got ${response.json?.attempted_count}`);
      return response.json;
    });

    await withCheck(report, "content_approved_with_edited_body_flow", async () => {
      const triggerId = crypto.randomUUID();
      const campaignId = crypto.randomUUID();
      const contentId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const originalDraft = "탄자니아에서 아이들과 함께한 봉사 활동을 소개합니다!";
      const editedBody = "탄자니아 현지 학교에서 아이들과 보낸 특별한 하루를 전합니다.";

      const { error: triggerError } = await admin.from("pipeline_triggers").insert({
        id: triggerId,
        org_id: orgActiveId,
        relative_path: `phase25a/${runTag}/draft.txt`,
        file_name: "draft.txt",
        activity_folder: `phase25a-${runTag}`,
        file_type: "document",
        status: "processing",
        processed_at: new Date().toISOString()
      });
      assert(!triggerError, `Failed to insert trigger: ${triggerError?.message}`);

      const { error: campaignError } = await admin.from("campaigns").insert({
        id: campaignId,
        org_id: orgActiveId,
        title: `Phase 2-5a campaign ${runTag}`,
        activity_folder: `phase25a-${runTag}`,
        status: "approved",
        channels: ["instagram"],
        plan: {
          objective: "smoke",
          channels: ["instagram"],
          duration_days: 7,
          post_count: 1,
          content_types: ["text"],
          suggested_schedule: [{ day: 1, channel: "instagram", type: "text" }]
        }
      });
      assert(!campaignError, `Failed to insert campaign: ${campaignError?.message}`);

      const { error: contentError } = await admin.from("contents").insert({
        id: contentId,
        org_id: orgActiveId,
        campaign_id: campaignId,
        channel: "instagram",
        content_type: "text",
        status: "pending_approval",
        body: originalDraft,
        metadata: { source: "smoke-phase-2-5a" },
        created_by: "ai"
      });
      assert(!contentError, `Failed to insert pending content: ${contentError?.message}`);

      const { error: sessionError } = await admin.from("orchestrator_sessions").insert({
        id: sessionId,
        org_id: orgActiveId,
        trigger_id: triggerId,
        current_step: "await_content_approval",
        status: "paused",
        state: {
          trigger_id: triggerId,
          activity_folder: `phase25a-${runTag}`,
          file_name: "draft.txt",
          file_type: "document",
          user_message: "테스트",
          campaign_id: campaignId,
          campaign_plan: {
            objective: "smoke",
            channels: ["instagram"],
            duration_days: 7,
            post_count: 1,
            content_types: ["text"],
            suggested_schedule: [{ day: 1, channel: "instagram", type: "text" }]
          },
          content_id: contentId,
          content_draft: originalDraft,
          rag_context: null,
          forbidden_check: null,
          processed_event_ids: [],
          last_error: null
        }
      });
      assert(!sessionError, `Failed to insert orchestrator session: ${sessionError?.message}`);

      const resumeResponse = await requestJson(`${apiBaseUrl}/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          event_type: "content_approved",
          payload: {
            content_id: contentId,
            edited_body: editedBody
          },
          idempotency_key: `phase25a-${runTag}-resume`
        })
      });
      assert(resumeResponse.ok, `content_approved resume failed: ${resumeResponse.status} ${resumeResponse.text}`);
      assert(resumeResponse.json?.status === "done", `Expected done status, got ${resumeResponse.json?.status}`);

      await waitForBackground(async () => {
        const { data, error } = await admin
          .from("contents")
          .select("status, body, embedded_at")
          .eq("id", contentId)
          .maybeSingle();
        if (error || !data) {
          return false;
        }
        return data.status === "published" && data.body === editedBody && !!data.embedded_at;
      }, BACKGROUND_WAIT_TIMEOUT_MS, "published content embedding");

      await waitForBackground(async () => {
        const { data, error } = await admin
          .from("org_rag_embeddings")
          .select("id")
          .eq("org_id", orgActiveId)
          .eq("source_type", "chat_pattern")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) {
          return false;
        }
        return Array.isArray(data) && data.length > 0;
      }, BACKGROUND_WAIT_TIMEOUT_MS, "chat_pattern insertion");

      const { data: chatPatternRows, error: chatPatternError } = await admin
        .from("org_rag_embeddings")
        .select("content, metadata")
        .eq("org_id", orgActiveId)
        .eq("source_type", "chat_pattern")
        .order("created_at", { ascending: false })
        .limit(3);
      assert(!chatPatternError, `Failed to read chat_pattern rows: ${chatPatternError?.message}`);
      const latestChatPattern = Array.isArray(chatPatternRows) ? chatPatternRows[0] : null;
      assert(!!latestChatPattern, "Expected at least one chat_pattern row.");
      assert(
        latestChatPattern?.metadata?.channel === "instagram",
        `Expected chat_pattern metadata.channel=instagram, got ${JSON.stringify(latestChatPattern?.metadata ?? null)}`
      );

      const { data: brandSettings, error: brandSettingsError } = await admin
        .from("org_brand_settings")
        .select("memory_freshness_key")
        .eq("org_id", orgActiveId)
        .maybeSingle();
      assert(!brandSettingsError, `Failed to read memory_freshness_key: ${brandSettingsError?.message}`);
      assert(
        brandSettings?.memory_freshness_key === null,
        `Expected memory_freshness_key=null after invalidation, got ${brandSettings?.memory_freshness_key}`
      );

      return {
        content_id: contentId,
        chat_pattern_found: !!latestChatPattern,
        memory_freshness_key: brandSettings?.memory_freshness_key ?? null
      };
    });

    report.metrics.initial_backfill = firstBackfill;
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
      await safeCleanup("delete_sessions", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("orchestrator_sessions").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_triggers", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("pipeline_triggers").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_campaigns", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("campaigns").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_contents", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("contents").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_org_brand_settings", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("org_brand_settings").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_memberships", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("organization_members").delete().in("org_id", cleanup.orgIds);
      });
      await safeCleanup("delete_org_subscriptions", async () => {
        if (!cleanup.orgIds.length) {
          return;
        }
        await admin.from("org_subscriptions").delete().in("org_id", cleanup.orgIds);
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

    await stopApiServer(apiServer?.child);
    if (apiServer) {
      report.artifacts.api_log_tail = tailLines(apiServer.getLogs());
    }
    report.artifacts.cleanup_errors = cleanupErrors;
    report.finished_at = nowIso();

    const written = writeReport(report);
    report.artifacts.report_paths = written;

    console.log(`Phase 2-5a smoke report written: ${written.latest}`);
    console.log(`Phase 2-5a smoke report (timestamped): ${written.timestamped}`);
    console.log(`Phase 2-5a smoke success: ${report.success}`);
  }

  if (!report.success) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Phase 2-5a smoke runner crashed:", error);
  process.exit(1);
});
