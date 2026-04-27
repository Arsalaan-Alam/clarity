import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia } from "@reown/appkit/networks";
import { createConfig, http, injected } from "wagmi";
import type { Config } from "wagmi";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";

/** From [Reown Cloud](https://cloud.reown.com). Enables AppKit (WalletConnect + browser wallets). */
export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export function isAppKitEnabled(): boolean {
  return walletConnectProjectId.length > 0;
}

/** Used in AppKit metadata; set in production so wallet verify matches your origin. */
export const appMetadataUrl =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

let adapterSingleton: WagmiAdapter | null | undefined;

export function getWagmiAdapter(): WagmiAdapter | null {
  if (adapterSingleton !== undefined) return adapterSingleton;
  if (!isAppKitEnabled()) {
    adapterSingleton = null;
    return null;
  }
  adapterSingleton = new WagmiAdapter({
    projectId: walletConnectProjectId,
    networks: [baseSepolia],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
  });
  return adapterSingleton;
}

/** EIP-6963 list when AppKit / WalletConnect project id is not configured. */
export const fallbackWagmiConfig: Config = createConfig({
  chains: [baseSepolia],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: {
    [baseSepolia.id]: http(rpcUrl),
  },
  ssr: true,
});

export function getActiveWagmiConfig(): Config {
  return getWagmiAdapter()?.wagmiConfig ?? fallbackWagmiConfig;
}

export { baseSepolia };
