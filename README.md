# Clarity Backend (Base Sepolia)

Greenfield backend implementation for Clarity:
- `contracts/` (Foundry): `MockUSDC`, `ClarityEscrow`
- `relay/` (Hono): job/event APIs + encrypted deliverable storage
- `mcp/` (TS CLI runner): wallet, job lifecycle, deliverable encryption/decryption

## Prerequisites

- Node.js 20+
- Foundry (`forge`, `cast`)
- Base Sepolia funded client wallet

## Environment

Create `.env` in the repo root:

```bash
CLARITY_PRIVATE_KEY=0x...                     # client key
CLARITY_PROVIDER_PRIVATE_KEY=0x...            # provider key
CLARITY_EVALUATOR_PRIVATE_KEY=0x...           # evaluator key

CLARITY_RPC_URL=https://sepolia.base.org
CLARITY_API_URL=http://localhost:8788
CLARITY_DELIVERABLE_SECRET=change-me-dev-secret

CLARITY_USDC_ADDRESS=0x...
CLARITY_ESCROW_ADDRESS=0x...
```

## Install

```bash
cd relay && npm install
cd ../mcp && npm install
```

## Start Relay

Use `8788` to avoid local `8787` conflicts:

```bash
cd relay
PORT=8788 npm run start
```

## One-shot backend execution (happy path)

Run from repo root in a second terminal:

```bash
set -a && source ./.env && set +a && \
cd mcp && \
PROVIDER_ADDR=$(cast wallet address --private-key "$CLARITY_PROVIDER_PRIVATE_KEY") && \
EVALUATOR_ADDR=$(cast wallet address --private-key "$CLARITY_EVALUATOR_PRIVATE_KEY") && \
npm run start -- create_job "$PROVIDER_ADDR" "$EVALUATOR_ADDR" 86400 "job-demo" && \
JOB_ID=$(cast call "$CLARITY_ESCROW_ADDRESS" "jobCount()(uint256)" --rpc-url "$CLARITY_RPC_URL") && \
echo "JOB_ID=$JOB_ID" && \
npm run start -- set_budget "$JOB_ID" 5 && \
npm run start -- fund_job "$JOB_ID" && \
npm run start -- submit_work "$JOB_ID" "hello from provider" --pk "$CLARITY_PROVIDER_PRIVATE_KEY" && \
npm run start -- read_deliverable "$JOB_ID" && \
npm run start -- complete_job "$JOB_ID" --pk "$CLARITY_EVALUATOR_PRIVATE_KEY" && \
npm run start -- get_job "$JOB_ID"
```

## Useful checks

```bash
# Relay jobs
curl http://localhost:8788/relay/jobs

# Job timeline
curl "http://localhost:8788/relay/events?jobId=1"
```
