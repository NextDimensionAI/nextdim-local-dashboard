import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, API, type ConvEvent, type Page, type TokenResponse } from "../api";
import { LiveCardSkeleton, TimelineSkeleton } from "../components/Skeleton";
import { Timeline } from "../components/Timeline";
import { ago, humanize, titleCase } from "../format";
import { useNow } from "../useNow";
import { isStale, type LiveCall, type LiveStream } from "../useLiveStream";

const ENDED_VISIBLE_MS = 60 * 1000;

// Snapshot rows say "call" or "text"; live events say voice_inbound, text_outbound and so on.
function isTextChannel(channel: string): boolean {
  return channel === "text" || channel.startsWith("text_");
}

export function Live({ tenant, stream }: { tenant: string; stream: LiveStream }) {
  const { calls, connected, error, subscribe } = stream;
  const [selected, setSelected] = useState<string | null>(null);
  const [showStale, setShowStale] = useState(false);
  const now = useNow();

  const visible = useMemo(
    () =>
      Object.values(calls)
        .filter((c) => !c.endedAt || now - new Date(c.endedAt).getTime() < ENDED_VISIBLE_MS)
        .filter((c) => showStale || !isStale(c, now))
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [calls, now, showStale],
  );
  const staleCount = Object.values(calls).filter((c) => isStale(c, now)).length;
  const current = selected ? calls[selected] : undefined;

  return (
    <section>
      <header className="page-head">
        <h1>
          Live <span className={`dot ${connected ? "on" : "off"}`} title={connected ? "Connected" : "Disconnected"} />
        </h1>
        {staleCount ? (
          <label className="toggle">
            <input type="checkbox" checked={showStale} onChange={(e) => setShowStale(e.target.checked)} />
            Show {staleCount} older than 2 h
          </label>
        ) : null}
      </header>
      {error ? <p className="error">{error}</p> : null}

      <div className="live-page">
        <div className="live-list">
          {visible.length === 0 && connected ? <p className="muted pad">No live calls.</p> : null}
          {visible.length === 0 && !connected ? <LiveCardSkeleton /> : null}
          {visible.map((call) => (
            <button key={call.id} className={`card live-card ${call.id === selected ? "active" : ""}`} onClick={() => setSelected(call.id)}>
              <div className="card-top">
                <strong>{titleCase(call.name)}</strong>
                <span className={`pill ${call.endedAt ? "ended" : "live"}`}>{call.endedAt ? "Ended" : ago(call.startedAt, now)}</span>
              </div>
              <div className="card-mid">
                <span>{humanize(call.agent)}</span>
                {isTextChannel(call.channel) ? <span className="chip">Text</span> : null}
              </div>
            </button>
          ))}
        </div>
        <div className={`panel main ${current ? "" : "empty"}`}>
          {current ? (
            <LiveCallPanel key={current.id} tenant={tenant} call={current} subscribe={subscribe} />
          ) : (
            <p className="muted">Pick a call to follow it live.</p>
          )}
        </div>
      </div>
    </section>
  );
}

interface LiveCallPanelProps {
  tenant: string;
  call: LiveCall;
  subscribe: (listener: (callId: string, event: ConvEvent) => void) => () => void;
}

function LiveCallPanel({ tenant, call, subscribe }: LiveCallPanelProps) {
  const [liveEvents, setLiveEvents] = useState<ConvEvent[]>([]);
  const history = useQuery({
    queryKey: ["live-history", tenant, call.id],
    queryFn: () => api<Page<ConvEvent>>(`/v1/conversations/${encodeURIComponent(call.id)}/events?limit=1000`, tenant),
    staleTime: Infinity,
  });

  useEffect(() => subscribe((id, event) => id === call.id && setLiveEvents((prev) => [...prev, event])), [subscribe, call.id]);

  const events = useMemo(() => {
    const stored = [...(history.data?.items ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last = stored.at(-1)?.timestamp ?? "";
    return [...stored, ...liveEvents.filter((e) => e.timestamp > last)];
  }, [history.data, liveEvents]);

  return (
    <>
      <div className="panel-head sticky">
        <h2>{titleCase(call.name)}</h2>
        <div className="row">
          {!isTextChannel(call.channel) && !call.endedAt ? <ListenButton tenant={tenant} callId={call.id} /> : null}
          <a className="link" href={`#/c/${encodeURIComponent(call.id)}`}>Details</a>
        </div>
      </div>
      {history.isPending ? (
        <TimelineSkeleton />
      ) : (
        <Timeline events={events} origin={call.startedAt ? new Date(call.startedAt).getTime() : undefined} />
      )}
    </>
  );
}

type ListenState = "idle" | "starting" | "playing";

function ListenButton({ tenant, callId }: { tenant: string; callId: string }) {
  const [state, setState] = useState<ListenState>("idle");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    const el = audio.current;
    audio.current = null;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setState("idle");
  };

  useEffect(() => stop, [callId]);

  const start = async () => {
    setError("");
    setState("starting");
    try {
      const { token } = await api<TokenResponse>(`/v1/live/calls/${encodeURIComponent(callId)}/listen-token`, tenant);
      const el = new Audio(`${API}/v1/live/calls/${encodeURIComponent(callId)}/listen.wav?token=${encodeURIComponent(token)}`);
      audio.current = el;
      el.onplaying = () => audio.current === el && setState("playing");
      el.onended = () => audio.current === el && stop();
      el.onerror = () => {
        if (audio.current !== el) return;
        setError("Audio stream failed");
        stop();
      };
      await el.play();
    } catch (e) {
      setError(String(e));
      stop();
    }
  };

  const busy = state !== "idle";
  return (
    <span className="row">
      <button className={`btn listen-btn ${busy ? "" : "primary"}`} onClick={busy ? stop : start} aria-busy={state === "starting"}>
        {state === "starting" ? <span className="spinner" aria-hidden /> : null}
        {state === "playing" ? <span className="listening" aria-hidden /> : null}
        {busy ? "Stop" : "Start"}
      </button>
      {error ? <span className="error-inline">{error}</span> : null}
    </span>
  );
}
