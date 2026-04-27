export function getRelayUrl(): string {
  return process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:8788";
}

/** Public origin for WalletConnect / Reown metadata (e.g. https://yourapp.com in production). */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
}

/**
 * Reown (WalletConnect) Cloud project id — required for the WalletConnect modal / QR.
 * @see https://cloud.reown.com
 */
export function getWalletConnectProjectId(): string | null {
  const v = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();
  return v || null;
}

function isAddr(v: string | undefined): v is `0x${string}` {
  return !!v && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function getEscrowAddress(): `0x${string}` | null {
  const v = process.env.NEXT_PUBLIC_ESCROW_ADDRESS;
  return isAddr(v) ? v : null;
}

export function getUsdcAddress(): `0x${string}` | null {
  const v = process.env.NEXT_PUBLIC_USDC_ADDRESS;
  return isAddr(v) ? v : null;
}
