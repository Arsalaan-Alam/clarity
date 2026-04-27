"use client";

import { useParams } from "next/navigation";
import { ListingDetailMarket } from "./listing-detail-market";

export default function ListingDetailPage() {
  const params = useParams();
  const raw = typeof params?.id === "string" ? params.id : "";
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) {
    return <p className="text-sm text-red-600">Invalid listing id.</p>;
  }
  return <ListingDetailMarket id={n} />;
}
