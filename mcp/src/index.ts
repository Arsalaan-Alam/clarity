import { type Address } from "viem";
import {
  BASE_SEPOLIA_CHAIN_ID,
  CLARITY_API_URL,
  CLARITY_DELIVERABLE_SECRET,
  CLARITY_PRIVATE_KEY,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  requireAddress,
} from "./config.js";
import { clarityEscrowAbi } from "./abi/escrow.js";
import { usdcAbi } from "./abi/usdc.js";
import { assertChain, formatUsdc, getAccount, getWalletClient, normalizeAddress, parseUsdc, publicClient, toBytes32 } from "./protocol.js";
import {
  registerJobMetadata,
  postRelayEvent,
  relayAcceptBid,
  relayCancelListing,
  relayCreateListing,
  relayLinkListingOnchain,
  relayListListings,
  relayPostBid,
} from "./relay.js";
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
  "create_listing",
  "list_listings",
  "bid_listing",
  "accept_listing",
  "cancel_listing",
  "link_listing",
] as const;

function usage() {
  console.log(`[clarity-mcp] command runner`);
  console.log(`Usage: npm run start -- <command> [args]`);
  console.log(`Commands: ${COMMANDS.join(", ")}`);
  console.log(
    `Listings (relay): list_listings [status?] | bid_listing <id> "<message>" [--pk agentKey]`,
  );
  console.log(
    `Listings (client): create_listing --title … --desc … | accept_listing <id> <bidId> <0xEval> --token <hex> [--pk key] | cancel_listing <id> --token <hex> [--pk key] | link_listing <listingId> <escrowJobId> --token <hex> [--pk key]`,
  );
  console.log(`--token is the ownerToken field from create_listing JSON (or browser sessionStorage for web-created listings).`);
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

/** Returned once from relay on `POST /relay/listings`; required for cancel / accept / onchain. */
function extractOwnerTokenArg(args: string[]) {
  const idx = args.findIndex((v) => v === "--token");
  if (idx === -1) return { ownerToken: undefined as string | undefined, filteredArgs: args };
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Usage error: --token requires the hex secret from create_listing output.");
  }
  const filteredArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { ownerToken: value, filteredArgs };
}

/** Strips `--title`, `--desc` / `--description`, `--tags` for create_job. */
function parseListingCreateFlags(toolArgs: string[]) {
  const rest: string[] = [];
  let title: string | undefined;
  let description: string | undefined;
  let tags: string[] | undefined;
  let budgetHint: string | undefined;
  let hours = 72;
  for (let i = 0; i < toolArgs.length; i++) {
    const a = toolArgs[i];
    if (a === "--title") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_listing: --title needs a value.");
      title = v;
      continue;
    }
    if (a === "--desc" || a === "--description") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_listing: --desc needs a value.");
      description = v;
      continue;
    }
    if (a === "--tags") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_listing: --tags needs a value.");
      tags = v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      continue;
    }
    if (a === "--budget-hint") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_listing: --budget-hint needs a value.");
      budgetHint = v;
      continue;
    }
    if (a === "--hours") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_listing: --hours needs a value.");
      hours = Number(v);
      continue;
    }
    rest.push(a);
  }
  if (rest.length > 0) {
    throw new Error(`create_listing: unexpected arguments: ${rest.join(" ")}`);
  }
  return { title, description, tags, budgetHint, hours };
}

function parseCreateJobCliArgs(toolArgs: string[]) {
  const positional: string[] = [];
  let title: string | undefined;
  let description: string | undefined;
  let tags: string[] | undefined;
  for (let i = 0; i < toolArgs.length; i++) {
    const a = toolArgs[i];
    if (a === "--title") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_job: --title needs a value.");
      title = v;
      continue;
    }
    if (a === "--desc" || a === "--description") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_job: --desc needs a value.");
      description = v;
      continue;
    }
    if (a === "--tags") {
      const v = toolArgs[++i];
      if (!v || v.startsWith("--")) throw new Error("create_job: --tags needs a value.");
      tags = v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      continue;
    }
    positional.push(a);
  }
  return { positional, title, description, tags };
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
  descriptionArg: string | undefined,
  privateKey: string | undefined,
  rich: { title: string; description: string; tags?: string[] } | undefined,
) {
  const wallet = getWalletClient(privateKey);
  const account = getAccount(privateKey);
  const escrowAddress = requireAddress(ESCROW_ADDRESS, "CLARITY_ESCROW_ADDRESS");
  const provider = normalizeAddress(providerArg);
  const evaluator = normalizeAddress(evaluatorArg);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(expiresInSecArg));

  let descriptionCid: `0x${string}`;
  if (rich) {
    const title = rich.title.trim();
    const desc = rich.description.trim();
    if (!title || !desc) {
      throw new Error("Rich metadata requires non-empty title and description.");
    }
    const registered = await registerJobMetadata({ title, description: desc, tags: rich.tags });
    descriptionCid = registered.contentHash;
  } else {
    descriptionCid = toBytes32(descriptionArg!);
  }
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
      ...(rich
        ? {
            title: rich.title.trim(),
            description: rich.description.trim(),
            ...(rich.tags?.length ? { tags: rich.tags } : {}),
          }
        : {}),
    },
  });

  console.log(
    JSON.stringify(
      { ok: true, jobId: createdJobId.toString(), txHash: hash, descriptionCid },
      null,
      2,
    ),
  );
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

  const deliverableStoreRes = await fetch(`${CLARITY_API_URL}/relay/deliverables`, {
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
  const res = await fetch(`${CLARITY_API_URL}/relay/deliverables/${jobId}`);
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
  const res = await fetch(`${CLARITY_API_URL}/relay/jobs`);
  if (!res.ok) {
    throw new Error(`Failed to list relay jobs: ${res.status}`);
  }
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function createListingCmd(toolArgs: string[], privateKey?: string) {
  if (!privateKey && !CLARITY_PRIVATE_KEY) {
    throw new Error("create_listing requires CLARITY_PRIVATE_KEY or --pk (client wallet).");
  }
  const flags = parseListingCreateFlags(toolArgs);
  if (!flags.title?.trim() || !flags.description?.trim()) {
    throw new Error(
      "Usage: create_listing --title <t> --desc <description> [--tags a,b] [--budget-hint 5] [--hours 72] [--pk <key>]",
    );
  }
  if (!Number.isFinite(flags.hours) || flags.hours <= 0) {
    throw new Error("create_listing: --hours must be a positive number.");
  }
  const account = getAccount(privateKey);
  const { contentHash } = await registerJobMetadata({
    title: flags.title.trim(),
    description: flags.description.trim(),
    tags: flags.tags,
  });
  const listingExpiresAt = Math.floor(Date.now() / 1000) + flags.hours * 3600;
  const data = await relayCreateListing({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    client: account.address,
    title: flags.title.trim(),
    description: flags.description.trim(),
    tags: flags.tags,
    contentHash,
    budgetHintUsdc: flags.budgetHint?.trim() || undefined,
    listingExpiresAt,
  });
  console.log(JSON.stringify(data, null, 2));
}

async function listListingsCmd(statusArg?: string) {
  const data = await relayListListings(statusArg || "open");
  console.log(JSON.stringify(data, null, 2));
}

async function bidListingCmd(listingIdArg: string, message: string, privateKey?: string) {
  const listingId = Number(listingIdArg);
  if (!Number.isFinite(listingId) || listingId <= 0) throw new Error("Invalid listing id.");
  const account = getAccount(privateKey);
  const data = await relayPostBid(listingId, account.address, message);
  console.log(JSON.stringify(data, null, 2));
}

async function acceptListingCmd(
  listingIdArg: string,
  bidIdArg: string,
  evaluatorArg: string,
  privateKey?: string,
  ownerToken?: string,
) {
  const listingId = Number(listingIdArg);
  const bidId = Number(bidIdArg);
  if (!Number.isFinite(listingId) || listingId <= 0) throw new Error("Invalid listing id.");
  if (!Number.isFinite(bidId) || bidId <= 0) throw new Error("Invalid bid id.");
  if (!ownerToken?.trim()) {
    throw new Error("accept_listing requires --token <hex> (ownerToken from create_listing output).");
  }
  const account = getAccount(privateKey);
  const data = await relayAcceptBid({
    listingId,
    client: account.address,
    bidId,
    evaluator: normalizeAddress(evaluatorArg),
    ownerToken: ownerToken.trim(),
  });
  console.log(JSON.stringify(data, null, 2));
}

async function cancelListingCmd(listingIdArg: string, privateKey?: string, ownerToken?: string) {
  const listingId = Number(listingIdArg);
  if (!Number.isFinite(listingId) || listingId <= 0) throw new Error("Invalid listing id.");
  if (!ownerToken?.trim()) {
    throw new Error("cancel_listing requires --token <hex> (ownerToken from create_listing output).");
  }
  const account = getAccount(privateKey);
  const data = await relayCancelListing(listingId, account.address, ownerToken.trim());
  console.log(JSON.stringify(data, null, 2));
}

async function linkListingOnchainCmd(
  listingIdArg: string,
  escrowJobIdArg: string,
  privateKey?: string,
  ownerToken?: string,
) {
  const listingId = Number(listingIdArg);
  const escrowJobId = Number(escrowJobIdArg);
  if (!Number.isFinite(listingId) || listingId <= 0) throw new Error("Invalid listing id.");
  if (!Number.isFinite(escrowJobId) || escrowJobId <= 0) throw new Error("Invalid escrow job id.");
  if (!ownerToken?.trim()) {
    throw new Error("link_listing requires --token <hex> (ownerToken from create_listing output).");
  }
  const account = getAccount(privateKey);
  const data = await relayLinkListingOnchain({
    listingId,
    client: account.address,
    escrowJobId,
    ownerToken: ownerToken.trim(),
  });
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
  const { privateKey, filteredArgs: argsSansPk } = extractPrivateKeyArg(args);
  const { ownerToken, filteredArgs: toolArgs } = extractOwnerTokenArg(argsSansPk);

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
    case "create_job": {
      const { positional, title, description, tags } = parseCreateJobCliArgs(toolArgs);
      const hasRich = Boolean(title?.trim() && description?.trim());
      if (hasRich) {
        if (positional.length < 3) {
          throw new Error(
            "Usage (rich metadata): create_job <provider> <evaluator> <expiresInSeconds> --title <t> --desc <description> [--tags a,b] [--pk <key>]",
          );
        }
        await createJob(
          positional[0]!,
          positional[1]!,
          positional[2]!,
          undefined,
          privateKey,
          { title: title!, description: description!, tags },
        );
      } else {
        if (positional.length < 4) {
          throw new Error(
            "Usage: create_job <provider> <evaluator> <expiresInSeconds> <descriptionCidOrShortText> [--pk <privateKey>]  |  rich: add --title and --desc (3 positionals only)",
          );
        }
        await createJob(
          positional[0]!,
          positional[1]!,
          positional[2]!,
          positional[3]!,
          privateKey,
          undefined,
        );
      }
      return;
    }
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
    case "create_listing":
      await createListingCmd(toolArgs, privateKey);
      return;
    case "list_listings":
      await listListingsCmd(toolArgs[0]);
      return;
    case "bid_listing":
      if (toolArgs.length < 2) {
        throw new Error("Usage: bid_listing <listingId> <message> [--pk <agentPrivateKey>]");
      }
      await bidListingCmd(toolArgs[0], toolArgs[1], privateKey);
      return;
    case "accept_listing":
      if (toolArgs.length < 3) {
        throw new Error(
          "Usage: accept_listing <listingId> <bidId> <evaluatorAddress> --token <hex> [--pk <clientPrivateKey>]",
        );
      }
      await acceptListingCmd(toolArgs[0], toolArgs[1], toolArgs[2], privateKey, ownerToken);
      return;
    case "cancel_listing":
      if (toolArgs.length < 1) {
        throw new Error("Usage: cancel_listing <listingId> --token <hex> [--pk <clientPrivateKey>]");
      }
      await cancelListingCmd(toolArgs[0], privateKey, ownerToken);
      return;
    case "link_listing":
      if (toolArgs.length < 2) {
        throw new Error(
          "Usage: link_listing <listingId> <escrowJobId> --token <hex> [--pk <clientPrivateKey>]",
        );
      }
      await linkListingOnchainCmd(toolArgs[0], toolArgs[1], privateKey, ownerToken);
      return;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error("[clarity-mcp] command failed", err);
  process.exit(1);
});
