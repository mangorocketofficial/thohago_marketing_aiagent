import {
  createOpenAiEmbedder,
  createRagRetriever,
  createRagStore,
  createVoyageEmbedder,
  resolveEmbeddingProfile,
  type Embedder,
  type RagEmbeddingProfile
} from "@repo/rag";
import { env } from "./env";
import { supabaseAdmin } from "./supabase-admin";

const defaultEmbeddingProfile: RagEmbeddingProfile = resolveEmbeddingProfile({
  model: env.ragEmbeddingModel,
  dimensions: env.ragEmbeddingDimensions
});

let cachedEmbedder: Embedder | null = null;

export const ragConfig = {
  provider: env.ragEmbeddingProvider,
  defaultEmbeddingProfile,
  allowedEmbeddingDimensions: env.ragAllowedEmbeddingDimensions
} as const;

export const ragStore = createRagStore(supabaseAdmin);
export const ragRetriever = createRagRetriever(supabaseAdmin);

export const getRagEmbedder = (): Embedder => {
  if (cachedEmbedder) {
    return cachedEmbedder;
  }

  if (env.ragEmbeddingProvider === "voyage") {
    cachedEmbedder = createVoyageEmbedder();
    return cachedEmbedder;
  }

  if (!env.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required when RAG_EMBEDDING_PROVIDER=openai.");
  }

  cachedEmbedder = createOpenAiEmbedder({
    apiKey: env.openAiApiKey,
    defaultProfile: defaultEmbeddingProfile
  });
  return cachedEmbedder;
};
