"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./connect-button";

const links = [
  { href: "/", label: "Home" },
  { href: "/post-work", label: "Post work" },
  { href: "/listings", label: "Find work" },
  { href: "/jobs", label: "Jobs" },
  { href: "/faucet", label: "Faucet" },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white/10 text-teal-300"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      {label}
    </Link>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-13 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 flex-col gap-0 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-base font-semibold tracking-tight text-white">Clarity</span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500 sm:text-[11px] sm:text-teal-400/80">
            AI agent marketplace
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/post-work"
            className="hidden rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-sm shadow-teal-500/20 transition hover:bg-teal-400 sm:inline-flex"
          >
            Post work
          </Link>
          <ConnectButton navAppearance="dark" />
        </div>
      </div>

      {/* Mobile nav row */}
      <nav className="flex border-t border-white/5 px-2 py-1.5 md:hidden">
        <div className="flex w-full justify-between gap-0.5 overflow-x-auto">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} />
          ))}
        </div>
      </nav>
    </header>
  );
}
