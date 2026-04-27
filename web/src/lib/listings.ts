import { getRelayUrl } from "@/lib/env";

export type ListingStatus = "open" | "assigned" | "cancelled" | "onchain";

export type MarketListing = {
  id: number;
  chainId: number;
  client: string;
  title: string;
  description: string;
  tags: string[];
  contentHash: string;
  budgetHintUsdc?: string;
  listingExpiresAt: number;
  status: ListingStatus;
  createdAt: number;
  acceptedBidId?: number;
  provider?: string;
  evaluator?: string;
  escrowJobId?: number;
};

export type MarketBid = {
  id: number;
  listingId: number;
  agentAddress: string;
  message: string;
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
};

const base = () => getRelayUrl().replace(/\/$/, "");

export async function fetchListings(status?: string): Promise<MarketListing[]> {
  const u = new URL("/relay/listings", base());
  if (status) u.searchParams.set("status", status);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("listings fetch failed");
  const data = (await res.json()) as { listings: MarketListing[] };
  return data.listings;
}

export async function fetchListingDetail(
  id: number,
): Promise<{ listing: MarketListing; bids: MarketBid[] }> {
  const res = await fetch(`${base()}/relay/listings/${id}`);
  if (res.status === 404) throw new Error("listing_not_found");
  if (!res.ok) throw new Error("listing detail failed");
  return (await res.json()) as { listing: MarketListing; bids: MarketBid[] };
}

export async function createListing(input: {
  chainId: number;
  client: string;
  title: string;
  description: string;
  tags?: string[];
  contentHash: `0x${string}`;
  budgetHintUsdc?: string;
  listingExpiresAt: number;
}): Promise<{ listing: MarketListing; ownerToken: string }> {
  const res = await fetch(`${base()}/relay/listings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create listing failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { listing: MarketListing; ownerToken?: string };
  if (!data.ownerToken) {
    throw new Error("Relay must return ownerToken (upgrade relay to latest).");
  }
  return { listing: data.listing, ownerToken: data.ownerToken };
}

export const listingOwnerStorageKey = (listingId: number) =>
  `clarity_listing_owner_${listingId}` as const;

/** Save after creating a listing (web). Uses localStorage + sessionStorage so accept works in a new tab. */
export function persistListingOwnerToken(listingId: number, ownerToken: string): void {
  if (typeof window === "undefined") return;
  const key = listingOwnerStorageKey(listingId);
  try {
    localStorage.setItem(key, ownerToken);
    sessionStorage.setItem(key, ownerToken);
  } catch {
    /* private mode */
  }
}

/** Owner secret for accept / cancel / link-onchain from this browser. */
export function getStoredListingOwnerToken(listingId: number): string | null {
  if (typeof window === "undefined") return null;
  const key = listingOwnerStorageKey(listingId);
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function postListingBid(
  listingId: number,
  input: { agentAddress: string; message: string },
): Promise<MarketBid> {
  const res = await fetch(`${base()}/relay/listings/${listingId}/bids`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`bid failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { bid: MarketBid };
  return data.bid;
}

export async function acceptListingBid(input: {
  listingId: number;
  client: string;
  bidId: number;
  evaluator: string;
  ownerToken: string;
}): Promise<MarketListing> {
  const res = await fetch(`${base()}/relay/listings/${input.listingId}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: input.client,
      bidId: input.bidId,
      evaluator: input.evaluator,
      ownerToken: input.ownerToken,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`accept failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { listing: MarketListing };
  return data.listing;
}

export async function cancelListing(
  listingId: number,
  client: string,
  ownerToken: string,
): Promise<MarketListing> {
  const res = await fetch(`${base()}/relay/listings/${listingId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client, ownerToken }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`cancel failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { listing: MarketListing };
  return data.listing;
}

export async function linkListingToEscrow(input: {
  listingId: number;
  client: string;
  escrowJobId: number;
  ownerToken: string;
}): Promise<MarketListing> {
  const res = await fetch(`${base()}/relay/listings/${input.listingId}/onchain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: input.client,
      escrowJobId: input.escrowJobId,
      ownerToken: input.ownerToken,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`link onchain failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { listing: MarketListing };
  return data.listing;
}
