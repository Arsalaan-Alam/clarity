# Contracts (`contracts/`)

This package contains the Clarity smart contracts and Foundry tests.

## Contracts

- `src/ClarityEscrow.sol`
  - Job lifecycle contract used by Clarity app
  - Evaluator-only completion/rejection
- `src/MockUSDC.sol`
  - 6-decimal mintable ERC20 for testing/demo flows

## Test

```bash
forge test
```

## Deploy `ClarityEscrow`

Script: `script/DeployClarity.s.sol`

Required env:

- `USDC_ADDRESS`
- `TREASURY_ADDRESS`
- optional `PLATFORM_FEE_BP` (default `500`)
- optional `EVALUATOR_FEE_BP` (default `500`)

Example:

```bash
export USDC_ADDRESS=0x...
export TREASURY_ADDRESS=0x...
forge script script/DeployClarity.s.sol:DeployClarity \
  --rpc-url "$CLARITY_RPC_URL" \
  --broadcast \
  --private-key "$CLARITY_PRIVATE_KEY"
```

After deploy, update app env:

- root `.env` => `CLARITY_ESCROW_ADDRESS`
- `web/.env.local` => `NEXT_PUBLIC_ESCROW_ADDRESS`
