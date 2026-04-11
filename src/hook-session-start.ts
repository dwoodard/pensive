#!/usr/bin/env node
/**
 * Claude Code SessionStart hook.
 * Fires when a new session opens. Writes a lean context bundle to stdout
 * so Claude Code injects it into the session before the first user message.
 */

import * as fs from "fs";
import { findProjectMemoryDir } from "./hook-utils.js";
import { readProjectConfig } from "./config.js";
import { getDb } from "./db.js";
import { querySessionBundle } from "./session-bundle.js";
import { escape, queryAll } from "./kuzu-helpers.js";

interface SessionStartPayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
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
    const { conn } = await getDb(projectMemoryDir);

    // Create Session node eagerly so it exists from the start of the session
    const existing = await queryAll(conn,
      `MATCH (s:Session {id: '${escape(payload.session_id)}'}) RETURN s.id`);
    if (existing.length === 0) {
      const now = new Date().toISOString();
      await conn.query(
        `CREATE (s:Session {
          id: '${escape(payload.session_id)}',
          projectId: '${escape(config.projectId)}',
          startedAt: '${escape(now)}',
          title: 'Session Initialization',
          summary: '',
          embedding: []
        })`
      );
      await conn.query(
        `MATCH (p:Project {id: '${escape(config.projectId)}'}), (s:Session {id: '${escape(payload.session_id)}'})
         CREATE (p)-[:HAS_SESSION]->(s)`
      );
    }

    const bundle = await querySessionBundle(conn, config.projectId, payload.session_id);
    if (bundle) process.stdout.write(bundle + "\n");
  } catch {
    // Never block session start
  }

  process.exit(0);
}

main();
