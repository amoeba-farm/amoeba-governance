import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import bs58Module from "bs58";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  assertRunDirectoryBackoffElapsed,
  loadInjectedSignerProvider,
  signTransactionWithProvider,
} from "./devnet-ceremony-runtime.mjs";

import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

import {
  ARTIFACT_MERKLE_SCHEME_ID,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  artifactChunkCount,
  artifactMerkleProof,
  artifactMerkleRoot,
} from "../dist/upgradeGovernance/artifactMerkleV1.js";
import {
  CEREMONY_ACCOUNT_VERSION_V1,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN,
  CONTROLLER_RELEASE_COMMITMENT_V1_LEN,
  LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
  PROGRAMDATA_CAPACITY_POLICY_V1_LEN,
  PROGRAMDATA_OBSERVATION_V1_LEN,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  controllerImmutabilityReceiptDigestV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerImmutabilityReceiptPdaV1,
  deriveControllerReleaseCommitmentPdaV1,
  deriveProgramDataObservationPdaV1,
  deserializeControllerImmutabilityReceiptV1,
  deserializeControllerReleaseCommitmentV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  programDataObservationSubjectDigestV1,
  serializeControllerImmutabilityReceiptV1,
  validateControllerImmutabilityReceiptDigestV1,
  validateControllerReleaseDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import {
  buildAppendProgramDataObservationChunkV1Instruction,
  buildBeginProgramDataObservationV1Instruction,
  buildFinalizeProgramDataObservationV1Instruction,
  buildVerifyObservedArtifactChunkV1Instruction,
} from "../dist/upgradeGovernance/release1CeremonyInstructions.js";
import {
  buildRecordControllerImmutabilityV1Instruction,
} from "../dist/upgradeGovernance/release1AuthorityInstructions.js";
import {
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  programDataObservationGeometryV1,
  programDataObservationMerkleRootV1,
  programDataRawSha256ReceiptV1,
} from "../dist/upgradeGovernance/programDataObservationMerkleV1.js";
import {
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
  GateStatusV1,
} from "../dist/upgradeGovernance/release1.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  CONTROLLER_CONFIG_LEN,
  GOVERNANCE_COUNCIL_SET_LEN,
  GOVERNANCE_POLICY_LEN,
  PROTOCOL_GATE_LEN,
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deserializeProtocolGateV1,
} from "../dist/upgradeGovernance/v1.js";
import {
  deserializeControllerConfigV1,
  deserializeGovernanceCouncilSetFixedV1,
  deserializeGovernancePolicyFixedV1,
} from "../dist/upgradeGovernance/v1FixedAccounts.js";
import { clusterDomainFromGenesisHashV1 } from "../dist/upgradeGovernance/release1Planning.js";
import {
  ExclusiveOperatorLockV1,
  GovernanceJournalV1,
} from "../dist/upgradeGovernance/operator.js";

process.umask(0o077);

const bs58 = bs58Module.default ?? bs58Module;

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const CONTROLLER = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const TARGET = new PublicKey("9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH");
const TARGET_PROGRAMDATA = new PublicKey("2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3");
const LEGACY_TARGET_AUTHORITY = new PublicKey("D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq");
const PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const INITIALIZER = new PublicKey("7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ");
const TREASURY = new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j");
const GUARDIAN = new PublicKey("9DREu4USpbCHzLHD9whKHnRud8KDMhPswU4jZMbJP3ab");
const SEATS = [
  "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
  "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
  "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
  "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
  "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
].map((value) => new PublicKey(value));

const SOLANA = "/home/space/.local/share/solana/install/active_release/bin/solana";
const EXPECTED_SOLANA_VERSION = "solana-cli 4.0.0 (src:2a165e7a; feat:dda54cf7, client:Agave)";
const EXPECTED_ARTIFACT_SHA256 = "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
const EXPECTED_ARTIFACT_BYTES = 1_114_592;
const PLAN_TTL_SLOTS = 100_000;
const FINALIZED_STATUS_POLL_INTERVAL_MS = 30_000;
const MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS = 20;
const MINIMUM_CONTEXT_CATCH_UP_DELAY_MS = 2_000;
const MINIMUM_CONTEXT_CATCH_UP_READ_METHODS = new Set([
  "getAccountInfoAndContext",
  "getBlockHeight",
  "getGenesisHash",
  "getLatestBlockhashAndContext",
  "getMultipleAccountsInfoAndContext",
  "getSignatureStatuses",
  "getSlot",
  "getTransaction",
  "isBlockhashValid",
]);
const ROLLBACK_DELAY_SLOTS = 900n;
const ROUTINE_DELAY_SLOTS = 2_250n;
const MAJOR_DELAY_SLOTS = 4_500n;
const TERMINAL_DELAY_SLOTS = 9_000n;
const VOTE_REVIEW_SLOTS = 450n;
const PROPOSAL_EXPIRY_SLOTS = 432_000n;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const SOURCE_COMMIT = "9f3414315d53f70fe029c7f3480c9d45b8674da2";
const SOURCE_TREE = "854f20940fd701c2c5a9716b7a71dc174dd7c8c2";
const RAW_CHUNK_SIZE = PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1;
const ARTIFACT_CHUNK_SIZE = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
const PRE_GENERATION = 1n;
const POST_GENERATION = 2n;
const LOADER_SET_AUTHORITY_DATA = Buffer.from([4, 0, 0, 0]);
const ZERO_32 = Buffer.alloc(32);
const INITIALIZATION_PLAN_PATTERN = /^controller-initialize-plan-v3(?:-([0-9a-f]{64}))?\.json$/u;
const PRE_PLAN_PATTERN = /^controller-immutability-pre-observation-plan-v1(?:-([0-9a-f]{64}))?\.json$/u;
const AUTHORITY_PLAN_PATTERN = /^controller-immutability-authority-final-plan-v1(?:-([0-9a-f]{64}))?\.json$/u;
const POST_PLAN_PATTERN = /^controller-immutability-post-observation-plan-v1(?:-([0-9a-f]{64}))?\.json$/u;
const RECORD_PLAN_PATTERN = /^controller-immutability-record-plan-v1(?:-([0-9a-f]{64}))?\.json$/u;
const PRE_PLAN_ENV = "AMEBA_CONTROLLER_IMMUTABILITY_PRE_PLAN";
const AUTHORITY_PLAN_ENV = "AMEBA_CONTROLLER_IMMUTABILITY_AUTHORITY_FINAL_PLAN";
const POST_PLAN_ENV = "AMEBA_CONTROLLER_IMMUTABILITY_POST_PLAN";
const RECORD_PLAN_ENV = "AMEBA_CONTROLLER_IMMUTABILITY_RECORD_PLAN";

let activeExecutionRpc = null;
let passivePlanningRpc = null;

const FILES = Object.freeze({
  prePlan: "controller-immutability-pre-observation-plan-v1.json",
  preReceipt: "controller-immutability-pre-observation-receipt-v1.json",
  authorityPlan: "controller-immutability-authority-final-plan-v1.json",
  authorityReceipt: "controller-immutability-authority-final-receipt-v1.json",
  postPlan: "controller-immutability-post-observation-plan-v1.json",
  postReceipt: "controller-immutability-post-observation-receipt-v1.json",
  recordPlan: "controller-immutability-record-plan-v1.json",
  recordReceipt: "controller-immutability-record-receipt-v1.json",
  initializationPlan: "controller-initialize-plan-v3.json",
  initializationReceipt: "controller-initialize-receipt-v3.json",
  journal: "controller-immutability-journal-v1.jsonl",
  lock: "release1-devnet-rpc-owner.lock",
});

const PLAN_SPECS = Object.freeze({
  pre: Object.freeze({
    canonicalFile: FILES.prePlan,
    environmentName: PRE_PLAN_ENV,
    pattern: PRE_PLAN_PATTERN,
    receiptFile: FILES.preReceipt,
    schema: "ameba-governance-devnet-controller-immutability-pre-observation-plan-v1",
  }),
  authority: Object.freeze({
    canonicalFile: FILES.authorityPlan,
    environmentName: AUTHORITY_PLAN_ENV,
    pattern: AUTHORITY_PLAN_PATTERN,
    receiptFile: FILES.authorityReceipt,
    schema: "ameba-governance-devnet-controller-immutability-authority-final-plan-v1",
  }),
  post: Object.freeze({
    canonicalFile: FILES.postPlan,
    environmentName: POST_PLAN_ENV,
    pattern: POST_PLAN_PATTERN,
    receiptFile: FILES.postReceipt,
    schema: "ameba-governance-devnet-controller-immutability-post-observation-plan-v1",
  }),
  record: Object.freeze({
    canonicalFile: FILES.recordPlan,
    environmentName: RECORD_PLAN_ENV,
    pattern: RECORD_PLAN_PATTERN,
    receiptFile: FILES.recordReceipt,
    schema: "ameba-governance-devnet-controller-immutability-record-plan-v1",
  }),
});

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment ${name}`);
  return value;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest();
}

function sha256Hex(bytes) {
  return sha256Bytes(bytes).toString("hex");
}

function stableJson(value) {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function operationId(material) {
  return sha256Hex(Buffer.from(stableJson(material), "utf8"));
}

function initializationOperationId(material) {
  return sha256Hex(Buffer.from(JSON.stringify(material), "utf8"));
}

function finalizedReadConfig(value) {
  const config = { commitment: "finalized" };
  if (value.minContextSlot > 0) config.minContextSlot = value.minContextSlot;
  return config;
}

function advanceMinContextSlot(value, slot, label) {
  assert(Number.isSafeInteger(slot) && slot > 0, `${label} returned an invalid context slot`);
  assert(slot >= value.minContextSlot, `${label} predates the monotonic minimum context slot`);
  value.minContextSlot = slot;
  return slot;
}

function assertJournalBackoffElapsed(journal) {
  const latest = [...journal.recover()].reverse().find((entry) => entry.event === "rpc-rate-limit-exit");
  if (!latest) return;
  const retryNotBefore = latest.payload?.retryNotBefore;
  assert(typeof retryNotBefore === "string" && Number.isFinite(Date.parse(retryNotBefore)), "journaled RPC retry-not-before is malformed");
  const remaining = Date.parse(retryNotBefore) - Date.now();
  if (remaining > 0) {
    throw new Error(`RPC backoff remains active for ${remaining} ms; retry only after the journaled retry-not-before`);
  }
}

function rpcProviderOriginSha256(origin) {
  return sha256Hex(Buffer.concat([
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ]));
}

function fileInRunDir(runDir, name) {
  const resolved = path.resolve(runDir, name);
  assert.equal(path.dirname(resolved), path.resolve(runDir), `${name} escaped the ceremony run directory`);
  return resolved;
}

async function writeExclusiveJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(file, 0o600);
}

async function writeReceiptOnce(file, value) {
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(existing, value, `existing receipt ${path.basename(file)} differs`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeExclusiveJson(file, value);
  }
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readExactPlan(runDir, fileInput, spec, label) {
  const file = path.resolve(fileInput);
  assert.equal(path.dirname(file), path.resolve(runDir), `${label} must be directly inside the ceremony run directory`);
  const secureFile = await requireSecureRegularFile(file, label);
  const match = spec.pattern.exec(path.basename(secureFile));
  assert(match, `${label} filename is invalid`);
  const raw = await readFile(secureFile);
  const plan = JSON.parse(raw.toString("utf8"));
  assert.equal(plan.schema, spec.schema, `${label} schema changed`);
  const { operationId: stored, ...material } = plan;
  assert.equal(operationId(material), stored, `${label} operation ID changed`);
  if (match[1] !== undefined) assert.equal(match[1], stored, `${label} filename operation ID changed`);
  assert(raw.equals(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8")), `${label} is not canonical JSON`);
  return { file: secureFile, plan, raw };
}

async function readSelectedPlan(runDir, spec, label) {
  const configured = process.env[spec.environmentName]?.trim();
  const file = configured ? path.resolve(configured) : fileInRunDir(runDir, spec.canonicalFile);
  return readExactPlan(runDir, file, spec, label);
}

function assertJournalEntriesAllowReplan(allEntries, priorPlan) {
  const entries = allEntries.filter((entry) => entry.operationId === priorPlan.operationId);
  const finalized = entries.filter((entry) => [
    "transaction-finalized",
    "transaction-reconciled-finalized",
  ].includes(entry.event));
  assert.equal(finalized.length, 0, "refusing to replan after the prior immutability plan finalized a transaction");
  const prepared = entries.filter((entry) => entry.event === "transaction-prepared");
  for (const entry of prepared) {
    const terminal = entries.find((candidate) => candidate.event === "transaction-expired-not-landed"
      && candidate.payload.stage === entry.payload.stage
      && candidate.payload.signature === entry.payload.signature);
    assert(terminal, `refusing to replan with unresolved prepared signature ${entry.payload.signature}`);
  }
}

async function assertPriorPlanAllowsReplan(runDir, priorPlan) {
  const journalFile = fileInRunDir(runDir, FILES.journal);
  if (!(await pathExists(journalFile))) return;
  assertJournalEntriesAllowReplan(new GovernanceJournalV1(journalFile).recover(), priorPlan);
}

function suffixedPlanBasename(spec, operationIdValue) {
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "immutability replan operation ID is invalid");
  const stem = spec.canonicalFile.slice(0, -".json".length);
  const basename = `${stem}-${operationIdValue}.json`;
  const match = spec.pattern.exec(basename);
  assert(match && match[1] === operationIdValue, "immutability replan filename binding changed");
  return basename;
}

async function writeNonOverwritingPlan(runDir, spec, plan, label) {
  assert(Number.isSafeInteger(plan.observedSlot) && plan.observedSlot > 0, `${label} observed slot is invalid`);
  assert(Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot >= plan.observedSlot, `${label} validity slot is invalid`);
  assert(!(await pathExists(fileInRunDir(runDir, spec.receiptFile))), `refusing to replan after ${spec.receiptFile} exists`);
  const existingNames = (await readdir(runDir)).filter((name) => spec.pattern.test(name)).sort();
  const expectedRaw = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  if (existingNames.length === 0) {
    const file = fileInRunDir(runDir, spec.canonicalFile);
    await writeExclusiveJson(file, plan);
    return file;
  }
  let identicalFile = null;
  for (const name of existingNames) {
    const prior = await readExactPlan(runDir, fileInRunDir(runDir, name), spec, `prior ${label}`);
    if (prior.raw.equals(expectedRaw)) {
      assert.equal(identicalFile, null, `duplicate identical ${label} files exist`);
      identicalFile = prior.file;
      continue;
    }
    assert(plan.observedSlot > prior.plan.planValidUntilSlot, `refusing to replan while ${name} remains valid`);
    await assertPriorPlanAllowsReplan(runDir, prior.plan);
  }
  if (identicalFile !== null) return identicalFile;
  const file = fileInRunDir(runDir, suffixedPlanBasename(spec, plan.operationId));
  if (await pathExists(file)) {
    const existing = await readExactPlan(runDir, file, spec, `existing ${label} replan`);
    assert(existing.raw.equals(expectedRaw), `existing ${label} replan differs`);
    return file;
  }
  await writeExclusiveJson(file, plan);
  return file;
}

async function readSecureJson(runDir, name, label) {
  const file = await requireSecureRegularFile(fileInRunDir(runDir, name), label);
  const bytes = await readFile(file);
  const value = JSON.parse(bytes.toString("utf8"));
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} is malformed`);
  return { bytes, value };
}

function assertSha256(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} is not a lowercase SHA-256`);
}

function assertInitializationPlan(plan, ids, artifact) {
  assert.equal(plan.schema, "ameba-governance-devnet-controller-initialize-plan-v3", "initialization plan schema changed");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(initializationOperationId(material), storedOperationId, "initialization plan operation ID changed");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS, "initialization plan genesis changed");
  assert.equal(plan.mainnetAllowed, false, "initialization plan permits Mainnet");
  assert.equal(plan.controllerProgram, CONTROLLER.toBase58(), "initialization plan controller changed");
  assert.equal(plan.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58(), "initialization plan Controller ProgramData changed");
  assert.equal(plan.targetProgram, TARGET.toBase58(), "initialization plan target changed");
  assert.equal(plan.targetProgramdata, TARGET_PROGRAMDATA.toBase58(), "initialization plan target ProgramData changed");
  assert.equal(plan.upgradeableLoader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "initialization plan Loader changed");
  assert.equal(plan.payer, PAYER.toBase58(), "initialization plan payer changed");
  assert.equal(plan.initializer, INITIALIZER.toBase58(), "initialization plan initializer changed");
  assert.equal(plan.canonicalSpillTreasury, TREASURY.toBase58(), "initialization plan treasury changed");
  assert.equal(plan.guardian, GUARDIAN.toBase58(), "initialization plan guardian changed");
  assert.deepEqual(plan.seats, SEATS.map((seat) => seat.toBase58()), "initialization plan council seats changed");
  assert.equal(plan.controllerConfig, ids.config.toBase58(), "initialization plan config changed");
  assert.equal(plan.authorityPda, ids.authority.toBase58(), "initialization plan authority PDA changed");
  assert.equal(plan.protocolGate, ids.gate.toBase58(), "initialization plan gate changed");
  assert.equal(plan.policy, ids.policy.toBase58(), "initialization plan policy changed");
  assert.equal(plan.council, ids.council.toBase58(), "initialization plan council changed");
  assert.equal(plan.capacityPolicy, ids.capacityPolicy.toBase58(), "initialization plan capacity policy changed");
  assert.equal(plan.controllerRelease, ids.controllerRelease.toBase58(), "initialization plan release commitment changed");
  assert.equal(plan.initialPolicyVersion, "1", "initialization plan policy version changed");
  assert.equal(plan.initialCouncilVersion, "1", "initialization plan council version changed");
  assert.equal(plan.nextProposalId, "1", "initialization plan next proposal ID changed");
  assert.equal(plan.targetNonce, "1", "initialization plan target nonce changed");
  assert.equal(plan.initialGateEpoch, "1", "initialization plan gate epoch changed");
  assert.equal(plan.policyActivationSlot, String(plan.observedSlot), "initialization plan activation slot changed");
  assert.deepEqual(plan.timing, {
    rollbackDelaySlots: ROLLBACK_DELAY_SLOTS.toString(),
    routineDelaySlots: ROUTINE_DELAY_SLOTS.toString(),
    majorDelaySlots: MAJOR_DELAY_SLOTS.toString(),
    terminalDelaySlots: TERMINAL_DELAY_SLOTS.toString(),
    voteReviewSlots: VOTE_REVIEW_SLOTS.toString(),
    proposalExpirySlots: PROPOSAL_EXPIRY_SLOTS.toString(),
  }, "initialization plan timing changed");
  assert.equal(plan.controllerArtifact.bytes, EXPECTED_ARTIFACT_BYTES, "initialization plan artifact length changed");
  assert.equal(plan.controllerArtifact.sha256, EXPECTED_ARTIFACT_SHA256, "initialization plan artifact SHA-256 changed");
  assert.equal(plan.controllerArtifact.merkleRoot, artifactMerkleRoot(artifact).toString("hex"), "initialization plan artifact root changed");
  assert.equal(plan.controllerArtifact.chunkSize, ARTIFACT_CHUNK_SIZE, "initialization plan artifact chunk size changed");
  assert.equal(plan.controllerSource.commit, SOURCE_COMMIT, "initialization plan source commit changed");
  assert.equal(plan.controllerSource.tree, SOURCE_TREE, "initialization plan source tree changed");
  for (const field of ["policyHash", "councilHash", "capacityPolicyDigest", "controllerReleaseDigest", "deploymentManifestSha256", "planningMessageSha256"]) {
    assertSha256(plan[field], `initialization plan ${field}`);
  }
  assert(Number.isSafeInteger(plan.observedSlot) && plan.observedSlot > 0, "initialization plan observation slot is invalid");
  assert(Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot >= plan.observedSlot, "initialization plan validity is invalid");
  assert(Number.isSafeInteger(plan.packetBytes) && plan.packetBytes > 0 && plan.packetBytes <= 1_232, "initialization plan packet size is invalid");
  assert(Array.isArray(plan.instructions) && plan.instructions.length === 3, "initialization plan instruction envelope changed");
}

function assertInitializationReceipt(receipt, plan, ids) {
  assert.equal(receipt.schema, "ameba-governance-devnet-controller-initialize-receipt-v3", "initialization receipt schema changed");
  assert.equal(receipt.operationId, plan.operationId, "initialization receipt operation changed");
  assert(typeof receipt.planFile === "string" && INITIALIZATION_PLAN_PATTERN.test(receipt.planFile), "initialization receipt plan filename changed");
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")), "initialization receipt plan hash changed");
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS, "initialization receipt genesis changed");
  assert.equal(receipt.controllerProgram, CONTROLLER.toBase58(), "initialization receipt controller changed");
  assert.equal(receipt.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58(), "initialization receipt Controller ProgramData changed");
  assert.equal(receipt.targetProgram, TARGET.toBase58(), "initialization receipt target changed");
  assert.equal(receipt.targetProgramdata, TARGET_PROGRAMDATA.toBase58(), "initialization receipt target ProgramData changed");
  assert.equal(receipt.payer, PAYER.toBase58(), "initialization receipt payer changed");
  assert.equal(receipt.initializer, INITIALIZER.toBase58(), "initialization receipt initializer changed");
  assert.equal(receipt.gateStatus, GateStatusV1.EmergencyFrozen, "initialization receipt gate status changed");
  assert.equal(receipt.gateEpoch, "1", "initialization receipt gate epoch changed");
  assert.equal(receipt.freezeReasonCode, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1, "initialization receipt freeze reason changed");
  assert.equal(receipt.tokenGovernanceEnabled, false, "initialization receipt enabled token governance");
  assert.equal(receipt.targetNonce, "1", "initialization receipt target nonce changed");
  assert.equal(receipt.policyHash, plan.policyHash, "initialization receipt policy hash changed");
  assert.equal(receipt.councilHash, plan.councilHash, "initialization receipt council hash changed");
  assert.equal(receipt.capacityPolicyDigest, plan.capacityPolicyDigest, "initialization receipt capacity digest changed");
  assert.equal(receipt.controllerReleaseDigest, plan.controllerReleaseDigest, "initialization receipt release digest changed");
  assert(Number.isSafeInteger(receipt.slot) && receipt.slot > 0, "initialization receipt finalized transaction slot is invalid");
  assert(Number.isSafeInteger(receipt.finalizedObservationSlot) && receipt.finalizedObservationSlot >= receipt.slot, "initialization receipt observation predates its transaction");
  assert(typeof receipt.signature === "string" && receipt.signature.length > 0, "initialization receipt signature is absent");
  assertSha256(receipt.messageSha256, "initialization receipt message SHA-256");
  const expectedAccounts = [ids.config, ids.gate, ids.policy, ids.council, ids.capacityPolicy, ids.controllerRelease].map((address) => address.toBase58()).sort();
  assert(receipt.accountRawSha256 && typeof receipt.accountRawSha256 === "object" && !Array.isArray(receipt.accountRawSha256), "initialization receipt account hash map is absent");
  assert.deepEqual(Object.keys(receipt.accountRawSha256).sort(), expectedAccounts, "initialization receipt account hash inventory changed");
  for (const address of expectedAccounts) assertSha256(receipt.accountRawSha256[address], `initialization receipt account hash ${address}`);
}

async function loadInitializationAttestation(runDir, artifact) {
  const ids = identities();
  const receiptFile = await readSecureJson(runDir, FILES.initializationReceipt, "controller initialization receipt");
  assert(
    typeof receiptFile.value.planFile === "string" && INITIALIZATION_PLAN_PATTERN.test(receiptFile.value.planFile),
    "controller initialization receipt plan filename changed",
  );
  const planFile = await readSecureJson(runDir, receiptFile.value.planFile, "controller initialization plan");
  const planName = INITIALIZATION_PLAN_PATTERN.exec(receiptFile.value.planFile);
  assert(planName, "controller initialization plan filename is invalid");
  assertInitializationPlan(planFile.value, ids, artifact);
  if (planName[1] !== undefined) assert.equal(planName[1], planFile.value.operationId, "controller initialization replan filename operation ID changed");
  assertInitializationReceipt(receiptFile.value, planFile.value, ids);
  return {
    plan: planFile.value,
    receipt: receiptFile.value,
    snapshot: {
      planOperationId: planFile.value.operationId,
      planFileSha256: sha256Hex(planFile.bytes),
      receiptFileSha256: sha256Hex(receiptFile.bytes),
      finalizedSignature: receiptFile.value.signature,
      finalizedMessageSha256: receiptFile.value.messageSha256,
      finalizedTransactionSlot: receiptFile.value.slot,
      finalizedObservationSlot: receiptFile.value.finalizedObservationSlot,
      policyHash: planFile.value.policyHash,
      councilHash: planFile.value.councilHash,
      capacityPolicyDigest: planFile.value.capacityPolicyDigest,
      controllerReleaseDigest: planFile.value.controllerReleaseDigest,
      deploymentManifestSha256: planFile.value.deploymentManifestSha256,
      accountRawSha256: { ...receiptFile.value.accountRawSha256 },
    },
  };
}

function armValue(command, operationIdValue, actionPlanSha256) {
  assertSha256(actionPlanSha256, "action-plan SHA-256");
  return `${command}:${operationIdValue}:${actionPlanSha256}`;
}

function requireArm(command, plan) {
  assert.equal(
    requiredEnvironment("AMEBA_CONTROLLER_IMMUTABILITY_ARM"),
    armValue(command, plan.operationId, plan.actionPlanSha256),
    `${command} is not explicitly armed`,
  );
}

function sanitizedChildEnvironment() {
  return {
    LANG: process.env.LANG ?? "C.UTF-8",
    PATH: "/home/space/.cargo/bin:/home/space/.local/share/solana/install/active_release/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  };
}

function solanaVersion() {
  const result = spawnSync(SOLANA, ["--version"], {
    encoding: "utf8",
    env: sanitizedChildEnvironment(),
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, "pinned Solana CLI version probe failed");
  assert.equal(result.stdout.trim(), EXPECTED_SOLANA_VERSION, "Solana CLI version changed");
  return result.stdout.trim();
}

async function loadArtifact(fileInput) {
  const file = path.resolve(fileInput);
  const handle = await open(file, "r");
  try {
    const status = await handle.stat();
    assert(status.isFile(), "controller artifact must be a regular file");
    const artifact = await handle.readFile();
    assert.equal(artifact.length, EXPECTED_ARTIFACT_BYTES, "controller artifact length changed");
    assert.equal(sha256Hex(artifact), EXPECTED_ARTIFACT_SHA256, "controller artifact SHA-256 changed");
    return { artifact, file };
  } finally {
    await handle.close();
  }
}

function assertStateRpcSelection(selection) {
  assert.equal(selection, "state", "controller immutability requires the exact Devnet state RPC selection");
}

async function inputs() {
  const { rpcSelection, stateRpcOrigin, stateRpcUrl } = await loadDevnetRpcConfiguration();
  assertStateRpcSelection(rpcSelection);
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const { artifact, file: artifactPath } = await loadArtifact(requiredEnvironment("AMEBA_CONTROLLER_ARTIFACT"));
  const initializationAttestation = await loadInitializationAttestation(runDir, artifact);
  const connection = new Connection(stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 120_000,
    disableRetryOnRateLimit: true,
  });
  const value = {
    artifact,
    artifactPath,
    connection,
    initializationAttestation,
    initializationTransactionVerified: false,
    minContextSlot: 0,
    rpcSelection,
    rpcProviderOriginSha256: rpcProviderOriginSha256(stateRpcOrigin),
    runDir,
    stateRpcUrl,
  };
  return value;
}

function planningOperationId(value, command) {
  return operationId({
    schema: "ameba-governance-devnet-controller-immutability-planning-lock-v1",
    command,
    genesisHash: EXPECTED_GENESIS,
    controllerProgram: CONTROLLER.toBase58(),
    targetProgram: TARGET.toBase58(),
    artifactSha256: EXPECTED_ARTIFACT_SHA256,
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
  });
}

async function withPlanningLock(value, command, callback) {
  const operationIdValue = planningOperationId(value, command);
  const lock = new ExclusiveOperatorLockV1(fileInRunDir(value.runDir, FILES.lock));
  const journal = new GovernanceJournalV1(fileInRunDir(value.runDir, FILES.journal));
  lock.acquire(operationIdValue);
  assert.equal(passivePlanningRpc, null, "nested planning RPC context is forbidden");
  passivePlanningRpc = { journal, operationId: operationIdValue };
  try {
    await assertRunDirectoryBackoffElapsed(value.runDir);
    assertJournalBackoffElapsed(journal);
    journal.append(operationIdValue, "planning-started", { command });
    assert.equal(
      await executionAwareRpc("getGenesisHash", "genesis", () => value.connection.getGenesisHash()),
      EXPECTED_GENESIS,
      "state RPC genesis changed",
    );
    const result = await callback();
    journal.append(operationIdValue, "planning-completed", { command });
    return result;
  } catch (error) {
    journal.append(operationIdValue, "planning-stopped", {
      command,
      errorName: error?.name ?? "Error",
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw error;
  } finally {
    passivePlanningRpc = null;
    lock.release();
  }
}

function identities() {
  const [config, configBump] = deriveControllerConfigPda(CONTROLLER, TARGET);
  const [authority, authorityBump] = deriveAuthorityPda(CONTROLLER, TARGET);
  const [gate, gateBump] = deriveGatePda(CONTROLLER, TARGET);
  const [policy, policyBump] = derivePolicyPda(CONTROLLER, TARGET, 1n);
  const [council, councilBump] = deriveCouncilPda(CONTROLLER, TARGET, 1n);
  const [capacityPolicy, capacityPolicyBump] = deriveCapacityPolicyPdaV1(CONTROLLER, TARGET);
  const [controllerRelease, controllerReleaseBump] = deriveControllerReleaseCommitmentPdaV1(CONTROLLER, TARGET);
  const [immutabilityReceipt, immutabilityReceiptBump] = deriveControllerImmutabilityReceiptPdaV1(CONTROLLER, TARGET);
  return {
    authority,
    authorityBump,
    capacityPolicy,
    capacityPolicyBump,
    config,
    configBump,
    council,
    councilBump,
    controllerRelease,
    controllerReleaseBump,
    gate,
    gateBump,
    immutabilityReceipt,
    immutabilityReceiptBump,
    policy,
    policyBump,
  };
}

function assertAccount(account, owner, bytes, label, executable = false) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(owner), `${label} owner changed`);
  assert.equal(account.data.length, bytes, `${label} length changed`);
  assert.equal(account.executable, executable, `${label} executable state changed`);
  return account;
}

function accountFingerprint(account) {
  assert(account, "cannot fingerprint an absent account");
  return {
    owner: account.owner.toBase58(),
    executable: account.executable,
    lamports: account.lamports,
    rentEpoch: String(account.rentEpoch),
    dataBytes: account.data.length,
    dataSha256: sha256Hex(account.data),
  };
}

function optionalAuthority(present, value = PublicKey.default) {
  return { present, value };
}

function parseProgramdata(account, label) {
  assert(account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} owner changed`);
  assert(!account.executable, `${label} must not be executable`);
  assert(account.data.length >= Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1), `${label} is truncated`);
  assert.equal(account.data.readUInt32LE(0), 3, `${label} Loader tag changed`);
  const authorityTag = account.data[12];
  assert(authorityTag === 0 || authorityTag === 1, `${label} authority option is noncanonical`);
  return {
    deployedSlot: account.data.readBigUInt64LE(4),
    authority: authorityTag === 1
      ? optionalAuthority(true, new PublicKey(account.data.subarray(13, 45)))
      : optionalAuthority(false),
    header: Buffer.from(account.data.subarray(0, 45)),
    payload: Buffer.from(account.data.subarray(45)),
    raw: Buffer.from(account.data),
  };
}

function assertProgram(program, expectedProgramdata, label) {
  assertAccount(program, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, 36, label, true);
  assert.equal(program.data.readUInt32LE(0), 2, `${label} Loader tag changed`);
  assert(new PublicKey(program.data.subarray(4, 36)).equals(expectedProgramdata), `${label} ProgramData linkage changed`);
}

async function executionAwareRpc(method, stage, callback) {
  assert(MINIMUM_CONTEXT_CATCH_UP_READ_METHODS.has(method), `${stage} is not an admitted read RPC method`);
  const rpcContext = activeExecutionRpc ?? passivePlanningRpc;
  if (rpcContext === null) return callback();
  return rpcExecution(
    rpcContext.journal,
    rpcContext.operationId,
    stage,
    method,
    callback,
  );
}

async function ensureInitializationTransaction(value) {
  if (value.initializationTransactionVerified) return;
  const receipt = value.initializationAttestation.receipt;
  const landed = await executionAwareRpc(
    "getTransaction",
    "finalized-read:initialization-transaction",
    () => finalizedTransaction(value, receipt.signature, receipt.messageSha256, receipt.slot),
  );
  assert(landed, "controller initialization transaction is not finalized and retrievable");
  assert.equal(landed.slot, receipt.slot, "controller initialization transaction slot changed");
  value.initializationTransactionVerified = true;
}

function assertInitializationState(value, ids, accounts, config, gate, policy, council, capacity, release) {
  const { plan, receipt } = value.initializationAttestation;
  const accountEntries = [
    [ids.config, accounts.config],
    [ids.gate, accounts.gate],
    [ids.policy, accounts.policy],
    [ids.council, accounts.council],
    [ids.capacityPolicy, accounts.capacity],
    [ids.controllerRelease, accounts.release],
  ];
  for (const [address, account] of accountEntries) {
    assert.equal(
      sha256Hex(account.data),
      receipt.accountRawSha256[address.toBase58()],
      `initialized account ${address.toBase58()} bytes differ from the initialization receipt`,
    );
  }

  assert(config.clusterDomain.equals(clusterDomainFromGenesisHashV1(EXPECTED_GENESIS)), "controller config cluster domain changed");
  assert(config.authorityPda.equals(ids.authority), "controller config authority PDA changed");
  assert(config.canonicalSpillTreasury.equals(TREASURY), "controller config treasury changed");
  assert(config.guardian.equals(GUARDIAN), "controller config guardian changed");
  assert.equal(config.currentPolicyVersion, 1n, "controller config policy version changed");
  assert.equal(config.currentCouncilVersion, 1n, "controller config council version changed");
  assert.equal(config.nextProposalId, 1n, "controller config next proposal ID changed before immutability");
  assert.equal(config.targetNonce, 1n, "controller config target nonce changed before immutability");
  assert.equal(config.tokenGovernanceEnabled, false, "controller config enabled token governance");
  assert.equal(config.rollbackDelaySlots, ROLLBACK_DELAY_SLOTS, "controller rollback delay changed");
  assert.equal(config.routineDelaySlots, ROUTINE_DELAY_SLOTS, "controller routine delay changed");
  assert.equal(config.majorDelaySlots, MAJOR_DELAY_SLOTS, "controller major delay changed");
  assert.equal(config.terminalDelaySlots, TERMINAL_DELAY_SLOTS, "controller terminal delay changed");
  assert.equal(config.voteReviewSlots, VOTE_REVIEW_SLOTS, "controller review delay changed");
  assert.equal(config.proposalExpirySlots, PROPOSAL_EXPIRY_SLOTS, "controller proposal expiry changed");
  assert.equal(config.policyFlags, 0n, "controller config flags changed");

  assert(policy.controllerConfig.equals(ids.config), "governance policy config changed");
  assert.equal(policy.bump, ids.policyBump, "governance policy bump changed");
  assert(policy.targetProgram.equals(TARGET), "governance policy target changed");
  assert.equal(policy.version, 1n, "governance policy version changed");
  assert.equal(policy.activationSlot, BigInt(plan.policyActivationSlot), "governance policy activation slot changed");
  assert.equal(policy.policyHash.toString("hex"), plan.policyHash, "governance policy hash changed");
  assert.equal(policy.councilSize, 5, "governance policy council size changed");
  assert.equal(policy.routineThreshold, 3, "governance policy routine threshold changed");
  assert.equal(policy.terminalThreshold, 4, "governance policy terminal threshold changed");

  assert(council.controllerConfig.equals(ids.config), "governance council config changed");
  assert.equal(council.bump, ids.councilBump, "governance council bump changed");
  assert(council.targetProgram.equals(TARGET), "governance council target changed");
  assert.equal(council.version, 1n, "governance council version changed");
  assert.equal(council.activationSlot, BigInt(plan.policyActivationSlot), "governance council activation slot changed");
  assert.equal(council.deactivationSlot, 0n, "governance council is deactivated");
  assert.equal(council.setHash.toString("hex"), plan.councilHash, "governance council hash changed");
  assert.deepEqual(council.seats.map((seat) => seat.seatAuthority.toBase58()), SEATS.map((seat) => seat.toBase58()), "governance council seat authorities changed");
  for (const seat of council.seats) {
    assert.equal(seat.active, true, "governance council contains an inactive seat");
    assert.equal(seat.termStartSlot, BigInt(plan.policyActivationSlot), "governance council seat start changed");
    assert.equal(seat.termEndSlot, U64_MAX, "governance council seat end changed");
  }

  assert.equal(gate.epoch, 1n, "bootstrap gate epoch changed before immutability");
  assert.equal(gate.freezeSlot, BigInt(receipt.freezeSlot), "bootstrap gate freeze slot changed");
  assert(gate.lastCompletedProposal.equals(PublicKey.default), "bootstrap gate has a completed proposal");
  assert.equal(capacity.creationSlot, BigInt(receipt.slot), "capacity policy creation slot changed");
  assert.equal(release.creationSlot, BigInt(receipt.slot), "controller release creation slot changed");
  assert.equal(capacity.policyDigest.toString("hex"), plan.capacityPolicyDigest, "capacity policy digest differs from initialization");
  assert.equal(release.releaseDigest.toString("hex"), plan.controllerReleaseDigest, "controller release digest differs from initialization");
}

async function readBaseState(value) {
  await ensureInitializationTransaction(value);
  const ids = identities();
  const addresses = [
    CONTROLLER,
    CONTROLLER_PROGRAMDATA,
    TARGET,
    TARGET_PROGRAMDATA,
    ids.config,
    ids.gate,
    ids.policy,
    ids.council,
    ids.capacityPolicy,
    ids.controllerRelease,
    ids.authority,
  ];
  const response = await executionAwareRpc(
    "getMultipleAccountsInfoAndContext",
    "finalized-read:base-state",
    () => value.connection.getMultipleAccountsInfoAndContext(addresses, finalizedReadConfig(value)),
  );
  advanceMinContextSlot(value, response.context.slot, "base-state read");
  const [controller, controllerProgramdataAccount, target, targetProgramdataAccount, configAccount, gateAccount, policyAccount, councilAccount, capacityAccount, releaseAccount, authorityAccount] = response.value;

  assertProgram(controller, CONTROLLER_PROGRAMDATA, "controller Program");
  assertProgram(target, TARGET_PROGRAMDATA, "target Program");
  const controllerProgramdata = parseProgramdata(controllerProgramdataAccount, "controller ProgramData");
  const targetProgramdata = parseProgramdata(targetProgramdataAccount, "target ProgramData");
  assert(BigInt(response.context.slot) > controllerProgramdata.deployedSlot, "controller deployment is not yet in the finalized past");
  assert(targetProgramdata.authority.present && targetProgramdata.authority.value.equals(LEGACY_TARGET_AUTHORITY), "target ProgramData authority changed");
  assert(controllerProgramdata.payload.equals(value.artifact), "controller ProgramData payload differs from the exact artifact");
  assert.equal(controllerProgramdata.payload.length, EXPECTED_ARTIFACT_BYTES, "controller ProgramData capacity is not exact");

  assertAccount(configAccount, CONTROLLER, CONTROLLER_CONFIG_LEN, "controller config");
  assertAccount(gateAccount, CONTROLLER, PROTOCOL_GATE_LEN, "protocol gate");
  assertAccount(policyAccount, CONTROLLER, GOVERNANCE_POLICY_LEN, "governance policy");
  assertAccount(councilAccount, CONTROLLER, GOVERNANCE_COUNCIL_SET_LEN, "governance council");
  assertAccount(capacityAccount, CONTROLLER, PROGRAMDATA_CAPACITY_POLICY_V1_LEN, "capacity policy");
  assertAccount(releaseAccount, CONTROLLER, CONTROLLER_RELEASE_COMMITMENT_V1_LEN, "controller release");
  const config = deserializeControllerConfigV1(configAccount.data);
  const gate = deserializeProtocolGateV1(gateAccount.data);
  const policy = deserializeGovernancePolicyFixedV1(policyAccount.data);
  const council = deserializeGovernanceCouncilSetFixedV1(councilAccount.data);
  const capacity = deserializeProgramDataCapacityPolicyV1(capacityAccount.data);
  const release = deserializeControllerReleaseCommitmentV1(releaseAccount.data);
  validateProgramDataCapacityPolicyDigestV1(capacity);
  validateControllerReleaseDigestV1(release);

  assert(config.targetProgram.equals(TARGET) && config.targetProgramdata.equals(TARGET_PROGRAMDATA), "controller config target graph changed");
  assert(config.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "controller config Loader changed");
  assert(config.gatePda.equals(ids.gate), "controller config gate changed");
  assert.equal(config.bump, ids.configBump, "controller config bump changed");
  assert.equal(gate.bump, ids.gateBump, "protocol gate bump changed");
  assert(gate.controllerConfig.equals(ids.config), "protocol gate config changed");
  assert(gate.targetProgram.equals(TARGET) && gate.targetProgramdata.equals(TARGET_PROGRAMDATA), "protocol gate target graph changed");
  assert.equal(gate.status, GateStatusV1.EmergencyFrozen, "bootstrap gate is not EmergencyFrozen");
  assert(gate.activeProposal.equals(PublicKey.default), "bootstrap gate has an active proposal");
  assert(gate.epoch > 0n && gate.freezeSlot > 0n, "bootstrap gate epoch/freeze slot is incomplete");
  assert.equal(gate.freezeReasonCode, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1, "bootstrap freeze reason changed");

  assert.equal(capacity.bump, ids.capacityPolicyBump, "capacity policy bump changed");
  assert(capacity.controllerProgram.equals(CONTROLLER), "capacity policy controller changed");
  assert(capacity.controllerConfig.equals(ids.config), "capacity policy config changed");
  assert(capacity.targetProgram.equals(TARGET) && capacity.targetProgramdata.equals(TARGET_PROGRAMDATA), "capacity policy target graph changed");
  assert(capacity.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "capacity policy Loader changed");
  assert.equal(capacity.observationChunkSize, RAW_CHUNK_SIZE, "capacity policy does not pin exact 16 KiB raw chunks");
  assert.equal(capacity.artifactChunkSize, ARTIFACT_CHUNK_SIZE, "capacity policy does not pin exact 16 KiB artifact chunks");
  assert(capacity.observationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1), "capacity policy observation scheme changed");
  assert(capacity.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "capacity policy artifact scheme changed");
  assert.equal(capacity.zeroTailRequired, true, "capacity policy zero-tail rule changed");

  assert.equal(release.bump, ids.controllerReleaseBump, "controller release bump changed");
  assert(release.controllerProgram.equals(CONTROLLER) && release.controllerProgramdata.equals(CONTROLLER_PROGRAMDATA), "controller release graph changed");
  assert(release.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "controller release Loader changed");
  assert(release.capacityPolicy.equals(ids.capacityPolicy), "controller release capacity policy changed");
  assert(release.capacityPolicyDigest.equals(capacity.policyDigest), "controller release capacity digest changed");
  assert.equal(release.artifactLength, BigInt(EXPECTED_ARTIFACT_BYTES), "controller release artifact length changed");
  assert.equal(release.artifactSha256.toString("hex"), EXPECTED_ARTIFACT_SHA256, "controller release artifact SHA-256 changed");
  assert(release.artifactMerkleRoot.equals(artifactMerkleRoot(value.artifact)), "controller release artifact root changed");
  assert(release.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "controller release artifact scheme changed");
  assert(release.preImmutabilityAuthority.present && release.preImmutabilityAuthority.value.equals(INITIALIZER), "controller release pre-immutability authority changed");
  assert.equal(release.minimumProgramdataCapacity, BigInt(EXPECTED_ARTIFACT_BYTES), "controller release minimum capacity is not exact");
  const authorityVacancy = assertVacantPda(authorityAccount, ids.authority, "controller authority PDA");
  assert.equal(authorityVacancy, null, "controller authority PDA must remain an absent signer-only PDA before immutability");
  assertInitializationState(value, ids, {
    config: configAccount,
    gate: gateAccount,
    policy: policyAccount,
    council: councilAccount,
    capacity: capacityAccount,
    release: releaseAccount,
  }, config, gate, policy, council, capacity, release);

  return {
    capacity,
    config,
    council,
    controller,
    controllerProgramdata,
    controllerProgramdataAccount,
    gate,
    governanceSnapshot: {
      controllerProgram: accountFingerprint(controller),
      controllerConfig: accountFingerprint(configAccount),
      protocolGate: accountFingerprint(gateAccount),
      governancePolicy: accountFingerprint(policyAccount),
      governanceCouncil: accountFingerprint(councilAccount),
      capacityPolicy: accountFingerprint(capacityAccount),
      controllerRelease: accountFingerprint(releaseAccount),
      authorityPda: authorityVacancy,
    },
    ids,
    initializationSnapshot: value.initializationAttestation.snapshot,
    policy,
    release,
    slot: response.context.slot,
    target,
    targetProgramdata,
    targetProgramdataAccount,
    targetSnapshot: {
      program: accountFingerprint(target),
      programdata: accountFingerprint(targetProgramdataAccount),
    },
  };
}

function assertAuthority(state, expectedPresent) {
  assert.equal(state.controllerProgramdata.authority.present, expectedPresent, "controller ProgramData authority presence changed");
  if (expectedPresent) {
    assert(state.controllerProgramdata.authority.value.equals(INITIALIZER), "controller ProgramData authority changed");
  }
}

function observationSubject(state, generation) {
  return programDataObservationSubjectDigestV1({
    controllerProgram: CONTROLLER,
    controllerConfig: state.ids.config,
    targetProgram: CONTROLLER,
    targetProgramdata: CONTROLLER_PROGRAMDATA,
    purpose: ProgramDataObservationPurposeV1.ControllerImmutability,
    subject: state.ids.controllerRelease,
    generation,
    protocolGate: state.ids.gate,
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch,
    gateActiveProposal: state.gate.activeProposal,
    gateFreezeSlot: state.gate.freezeSlot,
    gateFreezeReasonCode: state.gate.freezeReasonCode,
    capacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: state.release.artifactLength,
    expectedArtifactSha256: state.release.artifactSha256,
    expectedArtifactMerkleRoot: state.release.artifactMerkleRoot,
    expectedArtifactSchemeId: state.release.artifactSchemeId,
    minimumRequiredCapacity: state.release.minimumProgramdataCapacity,
  });
}

function instructionSummary(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((meta) => ({
      pubkey: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    dataBytes: instruction.data.length,
    dataHex: Buffer.from(instruction.data).toString("hex"),
    dataSha256: sha256Hex(instruction.data),
  };
}

function canonicalActionPlanSha256(schedule) {
  assert(Array.isArray(schedule) && schedule.length > 0, "immutability action schedule is empty");
  return sha256Hex(Buffer.from(stableJson({
    schema: "ameba-controller-immutability-action-plan-v1",
    schedule,
  }), "utf8"));
}

function observationActionSchedule(kind, transactions) {
  assert(kind === "pre" || kind === "post", "observation action kind is invalid");
  return transactions.map((transaction) => ({
    stage: `${kind}:${transaction.stage}`,
    instructions: transaction.instructions,
  }));
}

function planActionSchedule(plan) {
  if (plan.command === "execute-pre") return observationActionSchedule("pre", plan.transactions);
  if (plan.command === "execute-post") return observationActionSchedule("post", plan.transactions);
  if (plan.command === "execute-authority-final") {
    return [{ stage: "authority-final", instructions: [plan.loaderInstruction] }];
  }
  if (plan.command === "execute-record") {
    return [{ stage: "record-controller-immutability", instructions: [plan.instruction] }];
  }
  throw new Error(`unsupported immutability action-plan command ${plan.command}`);
}

function assertPlanActionBinding(plan) {
  const schedule = planActionSchedule(plan);
  assert.equal(
    plan.actionPlanSha256,
    canonicalActionPlanSha256(schedule),
    "immutability action-plan commitment changed",
  );
  return schedule;
}

function canonicalDecodedAction(plan, stage, instructions, expectedSigners) {
  const schedule = assertPlanActionBinding(plan);
  const planned = schedule.filter((entry) => entry.stage === stage);
  assert.equal(planned.length, 1, `${stage} is absent or duplicated in the exact action plan`);
  const summaries = instructions.map(instructionSummary);
  assert.deepEqual(summaries, planned[0].instructions, `${stage} instruction differs from the exact action plan`);
  const action = {
    schema: "ameba-controller-immutability-decoded-action-v1",
    command: plan.command,
    operationId: plan.operationId,
    actionPlanSha256: plan.actionPlanSha256,
    stage,
    signerAccounts: expectedSigners.map((signer) => signer.toBase58()),
    targetMutationAllowed: false,
    instructions: summaries,
  };
  return {
    action,
    actionSha256: sha256Hex(Buffer.from(stableJson(action), "utf8")),
  };
}

function displayCanonicalDecodedAction(journal, plan, stage, instructions, expectedSigners) {
  requireArm(plan.command, plan);
  const decoded = canonicalDecodedAction(plan, stage, instructions, expectedSigners);
  process.stdout.write(`${JSON.stringify({
    decodedAction: decoded.action,
    decodedActionSha256: decoded.actionSha256,
    armedActionPlanSha256: plan.actionPlanSha256,
  }, null, 2)}\n`);
  journal.append(plan.operationId, "decoded-action-displayed", {
    stage,
    actionPlanSha256: plan.actionPlanSha256,
    decodedActionSha256: decoded.actionSha256,
    decodedAction: decoded.action,
  });
  return decoded;
}

function assertDisplayedActionAuthorization(decoded, plan, stage) {
  assert(decoded && typeof decoded === "object", `${stage} decoded-action authorization is absent`);
  assert.equal(decoded.action?.operationId, plan.operationId, `${stage} decoded-action operation changed`);
  assert.equal(decoded.action?.actionPlanSha256, plan.actionPlanSha256, `${stage} decoded-action plan hash changed`);
  assert.equal(decoded.action?.stage, stage, `${stage} decoded-action stage changed`);
  assert.equal(
    decoded.actionSha256,
    sha256Hex(Buffer.from(stableJson(decoded.action), "utf8")),
    `${stage} decoded-action hash changed`,
  );
}

async function loadSignerProviderAfterDisplayedAction(value, decoded, plan, stage) {
  assertDisplayedActionAuthorization(decoded, plan, stage);
  return loadInjectedSignerProvider(value.runDir);
}

function assertNoTargetMutationInstruction(instruction) {
  assert(!instruction.programId.equals(TARGET), "target program invocation is forbidden");
  for (const meta of instruction.keys) {
    assert(!meta.pubkey.equals(TARGET) && !meta.pubkey.equals(TARGET_PROGRAMDATA), "target accounts are outside this tool's mutation envelope");
  }
}

function buildObservationModel(value, state, generation, expectedAuthority) {
  const subjectDigest = observationSubject(state, generation);
  const [observation, observationBump] = deriveProgramDataObservationPdaV1(
    CONTROLLER,
    CONTROLLER,
    ProgramDataObservationPurposeV1.ControllerImmutability,
    subjectDigest,
    generation,
  );
  const guard = {
    purpose: ProgramDataObservationPurposeV1.ControllerImmutability,
    generation,
    expectedSubjectDigest: subjectDigest,
    expectedGateStatus: state.gate.status,
    expectedGateEpoch: state.gate.epoch,
    expectedFreezeReasonCode: state.gate.freezeReasonCode,
    expectedFreezeSlot: state.gate.freezeSlot,
  };
  const beginAccounts = {
    payer: PAYER,
    controllerConfig: state.ids.config,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    subject: state.ids.controllerRelease,
    observedProgram: CONTROLLER,
    observedProgramdata: CONTROLLER_PROGRAMDATA,
    observation,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  const stepAccounts = {
    controllerConfig: state.ids.config,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    subject: state.ids.controllerRelease,
    observedProgram: CONTROLLER,
    observedProgramdata: CONTROLLER_PROGRAMDATA,
    observation,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  const raw = state.controllerProgramdata.raw;
  const rawGeometry = programDataObservationGeometryV1(raw.length, RAW_CHUNK_SIZE);
  const artifactChunkTotal = artifactChunkCount(value.artifact.length, ARTIFACT_CHUNK_SIZE);
  assert.equal(rawGeometry.chunkCount, artifactChunkTotal, "fixed controller raw/artifact chunk counts diverged");
  assert.equal(BigInt(state.controllerProgramdata.payload.length) - state.release.artifactLength, 0n, "controller ProgramData has nonzero tail capacity");
  const rawRoot = programDataObservationMerkleRootV1(raw, subjectDigest, RAW_CHUNK_SIZE);
  const begin = buildBeginProgramDataObservationV1Instruction(CONTROLLER, beginAccounts, {
    guard,
    expectedCapacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: state.release.artifactLength,
    expectedArtifactSha256: state.release.artifactSha256,
    expectedArtifactMerkleRoot: state.release.artifactMerkleRoot,
    expectedArtifactSchemeId: state.release.artifactSchemeId,
    minimumRequiredCapacity: state.release.minimumProgramdataCapacity,
    expectedDeployedSlot: state.controllerProgramdata.deployedSlot,
    expectedActualCapacity: BigInt(state.controllerProgramdata.payload.length),
    expectedUpgradeAuthority: expectedAuthority,
  });
  assertNoTargetMutationInstruction(begin);
  const transactions = [{ stage: "begin", instructions: [instructionSummary(begin)] }];
  const appends = [];
  const verifies = [];
  for (let index = 0; index < rawGeometry.chunkCount; index += 1) {
    const append = buildAppendProgramDataObservationChunkV1Instruction(CONTROLLER, stepAccounts, {
      guard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex: index,
    });
    const proof = artifactMerkleProof(value.artifact, index, ARTIFACT_CHUNK_SIZE);
    assert(proof.length <= 7, "artifact proof exceeds the fixed seven-node ABI");
    const verify = buildVerifyObservedArtifactChunkV1Instruction(CONTROLLER, stepAccounts, {
      guard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex: index,
      expectedNextArtifactChunkIndex: index,
      expectedTailBytesVerified: 0n,
      proof: {
        proofLen: proof.length,
        nodes: [...proof.map((node) => Buffer.from(node)), ...Array.from({ length: 7 - proof.length }, () => Buffer.from(ZERO_32))],
      },
    });
    assertNoTargetMutationInstruction(append);
    assertNoTargetMutationInstruction(verify);
    appends.push(append);
    verifies.push(verify);
    transactions.push({ stage: `append-${String(index).padStart(3, "0")}`, instructions: [instructionSummary(append)] });
  }
  for (let index = 0; index < verifies.length; index += 1) {
    transactions.push({ stage: `verify-${String(index).padStart(3, "0")}`, instructions: [instructionSummary(verifies[index])] });
  }
  const finalize = buildFinalizeProgramDataObservationV1Instruction(CONTROLLER, stepAccounts, {
    guard,
    expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
    expectedNextRawChunkIndex: rawGeometry.chunkCount,
    expectedNextArtifactChunkIndex: artifactChunkTotal,
    expectedTailBytesVerified: 0n,
  });
  assertNoTargetMutationInstruction(finalize);
  transactions.push({ stage: "finalize", instructions: [instructionSummary(finalize)] });
  return {
    artifactChunkTotal,
    begin,
    expectedAuthority,
    finalize,
    guard,
    observation,
    observationBump,
    appends,
    rawGeometry,
    rawRoot,
    rawSha256: programDataRawSha256ReceiptV1(raw),
    subjectDigest,
    transactions,
    verifies,
  };
}

async function readOneAccount(value, address) {
  const response = await executionAwareRpc(
    "getAccountInfoAndContext",
    `finalized-read:account:${address.toBase58()}`,
    () => value.connection.getAccountInfoAndContext(address, finalizedReadConfig(value)),
  );
  advanceMinContextSlot(value, response.context.slot, `account read ${address.toBase58()}`);
  return response;
}

function assertVacantPda(account, address, label) {
  if (account === null) return null;
  assert(account.owner.equals(SystemProgram.programId), `${label} ${address.toBase58()} is foreign-owned`);
  assert.equal(account.data.length, 0, `${label} ${address.toBase58()} is data-bearing`);
  assert.equal(account.executable, false, `${label} ${address.toBase58()} is executable`);
  return accountFingerprint(account);
}

function assertOptionalAuthority(actual, expected, label) {
  assert.equal(actual.present, expected.present, `${label} authority presence changed`);
  assert(actual.value.equals(expected.value), `${label} authority value changed`);
}

function assertObservationCommon(observation, model, state, label) {
  assert.equal(observation.bump, model.observationBump, `${label} bump changed`);
  assert(observation.controllerProgram.equals(CONTROLLER), `${label} controller changed`);
  assert(observation.controllerConfig.equals(state.ids.config), `${label} config changed`);
  assert(observation.capacityPolicy.equals(state.ids.capacityPolicy), `${label} capacity policy changed`);
  assert(observation.capacityPolicyDigest.equals(state.capacity.policyDigest), `${label} capacity digest changed`);
  assert.equal(observation.purpose, ProgramDataObservationPurposeV1.ControllerImmutability, `${label} purpose changed`);
  assert(observation.subject.equals(state.ids.controllerRelease), `${label} subject changed`);
  assert(observation.subjectDigest.equals(model.subjectDigest), `${label} subject digest changed`);
  assert.equal(observation.generation, model.guard.generation, `${label} generation changed`);
  assert(observation.protocolGate.equals(state.ids.gate), `${label} gate changed`);
  assert.equal(observation.gateStatus, state.gate.status, `${label} gate status changed`);
  assert.equal(observation.gateEpoch, state.gate.epoch, `${label} gate epoch changed`);
  assert(observation.gateActiveProposal.equals(state.gate.activeProposal), `${label} gate proposal changed`);
  assert.equal(observation.gateFreezeSlot, state.gate.freezeSlot, `${label} gate freeze slot changed`);
  assert.equal(observation.gateFreezeReasonCode, state.gate.freezeReasonCode, `${label} gate freeze reason changed`);
  assert(observation.targetProgram.equals(CONTROLLER), `${label} observed Program changed`);
  assert(observation.targetProgramdata.equals(CONTROLLER_PROGRAMDATA), `${label} observed ProgramData changed`);
  assert(observation.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} Loader changed`);
  assert(observation.programOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} Program owner changed`);
  assert.equal(observation.programExecutable, true, `${label} Program executable changed`);
  assert.equal(observation.programDataLength, 36n, `${label} Program length changed`);
  assert.equal(observation.programHeaderPresent, true, `${label} Program header missing`);
  assert(observation.programHeaderSnapshot.equals(state.controller.data), `${label} Program header bytes changed`);
  assert(observation.linkedProgramdata.equals(CONTROLLER_PROGRAMDATA), `${label} ProgramData linkage changed`);
  assert(observation.programdataOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} ProgramData owner changed`);
  assert.equal(observation.programdataExecutable, false, `${label} ProgramData executable changed`);
  assert.equal(observation.programdataHeaderPresent, true, `${label} ProgramData header missing`);
  assert(observation.programdataHeaderSnapshot.equals(state.controllerProgramdata.header), `${label} ProgramData header bytes changed`);
  assert.equal(observation.deployedSlot, state.controllerProgramdata.deployedSlot, `${label} deployed slot changed`);
  assertOptionalAuthority(observation.upgradeAuthority, model.expectedAuthority, label);
  assert.equal(observation.rawDataLength, BigInt(state.controllerProgramdata.raw.length), `${label} raw length changed`);
  assert.equal(observation.payloadOffset, 45, `${label} payload offset changed`);
  assert.equal(observation.actualCapacity, BigInt(state.controllerProgramdata.payload.length), `${label} capacity changed`);
  assert.equal(observation.expectedArtifactLength, state.release.artifactLength, `${label} artifact length changed`);
  assert(observation.expectedArtifactSha256.equals(state.release.artifactSha256), `${label} artifact SHA-256 changed`);
  assert(observation.expectedArtifactMerkleRoot.equals(state.release.artifactMerkleRoot), `${label} artifact root changed`);
  assert(observation.expectedArtifactSchemeId.equals(state.release.artifactSchemeId), `${label} artifact scheme changed`);
  assert.equal(observation.artifactChunkSize, ARTIFACT_CHUNK_SIZE, `${label} artifact chunk size changed`);
  assert.equal(observation.artifactChunkCount, model.artifactChunkTotal, `${label} artifact chunk count changed`);
  assert.equal(observation.minimumRequiredCapacity, state.release.minimumProgramdataCapacity, `${label} minimum capacity changed`);
  assert(observation.rawObservationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1), `${label} raw scheme changed`);
  assert.equal(observation.rawChunkSize, RAW_CHUNK_SIZE, `${label} raw chunk size changed`);
  assert.equal(observation.rawChunkCount, model.rawGeometry.chunkCount, `${label} raw chunk count changed`);
  assert.equal(observation.rawPaddedLeafCount, model.rawGeometry.paddedChunkCount, `${label} raw padded count changed`);
  assert.equal(observation.rawTreeDepth, model.rawGeometry.treeDepth, `${label} raw tree depth changed`);
}

function assertFinalObservation(observation, model, state, label) {
  assertObservationCommon(observation, model, state, label);
  assert.equal(observation.status, ProgramDataObservationStatusV1.Finalized, `${label} is not finalized`);
  assert.equal(observation.nextRawChunkIndex, model.rawGeometry.chunkCount, `${label} raw scan is incomplete`);
  assert.equal(observation.nextArtifactChunkIndex, model.artifactChunkTotal, `${label} artifact verification is incomplete`);
  assert.equal(observation.tailBytesVerified, 0n, `${label} exact-capacity tail count changed`);
  assert(observation.finalRawMerkleRoot.equals(model.rawRoot), `${label} raw Merkle root changed`);
  validateProgramDataObservationDigestV1(observation);
}

async function readObservation(value, model) {
  const response = await readOneAccount(value, model.observation);
  if (response.value === null || (response.value.owner.equals(SystemProgram.programId) && response.value.data.length === 0)) {
    return { account: response.value, observation: null, slot: response.context.slot };
  }
  assertAccount(response.value, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, "ProgramData observation");
  return {
    account: response.value,
    observation: deserializeProgramDataObservationV1(response.value.data),
    slot: response.context.slot,
  };
}

function observationPlanMaterial(value, state, model, kind, initialObservation) {
  const authority = model.expectedAuthority.present ? model.expectedAuthority.value.toBase58() : null;
  return {
    schema: `ameba-governance-devnet-controller-immutability-${kind}-observation-plan-v1`,
    command: `execute-${kind}`,
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
    observedSlot: value.minContextSlot,
    planValidUntilSlot: value.minContextSlot + PLAN_TTL_SLOTS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    targetMutationAllowed: false,
    targetSnapshot: state.targetSnapshot,
    governanceSnapshot: state.governanceSnapshot,
    initializationSnapshot: state.initializationSnapshot,
    payer: PAYER.toBase58(),
    initializer: INITIALIZER.toBase58(),
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    controllerConfig: state.ids.config.toBase58(),
    protocolGate: state.ids.gate.toBase58(),
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch.toString(),
    gateFreezeSlot: state.gate.freezeSlot.toString(),
    gateFreezeReasonCode: state.gate.freezeReasonCode,
    capacityPolicy: state.ids.capacityPolicy.toBase58(),
    capacityPolicyDigest: state.capacity.policyDigest.toString("hex"),
    controllerRelease: state.ids.controllerRelease.toBase58(),
    controllerReleaseDigest: state.release.releaseDigest.toString("hex"),
    generation: model.guard.generation.toString(),
    observation: model.observation.toBase58(),
    observationBump: model.observationBump,
    observationInitiallyVacant: initialObservation,
    subjectDigest: model.subjectDigest.toString("hex"),
    expectedUpgradeAuthority: authority,
    deployedSlot: state.controllerProgramdata.deployedSlot.toString(),
    programdataRawBytes: state.controllerProgramdata.raw.length,
    programdataRawBase64: state.controllerProgramdata.raw.toString("base64"),
    programdataRawSha256: model.rawSha256.toString("hex"),
    programdataRawMerkleRoot: model.rawRoot.toString("hex"),
    payloadBytes: state.controllerProgramdata.payload.length,
    artifactBytes: value.artifact.length,
    artifactSha256: EXPECTED_ARTIFACT_SHA256,
    artifactMerkleRoot: state.release.artifactMerkleRoot.toString("hex"),
    rawChunkSize: RAW_CHUNK_SIZE,
    rawChunkCount: model.rawGeometry.chunkCount,
    artifactChunkSize: ARTIFACT_CHUNK_SIZE,
    artifactChunkCount: model.artifactChunkTotal,
    exactChunkSchedule: "begin; append every ordered exact raw 16KiB range; verify every ordered exact artifact 16KiB range; finalize",
    transactions: model.transactions,
    actionPlanSha256: canonicalActionPlanSha256(observationActionSchedule(kind, model.transactions)),
    maxRetries: 0,
    mainnetAllowed: false,
  };
}

async function planObservation(kind) {
  assert(kind === "pre" || kind === "post", "unknown observation kind");
  const value = await inputs({ verifyGenesis: false });
  await withPlanningLock(value, `plan-${kind}`, async () => {
    const state = await readBaseState(value);
    const generation = kind === "pre" ? PRE_GENERATION : POST_GENERATION;
    const expectedAuthority = kind === "pre" ? optionalAuthority(true, INITIALIZER) : optionalAuthority(false);
    assertAuthority(state, kind === "pre");
    const model = buildObservationModel(value, state, generation, expectedAuthority);
    if (kind === "post") {
      const preModel = buildObservationModel(value, state, PRE_GENERATION, optionalAuthority(true, INITIALIZER));
      // The post raw bytes differ only in the Loader authority option byte; the
      // pre observation therefore needs its original root/model, loaded from its
      // own plan below rather than recomputed from the post bytes.
      const preBundle = await loadFinalObservationFromPlan(
        value,
        PLAN_SPECS.pre,
        FILES.preReceipt,
        "pre-immutability observation",
      );
      assert.equal(preBundle.plan.observation, preModel.observation.toBase58(), "pre observation identity changed");
      const authorityReceiptFile = await readSecureJson(
        value.runDir,
        FILES.authorityReceipt,
        "authority-final receipt",
      );
      assert(
        typeof authorityReceiptFile.value.planFile === "string"
          && PLAN_SPECS.authority.pattern.test(authorityReceiptFile.value.planFile),
        "authority-final receipt plan filename changed",
      );
      const authorityPlan = (await readExactPlan(
        value.runDir,
        fileInRunDir(value.runDir, authorityReceiptFile.value.planFile),
        PLAN_SPECS.authority,
        "authority-final receipt plan",
      )).plan;
      const authorityReceipt = authorityReceiptFile.value;
      assertAuthorityReceipt(authorityReceipt, authorityPlan);
      assert.equal(authorityReceipt.postRawSha256, sha256Hex(state.controllerProgramdata.raw), "authority-final receipt raw SHA-256 changed");
    }
    const observationResponse = await readOneAccount(value, model.observation);
    const initialObservation = assertVacantPda(observationResponse.value, model.observation, `${kind} observation`);
    const material = observationPlanMaterial(value, state, model, kind, initialObservation);
    const plan = { ...material, operationId: operationId(material) };
    const spec = kind === "pre" ? PLAN_SPECS.pre : PLAN_SPECS.post;
    const planFile = await writeNonOverwritingPlan(value.runDir, spec, plan, `${kind} observation plan`);
    process.stdout.write(`${JSON.stringify({
      ...plan,
      planFile: path.basename(planFile),
      planSelection: { environment: spec.environmentName, value: planFile },
      requiredArm: armValue(`execute-${kind}`, plan.operationId, plan.actionPlanSha256),
    }, null, 2)}\n`);
  });
}

function nestedErrorValues(error) {
  const values = [];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    values.push(current);
    current = current.cause;
  }
  return values;
}

function isRateLimit(error) {
  return /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(error?.message ?? error))
    || nestedErrorValues(error).some((value) => (
      value?.status === 429
      || value?.statusCode === 429
      || value?.response?.status === 429
      || /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(value?.message ?? ""))
    ));
}

function isMinimumContextSlotNotReached(error) {
  const values = nestedErrorValues(error);
  const messages = values.map((value) => String(value?.message ?? value ?? "")).join("\n");
  const hasExactCode = values.some((value) => value?.code === -32016)
    || /(?:^|\D)-32016(?:\D|$)/u.test(messages);
  return hasExactCode
    && /minimum context slot (?:not reached|has not been reached)/iu.test(messages);
}

function retryAfterMs(error) {
  const text = String(error?.message ?? error);
  const match = text.match(/retry[- ]after[^0-9]*(\d+(?:\.\d+)?)/iu);
  return match ? Math.ceil(Number(match[1]) * 1_000) : 30_000;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function journalRpcFailure(journal, operationIdValue, stage, error) {
  const limited = isRateLimit(error);
  const priorRateLimits = limited
    ? journal.recover().filter((entry) => entry.event === "rpc-rate-limit-exit").length
    : 0;
  const rateLimitOrdinal = limited ? priorRateLimits + 1 : null;
  const exponentialBackoffMs = limited
    ? Math.min(30_000 * (2 ** Math.min(priorRateLimits, 5)), 15 * 60_000)
    : null;
  const selectedBackoffMs = limited ? Math.max(retryAfterMs(error), exponentialBackoffMs) : null;
  journal.append(operationIdValue, limited ? "rpc-rate-limit-exit" : "rpc-error", {
    stage,
    rateLimitOrdinal,
    retryAfterMs: selectedBackoffMs,
    exponentialBackoffMs,
    retryNotBefore: limited ? new Date(Date.now() + selectedBackoffMs).toISOString() : null,
    automaticRetry: false,
    errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
  });
}

async function rpcExecution(
  journal,
  operationIdValue,
  stage,
  method,
  callback,
  options = {},
) {
  assert(MINIMUM_CONTEXT_CATCH_UP_READ_METHODS.has(method), `${stage} RPC method is not an admitted catch-up read`);
  const maxAttempts = options.maxAttempts ?? MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? MINIMUM_CONTEXT_CATCH_UP_DELAY_MS;
  assert(
    Number.isSafeInteger(maxAttempts)
      && maxAttempts >= 1
      && maxAttempts <= MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS,
    `${stage} minimum-context catch-up attempt bound is invalid`,
  );
  assert(
    Number.isSafeInteger(delayMs)
      && delayMs >= 0
      && delayMs <= MINIMUM_CONTEXT_CATCH_UP_DELAY_MS,
    `${stage} minimum-context catch-up delay is invalid`,
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertJournalBackoffElapsed(journal);
    try {
      return await callback();
    } catch (error) {
      if (isRateLimit(error)) {
        journalRpcFailure(journal, operationIdValue, stage, error);
        throw error;
      }
      if (!isMinimumContextSlotNotReached(error)) {
        journalRpcFailure(journal, operationIdValue, stage, error);
        throw error;
      }
      const exhausted = attempt === maxAttempts;
      journal.append(
        operationIdValue,
        exhausted ? "minimum-context-catch-up-exhausted" : "minimum-context-catch-up",
        {
          stage,
          method,
          attempt,
          maxAttempts,
          retryDelayMs: exhausted ? 0 : delayMs,
          automaticTransactionRetry: false,
          errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
        },
      );
      if (exhausted) throw error;
      await delay(delayMs);
    }
  }
  throw new Error(`${stage} minimum-context catch-up loop terminated unexpectedly`);
}

async function recordFinalizedReread(value, journal, plan, stage, phase, callback) {
  assert(["pre-sign", "pre-submit"].includes(phase), `${stage} finalized reread phase is invalid`);
  const beforeSlot = value.minContextSlot;
  const result = await callback();
  const observationSlot = value.minContextSlot;
  assert(Number.isSafeInteger(observationSlot) && observationSlot > 0, `${stage} ${phase} reread lacks a finalized observation slot`);
  assert(observationSlot >= beforeSlot, `${stage} ${phase} reread regressed the monotonic context slot`);
  journal.append(plan.operationId, `${phase}-state-verified`, {
    stage,
    actionPlanSha256: plan.actionPlanSha256,
    priorMinContextSlot: beforeSlot,
    observationSlot,
  });
  return result;
}

async function assertBlockhashValidAtCurrentContext(value, journal, plan, stage, blockhash, phase) {
  const minimum = value.minContextSlot;
  assert(Number.isSafeInteger(minimum) && minimum > 0, `${stage} ${phase} blockhash check lacks a minimum context slot`);
  const response = await rpcExecution(
    journal,
    plan.operationId,
    `${stage}:${phase}-blockhash-validity`,
    "isBlockhashValid",
    () => value.connection.isBlockhashValid(blockhash, {
      commitment: "finalized",
      minContextSlot: minimum,
    }),
  );
  advanceMinContextSlot(value, response.context.slot, `${stage} ${phase} blockhash validation`);
  assert.equal(response.value, true, `${stage} blockhash expired before ${phase}`);
}

function preparedTransactions(journal, operationIdValue, stage) {
  const entries = journal.recover().filter((entry) => entry.operationId === operationIdValue);
  const prepared = entries.filter((entry) => entry.event === "transaction-prepared" && entry.payload.stage === stage);
  if (prepared.length === 0) return null;
  const last = prepared.at(-1).payload;
  const terminal = entries.find((entry) => ["transaction-finalized", "transaction-reconciled-finalized", "transaction-expired-not-landed"].includes(entry.event)
    && entry.payload.stage === stage && entry.payload.signature === last.signature);
  return terminal ? null : last;
}

function assertSignerProviderEvidence(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} signer-provider evidence is absent`);
  assert.deepEqual(
    Object.keys(value).sort(),
    ["providerId", "providerKind", "providerModuleSha256"].sort(),
    `${label} signer-provider evidence keys changed`,
  );
  assert(typeof value.providerId === "string" && value.providerId.length > 0, `${label} signer-provider ID is absent`);
  assert(["hardware-wallet", "kms", "smart-account", "wallet"].includes(value.providerKind), `${label} signer-provider kind is unsupported`);
  assertSha256(value.providerModuleSha256, `${label} signer-provider module SHA-256`);
  return value;
}

function unresolvedPreparedStages(journal, operationIdValue) {
  const entries = journal.recover().filter((entry) => entry.operationId === operationIdValue);
  const terminalKeys = new Set(entries
    .filter((entry) => ["transaction-finalized", "transaction-reconciled-finalized", "transaction-expired-not-landed"].includes(entry.event))
    .map((entry) => `${entry.payload.stage}:${entry.payload.signature}`));
  const stages = [];
  const seen = new Set();
  for (const entry of entries) {
    if (entry.event !== "transaction-prepared") continue;
    const key = `${entry.payload.stage}:${entry.payload.signature}`;
    if (terminalKeys.has(key)) continue;
    assert(!seen.has(entry.payload.stage), `${entry.payload.stage} has more than one unresolved prepared transaction`);
    seen.add(entry.payload.stage);
    stages.push(entry.payload.stage);
  }
  return stages;
}

async function finalizedTransaction(value, signature, expectedMessageSha256, minimumContextSlot = 0) {
  assert(Number.isSafeInteger(minimumContextSlot) && minimumContextSlot >= 0, "finalized transaction minimum context slot is invalid");
  const [statusResponse, landed] = await Promise.all([
    value.connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    value.connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  const status = statusResponse.value[0];
  if (status?.err) throw new Error(`transaction ${signature} failed`);
  if (!landed || status?.confirmationStatus !== "finalized") return null;
  assert(landed.meta && landed.meta.err === null, `transaction ${signature} finalized with an error`);
  assert(landed.slot >= minimumContextSlot, `transaction ${signature} predates its minimum context slot`);
  value.minContextSlot = Math.max(value.minContextSlot, landed.slot);
  assert(landed.transaction.signatures.includes(signature), `transaction ${signature} signature changed`);
  const messageSha256 = sha256Hex(Buffer.from(landed.transaction.message.serialize()));
  assert.equal(messageSha256, expectedMessageSha256, `transaction ${signature} finalized message changed`);
  return {
    signature,
    slot: landed.slot,
    blockTime: landed.blockTime,
    feeLamports: landed.meta.fee,
    computeUnits: landed.meta.computeUnitsConsumed ?? null,
    messageSha256,
    recentBlockhash: landed.transaction.message.recentBlockhash,
    minContextSlot: minimumContextSlot,
  };
}

async function pollSubmittedFinalized(value, journal, plan, stage, prepared) {
  for (;;) {
    const statusResponse = await rpcExecution(
      journal,
      plan.operationId,
      `${stage}:finalized-status-poll`,
      "getSignatureStatuses",
      () => value.connection.getSignatureStatuses([prepared.signature], { searchTransactionHistory: true }),
    );
    assert.equal(statusResponse.value.length, 1, `${stage} finalized status response length changed`);
    const status = statusResponse.value[0];
    if (status?.err) throw new Error(`${stage} transaction finalized with an error`);
    if (status?.confirmationStatus === "finalized") {
      const landed = await rpcExecution(
        journal,
        plan.operationId,
        `${stage}:finalized-read`,
        "getTransaction",
        () => finalizedTransaction(value, prepared.signature, prepared.messageSha256, prepared.minContextSlot),
      );
      assert(landed, `${stage} finalized transaction is unavailable`);
      journal.append(plan.operationId, "transaction-finalized", {
        stage,
        ...landed,
        signerProvider: prepared.signerProvider,
      });
      return landed;
    }
    if (status === null) {
      const blockHeight = await rpcExecution(
        journal,
        plan.operationId,
        `${stage}:finalized-poll-block-height`,
        "getBlockHeight",
        () => value.connection.getBlockHeight(finalizedReadConfig(value)),
      );
      if (blockHeight > prepared.lastValidBlockHeight) {
        const reconciled = await reconcilePrepared(value, journal, plan.operationId, stage);
        if (reconciled) return reconciled;
        throw new Error(`${stage} transaction expired without landing; rerun the same armed plan to prepare a fresh attempt`);
      }
    }
    await delay(FINALIZED_STATUS_POLL_INTERVAL_MS);
  }
}

async function reconcilePrepared(value, journal, operationIdValue, stage) {
  const pending = preparedTransactions(journal, operationIdValue, stage);
  if (!pending) return null;
  assertSignerProviderEvidence(pending.signerProvider, stage);
  assert(Number.isSafeInteger(pending.minContextSlot) && pending.minContextSlot > 0, `${stage} prepared minimum context slot is invalid`);
  const landed = await rpcExecution(
    journal,
    operationIdValue,
    `${stage}:reconcile`,
    "getTransaction",
    () => finalizedTransaction(value, pending.signature, pending.messageSha256, pending.minContextSlot),
  );
  if (landed) {
    journal.append(operationIdValue, "transaction-reconciled-finalized", {
      stage,
      ...landed,
      signerProvider: pending.signerProvider,
    });
    return landed;
  }
  const blockHeight = await rpcExecution(
    journal,
    operationIdValue,
    `${stage}:block-height`,
    "getBlockHeight",
    () => value.connection.getBlockHeight(finalizedReadConfig(value)),
  );
  if (blockHeight > pending.lastValidBlockHeight) {
    const statusResponse = await rpcExecution(
      journal,
      operationIdValue,
      `${stage}:expired-signature-status`,
      "getSignatureStatuses",
      () => value.connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true }),
    );
    assert.equal(statusResponse.value.length, 1, `${stage} expiry status response length changed`);
    assert.equal(
      statusResponse.value[0],
      null,
      `${stage} expired signature remains visible and cannot be classified as not landed`,
    );
    const finalizedProofSlot = await rpcExecution(
      journal,
      operationIdValue,
      `${stage}:expired-finalized-proof-slot`,
      "getSlot",
      () => value.connection.getSlot("finalized"),
    );
    advanceMinContextSlot(value, finalizedProofSlot, `${stage} expiry proof`);
    journal.append(operationIdValue, "transaction-expired-not-landed", {
      stage,
      signature: pending.signature,
      lastValidBlockHeight: pending.lastValidBlockHeight,
      observedBlockHeight: blockHeight,
      finalizedProofSlot,
    });
    return null;
  }
  throw new Error(`${stage} has an unresolved prepared signature ${pending.signature}; no retry is allowed before expiry/finalized reconciliation`);
}

async function reconcileAllPrepared(value, journal, operationIdValue) {
  for (const stage of unresolvedPreparedStages(journal, operationIdValue)) {
    await reconcilePrepared(value, journal, operationIdValue, stage);
  }
}

function transactionSignature(transaction) {
  const bytes = transaction.signatures[0]?.signature;
  assert(bytes && bytes.length === 64, "fee-payer signature is absent");
  return bs58.encode(bytes);
}

async function submitSignedTransaction(
  value,
  journal,
  plan,
  stage,
  transaction,
  latestBlockhash,
  verifyImmediatelyBeforeSubmit,
  signerProviderEvidence,
) {
  const operationIdValue = plan.operationId;
  const reconciled = await reconcilePrepared(value, journal, operationIdValue, stage);
  if (reconciled) return reconciled;
  assertSignerProviderEvidence(signerProviderEvidence, stage);
  const raw = Buffer.from(transaction.serialize({ requireAllSignatures: true, verifySignatures: true }));
  assert(raw.length <= 1_232, `${stage} packet exceeds 1,232 bytes`);
  const message = Buffer.from(transaction.compileMessage().serialize());
  const signature = transactionSignature(transaction);
  await recordFinalizedReread(
    value,
    journal,
    plan,
    stage,
    "pre-submit",
    verifyImmediatelyBeforeSubmit,
  );
  await assertBlockhashValidAtCurrentContext(
    value,
    journal,
    plan,
    stage,
    latestBlockhash.blockhash,
    "submission",
  );
  const minContextSlot = value.minContextSlot;
  assert(Number.isSafeInteger(minContextSlot) && minContextSlot > 0, `${stage} minimum context slot is invalid`);
  const prepared = {
    stage,
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    messageSha256: sha256Hex(message),
    wireSha256: sha256Hex(raw),
    wireBytes: raw.length,
    minContextSlot,
    maxRetries: 0,
    signerProvider: signerProviderEvidence,
  };
  journal.append(operationIdValue, "transaction-prepared", prepared);
  assertJournalBackoffElapsed(journal);
  let submitted;
  try {
    submitted = await value.connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 0,
      minContextSlot,
    });
  } catch (error) {
    journalRpcFailure(journal, operationIdValue, `${stage}:submit`, error);
    if (isRateLimit(error)) {
      throw new Error(`${stage} stopped on the first 429 with unknown submission outcome for ${signature}; wait for the journaled backoff and rerun only for reconciliation`);
    }
    const landed = await rpcExecution(
      journal,
      operationIdValue,
      `${stage}:submit-error-reconcile`,
      "getTransaction",
      () => finalizedTransaction(value, signature, prepared.messageSha256, prepared.minContextSlot),
    ).catch(() => null);
    if (landed) {
      journal.append(operationIdValue, "transaction-reconciled-finalized", {
        stage,
        ...landed,
        signerProvider: signerProviderEvidence,
      });
      return landed;
    }
    throw new Error(`${stage} submission outcome is unknown for ${signature}; rerun only for journal reconciliation`);
  }
  assert.equal(submitted, signature, `${stage} RPC returned a different signature`);
  journal.append(operationIdValue, "transaction-submitted", { stage, signature });
  return pollSubmittedFinalized(value, journal, plan, stage, prepared);
}

async function latestFinalizedBlockhash(value, journal, operationIdValue, stage) {
  const response = await rpcExecution(
    journal,
    operationIdValue,
    `${stage}:blockhash`,
    "getLatestBlockhashAndContext",
    () => value.connection.getLatestBlockhashAndContext(finalizedReadConfig(value)),
  );
  advanceMinContextSlot(value, response.context.slot, `${stage} blockhash`);
  return response.value;
}

function providerStage(stage) {
  const value = stage.replaceAll(":", "-");
  assert(/^[a-z0-9][a-z0-9-]*$/u.test(value), `${stage} cannot be represented as a signer-provider stage`);
  return value;
}

async function submitControllerInstructions(value, journal, plan, stage, instructions, verifyCurrentState) {
  const operationIdValue = plan.operationId;
  const pending = await reconcilePrepared(value, journal, operationIdValue, stage);
  if (pending) return pending;
  const latest = await latestFinalizedBlockhash(value, journal, operationIdValue, stage);
  await recordFinalizedReread(value, journal, plan, stage, "pre-sign", verifyCurrentState);
  await assertBlockhashValidAtCurrentContext(
    value,
    journal,
    plan,
    stage,
    latest.blockhash,
    "signing",
  );
  const unsigned = new Transaction({ feePayer: PAYER, recentBlockhash: latest.blockhash });
  unsigned.add(...instructions);
  const displayedAction = displayCanonicalDecodedAction(journal, plan, stage, instructions, [PAYER]);
  const provider = await loadSignerProviderAfterDisplayedAction(value, displayedAction, plan, stage);
  const signed = await signTransactionWithProvider({
    providerValue: provider,
    transaction: unsigned,
    expectedSigners: [PAYER],
    operationId: operationIdValue,
    stage: providerStage(stage),
  });
  return submitSignedTransaction(
    value,
    journal,
    plan,
    stage,
    signed.transaction,
    latest,
    verifyCurrentState,
    signed.providerEvidence,
  );
}

function operationFinalizedTransactions(journal, operationIdValue) {
  const results = new Map();
  for (const entry of journal.recover()) {
    if (entry.operationId !== operationIdValue || !["transaction-finalized", "transaction-reconciled-finalized"].includes(entry.event)) continue;
    results.set(entry.payload.stage, entry.payload);
  }
  return [...results.values()];
}

async function withExecutionLock(value, plan, command, callback) {
  requireArm(command, plan);
  const lock = new ExclusiveOperatorLockV1(fileInRunDir(value.runDir, FILES.lock));
  const journal = new GovernanceJournalV1(fileInRunDir(value.runDir, FILES.journal));
  lock.acquire(plan.operationId);
  assert.equal(activeExecutionRpc, null, "nested execution RPC context is forbidden");
  activeExecutionRpc = { journal, operationId: plan.operationId };
  try {
    await assertRunDirectoryBackoffElapsed(value.runDir);
    assertJournalBackoffElapsed(journal);
    journal.append(plan.operationId, "execution-started", { command, planSchema: plan.schema, maxRetries: 0 });
    const genesisHash = await executionAwareRpc(
      "getGenesisHash",
      "genesis",
      () => value.connection.getGenesisHash(),
    );
    assert.equal(genesisHash, EXPECTED_GENESIS, "state RPC genesis changed");
    await reconcileAllPrepared(value, journal, plan.operationId);
    const result = await callback(journal);
    journal.append(plan.operationId, "execution-completed", { command });
    return result;
  } catch (error) {
    journal.append(plan.operationId, "execution-stopped", {
      command,
      errorName: error?.name ?? "Error",
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
      lockRetainedForReview: false,
    });
    throw error;
  } finally {
    activeExecutionRpc = null;
    lock.release();
  }
}

function assertPlanBase(value, state, plan) {
  assertPlanActionBinding(plan);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcSelection, value.rpcSelection, "RPC selection changed");
  assert.equal(plan.rpcProviderOriginSha256, value.rpcProviderOriginSha256, "RPC provider origin changed");
  assert.equal(plan.controllerProgram, CONTROLLER.toBase58());
  assert.equal(plan.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.targetProgram, TARGET.toBase58());
  assert.equal(plan.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(plan.targetMutationAllowed, false);
  assert.deepEqual(state.targetSnapshot, plan.targetSnapshot, "target Program/ProgramData changed");
  assert.deepEqual(state.governanceSnapshot, plan.governanceSnapshot, "controller governance accounts changed");
  assert.deepEqual(state.initializationSnapshot, plan.initializationSnapshot, "controller initialization attestation changed");
  assert.equal(plan.payer, PAYER.toBase58());
  assert.equal(plan.initializer, INITIALIZER.toBase58());
  assert.equal(plan.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(plan.maxRetries, 0);
  assert.equal(plan.mainnetAllowed, false);
  assert(Number.isSafeInteger(plan.observedSlot) && Number.isSafeInteger(plan.planValidUntilSlot));
  assert.equal(plan.planValidUntilSlot, plan.observedSlot + PLAN_TTL_SLOTS);
  assert(state.slot >= plan.observedSlot, "finalized state read predates the plan observation slot");
  assert(state.slot <= plan.planValidUntilSlot, "plan expired");
}

function assertObservationPlan(value, state, model, plan) {
  assertPlanBase(value, state, plan);
  assert.equal(plan.controllerConfig, state.ids.config.toBase58());
  assert.equal(plan.protocolGate, state.ids.gate.toBase58());
  assert.equal(plan.gateStatus, state.gate.status);
  assert.equal(plan.gateEpoch, state.gate.epoch.toString());
  assert.equal(plan.gateFreezeSlot, state.gate.freezeSlot.toString());
  assert.equal(plan.gateFreezeReasonCode, state.gate.freezeReasonCode);
  assert.equal(plan.capacityPolicy, state.ids.capacityPolicy.toBase58());
  assert.equal(plan.capacityPolicyDigest, state.capacity.policyDigest.toString("hex"));
  assert.equal(plan.controllerRelease, state.ids.controllerRelease.toBase58());
  assert.equal(plan.controllerReleaseDigest, state.release.releaseDigest.toString("hex"));
  assert.equal(plan.generation, model.guard.generation.toString());
  assert.equal(plan.observation, model.observation.toBase58());
  assert.equal(plan.observationBump, model.observationBump);
  assert.equal(plan.subjectDigest, model.subjectDigest.toString("hex"));
  assert.equal(plan.expectedUpgradeAuthority, model.expectedAuthority.present ? INITIALIZER.toBase58() : null);
  assert.equal(plan.deployedSlot, state.controllerProgramdata.deployedSlot.toString());
  assert.equal(plan.programdataRawBytes, state.controllerProgramdata.raw.length);
  assert.equal(plan.programdataRawBase64, state.controllerProgramdata.raw.toString("base64"), "exact ProgramData raw bytes changed");
  assert.equal(plan.programdataRawSha256, model.rawSha256.toString("hex"));
  assert.equal(plan.programdataRawMerkleRoot, model.rawRoot.toString("hex"));
  assert.equal(plan.payloadBytes, state.controllerProgramdata.payload.length);
  assert.equal(plan.artifactBytes, value.artifact.length);
  assert.equal(plan.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(plan.artifactMerkleRoot, state.release.artifactMerkleRoot.toString("hex"));
  assert.equal(plan.rawChunkSize, RAW_CHUNK_SIZE);
  assert.equal(plan.rawChunkCount, model.rawGeometry.chunkCount);
  assert.equal(plan.artifactChunkSize, ARTIFACT_CHUNK_SIZE);
  assert.equal(plan.artifactChunkCount, model.artifactChunkTotal);
  assert.deepEqual(plan.transactions, model.transactions, "exact observation transaction plan changed");
}

async function executeObservation(kind) {
  const command = `execute-${kind}`;
  const schema = `ameba-governance-devnet-controller-immutability-${kind}-observation-plan-v1`;
  const receiptName = kind === "pre" ? FILES.preReceipt : FILES.postReceipt;
  const value = await inputs({ verifyGenesis: false });
  const spec = kind === "pre" ? PLAN_SPECS.pre : PLAN_SPECS.post;
  assert.equal(spec.schema, schema, "observation plan specification schema changed");
  const selectedPlan = await readSelectedPlan(value.runDir, spec, `${kind} observation plan`);
  const plan = selectedPlan.plan;
  await withExecutionLock(value, plan, command, async (journal) => {
    let state = await readBaseState(value);
    assertAuthority(state, kind === "pre");
    let model = buildObservationModel(
      value,
      state,
      kind === "pre" ? PRE_GENERATION : POST_GENERATION,
      kind === "pre" ? optionalAuthority(true, INITIALIZER) : optionalAuthority(false),
    );
    assertObservationPlan(value, state, model, plan);
    for (;;) {
      state = await readBaseState(value);
      assertAuthority(state, kind === "pre");
      model = buildObservationModel(value, state, model.guard.generation, model.expectedAuthority);
      assertObservationPlan(value, state, model, plan);
      const observed = await readObservation(value, model);
      if (!observed.observation) {
        assert.deepEqual(assertVacantPda(observed.account, model.observation, `${kind} observation`), plan.observationInitiallyVacant, "observation vacancy changed");
        await submitControllerInstructions(value, journal, plan, `${kind}:begin`, [model.begin], async () => {
          const immediateState = await readBaseState(value);
          assertAuthority(immediateState, kind === "pre");
          assert.deepEqual(immediateState.targetSnapshot, plan.targetSnapshot, "target changed before observation begin");
          const immediate = await readObservation(value, model);
          assert.equal(immediate.observation, null, "observation became occupied before begin submission");
        });
        continue;
      }
      assertObservationCommon(observed.observation, model, state, `${kind} observation`);
      if (observed.observation.status === ProgramDataObservationStatusV1.Accumulating) {
        const rawIndex = observed.observation.nextRawChunkIndex;
        const artifactIndex = observed.observation.nextArtifactChunkIndex;
        if (rawIndex < model.rawGeometry.chunkCount) {
          assert.equal(artifactIndex, 0, `${kind} artifact verification started before the exact raw scan completed`);
          const stage = `${kind}:append-${String(rawIndex).padStart(3, "0")}`;
          await submitControllerInstructions(value, journal, plan, stage, [model.appends[rawIndex]], async () => {
            const immediateState = await readBaseState(value);
            assertAuthority(immediateState, kind === "pre");
            assert.deepEqual(immediateState.targetSnapshot, plan.targetSnapshot, "target changed before observation append submission");
            const immediate = await readObservation(value, model);
            assert(immediate.observation, "observation disappeared before append submission");
            assertObservationCommon(immediate.observation, model, immediateState, `${kind} observation`);
            assert.equal(immediate.observation.status, ProgramDataObservationStatusV1.Accumulating, "observation status changed before append submission");
            assert.equal(immediate.observation.nextRawChunkIndex, rawIndex, "raw chunk cursor changed before submission");
            assert.equal(immediate.observation.nextArtifactChunkIndex, artifactIndex, "artifact chunk cursor changed before submission");
          });
          continue;
        }
        assert.equal(rawIndex, model.rawGeometry.chunkCount, `${kind} raw chunk cursor exceeds the exact plan`);
        assert(artifactIndex < model.artifactChunkTotal, `${kind} observation is accumulating after all verification chunks`);
        const stage = `${kind}:verify-${String(artifactIndex).padStart(3, "0")}`;
        await submitControllerInstructions(value, journal, plan, stage, [model.verifies[artifactIndex]], async () => {
          const immediateState = await readBaseState(value);
          assertAuthority(immediateState, kind === "pre");
          assert.deepEqual(immediateState.targetSnapshot, plan.targetSnapshot, "target changed before observation verification submission");
          const immediate = await readObservation(value, model);
          assert(immediate.observation, "observation disappeared before verification submission");
          assertObservationCommon(immediate.observation, model, immediateState, `${kind} observation`);
          assert.equal(immediate.observation.status, ProgramDataObservationStatusV1.Accumulating, "observation status changed before verification submission");
          assert.equal(immediate.observation.nextRawChunkIndex, rawIndex, "raw chunk cursor changed before submission");
          assert.equal(immediate.observation.nextArtifactChunkIndex, artifactIndex, "artifact chunk cursor changed before submission");
        });
        continue;
      }
      if (observed.observation.status === ProgramDataObservationStatusV1.ReadyToFinalize) {
        await submitControllerInstructions(value, journal, plan, `${kind}:finalize`, [model.finalize], async () => {
          const immediateState = await readBaseState(value);
          assertAuthority(immediateState, kind === "pre");
          assert.deepEqual(immediateState.targetSnapshot, plan.targetSnapshot, "target changed before observation finalization");
          const immediate = await readObservation(value, model);
          assert(immediate.observation, "observation disappeared before finalization");
          assert.equal(immediate.observation.status, ProgramDataObservationStatusV1.ReadyToFinalize, "observation status changed before finalization");
          assert.equal(immediate.observation.nextRawChunkIndex, model.rawGeometry.chunkCount, "raw scan changed before finalization");
          assert.equal(immediate.observation.nextArtifactChunkIndex, model.artifactChunkTotal, "artifact verification changed before finalization");
        });
        continue;
      }
      assertFinalObservation(observed.observation, model, state, `${kind} observation`);
      const receipt = {
        schema: `ameba-governance-devnet-controller-immutability-${kind}-observation-receipt-v1`,
        operationId: plan.operationId,
        planFile: path.basename(selectedPlan.file),
        observation: model.observation.toBase58(),
        generation: model.guard.generation.toString(),
        authority: model.expectedAuthority.present ? INITIALIZER.toBase58() : null,
        rawBytes: state.controllerProgramdata.raw.length,
        rawSha256: model.rawSha256.toString("hex"),
        rawMerkleRoot: observed.observation.finalRawMerkleRoot.toString("hex"),
        observationDigest: observed.observation.observationDigest.toString("hex"),
        finalizedSlot: observed.observation.finalizedSlot.toString(),
        targetSnapshot: state.targetSnapshot,
        initializationSnapshot: state.initializationSnapshot,
        targetMutationOccurred: false,
        transactions: operationFinalizedTransactions(journal, plan.operationId),
      };
      assert.deepEqual(
        receipt.transactions.map((transaction) => transaction.stage),
        plan.transactions.map((transaction) => `${kind}:${transaction.stage}`),
        `${kind} receipt finalized transaction schedule changed`,
      );
      await writeReceiptOnce(fileInRunDir(value.runDir, receiptName), receipt);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
  });
}

function loaderSetAuthorityFinalInstruction() {
  const instruction = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: CONTROLLER_PROGRAMDATA, isSigner: false, isWritable: true },
      { pubkey: INITIALIZER, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(LOADER_SET_AUTHORITY_DATA),
  });
  assertNoTargetMutationInstruction(instruction);
  return instruction;
}

function expectedPostAuthorityRaw(preRaw) {
  const postRaw = Buffer.from(preRaw);
  assert.equal(postRaw.readUInt32LE(0), 3, "pre-authority ProgramData Loader tag changed");
  assert.equal(postRaw[12], 1, "pre-authority ProgramData authority option is not Some");
  assert(new PublicKey(postRaw.subarray(13, 45)).equals(INITIALIZER), "pre-authority ProgramData authority is not the initializer");
  postRaw[12] = 0;
  return postRaw;
}

function authorityPlanMaterial(value, state, preModel, postSubjectDigest, expectedPostRaw, preObservation) {
  const loaderInstruction = loaderSetAuthorityFinalInstruction();
  return {
    schema: "ameba-governance-devnet-controller-immutability-authority-final-plan-v1",
    command: "execute-authority-final",
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
    observedSlot: value.minContextSlot,
    planValidUntilSlot: value.minContextSlot + PLAN_TTL_SLOTS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    targetMutationAllowed: false,
    targetSnapshot: state.targetSnapshot,
    governanceSnapshot: state.governanceSnapshot,
    initializationSnapshot: state.initializationSnapshot,
    payer: PAYER.toBase58(),
    initializer: INITIALIZER.toBase58(),
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    solanaCli: SOLANA,
    solanaCliVersion: solanaVersion(),
    canonicalCliEncodingReference: [
      "program", "set-upgrade-authority", CONTROLLER.toBase58(),
      "--upgrade-authority", "<reference-only>",
      "--final",
      "--blockhash", "<finalized-blockhash>",
      "--sign-only",
      "--dump-transaction-message",
      "--output", "json",
    ],
    cliSignsOrSubmits: false,
    checkedToNoneEncodable: false,
    checkedToNoneReason: "The pinned Loader SetAuthorityChecked ABI requires a concrete new-authority Pubkey and cannot encode None.",
    terminalMechanism: "Pinned Loader SetAuthority(None), encoded as the exact reviewed tag-4 instruction and signed only through the injected signer provider; this is the Loader's only terminal authority form.",
    signerProviderRequired: true,
    privateKeyFallbackAllowed: false,
    loaderInstruction: instructionSummary(loaderInstruction),
    closedEnvelope: {
      topLevelInstructionCount: 1,
      allowedProgramIds: [BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58()],
      writableAccounts: [CONTROLLER_PROGRAMDATA.toBase58()],
      signerAccounts: [PAYER.toBase58(), INITIALIZER.toBase58()],
      computeBudgetInstructionsAllowed: false,
      nonceInstructionsAllowed: false,
      targetAccountsAllowed: false,
    },
    actionPlanSha256: canonicalActionPlanSha256([{
      stage: "authority-final",
      instructions: [instructionSummary(loaderInstruction)],
    }]),
    preObservation: preModel.observation.toBase58(),
    preObservationDigest: preObservation.observationDigest.toString("hex"),
    preObservationRoot: preObservation.finalRawMerkleRoot.toString("hex"),
    preAuthority: INITIALIZER.toBase58(),
    postAuthority: null,
    authorityDelta: {
      rawOffset: 12,
      beforeHex: "01",
      afterHex: "00",
      semanticTransition: `Some(${INITIALIZER.toBase58()}) -> None`,
      formerAuthorityBytesRetainedAtOffsets13Through44: true,
    },
    deployedSlot: state.controllerProgramdata.deployedSlot.toString(),
    rawBytes: state.controllerProgramdata.raw.length,
    preRawBase64: state.controllerProgramdata.raw.toString("base64"),
    preRawSha256: sha256Hex(state.controllerProgramdata.raw),
    postRawBase64: expectedPostRaw.toString("base64"),
    postRawSha256: sha256Hex(expectedPostRaw),
    postSubjectDigest: postSubjectDigest.toString("hex"),
    postRawMerkleRoot: programDataObservationMerkleRootV1(expectedPostRaw, postSubjectDigest, RAW_CHUNK_SIZE).toString("hex"),
    maxRetries: 0,
    mainnetAllowed: false,
  };
}

async function planAuthorityFinal() {
  const value = await inputs({ verifyGenesis: false });
  await withPlanningLock(value, "plan-authority-final", async () => {
    const state = await readBaseState(value);
    assertAuthority(state, true);
    const preModel = buildObservationModel(value, state, PRE_GENERATION, optionalAuthority(true, INITIALIZER));
    const preBundle = await loadFinalObservationFromPlan(
      value,
      PLAN_SPECS.pre,
      FILES.preReceipt,
      "pre-immutability observation",
    );
    assertFinalObservation(preBundle.observation, preModel, state, "pre-immutability observation");
    const postSubjectDigest = observationSubject(state, POST_GENERATION);
    const expectedPostRaw = expectedPostAuthorityRaw(state.controllerProgramdata.raw);
    const material = authorityPlanMaterial(value, state, preModel, postSubjectDigest, expectedPostRaw, preBundle.observation);
    const plan = { ...material, operationId: operationId(material) };
    const planFile = await writeNonOverwritingPlan(value.runDir, PLAN_SPECS.authority, plan, "authority-final plan");
    process.stdout.write(`${JSON.stringify({
      ...plan,
      planFile: path.basename(planFile),
      planSelection: { environment: PLAN_SPECS.authority.environmentName, value: planFile },
      requiredArm: armValue("execute-authority-final", plan.operationId, plan.actionPlanSha256),
    }, null, 2)}\n`);
  });
}

function assertAuthorityPlan(value, state, plan, expectedPresent) {
  assertPlanBase(value, state, plan);
  assert.equal(plan.solanaCli, SOLANA);
  assert.equal(plan.solanaCliVersion, solanaVersion());
  assert.equal(plan.cliSignsOrSubmits, false, "authority-final plan permits CLI signing or submission");
  assert.deepEqual(plan.canonicalCliEncodingReference, [
    "program", "set-upgrade-authority", CONTROLLER.toBase58(),
    "--upgrade-authority", "<reference-only>",
    "--final",
    "--blockhash", "<finalized-blockhash>",
    "--sign-only",
    "--dump-transaction-message",
    "--output", "json",
  ], "authority-final CLI encoding reference changed");
  assert.equal(plan.checkedToNoneEncodable, false);
  assert.equal(plan.signerProviderRequired, true, "authority-final plan does not require signer-provider injection");
  assert.equal(plan.privateKeyFallbackAllowed, false, "authority-final plan permits a private-key fallback");
  assert.equal(plan.loaderInstruction.dataHex, LOADER_SET_AUTHORITY_DATA.toString("hex"));
  assert.deepEqual(plan.loaderInstruction, instructionSummary(loaderSetAuthorityFinalInstruction()), "Loader SetAuthority(None) instruction changed");
  assert.equal(plan.closedEnvelope.topLevelInstructionCount, 1);
  assert.deepEqual(plan.closedEnvelope.allowedProgramIds, [BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58()]);
  assert.deepEqual(plan.closedEnvelope.writableAccounts, [CONTROLLER_PROGRAMDATA.toBase58()]);
  assert.deepEqual(plan.closedEnvelope.signerAccounts, [PAYER.toBase58(), INITIALIZER.toBase58()]);
  assert.equal(plan.closedEnvelope.computeBudgetInstructionsAllowed, false);
  assert.equal(plan.closedEnvelope.nonceInstructionsAllowed, false);
  assert.equal(plan.closedEnvelope.targetAccountsAllowed, false);
  assert.equal(plan.preAuthority, INITIALIZER.toBase58());
  assert.equal(plan.postAuthority, null);
  assert.equal(plan.rawBytes, state.controllerProgramdata.raw.length);
  assert.equal(plan.deployedSlot, state.controllerProgramdata.deployedSlot.toString());
  if (expectedPresent) {
    assert.equal(plan.preRawBase64, state.controllerProgramdata.raw.toString("base64"), "pre-authority raw bytes changed");
    assert.equal(plan.preRawSha256, sha256Hex(state.controllerProgramdata.raw), "pre-authority raw SHA-256 changed");
    const expectedPostRaw = expectedPostAuthorityRaw(state.controllerProgramdata.raw);
    assert.equal(plan.postRawBase64, expectedPostRaw.toString("base64"), "planned post-authority raw bytes changed");
    assert.equal(plan.postRawSha256, sha256Hex(expectedPostRaw), "planned post-authority raw SHA-256 changed");
  } else {
    assert.equal(plan.postRawBase64, state.controllerProgramdata.raw.toString("base64"), "post-authority raw bytes changed");
    assert.equal(plan.postRawSha256, sha256Hex(state.controllerProgramdata.raw), "post-authority raw SHA-256 changed");
  }
}

function assertAuthorityReceipt(receipt, plan) {
  assert.equal(receipt.schema, "ameba-governance-devnet-controller-immutability-authority-final-receipt-v1", "authority receipt schema changed");
  assert.equal(receipt.operationId, plan.operationId, "authority receipt operation changed");
  assert(
    typeof receipt.planFile === "string" && PLAN_SPECS.authority.pattern.test(receipt.planFile),
    "authority receipt plan filename changed",
  );
  assert.equal(receipt.mechanism, "exact pinned Loader SetAuthority(None) -> injected signer provider", "authority receipt mechanism changed");
  assert.equal(receipt.checkedToNoneEncodable, false, "authority receipt misstates checked-to-None support");
  assert.equal(receipt.controllerProgram, CONTROLLER.toBase58(), "authority receipt controller changed");
  assert.equal(receipt.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58(), "authority receipt ProgramData changed");
  assert.equal(receipt.deployedSlot, plan.deployedSlot, "authority receipt deployed slot changed");
  assert.equal(receipt.preAuthority, INITIALIZER.toBase58(), "authority receipt pre-authority changed");
  assert.equal(receipt.postAuthority, null, "authority receipt does not end at None");
  assert.deepEqual(receipt.authorityDelta, plan.authorityDelta, "authority receipt delta changed");
  assert.equal(receipt.preRawSha256, plan.preRawSha256, "authority receipt pre raw SHA-256 changed");
  assert.equal(receipt.postRawSha256, plan.postRawSha256, "authority receipt post raw SHA-256 changed");
  assert.equal(receipt.postRawMerkleRoot, plan.postRawMerkleRoot, "authority receipt post root changed");
  assert.deepEqual(receipt.targetSnapshot, plan.targetSnapshot, "authority receipt target snapshot changed");
  assert.deepEqual(receipt.initializationSnapshot, plan.initializationSnapshot, "authority receipt initialization attestation changed");
  assert.equal(receipt.targetMutationOccurred, false, "authority receipt reports target mutation");
  assert(Array.isArray(receipt.transactions) && receipt.transactions.length === 1, "authority receipt must contain exactly one finalized transaction");
  assert.equal(receipt.transactions[0].stage, "authority-final", "authority receipt transaction stage changed");
  assert(typeof receipt.transactions[0].signature === "string" && receipt.transactions[0].signature.length > 0, "authority receipt signature is absent");
  assert(typeof receipt.transactions[0].messageSha256 === "string" && /^[0-9a-f]{64}$/u.test(receipt.transactions[0].messageSha256), "authority receipt message hash is absent");
  assert(Number.isSafeInteger(receipt.transactions[0].minContextSlot) && receipt.transactions[0].minContextSlot > 0, "authority receipt minimum context slot is absent");
  assertSignerProviderEvidence(receipt.transactions[0].signerProvider, "authority receipt");
}

async function verifiedAuthorityFinalTransactions(value, journal, plan) {
  const transactions = operationFinalizedTransactions(journal, plan.operationId);
  assert.equal(transactions.length, 1, "immutable controller has no unique finalized authority-final journal proof");
  const [transaction] = transactions;
  assert.equal(transaction.stage, "authority-final", "immutable controller journal stage changed");
  const landed = await rpcExecution(
    journal,
    plan.operationId,
    "authority-final:receipt-reverify",
    "getTransaction",
    () => finalizedTransaction(value, transaction.signature, transaction.messageSha256, transaction.minContextSlot),
  );
  assert(landed, "authority-final journal transaction is not finalized");
  assert.equal(landed.slot, transaction.slot, "authority-final finalized slot changed");
  const expectedMessage = new Transaction({ feePayer: PAYER, recentBlockhash: landed.recentBlockhash })
    .add(loaderSetAuthorityFinalInstruction())
    .compileMessage();
  assert.equal(
    sha256Hex(Buffer.from(expectedMessage.serialize())),
    landed.messageSha256,
    "authority-final finalized envelope differs from the exact one-instruction Loader SetAuthority(None) plan",
  );
  return transactions;
}

function authorityReceiptMaterial(state, plan, transactions, planFile) {
  return {
    schema: "ameba-governance-devnet-controller-immutability-authority-final-receipt-v1",
    operationId: plan.operationId,
    planFile,
    mechanism: "exact pinned Loader SetAuthority(None) -> injected signer provider",
    checkedToNoneEncodable: false,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    deployedSlot: state.controllerProgramdata.deployedSlot.toString(),
    preAuthority: INITIALIZER.toBase58(),
    postAuthority: null,
    authorityDelta: plan.authorityDelta,
    preRawSha256: plan.preRawSha256,
    postRawSha256: plan.postRawSha256,
    postRawMerkleRoot: plan.postRawMerkleRoot,
    targetSnapshot: state.targetSnapshot,
    initializationSnapshot: state.initializationSnapshot,
    targetMutationOccurred: false,
    transactions,
  };
}

async function providerSignedSetAuthorityFinal(value, plan, latestBlockhash, displayedAction) {
  const unsigned = new Transaction({ feePayer: PAYER, recentBlockhash: latestBlockhash.blockhash })
    .add(loaderSetAuthorityFinalInstruction());
  const expectedMessage = new Transaction({ feePayer: PAYER, recentBlockhash: latestBlockhash.blockhash })
    .add(loaderSetAuthorityFinalInstruction())
    .compileMessage();
  assert(
    Buffer.from(unsigned.compileMessage().serialize()).equals(Buffer.from(expectedMessage.serialize())),
    "authority-final unsigned message differs from the exact one-instruction Loader envelope",
  );
  const provider = await loadSignerProviderAfterDisplayedAction(
    value,
    displayedAction,
    plan,
    "authority-final",
  );
  return signTransactionWithProvider({
    providerValue: provider,
    transaction: unsigned,
    expectedSigners: [PAYER, INITIALIZER],
    operationId: plan.operationId,
    stage: "authority-final",
  });
}

async function executeAuthorityFinal() {
  const value = await inputs({ verifyGenesis: false });
  const selectedPlan = await readSelectedPlan(value.runDir, PLAN_SPECS.authority, "authority-final plan");
  const plan = selectedPlan.plan;
  await withExecutionLock(value, plan, "execute-authority-final", async (journal) => {
    let state = await readBaseState(value);
    const alreadyImmutable = !state.controllerProgramdata.authority.present;
    assertAuthorityPlan(value, state, plan, !alreadyImmutable);
    if (alreadyImmutable) {
      assert.equal(state.controllerProgramdata.raw.toString("base64"), plan.postRawBase64, "immutable ProgramData raw bytes differ from the exact planned delta");
      assert.deepEqual(state.targetSnapshot, plan.targetSnapshot, "target changed during controller immutability transition");
      const transactions = await verifiedAuthorityFinalTransactions(value, journal, plan);
      const receipt = authorityReceiptMaterial(state, plan, transactions, path.basename(selectedPlan.file));
      assertAuthorityReceipt(receipt, plan);
      await writeReceiptOnce(fileInRunDir(value.runDir, FILES.authorityReceipt), receipt);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
    assertAuthority(state, true);
    const preModel = buildObservationModel(value, state, PRE_GENERATION, optionalAuthority(true, INITIALIZER));
    const pre = await readObservation(value, preModel);
    assert(pre.observation, "pre-immutability observation is absent");
    assertFinalObservation(pre.observation, preModel, state, "pre-immutability observation");
    assert.equal(pre.observation.observationDigest.toString("hex"), plan.preObservationDigest, "pre-observation digest changed");
    assert.equal(pre.observation.finalRawMerkleRoot.toString("hex"), plan.preObservationRoot, "pre-observation root changed");

    const pending = await reconcilePrepared(value, journal, plan.operationId, "authority-final");
    if (!pending) {
      const latest = await latestFinalizedBlockhash(value, journal, plan.operationId, "authority-final");
      const verifyAuthorityState = async () => {
        const immediate = await readBaseState(value);
        assertAuthority(immediate, true);
        assertAuthorityPlan(value, immediate, plan, true);
        const exactPre = await readObservation(value, preModel);
        assert(exactPre.observation, "pre observation disappeared before authority submission");
        assertFinalObservation(exactPre.observation, preModel, immediate, "pre-immutability observation");
      };
      await recordFinalizedReread(value, journal, plan, "authority-final", "pre-sign", verifyAuthorityState);
      await assertBlockhashValidAtCurrentContext(
        value,
        journal,
        plan,
        "authority-final",
        latest.blockhash,
        "signing",
      );
      const authorityInstruction = loaderSetAuthorityFinalInstruction();
      const displayedAction = displayCanonicalDecodedAction(
        journal,
        plan,
        "authority-final",
        [authorityInstruction],
        [PAYER, INITIALIZER],
      );
      const signed = await providerSignedSetAuthorityFinal(value, plan, latest, displayedAction);
      await submitSignedTransaction(
        value,
        journal,
        plan,
        "authority-final",
        signed.transaction,
        latest,
        verifyAuthorityState,
        signed.providerEvidence,
      );
    }
    state = await readBaseState(value);
    assertAuthority(state, false);
    assertAuthorityPlan(value, state, plan, false);
    assert.equal(state.controllerProgramdata.raw.toString("base64"), plan.postRawBase64, "finalized SetAuthority(None) raw bytes differ from the exact planned delta");
    assert.deepEqual(state.targetSnapshot, plan.targetSnapshot, "target changed during controller immutability transition");
    const transactions = await verifiedAuthorityFinalTransactions(value, journal, plan);
    const receipt = authorityReceiptMaterial(state, plan, transactions, path.basename(selectedPlan.file));
    assertAuthorityReceipt(receipt, plan);
    await writeReceiptOnce(fileInRunDir(value.runDir, FILES.authorityReceipt), receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  });
}

async function loadFinalObservationFromPlan(value, spec, receiptName, label) {
  const receiptFile = await readSecureJson(value.runDir, receiptName, `${label} receipt`);
  const receipt = receiptFile.value;
  assert(
    typeof receipt.planFile === "string" && spec.pattern.test(receipt.planFile),
    `${label} receipt plan filename changed`,
  );
  const selectedPlan = await readExactPlan(
    value.runDir,
    fileInRunDir(value.runDir, receipt.planFile),
    spec,
    `${label} plan`,
  );
  const plan = selectedPlan.plan;
  assert.equal(receipt.operationId, plan.operationId, `${label} receipt operation changed`);
  assert.equal(receipt.observation, plan.observation, `${label} receipt observation changed`);
  assert.equal(receipt.targetMutationOccurred, false, `${label} receipt reports target mutation`);
  assert.deepEqual(receipt.targetSnapshot, plan.targetSnapshot, `${label} receipt target snapshot changed`);
  assert.deepEqual(receipt.initializationSnapshot, plan.initializationSnapshot, `${label} receipt initialization attestation changed`);
  assert(Array.isArray(receipt.transactions), `${label} receipt transaction list is absent`);
  const prefix = plan.command === "execute-pre" ? "pre" : "post";
  assert.deepEqual(
    receipt.transactions.map((transaction) => transaction.stage),
    plan.transactions.map((transaction) => `${prefix}:${transaction.stage}`),
    `${label} finalized transaction schedule changed`,
  );
  for (const transaction of receipt.transactions) {
    assert(typeof transaction.signature === "string" && transaction.signature.length > 0, `${label} finalized signature is absent`);
    assert(typeof transaction.messageSha256 === "string" && /^[0-9a-f]{64}$/u.test(transaction.messageSha256), `${label} finalized message hash is absent`);
    assert(Number.isSafeInteger(transaction.minContextSlot) && transaction.minContextSlot > 0, `${label} finalized minimum context slot is absent`);
    assertSignerProviderEvidence(transaction.signerProvider, label);
  }
  const address = new PublicKey(plan.observation);
  const response = await readOneAccount(value, address);
  assertAccount(response.value, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, label);
  const observation = deserializeProgramDataObservationV1(response.value.data);
  validateProgramDataObservationDigestV1(observation);
  assert.equal(observation.status, ProgramDataObservationStatusV1.Finalized, `${label} is not finalized`);
  assert.equal(observation.observationDigest.toString("hex"), receipt.observationDigest, `${label} digest changed`);
  assert.equal(observation.finalRawMerkleRoot.toString("hex"), receipt.rawMerkleRoot, `${label} root changed`);
  assert.equal(observation.generation.toString(), plan.generation, `${label} generation changed`);
  assert.equal(observation.subjectDigest.toString("hex"), plan.subjectDigest, `${label} subject changed`);
  assert.equal(observation.rawDataLength.toString(), String(plan.programdataRawBytes), `${label} raw length changed`);
  assert.equal(plan.programdataRawSha256, receipt.rawSha256, `${label} raw SHA receipt changed`);
  return { observation, plan, planFile: selectedPlan.file, receipt };
}

function expectedImmutabilityReceipt(state, preAddress, pre, postAddress, post) {
  const value = {
    discriminator: CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: state.ids.immutabilityReceiptBump,
    initialized: true,
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    capacityPolicy: state.ids.capacityPolicy,
    capacityPolicyDigest: state.capacity.policyDigest,
    releaseCommitment: state.ids.controllerRelease,
    releaseCommitmentDigest: state.release.releaseDigest,
    preObservation: preAddress,
    preObservationGeneration: pre.generation,
    preObservationRoot: pre.finalRawMerkleRoot,
    preObservationDigest: pre.observationDigest,
    preUpgradeAuthority: pre.upgradeAuthority,
    postObservation: postAddress,
    postObservationGeneration: post.generation,
    postObservationRoot: post.finalRawMerkleRoot,
    postObservationDigest: post.observationDigest,
    postUpgradeAuthority: post.upgradeAuthority,
    deployedSlot: post.deployedSlot,
    rawProgramdataLength: post.rawDataLength,
    programdataCapacity: post.actualCapacity,
    artifactLength: state.release.artifactLength,
    artifactSha256: state.release.artifactSha256,
    artifactMerkleRoot: state.release.artifactMerkleRoot,
    artifactSchemeId: state.release.artifactSchemeId,
    sourceCommitment: state.release.sourceCommitment,
    buildInputsCommitment: state.release.buildInputsCommitment,
    packageCommitment: state.release.packageCommitment,
    releaseManifestCommitment: state.release.releaseManifestCommitment,
    finalizedSlot: post.finalizedSlot,
    receiptDigest: Buffer.from(ZERO_32),
    finalized: true,
    reserved: Buffer.alloc(CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN),
  };
  value.receiptDigest = controllerImmutabilityReceiptDigestV1(value);
  validateControllerImmutabilityReceiptDigestV1(value);
  return value;
}

function assertAuthorityDelta(pre, post, prePlan, postPlan) {
  assert(pre.upgradeAuthority.present && pre.upgradeAuthority.value.equals(INITIALIZER), "pre observation does not bind Some(initializer)");
  assert.equal(post.upgradeAuthority.present, false, "post observation does not bind None");
  assert(post.upgradeAuthority.value.equals(PublicKey.default), "post observation absent authority is noncanonical");
  assert.equal(pre.deployedSlot, post.deployedSlot, "controller deployed slot changed across immutability");
  assert.equal(pre.rawDataLength, post.rawDataLength, "controller raw length changed across immutability");
  assert.equal(pre.actualCapacity, post.actualCapacity, "controller capacity changed across immutability");
  assert.equal(pre.expectedArtifactLength, post.expectedArtifactLength, "controller artifact length changed across immutability");
  assert(pre.expectedArtifactSha256.equals(post.expectedArtifactSha256), "controller artifact SHA-256 changed across immutability");
  assert(pre.expectedArtifactMerkleRoot.equals(post.expectedArtifactMerkleRoot), "controller artifact root changed across immutability");
  assert(pre.expectedArtifactSchemeId.equals(post.expectedArtifactSchemeId), "controller artifact scheme changed across immutability");
  const preRaw = Buffer.from(prePlan.programdataRawBase64, "base64");
  const postRaw = Buffer.from(postPlan.programdataRawBase64, "base64");
  assert(postRaw.equals(expectedPostAuthorityRaw(preRaw)), "pre/post exact raw bytes differ by more than the Loader authority option byte");
  assert.equal(prePlan.programdataRawSha256, sha256Hex(preRaw), "pre raw SHA-256 plan changed");
  assert.equal(postPlan.programdataRawSha256, sha256Hex(postRaw), "post raw SHA-256 plan changed");
  assert.notEqual(pre.finalRawMerkleRoot.toString("hex"), post.finalRawMerkleRoot.toString("hex"), "authority delta did not change the generation-bound raw root");
}

function recordInstruction(state, preAddress, postAddress, receiptValue) {
  const instruction = buildRecordControllerImmutabilityV1Instruction(CONTROLLER, {
    payer: PAYER,
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    controllerConfig: state.ids.config,
    capacityPolicy: state.ids.capacityPolicy,
    controllerRelease: state.ids.controllerRelease,
    preObservation: preAddress,
    postObservation: postAddress,
    immutabilityReceipt: state.ids.immutabilityReceipt,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }, {
    expectedCapacityPolicyDigest: state.capacity.policyDigest,
    expectedReleaseDigest: state.release.releaseDigest,
    expectedPreObservationDigest: receiptValue.preObservationDigest,
    expectedPostObservationDigest: receiptValue.postObservationDigest,
    expectedReceiptDigest: receiptValue.receiptDigest,
  });
  assertNoTargetMutationInstruction(instruction);
  return instruction;
}

function recordPlanMaterial(value, state, preBundle, postBundle, receiptValue, vacancy, instruction) {
  return {
    schema: "ameba-governance-devnet-controller-immutability-record-plan-v1",
    command: "execute-record",
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
    observedSlot: value.minContextSlot,
    planValidUntilSlot: value.minContextSlot + PLAN_TTL_SLOTS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    targetMutationAllowed: false,
    targetSnapshot: state.targetSnapshot,
    governanceSnapshot: state.governanceSnapshot,
    initializationSnapshot: state.initializationSnapshot,
    payer: PAYER.toBase58(),
    initializer: INITIALIZER.toBase58(),
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    controllerConfig: state.ids.config.toBase58(),
    capacityPolicy: state.ids.capacityPolicy.toBase58(),
    capacityPolicyDigest: state.capacity.policyDigest.toString("hex"),
    controllerRelease: state.ids.controllerRelease.toBase58(),
    controllerReleaseDigest: state.release.releaseDigest.toString("hex"),
    preObservation: preBundle.plan.observation,
    preObservationGeneration: preBundle.observation.generation.toString(),
    preObservationDigest: preBundle.observation.observationDigest.toString("hex"),
    preRawSha256: preBundle.plan.programdataRawSha256,
    preRawMerkleRoot: preBundle.observation.finalRawMerkleRoot.toString("hex"),
    preUpgradeAuthority: INITIALIZER.toBase58(),
    postObservation: postBundle.plan.observation,
    postObservationGeneration: postBundle.observation.generation.toString(),
    postObservationDigest: postBundle.observation.observationDigest.toString("hex"),
    postRawSha256: postBundle.plan.programdataRawSha256,
    postRawMerkleRoot: postBundle.observation.finalRawMerkleRoot.toString("hex"),
    postUpgradeAuthority: null,
    authorityDelta: {
      rawOffset: 12,
      beforeHex: "01",
      afterHex: "00",
      semanticTransition: `Some(${INITIALIZER.toBase58()}) -> None`,
      allOtherRawBytesUnchanged: true,
    },
    immutabilityReceipt: state.ids.immutabilityReceipt.toBase58(),
    immutabilityReceiptBump: state.ids.immutabilityReceiptBump,
    immutabilityReceiptInitiallyVacant: vacancy,
    expectedReceiptDigest: receiptValue.receiptDigest.toString("hex"),
    instruction: instructionSummary(instruction),
    closedEnvelope: {
      topLevelInstructionCount: 1,
      allowedProgramIds: [CONTROLLER.toBase58()],
      targetAccountsAllowed: false,
      computeBudgetInstructionsAllowed: false,
      nonceInstructionsAllowed: false,
    },
    actionPlanSha256: canonicalActionPlanSha256([{
      stage: "record-controller-immutability",
      instructions: [instructionSummary(instruction)],
    }]),
    maxRetries: 0,
    mainnetAllowed: false,
  };
}

async function planRecord() {
  const value = await inputs({ verifyGenesis: false });
  await withPlanningLock(value, "plan-record", async () => {
    const state = await readBaseState(value);
    assertAuthority(state, false);
    const preBundle = await loadFinalObservationFromPlan(
      value,
      PLAN_SPECS.pre,
      FILES.preReceipt,
      "pre-immutability observation",
    );
    const postBundle = await loadFinalObservationFromPlan(
      value,
      PLAN_SPECS.post,
      FILES.postReceipt,
      "post-immutability observation",
    );
    assertAuthorityDelta(preBundle.observation, postBundle.observation, preBundle.plan, postBundle.plan);
    assert.equal(state.controllerProgramdata.raw.toString("base64"), postBundle.plan.programdataRawBase64, "current immutable ProgramData bytes changed");
    const receiptValue = expectedImmutabilityReceipt(
      state,
      new PublicKey(preBundle.plan.observation),
      preBundle.observation,
      new PublicKey(postBundle.plan.observation),
      postBundle.observation,
    );
    const instruction = recordInstruction(state, receiptValue.preObservation, receiptValue.postObservation, receiptValue);
    const receiptResponse = await readOneAccount(value, state.ids.immutabilityReceipt);
    const vacancy = assertVacantPda(receiptResponse.value, state.ids.immutabilityReceipt, "controller immutability receipt");
    const material = recordPlanMaterial(value, state, preBundle, postBundle, receiptValue, vacancy, instruction);
    const plan = { ...material, operationId: operationId(material) };
    const planFile = await writeNonOverwritingPlan(value.runDir, PLAN_SPECS.record, plan, "record plan");
    process.stdout.write(`${JSON.stringify({
      ...plan,
      planFile: path.basename(planFile),
      planSelection: { environment: PLAN_SPECS.record.environmentName, value: planFile },
      requiredArm: armValue("execute-record", plan.operationId, plan.actionPlanSha256),
    }, null, 2)}\n`);
  });
}

function assertRecordPlan(value, state, preBundle, postBundle, receiptValue, instruction, plan) {
  assertPlanBase(value, state, plan);
  assert.equal(plan.controllerConfig, state.ids.config.toBase58());
  assert.equal(plan.capacityPolicy, state.ids.capacityPolicy.toBase58());
  assert.equal(plan.capacityPolicyDigest, state.capacity.policyDigest.toString("hex"));
  assert.equal(plan.controllerRelease, state.ids.controllerRelease.toBase58());
  assert.equal(plan.controllerReleaseDigest, state.release.releaseDigest.toString("hex"));
  assert.equal(plan.preObservation, preBundle.plan.observation);
  assert.equal(plan.preObservationGeneration, preBundle.observation.generation.toString());
  assert.equal(plan.preObservationDigest, preBundle.observation.observationDigest.toString("hex"));
  assert.equal(plan.preRawSha256, preBundle.plan.programdataRawSha256);
  assert.equal(plan.preRawMerkleRoot, preBundle.observation.finalRawMerkleRoot.toString("hex"));
  assert.equal(plan.preUpgradeAuthority, INITIALIZER.toBase58());
  assert.equal(plan.postObservation, postBundle.plan.observation);
  assert.equal(plan.postObservationGeneration, postBundle.observation.generation.toString());
  assert.equal(plan.postObservationDigest, postBundle.observation.observationDigest.toString("hex"));
  assert.equal(plan.postRawSha256, postBundle.plan.programdataRawSha256);
  assert.equal(plan.postRawMerkleRoot, postBundle.observation.finalRawMerkleRoot.toString("hex"));
  assert.equal(plan.postUpgradeAuthority, null);
  assert.equal(plan.immutabilityReceipt, state.ids.immutabilityReceipt.toBase58());
  assert.equal(plan.immutabilityReceiptBump, state.ids.immutabilityReceiptBump);
  assert.equal(plan.expectedReceiptDigest, receiptValue.receiptDigest.toString("hex"));
  assert.deepEqual(plan.instruction, instructionSummary(instruction), "RecordControllerImmutabilityV1 instruction changed");
  assert.equal(plan.closedEnvelope.topLevelInstructionCount, 1);
  assert.deepEqual(plan.closedEnvelope.allowedProgramIds, [CONTROLLER.toBase58()]);
  assert.equal(plan.closedEnvelope.targetAccountsAllowed, false);
  assert.equal(plan.closedEnvelope.computeBudgetInstructionsAllowed, false);
  assert.equal(plan.closedEnvelope.nonceInstructionsAllowed, false);
}

async function executeRecord() {
  const value = await inputs({ verifyGenesis: false });
  const selectedPlan = await readSelectedPlan(value.runDir, PLAN_SPECS.record, "record plan");
  const plan = selectedPlan.plan;
  await withExecutionLock(value, plan, "execute-record", async (journal) => {
    let state = await readBaseState(value);
    assertAuthority(state, false);
    const preBundle = await loadFinalObservationFromPlan(
      value,
      PLAN_SPECS.pre,
      FILES.preReceipt,
      "pre-immutability observation",
    );
    const postBundle = await loadFinalObservationFromPlan(
      value,
      PLAN_SPECS.post,
      FILES.postReceipt,
      "post-immutability observation",
    );
    assertAuthorityDelta(preBundle.observation, postBundle.observation, preBundle.plan, postBundle.plan);
    const receiptValue = expectedImmutabilityReceipt(
      state,
      new PublicKey(preBundle.plan.observation),
      preBundle.observation,
      new PublicKey(postBundle.plan.observation),
      postBundle.observation,
    );
    const instruction = recordInstruction(state, receiptValue.preObservation, receiptValue.postObservation, receiptValue);
    assertRecordPlan(value, state, preBundle, postBundle, receiptValue, instruction, plan);
    let receiptResponse = await readOneAccount(value, state.ids.immutabilityReceipt);
    if (receiptResponse.value === null || (receiptResponse.value.owner.equals(SystemProgram.programId) && receiptResponse.value.data.length === 0)) {
      assert.deepEqual(assertVacantPda(receiptResponse.value, state.ids.immutabilityReceipt, "controller immutability receipt"), plan.immutabilityReceiptInitiallyVacant, "receipt vacancy changed");
      await submitControllerInstructions(value, journal, plan, "record-controller-immutability", [instruction], async () => {
        const immediateState = await readBaseState(value);
        assertAuthority(immediateState, false);
        assert.deepEqual(immediateState.targetSnapshot, plan.targetSnapshot, "target changed before immutability record submission");
        const immediateReceipt = await readOneAccount(value, state.ids.immutabilityReceipt);
        assert.deepEqual(
          assertVacantPda(immediateReceipt.value, state.ids.immutabilityReceipt, "controller immutability receipt"),
          plan.immutabilityReceiptInitiallyVacant,
          "immutability receipt vacancy changed before submission",
        );
        const immediatePre = await readOneAccount(value, receiptValue.preObservation);
        const immediatePost = await readOneAccount(value, receiptValue.postObservation);
        assertAccount(immediatePre.value, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, "pre-immutability observation");
        assertAccount(immediatePost.value, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, "post-immutability observation");
        assert.equal(deserializeProgramDataObservationV1(immediatePre.value.data).observationDigest.toString("hex"), plan.preObservationDigest, "pre observation changed before submission");
        assert.equal(deserializeProgramDataObservationV1(immediatePost.value.data).observationDigest.toString("hex"), plan.postObservationDigest, "post observation changed before submission");
      });
    }
    state = await readBaseState(value);
    assertAuthority(state, false);
    assert.deepEqual(state.targetSnapshot, plan.targetSnapshot, "target changed while recording controller immutability");
    receiptResponse = await readOneAccount(value, state.ids.immutabilityReceipt);
    assertAccount(receiptResponse.value, CONTROLLER, CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN, "controller immutability receipt");
    const exactReceiptBytes = serializeControllerImmutabilityReceiptV1(receiptValue);
    assert(receiptResponse.value.data.equals(exactReceiptBytes), "controller immutability receipt bytes differ from the exact plan");
    const stored = deserializeControllerImmutabilityReceiptV1(receiptResponse.value.data);
    validateControllerImmutabilityReceiptDigestV1(stored);
    assert(stored.receiptDigest.equals(receiptValue.receiptDigest), "controller immutability receipt digest changed");
    const transactions = operationFinalizedTransactions(journal, plan.operationId);
    assert.deepEqual(
      transactions.map((transaction) => transaction.stage),
      ["record-controller-immutability"],
      "record receipt finalized transaction schedule changed",
    );
    const recordProof = transactions[0];
    assertSignerProviderEvidence(recordProof.signerProvider, "record-controller-immutability receipt");
    const landed = await rpcExecution(
      journal,
      plan.operationId,
      "record-controller-immutability:receipt-reverify",
      "getTransaction",
      () => finalizedTransaction(value, recordProof.signature, recordProof.messageSha256, recordProof.minContextSlot),
    );
    assert(landed, "record-controller-immutability journal transaction is not finalized");
    assert.equal(landed.slot, recordProof.slot, "record-controller-immutability finalized slot changed");
    const receipt = {
      schema: "ameba-governance-devnet-controller-immutability-record-receipt-v1",
      operationId: plan.operationId,
      planFile: path.basename(selectedPlan.file),
      immutabilityReceipt: state.ids.immutabilityReceipt.toBase58(),
      receiptDigest: stored.receiptDigest.toString("hex"),
      preObservation: stored.preObservation.toBase58(),
      preObservationDigest: stored.preObservationDigest.toString("hex"),
      preRawMerkleRoot: stored.preObservationRoot.toString("hex"),
      preAuthority: stored.preUpgradeAuthority.value.toBase58(),
      postObservation: stored.postObservation.toBase58(),
      postObservationDigest: stored.postObservationDigest.toString("hex"),
      postRawMerkleRoot: stored.postObservationRoot.toString("hex"),
      postAuthority: null,
      rawBytes: stored.rawProgramdataLength.toString(),
      capacityBytes: stored.programdataCapacity.toString(),
      artifactBytes: stored.artifactLength.toString(),
      artifactSha256: stored.artifactSha256.toString("hex"),
      finalizedSlot: stored.finalizedSlot.toString(),
      targetSnapshot: state.targetSnapshot,
      initializationSnapshot: state.initializationSnapshot,
      targetMutationOccurred: false,
      transactions,
    };
    await writeReceiptOnce(fileInRunDir(value.runDir, FILES.recordReceipt), receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  });
}

async function selfTest() {
  assert.doesNotThrow(() => assertStateRpcSelection("state"));
  for (const selection of ["history", "helius-state", ""]) {
    assert.throws(
      () => assertStateRpcSelection(selection),
      undefined,
      `state-RPC self-test accepted ${selection || "empty"}`,
    );
  }

  const expectedCatchUpMethods = [
    "getAccountInfoAndContext",
    "getBlockHeight",
    "getGenesisHash",
    "getLatestBlockhashAndContext",
    "getMultipleAccountsInfoAndContext",
    "getSignatureStatuses",
    "getSlot",
    "getTransaction",
    "isBlockhashValid",
  ];
  assert.deepEqual(
    [...MINIMUM_CONTEXT_CATCH_UP_READ_METHODS].sort(),
    expectedCatchUpMethods,
    "minimum-context catch-up method allowlist changed",
  );
  assert.equal(MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS, 20);
  assert.equal(MINIMUM_CONTEXT_CATCH_UP_DELAY_MS, 2_000);
  const minimumContextErrors = [
    Object.assign(new Error("RPC -32016: Minimum context slot not reached"), { code: -32016 }),
    Object.assign(new Error("Minimum context slot has not been reached (-32016)"), { code: -32016 }),
  ];
  for (const error of minimumContextErrors) {
    assert.equal(isMinimumContextSlotNotReached(error), true, `minimum-context wording was rejected: ${error.message}`);
  }
  assert.equal(
    isMinimumContextSlotNotReached(Object.assign(new Error("Minimum context slot has not been reached"), { code: -32015 })),
    false,
    "minimum-context catch-up accepted the wrong RPC code",
  );
  assert.equal(
    isMinimumContextSlotNotReached(Object.assign(new Error("different RPC failure"), { code: -32016 })),
    false,
    "minimum-context catch-up accepted the wrong RPC wording",
  );

  const catchUpJournal = () => {
    const entries = [];
    return {
      entries,
      append(operationIdValue, event, payload) {
        entries.push({ operationId: operationIdValue, event, payload });
      },
      recover() {
        return entries;
      },
    };
  };
  const catchUpOperationId = "c".repeat(64);
  const successfulCatchUpJournal = catchUpJournal();
  let catchUpAttempts = 0;
  const caughtUp = await rpcExecution(
    successfulCatchUpJournal,
    catchUpOperationId,
    "self-test:blockhash",
    "getLatestBlockhashAndContext",
    async () => {
      catchUpAttempts += 1;
      if (catchUpAttempts < 3) throw minimumContextErrors[catchUpAttempts - 1];
      return "caught-up";
    },
    { maxAttempts: 3, delayMs: 0 },
  );
  assert.equal(caughtUp, "caught-up");
  assert.equal(catchUpAttempts, 3);
  assert.deepEqual(
    successfulCatchUpJournal.entries.map((entry) => entry.event),
    ["minimum-context-catch-up", "minimum-context-catch-up"],
  );
  assert(successfulCatchUpJournal.entries.every((entry) => (
    entry.payload.method === "getLatestBlockhashAndContext"
      && entry.payload.automaticTransactionRetry === false
  )), "minimum-context retries do not preserve read-only evidence");

  const exhaustedCatchUpJournal = catchUpJournal();
  let exhaustedAttempts = 0;
  await assert.rejects(
    () => rpcExecution(
      exhaustedCatchUpJournal,
      catchUpOperationId,
      "self-test:exhaustion",
      "getAccountInfoAndContext",
      async () => {
        exhaustedAttempts += 1;
        throw minimumContextErrors[1];
      },
      { maxAttempts: 2, delayMs: 0 },
    ),
    /Minimum context slot has not been reached/u,
  );
  assert.equal(exhaustedAttempts, 2);
  assert.deepEqual(
    exhaustedCatchUpJournal.entries.map((entry) => entry.event),
    ["minimum-context-catch-up", "minimum-context-catch-up-exhausted"],
  );

  const rateLimitJournal = catchUpJournal();
  let rateLimitAttempts = 0;
  const rateLimitError = Object.assign(
    new Error("429 Minimum context slot has not been reached (-32016)"),
    { code: -32016, status: 429 },
  );
  await assert.rejects(
    () => rpcExecution(
      rateLimitJournal,
      catchUpOperationId,
      "self-test:rate-limit",
      "isBlockhashValid",
      async () => {
        rateLimitAttempts += 1;
        throw rateLimitError;
      },
      { maxAttempts: 3, delayMs: 0 },
    ),
    /429/u,
  );
  assert.equal(rateLimitAttempts, 1, "first-429 self-test retried a read");
  assert.deepEqual(rateLimitJournal.entries.map((entry) => entry.event), ["rpc-rate-limit-exit"]);

  let sendCallbackCalled = false;
  await assert.rejects(
    () => rpcExecution(
      catchUpJournal(),
      catchUpOperationId,
      "self-test:send",
      "sendRawTransaction",
      async () => {
        sendCallbackCalled = true;
      },
      { maxAttempts: 1, delayMs: 0 },
    ),
    /not an admitted catch-up read/u,
  );
  assert.equal(sendCallbackCalled, false, "minimum-context catch-up invoked sendRawTransaction");

  const loaderInstruction = loaderSetAuthorityFinalInstruction();
  const loaderSummary = instructionSummary(loaderInstruction);
  const actionSchedule = [{ stage: "authority-final", instructions: [loaderSummary] }];
  const actionPlanSha256 = canonicalActionPlanSha256(actionSchedule);
  const testPlan = {
    command: "execute-authority-final",
    operationId: "a".repeat(64),
    actionPlanSha256,
    loaderInstruction: loaderSummary,
  };
  assert.deepEqual(assertPlanActionBinding(testPlan), actionSchedule);
  const decoded = canonicalDecodedAction(
    testPlan,
    "authority-final",
    [loaderInstruction],
    [PAYER, INITIALIZER],
  );
  assert.equal(decoded.action.actionPlanSha256, actionPlanSha256);
  assert.deepEqual(decoded.action.signerAccounts, [PAYER, INITIALIZER].map((key) => key.toBase58()));
  assert.doesNotThrow(() => assertDisplayedActionAuthorization(decoded, testPlan, "authority-final"));
  assert.throws(
    () => assertDisplayedActionAuthorization(
      { ...decoded, actionSha256: "0".repeat(64) },
      testPlan,
      "authority-final",
    ),
    undefined,
    "signer-provider gate accepted a decoded action with the wrong action hash",
  );
  assert.throws(
    () => canonicalDecodedAction(
      testPlan,
      "authority-final",
      [new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        keys: loaderInstruction.keys,
        data: Buffer.from([0xff]),
      })],
      [PAYER, INITIALIZER],
    ),
    undefined,
    "decoded-action self-test accepted changed instruction bytes",
  );

  const previousArm = process.env.AMEBA_CONTROLLER_IMMUTABILITY_ARM;
  try {
    process.env.AMEBA_CONTROLLER_IMMUTABILITY_ARM = armValue(
      testPlan.command,
      testPlan.operationId,
      testPlan.actionPlanSha256,
    );
    assert.doesNotThrow(() => requireArm(testPlan.command, testPlan));
    process.env.AMEBA_CONTROLLER_IMMUTABILITY_ARM = `${testPlan.command}:${testPlan.operationId}:${"0".repeat(64)}`;
    assert.throws(
      () => requireArm(testPlan.command, testPlan),
      undefined,
      "action-plan arming self-test accepted the wrong action hash",
    );
  } finally {
    if (previousArm === undefined) delete process.env.AMEBA_CONTROLLER_IMMUTABILITY_ARM;
    else process.env.AMEBA_CONTROLLER_IMMUTABILITY_ARM = previousArm;
  }

  const rereadEvents = [];
  const rereadJournal = {
    append(operationIdValue, event, payload) {
      rereadEvents.push({ event, operationId: operationIdValue, payload });
    },
  };
  const rereadValue = { minContextSlot: 100 };
  let rereadCount = 0;
  const reread = async () => {
    rereadCount += 1;
    rereadValue.minContextSlot += 1;
  };
  await recordFinalizedReread(rereadValue, rereadJournal, testPlan, "authority-final", "pre-sign", reread);
  await recordFinalizedReread(rereadValue, rereadJournal, testPlan, "authority-final", "pre-submit", reread);
  assert.equal(rereadCount, 2, "pre-sign and pre-submit did not perform distinct finalized rereads");
  assert.deepEqual(
    rereadEvents.map((entry) => entry.event),
    ["pre-sign-state-verified", "pre-submit-state-verified"],
  );
  assert.deepEqual(
    rereadEvents.map((entry) => entry.payload.observationSlot),
    [101, 102],
  );

  const priorPlan = { operationId: "b".repeat(64) };
  assert.doesNotThrow(() => assertJournalEntriesAllowReplan([], priorPlan));
  assert.doesNotThrow(() => assertJournalEntriesAllowReplan([
    { operationId: priorPlan.operationId, event: "transaction-prepared", payload: { stage: "pre:begin", signature: "expired" } },
    { operationId: priorPlan.operationId, event: "transaction-expired-not-landed", payload: { stage: "pre:begin", signature: "expired" } },
  ], priorPlan));
  assert.throws(
    () => assertJournalEntriesAllowReplan([
      { operationId: priorPlan.operationId, event: "transaction-prepared", payload: { stage: "pre:begin", signature: "pending" } },
    ], priorPlan),
    undefined,
    "replan self-test accepted an unresolved prepared transaction",
  );
  assert.throws(
    () => assertJournalEntriesAllowReplan([
      { operationId: priorPlan.operationId, event: "transaction-finalized", payload: { stage: "pre:begin", signature: "landed" } },
    ], priorPlan),
    undefined,
    "replan self-test accepted a prior finalized transaction",
  );
  for (const spec of Object.values(PLAN_SPECS)) {
    const basename = suffixedPlanBasename(spec, priorPlan.operationId);
    assert(spec.pattern.test(basename), `replan filename self-test rejected ${basename}`);
  }
  assert.equal(FINALIZED_STATUS_POLL_INTERVAL_MS, 30_000, "finalized status polling is faster than 30 seconds");

  return {
    ok: true,
    actionPlanSha256,
    decodedActionSha256: decoded.actionSha256,
    finalizedRereadPhases: rereadEvents.map((entry) => entry.event),
    finalizedStatusPollIntervalMs: FINALIZED_STATUS_POLL_INTERVAL_MS,
    minimumContextCatchUp: {
      maxAttempts: MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS,
      delayMs: MINIMUM_CONTEXT_CATCH_UP_DELAY_MS,
      readMethods: expectedCatchUpMethods,
      canonicalWordings: 2,
      successfulAttempts: catchUpAttempts,
      exhaustedAttempts,
      first429Attempts: rateLimitAttempts,
      sendRetryAllowed: sendCallbackCalled,
    },
    replanPatterns: Object.values(PLAN_SPECS).map((spec) => spec.pattern.source),
    rpcSelectionNegativeCases: ["history", "helius-state", "empty"],
  };
}

function usage() {
  return [
    "usage: node clients/ts/tools/devnet-controller-immutability.mjs <command>",
    "",
    "commands (run in this exact order):",
    "  self-test (offline only)",
    "  plan-pre",
    "  execute-pre",
    "  plan-authority-final",
    "  execute-authority-final",
    "  plan-post",
    "  execute-post",
    "  plan-record",
    "  execute-record",
    "",
    "planning performs finalized read-only RPC observations and writes a private exact plan.",
    "execution requires AMEBA_CONTROLLER_IMMUTABILITY_ARM=<execute-command>:<operation-id>:<action-plan-sha256>.",
    "A suffixed replan must be selected through the exact plan environment printed by its planning command.",
    "This tool never includes the Spread target Program or ProgramData in a mutation instruction.",
    "The authority-final stage constructs the exact canonical Loader SetAuthority(None)",
    "message, signs only through AMEBA_CEREMONY_SIGNER_PROVIDER, validates the closed",
    "envelope, journals it, then submits once with maxRetries: 0.",
    "SetAuthorityChecked-to-None is impossible in the pinned Loader ABI.",
  ].join("\n");
}

async function main() {
  assert.equal(process.argv.length, 3, usage());
  switch (process.argv[2]) {
    case "self-test": process.stdout.write(`${JSON.stringify(await selfTest(), null, 2)}\n`); break;
    case "plan-pre": await planObservation("pre"); break;
    case "execute-pre": await executeObservation("pre"); break;
    case "plan-authority-final": await planAuthorityFinal(); break;
    case "execute-authority-final": await executeAuthorityFinal(); break;
    case "plan-post": await planObservation("post"); break;
    case "execute-post": await executeObservation("post"); break;
    case "plan-record": await planRecord(); break;
    case "execute-record": await executeRecord(); break;
    default: throw new Error(usage());
  }
}

main().catch((error) => {
  const diagnostic = String(error?.stack ?? error).replace(/https:\/\/[^\s"']+/giu, "[REDACTED_HTTPS_URL]");
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
});
