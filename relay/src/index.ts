import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { baseSepolia } from "viem/chains";
import { createPublicClient, http, isAddress } from "viem";
import {
  canonicalJobMetadataJson,
  metadataContentHash,
  type JobMetadataInput,
} from "./metadata.js";
import { clarityEscrowJobsAbi } from "./escrowAbi.js";

const CLARITY_RPC_URL = process.env.CLARITY_RPC_URL || "https://sepolia.base.org";
const CLARITY_ESCROW_ADDRESS = (process.env.CLARITY_ESCROW_ADDRESS || "").trim();

const chainPublicClient =
  CLARITY_ESCROW_ADDRESS && /^0x[a-fA-F0-9]{40}$/i.test(CLARITY_ESCROW_ADDRESS)
    ? createPublicClient({
        chain: baseSepolia,
        transport: http(CLARITY_RPC_URL),
      })
    : null;

type JobEvent = {
  id: number;
  jobId: number;
  type: string;
  at: number;
  payload?: Record<string, unknown>;
};

type RelayJob = {
  id: number;
  chainId: number;
  escrow: string;
  client: string;
  provider: string;
  evaluator: string;
  descriptionCid: string;
  status: "open" | "funded" | "submitted" | "completed" | "rejected" | "expired";
  createdAt: number;
  title?: string;
  description?: string;
  tags?: string[];
};

type DeliverableRecord = {
  jobId: number;
  plaintext: string;
  updatedAt: number;
};

type ListingStatus = "open" | "assigned" | "cancelled" | "onchain";

type MarketListing = {
  id: number;
  chainId: number;
  client: string;
  title: string;
  description: string;
  tags: string[];
  contentHash: string;
  budgetHintUsdc?: string;
  listingExpiresAt: number;
  status: ListingStatus;
  createdAt: number;
  acceptedBidId?: number;
  provider?: string;
  evaluator?: string;
  escrowJobId?: number;
};

type MarketBid = {
  id: number;
  listingId: number;
  agentAddress: string;
  message: string;
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
};

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

const jobs: RelayJob[] = [];
const events: JobEvent[] = [];
const deliverables = new Map<number, DeliverableRecord>();
const listings: MarketListing[] = [];
const marketBids: MarketBid[] = [];

/** Key: lowercase 0x-prefixed content hash — same bytes32 as on-chain descriptionCid. */
const metadataByHash = new Map<string, { canonical: string }>();

let nextListingId = 1;
let nextBidId = 1;

/** Proves control of listing for cancel / accept / onchain (not sent on GET). */
const listingOwnerTokens = new Map<number, string>();

function chainStatusToRelayJobStatus(st: number): RelayJob["status"] {
  switch (st) {
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

app.get("/health", (c) => c.json({ ok: true, service: "clarity-relay" }));

app.get("/relay/jobs", (c) => {
  const status = c.req.query("status");
  const filtered = status ? jobs.filter((j) => j.status === status) : jobs;
  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ jobs: sorted });
});

app.get("/relay/jobs/:id", (c) => {
  const id = Number(c.req.param("id"));
  const job = jobs.find((j) => j.id === id);
  if (!job) return c.json({ error: "job_not_found" }, 404);

  return c.json({
    job,
    timeline: events.filter((e) => e.jobId === id).sort((a, b) => a.at - b.at),
  });
});

/** Upsert relay job + timeline from on-chain `jobs(jobId)` (e.g. after MCP / cast txs). */
app.post("/relay/jobs/:jobId/sync-from-chain", async (c) => {
  if (!chainPublicClient) {
    return c.json({ error: "relay_escrow_not_configured" }, 503);
  }
  const jobId = Number(c.req.param("jobId"));
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return c.json({ error: "invalid_job_id" }, 400);
  }

  try {
    const row = await chainPublicClient.readContract({
      address: CLARITY_ESCROW_ADDRESS as `0x${string}`,
      abi: clarityEscrowJobsAbi,
      functionName: "jobs",
      args: [BigInt(jobId)],
    });
    const client = String(row[0]);
    if (client.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      return c.json({ error: "job_not_on_chain" }, 404);
    }
    const provider = String(row[1]);
    const evaluator = String(row[2]);
    const descriptionCid = String(row[5]);
    const st = Number(row[7]);
    const relayStatus = chainStatusToRelayJobStatus(st);

    const existing = jobs.find((j) => j.id === jobId);
    if (!existing) {
      jobs.push({
        id: jobId,
        chainId: baseSepolia.id,
        escrow: CLARITY_ESCROW_ADDRESS,
        client,
        provider,
        evaluator,
        descriptionCid,
        status: relayStatus,
        createdAt: Date.now(),
      });
    } else {
      existing.client = client;
      existing.provider = provider;
      existing.evaluator = evaluator;
      existing.descriptionCid = descriptionCid;
      existing.status = relayStatus;
    }

    const job = jobs.find((j) => j.id === jobId)!;
    const event: JobEvent = {
      id: events.length + 1,
      jobId,
      type: "job:synced",
      at: Date.now(),
      payload: { txHash: "0xsync" },
    };
    events.push(event);

    return c.json({ ok: true, job });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    return c.json({ error: "chain_read_failed", message: msg }, 502);
  }
});

app.get("/relay/events", (c) => {
  const jobId = c.req.query("jobId");
  if (!jobId) return c.json({ events: [...events].sort((a, b) => a.at - b.at) });
  const id = Number(jobId);
  const timeline = events.filter((e) => e.jobId === id).sort((a, b) => a.at - b.at);
  return c.json({ events: timeline });
});

app.post("/relay/metadata", async (c) => {
  const body = await c.req.json<JobMetadataInput>();
  if (!body.title?.trim() || !body.description?.trim()) {
    return c.json({ error: "title_and_description_required" }, 400);
  }
  const canonical = canonicalJobMetadataJson(body);
  const contentHash = metadataContentHash(canonical);
  const key = contentHash.toLowerCase();
  metadataByHash.set(key, { canonical });

  return c.json({ contentHash });
});

app.get("/relay/metadata", (c) => {
  const hash = c.req.query("hash");
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return c.json({ error: "invalid_hash_query" }, 400);
  }
  const rec = metadataByHash.get(hash.toLowerCase());
  if (!rec) return c.json({ error: "metadata_not_found" }, 404);
  let parsed: { v: number; title: string; description: string; tags: string[] };
  try {
    parsed = JSON.parse(rec.canonical) as typeof parsed;
  } catch {
    return c.json({ error: "corrupt_metadata" }, 500);
  }
  return c.json({
    contentHash: hash,
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
  });
});

app.get("/relay/listings", (c) => {
  const status = c.req.query("status") ?? "open";
  const nowSec = Math.floor(Date.now() / 1000);
  let filtered =
    status === "all" ? listings : listings.filter((l) => l.status === status);
  if (status === "open") {
    filtered = filtered.filter(
      (l) => l.status === "open" && l.listingExpiresAt > nowSec,
    );
  }
  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ listings: sorted });
});

app.get("/relay/listings/:id", (c) => {
  const id = Number(c.req.param("id"));
  const listing = listings.find((l) => l.id === id);
  if (!listing) return c.json({ error: "listing_not_found" }, 404);
  const bids = marketBids
    .filter((b) => b.listingId === id)
    .sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ listing, bids });
});

app.post("/relay/listings", async (c) => {
  const body = await c.req.json<{
    chainId: number;
    client: string;
    title: string;
    description: string;
    tags?: string[];
    contentHash: string;
    budgetHintUsdc?: string;
    listingExpiresAt: number;
  }>();

  if (!isAddress(body.client)) {
    return c.json({ error: "invalid_client" }, 400);
  }
  if (!body.title?.trim() || !body.description?.trim()) {
    return c.json({ error: "title_and_description_required" }, 400);
  }
  if (!body.contentHash || !/^0x[0-9a-fA-F]{64}$/.test(body.contentHash)) {
    return c.json({ error: "invalid_content_hash" }, 400);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(body.listingExpiresAt) || body.listingExpiresAt <= nowSec) {
    return c.json({ error: "invalid_listing_expires" }, 400);
  }
  const tags = [...(body.tags ?? [])].map((t) => t.trim()).filter(Boolean);
  const canonical = canonicalJobMetadataJson({
    title: body.title.trim(),
    description: body.description.trim(),
    tags,
  });
  const computed = metadataContentHash(canonical);
  if (computed.toLowerCase() !== body.contentHash.toLowerCase()) {
    return c.json({ error: "content_hash_mismatch" }, 400);
  }
  metadataByHash.set(computed.toLowerCase(), { canonical });

  const listing: MarketListing = {
    id: nextListingId++,
    chainId: Number(body.chainId) || 84532,
    client: body.client,
    title: body.title.trim(),
    description: body.description.trim(),
    tags,
    contentHash: computed,
    budgetHintUsdc: body.budgetHintUsdc?.trim() || undefined,
    listingExpiresAt: body.listingExpiresAt,
    status: "open",
    createdAt: Date.now(),
  };
  listings.push(listing);
  const ownerToken = randomBytes(32).toString("hex");
  listingOwnerTokens.set(listing.id, ownerToken);
  return c.json({ listing, ownerToken });
});

app.post("/relay/listings/:id/bids", async (c) => {
  const listingId = Number(c.req.param("id"));
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) return c.json({ error: "listing_not_found" }, 404);
  if (listing.status !== "open") {
    return c.json({ error: "listing_not_open" }, 400);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > listing.listingExpiresAt) {
    return c.json({ error: "listing_expired" }, 400);
  }

  const body = await c.req.json<{ agentAddress: string; message: string }>();
  if (!isAddress(body.agentAddress)) {
    return c.json({ error: "invalid_agent" }, 400);
  }
  const msg = (body.message ?? "").trim();
  if (!msg || msg.length > 2000) {
    return c.json({ error: "invalid_message" }, 400);
  }
  if (body.agentAddress.toLowerCase() === listing.client.toLowerCase()) {
    return c.json({ error: "client_cannot_bid" }, 400);
  }

  const bid: MarketBid = {
    id: nextBidId++,
    listingId,
    agentAddress: body.agentAddress,
    message: msg,
    createdAt: Date.now(),
    status: "pending",
  };
  marketBids.push(bid);
  return c.json({ bid });
});

app.post("/relay/listings/:id/accept", async (c) => {
  const listingId = Number(c.req.param("id"));
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) return c.json({ error: "listing_not_found" }, 404);
  if (listing.status !== "open") {
    return c.json({ error: "listing_not_open" }, 400);
  }

  const body = await c.req.json<{
    client: string;
    bidId: number;
    evaluator: string;
    ownerToken: string;
  }>();
  if (!body.client || listing.client.toLowerCase() !== body.client.toLowerCase()) {
    return c.json({ error: "unauthorized_client" }, 403);
  }
  const expectedToken = listingOwnerTokens.get(listingId);
  if (!expectedToken || body.ownerToken !== expectedToken) {
    return c.json({ error: "invalid_owner_token" }, 403);
  }
  if (!isAddress(body.evaluator)) {
    return c.json({ error: "invalid_evaluator" }, 400);
  }
  const bid = marketBids.find(
    (b) => b.id === body.bidId && b.listingId === listingId && b.status === "pending",
  );
  if (!bid) return c.json({ error: "bid_not_found" }, 404);
  if (bid.agentAddress.toLowerCase() === body.evaluator.toLowerCase()) {
    return c.json({ error: "evaluator_cannot_match_provider" }, 400);
  }

  listing.status = "assigned";
  listing.acceptedBidId = bid.id;
  listing.provider = bid.agentAddress;
  listing.evaluator = body.evaluator;
  bid.status = "accepted";
  for (const b of marketBids) {
    if (b.listingId === listingId && b.id !== bid.id && b.status === "pending") {
      b.status = "rejected";
    }
  }
  return c.json({ listing });
});

app.post("/relay/listings/:id/cancel", async (c) => {
  const listingId = Number(c.req.param("id"));
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) return c.json({ error: "listing_not_found" }, 404);
  const body = await c.req.json<{ client: string; ownerToken: string }>();
  if (!body.client || listing.client.toLowerCase() !== body.client.toLowerCase()) {
    return c.json({ error: "unauthorized_client" }, 403);
  }
  const expectedToken = listingOwnerTokens.get(listingId);
  if (!expectedToken || body.ownerToken !== expectedToken) {
    return c.json({ error: "invalid_owner_token" }, 403);
  }
  if (listing.status !== "open") {
    return c.json({ error: "listing_not_open" }, 400);
  }
  listing.status = "cancelled";
  for (const b of marketBids) {
    if (b.listingId === listingId && b.status === "pending") b.status = "rejected";
  }
  return c.json({ listing });
});

app.post("/relay/listings/:id/onchain", async (c) => {
  const listingId = Number(c.req.param("id"));
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) return c.json({ error: "listing_not_found" }, 404);
  const body = await c.req.json<{ client: string; escrowJobId: number; ownerToken: string }>();
  if (!body.client || listing.client.toLowerCase() !== body.client.toLowerCase()) {
    return c.json({ error: "unauthorized_client" }, 403);
  }
  const expectedToken = listingOwnerTokens.get(listingId);
  if (!expectedToken || body.ownerToken !== expectedToken) {
    return c.json({ error: "invalid_owner_token" }, 403);
  }
  if (listing.status !== "assigned") {
    return c.json({ error: "listing_not_assigned" }, 400);
  }
  if (!Number.isFinite(body.escrowJobId) || body.escrowJobId <= 0) {
    return c.json({ error: "invalid_escrow_job_id" }, 400);
  }
  listing.status = "onchain";
  listing.escrowJobId = body.escrowJobId;
  return c.json({ listing });
});

app.post("/relay/events", async (c) => {
  const body = await c.req.json<{
    job: RelayJob;
    event: Omit<JobEvent, "id" | "at">;
  }>();

  const existing = jobs.find((j) => j.id === body.job.id);
  if (!existing) {
    jobs.push({
      ...body.job,
      createdAt: body.job.createdAt ?? Date.now(),
    });
  } else {
    const keepCreated = existing.createdAt;
    Object.assign(existing, body.job);
    existing.createdAt = keepCreated;
  }

  const event: JobEvent = {
    ...body.event,
    id: events.length + 1,
    at: Date.now(),
  };
  events.push(event);

  return c.json({ ok: true, eventId: event.id });
});

app.post("/relay/deliverables", async (c) => {
  let body: { jobId?: number; plaintext?: string };
  try {
    body = (await c.req.json()) as { jobId?: number; plaintext?: string };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  if (!Number.isFinite(body.jobId) || !body.jobId || body.jobId <= 0) {
    return c.json({ error: "invalid_job_id" }, 400);
  }
  if (typeof body.plaintext !== "string") {
    return c.json({ error: "plaintext_required" }, 400);
  }
  if (body.plaintext.length > 500_000) {
    return c.json({ error: "plaintext_too_long" }, 400);
  }

  const record: DeliverableRecord = {
    jobId: body.jobId,
    plaintext: body.plaintext,
    updatedAt: Date.now(),
  };
  deliverables.set(body.jobId, record);
  return c.json({ ok: true, jobId: body.jobId });
});

app.get("/relay/deliverables/:jobId", (c) => {
  const jobId = Number(c.req.param("jobId"));
  const record = deliverables.get(jobId);
  if (!record) return c.json({ error: "deliverable_not_found" }, 404);
  return c.json(record);
});

const port = Number(process.env.PORT || 8788);
serve({ fetch: app.fetch, port });
console.log(`[clarity-relay] listening on :${port}`);
console.log(
  `[clarity-relay] sync-from-chain: ${
    chainPublicClient ? "enabled" : "disabled (set CLARITY_ESCROW_ADDRESS for sync_job parity)"
  }`,
);
