import type { RagEmbeddingProfile } from "@repo/types";
import {
  assertEmbeddingVectorDimension,
  DEFAULT_EMBEDDING_PROFILE,
  resolveEmbeddingProfile,
  sanitizeEmbeddingInputText,
  type Embedder
} from "./embedder";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;

type OpenAiEmbedderConfig = {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  batchSize?: number;
  defaultProfile?: RagEmbeddingProfile;
};

type OpenAiEmbeddingsResponse = {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  error?: {
    message?: string;
  };
};

const chunkItems = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const normalizeBatchSize = (value?: number): number => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }
  const next = Math.floor(value);
  if (next < 1) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(next, DEFAULT_BATCH_SIZE);
};

const normalizeTimeoutMs = (value?: number): number => {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const next = Math.floor(value);
  if (next < 1000) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return next;
};

const asNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    throw new Error("Embedding response is not an array.");
  }

  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error("Embedding contains a non-numeric value.");
    }
    return entry;
  });
};

export class OpenAiEmbedder implements Embedder {
  private readonly apiKey: string;

  private readonly endpoint: string;

  private readonly timeoutMs: number;

  private readonly batchSize: number;

  private readonly defaultProfile: RagEmbeddingProfile;

  constructor(config: OpenAiEmbedderConfig) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) {
      throw new Error("OpenAI apiKey is required for OpenAiEmbedder.");
    }

    this.apiKey = apiKey;
    this.endpoint = (config.endpoint ?? OPENAI_EMBEDDINGS_URL).trim() || OPENAI_EMBEDDINGS_URL;
    this.timeoutMs = normalizeTimeoutMs(config.timeoutMs);
    this.batchSize = normalizeBatchSize(config.batchSize);
    this.defaultProfile = resolveEmbeddingProfile(config.defaultProfile, DEFAULT_EMBEDDING_PROFILE);
  }

  async generateEmbedding(text: string, profile: RagEmbeddingProfile = this.defaultProfile): Promise<number[]> {
    const [embedding] = await this.generateEmbeddings([text], profile);
    if (!embedding) {
      throw new Error("Embedding generation returned no vectors.");
    }
    return embedding;
  }

  async generateEmbeddings(texts: string[], profile: RagEmbeddingProfile = this.defaultProfile): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const resolvedProfile = resolveEmbeddingProfile(profile, this.defaultProfile);
    const sanitized = texts.map((value, index) => sanitizeEmbeddingInputText(value, index));

    const chunks = chunkItems(sanitized, this.batchSize);
    const outputs: number[][] = [];

    for (const chunk of chunks) {
      const vectors = await this.requestBatch(chunk, resolvedProfile);
      outputs.push(...vectors);
    }

    return outputs;
  }

  private async requestBatch(inputs: string[], profile: RagEmbeddingProfile): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: profile.model,
          input: inputs,
          dimensions: profile.dimensions
        }),
        signal: controller.signal
      });

      const body = (await response.json().catch(() => ({}))) as OpenAiEmbeddingsResponse;
      if (!response.ok) {
        const reason = typeof body.error?.message === "string" ? body.error.message : `status ${response.status}`;
        throw new Error(`OpenAI embedding request failed: ${reason}`);
      }

      const rows = Array.isArray(body.data) ? body.data : [];
      if (rows.length !== inputs.length) {
        throw new Error(`OpenAI embedding count mismatch. Expected ${inputs.length}, got ${rows.length}.`);
      }

      const sorted = rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return sorted.map((row) => {
        const vector = asNumberArray(row.embedding);
        assertEmbeddingVectorDimension(vector, profile.dimensions);
        return vector;
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenAI embedding request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createOpenAiEmbedder = (config: OpenAiEmbedderConfig): Embedder => new OpenAiEmbedder(config);
