export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_tool"
  | "awaiting_agent"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
export const ACTIVE_STATUSES = new Set<TaskStatus>(["running", "awaiting_tool", "awaiting_agent"]);

export interface TaskContract {
  id: string;
  user_id: string;
  idempotency_key: string | null;
  parent_task_id: string | null;
  agent_id: string;
  model: string | null;
  capability: string | null;
  status: TaskStatus;
  input_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  timeout_ms: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface TaskCreateInput {
  userId: string;
  agentId: string;
  input: unknown;
  idempotencyKey?: string | null;
  parentTaskId?: string | null;
  model?: string | null;
  capability?: string | null;
  maxAttempts?: number;
  timeoutMs?: number;
}

const AGENTS = new Set(["nexus", "sirius", "ana", "nova", "creative", "builder", "researcher", "analyst"]);
const CAPABILITIES = new Set(["chat", "research", "build", "creative", "browser", "mcp", "code", "orchestration"]);
const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["awaiting_tool", "awaiting_agent", "completed", "failed", "cancelled"]),
  awaiting_tool: new Set(["running", "failed", "cancelled"]),
  awaiting_agent: new Set(["running", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

export function normalizeAgentId(agentId: unknown): string {
  const value = String(agentId || "nexus").toLowerCase();
  return AGENTS.has(value) ? value : "nexus";
}

export function normalizeCapability(capability: unknown): string | null {
  if (capability == null || capability === "") return null;
  const value = String(capability).toLowerCase();
  return CAPABILITIES.has(value) ? value : null;
}

export function sanitizeInput(input: unknown): string {
  // Task payloads are intentionally JSON-only. Callers must pass references to secrets,
  // not secret values; this module does not persist headers, tokens, cookies, or credentials.
  return JSON.stringify(input ?? null);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

export function createTaskContract(input: TaskCreateInput): Omit<TaskContract, "created_at" | "updated_at"> & { created_at: string; updated_at: string } {
  const now = new Date().toISOString();
  const maxAttempts = boundedInt(input.maxAttempts, 2, 1, 3);
  const timeoutMs = boundedInt(input.timeoutMs, 120000, 1000, 300000);
  return {
    id: crypto.randomUUID(),
    user_id: input.userId,
    idempotency_key: input.idempotencyKey ?? null,
    parent_task_id: input.parentTaskId ?? null,
    agent_id: normalizeAgentId(input.agentId),
    model: input.model ?? null,
    capability: normalizeCapability(input.capability),
    status: "queued",
    input_json: sanitizeInput(input.input),
    result_json: null,
    error_code: null,
    error_message: null,
    attempts: 0,
    max_attempts: maxAttempts,
    timeout_ms: timeoutMs,
    created_at: now,
    started_at: null,
    completed_at: null,
    updated_at: now,
  };
}

export async function getTask(db: D1Database, userId: string, taskId: string): Promise<TaskContract | null> {
  return db.prepare("SELECT * FROM orchestration_tasks WHERE id = ? AND user_id = ?").bind(taskId, userId).first<TaskContract>();
}

export async function createTask(db: D1Database, input: TaskCreateInput): Promise<TaskContract> {
  if (!input.userId) throw new Error("userId required");
  const task = createTaskContract(input);
  await db.prepare(`
    INSERT INTO orchestration_tasks
      (id,user_id,idempotency_key,parent_task_id,agent_id,model,capability,status,input_json,max_attempts,timeout_ms,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    task.id, task.user_id, task.idempotency_key, task.parent_task_id, task.agent_id, task.model,
    task.capability, task.status, task.input_json, task.max_attempts, task.timeout_ms, task.created_at, task.updated_at,
  ).run();
  await appendTaskEvent(db, task.id, task.user_id, "task.created", { agent_id: task.agent_id, capability: task.capability });
  return task as TaskContract;
}

export async function createOrGetIdempotentTask(db: D1Database, input: TaskCreateInput): Promise<{ task: TaskContract; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await db.prepare("SELECT * FROM orchestration_tasks WHERE user_id = ? AND idempotency_key = ?")
      .bind(input.userId, input.idempotencyKey).first<TaskContract>();
    if (existing) return { task: existing, created: false };
  }
  return { task: await createTask(db, input), created: true };
}

export async function transitionTask(
  db: D1Database,
  userId: string,
  taskId: string,
  to: TaskStatus,
  details?: { result?: unknown; errorCode?: string; errorMessage?: string },
): Promise<TaskContract> {
  const current = await getTask(db, userId, taskId);
  if (!current) throw Object.assign(new Error("Task not found"), { status: 404 });
  if (!canTransition(current.status, to)) throw Object.assign(new Error(`Invalid task transition: ${current.status} -> ${to}`), { status: 409 });
  if (current.status === to) return current;

  const now = new Date().toISOString();
  const startedAt = to === "running" && !current.started_at ? now : current.started_at;
  const completedAt = TERMINAL_STATUSES.has(to) ? now : current.completed_at;
  const resultJson = details?.result === undefined ? current.result_json : JSON.stringify(details.result);
  const errorCode = details?.errorCode ?? current.error_code;
  const errorMessage = details?.errorMessage ?? current.error_message;
  const attempts = to === "running" ? current.attempts + 1 : current.attempts;

  if (to === "running" && attempts > current.max_attempts) {
    throw Object.assign(new Error("Maximum task attempts exceeded"), { status: 429 });
  }

  await db.prepare(`
    UPDATE orchestration_tasks
    SET status=?, result_json=?, error_code=?, error_message=?, attempts=?, started_at=?, completed_at=?, updated_at=?
    WHERE id=? AND user_id=?
  `).bind(to, resultJson, errorCode, errorMessage, attempts, startedAt, completedAt, now, taskId, userId).run();
  await appendTaskEvent(db, taskId, userId, `task.${to}`, { result: details?.result, error_code: errorCode, error_message: errorMessage });
  const updated = await getTask(db, userId, taskId);
  if (!updated) throw new Error("Task disappeared after update");
  return updated;
}

export async function appendTaskEvent(db: D1Database, taskId: string, userId: string, eventType: string, data?: unknown): Promise<void> {
  await db.prepare("INSERT INTO orchestration_events (id,task_id,user_id,event_type,data_json) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), taskId, userId, eventType, data === undefined ? null : JSON.stringify(data)).run();
}

export async function listTaskEvents(db: D1Database, userId: string, taskId: string): Promise<Array<Record<string, unknown>>> {
  const result = await db.prepare("SELECT * FROM orchestration_events WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC")
    .bind(taskId, userId).all<Record<string, unknown>>();
  return result.results;
}
