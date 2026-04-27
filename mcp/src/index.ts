import { decodeEventLog, type Address } from "viem";
import { BASE_SEPOLIA_CHAIN_ID, CLARITY_PRIVATE_KEY, ESCROW_ADDRESS, USDC_ADDRESS, requireAddress } from "./config.js";
import { clarityEscrowAbi } from "./abi/escrow.js";
import { usdcAbi } from "./abi/usdc.js";
import { assertChain, formatUsdc, getAccount, getWalletClient, normalizeAddress, parseUsdc, publicClient, toBytes32 } from "./protocol.js";
import { postRelayEvent } from "./relay.js";

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

async function setupWallet() {
  await assertChain();
  if (!CLARITY_PRIVATE_KEY) {
    throw new Error("CLARITY_PRIVATE_KEY is missing.");
  }
  const account = getAccount();
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

async function getWalletInfo() {
  const account = getAccount();
  const usdcAddress = requireAddress(USDC_ADDRESS, "CLARITY_USDC_ADDRESS");
  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(JSON.stringify({ address: account.address, usdc: formatUsdc(balance) }, null, 2));
}

async function createJob(providerArg: string, evaluatorArg: string, expiresInSecArg: string, descriptionArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const provider = normalizeAddress(providerArg);
  const evaluator = normalizeAddress(evaluatorArg);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(expiresInSecArg));
  const descriptionCid = toBytes32(descriptionArg);

  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "createJob",
    args: [provider, evaluator, expiresAt, descriptionCid],
    account,
    chain: wallet.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let createdJobId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: clarityEscrowAbi, data: log.data, topics: log.topics });
      if (parsed.eventName === "JobCreated") {
        if (!Array.isArray(parsed.args) && "jobId" in parsed.args) {
          createdJobId = parsed.args.jobId as bigint;
        }
        break;
      }
    } catch {
      continue;
    }
  }
  if (createdJobId === null) {
    const count = await publicClient.readContract({
      address: escrowAddress,
      abi: clarityEscrowAbi,
      functionName: "jobCount",
    });
    createdJobId = count;
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

async function setBudget(jobIdArg: string, amountArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
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

async function fund(jobIdArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
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

async function submitWork(jobIdArg: string, deliverableArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const jobId = BigInt(jobIdArg);
  const deliverableCid = toBytes32(deliverableArg);

  const hash = await wallet.writeContract({
    address: escrowAddress,
    abi: clarityEscrowAbi,
    functionName: "submitWork",
    args: [jobId, deliverableCid],
    account,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

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

async function completeJob(jobIdArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
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

async function rejectJob(jobIdArg: string) {
  const wallet = getWalletClient();
  const account = getAccount();
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
  console.log(
    JSON.stringify(
      {
        ...job,
        budgetUsdc: formatUsdc(job.budget),
        statusText: statusFromIndex(job.status),
      },
      null,
      2,
    ),
  );
}

async function listJobs() {
  const res = await fetch(`${process.env.CLARITY_API_URL || "http://localhost:8787"}/relay/jobs`);
  if (!res.ok) {
    throw new Error(`Failed to list relay jobs: ${res.status}`);
  }
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  await assertChain();
  const { command, args } = parseArgs(process.argv);

  if (!command) {
    usage();
    return;
  }

  switch (command) {
    case "setup_wallet":
      await setupWallet();
      return;
    case "get_wallet_info":
      await getWalletInfo();
      return;
    case "create_job":
      if (args.length < 4) throw new Error("Usage: create_job <provider> <evaluator> <expiresInSeconds> <descriptionCidOrShortText>");
      await createJob(args[0], args[1], args[2], args[3]);
      return;
    case "set_budget":
      if (args.length < 2) throw new Error("Usage: set_budget <jobId> <amountUsdc>");
      await setBudget(args[0], args[1]);
      return;
    case "fund_job":
      if (args.length < 1) throw new Error("Usage: fund_job <jobId>");
      await fund(args[0]);
      return;
    case "submit_work":
      if (args.length < 2) throw new Error("Usage: submit_work <jobId> <deliverableCidOrShortText>");
      await submitWork(args[0], args[1]);
      return;
    case "complete_job":
      if (args.length < 1) throw new Error("Usage: complete_job <jobId>");
      await completeJob(args[0]);
      return;
    case "reject_job":
      if (args.length < 1) throw new Error("Usage: reject_job <jobId>");
      await rejectJob(args[0]);
      return;
    case "get_job":
      if (args.length < 1) throw new Error("Usage: get_job <jobId>");
      await printJob(args[0]);
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
