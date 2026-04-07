import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { resolveProjectIdentity } from "./detect-project.js";
import { getDb, applySchema } from "./db.js";
import { DEFAULT_LLM, DEFAULT_EMBEDDING, type ProjectConfig } from "./config.js";

export async function initProject(cwd: string): Promise<void> {
  // Use cwd directly as the project root — no git required
  const projectRoot = cwd;
  const { remoteUrl, projectName } = resolveProjectIdentity(projectRoot);
  const repoRoot = projectRoot;
  const projectMemoryDir = path.join(projectRoot, ".pensive");
  const configPath = path.join(projectMemoryDir, "config.json");

  // Idempotent — check if already initialized
  if (fs.existsSync(configPath)) {
    const existing: ProjectConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log(`Already initialized: ${existing.projectName}`);
    console.log(`  ID:   ${existing.projectId}`);
    console.log(`  Path: ${repoRoot}`);
    return;
  }

  // Create directory structure
  for (const dir of [
    projectMemoryDir,
    path.join(projectMemoryDir, "sessions"),
    path.join(projectMemoryDir, "candidates"),
    path.join(projectMemoryDir, "artifacts"),
    path.join(projectMemoryDir, "summaries"),
    path.join(projectMemoryDir, "queue"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Initialize Kuzu and apply schema
  const { conn } = getDb(projectMemoryDir);
  await applySchema(conn);

  // Write config with LLM defaults
  const projectId = `proj_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const config: ProjectConfig = {
    projectId,
    projectName,
    remoteUrl,
    repoPath: repoRoot,
    createdAt: new Date().toISOString(),
    llm: { ...DEFAULT_LLM },
    embedding: { ...DEFAULT_EMBEDDING },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Create Project node in Kuzu
  await conn.query(
    `CREATE (p:Project {
      id: '${projectId}',
      name: '${projectName.replace(/'/g, "\\'")}',
      remoteUrl: '${remoteUrl.replace(/'/g, "\\'")}',
      repoPath: '${repoRoot.replace(/'/g, "\\'")}',
      createdAt: '${config.createdAt}'
    })`
  );

  // Add .pensive to .gitignore only if this is a git repo
  const gitDir = path.join(repoRoot, ".git");
  if (fs.existsSync(gitDir)) {
    const gitignorePath = path.join(repoRoot, ".gitignore");
    const entry = ".pensive/\n";
    if (fs.existsSync(gitignorePath)) {
      const contents = fs.readFileSync(gitignorePath, "utf-8");
      if (!contents.includes(".pensive")) fs.appendFileSync(gitignorePath, `\n${entry}`);
    } else {
      fs.writeFileSync(gitignorePath, entry);
    }
  }

  // Write hook registrations
  writeClaudeSettings(projectRoot);
  writeGithubHooks(projectRoot);

  console.log(`Initialized project: ${projectName}`);
  console.log(`  ID:     ${projectId}`);
  console.log(`  Remote: ${remoteUrl}`);
  console.log(`  Path:   ${projectMemoryDir}`);
  console.log(`  Hooks:  .claude/settings.json, .github/hooks/pensive.json`);
  console.log(`  Run "pensive config" to set your LLM and embedding models.`);
}

const HOOK_EVENTS: Array<[event: string, type: string]> = [
  ["SessionStart",     "session-start"],
  ["UserPromptSubmit", "user-prompt"],
  ["Stop",             "stop"],
  ["PreCompact",       "compact"],
  ["PostToolUse",      "post-tool-use"],
];

/** .claude/settings.json — nested format expected by Claude Code */
function writeClaudeSettings(projectRoot: string): void {
  const claudeDir = path.join(projectRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  fs.mkdirSync(claudeDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try { existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch { /* ignore */ }
  }

  const hooks = (existing["hooks"] as Record<string, unknown[]> | undefined) ?? {};

  for (const [event, type] of HOOK_EVENTS) {
    const cmd = `pensive hook ${type}`;
    const entries = (hooks[event] as Array<{ hooks: Array<{ command: string }> }> | undefined) ?? [];
    const alreadyPresent = entries.some((e) => e.hooks?.some((h) => h.command === cmd));
    if (!alreadyPresent) {
      entries.push({ matcher: "", hooks: [{ type: "command", command: cmd }] });
    }
    hooks[event] = entries;
  }

  existing["hooks"] = hooks;
  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
}

/** .github/hooks/pensive.json — flat format */
function writeGithubHooks(projectRoot: string): void {
  const hooksDir = path.join(projectRoot, ".github", "hooks");
  const pensivePath = path.join(hooksDir, "pensive.json");
  fs.mkdirSync(hooksDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(pensivePath)) {
    try { existing = JSON.parse(fs.readFileSync(pensivePath, "utf-8")); } catch { /* ignore */ }
  }

  const hooks = (existing["hooks"] as Record<string, unknown[]> | undefined) ?? {};

  for (const [event, type] of HOOK_EVENTS) {
    const cmd = `pensive hook ${type}`;
    const entries = (hooks[event] as Array<Record<string, string>> | undefined) ?? [];
    const alreadyPresent = entries.some((e) => e["command"] === cmd);
    if (!alreadyPresent) {
      entries.push({ matcher: "", type: "command", command: cmd });
    }
    hooks[event] = entries;
  }

  existing["hooks"] = hooks;
  fs.writeFileSync(pensivePath, JSON.stringify(existing, null, 2));
}
