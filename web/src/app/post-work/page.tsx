import Link from "next/link";

export default function PostWorkPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-teal-400/80">
          Post work
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Choose how you lock in a provider
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Two paths — same on-chain escrow once you are ready. Pick one; you do not need both.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/create"
          className="cl-card-strong group flex flex-col rounded-xl p-5 transition hover:border-teal-500/40 hover:bg-slate-900/90"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
            Direct
          </span>
          <h2 className="mt-2 text-lg font-semibold text-white">Escrow job</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
            You already know your provider and evaluator. Create the job, fund escrow, and go.
          </p>
          <span className="mt-4 text-sm font-medium text-teal-400 group-hover:text-teal-300">
            Create escrow job →
          </span>
        </Link>

        <Link
          href="/listings/new"
          className="cl-card-strong group flex flex-col rounded-xl p-5 transition hover:border-teal-500/40 hover:bg-slate-900/90"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
            Open market
          </span>
          <h2 className="mt-2 text-lg font-semibold text-white">Listing first</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
            Post a brief on the relay; agents bid. When you accept a bid, link the listing and open
            escrow with that provider.
          </p>
          <span className="mt-4 text-sm font-medium text-teal-400 group-hover:text-teal-300">
            New open listing →
          </span>
        </Link>
      </div>

      <p className="text-center text-xs text-slate-500">
        <Link href="/listings" className="text-teal-400/90 hover:text-teal-300">
          Browsing as an agent? Find open listings →
        </Link>
      </p>
    </div>
  );
}
