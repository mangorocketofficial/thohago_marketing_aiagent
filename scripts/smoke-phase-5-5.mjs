import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import process from "node:process";
import {
  assert,
  loadEnvFile,
  readSupabaseStatusEnv,
  requestJson,
  sleep,
  startApiServer,
  stopProcessTree,
  waitForHealth
} from "./lib/smoke-harness.mjs";

const API_START_TIMEOUT_MS = 120_000;
const HTTP_TIMEOUT_MS = 20_000;

const fetchSession = async (apiBaseUrl, apiSecret, sessionId) => {
  const sessionReq = await requestJson(
    `${apiBaseUrl}/sessions/${sessionId}`,
    {
      method: "GET",
      headers: { "x-api-token": apiSecret }
    },
    { timeoutMs: HTTP_TIMEOUT_MS }
  );
  assert(sessionReq.ok, `Failed to fetch session: HTTP ${sessionReq.status} ${sessionReq.text}`);
  return sessionReq.json?.session ?? null;
};

const resumeWithMessage = async (params) => {
  const response = await requestJson(
    `${params.apiBaseUrl}/sessions/${params.sessionId}/resume`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": params.apiSecret
      },
      body: JSON.stringify({
        event_type: "user_message",
        idempotency_key: params.idempotencyKey,
        payload: {
          content: params.content
        }
      })
    },
    { timeoutMs: HTTP_TIMEOUT_MS }
  );
  assert(response.ok, `resume(user_message) failed: HTTP ${response.status} ${response.text}`);
  return response.json;
};

const main = async () => {
  const cwd = process.cwd();
  let apiServer = null;
  let admin = null;

  const orgId = crypto.randomUUID();
  let sessionId = "";
  let campaignId = "";

  try {
    loadEnvFile(`${cwd}/.env`);
    loadEnvFile(`${cwd}/.env.local`);

    let supabaseUrl = "";
    let anonKey = "";
    let serviceRoleKey = "";

    try {
      const status = await readSupabaseStatusEnv({ cwd });
      supabaseUrl = status.API_URL ?? "";
      anonKey = status.ANON_KEY ?? "";
      serviceRoleKey = status.SERVICE_ROLE_KEY ?? "";
    } catch {
      supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
      anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
      serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    }
    const apiSecret = (process.env.API_SECRET ?? "").trim();

    assert(supabaseUrl, "Missing API_URL from supabase status.");
    assert(anonKey, "Missing ANON_KEY from supabase status.");
    assert(serviceRoleKey, "Missing SERVICE_ROLE_KEY from supabase status.");
    assert(apiSecret, "Missing API_SECRET in environment.");

    const apiPort = 42000 + Math.floor(Math.random() * 1000);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    apiServer = startApiServer({
      cwd,
      env: {
        ...process.env,
        API_PORT: String(apiPort),
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
      }
    });
    await waitForHealth({ baseUrl: apiBaseUrl, timeoutMs: API_START_TIMEOUT_MS, requestTimeoutMs: HTTP_TIMEOUT_MS });
    console.log(`PASS - API health: ${apiBaseUrl}`);

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { error: orgError } = await admin.from("organizations").insert({
      id: orgId,
      name: `Phase 5-5 Smoke Org ${Date.now()}`,
      org_type: "ngo"
    });
    assert(!orgError, `Failed to seed organization: ${orgError?.message}`);

    const { error: subscriptionError } = await admin.from("org_subscriptions").insert({
      org_id: orgId,
      provider: "manual",
      status: "active",
      trial_ends_at: null
    });
    assert(!subscriptionError, `Failed to seed org_subscriptions: ${subscriptionError?.message}`);

    const createSessionReq = await requestJson(
      `${apiBaseUrl}/orgs/${orgId}/sessions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          workspace_type: "campaign_plan",
          scope_id: `phase55-${Date.now()}`,
          title: "Phase 5-5 Smoke Session",
          start_paused: true
        })
      },
      { timeoutMs: HTTP_TIMEOUT_MS }
    );
    assert(createSessionReq.ok, `create session failed: HTTP ${createSessionReq.status} ${createSessionReq.text}`);
    sessionId = createSessionReq.json?.session?.id ?? "";
    assert(sessionId, "Session id missing after create session.");
    console.log("PASS - Session created");

    await resumeWithMessage({
      apiBaseUrl,
      apiSecret,
      sessionId,
      idempotencyKey: `phase55-init-${Date.now()}`,
      content: "인스타그램 인지도 캠페인 계획 시작해줘"
    });

    let session = await fetchSession(apiBaseUrl, apiSecret, sessionId);
    let surveyPhase = session?.state?.campaign_survey?.phase ?? null;

    if (surveyPhase === "survey_active") {
      await resumeWithMessage({
        apiBaseUrl,
        apiSecret,
        sessionId,
        idempotencyKey: `phase55-survey-${Date.now()}`,
        content: "목표는 인지도고 채널은 인스타그램이야. 진행"
      });
      session = await fetchSession(apiBaseUrl, apiSecret, sessionId);
      surveyPhase = session?.state?.campaign_survey?.phase ?? null;
    }

    assert(surveyPhase === "draft_review", `Expected survey phase draft_review, got ${surveyPhase}`);
    assert(
      Number(session?.state?.campaign_draft_version ?? 0) >= 1,
      `Expected campaign_draft_version >=1, got ${session?.state?.campaign_draft_version}`
    );
    console.log("PASS - Adaptive survey -> draft_review transition");

    await resumeWithMessage({
      apiBaseUrl,
      apiSecret,
      sessionId,
      idempotencyKey: `phase55-revise-${Date.now()}`,
      content: "채널 전략을 수정해줘. 블로그도 포함해줘."
    });
    session = await fetchSession(apiBaseUrl, apiSecret, sessionId);
    assert(session?.state?.campaign_survey?.phase === "draft_review", "Expected phase to remain draft_review.");
    assert(
      Number(session?.state?.campaign_draft_version ?? 0) >= 2,
      `Expected campaign_draft_version >=2 after revision, got ${session?.state?.campaign_draft_version}`
    );
    console.log("PASS - Revision loop increments draft version");

    await resumeWithMessage({
      apiBaseUrl,
      apiSecret,
      sessionId,
      idempotencyKey: `phase55-satisfaction-${Date.now()}`,
      content: "좋아"
    });
    session = await fetchSession(apiBaseUrl, apiSecret, sessionId);
    assert(
      session?.state?.campaign_survey?.awaiting_final_confirmation === true,
      "Expected awaiting_final_confirmation=true after satisfaction signal."
    );
    console.log("PASS - Explicit confirmation question gate");

    const confirmResponse = await resumeWithMessage({
      apiBaseUrl,
      apiSecret,
      sessionId,
      idempotencyKey: `phase55-confirm-${Date.now()}`,
      content: "네"
    });
    assert(confirmResponse.status === "done", `Expected status done, got ${confirmResponse.status}`);
    assert(confirmResponse.current_step === "done", `Expected current_step done, got ${confirmResponse.current_step}`);

    session = await fetchSession(apiBaseUrl, apiSecret, sessionId);
    campaignId = session?.state?.campaign_id ?? "";
    assert(campaignId, "campaign_id missing after final confirmation.");
    console.log("PASS - Final confirmation completed session");

    const { data: campaignRow, error: campaignError } = await admin
      .from("campaigns")
      .select("id,status")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .maybeSingle();
    assert(!campaignError, `Failed to read campaign row: ${campaignError?.message}`);
    assert(campaignRow, "Finalized campaign row not found.");
    assert(campaignRow.status === "approved", `Expected campaign status=approved, got ${campaignRow.status}`);

    const { count: workflowCount, error: workflowError } = await admin
      .from("workflow_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("source_campaign_id", campaignId);
    assert(!workflowError, `Failed to count workflow_items: ${workflowError?.message}`);
    assert((workflowCount ?? 0) === 0, `Expected no workflow_items for finalized campaign, got ${workflowCount}`);

    const { count: sessionWorkflowMessageCount, error: messageCountError } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("session_id", sessionId)
      .not("workflow_item_id", "is", null);
    assert(!messageCountError, `Failed to count workflow-linked chat messages: ${messageCountError?.message}`);
    assert(
      (sessionWorkflowMessageCount ?? 0) === 0,
      `Expected no workflow-linked messages in 5-5 campaign flow, got ${sessionWorkflowMessageCount}`
    );
    console.log("PASS - No inbox/workflow side effects for campaign planning");

    console.log("SMOKE TEST RESULT: PASS");
    console.log(
      JSON.stringify(
        {
          org_id: orgId,
          session_id: sessionId,
          campaign_id: campaignId
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("SMOKE TEST RESULT: FAIL");
    console.error(error);
    if (apiServer) {
      const logs = apiServer.getLogLines();
      if (logs.length > 0) {
        console.error("\n--- API Logs (tail) ---");
        for (const line of logs.slice(-40)) {
          process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
        }
      }
    }
    process.exitCode = 1;
  } finally {
    if (admin) {
      try {
        await admin.from("chat_messages").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("workflow_events").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("workflow_items").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("campaigns").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("orchestrator_sessions").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("org_subscriptions").delete().eq("org_id", orgId);
      } catch {}
      try {
        await admin.from("organizations").delete().eq("id", orgId);
      } catch {}
    }

    if (apiServer?.child) {
      await sleep(200);
      await stopProcessTree(apiServer.child);
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
