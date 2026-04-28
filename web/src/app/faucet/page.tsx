"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { baseSepolia } from "wagmi/chains";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, isAddress, parseUnits } from "viem";
import { usdcAbi } from "@/lib/abi";
import { getUsdcAddress } from "@/lib/env";
import { ConnectButton } from "@/components/connect-button";
import { Spinner } from "@/components/spinner";

const DEFAULT_AMOUNT = "10000";

export default function FaucetPage() {
  const usdc = getUsdcAddress();
  const { address, status, chainId } = useConnection();
  const [recipient, setRecipient] = useState("");
  const [amountHuman, setAmountHuman] = useState(DEFAULT_AMOUNT);
  const [message, setMessage] = useState<string | null>(null);
  const publicClient = usePublicClient({ chainId: baseSepolia.id });
  const { writeContractAsync, isPending } = useWriteContract();

  useEffect(() => {
    if (address) setRecipient((r) => (r.trim() === "" ? address : r));
  }, [address]);

  const recipientAddr =
    recipient.trim() && isAddress(recipient.trim()) ? (recipient.trim() as `0x${string}`) : null;

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: usdc ?? undefined,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: recipientAddr ? [recipientAddr] : undefined,
    query: { enabled: !!usdc && !!recipientAddr },
  });

  const onMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!usdc) {
      setMessage("Set NEXT_PUBLIC_USDC_ADDRESS in web/.env.local.");
      return;
    }
    if (status !== "connected" || !address) {
      setMessage("Connect a wallet to send the mint transaction (you pay gas).");
      return;
    }
    if (chainId !== baseSepolia.id) {
      setMessage("Switch to Base Sepolia.");
      return;
    }
    if (!recipientAddr) {
      setMessage("Enter a valid recipient address (0x…).");
      return;
    }
    let amount: bigint;
    try {
      amount = parseUnits(amountHuman.trim() || "0", 6);
    } catch {
      setMessage("Invalid amount.");
      return;
    }
    if (amount <= 0n) {
      setMessage("Amount must be greater than zero.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: usdc,
        abi: usdcAbi,
        functionName: "mint",
        args: [recipientAddr, amount],
        chainId: baseSepolia.id,
        account: address,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setMessage(`Minted. Tx: ${hash.slice(0, 10)}…`);
      await refetchBalance();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mint failed.");
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-8">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="text-teal-400/90 hover:text-teal-300">
          ← Home
        </Link>
      </nav>

      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-teal-400/80">Base Sepolia</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">mUSDC faucet</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Clarity&apos;s <span className="text-slate-300">MockUSDC</span> exposes <code className="rounded bg-white/5 px-1 font-mono text-xs">mint</code>{" "}
          to any caller. Your wallet sends the transaction and pays gas; tokens go to the address you
          specify (yourself, a friend, or a test agent).
        </p>
      </div>

      {!usdc ? (
        <p className="text-sm text-amber-200/90">
          Set <code className="font-mono text-teal-200/80">NEXT_PUBLIC_USDC_ADDRESS</code> in{" "}
          <code className="font-mono text-teal-200/80">web/.env.local</code>.
        </p>
      ) : (
        <form onSubmit={onMint} className="cl-card-strong space-y-4 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <span className="text-xs text-slate-500">Connected</span>
            <ConnectButton />
          </div>

          <div>
            <label className="text-xs text-slate-500">Recipient</label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500">Amount (mUSDC, 6 decimals)</label>
            <input
              className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              value={amountHuman}
              onChange={(e) => setAmountHuman(e.target.value)}
              inputMode="decimal"
            />
          </div>

          {recipientAddr && balance != null ? (
            <p className="text-xs text-slate-500">
              Current balance:{" "}
              <span className="font-mono text-slate-300">
                {formatUnits(balance, 6)} mUSDC
              </span>
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending || status !== "connected"}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-teal-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
          >
            {isPending ? <Spinner className="h-5 w-5" /> : "Mint mUSDC"}
          </button>

          {message ? (
            <p className="text-sm text-slate-300">{message}</p>
          ) : null}

          <p className="text-xs text-slate-500">
            Contract:{" "}
            <a
              href={`https://sepolia.basescan.org/address/${usdc}`}
              target="_blank"
              rel="noreferrer"
              className="break-all text-teal-400/90 hover:text-teal-300"
            >
              {usdc}
            </a>
          </p>
        </form>
      )}

      <p className="text-xs leading-relaxed text-slate-600">
        Testnet only. If your deployed MockUSDC removed public <code className="font-mono">mint</code>, this
        page will revert — redeploy the repo contract or adjust the ABI.
      </p>
    </div>
  );
}
