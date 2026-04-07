import { embed } from "./llm.js";
import { queryAll, escape } from "./kuzu-helpers.js";
import type { Memory, ScoredMemory } from "./types.js";
import type kuzu from "kuzu";

export { ScoredMemory };

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

/** Exponential recency decay — score of 1.0 today, ~0.5 at halfLifeDays */
function recencyScore(createdAt: string, halfLifeDays = 14): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Flat vector search — used by CLI `pensive search` */
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

/**
 * Graph-walk context assembly:
 * 1. Embed the seed query (active task title)
 * 2. Score all memories: similarity × recency decay
 * 3. Take top seedK hits as entry points
 * 4. Walk up to parent sessions — pull sibling memories (1 hop, half weight)
 * 5. Walk across RELATED_TO / SUPERSEDES edges (1 hop, half weight)
 * 6. Deduplicate, re-rank, return topK
 */
export async function searchMemoriesWithGraph(
  conn: InstanceType<typeof kuzu.Connection>,
  projectId: string,
  query: string,
  topK = 8,
  seedK = 4,
  embedFn: (text: string) => Promise<number[]> = embed
): Promise<ScoredMemory[]> {
  const queryVec = await embedFn(query);

  // Load all memories with embeddings
  const rows = await queryAll(
    conn,
    `MATCH (m:Memory {projectId: '${escape(projectId)}'})
     WHERE size(m.embedding) > 0
     RETURN m`
  );

  if (rows.length === 0) return [];

  // Score: similarity × recency
  const scored = rows.map((r) => {
    const m = r["m"] as Memory & { embedding: number[] };
    const sim = cosineSimilarity(queryVec, m.embedding);
    const rec = recencyScore(m.createdAt);
    return { ...m, score: sim * rec, _sim: sim };
  });

  scored.sort((a, b) => b.score - a.score);
  const seeds = scored.slice(0, seedK);

  // Collect candidate IDs → best score seen
  const candidates = new Map<string, ScoredMemory>();
  for (const s of seeds) {
    candidates.set(s.id, s);
  }

  // Walk up: for each seed, find its parent session and pull sibling memories
  for (const seed of seeds) {
    const sessionRows = await queryAll(
      conn,
      `MATCH (s:Session)-[:HAS_MEMORY]->(m:Memory {id: '${escape(seed.id)}'})
       RETURN s.id AS sid, s.title AS stitle, s.summary AS ssummary`
    );

    for (const sr of sessionRows) {
      const sid = String(sr["sid"]);
      const stitle = String(sr["stitle"] ?? "");
      const ssummary = String(sr["ssummary"] ?? "");

      // Siblings in the same session
      const sibRows = await queryAll(
        conn,
        `MATCH (s:Session {id: '${escape(sid)}'})-[:HAS_MEMORY]->(sib:Memory)
         WHERE sib.id <> '${escape(seed.id)}' AND size(sib.embedding) > 0
         RETURN sib`
      );

      for (const sibRow of sibRows) {
        const sib = sibRow["sib"] as Memory & { embedding: number[] };
        if (candidates.has(sib.id)) continue;
        const sim = cosineSimilarity(queryVec, sib.embedding);
        const rec = recencyScore(sib.createdAt);
        // Half weight for hop-1 nodes
        candidates.set(sib.id, {
          ...sib,
          score: sim * rec * 0.5,
          sessionTitle: stitle,
          sessionSummary: ssummary,
        });
      }

      // Attach session info to the seed itself
      const existing = candidates.get(seed.id)!;
      if (!existing.sessionTitle) {
        candidates.set(seed.id, { ...existing, sessionTitle: stitle, sessionSummary: ssummary });
      }
    }
  }

  // Walk across: RELATED_TO and SUPERSEDES neighbors of seeds
  for (const seed of seeds) {
    const relRows = await queryAll(
      conn,
      `MATCH (m:Memory {id: '${escape(seed.id)}'})-[:RELATED_TO|SUPERSEDES]->(rel:Memory)
       WHERE size(rel.embedding) > 0
       RETURN rel`
    );
    for (const rr of relRows) {
      const rel = rr["rel"] as Memory & { embedding: number[] };
      if (candidates.has(rel.id)) continue;
      const sim = cosineSimilarity(queryVec, rel.embedding);
      const rec = recencyScore(rel.createdAt);
      candidates.set(rel.id, { ...rel, score: sim * rec * 0.5 });
    }
  }

  // Final rank and trim
  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
