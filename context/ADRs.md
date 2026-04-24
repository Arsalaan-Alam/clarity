# Clarity ADRs (Phase 0)

## ADR-001: Chain
- **Decision:** Base Sepolia (`84532`) for development and demo.
- **Why:** aligns with Base-focused requirement and lowers deployment friction.

## ADR-002: Token
- **Decision:** Start with local `MockUSDC` (6 decimals) in development.
- **Why:** deterministic tests and no external faucet dependency while contracts/mcp/relay are stabilizing.
- **Next:** swap to Base Sepolia USDC address when deploy + funding flow is ready.

## ADR-003: Agent Wallet Mode
- **Decision:** EOA-first for initial implementation.
- **Why:** fastest path to reliable end-to-end flow in limited time.
- **Next:** upgrade to AA (`viem` + permissionless + bundler/paymaster) after happy path is stable.

## ADR-004: Identity
- **Decision:** Skip ERC-8004 identity in MVP.
- **Why:** escrow and encrypted delivery path are higher priority for first working version.
