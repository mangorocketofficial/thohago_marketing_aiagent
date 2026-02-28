import type { Request, Response } from "express";
import { env } from "./env";

let warnedNoApiSecret = false;

const getToken = (req: Request): string =>
  (req.header("x-api-token") ?? req.header("x-trigger-token") ?? "").trim();

export const requireApiSecret = (req: Request, res: Response): boolean => {
  if (!env.apiSecret) {
    if (!warnedNoApiSecret) {
      warnedNoApiSecret = true;
      console.warn("[API] API_SECRET is not set. Route auth is disabled.");
    }
    return true;
  }

  const token = getToken(req);
  if (!token || token !== env.apiSecret) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Valid API token is required."
    });
    return false;
  }

  return true;
};

