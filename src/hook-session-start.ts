#!/usr/bin/env node
/**
 * Claude Code SessionStart hook.
 * Fires when a new session opens. Writes a lean context bundle to stdout
 * so Claude Code injects it into the session before the first user message.
 *
 * Budget strategy (2000 char hard cap):
 *   1. Active task         — always include if present
 *   2. Pending tasks       — top 3
 *   3. Recent decisions    — top 3
 *   4. Key facts           — top 2
 *
 * Each section is truncated to fit. If nothing is in the DB, outputs nothing.
 */

import * as fs from "fs";
import { findProjectMemoryDir } from "./hook-utils.js";
import { readProjectConfig } from "./config.js";
import { getDb } from "./db.js";
import { queryAll, escape } from "./kuzu-helpers.js";
import type { Session, Task } from "./types.js";

interface SessionStartPayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
}

const BUDGET = 2000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Extract a useful excerpt from a session summary.
 * If it's an LLM-generated paragraph (no rolling-log markers), use it directly.
 * If it's the raw rolling log format, pull the last user message.
 */
function extractSummaryExcerpt(summary: string): string {
  if (!summary) return "";
  // Rolling log has [timestamp] markers — detect and extract last user message
  if (/^\[20\d\d-/.test(summary.trim())) {
    const segments = summary.split(/\n---\n/);
    const last = segments[segments.length - 1]?.trim() ?? "";
    const match = last.match(/^User:\s*(.+)/m);
    return match?.[1]?.trim() ?? last.slice(0, 200);
  }
  // LLM-generated summary — use directly
  return summary.slice(0, 300);
}

function buildBundle(
  activeTask: Task | null,
  pending: Task[],
  lastSession: Session | null,
  activeSubtasks: Task[] = []
): string {
  const lines: string[] = [];
  let remaining = BUDGET;

  const push = (line: string) => {
    if (remaining <= 0) return;
    const safe = truncate(line, remaining);
    lines.push(safe);
    remaining -= safe.length + 1;
  };

  push(`## pensive CLI`);
  push(`pensive tasks              — list tasks (gantt view)`);
  push(`pensive tasks start <n>    — set task active by queue position`);
  push(`pensive tasks done         — complete the active task`);
  push(`pensive tasks add "title"  — add a task to the queue`);
  push(`pensive tasks block "why"   — mark active task blocked`);
  push(`pensive tasks remove <n>   — delete a task by position or id`);
  push(`pensive tasks move <f> <t> — reorder queue`);
  push(`pensive context            — show full memory context`);
  push(`pensive status             — show memory stats`);
  push("");

  const hasTasks = activeTask !== null || pending.length > 0;

  if (hasTasks) {
    push(`## Tasks`);
    if (activeTask) {
      push(`ACTIVE: ${activeTask.title}`);
      if (activeTask.summary) push(`  ${activeTask.summary}`);
      if (activeSubtasks.length > 0) {
        activeSubtasks.forEach((s) => {
          const checkbox = s.status === "done" ? "[x]" : s.status === "blocked" ? "[-]" : "[ ]";
          push(`  ${checkbox} ${s.title}`);
        });
      }
    }
    if (pending.length > 0) {
      push(`Queue:`);
      pending.forEach((t, i) => push(`  ${i + 1}. ${t.title}`));
    }
    push(`Work the active task. When done run: pensive tasks done`);
    push("");
  }

  if (lastSession) {
    push(`## Last Session`);
    push(lastSession.title || lastSession.id);
    const excerpt = extractSummaryExcerpt(lastSession.summary);
    if (excerpt) push(truncate(excerpt, 300));
  }

  return lines.join("\n").trim();
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync("/dev/stdin", "utf-8");
  } catch {
    process.exit(0);
  }

  let payload: SessionStartPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  try {
    const projectMemoryDir = findProjectMemoryDir(payload.cwd);
    if (!projectMemoryDir) process.exit(0);

    const config = readProjectConfig(projectMemoryDir);
    const { conn } = getDb(projectMemoryDir);
    const pid = config.projectId;
    const currentSessionId = payload.session_id;

    const activeRows = await queryAll(conn,
      `MATCH (t:Task {projectId: '${pid}', status: 'active'})
       RETURN t ORDER BY t.createdAt DESC LIMIT 1`
    );
    const pendingRows = await queryAll(conn,
      `MATCH (t:Task {projectId: '${pid}', status: 'pending'})
       RETURN t ORDER BY t.taskOrder ASC LIMIT 3`
    );
    // Most recent non-archived session for this project, excluding the current one
    const lastSessionRows = await queryAll(conn,
      `MATCH (s:Session {projectId: '${pid}'})
       WHERE s.id <> '${escape(currentSessionId)}' AND (s.archived = false OR s.archived IS NULL)
       RETURN s ORDER BY s.startedAt DESC LIMIT 1`
    );

    const activeTask = activeRows[0]?.["t"] as Task | undefined ?? null;
    const pending = pendingRows.map((r) => r["t"] as Task);
    const lastSession = lastSessionRows[0]?.["s"] as Session | undefined ?? null;

    let activeSubtasks: Task[] = [];
    if (activeTask) {
      const subtaskRows = await queryAll(conn,
        `MATCH (t:Task {projectId: '${pid}', parentId: '${escape(activeTask.id)}'})
         WHERE t.status <> 'done'
         RETURN t ORDER BY t.taskOrder ASC`
      );
      activeSubtasks = subtaskRows.map((r) => r["t"] as Task);
    }

    const bundle = buildBundle(activeTask, pending, lastSession, activeSubtasks);
    if (bundle) process.stdout.write(bundle + "\n");
  } catch {
    // Never block session start
  }

  process.exit(0);
}

main();
