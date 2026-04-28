# Clarity Backend (Base Sepolia)

Greenfield backend implementation for Clarity:
- `contracts/` (Foundry): `MockUSDC`, `ClarityEscrow`
- `relay/` (Hono): job/event APIs + in-memory **plaintext** deliverable storage (optional `CLARITY_ESCROW_ADDRESS` for sync-from-chain)
- `mcp/` (TS CLI runner): wallet, job lifecycle, relay `POST` of deliverable text; on-chain `deliverableCid` is `keccak256(utf8(plaintext))`

**Roles (on-chain):** only the **evaluator** may call `completeJob` (approve) or `rejectJob` (reject and refund). The **client** does not approve or reject; they can read the submitted work from the relay as plaintext when the job is in **Submitted** or later. **Redeploy** the escrow contract if you still have bytecode that allowed the client to `rejectJob`.

## Prerequisites

- Node.js 20+
- Foundry (`forge`, `cast`)
- Base Sepolia funded client wallet

## Environment

Create `.env` in the repo root:

```bash
CLARITY_PRIVATE_KEY=0x...                     # client key
CLARITY_PROVIDER_PRIVATE_KEY=0x...            # provider key
CLARITY_EVALUATOR_PRIVATE_KEY=0x...         # evaluator key

CLARITY_RPC_URL=https://sepolia.base.org
CLARITY_API_URL=http://localhost:8788
CLARITY_USDC_ADDRESS=0x...
CLARITY_ESCROW_ADDRESS=0x...
```

Use the same `CLARITY_ESCROW_ADDRESS` and `CLARITY_RPC_URL` when running **`relay/`** if you use **Sync relay from chain** or `POST /relay/jobs/:jobId/sync-from-chain` from the web or MCP. No shared secret is required for deliverables.

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

Use `8788` to avoid local `8787` conflicts. For **web provider submit** and **submitted work** display, the relay stores deliverable **plaintext** in memory. Set `CLARITY_ESCROW_ADDRESS` (and `CLARITY_RPC_URL` if not default) so `POST /relay/jobs/:jobId/sync-from-chain` can read the escrow `jobs` row:

```bash
cd relay
export CLARITY_RPC_URL=https://sepolia.base.org
export CLARITY_ESCROW_ADDRESS=0x...   # same as NEXT_PUBLIC_ESCROW_ADDRESS
PORT=8788 npm run start
```

**Relay is in-memory:** if the process restarts, deliverable plaintext may be missing while the chain still shows **Submitted**—re-`POST` the same text to `POST /relay/deliverables` or use MCP `submit_work` with the same relay `CLARITY_API_URL`.

**Relay HTTP (deliverables):**

- `POST /relay/deliverables` — body `{ "jobId": n, "plaintext": "…" }` (max 500k chars). Stores plaintext for `GET /relay/deliverables/:jobId`.
- `GET /relay/deliverables/:jobId` — returns `{ jobId, plaintext, updatedAt }` or 404.
- The browser/MCP first sends `submitWork` on-chain with `deliverableCid = keccak256(utf8(plaintext))`, then `POST`s the same string here so the UI and `read_deliverable` can show it.
- `POST /relay/jobs/:jobId/sync-from-chain` — reads `jobs(jobId)` from the escrow, upserts the in-memory relay job, appends `job:synced` to the timeline (same role as MCP `sync_job`).

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

**Prereqs:** Repo root `.env` with three keys (`CLARITY_PRIVATE_KEY` = client, `CLARITY_PROVIDER_PRIVATE_KEY` = agent, `CLARITY_EVALUATOR_PRIVATE_KEY` = checker), `CLARITY_ESCROW_ADDRESS`, `CLARITY_USDC_ADDRESS`, `CLARITY_RPC_URL`, and **`CLARITY_API_URL=http://localhost:8788`** (must match the relay). Mint mUSDC for client + fund agent/evaluator with gas ETH on Base Sepolia.

**Relay** should have `CLARITY_ESCROW_ADDRESS` (and `CLARITY_RPC_URL` if not default) for **Sync relay from chain** and `sync-from-chain`.

### Linear checklist

1. **Relay** — `cd relay && npm run start` (port **8788**); export `CLARITY_ESCROW_ADDRESS` as above.
2. **Web** — `cd web && npm run dev`; `web/.env.local`: `NEXT_PUBLIC_RELAY_URL=http://localhost:8788`, escrow + USDC addresses.
3. **Client creates listing** — Listings → New (same browser session keeps `ownerToken`), or MCP `create_listing` (save `ownerToken` from JSON).
4. **Agent bids** — Web (second wallet on Base Sepolia) or MCP: `bid_listing <id> "pitch" --pk "$CLARITY_PROVIDER_PRIVATE_KEY"`.
5. **Client accepts** — Web listing page (evaluator field + **Accept this bid**), or MCP `accept_listing … --token …`.
6. **Client creates & funds job** — Web **Create** from listing link; create → set budget → approve + fund. If listing link fails, use **Retry link** on the create page or MCP `link_listing`.
7. **Listing on-chain** — Open listing again: **Open job #n** when status is `onchain`.
8. **Provider submits** — **Web:** `/jobs/<id>` as provider — **Submit work** (keccak of UTF-8 text on-chain, then `POST` plaintext to the relay). **Or MCP:** `submit_work <jobId> "text" --pk "$CLARITY_PROVIDER_PRIVATE_KEY"`.
9. **Evaluator checks** — **Web:** same job page — read **Submitted work** (plaintext), then **Approve and release payment**. **Or MCP:** `read_deliverable <jobId>` then `complete_job <jobId> --pk "$CLARITY_EVALUATOR_PRIVATE_KEY"`.
10. **Edges** — While **Submitted**: only the **evaluator** can **Reject and refund client** on the job page or via MCP `reject_job` (evaluator key). If **Funded** but provider never submits and `expiresAt` has passed: client **Claim refund** on the job page or MCP `claim_refund <jobId> --pk "$CLARITY_PRIVATE_KEY"`.

| Step | Web | MCP |
|------|-----|-----|
| Submit work | Job page (provider): tx + `POST /relay/deliverables` | `submit_work` |
| Read submitted work | Job page: **Submitted work** (all connected wallets see plaintext) | `read_deliverable` |
| Release escrow | Job page: **Approve** (evaluator) | `complete_job` (evaluator `--pk`) |
| Reject | Job page: **Reject** (evaluator only) | `reject_job` (evaluator `--pk`) |
| Refund after expiry (Funded) | Job page: **Claim refund** (client) | `claim_refund` |

If `submit_work` or web submit shows on-chain **Submitted** but the relay has no text, `CLARITY_API_URL` / `NEXT_PUBLIC_RELAY_URL` may not match the running relay, or the relay was restarted—fix env and re-`POST` the plaintext to `/relay/deliverables` (same string as used for the hash).
