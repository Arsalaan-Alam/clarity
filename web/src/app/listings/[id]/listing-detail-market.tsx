"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { baseSepolia } from "wagmi/chains";
import { useConnection, useSwitchChain } from "wagmi";
import { isAddress } from "viem";
import {
  acceptListingBid,
  cancelListing,
  fetchListingDetail,
  getStoredListingOwnerToken,
  postListingBid,
  type MarketBid,
  type MarketListing,
} from "@/lib/listings";
import { ConnectButton } from "@/components/connect-button";

const card = "cl-card-strong rounded-xl p-4";

export function ListingDetailMarket({ id }: { id: number }) {
  const { address, status, chainId } = useConnection();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [data, setData] = useState<{ listing: MarketListing; bids: MarketBid[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [bidMsg, setBidMsg] = useState("");
  const [evalAddr, setEvalAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchListingDetail(id);
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (err || !data) return <p className="text-sm text-red-400">{err ?? "Not found"}</p>;

  const { listing, bids } = data;
  const isClient =
    address && listing.client.toLowerCase() === address.toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = listing.status === "open" && nowSec > listing.listingExpiresAt;
  const canBid =
    status === "connected" &&
    chainId === baseSepolia.id &&
    address &&
    !isClient &&
    listing.status === "open" &&
    !expired;

  const createUrl =
    listing.status === "assigned" && listing.provider && listing.evaluator
      ? `/create?listingId=${listing.id}&provider=${encodeURIComponent(listing.provider)}&evaluator=${encodeURIComponent(listing.evaluator)}`
      : null;

  const submitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !bidMsg.trim()) return;
    setBusy(true);
    setLocalMsg(null);
    try {
      await postListingBid(listing.id, { agentAddress: address, message: bidMsg.trim() });
      setBidMsg("");
      await load();
    } catch (x) {
      setLocalMsg(x instanceof Error ? x.message : "Bid failed");
    } finally {
      setBusy(false);
    }
  };

  const ownerToken = getStoredListingOwnerToken(listing.id);

  const submitAccept = async (e: React.FormEvent, bidId: number) => {
    e.preventDefault();
    if (!address || !isAddress(evalAddr)) {
      setLocalMsg("Set a valid evaluator address.");
      return;
    }
    if (!ownerToken) {
      setLocalMsg(
        "This browser does not have the listing key. Create the listing from New listing here, then accept on this same device/browser.",
      );
      return;
    }
    setBusy(true);
    setLocalMsg(null);
    try {
      await acceptListingBid({
        listingId: listing.id,
        client: address,
        bidId,
        evaluator: evalAddr,
        ownerToken,
      });
      setEvalAddr("");
      await load();
    } catch (x) {
      setLocalMsg(x instanceof Error ? x.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  };

  const runCancel = async () => {
    if (!address) return;
    if (!ownerToken) {
      setLocalMsg(
        "Missing listing owner token — only the browser session that created the listing can cancel (or use MCP with --token).",
      );
      return;
    }
    setBusy(true);
    setLocalMsg(null);
    try {
      await cancelListing(listing.id, address, ownerToken);
      await load();
    } catch (x) {
      setLocalMsg(x instanceof Error ? x.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <Link href="/listings" className="text-xs text-slate-500 hover:text-teal-300">
        ← Listings
      </Link>
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-white">{listing.title}</h1>
        <p className="text-sm text-slate-400">
          Listing #{listing.id} ·{" "}
          <span className="font-mono text-xs">{listing.status}</span>
          {listing.budgetHintUsdc ? (
            <>
              {" "}
              · ~{listing.budgetHintUsdc} mUSDC (hint)
            </>
          ) : null}
        </p>
      </header>

      {expired && listing.status === "open" ? (
        <p className="text-sm text-amber-200/90">This listing&apos;s bid window has expired.</p>
      ) : null}

      {listing.status === "open" && isClient ? (
        <section className="rounded-xl border border-indigo-500/25 bg-indigo-950/35 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">
            Client · accept a bid (web only)
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
            <li>Stay on this page and connect the same wallet that created this listing (shown below as Client).</li>
            <li>
              Scroll to <strong className="text-white">Bids</strong>. Under the agent you want, paste your
              evaluator&apos;s wallet (who will approve delivery)—not the agent&apos;s address.
            </li>
            <li>
              Click <strong className="text-white">Accept this bid</strong>. Then use{" "}
              <strong className="text-white">Create paid job</strong> when it appears to fund escrow in
              the app.
            </li>
          </ol>
          {!ownerToken ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-200/90">
              This browser doesn&apos;t have the listing key (usually you didn&apos;t create the listing
              here). Create the listing from{" "}
              <Link href="/listings/new" className="text-teal-300 underline">
                New listing
              </Link>{" "}
              in this browser, or you can&apos;t accept from the web.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={card}>
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Description</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{listing.description}</p>
        {listing.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {listing.tags.map((t) => (
              <span
                key={t}
                className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-300"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-slate-500">
          Client <span className="font-mono text-slate-400">{listing.client}</span>
        </p>
      </section>

      {listing.status === "assigned" && createUrl ? (
        <section className="rounded-xl border border-teal-500/25 bg-teal-950/30 p-4">
          <p className="text-sm text-slate-200">
            Provider and evaluator are set. Create the on-chain escrow job next (metadata must
            match this listing).
          </p>
          <Link
            href={createUrl}
            className="mt-3 inline-block rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400"
          >
            Create escrow job
          </Link>
        </section>
      ) : null}

      {listing.status === "open" && isClient ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runCancel()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel listing
          </button>
          {!ownerToken ? (
            <p className="text-xs text-amber-200/90">
              Listing key missing—cancel/accept from the web only work if you created this listing in this
              browser from{" "}
              <Link href="/listings/new" className="text-teal-300 underline">
                New listing
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      <section className={card}>
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Bids</h2>
        {bids.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No bids yet.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {bids.map((b) => (
              <li key={b.id} className="border-b border-white/10 pb-3 last:border-0">
                <p className="font-mono text-xs text-slate-400">{b.agentAddress}</p>
                <p className="mt-1 text-sm text-slate-200">{b.message}</p>
                <p className="mt-1 text-xs text-slate-500">{b.status}</p>
                {listing.status === "open" && isClient && b.status === "pending" ? (
                  <form
                    onSubmit={(e) => void submitAccept(e, b.id)}
                    className="mt-2 max-w-md space-y-2"
                  >
                    {!ownerToken ? (
                      <p className="text-xs text-amber-200/90">
                        Accept requires the listing owner token from the session that created this listing (or MCP with{" "}
                        <code className="font-mono">--token</code>).
                      </p>
                    ) : null}
                    <input
                      className="w-full rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600"
                      placeholder="Evaluator 0x…"
                      value={evalAddr}
                      onChange={(e) => setEvalAddr(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={busy || !ownerToken}
                      className="rounded-md bg-teal-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
                    >
                      Accept this bid
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {listing.status === "open" && !expired ? (
        <section className={card}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Place a bid</h2>
          {canBid ? (
            <form onSubmit={(e) => void submitBid(e)} className="mt-3 max-w-md space-y-2">
              <textarea
                className="w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                rows={4}
                placeholder="Why you’re a fit, timeline, links…"
                value={bidMsg}
                onChange={(e) => setBidMsg(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
              >
                Submit bid as {address?.slice(0, 6)}…
              </button>
            </form>
          ) : status !== "connected" ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-400">Connect a wallet on Base Sepolia to place a bid.</p>
              <ConnectButton />
            </div>
          ) : chainId !== baseSepolia.id ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-400">
                Switch to Base Sepolia (chain {baseSepolia.id}) to bid. This app is {chainId ?? "unknown"}.
              </p>
              <button
                type="button"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: baseSepolia.id })}
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
              >
                {isSwitching ? "Switching…" : "Switch to Base Sepolia"}
              </button>
            </div>
          ) : isClient ? (
            <p className="mt-3 text-sm text-slate-500">
              You are the client on this listing — use another wallet to bid as an agent.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">You can&apos;t bid on this listing right now.</p>
          )}
        </section>
      ) : null}

      {localMsg ? <p className="text-sm text-red-400">{localMsg}</p> : null}
    </div>
  );
}
