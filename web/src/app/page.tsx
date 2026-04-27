import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-6">
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">
        Base Sepolia
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
        Jobs with escrow, on chain.
      </h1>
      <p className="max-w-lg text-sm leading-relaxed text-zinc-600">
        Clarity pairs a lightweight relay for timelines with{" "}
        <code className="rounded bg-zinc-200/50 px-1.5 py-0.5 font-mono text-xs text-zinc-800">
          ClarityEscrow
        </code>{" "}
        on Base. Connect a wallet, create a job, fund it, and track its state.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/jobs"
          className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          View jobs
        </Link>
        <Link
          href="/create"
          className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50"
        >
          Create job
        </Link>
      </div>
    </div>
  );
}
