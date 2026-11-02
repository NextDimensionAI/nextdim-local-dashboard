import { useEffect, useRef, useState } from "react";
import type { ConvEvent } from "../api";
import { transcriptText, type TranscriptDetail } from "../transcriptText";

const OPTIONS: { detail: TranscriptDetail; label: string }[] = [
  { detail: "text", label: "Text only" },
  { detail: "tools", label: "Text + tool calls" },
  { detail: "tasks", label: "Text + tool calls + agent tasks" },
];
const COPIED_MS = 1500;

interface CopyTranscriptMenuProps {
  events: ConvEvent[];
  origin?: number;
  starts?: Map<string, number>;
}

export function CopyTranscriptMenu({ events, origin, starts }: CopyTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (detail: TranscriptDetail) => {
    setOpen(false);
    await navigator.clipboard.writeText(transcriptText(events, { detail, origin, starts }));
    setCopied(true);
  };

  return (
    <div className="menu" ref={root} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        className="icon-btn"
        aria-label={copied ? "Transcript copied" : "Copy transcript"}
        title={copied ? "Copied" : "Copy transcript"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={events.length === 0}
        onClick={() => setOpen(!open)}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open ? (
        <ul className="menu-list" role="menu" aria-label="Copy transcript">
          {OPTIONS.map((option) => (
            <li key={option.detail} role="none">
              <button role="menuitem" className="menu-item" onClick={() => handleCopy(option.detail)}>
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
