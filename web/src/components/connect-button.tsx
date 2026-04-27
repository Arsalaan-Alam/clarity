"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { baseSepolia } from "wagmi/chains";
import {
  useConnect,
  useConnection,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import type { Connector } from "wagmi";

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function sortConnectors(list: readonly Connector[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function ConnectButton() {
  const { status, address, chainId, connector } = useConnection();
  const { disconnect } = useDisconnect();
  const { connectAsync, connectors, isPending } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const sorted = sortConnectors(connectors);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const runConnect = useCallback(
    async (c: Connector) => {
      setOpen(false);
      await connectAsync({ connector: c, chainId: baseSepolia.id });
    },
    [connectAsync],
  );

  if (status === "connected" && address) {
    if (chainId !== baseSepolia.id) {
      return (
        <button
          type="button"
          onClick={() => switchChainAsync({ chainId: baseSepolia.id })}
          disabled={isSwitching}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {isSwitching ? "Switching…" : "Base Sepolia"}
        </button>
      );
    }
    return (
      <div className="flex max-w-sm flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex flex-col items-end text-right">
          <span className="font-mono text-xs text-zinc-500 max-sm:max-w-32 max-sm:truncate sm:inline">
            {shortAddress(address)}
          </span>
          <span className="text-[10px] text-zinc-400">
            {connector?.name ? connector.name : "connected"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => disconnect()}
          className="shrink-0 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No browser wallet found. Install a wallet extension (e.g. MetaMask) and refresh.
      </p>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {open && (
        <ul
          className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-left shadow-md"
          role="menu"
        >
          {sorted.map((c, i) => (
            <li key={`${c.id}-${c.name}-${i}`}>
              <button
                type="button"
                role="menuitem"
                disabled={isPending}
                onClick={() => runConnect(c)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.icon}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded"
                    width={20}
                    height={20}
                  />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-100 text-[9px] font-medium text-zinc-500">
                    {c.name.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 font-medium">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
