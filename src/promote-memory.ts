import * as crypto from "crypto";
import { queryAll, escape } from "./kuzu-helpers.js";
import type { Memory } from "./types.js";
import type { CandidateMemory } from "./extract-memory.js";
import type kuzu from "kuzu";

export async function promoteToDb(
  candidates: CandidateMemory[],
  projectId: string,
  conn: InstanceType<typeof kuzu.Connection>
): Promise<Memory[]> {
  const promoted: Memory[] = [];

  for (const c of candidates) {
    // Dedupe by title
    const existing = await queryAll(
      conn,
      `MATCH (m:Memory {projectId: '${escape(projectId)}'})
       WHERE m.title = '${escape(c.title)}'
       RETURN m.id`
    );
    if (existing.length > 0) continue;

    // Tasks default to pending; enforce only-one-active
    let status = c.status;
    let taskOrder = 0;
    if (c.kind === "task") {
      if (!status) status = "pending";
      if (status === "active") {
        // Demote any currently active task to pending
        await conn.query(
          `MATCH (m:Memory {projectId: '${escape(projectId)}', kind: 'task', status: 'active'})
           SET m.status = 'pending'`
        );
      }
      if (status === "pending") {
        // Assign next order position
        const orderRows = await queryAll(
          conn,
          `MATCH (m:Memory {projectId: '${escape(projectId)}', kind: 'task', status: 'pending'})
           RETURN max(m.taskOrder) AS maxOrder`
        );
        const maxOrder = Number(orderRows[0]?.["maxOrder"] ?? 0);
        taskOrder = maxOrder + 1;
      }
    }

    const memory: Memory = {
      id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      kind: c.kind,
      title: c.title,
      summary: c.summary,
      recallCue: c.recallCue,
      projectId,
      sessionId: c.sessionId,
      createdAt: new Date().toISOString(),
      status,
      taskOrder,
    };

    await conn.query(
      `CREATE (m:Memory {
        id: '${escape(memory.id)}',
        kind: '${escape(memory.kind)}',
        title: '${escape(memory.title)}',
        summary: '${escape(memory.summary)}',
        recallCue: '${escape(memory.recallCue)}',
        projectId: '${escape(memory.projectId)}',
        sessionId: '${escape(memory.sessionId)}',
        createdAt: '${escape(memory.createdAt)}',
        status: '${escape(memory.status ?? "")}',
        taskOrder: ${memory.taskOrder ?? 0},
        artifactId: ''
      })`
    );

    // Link to session if it exists
    const sessionRows = await queryAll(conn, `MATCH (s:Session {id: '${escape(c.sessionId)}'}) RETURN s`);
    if (sessionRows.length > 0) {
      await conn.query(
        `MATCH (s:Session {id: '${escape(c.sessionId)}'}), (m:Memory {id: '${escape(memory.id)}'})
         CREATE (s)-[:HAS_MEMORY]->(m)`
      );
    }

    promoted.push(memory);
  }

  return promoted;
}

export async function getExistingMemories(
  projectId: string,
  conn: InstanceType<typeof kuzu.Connection>
): Promise<Memory[]> {
  const rows = await queryAll(
    conn,
    `MATCH (m:Memory {projectId: '${escape(projectId)}'})
     RETURN m ORDER BY m.createdAt DESC LIMIT 50`
  );
  return rows.map((r) => r["m"] as Memory);
}
