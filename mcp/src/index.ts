import { type Address } from "viem";
import {
  BASE_SEPOLIA_CHAIN_ID,
  CLARITY_DELIVERABLE_SECRET,
  CLARITY_PRIVATE_KEY,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  requireAddress,
} from "./config.js";
import { clarityEscrowAbi } from "./abi/escrow.js";
import { usdcAbi } from "./abi/usdc.js";
import { assertChain, formatUsdc, getAccount, getWalletClient, normalizeAddress, parseUsdc, publicClient, toBytes32 } from "./protocol.js";
import { postRelayEvent } from "./relay.js";
import { decryptDeliverable, encryptDeliverable } from "./encryption.js";

const COMMANDS = [
  "setup_wallet",
  "get_wallet_info",
  "create_job",
  "set_budget",
  "fund_job",
  "submit_work",
  "complete_job",
  "reject_job",
  "get_job",
  "read_deliverable",
  "sync_job",
  "list_jobs",
] as const;

function usage() {
  console.log(`[clarity-mcp] command runner`);
  console.log(`Usage: npm run start -- <command> [args]`);
  console.log(`Commands: ${COMMANDS.join(", ")}`);
}

function parseArgs(argv: string[]) {
  const [, , command, ...args] = argv;
  return { command, args };
}

function extractPrivateKeyArg(args: string[]) {
  const idx = args.findIndex((v) => v === "--pk");
  if (idx === -1) return { privateKey: undefined as string | undefined, filteredArgs: args };
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Usage error: --pk requires a private key value.");
  }
  const filteredArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { privateKey: value, filteredArgs };
}

function parseJobResult(raw: readonly unknown[]) {
  return {
    client: raw[0] as Address,
    provider: raw[1] as Address,
    evaluator: raw[2] as Address,
    budget: raw[3] as bigint,
    expiresAt: Number(raw[4]),
    descriptionCid: raw[5] as `0x${string}`,
    deliverableCid: raw[6] as `0x${string}`,
    status: Number(raw[7]),
  };
}

function statusFromIndex(status: number): "open" | "funded" | "submitted" | "completed" | "rejected" | "expired" {
  switch (status) {
    case 0:
      return "open";
    case 1:
      return "funded";
    case 2:
      return "submitted";
    case 3:
      return "completed";
    case 4:
      return "rejected";
    case 5:
      return "expired";
    default:
      return "open";
  }
}

async function getJob(jobId: bigint) {
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const raw = await publicClient.readContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "jobs",
    args: [jobId],
  });
  return parseJobResult(raw);
}

async function setupWallet(privateKey?: string) {
  await assertChain();
  if (!privateKey && !CLARITY_PRIVATE_KEY) {
    throw new Error("CLARITY_PRIVATE_KEY is missing.");
  }
  const account = getAccount(privateKey);
  console.log(
    JSON.stringify(
      {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        address: account.address,
        rpcUrl: process.env.CLARITY_RPC_URL || "https://sepolia.base.org",
      },
      null,
      2,
    ),
  );
}

async function getWalletInfo(privateKey?: string) {
  const account = getAccount(privateKey);
  const usdcAddress = requireAddress(USDC_ADDRESS, "CLARITY_USDC_ADDRESS");
  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(JSON.stringify({ address: account.address, usdc: formatUsdc(balance) }, null, 2));
}

async function createJob(
  providerArg: string,
  evaluatorArg: string,
  expiresInSecArg: string,
  descriptionArg: string,
  privateKey?: string,
) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const provider = normalizeAddress(providerArg);
  const evaluator = normalizeAddress(evaluatorArg);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(expiresInSecArg));
  const descriptionCid = toBytes32(descriptionArg);
  const beforeCount = await publicClient.readContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "jobCount",
  });

  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "createJob",
    args: [provider, evaluator, expiresAt, descriptionCid],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const createdJobId = await publicClient.readContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "jobCount",
  });
  if (createdJobId <= beforeCount) {
    throw new Error(`create_job did not advance jobCount (before=${beforeCount}, after=${createdJobId})`);
  }

  await postRelayEvent({
    jobId: Number(createdJobId),
    eventType: "job:created",
    status: "open",
    txHash: hash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: account.address,
      provider,
      evaluator,
      descriptionCid,
    },
  });

  console.log(JSON.stringify({ ok: true, jobId: createdJobId.toString(), txHash: hash }, null, 2));
}

async function setBudget(jobIdArg: string, amountArg: string, privateKey?: string) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const amount = parseUsdc(amountArg);
  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "setBudget",
    args: [jobId, amount],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const job = await getJob(jobId);
  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:budget_set",
    status: statusFromIndex(job.status),
    txHash: hash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      descriptionCid: job.descriptionCid,
    },
  });
  console.log(JSON.stringify({ ok: true, jobId: jobId.toString(), budgetUsdc: amountArg, txHash: hash }, null, 2));
}

async function fund(jobIdArg: string, privateKey?: string) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const usdcAddress = requireAddress(USDC_ADDRESS, "CLARITY_USDC_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const jobBefore = await getJob(jobId);

  const approveHash = await wallet.writeContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [escrowAddress, jobBefore.budget],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const fundHash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "fund",
    args: [jobId, jobBefore.budget],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  const jobAfter = await getJob(jobId);
  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:funded",
    status: statusFromIndex(jobAfter.status),
    txHash: fundHash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: jobAfter.client,
      provider: jobAfter.provider,
      evaluator: jobAfter.evaluator,
      descriptionCid: jobAfter.descriptionCid,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId: jobId.toString(),
        approveTxHash: approveHash,
        txHash: fundHash,
      },
      null,
      2,
    ),
  );
}

async function submitWork(jobIdArg: string, deliverableArg: string, privateKey?: string) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const encrypted = await encryptDeliverable(deliverableArg, CLARITY_DELIVERABLE_SECRET);
  const deliverableCid = toBytes32(`enc:${encrypted.ciphertext.slice(0, 20)}`);

  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "submitWork",
    args: [jobId, deliverableCid],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const deliverableStoreRes = await fetch(`${process.env.CLARITY_API_URL || "http://localhost:8787"}/relay/deliverables`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobId: Number(jobId),
      ...encrypted,
    }),
  });
  if (!deliverableStoreRes.ok) {
    throw new Error(`Failed to store encrypted deliverable: ${deliverableStoreRes.status}`);
  }

  const job = await getJob(jobId);
  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:submitted",
    status: statusFromIndex(job.status),
    txHash: hash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      descriptionCid: job.descriptionCid,
    },
  });
  console.log(JSON.stringify({ ok: true, jobId: jobId.toString(), txHash: hash }, null, 2));
}

async function completeJob(jobIdArg: string, privateKey?: string) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "completeJob",
    args: [jobId],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const job = await getJob(jobId);
  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:completed",
    status: statusFromIndex(job.status),
    txHash: hash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      descriptionCid: job.descriptionCid,
    },
  });
  console.log(JSON.stringify({ ok: true, jobId: jobId.toString(), txHash: hash }, null, 2));
}

async function rejectJob(jobIdArg: string, privateKey?: string) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "rejectJob",
    args: [jobId],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const job = await getJob(jobId);
  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:rejected",
    status: statusFromIndex(job.status),
    txHash: hash,
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      descriptionCid: job.descriptionCid,
    },
  });
  console.log(JSON.stringify({ ok: true, jobId: jobId.toString(), txHash: hash }, null, 2));
}

async function printJob(jobIdArg: string) {
  const job = await getJob(BigInt(jobIdArg));
  const payload = {
    ...job,
    budget: job.budget.toString(),
    budgetUsdc: formatUsdc(job.budget),
    statusText: statusFromIndex(job.status),
  };
  console.log(
    JSON.stringify(payload, null, 2),
  );
}

async function readDeliverable(jobIdArg: string) {
  const jobId = Number(jobIdArg);
  const res = await fetch(`${process.env.CLARITY_API_URL || "http://localhost:8787"}/relay/deliverables/${jobId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch deliverable: ${res.status}`);
  }
  const payload = (await res.json()) as {
    ciphertext: string;
    iv: string;
    authTag: string;
    algorithm: "aes-256-gcm";
  };
  const plaintext = await decryptDeliverable(payload, CLARITY_DELIVERABLE_SECRET);
  console.log(JSON.stringify({ jobId, plaintext }, null, 2));
}

async function listJobs() {
  const res = await fetch(`${process.env.CLARITY_API_URL || "http://localhost:8787"}/relay/jobs`);
  if (!res.ok) {
    throw new Error(`Failed to list relay jobs: ${res.status}`);
  }
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function syncJob(jobIdArg: string) {
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const job = await getJob(jobId);

  await postRelayEvent({
    jobId: Number(jobId),
    eventType: "job:synced",
    status: statusFromIndex(job.status),
    txHash: "0xsync",
    job: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      escrow: escrowAddress,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      descriptionCid: job.descriptionCid,
    },
  });

  console.log(JSON.stringify({ ok: true, jobId: jobId.toString(), status: statusFromIndex(job.status) }, null, 2));
}

async function main() {
  await assertChain();
  const { command, args } = parseArgs(process.argv);
  const { privateKey, filteredArgs: toolArgs } = extractPrivateKeyArg(args);

  if (!command) {
    usage();
    return;
  }

  switch (command) {
    case "setup_wallet":
      await setupWallet(privateKey);
      return;
    case "get_wallet_info":
      await getWalletInfo(privateKey);
      return;
    case "create_job":
      if (toolArgs.length < 4) throw new Error("Usage: create_job <provider> <evaluator> <expiresInSeconds> <descriptionCidOrShortText> [--pk <privateKey>]");
      await createJob(toolArgs[0], toolArgs[1], toolArgs[2], toolArgs[3], privateKey);
      return;
    case "set_budget":
      if (toolArgs.length < 2) throw new Error("Usage: set_budget <jobId> <amountUsdc> [--pk <privateKey>]");
      await setBudget(toolArgs[0], toolArgs[1], privateKey);
      return;
    case "fund_job":
      if (toolArgs.length < 1) throw new Error("Usage: fund_job <jobId> [--pk <privateKey>]");
      await fund(toolArgs[0], privateKey);
      return;
    case "submit_work":
      if (toolArgs.length < 2) throw new Error("Usage: submit_work <jobId> <deliverableCidOrShortText> [--pk <privateKey>]");
      await submitWork(toolArgs[0], toolArgs[1], privateKey);
      return;
    case "complete_job":
      if (toolArgs.length < 1) throw new Error("Usage: complete_job <jobId> [--pk <privateKey>]");
      await completeJob(toolArgs[0], privateKey);
      return;
    case "reject_job":
      if (toolArgs.length < 1) throw new Error("Usage: reject_job <jobId> [--pk <privateKey>]");
      await rejectJob(toolArgs[0], privateKey);
      return;
    case "get_job":
      if (toolArgs.length < 1) throw new Error("Usage: get_job <jobId>");
      await printJob(toolArgs[0]);
      return;
    case "read_deliverable":
      if (toolArgs.length < 1) throw new Error("Usage: read_deliverable <jobId>");
      await readDeliverable(toolArgs[0]);
      return;
    case "sync_job":
      if (toolArgs.length < 1) throw new Error("Usage: sync_job <jobId>");
      await syncJob(toolArgs[0]);
      return;
    case "list_jobs":
      await listJobs();
      return;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error("[clarity-mcp] command failed", err);
  process.exit(1);
});
