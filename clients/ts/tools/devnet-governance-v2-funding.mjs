import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  Connection,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  guardRpcConnection,
  loadSecureKeypair,
  openJournal,
  sha256Hex,
  withCeremonyRpcOwnerLock,
  writeExclusiveJson,
} from "./devnet-ceremony-runtime.mjs";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

const bs58 = bs58Module.default ?? bs58Module;

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const TREASURY = new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j");
const FEE_PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const CONTROLLER_PROGRAM = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const TREASURY_KMS_ROLE = "governance-treasury-v1";
const TREASURY_KMS_RESOURCE = "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-treasury-v1/cryptoKeyVersions/1";
const DEFAULT_AMOUNT_LAMPORTS = 7_700_000_000n;
const MAX_AMOUNT_LAMPORTS = DEFAULT_AMOUNT_LAMPORTS;
const MAX_TRANSACTION_FEE_LAMPORTS = 100_000n;
const PLAN_SCHEMA = "ameba-governance-v2-funding-plan-v1";
const PLAN_FILE = "devnet-governance-v2-funding-plan-v1.json";
const DEPLOYMENT_MANIFEST_FILE = "controller-deployment-manifest-v2.json";
const TOOL_FILE = fileURLToPath(import.meta.url);
const KMS_SIGNER_FILE = fileURLToPath(new URL("./gcp-kms-ed25519-signer.mjs", import.meta.url));

const PLAN_KEYS = [
  "amountLamports",
  "feePayer",
  "feePayerLamports",
  "fundOperationId",
  "genesisHash",
  "kmsKeyVersion",
  "kmsSignerSha256",
  "mainnetAllowed",
  "observedSlot",
  "planId",
  "returnOperationId",
  "rpcProviderOriginSha256",
  "rpcSelection",
  "schema",
  "toolSha256",
  "treasury",
  "treasuryLamports",
  "version",
];

const USAGE = `usage:
  node tools/devnet-governance-v2-funding.mjs plan --run-dir <secure-dir> [--amount-lamports <1..7700000000>]
  node tools/devnet-governance-v2-funding.mjs execute --run-dir <secure-dir> --arm <fund-operation-id>
  node tools/devnet-governance-v2-funding.mjs status --run-dir <secure-dir>
  node tools/devnet-governance-v2-funding.mjs return --run-dir <secure-dir> --arm <return-operation-id>
  node tools/devnet-governance-v2-funding.mjs self-test

Live modes require AMEBA_RPC_ENV_FILE. execute/return additionally require the
fixed fee-payer keypair in AMEBA_CEREMONY_FEE_PAYER. execute also requires the
fixed treasury public PEM in AMEBA_GOVERNANCE_TREASURY_PUBLIC_PEM. Each armed
mode makes at most one sendRawTransaction call with maxRetries=0.`;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `missing required environment ${name}`);
  return value;
}

function stableJson(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    assert.notEqual(encoded, undefined, "value is not JSON encodable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, entry]) => `${JSON.stringify(field)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function domainHash(domain, value) {
  return createHash("sha256")
    .update(domain, "ascii")
    .update(stableJson(value), "utf8")
    .digest("hex");
}

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys changed`);
}

function canonicalU64(value, label, { allowZero = false, maximum = 0xffff_ffff_ffff_ffffn } = {}) {
  assert(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value), `${label} must be a canonical decimal u64`);
  const decoded = BigInt(value);
  assert(decoded <= maximum, `${label} exceeds its maximum`);
  if (!allowZero) assert(decoded > 0n, `${label} must be nonzero`);
  return decoded;
}

function parseAmount(value) {
  if (value === undefined) return DEFAULT_AMOUNT_LAMPORTS;
  return canonicalU64(value, "amount-lamports", { maximum: MAX_AMOUNT_LAMPORTS });
}

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "help")) return { command: "help" };
  const command = argv[0];
  assert(["plan", "execute", "status", "return", "self-test"].includes(command), USAGE);
  if (command === "self-test") {
    assert.equal(argv.length, 1, USAGE);
    return { command };
  }
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(["--run-dir", "--amount-lamports", "--arm"].includes(flag), `unknown option ${flag}\n${USAGE}`);
    assert(!values.has(flag), `duplicate option ${flag}`);
    assert(typeof value === "string" && value.length > 0, `${flag} requires a value`);
    values.set(flag, value);
  }
  assert(values.has("--run-dir"), `--run-dir is required\n${USAGE}`);
  if (command === "plan") {
    assert(!values.has("--arm"), "plan cannot be armed");
  } else {
    assert(!values.has("--amount-lamports"), `${command} cannot change the planned amount`);
  }
  if (command === "execute" || command === "return") assert(values.has("--arm"), `${command} requires --arm`);
  else assert(!values.has("--arm"), `${command} cannot be armed`);
  return {
    command,
    runDir: values.get("--run-dir"),
    amountLamports: command === "plan" ? parseAmount(values.get("--amount-lamports")) : undefined,
    arm: values.get("--arm"),
  };
}

function planBase(input) {
  return {
    schema: PLAN_SCHEMA,
    version: 1,
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    rpcSelection: input.rpcSelection,
    rpcProviderOriginSha256: input.rpcProviderOriginSha256,
    treasury: input.treasury.toBase58(),
    feePayer: input.feePayer.toBase58(),
    kmsKeyVersion: TREASURY_KMS_RESOURCE,
    amountLamports: input.amountLamports.toString(),
    observedSlot: String(input.state.contextSlot),
    treasuryLamports: input.state.treasuryLamports.toString(),
    feePayerLamports: input.state.feePayerLamports.toString(),
    toolSha256: input.toolSha256,
    kmsSignerSha256: input.kmsSignerSha256,
  };
}

function buildPlan(input) {
  const base = planBase(input);
  const planId = domainHash("AMOEBA_GOVERNANCE_V2_FUNDING_PLAN_V1", base);
  return {
    ...base,
    planId,
    fundOperationId: domainHash("AMOEBA_GOVERNANCE_V2_FUNDING_EXECUTE_V1", { planId }),
    returnOperationId: domainHash("AMOEBA_GOVERNANCE_V2_FUNDING_RETURN_V1", { planId }),
  };
}

function validatePlan(plan, expectedHashes) {
  assertExactKeys(plan, PLAN_KEYS, "funding plan");
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.version, 1);
  assert.equal(plan.mainnetAllowed, false);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(new PublicKey(plan.treasury).toBase58(), TREASURY.toBase58());
  assert.equal(new PublicKey(plan.feePayer).toBase58(), FEE_PAYER.toBase58());
  assert.equal(plan.kmsKeyVersion, TREASURY_KMS_RESOURCE);
  assert(/^[a-z0-9-]+$/u.test(plan.rpcSelection), "funding plan RPC selection is invalid");
  for (const [field, hash] of Object.entries({
    rpcProviderOriginSha256: plan.rpcProviderOriginSha256,
    toolSha256: plan.toolSha256,
    kmsSignerSha256: plan.kmsSignerSha256,
    planId: plan.planId,
    fundOperationId: plan.fundOperationId,
    returnOperationId: plan.returnOperationId,
  })) assert(/^[0-9a-f]{64}$/u.test(hash), `${field} is not lowercase SHA-256`);
  if (expectedHashes) {
    assert.equal(plan.toolSha256, expectedHashes.toolSha256, "funding tool changed after planning");
    assert.equal(plan.kmsSignerSha256, expectedHashes.kmsSignerSha256, "KMS signer changed after planning");
  }
  const amountLamports = canonicalU64(plan.amountLamports, "plan amount", { maximum: MAX_AMOUNT_LAMPORTS });
  const state = {
    contextSlot: Number(canonicalU64(plan.observedSlot, "plan observed slot")),
    treasuryLamports: canonicalU64(plan.treasuryLamports, "plan treasury balance", { allowZero: true }),
    feePayerLamports: canonicalU64(plan.feePayerLamports, "plan fee-payer balance", { allowZero: true }),
  };
  assert(Number.isSafeInteger(state.contextSlot) && state.contextSlot > 0, "plan observed slot is not a safe positive integer");
  const expected = buildPlan({
    amountLamports,
    feePayer: FEE_PAYER,
    kmsSignerSha256: plan.kmsSignerSha256,
    rpcProviderOriginSha256: plan.rpcProviderOriginSha256,
    rpcSelection: plan.rpcSelection,
    state,
    toolSha256: plan.toolSha256,
    treasury: TREASURY,
  });
  assert.deepEqual(plan, expected, "funding plan deterministic identity changed");
  assert(state.treasuryLamports >= amountLamports, "planned treasury balance cannot cover the transfer");
  assert(state.feePayerLamports >= MAX_TRANSACTION_FEE_LAMPORTS, "planned fee payer lacks the fee reserve");
  return { amountLamports, state };
}

function planPath(runDir) {
  return path.join(runDir, PLAN_FILE);
}

async function currentToolHashes() {
  return {
    toolSha256: sha256Hex(await readFile(TOOL_FILE)),
    kmsSignerSha256: sha256Hex(await readFile(KMS_SIGNER_FILE)),
  };
}

async function loadPlan(runDirInput) {
  const runDir = await requireSecureDirectory(runDirInput, "funding run directory");
  const file = await requireSecureRegularFile(planPath(runDir), "funding plan");
  const raw = await readFile(file, "utf8");
  assert(raw.endsWith("\n"), "funding plan lacks its final newline");
  const plan = JSON.parse(raw);
  const hashes = await currentToolHashes();
  const decoded = validatePlan(plan, hashes);
  return { ...decoded, file, plan, raw, runDir };
}

function journalName(direction, plan) {
  return `devnet-governance-v2-funding-${direction}-${plan.planId.slice(0, 16)}`;
}

function journalPath(runDir, direction, plan) {
  return path.join(runDir, `${journalName(direction, plan)}.jsonl`);
}

async function journalExists(runDir, direction, plan) {
  try {
    const status = await lstat(journalPath(runDir, direction, plan));
    assert(status.isFile() && !status.isSymbolicLink(), `${direction} journal path is not a regular file`);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readExistingJournal(runDir, direction, plan, operationId) {
  assert(await journalExists(runDir, direction, plan), `${direction} journal is absent`);
  const journal = await openJournal(runDir, journalName(direction, plan), operationId);
  const entries = [...journal.entries];
  await journal.close();
  return entries;
}

function assertSystemAccount(account, expected, label) {
  assert(account, `${label} account is absent`);
  assert(account.owner.equals(SystemProgram.programId), `${label} owner changed`);
  assert.equal(account.executable, false, `${label} became executable`);
  assert.equal(account.data.length, 0, `${label} gained data`);
  assert(Number.isSafeInteger(account.lamports) && account.lamports >= 0, `${label} balance is invalid`);
  assert(expected instanceof PublicKey, `${label} expected identity is invalid`);
}

async function readFinalizedState(connection, minimumContextSlot) {
  const response = await connection.getMultipleAccountsInfoAndContext(
    [TREASURY, FEE_PAYER],
    { commitment: "finalized", minContextSlot: minimumContextSlot },
  );
  assert(Number.isSafeInteger(response.context.slot) && response.context.slot > 0, "finalized funding context slot is invalid");
  assertSystemAccount(response.value[0], TREASURY, "governance treasury");
  assertSystemAccount(response.value[1], FEE_PAYER, "fee payer");
  return {
    contextSlot: response.context.slot,
    treasuryLamports: BigInt(response.value[0].lamports),
    feePayerLamports: BigInt(response.value[1].lamports),
  };
}

async function rpcContext(journal, scope, expectedPlan) {
  const configuration = await loadDevnetRpcConfiguration();
  const originSha256 = sha256Hex(Buffer.from(configuration.stateRpcOrigin, "utf8"));
  if (expectedPlan) {
    assert.equal(configuration.rpcSelection, expectedPlan.rpcSelection, "RPC selection changed from the exact plan");
    assert.equal(originSha256, expectedPlan.rpcProviderOriginSha256, "RPC provider origin changed from the exact plan");
  }
  const raw = new Connection(configuration.stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
  const connection = guardRpcConnection(raw, journal, scope);
  assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
  return { configuration, connection, originSha256 };
}

function transferIdentities(direction, identities = { treasury: TREASURY, feePayer: FEE_PAYER }) {
  assert(direction === "fund" || direction === "return", "unknown funding direction");
  return direction === "fund"
    ? { from: identities.treasury, to: identities.feePayer }
    : { from: identities.feePayer, to: identities.treasury };
}

function buildTransferTransaction({ direction, amountLamports, blockhash, lastValidBlockHeight, identities = { treasury: TREASURY, feePayer: FEE_PAYER } }) {
  assert(Number.isSafeInteger(lastValidBlockHeight) && lastValidBlockHeight > 0, "funding last-valid block height is invalid");
  const { from, to } = transferIdentities(direction, identities);
  const transaction = new Transaction({
    feePayer: identities.feePayer,
    recentBlockhash: blockhash,
  }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: amountLamports }));
  assertTransferTransaction(transaction, direction, amountLamports, identities);
  return transaction;
}

function assertTransferTransaction(transaction, direction, amountLamports, identities = { treasury: TREASURY, feePayer: FEE_PAYER }) {
  assert(transaction.feePayer?.equals(identities.feePayer), "funding fee payer changed");
  assert.equal(transaction.instructions.length, 1, "funding transaction must contain exactly one instruction");
  const instruction = transaction.instructions[0];
  assert(instruction.programId.equals(SystemProgram.programId), "funding instruction is not SystemProgram");
  assert.equal(SystemInstruction.decodeInstructionType(instruction), "Transfer", "funding instruction is not a transfer");
  const decoded = SystemInstruction.decodeTransfer(instruction);
  const expected = transferIdentities(direction, identities);
  assert(decoded.fromPubkey.equals(expected.from), "funding transfer source changed");
  assert(decoded.toPubkey.equals(expected.to), "funding transfer destination changed");
  assert.equal(BigInt(decoded.lamports), amountLamports, "funding transfer amount changed");
  const message = transaction.compileMessage();
  const signerKeys = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  assert.deepEqual(
    signerKeys.map((key) => key.toBase58()),
    direction === "fund"
      ? [identities.feePayer.toBase58(), identities.treasury.toBase58()]
      : [identities.feePayer.toBase58()],
    "funding required-signer order changed",
  );
  assert.equal(message.accountKeys.length, 3, "funding transaction admitted an extra account");
  assert(message.accountKeys[2].equals(SystemProgram.programId), "funding SystemProgram account moved");
  return { from: expected.from.toBase58(), to: expected.to.toBase58(), signerKeys };
}

async function writeSecureMessage(runDir, message) {
  const hash = sha256Hex(message);
  const file = path.join(runDir, `.governance-treasury-message-${hash.slice(0, 16)}.bin`);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(message);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
  return file;
}

async function signWithTreasuryKms(transaction, runDir) {
  const pem = await requireSecureRegularFile(
    requiredEnvironment("AMEBA_GOVERNANCE_TREASURY_PUBLIC_PEM"),
    "governance treasury KMS public PEM",
  );
  const message = transaction.serializeMessage();
  const messageSha256 = sha256Hex(message);
  const messageFile = await writeSecureMessage(runDir, message);
  try {
    const result = spawnSync(process.execPath, [
      KMS_SIGNER_FILE,
      "--authority", TREASURY_KMS_ROLE,
      "--kms-key-version", TREASURY_KMS_RESOURCE,
      "--public-key-pem", pem,
      "--message", messageFile,
      "--expected-message-sha256", messageSha256,
    ], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`treasury KMS signer failed (status=${result.status ?? "none"}, stdoutSha256=${sha256Hex(Buffer.from(result.stdout ?? "", "utf8"))}, stderrSha256=${sha256Hex(Buffer.from(result.stderr ?? "", "utf8"))})`);
    }
    const signed = JSON.parse(result.stdout);
    assertExactKeys(signed, [
      "schema", "authorityRole", "authority", "kmsKeyVersion", "messageBytes",
      "messageSha256", "requiredSignerIndex", "signatureBase64",
    ], "treasury KMS result");
    assert.equal(signed.schema, "ameba-gcp-kms-ed25519-signature-v1");
    assert.equal(signed.authorityRole, TREASURY_KMS_ROLE);
    assert.equal(signed.authority, TREASURY.toBase58());
    assert.equal(signed.kmsKeyVersion, TREASURY_KMS_RESOURCE);
    assert.equal(signed.messageBytes, message.length);
    assert.equal(signed.messageSha256, messageSha256);
    assert.equal(signed.requiredSignerIndex, 1, "treasury must be the second required signer");
    const signature = Buffer.from(signed.signatureBase64, "base64");
    assert.equal(signature.length, 64, "treasury KMS signature length changed");
    assert.equal(signature.toString("base64"), signed.signatureBase64, "treasury KMS signature is noncanonical base64");
    transaction.addSignature(TREASURY, signature);
    assert.equal(transaction.verifySignatures(), true, "combined funding signatures do not verify");
    return { messageSha256, requiredSignerIndex: signed.requiredSignerIndex };
  } finally {
    await unlink(messageFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function sendExactlyOnce(connection, wire, options) {
  return connection.sendRawTransaction(wire, options);
}

function staticKeys(message) {
  return "staticAccountKeys" in message ? message.staticAccountKeys : message.accountKeys;
}

function validateFinalizedTransfer(landed, signature, direction, amountLamports, prestate) {
  assert(landed, "funding transaction is not available at finalized commitment");
  assert.equal(landed.meta?.err, null, "funding transaction failed on chain");
  assert(landed.transaction.signatures.includes(signature), "finalized funding signature changed");
  assert(Number.isSafeInteger(landed.slot) && landed.slot >= prestate.contextSlot, "funding finalized slot regressed");
  const keys = staticKeys(landed.transaction.message);
  const payerIndex = keys.findIndex((key) => key.equals(FEE_PAYER));
  const treasuryIndex = keys.findIndex((key) => key.equals(TREASURY));
  assert(payerIndex >= 0 && treasuryIndex >= 0, "finalized funding identities are absent");
  const fee = BigInt(landed.meta.fee);
  assert(fee > 0n && fee <= MAX_TRANSACTION_FEE_LAMPORTS, "funding transaction fee is outside the bound");
  const payerPre = BigInt(landed.meta.preBalances[payerIndex]);
  const payerPost = BigInt(landed.meta.postBalances[payerIndex]);
  const treasuryPre = BigInt(landed.meta.preBalances[treasuryIndex]);
  const treasuryPost = BigInt(landed.meta.postBalances[treasuryIndex]);
  assert.equal(payerPre, prestate.feePayerLamports, "funding fee-payer prebalance changed");
  assert.equal(treasuryPre, prestate.treasuryLamports, "funding treasury prebalance changed");
  if (direction === "fund") {
    assert.equal(treasuryPost, treasuryPre - amountLamports, "treasury debit differs from the exact plan");
    assert.equal(payerPost, payerPre + amountLamports - fee, "fee-payer credit differs from the exact plan minus fee");
  } else {
    assert.equal(treasuryPost, treasuryPre + amountLamports, "treasury return credit differs from the exact plan");
    assert.equal(payerPost, payerPre - amountLamports - fee, "fee-payer return debit differs from the exact plan plus fee");
  }
  return { feeLamports: fee.toString(), slot: landed.slot };
}

async function assertDeploymentComplete(runDir) {
  const file = await requireSecureRegularFile(path.join(runDir, DEPLOYMENT_MANIFEST_FILE), "controller deployment manifest");
  const raw = await readFile(file);
  const manifest = JSON.parse(raw.toString("utf8"));
  assert.equal(manifest.schema, "amoeba-controller-deployment-manifest-v2", "controller deployment manifest schema changed");
  assert.equal(manifest.mainnetAllowed, false, "controller deployment manifest permits Mainnet");
  assert.equal(manifest.authorizedForInitializationEvidence, true, "controller deployment manifest is not completed evidence");
  assert.equal(manifest.cluster?.genesisHash, EXPECTED_GENESIS, "controller deployment manifest genesis changed");
  assert.equal(manifest.controller?.programId, CONTROLLER_PROGRAM.toBase58(), "deployed controller identity changed");
  assert.equal(manifest.controller?.programdata, CONTROLLER_PROGRAMDATA.toBase58(), "deployed controller ProgramData changed");
  assert(typeof manifest.deployment?.signature === "string" && manifest.deployment.signature.length > 0, "controller deployment signature is absent");
  assert(Number.isSafeInteger(manifest.deployment?.slot) && manifest.deployment.slot > 0, "controller deployment slot is invalid");
  return {
    deploymentManifestSha256: sha256Hex(raw),
    deploymentSignature: manifest.deployment.signature,
    deploymentSlot: manifest.deployment.slot,
  };
}

async function assertForwardFundingFinalized(runDir, plan) {
  const entries = await readExistingJournal(runDir, "fund", plan, plan.fundOperationId);
  const finalized = entries.findLast((entry) => entry.event === "finalized");
  const complete = entries.findLast((entry) => entry.event === "complete");
  assert(finalized && complete, "forward funding has not completed at finalized commitment");
  assert.equal(finalized.direction, "fund");
  assert.equal(finalized.amountLamports, plan.amountLamports);
  assert.equal(complete.signature, finalized.signature);
  return { signature: finalized.signature, slot: finalized.slot };
}

async function planFunding(options) {
  const runDir = await requireSecureDirectory(options.runDir, "funding run directory");
  const hashes = await currentToolHashes();
  const planningOperationId = domainHash("AMOEBA_GOVERNANCE_V2_FUNDING_PLANNING_SESSION_V1", {
    amountLamports: options.amountLamports.toString(),
    toolSha256: hashes.toolSha256,
    kmsSignerSha256: hashes.kmsSignerSha256,
  });
  return withCeremonyRpcOwnerLock(runDir, planningOperationId, async () => {
    const journal = await openJournal(runDir, `devnet-governance-v2-funding-planning-${planningOperationId.slice(0, 16)}`, planningOperationId);
    try {
      assert.equal(journal.entries.length, 0, "funding planning session already exists; do not overwrite it");
      await journal.append("planning-started", { amountLamports: options.amountLamports.toString(), mainnetAllowed: false });
      const { configuration, connection, originSha256 } = await rpcContext(journal, "governance-v2-funding-plan");
      const state = await readFinalizedState(connection);
      const plan = buildPlan({
        amountLamports: options.amountLamports,
        feePayer: FEE_PAYER,
        kmsSignerSha256: hashes.kmsSignerSha256,
        rpcProviderOriginSha256: originSha256,
        rpcSelection: configuration.rpcSelection,
        state,
        toolSha256: hashes.toolSha256,
        treasury: TREASURY,
      });
      validatePlan(plan, hashes);
      await writeExclusiveJson(planPath(runDir), plan);
      await journal.append("plan-written", {
        planFile: PLAN_FILE,
        planId: plan.planId,
        fundOperationId: plan.fundOperationId,
        returnOperationId: plan.returnOperationId,
        observedSlot: plan.observedSlot,
      });
      return plan;
    } finally {
      await journal.close();
    }
  });
}

async function executeDirection(options, direction) {
  const loaded = await loadPlan(options.runDir);
  const operationId = direction === "fund" ? loaded.plan.fundOperationId : loaded.plan.returnOperationId;
  assert.equal(options.arm, operationId, `explicit --arm must equal ${operationId}`);
  return withCeremonyRpcOwnerLock(loaded.runDir, operationId, async () => {
    const journal = await openJournal(loaded.runDir, journalName(direction, loaded.plan), operationId);
    try {
      assert.equal(journal.entries.length, 0, `${direction} already has durable attempt evidence; automatic or manual resend is forbidden`);
      await journal.append("session-started", {
        direction,
        planId: loaded.plan.planId,
        amountLamports: loaded.plan.amountLamports,
        automaticRetries: 0,
      });
      let deploymentEvidence = null;
      if (direction === "return") {
        const forward = await assertForwardFundingFinalized(loaded.runDir, loaded.plan);
        deploymentEvidence = await assertDeploymentComplete(loaded.runDir);
        assert(deploymentEvidence.deploymentSlot > forward.slot, "controller deployment did not occur after forward funding");
        await journal.append("return-prerequisites-verified", { ...forward, ...deploymentEvidence });
      }
      const { connection } = await rpcContext(journal, `governance-v2-funding-${direction}`, loaded.plan);
      const prestate = await readFinalizedState(connection, loaded.state.contextSlot);
      if (direction === "fund") {
        assert.equal(prestate.treasuryLamports, loaded.state.treasuryLamports, "treasury balance changed after planning");
        assert.equal(prestate.feePayerLamports, loaded.state.feePayerLamports, "fee-payer balance changed after planning");
      } else {
        assert(prestate.feePayerLamports >= loaded.amountLamports + MAX_TRANSACTION_FEE_LAMPORTS, "fee payer cannot return the exact amount plus bounded fee");
      }
      await journal.append("prestate-verified", {
        contextSlot: prestate.contextSlot,
        treasuryLamports: prestate.treasuryLamports.toString(),
        feePayerLamports: prestate.feePayerLamports.toString(),
      });
      const latest = await connection.getLatestBlockhashAndContext("finalized");
      assert(latest.context.slot >= prestate.contextSlot, "funding blockhash context regressed below prestate");
      const transaction = buildTransferTransaction({
        direction,
        amountLamports: loaded.amountLamports,
        blockhash: latest.value.blockhash,
        lastValidBlockHeight: latest.value.lastValidBlockHeight,
      });
      const identities = transferIdentities(direction);
      const decodedAction = {
        schema: "ameba-governance-v2-funding-action-v1",
        direction,
        program: SystemProgram.programId.toBase58(),
        instruction: "transfer",
        from: identities.from.toBase58(),
        to: identities.to.toBase58(),
        amountLamports: loaded.plan.amountLamports,
        feePayer: FEE_PAYER.toBase58(),
        requiredSigners: direction === "fund" ? [FEE_PAYER.toBase58(), TREASURY.toBase58()] : [FEE_PAYER.toBase58()],
        recentBlockhash: latest.value.blockhash,
        lastValidBlockHeight: latest.value.lastValidBlockHeight,
        minContextSlot: prestate.contextSlot,
        maxRetries: 0,
        skipPreflight: false,
      };
      process.stdout.write(`${JSON.stringify({ status: "decoded-action", operationId, action: decodedAction })}\n`);
      await journal.append("decoded-action", { action: decodedAction });
      const messageSha256 = sha256Hex(transaction.serializeMessage());
      await journal.append("prepared", { direction, messageSha256, recentBlockhash: latest.value.blockhash, lastValidBlockHeight: latest.value.lastValidBlockHeight });

      const payer = await loadSecureKeypair(requiredEnvironment("AMEBA_CEREMONY_FEE_PAYER"), FEE_PAYER, "ceremony fee payer");
      transaction.partialSign(payer);
      await journal.append("fee-payer-signed", { authority: FEE_PAYER.toBase58(), messageSha256 });
      if (direction === "fund") {
        const kms = await signWithTreasuryKms(transaction, loaded.runDir);
        await journal.append("treasury-kms-signed", { authority: TREASURY.toBase58(), kmsKeyVersion: TREASURY_KMS_RESOURCE, ...kms });
      } else {
        assert.equal(transaction.verifySignatures(), true, "return signature does not verify");
      }
      assertTransferTransaction(transaction, direction, loaded.amountLamports);
      const wire = transaction.serialize({ requireAllSignatures: true, verifySignatures: true });
      const localSignature = bs58.encode(transaction.signature);
      await journal.append("signed", { signature: localSignature, wireBytes: wire.length, wireSha256: sha256Hex(wire) });
      let returnedSignature;
      try {
        returnedSignature = await sendExactlyOnce(connection, wire, {
          skipPreflight: false,
          preflightCommitment: "finalized",
          maxRetries: 0,
          minContextSlot: prestate.contextSlot,
        });
      } catch (error) {
        await journal.append("submission-ambiguous", {
          direction,
          sendAttempts: 1,
          errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
        });
        throw error;
      }
      assert.equal(returnedSignature, localSignature, "state RPC returned a different funding signature");
      await journal.append("submitted", { direction, signature: returnedSignature, sendAttempts: 1 });
      let landed;
      try {
        const confirmation = await connection.confirmTransaction({
          signature: returnedSignature,
          blockhash: latest.value.blockhash,
          lastValidBlockHeight: latest.value.lastValidBlockHeight,
        }, "finalized");
        assert.equal(confirmation.value.err, null, "funding confirmation returned an on-chain error");
        landed = await connection.getTransaction(returnedSignature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      } catch (error) {
        await journal.append("finalization-ambiguous", {
          direction,
          signature: returnedSignature,
          errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
        });
        throw error;
      }
      const finalized = validateFinalizedTransfer(landed, returnedSignature, direction, loaded.amountLamports, prestate);
      await journal.append("finalized", {
        direction,
        signature: returnedSignature,
        amountLamports: loaded.plan.amountLamports,
        ...finalized,
      });
      await journal.append("complete", {
        direction,
        signature: returnedSignature,
        slot: finalized.slot,
        returnedSamePlannedAmount: direction === "return",
        deploymentManifestSha256: deploymentEvidence?.deploymentManifestSha256 ?? null,
      });
      return { direction, operationId, signature: returnedSignature, slot: finalized.slot };
    } finally {
      await journal.close();
    }
  });
}

async function statusFunding(options) {
  const loaded = await loadPlan(options.runDir);
  const operationId = domainHash("AMOEBA_GOVERNANCE_V2_FUNDING_STATUS_V1", { planId: loaded.plan.planId });
  return withCeremonyRpcOwnerLock(loaded.runDir, operationId, async () => {
    const journal = await openJournal(loaded.runDir, `devnet-governance-v2-funding-status-${loaded.plan.planId.slice(0, 16)}`, operationId);
    try {
      const { connection } = await rpcContext(journal, "governance-v2-funding-status", loaded.plan);
      const state = await readFinalizedState(connection, loaded.state.contextSlot);
      const fundEntries = await journalExists(loaded.runDir, "fund", loaded.plan)
        ? await readExistingJournal(loaded.runDir, "fund", loaded.plan, loaded.plan.fundOperationId)
        : [];
      const returnEntries = await journalExists(loaded.runDir, "return", loaded.plan)
        ? await readExistingJournal(loaded.runDir, "return", loaded.plan, loaded.plan.returnOperationId)
        : [];
      let deploymentManifestPresent = false;
      try {
        await requireSecureRegularFile(path.join(loaded.runDir, DEPLOYMENT_MANIFEST_FILE), "controller deployment manifest");
        deploymentManifestPresent = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return {
        schema: "ameba-governance-v2-funding-status-v1",
        planId: loaded.plan.planId,
        observedSlot: state.contextSlot,
        amountLamports: loaded.plan.amountLamports,
        treasuryLamports: state.treasuryLamports.toString(),
        feePayerLamports: state.feePayerLamports.toString(),
        fundStatus: fundEntries.findLast((entry) => entry.event === "complete") ? "complete" : fundEntries.length === 0 ? "not-started" : "incomplete-do-not-retry",
        returnStatus: returnEntries.findLast((entry) => entry.event === "complete") ? "complete" : returnEntries.length === 0 ? "not-started" : "incomplete-do-not-retry",
        deploymentManifestPresent,
      };
    } finally {
      await journal.close();
    }
  });
}

async function runSelfTest() {
  const signerSource = await readFile(KMS_SIGNER_FILE, "utf8");
  assert(signerSource.includes(`role: "${TREASURY_KMS_ROLE}"`), "KMS signer omits the fixed treasury role");
  assert(signerSource.includes(`address: "${TREASURY.toBase58()}"`), "KMS signer omits the fixed treasury address");
  assert(signerSource.includes(`kmsKeyVersion: "${TREASURY_KMS_RESOURCE}"`), "KMS signer omits the fixed treasury resource");

  const state = { contextSlot: 100, treasuryLamports: 20_000_000_000n, feePayerLamports: 1_000_000n };
  const input = {
    amountLamports: DEFAULT_AMOUNT_LAMPORTS,
    feePayer: FEE_PAYER,
    kmsSignerSha256: "22".repeat(32),
    rpcProviderOriginSha256: "33".repeat(32),
    rpcSelection: "state",
    state,
    toolSha256: "11".repeat(32),
    treasury: TREASURY,
  };
  const plan = buildPlan(input);
  assert.deepEqual(plan, buildPlan(input), "funding plan is nondeterministic");
  assert.equal(plan.amountLamports, "7700000000");
  assert.notEqual(plan.fundOperationId, plan.returnOperationId);
  validatePlan(plan);

  const fund = buildTransferTransaction({
    direction: "fund",
    amountLamports: DEFAULT_AMOUNT_LAMPORTS,
    blockhash: FEE_PAYER.toBase58(),
    lastValidBlockHeight: 200,
  });
  const returned = buildTransferTransaction({
    direction: "return",
    amountLamports: DEFAULT_AMOUNT_LAMPORTS,
    blockhash: TREASURY.toBase58(),
    lastValidBlockHeight: 201,
  });
  assert.equal(SystemInstruction.decodeTransfer(fund.instructions[0]).fromPubkey.toBase58(), TREASURY.toBase58());
  assert.equal(SystemInstruction.decodeTransfer(returned.instructions[0]).fromPubkey.toBase58(), FEE_PAYER.toBase58());
  assert.deepEqual(fund.compileMessage().accountKeys.slice(0, 2).map((key) => key.toBase58()), [FEE_PAYER.toBase58(), TREASURY.toBase58()]);
  assert.equal(returned.compileMessage().header.numRequiredSignatures, 1);

  let sends = 0;
  const fake = { async sendRawTransaction() { sends += 1; return "fake-signature"; } };
  assert.equal(await sendExactlyOnce(fake, Buffer.from([1]), { maxRetries: 0 }), "fake-signature");
  assert.equal(sends, 1);
  sends = 0;
  const failing = { async sendRawTransaction() { sends += 1; throw new Error("ambiguous"); } };
  await assert.rejects(sendExactlyOnce(failing, Buffer.from([1]), { maxRetries: 0 }), /ambiguous/u);
  assert.equal(sends, 1, "send helper retried an ambiguous submission");

  assert.throws(() => parseAmount("7700000001"), /maximum/u);
  assert.throws(() => parseArguments(["return", "--run-dir", "x"]), /requires --arm/u);
  assert.throws(() => parseArguments(["status", "--run-dir", "x", "--arm", "aa"]), /cannot be armed/u);
  return { passed: true, defaultAmountLamports: DEFAULT_AMOUNT_LAMPORTS.toString(), oneSendAttempt: true };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (options.command === "self-test") {
    process.stdout.write(`${JSON.stringify(await runSelfTest())}\n`);
    return;
  }
  let result;
  if (options.command === "plan") result = await planFunding(options);
  else if (options.command === "execute") result = await executeDirection(options, "fund");
  else if (options.command === "return") result = await executeDirection(options, "return");
  else result = await statusFunding(options);
  process.stdout.write(`${JSON.stringify({ status: options.command, result })}\n`);
}

const previousUmask = process.umask(0o077);
try {
  await main();
} finally {
  process.umask(previousUmask);
}
