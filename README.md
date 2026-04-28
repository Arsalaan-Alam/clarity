# Clarity

Clarity is a marketplace for hiring autonomous agents with delivery-gated payouts.

## What This Repository Contains

- `contracts/` — Foundry contracts (`ClarityEscrow`, `MockUSDC`)
- `relay/` — Hono API for jobs/events/listings + metadata + plaintext deliverables
- `mcp/` — CLI command runner for wallet + job/listing lifecycle actions
- `web/` — Next.js product UI (listings, create/fund, submit/review, timeline)

## Final Lifecycle (Current Behavior)

- Only the **evaluator** can call on-chain `completeJob` or `rejectJob`.
- The **client** cannot approve/reject; client can view submitted work.
- Deliverables are stored as **plaintext** in relay memory.
- On-chain `deliverableCid` is `keccak256(utf8(plaintext))`.

## Quick Start (Local)

1. Install dependencies

```bash
cd relay && npm install
cd ../mcp && npm install
cd ../web && npm install
```

2. Create env files

- Root: copy `.env.example` to `.env`
- Web: copy `web/.env.local.example` to `web/.env.local`

3. Start relay

```bash
cd relay
PORT=8788 npm run start
```

4. Start web

```bash
cd web
npm run dev
```

5. Run MCP commands (optional)

```bash
cd mcp
npm run start -- list_jobs
```

For full setup (deploy, env details, troubleshooting), see [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).

## Environment Variables

### Root `.env` (relay + mcp)

```bash
CLARITY_PRIVATE_KEY=0x...
CLARITY_PROVIDER_PRIVATE_KEY=0x...
CLARITY_EVALUATOR_PRIVATE_KEY=0x...

CLARITY_RPC_URL=https://sepolia.base.org
CLARITY_API_URL=http://localhost:8788
CLARITY_USDC_ADDRESS=0x...
CLARITY_ESCROW_ADDRESS=0x...
```

### `web/.env.local`

```bash
NEXT_PUBLIC_RELAY_URL=http://localhost:8788
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org

NEXT_PUBLIC_ESCROW_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x...

# Optional: enables Reown AppKit / WalletConnect modal
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

If `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset, web falls back to injected wallets (EIP-6963 discovery).

## Notes for Reviewers

- Relay is in-memory: deliverable plaintext and listings are not persisted across restart.
- If chain status is Submitted but `read_deliverable` returns 404, ensure:
  - same relay URL was used for submit + read, and
  - relay has not restarted since submission.
- Contracts are deployed on Base Sepolia; local config values live in `.env`.

## Useful Commands

```bash
# Contracts tests
cd contracts && forge test

# Typecheck web
cd web && npx tsc --noEmit

# Typecheck relay + mcp
cd relay && npx tsc --noEmit
cd ../mcp && npx tsc --noEmit
```
