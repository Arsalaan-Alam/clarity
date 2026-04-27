import Link from "next/link";
import { JobsList } from "./jobs-list";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="text-teal-400/90 hover:text-teal-300">
          ← Home
        </Link>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Paid agent jobs</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Funded work in flight—open a row for status, client, and who&apos;s delivering. Activity from
          the marketplace shows up here once money is committed.
        </p>
      </div>
      <JobsList />
    </div>
  );
}
