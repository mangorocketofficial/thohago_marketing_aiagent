import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SCHEMA_CACHE_MISSING_RE = /Could not find the table '([^']+)' in the schema cache/i;
const REQUIRED_TABLES = ["pipeline_triggers", "campaigns", "orchestrator_sessions"];

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

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
};

const required = (name) => {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const loadEnv = () => {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));
};

const main = async () => {
  loadEnv();

  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return supabaseUrl;
    }
  })();

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  console.log(`[schema-check] Supabase host: ${host}`);

  const failures = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabaseAdmin.from(table).select("id").limit(1);
    if (!error) {
      console.log(`PASS - ${table}`);
      continue;
    }

    const match = error.message.match(SCHEMA_CACHE_MISSING_RE);
    if (match) {
      const missingTable = match[1] ?? `public.${table}`;
      failures.push(
        `Missing table in schema cache: ${missingTable}. Apply Supabase migrations in order through supabase/migrations/20260228110000_phase_1_5a_orchestration.sql on this project.`
      );
      console.log(`FAIL - ${table} (${error.message})`);
      continue;
    }

    failures.push(`Table check failed for ${table}: ${error.message}`);
    console.log(`FAIL - ${table} (${error.message})`);
  }

  if (failures.length > 0) {
    console.error("\nSchema check failed:");
    for (const line of failures) {
      console.error(`- ${line}`);
    }
    process.exit(1);
  }

  console.log("\nSchema check passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
