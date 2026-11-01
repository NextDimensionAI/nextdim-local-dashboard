import type { CSSProperties } from "react";

export function Skeleton({ width = "100%", height = 12, round = false, style }: { width?: number | string; height?: number; round?: boolean; style?: CSSProperties }) {
  return <span className={`skeleton ${round ? "round" : ""}`} style={{ width, height, ...style }} aria-hidden />;
}

/** A bar inside a box exactly one text line tall, so it takes the space the loaded text will. */
export function SkeletonText({ size = "body", width = "100%", bar }: { size?: keyof typeof LINE; width?: number | string; bar?: number }) {
  return (
    <span className="sk-text" style={{ height: LINE[size] }} aria-hidden>
      <Skeleton width={width} height={bar ?? BAR[size]} />
    </span>
  );
}

// Line heights of the text each skeleton stands in for (font-size × 1.5).
const LINE = { title: 30, body: 21, card: 19.5, small: 18 } as const;
const BAR = { title: 22, body: 12, card: 11, small: 10 } as const;

const TABLE_WIDTHS = ["70%", "50%", "45%", "80%", "70%", "55%", "40%", "30%"];

export function TableSkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden>
          <td>
            <SkeletonText width="60%" />
            <SkeletonText size="small" width="40%" />
          </td>
          {TABLE_WIDTHS.map((width, c) => (
            <td key={c}>
              <SkeletonText width={width} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

const BUBBLES: Array<["agent" | "caller" | "tool", string]> = [
  ["agent", "62%"],
  ["caller", "48%"],
  ["tool", "100%"],
  ["agent", "40%"],
  ["agent", "70%"],
  ["caller", "35%"],
  ["agent", "55%"],
];

export function TimelineSkeleton() {
  return (
    <ol className="timeline" aria-busy aria-label="Loading timeline">
      {BUBBLES.map(([kind, width], i) =>
        kind === "tool" ? (
          <li key={i}>
            <Skeleton height={30} />
          </li>
        ) : (
          <li key={i} className={`turn ${kind}`}>
            <div className="bubble skeleton-bubble" style={{ width }}>
              <Skeleton width={70} height={10} />
              <Skeleton height={12} style={{ marginTop: 8 }} />
              <Skeleton width="70%" height={12} style={{ marginTop: 6 }} />
            </div>
          </li>
        ),
      )}
    </ol>
  );
}

/** Paragraph placeholder: each line takes a full text line, plus a paragraph's margins. */
export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-lines" aria-busy>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonText key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function LiveCardSkeleton() {
  return (
    <div className="card live-card" aria-hidden>
      <div className="card-top">
        <SkeletonText width="55%" bar={14} />
        <Skeleton width={54} height={21} round />
      </div>
      <div className="card-mid">
        <SkeletonText size="card" width="35%" />
      </div>
    </div>
  );
}
