import { titleCase } from "../format";

const TONE_BY_URGENCY: Record<string, string> = {
  critical: "bad",
  urgent: "bad",
  high: "bad",
  medium: "warn",
  normal: "good",
  low: "good",
};

export function UrgencyChip({ urgency }: { urgency: string }) {
  const tone = TONE_BY_URGENCY[urgency.toLowerCase()] ?? "";
  return <span className={`chip ${tone}`}>{titleCase(urgency)}</span>;
}
