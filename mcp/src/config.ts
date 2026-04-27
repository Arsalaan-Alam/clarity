export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const CLARITY_RPC_URL = process.env.CLARITY_RPC_URL || "https://sepolia.base.org";
export const CLARITY_API_URL = process.env.CLARITY_API_URL || "http://localhost:8787";
export const CLARITY_PRIVATE_KEY = process.env.CLARITY_PRIVATE_KEY || "";
export const CLARITY_DELIVERABLE_SECRET = process.env.CLARITY_DELIVERABLE_SECRET || "clarity-dev-secret";

export const ESCROW_ADDRESS = process.env.CLARITY_ESCROW_ADDRESS || "";
export const USDC_ADDRESS = process.env.CLARITY_USDC_ADDRESS || "";

export function requireAddress(value: string, name: string): `0x${string}` {
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error(`${name} must be a valid 0x address`);
  }
  return value as `0x${string}`;
}
