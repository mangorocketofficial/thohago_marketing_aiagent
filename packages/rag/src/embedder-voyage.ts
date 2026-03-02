import type { RagEmbeddingProfile } from "@repo/types";
import type { Embedder } from "./embedder";

export class VoyageEmbedder implements Embedder {
  async generateEmbedding(_text: string, _profile?: RagEmbeddingProfile): Promise<number[]> {
    throw new Error("Voyage embedder is not implemented yet.");
  }

  async generateEmbeddings(_texts: string[], _profile?: RagEmbeddingProfile): Promise<number[][]> {
    throw new Error("Voyage embedder is not implemented yet.");
  }
}

export const createVoyageEmbedder = (): Embedder => new VoyageEmbedder();
