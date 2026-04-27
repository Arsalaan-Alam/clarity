declare module "@clarity/wc-connector" {
  import type { CreateConnectorFn } from "@wagmi/core";
  /** Params match @walletconnect/ethereum-provider init; see wagmi WalletConnect connector docs. */
  export function walletConnect(parameters: {
    projectId: string;
    metadata?: { name: string; description: string; url: string; icons: string[] };
    showQrModal?: boolean;
    isNewChainsStale?: boolean;
    /** Merged into Reown AppKit via WCM → AppKit conversion; include `basic` for integrated WC flow. */
    qrModalOptions?: Record<string, unknown>;
  }): CreateConnectorFn;
}
