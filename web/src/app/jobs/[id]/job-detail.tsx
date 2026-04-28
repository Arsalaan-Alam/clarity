"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { baseSepolia } from "wagmi/chains";
import {
  useConnection,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { formatUnits, type Hex } from "viem";
import { clarityEscrowAbi } from "@/lib/abi";
import { getEscrowAddress } from "@/lib/env";
import {
  chainStatusToRelayStatus,
  deliverableCidFromPlaintext,
  fetchDeliverablePlaintext,
  fetchRelayJobDetail,
  postRelayDeliverablePlaintext,
  postRelayEvent,
  syncRelayJobFromChain,
  type RelayEvent,
  type RelayJob,
} from "@/lib/relay";
import { onChainStatusLabel } from "@/lib/status";

const card = "cl-card-strong rounded-xl p-4";
const TX_GAS = 500_000n;

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

function addrLower(a: string | undefined): string {
  return (a ?? "").toLowerCase();
}

export function JobDetail({ id: idStr }: { id: string }) {
  const jobId = Number(idStr);
  const escrow = getEscrowAddress();
  const { address, status: connStatus, chainId } = useConnection();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const [relay, setRelay] = useState<{
    job: RelayJob;
    timeline: RelayEvent[];
  } | null>(null);
  const [relayLoading, setRelayLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [submitText, setSubmitText] = useState("");
  const [deliverableText, setDeliverableText] = useState<string | null>(null);
  const [deliverableLoadErr, setDeliverableLoadErr] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);

  const loadRelay = useCallback(async () => {
    setRelayLoading(true);
    try {
      const d = await fetchRelayJobDetail(jobId);
      setRelay(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Relay error");
    } finally {
      setRelayLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadRelay();
  }, [loadRelay]);

  const {
    data: onchain,
    error: readErr,
    refetch: refetchOnchain,
  } = useReadContract({
    address: escrow ?? "0x0000000000000000000000000000000000000000",
    abi: clarityEscrowAbi,
    functionName: "jobs",
    args: [BigInt(jobId)],
    query: {
      enabled: Number.isFinite(jobId) && jobId > 0 && !!escrow,
      refetchInterval: (q) => {
        const row = q.state.data;
        if (!row || !Array.isArray(row)) return false;
        const st = Number((row as readonly unknown[])[7]);
        return st <= 2 ? 12_000 : false;
      },
    },
  });

  /** Keep relay timeline in view when an agent updates the job from the terminal (MCP). */
  useEffect(() => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    const row = onchain;
    if (!row || !Array.isArray(row)) return;
    const st = Number((row as readonly unknown[])[7]);
    if (st > 2) return;
    const id = window.setInterval(() => {
      void loadRelay();
    }, 14_000);
    return () => window.clearInterval(id);
  }, [jobId, onchain, loadRelay]);

  useEffect(() => {
    const row = onchain;
    const st = row && Array.isArray(row) ? Number((row as readonly unknown[])[7]) : -1;
    if (st < 2) {
      setDeliverableText(null);
      setDeliverableLoadErr(null);
      return;
    }
    let cancelled = false;
    setDeliverableLoadErr(null);
    void fetchDeliverablePlaintext(jobId)
      .then((t) => {
        if (!cancelled) {
          setDeliverableText(t);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDeliverableLoadErr(e instanceof Error ? e.message : "Load failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, onchain]);

  const readRow = async () => {
    if (!escrow || !publicClient) return null;
    return publicClient.readContract({
      address: escrow,
      abi: clarityEscrowAbi,
      functionName: "jobs",
      args: [BigInt(jobId)],
    });
  };

  const syncRelayAfterTx = async (eventType: string, txHash: Hex) => {
    if (!escrow) return;
    const row = await readRow();
    if (!row || !Array.isArray(row)) return;
    const r = row as readonly unknown[];
    const st = Number(r[7]);
    await postRelayEvent({
      jobId,
      eventType,
      status: chainStatusToRelayStatus(st),
      txHash,
      job: {
        chainId: baseSepolia.id,
        escrow,
        client: String(r[0]),
        provider: String(r[1]),
        evaluator: String(r[2]),
        descriptionCid: String(r[5]),
        ...(relay?.job.title ? { title: relay.job.title } : {}),
        ...(relay?.job.description ? { description: relay.job.description } : {}),
        ...(relay?.job.tags ? { tags: relay.job.tags } : {}),
      },
    });
    await loadRelay();
    await refetchOnchain();
  };

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
  const expiresAtSec =
    onchain && Array.isArray(onchain) ? BigInt(onchain[4] as bigint) : 0n;
  const statusLabel = statusIdx >= 0 ? onChainStatusLabel(statusIdx) : "unknown";

  const clientAddr = onchain && Array.isArray(onchain) ? String(onchain[0]) : "";
  const providerAddr = onchain && Array.isArray(onchain) ? String(onchain[1]) : "";
  const evaluatorAddr = onchain && Array.isArray(onchain) ? String(onchain[2]) : "";

  const isClient = connStatus === "connected" && addrLower(address) === addrLower(clientAddr);
  const isProvider = connStatus === "connected" && addrLower(address) === addrLower(providerAddr);
  const isEvaluator =
    connStatus === "connected" && addrLower(address) === addrLower(evaluatorAddr);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const fundedExpired = statusIdx === 1 && nowSec > expiresAtSec;
  const wrongChain = connStatus === "connected" && chainId !== baseSepolia.id;

  const runSubmitWork = async () => {
    setActionMsg(null);
    if (!address || !publicClient || wrongChain) {
      setActionMsg("Connect the provider wallet on Base Sepolia.");
      return;
    }
    if (!submitText.trim()) {
      setActionMsg("Enter deliverable text.");
      return;
    }
    try {
      const trimmed = submitText.trim();
      const cid = deliverableCidFromPlaintext(trimmed);
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "submitWork",
        args: [BigInt(jobId), cid],
        gas: TX_GAS,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await postRelayDeliverablePlaintext({ jobId, plaintext: trimmed });
      await syncRelayAfterTx("job:submitted", hash);
      setSubmitText("");
      setActionMsg("Work submitted.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Submit failed");
    }
  };

  const runComplete = async () => {
    setActionMsg(null);
    if (!address || !publicClient || wrongChain) {
      setActionMsg("Connect the evaluator wallet on Base Sepolia.");
      return;
    }
    if (!evaluatorAddr) {
      setActionMsg("Waiting for on-chain job data…");
      return;
    }
    if (addrLower(address) !== addrLower(evaluatorAddr)) {
      setActionMsg("Only the on-chain evaluator can approve.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "completeJob",
        args: [BigInt(jobId)],
        gas: TX_GAS,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await syncRelayAfterTx("job:completed", hash);
      setActionMsg("Payment released.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Complete failed");
    }
  };

  const runReject = async () => {
    setActionMsg(null);
    if (!address || !publicClient || wrongChain) {
      setActionMsg("Connect the evaluator wallet on Base Sepolia.");
      return;
    }
    if (!evaluatorAddr) {
      setActionMsg("Waiting for on-chain job data…");
      return;
    }
    if (addrLower(address) !== addrLower(evaluatorAddr)) {
      setActionMsg("Only the on-chain evaluator can reject.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "rejectJob",
        args: [BigInt(jobId)],
        gas: TX_GAS,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await syncRelayAfterTx("job:rejected", hash);
      setActionMsg("Work rejected; client refunded.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const runClaimRefund = async () => {
    setActionMsg(null);
    if (!address || !publicClient || wrongChain) {
      setActionMsg("Connect the client wallet on Base Sepolia.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "claimRefund",
        args: [BigInt(jobId)],
        gas: TX_GAS,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await syncRelayAfterTx("job:refunded", hash);
      setActionMsg("Refund claimed (job expired without submission).");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Refund failed");
    }
  };

  const runRefresh = async () => {
    setRefreshBusy(true);
    setActionMsg(null);
    try {
      await Promise.all([refetchOnchain(), loadRelay()]);
      setActionMsg("Refreshed on-chain data and relay.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshBusy(false);
    }
  };

  const runSyncRelayFromChain = async () => {
    setSyncBusy(true);
    setActionMsg(null);
    try {
      await syncRelayJobFromChain(jobId);
      await loadRelay();
      await refetchOnchain();
      setActionMsg("Relay updated from chain (same idea as MCP sync_job).");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Sync failed — is relay running with CLARITY_ESCROW_ADDRESS?");
    } finally {
      setSyncBusy(false);
    }
  };

  const showActions =
    onchain &&
    Array.isArray(onchain) &&
    statusIdx >= 0 &&
    connStatus === "connected" &&
    !wrongChain;

  const relayStatusFromChain =
    statusIdx >= 0 ? chainStatusToRelayStatus(statusIdx) : null;
  const relayMismatch =
    relay &&
    relayStatusFromChain != null &&
    relay.job.status !== relayStatusFromChain;
  const hasOnchainJob =
    onchain != null &&
    Array.isArray(onchain) &&
    String(onchain[0]).toLowerCase() !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="space-y-8">
      <Link href="/jobs" className="text-xs text-slate-500 hover:text-teal-300">
        ← Jobs
      </Link>
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">
            {relay?.job.title ?? `Job #${jobId}`}
          </h1>
          {relay?.job.title ? (
            <p className="text-sm text-slate-400">
              <span className="font-mono">#{jobId}</span>
            </p>
          ) : null}
        </div>
        {hasOnchainJob ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshBusy || relayLoading}
              onClick={() => void runRefresh()}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              {refreshBusy ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => void runSyncRelayFromChain()}
              className="rounded-lg border border-teal-500/35 bg-teal-950/40 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-900/50 disabled:opacity-50"
            >
              {syncBusy ? "Syncing…" : "Sync relay from chain"}
            </button>
          </div>
        ) : null}
      </header>

      {relayMismatch ? (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-950/35 px-3 py-2 text-xs leading-relaxed text-amber-100"
          role="status"
        >
          Relay shows <span className="font-mono">{relay?.job.status}</span> but the contract is{" "}
          <span className="font-mono">{relayStatusFromChain}</span>. After an agent uses the terminal,
          click <strong className="text-white">Sync relay from chain</strong> (or run MCP{" "}
          <code className="rounded bg-black/30 px-1 font-mono">sync_job {jobId}</code>
          ).
        </div>
      ) : null}

      {!relayLoading && !relay && hasOnchainJob ? (
        <div className="rounded-lg border border-slate-500/30 bg-slate-900/50 px-3 py-2 text-xs leading-relaxed text-slate-300">
          No relay row for this job yet. If the agent submitted work from the terminal, use{" "}
          <strong className="text-white">Sync relay from chain</strong> so the timeline and
          deliverable preview stay aligned.
        </div>
      ) : null}

      <details className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        <summary className="cursor-pointer select-none text-slate-300 hover:text-slate-200">
          Agent (terminal / MCP) commands for job #{jobId}
        </summary>
        <p className="mt-2 leading-relaxed">
          From repo root with <code className="font-mono text-teal-200/90">.env</code> loaded (
          <code className="font-mono">CLARITY_API_URL</code> = relay,{" "}
          <code className="font-mono">CLARITY_ESCROW_ADDRESS</code>, provider key):
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-slate-300">
{`cd mcp && npm run start -- submit_work ${jobId} "Your deliverable" --pk "$CLARITY_PROVIDER_PRIVATE_KEY"
npm run start -- read_deliverable ${jobId}
npm run start -- sync_job ${jobId}`}
        </pre>
        <p className="mt-2 text-slate-500">
          The <strong className="text-slate-400">Jobs</strong> list reads the contract directly;
          deliverable text is stored as plaintext on the relay.
        </p>
      </details>

      {wrongChain && connStatus === "connected" ? (
        <p className="text-sm text-amber-200/90">Switch to Base Sepolia to use job actions.</p>
      ) : null}

      {connStatus === "connected" && onchain && statusIdx === 1 && !isClient && !isProvider ? (
        <p className="text-sm text-slate-500">
          Connect the <strong className="text-slate-300">provider</strong> wallet to submit, or the{" "}
          <strong className="text-slate-300">client</strong> wallet after expiry to claim a refund.
        </p>
      ) : null}

      {connStatus === "connected" && onchain && statusIdx === 2 && !isClient && !isEvaluator ? (
        <p className="text-sm text-slate-500">
          Connect the <strong className="text-slate-300">evaluator</strong> wallet to approve payment
          or reject the work (refund to client). The client can read the submission below but cannot
          approve or reject on-chain.
        </p>
      ) : null}

      <section className={card}>
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">On-chain</h2>
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
              <dt className="text-slate-500">Expires (Unix)</dt>
              <dd className="font-mono text-xs text-slate-300">{expiresAtSec.toString()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Client</dt>
              <dd className="break-all font-mono text-xs text-slate-300">{clientAddr}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Provider</dt>
              <dd className="break-all font-mono text-xs text-slate-300">{providerAddr}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Evaluator</dt>
              <dd className="break-all font-mono text-xs text-slate-300">{evaluatorAddr}</dd>
            </div>
          </dl>
        )}
      </section>

      {statusIdx >= 2 ? (
        <section className={`${card} space-y-2`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Submitted work</h2>
          {deliverableLoadErr ? (
            <p className="text-sm text-amber-200/90">{deliverableLoadErr}</p>
          ) : null}
          {deliverableText != null ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-slate-950/80 p-3 text-sm text-slate-200">
              {deliverableText}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              No copy on the relay for this job id (relay may have restarted, or the provider did not
              POST after the on-chain tx). Try <strong>Sync relay from chain</strong> and ensure
              <code className="mx-1 font-mono text-xs">submit_work</code> reached the same relay URL.
            </p>
          )}
        </section>
      ) : null}

      {showActions && statusIdx === 1 && isProvider ? (
        <section className={`${card} space-y-3`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Provider · submit work
          </h2>
          <p className="text-xs text-slate-500">
            Same text is stored on the relay (plaintext) and referenced on-chain as{" "}
            <code className="font-mono text-slate-400">keccak256(utf8)</code> of the message.
          </p>
          <textarea
            className="min-h-[120px] w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            placeholder="Deliverable (markdown or plain text)…"
            value={submitText}
            onChange={(e) => setSubmitText(e.target.value)}
          />
          <button
            type="button"
            disabled={isWriting}
            onClick={() => void runSubmitWork()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {isWriting ? "Submitting…" : "Submit work"}
          </button>
        </section>
      ) : null}

      {showActions && statusIdx === 1 && isClient ? (
        <section className={`${card} space-y-3`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Client · refund if job expired
          </h2>
          {fundedExpired ? (
            <button
              type="button"
              disabled={isWriting}
              onClick={() => void runClaimRefund()}
              className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-2 text-sm text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
            >
              {isWriting ? "Claiming…" : "Claim refund (escrow was funded, deadline passed)"}
            </button>
          ) : (
            <p className="text-sm text-slate-400">
              Refund is available only after the on-chain expiry time if the provider never submitted.
              Current time: {nowSec.toString()} · Expires: {expiresAtSec.toString()}
            </p>
          )}
        </section>
      ) : null}

      {showActions && statusIdx === 2 && isEvaluator ? (
        <section className={`${card} space-y-3`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Evaluator · approve or reject
          </h2>
          <p className="text-xs text-slate-500">
            <strong className="text-slate-300">Approve</strong> releases USDC to the provider, evaluator
            cut, and platform. <strong className="text-slate-300">Reject</strong> returns the full budget
            to the client. Only the evaluator address can do either.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isWriting}
              onClick={() => void runComplete()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {isWriting ? "Confirming…" : "Approve and release payment"}
            </button>
            <button
              type="button"
              disabled={isWriting}
              onClick={() => void runReject()}
              className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-100 hover:bg-red-900/40 disabled:opacity-50"
            >
              {isWriting ? "Sending…" : "Reject and refund client"}
            </button>
          </div>
        </section>
      ) : null}

      {actionMsg ? (
        <p className="text-sm text-slate-300" role="status">
          {actionMsg}
        </p>
      ) : null}

      {!relayLoading && relay && (
        <section className={`${card} space-y-3`}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Relay</h2>
          <p className="text-sm text-slate-400">
            Off-chain status: <span className="text-slate-200">{relay.job.status}</span>
          </p>
          {relay.job.description ? (
            <div>
              <h3 className="text-xs font-medium text-slate-500">Description</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{relay.job.description}</p>
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

      {relayLoading && <p className="text-sm text-slate-500">Loading relay…</p>}

      {!relayLoading && relay && relay.timeline.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Timeline</h2>
          <ol className="mt-3 space-y-2 border-l border-white/15 pl-4">
            {relay.timeline.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</span>
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
