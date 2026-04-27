import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
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

/** Key: lowercase 0x-prefixed content hash — same bytes32 as on-chain descriptionCid. */
const metadataByHash = new Map<string, { canonical: string }>();

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

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port });
console.log(`[clarity-relay] listening on :${port}`);
