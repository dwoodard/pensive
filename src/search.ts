import { embed } from "./llm.js";
import { queryAll, escape } from "./kuzu-helpers.js";
import type { Memory } from "./types.js";
import type kuzu from "kuzu";

export interface ScoredMemory extends Memory {
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchMemories(
  conn: InstanceType<typeof kuzu.Connection>,
  projectId: string,
  query: string,
  topK = 5
): Promise<ScoredMemory[]> {
  const queryVec = await embed(query);

  const rows = await queryAll(
    conn,
    `MATCH (m:Memory {projectId: '${escape(projectId)}'})
     WHERE size(m.embedding) > 0
     RETURN m`
  );

  return rows
    .map((r) => {
      const m = r["m"] as Memory & { embedding: number[] };
      return { ...m, score: cosineSimilarity(queryVec, m.embedding) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
