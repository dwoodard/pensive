#!/usr/bin/env node
/**
 * Claude Code Stop hook.
 * Extracts the last turn from the transcript, writes a debug log,
 * and runs the full ingest pipeline (turn log + memory extraction).
 */

import * as fs from "fs";
import * as path from "path";
import { ingestTurn } from "./index.js";
import { findProjectMemoryDir } from "./hook-utils.js";
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

function writeDebugLog(
  projectMemoryDir: string,
  sessionId: string,
  timestamp: string,
  promptId: string | null,
  cwd: string,
  userText: string,
  assistantText: string
): void {
  const debugDir = path.join(projectMemoryDir, "debug", sessionId);
  fs.mkdirSync(debugDir, { recursive: true });
  const safe = timestamp.replace(/[:.]/g, "-");
  const outPath = path.join(debugDir, `${safe}.txt`);
  const output = [
    `=== Turn: ${timestamp} ===`,
    `Session:   ${sessionId}`,
    `CWD:       ${cwd}`,
    `PromptID:  ${promptId}`,
    ``,
    `--- USER ---`,
    userText,
    ``,
    `--- ASSISTANT ---`,
    assistantText || "(no text response)",
    ``,
  ].join("\n");
  fs.writeFileSync(outPath, output);
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

    // Find the last promptId that has a real user text message
    let lastPromptId: string | null = null;
    let lastRoot: TranscriptEntry | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e.promptId || e.message.role !== "user") continue;
      const text = extractText(e.message.content);
      if (text) {
        lastPromptId = e.promptId;
        lastRoot = e;
        break;
      }
    }

    if (!lastPromptId || !lastRoot) process.exit(0);

    const userText = extractText(lastRoot.message.content);
    if (!userText) process.exit(0);

    // Assistant messages have no promptId — find them via parentUuid chain.
    // Collect all uuids that belong to this prompt's user messages.
    const promptUuids = new Set(
      entries.filter((e) => e.promptId === lastPromptId).map((e) => e.uuid)
    );
    // Walk backwards and find the last assistant message whose parentUuid
    // points to one of those uuids.
    let assistantText = "";
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.message.role !== "assistant") continue;
      if (!e.parentUuid || !promptUuids.has(e.parentUuid)) continue;
      const text = extractText(e.message.content);
      if (text) { assistantText = text; break; }
    }

    const cwd = lastRoot.cwd ?? payload.cwd;
    const sessionId = lastRoot.sessionId ?? payload.session_id;
    const timestamp = lastRoot.timestamp ?? new Date().toISOString();

    const projectMemoryDir = findProjectMemoryDir(cwd);
    if (!projectMemoryDir) process.exit(0);

    // Always write debug log
    writeDebugLog(
      projectMemoryDir,
      sessionId,
      timestamp,
      lastPromptId,
      cwd,
      userText,
      assistantText
    );

    // Run full ingest pipeline with LLM extraction
    const turn: Turn = {
      client: "claude-code",
      cwd,
      sessionId,
      timestamp,
      messages: [
        { role: "user", content: userText },
        { role: "assistant", content: assistantText },
      ],
      files: [],
    };

    // No LLM extraction — just log the turn and update the rolling summary
    await ingestTurn(turn);
  } catch {
    // Never block Claude on hook errors
  }

  process.exit(0);
}

main();
