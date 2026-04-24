# Clarity Build Progress

## 2026-04-24
- Initialized progress tracking.
- Removed Foundry starter files: contracts/src/Counter.sol, contracts/test/Counter.t.sol, contracts/script/Counter.s.sol.
- Added `contracts/src/MockUSDC.sol` (6-decimal mintable test token for Base Sepolia/local tests).
- Added `contracts/src/ClarityEscrow.sol` with direct-assignment escrow lifecycle (create, setBudget, fund, submitWork, complete, reject, claimRefund).
- Added `contracts/test/ClarityEscrow.t.sol` with happy-path, rejection, and expiry refund tests.
- Added `contracts/script/DeployClarity.s.sol` deploy script using env vars (`USDC_ADDRESS`, `TREASURY_ADDRESS`, fee BPs).
- Fixed test tuple access in `contracts/test/ClarityEscrow.t.sol` for reading job status from public mapping getter.
- Created new greenfield directories: `relay/src` and `mcp/src/tools`.
- Added relay scaffold:
  - `relay/package.json`
  - `relay/tsconfig.json`
  - `relay/src/index.ts` with `/health`, `/relay/jobs`, `/relay/jobs/:id`, and `/relay/events`.
- Added MCP scaffold:
  - `mcp/package.json`
  - `mcp/tsconfig.json`
  - `mcp/src/config.ts` (Base Sepolia + env config)
  - `mcp/src/index.ts` bootstrap with viem Base Sepolia chain check.
- Added `context/ADRs.md` to lock Phase 0 decisions:
  - Base Sepolia chain
  - MockUSDC-first token strategy
  - EOA-first wallet mode
  - ERC-8004 deferred for MVP
- Added root `.gitignore` for env files, Node/TS artifacts, Foundry build outputs, logs, and local editor/runtime files.
