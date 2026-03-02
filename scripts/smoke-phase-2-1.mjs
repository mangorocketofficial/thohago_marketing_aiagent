import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const STORAGE_DIM = 1536;
const PASSWORD = "Phase2Smoke!12345";

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

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const nowIso = () => new Date().toISOString();

const makeStorageVector = ({ profileDim, hotIndex }) => {
  if (profileDim < 1 || profileDim > STORAGE_DIM) {
    throw new Error(`Invalid profileDim: ${profileDim}`);
  }
  if (hotIndex < 0 || hotIndex >= profileDim) {
    throw new Error(`Invalid hotIndex=${hotIndex} for profileDim=${profileDim}`);
  }

  const vector = new Array(STORAGE_DIM).fill(0);
  vector[hotIndex] = 1;
  return vector;
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

const createUserClient = (url, anonKey, token) =>
  createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

const main = async () => {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  const { stdout } = await runCommandCapture("pnpm", ["exec", "supabase", "status", "-o", "env"], { cwd });
  const statusEnv = parseEnvMap(stdout);
  const supabaseUrl = (statusEnv.API_URL ?? "").trim();
  const anonKey = (statusEnv.ANON_KEY ?? "").trim();
  const serviceRoleKey = (statusEnv.SERVICE_ROLE_KEY ?? "").trim();

  assert(supabaseUrl, "Missing API_URL from `supabase status -o env`.");
  assert(anonKey, "Missing ANON_KEY from `supabase status -o env`.");
  assert(serviceRoleKey, "Missing SERVICE_ROLE_KEY from `supabase status -o env`.");

  const runId = Date.now();
  const seedOrgId = (process.env.SEED_ORG_ID ?? "a1b2c3d4-0000-0000-0000-000000000001").trim();
  const otherOrgId = crypto.randomUUID();
  const ownerEmail = `phase2-owner-${runId}@example.com`;
  const outsiderEmail = `phase2-outsider-${runId}@example.com`;
  const sourcePrefix = `phase2-smoke-${runId}`;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const cleanup = {
    userIds: [],
    sourceIds: [],
    otherOrgId
  };

  try {
    const { error: orgError } = await admin.from("organizations").upsert(
      {
        id: otherOrgId,
        name: `Phase2 Smoke Other Org ${runId}`,
        org_type: "ngo"
      },
      { onConflict: "id" }
    );
    assert(!orgError, `Failed to ensure other org: ${orgError?.message}`);

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

    const { error: usersError } = await admin.from("users").upsert(
      [
        { id: owner.userId, email: ownerEmail, name: "Phase2 Owner" },
        { id: outsider.userId, email: outsiderEmail, name: "Phase2 Outsider" }
      ],
      { onConflict: "id" }
    );
    assert(!usersError, `Failed to upsert public.users rows: ${usersError?.message}`);

    const { error: membersError } = await admin.from("organization_members").upsert(
      [
        {
          id: crypto.randomUUID(),
          org_id: seedOrgId,
          user_id: owner.userId,
          role: "owner"
        },
        {
          id: crypto.randomUUID(),
          org_id: otherOrgId,
          user_id: outsider.userId,
          role: "owner"
        }
      ],
      { onConflict: "org_id,user_id" }
    );
    assert(!membersError, `Failed to upsert memberships: ${membersError?.message}`);

    const rows = [
      {
        org_id: seedOrgId,
        source_type: "content",
        source_id: `${sourcePrefix}-1536`,
        chunk_index: 0,
        content: "phase2 smoke seed org dim 1536",
        metadata: { run_id: runId, profile: "default", created_at: nowIso() },
        embedding_model: "text-embedding-3-small",
        embedding_dim: 1536,
        embedding: makeStorageVector({ profileDim: 1536, hotIndex: 4 })
      },
      {
        org_id: seedOrgId,
        source_type: "content",
        source_id: `${sourcePrefix}-768`,
        chunk_index: 0,
        content: "phase2 smoke seed org dim 768",
        metadata: { run_id: runId, profile: "balanced", created_at: nowIso() },
        embedding_model: "text-embedding-3-small",
        embedding_dim: 768,
        embedding: makeStorageVector({ profileDim: 768, hotIndex: 8 })
      },
      {
        org_id: otherOrgId,
        source_type: "content",
        source_id: `${sourcePrefix}-other-org`,
        chunk_index: 0,
        content: "phase2 smoke other org dim 1536",
        metadata: { run_id: runId, profile: "default", created_at: nowIso() },
        embedding_model: "text-embedding-3-small",
        embedding_dim: 1536,
        embedding: makeStorageVector({ profileDim: 1536, hotIndex: 12 })
      }
    ];
    cleanup.sourceIds = rows.map((row) => row.source_id);

    const { error: insertError } = await admin.from("org_rag_embeddings").insert(rows);
    assert(!insertError, `Failed to insert smoke embeddings: ${insertError?.message}`);
    console.log("PASS - inserted smoke embedding rows");

    const query1536 = makeStorageVector({ profileDim: 1536, hotIndex: 4 });
    const rpc1536 = await admin.rpc("match_rag_embeddings", {
      query_embedding: query1536,
      query_org_id: seedOrgId,
      query_embedding_model: "text-embedding-3-small",
      query_embedding_dim: 1536,
      query_source_types: ["content"],
      query_metadata_filter: { run_id: runId },
      match_threshold: 0.2,
      match_count: 5
    });
    assert(!rpc1536.error, `Service RPC(1536) failed: ${rpc1536.error?.message}`);
    assert((rpc1536.data?.length ?? 0) >= 1, "Service RPC(1536) returned no rows.");
    assert(
      rpc1536.data?.some((row) => row.source_id === `${sourcePrefix}-1536`),
      "Service RPC(1536) missing expected source row."
    );
    console.log("PASS - service RPC returns 1536 profile rows");

    const query768 = makeStorageVector({ profileDim: 768, hotIndex: 8 });
    const rpc768 = await admin.rpc("match_rag_embeddings", {
      query_embedding: query768,
      query_org_id: seedOrgId,
      query_embedding_model: "text-embedding-3-small",
      query_embedding_dim: 768,
      query_source_types: ["content"],
      query_metadata_filter: { run_id: runId },
      match_threshold: 0.2,
      match_count: 5
    });
    assert(!rpc768.error, `Service RPC(768) failed: ${rpc768.error?.message}`);
    assert(
      rpc768.data?.some((row) => row.source_id === `${sourcePrefix}-768`),
      "Service RPC(768) missing expected profile row."
    );
    console.log("PASS - service RPC returns 768 profile rows");

    const ownerClient = createUserClient(supabaseUrl, anonKey, owner.accessToken);
    const outsiderClient = createUserClient(supabaseUrl, anonKey, outsider.accessToken);

    const ownerOwnRows = await ownerClient
      .from("org_rag_embeddings")
      .select("source_id, org_id")
      .eq("org_id", seedOrgId)
      .like("source_id", `${sourcePrefix}%`);
    assert(!ownerOwnRows.error, `Owner own-org select failed: ${ownerOwnRows.error?.message}`);
    assert((ownerOwnRows.data?.length ?? 0) >= 2, "Owner could not read own org embedding rows.");
    console.log("PASS - owner can read own org rows (RLS)");

    const ownerOtherRows = await ownerClient
      .from("org_rag_embeddings")
      .select("source_id, org_id")
      .eq("org_id", otherOrgId)
      .like("source_id", `${sourcePrefix}%`);
    assert(!ownerOtherRows.error, `Owner other-org select failed: ${ownerOtherRows.error?.message}`);
    assert((ownerOtherRows.data?.length ?? 0) === 0, "Owner can read other org rows unexpectedly.");
    console.log("PASS - owner cannot read other org rows (RLS)");

    const outsiderSeedRows = await outsiderClient
      .from("org_rag_embeddings")
      .select("source_id, org_id")
      .eq("org_id", seedOrgId)
      .like("source_id", `${sourcePrefix}%`);
    assert(!outsiderSeedRows.error, `Outsider seed-org select failed: ${outsiderSeedRows.error?.message}`);
    assert((outsiderSeedRows.data?.length ?? 0) === 0, "Outsider can read seed org rows unexpectedly.");
    console.log("PASS - outsider cannot read seed org rows (RLS)");

    const ownerInsert = await ownerClient.from("org_rag_embeddings").insert({
      org_id: seedOrgId,
      source_type: "content",
      source_id: `${sourcePrefix}-owner-insert`,
      chunk_index: 0,
      content: "should fail",
      metadata: { run_id: runId },
      embedding_model: "text-embedding-3-small",
      embedding_dim: 1536,
      embedding: makeStorageVector({ profileDim: 1536, hotIndex: 20 })
    });
    assert(!!ownerInsert.error, "Owner insert unexpectedly succeeded.");
    console.log("PASS - owner write blocked (no authenticated write policy)");

    const ownerRpc = await ownerClient.rpc("match_rag_embeddings", {
      query_embedding: query1536,
      query_org_id: seedOrgId,
      query_embedding_model: "text-embedding-3-small",
      query_embedding_dim: 1536,
      query_source_types: ["content"],
      query_metadata_filter: { run_id: runId },
      match_threshold: 0.2,
      match_count: 5
    });
    assert(!!ownerRpc.error, "Owner RPC unexpectedly succeeded (should be service_role only).");
    console.log("PASS - authenticated RPC execution blocked");

    console.log("\nSMOKE RESULT: PASS");
  } finally {
    if (cleanup.sourceIds.length > 0) {
      await admin.from("org_rag_embeddings").delete().in("source_id", cleanup.sourceIds);
    }

    if (cleanup.userIds.length > 0) {
      await admin.from("organization_members").delete().in("user_id", cleanup.userIds);
      await admin.from("users").delete().in("id", cleanup.userIds);
      for (const userId of cleanup.userIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    }

    if (cleanup.otherOrgId) {
      await admin.from("organizations").delete().eq("id", cleanup.otherOrgId);
    }
  }
};

main().catch((error) => {
  console.error("\nSMOKE RESULT: FAIL");
  console.error(error);
  process.exit(1);
});
