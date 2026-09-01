import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  RpcBackoffExit,
  guardRpcConnection,
  loadInjectedSignerProvider,
  openJournal,
  operationId,
  reconcileOneFinalized,
  selfTestCeremonyRuntime,
  sha256Hex,
  signTransactionWithProvider,
  submitOneFinalized,
  withCeremonyRpcOwnerLock,
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
  artifactChunkCount,
  artifactMerkleProof,
  artifactMerkleRoot,
} from "../dist/upgradeGovernance/artifactMerkleV1.js";
import {
  GateStatusV1,
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
} from "../dist/upgradeGovernance/release1.js";
import {
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN,
  CEREMONY_ACCOUNT_VERSION_V1,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
  CURRENT_DEPLOYMENT_STATE_V1_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN,
  PROGRAMDATA_CAPACITY_POLICY_V1_LEN,
  PROGRAMDATA_OBSERVATION_V1_LEN,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN,
  bootstrapActivationDeploymentPlanDigestV1,
  bootstrapActivationReceiptPlanDigestV1,
  deriveBootstrapActivationReceiptPdaV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerImmutabilityReceiptPdaV1,
  deriveCurrentDeploymentStatePdaV1,
  deriveProgramDataObservationPdaV1,
  deriveTargetAuthorityHandoffReceiptPdaV1,
  deserializeBootstrapActivationReceiptV1,
  deserializeControllerImmutabilityReceiptV1,
  deserializeCurrentDeploymentStateV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  deserializeTargetAuthorityHandoffReceiptV1,
  programDataObservationSubjectDigestV1,
  validateBootstrapActivationReceiptDigestV1,
  validateControllerImmutabilityReceiptDigestV1,
  validateCurrentDeploymentDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
  validateTargetAuthorityHandoffReceiptDigestV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import {
  buildAppendProgramDataObservationChunkV1Instruction,
  buildBeginProgramDataObservationV1Instruction,
  buildFinalizeProgramDataObservationV1Instruction,
  buildVerifyObservedArtifactChunkV1Instruction,
} from "../dist/upgradeGovernance/release1CeremonyInstructions.js";
import {
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  programDataObservationGeometryV1,
  programDataObservationMerkleRootV1,
  programDataRawSha256ReceiptV1,
} from "../dist/upgradeGovernance/programDataObservationMerkleV1.js";
import {
  GovernanceActionKindV2,
  GovernanceLifecycleStateV2,
  GovernanceTimingClassV1,
  BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN,
  GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN,
  GOVERNANCE_TIMING_PROFILE_V1_LEN,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN,
  deriveGovernanceActionProposalPdaV2,
  deriveGovernanceLifecycleRegistryPdaV2,
  deriveGovernanceTimingProfilePdaV1,
  deriveProposalTimingV2,
  deserializeBootstrapActivationProposalV2,
  deserializeGovernanceLifecycleRegistryV2,
  deserializeGovernanceTimingProfileV1,
  deserializeTargetAuthorityHandoffProposalV2,
  nominalGovernanceTimingProfileV1,
} from "../dist/upgradeGovernance/release1GovernanceV2.js";
import {
  buildApproveBootstrapActivationProposalV2Instruction,
  buildApproveTargetAuthorityHandoffProposalV2Instruction,
  buildCreateBootstrapActivationProposalV2Instruction,
  buildCreateTargetAuthorityHandoffProposalV2Instruction,
  buildExecuteBootstrapActivationProposalV2Instruction,
  buildExecuteTargetAuthorityHandoffProposalV2Instruction,
  buildQueueBootstrapActivationProposalV2Instruction,
  buildQueueTargetAuthorityHandoffProposalV2Instruction,
} from "../dist/upgradeGovernance/release1GovernanceV2Instructions.js";
import { buildCanonicalRelease1LoaderEnvelopeV1 } from "../dist/upgradeGovernance/release1PacketPlanning.js";
import { clusterDomainFromGenesisHashV1 } from "../dist/upgradeGovernance/release1Planning.js";
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
  deriveUpgradeableProgramdataAddress,
  deserializeProtocolGateV1,
  governanceCouncilSetHash,
  governancePolicyHash,
} from "../dist/upgradeGovernance/v1.js";
import {
  deserializeControllerConfigV1,
  deserializeGovernanceCouncilSetFixedV1,
  deserializeGovernancePolicyFixedV1,
} from "../dist/upgradeGovernance/v1FixedAccounts.js";

process.umask(0o077);

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BASE_DESCRIPTOR_SHA256 = "315449f8e4cdca69ca3e5ff934d24e1af029cc1578cc5d9eb01d03644d767450";
const AMENDED_DESCRIPTOR_SHA256 = "d12f0a7c0ef6d477fa49a164c093a36e181cf8a5bf14e0d762faecefb6848cd9";
const BASE_TIMING_HASH = "1663ed402b211cc47b5318cec498fc92ec6f87e2c0178ae6d1536ead7f5f7ebe";
const CURRENT_TIMING_HASH = "1b35ca7d503ea56ae5d6f8fa0de4346b5ba406aa7da0c8b7e76ec65c0d50ab37";
const EXPECTED_CONTROLLER = "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm";
const EXPECTED_CONTROLLER_PROGRAMDATA = "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed";
const EXPECTED_TARGET = "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
const EXPECTED_TARGET_PROGRAMDATA = "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
const EXPECTED_LEGACY_AUTHORITY = "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
const PLAN_SCHEMA = "ameba-governance-devnet-v2-handoff-activation-next-plan-v1";
const RECEIPT_SCHEMA = "ameba-governance-devnet-v2-handoff-activation-stage-receipt-v1";
const FINAL_RECEIPT_SCHEMA = "ameba-governance-devnet-v2-handoff-activation-final-receipt-v1";
const PLAN_TTL_SLOTS = 2_000;
const PROGRAM_ACCOUNT_LEN = 36;
const PROGRAMDATA_HEADER_LEN = 45;
const COMPUTE_UNIT_LIMIT = 1_400_000;
const COMPUTE_UNIT_PRICE = 10_000n;
const ZERO_32 = Buffer.alloc(32);
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const COMMANDS = new Set([
  "self-test",
  "verify-evidence-offline",
  "status-handoff",
  "plan-handoff-next",
  "execute-handoff-next",
  "status-activation",
  "plan-activation-next",
  "execute-activation-next",
]);

function usage() {
  return `usage: node tools/devnet-governance-v2-handoff-activation.mjs <${[...COMMANDS].join("|")}>\n`;
}

function env(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required`);
  return value;
}

function key(value, label) {
  assert(typeof value === "string", `${label} must be base58`);
  const result = new PublicKey(value);
  assert(!result.equals(PublicKey.default), `${label} must be nondefault`);
  return result;
}

function lowerHash(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be lowercase SHA-256`);
  assert.notEqual(value, "0".repeat(64), `${label} must be nonzero`);
  return value;
}

function stable(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([field, entry]) => `${JSON.stringify(field)}:${stable(entry)}`).join(",")}}`;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(JSON.parse(stable(value)), null, 2)}\n`, "utf8");
}

function semanticReceiptHash(domain, receipt) {
  const material = { ...receipt };
  delete material.receiptSha256;
  return createHash("sha256")
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(stable(material), "utf8")
    .digest("hex");
}

function instructionManifest(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((entry) => ({
      pubkey: entry.pubkey.toBase58(),
      isSigner: entry.isSigner,
      isWritable: entry.isWritable,
    })),
    dataHex: Buffer.from(instruction.data).toString("hex"),
  };
}

function actionFromPlan(plan) {
  return {
    signers: plan.signers.map((value) => new PublicKey(value)),
    instructions: plan.instructions.map((instruction) => {
      assert(/^(?:[0-9a-f]{2})*$/u.test(instruction.dataHex), "planned instruction data is not canonical hex");
      return new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((account) => ({
          pubkey: new PublicKey(account.pubkey),
          isSigner: account.isSigner,
          isWritable: account.isWritable,
        })),
        data: Buffer.from(instruction.dataHex, "hex"),
      });
    }),
  };
}

function exactInstruction(actual, expected, label) {
  assert.deepEqual(instructionManifest(actual), instructionManifest(expected), `${label} changed`);
}

function accountFingerprint(account) {
  if (account === null) return null;
  return {
    owner: account.owner.toBase58(),
    executable: account.executable,
    lamports: account.lamports,
    dataLength: account.data.length,
    dataSha256: sha256Hex(account.data),
  };
}

function loaderProgram(account, expectedProgramdata, label) {
  assert(account && account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} owner changed`);
  assert.equal(account.executable, true, `${label} is not executable`);
  assert.equal(account.data.length, PROGRAM_ACCOUNT_LEN, `${label} length changed`);
  assert.equal(account.data.readUInt32LE(0), 2, `${label} loader variant changed`);
  assert(new PublicKey(account.data.subarray(4)).equals(expectedProgramdata), `${label} ProgramData linkage changed`);
}

function loaderProgramdata(account, label) {
  assert(account && account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} owner changed`);
  assert.equal(account.executable, false, `${label} became executable`);
  assert(account.data.length >= PROGRAMDATA_HEADER_LEN, `${label} is truncated`);
  assert.equal(account.data.readUInt32LE(0), 3, `${label} loader variant changed`);
  const option = account.data[12];
  assert([0, 1].includes(option), `${label} authority option changed`);
  return {
    raw: Buffer.from(account.data),
    header: Buffer.from(account.data.subarray(0, PROGRAMDATA_HEADER_LEN)),
    payload: Buffer.from(account.data.subarray(PROGRAMDATA_HEADER_LEN)),
    deployedSlot: account.data.readBigUInt64LE(4),
    authority: option === 1 ? new PublicKey(account.data.subarray(13, 45)) : null,
  };
}

async function secureJson(environment, label) {
  const file = await requireSecureRegularFile(env(environment), label);
  return secureJsonFile(file, label);
}

async function secureJsonFile(input, label) {
  const file = await requireSecureRegularFile(input, label);
  const raw = await readFile(file);
  assert(raw.length > 0, `${label} is empty`);
  return { file, raw, sha256: sha256Hex(raw), value: JSON.parse(raw.toString("utf8")) };
}

async function auditedJson(environment, label) {
  const file = path.resolve(env(environment));
  const status = await lstat(file);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  if (typeof process.getuid === "function") assert.equal(status.uid, process.getuid(), `${label} owner changed`);
  assert.equal(status.mode & 0o022, 0, `${label} must not be group/other writable`);
  const raw = await readFile(file);
  assert(raw.length > 0, `${label} is empty`);
  return { file, raw, sha256: sha256Hex(raw), value: JSON.parse(raw.toString("utf8")) };
}

function onlyTimingDiff(base, amended) {
  const expected = structuredClone(base);
  expected.governanceLivenessV2.initialTimingProfileHash = CURRENT_TIMING_HASH;
  assert.deepEqual(amended, expected, "amended descriptor differs outside initialTimingProfileHash");
}

function validateDescriptor(descriptor, expectedHash, amended) {
  assert.equal(descriptor.schema, "ameba-governance-devnet-controller-v2-descriptor-v1");
  assert.equal(descriptor.cluster?.name, "devnet");
  assert.equal(descriptor.cluster?.genesisHash, EXPECTED_GENESIS);
  assert.equal(descriptor.identities?.controllerProgram, EXPECTED_CONTROLLER);
  assert.equal(descriptor.identities?.controllerProgramData, EXPECTED_CONTROLLER_PROGRAMDATA);
  assert.equal(descriptor.identities?.targetProgram, EXPECTED_TARGET);
  assert.equal(descriptor.identities?.targetProgramData, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(descriptor.identities?.legacyTargetAuthority, EXPECTED_LEGACY_AUTHORITY);
  assert(Array.isArray(descriptor.identities?.seats) && descriptor.identities.seats.length === 5, "descriptor seat vector changed");
  assert.equal(new Set(descriptor.identities.seats).size, 5, "descriptor seats are not distinct");
  assert.equal(descriptor.governanceLivenessV2?.initialTimingProfileHash, amended ? CURRENT_TIMING_HASH : BASE_TIMING_HASH);
  assert.equal(descriptor.authorization?.devnetOnly, true);
  assert.equal(descriptor.authorization?.mainnetAllowed, false);
  assert.equal(descriptor.authorization?.writerRestartAllowed, false);
  assert.equal(expectedHash, amended ? AMENDED_DESCRIPTOR_SHA256 : BASE_DESCRIPTOR_SHA256);
}

function deriveIds(descriptor) {
  const controller = key(descriptor.identities.controllerProgram, "controller program");
  const controllerProgramdata = key(descriptor.identities.controllerProgramData, "controller ProgramData");
  const target = key(descriptor.identities.targetProgram, "target program");
  const targetProgramdata = key(descriptor.identities.targetProgramData, "target ProgramData");
  assert(deriveUpgradeableProgramdataAddress(controller)[0].equals(controllerProgramdata), "controller ProgramData is not canonical");
  assert(deriveUpgradeableProgramdataAddress(target)[0].equals(targetProgramdata), "target ProgramData is not canonical");
  const [config, configBump] = deriveControllerConfigPda(controller, target);
  const [authority, authorityBump] = deriveAuthorityPda(controller, target);
  const [gate, gateBump] = deriveGatePda(controller, target);
  const [policy] = derivePolicyPda(controller, target, 1n);
  const [capacity] = deriveCapacityPolicyPdaV1(controller, target);
  const [immutability] = deriveControllerImmutabilityReceiptPdaV1(controller, target);
  const [registry, registryBump] = deriveGovernanceLifecycleRegistryPdaV2(controller, target);
  const [handoffReceipt, handoffReceiptBump] = deriveTargetAuthorityHandoffReceiptPdaV1(controller, target);
  const [activationReceipt, activationReceiptBump] = deriveBootstrapActivationReceiptPdaV1(controller, target);
  const [currentDeployment, currentDeploymentBump] = deriveCurrentDeploymentStatePdaV1(controller, target);
  const fixed = {
    controllerConfig: config,
    controllerAuthority: authority,
    protocolGate: gate,
    governancePolicyV1: policy,
    capacityPolicy: capacity,
    controllerImmutabilityReceipt: immutability,
    governanceLifecycleRegistryV2: registry,
  };
  for (const [field, value] of Object.entries(fixed)) {
    assert.equal(value.toBase58(), descriptor.pdas[field], `descriptor ${field} PDA changed`);
  }
  return {
    controller, controllerProgramdata, target, targetProgramdata,
    legacyAuthority: key(descriptor.identities.legacyTargetAuthority, "legacy authority"),
    payer: key(descriptor.identities.feePayer, "fee payer"),
    treasury: key(descriptor.identities.treasury, "treasury"),
    seats: descriptor.identities.seats.map((entry, index) => key(entry, `seat ${index}`)),
    config, configBump, authority, authorityBump, gate, gateBump, policy, capacity,
    immutability, registry, registryBump, handoffReceipt, handoffReceiptBump,
    activationReceipt, activationReceiptBump, currentDeployment, currentDeploymentBump,
  };
}

async function loadBundle({ requireArtifact = true } = {}) {
  const base = await secureJson("AMEBA_GOVERNANCE_V2_BASE_DESCRIPTOR", "base controller descriptor");
  const amended = await secureJson("AMEBA_GOVERNANCE_V2_DESCRIPTOR", "amended controller descriptor");
  assert.equal(base.sha256, BASE_DESCRIPTOR_SHA256, "base descriptor SHA-256 changed");
  assert.equal(amended.sha256, AMENDED_DESCRIPTOR_SHA256, "amended descriptor SHA-256 changed");
  validateDescriptor(base.value, base.sha256, false);
  validateDescriptor(amended.value, amended.sha256, true);
  onlyTimingDiff(base.value, amended.value);
  const ids = deriveIds(amended.value);
  const tag53 = await secureJson("AMEBA_GOVERNANCE_V2_TAG53_RECEIPT", "tag53 receipt");
  const tag82 = await secureJson("AMEBA_GOVERNANCE_V2_TAG82_RECEIPT", "tag82 receipt");
  assert.equal(tag53.value.schema, "ameba-governance-devnet-controller-v2-receipt-v1");
  assert.equal(tag53.value.action, "initialize-tag53");
  assert.equal(tag53.value.descriptorSha256, BASE_DESCRIPTOR_SHA256);
  assert.equal(tag82.value.schema, "ameba-governance-devnet-controller-v2-receipt-v1");
  assert.equal(tag82.value.action, "initialize-tag82");
  assert.equal(tag82.value.descriptorSha256, BASE_DESCRIPTOR_SHA256);
  assert.equal(tag82.value.timingAmendmentDescriptorSha256, AMENDED_DESCRIPTOR_SHA256);
  assert.equal(tag82.value.timingProfileHash, CURRENT_TIMING_HASH);
  const immutabilityRecord = await secureJson("AMEBA_CONTROLLER_IMMUTABILITY_RECORD_RECEIPT", "controller immutability record receipt");
  assert.equal(immutabilityRecord.value.schema, "ameba-governance-devnet-controller-immutability-record-receipt-v1");
  assert.equal(immutabilityRecord.value.immutabilityReceipt, ids.immutability.toBase58(), "immutability record PDA changed");
  assert.equal(immutabilityRecord.value.postAuthority, null, "immutability record retained controller authority");
  assert.equal(immutabilityRecord.value.artifactSha256, amended.value.artifact.sha256, "immutability record controller artifact changed");
  assert.equal(immutabilityRecord.value.targetMutationOccurred, false, "immutability ceremony mutated Spread");
  const bridgeRunDir = await requireSecureDirectory(env("AMEBA_SPREAD_BRIDGE_RUN_DIR"), "Spread bridge run directory");
  const controllerAuthorityFinal = await secureJsonFile(
    path.join(bridgeRunDir, "controller-immutability-authority-final-receipt-v1.json"),
    "controller authority-final receipt",
  );
  assert.equal(
    controllerAuthorityFinal.value.schema,
    "ameba-governance-devnet-controller-immutability-authority-final-receipt-v1",
    "controller authority-final receipt schema changed",
  );
  assert.equal(controllerAuthorityFinal.value.controllerProgram, EXPECTED_CONTROLLER, "controller authority-final program changed");
  assert.equal(controllerAuthorityFinal.value.controllerProgramdata, EXPECTED_CONTROLLER_PROGRAMDATA, "controller authority-final ProgramData changed");
  assert.equal(controllerAuthorityFinal.value.postAuthority, null, "controller authority-final receipt retained authority");
  assert.equal(controllerAuthorityFinal.value.targetMutationOccurred, false, "controller authority-final receipt mutated Spread");
  lowerHash(controllerAuthorityFinal.value.operationId, "controller authority-final operation ID");
  lowerHash(controllerAuthorityFinal.value.postRawSha256, "controller authority-final ProgramData hash");
  assert(
    typeof controllerAuthorityFinal.value.planFile === "string"
      && path.basename(controllerAuthorityFinal.value.planFile) === controllerAuthorityFinal.value.planFile,
    "controller authority-final plan filename changed",
  );
  assert(
    Array.isArray(controllerAuthorityFinal.value.transactions)
      && controllerAuthorityFinal.value.transactions.length === 1
      && controllerAuthorityFinal.value.transactions[0]?.stage === "authority-final",
    "controller authority-final receipt must bind one authority-final transaction",
  );
  const controllerAuthorityFinalPlan = await secureJsonFile(
    path.join(bridgeRunDir, controllerAuthorityFinal.value.planFile),
    "controller authority-final plan",
  );
  assert.equal(
    controllerAuthorityFinalPlan.value.schema,
    "ameba-governance-devnet-controller-immutability-authority-final-plan-v1",
    "controller authority-final plan schema changed",
  );
  assert.equal(controllerAuthorityFinalPlan.value.operationId, controllerAuthorityFinal.value.operationId, "controller authority-final plan operation changed");
  assert.equal(controllerAuthorityFinalPlan.value.command, "execute-authority-final", "controller authority-final plan command changed");
  assert.equal(controllerAuthorityFinalPlan.value.controllerProgram, EXPECTED_CONTROLLER, "controller authority-final plan program changed");
  assert.equal(controllerAuthorityFinalPlan.value.controllerProgramdata, EXPECTED_CONTROLLER_PROGRAMDATA, "controller authority-final plan ProgramData changed");
  assert.equal(controllerAuthorityFinalPlan.value.targetProgram, EXPECTED_TARGET, "controller authority-final plan target changed");
  assert.equal(controllerAuthorityFinalPlan.value.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA, "controller authority-final plan target ProgramData changed");
  assert.equal(controllerAuthorityFinalPlan.value.postAuthority, null, "controller authority-final plan retained authority");
  assert.equal(controllerAuthorityFinalPlan.value.targetMutationAllowed, false, "controller authority-final plan permits Spread mutation");
  assert.equal(controllerAuthorityFinalPlan.value.postRawSha256, controllerAuthorityFinal.value.postRawSha256, "controller authority-final plan ProgramData hash changed");
  assert.deepEqual(controllerAuthorityFinalPlan.value.targetSnapshot, controllerAuthorityFinal.value.targetSnapshot, "controller authority-final target snapshot changed");
  assert.deepEqual(controllerAuthorityFinalPlan.value.initializationSnapshot, controllerAuthorityFinal.value.initializationSnapshot, "controller authority-final initialization snapshot changed");
  const evidence = {
    controllerAuthorityFinal,
    controllerAuthorityFinalPlan,
    identityManifest: await auditedJson("AMEBA_SPREAD_GOVERNANCE_IDENTITY_MANIFEST", "Spread reviewed identity manifest"),
    identityReview: await auditedJson("AMEBA_SPREAD_GOVERNANCE_IDENTITY_REVIEW", "Spread reviewed identity review"),
    releaseManifest: await auditedJson("AMEBA_SPREAD_GOVERNANCE_BRIDGE_PLAN", "Spread reviewed bridge plan"),
    source: await secureJsonFile(path.join(bridgeRunDir, "spread-governance-bridge-ceremony-build-receipt-v1.json"), "Spread ceremony build receipt"),
    buildInputs: await secureJsonFile(path.join(bridgeRunDir, "spread-governance-bridge-build-input-inventory-v1.json"), "Spread build input inventory"),
    prebuildPlan: await secureJsonFile(path.join(bridgeRunDir, "spread-governance-bridge-prebuild-plan-v1.json"), "Spread copied prebuild plan"),
    package: await secureJsonFile(path.join(bridgeRunDir, "spread-reviewed-bridge-upgrade-receipt-v1.json"), "Spread reviewed bridge upgrade receipt"),
  };
  const identity = evidence.identityManifest.value;
  const review = evidence.identityReview.value;
  const manifest = evidence.releaseManifest.value;
  const buildReceipt = evidence.source.value;
  assert.equal(identity.schema, "ameba-spread-governance-controller-identity-v1");
  assert.equal(identity.status, "reviewed");
  assert(Number.isSafeInteger(identity.identityGeneration) && identity.identityGeneration >= 2, "Spread identity is not generation 2 or later");
  assert.equal(identity.targetProgramId, EXPECTED_TARGET, "Spread identity target changed");
  assert.equal(identity.controllerProgramId, EXPECTED_CONTROLLER, "Spread identity controller changed");
  assert.equal(identity.controllerConfigPda, ids.config.toBase58(), "Spread identity config changed");
  assert.equal(identity.protocolGatePda, ids.gate.toBase58(), "Spread identity gate changed");
  assert.equal(review.schema, "ameba-spread-governance-controller-identity-review-v1");
  assert.equal(review.status, "approved");
  assert.equal(review.identityGeneration, identity.identityGeneration, "Spread review generation changed");
  assert.equal(review.identityManifestSha256, evidence.identityManifest.sha256, "Spread review manifest hash changed");
  assert.equal(review.reviewedSourceCommit, amended.value.source.commit, "Spread review controller source changed");
  assert.equal(review.controllerArtifactSha256, amended.value.artifact.sha256, "Spread review controller artifact changed");
  assert.equal(review.controllerImmutabilityReceiptSha256, controllerAuthorityFinal.sha256, "Spread review authority-final receipt changed");
  assert.equal(review.spreadBridgePlanSha256, evidence.releaseManifest.sha256, "Spread review bridge plan changed");
  assert.equal(review.productionUseAuthorized, true, "Spread identity review is not authorized");
  assert.equal(manifest.schema, "ameba-spread-governance-bridge-prebuild-plan-v1");
  assert.equal(manifest.environment, "devnet");
  assert.equal(manifest.mainnetAllowed, false);
  assert.equal(manifest.target?.programId, EXPECTED_TARGET, "Spread bridge plan target changed");
  assert.equal(manifest.target?.programData, EXPECTED_TARGET_PROGRAMDATA, "Spread bridge plan ProgramData changed");
  assert.equal(manifest.controller?.programId, EXPECTED_CONTROLLER, "Spread bridge plan controller changed");
  assert.equal(manifest.controller?.programData, EXPECTED_CONTROLLER_PROGRAMDATA, "Spread bridge plan controller ProgramData changed");
  assert.equal(manifest.controller?.configPda, ids.config.toBase58(), "Spread bridge plan config changed");
  assert.equal(manifest.controller?.gatePda, ids.gate.toBase58(), "Spread bridge plan gate changed");
  assert.equal(manifest.controller?.immutabilityReceiptSha256, controllerAuthorityFinal.sha256, "Spread bridge plan authority-final receipt changed");
  assert.equal(manifest.controller?.upgradeAuthorityStatus, "immutable-none", "Spread bridge plan controller is not immutable");
  assert.equal(evidence.prebuildPlan.sha256, evidence.releaseManifest.sha256, "run-dir prebuild plan differs from reviewed plan");
  assert.deepEqual(evidence.prebuildPlan.value, manifest, "run-dir prebuild plan content changed");
  assert.equal(buildReceipt.schema, "ameba-spread-governance-bridge-ceremony-build-receipt-v1");
  assert.equal(buildReceipt.mainnetAllowed, false);
  assert.equal(buildReceipt.identity?.identityGeneration, identity.identityGeneration, "build receipt identity generation changed");
  assert.equal(buildReceipt.identity?.targetProgramId, EXPECTED_TARGET, "build receipt target changed");
  assert.equal(buildReceipt.identity?.controllerProgramId, EXPECTED_CONTROLLER, "build receipt controller changed");
  assert.equal(buildReceipt.identity?.controllerProgramData, EXPECTED_CONTROLLER_PROGRAMDATA, "build receipt controller ProgramData changed");
  assert.equal(buildReceipt.identity?.controllerConfigPda, ids.config.toBase58(), "build receipt config changed");
  assert.equal(buildReceipt.identity?.protocolGatePda, ids.gate.toBase58(), "build receipt gate changed");
  assert.equal(buildReceipt.identity?.identityManifestSha256, evidence.identityManifest.sha256, "build receipt identity manifest changed");
  assert.equal(buildReceipt.identity?.identityReviewSha256, evidence.identityReview.sha256, "build receipt identity review changed");
  assert.equal(buildReceipt.prebuildPlan?.sha256, evidence.releaseManifest.sha256, "build receipt prebuild plan changed");
  assert.equal(buildReceipt.inputs?.sha256, evidence.buildInputs.sha256, "build receipt inventory changed");
  assert.equal(buildReceipt.source?.commit, evidence.buildInputs.value.git?.head, "build receipt and inventory commits differ");
  assert.deepEqual(buildReceipt.controllerImmutabilityEvidence, {
    schema: controllerAuthorityFinal.value.schema,
    evidenceFilename: "controller-immutability-authority-final-receipt-v1.json",
    sha256: controllerAuthorityFinal.sha256,
    operationId: controllerAuthorityFinal.value.operationId,
    planFile: controllerAuthorityFinal.value.planFile,
    planSha256: controllerAuthorityFinalPlan.sha256,
    controllerProgram: EXPECTED_CONTROLLER,
    controllerProgramData: EXPECTED_CONTROLLER_PROGRAMDATA,
    postRawSha256: controllerAuthorityFinal.value.postRawSha256,
    postAuthority: null,
    targetMutationOccurred: false,
    finalizedTransactionCount: 1,
  }, "Spread build receipt authority-final evidence changed");
  assert.notEqual(
    controllerAuthorityFinal.sha256,
    immutabilityRecord.sha256,
    "authority-final and later on-chain immutability-record evidence were conflated",
  );
  const artifactFile = requireArtifact
    ? await requireSecureRegularFile(path.join(bridgeRunDir, "light_token_minter.so"), "Spread bridge artifact")
    : null;
  const artifact = artifactFile ? await readFile(artifactFile) : null;
  if (artifact) {
    assert(artifact.length > 0 && artifact.length <= MAX_ARTIFACT_BYTES_V1, "Spread bridge artifact length is outside bounds");
    assert.equal(buildReceipt.artifact?.sizeBytes, artifact.length, "Spread build receipt artifact length changed");
    assert.equal(buildReceipt.artifact?.sha256, sha256Hex(artifact), "Spread build receipt artifact SHA-256 changed");
    assert.equal(evidence.package.value.schema, "ameba-spread-reviewed-governance-bridge-upgrade-receipt-v1");
    assert.equal(evidence.package.value.artifactSha256, sha256Hex(artifact), "Spread bridge receipt artifact changed");
    assert.equal(evidence.package.value.targetProgram, EXPECTED_TARGET, "Spread bridge receipt target changed");
    assert.equal(evidence.package.value.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA, "Spread bridge receipt target ProgramData changed");
    assert.equal(
      evidence.package.value.postUpgradeAuthority ?? evidence.package.value.upgradeAuthority,
      EXPECTED_LEGACY_AUTHORITY,
      "Spread bridge receipt authority changed",
    );
  }
  const runDir = await requireSecureDirectory(env("AMEBA_GOVERNANCE_V2_HANDOFF_ACTIVATION_RUN_DIR"), "handoff/activation run directory");
  return {
    descriptor: amended.value,
    descriptorSha256: amended.sha256,
    baseDescriptorSha256: base.sha256,
    ids,
    tag53, tag82, immutabilityRecord, evidence, manifest, bridgeRunDir,
    artifact, artifactFile, runDir,
    artifactSha256: artifact ? sha256Hex(artifact) : buildReceipt.artifact.sha256,
    artifactMerkleRoot: artifact ? artifactMerkleRoot(artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1) : null,
    evidenceCommitments: {
      source: Buffer.from(evidence.source.sha256, "hex"),
      buildInputs: Buffer.from(evidence.buildInputs.sha256, "hex"),
      package: Buffer.from(evidence.package.sha256, "hex"),
      releaseManifest: Buffer.from(evidence.releaseManifest.sha256, "hex"),
    },
  };
}

async function bindFormerAuthorityBoundary(bundle, phase) {
  if (phase !== "activation") return bundle;
  const minimal = await secureJsonFile(
    path.join(bundle.bridgeRunDir, "spread-former-authority-minimal-proof-buffer-receipt-v2.json"),
    "minimal former-authority proof-buffer receipt",
  );
  assert.equal(minimal.value.schema, "ameba-spread-former-authority-minimal-proof-buffer-receipt-v2");
  assert.equal(minimal.value.mainnetAllowed, false);
  assert.equal(minimal.value.genesisHash, EXPECTED_GENESIS);
  assert.equal(minimal.value.targetProgram, bundle.ids.target.toBase58());
  assert.equal(minimal.value.targetProgramData, bundle.ids.targetProgramdata.toBase58());
  assert.equal(minimal.value.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(minimal.value.bufferAuthority, bundle.ids.legacyAuthority.toBase58());
  assert.equal(minimal.value.spillTreasury, bundle.ids.treasury.toBase58());
  assert.equal(minimal.value.payloadBytes, 1);
  assert.equal(minimal.value.bufferRawBytes, 38);
  assert.equal(minimal.value.sourceDeploymentReceiptSha256, bundle.evidence.package.sha256);
  const receipt = await secureJson(
    "AMEBA_GOVERNANCE_V2_FORMER_AUTHORITY_CLOSE_RECEIPT",
    "former-authority proof-buffer close receipt",
  );
  const negative = await secureJsonFile(
    path.join(path.dirname(receipt.file), "v2-former-authority-negative-proof-v1.json"),
    "former-authority negative proof receipt",
  );
  assert.equal(negative.value.schema, "ameba-governance-devnet-v2-former-authority-negative-proof-v1");
  assert.equal(negative.value.descriptorSha256, bundle.descriptorSha256);
  assert.equal(negative.value.baseDescriptorSha256, bundle.baseDescriptorSha256);
  assert.equal(negative.value.controllerProgram, bundle.ids.controller.toBase58());
  assert.equal(negative.value.controllerAuthority, bundle.ids.authority.toBase58());
  assert.equal(negative.value.targetProgram, bundle.ids.target.toBase58());
  assert.equal(negative.value.targetProgramdata, bundle.ids.targetProgramdata.toBase58());
  assert.equal(negative.value.formerAuthority, bundle.ids.legacyAuthority.toBase58());
  assert.equal(negative.value.proofBuffer, minimal.value.proofBuffer);
  assert.equal(negative.value.expectedInstructionError, "IncorrectAuthority");
  assert.deepEqual(negative.value.finalizedError?.InstructionError, [0, "IncorrectAuthority"]);
  assert(Array.isArray(negative.value.finalizedLogs) && negative.value.finalizedLogs.some((entry) => entry.includes("Incorrect authority provided")), "former-authority finalized logs do not prove IncorrectAuthority");
  assert.equal(negative.value.targetMutationObserved, false);
  assert.equal(negative.value.proofBufferMutationObserved, false);
  assert.equal(negative.value.activationBoundaryMutationObserved, false);
  assert.equal(
    negative.value.receiptSha256,
    semanticReceiptHash("AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_NEGATIVE_PROOF_V1", negative.value),
    "former-authority negative semantic receipt hash changed",
  );
  const value = receipt.value;
  assert.equal(value.schema, "ameba-governance-devnet-v2-former-authority-proof-buffer-close-v1");
  assert.equal(value.mainnetAllowed, false);
  assert.equal(value.genesisHash, EXPECTED_GENESIS);
  assert.equal(value.descriptorSha256, bundle.descriptorSha256);
  assert.equal(value.baseDescriptorSha256, bundle.baseDescriptorSha256);
  assert.equal(value.stage, "former-authority-proof-buffer-close");
  assert.equal(value.controllerProgram, bundle.ids.controller.toBase58());
  assert.equal(value.controllerAuthority, bundle.ids.authority.toBase58());
  assert.equal(value.targetProgram, bundle.ids.target.toBase58());
  assert.equal(value.targetProgramdata, bundle.ids.targetProgramdata.toBase58());
  assert.equal(value.formerAuthority, bundle.ids.legacyAuthority.toBase58());
  assert.equal(value.proofBuffer, minimal.value.proofBuffer);
  assert.equal(value.treasury, bundle.ids.treasury.toBase58());
  assert.equal(value.minimalProofBufferReceiptSha256, minimal.sha256);
  assert.equal(value.negativeProofReceiptSha256, negative.sha256);
  assert.equal(value.negativeFailureSignature, negative.value.signature);
  assert.equal(bs58.decode(value.negativeFailureSignature).length, 64, "former-authority failure signature is invalid");
  assert.equal(value.targetMutationObserved, false);
  assert.equal(value.activationBoundaryMutationObserved, false);
  assert.equal(value.bufferClosed, true);
  assert.equal(value.stateAfter?.proofBuffer, null, "former-authority proof buffer remains live");
  assert.equal(value.stateAfter?.boundary?.targetProgramdata?.authority, bundle.ids.authority.toBase58(), "former-authority close receipt has the wrong target authority");
  assert.equal(value.stateAfter?.boundary?.gateStatus, GateStatusV1.EmergencyFrozen, "former-authority close receipt crossed the frozen activation boundary");
  assert.equal(value.stateAfter?.boundary?.activationProposal, null, "activation proposal predates former-authority proof closure");
  assert.equal(value.stateAfter?.boundary?.activationReceipt, null, "activation receipt predates former-authority proof closure");
  assert.equal(value.stateAfter?.boundary?.currentDeployment, null, "current deployment predates former-authority proof closure");
  const expectedSemanticHash = semanticReceiptHash(
    "AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_PROOF_BUFFER_CLOSE_V1",
    value,
  );
  assert.equal(value.receiptSha256, expectedSemanticHash, "former-authority close semantic receipt hash changed");
  return { ...bundle, formerAuthorityBoundary: receipt, formerAuthorityNegative: negative, minimalProofBuffer: minimal };
}

function finalized(minContextSlot = 0) {
  return { commitment: "finalized", ...(minContextSlot > 0 ? { minContextSlot } : {}) };
}

function assertOwned(account, owner, length, label, executable = false) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(owner), `${label} owner changed`);
  assert.equal(account.executable, executable, `${label} executable flag changed`);
  assert.equal(account.data.length, length, `${label} length changed`);
  return account;
}

async function rpcContext(bundle, journal, scope) {
  const rpc = await loadDevnetRpcConfiguration();
  const connection = guardRpcConnection(new Connection(rpc.stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 120_000,
  }), journal, scope);
  assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "RPC is not Solana Devnet");
  const slot = await connection.getSlot("finalized");
  assert(Number.isSafeInteger(slot) && slot > 0, "finalized slot is invalid");
  return { connection, slot, rpcSelection: rpc.rpcSelection, rpcOrigin: rpc.stateRpcOrigin };
}

async function readAccountSet(connection, addresses, minContextSlot) {
  const response = await connection.getMultipleAccountsInfoAndContext(addresses, finalized(minContextSlot));
  assert(response.context.slot >= minContextSlot, "account-set read predates minimum context");
  assert.equal(response.value.length, addresses.length, "account-set result length changed");
  return { slot: response.context.slot, accounts: response.value };
}

function assertConfig(config, bundle, council, timingProfile) {
  const { ids } = bundle;
  assert(config.targetProgram.equals(ids.target), "config target changed");
  assert(config.targetProgramdata.equals(ids.targetProgramdata), "config target ProgramData changed");
  assert(config.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "config Loader changed");
  assert(config.authorityPda.equals(ids.authority), "config authority changed");
  assert(config.gatePda.equals(ids.gate), "config gate changed");
  assert.equal(config.currentPolicyVersion, 1n, "config policy version changed");
  assert.equal(config.currentCouncilVersion, council.version, "config council version changed");
  assert(config.targetNonce > 0n, "config target nonce is zero");
  assert.equal(config.tokenGovernanceEnabled, false, "token governance became enabled");
  assert.equal(timingProfile.profileVersion > 0n, true, "timing profile version is zero");
}

function assertCouncil(council, bundle, councilAddress, slot) {
  const { ids } = bundle;
  assert(council.controllerConfig.equals(ids.config), "council config changed");
  assert(council.targetProgram.equals(ids.target), "council target changed");
  assert.equal(council.routineThreshold, 3, "council routine threshold changed");
  assert.equal(council.terminalThreshold, 4, "council terminal threshold changed");
  assert.equal(council.policyFlags, 0, "council flags changed");
  assert(council.setHash.equals(governanceCouncilSetHash(council)), "council hash changed");
  assert.equal(council.seats.length, 5, "council size changed");
  council.seats.forEach((seat, index) => {
    assert(seat.seatAuthority.equals(ids.seats[index]), `council seat ${index} identity changed`);
    assert.equal(seat.active, true, `council seat ${index} is inactive`);
    assert(seat.termStartSlot <= BigInt(slot) && BigInt(slot) < seat.termEndSlot, `council seat ${index} term does not cover finalized slot`);
  });
  assert(deriveCouncilPda(ids.controller, ids.target, council.version)[0].equals(councilAddress), "council PDA changed");
}

function assertGate(gate, bundle, expectedStatus) {
  const { ids } = bundle;
  assert.equal(gate.bump, ids.gateBump, "gate bump changed");
  assert(gate.controllerConfig.equals(ids.config), "gate config changed");
  assert(gate.targetProgram.equals(ids.target), "gate target changed");
  assert(gate.targetProgramdata.equals(ids.targetProgramdata), "gate ProgramData changed");
  assert.equal(gate.status, expectedStatus, "gate status changed");
  assert(gate.epoch > 0n, "gate epoch is zero");
  assert(gate.activeProposal.equals(PublicKey.default), "ceremony gate has an active proposal");
  if (expectedStatus === GateStatusV1.EmergencyFrozen) {
    assert(gate.freezeSlot > 0n, "bootstrap freeze slot is zero");
    assert.equal(gate.freezeReasonCode, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1, "bootstrap freeze reason changed");
  } else {
    assert.equal(expectedStatus, GateStatusV1.Active, "unsupported ceremony gate status");
    assert.equal(gate.freezeSlot, 0n, "active gate retained freeze slot");
    assert.equal(gate.freezeReasonCode, 0, "active gate retained freeze reason");
  }
}

async function readBaseState(connection, bundle, minContextSlot = 0, phase = "handoff") {
  const { ids } = bundle;
  const configResponse = await connection.getAccountInfoAndContext(ids.config, finalized(minContextSlot));
  assert(configResponse.context.slot >= minContextSlot, "config read predates minimum context");
  const configAccount = assertOwned(configResponse.value, ids.controller, CONTROLLER_CONFIG_LEN, "controller config");
  const config = deserializeControllerConfigV1(configAccount.data);
  const [councilAddress] = deriveCouncilPda(ids.controller, ids.target, config.currentCouncilVersion);
  const registryAddress = ids.registry;
  const firstRegistry = await connection.getAccountInfoAndContext(registryAddress, finalized(configResponse.context.slot));
  const registryAccount = assertOwned(firstRegistry.value, ids.controller, GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, "lifecycle registry");
  const registry = deserializeGovernanceLifecycleRegistryV2(registryAccount.data);
  const [timingAddress] = deriveGovernanceTimingProfilePdaV1(ids.controller, ids.target, registry.currentTimingProfileVersion);
  const addresses = [
    ids.controller, ids.controllerProgramdata, ids.config, ids.policy, councilAddress, ids.gate,
    ids.capacity, ids.immutability, ids.registry, timingAddress, ids.target, ids.targetProgramdata,
    ids.handoffReceipt, ids.activationReceipt, ids.currentDeployment,
  ];
  const response = await readAccountSet(connection, addresses, firstRegistry.context.slot);
  const [
    controllerAccount, controllerProgramdataAccount, configAgain, policyAccount, councilAccount,
    gateAccount, capacityAccount, immutabilityAccount, registryAgain, timingAccount,
    targetAccount, targetProgramdataAccount, handoffReceiptAccount, activationReceiptAccount,
    currentDeploymentAccount,
  ] = response.accounts;
  assert(configAgain.data.equals(configAccount.data), "config changed during finalized read");
  assert(registryAgain.data.equals(registryAccount.data), "registry changed during finalized read");
  loaderProgram(controllerAccount, ids.controllerProgramdata, "controller Program");
  const controllerProgramdata = loaderProgramdata(controllerProgramdataAccount, "controller ProgramData");
  assert.equal(controllerProgramdata.authority, null, "controller is not immutable");
  loaderProgram(targetAccount, ids.targetProgramdata, "Spread Program");
  const targetProgramdata = loaderProgramdata(targetProgramdataAccount, "Spread ProgramData");
  const policy = deserializeGovernancePolicyFixedV1(assertOwned(policyAccount, ids.controller, GOVERNANCE_POLICY_LEN, "governance policy").data);
  const council = deserializeGovernanceCouncilSetFixedV1(assertOwned(councilAccount, ids.controller, GOVERNANCE_COUNCIL_SET_LEN, "governance council").data);
  const gate = deserializeProtocolGateV1(assertOwned(gateAccount, ids.controller, PROTOCOL_GATE_LEN, "protocol gate").data);
  const capacity = deserializeProgramDataCapacityPolicyV1(assertOwned(capacityAccount, ids.controller, PROGRAMDATA_CAPACITY_POLICY_V1_LEN, "capacity policy").data);
  validateProgramDataCapacityPolicyDigestV1(capacity);
  const immutability = deserializeControllerImmutabilityReceiptV1(assertOwned(immutabilityAccount, ids.controller, CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN, "immutability receipt").data);
  validateControllerImmutabilityReceiptDigestV1(immutability);
  const timingProfile = deserializeGovernanceTimingProfileV1(assertOwned(timingAccount, ids.controller, GOVERNANCE_TIMING_PROFILE_V1_LEN, "timing profile").data);
  assertConfig(config, bundle, council, timingProfile);
  assertCouncil(council, bundle, councilAddress, response.slot);
  assert(policy.policyHash.equals(governancePolicyHash(policy)), "governance policy hash changed");
  assert.equal(policy.routineThreshold, 3, "policy routine threshold changed");
  assert.equal(policy.terminalThreshold, 4, "policy terminal threshold changed");
  assert.equal(policy.governanceMode, 0, "token governance policy changed");
  assertGate(gate, bundle, phase === "activation-complete" ? GateStatusV1.Active : GateStatusV1.EmergencyFrozen);
  assert(registry.controllerProgram.equals(ids.controller), "registry controller changed");
  assert(registry.controllerConfig.equals(ids.config), "registry config changed");
  assert(registry.targetProgram.equals(ids.target), "registry target changed");
  assert(registry.currentTimingProfile.equals(timingAddress), "registry timing profile changed");
  assert(registry.currentTimingProfileHash.equals(timingProfile.profileHash), "registry timing hash changed");
  assert.equal(timingProfile.profileHash.toString("hex"), CURRENT_TIMING_HASH, "current timing profile is not the amended profile");
  assert(immutability.finalized, "controller immutability receipt is not finalized");
  assert(immutability.controllerProgram.equals(ids.controller), "immutability controller changed");
  assert(immutability.controllerProgramdata.equals(ids.controllerProgramdata), "immutability ProgramData changed");
  assert.equal(immutability.postUpgradeAuthority.present, false, "immutability receipt retains authority");
  assert(capacity.controllerConfig.equals(ids.config), "capacity config changed");
  assert(capacity.targetProgram.equals(ids.target), "capacity target changed");
  assert.equal(capacity.observationChunkSize, PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1, "observation chunk size changed");
  assert(capacity.observationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1), "observation scheme changed");
  assert(capacity.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "artifact scheme changed");
  assert.equal(capacity.artifactChunkSize, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, "artifact chunk size changed");
  assert(config.clusterDomain.equals(clusterDomainFromGenesisHashV1(EXPECTED_GENESIS)), "cluster domain changed");
  assert(bundle.artifact, "artifact is required for live state verification");
  assert(targetProgramdata.payload.length >= bundle.artifact.length, "target capacity is below bridge artifact");
  assert(targetProgramdata.payload.subarray(0, bundle.artifact.length).equals(bundle.artifact), "target payload differs from bridge artifact");
  assert(targetProgramdata.payload.subarray(bundle.artifact.length).every((value) => value === 0), "target zero tail changed");
  const expectedAuthority = phase === "handoff" ? ids.legacyAuthority : ids.authority;
  assert(targetProgramdata.authority?.equals(expectedAuthority), `target authority is not canonical for ${phase}`);
  return {
    slot: response.slot, config, policy, council, councilAddress, gate, capacity, immutability,
    registry, timingProfile, timingAddress, controllerProgramdata, targetProgramdata,
    accounts: {
      controller: controllerAccount, controllerProgramdata: controllerProgramdataAccount,
      config: configAgain, policy: policyAccount, council: councilAccount, gate: gateAccount,
      capacity: capacityAccount, immutability: immutabilityAccount, registry: registryAgain,
      timing: timingAccount, target: targetAccount, targetProgramdata: targetProgramdataAccount,
      handoffReceipt: handoffReceiptAccount, activationReceipt: activationReceiptAccount,
      currentDeployment: currentDeploymentAccount,
    },
  };
}

function observationModel(bundle, state, phase, programdataRaw = state.targetProgramdata.raw) {
  const { ids } = bundle;
  const purpose = phase === "handoff"
    ? ProgramDataObservationPurposeV1.TargetHandoffBridge
    : ProgramDataObservationPurposeV1.BootstrapActivation;
  const subject = phase === "handoff" ? ids.immutability : ids.handoffReceipt;
  const generation = 1n;
  const artifactSha = Buffer.from(bundle.artifactSha256, "hex");
  const subjectDigest = programDataObservationSubjectDigestV1({
    controllerProgram: ids.controller,
    controllerConfig: ids.config,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    purpose,
    subject,
    generation,
    protocolGate: ids.gate,
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch,
    gateActiveProposal: state.gate.activeProposal,
    gateFreezeSlot: state.gate.freezeSlot,
    gateFreezeReasonCode: state.gate.freezeReasonCode,
    capacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: BigInt(bundle.artifact.length),
    expectedArtifactSha256: artifactSha,
    expectedArtifactMerkleRoot: bundle.artifactMerkleRoot,
    expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    minimumRequiredCapacity: BigInt(bundle.artifact.length),
  });
  const [observation, bump] = deriveProgramDataObservationPdaV1(ids.controller, ids.target, purpose, subjectDigest, generation);
  const guard = {
    purpose,
    generation,
    expectedSubjectDigest: subjectDigest,
    expectedGateStatus: state.gate.status,
    expectedGateEpoch: state.gate.epoch,
    expectedFreezeReasonCode: state.gate.freezeReasonCode,
    expectedFreezeSlot: state.gate.freezeSlot,
  };
  const stepAccounts = {
    controllerConfig: ids.config,
    protocolGate: ids.gate,
    capacityPolicy: ids.capacity,
    subject,
    observedProgram: ids.target,
    observedProgramdata: ids.targetProgramdata,
    observation,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  assert.equal(programdataRaw.length, state.targetProgramdata.raw.length, "observation ProgramData raw length changed");
  const rawGeometry = programDataObservationGeometryV1(programdataRaw.length, state.capacity.observationChunkSize);
  const artifactChunks = artifactChunkCount(bundle.artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  const tailBytes = BigInt(state.targetProgramdata.payload.length - bundle.artifact.length);
  const begin = buildBeginProgramDataObservationV1Instruction(ids.controller, {
    payer: ids.payer,
    ...stepAccounts,
    systemProgram: SystemProgram.programId,
  }, {
    guard,
    expectedCapacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: BigInt(bundle.artifact.length),
    expectedArtifactSha256: artifactSha,
    expectedArtifactMerkleRoot: bundle.artifactMerkleRoot,
    expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    minimumRequiredCapacity: BigInt(bundle.artifact.length),
    expectedDeployedSlot: state.targetProgramdata.deployedSlot,
    expectedActualCapacity: BigInt(state.targetProgramdata.payload.length),
    expectedUpgradeAuthority: { present: true, value: phase === "handoff" ? ids.legacyAuthority : ids.authority },
  });
  const append = (index) => buildAppendProgramDataObservationChunkV1Instruction(ids.controller, stepAccounts, {
    guard,
    expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: index,
  });
  const verify = (index) => {
    const proof = artifactMerkleProof(bundle.artifact, index, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    assert(proof.length <= 7, "artifact proof exceeds fixed ABI");
    return buildVerifyObservedArtifactChunkV1Instruction(ids.controller, stepAccounts, {
      guard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex: index,
      expectedNextArtifactChunkIndex: index,
      expectedTailBytesVerified: tailBytes,
      proof: {
        proofLen: proof.length,
        nodes: [...proof.map(Buffer.from), ...Array.from({ length: 7 - proof.length }, () => Buffer.from(ZERO_32))],
      },
    });
  };
  const finalizeInstruction = buildFinalizeProgramDataObservationV1Instruction(ids.controller, stepAccounts, {
    guard,
    expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
    expectedNextRawChunkIndex: rawGeometry.chunkCount,
    expectedNextArtifactChunkIndex: artifactChunks,
    expectedTailBytesVerified: tailBytes,
  });
  return {
    purpose, subject, generation, subjectDigest, observation, bump, guard,
    rawGeometry, artifactChunks, tailBytes, begin, append, verify,
    finalize: finalizeInstruction,
    rawRoot: programDataObservationMerkleRootV1(programdataRaw, subjectDigest, state.capacity.observationChunkSize),
    rawSha256: programDataRawSha256ReceiptV1(programdataRaw),
  };
}

function completedHandoffPreObservationRaw(bundle, state, handoff) {
  assert(handoff, "completed handoff lacks its finalized receipt");
  const current = state.targetProgramdata;
  assert(current.authority?.equals(bundle.ids.authority), "completed handoff did not install the controller authority");
  assert.equal(current.deployedSlot, handoff.deployedSlot, "handoff changed the ProgramData deployed slot");
  assert.equal(BigInt(current.raw.length), handoff.rawProgramdataLength, "handoff changed the ProgramData raw length");
  assert.equal(BigInt(current.payload.length), handoff.programdataCapacity, "handoff changed the ProgramData capacity");
  assert(current.header.equals(handoff.postProgramdataHeaderSnapshot), "current ProgramData header differs from the finalized handoff receipt");
  const preRaw = Buffer.from(current.raw);
  Buffer.from(handoff.preProgramdataHeaderSnapshot).copy(preRaw, 0);
  assert(preRaw.subarray(0, 13).equals(current.raw.subarray(0, 13)), "handoff changed ProgramData metadata outside authority bytes");
  assert(preRaw.subarray(PROGRAMDATA_HEADER_LEN).equals(current.raw.subarray(PROGRAMDATA_HEADER_LEN)), "handoff changed ProgramData payload bytes");
  return preRaw;
}

function assertCompletedHandoffObservation(value, model, bundle, state, handoff, preRaw) {
  assert(value.upgradeAuthority.present && value.upgradeAuthority.value.equals(bundle.ids.legacyAuthority), "pre-handoff observation authority changed");
  assert(value.programdataHeaderSnapshot.equals(handoff.preProgramdataHeaderSnapshot), "pre-handoff observation header changed");
  assert.equal(value.deployedSlot, state.targetProgramdata.deployedSlot, "handoff changed the observed deployed slot");
  assert.equal(value.rawDataLength, BigInt(state.targetProgramdata.raw.length), "handoff changed the observed raw length");
  assert.equal(value.actualCapacity, BigInt(state.targetProgramdata.payload.length), "handoff changed the observed capacity");
  assert(handoff.preObservation.equals(model.observation), "handoff receipt pre-observation address changed");
  assert.equal(handoff.preObservationGeneration, value.generation, "handoff receipt pre-observation generation changed");
  assert(handoff.preObservationRoot.equals(value.finalRawMerkleRoot), "handoff receipt pre-observation root changed");
  assert(handoff.preObservationDigest.equals(value.observationDigest), "handoff receipt pre-observation digest changed");
  const normalizedRoot = programDataObservationMerkleRootV1(preRaw, value.subjectDigest, value.rawChunkSize);
  assert(normalizedRoot.equals(value.finalRawMerkleRoot), "current ProgramData differs outside the exact authority transition");
}

function validateObservation(value, model, state, bundle) {
  validateProgramDataObservationDigestV1(value);
  assert(value.controllerProgram.equals(bundle.ids.controller), "observation controller changed");
  assert(value.controllerConfig.equals(bundle.ids.config), "observation config changed");
  assert(value.capacityPolicy.equals(bundle.ids.capacity), "observation capacity changed");
  assert(value.subject.equals(model.subject), "observation subject changed");
  assert(value.subjectDigest.equals(model.subjectDigest), "observation subject digest changed");
  assert.equal(value.purpose, model.purpose, "observation purpose changed");
  assert.equal(value.generation, model.generation, "observation generation changed");
  assert.equal(value.gateEpoch, state.gate.epoch, "observation gate epoch changed");
  assert(value.finalRawMerkleRoot.equals(model.rawRoot), "observation raw Merkle root changed");
  assert.equal(value.rawDataLength, BigInt(state.targetProgramdata.raw.length), "observation raw length changed");
  assert.equal(value.artifactChunkCount, model.artifactChunks, "observation artifact count changed");
  assert.equal(value.rawChunkCount, model.rawGeometry.chunkCount, "observation raw count changed");
  assert.equal(value.tailBytesVerified, model.tailBytes, "observation tail count changed");
}

function computePrefix() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
  ];
}

function envelope() {
  return {
    computeUnitLimit: COMPUTE_UNIT_LIMIT,
    computeUnitPriceMicroLamports: COMPUTE_UNIT_PRICE,
    durableNonceAccount: { present: false, value: PublicKey.default },
    durableNonceAuthority: { present: false, value: PublicKey.default },
  };
}

function proposalGuard(state, proposal) {
  return {
    proposalId: proposal.proposalId,
    expectedProposalDigest: proposal.proposalDigest,
    expectedCouncilVersion: state.council.version,
    expectedTimingProfileVersion: state.timingProfile.profileVersion,
    expectedTimingProfileHash: state.timingProfile.profileHash,
  };
}

function assertProposalTiming(proposal, profile, timingClass) {
  const expected = deriveProposalTimingV2(profile, timingClass, proposal.creationSlot);
  const expectedFields = {
    reviewDurationSlots: expected.reviewSlots,
    delayDurationSlots: expected.delaySlots,
    expiryDurationSlots: expected.expirySlots,
    creationSlot: expected.creationSlot,
    reviewStartSlot: expected.reviewStartSlot,
    reviewEndSlot: expected.reviewEndSlot,
    notBeforeSlot: expected.notBeforeSlot,
    expirySlot: expected.expirySlot,
  };
  for (const [field, value] of Object.entries(expectedFields)) {
    assert.equal(proposal[field], value, `proposal ${field} changed`);
  }
  assert.equal(proposal.approvalThreshold, 3, "proposal approval threshold changed");
  assert.equal(proposal.cancellationThreshold, 3, "proposal cancellation threshold changed");
}

function selfTestProposalTiming() {
  const profile = nominalGovernanceTimingProfileV1({
    bump: 1,
    controllerConfig: selfTestKey("timing-controller-config"),
    targetProgram: selfTestKey("timing-target-program"),
    creationCouncilVersion: 1n,
    creationSlot: 1n,
  });
  const creationSlot = 123_456n;
  const check = (timingClass) => {
    const expected = deriveProposalTimingV2(profile, timingClass, creationSlot);
    const proposal = {
      reviewDurationSlots: expected.reviewSlots,
      delayDurationSlots: expected.delaySlots,
      expiryDurationSlots: expected.expirySlots,
      creationSlot: expected.creationSlot,
      reviewStartSlot: expected.reviewStartSlot,
      reviewEndSlot: expected.reviewEndSlot,
      notBeforeSlot: expected.notBeforeSlot,
      expirySlot: expected.expirySlot,
      approvalThreshold: 3,
      cancellationThreshold: 3,
    };
    assertProposalTiming(proposal, profile, timingClass);
    return {
      reviewDurationSlots: proposal.reviewDurationSlots.toString(),
      delayDurationSlots: proposal.delayDurationSlots.toString(),
      expiryDurationSlots: proposal.expiryDurationSlots.toString(),
    };
  };
  return {
    handoff: check(GovernanceTimingClassV1.Constitutional),
    activation: check(GovernanceTimingClassV1.Routine),
  };
}

function selfTestCompletedHandoffObservation() {
  const legacyAuthority = selfTestKey("transition-legacy-authority");
  const controllerAuthority = selfTestKey("transition-controller-authority");
  const observationAddress = selfTestKey("transition-observation");
  const deployedSlot = 123n;
  const header = (authority) => {
    const value = Buffer.alloc(PROGRAMDATA_HEADER_LEN);
    value.writeUInt32LE(3, 0);
    value.writeBigUInt64LE(deployedSlot, 4);
    value[12] = 1;
    authority.toBuffer().copy(value, 13);
    return value;
  };
  const preHeader = header(legacyAuthority);
  const postHeader = header(controllerAuthority);
  const payload = createHash("sha256").update("completed-handoff-payload").digest();
  const preRaw = Buffer.concat([preHeader, payload]);
  const postRaw = Buffer.concat([postHeader, payload]);
  const bundle = { ids: { legacyAuthority, authority: controllerAuthority } };
  const state = {
    targetProgramdata: {
      raw: postRaw,
      header: postHeader,
      payload,
      deployedSlot,
      authority: controllerAuthority,
    },
  };
  const subjectDigest = createHash("sha256").update("completed-handoff-subject").digest();
  const observationDigest = createHash("sha256").update("completed-handoff-observation").digest();
  const finalRawMerkleRoot = programDataObservationMerkleRootV1(
    preRaw,
    subjectDigest,
    PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  );
  const handoff = {
    deployedSlot,
    rawProgramdataLength: BigInt(preRaw.length),
    programdataCapacity: BigInt(payload.length),
    preProgramdataHeaderSnapshot: preHeader,
    postProgramdataHeaderSnapshot: postHeader,
    preObservation: observationAddress,
    preObservationGeneration: 1n,
    preObservationRoot: finalRawMerkleRoot,
    preObservationDigest: observationDigest,
  };
  const observation = {
    upgradeAuthority: { present: true, value: legacyAuthority },
    programdataHeaderSnapshot: preHeader,
    deployedSlot,
    rawDataLength: BigInt(preRaw.length),
    actualCapacity: BigInt(payload.length),
    generation: 1n,
    finalRawMerkleRoot,
    observationDigest,
    subjectDigest,
    rawChunkSize: PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  };
  const normalized = completedHandoffPreObservationRaw(bundle, state, handoff);
  assert(normalized.equals(preRaw), "completed handoff normalization changed the pre-observation bytes");
  assertCompletedHandoffObservation(observation, { observation: observationAddress }, bundle, state, handoff, normalized);
  const tamperedPayload = Buffer.from(payload);
  tamperedPayload[0] ^= 1;
  const tamperedState = {
    targetProgramdata: {
      ...state.targetProgramdata,
      raw: Buffer.concat([postHeader, tamperedPayload]),
      payload: tamperedPayload,
    },
  };
  const tamperedNormalized = completedHandoffPreObservationRaw(bundle, tamperedState, handoff);
  assert.throws(
    () => assertCompletedHandoffObservation(observation, { observation: observationAddress }, bundle, tamperedState, handoff, tamperedNormalized),
    /differs outside the exact authority transition/u,
  );
  return { deployedSlot: deployedSlot.toString(), payloadBytes: payload.length, payloadTamperRejected: true };
}

function assertProposalEvidence(proposal, phase, bundle, state, model) {
  const { ids } = bundle;
  assert(proposal.lifecycleRegistry.equals(ids.registry), "proposal registry changed");
  assert(proposal.governingTimingProfile.equals(state.timingAddress), "proposal timing profile changed");
  assert.equal(proposal.governingTimingProfileVersion, state.timingProfile.profileVersion, "proposal timing version changed");
  assert(proposal.governingTimingProfileHash.equals(state.timingProfile.profileHash), "proposal timing hash changed");
  assert(proposal.controllerProgram.equals(ids.controller), "proposal controller changed");
  assert(proposal.controllerProgramdata.equals(ids.controllerProgramdata), "proposal controller ProgramData changed");
  assert(proposal.controllerConfig.equals(ids.config), "proposal config changed");
  assert(proposal.governancePolicy.equals(ids.policy), "proposal policy changed");
  assert(proposal.governancePolicyHash.equals(state.policy.policyHash), "proposal policy hash changed");
  assert(proposal.capacityPolicy.equals(ids.capacity), "proposal capacity changed");
  assert(proposal.capacityPolicyDigest.equals(state.capacity.policyDigest), "proposal capacity digest changed");
  assert(proposal.controllerImmutabilityReceipt.equals(ids.immutability), "proposal immutability receipt changed");
  assert(proposal.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "proposal immutability digest changed");
  assert(proposal.gate.equals(ids.gate), "proposal gate changed");
  assert(proposal.targetProgram.equals(ids.target), "proposal target changed");
  assert(proposal.targetProgramdata.equals(ids.targetProgramdata), "proposal target ProgramData changed");
  assert(proposal.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "proposal Loader changed");
  assert(proposal.controllerAuthority.equals(ids.authority), "proposal controller authority changed");
  assert.equal(proposal.bridgeArtifactLength, BigInt(bundle.artifact.length), "proposal artifact length changed");
  assert.equal(proposal.bridgeArtifactSha256.toString("hex"), bundle.artifactSha256, "proposal artifact SHA-256 changed");
  assert(proposal.bridgeArtifactMerkleRoot.equals(bundle.artifactMerkleRoot), "proposal artifact root changed");
  assert(proposal.bridgeArtifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "proposal artifact scheme changed");
  assert(proposal.bridgeSourceCommitment.equals(bundle.evidenceCommitments.source), "proposal source commitment changed");
  assert(proposal.bridgeBuildInputsCommitment.equals(bundle.evidenceCommitments.buildInputs), "proposal build commitment changed");
  assert(proposal.bridgePackageCommitment.equals(bundle.evidenceCommitments.package), "proposal package commitment changed");
  assert(proposal.bridgeReleaseManifestCommitment.equals(bundle.evidenceCommitments.releaseManifest), "proposal release commitment changed");
  assert(proposal.bridgeObservation.equals(model.observation), "proposal observation changed");
  assert.equal(proposal.bridgeObservationGeneration, model.generation, "proposal observation generation changed");
  assert(proposal.bridgeObservationRoot.equals(model.rawRoot), "proposal observation root changed");
  assert.equal(proposal.bootstrapGateStatus, GateStatusV1.EmergencyFrozen, "proposal bootstrap gate status changed");
  assert.equal(proposal.bootstrapGateEpoch, state.gate.epoch, "proposal gate epoch changed");
  assert.equal(proposal.bootstrapFreezeReasonCode, state.gate.freezeReasonCode, "proposal freeze reason changed");
  assert.equal(proposal.bootstrapFreezeSlot, state.gate.freezeSlot, "proposal freeze slot changed");
  assert.equal(proposal.targetNonce, state.config.targetNonce, "proposal target nonce changed");
  assert.equal(proposal.councilVersion, state.council.version, "proposal council version changed");
  assert(proposal.councilHash.equals(state.council.setHash), "proposal council hash changed");
  if (phase === "handoff") {
    assert(proposal.legacyTargetAuthority.equals(ids.legacyAuthority), "handoff legacy authority changed");
    assertProposalTiming(proposal, state.timingProfile, GovernanceTimingClassV1.Constitutional);
  } else {
    assert(proposal.targetHandoffReceipt.equals(ids.handoffReceipt), "activation handoff receipt changed");
    assertProposalTiming(proposal, state.timingProfile, GovernanceTimingClassV1.Routine);
  }
}

async function readObservation(connection, bundle, state, model, minContextSlot) {
  const response = await connection.getAccountInfoAndContext(model.observation, finalized(minContextSlot));
  assert(response.context.slot >= minContextSlot, "observation read predates minimum context");
  if (response.value === null) return { slot: response.context.slot, account: null, value: null };
  const account = assertOwned(response.value, bundle.ids.controller, PROGRAMDATA_OBSERVATION_V1_LEN, "ProgramData observation");
  const value = deserializeProgramDataObservationV1(account.data);
  if (value.status === ProgramDataObservationStatusV1.Finalized) validateObservation(value, model, state, bundle);
  else {
    assert(value.subjectDigest.equals(model.subjectDigest), "in-progress observation subject changed");
    assert.equal(value.generation, model.generation, "in-progress observation generation changed");
    assert.equal(value.gateEpoch, state.gate.epoch, "in-progress observation epoch changed");
  }
  return { slot: response.context.slot, account, value };
}

async function localProposalId(bundle, phase) {
  const names = (await readdir(bundle.runDir)).filter((name) => name.startsWith("v2-handoff-activation-stage-") && name.endsWith(".json"));
  const values = [];
  for (const name of names) {
    const file = await requireSecureRegularFile(path.join(bundle.runDir, name), `stage receipt ${name}`);
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.schema !== RECEIPT_SCHEMA || value.phase !== phase || value.descriptorSha256 !== bundle.descriptorSha256) continue;
    if (value.proposalId !== null) values.push(BigInt(value.proposalId));
  }
  if (values.length === 0) return null;
  assert.equal(new Set(values.map(String)).size, 1, `${phase} stage receipts disagree on proposal ID`);
  return values[0];
}

async function readProposal(connection, bundle, state, phase, minContextSlot) {
  const kind = phase === "handoff" ? GovernanceActionKindV2.TargetAuthorityHandoff : GovernanceActionKindV2.BootstrapActivation;
  let proposalId = await localProposalId(bundle, phase);
  if (proposalId === null && state.registry.nextProposalId > 1n) proposalId = state.registry.nextProposalId - 1n;
  if (proposalId === null) return {
    slot: minContextSlot,
    proposalId: state.registry.nextProposalId,
    address: deriveGovernanceActionProposalPdaV2(bundle.ids.controller, bundle.ids.target, kind, state.registry.nextProposalId)[0],
    account: null,
    value: null,
  };
  let [address] = deriveGovernanceActionProposalPdaV2(bundle.ids.controller, bundle.ids.target, kind, proposalId);
  let response = await connection.getAccountInfoAndContext(address, finalized(minContextSlot));
  if (response.value === null && proposalId === state.registry.nextProposalId - 1n) {
    return {
      slot: response.context.slot,
      proposalId: state.registry.nextProposalId,
      address: deriveGovernanceActionProposalPdaV2(bundle.ids.controller, bundle.ids.target, kind, state.registry.nextProposalId)[0],
      account: null,
      value: null,
    };
  }
  assert(response.value, `${phase} proposal ${proposalId} is absent`);
  const length = phase === "handoff" ? TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN : BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN;
  const account = assertOwned(response.value, bundle.ids.controller, length, `${phase} proposal`);
  const value = phase === "handoff"
    ? deserializeTargetAuthorityHandoffProposalV2(account.data)
    : deserializeBootstrapActivationProposalV2(account.data);
  assert.equal(value.proposalId, proposalId, `${phase} proposal ID changed`);
  return { slot: response.context.slot, proposalId, address, account, value };
}

function observationNextAction(model, observation, bundle) {
  const { ids } = bundle;
  if (observation.value === null) return {
    stage: "observation-begin",
    instructions: [...computePrefix(), model.begin],
    signers: [ids.payer],
  };
  const value = observation.value;
  if (value.status === ProgramDataObservationStatusV1.Accumulating) {
    if (value.nextRawChunkIndex < model.rawGeometry.chunkCount) return {
      stage: `observation-raw-${String(value.nextRawChunkIndex).padStart(3, "0")}`,
      instructions: [...computePrefix(), model.append(value.nextRawChunkIndex)],
      signers: [ids.payer],
    };
    if (value.nextArtifactChunkIndex < model.artifactChunks) return {
      stage: `observation-artifact-${String(value.nextArtifactChunkIndex).padStart(3, "0")}`,
      instructions: [...computePrefix(), model.verify(value.nextArtifactChunkIndex)],
      signers: [ids.payer],
    };
    throw new Error("observation is accumulating with all chunks consumed but not ReadyToFinalize");
  }
  if (value.status === ProgramDataObservationStatusV1.ReadyToFinalize) return {
    stage: "observation-finalize",
    instructions: [...computePrefix(), model.finalize],
    signers: [ids.payer],
  };
  assert.equal(value.status, ProgramDataObservationStatusV1.Finalized, "observation status is unsupported");
  return null;
}

function handoffAccounts(bundle, state, model, proposalAddress) {
  const { ids } = bundle;
  const common = {
    controllerProgram: ids.controller,
    controllerProgramdata: ids.controllerProgramdata,
    controllerConfig: ids.config,
    governancePolicy: ids.policy,
    council: state.councilAddress,
    protocolGate: ids.gate,
    capacityPolicy: ids.capacity,
    controllerImmutabilityReceipt: ids.immutability,
    bridgeObservation: model.observation,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    legacyAuthority: ids.legacyAuthority,
    controllerAuthority: ids.authority,
    lifecycleRegistry: ids.registry,
    governingTimingProfile: state.timingAddress,
    proposal: proposalAddress,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  return {
    common,
    create: { payer: ids.payer, creator: ids.seats[0], ...common, systemProgram: SystemProgram.programId },
    execute: {
      payer: ids.payer,
      controllerProgram: ids.controller,
      controllerProgramdata: ids.controllerProgramdata,
      controllerConfig: ids.config,
      governancePolicy: ids.policy,
      council: state.councilAddress,
      protocolGate: ids.gate,
      capacityPolicy: ids.capacity,
      controllerImmutabilityReceipt: ids.immutability,
      lifecycleRegistry: ids.registry,
      governingTimingProfile: state.timingAddress,
      proposal: proposalAddress,
      bridgeObservation: model.observation,
      targetProgram: ids.target,
      targetProgramdata: ids.targetProgramdata,
      legacyAuthority: ids.legacyAuthority,
      controllerAuthority: ids.authority,
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      targetHandoffReceipt: ids.handoffReceipt,
      systemProgram: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
  };
}

function activationAccounts(bundle, state, model, proposalAddress) {
  const { ids } = bundle;
  const common = {
    controllerProgram: ids.controller,
    controllerProgramdata: ids.controllerProgramdata,
    controllerConfig: ids.config,
    governancePolicy: ids.policy,
    council: state.councilAddress,
    protocolGate: ids.gate,
    capacityPolicy: ids.capacity,
    controllerImmutabilityReceipt: ids.immutability,
    targetHandoffReceipt: ids.handoffReceipt,
    bridgeObservation: model.observation,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    controllerAuthority: ids.authority,
    lifecycleRegistry: ids.registry,
    governingTimingProfile: state.timingAddress,
    proposal: proposalAddress,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  return {
    common,
    create: { payer: ids.payer, creator: ids.seats[0], ...common, systemProgram: SystemProgram.programId },
    execute: {
      payer: ids.payer,
      controllerProgram: ids.controller,
      controllerProgramdata: ids.controllerProgramdata,
      controllerConfig: ids.config,
      governancePolicy: ids.policy,
      council: state.councilAddress,
      protocolGate: ids.gate,
      capacityPolicy: ids.capacity,
      controllerImmutabilityReceipt: ids.immutability,
      targetHandoffReceipt: ids.handoffReceipt,
      lifecycleRegistry: ids.registry,
      governingTimingProfile: state.timingAddress,
      proposal: proposalAddress,
      bridgeObservation: model.observation,
      targetProgram: ids.target,
      targetProgramdata: ids.targetProgramdata,
      controllerAuthority: ids.authority,
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      bootstrapActivationReceipt: ids.activationReceipt,
      currentDeployment: ids.currentDeployment,
      systemProgram: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
  };
}

function validateHandoffReceipt(receipt, bundle, state, proposal = null) {
  const { ids } = bundle;
  validateTargetAuthorityHandoffReceiptDigestV1(receipt);
  assert(receipt.finalized, "handoff receipt is not finalized");
  if (proposal) {
    assert(receipt.proposal.equals(deriveGovernanceActionProposalPdaV2(ids.controller, ids.target, GovernanceActionKindV2.TargetAuthorityHandoff, proposal.proposalId)[0]), "handoff receipt proposal changed");
    assert(receipt.proposalDigest.equals(proposal.proposalDigest), "handoff receipt proposal digest changed");
  }
  assert(receipt.controllerProgram.equals(ids.controller), "handoff receipt controller changed");
  assert(receipt.controllerConfig.equals(ids.config), "handoff receipt config changed");
  assert(receipt.controllerAuthority.equals(ids.authority), "handoff receipt authority changed");
  assert(receipt.controllerImmutabilityReceipt.equals(ids.immutability), "handoff receipt immutability account changed");
  assert(receipt.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "handoff receipt immutability digest changed");
  assert(receipt.targetProgram.equals(ids.target), "handoff receipt target changed");
  assert(receipt.targetProgramdata.equals(ids.targetProgramdata), "handoff receipt target ProgramData changed");
  assert(receipt.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "handoff receipt Loader changed");
  assert.equal(receipt.preUpgradeAuthority.present, true, "handoff pre-authority is absent");
  assert(receipt.preUpgradeAuthority.value.equals(ids.legacyAuthority), "handoff pre-authority changed");
  assert.equal(receipt.postUpgradeAuthority.present, true, "handoff post-authority is absent");
  assert(receipt.postUpgradeAuthority.value.equals(ids.authority), "handoff post-authority changed");
  assert.equal(receipt.artifactLength, BigInt(bundle.artifact.length), "handoff receipt artifact length changed");
  assert.equal(receipt.artifactSha256.toString("hex"), bundle.artifactSha256, "handoff receipt artifact changed");
  assert(receipt.artifactMerkleRoot.equals(bundle.artifactMerkleRoot), "handoff receipt artifact root changed");
  assert(receipt.bridgeSourceCommitment.equals(bundle.evidenceCommitments.source), "handoff receipt source changed");
  assert(receipt.bridgeBuildInputsCommitment.equals(bundle.evidenceCommitments.buildInputs), "handoff receipt build changed");
  assert(receipt.bridgePackageCommitment.equals(bundle.evidenceCommitments.package), "handoff receipt package changed");
  assert(receipt.bridgeReleaseManifestCommitment.equals(bundle.evidenceCommitments.releaseManifest), "handoff receipt release changed");
  assert.equal(receipt.bootstrapGateEpoch, state.gate.epoch, "handoff receipt gate epoch changed");
  assert.equal(receipt.targetNonce, state.config.targetNonce, "handoff receipt nonce changed");
  assert.equal(receipt.councilVersion, state.council.version, "handoff receipt council changed");
  return receipt;
}

function activationPlanDigests(bundle, state, model, observation, handoff, proposalAddress, proposalDigest) {
  const { ids } = bundle;
  const nextEpoch = state.gate.epoch + 1n;
  const deployment = {
    discriminator: Buffer.from(CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR),
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.currentDeploymentBump,
    initialized: true,
    controllerProgram: ids.controller,
    controllerConfig: ids.config,
    capacityPolicy: ids.capacity,
    capacityPolicyDigest: observation.capacityPolicyDigest,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority: ids.authority,
    artifactLength: handoff.artifactLength,
    artifactSha256: handoff.artifactSha256,
    artifactMerkleRoot: handoff.artifactMerkleRoot,
    artifactSchemeId: handoff.artifactSchemeId,
    actualProgramdataCapacity: observation.actualCapacity,
    programdataObservation: model.observation,
    observationGeneration: observation.generation,
    observationRoot: observation.finalRawMerkleRoot,
    observationDigest: observation.observationDigest,
    deployedSlot: observation.deployedSlot,
    installedAuthority: ids.authority,
    sourceCommitment: handoff.bridgeSourceCommitment,
    buildInputsCommitment: handoff.bridgeBuildInputsCommitment,
    packageCommitment: handoff.bridgePackageCommitment,
    releaseManifestCommitment: handoff.bridgeReleaseManifestCommitment,
    releaseCommitment: ids.handoffReceipt,
    releaseCommitmentDigest: handoff.receiptDigest,
    activationReceipt: { present: true, value: ids.activationReceipt },
    completedProposal: { present: false, value: PublicKey.default },
    gateEpochAtActivation: nextEpoch,
    deploymentGeneration: 1n,
    deploymentDigest: Buffer.from(ZERO_32),
    lastUpdatedSlot: 0n,
    reserved: Buffer.alloc(CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN),
  };
  const receipt = {
    discriminator: Buffer.from(BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR),
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.activationReceiptBump,
    initialized: true,
    proposal: proposalAddress,
    proposalDigest,
    controllerProgram: ids.controller,
    controllerConfig: ids.config,
    governancePolicy: ids.policy,
    governancePolicyHash: state.policy.policyHash,
    capacityPolicy: ids.capacity,
    capacityPolicyDigest: observation.capacityPolicyDigest,
    controllerImmutabilityReceipt: ids.immutability,
    controllerImmutabilityDigest: state.immutability.receiptDigest,
    targetHandoffReceipt: ids.handoffReceipt,
    targetHandoffDigest: handoff.receiptDigest,
    gate: ids.gate,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority: ids.authority,
    bridgeObservation: model.observation,
    bridgeObservationGeneration: observation.generation,
    bridgeObservationRoot: observation.finalRawMerkleRoot,
    bridgeObservationDigest: observation.observationDigest,
    bridgeArtifactLength: handoff.artifactLength,
    bridgeArtifactSha256: handoff.artifactSha256,
    bridgeArtifactMerkleRoot: handoff.artifactMerkleRoot,
    bridgeArtifactSchemeId: handoff.artifactSchemeId,
    actualTargetCapacity: observation.actualCapacity,
    targetDeployedSlot: observation.deployedSlot,
    previousGateStatus: GateStatusV1.EmergencyFrozen,
    previousGateEpoch: state.gate.epoch,
    previousFreezeReasonCode: state.gate.freezeReasonCode,
    previousFreezeSlot: state.gate.freezeSlot,
    activatedGateStatus: GateStatusV1.Active,
    activatedGateEpoch: nextEpoch,
    targetNonce: state.config.targetNonce,
    councilVersion: state.council.version,
    councilHash: state.council.setHash,
    currentDeploymentState: ids.currentDeployment,
    currentDeploymentDigest: Buffer.from(ZERO_32),
    deploymentGeneration: 1n,
    finalizedSlot: 0n,
    receiptDigest: Buffer.from(ZERO_32),
    finalized: true,
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN),
  };
  return {
    deploymentPlanDigest: bootstrapActivationDeploymentPlanDigestV1(deployment),
    receiptPlanDigest: bootstrapActivationReceiptPlanDigestV1(receipt),
  };
}

function assertActivationFinal(bundle, state, proposal = null) {
  const { ids } = bundle;
  const receiptAccount = assertOwned(state.accounts.activationReceipt, ids.controller, BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN, "activation receipt");
  const deploymentAccount = assertOwned(state.accounts.currentDeployment, ids.controller, CURRENT_DEPLOYMENT_STATE_V1_LEN, "current deployment");
  const receipt = deserializeBootstrapActivationReceiptV1(receiptAccount.data);
  const deployment = deserializeCurrentDeploymentStateV1(deploymentAccount.data);
  validateBootstrapActivationReceiptDigestV1(receipt);
  validateCurrentDeploymentDigestV1(deployment);
  assert(receipt.finalized, "activation receipt is not finalized");
  if (proposal) {
    assert(receipt.proposalDigest.equals(proposal.proposalDigest), "activation receipt proposal digest changed");
    assert(receipt.proposal.equals(deriveGovernanceActionProposalPdaV2(ids.controller, ids.target, GovernanceActionKindV2.BootstrapActivation, proposal.proposalId)[0]), "activation receipt proposal changed");
  }
  assert(receipt.controllerProgram.equals(ids.controller), "activation receipt controller changed");
  assert(receipt.targetHandoffReceipt.equals(ids.handoffReceipt), "activation receipt handoff account changed");
  assert(receipt.targetProgram.equals(ids.target), "activation receipt target changed");
  assert(receipt.targetProgramdata.equals(ids.targetProgramdata), "activation receipt ProgramData changed");
  assert(receipt.controllerAuthority.equals(ids.authority), "activation receipt authority changed");
  assert.equal(receipt.activatedGateStatus, GateStatusV1.Active, "activation receipt gate status changed");
  assert.equal(receipt.activatedGateEpoch, state.gate.epoch, "activation receipt gate epoch changed");
  assert(receipt.currentDeploymentState.equals(ids.currentDeployment), "activation deployment address changed");
  assert(receipt.currentDeploymentDigest.equals(deployment.deploymentDigest), "activation receipt deployment digest changed");
  assert(deployment.activationReceipt.present && deployment.activationReceipt.value.equals(ids.activationReceipt), "deployment activation receipt changed");
  assert(deployment.targetProgram.equals(ids.target), "deployment target changed");
  assert(deployment.targetProgramdata.equals(ids.targetProgramdata), "deployment ProgramData changed");
  assert(deployment.installedAuthority.equals(ids.authority), "deployment authority changed");
  assert.equal(deployment.artifactSha256.toString("hex"), bundle.artifactSha256, "deployment artifact changed");
  assert.equal(deployment.gateEpochAtActivation, state.gate.epoch, "deployment gate epoch changed");
  return { receipt, deployment };
}

async function currentAction(connection, bundle, phase, minContextSlot = 0) {
  let statePhase = phase;
  if (phase === "handoff") {
    const targetResponse = await connection.getAccountInfoAndContext(bundle.ids.targetProgramdata, finalized(minContextSlot));
    const targetProgramdata = loaderProgramdata(targetResponse.value, "Spread ProgramData preflight");
    if (targetProgramdata.authority?.equals(bundle.ids.authority)) statePhase = "handoff-complete";
    else assert(targetProgramdata.authority?.equals(bundle.ids.legacyAuthority), "Spread ProgramData has an unexpected pre-handoff authority");
  }
  if (phase === "activation") {
    const gateResponse = await connection.getAccountInfoAndContext(bundle.ids.gate, finalized(minContextSlot));
    const gate = deserializeProtocolGateV1(assertOwned(gateResponse.value, bundle.ids.controller, PROTOCOL_GATE_LEN, "protocol gate preflight").data);
    if (gate.status === GateStatusV1.Active) statePhase = "activation-complete";
  }
  const state = await readBaseState(connection, bundle, minContextSlot, statePhase);
  if (statePhase === "activation-complete") {
    const proposal = await readProposal(connection, bundle, state, "activation", state.slot);
    assert(proposal.value && proposal.value.state === GovernanceLifecycleStateV2.Completed, "active gate lacks completed activation proposal");
    const final = assertActivationFinal(bundle, state, proposal.value);
    return { phase, kind: "complete", stage: "complete", state, proposal, final, instructions: [], signers: [] };
  }
  let handoff = null;
  if (state.accounts.handoffReceipt !== null) {
    handoff = deserializeTargetAuthorityHandoffReceiptV1(assertOwned(state.accounts.handoffReceipt, bundle.ids.controller, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN, "handoff receipt").data);
    validateHandoffReceipt(handoff, bundle, state);
  }
  if (phase === "activation") assert(handoff, "activation requires finalized handoff receipt");
  const preObservationRaw = statePhase === "handoff-complete"
    ? completedHandoffPreObservationRaw(bundle, state, handoff)
    : state.targetProgramdata.raw;
  const model = observationModel(bundle, state, phase, preObservationRaw);
  const observation = await readObservation(connection, bundle, state, model, state.slot);
  if (statePhase === "handoff-complete") {
    assert(observation.value && observation.value.status === ProgramDataObservationStatusV1.Finalized, "completed handoff lacks its finalized pre-handoff observation");
    assertCompletedHandoffObservation(observation.value, model, bundle, state, handoff, preObservationRaw);
  }
  const observationAction = observationNextAction(model, observation, bundle);
  if (observationAction) return { phase, kind: "mutation", state, model, observation, proposal: null, handoff, ...observationAction };
  assert(observation.value, "finalized observation is absent");
  const proposal = await readProposal(connection, bundle, state, phase, observation.slot);
  const accounts = phase === "handoff"
    ? handoffAccounts(bundle, state, model, proposal.address)
    : activationAccounts(bundle, state, model, proposal.address);
  if (proposal.value === null) {
    const instruction = phase === "handoff"
      ? buildCreateTargetAuthorityHandoffProposalV2Instruction(bundle.ids.controller, accounts.create, {
        expectedProposalId: proposal.proposalId,
        expectedGateEpoch: state.gate.epoch,
        expectedTargetNonce: state.config.targetNonce,
        expectedCouncilVersion: state.council.version,
        expectedTimingProfileVersion: state.timingProfile.profileVersion,
        expectedTimingProfileHash: state.timingProfile.profileHash,
        bridgeSourceCommitment: bundle.evidenceCommitments.source,
        bridgeBuildInputsCommitment: bundle.evidenceCommitments.buildInputs,
        bridgePackageCommitment: bundle.evidenceCommitments.package,
        bridgeReleaseManifestCommitment: bundle.evidenceCommitments.releaseManifest,
      })
      : buildCreateBootstrapActivationProposalV2Instruction(bundle.ids.controller, accounts.create, {
        expectedProposalId: proposal.proposalId,
        expectedControllerImmutabilityDigest: state.immutability.receiptDigest,
        expectedHandoffReceiptDigest: handoff.receiptDigest,
        expectedBridgeObservationDigest: observation.value.observationDigest,
        expectedGateEpoch: state.gate.epoch,
        expectedTargetNonce: state.config.targetNonce,
        expectedCouncilVersion: state.council.version,
        expectedTimingProfileVersion: state.timingProfile.profileVersion,
        expectedTimingProfileHash: state.timingProfile.profileHash,
      });
    return {
      phase, kind: "mutation", stage: "proposal-create", state, model, observation, proposal, handoff,
      instructions: [instruction], signers: [bundle.ids.payer, bundle.ids.seats[0]],
    };
  }
  assertProposalEvidence(proposal.value, phase, bundle, state, model);
  assert(proposal.value.bridgeObservationDigest.equals(observation.value.observationDigest), "proposal observation digest changed");
  if (phase === "handoff") assert(proposal.value.legacyTargetAuthority.equals(bundle.ids.legacyAuthority), "handoff proposal authority changed");
  else {
    assert(proposal.value.targetHandoffReceipt.equals(bundle.ids.handoffReceipt), "activation proposal handoff changed");
    assert(proposal.value.targetHandoffDigest.equals(handoff.receiptDigest), "activation proposal handoff digest changed");
  }
  if (proposal.value.state === GovernanceLifecycleStateV2.Draft) {
    assert(BigInt(state.slot) >= proposal.value.reviewStartSlot, "proposal review has not started");
    assert(BigInt(state.slot) <= proposal.value.reviewEndSlot, "proposal review window expired");
    assert(BigInt(state.slot) < proposal.value.expirySlot, "proposal expired");
    const seatIndex = [0, 1, 2].find((index) => (proposal.value.approvalBitset & (1 << index)) === 0);
    assert.notEqual(seatIndex, undefined, "Draft proposal has no missing approval seat");
    const instruction = phase === "handoff"
      ? buildApproveTargetAuthorityHandoffProposalV2Instruction(bundle.ids.controller, { ...accounts.common, seatAuthority: bundle.ids.seats[seatIndex] }, { guard: proposalGuard(state, proposal.value) })
      : buildApproveBootstrapActivationProposalV2Instruction(bundle.ids.controller, { ...accounts.common, seatAuthority: bundle.ids.seats[seatIndex] }, { guard: proposalGuard(state, proposal.value) });
    return {
      phase, kind: "mutation", stage: `proposal-approve-${seatIndex}`, state, model, observation, proposal, handoff,
      instructions: [instruction], signers: [bundle.ids.payer, bundle.ids.seats[seatIndex]],
    };
  }
  if (proposal.value.state === GovernanceLifecycleStateV2.CouncilApproved) {
    const instruction = phase === "handoff"
      ? buildQueueTargetAuthorityHandoffProposalV2Instruction(bundle.ids.controller, accounts.common, { guard: proposalGuard(state, proposal.value) })
      : buildQueueBootstrapActivationProposalV2Instruction(bundle.ids.controller, accounts.common, { guard: proposalGuard(state, proposal.value) });
    return {
      phase, kind: "mutation", stage: "proposal-queue", state, model, observation, proposal, handoff,
      instructions: [instruction], signers: [bundle.ids.payer],
    };
  }
  if (proposal.value.state === GovernanceLifecycleStateV2.Timelocked) {
    assert(BigInt(state.slot) < proposal.value.expirySlot, "proposal expired before execution");
    if (BigInt(state.slot) < proposal.value.notBeforeSlot) return {
      phase, kind: "wait", stage: "wait-not-before", state, model, observation, proposal, handoff,
      instructions: [], signers: [], slotsRemaining: (proposal.value.notBeforeSlot - BigInt(state.slot)).toString(),
    };
    let instruction;
    if (phase === "handoff") {
      instruction = buildExecuteTargetAuthorityHandoffProposalV2Instruction(bundle.ids.controller, accounts.execute, {
        guard: proposalGuard(state, proposal.value),
        expectedBridgeObservationDigest: observation.value.observationDigest,
        expectedGateEpoch: state.gate.epoch,
        expectedTargetNonce: state.config.targetNonce,
        envelope: envelope(),
      });
    } else {
      const digests = activationPlanDigests(bundle, state, model, observation.value, handoff, proposal.address, proposal.value.proposalDigest);
      instruction = buildExecuteBootstrapActivationProposalV2Instruction(bundle.ids.controller, accounts.execute, {
        guard: proposalGuard(state, proposal.value),
        expectedBridgeObservationDigest: observation.value.observationDigest,
        expectedGateEpoch: state.gate.epoch,
        expectedTargetNonce: state.config.targetNonce,
        expectedDeploymentPlanDigest: digests.deploymentPlanDigest,
        expectedReceiptPlanDigest: digests.receiptPlanDigest,
        envelope: envelope(),
      });
    }
    const instructions = buildCanonicalRelease1LoaderEnvelopeV1(instruction);
    return {
      phase, kind: "mutation", stage: "proposal-execute", state, model, observation, proposal, handoff,
      instructions, signers: phase === "handoff" ? [bundle.ids.payer, bundle.ids.legacyAuthority] : [bundle.ids.payer],
    };
  }
  if (proposal.value.state === GovernanceLifecycleStateV2.Completed) {
    if (phase === "handoff") {
      assert(handoff, "completed handoff proposal lacks receipt");
      validateHandoffReceipt(handoff, bundle, state, proposal.value);
    } else {
      throw new Error("completed activation proposal did not activate the gate atomically");
    }
    return { phase, kind: "complete", stage: "complete", state, model, observation, proposal, handoff, instructions: [], signers: [] };
  }
  throw new Error(`${phase} proposal is terminal in unsupported state ${proposal.value.state}`);
}

function bootstrapLookupAddresses(bundle) {
  const { ids, descriptor } = bundle;
  const values = [
    ids.controllerProgramdata,
    ids.target,
    ids.targetProgramdata,
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ids.config,
    ids.authority,
    ids.gate,
    ids.policy,
    key(descriptor.pdas.governanceCouncilSetV1, "descriptor bootstrap council"),
    ids.capacity,
    key(descriptor.pdas.controllerReleaseCommitment, "descriptor release commitment"),
    ids.treasury,
    key(descriptor.identities.guardian, "descriptor guardian"),
    ...ids.seats,
    ids.registry,
    key(descriptor.pdas.governanceTimingProfileV1, "descriptor initial timing profile"),
  ];
  assert.equal(values.length, 20, "bootstrap lookup address count changed");
  assert.equal(new Set(values.map((value) => value.toBase58())).size, 20, "bootstrap lookup addresses contain duplicates");
  return values;
}

async function loadLookup(connection, bundle, minContextSlot) {
  const receipt = await secureJson("AMEBA_GOVERNANCE_V2_ALT_EXTEND_RECEIPT", "V2 ALT extend receipt");
  assert.equal(receipt.value.schema, "ameba-governance-devnet-controller-v2-receipt-v1");
  assert.equal(receipt.value.action, "alt-extend");
  assert.equal(receipt.value.descriptorSha256, BASE_DESCRIPTOR_SHA256);
  const address = key(receipt.value.lookupTable, "V2 ceremony lookup table");
  const response = await connection.getAddressLookupTable(address, finalized(minContextSlot));
  assert(response.context.slot >= minContextSlot, "lookup read predates minimum context");
  assert(response.value, "V2 ceremony lookup table is absent");
  assert(response.value.state.authority?.equals(bundle.ids.payer), "lookup authority changed");
  assert(response.value.isActive(), "lookup table is inactive");
  assert.deepEqual(
    response.value.state.addresses.map((entry) => entry.toBase58()),
    bootstrapLookupAddresses(bundle).map((entry) => entry.toBase58()),
    "lookup address vector changed",
  );
  return { receipt, address, account: response.value, slot: response.context.slot };
}

function compilePacket(action, lookup, blockhash) {
  const message = new TransactionMessage({
    payerKey: action.signers[0],
    recentBlockhash: blockhash,
    instructions: action.instructions,
  }).compileToV0Message([lookup.account]);
  const signerKeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  assert.deepEqual(signerKeys.map((value) => value.toBase58()), action.signers.map((value) => value.toBase58()), "compiled signer order changed");
  const transaction = new VersionedTransaction(message);
  const packetBytes = transaction.serialize().length;
  assert(packetBytes <= 1_232, `transaction packet is ${packetBytes} bytes`);
  return { transaction, packetBytes, messageSha256: sha256Hex(Buffer.from(message.serialize())) };
}

function proposalSummary(proposal) {
  if (!proposal) return null;
  return {
    id: proposal.proposalId.toString(),
    address: proposal.address.toBase58(),
    state: proposal.value?.state ?? null,
    digest: proposal.value?.proposalDigest.toString("hex") ?? null,
    approvalBitset: proposal.value?.approvalBitset ?? null,
    approvalCount: proposal.value?.approvalCount ?? null,
    reviewEndSlot: proposal.value?.reviewEndSlot.toString() ?? null,
    notBeforeSlot: proposal.value?.notBeforeSlot.toString() ?? null,
    expirySlot: proposal.value?.expirySlot.toString() ?? null,
  };
}

function actionBindings(action, bundle) {
  return {
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerProgramdata: bundle.ids.controllerProgramdata.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    targetAuthority: action.state.targetProgramdata.authority?.toBase58() ?? null,
    gate: bundle.ids.gate.toBase58(),
    gateStatus: action.state.gate.status,
    gateEpoch: action.state.gate.epoch.toString(),
    gateFreezeSlot: action.state.gate.freezeSlot.toString(),
    gateFreezeReasonCode: action.state.gate.freezeReasonCode,
    configTargetNonce: action.state.config.targetNonce.toString(),
    council: action.state.councilAddress.toBase58(),
    councilVersion: action.state.council.version.toString(),
    councilHash: action.state.council.setHash.toString("hex"),
    lifecycleRegistry: bundle.ids.registry.toBase58(),
    nextProposalId: action.state.registry.nextProposalId.toString(),
    timingProfile: action.state.timingAddress.toBase58(),
    timingProfileVersion: action.state.timingProfile.profileVersion.toString(),
    timingProfileHash: action.state.timingProfile.profileHash.toString("hex"),
    observation: action.model?.observation.toBase58() ?? null,
    observationDigest: action.observation?.value?.observationDigest.toString("hex") ?? null,
    proposal: proposalSummary(action.proposal),
    formerAuthorityBoundaryReceiptSha256: bundle.formerAuthorityBoundary?.sha256 ?? null,
    baseAccountFingerprints: Object.fromEntries(Object.entries(action.state.accounts).map(([field, account]) => [field, accountFingerprint(account)])),
  };
}

function publicAction(action, bundle) {
  return {
    phase: action.phase,
    kind: action.kind,
    stage: action.stage,
    observedSlot: action.state.slot,
    slotsRemaining: action.slotsRemaining ?? null,
    signers: action.signers.map((value) => value.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    bindings: actionBindings(action, bundle),
  };
}

function assertActionMatchesPlan(action, plan, bundle) {
  assert.equal(action.kind, "mutation", "planned mutation is no longer the next action");
  assert.equal(action.phase, plan.phase, "phase changed after planning");
  assert.equal(action.stage, plan.stage, "stage changed after planning");
  assert.deepEqual(action.signers.map((value) => value.toBase58()), plan.signers, "signer set changed after planning");
  assert.deepEqual(action.instructions.map(instructionManifest), plan.instructions, "instruction manifest changed after planning");
  assert.deepEqual(actionBindings(action, bundle), plan.bindings, "on-chain plan bindings changed");
}

async function writePlan(bundle, phase, action, lookup, rpcSelection) {
  const material = {
    schema: PLAN_SCHEMA,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    tag53ReceiptSha256: bundle.tag53.sha256,
    tag82ReceiptSha256: bundle.tag82.sha256,
    controllerImmutabilityRecordSha256: bundle.immutabilityRecord.sha256,
    formerAuthorityBoundaryReceiptSha256: bundle.formerAuthorityBoundary?.sha256 ?? null,
    phase,
    stage: action.stage,
    genesisHash: EXPECTED_GENESIS,
    rpcSelection,
    observedSlot: action.state.slot,
    validUntilSlot: action.state.slot + PLAN_TTL_SLOTS,
    lookupTable: lookup.address.toBase58(),
    lookupReceiptSha256: lookup.receipt.sha256,
    lookupAddresses: lookup.account.state.addresses.map((value) => value.toBase58()),
    artifactSha256: bundle.artifactSha256,
    artifactBytes: bundle.artifact.length,
    evidenceSha256: Object.fromEntries(Object.entries(bundle.evidence).map(([field, value]) => [field, value.sha256])),
    signers: action.signers.map((value) => value.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    bindings: actionBindings(action, bundle),
  };
  const plan = { ...material, operationId: operationId(material) };
  const file = path.join(bundle.runDir, `v2-${phase}-${action.stage}-plan-${plan.operationId}.json`);
  await writeExclusiveJson(file, plan);
  const raw = await readFile(file);
  const planSha256 = sha256Hex(raw);
  const arm = `execute-${phase}-next:${plan.operationId}:${planSha256}`;
  process.stdout.write(`${JSON.stringify({ planFile: file, planSha256, arm, decodedAction: publicAction(action, bundle) }, null, 2)}\n`);
  return { file, plan, raw, planSha256 };
}

async function planNext(phase) {
  const bundle = await bindFormerAuthorityBoundary(await loadBundle(), phase);
  const planningOperation = operationId({ schema: "ameba-v2-handoff-activation-planning-v1", descriptor: bundle.descriptorSha256, phase, timestampBucket: Math.floor(Date.now() / 1_000) });
  return withCeremonyRpcOwnerLock(bundle.runDir, planningOperation, async () => {
    const journal = await openJournal(bundle.runDir, `v2-${phase}-planning-${planningOperation.slice(0, 12)}`, planningOperation);
    try {
      const { connection, slot, rpcSelection } = await rpcContext(bundle, journal, `v2-${phase}-planning`);
      const action = await currentAction(connection, bundle, phase, slot);
      if (action.kind !== "mutation") {
        process.stdout.write(`${JSON.stringify({ phase, status: action.kind, decodedAction: publicAction(action, bundle) }, null, 2)}\n`);
        return action;
      }
      const lookup = await loadLookup(connection, bundle, action.state.slot);
      compilePacket(action, lookup, PublicKey.default.toBase58());
      return writePlan(bundle, phase, action, lookup, rpcSelection);
    } finally {
      await journal.close();
    }
  });
}

async function loadPlan(bundle, phase) {
  const file = await requireSecureRegularFile(env("AMEBA_GOVERNANCE_V2_HANDOFF_ACTIVATION_PLAN"), "handoff/activation execution plan");
  assert.equal(path.dirname(file), bundle.runDir, "execution plan escaped the run directory");
  const raw = await readFile(file);
  const plan = JSON.parse(raw.toString("utf8"));
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.descriptorSha256, bundle.descriptorSha256);
  assert.equal(plan.baseDescriptorSha256, bundle.baseDescriptorSha256);
  assert.equal(plan.phase, phase);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.tag53ReceiptSha256, bundle.tag53.sha256);
  assert.equal(plan.tag82ReceiptSha256, bundle.tag82.sha256);
  assert.equal(plan.controllerImmutabilityRecordSha256, bundle.immutabilityRecord.sha256);
  assert.equal(plan.formerAuthorityBoundaryReceiptSha256, bundle.formerAuthorityBoundary?.sha256 ?? null);
  assert.equal(plan.artifactSha256, bundle.artifactSha256);
  assert.equal(plan.artifactBytes, bundle.artifact.length);
  assert(/^[0-9a-f]{64}$/u.test(plan.operationId), "plan operation ID is invalid");
  const { operationId: recorded, ...material } = plan;
  assert.equal(recorded, operationId(material), "plan operation ID changed");
  const planSha256 = sha256Hex(raw);
  const expectedArm = `execute-${phase}-next:${plan.operationId}:${planSha256}`;
  assert.equal(env("AMEBA_GOVERNANCE_V2_HANDOFF_ACTIVATION_ARM"), expectedArm, "execution is not armed for this exact plan");
  return { file, raw, plan, planSha256 };
}

async function writeStageReceipt(bundle, selected, landed, post) {
  const receipt = {
    schema: RECEIPT_SCHEMA,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    phase: selected.plan.phase,
    stage: selected.plan.stage,
    operationId: selected.plan.operationId,
    planFile: path.basename(selected.file),
    planSha256: selected.planSha256,
    formerAuthorityBoundaryReceiptSha256: bundle.formerAuthorityBoundary?.sha256 ?? null,
    proposalId: selected.plan.bindings.proposal?.id ?? (selected.plan.stage === "proposal-create" ? selected.plan.bindings.nextProposalId : null),
    finalizedTransaction: landed,
    postObservedSlot: post.state.slot,
    postStage: post.stage,
    postKind: post.kind,
  };
  const file = path.join(bundle.runDir, `v2-handoff-activation-stage-${selected.plan.operationId}.json`);
  try {
    await writeExclusiveJson(file, receipt);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), receipt, "existing stage receipt changed");
  }
  let finalReceipt = null;
  if (post.kind === "complete") {
    const stages = [];
    for (const name of (await readdir(bundle.runDir)).filter((entry) => entry.startsWith("v2-handoff-activation-stage-") && entry.endsWith(".json")).sort()) {
      const stageFile = await requireSecureRegularFile(path.join(bundle.runDir, name), `stage receipt ${name}`);
      const raw = await readFile(stageFile);
      const value = JSON.parse(raw.toString("utf8"));
      if (value.schema === RECEIPT_SCHEMA) stages.push({ file: name, sha256: sha256Hex(raw), phase: value.phase, stage: value.stage, signature: value.finalizedTransaction.signature, slot: value.finalizedTransaction.slot });
    }
    finalReceipt = {
      schema: FINAL_RECEIPT_SCHEMA,
      descriptorSha256: bundle.descriptorSha256,
      baseDescriptorSha256: bundle.baseDescriptorSha256,
      phase: selected.plan.phase,
      controllerProgram: bundle.ids.controller.toBase58(),
      targetProgram: bundle.ids.target.toBase58(),
      targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
      targetAuthority: post.state.targetProgramdata.authority?.toBase58() ?? null,
      gateStatus: post.state.gate.status,
      gateEpoch: post.state.gate.epoch.toString(),
      proposal: proposalSummary(post.proposal),
      handoffReceiptSha256: post.state.accounts.handoffReceipt ? sha256Hex(post.state.accounts.handoffReceipt.data) : null,
      activationReceiptSha256: post.state.accounts.activationReceipt ? sha256Hex(post.state.accounts.activationReceipt.data) : null,
      currentDeploymentSha256: post.state.accounts.currentDeployment ? sha256Hex(post.state.accounts.currentDeployment.data) : null,
      formerAuthorityBoundaryReceiptSha256: bundle.formerAuthorityBoundary?.sha256 ?? null,
      artifactSha256: bundle.artifactSha256,
      evidenceSha256: Object.fromEntries(Object.entries(bundle.evidence).map(([field, value]) => [field, value.sha256])),
      finalizedObservationSlot: post.state.slot,
      stageReceipts: stages,
    };
    const finalFile = path.join(bundle.runDir, `v2-${selected.plan.phase}-final-receipt-v1.json`);
    try {
      await writeExclusiveJson(finalFile, finalReceipt);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      assert.deepEqual(JSON.parse(await readFile(finalFile, "utf8")), finalReceipt, "existing final receipt changed");
    }
    finalReceipt = { file: finalFile, value: finalReceipt };
  }
  process.stdout.write(`${JSON.stringify({ receiptFile: file, receipt, finalReceipt }, null, 2)}\n`);
  return { file, receipt, finalReceipt };
}

async function executeNext(phase) {
  const bundle = await bindFormerAuthorityBoundary(await loadBundle(), phase);
  const selected = await loadPlan(bundle, phase);
  return withExecutionLock(bundle.runDir, `v2-${phase}-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId, async () => (
    withCeremonyRpcOwnerLock(bundle.runDir, selected.plan.operationId, async () => {
      const journal = await openJournal(bundle.runDir, `v2-${phase}-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId);
      try {
        const { connection, slot } = await rpcContext(bundle, journal, `v2-${phase}-execute`);
        assert(slot >= selected.plan.observedSlot, "execution RPC predates plan");
        const lookup = await loadLookup(connection, bundle, selected.plan.observedSlot);
        assert.equal(lookup.address.toBase58(), selected.plan.lookupTable, "lookup address changed after planning");
        assert.deepEqual(lookup.account.state.addresses.map((value) => value.toBase58()), selected.plan.lookupAddresses, "lookup addresses changed after planning");
        const plannedAction = actionFromPlan(selected.plan);
        const dummy = compilePacket(plannedAction, lookup, PublicKey.default.toBase58());
        let action = await currentAction(connection, bundle, phase, selected.plan.observedSlot);
        const verifyCurrent = async (minimumSlot) => {
          const current = await currentAction(connection, bundle, phase, minimumSlot);
          assertActionMatchesPlan(current, selected.plan, bundle);
          return { slot: current.state.slot };
        };
        const reconciled = await reconcileOneFinalized({
          connection,
          journal,
          operationId: selected.plan.operationId,
          stage: selected.plan.stage,
          expectedSigners: action.signers,
          expectedPacketBytes: dummy.packetBytes,
          verifyImmediatelyBeforeResubmit: verifyCurrent,
          verifyExpiredPrestate: verifyCurrent,
        });
        if (reconciled) {
          const post = await currentAction(connection, bundle, phase, reconciled.slot);
          assert.notEqual(post.stage, selected.plan.stage, "finalized transaction did not advance its stage");
          return writeStageReceipt(bundle, selected, reconciled, post);
        }
        assertActionMatchesPlan(action, selected.plan, bundle);
        assert(slot <= selected.plan.validUntilSlot, "plan expired");
        const blockhash = await connection.getLatestBlockhashAndContext("finalized");
        assert(blockhash.context.slot >= selected.plan.observedSlot, "blockhash predates plan");
        action = await currentAction(connection, bundle, phase, blockhash.context.slot);
        assertActionMatchesPlan(action, selected.plan, bundle);
        const prepared = compilePacket(action, lookup, blockhash.value.blockhash);
        assert.equal(prepared.packetBytes, dummy.packetBytes, "live packet length differs from plan");
        const decodedAction = publicAction(action, bundle);
        process.stdout.write(`${JSON.stringify({ decodedAction, operationId: selected.plan.operationId, planSha256: selected.planSha256 }, null, 2)}\n`);
        await journal.append("decoded-action", { phase, stage: action.stage, planSha256: selected.planSha256, decodedAction });
        const provider = await loadInjectedSignerProvider(bundle.runDir, "AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER");
        const signed = await signTransactionWithProvider({
          providerValue: provider,
          transaction: prepared.transaction,
          expectedSigners: action.signers,
          operationId: selected.plan.operationId,
          stage: selected.plan.stage,
        });
        const landed = await submitOneFinalized({
          connection,
          transaction: signed.transaction,
          latestBlockhash: blockhash.value,
          journal,
          operationId: selected.plan.operationId,
          stage: selected.plan.stage,
          expectedSigners: action.signers,
          expectedPacketBytes: prepared.packetBytes,
          minContextSlot: blockhash.context.slot,
          preparedContext: { planSha256: selected.planSha256, signerProvider: signed.providerEvidence },
          verifyImmediatelyBeforeSubmit: verifyCurrent,
          verifyExpiredPrestate: verifyCurrent,
        });
        const post = await currentAction(connection, bundle, phase, landed.slot);
        assert.notEqual(post.stage, selected.plan.stage, "finalized transaction did not advance its stage");
        return writeStageReceipt(bundle, selected, landed, post);
      } finally {
        await journal.close();
      }
    })
  ));
}

async function status(phase) {
  const bundle = await bindFormerAuthorityBoundary(await loadBundle(), phase);
  const statusId = operationId({ schema: "ameba-v2-handoff-activation-status-v1", descriptor: bundle.descriptorSha256, phase, timestampBucket: Math.floor(Date.now() / 1_000) });
  return withCeremonyRpcOwnerLock(bundle.runDir, statusId, async () => {
    const journal = await openJournal(bundle.runDir, `v2-${phase}-status-${statusId.slice(0, 12)}`, statusId);
    try {
      const { connection, slot } = await rpcContext(bundle, journal, `v2-${phase}-status`);
      const action = await currentAction(connection, bundle, phase, slot);
      process.stdout.write(`${JSON.stringify({ phase, status: action.kind, decodedAction: publicAction(action, bundle) }, null, 2)}\n`);
      return action;
    } finally {
      await journal.close();
    }
  });
}

function selfTestKey(label) {
  return new PublicKey(createHash("sha256").update(`v2-handoff-self-test:${label}`, "utf8").digest());
}

function selfTestEnvelope(kind) {
  const controller = new PublicKey(EXPECTED_CONTROLLER);
  const controllerProgramdata = new PublicKey(EXPECTED_CONTROLLER_PROGRAMDATA);
  const target = new PublicKey(EXPECTED_TARGET);
  const targetProgramdata = new PublicKey(EXPECTED_TARGET_PROGRAMDATA);
  const payer = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
  const legacy = new PublicKey(EXPECTED_LEGACY_AUTHORITY);
  const [config] = deriveControllerConfigPda(controller, target);
  const [authority] = deriveAuthorityPda(controller, target);
  const [gate] = deriveGatePda(controller, target);
  const [policy] = derivePolicyPda(controller, target, 1n);
  const [council] = deriveCouncilPda(controller, target, 1n);
  const [capacity] = deriveCapacityPolicyPdaV1(controller, target);
  const [immutability] = deriveControllerImmutabilityReceiptPdaV1(controller, target);
  const [registry] = deriveGovernanceLifecycleRegistryPdaV2(controller, target);
  const [profile] = deriveGovernanceTimingProfilePdaV1(controller, target, 1n);
  const seats = [
    "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
    "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
    "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
    "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
    "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
  ].map((value) => new PublicKey(value));
  const base = {
    controllerProgram: controller,
    controllerProgramdata,
    controllerConfig: config,
    governancePolicy: policy,
    council,
    protocolGate: gate,
    capacityPolicy: capacity,
    controllerImmutabilityReceipt: immutability,
    lifecycleRegistry: registry,
    governingTimingProfile: profile,
    proposal: selfTestKey(`${kind}-proposal`),
    bridgeObservation: selfTestKey(`${kind}-observation`),
    targetProgram: target,
    targetProgramdata,
    controllerAuthority: authority,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  const guard = {
    proposalId: 1n,
    expectedProposalDigest: createHash("sha256").update("proposal").digest(),
    expectedCouncilVersion: 1n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: Buffer.from(CURRENT_TIMING_HASH, "hex"),
  };
  const value = {
    guard,
    expectedBridgeObservationDigest: createHash("sha256").update("observation").digest(),
    expectedGateEpoch: 1n,
    expectedTargetNonce: 1n,
    envelope: envelope(),
  };
  const instruction = kind === "handoff"
    ? buildExecuteTargetAuthorityHandoffProposalV2Instruction(controller, {
      payer,
      ...base,
      legacyAuthority: legacy,
      targetHandoffReceipt: selfTestKey("handoff-receipt"),
      systemProgram: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    }, value)
    : buildExecuteBootstrapActivationProposalV2Instruction(controller, {
      payer,
      ...base,
      targetHandoffReceipt: selfTestKey("handoff-receipt"),
      bootstrapActivationReceipt: selfTestKey("activation-receipt"),
      currentDeployment: selfTestKey("deployment"),
      systemProgram: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    }, {
      ...value,
      expectedDeploymentPlanDigest: createHash("sha256").update("deployment").digest(),
      expectedReceiptPlanDigest: createHash("sha256").update("receipt").digest(),
    });
  const instructions = buildCanonicalRelease1LoaderEnvelopeV1(instruction);
  assert.equal(instructions.length, 3, `${kind} envelope instruction count changed`);
  assert.equal(instruction.data[0], kind === "handoff" ? 101 : 107, `${kind} V2 tag changed`);
  const signers = kind === "handoff" ? [payer, legacy] : [payer];
  const lookupKeys = [
    controllerProgramdata,
    target,
    targetProgramdata,
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    config,
    authority,
    gate,
    policy,
    council,
    capacity,
    new PublicKey("AyQyWNJz7HqSafrgYpgFKWkoq8sGQDZmjMB7adPq6nKW"),
    new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j"),
    new PublicKey("9DREu4USpbCHzLHD9whKHnRud8KDMhPswU4jZMbJP3ab"),
    ...seats,
    registry,
    profile,
  ];
  assert.equal(lookupKeys.length, 20);
  const lookup = new AddressLookupTableAccount({
    key: selfTestKey(`${kind}-lookup`),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      authority: payer,
      addresses: lookupKeys,
    },
  });
  const action = { instructions, signers };
  const packet = compilePacket(action, { account: lookup }, selfTestKey(`${kind}-blockhash`).toBase58());
  const restored = actionFromPlan({
    signers: signers.map((value) => value.toBase58()),
    instructions: instructions.map(instructionManifest),
  });
  assert.deepEqual(restored.signers.map((value) => value.toBase58()), signers.map((value) => value.toBase58()), `${kind} planned signer restoration changed`);
  assert.deepEqual(restored.instructions.map(instructionManifest), instructions.map(instructionManifest), `${kind} planned instruction restoration changed`);
  const restoredPacket = compilePacket(restored, { account: lookup }, selfTestKey(`${kind}-blockhash`).toBase58());
  assert.equal(restoredPacket.packetBytes, packet.packetBytes, `${kind} restored plan packet length changed`);
  return { tag: instruction.data[0], accounts: instruction.keys.length, packetBytes: packet.packetBytes, planRestored: true };
}

async function selfTest() {
  assert.equal(BASE_DESCRIPTOR_SHA256.length, 64);
  assert.equal(AMENDED_DESCRIPTOR_SHA256.length, 64);
  assert.notEqual(BASE_DESCRIPTOR_SHA256, AMENDED_DESCRIPTOR_SHA256);
  assert.notEqual(BASE_TIMING_HASH, CURRENT_TIMING_HASH);
  const handoff = selfTestEnvelope("handoff");
  const activation = selfTestEnvelope("activation");
  assert.equal(handoff.accounts, 21, "tag101 account count changed");
  assert.equal(activation.accounts, 22, "tag107 account count changed");
  const source = await readFile(fileURLToPath(import.meta.url), "utf8");
  assert(!source.includes(["buildCreateTargetAuthorityHandoff", "V1Instruction"].join("")), "tool imported the V1 handoff builder");
  assert(!source.includes(["buildCreateBootstrapActivation", "V1Instruction"].join("")), "tool imported the V1 activation builder");
  assert(!source.includes(["loadSecure", "Keypair"].join("")), "tool contains a keypair fallback");
  const proposalTiming = selfTestProposalTiming();
  const completedHandoffObservation = selfTestCompletedHandoffObservation();
  const runtime = await selfTestCeremonyRuntime();
  const result = {
    schema: "ameba-governance-devnet-v2-handoff-activation-self-test-v1",
    descriptorLineage: { base: BASE_DESCRIPTOR_SHA256, amended: AMENDED_DESCRIPTOR_SHA256 },
    timingLineage: { base: BASE_TIMING_HASH, current: CURRENT_TIMING_HASH },
    tags: { handoffExecute: handoff.tag, activationExecute: activation.tag },
    accountCounts: { handoffExecute: handoff.accounts, activationExecute: activation.accounts },
    packetBytes: { handoffExecute: handoff.packetBytes, activationExecute: activation.packetBytes },
    injectedSignerOnly: true,
    oldV1LifecycleBuildersAbsent: true,
    authorityFinalAndOnchainRecordEvidenceSeparated: true,
    proposalTiming,
    completedHandoffObservation,
    finalizedJournalPlanRestoredWithoutLiveAction: handoff.planRestored && activation.planRestored,
    runtime,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function verifyEvidenceOffline() {
  const bundle = await loadBundle();
  const result = {
    schema: "ameba-governance-devnet-v2-handoff-activation-evidence-verification-v1",
    genesisHash: EXPECTED_GENESIS,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerProgramdata: bundle.ids.controllerProgramdata.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    legacyAuthority: bundle.ids.legacyAuthority.toBase58(),
    tag53ReceiptSha256: bundle.tag53.sha256,
    tag82ReceiptSha256: bundle.tag82.sha256,
    immutabilityRecordSha256: bundle.immutabilityRecord.sha256,
    artifact: {
      file: bundle.artifactFile,
      bytes: bundle.artifact.length,
      sha256: bundle.artifactSha256,
      merkleRoot: bundle.artifactMerkleRoot.toString("hex"),
      schemeId: ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
    },
    evidenceSha256: Object.fromEntries(Object.entries(bundle.evidence).map(([field, value]) => [field, value.sha256])),
    evidenceCommitments: Object.fromEntries(Object.entries(bundle.evidenceCommitments).map(([field, value]) => [field, value.toString("hex")])),
    rpcUsed: false,
    signingUsed: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  switch (command) {
    case "self-test": await selfTest(); break;
    case "verify-evidence-offline": await verifyEvidenceOffline(); break;
    case "status-handoff": await status("handoff"); break;
    case "plan-handoff-next": await planNext("handoff"); break;
    case "execute-handoff-next": await executeNext("handoff"); break;
    case "status-activation": await status("activation"); break;
    case "plan-activation-next": await planNext("activation"); break;
    case "execute-activation-next": await executeNext("activation"); break;
    default: throw new Error("unreachable command");
  }
}

main().catch((error) => {
  if (error instanceof RpcBackoffExit) {
    process.stderr.write(`${JSON.stringify({ controlledExit: "rpc-rate-limit", retryAfterMs: error.retryAfterMs })}\n`);
    process.exitCode = 75;
    return;
  }
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
