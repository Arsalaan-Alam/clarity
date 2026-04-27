import { createConfig, http, injected } from "wagmi";
import { baseSepolia } from "wagmi/chains";
/** Direct file import avoids `wagmi/connectors` barrel (porto, metaMask, safe, …) and broken Next/Webpack resolution. */
import { walletConnect } from "@clarity/wc-connector";
import { getAppUrl, getWalletConnectProjectId } from "./env";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";

const wcProjectId = getWalletConnectProjectId();
const appUrl = getAppUrl();

const WC_ICON =
  "https://raw.githubusercontent.com/WalletConnect/walletconnect-assets/master/Icon/Blue%20(Default)/Icon%20-%20Blue%20\(Default%20-%20big%29.png";

/**
 * Set `NEXT_PUBLIC_WC_PROJECT_ID` to enable the WalletConnect option (phone / QR / 1000+ wallets).
 * Browser extension wallets work without it via EIP-6963 discovery.
 */
export const isWalletConnectConfigured = Boolean(wcProjectId);

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  // `injected()` (window.ethereum) + `multiInjectedProviderDiscovery` (default true) adds one
  // connector per EIP-6963–announced extension (MetaMask, Rabby, etc.).
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            metadata: {
              name: "Clarity",
              description: "Clarity escrow on Base Sepolia",
              url: appUrl,
              icons: [WC_ICON],
            },
            showQrModal: true,
            qrModalOptions: {
              enableExplorer: true,
              basic: true,
            },
          }),
        ]
      : []),
  ],
  // default `true` — do not set false or extension wallets will not auto-register
  multiInjectedProviderDiscovery: true,
  transports: {
    [baseSepolia.id]: http(rpcUrl),
  },
  ssr: true,
});
