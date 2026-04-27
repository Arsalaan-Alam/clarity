import { getRelayUrl } from "@/lib/env";

export type RelayJobStatus =
  | "open"
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  | "expired";

export type RelayJob = {
  id: number;
  chainId: number;
  escrow: string;
  client: string;
  provider: string;
  evaluator: string;
  descriptionCid: string;
  status: RelayJobStatus;
  createdAt: number;
};

export type RelayEvent = {
  id: number;
  jobId: number;
  type: string;
  at: number;
  payload?: { txHash?: string };
};

const base = () => getRelayUrl().replace(/\/$/, "");

export function chainStatusToRelayStatus(status: number): RelayJobStatus {
  switch (status) {
    case 0:
      return "open";
    case 1:
      return "funded";
    case 2:
      return "submitted";
    case 3:
      return "completed";
    case 4:
      return "rejected";
    case 5:
      return "expired";
    default:
      return "open";
  }
}

/** Same shape as MCP `postRelayEvent` — upserts job and appends timeline event. */
export async function postRelayEvent(input: {
  jobId: number;
  eventType: string;
  status: RelayJobStatus;
  txHash: string;
  job: {
    chainId: number;
    escrow: string;
    client: string;
    provider: string;
    evaluator: string;
    descriptionCid: string;
  };
}): Promise<void> {
  const res = await fetch(`${base()}/relay/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      job: {
        id: input.jobId,
        chainId: input.job.chainId,
        escrow: input.job.escrow,
        client: input.job.client,
        provider: input.job.provider,
        evaluator: input.job.evaluator,
        descriptionCid: input.job.descriptionCid,
        status: input.status,
        createdAt: Date.now(),
      },
      event: {
        jobId: input.jobId,
        type: input.eventType,
        payload: { txHash: input.txHash },
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Relay sync failed: ${res.status} ${t}`);
  }
}

export async function fetchRelayJobs(status?: string): Promise<RelayJob[]> {
  const u = new URL("/relay/jobs", base());
  if (status) u.searchParams.set("status", status);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("relay jobs fetch failed");
  const data = (await res.json()) as { jobs: RelayJob[] };
  return data.jobs;
}

export async function fetchRelayJobDetail(
  id: number,
): Promise<{ job: RelayJob; timeline: RelayEvent[] } | null> {
  const res = await fetch(`${base()}/relay/jobs/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("relay job detail failed");
  return (await res.json()) as { job: RelayJob; timeline: RelayEvent[] };
}
