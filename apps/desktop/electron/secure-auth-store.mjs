import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");
const { app, safeStorage } = electron;

const AUTH_SESSION_FILENAME = "desktop-auth-session.bin";
const AUTH_SESSION_FALLBACK_FILENAME = "desktop-auth-session.fallback.json";

const getAuthSessionPath = () => path.join(app.getPath("userData"), AUTH_SESSION_FILENAME);
const getAuthSessionFallbackPath = () => path.join(app.getPath("userData"), AUTH_SESSION_FALLBACK_FILENAME);
const isInsecureFallbackAllowed = () => !app.isPackaged;

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
  if (fs.existsSync(sessionPath) && safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = fs.readFileSync(sessionPath);
      const decrypted = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted);
      return toPlainPayload(parsed);
    } catch {
      // Fall through to dev fallback if available.
    }
  }

  if (isInsecureFallbackAllowed()) {
    const fallbackPath = getAuthSessionFallbackPath();
    if (!fs.existsSync(fallbackPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(fallbackPath, "utf8");
      const parsed = JSON.parse(raw);
      return toPlainPayload(parsed);
    } catch {
      return null;
    }
  }

  return null;
};

const writePlaintextFallback = (payload) => {
  const fallbackPath = getAuthSessionFallbackPath();
  fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
  fs.writeFileSync(fallbackPath, JSON.stringify(payload), "utf8");
};

const clearPlaintextFallback = () => {
  const fallbackPath = getAuthSessionFallbackPath();
  if (!fs.existsSync(fallbackPath)) {
    return;
  }
  fs.unlinkSync(fallbackPath);
};

export const saveAuthSession = (payload) => {
  const normalized = toPlainPayload(payload);
  if (!normalized) {
    throw new Error("Invalid auth session payload.");
  }

  const sessionPath = getAuthSessionPath();
  if (safeStorage.isEncryptionAvailable()) {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    const serialized = JSON.stringify(normalized);
    const encrypted = safeStorage.encryptString(serialized);
    fs.writeFileSync(sessionPath, encrypted);
    clearPlaintextFallback();
    return normalized;
  }

  if (isInsecureFallbackAllowed()) {
    writePlaintextFallback(normalized);
    return normalized;
  }

  throw new Error("OS encryption is not available. Cannot persist auth session securely.");
};

export const clearAuthSession = () => {
  const sessionPath = getAuthSessionPath();
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
  clearPlaintextFallback();
};
