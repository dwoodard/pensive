import * as fs from "fs";
import * as path from "path";

export interface ModelConfig {
  provider: "lmstudio" | "ollama" | "openai" | "anthropic";
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface ProjectConfig {
  projectId: string;
  projectName: string;
  remoteUrl: string;
  repoPath: string;
  createdAt: string;
  llm: ModelConfig;
  embedding: ModelConfig;
}

export const PROVIDER_DEFAULTS: Record<string, Partial<ModelConfig>> = {
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: "local-model",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3.2",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-4-5-20251001",
  },
};

export const DEFAULT_LLM: ModelConfig = {
  provider: "lmstudio",
  baseUrl: "http://localhost:1234/v1",
  apiKey: "",
  model: "local-model",
};

export const DEFAULT_EMBEDDING: ModelConfig = {
  provider: "lmstudio",
  baseUrl: "http://localhost:1234/v1",
  apiKey: "",
  model: "text-embedding-nomic-embed-text-v1.5",
};

export function readProjectConfig(projectMemoryDir: string): ProjectConfig {
  const configPath = path.join(projectMemoryDir, "config.json");
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  // Backfill defaults for older configs missing llm/embedding
  if (!parsed.llm) parsed.llm = { ...DEFAULT_LLM };
  if (!parsed.embedding) parsed.embedding = { ...DEFAULT_EMBEDDING };
  return parsed;
}

export function writeProjectConfig(projectMemoryDir: string, config: ProjectConfig): void {
  const configPath = path.join(projectMemoryDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
