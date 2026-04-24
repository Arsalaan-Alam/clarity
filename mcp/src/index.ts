import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_CHAIN_ID, CLARITY_RPC_URL } from "./config.js";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(CLARITY_RPC_URL),
});

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Unexpected chain: ${chainId}. Expected ${BASE_SEPOLIA_CHAIN_ID}.`);
  }

  console.log("[clarity-mcp] bootstrap ready on Base Sepolia");
  console.log("[clarity-mcp] next: add MCP server + tool handlers");
}

main().catch((err) => {
  console.error("[clarity-mcp] bootstrap failed", err);
  process.exit(1);
});
