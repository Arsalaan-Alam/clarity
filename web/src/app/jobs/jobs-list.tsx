"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { baseSepolia } from "wagmi/chains";
import { usePublicClient } from "wagmi";
import { clarityEscrowAbi } from "@/lib/abi";
import { getEscrowAddress } from "@/lib/env";
import { fetchJobTitleForList } from "@/lib/relay";
import { onChainStatusLabel } from "@/lib/status";
import { LoadingBlock } from "@/components/spinner";

type ListedJob = {
  id: number;
  status: string;
  clientShort: string;
  title: string | null;
};

export function JobsList() {
  const escrow = getEscrowAddress();
  const publicClient = usePublicClient({ chainId: baseSepolia.id });

  const { data: jobs, isPending, error } = useQuery({
    queryKey: ["escrowJobList", escrow],
    enabled: Boolean(escrow && publicClient),
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ListedJob[]> => {
      if (!escrow || !publicClient) return [];

      const jobCount = await publicClient.readContract({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobCount",
      });

      const n = Number(jobCount);
      if (!Number.isFinite(n) || n <= 0) return [];

      const contracts = Array.from({ length: n }, (_, i) => ({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobs" as const,
        args: [BigInt(i + 1)] as const,
      }));

      const results = await publicClient.multicall({
        contracts,
        allowFailure: true,
      });

      const baseRows: { id: number; status: string; clientShort: string; descriptionCid: string }[] =
        [];
      for (let i = 0; i < n; i++) {
        const item = results[i];
        if (!item || item.status !== "success") continue;
        const tuple = item.result as readonly unknown[];
        if (!Array.isArray(tuple) || tuple.length < 8) continue;
        const client = String(tuple[0]);
        const statusIdx = Number(tuple[7]);
        const descriptionCid = String(tuple[5]);
        baseRows.push({
          id: i + 1,
          status: onChainStatusLabel(statusIdx),
          clientShort: `${client.slice(0, 6)}…${client.slice(-4)}`,
          descriptionCid,
        });
      }

      const withTitles = await Promise.all(
        baseRows.map(async (r) => {
          const title = await fetchJobTitleForList(r.id, r.descriptionCid);
          return {
            id: r.id,
            status: r.status,
            clientShort: r.clientShort,
            title,
          } satisfies ListedJob;
        }),
      );
      return withTitles;
    },
  });

  if (!escrow) {
    return (
      <p className="text-sm text-amber-200/90">
        Set <code className="font-mono text-xs text-teal-200/80">NEXT_PUBLIC_ESCROW_ADDRESS</code> in{" "}
        <code className="font-mono text-xs text-teal-200/80">web/.env.local</code>.
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        {error instanceof Error ? error.message : "Failed to load jobs"} — check{" "}
        <code className="font-mono text-xs text-slate-300">NEXT_PUBLIC_RPC_URL</code> if reads time out.
      </p>
    );
  }

  if (isPending || jobs === undefined) {
    return <LoadingBlock />;
  }

  if (jobs.length === 0) {
    return <p className="text-sm text-slate-500">No jobs yet.</p>;
  }

  return (
    <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-slate-900/40">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link
            href={`/jobs/${j.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {j.title ? (
                <span className="truncate text-sm font-medium text-slate-100">{j.title}</span>
              ) : null}
              <span className="font-mono text-sm text-slate-300">#{j.id}</span>
              <span className="truncate font-mono text-xs text-slate-500">{j.clientShort}</span>
            </div>
            <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-300">
              {j.status}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
