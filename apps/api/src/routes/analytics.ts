import type { Response } from "express";
import { Router } from "express";
import { maybeEnqueueAnalysisRun } from "../analytics/run-queue";
import { getAnalysisReportById, getLatestAnalysisReport } from "../analytics/report-repository";
import { requireApiSecret } from "../lib/auth";
import { toHttpError } from "../lib/errors";
import { parseRequiredString } from "../lib/request-parsers";
import { requireActiveSubscription } from "../lib/subscription";

export const analyticsRouter: Router = Router();

const sendAnalyticsError = (res: Response, error: unknown): void => {
  const httpError = toHttpError(error);
  res.status(httpError.status).json({
    ok: false,
    error: httpError.code,
    message: httpError.message,
    ...(httpError.details ? { details: httpError.details } : {})
  });
};

analyticsRouter.post("/orgs/:orgId/analytics/trigger-analysis", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    if (!(await requireActiveSubscription(res, orgId))) {
      return;
    }

    const result = await maybeEnqueueAnalysisRun(orgId, "manual");
    res.json({
      ok: true,
      queued: result.queued,
      run: result.run,
      message: result.message,
      reason: result.reason
    });
  } catch (error) {
    sendAnalyticsError(res, error);
  }
});

analyticsRouter.get("/orgs/:orgId/analytics/reports/latest", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const report = await getLatestAnalysisReport(orgId);
    res.json({
      ok: true,
      report
    });
  } catch (error) {
    sendAnalyticsError(res, error);
  }
});

analyticsRouter.get("/orgs/:orgId/analytics/reports/:reportId", async (req, res) => {
  if (!requireApiSecret(req, res)) {
    return;
  }

  try {
    const orgId = parseRequiredString(req.params.orgId, "orgId");
    const reportId = parseRequiredString(req.params.reportId, "reportId");
    const report = await getAnalysisReportById(orgId, reportId);
    res.json({
      ok: true,
      report
    });
  } catch (error) {
    sendAnalyticsError(res, error);
  }
});
