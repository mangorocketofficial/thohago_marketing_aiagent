import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env"));
loadEnvFile(path.join(cwd, ".env.local"));

const required = (name) => {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!/^https?:\/\//i.test(url)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must start with http:// or https://");
}
const testUserToken = process.env.RLS_TEST_USER_TOKEN;
const otherOrgId = process.env.RLS_OTHER_ORG_ID;
const seedOrgId = process.env.SEED_ORG_ID;

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const run = async () => {
  const result = [];

  const anonOrgQuery = await anon.from("organizations").select("id");
  result.push({
    name: "anon cannot read organizations",
    pass: !anonOrgQuery.data || anonOrgQuery.data.length === 0,
    detail: anonOrgQuery.error?.message ?? `rows=${anonOrgQuery.data?.length ?? 0}`,
  });

  if (!testUserToken) {
    result.push({
      name: "authenticated tests",
      pass: false,
      detail: "RLS_TEST_USER_TOKEN not set",
    });
  } else {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${testUserToken}` } },
    });

    if (seedOrgId) {
      const ownOrgQuery = await userClient
        .from("organizations")
        .select("id")
        .eq("id", seedOrgId);

      result.push({
        name: "member can read own org",
        pass: !ownOrgQuery.error && (ownOrgQuery.data?.length ?? 0) === 1,
        detail: ownOrgQuery.error?.message ?? `rows=${ownOrgQuery.data?.length ?? 0}`,
      });
    }

    if (otherOrgId) {
      const forbiddenInsert = await userClient.from("contents").insert({
        org_id: otherOrgId,
        channel: "instagram",
        content_type: "text",
        status: "draft",
        body: "rls probe",
        metadata: {},
        created_by: "user",
      });

      result.push({
        name: "member cannot insert other org content",
        pass: !!forbiddenInsert.error,
        detail: forbiddenInsert.error?.message ?? "insert succeeded unexpectedly",
      });
    }
  }

  let failed = false;
  for (const item of result) {
    const state = item.pass ? "PASS" : "FAIL";
    if (!item.pass) failed = true;
    console.log(`${state} - ${item.name} (${item.detail})`);
  }

  if (failed) process.exit(1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
