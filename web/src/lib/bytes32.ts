import { type Hex, keccak256, toBytes } from "viem";

/**
 * Packs a short string into 32 bytes for demo jobs (matches short ASCII path in MCP).
 * Longer strings are hashed to bytes32.
 */
export function toBytes32(value: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value as Hex;
  }
  if (value.length > 32) {
    return keccak256(toBytes(value));
  }
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(value));
  return `0x${Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}
