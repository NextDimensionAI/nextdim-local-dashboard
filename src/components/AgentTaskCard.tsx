import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, getTenant, type ConvEvent } from "../api";
import { humanize, prettyJson } from "../format";
import { EventTime } from "./EventTime";
import { LinesSkeleton } from "./Skeleton";

const EVENT_TEXT_LIMIT = 4000;
const CLIPPED_MARK = "…";

interface TaskInput {
  include_parent_history?: boolean;
  history_total?: number;
  instructions?: string | null;
  on_enter_instructions?: string | null;
  tools?: string[];
  completion_tools?: string[];
  models?: Record<string, string>;
}

interface TaskOutput {
  completion_tool?: string | null;
  result?: Record<string, unknown> | null;
  save_to?: string | null;
  reply?: string | null;
  deferred_action?: string | null;
}

const OUTCOME_TONE: Record<string, string> = { completed: "good", declined: "warn", cancelled: "", error: "bad" };

interface AgentTaskCardProps {
  started?: ConvEvent;
  completed?: ConvEvent;
}

/** One agent-task run: its started and completed events merged into a single card. */
export function AgentTaskCard({ started, completed }: AgentTaskCardProps) {
  const [open, setOpen] = useState(false);
  const first = (started ?? completed)!;
  const d = { ...(started?.data ?? {}), ...(completed?.data ?? {}) } as Record<string, unknown>;
  const input = (started?.data?.input ?? completed?.data?.input) as TaskInput | null | undefined;
  const output = completed?.data?.output as TaskOutput | null | undefined;
  const outcome = completed ? String(d.outcome ?? "completed") : "";
  const duration = typeof d.duration_ms === "number" ? `${(d.duration_ms / 1000).toFixed(1)} s` : "";
  const trigger = d.trigger === "on_enter" ? "On enter" : d.trigger === "tool" ? "Via tool" : "";

  return (
    <div className={`tool agent-task ${outcome === "error" ? "failed" : ""}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="tag task-tag">Agent task</span>
        <span className="tool-name">{humanize(String(d.task_slug ?? "task"))}</span>
        {trigger ? <span className="chip">{trigger}</span> : null}
        {completed ? (
          <span className={`chip ${OUTCOME_TONE[outcome] ?? ""}`}>{humanize(outcome)}</span>
        ) : (
          <span className="chip running">Running</span>
        )}
        <span className="muted">{duration}</span>
        <EventTime iso={first.timestamp} />
      </button>
      {open ? (
        <div className="tool-body task-body">
          {output ? <OutputDetails output={output} /> : null}
          {input ? <InputDetails input={input} slug={String(d.task_slug ?? "")} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The point in the timeline where a run handed control back. */
export function AgentTaskEnd({ run }: { run: { started?: ConvEvent; completed?: ConvEvent } }) {
  const d = { ...(run.started?.data ?? {}), ...(run.completed?.data ?? {}) } as Record<string, unknown>;
  const outcome = String(d.outcome ?? "completed");
  const duration = typeof d.duration_ms === "number" ? `${(d.duration_ms / 1000).toFixed(1)} s` : "";
  return (
    <div className="marker task-end">
      <EventTime iso={run.completed?.timestamp} />
      <strong>{humanize(String(d.task_slug ?? "task"))} ended</strong>
      <span className={`chip ${OUTCOME_TONE[outcome] ?? ""}`}>{humanize(outcome)}</span>
      {duration ? <span className="muted">{duration}</span> : null}
    </div>
  );
}

function OutputDetails({ output }: { output: TaskOutput }) {
  return (
    <div>
      <div className="label">Result</div>
      <dl className="facts">
        {output.completion_tool ? <Fact term="Completed by" value={output.completion_tool} mono /> : null}
        {output.save_to ? <Fact term="Saved to" value={output.save_to} mono /> : null}
        {output.deferred_action ? <Fact term="Deferred action" value={humanize(output.deferred_action)} /> : null}
        {output.reply ? <Fact term="Reply" value={output.reply} /> : null}
      </dl>
      {output.result ? <pre className="code">{prettyJson(output.result)}</pre> : null}
    </div>
  );
}

function InputDetails({ input, slug }: { input: TaskInput; slug: string }) {
  const models = Object.entries(input.models ?? {});
  return (
    <div>
      <div className="label">Setup</div>
      <dl className="facts">
        {input.tools?.length ? <Fact term="Tools" value={input.tools.join(", ")} mono /> : null}
        {input.completion_tools?.length ? <Fact term="Completion tools" value={input.completion_tools.join(", ")} mono /> : null}
        {models.length ? <Fact term="Models" value={models.map(([slot, model]) => `${slot}: ${model}`).join(" · ")} /> : null}
        <Fact
          term="Parent history"
          value={input.include_parent_history ? `${input.history_total ?? 0} messages` : "Not included"}
        />
      </dl>
      <Prompt label="On enter" text={input.on_enter_instructions} slug={slug} field="on_enter_instructions" />
      <Prompt label="Instructions" text={input.instructions} slug={slug} field="instructions" />
    </div>
  );
}

interface AgentTaskSpec {
  spec?: Record<string, { inline_text?: string | null } | undefined>;
}

// The voice agent cuts event text at 4,000 characters; the task's own spec holds the full prompt.
function Prompt({ label, text, slug, field }: { label: string; text?: string | null; slug: string; field: string }) {
  const clipped = !!text && text.length > EVENT_TEXT_LIMIT && text.endsWith(CLIPPED_MARK);
  const spec = useQuery({
    queryKey: ["agent-task", getTenant(), slug],
    queryFn: () => api<AgentTaskSpec>(`/v1/agent-tasks/${encodeURIComponent(slug)}`, getTenant()),
    enabled: clipped,
    staleTime: 5 * 60_000,
  });
  if (!text) return null;
  const full = spec.data?.spec?.[field]?.inline_text;
  return (
    <div>
      <div className="label">
        {label}
        {clipped && full ? <span className="muted"> · full prompt from the task's current config</span> : null}
      </div>
      {clipped && spec.isPending ? (
        <LinesSkeleton lines={6} />
      ) : (
        <pre className="code prompt">{clipped && full ? full : text}</pre>
      )}
      {clipped && spec.isError ? <p className="error-inline">Couldn't load the full prompt; showing the first 4,000 characters.</p> : null}
    </div>
  );
}

function Fact({ term, value, mono }: { term: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{term}</dt>
      <dd className={mono ? "mono" : ""}>{value}</dd>
    </>
  );
}
