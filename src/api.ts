export const API = "/api";

const TENANT_KEY = "nextdim-dashboard.tenant";

export function getTenant(): string {
  try {
    return localStorage.getItem(TENANT_KEY) || "nyga";
  } catch {
    return "nyga";
  }
}

export function setTenant(tenant: string): void {
  try {
    localStorage.setItem(TENANT_KEY, tenant);
  } catch {
    // Private mode: the switch still applies for this page load.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, tenant: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "X-Tenant-Id": tenant, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, `${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total_count: number | null;
}

export interface ConversationRow {
  id: string;
  channel: string | null;
  channel_direction: string | null;
  phone_number: string | null;
  caller_name: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_status: string | null;
  call_start_time: string | null;
  call_duration: number | null;
  call_status: string | null;
  urgency: string | null;
  call_sentiment: string | null;
  primary_intent: string | null;
  abrupt_end: boolean | null;
  escalation_requested: boolean | null;
  action_performed: boolean | null;
  agent_display_name: string | null;
  agents_display_names: string[] | null;
  tasks_count: number | null;
}

export interface ConversationDetail extends ConversationRow {
  status: string | null;
  call_end_time: string | null;
  summary: string | null;
  call_reason: string | null;
  secondary_intent: string | null;
  ai_success: boolean | null;
  ai_success_reason: string | null;
  call_complexity: string | null;
  questions_not_answered: string[] | null;
  outcome_task: string[] | null;
  information_collected: Record<string, unknown> | null;
  recording_link: string | null;
}

export interface ConvEvent {
  event_id: string;
  category: string;
  event_type: string;
  type?: string;
  timestamp: string;
  source: string | null;
  direction?: string | null;
  agent_id: string | null;
  data: Record<string, unknown>;
}

export interface LatencyTurn {
  turn_index: number;
  role: string;
  e2e_latency_ms: number | null;
  llm_latency_ms: number | null;
  tts_latency_ms: number | null;
  stt_latency_ms: number | null;
  ttft_ms: number | null;
}

export interface Task {
  id?: string;
  _id?: string;
  title?: string | null;
  task_type?: string | null;
  type?: string | null;
  status?: string | null;
  urgency?: string | null;
  summary?: string | null;
  description?: string | null;
  created_at?: string | null;
  task_status?: string | null;
  tool_name?: string | null;
  event_description?: string | null;
  patient_intent?: string | null;
}

export interface TokenResponse {
  token: string;
  expires_in: number;
}
