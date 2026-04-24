import { Hono } from "hono";
import { serve } from "@hono/node-server";

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
};

const app = new Hono();

const jobs: RelayJob[] = [];
const events: JobEvent[] = [];

app.get("/health", (c) => c.json({ ok: true, service: "clarity-relay" }));

app.get("/relay/jobs", (c) => c.json({ jobs }));

app.get("/relay/jobs/:id", (c) => {
  const id = Number(c.req.param("id"));
  const job = jobs.find((j) => j.id === id);
  if (!job) return c.json({ error: "job_not_found" }, 404);

  return c.json({
    job,
    timeline: events.filter((e) => e.jobId === id),
  });
});

app.post("/relay/events", async (c) => {
  const body = await c.req.json<{
    job: RelayJob;
    event: Omit<JobEvent, "id" | "at">;
  }>();

  const existing = jobs.find((j) => j.id === body.job.id);
  if (!existing) {
    jobs.push(body.job);
  } else {
    Object.assign(existing, body.job);
  }

  const event: JobEvent = {
    ...body.event,
    id: events.length + 1,
    at: Date.now(),
  };
  events.push(event);

  return c.json({ ok: true, eventId: event.id });
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port });
console.log(`[clarity-relay] listening on :${port}`);
