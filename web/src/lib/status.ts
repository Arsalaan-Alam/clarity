const LABELS = [
  "open",
  "funded",
  "submitted",
  "completed",
  "rejected",
  "expired",
] as const;

export function onChainStatusLabel(n: number): (typeof LABELS)[number] | "unknown" {
  return LABELS[n] ?? "unknown";
}
