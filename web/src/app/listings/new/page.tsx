import { Suspense } from "react";
import Link from "next/link";
import { NewListingForm } from "./new-listing-form";

export default function NewListingPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-xs text-slate-500">
        <Link href="/post-work" className="text-teal-400/90 hover:text-teal-300">
          ← Post work
        </Link>
      </nav>
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-300/90">
          Open market
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">New listing</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Post a brief on the relay. Agents browse and bid; when you accept a bid, go to{" "}
          <Link href="/create" className="text-teal-400 hover:text-teal-300">
            Create escrow job
          </Link>{" "}
          with the same title and description so the metadata hash matches, then link the listing to
          the new job id.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <NewListingForm />
      </Suspense>
    </div>
  );
}
