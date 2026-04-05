import * as path from "path";
import { detectProject } from "./detect-project.js";
import { getDb } from "./db.js";
import { queryAll } from "./kuzu-helpers.js";
import { appendTurn, resolveSession } from "./append-turn.js";
import { readSummary, writeSummary, buildUpdatedSummary } from "./update-summary.js";
import { extractFromTurn, writeCandidateFile } from "./extract-memory.js";
import { promoteToDb } from "./promote-memory.js";
import { readProjectConfig } from "./config.js";
import type { Turn } from "./types.js";

export async function ingestTurn(turn: Turn): Promise<void> {
  const detected = detectProject(turn.cwd);
  if (!detected) {
    console.error("No git repo found at:", turn.cwd);
    return;
  }

  const { repoRoot } = detected;
  const projectMemoryDir = path.join(repoRoot, ".project-memory");
  let config;
  try {
    config = readProjectConfig(projectMemoryDir);
  } catch {
    console.error("Project not initialized. Run: project-memory init");
    return;
  }
  const { conn } = getDb(projectMemoryDir);

  // 1. Resolve session
  const sessionId = resolveSession(turn, projectMemoryDir, config);

  // Ensure session exists in DB
  const sessionRows = await queryAll(
    conn,
    `MATCH (s:Session {id: '${sessionId}'}) RETURN s`
  );
  if (sessionRows.length === 0) {
    await conn.query(
      `CREATE (s:Session {
        id: '${sessionId}',
        projectId: '${config.projectId}',
        startedAt: '${new Date().toISOString()}',
        summary: ''
      })`
    );
    await conn.query(
      `MATCH (p:Project {id: '${config.projectId}'}), (s:Session {id: '${sessionId}'})
       CREATE (p)-[:HAS_SESSION]->(s)`
    );
  }

  // 2. Append turn to session log
  appendTurn(turn, projectMemoryDir, sessionId);

  // 3. Update rolling session summary
  const existingSummary = readSummary(projectMemoryDir, sessionId);
  const updatedSummary = buildUpdatedSummary(existingSummary, turn);
  writeSummary(projectMemoryDir, sessionId, updatedSummary);

  // 4. Extract memories from the full turn (skip if LLM not configured)
  if (!config.llm?.model || config.llm.model === "local-model") return;

  const userText = turn.messages.find((m) => m.role === "user")?.content ?? "";
  const assistantText = turn.messages.find((m) => m.role === "assistant")?.content ?? "";
  if (!userText) return;

  try {
    const turnId = `turn_${sessionId.slice(0, 8)}_${Date.now()}`;
    const candidates = await extractFromTurn(userText, assistantText, sessionId, turnId);
    if (candidates.length === 0) return;

    writeCandidateFile(projectMemoryDir, candidates);
    await promoteToDb(candidates, config.projectId, conn);
  } catch {
    // Never block on extraction errors
  }
}
