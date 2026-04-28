/**
 * Load `.env` from repo root (and optional `mcp/.env`) so `cd mcp && npm run start` works
 * without manually exporting variables.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const mcpDir = resolve(here, "..");

config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(mcpDir, ".env") });
