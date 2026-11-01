import { createContext, useContext } from "react";
import { clock, formatTime } from "../format";

/** Call start in epoch ms. When set, times read as m:ss into the call instead of the wall clock. */
export const CallOrigin = createContext<number | null>(null);

export function EventTime({ iso, seconds }: { iso: string | null | undefined; seconds?: number }) {
  const origin = useContext(CallOrigin);
  if (origin == null || !iso) return <span className="time">{clock(iso)}</span>;
  const at = seconds ?? (new Date(iso).getTime() - origin) / 1000;
  return (
    <span className="time" title={clock(iso)}>
      {formatTime(at)}
    </span>
  );
}
