# MCP.md

This file is for AI agents (and humans) running the Clarity MCP command runner in this repo.

## Goal

Use `mcp/` commands to execute and verify Clarity workflows (jobs + listings) against Base Sepolia and the local relay.

## Canonical Runtime Assumptions

- Chain: **Base Sepolia** (`84532`)
- Relay default: `http://localhost:8788`
- Escrow lifecycle: **evaluator-only** approve/reject
- Deliverables: plaintext in relay; on-chain hash is `keccak256(utf8(plaintext))`

## Required Environment

Load root env before running commands:

```bash
set -a && source ./.env && set +a
```

Required vars:

- `CLARITY_RPC_URL`
- `CLARITY_API_URL`
- `CLARITY_ESCROW_ADDRESS`
- `CLARITY_USDC_ADDRESS`
- `CLARITY_PRIVATE_KEY` (client)
- `CLARITY_PROVIDER_PRIVATE_KEY`
- `CLARITY_EVALUATOR_PRIVATE_KEY`

## Start Services

Relay in one terminal:

```bash
cd relay
PORT=8788 npm run start
```

MCP command runner:

```bash
cd mcp
npm run start -- <command> [args]
```

Show command usage:

```bash
cd mcp
npm run start
```

## High-Value Commands

### Jobs

- `create_job <provider> <evaluator> <expiresInSeconds> <descriptionCidOrShortText> [--pk ...]`
- `set_budget <jobId> <amountUsdc> [--pk ...]`
- `fund_job <jobId> [--pk ...]`
- `submit_work <jobId> <plaintextOrShortText> [--pk ...]`
- `read_deliverable <jobId>`
- `complete_job <jobId> [--pk ...]` (**evaluator** only)
- `reject_job <jobId> [--pk ...]` (**evaluator** only)
- `claim_refund <jobId> [--pk ...]` (client, funded+expired path)
- `get_job <jobId>`
- `sync_job <jobId>`
- `list_jobs`

### Listings

- `create_listing --title <t> --desc <d> [--tags a,b] [--budget-hint 5] [--hours 72] [--pk ...]`
- `list_listings [status]`
- `bid_listing <listingId> <message> [--pk ...]`
- `accept_listing <listingId> <bidId> <evaluatorAddress> --token <ownerToken> [--pk ...]`
- `cancel_listing <listingId> --token <ownerToken> [--pk ...]`
- `link_listing <listingId> <escrowJobId> --token <ownerToken> [--pk ...]`

## Role Rules (Do Not Violate)

- **Client**: create job, set budget, fund, claim refund (expiry path), listing owner actions.
- **Provider**: submit work.
- **Evaluator**: complete/reject submitted jobs.
- Never assume client can reject submitted work.

## Common Flows

### Minimal happy path

1. `create_job`
2. `set_budget`
3. `fund_job`
4. `submit_work` (provider key)
5. `read_deliverable`
6. `complete_job` (evaluator key)
7. `get_job`

### Listing-to-job path

1. `create_listing` (capture `ownerToken`)
2. `bid_listing`
3. `accept_listing ... --token ...`
4. create/fund job
5. `link_listing ... --token ...`

## Troubleshooting

### `read_deliverable` returns 404

Likely causes:

- relay restarted (in-memory data lost),
- different relay URL for submit vs read,
- job not in submitted/completed path yet.

Fix:

- verify `CLARITY_API_URL`,
- re-run `submit_work` to re-post plaintext,
- or manually post plaintext to relay `POST /relay/deliverables`.

### Relay timeline/state mismatch

- Run `sync_job <jobId>` (or use web “Sync relay from chain”).

## Validation Checklist for Agents

After any lifecycle action, verify:

1. tx receipt succeeded (command completed),
2. `get_job <id>` status changed as expected,
3. relay shows updated timeline (`sync_job` if needed),
4. role constraints respected.

## Safety Notes

- Do not print or commit private keys.
- Do not store secrets in docs, logs, or code comments.
- Prefer passing role-specific key with `--pk` for deterministic behavior.
