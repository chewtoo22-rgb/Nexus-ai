export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_tool"
  | "awaiting_agent"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskRecord {
  id: string;
  idempotency_key: string | null;
  agent: string;
  model: string | null;
  capabilities: string[];
  status: TaskStatus;
  input: string;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const TASK_STATUSES: TaskStatus[] = [
  "queued",
  "running",
  "awaiting_tool",
  "awaiting_agent",
  "completed",
  "failed",
  "cancelled",
];

export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function parseCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).slice(0, 32);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).slice(0, 32) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    idempotency_key: row.idempotency_key == null ? null : String(row.idempotency_key),
    agent: String(row.agent),
    model: row.model == null ? null : String(row.model),
    capabilities: parseCapabilities(row.capabilities),
    status: String(row.status) as TaskStatus,
    input: String(row.input || ""),
    result: row.result == null ? null : String(row.result),
    error: row.error == null ? null : String(row.error),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function createTask(
  db: D1Database,
  input: { agent: string; model?: string | null; capabilities?: string[]; task: string; idempotencyKey?: string | null },
): Promise<{ task: TaskRecord; created: boolean }> {
  const key = input.idempotencyKey?.trim() || null;
  if (key) {
    const existing = await db.prepare("SELECT * FROM agent_tasks WHERE idempotency_key = ? LIMIT 1").bind(key).first<Record<string, unknown>>();
    if (existing) return { task: rowToTask(existing), created: false };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const capabilities = JSON.stringify((input.capabilities || []).map(String).slice(0, 32));
  await db.prepare(
    "INSERT INTO agent_tasks (id, idempotency_key, agent, model, capabilities, status, input, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)",
  ).bind(id, key, input.agent.trim().toLowerCase(), input.model || null, capabilities, input.task.trim(), now, now).run();

  return {
    created: true,
    task: {
      id,
      idempotency_key: key,
      agent: input.agent.trim().toLowerCase(),
      model: input.model || null,
      capabilities: JSON.parse(capabilities),
      status: "queued",
      input: input.task.trim(),
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
    },
  };
}

export async function getTask(db: D1Database, id: string): Promise<TaskRecord | null> {
  const row = await db.prepare("SELECT * FROM agent_tasks WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToTask(row) : null;
}

export async function updateTask(
  db: D1Database,
  id: string,
  status: TaskStatus,
  result?: string | null,
  error?: string | null,
): Promise<TaskRecord | null> {
  const current = await getTask(db, id);
  if (!current) return null;
  if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") return current;

  const now = new Date().toISOString();
  await db.prepare("UPDATE agent_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?")
    .bind(status, result ?? current.result, error ?? current.error, now, id).run();
  return getTask(db, id);
}

export async function cancelTask(db: D1Database, id: string): Promise<TaskRecord | null> {
  const task = await getTask(db, id);
  if (!task) return null;
  if (["completed", "failed", "cancelled"].includes(task.status)) return task;
  return updateTask(db, id, "cancelled", task.result, "Cancelled by requester");
}
