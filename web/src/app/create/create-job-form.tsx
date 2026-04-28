"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { baseSepolia } from "wagmi/chains";
import {
  useConnection,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { formatUnits, isAddress, parseUnits } from "viem";
import { clarityEscrowAbi, usdcAbi } from "@/lib/abi";
import { getEscrowAddress, getUsdcAddress } from "@/lib/env";
import {
  chainStatusToRelayStatus,
  registerJobMetadata,
  postRelayEvent,
} from "@/lib/relay";
import {
  fetchListingDetail,
  getStoredListingOwnerToken,
  linkListingToEscrow,
  type MarketListing,
} from "@/lib/listings";
import { onChainStatusLabel } from "@/lib/status";
import { LoadingBlock, Spinner } from "@/components/spinner";

type Step = "form" | "budget" | "done";
type TxOp = "none" | "create" | "budget" | "fund";

/** Explicit gas avoids flaky `eth_estimateGas` on some Base Sepolia RPCs. */
const TX_GAS = 500_000n;

function isBytes32Hex(v: string): v is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function CreateJobForm() {
  const searchParams = useSearchParams();
  const listingIdParam = searchParams.get("listingId");
  const escrow = getEscrowAddress();
  const usdc = getUsdcAddress();
  const { address, status, chainId } = useConnection();
  const publicClient = usePublicClient();

  const [provider, setProvider] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [hours, setHours] = useState("24");
  const [title, setTitle] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [budget, setBudget] = useState("5");
  const [step, setStep] = useState<Step>("form");
  const [jobId, setJobId] = useState<bigint | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [listingLinkError, setListingLinkError] = useState<string | null>(null);
  const [listingLinkBusy, setListingLinkBusy] = useState(false);
  /** When set, `createJob` uses this listing’s `contentHash` (same bytes32 as the marketplace row). */
  const [listingSource, setListingSource] = useState<MarketListing | null>(null);
  const [listingLoadErr, setListingLoadErr] = useState<string | null>(null);
  const [txOp, setTxOp] = useState<TxOp>("none");

  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const txBusy = txOp !== "none" || isWriting;

  useEffect(() => {
    const p = searchParams.get("provider");
    const e = searchParams.get("evaluator");
    if (p && isAddress(p)) setProvider(p);
    if (e && isAddress(e)) setEvaluator(e);
    const lid = searchParams.get("listingId");
    if (!lid || Number.isNaN(Number(lid))) {
      setListingSource(null);
      setListingLoadErr(null);
      return;
    }
    setListingLoadErr(null);
    void fetchListingDetail(Number(lid))
      .then(({ listing }) => {
        setListingSource(listing);
        setTitle(listing.title);
        setLongDescription(listing.description);
        setTagsCsv(listing.tags.join(", "));
        const hint = listing.budgetHintUsdc?.trim();
        if (hint) setBudget(hint);
      })
      .catch(() => {
        setListingSource(null);
        setListingLoadErr("Could not load listing — check NEXT_PUBLIC_RELAY_URL.");
      });
  }, [searchParams]);

  const { data: onchainJob, refetch: refetchJob } = useReadContract({
    address: escrow ?? "0x0000000000000000000000000000000000000000",
    abi: clarityEscrowAbi,
    functionName: "jobs",
    args: [jobId ?? 0n],
    query: {
      enabled: jobId != null && !!escrow && jobId > 0n,
      refetchInterval: step === "budget" && jobId != null ? 8_000 : false,
    },
  });

  useEffect(() => {
    if (step === "budget" && jobId != null) {
      void refetchJob();
    }
  }, [step, jobId, refetchJob]);

  if (!escrow || !usdc) {
    return (
      <p className="text-sm text-amber-200/90">
        Add{" "}
        <code className="font-mono text-teal-200/80">NEXT_PUBLIC_ESCROW_ADDRESS</code> and{" "}
        <code className="font-mono text-teal-200/80">NEXT_PUBLIC_USDC_ADDRESS</code> to{" "}
        <code className="font-mono text-teal-200/80">web/.env.local</code>.
      </p>
    );
  }

  if (status !== "connected" || !address) {
    return (
      <p className="text-sm text-slate-400">Connect your wallet to continue.</p>
    );
  }

  if (chainId !== baseSepolia.id) {
    return (
      <p className="text-sm text-slate-400">Switch to Base Sepolia in the header.</p>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setListingLinkError(null);
    const lid =
      listingIdParam && !Number.isNaN(Number(listingIdParam)) ? Number(listingIdParam) : null;
    if (lid != null && !listingSource) {
      setMessage(
        listingLoadErr ?? "Listing is still loading or failed to load — cannot match metadata hash.",
      );
      return;
    }
    if (listingSource && lid != null && listingSource.id !== lid) {
      setMessage("Listing mismatch — refresh the page.");
      return;
    }
    if (!isAddress(provider) || !isAddress(evaluator)) {
      setMessage("Invalid provider or evaluator address.");
      return;
    }
    if (!publicClient) {
      setMessage("No public client.");
      return;
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiresAt = now + BigInt(Number(hours) * 3600);
    if (expiresAt <= now) {
      setMessage("Expiry must be in the future.");
      return;
    }
    if (!title.trim() || !longDescription.trim()) {
      setMessage("Add a title and description (stored via relay; bytes32 = keccak256 of canonical JSON).");
      return;
    }
    let desc: `0x${string}`;
    if (listingSource && lid != null) {
      if (!isBytes32Hex(listingSource.contentHash)) {
        setMessage("This listing’s contentHash from the relay is not a valid bytes32.");
        return;
      }
      desc = listingSource.contentHash;
    } else {
      try {
        const registered = await registerJobMetadata({
          title: title.trim(),
          description: longDescription.trim(),
          tags: tagsCsv
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        });
        desc = registered.contentHash;
      } catch (e) {
        setMessage(
          e instanceof Error
            ? e.message
            : "Could not pin metadata — is the relay running and NEXT_PUBLIC_RELAY_URL set?",
        );
        return;
      }
    }
    setTxOp("create");
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "createJob",
        args: [provider, evaluator, expiresAt, desc],
        gas: TX_GAS,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const count = await publicClient.readContract({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobCount",
      });
      const createdRow = await publicClient.readContract({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobs",
        args: [count],
      });
      const clientFromChain = String((createdRow as readonly unknown[])[0]);
      if (clientFromChain.toLowerCase() !== address.toLowerCase()) {
        setMessage(
          `On-chain client is ${clientFromChain} but the app showed ${address} as connected. ` +
            `Use the wallet that actually signed (often whichever owns window.ethereum on this site), or create a new job after fixing extensions. Budget/fund must be sent from ${clientFromChain}.`,
        );
      }
      setJobId(count);
      setStep("budget");
      try {
        await postRelayEvent({
          jobId: Number(count),
          eventType: "job:created",
          status: "open",
          txHash: hash,
          job: {
            chainId: baseSepolia.id,
            escrow,
            client: clientFromChain,
            provider,
            evaluator,
            descriptionCid: desc,
            title: (listingSource?.title ?? title).trim(),
            description: (listingSource?.description ?? longDescription).trim(),
            tags:
              listingSource?.tags ??
              tagsCsv
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
          },
        });
        if (clientFromChain.toLowerCase() === address.toLowerCase()) {
          setMessage("Job created. Set budget, then fund.");
        }
        if (
          listingIdParam &&
          !Number.isNaN(Number(listingIdParam)) &&
          clientFromChain.toLowerCase() === address.toLowerCase()
        ) {
          const lid = Number(listingIdParam);
          const ownerToken = getStoredListingOwnerToken(lid);
          if (ownerToken) {
            try {
              await linkListingToEscrow({
                listingId: lid,
                client: clientFromChain,
                escrowJobId: Number(count),
                ownerToken,
              });
              setListingLinkError(null);
            } catch (linkErr) {
              setListingLinkError(
                linkErr instanceof Error
                  ? linkErr.message
                  : "Could not link listing to this job id.",
              );
            }
          } else {
            setListingLinkError(
              "No listing owner key in this browser — the job is on-chain but the listing was not linked. Create the listing from this site or run MCP link_listing with --token.",
            );
          }
        }
      } catch (relayErr) {
        const relayFail =
          `Job #${count} is on-chain, but the relay was not updated (${relayErr instanceof Error ? relayErr.message : "error"}). ` +
          `Open /jobs only lists relay jobs — check NEXT_PUBLIC_RELAY_URL and that the relay is running.`;
        if (clientFromChain.toLowerCase() !== address.toLowerCase()) {
          setMessage(
            `On-chain client is ${clientFromChain} but the app showed ${address} as connected. Budget/fund must use ${clientFromChain}. ${relayFail}`,
          );
        } else {
          setMessage(relayFail);
        }
      }
    } finally {
      setTxOp("none");
    }
  };

  const runBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jobId == null || !address || !publicClient) return;
    setMessage(null);
    const row = await publicClient.readContract({
      address: escrow,
      abi: clarityEscrowAbi,
      functionName: "jobs",
      args: [jobId],
    });
    const clientOnChain = (row as readonly unknown[])[0] as `0x${string}`;
    const status = Number((row as readonly unknown[])[7]);
    const expiresAt = BigInt((row as readonly unknown[])[4] as bigint);
    if (clientOnChain.toLowerCase() !== address.toLowerCase()) {
      setMessage(
        `Wrong wallet: this job’s client is ${clientOnChain}. Connect that account to set budget.`,
      );
      return;
    }
    if (status !== 0) {
      const label = onChainStatusLabel(status);
      setMessage(
        `On-chain status is “${label}” (${status}), not open — set budget only works in the “open” state. ` +
          (status === 1
            ? "This job is already funded. Use the link below to open it (or finish approve + fund from there if your wallet is mid-flow)."
            : "Open the job page to see next steps, or start a new job from the listing if this one is done."),
      );
      return;
    }
    if (BigInt(Math.floor(Date.now() / 1000)) > expiresAt) {
      setMessage("This job’s expiry has passed; setBudget will revert. Create a new job.");
      return;
    }
    const amount = parseUnits(budget, 6);
    setTxOp("budget");
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "setBudget",
        args: [jobId, amount],
        gas: TX_GAS,
        account: address,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await refetchJob();
      const rowAfter = await publicClient.readContract({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobs",
        args: [jobId],
      });
      const r = rowAfter as readonly unknown[];
      try {
        await postRelayEvent({
          jobId: Number(jobId),
          eventType: "job:budget_set",
          status: chainStatusToRelayStatus(Number(r[7])),
          txHash: hash,
          job: {
            chainId: baseSepolia.id,
            escrow,
            client: String(r[0]),
            provider: String(r[1]),
            evaluator: String(r[2]),
            descriptionCid: String(r[5]),
          },
        });
      } catch {
        /* relay optional for on-chain success */
      }
    } finally {
      setTxOp("none");
    }
  };

  const runFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jobId == null || !address || !publicClient) return;
    setMessage(null);
    const row = await publicClient.readContract({
      address: escrow,
      abi: clarityEscrowAbi,
      functionName: "jobs",
      args: [jobId],
    });
    const r = row as readonly unknown[];
    const budgetOnChain = r[3] as bigint;
    const fundStatus = Number(r[7]);
    if (fundStatus === 1) {
      setMessage(
        `Job #${jobId.toString()} is already funded on-chain. Continue on the job page.`,
      );
      return;
    }
    if (fundStatus !== 0) {
      setMessage(
        `Can’t fund while status is “${onChainStatusLabel(fundStatus)}”. Open /jobs/${jobId.toString()} for details.`,
      );
      return;
    }
    if (budgetOnChain === 0n) {
      setMessage("Set budget on-chain first (step 2).");
      return;
    }
    const amount = parseUnits(budget, 6);
    if (amount !== budgetOnChain) {
      setMessage(
        `Wallet form shows ${formatUnits(amount, 6)} mUSDC but on-chain budget is ${formatUnits(budgetOnChain, 6)} mUSDC — match the budget field to what you set in step 2.`,
      );
      return;
    }
    setTxOp("fund");
    try {
      const h1 = await writeContractAsync({
        address: usdc,
        abi: usdcAbi,
        functionName: "approve",
        args: [escrow, amount],
        gas: TX_GAS,
        account: address,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: h1 });
      }
      const h2 = await writeContractAsync({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "fund",
        args: [jobId, amount],
        gas: TX_GAS,
        account: address,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: h2 });
        const rowAfter = await publicClient.readContract({
          address: escrow,
          abi: clarityEscrowAbi,
          functionName: "jobs",
          args: [jobId],
        });
        const r = rowAfter as readonly unknown[];
        try {
          await postRelayEvent({
            jobId: Number(jobId),
            eventType: "job:funded",
            status: chainStatusToRelayStatus(Number(r[7])),
            txHash: h2,
            job: {
              chainId: baseSepolia.id,
              escrow,
              client: String(r[0]),
              provider: String(r[1]),
              evaluator: String(r[2]),
              descriptionCid: String(r[5]),
            },
          });
        } catch {
          /* relay optional */
        }
      }
      setStep("done");
      setMessage("Funded.");
    } finally {
      setTxOp("none");
    }
  };

  const retryListingLink = async () => {
    if (!listingIdParam || jobId == null || !publicClient || !escrow) return;
    const lid = Number(listingIdParam);
    const ownerToken = getStoredListingOwnerToken(lid);
    if (!ownerToken) {
      setListingLinkError("Missing owner token in this browser.");
      return;
    }
    setListingLinkBusy(true);
    try {
      const row = await publicClient.readContract({
        address: escrow,
        abi: clarityEscrowAbi,
        functionName: "jobs",
        args: [jobId],
      });
      const clientFromChain = String((row as readonly unknown[])[0]);
      await linkListingToEscrow({
        listingId: lid,
        client: clientFromChain,
        escrowJobId: Number(jobId),
        ownerToken,
      });
      setListingLinkError(null);
      setMessage((prev) => (prev ? `${prev} Listing linked to #${lid}.` : `Listing #${lid} linked.`));
    } catch (e) {
      setListingLinkError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setListingLinkBusy(false);
    }
  };

  const chainStatusIdx =
    onchainJob && Array.isArray(onchainJob) && jobId != null ? Number((onchainJob as readonly unknown[])[7]) : -1;
  const chainBudgetWei =
    onchainJob && Array.isArray(onchainJob) && jobId != null ? ((onchainJob as readonly unknown[])[3] as bigint) : 0n;
  const canSetBudget = chainStatusIdx === 0;
  const canFund = chainStatusIdx === 0 && chainBudgetWei > 0n;
  const listingFromUrl = Boolean(listingIdParam && !Number.isNaN(Number(listingIdParam)));
  const listingStillLoading = listingFromUrl && !listingSource && !listingLoadErr;

  return (
    <div className="cl-card-strong mx-auto max-w-md space-y-6 rounded-xl p-6">
      {listingSource ? (
        <p className="rounded-md border border-teal-500/25 bg-teal-950/35 px-3 py-2 text-xs leading-relaxed text-teal-100">
          Listing <span className="font-mono">#{listingSource.id}</span>: title, description, and tags are
          loaded from the relay and the on-chain <span className="font-mono">bytes32</span> is this
          listing&apos;s <span className="font-mono">contentHash</span> (no manual copy-paste).
        </p>
      ) : null}
      {listingLoadErr ? (
        <p className="rounded-md border border-amber-500/25 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
          {listingLoadErr} You can still create a job without a listing hash by removing{" "}
          <span className="font-mono">listingId</span> from the URL.
        </p>
      ) : null}
      {listingStillLoading ? <LoadingBlock label="Loading listing…" className="py-1" /> : null}
      {step === "form" && (
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs text-slate-500">Provider</label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="0x…"
              required
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Evaluator</label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600"
              value={evaluator}
              onChange={(e) => setEvaluator(e.target.value)}
              placeholder="0x…"
              required
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Expires in (hours)</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">
              Title{listingSource ? " (from listing)" : ""}
            </label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 read-only:cursor-not-allowed read-only:opacity-90"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
              required
              readOnly={!!listingSource}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">
              Description{listingSource ? " (from listing)" : ""}
            </label>
            <textarea
              className="mt-1 min-h-[120px] w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 read-only:cursor-not-allowed read-only:opacity-90"
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              placeholder="Scope, acceptance criteria, links…"
              required
              readOnly={!!listingSource}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">
              Tags (optional, comma-separated){listingSource ? " (from listing)" : ""}
            </label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 read-only:cursor-not-allowed read-only:opacity-90"
              value={tagsCsv}
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="solidity, design"
              readOnly={!!listingSource}
            />
          </div>
          <p className="text-xs text-slate-500">
            Metadata is canonicalized and hashed; that <span className="font-mono">bytes32</span> is
            written on-chain and stored on the relay.
          </p>
          <p className="text-xs text-slate-400">
            <span className="text-slate-500">You will create this job as</span>{" "}
            <span className="font-mono break-all text-slate-300">{address}</span>
          </p>
          <button
            type="submit"
            disabled={txBusy || listingStillLoading}
            className="flex min-h-[40px] w-full items-center justify-center rounded-md bg-teal-500 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
          >
            {txOp === "create" ? <Spinner className="h-5 w-5" /> : "1. Create job"}
          </button>
        </form>
      )}

      {step === "budget" && jobId != null && (
        <div className="space-y-4">
          <div className="space-y-2 text-sm text-slate-300">
            {chainStatusIdx >= 0 ? (
              <p className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-xs leading-relaxed text-slate-300">
                <span className="text-slate-500">Live on-chain</span> · status{" "}
                <span className="font-mono text-teal-200/90">{onChainStatusLabel(chainStatusIdx)}</span>
                {chainBudgetWei > 0n ? (
                  <>
                    {" "}
                    · budget <span className="font-mono">{formatUnits(chainBudgetWei, 6)}</span> mUSDC
                  </>
                ) : null}
              </p>
            ) : null}
            {chainStatusIdx === 1 ? (
              <p className="text-xs leading-relaxed text-amber-200/90">
                This job is already <strong className="text-amber-100">funded</strong>. Step 2 only
                applies before funding. Continue on the job page.
              </p>
            ) : null}
            <p>
              Job id: <span className="font-mono">{jobId.toString()}</span>
            </p>
            {address ? (
              <p>
                <span className="text-slate-500">Connected in this app: </span>
                <span className="font-mono text-xs break-all">{address}</span>
              </p>
            ) : null}
            {onchainJob && Array.isArray(onchainJob) && (
              <p>
                <span className="text-slate-500">On-chain client (must match to budget/fund): </span>
                <span className="font-mono text-xs break-all">
                  {String((onchainJob as readonly unknown[])[0])}
                </span>
                {address &&
                  String((onchainJob as readonly unknown[])[0]).toLowerCase() !==
                    address.toLowerCase() && (
                    <span className="mt-2 block text-xs leading-relaxed text-amber-200">
                      Switch Rabby (or your wallet) to this exact address, or create a new job while
                      connected as the client you intend. This job is already owned on-chain by the
                      address above.
                    </span>
                  )}
              </p>
            )}
          </div>
          <form onSubmit={runBudget} className="space-y-3">
            <div>
              <label className="text-xs text-slate-500">Budget (mUSDC)</label>
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={txBusy || !canSetBudget}
              className="flex min-h-[40px] w-full items-center justify-center rounded-md border border-white/15 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              {txOp === "budget" ? <Spinner className="h-5 w-5" /> : "2. Set budget"}
            </button>
          </form>
          <form onSubmit={runFund} className="space-y-2">
            <button
              type="submit"
              disabled={txBusy || !canFund}
              className="flex min-h-[40px] w-full items-center justify-center rounded-md bg-teal-500 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
            >
              {txOp === "fund" ? <Spinner className="h-5 w-5" /> : "3. Approve + fund"}
            </button>
          </form>
          {chainStatusIdx === 1 ? (
            <Link
              href={`/jobs/${jobId.toString()}`}
              className="inline-block text-sm font-medium text-teal-400 hover:text-teal-300 hover:underline"
            >
              Open job #{jobId.toString()}
            </Link>
          ) : null}
        </div>
      )}

      {step === "done" && jobId != null && (
        <p className="text-sm text-slate-300">
          {message}{" "}
          <Link
            className="font-medium text-teal-400 hover:text-teal-300 hover:underline"
            href={`/jobs/${jobId.toString()}`}
          >
            Open job
          </Link>
        </p>
      )}

      {message && step !== "done" && (
        <p className="text-sm text-slate-300">{message}</p>
      )}

      {listingLinkError ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-950/40 p-3 text-xs text-amber-100">
          <p className="font-semibold text-amber-200">Listing ↔ paid job</p>
          <p className="mt-1 leading-relaxed">{listingLinkError}</p>
          {listingIdParam && jobId != null ? (
            <button
              type="button"
              disabled={listingLinkBusy}
              onClick={() => void retryListingLink()}
              className="mt-2 inline-flex min-h-[32px] min-w-[140px] items-center justify-center rounded-md border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
            >
              {listingLinkBusy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                `Retry link to listing #${listingIdParam}`
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
