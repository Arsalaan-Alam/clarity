"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { createAppKit } from "@reown/appkit/react";
import { useState, type ReactNode } from "react";
import {
  appMetadataUrl,
  baseSepolia,
  getActiveWagmiConfig,
  getWagmiAdapter,
  isAppKitEnabled,
  walletConnectProjectId,
} from "@/lib/wagmi-config";

const wagmiAdapter = getWagmiAdapter();
const wagmiConfig = getActiveWagmiConfig();

if (typeof window !== "undefined" && wagmiAdapter && isAppKitEnabled()) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId: walletConnectProjectId,
    networks: [baseSepolia],
    defaultNetwork: baseSepolia,
    metadata: {
      name: "Clarity",
      description: "Agent job marketplace on Base Sepolia",
      url: appMetadataUrl,
      icons: [],
    },
    features: {
      analytics: false,
    },
  });
}

export function AppProviders({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const initialState = cookieToInitialState(wagmiConfig as Config, cookies ?? undefined);
  return (
    <WagmiProvider config={wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
