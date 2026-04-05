import kuzu from "kuzu";
import * as fs from "fs";
import * as path from "path";

const _cache = new Map<string, {
  db: InstanceType<typeof kuzu.Database>;
  conn: InstanceType<typeof kuzu.Connection>;
}>();

export function getDb(projectMemoryDir: string): {
  db: InstanceType<typeof kuzu.Database>;
  conn: InstanceType<typeof kuzu.Connection>;
} {
  const cached = _cache.get(projectMemoryDir);
  if (cached) return cached;

  // Explorer expects KUZU_DIR/database.kz — create the parent dir and use that filename
  const graphDir = path.join(projectMemoryDir, "graph");
  fs.mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, "database.kz");
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  _cache.set(projectMemoryDir, { db, conn });
  return { db, conn };
}

export async function applySchema(
  conn: InstanceType<typeof kuzu.Connection>
): Promise<void> {
  const statements = [
    `CREATE NODE TABLE IF NOT EXISTS Project(
      id STRING,
      name STRING,
      remoteUrl STRING,
      repoPath STRING,
      createdAt STRING,
      PRIMARY KEY (id)
    )`,
    `CREATE NODE TABLE IF NOT EXISTS Session(
      id STRING,
      projectId STRING,
      startedAt STRING,
      summary STRING,
      PRIMARY KEY (id)
    )`,
    `CREATE NODE TABLE IF NOT EXISTS Memory(
      id STRING,
      kind STRING,
      title STRING,
      summary STRING,
      recallCue STRING,
      projectId STRING,
      sessionId STRING,
      createdAt STRING,
      status STRING,
      artifactId STRING,
      PRIMARY KEY (id)
    )`,
    `CREATE NODE TABLE IF NOT EXISTS Artifact(
      id STRING,
      type STRING,
      title STRING,
      summary STRING,
      location STRING,
      projectId STRING,
      sessionId STRING,
      createdAt STRING,
      PRIMARY KEY (id)
    )`,
    `CREATE REL TABLE IF NOT EXISTS HAS_SESSION(FROM Project TO Session)`,
    `CREATE REL TABLE IF NOT EXISTS HAS_MEMORY(FROM Session TO Memory)`,
    `CREATE REL TABLE IF NOT EXISTS PRODUCED(FROM Session TO Artifact)`,
    `CREATE REL TABLE IF NOT EXISTS REFERS_TO(FROM Memory TO Artifact)`,
    `CREATE REL TABLE IF NOT EXISTS SUPERSEDES(FROM Memory TO Memory)`,
    `CREATE REL TABLE IF NOT EXISTS RELATED_TO(FROM Memory TO Memory)`,
  ];

  for (const stmt of statements) {
    await conn.query(stmt);
  }
}
