// Local sentence embeddings: all-MiniLM-L6-v2 -> 384-dim, L2-normalised vectors.
// Runs inside the Node process via Transformers.js (ONNX) - no API key needed.
let extractor: Promise<any> | null = null;

function getExtractor() {
  if (!extractor) {
    extractor = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return (pipeline as any)(
        "feature-extraction",
        process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2"
      );
    })();
  }
  return extractor;
}

export async function embed(text: string): Promise<number[]> {
  const ex = await getExtractor();
  const out = await ex(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

/** pgvector text literal, e.g. "[0.1,0.2,...]" - cast with ::vector in SQL */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
