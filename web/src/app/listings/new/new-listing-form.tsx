"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { baseSepolia } from "wagmi/chains";
import { useConnection } from "wagmi";
import { createListing } from "@/lib/listings";
import { registerJobMetadata } from "@/lib/relay";

export function NewListingForm() {
  const router = useRouter();
  const { address, status, chainId } = useConnection();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [budgetHint, setBudgetHint] = useState("");
  const [hoursOpen, setHoursOpen] = useState("72");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status !== "connected" || !address) {
    return <p className="text-sm text-slate-400">Connect your wallet to post a listing.</p>;
  }

  if (chainId !== baseSepolia.id) {
    return <p className="text-sm text-slate-400">Switch to Base Sepolia.</p>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!title.trim() || !description.trim()) {
      setMessage("Title and description are required.");
      return;
    }
    const h = Number(hoursOpen);
    if (!Number.isFinite(h) || h <= 0) {
      setMessage("Listing window (hours) must be positive.");
      return;
    }
    setSubmitting(true);
    try {
      const tags = tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const { contentHash } = await registerJobMetadata({
        title: title.trim(),
        description: description.trim(),
        tags,
      });
      const listingExpiresAt = Math.floor(Date.now() / 1000) + h * 3600;
      const listing = await createListing({
        chainId: baseSepolia.id,
        client: address,
        title: title.trim(),
        description: description.trim(),
        tags,
        contentHash,
        budgetHintUsdc: budgetHint.trim() || undefined,
        listingExpiresAt,
      });
      router.push(`/listings/${listing.id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create listing.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="cl-card-strong mx-auto max-w-md space-y-4 rounded-xl p-6"
    >
      <div>
        <label className="text-xs text-slate-500">Title</label>
        <input
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">Description</label>
        <textarea
          className="mt-1 min-h-[120px] w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">Tags (optional)</label>
        <input
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          value={tagsCsv}
          onChange={(e) => setTagsCsv(e.target.value)}
          placeholder="rust, agents"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">Budget hint (mUSDC, optional)</label>
        <input
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          value={budgetHint}
          onChange={(e) => setBudgetHint(e.target.value)}
          placeholder="Rough guide for bidders"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">Open for bids (hours)</label>
        <input
          type="number"
          min={1}
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          value={hoursOpen}
          onChange={(e) => setHoursOpen(e.target.value)}
        />
      </div>
      <p className="text-xs text-slate-500">
        This is an <strong className="text-slate-300">off-chain</strong> open listing. After you accept
        a bid, create the escrow job on the Create page with the same title/description so the metadata
        hash matches.
      </p>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-teal-500 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
      >
        {submitting ? "Posting…" : "Post listing"}
      </button>
      {message ? <p className="text-sm text-red-400">{message}</p> : null}
      <p className="text-xs text-slate-500">
        <Link href="/listings" className="text-teal-400 hover:text-teal-300">
          ← All listings
        </Link>
      </p>
    </form>
  );
}
