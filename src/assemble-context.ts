import type { Memory, Task, ContextBundle } from "./types.js";
import type kuzu from "kuzu";
import { queryAll, escape } from "./kuzu-helpers.js";
import { searchMemories } from "./search.js";

export async function assembleContext(
  projectId: string,
  sessionSummary: string,
  conn: InstanceType<typeof kuzu.Connection>,
  query?: string
): Promise<ContextBundle> {
  // Get active task
  const activeRows = await queryAll(
    conn,
    `MATCH (t:Task {projectId: '${escape(projectId)}', status: 'active'})
     RETURN t ORDER BY t.createdAt DESC LIMIT 1`
  );
  const activeTask: Task | null =
    activeRows.length > 0 ? (activeRows[0]["t"] as Task) : null;

  // Get next pending tasks
  const pendingRows = await queryAll(
    conn,
    `MATCH (t:Task {projectId: '${escape(projectId)}', status: 'pending'})
     RETURN t ORDER BY t.taskOrder ASC LIMIT 3`
  );
  const nextTasks: Task[] = pendingRows.map((r) => r["t"] as Task);

  // Get key memories — semantic search if query provided, otherwise recency
  let keyMemories: Memory[];
  if (query) {
    try {
      keyMemories = await searchMemories(conn, projectId, query, 5);
    } catch {
      // Fall back to recency if embedding fails
      keyMemories = await recencyMemories(conn, projectId);
    }
  } else {
    keyMemories = await recencyMemories(conn, projectId);
  }

  return {
    activeTask,
    nextTasks,
    keyMemories,
    sessionSummary,
  };
}

async function recencyMemories(
  conn: InstanceType<typeof kuzu.Connection>,
  projectId: string
): Promise<Memory[]> {
  const rows = await queryAll(
    conn,
    `MATCH (m:Memory {projectId: '${escape(projectId)}'})
     WHERE m.kind IN ['decision', 'question', 'fact', 'summary']
     RETURN m ORDER BY m.createdAt DESC LIMIT 5`
  );
  return rows.map((r) => r["m"] as Memory);
}

export function formatContextBundle(bundle: ContextBundle): string {
  const isEmpty =
    !bundle.activeTask &&
    bundle.nextTasks.length === 0 &&
    bundle.keyMemories.length === 0 &&
    !bundle.sessionSummary;

  if (isEmpty) {
    return [
      "## Project Memory Context",
      "",
      "No memories yet. Memories are extracted automatically at the end of each AI turn.",
      "Run: project-memory config  to set your LLM and embedding models.",
    ].join("\n");
  }

  const lines: string[] = ["## Project Memory Context\n"];

  if (bundle.activeTask) {
    lines.push(`### Active Task\n${bundle.activeTask.title}`);
    if (bundle.activeTask.summary) lines.push(bundle.activeTask.summary);
    lines.push("");
  }

  if (bundle.nextTasks.length > 0) {
    lines.push("### Next Tasks");
    bundle.nextTasks.forEach((t) => lines.push(`- ${t.title}`));
    lines.push("");
  }

  if (bundle.keyMemories.length > 0) {
    lines.push("### Key Context");
    bundle.keyMemories.forEach((m) => {
      lines.push(`**[${m.kind}]** ${m.title}: ${m.summary}`);
    });
    lines.push("");
  }

  if (bundle.sessionSummary) {
    lines.push("### Session Summary");
    lines.push(bundle.sessionSummary);
  }

  return lines.join("\n");
}
