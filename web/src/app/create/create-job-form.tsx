"use client";

import { useState } from "react";
import Link from "next/link";
import { baseSepolia } from "wagmi/chains";
import {
  useConnection,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { isAddress, parseUnits } from "viem";
import { clarityEscrowAbi, usdcAbi } from "@/lib/abi";
import { getEscrowAddress, getUsdcAddress } from "@/lib/env";
import {
  chainStatusToRelayStatus,
  registerJobMetadata,
  postRelayEvent,
} from "@/lib/relay";

type Step = "form" | "budget" | "done";

/** Explicit gas avoids flaky `eth_estimateGas` on some Base Sepolia RPCs. */
const TX_GAS = 500_000n;

export function CreateJobForm() {
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

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const { data: onchainJob, refetch: refetchJob } = useReadContract({
    address: escrow ?? "0x0000000000000000000000000000000000000000",
    abi: clarityEscrowAbi,
    functionName: "jobs",
    args: jobId != null ? [jobId] : [0n],
    query: { enabled: jobId != null && !!escrow && jobId > 0n },
  });

  if (!escrow || !usdc) {
    return (
      <p className="text-sm text-amber-800">
        Add{" "}
        <code className="font-mono">NEXT_PUBLIC_ESCROW_ADDRESS</code> and{" "}
        <code className="font-mono">NEXT_PUBLIC_USDC_ADDRESS</code> to{" "}
        <code className="font-mono">web/.env.local</code>.
      </p>
    );
  }

  if (status !== "connected" || !address) {
    return (
      <p className="text-sm text-zinc-600">Connect your wallet to continue.</p>
    );
  }

  if (chainId !== baseSepolia.id) {
    return (
      <p className="text-sm text-zinc-600">Switch to Base Sepolia in the header.</p>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
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
          title: title.trim(),
          description: longDescription.trim(),
          tags: tagsCsv
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      });
      if (clientFromChain.toLowerCase() === address.toLowerCase()) {
        setMessage("Job created. Set budget, then fund.");
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
      setMessage("Job is not Open anymore (budget may already be set or state changed).");
      return;
    }
    if (BigInt(Math.floor(Date.now() / 1000)) > expiresAt) {
      setMessage("This job’s expiry has passed; setBudget will revert. Create a new job.");
      return;
    }
    const amount = parseUnits(budget, 6);
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
  };

  const runFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jobId == null || !address) return;
    setMessage(null);
    const amount = parseUnits(budget, 6);
    if (onchainJob && Array.isArray(onchainJob) && (onchainJob[3] as bigint) === 0n) {
      setMessage("Set budget on-chain first.");
      return;
    }
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
  };

  return (
    <div className="max-w-md space-y-6">
      {step === "form" && (
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs text-zinc-500">Provider</label>
            <input
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="0x…"
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Evaluator</label>
            <input
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm"
              value={evaluator}
              onChange={(e) => setEvaluator(e.target.value)}
              placeholder="0x…"
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Expires in (hours)</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Title</label>
            <input
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Description</label>
            <textarea
              className="mt-1 min-h-[120px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              placeholder="Scope, acceptance criteria, links…"
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Tags (optional, comma-separated)</label>
            <input
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              value={tagsCsv}
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="solidity, design"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Metadata is canonicalized and hashed; that <span className="font-mono">bytes32</span> is
            written on-chain and stored on the relay.
          </p>
          <p className="text-xs text-zinc-600">
            <span className="text-zinc-500">You will create this job as</span>{" "}
            <span className="font-mono break-all">{address}</span>
          </p>
          <button
            type="submit"
            disabled={isWriting}
            className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {isWriting ? "Submitting…" : "1. Create on-chain job"}
          </button>
        </form>
      )}

      {step === "budget" && jobId != null && (
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 space-y-2">
            <p>
              Job id: <span className="font-mono">{jobId.toString()}</span>
            </p>
            {address ? (
              <p>
                <span className="text-zinc-500">Connected in this app: </span>
                <span className="font-mono text-xs break-all">{address}</span>
              </p>
            ) : null}
            {onchainJob && Array.isArray(onchainJob) && (
              <p>
                <span className="text-zinc-500">On-chain client (must match to budget/fund): </span>
                <span className="font-mono text-xs break-all">
                  {String((onchainJob as readonly unknown[])[0])}
                </span>
                {address &&
                  String((onchainJob as readonly unknown[])[0]).toLowerCase() !==
                    address.toLowerCase() && (
                    <span className="block text-amber-800 text-xs mt-2 leading-relaxed">
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
              <label className="text-xs text-zinc-500">Budget (mUSDC)</label>
              <input
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={isWriting}
              className="w-full rounded-md border border-zinc-200 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              2. Set budget
            </button>
          </form>
          <form onSubmit={runFund} className="space-y-2">
            <button
              type="submit"
              disabled={isWriting}
              className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              3. Approve + fund
            </button>
          </form>
        </div>
      )}

      {step === "done" && jobId != null && (
        <p className="text-sm text-zinc-600">
          {message}{" "}
          <Link
            className="text-blue-600 hover:underline"
            href={`/jobs/${jobId.toString()}`}
          >
            Open job
          </Link>
        </p>
      )}

      {message && step !== "done" && (
        <p className="text-sm text-zinc-600">{message}</p>
      )}
    </div>
  );
}
