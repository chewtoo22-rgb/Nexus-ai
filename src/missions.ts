export type MissionStatus = "queued" | "planning" | "running" | "completed" | "failed" | "cancelled";

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  orchestrator: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  result?: string | null;
  error?: string | null;
}

export interface MissionStep {
  id: string;
  mission_id: string;
  step_index: number;
  agent: string;
  title: string;
  task: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: string | null;
  created_at: string;
  updated_at: string;
}

const ALLOWED_AGENTS = new Set(["sirius", "ana", "nova", "creative"]);

export function normalizeAgent(agent: string): string {
  const value = String(agent || "sirius").toLowerCase();
  if (value === "builder") return "ana";
  if (value === "researcher") return "nova";
  if (value === "analyst" || value === "gateway") return "sirius";
  return ALLOWED_AGENTS.has(value) ? value : "sirius";
}

export async function createMission(db: D1Database, goal: string, projectId?: string | null): Promise<Mission> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO missions (id, goal, status, orchestrator, project_id, created_at, updated_at) VALUES (?, ?, 'queued', 'sirius', ?, ?, ?)",
  ).bind(id, goal.trim(), projectId || null, now, now).run();
  return { id, goal: goal.trim(), status: "queued", orchestrator: "sirius", project_id: projectId || null, created_at: now, updated_at: now };
}

export async function getMission(db: D1Database, id: string): Promise<{ mission: Mission | null; steps: MissionStep[] }> {
  const mission = await db.prepare("SELECT * FROM missions WHERE id = ?").bind(id).first<Mission>();
  const steps = await db.prepare("SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY step_index ASC").bind(id).all<MissionStep>();
  return { mission, steps: steps.results };
}

export async function listMissions(db: D1Database): Promise<Mission[]> {
  const r = await db.prepare("SELECT * FROM missions ORDER BY updated_at DESC LIMIT 100").all<Mission>();
  return r.results;
}

export async function setMissionStatus(db: D1Database, id: string, status: MissionStatus, result?: string | null, error?: string | null): Promise<void> {
  await db.prepare("UPDATE missions SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?")
    .bind(status, result ?? null, error ?? null, new Date().toISOString(), id).run();
}

export async function addMissionStep(db: D1Database, missionId: string, index: number, agent: string, title: string, task: string): Promise<MissionStep> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalized = normalizeAgent(agent);
  await db.prepare(
    "INSERT INTO mission_steps (id, mission_id, step_index, agent, title, task, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
  ).bind(id, missionId, index, normalized, title, task, now, now).run();
  return { id, mission_id: missionId, step_index: index, agent: normalized, title, task, status: "queued", created_at: now, updated_at: now };
}

export async function setStepStatus(db: D1Database, id: string, status: MissionStep["status"], result?: string | null): Promise<void> {
  await db.prepare("UPDATE mission_steps SET status = ?, result = ?, updated_at = ? WHERE id = ?")
    .bind(status, result ?? null, new Date().toISOString(), id).run();
}
