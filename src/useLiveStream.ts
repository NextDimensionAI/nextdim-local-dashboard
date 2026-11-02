import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, api, type ConvEvent, type TokenResponse } from "./api";

export interface LiveCall {
  id: string;
  channel: string;
  name: string;
  agent: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface RawLiveEvent {
  type?: string;
  channel?: string;
  conversation_id?: string;
  ts?: string;
  agent_id?: string;
  data?: Record<string, unknown>;
}

const RECONNECT_MS = 3000;
// Calls whose end the configurator never recorded stay "active"; past this age they're treated as stale.
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function isStale(call: LiveCall, now: number): boolean {
  return !call.endedAt && !!call.startedAt && now - new Date(call.startedAt).getTime() >= STALE_AFTER_MS;
}

const UNFINISHED_STATUSES = new Set(["active", "in_progress"]);
// While a call is unfinished its row is re-read this often, until post-call writes the final status.
export const UNFINISHED_POLL_MS = 10_000;

export function isUnfinished(row: { call_status: string | null; call_start_time: string | null }, now: number): boolean {
  if (!UNFINISHED_STATUSES.has(row.call_status ?? "")) return false;
  return !row.call_start_time || now - new Date(row.call_start_time).getTime() < STALE_AFTER_MS;
}

export function liveCount(calls: Record<string, LiveCall>, now: number): number {
  return Object.values(calls).filter((call) => !call.endedAt && !isStale(call, now)).length;
}

export type LiveStream = ReturnType<typeof useLiveStream>;
const LIVE_EVENT_TYPES = [
  "call_started",
  "call_ended",
  "transcript_update",
  "tool_call",
  "agent_switch",
  "mode_changed",
  "agent_task_started",
  "agent_task_completed",
  "notification",
];

const CATEGORY_BY_TYPE: Record<string, [string, string]> = {
  transcript_update: ["transcript", "updated"],
  tool_call: ["tool_call", "tool_call"],
  agent_switch: ["handoff", "agent_switch"],
  call_started: ["conversation", "started"],
  call_ended: ["conversation", "ended"],
  agent_task_started: ["agent_task", "started"],
  agent_task_completed: ["agent_task", "completed"],
};

let seq = 0;

function toConvEvent(raw: RawLiveEvent): ConvEvent {
  const type = raw.type ?? "event";
  const [category, eventType] = CATEGORY_BY_TYPE[type] ?? [type, type];
  return {
    event_id: `live-${++seq}`,
    category,
    event_type: eventType,
    timestamp: raw.ts ?? new Date().toISOString(),
    source: "live",
    agent_id: raw.agent_id ?? null,
    data: raw.data ?? {},
  };
}

function callFromSnapshot(item: Record<string, unknown>): LiveCall {
  const first = String(item.patient_first_name ?? "");
  const last = String(item.patient_last_name ?? "");
  return {
    id: String(item.id),
    channel: String(item.channel ?? "call"),
    name: [first, last].filter(Boolean).join(" ") || String(item.caller_name ?? item.phone_number ?? item.caller ?? "Unknown caller"),
    agent: String(item.agent_display_name ?? item.agent ?? ""),
    startedAt: (item.call_start_time as string | null) ?? null,
    endedAt: (item.call_end_time as string | null) ?? null,
  };
}

/** One shared live stream for the tenant: the calls in progress and every event they emit. */
export function useLiveStream(tenant: string) {
  const [calls, setCalls] = useState<Record<string, LiveCall>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const listeners = useRef(new Set<(callId: string, event: ConvEvent) => void>());
  const queryClient = useQueryClient();

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const retry = () => {
      if (cancelled) return;
      source?.close();
      setConnected(false);
      timer = setTimeout(connect, RECONNECT_MS);
    };

    async function connect() {
      try {
        const { token } = await api<TokenResponse>("/v1/live/token", tenant);
        if (cancelled) return;
        source = new EventSource(`${API}/v1/live/stream?token=${encodeURIComponent(token)}`);
        source.onopen = () => {
          setConnected(true);
          setError("");
        };
        source.onerror = () => {
          setError("Live stream dropped; reconnecting…");
          retry();
        };
        source.addEventListener("snapshot", (message) => {
          const items = (JSON.parse((message as MessageEvent).data).items ?? []) as Record<string, unknown>[];
          setCalls(Object.fromEntries(items.map((item) => [String(item.id), callFromSnapshot(item)])));
        });
        for (const type of LIVE_EVENT_TYPES) {
          source.addEventListener(type, (message) => handle(type, JSON.parse((message as MessageEvent).data) as RawLiveEvent));
        }
      } catch (e) {
        setError(`Live token failed: ${String(e)}`);
        retry();
      }
    }

    function handle(type: string, raw: RawLiveEvent) {
      const id = raw.conversation_id ?? String(raw.data?.room_sid ?? "");
      if (!id) return;
      if (type === "call_started") {
        setCalls((prev) => ({
          ...prev,
          [id]: {
            id,
            channel: raw.channel ?? "call",
            name: String(raw.data?.caller ?? raw.data?.phone ?? "New caller"),
            agent: String(raw.data?.agent_display_name ?? raw.agent_id ?? ""),
            startedAt: raw.ts ?? new Date().toISOString(),
            endedAt: null,
          },
        }));
      }
      if (type === "call_ended") {
        setCalls((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], endedAt: raw.ts ?? new Date().toISOString() } } : prev));
      }
      if (type === "call_started" || type === "call_ended") {
        queryClient.invalidateQueries({ queryKey: ["conversations", tenant] });
        queryClient.invalidateQueries({ queryKey: ["conv", tenant, id] });
      }
      const event = { ...toConvEvent(raw), type };
      for (const listener of listeners.current) listener(id, event);
    }

    setCalls({});
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [tenant, queryClient]);

  const subscribe = useCallback((listener: (callId: string, event: ConvEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { calls, connected, error, subscribe };
}
