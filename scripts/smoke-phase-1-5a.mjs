import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import process from "node:process";

const SEED_ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const API_PORT = Number.parseInt(process.env.SMOKE_API_PORT ?? "3011", 10);
const API_SECRET = process.env.SMOKE_API_SECRET ?? "phase-1-5a-smoke-secret";
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const HTTP_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 30_000;

const pnpmCommand = "pnpm";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const quoteCmdArg = (value) => {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
};

const spawnProcess = (command, args, options = {}) => {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args].map((item) => quoteCmdArg(item)).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", cmdLine], options);
  }
  return spawn(command, args, options);
};

const runCommandCapture = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });

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
      reject(new Error(`Command failed (${command} ${args.join(" ")}):\n${stderr || stdout}`));
    });
  });

const parseSupabaseStatusEnv = (rawOutput) => {
  const map = {};
  for (const line of rawOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    const valueRaw = rest.join("=").trim();
    const value =
      valueRaw.startsWith("\"") && valueRaw.endsWith("\"")
        ? valueRaw.slice(1, -1)
        : valueRaw;
    map[key] = value;
  }

  return map;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fetchJson = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    return { response, body };
  } finally {
    clearTimeout(timer);
  }
};

const waitForHealth = async () => {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const { response, body } = await fetchJson(`${API_BASE}/health`, { method: "GET" });
      if (response.ok && body?.ok) {
        return;
      }
      lastError = new Error(`Health not ready: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw new Error(`API health check timeout: ${lastError?.message ?? "unknown error"}`);
};

const stopProcessTree = async (child) => {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await runCommandCapture("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    } catch {
      // fallback below
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
};

const main = async () => {
  const cwd = process.cwd();
  const { stdout: statusOutput } = await runCommandCapture(
    pnpmCommand,
    ["exec", "supabase", "status", "-o", "env"],
    { cwd }
  );
  const envMap = parseSupabaseStatusEnv(statusOutput);

  const supabaseUrl = envMap.API_URL;
  const serviceRoleKey = envMap.SERVICE_ROLE_KEY;
  assert(supabaseUrl, "Failed to read API_URL from supabase status output.");
  assert(serviceRoleKey, "Failed to read SERVICE_ROLE_KEY from supabase status output.");

  const orgId = (process.env.SEED_ORG_ID ?? SEED_ORG_ID).trim() || SEED_ORG_ID;
  const now = Date.now();
  const activityFolder = `smoke-${now}`;
  const fileName = "photo01.jpg";
  const relativePath = `${activityFolder}/${fileName}`;
  const sourceEventId = `smoke-${now}-event`;
  const userMessage = "네, 인스타그램 중심으로 진행해줘.";

  const apiLogs = [];
  const apiServer = spawnProcess(
    pnpmCommand,
    ["-C", "apps/api", "dev"],
    {
      cwd,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        API_PORT: String(API_PORT),
        API_SECRET,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  apiServer.stdout.on("data", (chunk) => {
    const line = chunk.toString();
    apiLogs.push(`[stdout] ${line}`);
    if (apiLogs.length > 200) {
      apiLogs.shift();
    }
  });

  apiServer.stderr.on("data", (chunk) => {
    const line = chunk.toString();
    apiLogs.push(`[stderr] ${line}`);
    if (apiLogs.length > 200) {
      apiLogs.shift();
    }
  });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let sessionId = "";
  let triggerId = "";
  let campaignId = "";
  let contentId = "";

  try {
    await waitForHealth();
    console.log(`PASS - API server is healthy at ${API_BASE}`);

    const triggerReq = await fetchJson(`${API_BASE}/trigger`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trigger-token": API_SECRET
      },
      body: JSON.stringify({
        org_id: orgId,
        relative_path: relativePath,
        file_name: fileName,
        activity_folder: activityFolder,
        file_type: "image",
        source_event_id: sourceEventId
      })
    });

    assert(triggerReq.response.ok, `POST /trigger failed: ${JSON.stringify(triggerReq.body)}`);
    assert(triggerReq.body?.ok === true, `POST /trigger did not return ok=true: ${JSON.stringify(triggerReq.body)}`);
    sessionId = triggerReq.body.session_id;
    triggerId = triggerReq.body.trigger_id;
    assert(sessionId, "POST /trigger did not return session_id.");
    assert(triggerId, "POST /trigger did not return trigger_id.");
    console.log("PASS - /trigger returned session_id and trigger_id");

    const { data: triggerAfterInsert, error: triggerAfterInsertError } = await supabaseAdmin
      .from("pipeline_triggers")
      .select("*")
      .eq("id", triggerId)
      .single();
    assert(!triggerAfterInsertError, `Failed to read trigger row: ${triggerAfterInsertError?.message}`);
    assert(
      triggerAfterInsert.relative_path === relativePath,
      `Trigger relative_path mismatch: ${triggerAfterInsert.relative_path}`
    );
    assert(!!triggerAfterInsert.processed_at, "Trigger processed_at is null after trigger consumption.");
    console.log("PASS - pipeline_triggers row inserted and processed_at set");

    const initialSessionReq = await fetchJson(`${API_BASE}/sessions/${sessionId}`, {
      method: "GET",
      headers: { "x-api-token": API_SECRET }
    });
    assert(initialSessionReq.response.ok, `GET session failed: ${JSON.stringify(initialSessionReq.body)}`);
    assert(
      initialSessionReq.body?.session?.current_step === "await_user_input",
      `Unexpected step after detect: ${initialSessionReq.body?.session?.current_step}`
    );
    console.log("PASS - session is paused at await_user_input");

    const resumeUserReq = await fetchJson(`${API_BASE}/sessions/${sessionId}/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": API_SECRET
      },
      body: JSON.stringify({
        event_type: "user_message",
        idempotency_key: `smoke-${now}-user`,
        payload: { content: userMessage }
      })
    });
    assert(resumeUserReq.response.ok, `user_message resume failed: ${JSON.stringify(resumeUserReq.body)}`);
    assert(
      resumeUserReq.body?.current_step === "await_campaign_approval",
      `Unexpected step after user_message: ${resumeUserReq.body?.current_step}`
    );
    console.log("PASS - user_message resume created campaign plan step");

    const sessionAfterUserReq = await fetchJson(`${API_BASE}/sessions/${sessionId}`, {
      method: "GET",
      headers: { "x-api-token": API_SECRET }
    });
    campaignId = sessionAfterUserReq.body?.session?.state?.campaign_id;
    assert(campaignId, "campaign_id missing in session state after user_message.");

    const { data: campaignRow, error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    assert(!campaignError, `Failed to read campaign row: ${campaignError?.message}`);
    assert(campaignRow.status === "draft", `Expected campaign status=draft, got ${campaignRow.status}`);
    console.log("PASS - campaign draft created");

    const resumeCampaignReq = await fetchJson(`${API_BASE}/sessions/${sessionId}/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": API_SECRET
      },
      body: JSON.stringify({
        event_type: "campaign_approved",
        idempotency_key: `smoke-${now}-campaign-approved`,
        payload: { campaign_id: campaignId }
      })
    });
    assert(
      resumeCampaignReq.response.ok,
      `campaign_approved resume failed: ${JSON.stringify(resumeCampaignReq.body)}`
    );
    assert(
      resumeCampaignReq.body?.current_step === "await_content_approval",
      `Unexpected step after campaign_approved: ${resumeCampaignReq.body?.current_step}`
    );
    console.log("PASS - campaign_approved resume created content draft step");

    const sessionAfterCampaignReq = await fetchJson(`${API_BASE}/sessions/${sessionId}`, {
      method: "GET",
      headers: { "x-api-token": API_SECRET }
    });
    contentId = sessionAfterCampaignReq.body?.session?.state?.content_id;
    assert(contentId, "content_id missing in session state after campaign_approved.");

    const { data: contentBeforePublish, error: contentBeforePublishError } = await supabaseAdmin
      .from("contents")
      .select("*")
      .eq("id", contentId)
      .single();
    assert(!contentBeforePublishError, `Failed to read content row: ${contentBeforePublishError?.message}`);
    assert(
      contentBeforePublish.status === "pending_approval",
      `Expected content status=pending_approval, got ${contentBeforePublish.status}`
    );
    console.log("PASS - content draft inserted with pending_approval");

    const resumeContentReq = await fetchJson(`${API_BASE}/sessions/${sessionId}/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": API_SECRET
      },
      body: JSON.stringify({
        event_type: "content_approved",
        idempotency_key: `smoke-${now}-content-approved`,
        payload: { content_id: contentId }
      })
    });
    assert(
      resumeContentReq.response.ok,
      `content_approved resume failed: ${JSON.stringify(resumeContentReq.body)}`
    );
    assert(resumeContentReq.body?.status === "done", `Expected session status done, got ${resumeContentReq.body?.status}`);
    console.log("PASS - content_approved resume completed session");

    const { data: finalContent, error: finalContentError } = await supabaseAdmin
      .from("contents")
      .select("*")
      .eq("id", contentId)
      .single();
    assert(!finalContentError, `Failed to read final content row: ${finalContentError?.message}`);
    assert(finalContent.status === "published", `Expected content status=published, got ${finalContent.status}`);
    assert(!!finalContent.published_at, "published_at was not set.");

    const { data: finalTrigger, error: finalTriggerError } = await supabaseAdmin
      .from("pipeline_triggers")
      .select("*")
      .eq("id", triggerId)
      .single();
    assert(!finalTriggerError, `Failed to read final trigger row: ${finalTriggerError?.message}`);
    assert(finalTrigger.status === "done", `Expected trigger status=done, got ${finalTrigger.status}`);

    const { data: finalSession, error: finalSessionError } = await supabaseAdmin
      .from("orchestrator_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    assert(!finalSessionError, `Failed to read final session row: ${finalSessionError?.message}`);
    assert(finalSession.status === "done", `Expected session status=done, got ${finalSession.status}`);
    assert(finalSession.current_step === "done", `Expected session step=done, got ${finalSession.current_step}`);
    console.log("PASS - final DB statuses are done/published");

    const { data: chatMessages, error: chatError } = await supabaseAdmin
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(30);
    assert(!chatError, `Failed to read chat messages: ${chatError?.message}`);
    const relatedMessages =
      chatMessages?.filter((row) => typeof row.content === "string" && row.content.includes(activityFolder)) ?? [];
    assert(
      relatedMessages.length >= 2,
      `Expected at least 2 chat messages related to ${activityFolder}, got ${relatedMessages.length}`
    );
    console.log(`PASS - chat_messages inserted (${relatedMessages.length} related rows found)`);

    console.log("\nSMOKE TEST RESULT: PASS");
    console.log(JSON.stringify({ trigger_id: triggerId, session_id: sessionId, campaign_id: campaignId, content_id: contentId }, null, 2));
  } catch (error) {
    console.error("\nSMOKE TEST RESULT: FAIL");
    console.error(error);
    if (apiLogs.length > 0) {
      console.error("\n--- API Logs (tail) ---");
      for (const line of apiLogs.slice(-30)) {
        process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
      }
    }
    process.exitCode = 1;
  } finally {
    await stopProcessTree(apiServer);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
