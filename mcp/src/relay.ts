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

export async function relayCreateListing(input: {
  chainId: number;
  client: string;
  title: string;
  description: string;
  tags?: string[];
  contentHash: `0x${string}`;
  budgetHintUsdc?: string;
  listingExpiresAt: number;
}): Promise<unknown> {
  const res = await fetch(`${CLARITY_API_URL}/relay/listings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay listing create failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function relayListListings(status?: string): Promise<unknown> {
  const u = new URL("/relay/listings", CLARITY_API_URL);
  if (status) u.searchParams.set("status", status);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`Relay listings fetch failed: ${res.status}`);
  return res.json();
}

export async function relayPostBid(
  listingId: number,
  agentAddress: string,
  message: string,
): Promise<unknown> {
  const res = await fetch(`${CLARITY_API_URL}/relay/listings/${listingId}/bids`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentAddress, message }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay bid failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function relayAcceptBid(input: {
  listingId: number;
  client: string;
  bidId: number;
  evaluator: string;
}): Promise<unknown> {
  const res = await fetch(`${CLARITY_API_URL}/relay/listings/${input.listingId}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: input.client,
      bidId: input.bidId,
      evaluator: input.evaluator,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay accept failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function relayCancelListing(listingId: number, client: string): Promise<unknown> {
  const res = await fetch(`${CLARITY_API_URL}/relay/listings/${listingId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay cancel failed: ${res.status} ${body}`);
  }
  return res.json();
}
