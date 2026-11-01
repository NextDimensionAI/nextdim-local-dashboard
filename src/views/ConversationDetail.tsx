import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type RefObject } from "react";
import { api, type ConvEvent, type ConversationDetail as Detail, type LatencyTurn, type Page, type Task } from "../api";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { CallLog } from "../components/CallLog";
import { EventLog } from "../components/EventLog";
import { LinesSkeleton, Skeleton, SkeletonText, TimelineSkeleton } from "../components/Skeleton";
import { Timeline } from "../components/Timeline";
import { UrgencyChip } from "../components/UrgencyChip";
import { duration, humanize, personName, when } from "../format";
import { analyseRecording, speechStart } from "../recording";

export function ConversationDetail({ tenant, id }: { tenant: string; id: string }) {
  const path = `/v1/conversations/${encodeURIComponent(id)}`;

  const detail = useQuery({ queryKey: ["conv", tenant, id], queryFn: () => api<Detail>(path, tenant), staleTime: 30_000 });
  const events = useQuery({
    queryKey: ["events", tenant, id],
    queryFn: () => api<Page<ConvEvent>>(`${path}/events?limit=1000`, tenant),
    staleTime: 30_000,
  });
  const tasks = useQuery({ queryKey: ["tasks", tenant, id], queryFn: () => api<Page<Task>>(`${path}/tasks`, tenant), staleTime: 30_000 });
  const latency = useQuery({
    queryKey: ["latency", tenant, id],
    queryFn: () => api<{ turns: LatencyTurn[] | null }>(`${path}/latency`, tenant),
    staleTime: 60_000,
  });

  const sortedEvents = useMemo(
    () => [...(events.data?.items ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [events.data],
  );
  const c = detail.data;

  const recordingSrc = `/media/recording/${encodeURIComponent(id)}?tenant=${encodeURIComponent(tenant)}`;
  const player = useRef<AudioPlayerHandle>(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const shape = useQuery({
    queryKey: ["recording", tenant, id],
    queryFn: ({ signal }) => analyseRecording(recordingSrc, signal),
    enabled: !!c?.recording_link,
    staleTime: Infinity,
    retry: false,
  });
  const playable = !!c?.recording_link && !audioFailed;
  const origin = c?.call_start_time ? new Date(c.call_start_time).getTime() : undefined;
  const starts = useMemo(
    () => (playable && origin != null && !shape.isPending ? turnStarts(sortedEvents, origin, shape.data?.activity) : undefined),
    [playable, origin, shape.isPending, shape.data, sortedEvents],
  );

  return (
    <section>
      <header className="page-head">
        <div>
          <a className="back" href="#/">← Conversations</a>
          {c ? (
            <>
              <h1>{personName(c)}</h1>
              <p className="muted">
                {when(c.call_start_time)} · {duration(c.call_duration)} ·{" "}
                {(c.agents_display_names?.length ? c.agents_display_names : [c.agent_display_name ?? ""]).map(humanize).join(" → ")}
                {c.phone_number ? ` · ${c.phone_number}` : ""}
              </p>
            </>
          ) : detail.isPending ? (
            <>
              <h1>
                <SkeletonText size="title" width={220} />
              </h1>
              <p className="muted">
                <SkeletonText width={340} />
              </p>
            </>
          ) : (
            <h1>Conversation</h1>
          )}
        </div>
      </header>

      {detail.isError ? <p className="error">{String(detail.error)}</p> : null}

      <div className="detail">
        <div className="main-col">
        <Recording
          src={recordingSrc}
          loading={detail.isPending}
          recordingLink={c?.recording_link}
          peaks={shape.isPending ? null : (shape.data?.peaks ?? [])}
          player={player}
          failed={audioFailed}
          onFailed={() => setAudioFailed(true)}
        />
        <CallTabs
          tenant={tenant}
          conversationId={id}
          events={sortedEvents}
          loading={events.isPending}
          callStart={c?.call_start_time}
          origin={origin}
          starts={starts}
          onSeek={(seconds) => player.current?.playFrom(seconds)}
        />
        </div>

        <aside className="side">
          <TasksPanel tasks={tasks.data?.items ?? []} loading={tasks.isPending} />
          {latency.isPending ? <PanelSkeleton title="Latency" lines={1} chart /> : <LatencyPanel turns={latency.data?.turns ?? []} />}
          {c ? <Analysis c={c} /> : detail.isPending ? <PanelSkeleton title="Post-call" lines={4} chips /> : null}
        </aside>
      </div>
    </section>
  );
}

type Tab = "transcript" | "events" | "logs";

// What the conversation itself did; everything else is only in the Events tab.
const TRANSCRIPT_CATEGORIES = new Set(["transcript", "handoff", "tool_call", "agent_task"]);

interface CallTabsProps {
  tenant: string;
  conversationId: string;
  events: ConvEvent[];
  loading: boolean;
  callStart: string | null | undefined;
  origin: number | undefined;
  starts: Map<string, number> | undefined;
  onSeek: (seconds: number) => void;
}

function CallTabs({ tenant, conversationId, events, loading, callStart, origin, starts, onSeek }: CallTabsProps) {
  const [tab, setTab] = useState<Tab>("transcript");
  const transcript = events.filter((e) => TRANSCRIPT_CATEGORIES.has(e.category) || (e.event_type ?? e.type) === "tool_call");
  const turns = transcript.filter((e) => e.category === "transcript").length;
  const others = events.filter((e) => e.category !== "transcript" && !(e.category === "agent_task" && e.data?.phase === "completed")).length;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "transcript", label: "Transcript", count: loading ? undefined : turns },
    { key: "events", label: "Events", count: loading ? undefined : others },
    { key: "logs", label: "Logs" },
  ];
  return (
    <div className="panel main scroll-card">
      <div className="panel-head sticky">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
              {t.count != null ? <span className="badge">{t.count}</span> : null}
            </button>
          ))}
        </div>
      </div>
      {tab === "logs" ? (
        <CallLog tenant={tenant} conversationId={conversationId} />
      ) : loading ? (
        <TimelineSkeleton />
      ) : tab === "transcript" ? (
        <Timeline events={transcript} origin={origin} starts={starts} onSeek={onSeek} />
      ) : (
        <EventLog events={events} callStart={callStart} />
      )}
    </div>
  );
}

function Analysis({ c }: { c: Detail }) {
  return (
    <div className="panel">
      <h2>Post-call</h2>
      <div className="chips">
        {c.call_status ? <span className={`chip status-${c.call_status}`}>{humanize(c.call_status)}</span> : null}
        {c.urgency ? <UrgencyChip urgency={c.urgency} /> : null}
        {c.call_sentiment ? <span className="chip">{humanize(c.call_sentiment)}</span> : null}
        {c.ai_success != null ? <span className={`chip ${c.ai_success ? "good" : "warn"}`}>{c.ai_success ? "AI success" : "AI failed"}</span> : null}
      </div>
      {c.primary_intent ? <p><strong>{c.primary_intent}</strong>{c.secondary_intent ? <span className="muted"> · {c.secondary_intent}</span> : null}</p> : null}
      {c.summary ? <p>{c.summary}</p> : <p className="muted">No analysis yet.</p>}
      {c.ai_success_reason ? <p className="muted">{c.ai_success_reason}</p> : null}
      {c.questions_not_answered?.length ? (
        <>
          <div className="label">Unanswered</div>
          <ul className="plain">{c.questions_not_answered.map((q) => <li key={q}>{q}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}

function TasksPanel({ tasks, loading }: { tasks: Task[]; loading: boolean }) {
  return (
    <div className="panel">
      <h2>
        Tasks <span className="badge">{tasks.length}</span>
      </h2>
      {loading ? <LinesSkeleton lines={1} /> : tasks.length === 0 ? <p className="muted">None.</p> : null}
      <ul className="plain tasks">
        {tasks.map((t, i) => {
          const status = t.status || t.task_status;
          const details = t.summary || t.description || t.event_description;
          return (
            <li key={t.id ?? t._id ?? i}>
              <strong>{humanize(t.title || t.task_type || t.patient_intent || t.tool_name || t.type || "Task")}</strong>
              {status ? <span className="chip">{humanize(status)}</span> : null}
              {t.urgency ? <UrgencyChip urgency={t.urgency} /> : null}
              {details ? <p className="muted">{details}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Transcript events land when a turn ends, so each turn is placed at the first speech in the
// recording after the previous turn ended (or at that point when the audio couldn't be analysed).
// The recording starts with the call, so call-start offsets are recording positions.
function turnStarts(events: ConvEvent[], origin: number, activity: Float32Array | undefined): Map<string, number> {
  const starts = new Map<string, number>();
  let from = 0;
  for (const event of events) {
    if (event.category !== "transcript") continue;
    const end = (new Date(event.timestamp).getTime() - origin) / 1000;
    starts.set(event.event_id, activity ? speechStart(activity, from, end) : from);
    from = Math.max(from, end);
  }
  return starts;
}

interface RecordingProps {
  src: string;
  loading: boolean;
  recordingLink: string | null | undefined;
  peaks: number[] | null;
  player: RefObject<AudioPlayerHandle>;
  failed: boolean;
  onFailed: () => void;
}

function Recording({ src, loading, recordingLink, peaks, player, failed, onFailed }: RecordingProps) {
  return (
    <div className="panel recording">
      <h2>Recording</h2>
      <div className="recording-body">
        {loading ? (
          <Skeleton height={44} />
        ) : !recordingLink ? (
          <p className="muted">No recording for this call.</p>
        ) : failed ? (
          <p className="error-inline">The recording couldn't be loaded.</p>
        ) : (
          <AudioPlayer ref={player} src={src} peaks={peaks} onError={onFailed} />
        )}
      </div>
    </div>
  );
}

function PanelSkeleton({ title, lines, chart, chips }: { title: string; lines: number; chart?: boolean; chips?: boolean }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {chips ? (
        <div className="chips">
          {[96, 52, 64].map((w) => (
            <Skeleton key={w} width={w} height={22} round />
          ))}
        </div>
      ) : null}
      <LinesSkeleton lines={lines} />
      {chart ? <Skeleton height={80} style={{ marginTop: 8 }} /> : null}
    </div>
  );
}

function LatencyPanel({ turns }: { turns: LatencyTurn[] }) {
  const agentTurns = turns.filter((t) => t.role !== "user" && t.e2e_latency_ms != null);
  if (agentTurns.length === 0) return null;
  const values = agentTurns.map((t) => t.e2e_latency_ms ?? 0);
  const max = Math.max(...values, 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    <div className="panel">
      <h2>Latency</h2>
      <p className="muted">
        Avg {(avg / 1000).toFixed(1)} s · max {(max / 1000).toFixed(1)} s · {values.length} turns
      </p>
      <div className="bars" role="img" aria-label="End-to-end latency per agent turn">
        {agentTurns.map((t) => (
          <span
            key={t.turn_index}
            className={`bar ${(t.e2e_latency_ms ?? 0) > 3000 ? "slow" : ""}`}
            style={{ height: `${Math.max(4, ((t.e2e_latency_ms ?? 0) / max) * 100)}%` }}
            title={`Turn ${t.turn_index}: ${((t.e2e_latency_ms ?? 0) / 1000).toFixed(2)} s`}
          />
        ))}
      </div>
    </div>
  );
}
