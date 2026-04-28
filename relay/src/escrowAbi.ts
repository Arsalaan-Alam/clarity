/** Minimal ABI for relay chain reads (must match ClarityEscrow jobs()). */
export const clarityEscrowJobsAbi = [
  {
    type: "function",
    name: "jobs",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "budget", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "descriptionCid", type: "bytes32" },
      { name: "deliverableCid", type: "bytes32" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;
