"use client";

import { useParams } from "next/navigation";
import { JobDetail } from "./job-detail";

export default function JobByIdPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  if (!id || !/^\d+$/.test(id)) {
    return <p className="text-sm text-red-600">Invalid job id.</p>;
  }
  return <JobDetail id={id} />;
}
