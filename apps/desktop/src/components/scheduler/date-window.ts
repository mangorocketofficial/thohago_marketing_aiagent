export type SchedulerViewMode = "week" | "month" | "list";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fromDateKey = (dateKey: string): Date | null => {
  if (!ISO_DATE_RE.test(dateKey)) {
    return null;
  }
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
    return null;
  }
  return parsed;
};

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const startOfWeekMonday = (date: Date): Date => {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
};

const startOfMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const endOfMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

const datePartsInTimezone = (timeZone: string, base: Date): { year: number; month: number; day: number } => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(base);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0")
  };
};

export const resolveLocalTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const todayDateKeyInTimezone = (timeZone: string): string => {
  const parts = datePartsInTimezone(timeZone, new Date());
  return toDateKey(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
};

export const normalizeDateKey = (candidate: string | null | undefined, fallbackDateKey: string): string => {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return fallbackDateKey;
  }
  const parsed = fromDateKey(candidate.trim());
  return parsed ? toDateKey(parsed) : fallbackDateKey;
};

export const buildDateWindow = (params: { viewMode: SchedulerViewMode; currentDateKey: string }): {
  startDate: string;
  endDate: string;
} => {
  const anchor = fromDateKey(params.currentDateKey);
  if (!anchor) {
    return {
      startDate: params.currentDateKey,
      endDate: params.currentDateKey
    };
  }

  if (params.viewMode === "week") {
    const start = startOfWeekMonday(anchor);
    const end = addDays(start, 6);
    return {
      startDate: toDateKey(start),
      endDate: toDateKey(end)
    };
  }

  if (params.viewMode === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return {
      startDate: toDateKey(start),
      endDate: toDateKey(end)
    };
  }

  return {
    startDate: toDateKey(anchor),
    endDate: toDateKey(addDays(anchor, 30))
  };
};

export const shiftCurrentDateKey = (params: {
  viewMode: SchedulerViewMode;
  currentDateKey: string;
  direction: "prev" | "next";
}): string => {
  const anchor = fromDateKey(params.currentDateKey);
  if (!anchor) {
    return params.currentDateKey;
  }
  const multiplier = params.direction === "next" ? 1 : -1;
  if (params.viewMode === "month") {
    const shifted = startOfMonth(anchor);
    shifted.setUTCMonth(shifted.getUTCMonth() + multiplier);
    return toDateKey(shifted);
  }

  const days = params.viewMode === "week" ? 7 : 30;
  return toDateKey(addDays(anchor, multiplier * days));
};
