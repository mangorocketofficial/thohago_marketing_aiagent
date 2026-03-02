import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const INGESTION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_500;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_REVIEW_PATH = path.join(REPO_ROOT, "docs", "브랜드리뷰_2026-03-01-05.md");
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, "docs", "reports", "phase-2-2-reingest-result.json");

const loadEnvFile = (filePath: string): void => {
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

const runCommandCapture = (command: string, args: string[], options: { cwd: string }) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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

const parseEnvMap = (raw: string): Record<string, string> => {
  const map: Record<string, string> = {};
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

const parseArgs = (): {
  orgId: string;
  reviewPath: string;
  reportPath: string;
} => {
  const args = process.argv.slice(2);
  const output = {
    orgId: process.env.SEED_ORG_ID?.trim() || DEFAULT_ORG_ID,
    reviewPath: DEFAULT_REVIEW_PATH,
    reportPath: DEFAULT_REPORT_PATH
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--org-id" && args[index + 1]) {
      output.orgId = args[index + 1].trim();
      index += 1;
      continue;
    }
    if (token === "--review-path" && args[index + 1]) {
      output.reviewPath = args[index + 1].trim();
      index += 1;
      continue;
    }
    if (token === "--report-path" && args[index + 1]) {
      output.reportPath = args[index + 1].trim();
      index += 1;
      continue;
    }
  }

  return output;
};

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};

const nowIso = () => new Date().toISOString();

const main = async (): Promise<void> => {
  const cwd = REPO_ROOT;
  loadEnvFile(path.join(REPO_ROOT, ".env"));
  loadEnvFile(path.join(REPO_ROOT, ".env.local"));

  const args = parseArgs();
  const reviewAbsolutePath = path.isAbsolute(args.reviewPath) ? args.reviewPath : path.resolve(REPO_ROOT, args.reviewPath);
  assert(fs.existsSync(reviewAbsolutePath), `Review markdown file not found: ${reviewAbsolutePath}`);

  const reviewMarkdown = fs.readFileSync(reviewAbsolutePath, "utf8").replace(/\r\n/g, "\n").trim();
  assert(reviewMarkdown.length > 0, "Review markdown file is empty.");

  const { stdout } = await runCommandCapture("pnpm", ["exec", "supabase", "status", "-o", "env"], { cwd });
  const statusEnv = parseEnvMap(stdout);
  const supabaseUrl = (statusEnv.API_URL ?? "").trim();
  const serviceRoleKey = (statusEnv.SERVICE_ROLE_KEY ?? "").trim();
  assert(supabaseUrl, "Missing API_URL from local supabase status.");
  assert(serviceRoleKey, "Missing SERVICE_ROLE_KEY from local supabase status.");

  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = (statusEnv.ANON_KEY ?? "").trim();
  process.env.ONBOARDING_PINNED_REVIEW_PATH = path.relative(REPO_ROOT, reviewAbsolutePath).replace(/\\/g, "/");

  const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  assert(openAiApiKey, "OPENAI_API_KEY is required for ingestion.");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: orgRow, error: orgError } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", args.orgId)
    .maybeSingle();
  assert(!orgError, `Failed to read organization: ${orgError?.message}`);
  assert(orgRow?.id, `Organization not found: ${args.orgId}`);

  const { data: existing, error: existingError } = await admin
    .from("org_brand_settings")
    .select("id, result_document")
    .eq("org_id", args.orgId)
    .maybeSingle();
  assert(!existingError, `Failed to read org_brand_settings: ${existingError?.message}`);

  const nextResultDocument = {
    ...(existing?.result_document && typeof existing.result_document === "object" ? existing.result_document : {}),
    review_markdown: reviewMarkdown,
    template_ref: path.relative(REPO_ROOT, reviewAbsolutePath).replace(/\\/g, "/"),
    generated_at: nowIso()
  };

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("org_brand_settings")
      .update({
        result_document: nextResultDocument,
        rag_ingestion_status: "pending",
        rag_ingestion_started_at: null,
        rag_ingestion_error: null
      })
      .eq("org_id", args.orgId);
    assert(!updateError, `Failed to update org_brand_settings: ${updateError?.message}`);
  } else {
    const { error: insertError } = await admin.from("org_brand_settings").insert({
      org_id: args.orgId,
      crawl_status: {},
      crawl_payload: {},
      interview_answers: {},
      target_audience: [],
      key_themes: [],
      forbidden_words: [],
      forbidden_topics: [],
      campaign_seasons: [],
      result_document: nextResultDocument,
      rag_ingestion_status: "pending",
      rag_ingestion_started_at: null,
      rag_ingestion_error: null
    });
    assert(!insertError, `Failed to insert org_brand_settings: ${insertError?.message}`);
  }

  const { enqueueRagIngestion } = await import("../apps/api/src/rag/ingest-brand-profile.ts");
  await enqueueRagIngestion(args.orgId);

  const statusTimeline: Array<{ at: string; status: string; error: string | null }> = [];
  const startedAt = Date.now();
  let finalStatus = "pending";
  let finalError: string | null = null;
  while (Date.now() - startedAt < INGESTION_TIMEOUT_MS) {
    const { data, error } = await admin
      .from("org_brand_settings")
      .select("rag_ingestion_status, rag_ingestion_error, rag_indexed_at, rag_source_hash")
      .eq("org_id", args.orgId)
      .maybeSingle();
    assert(!error, `Failed to poll ingestion status: ${error?.message}`);
    assert(data, "org_brand_settings row missing while polling.");

    finalStatus = String(data.rag_ingestion_status ?? "pending");
    finalError = typeof data.rag_ingestion_error === "string" ? data.rag_ingestion_error : null;
    statusTimeline.push({
      at: nowIso(),
      status: finalStatus,
      error: finalError
    });

    if (finalStatus === "done") {
      break;
    }
    if (finalStatus === "failed") {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const { data: embeddingRows, error: embeddingError } = await admin
    .from("org_rag_embeddings")
    .select("source_id")
    .eq("org_id", args.orgId)
    .eq("source_type", "brand_profile");
  assert(!embeddingError, `Failed to read embeddings: ${embeddingError?.message}`);
  const rows = Array.isArray(embeddingRows) ? embeddingRows : [];
  const bySource = rows.reduce<Record<string, number>>((acc, row) => {
    const sourceId = typeof row.source_id === "string" ? row.source_id : "unknown";
    acc[sourceId] = (acc[sourceId] ?? 0) + 1;
    return acc;
  }, {});

  const report = {
    started_at: nowIso(),
    org_id: args.orgId,
    org_name: orgRow.name,
    review_path: reviewAbsolutePath,
    review_length: reviewMarkdown.length,
    status_timeline: statusTimeline,
    final_status: finalStatus,
    final_error: finalError,
    embedding_counts: {
      total_brand_profile_chunks: rows.length,
      by_source: bySource
    },
    success: finalStatus === "done"
  };

  const reportAbsolutePath = path.isAbsolute(args.reportPath) ? args.reportPath : path.resolve(REPO_ROOT, args.reportPath);
  fs.mkdirSync(path.dirname(reportAbsolutePath), { recursive: true });
  fs.writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const timestampedPath = reportAbsolutePath.replace(/\.json$/i, `-${timestamp}.json`);
  fs.writeFileSync(timestampedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Reingest report written: ${reportAbsolutePath}`);
  console.log(`Reingest report (timestamped): ${timestampedPath}`);
  console.log(`Reingest final status: ${finalStatus}`);

  if (finalStatus !== "done") {
    process.exit(1);
  }
};

void main().catch((error) => {
  console.error("Brand review reingest failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
