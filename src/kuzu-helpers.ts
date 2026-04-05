import type kuzu from "kuzu";

type QueryResult = InstanceType<typeof kuzu.QueryResult>;

export function escape(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function queryAll(
  conn: InstanceType<typeof kuzu.Connection>,
  cypher: string
): Promise<Record<string, unknown>[]> {
  const result = await conn.query(cypher);
  const qr = Array.isArray(result) ? result[0] : result;
  return (qr as QueryResult).getAll();
}
