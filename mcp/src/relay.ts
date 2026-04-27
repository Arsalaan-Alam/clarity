import { CLARITY_API_URL } from "./config.js";

type RelayStatus = "open" | "funded" | "submitted" | "completed" | "rejected" | "expired";

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
  };
};

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
