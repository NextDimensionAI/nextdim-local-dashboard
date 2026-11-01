import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatTime } from "../format";

const SPEEDS = [1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;
// Waveform geometry in CSS pixels; WAVE_HEIGHT matches .player-wave in styles.css.
const WAVE_HEIGHT = 40;
const BAR_WIDTH = 2;
const BAR_STEP = 3;
const MIN_BAR = 2;

export interface AudioPlayerHandle {
  playFrom: (seconds: number) => void;
}

interface AudioPlayerProps {
  src: string;
  /** Waveform loudness from analyseRecording; null while loading, empty when it couldn't be decoded. */
  peaks: number[] | null;
  onError: () => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({ src, peaks, onError }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [length, setLength] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [bars, setBars] = useState(0);
  const clipId = `wave-${useId().replace(/:/g, "")}`;

  useImperativeHandle(ref, () => ({
    playFrom: (seconds) => {
      const el = audio.current;
      if (!el) return;
      el.currentTime = Math.max(0, seconds);
      setCurrent(el.currentTime);
      el.play().catch(ignorePlayRejection);
    },
  }));

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBars(Math.max(1, Math.floor(entry.contentRect.width / BAR_STEP))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const heights = useMemo(() => resample(peaks ?? [], bars), [peaks, bars]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const sync = () => {
      if (!scrubbing) setCurrent(el.currentTime);
      if (Number.isFinite(el.duration)) setLength(el.duration);
    };
    const events = ["timeupdate", "durationchange", "loadedmetadata"] as const;
    events.forEach((name) => el.addEventListener(name, sync));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      events.forEach((name) => el.removeEventListener(name, sync));
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [scrubbing]);

  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el || !length) return;
    el.currentTime = Math.min(length, Math.max(0, seconds));
    setCurrent(el.currentTime);
  };

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(ignorePlayRejection);
    else el.pause();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    if (audio.current) audio.current.playbackRate = next;
    setSpeed(next);
  };

  const toggleMute = () => {
    if (audio.current) audio.current.muted = !muted;
    setMuted(!muted);
  };

  const timeAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || !length) return 0;
    return ((clientX - rect.left) / rect.width) * length;
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    setCurrent(Math.min(length, Math.max(0, timeAt(e.clientX))));
  };
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const at = Math.min(length, Math.max(0, timeAt(e.clientX)));
    if (scrubbing) setCurrent(at);
    if (e.pointerType === "mouse" && length) setHover(at);
  };
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    setScrubbing(false);
    seekTo(timeAt(e.clientX));
  };

  const handleTrackKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") seekTo(current + 5);
    else if (e.key === "ArrowLeft") seekTo(current - 5);
    else if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(length);
    else return;
    e.preventDefault();
  };

  const fraction = (value: number) => (length ? Math.min(1, Math.max(0, value / length)) : 0);
  const pct = (value: number) => `${fraction(value) * 100}%`;
  const waveWidth = bars * BAR_STEP;
  const barRects = useMemo(
    () =>
      heights.map((peak, i) => {
        const h = Math.max(MIN_BAR, peak * WAVE_HEIGHT);
        return <rect key={i} x={i * BAR_STEP} y={(WAVE_HEIGHT - h) / 2} width={BAR_WIDTH} height={h} rx={1} />;
      }),
    [heights],
  );

  return (
    <div className="player">
      <audio ref={audio} src={src} preload="metadata" onError={onError} />
      <button className="player-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button className="player-icon" onClick={() => seekTo(current - SKIP_SECONDS)} aria-label="Back 10 seconds">
        <SkipIcon back />
      </button>
      <button className="player-icon" onClick={() => seekTo(current + SKIP_SECONDS)} aria-label="Forward 10 seconds">
        <SkipIcon />
      </button>
      <span className="player-time">{formatTime(current)}</span>
      <div
        ref={track}
        className={`player-wave ${scrubbing ? "scrubbing" : ""} ${peaks ? "" : "loading"}`}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} of ${formatTime(length)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setScrubbing(false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={handleTrackKey}
      >
        <svg viewBox={`0 0 ${waveWidth || 1} ${WAVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <clipPath id={clipId}>
              <rect width={fraction(current) * waveWidth} height={WAVE_HEIGHT} />
            </clipPath>
          </defs>
          <g className="player-wave-base">{barRects}</g>
          <g className="player-wave-played" clipPath={`url(#${clipId})`}>
            {barRects}
          </g>
        </svg>
        <span className="player-cursor" style={{ left: pct(current) }} />
        {hover != null && !scrubbing && (
          <span className="player-hover" style={{ left: pct(hover) }}>
            <span className="player-hover-time">{formatTime(hover)}</span>
          </span>
        )}
      </div>
      <span className="player-time muted">{formatTime(length)}</span>
      <button className="player-speed" onClick={cycleSpeed} aria-label="Playback speed">
        {speed}×
      </button>
      <button className="player-icon" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
        <VolumeIcon muted={muted} />
      </button>
    </div>
  );
});

function resample(peaks: number[], count: number): number[] {
  if (!peaks.length) return new Array(count).fill(0);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
    return Math.max(...peaks.slice(start, end));
  });
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function SkipIcon({ back }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <g transform={back ? undefined : "matrix(-1 0 0 1 24 0)"}>
        <path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z" fill="currentColor" />
      </g>
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fontWeight="600" fill="currentColor">
        10
      </text>
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      {muted ? (
        <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

// play() rejects when a pause or seek interrupts it, or autoplay is blocked; none of these mean
// the recording failed. Real load failures still reach onError through the <audio> error event.
function ignorePlayRejection() {}
