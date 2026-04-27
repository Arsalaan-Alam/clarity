"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { clarityEscrowAbi } from "@/lib/abi";
import { getEscrowAddress } from "@/lib/env";
import { fetchRelayJobDetail, type RelayEvent, type RelayJob } from "@/lib/relay";
import { onChainStatusLabel } from "@/lib/status";

const card = "cl-card-strong rounded-xl p-4";

function ExplorerTx({ hash }: { hash: string }) {
  if (hash === "0xsync") {
    return <span className="text-slate-500">—</span>;
  }
  const href = `https://sepolia.basescan.org/tx/${hash}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-teal-400 hover:text-teal-300 hover:underline"
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
      <p className="text-sm text-amber-200/90">
        Set{" "}
        <code className="font-mono text-teal-200/80">NEXT_PUBLIC_ESCROW_ADDRESS</code> in{" "}
        <code className="font-mono text-teal-200/80">web/.env.local</code>.
      </p>
    );
  }

  if (err) {
    return <p className="text-sm text-red-400">{err}</p>;
  }

  const statusIdx = onchain && Array.isArray(onchain) ? Number(onchain[7]) : -1;
  const budget = onchain && Array.isArray(onchain) ? (onchain[3] as bigint) : 0n;
  const statusLabel =
    statusIdx >= 0 ? onChainStatusLabel(statusIdx) : "unknown";

  return (
    <div className="space-y-8">
      <Link
        href="/jobs"
        className="text-xs text-slate-500 hover:text-teal-300"
      >
        ← Jobs
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white">
          {relay?.job.title ?? `Job #${jobId}`}
        </h1>
        {relay?.job.title ? (
          <p className="text-sm text-slate-400">
            <span className="font-mono">#{jobId}</span>
          </p>
        ) : null}
      </header>

      <section className={card}>
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
          On-chain
        </h2>
        {readErr ? (
          <p className="mt-2 text-sm text-amber-200/90">{readErr.message}</p>
        ) : onchain == null ? (
          <p className="mt-2 text-sm text-slate-500">Loading or no job…</p>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-mono text-slate-200">{statusLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Budget</dt>
              <dd className="text-slate-200">
                {formatUnits(budget, 6)} <span className="text-slate-500">mUSDC</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Client</dt>
              <dd className="break-all font-mono text-xs text-slate-300">
                {String((onchain as readonly unknown[])[0])}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Provider</dt>
              <dd className="break-all font-mono text-xs text-slate-300">
                {String((onchain as readonly unknown[])[1])}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Evaluator</dt>
              <dd className="break-all font-mono text-xs text-slate-300">
                {String((onchain as readonly unknown[])[2])}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {!relayLoading && relay && (
        <section className={`${card} space-y-3`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Relay
          </h2>
          <p className="text-sm text-slate-400">
            Off-chain status:{" "}
            <span className="text-slate-200">{relay.job.status}</span>
          </p>
          {relay.job.description ? (
            <div>
              <h3 className="text-xs font-medium text-slate-500">Description</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
                {relay.job.description}
              </p>
            </div>
          ) : null}
          {relay.job.tags && relay.job.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {relay.job.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {relayLoading && (
        <p className="text-sm text-slate-500">Loading relay…</p>
      )}

      {!relayLoading && relay && relay.timeline.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Timeline
          </h2>
          <ol className="mt-3 space-y-2 border-l border-white/15 pl-4">
            {relay.timeline.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-xs text-slate-500">
                  {new Date(e.at).toLocaleString()}
                </span>
                <br />
                <span className="text-slate-200">{e.type}</span>{" "}
                {e.payload?.txHash && <ExplorerTx hash={e.payload.txHash} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      {!relayLoading && !relay && !err && (
        <p className="text-sm text-slate-500">
          No relay entry for this id (chain data above if the job exists).
        </p>
      )}
    </div>
  );
}
