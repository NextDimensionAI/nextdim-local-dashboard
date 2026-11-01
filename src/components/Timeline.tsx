import { useState, type MouseEvent } from "react";
import type { ConvEvent } from "../api";
import { formatTime, humanize, prettyJson } from "../format";
import { AgentTaskCard, AgentTaskEnd } from "./AgentTaskCard";
import { CallOrigin, EventTime } from "./EventTime";

const RAIL_GAP = 10;

interface Run {
  started?: ConvEvent;
  completed?: ConvEvent;
}

type Row =
  | { kind: "event"; event: ConvEvent }
  | { kind: "task-start"; run: Run; runId: string }
  | { kind: "task-end"; run: Run; runId: string };

interface RailMark {
  lane: number;
  edge: "start" | "end" | "through";
}

interface TimelineProps {
  events: ConvEvent[];
  /** Call start in epoch ms; when given, times show as m:ss into the call. */
  origin?: number;
  /** Seconds into the recording where each transcript turn starts, by event id. */
  starts?: Map<string, number>;
  onSeek?: (seconds: number) => void;
}

export function Timeline({ events, origin, starts, onSeek }: TimelineProps) {
  if (events.length === 0) return <p className="muted pad">Nothing yet.</p>;

  const runs = groupRuns(events);
  const rows = toRows(events, runs);
  const rails = assignRails(rows);
  const lanes = Math.max(0, ...rails.flat().map((mark) => mark.lane + 1));

  return (
    <CallOrigin.Provider value={origin ?? null}>
    <ol className="timeline" style={{ ["--rail-pad" as string]: `${lanes * RAIL_GAP}px` }}>
      {rows.map((row, i) => (
        <li key={rowKey(row)} className={`tl-row ${lanes ? "railed" : ""}`}>
          {rails[i].map((mark) => (
            <span key={mark.lane} className={`rail ${mark.edge}`} style={{ left: mark.lane * RAIL_GAP }} aria-hidden />
          ))}
          {row.kind === "event" ? (
            <TimelineItem event={row.event} start={starts?.get(row.event.event_id)} onSeek={onSeek} />
          ) : row.kind === "task-start" ? (
            <AgentTaskCard started={row.run.started} completed={row.run.completed} />
          ) : (
            <AgentTaskEnd run={row.run} />
          )}
        </li>
      ))}
    </ol>
    </CallOrigin.Provider>
  );
}

function runIdOf(event: ConvEvent): string {
  return String(event.data?.run_id ?? event.event_id);
}

function isCompletion(event: ConvEvent): boolean {
  return event.data?.phase === "completed" || event.event_type === "completed";
}

function groupRuns(events: ConvEvent[]): Map<string, Run> {
  const runs = new Map<string, Run>();
  for (const event of events) {
    if (event.category !== "agent_task") continue;
    const id = runIdOf(event);
    runs.set(id, { ...runs.get(id), [isCompletion(event) ? "completed" : "started"]: event });
  }
  return runs;
}

// A run shows as a card where it started and a marker where it ended. A completion whose
// start is outside the loaded window has no span to draw, so it shows as a lone card.
function toRows(events: ConvEvent[], runs: Map<string, Run>): Row[] {
  const rows: Row[] = [];
  for (const event of events) {
    if (event.category !== "agent_task") {
      rows.push({ kind: "event", event });
      continue;
    }
    const runId = runIdOf(event);
    const run = runs.get(runId) ?? {};
    if (!isCompletion(event)) rows.push({ kind: "task-start", run, runId });
    else if (run.started) rows.push({ kind: "task-end", run, runId });
    else rows.push({ kind: "task-start", run, runId });
  }
  return rows;
}

// Each open run holds a lane from its start row to its end row (or to the bottom while running).
function assignRails(rows: Row[]): RailMark[][] {
  const laneOf = new Map<string, number>();
  const used: boolean[] = [];
  return rows.map((row) => {
    let opened: string | null = null;
    if (row.kind === "task-start" && row.run.started) {
      const lane = used.findIndex((busy) => !busy);
      const free = lane === -1 ? used.length : lane;
      used[free] = true;
      laneOf.set(row.runId, free);
      opened = row.runId;
    }
    const marks: RailMark[] = [...laneOf.entries()].map(([runId, lane]) => ({
      lane,
      edge: runId === opened ? "start" : row.kind === "task-end" && row.runId === runId ? "end" : "through",
    }));
    if (row.kind === "task-end") {
      const lane = laneOf.get(row.runId);
      if (lane !== undefined) used[lane] = false;
      laneOf.delete(row.runId);
    }
    return marks;
  });
}

function rowKey(row: Row): string {
  if (row.kind === "event") return row.event.event_id;
  return `${row.kind}-${row.runId}`;
}

interface TimelineItemProps {
  event: ConvEvent;
  start?: number;
  onSeek?: (seconds: number) => void;
}

function TimelineItem({ event, start, onSeek }: TimelineItemProps) {
  const d = event.data ?? {};
  const kind = event.event_type ?? event.type;

  if (event.category === "transcript") {
    const role = String(d.role ?? "");
    const isCaller = role === "user" || role === "caller";
    const canSeek = onSeek != null && start != null;
    // The text itself stays selectable: only clicks around it seek, and never one that ends a selection.
    const seek = (e: MouseEvent) => {
      if (!canSeek || (e.target as HTMLElement).closest(".turn-text") || window.getSelection()?.toString()) return;
      onSeek(start);
    };
    const time = <EventTime iso={event.timestamp} seconds={start} />;
    return (
      <div className={`turn ${isCaller ? "caller" : "agent"} ${canSeek ? "seekable" : ""}`} onClick={seek}>
        <div className="bubble">
          <span className="who">{isCaller ? "Caller" : "Agent"}</span>
          {canSeek ? (
            <button className="time-seek" aria-label={`Play from ${formatTime(start)}`}>
              {time}
            </button>
          ) : (
            time
          )}
          <p className="turn-text">{String(d.text ?? "")}</p>
        </div>
      </div>
    );
  }

  if (kind === "tool_call") {
    return <ToolCall event={event} />;
  }

  if (event.category === "handoff") {
    const from = d.from_agent_name ?? d.from_agent_id;
    const to = d.to_agent_name ?? d.to_agent_id;
    return (
      <div className="marker handoff">
        <EventTime iso={event.timestamp} />
        <strong>
          {humanize(String(from ?? ""))} → {humanize(String(to ?? ""))}
        </strong>
        {d.reason ? <span className="muted">{String(d.reason)}</span> : null}
      </div>
    );
  }

  return <Generic event={event} />;
}

// Post-call tool events name the tool in `tool` and carry only a JSON `tool_result`.
function toolStatus(d: Record<string, unknown>, output: unknown): string {
  if (d.status) return String(d.status);
  const parsed = typeof output === "string" ? safeParse(output) : output;
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    return (parsed as { success: unknown }).success ? "ok" : "failed";
  }
  return "";
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ToolCall({ event }: { event: ConvEvent }) {
  const [open, setOpen] = useState(false);
  const d = event.data ?? {};
  const name = String(d.tool_name ?? d.tool ?? "tool");
  const input = d.args ?? d.input;
  const output = d.result ?? d.output ?? d.tool_result;
  const status = toolStatus(d, output);
  const failed = status && status !== "ok" && status !== "success";
  const latency = typeof d.latency_ms === "number" ? `${Math.round(d.latency_ms)} ms` : "";
  return (
    <div className={`tool ${failed ? "failed" : ""}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="tool-name">{name}</span>
        {event.category === "post_call" ? <span className="tag">post-call</span> : null}
        <span className={`status ${failed ? "bad" : "good"}`}>{status || "—"}</span>
        <span className="muted">{latency}</span>
        <EventTime iso={event.timestamp} />
      </button>
      {open ? (
        <div className="tool-body">
          <Section label="Input" value={input} />
          <Section label="Output" value={output} />
        </div>
      ) : null}
    </div>
  );
}

function Generic({ event }: { event: ConvEvent }) {
  const [open, setOpen] = useState(false);
  const kind = event.event_type ?? event.type;
  return (
    <div className={`marker ${kind === "api_failed" || kind === "not_found" ? "warn" : ""}`}>
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        <EventTime iso={event.timestamp} />
        <strong>{humanize(event.category)}</strong>
        <span className="muted">{humanize(kind)}</span>
      </button>
      {open ? <pre className="code">{prettyJson(event.data)}</pre> : null}
    </div>
  );
}

function Section({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <div className="label">{label}</div>
      <pre className="code">{prettyJson(value)}</pre>
    </div>
  );
}
