import { useCallback, useEffect, useState } from "react";
import type { Content } from "@repo/types";

export const usePendingApprovals = (pendingContents: Content[]) => {
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    setContentEdits((previous) => {
      const next: Record<string, string> = {};
      for (const content of pendingContents) {
        const existing = previous[content.id];
        next[content.id] = typeof existing === "string" ? existing : content.body ?? "";
      }
      return next;
    });
  }, [pendingContents]);

  const updateContentEdit = useCallback((contentId: string, nextBody: string) => {
    setContentEdits((previous) => ({
      ...previous,
      [contentId]: nextBody
    }));
  }, []);

  const removeContentEdit = useCallback((contentId: string) => {
    setContentEdits((previous) => {
      const next = { ...previous };
      delete next[contentId];
      return next;
    });
  }, []);

  return {
    contentEdits,
    updateContentEdit,
    removeContentEdit
  };
};

