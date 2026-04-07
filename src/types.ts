export type MemoryKind =
  | "summary"
  | "decision"
  | "fact"
  | "reference"
  | "task"
  | "question";

export type TaskStatus = "pending" | "active" | "done" | "blocked";

export interface Project {
  id: string;
  name: string;
  remoteUrl: string;
  repoPath: string;
  createdAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  startedAt: string;
  title: string;
  summary: string;
  archived?: boolean;
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  title: string;
  summary: string;
  recallCue: string;
  projectId: string;
  sessionId: string;
  createdAt: string;
  artifactId?: string;
  embedding?: number[];
}

export interface Task {
  id: string;
  title: string;
  summary: string;
  status: TaskStatus;
  taskOrder: number;
  projectId: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  type: string;
  title: string;
  summary: string;
  location: string;
  projectId: string;
  sessionId: string;
  createdAt: string;
}

export interface Turn {
  client: string;
  cwd: string;
  sessionId: string;
  timestamp: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  files?: string[];
}

export interface ScoredMemory extends Memory {
  score: number;
  sessionTitle?: string;
  sessionSummary?: string;
}

export interface ContextBundle {
  activeTask: Task | null;
  nextTasks: Task[];
  keyMemories: ScoredMemory[];
  sessionSummary: string;
}
