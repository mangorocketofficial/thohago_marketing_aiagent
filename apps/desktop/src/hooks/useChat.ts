import { useCallback, useMemo, useState } from "react";
import type { Campaign } from "@repo/types";

export const useChat = (draftCampaigns: Campaign[]) => {
  const [chatInput, setChatInput] = useState("");

  const campaignToReview = useMemo(() => draftCampaigns[0] ?? null, [draftCampaigns]);

  const clearChatInput = useCallback(() => {
    setChatInput("");
  }, []);

  return {
    chatInput,
    setChatInput,
    clearChatInput,
    campaignToReview
  };
};

