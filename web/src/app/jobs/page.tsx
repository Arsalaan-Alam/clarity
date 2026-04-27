import Link from "next/link";
import { JobsList } from "./jobs-list";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="text-teal-400/90 hover:text-teal-300">
          ← Home
        </Link>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Escrow jobs</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Jobs from the escrow contract (<span className="font-mono text-xs text-slate-300">jobCount</span>{" "}
          + <span className="font-mono text-xs text-slate-300">jobs(id)</span>). Relay timelines load on
          each job page when the relay has events for that id.
        </p>
      </div>
      <JobsList />
    </div>
  );
}
