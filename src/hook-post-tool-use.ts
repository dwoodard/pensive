#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook.
 * Fires after every tool call. We only care about Write tool on new files.
 *
 * Artifact strategy (Option A — reference, don't copy):
 *   - If the written file is tracked by git → record Artifact node with location only
 *   - If not tracked by git → copy to .project-memory/artifacts/ and record that path
 *
 * We skip:
 *   - edits to existing files (only new file creation is artifact-worthy)
 *   - files inside .project-memory/ itself
 *   - non-document files (not .md, .txt, .json, .yaml, .yml)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import { findProjectMemoryDir } from "./hook-utils.js";
import { readProjectConfig } from "./config.js";
import { getDb } from "./db.js";
import { queryAll, escape } from "./kuzu-helpers.js";

interface PostToolUsePayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    command?: string;
    [key: string]: unknown;
  };
  tool_response?: unknown;
}

const ARTIFACT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

/**
 * Returns whether the file is tracked by git (exists in the index).
 * A file that was just written but never staged is "untracked" → new artifact.
 */
function isGitTracked(filePath: string, repoRoot: string): boolean {
  const result = spawnSync("git", ["ls-files", filePath], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  return (result.stdout?.toString().trim() ?? "") !== "";
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, " ");
}

async function recordArtifact(
  sessionId: string,
  projectId: string,
  filePath: string,
  repoRoot: string,
  projectMemoryDir: string,
  conn: ReturnType<typeof import("./db.js").getDb>["conn"]
): Promise<void> {
  const tracked = isGitTracked(filePath, repoRoot);
  let location: string;

  if (tracked) {
    // File is in git — use its repo-relative path as location
    location = path.relative(repoRoot, filePath);
  } else {
    // Not in git — copy to artifacts dir for persistence
    const artifactsDir = path.join(projectMemoryDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    const dest = path.join(artifactsDir, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    location = path.relative(repoRoot, dest);
  }

  const ext = path.extname(filePath).toLowerCase();
  const artifactId = `art_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const title = titleFromPath(filePath);
  const now = new Date().toISOString();

  // Dedupe: skip if we already have an artifact for this location
  const existing = await queryAll(conn,
    `MATCH (a:Artifact {projectId: '${escape(projectId)}'})
     WHERE a.location = '${escape(location)}'
     RETURN a.id LIMIT 1`
  );
  if (existing.length > 0) return;

  await conn.query(
    `CREATE (a:Artifact {
      id: '${escape(artifactId)}',
      type: '${escape(ext.replace(".", ""))}',
      title: '${escape(title)}',
      summary: '',
      location: '${escape(location)}',
      projectId: '${escape(projectId)}',
      sessionId: '${escape(sessionId)}',
      createdAt: '${escape(now)}'
    })`
  );

  // Link to session if it exists
  const sessionRows = await queryAll(conn,
    `MATCH (s:Session {id: '${escape(sessionId)}'}) RETURN s LIMIT 1`
  );
  if (sessionRows.length > 0) {
    await conn.query(
      `MATCH (s:Session {id: '${escape(sessionId)}'}), (a:Artifact {id: '${escape(artifactId)}'})
       CREATE (s)-[:PRODUCED]->(a)`
    );
  }
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync("/dev/stdin", "utf-8");
  } catch {
    process.exit(0);
  }

  let payload: PostToolUsePayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // Only care about Write tool
  if (payload.tool_name !== "Write") process.exit(0);

  const filePath = payload.tool_input?.file_path;
  if (!filePath) process.exit(0);

  // Only document file types
  const ext = path.extname(filePath).toLowerCase();
  if (!ARTIFACT_EXTENSIONS.has(ext)) process.exit(0);

  // Skip files inside .project-memory/
  if (filePath.includes(".project-memory")) process.exit(0);

  try {
    const projectMemoryDir = findProjectMemoryDir(payload.cwd);
    if (!projectMemoryDir) process.exit(0);

    const repoRoot = path.dirname(projectMemoryDir);

    // Skip edits to files already known to git — only capture newly created files
    if (isGitTracked(filePath, repoRoot)) process.exit(0);

    const config = readProjectConfig(projectMemoryDir);
    const { conn } = getDb(projectMemoryDir);

    await recordArtifact(
      payload.session_id,
      config.projectId,
      filePath,
      repoRoot,
      projectMemoryDir,
      conn
    );
  } catch {
    // Never block Claude
  }

  process.exit(0);
}

main();
