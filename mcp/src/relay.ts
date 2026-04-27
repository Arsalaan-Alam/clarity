import { CLARITY_API_URL } from "./config.js";

type RelayStatus = "open" | "funded" | "submitted" | "completed" | "rejected" | "expired";

export type JobMetadataRegisterInput = {
  title: string;
  description: string;
  tags?: string[];
};

type RelayEventInput = {
  jobId: number;
  eventType: string;
  status: RelayStatus;
  txHash: string;
  job: {
    chainId: number;
    escrow: string;
    client: string;
    provider: string;
    evaluator: string;
    descriptionCid: string;
    title?: string;
    description?: string;
    tags?: string[];
  };
};

export async function registerJobMetadata(
  input: JobMetadataRegisterInput,
): Promise<{ contentHash: `0x${string}` }> {
  const res = await fetch(`${CLARITY_API_URL}/relay/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      tags: input.tags,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay metadata register failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { contentHash: `0x${string}` };
  return { contentHash: data.contentHash };
}

export async function postRelayEvent(input: RelayEventInput): Promise<void> {
  const res = await fetch(`${CLARITY_API_URL}/relay/events`, {
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
        ...(input.job.title != null ? { title: input.job.title } : {}),
        ...(input.job.description != null ? { description: input.job.description } : {}),
        ...(input.job.tags != null ? { tags: input.job.tags } : {}),
      },
      event: {
        jobId: input.jobId,
        type: input.eventType,
        payload: { txHash: input.txHash },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay event post failed: ${res.status} ${body}`);
  }
}
