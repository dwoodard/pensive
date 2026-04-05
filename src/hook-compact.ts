#!/usr/bin/env node
/**
 * Claude Code PreCompact hook.
 * Fires when context is about to be compacted — natural end-of-session moment.
 * Reviews all accumulated candidates against the DB and promotes the best ones.
 * Payload: { session_id, cwd, hook_event_name, compaction_type }
 */

import * as fs from "fs";
import { findProjectMemoryDir } from "./hook-utils.js";
import { readAllCandidates, reviewCandidates, clearCandidates } from "./extract-memory.js";
import { promoteToDb, getExistingMemories } from "./promote-memory.js";
import { readProjectConfig } from "./config.js";
import { getDb } from "./db.js";

interface CompactPayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  compaction_type?: string;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync("/dev/stdin", "utf-8");
  } catch {
    process.exit(0);
  }

  let payload: CompactPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  try {
    const projectMemoryDir = findProjectMemoryDir(payload.cwd);
    if (!projectMemoryDir) process.exit(0);

    const config = readProjectConfig(projectMemoryDir);
    if (!config.llm?.model || config.llm.model === "local-model") process.exit(0);

    const { conn } = getDb(projectMemoryDir);

    // Read all candidates accumulated during this session
    const candidates = readAllCandidates(projectMemoryDir);
    if (candidates.length === 0) process.exit(0);

    // Get existing memories for deduplication
    const existing = await getExistingMemories(config.projectId, conn);

    // LLM reviews candidates against existing DB — promotes, merges, or discards
    const reviewed = await reviewCandidates(candidates, existing, config.projectName);

    if (reviewed.length > 0) {
      await promoteToDb(reviewed, config.projectId, conn);
    }

    // Clear candidates now that they've been reviewed
    clearCandidates(projectMemoryDir);
  } catch {
    // Never block compaction
  }

  process.exit(0);
}

main();
