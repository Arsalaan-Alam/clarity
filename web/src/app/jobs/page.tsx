import { JobsList } from "./jobs-list";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
      <p className="text-sm text-zinc-600">
        All jobs come from the escrow contract (<span className="font-mono text-xs">jobCount</span>{" "}
        + <span className="font-mono text-xs">jobs(id)</span>). Relay timelines still load on each job
        page when the relay has events for that id.
      </p>
      <JobsList />
    </div>
  );
}
