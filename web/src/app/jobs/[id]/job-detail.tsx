"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { clarityEscrowAbi } from "@/lib/abi";
import { getEscrowAddress } from "@/lib/env";
import { fetchRelayJobDetail, type RelayEvent, type RelayJob } from "@/lib/relay";
import { onChainStatusLabel } from "@/lib/status";

function ExplorerTx({ hash }: { hash: string }) {
  if (hash === "0xsync") {
    return <span className="text-zinc-400">—</span>;
  }
  const href = `https://sepolia.basescan.org/tx/${hash}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-blue-600 hover:underline"
    >
      {hash.slice(0, 10)}…
    </a>
  );
}

export function JobDetail({ id: idStr }: { id: string }) {
  const jobId = Number(idStr);
  const escrow = getEscrowAddress();
  const [relay, setRelay] = useState<{
    job: RelayJob;
    timeline: RelayEvent[];
  } | null>(null);
  const [relayLoading, setRelayLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = false;
    setRelayLoading(true);
    (async () => {
      try {
        const d = await fetchRelayJobDetail(jobId);
        if (!c) {
          setRelay(d);
          setErr(null);
        }
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : "Relay error");
      } finally {
        if (!c) setRelayLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [jobId]);

  const { data: onchain, error: readErr } = useReadContract({
    address: escrow ?? "0x0000000000000000000000000000000000000000",
    abi: clarityEscrowAbi,
    functionName: "jobs",
    args: [BigInt(jobId)],
    query: { enabled: Number.isFinite(jobId) && jobId > 0 && !!escrow },
  });

  if (!escrow) {
    return (
      <p className="text-sm text-amber-800">
        Set{" "}
        <code className="font-mono">NEXT_PUBLIC_ESCROW_ADDRESS</code> in{" "}
        <code className="font-mono">web/.env.local</code>.
      </p>
    );
  }

  if (err) {
    return <p className="text-sm text-red-600">{err}</p>;
  }

  const statusIdx = onchain && Array.isArray(onchain) ? Number(onchain[7]) : -1;
  const budget = onchain && Array.isArray(onchain) ? (onchain[3] as bigint) : 0n;
  const statusLabel =
    statusIdx >= 0 ? onChainStatusLabel(statusIdx) : "unknown";

  return (
    <div className="space-y-8">
      <Link
        href="/jobs"
        className="text-xs text-zinc-500 hover:text-zinc-800"
      >
        ← Jobs
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">
          {relay?.job.title ?? `Job #${jobId}`}
        </h1>
        {relay?.job.title ? (
          <p className="text-sm text-zinc-500">
            <span className="font-mono">#{jobId}</span>
          </p>
        ) : null}
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          On-chain
        </h2>
        {readErr ? (
          <p className="mt-2 text-sm text-amber-700">{readErr.message}</p>
        ) : onchain == null ? (
          <p className="mt-2 text-sm text-zinc-500">Loading or no job…</p>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Status</dt>
              <dd className="font-mono text-zinc-800">{statusLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Budget</dt>
              <dd>
                {formatUnits(budget, 6)} <span className="text-zinc-500">mUSDC</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Client</dt>
              <dd className="font-mono text-xs break-all">
                {String((onchain as readonly unknown[])[0])}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Provider</dt>
              <dd className="font-mono text-xs break-all">
                {String((onchain as readonly unknown[])[1])}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Evaluator</dt>
              <dd className="font-mono text-xs break-all">
                {String((onchain as readonly unknown[])[2])}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {!relayLoading && relay && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Relay
          </h2>
          <p className="text-sm text-zinc-600">
            Off-chain status:{" "}
            <span className="text-zinc-800">{relay.job.status}</span>
          </p>
          {relay.job.description ? (
            <div>
              <h3 className="text-xs font-medium text-zinc-500">Description</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                {relay.job.description}
              </p>
            </div>
          ) : null}
          {relay.job.tags && relay.job.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {relay.job.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {relayLoading && (
        <p className="text-sm text-zinc-500">Loading relay…</p>
      )}

      {!relayLoading && relay && relay.timeline.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Timeline
          </h2>
          <ol className="mt-3 space-y-2 border-l border-zinc-200 pl-4">
            {relay.timeline.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-zinc-500 text-xs">
                  {new Date(e.at).toLocaleString()}
                </span>
                <br />
                <span className="text-zinc-800">{e.type}</span>{" "}
                {e.payload?.txHash && <ExplorerTx hash={e.payload.txHash} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      {!relayLoading && !relay && !err && (
        <p className="text-sm text-zinc-500">
          No relay entry for this id (chain data above if the job exists).
        </p>
      )}
    </div>
  );
}
