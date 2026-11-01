import { useState, type ReactNode } from "react";
import type { ConvEvent } from "../api";
import { clock, duration, humanize, prettyJson } from "../format";
import { AgentTaskCard } from "./AgentTaskCard";

type Data = Record<string, unknown>;

interface Group {
  key: string;
  label: string;
  matches: (event: ConvEvent) => boolean;
}

const GROUPS: Group[] = [
  { key: "call", label: "Call", matches: (e) => e.category === "conversation" },
  { key: "tools", label: "Tools", matches: (e) => e.category === "tool_call" || kindOf(e) === "tool_call" },
  { key: "integrations", label: "Integrations", matches: (e) => e.category === "integration_call" },
  { key: "tasks", label: "Agent tasks", matches: (e) => e.category === "agent_task" },
  { key: "data", label: "Data", matches: (e) => e.category === "user_data" },
  { key: "handoffs", label: "Handoffs", matches: (e) => e.category === "handoff" },
  { key: "post_call", label: "Post-call", matches: (e) => e.category === "post_call" && kindOf(e) !== "tool_call" },
];

function kindOf(event: ConvEvent): string {
  return event.event_type ?? event.type ?? "";
}

function groupOf(event: ConvEvent): string {
  return GROUPS.find((g) => g.matches(event))?.key ?? "other";
}

/** Every non-transcript event for a call, one readable row each, filterable by kind. */
export function EventLog({ events, callStart }: { events: ConvEvent[]; callStart: string | null | undefined }) {
  const [filter, setFilter] = useState<string | null>(null);
  const rows = mergeAgentTasks(events.filter((e) => e.category !== "transcript"));
  if (rows.length === 0) return <p className="muted pad">No events.</p>;

  const origin = new Date(callStart ?? rows[0].event.timestamp).getTime();
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(groupOf(row.event), (counts.get(groupOf(row.event)) ?? 0) + 1);
  const shown = filter ? rows.filter((row) => groupOf(row.event) === filter) : rows;

  return (
    <>
      <div className="filters" role="group" aria-label="Filter events">
        <FilterChip label="All" count={rows.length} on={filter === null} onClick={() => setFilter(null)} />
        {[...GROUPS, { key: "other", label: "Other" }].map((g) =>
          counts.get(g.key) ? (
            <FilterChip key={g.key} group={g.key} label={g.label} count={counts.get(g.key)!} on={filter === g.key} onClick={() => setFilter(g.key)} />
          ) : null,
        )}
      </div>
      <ol className="events">
        {shown.map((row) => (
          <li key={row.event.event_id} className={`ev ev-${groupOf(row.event)}`}>
            <span className="ev-offset" title={clock(row.event.timestamp)}>
              {offset(row.event.timestamp, origin)}
            </span>
            <span className="ev-dot" aria-hidden />
            <div className="ev-body">
              {row.completed !== undefined ? <AgentTaskCard started={row.event} completed={row.completed ?? undefined} /> : <EventCard event={row.event} />}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function FilterChip({ label, count, on, onClick, group }: { label: string; count: number; on: boolean; onClick: () => void; group?: string }) {
  return (
    <button className={`filter ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      {group ? <span className={`ev-swatch ev-${group}`} aria-hidden /> : null}
      {label}
      <span className="filter-count">{count}</span>
    </button>
  );
}

interface Row {
  event: ConvEvent;
  // Set only for agent-task runs: the completion event, or null while the run is open.
  completed?: ConvEvent | null;
}

// A run's started and completed events read as one card, placed where the run started.
function mergeAgentTasks(events: ConvEvent[]): Row[] {
  const runOf = (e: ConvEvent) => String(e.data?.run_id ?? e.event_id);
  const isDone = (e: ConvEvent) => e.data?.phase === "completed" || kindOf(e) === "completed";
  const done = new Map(events.filter((e) => e.category === "agent_task" && isDone(e)).map((e) => [runOf(e), e]));
  const startedRuns = new Set(events.filter((e) => e.category === "agent_task" && !isDone(e)).map(runOf));
  const rows: Row[] = [];
  for (const event of events) {
    if (event.category !== "agent_task") rows.push({ event });
    else if (!isDone(event)) rows.push({ event, completed: done.get(runOf(event)) ?? null });
    else if (!startedRuns.has(runOf(event))) rows.push({ event: event, completed: event });
  }
  return rows;
}

function offset(iso: string, origin: number): string {
  const seconds = Math.max(0, Math.round((new Date(iso).getTime() - origin) / 1000));
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function EventCard({ event }: { event: ConvEvent }) {
  const d = (event.data ?? {}) as Data;
  switch (groupOf(event)) {
    case "call":
      return kindOf(event) === "ended" || d.phase === "ended" ? <CallEnded event={event} d={d} /> : <CallStarted event={event} d={d} />;
    case "tools":
      return <ToolEvent event={event} d={d} />;
    case "integrations":
      return <IntegrationEvent event={event} d={d} />;
    case "data":
      return <DataEvent event={event} d={d} />;
    case "handoffs":
      return <HandoffEvent event={event} d={d} />;
    case "post_call":
      return <PostCallEvent event={event} d={d} />;
    default:
      return (
        <Card title={humanize(event.category)} summary={humanize(kindOf(event))} time={event.timestamp}>
          <pre className="code">{prettyJson(d)}</pre>
        </Card>
      );
  }
}

interface CardProps {
  title: ReactNode;
  summary?: ReactNode;
  chips?: ReactNode;
  meta?: ReactNode;
  time: string;
  tone?: "bad" | "warn";
  // The summary only previews the detail, so it hides once the card is open.
  previewOnly?: boolean;
  children?: ReactNode;
}

function Card({ title, summary, chips, meta, time, tone, previewOnly, children }: CardProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ev-card ${tone ?? ""} ${open ? "open" : ""}`}>
      <button className="ev-head" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!children}>
        <span className="chev">{children ? (open ? "▾" : "▸") : ""}</span>
        <span className="ev-title">{title}</span>
        {chips}
        {meta ? <span className="ev-meta">{meta}</span> : null}
        <span className="time">{clock(time)}</span>
      </button>
      {summary && !(open && previewOnly) ? <div className="ev-summary">{summary}</div> : null}
      {open && children ? <div className="ev-detail">{children}</div> : null}
    </div>
  );
}

function CallStarted({ event, d }: { event: ConvEvent; d: Data }) {
  const meta = (d.metadata ?? {}) as Data;
  return (
    <Card
      title="Call started"
      summary={[str(d.caller_e164) && `From ${d.caller_e164}`, str(meta.dialed_e164) && `to ${meta.dialed_e164}`, humanize(str(d.agent_id ?? event.agent_id))]
        .filter(Boolean)
        .join(" · ")}
      time={event.timestamp}
    >
      <Facts
        entries={{
          Agent: d.agent_id ?? event.agent_id,
          Behavior: meta.behavior,
          Caller: d.caller_e164,
          Dialed: meta.dialed_e164,
          Direction: event.direction,
          "Manifest version": d.manifest_version,
          Room: d.room_sid,
        }}
      />
    </Card>
  );
}

function CallEnded({ event, d }: { event: ConvEvent; d: Data }) {
  const meta = (d.metadata ?? {}) as Data;
  const seconds =
    typeof d.duration_seconds === "number"
      ? d.duration_seconds
      : d.started_at && d.ended_at
        ? (new Date(String(d.ended_at)).getTime() - new Date(String(d.started_at)).getTime()) / 1000
        : null;
  return (
    <Card
      title="Call ended"
      summary={[d.ended_by ? `By ${d.ended_by}` : "", seconds != null ? duration(seconds) : ""].filter(Boolean).join(" · ")}
      time={event.timestamp}
    >
      <Facts entries={{ "Ended by": d.ended_by, Duration: seconds != null ? duration(seconds) : null, Recording: d.recording_url, Log: d.log_url, Egress: d.egress_id }} mono />
      {meta.information_collected ? <Block label="Information collected" value={meta.information_collected} /> : null}
    </Card>
  );
}

function ToolEvent({ event, d }: { event: ConvEvent; d: Data }) {
  const name = str(d.tool_name ?? d.tool) || "tool";
  const output = d.result ?? d.output ?? d.tool_result;
  const status = toolStatus(d, output);
  const failed = !!status && !["ok", "success"].includes(status);
  return (
    <Card
      title={
        <>
          <span className="ev-kind">Tool</span>
          <span className="mono-strong">{name}</span>
        </>
      }
      chips={
        <>
          {event.category === "post_call" ? <span className="tag">post-call</span> : null}
          {status ? <span className={`chip ${failed ? "bad" : "good"}`}>{humanize(status)}</span> : null}
        </>
      }
      meta={ms(d.latency_ms)}
      summary={argsSummary(d.args ?? d.input)}
      tone={failed ? "bad" : undefined}
      time={event.timestamp}
    >
      <Block label="Input" value={d.args ?? d.input} />
      <Block label="Output" value={output} />
    </Card>
  );
}

function IntegrationEvent({ event, d }: { event: ConvEvent; d: Data }) {
  const status = str(d.status) || kindOf(event);
  const tone = status === "ok" || status === "success" ? undefined : status === "not_found" ? "warn" : "bad";
  const route = [str(d.method), str(d.path)].filter(Boolean).join(" ");
  return (
    <Card
      title={
        <>
          <span className="ev-kind">Integration</span>
          <span className="mono-strong">{str(d.tool_name) || str(d.capability) || "call"}</span>
        </>
      }
      chips={
        <>
          <span className={`chip ${tone ?? "good"}`}>{humanize(status)}</span>
          {d.is_mutating ? <span className="chip warn">Writes</span> : null}
        </>
      }
      meta={[d.status_code != null ? `HTTP ${d.status_code}` : "", ms(d.latency_ms)].filter(Boolean).join(" · ")}
      summary={
        <>
          {route ? <span className="mono">{route}</span> : null}
          {d.error_message ? <span className={tone === "bad" ? "error-text" : "warn-text"}> — {String(d.error_message)}</span> : null}
        </>
      }
      tone={tone}
      time={event.timestamp}
    >
      {d.error_code || d.error_message ? <Facts entries={{ "Error code": d.error_code, Message: d.error_message }} /> : null}
      <Block label="Input" value={d.input} />
      <Block label="Output" value={d.output} />
      <Facts entries={{ Capability: d.capability, "Correlation id": d.correlation_id, "Idempotency key": d.idempotency_key }} mono />
    </Card>
  );
}

interface Change {
  field: string;
  old: unknown;
  new: unknown;
  mode?: string;
}

function DataEvent({ event, d }: { event: ConvEvent; d: Data }) {
  const changes = (Array.isArray(d.changes) ? d.changes : []) as Change[];
  return (
    <Card
      title={
        <>
          <span className="ev-kind">Data</span>
          {changes.length} field{changes.length === 1 ? "" : "s"} updated
        </>
      }
      meta={d.collected_by ? <>by <span className="mono">{String(d.collected_by)}</span></> : null}
      summary={<span className="mono">{changes.map((c) => c.field).join(", ")}</span>}
      previewOnly
      time={event.timestamp}
    >
      <table className="changes">
        <tbody>
          {changes.map((c) => (
            <tr key={c.field}>
              <th className="mono">{c.field}</th>
              <td>
                {c.old != null ? (
                  <>
                    <Value value={c.old} /> <span className="muted">→</span>{" "}
                  </>
                ) : null}
                <Value value={c.new} />
                {c.mode && c.mode !== "set" ? <span className="chip">{c.mode}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function HandoffEvent({ event, d }: { event: ConvEvent; d: Data }) {
  const gate = (d.router_gate ?? {}) as Data;
  return (
    <Card
      title={
        <>
          <span className="ev-kind">Handoff</span>
          {humanize(str(d.from_agent_name ?? d.from_agent_id))} <span className="muted">→</span> {humanize(str(d.to_agent_name ?? d.to_agent_id))}
        </>
      }
      summary={d.reason ? String(d.reason) : null}
      time={event.timestamp}
    >
      <Facts entries={{ From: d.from_agent_id, To: d.to_agent_id, Via: gate.tool_name, "Intent hint": d.intent_hint ?? gate.intent_hint, "Target version": d.target_version }} mono />
    </Card>
  );
}

function PostCallEvent({ event, d }: { event: ConvEvent; d: Data }) {
  const analytics = (d.analytics ?? {}) as Data;
  const raw = (analytics.raw ?? {}) as Data;
  return (
    <Card
      title={
        <>
          <span className="ev-kind">Post-call</span>
          {humanize(str(d.kind) || kindOf(event))}
        </>
      }
      chips={
        <>
          {analytics.call_status ? <span className="chip">{humanize(str(analytics.call_status))}</span> : null}
          {analytics.urgency ? <span className="chip">{String(analytics.urgency)} urgency</span> : null}
          {raw.ai_success != null ? <span className={`chip ${raw.ai_success ? "good" : "warn"}`}>{raw.ai_success ? "AI success" : "AI failed"}</span> : null}
          {raw.model_error ? <span className="chip bad">Model error</span> : null}
        </>
      }
      summary={analytics.summary ? <span className="clamp">{String(analytics.summary)}</span> : null}
      time={event.timestamp}
    >
      {analytics.summary ? <p className="pre">{String(analytics.summary)}</p> : null}
      <Facts
        entries={{
          "Primary intent": raw.primary_intent,
          Outcome: raw.outcome_task,
          Sentiment: raw.call_sentiment,
          Complexity: raw.call_complexity,
          "AI success reason": raw.ai_success_reason,
          "Abrupt end": raw.abrupt_end,
          "Escalation requested": raw.escalation_requested,
        }}
      />
      <Block label="Raw" value={Object.keys(analytics).length ? analytics : d} />
    </Card>
  );
}

function Facts({ entries, mono }: { entries: Record<string, unknown>; mono?: boolean }) {
  const shown = Object.entries(entries).filter(([, v]) => v != null && v !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="facts">
      {shown.map(([term, value]) => (
        <FactRow key={term} term={term} value={value} mono={mono} />
      ))}
    </dl>
  );
}

function FactRow({ term, value, mono }: { term: string; value: unknown; mono?: boolean }) {
  return (
    <>
      <dt>{term}</dt>
      <dd className={mono && typeof value === "string" ? "mono" : ""}>
        <Value value={value} />
      </dd>
    </>
  );
}

// Flat objects read as a fact list; anything nested falls back to JSON.
function Block({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "string" ? safeParse(value) ?? value : value;
  const flat = isPlainObject(parsed) && Object.values(parsed).every(isInline);
  return (
    <div>
      <div className="label">{label}</div>
      {flat ? (
        <dl className="facts boxed">
          {Object.entries(parsed as Data).map(([k, v]) => (
            <FactRow key={k} term={k} value={v} mono />
          ))}
        </dl>
      ) : (
        <pre className="code">{prettyJson(parsed)}</pre>
      )}
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (value == null) return <span className="muted">—</span>;
  if (typeof value === "boolean") return <span className={`chip ${value ? "good" : ""}`}>{value ? "true" : "false"}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" && v.length <= 1)) return <span className="mono">{value.join(" ")}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return <span>{value.join(", ")}</span>;
  if (typeof value === "object") return <pre className="code inline">{prettyJson(value)}</pre>;
  return <span>{String(value)}</span>;
}

function isInline(value: unknown): boolean {
  if (value == null || typeof value !== "object") return true;
  return Array.isArray(value) && value.every((v) => v == null || typeof v !== "object");
}

function isPlainObject(value: unknown): value is Data {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function argsSummary(args: unknown): string {
  if (!isPlainObject(args)) return "";
  return Object.entries(args)
    .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
    .slice(0, 3)
    .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
    .join(" · ");
}

// Post-call tool events name the tool in `tool` and carry only a JSON `tool_result`.
function toolStatus(d: Data, output: unknown): string {
  if (d.status) return String(d.status);
  const parsed = typeof output === "string" ? safeParse(output) : output;
  if (isPlainObject(parsed) && "success" in parsed) return parsed.success ? "ok" : "failed";
  return "";
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function ms(value: unknown): string {
  if (typeof value !== "number") return "";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}
