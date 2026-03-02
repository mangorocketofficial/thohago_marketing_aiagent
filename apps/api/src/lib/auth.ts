import type { Request, Response } from "express";
import { env } from "./env";
import { supabaseAdmin } from "./supabase-admin";

const getToken = (req: Request): string =>
  (req.header("x-api-token") ?? req.header("x-trigger-token") ?? "").trim();

export const hasValidApiSecret = (req: Request): boolean => {
  const token = getToken(req);
  return !!token && token === env.apiSecret;
};

const getBearerToken = (req: Request): string => {
  const value = (req.header("authorization") ?? "").trim();
  if (!value) {
    return "";
  }

  const [scheme, token] = value.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return "";
  }

  return token.trim();
};

export type AuthenticatedUserContext = {
  userId: string;
  email: string | null;
  name: string | null;
};

export const requireApiSecret = (req: Request, res: Response): boolean => {
  if (!hasValidApiSecret(req)) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Valid API token is required."
    });
    return false;
  }

  return true;
};

export const requireUserJwt = async (
  req: Request,
  res: Response
): Promise<AuthenticatedUserContext | null> => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Bearer token is required."
    });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Invalid or expired user token."
    });
    return null;
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    name:
      typeof data.user.user_metadata?.name === "string"
        ? data.user.user_metadata.name
        : typeof data.user.user_metadata?.full_name === "string"
          ? data.user.user_metadata.full_name
          : null
  };
};
