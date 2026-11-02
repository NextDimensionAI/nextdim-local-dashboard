import type { ConvEvent } from "./api";
import { clock, formatTime, humanize } from "./format";

export type TranscriptDetail = "text" | "tools" | "tasks";

interface TranscriptTextOptions {
  detail: TranscriptDetail;
  /** Call start in epoch ms; times read as m:ss into the call when given. */
  origin?: number;
  /** Seconds into the recording where each turn starts, by event id. */
  starts?: Map<string, number>;
}

/** The transcript as plain text, for pasting into a ticket or a chat. */
export function transcriptText(events: ConvEvent[], { detail, origin, starts }: TranscriptTextOptions): string {
  const withTools = detail !== "text";
  const withTasks = detail === "tasks";
  const lines: string[] = [];
  for (const event of events) {
    const d = event.data ?? {};
    const at = `[${timeOf(event, origin, starts)}]`;
    if (event.category === "transcript") {
      const role = String(d.role ?? "");
      lines.push(`${at} ${role === "user" || role === "caller" ? "Caller" : "Agent"}: ${String(d.text ?? "").trim()}`);
    } else if ((event.event_type ?? event.type) === "tool_call" && withTools) {
      const status = d.status ? ` (${String(d.status)})` : "";
      lines.push(`${at} Tool ${String(d.tool_name ?? d.tool ?? "tool")}${status}`);
      pushJson(lines, "Input", d.args ?? d.input);
      pushJson(lines, "Output", d.result ?? d.output ?? d.tool_result);
    } else if (event.category === "handoff" && withTools) {
      const from = humanize(String(d.from_agent_name ?? d.from_agent_id ?? ""));
      const to = humanize(String(d.to_agent_name ?? d.to_agent_id ?? ""));
      lines.push(`${at} Handoff ${from} → ${to}${d.reason ? ` (${String(d.reason)})` : ""}`);
    } else if (event.category === "agent_task" && withTasks) {
      const task = humanize(String(d.task_slug ?? "task"));
      if (d.phase === "completed" || event.event_type === "completed") {
        const seconds = typeof d.duration_ms === "number" ? `, ${(d.duration_ms / 1000).toFixed(1)} s` : "";
        lines.push(`${at} Agent task ended: ${task} (${humanize(String(d.outcome ?? "completed"))}${seconds})`);
        pushJson(lines, "Result", (d.output as { result?: unknown } | undefined)?.result);
      } else {
        const trigger = d.trigger === "on_enter" ? " (on enter)" : d.trigger === "tool" ? " (via tool)" : "";
        lines.push(`${at} Agent task started: ${task}${trigger}`);
      }
    }
  }
  return lines.join("\n");
}

function timeOf(event: ConvEvent, origin?: number, starts?: Map<string, number>): string {
  const start = starts?.get(event.event_id);
  if (start != null) return formatTime(start);
  if (origin != null) return formatTime((new Date(event.timestamp).getTime() - origin) / 1000);
  return clock(event.timestamp);
}

function pushJson(lines: string[], label: string, value: unknown) {
  if (value == null || value === "") return;
  lines.push(`    ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
