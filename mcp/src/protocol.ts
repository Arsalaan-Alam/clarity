import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_CHAIN_ID, CLARITY_RPC_URL } from "./config.js";

export function getAccount() {
  const pk = process.env.CLARITY_PRIVATE_KEY;
  if (!pk) {
    throw new Error("CLARITY_PRIVATE_KEY is required for write operations.");
  }
  return privateKeyToAccount(pk as Hex);
}

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(CLARITY_RPC_URL),
});

export function getWalletClient() {
  return createWalletClient({
    account: getAccount(),
    chain: baseSepolia,
    transport: http(CLARITY_RPC_URL),
  });
}

export async function assertChain() {
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Unexpected chain: ${chainId}. Expected ${BASE_SEPOLIA_CHAIN_ID}.`);
  }
}

export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, 6);
}

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, 6);
}

export function toBytes32(value: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value as Hex;
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.length > 32) {
    throw new Error("String input too long for bytes32. Pass a 0x-prefixed bytes32 value instead.");
  }
  const out = new Uint8Array(32);
  out.set(bytes);
  return `0x${Buffer.from(out).toString("hex")}` as Hex;
}

export function normalizeAddress(value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value as Address;
}
