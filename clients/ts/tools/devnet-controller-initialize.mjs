import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  assertExactKeys,
  guardRpcConnection,
  loadInjectedSignerProvider,
  openJournal,
  operationId,
  reconcileOneFinalized,
  sha256Hex,
  signTransactionWithProvider,
  submitOneFinalized,
  withExecutionLock,
  writeExclusiveJson,
} from "./devnet-ceremony-runtime.mjs";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

import {
  ARTIFACT_MERKLE_SCHEME_ID,
  MAX_ARTIFACT_BYTES_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  artifactMerkleRoot,
} from "../dist/upgradeGovernance/artifactMerkleV1.js";
import {
  MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  programDataObservationGeometryV1,
} from "../dist/upgradeGovernance/programDataObservationMerkleV1.js";
import {
  CEREMONY_ACCOUNT_VERSION_V1,
  CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR,
  CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN,
  EXTEND_PROGRAM_CHECKED_FEATURE_ID_V1,
  LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
  MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
  PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
  PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN,
  SET_AUTHORITY_CHECKED_FEATURE_ID_V1,
  controllerReleaseDigestV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerReleaseCommitmentPdaV1,
  deserializeControllerReleaseCommitmentV1,
  deserializeProgramDataCapacityPolicyV1,
  programDataCapacityPolicyDigestV1,
  serializeControllerReleaseCommitmentV1,
  serializeProgramDataCapacityPolicyV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import { clusterDomainFromGenesisHashV1 } from "../dist/upgradeGovernance/release1Planning.js";
import {
  BOOTSTRAP_INITIAL_SEAT_TERM_END_V2,
} from "../dist/upgradeGovernance/release1V3Instructions.js";
import { buildInitializeControllerV2Instruction } from "../dist/upgradeGovernance/release1V3Builders.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deserializeProtocolGateV1,
  governanceCouncilSetHash,
  governancePolicyHash,
  PROTOCOL_GATE_DISCRIMINATOR,
  serializeGovernanceCouncilSetV1,
  serializeGovernancePolicyV1,
  serializeProtocolGateV1,
} from "../dist/upgradeGovernance/v1.js";
import {
  CONTROLLER_CONFIG_V1_DISCRIMINATOR,
  GOVERNANCE_COUNCIL_SET_V1_DISCRIMINATOR,
  GOVERNANCE_POLICY_V1_DISCRIMINATOR,
  deserializeControllerConfigV1,
  deserializeGovernanceCouncilSetFixedV1,
  deserializeGovernancePolicyFixedV1,
  serializeControllerConfigV1,
  serializeGovernanceCouncilSetFixedV1,
  serializeGovernancePolicyFixedV1,
} from "../dist/upgradeGovernance/v1FixedAccounts.js";

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
const EXPECTED_CONTROLLER_ARTIFACT_SHA256 = "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
const EXPECTED_CONTROLLER_ARTIFACT_BYTES = 1_114_592;
const CONTROLLER_DEPLOY_BUFFER = new PublicKey("9DAowZpMbWKNAvjz81HXKQqUJbaTiQ9RZmgu5xgddogM");
const CONTROLLER_SOURCE_REPOSITORY = "https://github.com/SPACE999978/ameba_gov";
const CONTROLLER_CARGO_LOCK_SHA256 = "0c26b200f23a65d0976f30474208b74a64f04623f16d539e6b805c4fcf98768d";
const CONTROLLER_SBPF_ARCHITECTURE = "v0";
const CONTROLLER_PROGRAM_RAW_BYTES = 36;
const CONTROLLER_PROGRAMDATA_HEADER_BYTES = 45;
const CONTROLLER_PROGRAMDATA_RAW_BYTES = CONTROLLER_PROGRAMDATA_HEADER_BYTES + EXPECTED_CONTROLLER_ARTIFACT_BYTES;
const CONTROLLER_BUFFER_HEADER_BYTES = 37;
const CONTROLLER_BUFFER_RAW_BYTES = CONTROLLER_BUFFER_HEADER_BYTES + EXPECTED_CONTROLLER_ARTIFACT_BYTES;
const CONTROLLER_BUFFER_RENT_MINIMUM_LAMPORTS = 7_758_708_720;
const CONTROLLER_BUFFER_LAMPORTS = 7_758_764_400;
const CONTROLLER_MAX_DEPLOY_FEE_LAMPORTS = 100_000;
const CONTROLLER_DEPLOY_FUNDING_MARGIN_LAMPORTS = 500_000_000;
const CONTROLLER_DEPLOY_MANIFEST_SCHEMA = "amoeba-controller-deployment-manifest-v2";
const CONTROLLER_DEPLOY_MANIFEST_FILE = "controller-deployment-manifest-v2.json";
const CONTROLLER_DEPLOY_PLAN_SCHEMA = "ameba-governance-devnet-controller-final-deploy-plan-v1";
const CONTROLLER_DEPLOY_PLAN_FILE = "controller-final-deploy-plan-v1.json";
const CONTROLLER_DEPLOY_JOURNAL_PATTERN = /^controller-final-deploy-journal-v1-([0-9a-f]{64})\.jsonl$/u;
const CONTROLLER_DEPLOY_TOOL_FILE = "devnet-controller-final-deploy.mjs";
const CONTROLLER_BUFFER_UPLOAD_PLAN_SCHEMA = "ameba-governance-devnet-controller-buffer-upload-plan-v1";
const CONTROLLER_BUFFER_UPLOAD_PLAN_FILE = "controller-buffer-upload-plan-v1.json";
const CONTROLLER_BUFFER_UPLOAD_JOURNAL_FILE = "controller-buffer-upload-journal-v1.jsonl";
const CONTROLLER_BUFFER_UPLOAD_TOOL_FILE = "devnet-controller-buffer-upload.mjs";
const CONTROLLER_BUFFER_UPLOAD_TOOL_SHA256 = "9bab1abf5d0a91e0998132c51aa28b6df17114b9c21ace2a24f76d2c04ea4410";
const CONTROLLER_LOADER_INTERFACE_CRATE = "solana-loader-v3-interface";
const CONTROLLER_LOADER_INTERFACE_VERSION = "5.0.0";
const CONTROLLER_LOADER_INTERFACE_CHECKSUM = "6f7162a05b8b0773156b443bccd674ea78bb9aa406325b467ea78c06c99a63a2";
const CONTROLLER_LOADER_INTERFACE_SOURCE_SHA256 = "93d8b95d1739babc7206909cb1ed074da0d1884005b2245cdfa7e224609d503e";
const CONTROLLER_LOADER_PROCESSOR_CRATE = "solana-bpf-loader-program";
const CONTROLLER_LOADER_PROCESSOR_VERSION = "2.3.13";
const CONTROLLER_LOADER_PROCESSOR_SOURCE_SHA256 = "8097ca702f1f54960615362022f6ce72e69f871eabdb5ae91607f1c12b068b89";
const CONTROLLER_DEPLOY_DATA_HEX = "02000000e001110000000000";
const CONTROLLER_DEPLOY_PLAN_VALIDITY_SLOTS = 2_000;
const ALT_CREATE_PLAN_VALIDITY_SLOTS = 2_000;
const PINNED_CONTROLLER_DEPLOY_RECOVERY = Object.freeze({
  operationId: "0236f8ae13269fec3472b44105a91b4278218748666f741952dfd2b1865ca24d",
  planSha256: "b2a00a168176db3d51e5c57f3db0d364755751fcc9763b639dd8b4b442f118bf",
  supersededToolSha256: "cc62696427f5cb4d3ab26ca4146805ebe133409a6ab8af728e219e0e603a4b50",
});
const ZERO_HASH = "0".repeat(64);
const SOURCE_COMMIT = "9f3414315d53f70fe029c7f3480c9d45b8674da2";
const SOURCE_TREE = "854f20940fd701c2c5a9716b7a71dc174dd7c8c2";
const ROLLBACK_DELAY_SLOTS = 900n;
const ROUTINE_DELAY_SLOTS = 2_250n;
const MAJOR_DELAY_SLOTS = 4_500n;
const TERMINAL_DELAY_SLOTS = 9_000n;
const VOTE_REVIEW_SLOTS = 450n;
const PROPOSAL_EXPIRY_SLOTS = 432_000n;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const bs58 = bs58Module.default ?? bs58Module;
const ARTIFACT_MERKLE_SCHEME_ID_HEX = Buffer.from(ARTIFACT_MERKLE_SCHEME_ID).toString("hex");
const ALT_CREATE_PLAN_FILE = "controller-initialize-alt-create-plan-v3.json";
const ALT_CREATE_PLAN_PATTERN = /^controller-initialize-alt-create-plan-v3(?:-([0-9a-f]{64}))?\.json$/u;
const ALT_CREATE_PLAN_ENV = "AMEBA_CONTROLLER_INITIALIZE_ALT_CREATE_PLAN";
const ALT_EXTEND_PLAN_FILE = "controller-initialize-alt-extend-plan-v3.json";
const ALT_EXTEND_PLAN_PATTERN = /^controller-initialize-alt-extend-plan-v3(?:-([0-9a-f]{64}))?\.json$/u;
const ALT_EXTEND_PLAN_ENV = "AMEBA_CONTROLLER_INITIALIZE_ALT_EXTEND_PLAN";
const INITIALIZE_PLAN_FILE = "controller-initialize-plan-v3.json";
const INITIALIZE_PLAN_PATTERN = /^controller-initialize-plan-v3(?:-([0-9a-f]{64}))?\.json$/u;
const INITIALIZE_PLAN_ENV = "AMEBA_CONTROLLER_INITIALIZE_PLAN";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment ${name}`);
  return value;
}

function controllerDeployJournalBasename(operationIdValue) {
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "controller deployment journal operation ID is invalid");
  return `controller-final-deploy-journal-v1-${operationIdValue}.jsonl`;
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

async function secureFileInsideRunDir(runDir, fileInput, label) {
  const file = path.resolve(fileInput);
  assert.equal(path.dirname(file), path.resolve(runDir), `${label} must be directly inside the ceremony run directory`);
  return requireSecureRegularFile(file, label);
}

async function readExactInitializationPlan(runDir, fileInput, pattern, keys, label) {
  const file = await secureFileInsideRunDir(runDir, fileInput, label);
  const match = pattern.exec(path.basename(file));
  assert(match, `${label} filename is invalid`);
  const raw = await readFile(file);
  const plan = JSON.parse(raw.toString("utf8"));
  assertExactKeys(plan, keys, label);
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, `${label} operation ID changed`);
  if (match[1] !== undefined) assert.equal(match[1], storedOperationId, `${label} filename operation ID changed`);
  assert(raw.equals(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8")), `${label} is not canonical JSON`);
  return { file, plan, raw };
}

function executionJournalName(prefix, operationIdValue) {
  assert(/^[a-z0-9][a-z0-9-]*$/u.test(prefix), "execution journal prefix is invalid");
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "execution journal operation ID is invalid");
  return `${prefix}-${operationIdValue}`;
}

async function assertPriorExecutionJournalAllowsReplan(runDir, journalPrefix, priorPlan) {
  const name = executionJournalName(journalPrefix, priorPlan.operationId);
  const file = path.join(runDir, `${name}.jsonl`);
  if (!(await pathExists(file))) return;
  const journal = await openJournal(runDir, name, priorPlan.operationId);
  try {
    const finalized = journal.entries.filter((entry) => ["finalized", "reconciled-finalized"].includes(entry.event));
    assert.equal(finalized.length, 0, `refusing to replan after ${name} finalized a transaction`);
    const prepared = journal.entries.filter((entry) => entry.event === "prepared");
    for (const entry of prepared) {
      const terminal = journal.entries.find((candidate) => (
        candidate.stage === entry.stage
        && candidate.signature === entry.signature
        && ["expired-not-landed", "transaction-failed"].includes(candidate.event)
      ));
      assert(terminal, `refusing to replan with unresolved prepared signature ${entry.signature}`);
    }
  } finally {
    await journal.close();
  }
}

async function writeNonOverwritingInitializationPlan({
  runDir,
  plan,
  canonicalFile,
  pattern,
  keys,
  journalPrefix,
  receiptFile,
  label,
}) {
  assert(Number.isSafeInteger(plan.observedSlot) && plan.observedSlot > 0, `${label} observed slot is invalid`);
  assert(Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot >= plan.observedSlot, `${label} validity slot is invalid`);
  assert(!(await pathExists(path.join(runDir, receiptFile))), `refusing to replan after ${receiptFile} exists`);
  const existingNames = (await readdir(runDir)).filter((name) => pattern.test(name)).sort();
  const expectedRaw = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  if (existingNames.length === 0) {
    const file = path.join(runDir, canonicalFile);
    await writeExclusiveJson(file, plan);
    return file;
  }
  let identicalFile = null;
  for (const name of existingNames) {
    const prior = await readExactInitializationPlan(runDir, path.join(runDir, name), pattern, keys, `prior ${label}`);
    if (prior.raw.equals(expectedRaw)) {
      assert.equal(identicalFile, null, `duplicate identical ${label} files exist`);
      identicalFile = prior.file;
      continue;
    }
    assert(
      plan.observedSlot > prior.plan.planValidUntilSlot,
      `refusing to replan while ${name} remains valid`,
    );
    await assertPriorExecutionJournalAllowsReplan(runDir, journalPrefix, prior.plan);
  }
  if (identicalFile !== null) return identicalFile;
  const stem = canonicalFile.slice(0, -".json".length);
  const file = path.join(runDir, `${stem}-${plan.operationId}.json`);
  if (await pathExists(file)) {
    const existing = await readExactInitializationPlan(runDir, file, pattern, keys, `existing ${label} replan`);
    assert(existing.raw.equals(expectedRaw), `existing ${label} replan differs`);
    return file;
  }
  await writeExclusiveJson(file, plan);
  return file;
}

async function readSelectedInitializationPlan(runDir, environmentName, canonicalFile, pattern, keys, label) {
  const configured = process.env[environmentName]?.trim();
  const file = configured ? path.resolve(configured) : path.join(runDir, canonicalFile);
  return readExactInitializationPlan(runDir, file, pattern, keys, label);
}

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

const CONTROLLER_DEPLOY_MANIFEST_KEYS = [
  "authorizedForInitializationEvidence", "bufferUpload", "build", "cluster", "controller",
  "deployment", "evidence", "funding", "loader", "mainnetAllowed", "operationId", "schema", "source",
];
const CONTROLLER_DEPLOY_PLAN_KEYS = [
  "actionManifest", "artifact", "bufferUpload", "cluster", "controller", "expectedPoststate", "funding",
  "loaderEncoding", "mainnetAllowed", "operationId", "planningTransaction", "prestate", "schema", "source", "toolSha256",
];
const CONTROLLER_BUFFER_UPLOAD_PLAN_KEYS = [
  "artifactBytes", "artifactSha256", "baselineExactWriteCount", "baselineExactWrittenBytes", "baselineHistoryMaxSlot",
  "baselineHistoryMinSlot", "baselineHistorySignatureCount", "baselinePayloadSha256", "baselinePresentOffsets",
  "baselineRawSha256", "baselineWriteHistoryManifestSha256", "batchSize", "buffer", "bufferAuthority",
  "bufferLamports", "bufferRawBytes", "bufferRentMinimumLamports", "chunkCount", "chunkSize", "commitment",
  "controllerProgram", "controllerProgramdata", "estimatedMaximumFeeLamports", "feePayer", "feePayerBalanceLamports",
  "finalChunkBytes", "finalPayloadSha256", "finalRawSha256", "genesisHash", "loader", "mainnetAllowed", "missingBytes",
  "missingChunkCount", "observedSlot", "operationId", "planValidUntilSlot", "rpcProviderOriginSha256", "rpcSelection", "schema",
];
const CONTROLLER_DEPLOY_JOURNAL_EVENTS = new Set([
  "complete", "decoded-action-displayed", "expired-unaccepted", "finalized", "manifest-written", "poststate-verified",
  "prepared", "rate-limited", "resubmit-prepared", "resubmitted", "send-prepared", "session-started",
  "simulation-failed", "simulation-passed", "submission-unknown", "submitted", "transaction-failed",
]);
const CONTROLLER_BUFFER_UPLOAD_JOURNAL_EVENTS = new Set([
  "backoff-derived", "batch-verified", "complete", "expired-unaccepted", "finalized", "prepared", "rate-limited",
  "resubmit-prepared", "resubmitted", "send-prepared", "session-started", "submission-unknown", "submitted", "transaction-failed",
]);

function assertSha256(value, label, { allowZero = false } = {}) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256`);
  if (!allowZero) assert.notEqual(value, ZERO_HASH, `${label} must be nonzero`);
}

function assertPositiveSafeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
}

function assertNonnegativeSafeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
}

function canonicalArtifactMerkleSchemeId(value, label, { allowLegacyBufferJson = false } = {}) {
  if (typeof value === "string") {
    assert(/^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase 32-byte hex string`);
    assert.equal(value, ARTIFACT_MERKLE_SCHEME_ID_HEX, `${label} changed`);
    return value;
  }

  assert(allowLegacyBufferJson, `${label} must be a lowercase 32-byte hex string`);
  assertExactKeys(value, ["type", "data"], `${label} legacy Buffer JSON`);
  assert.equal(value.type, "Buffer", `${label} legacy type changed`);
  assert(Array.isArray(value.data), `${label} legacy data must be an array`);
  assert.equal(value.data.length, ARTIFACT_MERKLE_SCHEME_ID.length, `${label} legacy byte length changed`);
  for (const byte of value.data) {
    assert(Number.isInteger(byte) && byte >= 0 && byte <= 255, `${label} legacy data contains a non-byte`);
  }
  assert.deepEqual(value.data, [...ARTIFACT_MERKLE_SCHEME_ID], `${label} legacy bytes changed`);
  return ARTIFACT_MERKLE_SCHEME_ID_HEX;
}

function canonicalInitializationPlanMaterialForComparison(
  material,
  label,
  { allowLegacyBufferJson = false } = {},
) {
  assert(material && typeof material === "object" && !Array.isArray(material), `${label} must be an object`);
  assertExactKeys(
    material.controllerArtifact,
    ["bytes", "sha256", "merkleRoot", "merkleSchemeId", "chunkSize"],
    `${label} controller artifact`,
  );
  return {
    ...material,
    controllerArtifact: {
      ...material.controllerArtifact,
      merkleSchemeId: canonicalArtifactMerkleSchemeId(
        material.controllerArtifact.merkleSchemeId,
        `${label} artifact Merkle scheme ID`,
        { allowLegacyBufferJson },
      ),
    },
  };
}

function assertInitializationPlanMaterialExact(reconstructedMaterial, plannedMaterial, label) {
  assert.deepEqual(
    canonicalInitializationPlanMaterialForComparison(reconstructedMaterial, `${label} reconstructed`),
    canonicalInitializationPlanMaterialForComparison(
      plannedMaterial,
      `${label} persisted`,
      { allowLegacyBufferJson: true },
    ),
    label,
  );
}

function expectedControllerProgramBytes() {
  const raw = Buffer.alloc(CONTROLLER_PROGRAM_RAW_BYTES);
  raw.writeUInt32LE(2, 0);
  CONTROLLER_PROGRAMDATA.toBuffer().copy(raw, 4);
  return raw;
}

function expectedControllerProgramdataBytes(slot, artifact) {
  assertPositiveSafeInteger(slot, "controller deployment slot");
  assert.equal(artifact.length, EXPECTED_CONTROLLER_ARTIFACT_BYTES, "controller artifact length changed");
  const raw = Buffer.alloc(CONTROLLER_PROGRAMDATA_RAW_BYTES);
  raw.writeUInt32LE(3, 0);
  raw.writeBigUInt64LE(BigInt(slot), 4);
  raw[12] = 1;
  INITIALIZER.toBuffer().copy(raw, 13);
  artifact.copy(raw, CONTROLLER_PROGRAMDATA_HEADER_BYTES);
  return raw;
}

function expectedControllerBufferBytes(artifact) {
  assert.equal(artifact.length, EXPECTED_CONTROLLER_ARTIFACT_BYTES, "controller artifact length changed");
  const raw = Buffer.alloc(CONTROLLER_BUFFER_RAW_BYTES);
  raw.writeUInt32LE(1, 0);
  raw[4] = 1;
  INITIALIZER.toBuffer().copy(raw, 5);
  artifact.copy(raw, CONTROLLER_BUFFER_HEADER_BYTES);
  return raw;
}

function controllerDeployInstructionManifest(ix) {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    dataHex: Buffer.from(ix.data).toString("hex"),
  };
}

function expectedControllerDeployInstructions(programRentLamports) {
  assertPositiveSafeInteger(programRentLamports, "controller Program rent");
  const createProgram = SystemProgram.createAccount({
    fromPubkey: PAYER,
    newAccountPubkey: CONTROLLER,
    lamports: programRentLamports,
    space: CONTROLLER_PROGRAM_RAW_BYTES,
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  });
  const deploy = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      { pubkey: CONTROLLER_PROGRAMDATA, isSigner: false, isWritable: true },
      { pubkey: CONTROLLER, isSigner: false, isWritable: true },
      { pubkey: CONTROLLER_DEPLOY_BUFFER, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: INITIALIZER, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(CONTROLLER_DEPLOY_DATA_HEX, "hex"),
  });
  return [createProgram, deploy];
}

function expectedControllerDeployAction(programRentLamports) {
  return {
    schema: "ameba-controller-final-deploy-action-v1",
    instructionCount: 2,
    signerOrder: [PAYER, CONTROLLER, INITIALIZER].map((key) => key.toBase58()),
    instructions: expectedControllerDeployInstructions(programRentLamports).map(controllerDeployInstructionManifest),
  };
}

function expectedControllerDeployMessage(blockhash, programRentLamports) {
  const expected = new Transaction({ feePayer: PAYER, recentBlockhash: blockhash });
  expected.add(...expectedControllerDeployInstructions(programRentLamports));
  return Buffer.from(expected.serializeMessage());
}

function assertExactControllerDeployCompiledMessage(transaction, entry, plan) {
  const signedMessage = Buffer.from(transaction.serializeMessage());
  assert.equal(sha256Hex(signedMessage), entry.messageSha256, "controller deployment prepared message changed");
  assert(
    signedMessage.equals(expectedControllerDeployMessage(entry.blockhash, plan.funding.programRentLamports)),
    "controller deployment signed compiled message differs from the exact reviewed action",
  );
}

function validateControllerDeploymentManifestV2Core(manifest, artifact, expectedRpcProviderOriginSha256, expectedArtifactSha256) {
  assert.equal(artifact.length, EXPECTED_CONTROLLER_ARTIFACT_BYTES, "controller artifact length changed");
  assert.equal(sha256Hex(artifact), expectedArtifactSha256, "controller artifact hash changed");
  assertSha256(expectedRpcProviderOriginSha256, "expected RPC provider-origin commitment");
  assertExactKeys(manifest, CONTROLLER_DEPLOY_MANIFEST_KEYS, "controller deployment manifest");
  assertExactKeys(manifest.cluster, ["commitment", "genesisHash", "rpcProviderOriginSha256", "rpcSelection"], "controller deployment cluster");
  assertExactKeys(manifest.source, ["cargoLockSha256", "commit", "repository", "tree"], "controller deployment source");
  assertExactKeys(manifest.build, ["artifactBytes", "artifactSha256", "exactProgramdataCapacity", "sbpfArchitecture"], "controller deployment build");
  assertExactKeys(manifest.bufferUpload, ["completeSlot", "journalEntryCount", "journalSha256", "journalTerminalEntrySha256", "operationId", "planSha256", "toolSha256"], "controller deployment Buffer evidence");
  assertExactKeys(manifest.loader, ["deployWithMaxDataLenHex", "interfaceChecksum", "interfaceCrate", "interfaceInstructionSourceSha256", "interfaceVersion", "processorCrate", "processorSourceSha256", "processorVersion", "programId"], "controller deployment loader");
  assertExactKeys(manifest.deployment, ["blockTime", "computeUnits", "feeLamports", "messageSha256", "siblingInstructionCount", "signature", "signerOrder", "slot", "topLevelInstructionCount", "topLevelInstructions", "wireBytes", "wireSha256"], "controller deployment envelope");
  assertExactKeys(manifest.funding, ["bufferPostLamports", "bufferPreLamports", "payerPostLamports", "payerPreLamports", "programRentLamports", "programdataRentLamports"], "controller deployment funding");
  assertExactKeys(manifest.controller, ["bufferAbsent", "consumedBuffer", "immutable", "initialUpgradeAuthority", "initialized", "program", "programId", "programdata", "programdataState"], "controller deployment state");
  assertExactKeys(manifest.controller.program, ["executable", "lamports", "linkedProgramdata", "owner", "rawBytes", "rawSha256"], "controller Program state");
  assertExactKeys(manifest.controller.programdataState, ["capacity", "deployedSlot", "executable", "lamports", "owner", "payloadBytes", "payloadSha256", "rawBytes", "rawSha256", "upgradeAuthority", "zeroTailBytes"], "controller ProgramData state");
  assertExactKeys(manifest.evidence, ["deploymentAttemptCount", "finalizedEntrySha256", "journalEntriesThroughPoststate", "journalPathBasename", "journalPoststateEntrySha256", "journalThroughPoststateSha256", "planOperationId", "planPathBasename", "planSha256", "toolSha256"], "controller deployment evidence");

  assert.equal(manifest.schema, CONTROLLER_DEPLOY_MANIFEST_SCHEMA);
  assertSha256(manifest.operationId, "controller deployment operation ID");
  assert.equal(manifest.authorizedForInitializationEvidence, true, "deployment manifest is not authorized initialization evidence");
  assert.equal(manifest.mainnetAllowed, false, "deployment manifest unexpectedly authorizes Mainnet");
  assert.deepEqual(manifest.cluster, {
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: "state",
    rpcProviderOriginSha256: expectedRpcProviderOriginSha256,
  });
  assert.deepEqual(manifest.source, {
    repository: CONTROLLER_SOURCE_REPOSITORY,
    commit: SOURCE_COMMIT,
    tree: SOURCE_TREE,
    cargoLockSha256: CONTROLLER_CARGO_LOCK_SHA256,
  });
  assert.deepEqual(manifest.build, {
    artifactBytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    artifactSha256: expectedArtifactSha256,
    sbpfArchitecture: CONTROLLER_SBPF_ARCHITECTURE,
    exactProgramdataCapacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
  });

  for (const key of ["operationId", "planSha256", "journalSha256", "journalTerminalEntrySha256", "toolSha256"]) {
    assertSha256(manifest.bufferUpload[key], `controller Buffer-upload ${key}`);
  }
  assert.equal(manifest.bufferUpload.toolSha256, CONTROLLER_BUFFER_UPLOAD_TOOL_SHA256, "reviewed Buffer uploader changed");
  assertPositiveSafeInteger(manifest.bufferUpload.journalEntryCount, "Buffer-upload journal entry count");
  assertPositiveSafeInteger(manifest.bufferUpload.completeSlot, "Buffer-upload completion slot");

  assert.deepEqual(manifest.loader, {
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    interfaceCrate: CONTROLLER_LOADER_INTERFACE_CRATE,
    interfaceVersion: CONTROLLER_LOADER_INTERFACE_VERSION,
    interfaceChecksum: CONTROLLER_LOADER_INTERFACE_CHECKSUM,
    interfaceInstructionSourceSha256: CONTROLLER_LOADER_INTERFACE_SOURCE_SHA256,
    processorCrate: CONTROLLER_LOADER_PROCESSOR_CRATE,
    processorVersion: CONTROLLER_LOADER_PROCESSOR_VERSION,
    processorSourceSha256: CONTROLLER_LOADER_PROCESSOR_SOURCE_SHA256,
    deployWithMaxDataLenHex: CONTROLLER_DEPLOY_DATA_HEX,
  });

  assert(typeof manifest.deployment.signature === "string", "controller deployment signature is absent");
  assert.equal(bs58.decode(manifest.deployment.signature).length, 64, "controller deployment signature length changed");
  assertPositiveSafeInteger(manifest.deployment.slot, "controller deployment slot");
  assert(manifest.deployment.blockTime === null || Number.isSafeInteger(manifest.deployment.blockTime), "controller deployment block time is invalid");
  assertPositiveSafeInteger(manifest.deployment.feeLamports, "controller deployment fee");
  assert(manifest.deployment.feeLamports <= CONTROLLER_MAX_DEPLOY_FEE_LAMPORTS, "controller deployment fee exceeds the reviewed ceiling");
  assert(manifest.deployment.computeUnits === null || (Number.isSafeInteger(manifest.deployment.computeUnits) && manifest.deployment.computeUnits > 0), "controller deployment compute units are invalid");
  assertSha256(manifest.deployment.messageSha256, "controller deployment message commitment");
  assertSha256(manifest.deployment.wireSha256, "controller deployment wire commitment");
  assertPositiveSafeInteger(manifest.deployment.wireBytes, "controller deployment packet length");
  assert(manifest.deployment.wireBytes <= 1_232, "controller deployment packet exceeds Solana's limit");
  assert.deepEqual(manifest.deployment.signerOrder, [PAYER, CONTROLLER, INITIALIZER].map((key) => key.toBase58()), "controller deployment signer order changed");
  assert.equal(manifest.deployment.topLevelInstructionCount, 2, "controller deployment must have exactly two top-level instructions");
  assert.equal(manifest.deployment.siblingInstructionCount, 0, "controller deployment contains sibling instructions");
  assert.deepEqual(manifest.deployment.topLevelInstructions, expectedControllerDeployAction(manifest.funding.programRentLamports).instructions, "controller deployment instruction envelope changed");
  assert(manifest.bufferUpload.completeSlot <= manifest.deployment.slot, "Buffer upload completed after controller deployment");

  for (const [key, label] of [
    ["programRentLamports", "Program rent"], ["programdataRentLamports", "ProgramData rent"],
    ["bufferPreLamports", "Buffer pre-balance"], ["payerPreLamports", "payer pre-balance"],
  ]) assertPositiveSafeInteger(manifest.funding[key], label);
  assertNonnegativeSafeInteger(manifest.funding.bufferPostLamports, "Buffer post-balance");
  assertNonnegativeSafeInteger(manifest.funding.payerPostLamports, "payer post-balance");
  assert.equal(manifest.funding.bufferPreLamports, CONTROLLER_BUFFER_LAMPORTS, "controller Buffer pre-balance changed");
  assert.equal(manifest.funding.bufferPostLamports, 0, "controller Buffer was not consumed");
  assert.equal(
    manifest.funding.payerPostLamports,
    manifest.funding.payerPreLamports + manifest.funding.bufferPreLamports
      - manifest.funding.programRentLamports - manifest.funding.programdataRentLamports - manifest.deployment.feeLamports,
    "controller deployment funding arithmetic changed",
  );

  assert.equal(manifest.controller.programId, CONTROLLER.toBase58());
  assert.equal(manifest.controller.programdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(manifest.controller.initialUpgradeAuthority, INITIALIZER.toBase58());
  assert.equal(manifest.controller.initialized, false, "controller was initialized before the initialization ceremony");
  assert.equal(manifest.controller.immutable, false, "controller was immutable before initialization");
  assert.equal(manifest.controller.consumedBuffer, CONTROLLER_DEPLOY_BUFFER.toBase58());
  assert.equal(manifest.controller.bufferAbsent, true, "controller deploy Buffer was not consumed");
  const expectedProgram = expectedControllerProgramBytes();
  assert.deepEqual(manifest.controller.program, {
    owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    executable: true,
    lamports: manifest.funding.programRentLamports,
    rawBytes: CONTROLLER_PROGRAM_RAW_BYTES,
    rawSha256: sha256Hex(expectedProgram),
    linkedProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
  });
  const expectedProgramdata = expectedControllerProgramdataBytes(manifest.deployment.slot, artifact);
  assert.deepEqual(manifest.controller.programdataState, {
    owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    executable: false,
    lamports: manifest.funding.programdataRentLamports,
    rawBytes: CONTROLLER_PROGRAMDATA_RAW_BYTES,
    rawSha256: sha256Hex(expectedProgramdata),
    deployedSlot: manifest.deployment.slot,
    upgradeAuthority: INITIALIZER.toBase58(),
    payloadBytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    payloadSha256: expectedArtifactSha256,
    capacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    zeroTailBytes: 0,
  }, "controller ProgramData is not the exact artifact with exact capacity and zero tail");

  assert.equal(manifest.evidence.planOperationId, manifest.operationId, "deployment evidence operation ID changed");
  for (const key of ["planSha256", "toolSha256", "journalThroughPoststateSha256", "journalPoststateEntrySha256", "finalizedEntrySha256"]) {
    assertSha256(manifest.evidence[key], `controller deployment evidence ${key}`);
  }
  const journalName = CONTROLLER_DEPLOY_JOURNAL_PATTERN.exec(manifest.evidence.journalPathBasename);
  assert(journalName, "controller deployment evidence journal filename is invalid");
  assert.equal(journalName[1], manifest.operationId, "controller deployment journal filename operation ID changed");
  const planName = /^controller-final-deploy-plan-v1(?:-([0-9a-f]{64}))?\.json$/u.exec(manifest.evidence.planPathBasename);
  assert(planName, "controller deployment evidence plan filename is invalid");
  if (planName[1] !== undefined) assert.equal(planName[1], manifest.operationId, "controller replan filename operation ID changed");
  assertPositiveSafeInteger(manifest.evidence.journalEntriesThroughPoststate, "deployment journal poststate sequence");
  assertPositiveSafeInteger(manifest.evidence.deploymentAttemptCount, "deployment attempt count");
  return manifest;
}

export function validateControllerDeploymentManifestV2(manifest, artifact, expectedRpcProviderOriginSha256) {
  return validateControllerDeploymentManifestV2Core(
    manifest,
    artifact,
    expectedRpcProviderOriginSha256,
    EXPECTED_CONTROLLER_ARTIFACT_SHA256,
  );
}

async function secureCeremonyFile(runDir, input, label) {
  const file = await requireSecureRegularFile(path.resolve(input), label);
  const relative = path.relative(runDir, file);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} must be inside the ceremony run directory`);
  return file;
}

async function readCanonicalJsonFile(runDir, input, expectedKeys, label) {
  const file = await secureCeremonyFile(runDir, input, label);
  const raw = await readFile(file);
  const value = JSON.parse(raw.toString("utf8"));
  assertExactKeys(value, expectedKeys, label);
  assert(raw.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")), `${label} bytes are not canonical`);
  return { file, raw, value };
}

function parseControllerEvidenceJournal(raw, expectedOperationId, allowedEvents, label) {
  const text = raw.toString("utf8");
  assert(text.length > 0 && text.endsWith("\n"), `${label} is empty or has a partial tail`);
  const lines = text.slice(0, -1).split("\n");
  const entries = lines.map((line) => JSON.parse(line));
  let previousEntrySha256 = ZERO_HASH;
  for (const [index, entry] of entries.entries()) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), `${label} entry is malformed`);
    assert.equal(lines[index], JSON.stringify(entry), `${label} entry ${index + 1} is not canonical JSON`);
    assert.equal(entry.sequence, index + 1, `${label} sequence changed`);
    assert.equal(entry.operationId, expectedOperationId, `${label} operation ID changed`);
    assert.equal(entry.previousEntrySha256, previousEntrySha256, `${label} hash chain changed`);
    assert(typeof entry.timestamp === "string" && new Date(entry.timestamp).toISOString() === entry.timestamp, `${label} timestamp is invalid`);
    assert(allowedEvents.has(entry.event), `${label} contains unsupported event ${entry.event}`);
    const { entrySha256, ...material } = entry;
    assertSha256(entrySha256, `${label} entry hash`);
    assert.equal(entrySha256, sha256Hex(Buffer.from(JSON.stringify(material), "utf8")), `${label} entry hash changed`);
    previousEntrySha256 = entrySha256;
  }
  return { entries, lines, terminalEntrySha256: previousEntrySha256 };
}

async function validateControllerBufferUploadEvidence(value, manifest) {
  const planValue = await readCanonicalJsonFile(
    value.runDir,
    path.join(value.runDir, CONTROLLER_BUFFER_UPLOAD_PLAN_FILE),
    CONTROLLER_BUFFER_UPLOAD_PLAN_KEYS,
    "controller Buffer-upload plan",
  );
  const plan = planValue.value;
  const { operationId: storedOperationId, ...planMaterial } = plan;
  assert.equal(operationId(planMaterial), storedOperationId, "controller Buffer-upload operation ID changed");
  assert.equal(plan.schema, CONTROLLER_BUFFER_UPLOAD_PLAN_SCHEMA);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcSelection, "state");
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.controllerProgram, CONTROLLER.toBase58());
  assert.equal(plan.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.buffer, CONTROLLER_DEPLOY_BUFFER.toBase58());
  assert.equal(plan.bufferAuthority, INITIALIZER.toBase58());
  assert.equal(plan.feePayer, PAYER.toBase58());
  assert.equal(plan.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(plan.artifactBytes, EXPECTED_CONTROLLER_ARTIFACT_BYTES);
  assert.equal(plan.artifactSha256, EXPECTED_CONTROLLER_ARTIFACT_SHA256);
  assert.equal(plan.bufferRawBytes, CONTROLLER_BUFFER_RAW_BYTES);
  assert.equal(plan.bufferLamports, CONTROLLER_BUFFER_LAMPORTS);
  assert.equal(
    plan.bufferRentMinimumLamports,
    CONTROLLER_BUFFER_RENT_MINIMUM_LAMPORTS,
    "controller Buffer-upload minimum rent changed",
  );
  assert(
    plan.bufferLamports >= plan.bufferRentMinimumLamports,
    "controller Buffer-upload account is below its exact Buffer rent minimum",
  );
  assert.equal(plan.finalPayloadSha256, EXPECTED_CONTROLLER_ARTIFACT_SHA256);
  assert.equal(plan.finalRawSha256, sha256Hex(expectedControllerBufferBytes(value.artifact)), "controller Buffer final raw hash changed");
  assert.equal(plan.mainnetAllowed, false);
  assertPositiveSafeInteger(plan.observedSlot, "Buffer-upload observed slot");
  assertPositiveSafeInteger(plan.planValidUntilSlot, "Buffer-upload plan validity slot");
  assert(plan.planValidUntilSlot >= plan.observedSlot, "Buffer-upload plan validity is inverted");
  assertPositiveSafeInteger(plan.chunkSize, "Buffer-upload chunk size");
  assert.equal(plan.chunkCount, Math.ceil(EXPECTED_CONTROLLER_ARTIFACT_BYTES / plan.chunkSize), "Buffer-upload chunk count changed");
  assert.equal(plan.finalChunkBytes, EXPECTED_CONTROLLER_ARTIFACT_BYTES % plan.chunkSize, "Buffer-upload final chunk length changed");
  assertPositiveSafeInteger(plan.batchSize, "Buffer-upload batch size");
  assertNonnegativeSafeInteger(plan.missingChunkCount, "Buffer-upload missing chunk count");
  assertNonnegativeSafeInteger(plan.missingBytes, "Buffer-upload missing byte count");
  assert(Array.isArray(plan.baselinePresentOffsets), "Buffer-upload baseline offsets are malformed");
  assert.equal(new Set(plan.baselinePresentOffsets).size, plan.baselinePresentOffsets.length, "Buffer-upload baseline offsets are duplicated");

  const uploadTool = path.join(path.dirname(fileURLToPath(import.meta.url)), CONTROLLER_BUFFER_UPLOAD_TOOL_FILE);
  const uploadToolSha256 = sha256Hex(await readFile(uploadTool));
  assert.equal(uploadToolSha256, CONTROLLER_BUFFER_UPLOAD_TOOL_SHA256, "reviewed controller Buffer-upload tool changed");

  const journalFile = await secureCeremonyFile(
    value.runDir,
    path.join(value.runDir, CONTROLLER_BUFFER_UPLOAD_JOURNAL_FILE),
    "controller Buffer-upload journal",
  );
  const journalRaw = await readFile(journalFile);
  const journal = parseControllerEvidenceJournal(
    journalRaw,
    plan.operationId,
    CONTROLLER_BUFFER_UPLOAD_JOURNAL_EVENTS,
    "controller Buffer-upload journal",
  );
  const completeEntries = journal.entries.filter((entry) => entry.event === "complete");
  assert.equal(completeEntries.length, 1, "controller Buffer-upload journal must contain one complete event");
  const complete = completeEntries[0];
  assert.equal(journal.entries.at(-1), complete, "controller Buffer-upload complete event must be terminal");
  assertPositiveSafeInteger(complete.slot, "controller Buffer-upload complete slot");
  assert.equal(complete.exactChunkCount, plan.chunkCount, "controller Buffer-upload final chunk count changed");
  assert.equal(complete.payloadSha256, EXPECTED_CONTROLLER_ARTIFACT_SHA256, "controller Buffer-upload final payload changed");
  assert.equal(complete.rawSha256, plan.finalRawSha256, "controller Buffer-upload final raw hash changed");
  assert.equal(complete.controllerProgramAbsent, true, "controller Program existed when Buffer upload completed");
  assert.equal(complete.controllerProgramdataAbsent, true, "controller ProgramData existed when Buffer upload completed");

  assert.equal(manifest.bufferUpload.operationId, plan.operationId, "manifest Buffer-upload operation changed");
  assert.equal(manifest.bufferUpload.planSha256, sha256Hex(planValue.raw), "manifest Buffer-upload plan hash changed");
  assert.equal(manifest.bufferUpload.journalSha256, sha256Hex(journalRaw), "manifest Buffer-upload journal hash changed");
  assert.equal(manifest.bufferUpload.journalTerminalEntrySha256, journal.terminalEntrySha256, "manifest Buffer-upload terminal hash changed");
  assert.equal(manifest.bufferUpload.journalEntryCount, journal.entries.length, "manifest Buffer-upload journal count changed");
  assert.equal(manifest.bufferUpload.completeSlot, complete.slot, "manifest Buffer-upload completion slot changed");
  assert.equal(manifest.bufferUpload.toolSha256, uploadToolSha256, "manifest Buffer-upload tool hash changed");
  return { complete, journal, plan, planSha256: sha256Hex(planValue.raw) };
}

function validateControllerFinalDeployPlan(
  plan,
  artifact,
  expectedRpcProviderOriginSha256,
  manifest,
  currentToolSha256,
  bufferUploadPlan,
) {
  assertExactKeys(plan, CONTROLLER_DEPLOY_PLAN_KEYS, "controller final-deploy plan");
  assertExactKeys(plan.cluster, ["commitment", "genesisHash", "observedSlot", "planValidUntilSlot", "rpcProviderOriginSha256", "rpcSelection"], "controller final-deploy cluster plan");
  assertExactKeys(plan.controller, ["buffer", "bufferAuthority", "canonicalProgramdata", "feePayer", "initialUpgradeAuthority", "loader", "programId"], "controller final-deploy identities");
  assertExactKeys(plan.source, ["cargoLockSha256", "commit", "repository", "tree"], "controller final-deploy source");
  assertExactKeys(plan.artifact, ["bytes", "programdataCapacity", "sbpfArchitecture", "sha256"], "controller final-deploy artifact");
  assertExactKeys(plan.bufferUpload, ["completeSlot", "journalEntryCount", "journalSha256", "journalTerminalEntrySha256", "operationId", "planSha256", "toolSha256"], "controller final-deploy Buffer evidence");
  assertExactKeys(plan.loaderEncoding, ["deployDataHex", "interfaceChecksum", "interfaceCrate", "interfaceInstructionSourceSha256", "interfaceVersion", "processorCrate", "processorSourceSha256", "processorVersion"], "controller final-deploy loader encoding");
  assertExactKeys(plan.prestate, ["bufferAuthority", "bufferExecutable", "bufferLamports", "bufferOwner", "bufferPayloadSha256", "bufferRawBytes", "bufferRawSha256", "feePayerLamports", "observedSlot", "programAbsent", "programdataAbsent"], "controller final-deploy prestate");
  assertExactKeys(plan.funding, ["bufferRentLamports", "estimatedFeeLamports", "fundingMarginLamports", "minimumPayerLamports", "payerPostBeforeFeeLamports", "programRentLamports", "programdataRentLamports"], "controller final-deploy funding");
  assertExactKeys(plan.actionManifest, ["instructionCount", "instructions", "schema", "signerOrder"], "controller final-deploy action");
  assertExactKeys(plan.planningTransaction, ["blockhash", "lastValidBlockHeight", "messageSha256", "packetBytes", "signerOrder"], "controller final-deploy planning transaction");
  assertExactKeys(plan.expectedPoststate, ["bufferAbsent", "programExecutable", "programOwner", "programRawBytes", "programRawSha256", "programdataAuthority", "programdataCapacity", "programdataExecutable", "programdataOwner", "programdataPayloadSha256", "programdataRawBytes", "programdataSlotSource", "zeroTailBytes"], "controller final-deploy expected poststate");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "controller final-deploy operation ID changed");
  assert.equal(plan.schema, CONTROLLER_DEPLOY_PLAN_SCHEMA);
  assert.equal(plan.operationId, manifest.operationId);
  const pinnedPreparedRecovery = plan.operationId === PINNED_CONTROLLER_DEPLOY_RECOVERY.operationId
    && manifest.evidence.planSha256 === PINNED_CONTROLLER_DEPLOY_RECOVERY.planSha256
    && plan.toolSha256 === PINNED_CONTROLLER_DEPLOY_RECOVERY.supersededToolSha256;
  assert(
    plan.toolSha256 === currentToolSha256 || pinnedPreparedRecovery,
    "controller final-deploy tool changed after planning",
  );
  assert.deepEqual(plan.cluster, {
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: "state",
    rpcProviderOriginSha256: expectedRpcProviderOriginSha256,
    observedSlot: plan.cluster.observedSlot,
    planValidUntilSlot: plan.cluster.planValidUntilSlot,
  });
  assertPositiveSafeInteger(plan.cluster.observedSlot, "controller final-deploy observed slot");
  assertPositiveSafeInteger(plan.cluster.planValidUntilSlot, "controller final-deploy validity slot");
  assert.equal(
    plan.cluster.planValidUntilSlot,
    plan.cluster.observedSlot + CONTROLLER_DEPLOY_PLAN_VALIDITY_SLOTS,
    "controller final-deploy validity window changed",
  );
  assert.deepEqual(plan.controller, {
    programId: CONTROLLER.toBase58(),
    canonicalProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    buffer: CONTROLLER_DEPLOY_BUFFER.toBase58(),
    bufferAuthority: INITIALIZER.toBase58(),
    initialUpgradeAuthority: INITIALIZER.toBase58(),
    feePayer: PAYER.toBase58(),
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
  });
  assert.deepEqual(plan.source, manifest.source);
  assert.deepEqual(plan.artifact, {
    bytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    sha256: EXPECTED_CONTROLLER_ARTIFACT_SHA256,
    sbpfArchitecture: CONTROLLER_SBPF_ARCHITECTURE,
    programdataCapacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
  });
  assert.deepEqual(plan.bufferUpload, manifest.bufferUpload, "controller final-deploy Buffer lineage changed");
  assert.deepEqual(plan.loaderEncoding, {
    interfaceCrate: CONTROLLER_LOADER_INTERFACE_CRATE,
    interfaceVersion: CONTROLLER_LOADER_INTERFACE_VERSION,
    interfaceChecksum: CONTROLLER_LOADER_INTERFACE_CHECKSUM,
    interfaceInstructionSourceSha256: CONTROLLER_LOADER_INTERFACE_SOURCE_SHA256,
    processorCrate: CONTROLLER_LOADER_PROCESSOR_CRATE,
    processorVersion: CONTROLLER_LOADER_PROCESSOR_VERSION,
    processorSourceSha256: CONTROLLER_LOADER_PROCESSOR_SOURCE_SHA256,
    deployDataHex: CONTROLLER_DEPLOY_DATA_HEX,
  });
  assert.deepEqual(plan.prestate, {
    observedSlot: plan.cluster.observedSlot,
    programAbsent: true,
    programdataAbsent: true,
    bufferOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    bufferExecutable: false,
    bufferLamports: CONTROLLER_BUFFER_LAMPORTS,
    bufferRawBytes: CONTROLLER_BUFFER_RAW_BYTES,
    bufferRawSha256: sha256Hex(expectedControllerBufferBytes(artifact)),
    bufferPayloadSha256: EXPECTED_CONTROLLER_ARTIFACT_SHA256,
    bufferAuthority: INITIALIZER.toBase58(),
    feePayerLamports: manifest.funding.payerPreLamports,
  });

  for (const key of ["programRentLamports", "programdataRentLamports", "bufferRentLamports", "estimatedFeeLamports", "minimumPayerLamports", "payerPostBeforeFeeLamports"]) {
    assertPositiveSafeInteger(plan.funding[key], `controller final-deploy ${key}`);
  }
  assert.equal(plan.funding.programRentLamports, manifest.funding.programRentLamports);
  assert.equal(plan.funding.programdataRentLamports, manifest.funding.programdataRentLamports);
  assert.equal(
    plan.funding.bufferRentLamports,
    CONTROLLER_BUFFER_RENT_MINIMUM_LAMPORTS,
    "controller final-deploy Buffer minimum rent changed",
  );
  assert.equal(
    plan.funding.bufferRentLamports,
    bufferUploadPlan.bufferRentMinimumLamports,
    "controller final-deploy plan did not preserve the Buffer-upload minimum-rent commitment",
  );
  assert.equal(
    plan.funding.programdataRentLamports,
    CONTROLLER_BUFFER_LAMPORTS,
    "controller final-deploy Buffer balance is not exact ProgramData rent",
  );
  assert(plan.funding.estimatedFeeLamports <= CONTROLLER_MAX_DEPLOY_FEE_LAMPORTS, "estimated controller deployment fee exceeds the reviewed ceiling");
  assert.equal(plan.funding.fundingMarginLamports, CONTROLLER_DEPLOY_FUNDING_MARGIN_LAMPORTS);
  const programdataShortfall = Math.max(0, plan.funding.programdataRentLamports - CONTROLLER_BUFFER_LAMPORTS);
  assert.equal(
    plan.funding.minimumPayerLamports,
    plan.funding.programRentLamports + programdataShortfall + plan.funding.estimatedFeeLamports + CONTROLLER_DEPLOY_FUNDING_MARGIN_LAMPORTS,
    "controller final-deploy minimum funding changed",
  );
  assert(plan.prestate.feePayerLamports >= plan.funding.minimumPayerLamports, "controller final-deploy payer was underfunded");
  assert.equal(
    plan.funding.payerPostBeforeFeeLamports,
    plan.prestate.feePayerLamports + CONTROLLER_BUFFER_LAMPORTS - plan.funding.programRentLamports - plan.funding.programdataRentLamports,
    "controller final-deploy pre-fee balance changed",
  );
  assert.equal(manifest.funding.payerPostLamports, plan.funding.payerPostBeforeFeeLamports - manifest.deployment.feeLamports);

  const expectedAction = expectedControllerDeployAction(plan.funding.programRentLamports);
  assert.deepEqual(plan.actionManifest, expectedAction, "controller final-deploy action changed");
  assert(typeof plan.planningTransaction.blockhash === "string" && new PublicKey(plan.planningTransaction.blockhash).toBase58() === plan.planningTransaction.blockhash, "controller final-deploy blockhash is invalid");
  assertPositiveSafeInteger(plan.planningTransaction.lastValidBlockHeight, "controller final-deploy last valid block height");
  assertSha256(plan.planningTransaction.messageSha256, "controller final-deploy planning message");
  assertPositiveSafeInteger(plan.planningTransaction.packetBytes, "controller final-deploy planning packet length");
  assert(plan.planningTransaction.packetBytes <= 1_232, "controller final-deploy planning packet exceeds Solana's limit");
  assert.deepEqual(plan.planningTransaction.signerOrder, expectedAction.signerOrder);
  const planningTransaction = new Transaction({ feePayer: PAYER, recentBlockhash: plan.planningTransaction.blockhash });
  planningTransaction.add(...expectedControllerDeployInstructions(plan.funding.programRentLamports));
  const planningWire = planningTransaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  assert.equal(sha256Hex(planningTransaction.serializeMessage()), plan.planningTransaction.messageSha256, "controller final-deploy planning message changed");
  assert.equal(planningWire.length, plan.planningTransaction.packetBytes, "controller final-deploy planning packet length changed");
  assert.deepEqual(planningTransaction.signatures.map((entry) => entry.publicKey.toBase58()), expectedAction.signerOrder);
  assert.deepEqual(plan.expectedPoststate, {
    bufferAbsent: true,
    programOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    programExecutable: true,
    programRawBytes: CONTROLLER_PROGRAM_RAW_BYTES,
    programRawSha256: sha256Hex(expectedControllerProgramBytes()),
    programdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    programdataExecutable: false,
    programdataRawBytes: CONTROLLER_PROGRAMDATA_RAW_BYTES,
    programdataCapacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    programdataAuthority: INITIALIZER.toBase58(),
    programdataPayloadSha256: EXPECTED_CONTROLLER_ARTIFACT_SHA256,
    programdataSlotSource: "finalized-deployment-transaction-slot",
    zeroTailBytes: 0,
  });
  assert.equal(plan.mainnetAllowed, false);
  return plan;
}

function validateControllerFinalDeployJournal(journal, plan, manifest, manifestRaw) {
  const attempts = [];
  const attemptsBySignature = new Map();
  for (const entry of journal.entries) {
    if (entry.event === "prepared") {
      assert.equal(entry.attempt, attempts.length + 1, "controller deployment attempt sequence changed");
      if (attempts.length > 0) {
        const previous = attempts.at(-1);
        assert(previous.expired && !previous.finalized && !previous.failed, "new controller deployment attempt followed an unresolved attempt");
      }
      assert(typeof entry.wireBase64 === "string" && entry.wireBase64.length > 0, "controller deployment prepared wire bytes are absent");
      const wire = Buffer.from(entry.wireBase64, "base64");
      assert.equal(wire.toString("base64"), entry.wireBase64, "controller deployment prepared wire encoding changed");
      assertPositiveSafeInteger(entry.wireBytes, "controller deployment prepared packet length");
      assert.equal(wire.length, entry.wireBytes, "controller deployment prepared packet length changed");
      assert(wire.length <= 1_232, "controller deployment prepared packet exceeds Solana's limit");
      assert.equal(sha256Hex(wire), entry.wireSha256, "controller deployment prepared wire hash changed");
      const transaction = Transaction.from(wire);
      assert(transaction.verifySignatures(), "controller deployment signatures are invalid");
      assert.equal(transaction.recentBlockhash, entry.blockhash, "controller deployment prepared blockhash changed");
      assertExactControllerDeployCompiledMessage(transaction, entry, plan);
      assert(transaction.signature, "controller deployment fee-payer signature is absent");
      assert.equal(bs58.encode(transaction.signature), entry.signature, "controller deployment fee-payer signature changed");
      assert.deepEqual(transaction.signatures.map((signature) => signature.publicKey.toBase58()), plan.actionManifest.signerOrder, "controller deployment signed signer order changed");
      assert.equal(entry.actionManifestSha256, sha256Hex(Buffer.from(JSON.stringify(plan.actionManifest), "utf8")), "controller deployment action commitment changed");
      assertPositiveSafeInteger(entry.lastValidBlockHeight, "controller deployment last-valid block height");
      assertPositiveSafeInteger(entry.preflightSlot, "controller deployment prepared context slot");
      assert(entry.preflightSlot >= plan.prestate.observedSlot, "controller deployment prepared context predates the plan");
      assert(entry.preflightSlot <= plan.cluster.planValidUntilSlot, "controller deployment was signed after plan expiry");
      assertExactKeys(entry.signerProvider, ["providerId", "providerKind", "providerModuleSha256"], "controller deployment signer-provider evidence");
      assert(typeof entry.signerProvider.providerId === "string" && entry.signerProvider.providerId.length > 0, "controller deployment signer-provider ID is absent");
      assert(["hardware-wallet", "kms", "smart-account", "wallet"].includes(entry.signerProvider.providerKind), "controller deployment signer-provider kind is unsupported");
      assertSha256(entry.signerProvider.providerModuleSha256, "controller deployment signer-provider module hash");
      assert(!attemptsBySignature.has(entry.signature), "controller deployment signature is duplicated");
      const attempt = { entry, expired: false, failed: false, finalized: false, lastSendContextSlot: entry.preflightSlot };
      attempts.push(attempt);
      attemptsBySignature.set(entry.signature, attempt);
      continue;
    }
    if (["expired-unaccepted", "finalized", "simulation-failed", "transaction-failed"].includes(entry.event)) {
      const attempt = attemptsBySignature.get(entry.signature);
      assert(attempt, `${entry.event} refers to an unknown controller deployment signature`);
      if (entry.event === "expired-unaccepted") {
        assertPositiveSafeInteger(entry.finalizedProofSlot, "controller deployment expiry finalized proof slot");
        assertPositiveSafeInteger(entry.prestateProofSlot, "controller deployment expiry prestate proof slot");
        assert(entry.prestateProofSlot >= entry.finalizedProofSlot, "controller deployment expiry prestate proof predates finalized context");
        attempt.expired = true;
      }
      if (["simulation-failed", "transaction-failed"].includes(entry.event)) attempt.failed = true;
      if (entry.event === "finalized") attempt.finalized = true;
    }
    if (["resubmit-prepared", "send-prepared"].includes(entry.event)) {
      const attempt = attemptsBySignature.get(entry.signature);
      assert(attempt, `${entry.event} refers to an unknown controller deployment signature`);
      assert.equal(entry.messageSha256, attempt.entry.messageSha256, `${entry.event} message hash changed`);
      assert.equal(entry.wireSha256, attempt.entry.wireSha256, `${entry.event} wire hash changed`);
      assert.equal(entry.wireBytes, attempt.entry.wireBytes, `${entry.event} packet length changed`);
      assertPositiveSafeInteger(entry.minContextSlot, `${entry.event} minimum context slot`);
      assert(entry.minContextSlot >= attempt.lastSendContextSlot, `${entry.event} context regressed`);
      attempt.lastSendContextSlot = entry.minContextSlot;
    }
  }
  assert.equal(attempts.length, manifest.evidence.deploymentAttemptCount, "controller deployment attempt count changed");
  assert.equal(attempts.filter((attempt) => attempt.finalized).length, 1, "controller deployment journal lacks exactly one finalized attempt");
  for (const attempt of attempts) assert(!(attempt.expired && attempt.finalized), "controller deployment attempt is both expired and finalized");
  const selectedAttempt = attemptsBySignature.get(manifest.deployment.signature);
  assert(selectedAttempt?.finalized, "deployment manifest signature is not the finalized controller deployment");
  assert.equal(manifest.deployment.messageSha256, selectedAttempt.entry.messageSha256);
  assert.equal(manifest.deployment.wireSha256, selectedAttempt.entry.wireSha256);
  assert.equal(manifest.deployment.wireBytes, selectedAttempt.entry.wireBytes);

  const finalizedEntries = journal.entries.filter((entry) => entry.event === "finalized");
  assert.equal(finalizedEntries.length, 1, "controller deployment journal must contain one finalized event");
  const finalized = finalizedEntries[0];
  assert.equal(finalized.signature, manifest.deployment.signature);
  assert.equal(finalized.entrySha256, manifest.evidence.finalizedEntrySha256, "deployment finalized evidence hash changed");
  assert.equal(finalized.slot, manifest.deployment.slot);
  assert.equal(finalized.blockTime, manifest.deployment.blockTime);
  assert.equal(finalized.feeLamports, manifest.deployment.feeLamports);
  assert.equal(finalized.computeUnits, manifest.deployment.computeUnits);
  assert.equal(finalized.messageSha256, manifest.deployment.messageSha256);
  assert.equal(finalized.wireSha256, manifest.deployment.wireSha256);
  assert.equal(finalized.payerPreLamports, manifest.funding.payerPreLamports);
  assert.equal(finalized.payerPostLamports, manifest.funding.payerPostLamports);
  assert.equal(finalized.programPostLamports, manifest.funding.programRentLamports);
  assert.equal(finalized.programdataPostLamports, manifest.funding.programdataRentLamports);
  assert.equal(finalized.bufferPreLamports, CONTROLLER_BUFFER_LAMPORTS);
  assert.equal(finalized.bufferPostLamports, 0);

  const poststateEntries = journal.entries.filter((entry) => entry.event === "poststate-verified");
  assert.equal(poststateEntries.length, 1, "controller deployment journal must contain one verified poststate");
  const poststate = poststateEntries[0];
  assert.equal(poststate.signature, manifest.deployment.signature);
  assert.equal(poststate.deploymentSlot, manifest.deployment.slot);
  assertPositiveSafeInteger(poststate.observationSlot, "controller deployment poststate observation slot");
  assert(poststate.observationSlot >= manifest.deployment.slot, "controller deployment poststate predates deployment");
  assert.equal(poststate.programRawSha256, manifest.controller.program.rawSha256);
  assert.equal(poststate.programdataRawSha256, manifest.controller.programdataState.rawSha256);
  assert.equal(poststate.payloadSha256, EXPECTED_CONTROLLER_ARTIFACT_SHA256);
  assert.equal(poststate.programdataAuthority, INITIALIZER.toBase58());
  assert.equal(poststate.capacity, EXPECTED_CONTROLLER_ARTIFACT_BYTES);
  assert.equal(poststate.bufferAbsent, true);
  assert.equal(poststate.entrySha256, manifest.evidence.journalPoststateEntrySha256, "controller deployment poststate evidence hash changed");
  assert.equal(poststate.sequence, manifest.evidence.journalEntriesThroughPoststate, "controller deployment poststate sequence changed");
  const journalPrefix = Buffer.from(`${journal.lines.slice(0, poststate.sequence).join("\n")}\n`, "utf8");
  assert.equal(sha256Hex(journalPrefix), manifest.evidence.journalThroughPoststateSha256, "controller deployment poststate journal prefix changed");

  const manifestEntries = journal.entries.filter((entry) => entry.event === "manifest-written");
  assert.equal(manifestEntries.length, 1, "controller deployment journal must contain one manifest-written event");
  assert.equal(manifestEntries[0].signature, manifest.deployment.signature);
  assert.equal(manifestEntries[0].manifestFile, CONTROLLER_DEPLOY_MANIFEST_FILE);
  assert.equal(manifestEntries[0].manifestSha256, sha256Hex(manifestRaw), "controller deployment manifest journal hash changed");
  const completeEntries = journal.entries.filter((entry) => entry.event === "complete");
  assert.equal(completeEntries.length, 1, "controller deployment journal must contain one complete event");
  const complete = completeEntries[0];
  for (const trailing of journal.entries.slice(complete.sequence)) {
    assert.equal(trailing.event, "session-started", "controller deployment journal contains a state-changing event after completion");
    assert.equal(trailing.planSha256, manifest.evidence.planSha256, "post-completion session plan changed");
    assert.equal(trailing.toolSha256, manifest.evidence.toolSha256, "post-completion session tool changed");
  }
  assert.equal(complete.signature, manifest.deployment.signature);
  assert.equal(complete.slot, manifest.deployment.slot);
  assert.equal(complete.controllerProgram, CONTROLLER.toBase58());
  assert.equal(complete.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(complete.artifactSha256, EXPECTED_CONTROLLER_ARTIFACT_SHA256);
  assert.equal(complete.manifestSha256, sha256Hex(manifestRaw));
  assert.equal(complete.controllerInitialized, false);
  assert.equal(complete.controllerImmutable, false);
}

async function loadControllerDeploymentManifestEvidence(value) {
  const manifestInput = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_DEPLOYMENT_MANIFEST"));
  assert.equal(path.basename(manifestInput), CONTROLLER_DEPLOY_MANIFEST_FILE, "controller deployment manifest filename changed");
  const manifestValue = await readCanonicalJsonFile(
    value.runDir,
    manifestInput,
    CONTROLLER_DEPLOY_MANIFEST_KEYS,
    "controller deployment manifest",
  );
  const expectedRpcProviderOrigin = rpcProviderOriginSha256(value.stateRpcOrigin);
  const manifest = validateControllerDeploymentManifestV2(manifestValue.value, value.artifact, expectedRpcProviderOrigin);
  const manifestSha256 = sha256Hex(manifestValue.raw);

  const bufferUploadEvidence = await validateControllerBufferUploadEvidence(value, manifest);
  const toolPath = path.join(path.dirname(fileURLToPath(import.meta.url)), CONTROLLER_DEPLOY_TOOL_FILE);
  const currentToolSha256 = sha256Hex(await readFile(toolPath));
  assert.equal(manifest.evidence.toolSha256, currentToolSha256, "controller final-deploy tool differs from deployment evidence");
  const planValue = await readCanonicalJsonFile(
    value.runDir,
    path.join(value.runDir, manifest.evidence.planPathBasename),
    CONTROLLER_DEPLOY_PLAN_KEYS,
    "controller final-deploy plan",
  );
  const plan = validateControllerFinalDeployPlan(
    planValue.value,
    value.artifact,
    expectedRpcProviderOrigin,
    manifest,
    currentToolSha256,
    bufferUploadEvidence.plan,
  );
  assert.equal(manifest.evidence.planSha256, sha256Hex(planValue.raw), "controller final-deploy plan hash changed");
  assert.equal(manifest.evidence.planOperationId, plan.operationId, "controller final-deploy plan operation changed");

  const journalFile = await secureCeremonyFile(
    value.runDir,
    path.join(value.runDir, manifest.evidence.journalPathBasename),
    "controller final-deploy journal",
  );
  const journalRaw = await readFile(journalFile);
  const journal = parseControllerEvidenceJournal(
    journalRaw,
    plan.operationId,
    CONTROLLER_DEPLOY_JOURNAL_EVENTS,
    "controller final-deploy journal",
  );
  validateControllerFinalDeployJournal(journal, plan, manifest, manifestValue.raw);
  return { manifest, manifestPath: manifestValue.file, manifestRaw: manifestValue.raw, manifestSha256 };
}

function controllerDeploymentManifestValidatorSelfTest() {
  const artifact = Buffer.alloc(EXPECTED_CONTROLLER_ARTIFACT_BYTES, 0xa5);
  const artifactSha256 = sha256Hex(artifact);
  const testHash = (label) => sha256Hex(Buffer.from(`controller-deployment-manifest-self-test:${label}`, "utf8"));
  const rpcOrigin = testHash("rpc-origin");
  const slot = 123_456;
  const feeLamports = 5_000;
  const programRentLamports = 1_234_560;
  const programdataRentLamports = 7_700_000_000;
  const payerPreLamports = 20_000_000_000;
  const payerPostLamports = payerPreLamports + CONTROLLER_BUFFER_LAMPORTS
    - programRentLamports - programdataRentLamports - feeLamports;
  const operation = testHash("operation");
  const action = expectedControllerDeployAction(programRentLamports);
  const manifest = {
    schema: CONTROLLER_DEPLOY_MANIFEST_SCHEMA,
    operationId: operation,
    authorizedForInitializationEvidence: true,
    mainnetAllowed: false,
    cluster: {
      genesisHash: EXPECTED_GENESIS,
      commitment: "finalized",
      rpcSelection: "state",
      rpcProviderOriginSha256: rpcOrigin,
    },
    source: {
      repository: CONTROLLER_SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE,
      cargoLockSha256: CONTROLLER_CARGO_LOCK_SHA256,
    },
    build: {
      artifactBytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
      artifactSha256,
      sbpfArchitecture: CONTROLLER_SBPF_ARCHITECTURE,
      exactProgramdataCapacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
    },
    bufferUpload: {
      operationId: testHash("buffer-operation"),
      planSha256: testHash("buffer-plan"),
      journalSha256: testHash("buffer-journal"),
      journalTerminalEntrySha256: testHash("buffer-terminal"),
      journalEntryCount: 5,
      completeSlot: slot - 1,
      toolSha256: CONTROLLER_BUFFER_UPLOAD_TOOL_SHA256,
    },
    loader: {
      programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
      interfaceCrate: CONTROLLER_LOADER_INTERFACE_CRATE,
      interfaceVersion: CONTROLLER_LOADER_INTERFACE_VERSION,
      interfaceChecksum: CONTROLLER_LOADER_INTERFACE_CHECKSUM,
      interfaceInstructionSourceSha256: CONTROLLER_LOADER_INTERFACE_SOURCE_SHA256,
      processorCrate: CONTROLLER_LOADER_PROCESSOR_CRATE,
      processorVersion: CONTROLLER_LOADER_PROCESSOR_VERSION,
      processorSourceSha256: CONTROLLER_LOADER_PROCESSOR_SOURCE_SHA256,
      deployWithMaxDataLenHex: CONTROLLER_DEPLOY_DATA_HEX,
    },
    deployment: {
      signature: bs58.encode(Buffer.alloc(64, 7)),
      slot,
      blockTime: 1_800_000_000,
      feeLamports,
      computeUnits: 100_000,
      messageSha256: testHash("message"),
      wireSha256: testHash("wire"),
      wireBytes: 512,
      signerOrder: action.signerOrder,
      topLevelInstructions: action.instructions,
      topLevelInstructionCount: 2,
      siblingInstructionCount: 0,
    },
    funding: {
      programRentLamports,
      programdataRentLamports,
      bufferPreLamports: CONTROLLER_BUFFER_LAMPORTS,
      bufferPostLamports: 0,
      payerPreLamports,
      payerPostLamports,
    },
    controller: {
      programId: CONTROLLER.toBase58(),
      programdata: CONTROLLER_PROGRAMDATA.toBase58(),
      initialUpgradeAuthority: INITIALIZER.toBase58(),
      initialized: false,
      immutable: false,
      program: {
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
        executable: true,
        lamports: programRentLamports,
        rawBytes: CONTROLLER_PROGRAM_RAW_BYTES,
        rawSha256: sha256Hex(expectedControllerProgramBytes()),
        linkedProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      },
      programdataState: {
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
        executable: false,
        lamports: programdataRentLamports,
        rawBytes: CONTROLLER_PROGRAMDATA_RAW_BYTES,
        rawSha256: sha256Hex(expectedControllerProgramdataBytes(slot, artifact)),
        deployedSlot: slot,
        upgradeAuthority: INITIALIZER.toBase58(),
        payloadBytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
        payloadSha256: artifactSha256,
        capacity: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
        zeroTailBytes: 0,
      },
      consumedBuffer: CONTROLLER_DEPLOY_BUFFER.toBase58(),
      bufferAbsent: true,
    },
    evidence: {
      planSha256: testHash("plan"),
      planOperationId: operation,
      toolSha256: testHash("tool"),
      journalPathBasename: controllerDeployJournalBasename(operation),
      planPathBasename: CONTROLLER_DEPLOY_PLAN_FILE,
      journalThroughPoststateSha256: testHash("journal-prefix"),
      journalPoststateEntrySha256: testHash("poststate-entry"),
      journalEntriesThroughPoststate: 4,
      finalizedEntrySha256: testHash("finalized-entry"),
      deploymentAttemptCount: 1,
    },
  };
  validateControllerDeploymentManifestV2Core(manifest, artifact, rpcOrigin, artifactSha256);
  const unsignedDeployment = new Transaction({
    feePayer: PAYER,
    recentBlockhash: EXPECTED_GENESIS,
  });
  unsignedDeployment.add(...expectedControllerDeployInstructions(programRentLamports));
  const roundtrippedDeployment = Transaction.from(unsignedDeployment.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }));
  assert.equal(
    roundtrippedDeployment.instructions[1].keys[2].isSigner,
    true,
    "controller Program was not globally promoted to signer in the reconstructed Loader instruction",
  );
  const preparedMessageEntry = {
    blockhash: EXPECTED_GENESIS,
    messageSha256: sha256Hex(roundtrippedDeployment.serializeMessage()),
  };
  const preparedMessagePlan = { funding: { programRentLamports } };
  assert.doesNotThrow(
    () => assertExactControllerDeployCompiledMessage(
      roundtrippedDeployment,
      preparedMessageEntry,
      preparedMessagePlan,
    ),
    "exact compiled-message validation rejected harmless global signer promotion",
  );
  const changedInstructionDeployment = Transaction.from(unsignedDeployment.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }));
  changedInstructionDeployment.instructions[1].data[0] ^= 0xff;
  assert.throws(
    () => assertExactControllerDeployCompiledMessage(
      changedInstructionDeployment,
      {
        ...preparedMessageEntry,
        messageSha256: sha256Hex(changedInstructionDeployment.serializeMessage()),
      },
      preparedMessagePlan,
    ),
    /exact reviewed action/,
    "compiled-message validation accepted changed Loader instruction data",
  );
  assert.throws(
    () => assertExactControllerDeployCompiledMessage(
      roundtrippedDeployment,
      preparedMessageEntry,
      { funding: { programRentLamports: programRentLamports + 1 } },
    ),
    /exact reviewed action/,
    "compiled-message validation accepted changed Program rent",
  );
  const negativeMutations = [
    ["authorization", (candidate) => { candidate.authorizedForInitializationEvidence = false; }],
    ["mainnet", (candidate) => { candidate.mainnetAllowed = true; }],
    ["unknown-key", (candidate) => { candidate.unreviewed = true; }],
    ["capacity", (candidate) => { candidate.build.exactProgramdataCapacity -= 1; }],
    ["instruction-count", (candidate) => { candidate.deployment.topLevelInstructionCount = 1; }],
    ["sibling", (candidate) => { candidate.deployment.siblingInstructionCount = 1; }],
    ["initialized", (candidate) => { candidate.controller.initialized = true; }],
    ["immutable", (candidate) => { candidate.controller.immutable = true; }],
    ["zero-tail", (candidate) => { candidate.controller.programdataState.zeroTailBytes = 1; }],
    ["buffer-pre-balance", (candidate) => { candidate.funding.bufferPreLamports -= 1; }],
    ["raw-programdata", (candidate) => { candidate.controller.programdataState.rawSha256 = testHash("wrong-raw"); }],
    ["journal-operation", (candidate) => { candidate.evidence.journalPathBasename = controllerDeployJournalBasename(testHash("other-operation")); }],
  ];
  for (const [label, mutate] of negativeMutations) {
    const candidate = JSON.parse(JSON.stringify(manifest));
    mutate(candidate);
    assert.throws(
      () => validateControllerDeploymentManifestV2Core(candidate, artifact, rpcOrigin, artifactSha256),
      undefined,
      `controller deployment manifest validator accepted negative case ${label}`,
    );
  }
  assertAltCreatePlanValidity({
    observedSlot: 123_456,
    planValidUntilSlot: 123_456 + ALT_CREATE_PLAN_VALIDITY_SLOTS,
  });
  assert.throws(
    () => assertAltCreatePlanValidity({
      observedSlot: 123_456,
      planValidUntilSlot: 123_456 + ALT_CREATE_PLAN_VALIDITY_SLOTS - 1,
    }),
    undefined,
    "ALT create validity self-test accepted a producer/consumer mismatch",
  );
  const canonicalSchemeMaterial = {
    controllerArtifact: {
      bytes: EXPECTED_CONTROLLER_ARTIFACT_BYTES,
      sha256: artifactSha256,
      merkleRoot: testHash("artifact-merkle-root"),
      merkleSchemeId: ARTIFACT_MERKLE_SCHEME_ID_HEX,
      chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    },
    sentinel: "unchanged",
  };
  const legacyBufferJsonMaterial = JSON.parse(JSON.stringify({
    ...canonicalSchemeMaterial,
    controllerArtifact: {
      ...canonicalSchemeMaterial.controllerArtifact,
      merkleSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    },
  }));
  assert.doesNotThrow(
    () => assertInitializationPlanMaterialExact(
      canonicalSchemeMaterial,
      legacyBufferJsonMaterial,
      "artifact Merkle scheme Buffer JSON round-trip",
    ),
    "exact legacy Buffer JSON did not normalize to the canonical hex scheme ID",
  );
  const expectedLegacyBytes = [...ARTIFACT_MERKLE_SCHEME_ID];
  const malformedSchemeIds = [
    ["uppercase-hex", ARTIFACT_MERKLE_SCHEME_ID_HEX.toUpperCase()],
    ["wrong-hex", "00".repeat(32)],
    ["short-hex", ARTIFACT_MERKLE_SCHEME_ID_HEX.slice(2)],
    ["raw-array", expectedLegacyBytes],
    ["wrong-legacy-type", { type: "Uint8Array", data: expectedLegacyBytes }],
    ["extra-legacy-key", { type: "Buffer", data: expectedLegacyBytes, extra: true }],
    ["short-legacy-data", { type: "Buffer", data: expectedLegacyBytes.slice(1) }],
    ["non-byte-legacy-data", { type: "Buffer", data: [1.5, ...expectedLegacyBytes.slice(1)] }],
    ["changed-legacy-data", { type: "Buffer", data: [expectedLegacyBytes[0] ^ 0xff, ...expectedLegacyBytes.slice(1)] }],
  ];
  for (const [label, candidate] of malformedSchemeIds) {
    assert.throws(
      () => canonicalArtifactMerkleSchemeId(
        candidate,
        `artifact Merkle scheme self-test ${label}`,
        { allowLegacyBufferJson: true },
      ),
      undefined,
      `artifact Merkle scheme validator accepted ${label}`,
    );
  }
  return {
    ok: true,
    altCreatePlanValiditySlots: ALT_CREATE_PLAN_VALIDITY_SLOTS,
    artifactMerkleSchemeId: {
      canonicalHex: ARTIFACT_MERKLE_SCHEME_ID_HEX,
      legacyBufferJsonRoundTrip: true,
      malformedCases: malformedSchemeIds.map(([label]) => label),
    },
    compiledMessageNegativeCases: ["changed-loader-data", "changed-program-rent"],
    negativeCases: negativeMutations.map(([label]) => label),
  };
}

async function context() {
  const { rpcSelection, stateRpcOrigin, stateRpcUrl: rpcUrl } = await loadDevnetRpcConfiguration();
  assert.equal(rpcSelection, "state", "controller initialization requires the default Devnet state RPC");
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const artifactPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_ARTIFACT"));
  const artifact = await readFile(artifactPath);
  assert.equal(artifact.length, EXPECTED_CONTROLLER_ARTIFACT_BYTES, "controller artifact length changed");
  assert.equal(sha256(artifact).toString("hex"), EXPECTED_CONTROLLER_ARTIFACT_SHA256, "controller artifact hash changed");
  const connection = new Connection(rpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
  return { artifact, artifactPath, connection, minContextSlot: 0, rpcSelection, stateRpcOrigin, runDir };
}

function advanceMinContextSlot(value, slot, label) {
  assert(Number.isSafeInteger(slot) && slot > 0, `${label} returned an invalid finalized context slot`);
  assert(slot >= value.minContextSlot, `${label} regressed below the monotonic finalized context slot`);
  value.minContextSlot = slot;
  return slot;
}

function planningJournalOperationId(value, command) {
  return operationId({
    schema: "ameba-governance-devnet-initialize-planning-journal-v1",
    command,
    genesisHash: EXPECTED_GENESIS,
    controllerProgram: CONTROLLER.toBase58(),
    targetProgram: TARGET.toBase58(),
    controllerArtifactSha256: sha256Hex(value.artifact),
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
  });
}

async function withPlanningRpc(value, command, callback) {
  const journalOperationId = planningJournalOperationId(value, command);
  const name = `controller-initialize-${command}-planning-v1`;
  return withExecutionLock(value.runDir, "release1-devnet-rpc-owner", journalOperationId, async (runDir) => {
    const journal = await openJournal(runDir, name, journalOperationId);
    try {
      journal.assertBackoffElapsed();
      await journal.append("invocation-started", { command });
      const guarded = {
        ...value,
        connection: guardRpcConnection(value.connection, journal, command),
      };
      assert.equal(await guarded.connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      const result = await callback(guarded);
      await journal.append("invocation-completed", { command });
      return result;
    } catch (error) {
      await journal.append("invocation-stopped", {
        command,
        errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
      });
      throw error;
    } finally {
      await journal.close();
    }
  });
}

async function withExecutionRpc(value, runDir, name, operationIdValue, callback) {
  const journal = await openJournal(runDir, name, operationIdValue);
  try {
    journal.assertBackoffElapsed();
    await journal.append("invocation-started", { command: name });
    const guarded = {
      ...value,
      connection: guardRpcConnection(value.connection, journal, name),
    };
    assert.equal(await guarded.connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
    const result = await callback(guarded, journal);
    await journal.append("invocation-completed", { command: name });
    return result;
  } catch (error) {
    await journal.append("invocation-stopped", {
      command: name,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw error;
  } finally {
    await journal.close();
  }
}

function rpcProviderOriginSha256(origin) {
  return sha256(
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ).toString("hex");
}

function identities() {
  const [config, configBump] = deriveControllerConfigPda(CONTROLLER, TARGET);
  const [authority, authorityBump] = deriveAuthorityPda(CONTROLLER, TARGET);
  const [gate, gateBump] = deriveGatePda(CONTROLLER, TARGET);
  const [policy, policyBump] = derivePolicyPda(CONTROLLER, TARGET, 1n);
  const [council, councilBump] = deriveCouncilPda(CONTROLLER, TARGET, 1n);
  const [capacityPolicy, capacityPolicyBump] = deriveCapacityPolicyPdaV1(CONTROLLER, TARGET);
  const [controllerRelease, controllerReleaseBump] = deriveControllerReleaseCommitmentPdaV1(CONTROLLER, TARGET);
  return {
    authority,
    authorityBump,
    capacityPolicy,
    capacityPolicyBump,
    config,
    configBump,
    controllerRelease,
    controllerReleaseBump,
    council,
    councilBump,
    gate,
    gateBump,
    policy,
    policyBump,
  };
}

function assertDistinct(accountMap) {
  const values = Object.values(accountMap).map((value) => value.toBase58());
  assert.equal(new Set(values).size, values.length, "initialization account identities alias");
}

async function loaderGraph(connection, artifact, minContextSlot) {
  const config = { commitment: "finalized" };
  if (minContextSlot !== undefined) {
    assert(Number.isSafeInteger(minContextSlot) && minContextSlot > 0, "loader graph minimum context slot is invalid");
    config.minContextSlot = minContextSlot;
  }
  const response = await connection.getMultipleAccountsInfoAndContext(
    [CONTROLLER, CONTROLLER_PROGRAMDATA, TARGET, TARGET_PROGRAMDATA],
    config,
  );
  assert.equal(response.value.length, 4, "loader graph response length changed");
  assert(Number.isSafeInteger(response.context.slot) && response.context.slot > 0, "loader graph context slot is invalid");
  if (minContextSlot !== undefined) assert(response.context.slot >= minContextSlot, "loader graph observation predates the required slot");
  const [controller, controllerProgramdata, target, targetProgramdata] = response.value;
  for (const [label, account] of Object.entries({ controller, controllerProgramdata, target, targetProgramdata })) {
    assert(account, `${label} is absent`);
    assert(account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} has wrong owner`);
  }
  assert(controller.executable && target.executable, "Program executable state is invalid");
  assert(!controllerProgramdata.executable && !targetProgramdata.executable, "ProgramData must not be executable");
  assert.equal(controller.data.readUInt32LE(0), 2);
  assert.equal(target.data.readUInt32LE(0), 2);
  assert(new PublicKey(controller.data.subarray(4, 36)).equals(CONTROLLER_PROGRAMDATA));
  assert(new PublicKey(target.data.subarray(4, 36)).equals(TARGET_PROGRAMDATA));
  assert.equal(controllerProgramdata.data.readUInt32LE(0), 3);
  assert.equal(targetProgramdata.data.readUInt32LE(0), 3);
  assert.equal(controllerProgramdata.data[12], 1);
  assert.equal(targetProgramdata.data[12], 1);
  assert(new PublicKey(controllerProgramdata.data.subarray(13, 45)).equals(INITIALIZER), "controller initializer authority changed");
  assert(new PublicKey(targetProgramdata.data.subarray(13, 45)).equals(LEGACY_TARGET_AUTHORITY), "legacy target authority changed");
  const controllerPayload = controllerProgramdata.data.subarray(45);
  assert.equal(controllerPayload.length, artifact.length, "controller capacity is not exact");
  assert(controllerPayload.equals(artifact), "controller payload differs from artifact");
  const targetPayload = targetProgramdata.data.subarray(45);
  assert(targetProgramdata.data.length <= MAX_PROGRAMDATA_ACCOUNT_BYTES_V1, "target ProgramData exceeds the Release 1 raw-size ceiling");
  return {
    controllerCapacity: controllerPayload.length,
    controllerDeployedSlot: controllerProgramdata.data.readBigUInt64LE(4),
    controllerPayloadSha256: sha256(controllerPayload).toString("hex"),
    controllerRawBytes: controllerProgramdata.data.length,
    controllerRawSha256: sha256(controllerProgramdata.data).toString("hex"),
    observationSlot: response.context.slot,
    targetAuthority: LEGACY_TARGET_AUTHORITY.toBase58(),
    targetCapacity: targetPayload.length,
    targetDeployedSlot: targetProgramdata.data.readBigUInt64LE(4),
    targetPayloadSha256: sha256(targetPayload).toString("hex"),
    targetRawBytes: targetProgramdata.data.length,
    targetRawSha256: sha256(targetProgramdata.data).toString("hex"),
  };
}

async function readLoaderGraph(value, minContextSlot = value.minContextSlot) {
  const requiredSlot = Math.max(value.minContextSlot, minContextSlot ?? 0);
  const graph = await loaderGraph(
    value.connection,
    value.artifact,
    requiredSlot > 0 ? requiredSlot : undefined,
  );
  advanceMinContextSlot(value, graph.observationSlot, "loader graph read");
  return graph;
}

async function assertPdasVacant(connection, ids, minContextSlot) {
  const addresses = [ids.config, ids.gate, ids.policy, ids.council, ids.capacityPolicy, ids.controllerRelease, ids.authority];
  const config = { commitment: "finalized" };
  if (minContextSlot !== undefined) {
    assert(Number.isSafeInteger(minContextSlot) && minContextSlot > 0, "PDA observation minimum context slot is invalid");
    config.minContextSlot = minContextSlot;
  }
  const response = await connection.getMultipleAccountsInfoAndContext(addresses, config);
  assert.equal(response.value.length, addresses.length, "PDA observation response length changed");
  assert(Number.isSafeInteger(response.context.slot) && response.context.slot > 0, "PDA observation context slot is invalid");
  if (minContextSlot !== undefined) assert(response.context.slot >= minContextSlot, "PDA observation predates the required slot");
  for (let index = 0; index < response.value.length; index += 1) {
    const account = response.value[index];
    if (account === null) continue;
    assert(account.owner.equals(SystemProgram.programId) && account.data.length === 0, `${addresses[index].toBase58()} is not vacant`);
  }
  return response.context.slot;
}

async function readPdasVacant(value, ids, minContextSlot = value.minContextSlot) {
  const requiredSlot = Math.max(value.minContextSlot, minContextSlot ?? 0);
  const slot = await assertPdasVacant(
    value.connection,
    ids,
    requiredSlot > 0 ? requiredSlot : undefined,
  );
  return advanceMinContextSlot(value, slot, "PDA vacancy read");
}

function lookupAddresses(ids) {
  return [
    CONTROLLER_PROGRAMDATA,
    TARGET,
    TARGET_PROGRAMDATA,
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ids.config,
    ids.authority,
    ids.gate,
    ids.policy,
    ids.council,
    ids.capacityPolicy,
    ids.controllerRelease,
    TREASURY,
    GUARDIAN,
  ];
}

function stableInitializationIdentities(ids) {
  return {
    controllerConfig: ids.config.toBase58(),
    authorityPda: ids.authority.toBase58(),
    protocolGate: ids.gate.toBase58(),
    policy: ids.policy.toBase58(),
    council: ids.council.toBase58(),
    capacityPolicy: ids.capacityPolicy.toBase58(),
    controllerRelease: ids.controllerRelease.toBase58(),
    canonicalSpillTreasury: TREASURY.toBase58(),
    guardian: GUARDIAN.toBase58(),
    seats: SEATS.map((seat) => seat.toBase58()),
  };
}

function instructionManifest(ix) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    dataHex: Buffer.from(ix.data).toString("hex"),
  };
}

function packetBytesForInstructions(instructions) {
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: EXPECTED_GENESIS,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize().length;
}

function planningMessageSha256ForInstructions(instructions) {
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: EXPECTED_GENESIS,
    instructions,
  }).compileToV0Message();
  return sha256Hex(Buffer.from(message.serialize()));
}

function lookupStateSnapshot(lookup) {
  return {
    authority: lookup.state.authority?.toBase58() ?? null,
    active: lookup.isActive(),
    deactivationSlot: lookup.state.deactivationSlot.toString(),
    lastExtendedSlot: lookup.state.lastExtendedSlot,
    lastExtendedSlotStartIndex: lookup.state.lastExtendedSlotStartIndex,
    addresses: lookup.state.addresses.map((address) => address.toBase58()),
  };
}

function assertActiveLookup(lookup, expectedAuthority, label) {
  assert(lookup.isActive(), `${label} is deactivated`);
  assert.equal(lookup.state.deactivationSlot, U64_MAX, `${label} deactivation slot changed`);
  assert(lookup.state.authority?.equals(expectedAuthority), `${label} authority changed`);
}

const ALT_CREATE_PLAN_KEYS = [
  "schema", "genesisHash", "observedSlot", "planValidUntilSlot", "recentSlot",
  "controllerProgram", "controllerProgramdata", "targetProgram", "targetProgramdata",
  "upgradeableLoader", "initializer", "authority", "payer", "lookupTable",
  "expectedLookupAuthority", "expectedLookupActive", "expectedLookupDeactivationSlot",
  "expectedLookupAddresses",
  "initializationIdentities", "loaderGraph", "instruction", "planningMessageSha256", "packetBytes", "rpcSelection",
  "rpcProviderOriginSha256", "mainnetAllowed", "operationId",
];

function assertAltCreatePlanValidity(plan) {
  assert(Number.isSafeInteger(plan.observedSlot) && plan.observedSlot > 0, "ALT create observed slot is invalid");
  assert.equal(
    plan.planValidUntilSlot,
    plan.observedSlot + ALT_CREATE_PLAN_VALIDITY_SLOTS,
    "ALT create plan validity changed",
  );
}

function altCreatePlanMaterial(value, ids, graph, observedSlot, recentSlot) {
  assert(Number.isSafeInteger(observedSlot) && observedSlot > 0, "ALT create observed slot is invalid");
  assert.equal(recentSlot, observedSlot, "ALT create recent slot must equal its finalized observation slot");
  const [createInstruction, lookupTable] = AddressLookupTableProgram.createLookupTable({
    authority: PAYER,
    payer: PAYER,
    recentSlot,
  });
  const packetBytes = packetBytesForInstructions([createInstruction]);
  assert(packetBytes <= 1_232, "ALT create packet exceeds Solana limit");
  return {
    createInstruction,
    lookupTable,
    material: {
      schema: "ameba-governance-devnet-initialize-alt-create-plan-v3",
      genesisHash: EXPECTED_GENESIS,
      observedSlot,
      planValidUntilSlot: observedSlot + ALT_CREATE_PLAN_VALIDITY_SLOTS,
      recentSlot,
      controllerProgram: CONTROLLER.toBase58(),
      controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      targetProgram: TARGET.toBase58(),
      targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
      initializer: INITIALIZER.toBase58(),
      authority: PAYER.toBase58(),
      payer: PAYER.toBase58(),
      lookupTable: lookupTable.toBase58(),
      expectedLookupAuthority: PAYER.toBase58(),
      expectedLookupActive: true,
      expectedLookupDeactivationSlot: U64_MAX.toString(),
      expectedLookupAddresses: [],
      initializationIdentities: stableInitializationIdentities(ids),
      loaderGraph: stableLoaderGraph(graph),
      instruction: instructionManifest(createInstruction),
      planningMessageSha256: planningMessageSha256ForInstructions([createInstruction]),
      packetBytes,
      rpcSelection: value.rpcSelection,
      rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
      mainnetAllowed: false,
    },
  };
}

async function planAlt() {
  const local = await context();
  await withPlanningRpc(local, "plan-alt-create-v3", async (value) => {
    const ids = identities();
    const graph = await readLoaderGraph(value);
    const observedSlot = await readPdasVacant(value, ids);
    assertDistinct({ payer: PAYER, initializer: INITIALIZER, controller: CONTROLLER, controllerProgramdata: CONTROLLER_PROGRAMDATA, target: TARGET, targetProgramdata: TARGET_PROGRAMDATA, loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, config: ids.config, authority: ids.authority, gate: ids.gate, policy: ids.policy, council: ids.council, capacityPolicy: ids.capacityPolicy, controllerRelease: ids.controllerRelease, treasury: TREASURY, guardian: GUARDIAN, seat0: SEATS[0], seat1: SEATS[1], seat2: SEATS[2], seat3: SEATS[3], seat4: SEATS[4], system: SystemProgram.programId });
    const { material } = altCreatePlanMaterial(value, ids, graph, observedSlot, observedSlot);
    const plan = { ...material, operationId: operationId(material) };
    assertExactKeys(plan, ALT_CREATE_PLAN_KEYS, "ALT create plan");
    assertAltCreatePlanValidity(plan);
    const planFile = await writeNonOverwritingInitializationPlan({
      runDir: value.runDir,
      plan,
      canonicalFile: ALT_CREATE_PLAN_FILE,
      pattern: ALT_CREATE_PLAN_PATTERN,
      keys: ALT_CREATE_PLAN_KEYS,
      journalPrefix: "controller-initialize-alt-create-v3",
      receiptFile: "controller-initialize-alt-create-receipt-v3.json",
      label: "ALT create plan",
    });
    process.stdout.write(`${JSON.stringify({ ...plan, planFile: path.basename(planFile) }, null, 2)}\n`);
  });
}

async function executeAltCreate() {
  const value = await context();
  const ids = identities();
  const selectedPlan = await readSelectedInitializationPlan(
    value.runDir,
    ALT_CREATE_PLAN_ENV,
    ALT_CREATE_PLAN_FILE,
    ALT_CREATE_PLAN_PATTERN,
    ALT_CREATE_PLAN_KEYS,
    "ALT create plan",
  );
  const plan = selectedPlan.plan;
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "ALT create operation is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-initialize-alt-create-plan-v3");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.rpcSelection, value.rpcSelection);
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  assertAltCreatePlanValidity(plan);
  await withExecutionLock(value.runDir, "release1-devnet-rpc-owner", storedOperationId, async (runDir) => {
    await withExecutionRpc(value, runDir, executionJournalName("controller-initialize-alt-create-v3", storedOperationId), storedOperationId, async (guarded, journal) => {
      const graph = await readLoaderGraph(guarded);
      const rebuilt = altCreatePlanMaterial(guarded, ids, graph, plan.observedSlot, plan.recentSlot);
      assert.deepEqual(rebuilt.material, material, "ALT create plan no longer reconstructs exactly");
      const { createInstruction, lookupTable } = rebuilt;
      const verifyExpiredPrestate = async (minContextSlot) => {
        await readLoaderGraph(guarded, minContextSlot);
        const slot = await readPdasVacant(guarded, ids, minContextSlot);
        const account = await guarded.connection.getAccountInfo(lookupTable, {
          commitment: "finalized",
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        });
        assert.equal(account, null, "planned ALT address is already occupied");
        return slot;
      };
      const assertPrestate = async (minContextSlot) => {
        const slot = await verifyExpiredPrestate(minContextSlot);
        assert(slot <= plan.planValidUntilSlot, "ALT create plan expired");
        return slot;
      };
      let landed = await reconcileOneFinalized({
        connection: guarded.connection,
        journal,
        operationId: storedOperationId,
        stage: "alt-create",
        expectedSigners: [PAYER],
        expectedPacketBytes: plan.packetBytes,
        verifyImmediatelyBeforeResubmit: assertPrestate,
        verifyExpiredPrestate,
      });
      if (!landed) {
        const preSignSlot = await assertPrestate();
        const latestResponse = await guarded.connection.getLatestBlockhashAndContext({
          commitment: "finalized",
          minContextSlot: preSignSlot,
        });
        assert(latestResponse.context.slot >= preSignSlot, "ALT create blockhash context predates prestate");
        const signingSlot = await assertPrestate(latestResponse.context.slot);
        assert(signingSlot >= latestResponse.context.slot, "ALT create signing prestate predates blockhash context");
        const latest = latestResponse.value;
        const message = new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: latest.blockhash,
          instructions: [createInstruction],
        }).compileToV0Message();
        const unsignedTransaction = new VersionedTransaction(message);
        const signerProvider = await loadInjectedSignerProvider(value.runDir);
        const signed = await signTransactionWithProvider({
          providerValue: signerProvider,
          transaction: unsignedTransaction,
          expectedSigners: [PAYER],
          operationId: storedOperationId,
          stage: "alt-create",
        });
        const transaction = signed.transaction;
        assert.equal(transaction.serialize().length, plan.packetBytes, "ALT create packet size changed");
        assert.equal(sha256Hex(Buffer.from(new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: EXPECTED_GENESIS,
          instructions: [createInstruction],
        }).compileToV0Message().serialize())), plan.planningMessageSha256, "ALT create planning message changed before signing");
        const simulation = await guarded.connection.simulateTransaction(transaction, {
          commitment: "processed",
          sigVerify: true,
          replaceRecentBlockhash: false,
          minContextSlot: signingSlot,
        });
        assert.equal(simulation.value.err, null, `ALT create simulation failed: ${JSON.stringify(simulation.value.logs)}`);
        landed = await submitOneFinalized({
          connection: guarded.connection,
          transaction,
          latestBlockhash: latest,
          journal,
          operationId: storedOperationId,
          stage: "alt-create",
          expectedSigners: [PAYER],
          expectedPacketBytes: plan.packetBytes,
          minContextSlot: signingSlot,
          preparedContext: {
            signerProvider: signed.providerEvidence,
            simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
          },
          verifyImmediatelyBeforeSubmit: assertPrestate,
          verifyExpiredPrestate,
        });
      }
      assert(landed, "ALT create did not produce a finalized transaction");
      const lookup = await guarded.connection.getAddressLookupTable(lookupTable, {
        commitment: "finalized",
        minContextSlot: landed.slot,
      });
      assert(lookup.context.slot >= landed.slot, "ALT create postread predates the transaction");
      assert(lookup.value, "created lookup table is unavailable at finalized commitment");
      assertActiveLookup(lookup.value, new PublicKey(plan.expectedLookupAuthority), "created lookup table");
      assert.equal(lookup.value.isActive(), plan.expectedLookupActive, "created lookup table active state changed");
      assert.equal(lookup.value.state.deactivationSlot.toString(), plan.expectedLookupDeactivationSlot, "created lookup table deactivation changed");
      assert.deepEqual(lookup.value.state.addresses.map((address) => address.toBase58()), plan.expectedLookupAddresses, "new lookup table addresses changed");
      await readLoaderGraph(guarded, landed.slot);
      await readPdasVacant(guarded, ids, landed.slot);
      const lookupState = lookupStateSnapshot(lookup.value);
      const receipt = {
        schema: "ameba-governance-devnet-initialize-alt-create-receipt-v3",
        operationId: storedOperationId,
        planFile: path.basename(selectedPlan.file),
        planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
        genesisHash: EXPECTED_GENESIS,
        lookupTable: lookupTable.toBase58(),
        authority: PAYER.toBase58(),
        recentSlot: plan.recentSlot,
        active: lookupState.active,
        deactivationSlot: lookupState.deactivationSlot,
        lastExtendedSlot: lookupState.lastExtendedSlot,
        lastExtendedSlotStartIndex: lookupState.lastExtendedSlotStartIndex,
        addresses: lookupState.addresses,
        simulationUnitsConsumed: landed.preparedContext?.simulationUnitsConsumed ?? null,
        finalizedObservationSlot: lookup.context.slot,
        ...landed,
      };
      await writeExclusiveJson(path.join(runDir, "controller-initialize-alt-create-receipt-v3.json"), receipt);
      await journal.append("receipt-written", {
        stage: "alt-create",
        signature: landed.signature,
        receiptSha256: sha256Hex(Buffer.from(JSON.stringify(receipt), "utf8")),
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    });
  });
}

const ALT_EXTEND_PLAN_KEYS = [
  "schema", "genesisHash", "observedSlot", "planValidUntilSlot", "controllerProgram",
  "controllerProgramdata", "targetProgram", "targetProgramdata", "upgradeableLoader",
  "initializer", "authority", "payer", "lookupTable", "lookupStateBefore", "addresses",
  "addressCount", "createOperationId", "createPlanSha256", "createReceiptSha256",
  "expectedLookupAuthority", "expectedLookupActive", "expectedLookupDeactivationSlot",
  "expectedLookupAddresses",
  "initializationIdentities", "loaderGraph", "instruction", "planningMessageSha256", "packetBytes", "rpcSelection",
  "rpcProviderOriginSha256", "mainnetAllowed", "operationId",
];

async function loadCreatedLookup(value, ids) {
  const receiptFile = await secureFileInsideRunDir(
    value.runDir,
    path.join(value.runDir, "controller-initialize-alt-create-receipt-v3.json"),
    "ALT create receipt",
  );
  const receiptBytes = await readFile(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.schema, "ameba-governance-devnet-initialize-alt-create-receipt-v3");
  assert(typeof receipt.planFile === "string" && ALT_CREATE_PLAN_PATTERN.test(receipt.planFile), "ALT create receipt plan filename changed");
  const selectedPlan = await readExactInitializationPlan(
    value.runDir,
    path.join(value.runDir, receipt.planFile),
    ALT_CREATE_PLAN_PATTERN,
    ALT_CREATE_PLAN_KEYS,
    "ALT create receipt plan",
  );
  const planBytes = selectedPlan.raw;
  const plan = selectedPlan.plan;
  assert.deepEqual(plan.initializationIdentities, stableInitializationIdentities(ids), "ALT create initialization identities changed");
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(receipt.operationId, plan.operationId, "ALT create receipt operation changed");
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")), "ALT create receipt plan hash changed");
  assert.equal(receipt.lookupTable, plan.lookupTable, "ALT create receipt table changed");
  assert.equal(receipt.authority, plan.expectedLookupAuthority, "ALT create receipt authority changed");
  assert.equal(receipt.recentSlot, plan.recentSlot, "ALT create receipt recent slot changed");
  assert.equal(receipt.active, plan.expectedLookupActive, "ALT create receipt active state changed");
  assert.equal(receipt.deactivationSlot, plan.expectedLookupDeactivationSlot, "ALT create receipt deactivation slot changed");
  assert.deepEqual(receipt.addresses, plan.expectedLookupAddresses, "ALT create receipt addresses changed");
  assert(Number.isSafeInteger(receipt.slot) && receipt.slot > 0, "ALT create receipt finalized slot is invalid");
  const lookupTable = new PublicKey(receipt.lookupTable);
  const requiredSlot = Math.max(receipt.slot, value.minContextSlot);
  const lookup = await value.connection.getAddressLookupTable(lookupTable, {
    commitment: "finalized",
    minContextSlot: requiredSlot,
  });
  advanceMinContextSlot(value, lookup.context.slot, "created lookup read");
  assert(lookup.context.slot >= requiredSlot, "created lookup read predates its required context");
  assert(lookup.value, "created lookup table is absent");
  assertActiveLookup(lookup.value, PAYER, "created lookup table");
  const currentState = lookupStateSnapshot(lookup.value);
  assert.deepEqual(currentState, {
    authority: receipt.authority,
    active: receipt.active,
    deactivationSlot: receipt.deactivationSlot,
    lastExtendedSlot: receipt.lastExtendedSlot,
    lastExtendedSlotStartIndex: receipt.lastExtendedSlotStartIndex,
    addresses: receipt.addresses,
  }, "created lookup table differs from its receipt");
  return {
    createOperationId: receipt.operationId,
    createPlanSha256: sha256Hex(planBytes),
    createReceiptSha256: sha256Hex(receiptBytes),
    lookup: lookup.value,
    lookupTable,
  };
}

function altExtendPlanMaterial(value, graph, ids, created, observedSlot) {
  assert(Number.isSafeInteger(observedSlot) && observedSlot > 0, "ALT extend observed slot is invalid");
  assertActiveLookup(created.lookup, PAYER, "lookup table before extension");
  const lookupStateBefore = lookupStateSnapshot(created.lookup);
  assert.deepEqual(lookupStateBefore.addresses, [], "lookup table is not empty before extension");
  const addresses = lookupAddresses(ids);
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: PAYER,
    authority: PAYER,
    lookupTable: created.lookupTable,
    addresses,
  });
  const packetBytes = packetBytesForInstructions([extendInstruction]);
  assert(packetBytes <= 1_232, "ALT extend packet exceeds Solana limit");
  return {
    addresses,
    extendInstruction,
    material: {
      schema: "ameba-governance-devnet-initialize-alt-extend-plan-v3",
      genesisHash: EXPECTED_GENESIS,
      observedSlot,
      planValidUntilSlot: observedSlot + 1_000,
      controllerProgram: CONTROLLER.toBase58(),
      controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      targetProgram: TARGET.toBase58(),
      targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
      initializer: INITIALIZER.toBase58(),
      authority: PAYER.toBase58(),
      payer: PAYER.toBase58(),
      lookupTable: created.lookupTable.toBase58(),
      lookupStateBefore,
      addresses: addresses.map((address) => address.toBase58()),
      addressCount: addresses.length,
      createOperationId: created.createOperationId,
      createPlanSha256: created.createPlanSha256,
      createReceiptSha256: created.createReceiptSha256,
      expectedLookupAuthority: PAYER.toBase58(),
      expectedLookupActive: true,
      expectedLookupDeactivationSlot: U64_MAX.toString(),
      expectedLookupAddresses: addresses.map((address) => address.toBase58()),
      initializationIdentities: stableInitializationIdentities(ids),
      loaderGraph: stableLoaderGraph(graph),
      instruction: instructionManifest(extendInstruction),
      planningMessageSha256: planningMessageSha256ForInstructions([extendInstruction]),
      packetBytes,
      rpcSelection: value.rpcSelection,
      rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
      mainnetAllowed: false,
    },
  };
}

async function planAltExtend() {
  const local = await context();
  await withPlanningRpc(local, "plan-alt-extend-v3", async (value) => {
    const ids = identities();
    const graph = await readLoaderGraph(value);
    await readPdasVacant(value, ids);
    const created = await loadCreatedLookup(value, ids);
    const observedSlot = value.minContextSlot;
    const { material } = altExtendPlanMaterial(value, graph, ids, created, observedSlot);
    const plan = { ...material, operationId: operationId(material) };
    assertExactKeys(plan, ALT_EXTEND_PLAN_KEYS, "ALT extend plan");
    const planFile = await writeNonOverwritingInitializationPlan({
      runDir: value.runDir,
      plan,
      canonicalFile: ALT_EXTEND_PLAN_FILE,
      pattern: ALT_EXTEND_PLAN_PATTERN,
      keys: ALT_EXTEND_PLAN_KEYS,
      journalPrefix: "controller-initialize-alt-extend-v3",
      receiptFile: "controller-initialize-alt-extend-receipt-v3.json",
      label: "ALT extend plan",
    });
    process.stdout.write(`${JSON.stringify({ ...plan, planFile: path.basename(planFile) }, null, 2)}\n`);
  });
}

async function executeAltExtend() {
  const value = await context();
  const ids = identities();
  const selectedPlan = await readSelectedInitializationPlan(
    value.runDir,
    ALT_EXTEND_PLAN_ENV,
    ALT_EXTEND_PLAN_FILE,
    ALT_EXTEND_PLAN_PATTERN,
    ALT_EXTEND_PLAN_KEYS,
    "ALT extend plan",
  );
  const plan = selectedPlan.plan;
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "ALT extend operation is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-initialize-alt-extend-plan-v3");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.rpcSelection, value.rpcSelection);
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  await withExecutionLock(value.runDir, "release1-devnet-rpc-owner", storedOperationId, async (runDir) => {
    await withExecutionRpc(value, runDir, executionJournalName("controller-initialize-alt-extend-v3", storedOperationId), storedOperationId, async (guarded, journal) => {
      const graph = await readLoaderGraph(guarded);
      const created = await loadCreatedLookup(guarded, ids);
      const rebuilt = altExtendPlanMaterial(guarded, graph, ids, created, plan.observedSlot);
      assert.deepEqual(rebuilt.material, material, "ALT extend plan no longer reconstructs exactly");
      const { extendInstruction } = rebuilt;
      const verifyExpiredPrestate = async (minContextSlot) => {
        await readLoaderGraph(guarded, minContextSlot);
        const slot = await readPdasVacant(guarded, ids, minContextSlot);
        const current = await guarded.connection.getAddressLookupTable(created.lookupTable, {
          commitment: "finalized",
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        });
        assert(current.value, "ALT is absent before extension");
        assertActiveLookup(current.value, PAYER, "ALT before extension");
        assert.deepEqual(lookupStateSnapshot(current.value), plan.lookupStateBefore, "ALT changed before extension");
        return Math.max(slot, current.context.slot);
      };
      const assertPrestate = async (minContextSlot) => {
        const slot = await verifyExpiredPrestate(minContextSlot);
        assert(slot <= plan.planValidUntilSlot, "ALT extend plan expired");
        return slot;
      };
      let landed = await reconcileOneFinalized({
        connection: guarded.connection,
        journal,
        operationId: storedOperationId,
        stage: "alt-extend",
        expectedSigners: [PAYER],
        expectedPacketBytes: plan.packetBytes,
        verifyImmediatelyBeforeResubmit: assertPrestate,
        verifyExpiredPrestate,
      });
      if (!landed) {
        const preSignSlot = await assertPrestate();
        const latestResponse = await guarded.connection.getLatestBlockhashAndContext({
          commitment: "finalized",
          minContextSlot: preSignSlot,
        });
        assert(latestResponse.context.slot >= preSignSlot, "ALT extend blockhash context predates prestate");
        const signingSlot = await assertPrestate(latestResponse.context.slot);
        assert(signingSlot >= latestResponse.context.slot, "ALT extend signing prestate predates blockhash context");
        const latest = latestResponse.value;
        const message = new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: latest.blockhash,
          instructions: [extendInstruction],
        }).compileToV0Message();
        const unsignedTransaction = new VersionedTransaction(message);
        const signerProvider = await loadInjectedSignerProvider(value.runDir);
        const signed = await signTransactionWithProvider({
          providerValue: signerProvider,
          transaction: unsignedTransaction,
          expectedSigners: [PAYER],
          operationId: storedOperationId,
          stage: "alt-extend",
        });
        const transaction = signed.transaction;
        assert.equal(transaction.serialize().length, plan.packetBytes, "ALT extend packet size changed");
        assert.equal(sha256Hex(Buffer.from(new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: EXPECTED_GENESIS,
          instructions: [extendInstruction],
        }).compileToV0Message().serialize())), plan.planningMessageSha256, "ALT extend planning message changed before signing");
        const simulation = await guarded.connection.simulateTransaction(transaction, {
          commitment: "processed",
          sigVerify: true,
          replaceRecentBlockhash: false,
          minContextSlot: signingSlot,
        });
        assert.equal(simulation.value.err, null, `ALT extend simulation failed: ${JSON.stringify(simulation.value.logs)}`);
        landed = await submitOneFinalized({
          connection: guarded.connection,
          transaction,
          latestBlockhash: latest,
          journal,
          operationId: storedOperationId,
          stage: "alt-extend",
          expectedSigners: [PAYER],
          expectedPacketBytes: plan.packetBytes,
          minContextSlot: signingSlot,
          preparedContext: {
            signerProvider: signed.providerEvidence,
            simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
          },
          verifyImmediatelyBeforeSubmit: assertPrestate,
          verifyExpiredPrestate,
        });
      }
      assert(landed, "ALT extension did not produce a finalized transaction");
      const lookup = await guarded.connection.getAddressLookupTable(created.lookupTable, {
        commitment: "finalized",
        minContextSlot: landed.slot,
      });
      assert(lookup.context.slot >= landed.slot, "ALT extend postread predates the transaction");
      assert(lookup.value, "extended lookup table is absent");
      assertActiveLookup(lookup.value, new PublicKey(plan.expectedLookupAuthority), "extended lookup table");
      assert.equal(lookup.value.isActive(), plan.expectedLookupActive, "extended lookup table active state changed");
      assert.equal(lookup.value.state.deactivationSlot.toString(), plan.expectedLookupDeactivationSlot, "extended lookup table deactivation changed");
      assert.deepEqual(lookup.value.state.addresses.map((address) => address.toBase58()), plan.expectedLookupAddresses, "lookup table addresses changed");
      await readLoaderGraph(guarded, landed.slot);
      await readPdasVacant(guarded, ids, landed.slot);
      const lookupState = lookupStateSnapshot(lookup.value);
      const receipt = {
        schema: "ameba-governance-devnet-initialize-alt-extend-receipt-v3",
        operationId: storedOperationId,
        planFile: path.basename(selectedPlan.file),
        planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
        createOperationId: plan.createOperationId,
        createPlanSha256: plan.createPlanSha256,
        createReceiptSha256: plan.createReceiptSha256,
        genesisHash: EXPECTED_GENESIS,
        lookupTable: created.lookupTable.toBase58(),
        authority: PAYER.toBase58(),
        addresses: plan.addresses,
        active: lookupState.active,
        deactivationSlot: lookupState.deactivationSlot,
        lastExtendedSlot: lookupState.lastExtendedSlot,
        lastExtendedSlotStartIndex: lookupState.lastExtendedSlotStartIndex,
        simulationUnitsConsumed: landed.preparedContext?.simulationUnitsConsumed ?? null,
        finalizedObservationSlot: lookup.context.slot,
        ...landed,
      };
      await writeExclusiveJson(path.join(runDir, "controller-initialize-alt-extend-receipt-v3.json"), receipt);
      await journal.append("receipt-written", {
        stage: "alt-extend",
        signature: landed.signature,
        receiptSha256: sha256Hex(Buffer.from(JSON.stringify(receipt), "utf8")),
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    });
  });
}

async function hashFiles(label, files) {
  const hash = createHash("sha256").update(label, "utf8");
  for (const file of files) {
    hash.update(path.basename(file), "utf8");
    hash.update(await readFile(file));
  }
  return hash.digest();
}

async function initializationModel(value, ids, observedSlot, controllerCapacity) {
  const clusterDomain = clusterDomainFromGenesisHashV1(EXPECTED_GENESIS);
  const activationSlot = BigInt(observedSlot);
  const seatTerms = SEATS.map(() => ({ termStartSlot: activationSlot, termEndSlot: BOOTSTRAP_INITIAL_SEAT_TERM_END_V2 }));
  assert.equal(BOOTSTRAP_INITIAL_SEAT_TERM_END_V2, U64_MAX);
  const policy = {
    discriminator: GOVERNANCE_POLICY_V1_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.policyBump,
    initialized: true,
    controllerConfig: ids.config,
    version: 1n,
    targetProgram: TARGET,
    activationSlot,
    councilSize: 5,
    routineThreshold: 3,
    terminalThreshold: 4,
    governanceMode: 0,
    policyFlags: 0,
    vetoQuorumBps: 0,
    affirmativeQuorumBps: 0,
    affirmativeApprovalBps: 0,
    routineRequiresVote: false,
    economicRequiresVote: false,
    constitutionalRequiresVote: false,
    rotationRequiresVote: false,
    immutabilityRequiresVote: false,
    policyHash: Buffer.alloc(32),
    reserved: Buffer.alloc(21),
  };
  policy.policyHash = governancePolicyHash(policy);
  serializeGovernancePolicyV1(policy);
  const council = {
    discriminator: GOVERNANCE_COUNCIL_SET_V1_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.councilBump,
    initialized: true,
    controllerConfig: ids.config,
    version: 1n,
    targetProgram: TARGET,
    activationSlot,
    deactivationSlot: 0n,
    seats: SEATS.map((seatAuthority) => ({ seatAuthority, termStartSlot: activationSlot, termEndSlot: U64_MAX, active: true, reserved: Buffer.alloc(47) })),
    routineThreshold: 3,
    terminalThreshold: 4,
    policyFlags: 0,
    setHash: Buffer.alloc(32),
    reserved: Buffer.alloc(26),
  };
  council.setHash = governanceCouncilSetHash(council);
  serializeGovernanceCouncilSetV1(council);
  const geometry = programDataObservationGeometryV1(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1, PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1);
  const capacityPolicy = {
    discriminator: PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.capacityPolicyBump,
    initialized: true,
    controllerProgram: CONTROLLER,
    controllerConfig: ids.config,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    loaderProgramdataMetadataLen: LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
    maximumRawProgramdataLength: BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1),
    maximumPayloadCapacity: MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
    maximumArtifactLength: BigInt(MAX_ARTIFACT_BYTES_V1),
    observationSchemeId: PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
    observationChunkSize: PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
    observationMaxChunkCount: geometry.chunkCount,
    observationPaddedLeafCount: geometry.paddedChunkCount,
    observationTreeDepth: geometry.treeDepth,
    observationFrontierHashCount: PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    artifactChunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    zeroTailRequired: true,
    extendProgramCheckedFeature: EXTEND_PROGRAM_CHECKED_FEATURE_ID_V1,
    setAuthorityCheckedFeature: SET_AUTHORITY_CHECKED_FEATURE_ID_V1,
    policyDigest: Buffer.alloc(32),
    creationSlot: activationSlot,
    reserved: Buffer.alloc(PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN),
  };
  capacityPolicy.policyDigest = programDataCapacityPolicyDigestV1(capacityPolicy);
  serializeProgramDataCapacityPolicyV1(capacityPolicy);

  const root = value.runDir;
  const buildRoot = path.join(root, "controller-build-9f34143", "v0");
  const deploymentEvidence = await loadControllerDeploymentManifestEvidence(value);
  const sourceCommitment = sha256(Buffer.from("AMOEBA_CONTROLLER_SOURCE_COMMIT_V1", "ascii"), Buffer.from(SOURCE_COMMIT, "hex"));
  const sourceTreeCommitment = sha256(Buffer.from("AMOEBA_CONTROLLER_SOURCE_TREE_V1", "ascii"), Buffer.from(SOURCE_TREE, "hex"));
  const buildInputsCommitment = await hashFiles("AMOEBA_CONTROLLER_BUILD_INPUTS_V1", [
    path.join(buildRoot, "command.txt"),
    path.join(buildRoot, "receipt.txt"),
  ]);
  const toolchainCommitment = await hashFiles("AMOEBA_CONTROLLER_TOOLCHAIN_V1", [path.join(buildRoot, "command.txt")]);
  const packageCommitment = sha256(Buffer.from("AMOEBA_CONTROLLER_PACKAGE_V1", "ascii"), value.artifact, await readFile(path.join(buildRoot, "receipt.txt")));
  const releaseManifestCommitment = await hashFiles("AMOEBA_CONTROLLER_DEPLOY_MANIFEST_V1", [
    deploymentEvidence.manifestPath,
  ]);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const abiCommitment = await hashFiles("AMOEBA_CONTROLLER_ABI_V1", [
    path.join(repo, "programs", "upgrade_controller", "src", "release1_v3_instruction.rs"),
    path.join(repo, "clients", "ts", "upgradeGovernance", "release1CurrentInstructions.test.ts"),
  ]);
  const controllerRelease = {
    discriminator: CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR,
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.controllerReleaseBump,
    initialized: true,
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    capacityPolicy: ids.capacityPolicy,
    capacityPolicyDigest: capacityPolicy.policyDigest,
    artifactLength: BigInt(value.artifact.length),
    artifactSha256: sha256(value.artifact),
    artifactMerkleRoot: artifactMerkleRoot(value.artifact),
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    sourceCommitment,
    sourceTreeCommitment,
    buildInputsCommitment,
    toolchainCommitment,
    packageCommitment,
    releaseManifestCommitment,
    abiCommitment,
    preImmutabilityAuthority: { present: true, value: INITIALIZER },
    minimumProgramdataCapacity: BigInt(controllerCapacity),
    releaseDigest: Buffer.alloc(32),
    creationSlot: activationSlot,
    finalized: true,
    reserved: Buffer.alloc(CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN),
  };
  controllerRelease.releaseDigest = controllerReleaseDigestV1(controllerRelease);
  serializeControllerReleaseCommitmentV1(controllerRelease);
  return {
    activationSlot,
    capacityPolicy,
    clusterDomain,
    controllerRelease,
    council,
    deploymentManifestSha256: deploymentEvidence.manifestSha256,
    policy,
    seatTerms,
  };
}

function instruction(ids, model) {
  return buildInitializeControllerV2Instruction(CONTROLLER, {
    payer: PAYER,
    initializer: INITIALIZER,
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerConfig: ids.config,
    authorityPda: ids.authority,
    protocolGate: ids.gate,
    policy: ids.policy,
    council: ids.council,
    capacityPolicy: ids.capacityPolicy,
    controllerRelease: ids.controllerRelease,
    canonicalSpillTreasury: TREASURY,
    guardian: GUARDIAN,
    seatAuthorities: SEATS,
    systemProgram: SystemProgram.programId,
  }, {
    clusterDomain: model.clusterDomain,
    initialPolicyVersion: 1n,
    initialCouncilVersion: 1n,
    nextProposalId: 1n,
    targetNonce: 1n,
    initialGateEpoch: 1n,
    policyActivationSlot: model.activationSlot,
    routineDelaySlots: ROUTINE_DELAY_SLOTS,
    majorDelaySlots: MAJOR_DELAY_SLOTS,
    rollbackDelaySlots: ROLLBACK_DELAY_SLOTS,
    terminalDelaySlots: TERMINAL_DELAY_SLOTS,
    voteReviewSlots: VOTE_REVIEW_SLOTS,
    proposalExpirySlots: PROPOSAL_EXPIRY_SLOTS,
    expectedPolicyHash: model.policy.policyHash,
    expectedCouncilHash: model.council.setHash,
    seatTerms: model.seatTerms,
    capacityPolicy: { expectedPolicyDigest: model.capacityPolicy.policyDigest },
    controllerRelease: {
      artifactLength: model.controllerRelease.artifactLength,
      artifactSha256: model.controllerRelease.artifactSha256,
      artifactMerkleRoot: model.controllerRelease.artifactMerkleRoot,
      sourceCommitment: model.controllerRelease.sourceCommitment,
      sourceTreeCommitment: model.controllerRelease.sourceTreeCommitment,
      buildInputsCommitment: model.controllerRelease.buildInputsCommitment,
      toolchainCommitment: model.controllerRelease.toolchainCommitment,
      packageCommitment: model.controllerRelease.packageCommitment,
      releaseManifestCommitment: model.controllerRelease.releaseManifestCommitment,
      abiCommitment: model.controllerRelease.abiCommitment,
      expectedReleaseDigest: model.controllerRelease.releaseDigest,
    },
  });
}

async function lookupFromReceipt(value, ids, minContextSlot) {
  const receiptFile = await secureFileInsideRunDir(
    value.runDir,
    path.join(value.runDir, "controller-initialize-alt-extend-receipt-v3.json"),
    "ALT extend receipt",
  );
  const receiptBytes = await readFile(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.schema, "ameba-governance-devnet-initialize-alt-extend-receipt-v3");
  assert(typeof receipt.planFile === "string" && ALT_EXTEND_PLAN_PATTERN.test(receipt.planFile), "ALT extend receipt plan filename changed");
  const selectedPlan = await readExactInitializationPlan(
    value.runDir,
    path.join(value.runDir, receipt.planFile),
    ALT_EXTEND_PLAN_PATTERN,
    ALT_EXTEND_PLAN_KEYS,
    "ALT extend receipt plan",
  );
  const planBytes = selectedPlan.raw;
  const plan = selectedPlan.plan;
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(receipt.operationId, plan.operationId, "ALT extend receipt operation changed");
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")), "ALT extend receipt plan hash changed");
  assert.equal(receipt.lookupTable, plan.lookupTable, "ALT extend receipt table changed");
  assert.equal(receipt.authority, plan.expectedLookupAuthority, "ALT extend receipt authority changed");
  assert.deepEqual(receipt.addresses, plan.expectedLookupAddresses, "ALT extend receipt addresses changed");
  assert.equal(receipt.active, plan.expectedLookupActive, "ALT extend receipt active state changed");
  assert.equal(receipt.deactivationSlot, plan.expectedLookupDeactivationSlot, "ALT extend receipt deactivation slot changed");
  assert(Number.isSafeInteger(receipt.slot) && receipt.slot > 0, "ALT extend receipt finalized slot is invalid");
  const address = new PublicKey(receipt.lookupTable);
  const requiredSlot = Math.max(receipt.slot, minContextSlot ?? 0);
  const lookup = await value.connection.getAddressLookupTable(address, {
    commitment: "finalized",
    minContextSlot: requiredSlot,
  });
  advanceMinContextSlot(value, lookup.context.slot, "initialization lookup read");
  assert(lookup.context.slot >= requiredSlot, "initialization lookup read predates its required slot");
  assert(lookup.value, "initialization lookup table is absent");
  assertActiveLookup(lookup.value, PAYER, "initialization lookup table");
  assert.deepEqual(lookupStateSnapshot(lookup.value), {
    authority: receipt.authority,
    active: receipt.active,
    deactivationSlot: receipt.deactivationSlot,
    lastExtendedSlot: receipt.lastExtendedSlot,
    lastExtendedSlotStartIndex: receipt.lastExtendedSlotStartIndex,
    addresses: receipt.addresses,
  }, "initialization lookup table differs from its receipt");
  assert(lookup.context.slot > lookup.value.state.lastExtendedSlot, "initialization lookup table is not warm yet");
  return lookup.value;
}

const INITIALIZE_PLAN_KEYS = [
  "schema", "genesisHash", "observedSlot", "planValidUntilSlot", "rpcSelection",
  "rpcProviderOriginSha256", "mainnetAllowed", "controllerProgram", "controllerProgramdata",
  "targetProgram", "targetProgramdata", "upgradeableLoader", "payer", "initializer",
  "canonicalSpillTreasury", "guardian", "seats", "controllerConfig", "authorityPda",
  "protocolGate", "policy", "council", "capacityPolicy", "controllerRelease", "lookupTable",
  "lookupAddresses", "lookupState", "clusterDomainHex", "policyActivationSlot",
  "initialPolicyVersion", "initialCouncilVersion", "nextProposalId", "targetNonce",
  "initialGateEpoch", "timing", "policyHash", "councilHash", "capacityPolicyDigest",
  "controllerReleaseDigest", "controllerArtifact", "controllerSource", "deploymentManifestSha256",
  "loaderGraph", "instructions", "planningMessageSha256", "packetBytes", "operationId",
];

function stableLoaderGraph(graph) {
  return {
    controller: {
      program: CONTROLLER.toBase58(),
      programdata: CONTROLLER_PROGRAMDATA.toBase58(),
      authority: INITIALIZER.toBase58(),
      deployedSlot: graph.controllerDeployedSlot.toString(),
      capacity: graph.controllerCapacity,
      rawBytes: graph.controllerRawBytes,
      rawSha256: graph.controllerRawSha256,
      payloadSha256: graph.controllerPayloadSha256,
    },
    target: {
      program: TARGET.toBase58(),
      programdata: TARGET_PROGRAMDATA.toBase58(),
      authority: graph.targetAuthority,
      deployedSlot: graph.targetDeployedSlot.toString(),
      capacity: graph.targetCapacity,
      rawBytes: graph.targetRawBytes,
      rawSha256: graph.targetRawSha256,
      payloadSha256: graph.targetPayloadSha256,
    },
  };
}

function initializeInstructions(ids, model) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000n }),
    instruction(ids, model),
  ];
}

async function initializationPlanMaterial(value, ids, graph, lookup, observedSlot) {
  assertActiveLookup(lookup, PAYER, "initialization lookup table");
  assert.deepEqual(lookup.state.addresses.map((address) => address.toBase58()), lookupAddresses(ids).map((address) => address.toBase58()), "initialization lookup addresses changed");
  const model = await initializationModel(value, ids, observedSlot, graph.controllerCapacity);
  const instructions = initializeInstructions(ids, model);
  const planningMessage = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: EXPECTED_GENESIS,
    instructions,
  }).compileToV0Message([lookup]);
  const packetBytes = new VersionedTransaction(planningMessage).serialize().length;
  assert(packetBytes <= 1_232, `initialization packet is ${packetBytes} bytes`);
  const material = {
    schema: "ameba-governance-devnet-controller-initialize-plan-v3",
    genesisHash: EXPECTED_GENESIS,
    observedSlot,
    planValidUntilSlot: observedSlot + 1_000,
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
    mainnetAllowed: false,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    payer: PAYER.toBase58(),
    initializer: INITIALIZER.toBase58(),
    canonicalSpillTreasury: TREASURY.toBase58(),
    guardian: GUARDIAN.toBase58(),
    seats: SEATS.map((seat) => seat.toBase58()),
    controllerConfig: ids.config.toBase58(),
    authorityPda: ids.authority.toBase58(),
    protocolGate: ids.gate.toBase58(),
    policy: ids.policy.toBase58(),
    council: ids.council.toBase58(),
    capacityPolicy: ids.capacityPolicy.toBase58(),
    controllerRelease: ids.controllerRelease.toBase58(),
    lookupTable: lookup.key.toBase58(),
    lookupAddresses: lookup.state.addresses.map((address) => address.toBase58()),
    lookupState: lookupStateSnapshot(lookup),
    clusterDomainHex: model.clusterDomain.toString("hex"),
    policyActivationSlot: model.activationSlot.toString(),
    initialPolicyVersion: "1",
    initialCouncilVersion: "1",
    nextProposalId: "1",
    targetNonce: "1",
    initialGateEpoch: "1",
    timing: {
      rollbackDelaySlots: ROLLBACK_DELAY_SLOTS.toString(),
      routineDelaySlots: ROUTINE_DELAY_SLOTS.toString(),
      majorDelaySlots: MAJOR_DELAY_SLOTS.toString(),
      terminalDelaySlots: TERMINAL_DELAY_SLOTS.toString(),
      voteReviewSlots: VOTE_REVIEW_SLOTS.toString(),
      proposalExpirySlots: PROPOSAL_EXPIRY_SLOTS.toString(),
    },
    policyHash: model.policy.policyHash.toString("hex"),
    councilHash: model.council.setHash.toString("hex"),
    capacityPolicyDigest: model.capacityPolicy.policyDigest.toString("hex"),
    controllerReleaseDigest: model.controllerRelease.releaseDigest.toString("hex"),
    controllerArtifact: {
      bytes: value.artifact.length,
      sha256: sha256Hex(value.artifact),
      merkleRoot: model.controllerRelease.artifactMerkleRoot.toString("hex"),
      merkleSchemeId: ARTIFACT_MERKLE_SCHEME_ID_HEX,
      chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    },
    controllerSource: { commit: SOURCE_COMMIT, tree: SOURCE_TREE },
    deploymentManifestSha256: model.deploymentManifestSha256,
    loaderGraph: stableLoaderGraph(graph),
    instructions: instructions.map(instructionManifest),
    planningMessageSha256: sha256Hex(Buffer.from(planningMessage.serialize())),
    packetBytes,
  };
  return { instructions, material, model };
}

async function assertInitializationInputs(value, ids, plan, minContextSlot, enforcePlanValidity = true) {
  await readPdasVacant(value, ids, minContextSlot);
  const graph = await readLoaderGraph(value, minContextSlot);
  const lookup = await lookupFromReceipt(value, ids, minContextSlot);
  const currentSlot = value.minContextSlot;
  if (enforcePlanValidity) assert(currentSlot <= plan.planValidUntilSlot, "initialize plan expired");
  const rebuilt = await initializationPlanMaterial(value, ids, graph, lookup, plan.observedSlot);
  const { operationId: _operationId, ...plannedMaterial } = plan;
  assertInitializationPlanMaterialExact(
    rebuilt.material,
    plannedMaterial,
    "initialize plan no longer matches finalized inputs",
  );
  return { ...rebuilt, currentSlot, graph, lookup };
}

function expectedInitializedAccountBytes(ids, model, finalizedSlot) {
  const creationSlot = BigInt(finalizedSlot);
  const config = {
    discriminator: CONTROLLER_CONFIG_V1_DISCRIMINATOR,
    version: 1,
    bump: ids.configBump,
    initialized: true,
    clusterDomain: model.clusterDomain,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    authorityPda: ids.authority,
    gatePda: ids.gate,
    canonicalSpillTreasury: TREASURY,
    currentCouncilVersion: 1n,
    currentPolicyVersion: 1n,
    nextProposalId: 1n,
    targetNonce: 1n,
    guardian: GUARDIAN,
    voteProgram: PublicKey.default,
    voteProgramdata: PublicKey.default,
    voteConfig: PublicKey.default,
    voteMint: PublicKey.default,
    tokenGovernanceEnabled: false,
    routineDelaySlots: ROUTINE_DELAY_SLOTS,
    majorDelaySlots: MAJOR_DELAY_SLOTS,
    rollbackDelaySlots: ROLLBACK_DELAY_SLOTS,
    terminalDelaySlots: TERMINAL_DELAY_SLOTS,
    voteReviewSlots: VOTE_REVIEW_SLOTS,
    proposalExpirySlots: PROPOSAL_EXPIRY_SLOTS,
    policyFlags: 0n,
    reserved: Buffer.alloc(28),
  };
  const gate = {
    discriminator: PROTOCOL_GATE_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.gateBump,
    initialized: true,
    status: 2,
    controllerConfig: ids.config,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    epoch: 1n,
    activeProposal: PublicKey.default,
    freezeSlot: creationSlot,
    freezeReasonCode: 1,
    lastCompletedProposal: PublicKey.default,
    reserved: Buffer.alloc(2),
  };
  const capacityPolicy = { ...model.capacityPolicy, creationSlot };
  const controllerRelease = { ...model.controllerRelease, creationSlot };
  return [
    { address: ids.config, bytes: serializeControllerConfigV1(config) },
    { address: ids.gate, bytes: serializeProtocolGateV1(gate) },
    { address: ids.policy, bytes: serializeGovernancePolicyFixedV1(model.policy) },
    { address: ids.council, bytes: serializeGovernanceCouncilSetFixedV1(model.council) },
    { address: ids.capacityPolicy, bytes: serializeProgramDataCapacityPolicyV1(capacityPolicy) },
    { address: ids.controllerRelease, bytes: serializeControllerReleaseCommitmentV1(controllerRelease) },
  ];
}

async function planInitialize() {
  const local = await context();
  await withPlanningRpc(local, "plan-initialize-v3", async (value) => {
    const ids = identities();
    const graph = await readLoaderGraph(value);
    await readPdasVacant(value, ids);
    const lookup = await lookupFromReceipt(value, ids);
    const observedSlot = value.minContextSlot;
    const { material } = await initializationPlanMaterial(value, ids, graph, lookup, observedSlot);
    const plan = { ...material, operationId: operationId(material) };
    assertExactKeys(plan, INITIALIZE_PLAN_KEYS, "controller initialize plan");
    const planFile = await writeNonOverwritingInitializationPlan({
      runDir: value.runDir,
      plan,
      canonicalFile: INITIALIZE_PLAN_FILE,
      pattern: INITIALIZE_PLAN_PATTERN,
      keys: INITIALIZE_PLAN_KEYS,
      journalPrefix: "controller-initialize-v3",
      receiptFile: "controller-initialize-receipt-v3.json",
      label: "controller initialize plan",
    });
    process.stdout.write(`${JSON.stringify({ ...plan, planFile: path.basename(planFile) }, null, 2)}\n`);
  });
}

async function executeInitialize() {
  const value = await context();
  const ids = identities();
  const selectedPlan = await readSelectedInitializationPlan(
    value.runDir,
    INITIALIZE_PLAN_ENV,
    INITIALIZE_PLAN_FILE,
    INITIALIZE_PLAN_PATTERN,
    INITIALIZE_PLAN_KEYS,
    "controller initialize plan",
  );
  const plan = selectedPlan.plan;
  const { operationId: storedOperationId, ...plannedMaterial } = plan;
  canonicalInitializationPlanMaterialForComparison(
    plannedMaterial,
    "controller initialize plan",
    { allowLegacyBufferJson: true },
  );
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "initialize operation is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-controller-initialize-plan-v3");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.rpcSelection, value.rpcSelection);
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  await withExecutionLock(value.runDir, "release1-devnet-rpc-owner", storedOperationId, async (runDir) => {
    await withExecutionRpc(value, runDir, executionJournalName("controller-initialize-v3", storedOperationId), storedOperationId, async (guarded, journal) => {
      // Reconstruct every plan field without requiring the pre-initialize PDA
      // vacancy. That lets a rerun reconcile a transaction that finalized
      // after the prior process stopped but before its receipt was written.
      const graph = await readLoaderGraph(guarded);
      const lookup = await lookupFromReceipt(guarded, ids);
      const reconstructed = await initializationPlanMaterial(guarded, ids, graph, lookup, plan.observedSlot);
      assertInitializationPlanMaterialExact(
        reconstructed.material,
        plannedMaterial,
        "initialize plan no longer reconstructs exactly",
      );
      const assertPrestate = async (minContextSlot) => assertInitializationInputs(guarded, ids, plan, minContextSlot);
      const verifyExpiredPrestate = async (minContextSlot) => assertInitializationInputs(guarded, ids, plan, minContextSlot, false);
      let landed = await reconcileOneFinalized({
        connection: guarded.connection,
        journal,
        operationId: storedOperationId,
        stage: "controller-initialize",
        expectedSigners: [PAYER, INITIALIZER],
        expectedPacketBytes: plan.packetBytes,
        verifyImmediatelyBeforeResubmit: assertPrestate,
        verifyExpiredPrestate,
      });
      if (!landed) {
        const preSign = await assertPrestate();
        const latestResponse = await guarded.connection.getLatestBlockhashAndContext({
          commitment: "finalized",
          minContextSlot: preSign.currentSlot,
        });
        assert(latestResponse.context.slot >= preSign.currentSlot, "initialize blockhash context predates prestate");
        const signingState = await assertPrestate(latestResponse.context.slot);
        assert(signingState.currentSlot >= latestResponse.context.slot, "initialize signing prestate predates blockhash context");
        const latest = latestResponse.value;
        const message = new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: latest.blockhash,
          instructions: signingState.instructions,
        }).compileToV0Message([signingState.lookup]);
        const unsignedTransaction = new VersionedTransaction(message);
        const signerProvider = await loadInjectedSignerProvider(value.runDir);
        const signed = await signTransactionWithProvider({
          providerValue: signerProvider,
          transaction: unsignedTransaction,
          expectedSigners: [PAYER, INITIALIZER],
          operationId: storedOperationId,
          stage: "controller-initialize",
        });
        const transaction = signed.transaction;
        assert.equal(transaction.serialize().length, plan.packetBytes, "initialize packet size changed");
        assert(transaction.serialize().length <= 1_232, "initialize packet exceeds Solana limit");
        assert.deepEqual(signingState.instructions.map(instructionManifest), plan.instructions, "initialize instructions changed before signing");
        const normalizedMessage = new TransactionMessage({
          payerKey: PAYER,
          recentBlockhash: EXPECTED_GENESIS,
          instructions: signingState.instructions,
        }).compileToV0Message([signingState.lookup]);
        assert.equal(sha256Hex(Buffer.from(normalizedMessage.serialize())), plan.planningMessageSha256, "initialize planning message changed before signing");
        const simulation = await guarded.connection.simulateTransaction(transaction, {
          commitment: "processed",
          sigVerify: true,
          replaceRecentBlockhash: false,
          minContextSlot: signingState.currentSlot,
        });
        assert.equal(simulation.value.err, null, `initialize simulation failed: ${JSON.stringify(simulation.value.logs)}`);
        landed = await submitOneFinalized({
          connection: guarded.connection,
          transaction,
          latestBlockhash: latest,
          journal,
          operationId: storedOperationId,
          stage: "controller-initialize",
          expectedSigners: [PAYER, INITIALIZER],
          expectedPacketBytes: plan.packetBytes,
          minContextSlot: signingState.currentSlot,
          preparedContext: {
            signerProvider: signed.providerEvidence,
            simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
          },
          verifyImmediatelyBeforeSubmit: assertPrestate,
          verifyExpiredPrestate,
        });
      }
      assert(landed, "controller initialization did not produce a finalized transaction");
      const expectedAccounts = expectedInitializedAccountBytes(ids, reconstructed.model, landed.slot);
      const response = await guarded.connection.getMultipleAccountsInfoAndContext(
        expectedAccounts.map((entry) => entry.address),
        { commitment: "finalized", minContextSlot: landed.slot },
      );
      assert.equal(response.value.length, expectedAccounts.length, "post-initialize account response length changed");
      assert(response.context.slot >= landed.slot, "post-initialize observation predates the transaction");
      for (let index = 0; index < expectedAccounts.length; index += 1) {
        const account = response.value[index];
        const expected = expectedAccounts[index];
        assert(account, `${expected.address.toBase58()} was not created`);
        assert(account.owner.equals(CONTROLLER), `${expected.address.toBase58()} has the wrong owner`);
        assert.equal(account.executable, false, `${expected.address.toBase58()} is unexpectedly executable`);
        assert(account.data.equals(expected.bytes), `${expected.address.toBase58()} bytes differ from the initialized model`);
      }
      const [configAccount, gateAccount, policyAccount, councilAccount, capacityAccount, releaseAccount] = response.value;
      const config = deserializeControllerConfigV1(configAccount.data);
      const gate = deserializeProtocolGateV1(gateAccount.data);
      const policy = deserializeGovernancePolicyFixedV1(policyAccount.data);
      const council = deserializeGovernanceCouncilSetFixedV1(councilAccount.data);
      const capacityPolicy = deserializeProgramDataCapacityPolicyV1(capacityAccount.data);
      const controllerRelease = deserializeControllerReleaseCommitmentV1(releaseAccount.data);
      const postGraph = await readLoaderGraph(guarded, landed.slot);
      assert.deepEqual(stableLoaderGraph(postGraph), plan.loaderGraph, "loader graph changed during initialization");
      const postLookup = await lookupFromReceipt(guarded, ids, landed.slot);
      assert.deepEqual(lookupStateSnapshot(postLookup), plan.lookupState, "lookup table changed during initialization");
      const receipt = {
        schema: "ameba-governance-devnet-controller-initialize-receipt-v3",
        operationId: storedOperationId,
        planFile: path.basename(selectedPlan.file),
        planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
        genesisHash: EXPECTED_GENESIS,
        rpcSelection: value.rpcSelection,
        rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
        controllerProgram: CONTROLLER.toBase58(),
        controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
        targetProgram: TARGET.toBase58(),
        targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
        payer: PAYER.toBase58(),
        initializer: INITIALIZER.toBase58(),
        lookupTable: lookup.key.toBase58(),
        lookupActive: postLookup.isActive(),
        lookupDeactivationSlot: postLookup.state.deactivationSlot.toString(),
        simulationUnitsConsumed: landed.preparedContext?.simulationUnitsConsumed ?? null,
        finalizedObservationSlot: response.context.slot,
        gateStatus: gate.status,
        gateEpoch: gate.epoch.toString(),
        freezeSlot: gate.freezeSlot.toString(),
        freezeReasonCode: gate.freezeReasonCode,
        tokenGovernanceEnabled: config.tokenGovernanceEnabled,
        targetNonce: config.targetNonce.toString(),
        policyHash: policy.policyHash.toString("hex"),
        councilHash: council.setHash.toString("hex"),
        capacityPolicyDigest: capacityPolicy.policyDigest.toString("hex"),
        controllerReleaseDigest: controllerRelease.releaseDigest.toString("hex"),
        deploymentManifestSha256: plan.deploymentManifestSha256,
        accountRawSha256: Object.fromEntries(expectedAccounts.map((entry, index) => [
          entry.address.toBase58(),
          sha256Hex(response.value[index].data),
        ])),
        ...landed,
      };
      await writeExclusiveJson(path.join(runDir, "controller-initialize-receipt-v3.json"), receipt);
      await journal.append("receipt-written", {
        stage: "controller-initialize",
        signature: landed.signature,
        receiptSha256: sha256Hex(Buffer.from(JSON.stringify(receipt), "utf8")),
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    });
  });
}

const mode = process.argv[2];
if (mode === "self-test-deployment-manifest") {
  process.stdout.write(`${JSON.stringify(controllerDeploymentManifestValidatorSelfTest(), null, 2)}\n`);
} else if (mode === "plan-alt") await planAlt();
else if (mode === "execute-alt-create") await executeAltCreate();
else if (mode === "plan-alt-extend") await planAltExtend();
else if (mode === "execute-alt-extend") await executeAltExtend();
else if (mode === "plan-initialize") await planInitialize();
else if (mode === "execute-initialize") await executeInitialize();
else throw new Error("expected self-test-deployment-manifest, plan-alt, execute-alt-create, plan-alt-extend, execute-alt-extend, plan-initialize, or execute-initialize");
