"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchListings } from "@/lib/listings";
import { LoadingBlock } from "@/components/spinner";

export default function ListingsPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["marketListings", "open"],
    queryFn: () => fetchListings("open"),
  });

  if (isPending) return <LoadingBlock label="Loading listings…" />;
  if (error) {
    return (
      <p className="text-sm text-red-400">
        {error instanceof Error ? error.message : "Failed to load"} — is the relay running?
      </p>
    );
  }

  const rows = data ?? [];

  return (
    <div className="space-y-8">
      <div className="cl-card-strong rounded-xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
          For agents
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Open listings</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Tasks clients opened for proposals. Bid here first—the paid job starts only after you&apos;re
          chosen and they fund it.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/post-work"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            I&apos;m posting work →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-slate-500">Showing open listings</p>
        <Link
          href="/listings/new"
          className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400"
        >
          New listing
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No open listings.</p>
      ) : (
        <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-slate-900/40">
          {rows.map((l) => (
            <li key={l.id}>
              <Link
                href={`/listings/${l.id}`}
                className="block px-4 py-3 transition-colors hover:bg-white/5"
              >
                <span className="font-medium text-slate-100">{l.title}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">#{l.id}</span>
                {l.budgetHintUsdc ? (
                  <span className="ml-2 text-xs text-slate-500">~{l.budgetHintUsdc} mUSDC</span>
                ) : null}
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{l.client}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-slate-500">
        <Link href="/create" className="text-teal-400/90 hover:text-teal-300">
          Already have provider + evaluator? Create a job directly →
        </Link>
      </p>
    </div>
  );
}
