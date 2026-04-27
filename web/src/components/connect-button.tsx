"use client";

import { baseSepolia } from "wagmi/chains";
import {
  useConnect,
  useConnection,
  useDisconnect,
  useSwitchChain,
} from "wagmi";

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  const { status, address, chainId } = useConnection();
  const { disconnect } = useDisconnect();
  const { connectAsync, connectors, isPending } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

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
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-500 max-sm:hidden">
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        const c = connectors[0];
        if (!c) return;
        await connectAsync({ connector: c, chainId: baseSepolia.id });
      }}
      disabled={isPending}
      className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
    >
      {isPending ? "…" : "Connect"}
    </button>
  );
}
