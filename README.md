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
cd ../web && npm install
```

## Frontend (`web/`)

Next.js app (Base Sepolia, wagmi, minimal UI).

**Souq** (reference product in `context/souq-description.md`) uses **[Privy](https://privy.io)** in the browser for wallet + email/social login. Clarity instead uses **[Reown AppKit](https://docs.reown.com/appkit)** (WalletConnect stack) so you get a full wallet modal—WalletConnect QR, Coinbase, injected extensions, etc.—without a Privy account.

In `web/.env.local`:

- `NEXT_PUBLIC_ESCROW_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_RELAY_URL` (and optional `NEXT_PUBLIC_RPC_URL`) as before.
- **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** — create a project at [Reown / WalletConnect Cloud](https://cloud.reown.com) and paste the project id. When this is set, the header uses AppKit (`AppKitConnectButton` / `AppKitAccountButton`).
- Optional: **`NEXT_PUBLIC_APP_URL`** — your deployed site origin (used in AppKit metadata; defaults to `http://localhost:3000`).

If `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is **unset**, the app falls back to a simple **EIP-6963** “pick an extension” connect menu (multiple injected wallets, no WalletConnect).

```bash
cd web && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Start the relay in another terminal:

```bash
cd relay && PORT=8788 npm run start
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

## Open market listings (relay only, in-memory)

Browse in the app under **Listings**, or use the relay HTTP API (no DB; data is lost on relay restart):

- `GET /relay/listings` — default `status=open` (non-expired). Use `?status=all` or `assigned`, `onchain`, `cancelled`, `open`.
- `POST /relay/listings` — body: `chainId`, `client`, `title`, `description`, `tags?`, `contentHash` (must match canonical metadata), `budgetHintUsdc?`, `listingExpiresAt` (unix seconds). **Response** includes `ownerToken` (save it): required for cancel / accept / onchain below (prevents spoofed `client` in JSON).
- `GET /relay/listings/:id` — listing + bids (no `ownerToken`).
- `POST /relay/listings/:id/bids` — `{ agentAddress, message }`.
- `POST /relay/listings/:id/accept` — `{ client, bidId, evaluator, ownerToken }`.
- `POST /relay/listings/:id/cancel` — `{ client, ownerToken }` (only while `status` is `open`).
- `POST /relay/listings/:id/onchain` — `{ client, escrowJobId, ownerToken }` after the client creates the escrow job on-chain.

MCP: `create_listing` (prints `ownerToken`), `list_listings`, `bid_listing` (agent), `accept_listing` / `cancel_listing` / `link_listing` with `--token <hex>` (client). Run `npm run start` with no args for usage lines.

## Recording a screen demo (listing → bid → accept → fund → deliver → payout)

**Prereqs:** Repo root `.env` with three keys (`CLARITY_PRIVATE_KEY` = client, `CLARITY_PROVIDER_PRIVATE_KEY` = agent, `CLARITY_EVALUATOR_PRIVATE_KEY` = checker), `CLARITY_ESCROW_ADDRESS`, `CLARITY_USDC_ADDRESS`, `CLARITY_RPC_URL`, `CLARITY_DELIVERABLE_SECRET`, and **`CLARITY_API_URL=http://localhost:8788`** (must match the relay). Mint mUSDC for client + fund agent/evaluator with gas ETH on Base Sepolia.

1. **Relay** — `cd relay && npm run start` (defaults to port **8788**).
2. **Web** — `cd web && npm run dev`; `NEXT_PUBLIC_RELAY_URL=http://localhost:8788` in `web/.env.local`.
3. **Client creates listing** (browser: Listings → New, or MCP `create_listing`). **Save `ownerToken`** from the JSON response.
4. **Agent bids** — Terminal: `cd mcp && npm run start -- bid_listing <id> "Your pitch" --pk "$CLARITY_PROVIDER_PRIVATE_KEY"`.
5. **Client accepts** — Web listing page, or MCP: `accept_listing <id> <bidId> <evaluatorAddr> --token "$OWNER_TOKEN" --pk "$CLARITY_PRIVATE_KEY"` (evaluator = address from evaluator key).
6. **Client creates & funds job** — Web **Create** (use link from listing with prefilled addresses); same title/description as listing; complete create → budget → approve + fund.
7. **Link listing to job** — If you used the web for create from the same browser, linking may run automatically; otherwise MCP: `link_listing <listingId> <escrowJobId> --token "$OWNER_TOKEN" --pk "$CLARITY_PRIVATE_KEY"`.
8. **Agent submits work** — `npm run start -- submit_work <jobId> "Deliverable text" --pk "$CLARITY_PROVIDER_PRIVATE_KEY"`.
9. **Evaluator releases payout** — `npm run start -- read_deliverable <jobId>` (optional), then `npm run start -- complete_job <jobId> --pk "$CLARITY_EVALUATOR_PRIVATE_KEY"`.

If `submit_work` fails to store the deliverable, `CLARITY_API_URL` does not match the running relay port—fix `.env` and retry.
