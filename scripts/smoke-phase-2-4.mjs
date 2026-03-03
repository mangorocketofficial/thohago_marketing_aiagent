import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import path from "node:path";
import {
  assert,
  createReport,
  createUserWithToken,
  loadEnvFile,
  nowIso,
  readSupabaseStatusEnv,
  requestJson,
  startApiServer,
  stopProcessTree,
  tailLines,
  waitForHealth,
  withCheck,
  writeJsonReport
} from "./lib/smoke-harness.mjs";

const PASSWORD = "Phase24Smoke!12345";
const API_START_TIMEOUT_MS = 120_000;
const REPORT_PATH = path.join("docs", "reports", "phase-2-4-test-result.json");

const writeReport = (report) =>
  writeJsonReport({
    report,
    latestPath: REPORT_PATH,
    timestampPrefix: "phase-2-4-test-result"
  });

const createEmbedding = async ({ apiKey, model, dimensions, input }) => {
  const body = {
    model,
    input
  };
  if (Number.isFinite(dimensions) && dimensions > 0) {
    body.dimensions = Math.floor(dimensions);
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed (${response.status}): ${text}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI embedding response is not valid JSON.");
  }

  const embedding = parsed?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("OpenAI embedding response missing vector data.");
  }

  return embedding;
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
      const statusEnv = await readSupabaseStatusEnv({ cwd });
      assert(statusEnv.API_URL, "Missing API_URL from `supabase status -o env`.");
      assert(statusEnv.ANON_KEY, "Missing ANON_KEY from `supabase status -o env`.");
      assert(statusEnv.SERVICE_ROLE_KEY, "Missing SERVICE_ROLE_KEY from `supabase status -o env`.");
      return {
        api_url: statusEnv.API_URL,
        anon_key: statusEnv.ANON_KEY,
        service_role_key: statusEnv.SERVICE_ROLE_KEY,
        anon_key_present: !!statusEnv.ANON_KEY,
        service_role_key_present: !!statusEnv.SERVICE_ROLE_KEY
      };
    });

    const supabaseUrl = status.api_url;
    const anonKey = status.anon_key;
    const serviceRoleKey = status.service_role_key;
    const apiSecret = (process.env.API_SECRET ?? "").trim();
    const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    const ragEmbeddingModel = (process.env.RAG_EMBEDDING_MODEL ?? "text-embedding-3-small").trim();
    const ragEmbeddingDimensions = Number.parseInt((process.env.RAG_EMBEDDING_DIMENSIONS ?? "1536").trim(), 10);

    await withCheck(report, "required_env", async () => {
      assert(apiSecret, "Missing API_SECRET in environment.");
      assert(openAiApiKey, "Missing OPENAI_API_KEY in environment.");
      assert(
        !/^OPENAI_API_KEY/i.test(openAiApiKey),
        "OPENAI_API_KEY looks like a placeholder value. Set a real key (for example, starts with sk-...)."
      );
      return {
        api_secret_present: true,
        openai_key_present: true,
        rag_embedding_model: ragEmbeddingModel,
        rag_embedding_dimensions: ragEmbeddingDimensions
      };
    });

    const apiPort = 40000 + Math.floor(Math.random() * 1000);
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
      await waitForHealth({ baseUrl: apiBaseUrl, timeoutMs: API_START_TIMEOUT_MS });
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

    const ownerEmail = `phase24-owner-${runTag}@example.com`;
    const owner = await withCheck(report, "seed_owner_user", async () => {
      const result = await createUserWithToken({
        adminClient: admin,
        anonClient: anon,
        email: ownerEmail,
        password: PASSWORD
      });
      cleanup.userIds.push(result.userId);

      const { error: userRowError } = await admin.from("users").upsert(
        [{ id: result.userId, email: ownerEmail, name: "Phase 2-4 Smoke Owner" }],
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
        {
          id: orgActiveId,
          name: `Phase 2-4 Active Org ${runTag}`,
          org_type: "ngo"
        },
        {
          id: orgBlockedId,
          name: `Phase 2-4 Blocked Org ${runTag}`,
          org_type: "ngo"
        }
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
      return {
        org_active_id: orgActiveId,
        org_blocked_id: orgBlockedId
      };
    });

    const sourceIdText = `phase24-text-${runTag}.pdf`;
    const sourceIdMeta = `phase24-image-${runTag}.jpg`;
    const sourceIdShort = `phase24-short-${runTag}.txt`;
    const activityFolder = `phase24-activity-${runTag}`;

    const longText = [
      "지역 아동 교육 프로그램 현장 보고서입니다.",
      "봉사자 참여율, 학습 성과, 다음 분기 계획을 포함합니다.",
      "핵심 메시지는 지속 가능한 교육 지원과 지역 파트너십 강화입니다."
    ]
      .join(" ")
      .repeat(30);
    const textFileModifiedAt = new Date().toISOString();
    const textFileSizeBytes = Buffer.byteLength(longText, "utf8");
    const textFileContentHash = crypto.createHash("sha256").update(longText, "utf8").digest("hex");

    await withCheck(report, "auth_failure_returns_401", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdText,
          activity_folder: activityFolder,
          file_name: "without-token.pdf",
          file_type: "document",
          file_size_bytes: textFileSizeBytes,
          file_modified_at: textFileModifiedAt,
          file_content_hash: textFileContentHash,
          extracted_text: longText
        })
      });
      assert(response.status === 401, `Expected 401, got ${response.status}: ${response.text}`);
      return {
        http_status: response.status
      };
    });

    await withCheck(report, "subscription_gate_returns_402", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgBlockedId,
          source_id: `blocked-${sourceIdText}`,
          activity_folder: activityFolder,
          file_name: "blocked.pdf",
          file_type: "document",
          file_size_bytes: textFileSizeBytes,
          file_modified_at: textFileModifiedAt,
          file_content_hash: textFileContentHash,
          extracted_text: longText
        })
      });
      assert(response.status === 402, `Expected 402, got ${response.status}: ${response.text}`);
      return {
        http_status: response.status,
        error: response.json?.error ?? null
      };
    });

    const textIndexResult = await withCheck(report, "index_text_document", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdText,
          activity_folder: activityFolder,
          file_name: "field-report.pdf",
          file_type: "document",
          file_size_bytes: textFileSizeBytes,
          file_modified_at: textFileModifiedAt,
          file_content_hash: textFileContentHash,
          extracted_text: longText
        })
      });
      assert(response.ok, `Index text document failed: HTTP ${response.status} ${response.text}`);
      assert((response.json?.chunk_count ?? 0) >= 1, "Text index should return at least one chunk.");

      const { data, error } = await admin
        .from("org_rag_embeddings")
        .select("id, source_id, metadata")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdText);
      assert(!error, `Failed to query indexed text rows: ${error?.message}`);
      const rows = Array.isArray(data) ? data : [];
      assert(rows.length === response.json.chunk_count, `Expected ${response.json.chunk_count} rows, got ${rows.length}`);
      assert(rows.every((row) => row?.metadata?.text_extracted === true), "Expected text_extracted=true for text chunks.");

      return {
        chunk_count: response.json.chunk_count,
        row_count: rows.length
      };
    });

    await withCheck(report, "index_metadata_only_null_text", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdMeta,
          activity_folder: activityFolder,
          file_name: "event-photo.jpg",
          file_type: "image",
          extracted_text: null
        })
      });
      assert(response.ok, `Metadata-only index failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.chunk_count === 1, `Expected chunk_count=1, got ${response.json?.chunk_count}`);

      const { data, error } = await admin
        .from("org_rag_embeddings")
        .select("content, metadata")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdMeta);
      assert(!error, `Failed to query metadata-only rows: ${error?.message}`);
      const rows = Array.isArray(data) ? data : [];
      assert(rows.length === 1, `Expected 1 metadata-only row, got ${rows.length}`);
      assert(rows[0]?.metadata?.text_extracted === false, "Expected text_extracted=false for metadata-only row.");

      return {
        chunk_count: response.json.chunk_count,
        content_preview: String(rows[0]?.content ?? "").slice(0, 80)
      };
    });

    await withCheck(report, "index_short_text_fallback", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdShort,
          activity_folder: activityFolder,
          file_name: "summary.txt",
          file_type: "document",
          extracted_text: "짧은 텍스트입니다."
        })
      });
      assert(response.ok, `Short text fallback failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.chunk_count === 1, `Expected chunk_count=1, got ${response.json?.chunk_count}`);

      const { data, error } = await admin
        .from("org_rag_embeddings")
        .select("metadata")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdShort);
      assert(!error, `Failed to query short-text rows: ${error?.message}`);
      const rows = Array.isArray(data) ? data : [];
      assert(rows.length === 1, `Expected 1 row for short text, got ${rows.length}`);
      assert(rows[0]?.metadata?.text_extracted === false, "Short text should fallback to metadata-only.");
      return {
        chunk_count: response.json.chunk_count
      };
    });

    await withCheck(report, "idempotent_reindex_no_duplicates", async () => {
      const before = await admin
        .from("org_rag_embeddings")
        .select("id")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdText);
      assert(!before.error, `Failed to query before reindex: ${before.error?.message}`);
      const beforeCount = Array.isArray(before.data) ? before.data.length : 0;
      assert(beforeCount === textIndexResult.chunk_count, "Before reindex count mismatch.");

      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdText,
          activity_folder: activityFolder,
          file_name: "field-report.pdf",
          file_type: "document",
          file_size_bytes: textFileSizeBytes,
          file_modified_at: textFileModifiedAt,
          file_content_hash: textFileContentHash,
          extracted_text: longText
        })
      });
      assert(response.ok, `Reindex failed: HTTP ${response.status} ${response.text}`);
      assert(response.json?.skipped === true, "Expected skipped=true for unchanged file signature.");
      assert(response.json?.reason === "unchanged", "Expected reason=unchanged on unchanged reindex.");

      const after = await admin
        .from("org_rag_embeddings")
        .select("id")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdText);
      assert(!after.error, `Failed to query after reindex: ${after.error?.message}`);
      const afterCount = Array.isArray(after.data) ? after.data.length : 0;
      assert(afterCount === beforeCount, `Reindex should not duplicate rows. before=${beforeCount}, after=${afterCount}`);

      return {
        before_count: beforeCount,
        after_count: afterCount,
        skipped: response.json?.skipped ?? null,
        reason: response.json?.reason ?? null
      };
    });

    await withCheck(report, "delete_document_embeddings", async () => {
      const response = await requestJson(`${apiBaseUrl}/rag/index-document`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-api-token": apiSecret
        },
        body: JSON.stringify({
          org_id: orgActiveId,
          source_id: sourceIdMeta
        })
      });
      assert(response.ok, `Delete failed: HTTP ${response.status} ${response.text}`);

      const { data, error } = await admin
        .from("org_rag_embeddings")
        .select("id")
        .eq("org_id", orgActiveId)
        .eq("source_type", "local_doc")
        .eq("source_id", sourceIdMeta);
      assert(!error, `Failed to query deleted rows: ${error?.message}`);
      const rows = Array.isArray(data) ? data : [];
      assert(rows.length === 0, `Expected 0 rows after delete, got ${rows.length}`);
      return {
        deleted: true
      };
    });

    await withCheck(report, "retriever_local_doc_rpc", async () => {
      const queryText = "교육 프로그램 현장 보고서 봉사자 참여율과 학습 성과";
      const embedding = await createEmbedding({
        apiKey: openAiApiKey,
        model: ragEmbeddingModel,
        dimensions: ragEmbeddingDimensions,
        input: queryText
      });

      const rpc = await admin.rpc("match_rag_embeddings", {
        query_embedding: embedding,
        query_org_id: orgActiveId,
        query_embedding_model: ragEmbeddingModel,
        query_embedding_dim: ragEmbeddingDimensions,
        query_source_types: ["local_doc"],
        query_metadata_filter: { activity_folder: activityFolder },
        match_threshold: 0.2,
        match_count: 5
      });
      assert(!rpc.error, `Retriever RPC failed: ${rpc.error?.message}`);
      const rows = Array.isArray(rpc.data) ? rpc.data : [];
      assert(rows.length > 0, "Retriever RPC returned no local_doc rows.");
      assert(rows.some((row) => row.source_id === sourceIdText), "Retriever RPC missing text source_id.");
      return {
        result_count: rows.length
      };
    });

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

    await stopProcessTree(apiServer?.child);
    if (apiServer) {
      report.artifacts.api_log_tail = tailLines(apiServer.getLogs());
    }

    report.artifacts.cleanup_errors = cleanupErrors;
    report.finished_at = nowIso();
    const written = writeReport(report);
    report.artifacts.report_paths = written;

    console.log(`Phase 2-4 smoke report written: ${written.latest}`);
    console.log(`Phase 2-4 smoke report (timestamped): ${written.timestamped}`);
    console.log(`Phase 2-4 smoke success: ${report.success}`);
  }

  if (!report.success) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Phase 2-4 smoke runner crashed:", error);
  process.exit(1);
});
