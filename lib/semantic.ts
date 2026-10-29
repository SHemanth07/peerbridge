import { query } from "./db";
import type { Session } from "./auth";

/** minimum cosine similarity to attach a concept automatically / to show a semantic-search hit */
export const MIN_SIM = 0.25;

/** Nearest concept (cosine distance, HNSW) inside a course, or null when nothing is close enough. */
export async function autoTag(s: Session, vec: string, courseId: number): Promise<number | null> {
  const near = await query(
    s,
    `SELECT concept_id, 1 - (embedding <=> $1::vector) AS sim
     FROM concepts WHERE course_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [vec, courseId]
  );
  return near[0] && near[0].sim >= MIN_SIM ? near[0].concept_id : null;
}
