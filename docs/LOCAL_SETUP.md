# Local Setup Guide

This guide is the canonical way to run Clarity locally for reviewers and contributors.

## 1) Prerequisites

- Node.js 20+
- Foundry (`forge`, `cast`) for contracts/deploy/test
- Base Sepolia wallet(s) with test ETH for gas

## 2) Install Dependencies

From repo root:

```bash
cd relay && npm install
cd ../mcp && npm install
cd ../web && npm install
```

## 3) Configure Environment

### Root `.env` (used by relay + mcp)

```bash
cp .env.example .env
```

Required fields:

- `CLARITY_PRIVATE_KEY` (client)
- `CLARITY_PROVIDER_PRIVATE_KEY`
- `CLARITY_EVALUATOR_PRIVATE_KEY`
- `CLARITY_RPC_URL`
- `CLARITY_API_URL` (usually `http://localhost:8788`)
- `CLARITY_USDC_ADDRESS`
- `CLARITY_ESCROW_ADDRESS`

### Web `.env.local`

```bash
cp web/.env.local.example web/.env.local
```

Required fields:

- `NEXT_PUBLIC_RELAY_URL`
- `NEXT_PUBLIC_RPC_URL` (optional; defaults to Base Sepolia public RPC)
- `NEXT_PUBLIC_ESCROW_ADDRESS`
- `NEXT_PUBLIC_USDC_ADDRESS`

Optional (for Reown AppKit modal):

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_APP_URL`

If WalletConnect project id is unset, web uses injected wallets.

## 4) Run Services

### Relay

```bash
cd relay
PORT=8788 npm run start
```

### Web

```bash
cd web
npm run dev
```

### MCP (optional CLI flows)

```bash
cd mcp
npm run start -- list_jobs
```

## 5) Contract Testing and Deployment

### Run tests

```bash
cd contracts
forge test
```

### Deploy `ClarityEscrow`

`contracts/script/DeployClarity.s.sol` expects:

- `USDC_ADDRESS`
- `TREASURY_ADDRESS`
- optional `PLATFORM_FEE_BP`, `EVALUATOR_FEE_BP`

Example:

```bash
cd contracts
export USDC_ADDRESS=0x...
export TREASURY_ADDRESS=0x...
forge script script/DeployClarity.s.sol:DeployClarity \
  --rpc-url "$CLARITY_RPC_URL" \
  --broadcast \
  --private-key "$CLARITY_PRIVATE_KEY"
```

After deployment, update:

- `CLARITY_ESCROW_ADDRESS` in root `.env`
- `NEXT_PUBLIC_ESCROW_ADDRESS` in `web/.env.local`

## 6) Lifecycle Rules (Current)

- Evaluator only: `completeJob`, `rejectJob`
- Client cannot approve/reject
- Deliverable relay storage is plaintext
- On-chain `deliverableCid` is `keccak256(utf8(plaintext))`

## 7) Troubleshooting

### `read_deliverable` returns 404

Most common causes:

1. Relay restart (in-memory data lost)
2. Different relay URL used for submit vs read
3. Job not yet submitted on-chain

Fix:

- Verify `CLARITY_API_URL` / `NEXT_PUBLIC_RELAY_URL`
- Re-run `submit_work` with same relay
- Or re-POST plaintext to `/relay/deliverables`

### Job visible on-chain but missing in relay timeline

Use:

- UI: **Sync relay from chain** on job page
- MCP: `sync_job <jobId>`
