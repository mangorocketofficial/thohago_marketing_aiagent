import fs from "node:fs";
import path from "node:path";

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

const parseCliArgs = (argv) => {
  const args = {
    orgId: "",
    batchLimit: 100,
    maxBatches: 100
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--org-id" && argv[i + 1]) {
      args.orgId = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === "--batch-limit" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.batchLimit = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--max-batches" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.maxBatches = parsed;
      }
      i += 1;
    }
  }

  return args;
};

const requestBatch = async ({ apiBase, apiSecret, orgId, batchLimit }) => {
  const response = await fetch(`${apiBase}/rag/embed-pending-content`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-token": apiSecret
    },
    body: JSON.stringify({
      org_id: orgId,
      batch_limit: batchLimit
    })
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.message ?? body?.error ?? text ?? `HTTP ${response.status}`;
    throw new Error(`Backfill request failed: ${message}`);
  }

  return body ?? {};
};

const main = async () => {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  const cli = parseCliArgs(process.argv.slice(2));
  const apiBase = (process.env.ORCHESTRATOR_API_BASE ?? "").trim().replace(/\/+$/, "");
  const apiSecret = (process.env.API_SECRET ?? "").trim();
  const orgId = (cli.orgId || process.env.SEED_ORG_ID || "").trim();

  if (!apiBase) {
    throw new Error("ORCHESTRATOR_API_BASE is required.");
  }
  if (!apiSecret) {
    throw new Error("API_SECRET is required.");
  }
  if (!orgId) {
    throw new Error("org id is required. Use --org-id or SEED_ORG_ID.");
  }

  let totalEmbedded = 0;
  let totalFailed = 0;
  let remaining = Number.POSITIVE_INFINITY;
  let batches = 0;

  while (remaining > 0 && batches < cli.maxBatches) {
    const result = await requestBatch({
      apiBase,
      apiSecret,
      orgId,
      batchLimit: cli.batchLimit
    });
    batches += 1;
    totalEmbedded += Number.isFinite(result.embedded_count) ? result.embedded_count : 0;
    totalFailed += Number.isFinite(result.failed_count) ? result.failed_count : 0;
    remaining = Number.isFinite(result.remaining) ? result.remaining : 0;

    console.log(
      `[BATCH ${batches}] embedded=${result.embedded_count ?? 0}, failed=${result.failed_count ?? 0}, remaining=${remaining}`
    );

    if ((result.attempted_count ?? 0) <= 0) {
      break;
    }
  }

  console.log(`[DONE] org=${orgId}, embedded=${totalEmbedded}, failed=${totalFailed}, remaining=${remaining}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
