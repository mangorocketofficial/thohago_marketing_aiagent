import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.API_SECRET ??= "test-secret";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { supabaseAdmin } = await import("../src/lib/supabase-admin");
const { buildEnrichedCampaignContext } = await import("../src/orchestrator/rag-context");
const { getDocumentExtractsByFolder } = await import("../src/rag/data");

type Row = Record<string, unknown>;
type MockTables = Record<string, Row[]>;

type QueryResponse = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const deepContains = (target: unknown, subset: Record<string, unknown>): boolean => {
  const record = asRecord(target);
  return Object.entries(subset).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return deepContains(record[key], expected as Record<string, unknown>);
    }
    return record[key] === expected;
  });
};

class MockBuilder {
  private mode: "select" | "update" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private updatePatch: Row | null = null;
  private headOnly = false;
  private countMode: string | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: MockTables
  ) {}

  select(_columns: string, options?: { count?: string; head?: boolean }): this {
    this.mode = "select";
    this.headOnly = options?.head === true;
    this.countMode = options?.count ?? null;
    return this;
  }

  update(patch: Row): this {
    this.mode = "update";
    this.updatePatch = patch;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }

  contains(column: string, value: Record<string, unknown>): this {
    this.filters.push((row) => deepContains(row[column], value));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = {
      column,
      ascending: options?.ascending ?? true
    };
    return this;
  }

  limit(value: number): this {
    this.limitCount = value;
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    const result = await this.run();
    if (result.error) {
      return { data: null, error: result.error };
    }

    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<QueryResponse> {
    const result = await this.run();
    if (result.error) {
      return { data: null, error: result.error };
    }

    const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
    if (rows.length !== 1) {
      return {
        data: null,
        error: { message: `Expected single row from ${this.table}, received ${rows.length}` }
      };
    }

    return { data: rows[0], error: null };
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async run(): Promise<QueryResponse> {
    if (this.mode === "update") {
      return this.runUpdate();
    }
    return this.runSelect();
  }

  private runSelect(): QueryResponse {
    let rows = [...(this.tables[this.table] ?? [])];

    for (const filter of this.filters) {
      rows = rows.filter(filter);
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows.sort((left, right) => {
        const l = left[column];
        const r = right[column];
        const lText = l === undefined || l === null ? "" : String(l);
        const rText = r === undefined || r === null ? "" : String(r);
        return ascending ? lText.localeCompare(rText) : rText.localeCompare(lText);
      });
    }

    if (typeof this.limitCount === "number") {
      rows = rows.slice(0, Math.max(0, this.limitCount));
    }

    if (this.headOnly) {
      return {
        data: null,
        error: null,
        count: this.countMode ? rows.length : null
      };
    }

    return {
      data: rows,
      error: null,
      count: this.countMode ? rows.length : null
    };
  }

  private runUpdate(): QueryResponse {
    const rows = this.tables[this.table] ?? [];
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.updatePatch) {
      for (const row of matched) {
        Object.assign(row, this.updatePatch);
      }
    }

    return {
      data: matched,
      error: null
    };
  }
}

const withMockSupabase = async <T>(tables: MockTables, fn: () => Promise<T>): Promise<T> => {
  const admin = supabaseAdmin as unknown as { from: (table: string) => unknown };
  const originalFrom = admin.from.bind(supabaseAdmin);
  admin.from = (table: string) => new MockBuilder(table, tables);

  try {
    return await fn();
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    admin.from = originalFrom;
  }
};

describe("Phase 5-2 RAG enrichment unit tests", () => {
  const ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";

  it("buildEnrichedCampaignContext returns full context when supplemental sources exist", async () => {
    const tables: MockTables = {
      org_brand_settings: [
        {
          org_id: ORG_ID,
          result_document: {
            review_markdown: "# Channel Audit\n- Instagram engagement is strong\n# Tone\n- Warm and trustworthy"
          },
          interview_answers: {
            q1: "warm and practical",
            q2: "young donors",
            q3: "political framing",
            q4: "spring fundraising"
          }
        }
      ],
      campaigns: [],
      org_rag_embeddings: [
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-report",
          chunk_index: 1,
          content: "second chunk",
          metadata: {
            activity_folder: "Project A",
            file_name: "report.md",
            text_extracted: true
          },
          created_at: "2026-03-04T10:00:01.000Z"
        },
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-report",
          chunk_index: 0,
          content: "first chunk",
          metadata: {
            activity_folder: "Project A",
            file_name: "report.md",
            text_extracted: true
          },
          created_at: "2026-03-04T10:00:00.000Z"
        }
      ]
    };

    await withMockSupabase(tables, async () => {
      const context = await buildEnrichedCampaignContext(ORG_ID, {
        activityFolder: "Project A",
        folderContext: {
          activity_folder: "Project A",
          total_files: 3,
          images: ["photo-1.jpg"],
          videos: ["clip-1.mp4"],
          documents: ["report.md"],
          scanned_at: "2026-03-04T10:05:00.000Z"
        }
      });

      assert.equal(context.contextLevel, "full");
      assert.equal(context.meta.context_level, "full");
      assert.ok(context.memoryMd && context.memoryMd.length > 0);
      assert.ok(context.brandReviewMd?.includes("Channel Audit"));
      assert.equal(context.interviewAnswers?.q1, "warm and practical");
      assert.ok(context.folderSummary?.includes("Project A"));
      assert.ok(context.documentExtracts?.includes("[report.md]"));
      assert.ok(context.documentExtracts?.includes("first chunk"));
      assert.ok(context.meta.tier2_sources.some((source) => source.source_id === "doc-report"));
    });
  });

  it("buildEnrichedCampaignContext returns partial when only memory is available", async () => {
    const tables: MockTables = {
      org_brand_settings: [
        {
          org_id: ORG_ID,
          result_document: null,
          interview_answers: {
            q1: "",
            q2: "",
            q3: "",
            q4: ""
          }
        }
      ],
      campaigns: [],
      org_rag_embeddings: []
    };

    await withMockSupabase(tables, async () => {
      const context = await buildEnrichedCampaignContext(ORG_ID, {
        activityFolder: "Project B"
      });

      assert.equal(context.contextLevel, "partial");
      assert.equal(context.meta.context_level, "partial");
      assert.ok(context.memoryMd && context.memoryMd.length > 0);
      assert.equal(context.brandReviewMd, null);
      assert.equal(context.interviewAnswers, null);
      assert.equal(context.folderSummary, null);
      assert.equal(context.documentExtracts, null);
      assert.equal(context.meta.tier2_sources.length, 0);
    });
  });

  it("getDocumentExtractsByFolder groups chunks per document and filters non-extracted rows", async () => {
    const tables: MockTables = {
      org_rag_embeddings: [
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-new",
          chunk_index: 2,
          content: "chunk-2",
          metadata: {
            activity_folder: "Project C",
            file_name: "new-report.md",
            text_extracted: true
          },
          created_at: "2026-03-05T11:00:02.000Z"
        },
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-new",
          chunk_index: 0,
          content: "chunk-0",
          metadata: {
            activity_folder: "Project C",
            file_name: "new-report.md",
            text_extracted: true
          },
          created_at: "2026-03-05T11:00:00.000Z"
        },
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-new",
          chunk_index: 1,
          content: "chunk-1",
          metadata: {
            activity_folder: "Project C",
            file_name: "new-report.md",
            text_extracted: true
          },
          created_at: "2026-03-05T11:00:01.000Z"
        },
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-old",
          chunk_index: 0,
          content: "old-chunk",
          metadata: {
            activity_folder: "Project C",
            file_name: "old-report.md",
            text_extracted: true
          },
          created_at: "2026-03-03T09:00:00.000Z"
        },
        {
          org_id: ORG_ID,
          source_type: "local_doc",
          source_id: "doc-ignored",
          chunk_index: 0,
          content: "should-not-appear",
          metadata: {
            activity_folder: "Project C",
            file_name: "ignored.md",
            text_extracted: false
          },
          created_at: "2026-03-05T12:00:00.000Z"
        }
      ]
    };

    await withMockSupabase(tables, async () => {
      const extracts = await getDocumentExtractsByFolder({
        orgId: ORG_ID,
        activityFolder: "Project C",
        limitDocs: 2,
        maxChunksPerDoc: 2,
        rowLimit: 20
      });

      assert.equal(extracts.length, 2);
      assert.equal(extracts[0]?.source_id, "doc-new");
      assert.equal(extracts[0]?.file_name, "new-report.md");
      assert.equal(extracts[0]?.chunk_count, 2);
      assert.ok(extracts[0]?.content.includes("chunk-0"));
      assert.ok(extracts[0]?.content.includes("chunk-1"));
      assert.ok(!extracts[0]?.content.includes("chunk-2"));

      assert.equal(extracts[1]?.source_id, "doc-old");
      assert.ok(!extracts.some((entry) => entry.source_id === "doc-ignored"));
    });
  });
});
