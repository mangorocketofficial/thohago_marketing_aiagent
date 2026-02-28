import express from "express";
import { env } from "./lib/env";
import { supabaseAdmin } from "./lib/supabase-admin";
import { healthRouter } from "./routes/health";
import { sessionsRouter } from "./routes/sessions";
import { triggerRouter } from "./routes/trigger";

const app = express();

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(healthRouter);
app.use(triggerRouter);
app.use(sessionsRouter);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    message: "Route not found."
  });
});

const requiredTables = ["pipeline_triggers", "campaigns", "orchestrator_sessions"] as const;

const verifyRequiredTables = async () => {
  for (const table of requiredTables) {
    const { error } = await supabaseAdmin.from(table).select("id").limit(1);
    if (!error) {
      continue;
    }

    if (/Could not find the table '.+' in the schema cache/i.test(error.message)) {
      console.warn(
        `[API] Schema not ready: ${error.message}. Apply Supabase migrations in order through 20260228110000_phase_1_5a_orchestration.sql on the connected project.`
      );
      continue;
    }

    console.warn(`[API] Schema probe failed for ${table}: ${error.message}`);
  }
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
});
