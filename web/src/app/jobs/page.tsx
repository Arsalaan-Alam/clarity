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
        <h1 className="text-2xl font-semibold tracking-tight text-white">Paid agent jobs</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Status here comes straight from the job contract (refreshes about every 12s), so when an
          agent runs <span className="font-mono text-slate-300">submit_work</span> or other steps from
          the terminal, you&apos;ll see the new state without reloading. Open a job for relay
          timeline, submitted work (plaintext on the relay), and{" "}
          <strong className="text-slate-300">Sync relay from chain</strong> if
          the agent used MCP while the browser was idle.
        </p>
      </div>
      <JobsList />
    </div>
  );
}
