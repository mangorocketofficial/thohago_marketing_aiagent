import type { RagEmbeddingDim, RagEmbeddingModel, RagEmbeddingProfile } from "@repo/types";

export type Embedder = {
  generateEmbedding(text: string, profile?: RagEmbeddingProfile): Promise<number[]>;
  generateEmbeddings(texts: string[], profile?: RagEmbeddingProfile): Promise<number[][]>;
};

export type EmbedderProvider = "openai" | "voyage";

export const DEFAULT_EMBEDDING_PROFILE: RagEmbeddingProfile = {
  model: "text-embedding-3-small",
  dimensions: 1536
};

export const SEARCH_EMBEDDING_PROFILES = {
  default: {
    model: "text-embedding-3-small",
    dimensions: 1536
  },
  balanced: {
    model: "text-embedding-3-small",
    dimensions: 768
  },
  fast: {
    model: "text-embedding-3-small",
    dimensions: 512
  }
} as const satisfies Record<string, RagEmbeddingProfile>;

export const STORAGE_EMBEDDING_DIM: RagEmbeddingDim = 1536;

const ALLOWED_EMBEDDING_DIMS = new Set<number>([512, 768, 1536]);
const ALLOWED_EMBEDDING_MODELS = new Set<string>(["text-embedding-3-small", "text-embedding-3-large"]);

export const isRagEmbeddingDim = (value: number): value is RagEmbeddingDim => ALLOWED_EMBEDDING_DIMS.has(value);

export const isRagEmbeddingModel = (value: string): value is RagEmbeddingModel =>
  ALLOWED_EMBEDDING_MODELS.has(value);

export const resolveEmbeddingProfile = (
  profile?: Partial<RagEmbeddingProfile>,
  fallback: RagEmbeddingProfile = DEFAULT_EMBEDDING_PROFILE
): RagEmbeddingProfile => {
  const model = profile?.model ?? fallback.model;
  const dimensions = profile?.dimensions ?? fallback.dimensions;

  if (!isRagEmbeddingModel(model)) {
    throw new Error(`Unsupported embedding model: ${model}`);
  }

  if (!isRagEmbeddingDim(dimensions)) {
    throw new Error(`Unsupported embedding dimensions: ${dimensions}`);
  }

  return {
    model,
    dimensions
  };
};

export const assertEmbeddingVectorDimension = (embedding: number[], expected: RagEmbeddingDim): void => {
  if (embedding.length !== expected) {
    throw new Error(`Embedding dimension mismatch. Expected ${expected}, got ${embedding.length}.`);
  }
};

export const toStorageEmbedding = (embedding: number[], profileDim: RagEmbeddingDim): number[] => {
  assertEmbeddingVectorDimension(embedding, profileDim);

  if (profileDim === STORAGE_EMBEDDING_DIM) {
    return embedding;
  }

  const output = new Array<number>(STORAGE_EMBEDDING_DIM).fill(0);
  for (let index = 0; index < profileDim; index += 1) {
    output[index] = embedding[index] ?? 0;
  }
  return output;
};

export const sanitizeEmbeddingInputText = (value: string, index: number): string => {
  if (typeof value !== "string") {
    throw new Error(`Embedding input at index ${index} must be a string.`);
  }

  const next = value.trim();
  if (!next) {
    throw new Error(`Embedding input at index ${index} is empty.`);
  }

  return next;
};
