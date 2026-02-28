import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");
const { app, safeStorage } = electron;

const AUTH_SESSION_FILENAME = "desktop-auth-session.bin";

const getAuthSessionPath = () => path.join(app.getPath("userData"), AUTH_SESSION_FILENAME);

const toPlainPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload;
  const accessToken = typeof row.accessToken === "string" ? row.accessToken.trim() : "";
  const refreshToken = typeof row.refreshToken === "string" ? row.refreshToken.trim() : "";
  const expiresAt = typeof row.expiresAt === "number" && Number.isFinite(row.expiresAt) ? row.expiresAt : null;
  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt
  };
};

export const loadAuthSession = () => {
  const sessionPath = getAuthSessionPath();
  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const encrypted = fs.readFileSync(sessionPath);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted);
    return toPlainPayload(parsed);
  } catch {
    return null;
  }
};

export const saveAuthSession = (payload) => {
  const normalized = toPlainPayload(payload);
  if (!normalized) {
    throw new Error("Invalid auth session payload.");
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption is not available. Cannot persist auth session securely.");
  }

  const sessionPath = getAuthSessionPath();
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const serialized = JSON.stringify(normalized);
  const encrypted = safeStorage.encryptString(serialized);
  fs.writeFileSync(sessionPath, encrypted);
  return normalized;
};

export const clearAuthSession = () => {
  const sessionPath = getAuthSessionPath();
  if (!fs.existsSync(sessionPath)) {
    return;
  }
  fs.unlinkSync(sessionPath);
};
