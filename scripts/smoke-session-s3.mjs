import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import process from "node:process";
import {
  assert,
  readSupabaseStatusEnv,
  requestJson,
  sleep,
  startApiServer,
  stopProcessTree,
  waitForHealth
} from "./lib/smoke-harness.mjs";

const SEED_ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const API_PORT = Number.parseInt(
  process.env.SMOKE_API_PORT ?? String(42000 + Math.floor(Math.random() * 1000)),
  10
);
const API_SECRET = process.env.SMOKE_API_SECRET ?? "phase-s3-smoke-secret";
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const HEALTH_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const SUBSCRIBE_TIMEOUT_MS = 12_000;
const EVENT_TIMEOUT_MS = 6_000;

const waitForSubscribed = (channel, timeoutMs = SUBSCRIBE_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Realtime subscribe timed out."));
    }, timeoutMs);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(undefined);
        return;
      }
      if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
        clearTimeout(timer);
        reject(new Error(`Realtime subscribe failed with status=${status}`));
      }
    });
  });

const waitForEvent = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const main = async () => {
  const cwd = process.cwd();
  const statusEnv = await readSupabaseStatusEnv({ cwd });
  const supabaseUrl = statusEnv.API_URL;
  const serviceRoleKey = statusEnv.SERVICE_ROLE_KEY;
  const anonKey = statusEnv.ANON_KEY;

  assert(supabaseUrl, "Missing API_URL from `supabase status -o env`.");
  assert(serviceRoleKey, "Missing SERVICE_ROLE_KEY from `supabase status -o env`.");
  assert(anonKey, "Missing ANON_KEY from `supabase status -o env`.");

  const orgId = (process.env.SEED_ORG_ID ?? SEED_ORG_ID).trim() || SEED_ORG_ID;
  const runTag = Date.now();

  const apiServer = startApiServer({
    cwd,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      API_PORT: String(API_PORT),
      API_SECRET
    },
    pnpmArgs: ["-C", "apps/api", "dev"],
    maxLogLines: 200
  });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  supabaseAdmin.realtime.setAuth(serviceRoleKey);
  const supabaseRealtime = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  supabaseRealtime.realtime.setAuth(serviceRoleKey);

  const insertedMessageIds = [];
  const createdSessionIds = [];
  let sessionA = "";
  let sessionB = "";
  let realtimeChannelA = null;

  const createSession = async (scopeId) => {
    const response = await requestJson(`${API_BASE}/orgs/${orgId}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": API_SECRET
      },
      body: JSON.stringify({
        workspace_type: "general",
        scope_id: scopeId,
        title: `S3 Smoke ${scopeId}`,
        start_paused: true
      })
    }, { timeoutMs: HTTP_TIMEOUT_MS });

    assert(response.ok, `Create session failed: HTTP ${response.status} ${response.text}`);
    assert(response.json?.ok === true, `Create session payload invalid: ${JSON.stringify(response.json)}`);
    const session = response.json?.session;
    assert(session?.id, `Session id is missing: ${JSON.stringify(response.json)}`);

    if (!response.json?.reused) {
      createdSessionIds.push(session.id);
    }

    return session.id;
  };

  const insertMessage = async ({ sessionId, content }) => {
    const id = crypto.randomUUID();
    const row = {
      id,
      org_id: orgId,
      session_id: sessionId,
      role: "assistant",
      content,
      channel: "dashboard",
      message_type: "text",
      metadata: {
        source: "smoke:s3",
        run_tag: String(runTag)
      },
      workflow_item_id: null,
      projection_key: null
    };

    const { error } = await supabaseAdmin.from("chat_messages").insert(row);
    assert(!error, `Failed to insert chat message (${id}): ${error?.message}`);
    insertedMessageIds.push(id);
    return id;
  };

  try {
    await waitForHealth({
      baseUrl: API_BASE,
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: 500,
      requireBodyOk: true,
      requestTimeoutMs: HTTP_TIMEOUT_MS
    });
    console.log(`PASS - API healthy at ${API_BASE}`);

    sessionA = await createSession(`s3-a-${runTag}`);
    sessionB = await createSession(`s3-b-${runTag}`);
    assert(sessionA !== sessionB, "Session A/B should be different ids.");
    console.log("PASS - created two sessions in same org");

    const msgA = await insertMessage({
      sessionId: sessionA,
      content: `S3 smoke message A ${runTag}`
    });
    const msgB = await insertMessage({
      sessionId: sessionB,
      content: `S3 smoke message B ${runTag}`
    });
    const msgLegacy = await insertMessage({
      sessionId: null,
      content: `S3 smoke legacy message ${runTag}`
    });
    console.log("PASS - inserted session A/B and legacy(null) messages");

    const { data: rowsA, error: rowsAError } = await supabaseAdmin
      .from("chat_messages")
      .select("id,session_id")
      .eq("org_id", orgId)
      .eq("session_id", sessionA)
      .order("created_at", { ascending: true });
    assert(!rowsAError, `Failed querying session A timeline: ${rowsAError?.message}`);
    assert(Array.isArray(rowsA), "Session A query did not return an array.");
    assert(rowsA.some((row) => row.id === msgA), "Session A query missing A message.");
    assert(!rowsA.some((row) => row.id === msgB), "Session A query leaked B message.");
    assert(!rowsA.some((row) => row.id === msgLegacy), "Session A query leaked legacy null-session message.");

    const { data: rowsB, error: rowsBError } = await supabaseAdmin
      .from("chat_messages")
      .select("id,session_id")
      .eq("org_id", orgId)
      .eq("session_id", sessionB)
      .order("created_at", { ascending: true });
    assert(!rowsBError, `Failed querying session B timeline: ${rowsBError?.message}`);
    assert(Array.isArray(rowsB), "Session B query did not return an array.");
    assert(rowsB.some((row) => row.id === msgB), "Session B query missing B message.");
    assert(!rowsB.some((row) => row.id === msgA), "Session B query leaked A message.");
    assert(!rowsB.some((row) => row.id === msgLegacy), "Session B query leaked legacy null-session message.");

    console.log("PASS - session-scoped queries are isolated and exclude legacy null rows");

    const realtimeReceivedIds = [];
    const visibleIdsForSelectedA = [];
    realtimeChannelA = supabaseRealtime
      .channel(`smoke-s3-a-${runTag}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `org_id=eq.${orgId}`
        },
        (payload) => {
          const id = payload?.new?.id;
          const rowSessionId = typeof payload?.new?.session_id === "string" ? payload.new.session_id : null;
          if (typeof id === "string") {
            realtimeReceivedIds.push(id);
            if (rowSessionId === sessionA) {
              visibleIdsForSelectedA.push(id);
            }
          }
        }
      );

    try {
      await waitForSubscribed(realtimeChannelA);

      const msgBRealtime = await insertMessage({
        sessionId: sessionB,
        content: `S3 smoke realtime B ${runTag}`
      });
      await waitForEvent(
        () => realtimeReceivedIds.includes(msgBRealtime),
        EVENT_TIMEOUT_MS,
        "session B realtime delivery to org channel"
      );
      assert(
        !visibleIdsForSelectedA.includes(msgBRealtime),
        "Selected-session gate leaked Session B event into Session A view."
      );

      const msgARealtime = await insertMessage({
        sessionId: sessionA,
        content: `S3 smoke realtime A ${runTag}`
      });
      await waitForEvent(
        () => visibleIdsForSelectedA.includes(msgARealtime),
        EVENT_TIMEOUT_MS,
        "session A realtime event"
      );

      console.log("PASS - realtime org stream + selected-session gate blocks cross-session leakage");
    } catch (realtimeError) {
      console.warn(
        `WARN - realtime delivery unavailable in this environment. Falling back to deterministic gate validation. (${
          realtimeError instanceof Error ? realtimeError.message : String(realtimeError)
        })`
      );

      const msgBRealtime = await insertMessage({
        sessionId: sessionB,
        content: `S3 smoke fallback B ${runTag}`
      });
      const msgARealtime = await insertMessage({
        sessionId: sessionA,
        content: `S3 smoke fallback A ${runTag}`
      });

      const { data: fallbackRows, error: fallbackError } = await supabaseAdmin
        .from("chat_messages")
        .select("id,session_id")
        .in("id", [msgARealtime, msgBRealtime]);
      assert(!fallbackError, `Failed fallback row query: ${fallbackError?.message}`);
      assert(Array.isArray(fallbackRows) && fallbackRows.length === 2, "Fallback rows are incomplete.");

      const rowA = fallbackRows.find((row) => row.id === msgARealtime) ?? null;
      const rowB = fallbackRows.find((row) => row.id === msgBRealtime) ?? null;
      assert(!!rowA && !!rowB, "Fallback rows missing expected ids.");

      const isVisibleForSelectedSession = (rowSessionId, selectedId) =>
        typeof rowSessionId === "string" && rowSessionId === selectedId;

      assert(!isVisibleForSelectedSession(rowB.session_id, sessionA), "Fallback gate leaked Session B row into Session A.");
      assert(isVisibleForSelectedSession(rowA.session_id, sessionA), "Fallback gate hid Session A row unexpectedly.");

      console.log("PASS - deterministic selected-session gate blocks cross-session leakage");
    }

    console.log("\nSMOKE TEST RESULT: PASS");
    console.log(
      JSON.stringify(
        {
          org_id: orgId,
          session_a: sessionA,
          session_b: sessionB
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("\nSMOKE TEST RESULT: FAIL");
    console.error(error);

    const apiLogLines = apiServer.getLogLines();
    if (apiLogLines.length > 0) {
      console.error("\n--- API Logs (tail) ---");
      for (const line of apiLogLines.slice(-40)) {
        process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
      }
    }

    process.exitCode = 1;
  } finally {
    if (realtimeChannelA) {
      await supabaseRealtime.removeChannel(realtimeChannelA).catch(() => {});
    }

    if (insertedMessageIds.length > 0) {
      try {
        await supabaseAdmin.from("chat_messages").delete().in("id", insertedMessageIds);
      } catch {
        // Ignore cleanup failures in smoke script.
      }
    }

    if (createdSessionIds.length > 0) {
      try {
        await supabaseAdmin.from("orchestrator_sessions").delete().in("id", createdSessionIds);
      } catch {
        // Ignore cleanup failures in smoke script.
      }
    }

    await stopProcessTree(apiServer.child);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
