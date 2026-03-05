import express from "express";
import { env } from "./lib/env";
import { supabaseAdmin } from "./lib/supabase-admin";
import { contentsRouter } from "./routes/contents";
import { entitlementRouter } from "./routes/entitlement";
import { healthRouter } from "./routes/health";
import { memoryRouter } from "./routes/memory";
import { onboardingRouter } from "./routes/onboarding";
import { ragRouter } from "./routes/rag";
import { sessionsRouter } from "./routes/sessions";
import { triggerRouter } from "./routes/trigger";
import { startRagIngestionWorker } from "./rag/ingest-brand-profile";

const app = express();

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(healthRouter);
app.use(triggerRouter);
app.use(sessionsRouter);
app.use(contentsRouter);
app.use(onboardingRouter);
app.use(memoryRouter);
app.use(ragRouter);
app.use(entitlementRouter);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    message: "Route not found."
  });
});

const requiredTables = [
  "pipeline_triggers",
  "campaigns",
  "contents",
  "chat_messages",
  "session_memory",
  "conversation_preferences",
  "llm_response_cache",
  "orchestrator_sessions",
  "workflow_items",
  "workflow_events",
  "schedule_slots",
  "org_brand_settings",
  "org_subscriptions"
] as const;

const verifyRequiredTables = async () => {
  for (const table of requiredTables) {
    const { error } = await supabaseAdmin.from(table).select("id").limit(1);
    if (!error) {
      continue;
    }

    if (/Could not find the table '.+' in the schema cache/i.test(error.message)) {
      console.warn(
        `[API] Schema not ready: ${error.message}. Apply Supabase migrations in order through 20260305183000_phase_6_2_scheduler_foundation.sql on the connected project.`
      );
      continue;
    }

    console.warn(`[API] Schema probe failed for ${table}: ${error.message}`);
  }
};

const verifyPhase32ProjectionColumns = async () => {
  const { error } = await supabaseAdmin
    .from("chat_messages")
    .select("id,message_type,metadata,workflow_item_id,projection_key")
    .limit(1);

  if (!error) {
    return;
  }

  if (/column .+ does not exist/i.test(error.message) || /Could not find the column/i.test(error.message)) {
    console.warn(
      `[API] Schema not ready: ${error.message}. Apply Supabase migrations in order through 20260305183000_phase_6_2_scheduler_foundation.sql on the connected project.`
    );
    return;
  }

  console.warn(`[API] Projection schema probe failed for chat_messages: ${error.message}`);
};

app.listen(env.apiPort, () => {
  const supabaseHost = (() => {
    try {
      return new URL(env.supabaseUrl).host;
    } catch {
      return env.supabaseUrl;
    }
  })();

  console.log(`[API] Listening on http://localhost:${env.apiPort}`);
  console.log(`[API] Supabase host: ${supabaseHost}`);
  void verifyRequiredTables();
  void verifyPhase32ProjectionColumns();
  startRagIngestionWorker();
});
