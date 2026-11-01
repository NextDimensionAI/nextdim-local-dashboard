import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api";
import { clock } from "../format";
import { LinesSkeleton } from "./Skeleton";

const LINE = /^\[([\w-]+)\] (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC - (\S+) - ([A-Z]+) - (.*)$/;
const CONTINUATION = /^\[([\w-]+)\] ?(.*)$/;
const LEVELS = ["ERROR", "WARNING", "INFO", "DEBUG"] as const;

interface Entry {
  index: number;
  segment: string;
  timestamp: string;
  logger: string;
  level: string;
  message: string;
  extra: string[];
}

/** The call's PHI-scrubbed console log, parsed into filterable lines. */
export function CallLog({ tenant, conversationId }: { tenant: string; conversationId: string }) {
  const log = useQuery({
    queryKey: ["call-log", tenant, conversationId],
    queryFn: () => fetchLog(tenant, conversationId),
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [segment, setSegment] = useState<string | null>(null);

  if (log.isPending) return <LinesSkeleton lines={12} />;
  if (log.isError) {
    return log.error instanceof ApiError && log.error.status === 404 ? (
      <p className="muted pad">No log for this call.</p>
    ) : (
      <p className="error">{String(log.error)}</p>
    );
  }

  const entries = log.data;
  const segments = [...new Set(entries.map((e) => e.segment))];
  const needle = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (!level || e.level === level) &&
      (!segment || e.segment === segment) &&
      (!needle || `${e.logger} ${e.message} ${e.extra.join("\n")}`.toLowerCase().includes(needle)),
  );
  const levelCount = (l: string) => entries.filter((e) => e.level === l && (!segment || e.segment === segment)).length;

  return (
    <div className="log">
      <div className="log-tools">
        <input className="search" type="search" placeholder="Search logs" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="filters" role="group" aria-label="Filter by level">
          <button className={`filter ${level === null ? "on" : ""}`} onClick={() => setLevel(null)} aria-pressed={level === null}>
            All levels
          </button>
          {LEVELS.map((l) =>
            levelCount(l) ? (
              <button key={l} className={`filter lvl-${l} ${level === l ? "on" : ""}`} onClick={() => setLevel(level === l ? null : l)} aria-pressed={level === l}>
                {l === "WARNING" ? "Warn" : l[0] + l.slice(1).toLowerCase()}
                <span className="filter-count">{levelCount(l)}</span>
              </button>
            ) : null,
          )}
        </div>
        {segments.length > 1 ? (
          <div className="filters" role="group" aria-label="Filter by source">
            {segments.map((s) => (
              <button key={s} className={`filter ${segment === s ? "on" : ""}`} onClick={() => setSegment(segment === s ? null : s)} aria-pressed={segment === s}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {shown.length === 0 ? <p className="muted pad">No matching lines.</p> : null}
      <ol className="log-lines">
        {shown.map((e) => (
          <LogLine key={e.index} entry={e} />
        ))}
      </ol>
    </div>
  );
}

function LogLine({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const short = entry.logger.split(".").slice(-2).join(".");
  return (
    <li className={`log-line lvl-${entry.level}`}>
      <span className="log-time">{clock(entry.timestamp)}</span>
      <span className={`log-level lvl-${entry.level}`}>{entry.level === "WARNING" ? "WARN" : entry.level}</span>
      <span className="log-src" title={`${entry.segment} · ${entry.logger}`}>
        {short}
      </span>
      <span className="log-msg">
        {entry.message}
        {entry.extra.length ? (
          <>
            {" "}
            <button className="link small-link" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : `+${entry.extra.length} lines`}
            </button>
            {open ? <pre className="code log-extra">{entry.extra.join("\n")}</pre> : null}
          </>
        ) : null}
      </span>
    </li>
  );
}

async function fetchLog(tenant: string, conversationId: string): Promise<Entry[]> {
  const res = await fetch(`/media/log/${encodeURIComponent(conversationId)}?tenant=${encodeURIComponent(tenant)}`);
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  return parseLog(await res.text());
}

// Lines without a timestamp prefix (tracebacks, multi-line messages) belong to the line above.
// Anything before the first entry is the file's banner and is dropped.
function parseLog(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(LINE);
    if (match) {
      const [, segment, stamp, logger, level, message] = match;
      entries.push({ index: entries.length, segment, timestamp: `${stamp.replace(" ", "T")}Z`, logger, level, message, extra: [] });
      continue;
    }
    const last = entries.at(-1);
    const continued = line.match(CONTINUATION);
    if (last && continued) last.extra.push(continued[2]);
  }
  return entries;
}
