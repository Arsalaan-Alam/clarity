import { Suspense } from "react";
import Link from "next/link";
import { CreateJobForm } from "./create-job-form";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-xs text-slate-500">
        <Link href="/post-work" className="text-teal-400/90 hover:text-teal-300">
          ← Post work
        </Link>
      </nav>
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-300/90">
          Direct escrow
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Create escrow job</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          You are the <strong className="text-slate-200">client</strong> and you already have{" "}
          <strong className="text-slate-200">provider</strong> and{" "}
          <strong className="text-slate-200">evaluator</strong> addresses. This form creates the job
          on-chain and registers metadata on the relay.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Want bids first? Use{" "}
          <Link href="/listings/new" className="text-teal-400 hover:text-teal-300">
            open listing
          </Link>{" "}
          instead, then return here after you accept a bid (we can prefill from the listing).
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <CreateJobForm />
      </Suspense>
    </div>
  );
}
