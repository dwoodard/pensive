#!/usr/bin/env node
/**
 * Claude Code Stop hook.
 * Fires after each assistant response. Reads the transcript, finds all
 * user-initiated turns that haven't been logged yet, and ingests them.
 * De-duplicates via promptId stored in each session JSONL entry.
 */

import * as fs from "fs";
import * as path from "path";
import { ingestTurn } from "./index.js";
import { findProjectMemoryDir } from "./hook-utils.js";
import { getDb, applySchema } from "./db.js";
import { readProjectConfig } from "./config.js";
import { llmComplete } from "./llm.js";
import { queryAll } from "./kuzu-helpers.js";
import { escape as esc } from "./kuzu-helpers.js";
import type { Turn } from "./types.js";

interface HookPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  stop_reason: string;
}

interface TranscriptEntry {
  parentUuid: string | null;
  promptId?: string;
  type?: string;
  message: {
    role: "user" | "assistant";
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          tool_use_id?: string;
          content?: string;
        }>;
  };
  uuid: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

function stripSystemTags(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractText(content: TranscriptEntry["message"]["content"]): string {
  if (typeof content === "string") return stripSystemTags(content);
  return stripSystemTags(
    content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n")
  );
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync("/dev/stdin", "utf-8");
  } catch {
    process.exit(0);
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!payload.transcript_path || !fs.existsSync(payload.transcript_path)) {
    process.exit(0);
  }

  try {
    const entries: TranscriptEntry[] = fs
      .readFileSync(payload.transcript_path, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    // Find ALL promptIds that have a real user text message (distinct by promptId,
    // keeping the first/root user entry for each prompt).
    const promptRoots = new Map<string, TranscriptEntry>();
    for (const e of entries) {
      if (!e.promptId || e.message?.role !== "user") continue;
      const text = extractText(e.message.content);
      if (text && !promptRoots.has(e.promptId)) {
        promptRoots.set(e.promptId, e);
      }
    }

    if (promptRoots.size === 0) process.exit(0);

    // Determine session + project context from first available entry
    const firstRoot = [...promptRoots.values()][0];
    const cwd = firstRoot.cwd ?? payload.cwd;
    const sessionId = firstRoot.sessionId ?? payload.session_id;

    const projectMemoryDir = findProjectMemoryDir(cwd);
    if (!projectMemoryDir) process.exit(0);

    // Read already-logged promptIds from the session JSONL so we don't re-ingest
    const loggedPromptIds = new Set<string>();
    const sessionFile = path.join(projectMemoryDir, "sessions", `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { promptId?: string };
          if (entry.promptId) loggedPromptIds.add(entry.promptId);
        } catch {
          // ignore malformed lines
        }
      }
    }

    // Process each new prompt turn
    let lastUserText = "";
    let lastAssistantText = "";

    for (const [promptId, userRoot] of promptRoots) {
      if (loggedPromptIds.has(promptId)) continue;

      const userText = extractText(userRoot.message.content);
      if (!userText) continue;

      // Collect all UUIDs belonging to this prompt's user messages (includes tool results)
      const promptUuids = new Set(
        entries.filter((e) => e.promptId === promptId).map((e) => e.uuid)
      );

      // Find the last assistant message whose parentUuid is within this prompt's UUID set
      let assistantText = "";
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.message?.role !== "assistant") continue;
        if (!e.parentUuid || !promptUuids.has(e.parentUuid)) continue;
        const text = extractText(e.message.content);
        if (text) { assistantText = text; break; }
      }

      const turn: Turn = {
        client: "claude-code",
        cwd: userRoot.cwd ?? payload.cwd,
        sessionId,
        timestamp: userRoot.timestamp ?? new Date().toISOString(),
        promptId,
        messages: [
          { role: "user", content: userText },
          { role: "assistant", content: assistantText },
        ],
        files: [],
      };

      await ingestTurn(turn);

      lastUserText = userText;
      lastAssistantText = assistantText;
    }

    // Optionally update project description based on what happened this session
    // (runs once after all new turns are processed, using the last turn's content)
    if (lastUserText) {
      try {
        const projectMemoryDir2 = findProjectMemoryDir(cwd);
        if (projectMemoryDir2) {
          const config = readProjectConfig(projectMemoryDir2);
          const { conn: conn2 } = await getDb(projectMemoryDir2);
          await applySchema(conn2, projectMemoryDir2);
          const pid = config.projectId;

          const rows = await queryAll(conn2, `MATCH (p:Project {id: '${pid}'}) RETURN p`);
          const p = rows[0]?.["p"] as Record<string, unknown> | undefined;
          const current = p?.["description"] ? String(p["description"]) : "";

          const prompt = `You are maintaining a living project description for a software project called "${config.projectName}".

Current description:
${current || "(none yet)"}

What just happened in this session (user message):
${lastUserText.slice(0, 800)}

Assistant response summary:
${lastAssistantText.slice(0, 800)}

Task: Should the project description be updated based on this session? If yes, write a concise updated description (2-5 sentences) that captures what this project is, what it does, and any key characteristics. If no update is needed, respond with exactly: NO_UPDATE

Respond with either the new description text, or NO_UPDATE.`;

          const result = await llmComplete(prompt);
          const trimmed = result.trim();
          if (trimmed && trimmed !== "NO_UPDATE" && trimmed.length > 10) {
            await conn2.query(
              `MATCH (p:Project {id: '${esc(pid)}'}) SET p.description = '${esc(trimmed)}'`
            );
          }
        }
      } catch {
        // Never block Claude on description update errors
      }
    }
  } catch {
    // Never block Claude on hook errors
  }

  process.exit(0);
}

main();
