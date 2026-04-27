import Link from "next/link";
import { ConnectButton } from "./connect-button";

export function Header() {
  return (
    <header className="border-b border-zinc-200/80 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="text-sm font-medium tracking-tight text-zinc-900 hover:text-zinc-600 transition-colors"
        >
          Clarity
        </Link>
        <nav className="flex items-center gap-5 text-sm text-zinc-600">
          <Link
            href="/jobs"
            className="hover:text-zinc-900 transition-colors"
          >
            Jobs
          </Link>
          <Link
            href="/create"
            className="hover:text-zinc-900 transition-colors"
          >
            Create
          </Link>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
