export function personName(row: {
  caller_name?: string | null;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
}): string {
  const patient = [row.patient_first_name, row.patient_last_name].filter(Boolean).join(" ");
  return titleCase(patient || row.caller_name || "Unknown caller");
}

export function titleCase(text: string): string {
  return text.replace(/\b([a-z])([a-z]*)/gi, (_, first: string, rest: string) => first.toUpperCase() + rest.toLowerCase());
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return titleCase(value.replace(/[_-]+/g, " "));
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/** Seconds as m:ss, the way the player and transcript show positions in the recording. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return duration(seconds);
}

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
