export function getRelayUrl(): string {
  return process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:8788";
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
