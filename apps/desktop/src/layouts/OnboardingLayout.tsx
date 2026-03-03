import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import type {
  InterviewAnswers,
  OnboardingCrawlSourceResult,
  OnboardingCrawlStatus,
  OrgEntitlement
} from "@repo/types";

type Runtime = Window["desktopRuntime"];
type WatcherStatus = Awaited<ReturnType<Runtime["watcher"]["getStatus"]>>;
type RendererFileEntry = Awaited<ReturnType<Runtime["watcher"]["getFiles"]>>[number];
type DesktopAppConfig = Awaited<ReturnType<Runtime["app"]["getConfig"]>>;
type OnboardingDraft = DesktopAppConfig["onboardingDraft"];
export type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type AuthMode = "sign_in" | "sign_up";
type OnboardingSynthesisResult = Awaited<ReturnType<Runtime["onboarding"]["synthesize"]>>;
type EntitlementResponse = Awaited<ReturnType<Runtime["billing"]["getEntitlement"]>>;

const ONBOARDING_STEPS: OnboardingStep[] = [0, 1, 2, 3, 4, 5, 6, 7];
const FALLBACK_ENTITLEMENT: OrgEntitlement = {
  org_id: "",
  status: "past_due",
  is_entitled: false,
  trial_ends_at: null,
  current_period_end: null
};

export const resolveOnboardingEntryStep = (watchPath: string | null | undefined): OnboardingStep =>
  String(watchPath ?? "").trim() ? 1 : 0;

const defaultOnboardingDraft = (): OnboardingDraft => ({
  websiteUrl: "",
  naverBlogUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  youtubeUrl: "",
  threadsUrl: ""
});

const defaultInterviewAnswers = (): InterviewAnswers => ({
  q1: "",
  q2: "",
  q3: "",
  q4: ""
});

const defaultOnboardingCrawlStatus = (): OnboardingCrawlStatus => ({
  state: "idle",
  started_at: null,
  finished_at: null,
  sources: {
    website: {
      source: "website",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    },
    naver_blog: {
      source: "naver_blog",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    },
    instagram: {
      source: "instagram",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    }
  }
});

const isCrawlSourceComplete = (source: OnboardingCrawlSourceResult): boolean =>
  source.status === "done" || source.status === "partial" || source.status === "failed" || source.status === "skipped";

const isCrawlFullyComplete = (status: OnboardingCrawlStatus): boolean =>
  isCrawlSourceComplete(status.sources.website) &&
  isCrawlSourceComplete(status.sources.naver_blog) &&
  isCrawlSourceComplete(status.sources.instagram);

const formatCrawlStatusLabel = (status: OnboardingCrawlSourceResult["status"]): string => {
  if (status === "pending") {
    return "Pending";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "done") {
    return "Done";
  }
  if (status === "partial") {
    return "Partial";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "skipped") {
    return "Skipped";
  }
  return status;
};

const isValidHttpUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

type OnboardingLayoutProps = {
  runtime: Runtime;
  authSupabase: SupabaseClient | null;
  authSession: Session | null;
  desktopConfig: DesktopAppConfig | null;
  selectedPath: string;
  entryStep: OnboardingStep;
  entryVersion: number;
  language: string;
  formatDateTime: (iso: string | null | undefined) => string;
  onLanguageChange: (language: "ko" | "en") => Promise<void>;
  onDesktopConfigChange: (config: DesktopAppConfig) => void;
  onSelectedPathChange: (path: string) => void;
  onSignOut: () => Promise<void>;
  onComplete: (payload: {
    status: WatcherStatus;
    config: DesktopAppConfig;
    files: RendererFileEntry[];
    notice: string;
  }) => void;
};

export const OnboardingLayout = ({
  runtime,
  authSupabase,
  authSession,
  desktopConfig,
  selectedPath,
  entryStep,
  entryVersion,
  language,
  formatDateTime,
  onLanguageChange,
  onDesktopConfigChange,
  onSelectedPathChange,
  onSignOut,
  onComplete
}: OnboardingLayoutProps) => {
  const { t } = useTranslation();

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(entryStep);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft>(
    desktopConfig?.onboardingDraft ?? defaultOnboardingDraft()
  );
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: ""
  });
  const [authNotice, setAuthNotice] = useState("");
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [interviewAnswers, setInterviewAnswers] = useState(defaultInterviewAnswers());
  const [crawlStatus, setCrawlStatus] = useState<OnboardingCrawlStatus>(defaultOnboardingCrawlStatus());
  const [isCrawlPending, setIsCrawlPending] = useState(false);
  const [isInterviewSaving, setIsInterviewSaving] = useState(false);
  const [isSynthesisPending, setIsSynthesisPending] = useState(false);
  const [synthesisResult, setSynthesisResult] = useState<OnboardingSynthesisResult | null>(null);
  const [hasSynthesisAttempted, setHasSynthesisAttempted] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementResponse | null>(null);
  const [isEntitlementPending, setIsEntitlementPending] = useState(false);
  const [notice, setNotice] = useState("");

  const crawlDone = useMemo(() => isCrawlFullyComplete(crawlStatus), [crawlStatus]);
  const reviewMarkdown = useMemo(() => {
    if (!synthesisResult?.ok) {
      return "";
    }
    const direct = typeof synthesisResult.review_markdown === "string" ? synthesisResult.review_markdown.trim() : "";
    if (direct) {
      return direct;
    }
    const nested =
      typeof synthesisResult.onboarding_result_document?.review_markdown === "string"
        ? synthesisResult.onboarding_result_document.review_markdown.trim()
        : "";
    return nested;
  }, [synthesisResult]);
  const reviewExportPath = useMemo(() => {
    if (!synthesisResult?.ok) {
      return "";
    }
    return typeof synthesisResult.review_export_path === "string" ? synthesisResult.review_export_path.trim() : "";
  }, [synthesisResult]);
  const isEntitled = entitlement?.is_entitled === true;
  const entitlementStatus = entitlement?.status ?? FALLBACK_ENTITLEMENT.status;

  useEffect(() => {
    setOnboardingStep(entryStep);
    setNotice("");
    setAuthNotice("");
  }, [entryStep, entryVersion]);

  useEffect(() => {
    if (!desktopConfig?.onboardingDraft) {
      return;
    }
    setOnboardingDraft(desktopConfig.onboardingDraft);
  }, [desktopConfig?.onboardingDraft]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const nextCrawlStatus = await runtime.onboarding.getCrawlState();
      if (!cancelled) {
        setCrawlStatus(nextCrawlStatus ?? defaultOnboardingCrawlStatus());
      }

      const lastSynthesis = await runtime.onboarding.getLastSynthesis();
      if (!cancelled) {
        setSynthesisResult(lastSynthesis?.ok ? lastSynthesis : null);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [runtime, entryVersion]);

  useEffect(() => {
    const offCrawlProgress = runtime.onboarding.onCrawlProgress((payload) => {
      if (!payload?.crawlState) {
        return;
      }
      setCrawlStatus(payload.crawlState);
    });

    const offCrawlComplete = runtime.onboarding.onCrawlComplete((payload) => {
      if (!payload?.crawlState) {
        return;
      }
      setCrawlStatus(payload.crawlState);
    });

    return () => {
      offCrawlProgress();
      offCrawlComplete();
    };
  }, [runtime]);

  const persistDraftPatch = useCallback(
    async (patch: Partial<OnboardingDraft>) => {
      const nextConfig = await runtime.onboarding.saveDraft(patch);
      onDesktopConfigChange(nextConfig);
      setOnboardingDraft(nextConfig.onboardingDraft);
    },
    [onDesktopConfigChange, runtime]
  );

  const setDraftValue = useCallback(
    async (field: keyof OnboardingDraft, value: string) => {
      const next = {
        ...onboardingDraft,
        [field]: value
      };
      setOnboardingDraft(next);
      await persistDraftPatch({
        [field]: value
      });
    },
    [onboardingDraft, persistDraftPatch]
  );

  const bootstrapOrgContext = useCallback(
    async (accessToken: string): Promise<string> => {
      const body = await runtime.onboarding.bootstrapOrg({
        accessToken,
        name: authForm.name || undefined,
        orgName: authForm.name || undefined
      });
      if (!body?.ok || !body.org?.id) {
        throw new Error("Bootstrap org failed.");
      }

      const orgId = body.org.id.trim();
      if (!orgId) {
        throw new Error("Bootstrap org failed: org_id is missing.");
      }

      const nextConfig = await runtime.onboarding.setOrgId(orgId);
      onDesktopConfigChange(nextConfig);
      onSelectedPathChange(nextConfig.watchPath ?? "");

      if (body.entitlement) {
        setEntitlement({
          ok: true,
          ...body.entitlement
        });
      }

      return orgId;
    },
    [authForm.name, onDesktopConfigChange, onSelectedPathChange, runtime]
  );

  const resolveOnboardingAccessToken = useCallback(async (): Promise<string> => {
    const direct = authSession?.access_token?.trim() ?? "";
    if (direct) {
      return direct;
    }
    const stored = await runtime.auth.getStoredSession();
    return stored?.accessToken?.trim() ?? "";
  }, [authSession?.access_token, runtime.auth]);

  const refreshEntitlement = useCallback(
    async (options?: {
      accessToken?: string;
      orgId?: string;
      silent?: boolean;
      useRefreshApi?: boolean;
    }): Promise<EntitlementResponse | null> => {
      const orgId = (options?.orgId ?? desktopConfig?.orgId ?? "").trim();
      if (!orgId) {
        if (!options?.silent) {
          setNotice("Organization context is missing.");
        }
        return null;
      }

      const accessToken = (options?.accessToken ?? "").trim() || (await resolveOnboardingAccessToken());
      if (!accessToken) {
        if (!options?.silent) {
          setNotice("Sign in session is missing. Please sign in again.");
        }
        return null;
      }

      setIsEntitlementPending(true);
      try {
        const response = options?.useRefreshApi
          ? await runtime.billing.refreshEntitlement({
              accessToken,
              orgId
            })
          : await runtime.billing.getEntitlement({
              accessToken,
              orgId
            });
        setEntitlement(response);
        return response;
      } catch (error) {
        if (!options?.silent) {
          setNotice(error instanceof Error ? error.message : "Failed to load subscription status.");
        }
        return null;
      } finally {
        setIsEntitlementPending(false);
      }
    },
    [desktopConfig?.orgId, resolveOnboardingAccessToken, runtime]
  );

  const ensureActiveEntitlement = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      if (entitlement?.is_entitled) {
        return true;
      }

      const refreshed = await refreshEntitlement({
        silent: options?.silent ?? false,
        useRefreshApi: true
      });
      if (refreshed?.is_entitled) {
        return true;
      }

      if (!options?.silent) {
        setNotice("Active subscription is required. Please complete checkout and refresh entitlement.");
      }
      return false;
    },
    [entitlement?.is_entitled, refreshEntitlement]
  );

  const startOnboardingCrawl = useCallback(
    async (forceRestart = false) => {
      const entitled = await ensureActiveEntitlement();
      if (!entitled) {
        return;
      }
      if (!forceRestart && (crawlStatus.state === "running" || crawlStatus.started_at)) {
        return;
      }

      setIsCrawlPending(true);
      setNotice("");
      setSynthesisResult(null);
      setHasSynthesisAttempted(false);
      try {
        const nextStatus = await runtime.onboarding.startCrawl({
          urls: {
            websiteUrl: onboardingDraft.websiteUrl,
            naverBlogUrl: onboardingDraft.naverBlogUrl,
            instagramUrl: onboardingDraft.instagramUrl
          }
        });
        setCrawlStatus(nextStatus);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Failed to start brand review crawl.");
      } finally {
        setIsCrawlPending(false);
      }
    },
    [
      crawlStatus.started_at,
      crawlStatus.state,
      ensureActiveEntitlement,
      onboardingDraft.instagramUrl,
      onboardingDraft.naverBlogUrl,
      onboardingDraft.websiteUrl,
      runtime
    ]
  );

  const persistInterviewAnswers = useCallback(
    async (answers: InterviewAnswers, options?: { silent?: boolean }) => {
      const orgId = desktopConfig?.orgId?.trim() ?? "";
      if (!orgId) {
        if (!options?.silent) {
          setNotice("Organization context is missing.");
        }
        return false;
      }

      const accessToken = await resolveOnboardingAccessToken();
      if (!accessToken) {
        if (!options?.silent) {
          setNotice("Sign in session is missing. Please sign in again.");
        }
        return false;
      }
      const entitled = await ensureActiveEntitlement({
        silent: options?.silent ?? false
      });
      if (!entitled) {
        return false;
      }

      setIsInterviewSaving(true);
      try {
        await runtime.onboarding.saveInterview({
          accessToken,
          orgId,
          interviewAnswers: answers
        });
        if (!options?.silent) {
          setNotice("Interview answers saved.");
        }
        return true;
      } catch (error) {
        if (!options?.silent) {
          setNotice(error instanceof Error ? error.message : "Failed to save interview answers.");
        }
        return false;
      } finally {
        setIsInterviewSaving(false);
      }
    },
    [desktopConfig?.orgId, ensureActiveEntitlement, resolveOnboardingAccessToken, runtime]
  );

  const synthesizeOnboardingResult = useCallback(async () => {
    const orgId = desktopConfig?.orgId?.trim() ?? "";
    if (!orgId) {
      setNotice("Organization context is missing.");
      return;
    }

    const accessToken = await resolveOnboardingAccessToken();
    if (!accessToken) {
      setNotice("Sign in session is missing. Please sign in again.");
      return;
    }
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    setIsSynthesisPending(true);
    setHasSynthesisAttempted(true);
    setNotice("");
    try {
      const response = await runtime.onboarding.synthesize({
        accessToken,
        orgId,
        synthesisMode: "phase_1_7b",
        interviewAnswers,
        urlMetadata: {
          website_url: onboardingDraft.websiteUrl,
          naver_blog_url: onboardingDraft.naverBlogUrl,
          instagram_url: onboardingDraft.instagramUrl,
          facebook_url: onboardingDraft.facebookUrl,
          youtube_url: onboardingDraft.youtubeUrl,
          threads_url: onboardingDraft.threadsUrl
        }
      });
      if (!response?.ok) {
        throw new Error("Result synthesis failed.");
      }

      setSynthesisResult(response);
      setNotice(
        response.review_export_path
          ? `Result document generated. Exported to: ${response.review_export_path}`
          : "Result document generated."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to generate result document.");
    } finally {
      setIsSynthesisPending(false);
    }
  }, [
    desktopConfig?.orgId,
    ensureActiveEntitlement,
    interviewAnswers,
    onboardingDraft.facebookUrl,
    onboardingDraft.instagramUrl,
    onboardingDraft.naverBlogUrl,
    onboardingDraft.threadsUrl,
    onboardingDraft.websiteUrl,
    onboardingDraft.youtubeUrl,
    resolveOnboardingAccessToken,
    runtime
  ]);

  const submitEmailAuth = async () => {
    if (!authSupabase) {
      setAuthNotice("Supabase auth config is missing.");
      return;
    }

    if (!authForm.email.trim() || !authForm.password.trim()) {
      setAuthNotice("Email and password are required.");
      return;
    }

    setIsAuthPending(true);
    setAuthNotice("");
    try {
      if (authMode === "sign_up") {
        const { error } = await authSupabase.auth.signUp({
          email: authForm.email.trim(),
          password: authForm.password,
          options: {
            data: {
              name: authForm.name.trim() || undefined
            }
          }
        });
        if (error) {
          throw error;
        }

        const { data: sessionData } = await authSupabase.auth.getSession();
        const session = sessionData.session;
        if (session) {
          const orgId = await bootstrapOrgContext(session.access_token);
          const entitlementResponse = await refreshEntitlement({
            accessToken: session.access_token,
            orgId,
            silent: true
          });
          if (!entitlementResponse) {
            throw new Error("Signup completed, but failed to load organization entitlement.");
          }
          setOnboardingStep(2);
        } else {
          setAuthNotice("Signup completed. Please verify email if confirmation is enabled, then sign in.");
        }
        return;
      }

      const { data, error } = await authSupabase.auth.signInWithPassword({
        email: authForm.email.trim(),
        password: authForm.password
      });
      if (error || !data.session) {
        throw error ?? new Error("Sign in failed.");
      }

      const orgId = await bootstrapOrgContext(data.session.access_token);
      const entitlementResponse = await refreshEntitlement({
        accessToken: data.session.access_token,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Sign-in completed, but failed to load organization entitlement.");
      }
      setOnboardingStep(2);
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!authSupabase) {
      setAuthNotice("Supabase auth config is missing.");
      return;
    }

    setIsAuthPending(true);
    setAuthNotice("Waiting for Google sign-in in your browser...");
    try {
      const secureSession = await runtime.auth.startGoogleOAuth();
      const { error } = await authSupabase.auth.setSession({
        access_token: secureSession.accessToken,
        refresh_token: secureSession.refreshToken
      });
      if (error) {
        console.warn("[Auth] Google session sync warning:", error.message);
      }

      const orgId = await bootstrapOrgContext(secureSession.accessToken);
      const entitlementResponse = await refreshEntitlement({
        accessToken: secureSession.accessToken,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Google sign-in completed, but failed to load organization entitlement.");
      }
      setOnboardingStep(2);
      setAuthNotice("Google sign-in completed.");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const continueAfterAuth = async () => {
    setIsAuthPending(true);
    setAuthNotice("");
    try {
      let accessToken = authSession?.access_token ?? "";
      if (!accessToken) {
        const stored = await runtime.auth.getStoredSession();
        accessToken = stored?.accessToken ?? "";
      }

      if (!accessToken) {
        setAuthNotice("Sign in first.");
        return;
      }

      const orgId = await bootstrapOrgContext(accessToken);
      const entitlementResponse = await refreshEntitlement({
        accessToken,
        orgId,
        silent: true
      });
      if (!entitlementResponse) {
        throw new Error("Auth is valid, but failed to load organization entitlement.");
      }
      moveToStep(2);
      setAuthNotice("");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Organization bootstrap failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const handleSignOut = async () => {
    setIsAuthPending(true);
    setAuthNotice("");
    try {
      await onSignOut();
      setEntitlement(null);
      setOnboardingStep(1);
      setAuthNotice("Signed out.");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  useEffect(() => {
    if (onboardingStep !== 1 || !authSession) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const resolvedOrgId = await bootstrapOrgContext(authSession.access_token);
        const entitlementResponse = await refreshEntitlement({
          accessToken: authSession.access_token,
          orgId: resolvedOrgId,
          silent: true
        });
        if (!entitlementResponse) {
          throw new Error("Authenticated, but failed to load organization entitlement.");
        }
        if (!cancelled) {
          setAuthNotice("");
          setOnboardingStep(2);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthNotice(error instanceof Error ? error.message : "Organization bootstrap failed.");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [authSession, bootstrapOrgContext, onboardingStep, refreshEntitlement]);

  useEffect(() => {
    if (onboardingStep < 2) {
      return;
    }
    if (isEntitlementPending) {
      return;
    }
    const orgId = (desktopConfig?.orgId ?? "").trim();
    if (!orgId) {
      return;
    }
    if (entitlement?.org_id === orgId) {
      return;
    }

    void refreshEntitlement({
      orgId,
      silent: true
    });
  }, [desktopConfig?.orgId, entitlement?.org_id, isEntitlementPending, onboardingStep, refreshEntitlement]);

  useEffect(() => {
    if (onboardingStep < 3) {
      return;
    }
    if (crawlStatus.state === "running" || crawlStatus.started_at) {
      return;
    }
    void startOnboardingCrawl(false);
  }, [crawlStatus.started_at, crawlStatus.state, onboardingStep, startOnboardingCrawl]);

  useEffect(() => {
    if (onboardingStep !== 5) {
      return;
    }
    if (!crawlDone || isSynthesisPending || synthesisResult || hasSynthesisAttempted) {
      return;
    }
    void synthesizeOnboardingResult();
  }, [crawlDone, hasSynthesisAttempted, isSynthesisPending, onboardingStep, synthesisResult, synthesizeOnboardingResult]);

  const moveToStep = (step: OnboardingStep) => {
    if (step >= 3 && !isEntitled) {
      setOnboardingStep(2);
      setNotice("Active subscription is required before continuing onboarding.");
      return;
    }
    setOnboardingStep(step);
    setNotice("");
  };

  const handleUrlsNext = async () => {
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    const urlFields: Array<keyof OnboardingDraft> = [
      "websiteUrl",
      "naverBlogUrl",
      "instagramUrl",
      "facebookUrl",
      "youtubeUrl",
      "threadsUrl"
    ];

    for (const key of urlFields) {
      const value = onboardingDraft[key].trim();
      if (value && !isValidHttpUrl(value)) {
        setNotice(`Invalid URL format: ${key}`);
        return;
      }
    }

    await persistDraftPatch(onboardingDraft);
    setCrawlStatus(defaultOnboardingCrawlStatus());
    setSynthesisResult(null);
    setHasSynthesisAttempted(false);
    moveToStep(3);
  };

  const handleInterviewNext = async () => {
    const entitled = await ensureActiveEntitlement();
    if (!entitled) {
      return;
    }

    if (!interviewAnswers.q1.trim() || !interviewAnswers.q2.trim() || !interviewAnswers.q3.trim() || !interviewAnswers.q4.trim()) {
      setNotice("Please answer all 4 questions.");
      return;
    }

    const saved = await persistInterviewAnswers(interviewAnswers);
    if (!saved) {
      return;
    }
    setHasSynthesisAttempted(false);
    setSynthesisResult(null);
    moveToStep(5);
  };

  const setInterviewValue = (key: keyof InterviewAnswers, value: string) => {
    setInterviewAnswers((prev) => ({
      ...prev,
      [key]: value
    }));
    setHasSynthesisAttempted(false);
    setSynthesisResult(null);
  };

  const handleInterviewBlur = async () => {
    await persistInterviewAnswers(interviewAnswers, { silent: true });
  };

  const refreshEntitlementStatus = async () => {
    const refreshed = await refreshEntitlement({
      useRefreshApi: true,
      silent: false
    });
    if (!refreshed) {
      return;
    }
    if (refreshed.is_entitled) {
      setNotice("Subscription is active. You can continue onboarding.");
      return;
    }
    setNotice(`Subscription status is "${refreshed.status}". Active access is still required.`);
  };

  const openCheckout = async () => {
    try {
      const result = await runtime.billing.openCheckout({
        orgId: desktopConfig?.orgId
      });
      if (!result.ok) {
        setNotice(result.message ?? "Checkout URL is not configured.");
        return;
      }
      setNotice(result.url ? `Opened checkout: ${result.url}` : "Checkout opened in your browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to open checkout.");
    }
  };

  const chooseFolder = async () => {
    const folderPath = await runtime.onboarding.chooseFolder();
    if (folderPath) {
      onSelectedPathChange(folderPath);
      setNotice("");
    }
  };

  const createFolder = async () => {
    const folderPath = await runtime.onboarding.createFolder();
    if (folderPath) {
      onSelectedPathChange(folderPath);
      setNotice("");
    }
  };

  const handleFolderNext = () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }
    moveToStep(7);
  };

  const completeOnboarding = async () => {
    if (!selectedPath) {
      setNotice("Choose or create a folder first.");
      return;
    }

    try {
      const nextStatus = await runtime.onboarding.complete({
        watchPath: selectedPath,
        orgId: desktopConfig?.orgId
      });
      const nextConfig = await runtime.app.getConfig();
      const nextFiles = await runtime.watcher.getFiles();
      onDesktopConfigChange(nextConfig);
      onSelectedPathChange(nextConfig.watchPath ?? "");
      onComplete({
        status: nextStatus,
        config: nextConfig,
        files: nextFiles,
        notice: "Watcher started successfully."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete onboarding.";
      setNotice(message);
    }
  };

  const activeStepLabel = t(`onboarding.steps.${onboardingStep}`);
  const crawlSourceRows = [
    {
      label: "Website",
      source: crawlStatus.sources.website
    },
    {
      label: "Naver Blog",
      source: crawlStatus.sources.naver_blog
    },
    {
      label: "Instagram",
      source: crawlStatus.sources.instagram
    }
  ];
  const instagramStatus = crawlStatus.sources.instagram.status;
  const showInstagramGuidance = instagramStatus === "partial" || instagramStatus === "failed";

  return (
    <main className="app-shell">
      <section className="panel onboarding-panel">
        <div className="onboarding-head">
          <p className="eyebrow">Phase 1-7b</p>
          <div className="button-row">
            <span className="meta">{t("onboarding.language")}</span>
            <button className={language === "ko" ? "primary" : ""} onClick={() => void onLanguageChange("ko")}>
              KO
            </button>
            <button className={language === "en" ? "primary" : ""} onClick={() => void onLanguageChange("en")}>
              EN
            </button>
          </div>
        </div>

        <div className="onboarding-stepper">
          {ONBOARDING_STEPS.map((step) => (
            <button
              key={step}
              className={`step-chip${step === onboardingStep ? " primary" : ""}`}
              disabled={step > onboardingStep}
              onClick={() => moveToStep(step)}
            >
              {step}. {t(`onboarding.steps.${step}`)}
            </button>
          ))}
        </div>

        <h1>{activeStepLabel}</h1>

        {onboardingStep === 0 ? (
          <>
            <p className="description" style={{ whiteSpace: "pre-line" }}>
              {t("onboarding.intro.greeting")}
              {"\n"}
              {t("onboarding.intro.intro")}
            </p>
            <p className="description">{t("onboarding.intro.promise")}</p>
            <div className="button-row">
              <button className="primary" onClick={() => moveToStep(1)}>
                {t("onboarding.intro.cta")}
              </button>
            </div>
          </>
        ) : null}

        {onboardingStep === 1 ? (
          <>
            <p className="description">{t("onboarding.auth.description")}</p>
            <div className="button-row">
              <button
                className={authMode === "sign_in" ? "primary" : ""}
                disabled={isAuthPending}
                onClick={() => setAuthMode("sign_in")}
              >
                {t("onboarding.auth.signIn")}
              </button>
              <button
                className={authMode === "sign_up" ? "primary" : ""}
                disabled={isAuthPending}
                onClick={() => setAuthMode("sign_up")}
              >
                {t("onboarding.auth.signUp")}
              </button>
            </div>
            <div className="auth-form">
              <input
                value={authForm.name}
                placeholder={t("onboarding.auth.name")}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))}
                disabled={isAuthPending}
              />
              <input
                value={authForm.email}
                placeholder={t("onboarding.auth.email")}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                disabled={isAuthPending}
              />
              <input
                type="password"
                value={authForm.password}
                placeholder={t("onboarding.auth.password")}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                disabled={isAuthPending}
              />
            </div>
            <div className="button-row">
              <button className="primary" disabled={isAuthPending} onClick={() => void submitEmailAuth()}>
                {authMode === "sign_up" ? t("onboarding.auth.signUp") : t("onboarding.auth.signIn")}
              </button>
              <button disabled={isAuthPending} onClick={() => void signInWithGoogle()}>
                {t("onboarding.auth.google")}
              </button>
              <button
                disabled={isAuthPending || !authSession}
                className="primary"
                onClick={() => void continueAfterAuth()}
              >
                {t("onboarding.auth.continue")}
              </button>
              {authSession ? (
                <button disabled={isAuthPending} onClick={() => void handleSignOut()}>
                  Sign out
                </button>
              ) : null}
            </div>
            {authSession?.user?.email ? (
              <p className="meta">
                Authenticated as <strong>{authSession.user.email}</strong>
              </p>
            ) : null}
            {authNotice ? <p className="notice">{authNotice}</p> : null}
          </>
        ) : null}

        {onboardingStep === 2 ? (
          <>
            {!isEntitled ? (
              <>
                <p className="description">
                  Active subscription is required before brand URL setup and synthesis.
                </p>
                <div className="meta-grid">
                  <p>
                    Subscription status: <strong>{entitlementStatus}</strong>
                  </p>
                  <p>
                    Trial ends: <strong>{formatDateTime(entitlement?.trial_ends_at)}</strong>
                  </p>
                  <p>
                    Period end: <strong>{formatDateTime(entitlement?.current_period_end)}</strong>
                  </p>
                  <p>
                    Org: <strong>{entitlement?.org_id || desktopConfig?.orgId || "-"}</strong>
                  </p>
                </div>
                {isEntitlementPending ? <p className="meta">Refreshing subscription status...</p> : null}
                <div className="button-row">
                  <button onClick={() => moveToStep(1)}>{t("onboarding.back")}</button>
                  <button onClick={() => void openCheckout()}>Open Checkout</button>
                  <button className="primary" disabled={isEntitlementPending} onClick={() => void refreshEntitlementStatus()}>
                    Refresh Subscription
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="description">{t("onboarding.urls.description")}</p>
                <div className="auth-form">
                  <input
                    value={onboardingDraft.websiteUrl}
                    placeholder={t("onboarding.urls.website")}
                    onChange={(event) => void setDraftValue("websiteUrl", event.target.value)}
                  />
                  <input
                    value={onboardingDraft.naverBlogUrl}
                    placeholder={t("onboarding.urls.naverBlog")}
                    onChange={(event) => void setDraftValue("naverBlogUrl", event.target.value)}
                  />
                  <input
                    value={onboardingDraft.instagramUrl}
                    placeholder={t("onboarding.urls.instagram")}
                    onChange={(event) => void setDraftValue("instagramUrl", event.target.value)}
                  />
                  <input
                    value={onboardingDraft.facebookUrl}
                    placeholder={t("onboarding.urls.facebook")}
                    onChange={(event) => void setDraftValue("facebookUrl", event.target.value)}
                  />
                  <input
                    value={onboardingDraft.youtubeUrl}
                    placeholder={t("onboarding.urls.youtube")}
                    onChange={(event) => void setDraftValue("youtubeUrl", event.target.value)}
                  />
                  <input
                    value={onboardingDraft.threadsUrl}
                    placeholder={t("onboarding.urls.threads")}
                    onChange={(event) => void setDraftValue("threadsUrl", event.target.value)}
                  />
                </div>
                <div className="button-row">
                  <button onClick={() => moveToStep(1)}>{t("onboarding.back")}</button>
                  <button className="primary" onClick={() => void handleUrlsNext()}>
                    {t("onboarding.urls.next")}
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}

        {onboardingStep === 3 ? (
          <>
            <p className="description">{t("onboarding.review.description")}</p>
            <div className="meta-grid onboarding-crawl-grid">
              <p>
                Website: <strong>{onboardingDraft.websiteUrl || "-"}</strong>
              </p>
              <p>
                Naver Blog: <strong>{onboardingDraft.naverBlogUrl || "-"}</strong>
              </p>
              <p>
                Instagram: <strong>{onboardingDraft.instagramUrl || "-"}</strong>
              </p>
              <p>
                YouTube: <strong>{onboardingDraft.youtubeUrl || "-"}</strong>
              </p>
            </div>
            <div className="crawl-status-list">
              {crawlSourceRows.map((row) => (
                <article key={row.label} className="crawl-status-item">
                  <p>
                    <strong>{row.label}</strong>
                  </p>
                  <p>
                    Status: <strong>{formatCrawlStatusLabel(row.source.status)}</strong>
                  </p>
                  <p>
                    URL: <strong>{row.source.url || "-"}</strong>
                  </p>
                  {row.source.error ? <p className="notice">{row.source.error}</p> : null}
                </article>
              ))}
            </div>
            {crawlDone ? (
              <p className="meta">Brand review crawl completed (with best-effort partial failures allowed).</p>
            ) : (
              <p className="meta">Crawl is running in the background. You can continue to interview now.</p>
            )}
            <div className="button-row">
              <button onClick={() => moveToStep(2)}>{t("onboarding.back")}</button>
              <button disabled={isCrawlPending || crawlStatus.state === "running"} onClick={() => void startOnboardingCrawl(true)}>
                Retry Crawl
              </button>
              <button className="primary" onClick={() => moveToStep(4)}>
                {t("onboarding.review.next")}
              </button>
            </div>
          </>
        ) : null}

        {onboardingStep === 4 ? (
          <>
            <p className="description">{t("onboarding.interview.description")}</p>
            {!crawlDone ? <p className="meta">Brand review crawl is still running. Keep answering interview questions.</p> : null}
            <div className="auth-form">
              <textarea
                value={interviewAnswers.q1}
                placeholder={t("onboarding.interview.q1")}
                onChange={(event) => setInterviewValue("q1", event.target.value)}
                onBlur={() => void handleInterviewBlur()}
              />
              <textarea
                value={interviewAnswers.q2}
                placeholder={t("onboarding.interview.q2")}
                onChange={(event) => setInterviewValue("q2", event.target.value)}
                onBlur={() => void handleInterviewBlur()}
              />
              <textarea
                value={interviewAnswers.q3}
                placeholder={t("onboarding.interview.q3")}
                onChange={(event) => setInterviewValue("q3", event.target.value)}
                onBlur={() => void handleInterviewBlur()}
              />
              <textarea
                value={interviewAnswers.q4}
                placeholder={t("onboarding.interview.q4")}
                onChange={(event) => setInterviewValue("q4", event.target.value)}
                onBlur={() => void handleInterviewBlur()}
              />
            </div>
            {isInterviewSaving ? <p className="meta">Saving interview answers...</p> : null}
            <div className="button-row">
              <button onClick={() => moveToStep(3)}>{t("onboarding.back")}</button>
              <button className="primary" disabled={isInterviewSaving} onClick={() => void handleInterviewNext()}>
                {t("onboarding.interview.next")}
              </button>
            </div>
          </>
        ) : null}

        {onboardingStep === 5 ? (
          <>
            <p className="description">{t("onboarding.result.description")}</p>
            {!crawlDone ? <p className="meta">Waiting for background crawl to finish before synthesis.</p> : null}
            {isSynthesisPending ? <p className="meta">Generating result document...</p> : null}
            {synthesisResult?.ok ? (
              <>
                <div className="source-coverage-row">
                  {crawlSourceRows.map((row) => (
                    <span key={`coverage-${row.label}`} className={`source-coverage-badge status-${row.source.status}`}>
                      {row.label}: {formatCrawlStatusLabel(row.source.status)}
                    </span>
                  ))}
                </div>
                {showInstagramGuidance ? (
                  <p className="meta">
                    {instagramStatus === "partial"
                      ? "Instagram crawl collected only partial public metadata. The review includes explicit data limitation notes."
                      : "Instagram crawl could not collect profile metadata. The review uses website/blog/interview evidence and records this limitation."}
                  </p>
                ) : null}
                <div className="meta-grid">
                  <p>
                    Tone: <strong>{synthesisResult.brand_profile.detected_tone || "-"}</strong>
                  </p>
                  <p>
                    Themes: <strong>{synthesisResult.brand_profile.key_themes.join(", ") || "-"}</strong>
                  </p>
                  <p>
                    Audience: <strong>{synthesisResult.brand_profile.target_audience.join(", ") || "-"}</strong>
                  </p>
                  <p>
                    Campaign Seasons: <strong>{synthesisResult.brand_profile.campaign_seasons.join(", ") || "-"}</strong>
                  </p>
                </div>
                {reviewExportPath ? (
                  <p className="meta">
                    Exported Markdown: <strong>{reviewExportPath}</strong>
                  </p>
                ) : null}
                {reviewMarkdown ? (
                  <article className="markdown-card">
                    <div className="markdown-viewer">
                      <ReactMarkdown>{reviewMarkdown}</ReactMarkdown>
                    </div>
                  </article>
                ) : (
                  <p className="meta">Markdown content is not available. Showing structured profile only.</p>
                )}
              </>
            ) : (
              <p className="empty">Result generation is automatic at this step.</p>
            )}
            <div className="button-row">
              <button onClick={() => moveToStep(4)}>{t("onboarding.back")}</button>
              <button className="primary" disabled={!synthesisResult || isSynthesisPending} onClick={() => moveToStep(6)}>
                {t("onboarding.result.next")}
              </button>
            </div>
          </>
        ) : null}

        {onboardingStep === 6 ? (
          <>
            <p className="description">{t("onboarding.folder.description")}</p>
            <div className="button-row">
              <button onClick={() => void chooseFolder()}>{t("onboarding.folder.choose")}</button>
              <button onClick={() => void createFolder()}>{t("onboarding.folder.create")}</button>
            </div>
            <p className="meta">
              {t("onboarding.folder.selected")}: <strong>{selectedPath || "-"}</strong>
            </p>
            <div className="button-row">
              <button onClick={() => moveToStep(5)}>{t("onboarding.back")}</button>
              <button className="primary" onClick={() => handleFolderNext()}>
                {t("onboarding.folder.next")}
              </button>
            </div>
          </>
        ) : null}

        {onboardingStep === 7 ? (
          <>
            <p className="description">{t("onboarding.summary.description")}</p>
            <div className="meta-grid">
              <p>
                Org: <strong>{desktopConfig?.orgId ?? "-"}</strong>
              </p>
              <p>
                Watch Folder: <strong>{selectedPath || "-"}</strong>
              </p>
              <p>
                Detected Tone: <strong>{synthesisResult?.brand_profile.detected_tone || "-"}</strong>
              </p>
              <p>
                Key Themes: <strong>{synthesisResult?.brand_profile.key_themes.join(", ") || "-"}</strong>
              </p>
            </div>
            <div className="button-row">
              <button onClick={() => moveToStep(6)}>{t("onboarding.back")}</button>
              <button className="primary" onClick={() => void completeOnboarding()}>
                {t("onboarding.summary.cta")}
              </button>
            </div>
          </>
        ) : null}

        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
};
