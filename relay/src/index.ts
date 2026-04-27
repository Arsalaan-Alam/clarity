import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { isAddress } from "viem";
import {
  canonicalJobMetadataJson,
  metadataContentHash,
  type JobMetadataInput,
} from "./metadata.js";

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
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "aes-256-gcm";
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
  const body = await c.req.json<{
    jobId: number;
    ciphertext: string;
    iv: string;
    authTag: string;
    algorithm?: "aes-256-gcm";
  }>();

  if (!Number.isFinite(body.jobId) || body.jobId <= 0) {
    return c.json({ error: "invalid_job_id" }, 400);
  }

  const record: DeliverableRecord = {
    jobId: body.jobId,
    ciphertext: body.ciphertext,
    iv: body.iv,
    authTag: body.authTag,
    algorithm: body.algorithm || "aes-256-gcm",
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
