import { WorkflowEntrypoint } from "cloudflare:workers";
import type { Env } from "./index";
import { MODELS } from "./models";

interface RAGParams {
  documentId: string;
  source: string;
  sourceKey: string;
  title?: string;
}

type WorkflowEventLike<T> = { payload: T };
type WorkflowStepLike = {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export class RAGWorkflow extends WorkflowEntrypoint<Env, RAGParams> {
  async run(event: WorkflowEventLike<RAGParams>, step: WorkflowStepLike): Promise<void> {
    const { documentId, source, sourceKey, title } = event.payload;
    const content = await step.do("fetch-document", async () => {
      if (source === "r2") {
        const obj = await this.env.BUCKET.get(sourceKey);
        return obj ? await obj.text() : "";
      }
      return "";
    });
    if (!content) {
      await this.env.DB.prepare("UPDATE documents SET status = 'failed' WHERE id = ?").bind(documentId).run();
      return;
    }
    const chunks = await step.do("chunk-text", async () => chunkText(content, 1000, 200));
    const embeddings = await step.do("generate-embeddings", async () => {
      const r = await this.env.AI.run(MODELS.embeddings.primary, { text: chunks });
      return (r as any).data ?? [];
    });
    await step.do("insert-vectors", async () => {
      const vectors = embeddings.map((vec: number[], i: number) => ({
        id: `${documentId}-${i}`,
        values: vec,
        metadata: { documentId, title: title ?? "", chunkIndex: i, text: chunks[i] },
      }));
      for (let i = 0; i < vectors.length; i += 100) await this.env.VECTORIZE.insert(vectors.slice(i, i + 100));
    });
    await step.do("update-status", async () => {
      await this.env.DB.prepare("UPDATE documents SET status = 'indexed', chunk_count = ? WHERE id = ?").bind(chunks.length, documentId).run();
    });
  }
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive");
  const safeOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - safeOverlap;
  }
  return chunks;
}
