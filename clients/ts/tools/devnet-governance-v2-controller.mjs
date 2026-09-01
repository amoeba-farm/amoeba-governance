import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  assertExactKeys,
  guardRpcConnection,
  loadInjectedSignerProvider,
  loadSecureKeypair,
  openJournal,
  operationId,
  reconcileOneFinalized,
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
  CONTROLLER_RELEASE_COMMITMENT_V1_LEN,
  CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN,
  EXTEND_PROGRAM_CHECKED_FEATURE_ID_V1,
  LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
  MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
  PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
  PROGRAMDATA_CAPACITY_POLICY_V1_LEN,
  PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN,
  SET_AUTHORITY_CHECKED_FEATURE_ID_V1,
  controllerReleaseDigestV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerImmutabilityReceiptPdaV1,
  deriveControllerReleaseCommitmentPdaV1,
  deserializeControllerReleaseCommitmentV1,
  deserializeProgramDataCapacityPolicyV1,
  programDataCapacityPolicyDigestV1,
  serializeControllerReleaseCommitmentV1,
  serializeProgramDataCapacityPolicyV1,
  validateControllerReleaseDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import {
  buildInitializeGovernanceLifecycleRegistryV2Instruction,
} from "../dist/upgradeGovernance/release1GovernanceV2Instructions.js";
import {
  GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN,
  GOVERNANCE_TIMING_PROFILE_V1_LEN,
  deriveGovernanceLifecycleRegistryPdaV2,
  deriveGovernanceTimingProfilePdaV1,
  deserializeGovernanceLifecycleRegistryV2,
  deserializeGovernanceTimingProfileV1,
  governanceTimingProfileHashV1,
  nominalGovernanceTimingProfileV1,
  validateGovernanceLifecycleRegistryV2,
  validateGovernanceTimingProfileV1,
} from "../dist/upgradeGovernance/release1GovernanceV2.js";
import { clusterDomainFromGenesisHashV1 } from "../dist/upgradeGovernance/release1Planning.js";
import {
  BOOTSTRAP_INITIAL_SEAT_TERM_END_V2,
} from "../dist/upgradeGovernance/release1V3Instructions.js";
import { buildInitializeControllerV2Instruction } from "../dist/upgradeGovernance/release1V3Builders.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  CONTROLLER_CONFIG_LEN,
  GOVERNANCE_COUNCIL_SET_LEN,
  GOVERNANCE_POLICY_LEN,
  PROTOCOL_GATE_LEN,
  PROTOCOL_GATE_DISCRIMINATOR,
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveUpgradeableProgramdataAddress,
  deserializeProtocolGateV1,
  governanceCouncilSetHash,
  governancePolicyHash,
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

process.umask(0o077);

const DESCRIPTOR_SCHEMA = "ameba-governance-devnet-controller-v2-descriptor-v1";
const PLAN_SCHEMA = "ameba-governance-devnet-controller-v2-plan-v1";
const RECEIPT_SCHEMA = "ameba-governance-devnet-controller-v2-receipt-v1";
const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAX_PACKET_BYTES = 1_232;
const PLAN_TTL_SLOTS = 2_000;
const CONTROLLER_PROGRAM_RAW_BYTES = 36;
const PROGRAMDATA_HEADER_BYTES = 45;
const BUFFER_HEADER_BYTES = 37;
const INITIAL_POLICY_VERSION = 1n;
const INITIAL_COUNCIL_VERSION = 1n;
const INITIAL_NEXT_PROPOSAL_ID = 1n;
const INITIAL_TARGET_NONCE = 1n;
const INITIAL_GATE_EPOCH = 1n;
const INITIAL_ROTATION_NONCE = 1n;
const ROUTINE_DELAY_SLOTS = 2_250n;
const MAJOR_DELAY_SLOTS = 4_500n;
const ROLLBACK_DELAY_SLOTS = 900n;
const TERMINAL_DELAY_SLOTS = 9_000n;
const VOTE_REVIEW_SLOTS = 450n;
const PROPOSAL_EXPIRY_SLOTS = 432_000n;
const ZERO_HASH = Buffer.alloc(32);
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const KEYPAIR_FILES = Object.freeze({
  payer: "ceremony-fee-payer.json",
  initializer: "controller-initializer.json",
  program: "controller-program-id.json",
  buffer: "controller-deploy-buffer.json",
});

const COMMANDS = new Set([
  "self-test",
  "plan-deploy",
  "execute-deploy",
  "plan-alt-create",
  "execute-alt-create",
  "plan-alt-extend",
  "execute-alt-extend",
  "plan-initialize-tag53",
  "execute-initialize-tag53",
  "plan-initialize-tag82",
  "execute-initialize-tag82",
  "verify-bootstrap",
  "plan-authority-final",
  "execute-authority-final",
  "verify-immutable",
]);

const DESCRIPTOR_KEYS = ["schema", "cluster", "source", "artifact", "identities", "pdas", "governanceLivenessV2", "authorization"];
const CLUSTER_KEYS = ["name", "genesisHash"];
const SOURCE_KEYS = ["repository", "branch", "commit", "tree", "cargoLockSha256"];
const ARTIFACT_KEYS = ["file", "sbpfArchitecture", "bytes", "sha256", "programDataRawBytes", "bufferRawBytes", "deployWithMaxDataLenHex"];
const IDENTITY_KEYS = ["controllerProgram", "controllerProgramData", "controllerDeployBuffer", "targetProgram", "targetProgramData", "legacyTargetAuthority", "feePayer", "initializer", "treasury", "guardian", "seats"];
const PDA_KEYS = ["controllerConfig", "controllerAuthority", "protocolGate", "governancePolicyV1", "governanceCouncilSetV1", "capacityPolicy", "controllerReleaseCommitment", "controllerImmutabilityReceipt", "governanceLifecycleRegistryV2", "governanceTimingProfileV1"];
const LIVENESS_KEYS = ["initialTimingProfileVersion", "initialTimingProfileHash", "initialNextProposalId", "initialRotationNonce", "routineQuorum", "terminalQuorumReserved", "tokenGovernanceEnabled"];
const AUTHORIZATION_KEYS = ["devnetOnly", "mainnetAllowed", "writerRestartAllowed", "mainBranchMergeAllowed"];
const PLAN_KEYS = ["schema", "descriptorSha256", "action", "genesisHash", "observedSlot", "validUntilSlot", "details", "operationId"];

function usage() {
  return `usage: node tools/devnet-governance-v2-controller.mjs <${[...COMMANDS].join("|")}>\n`;
}

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function domainDigest(domain, ...parts) {
  return sha256(Buffer.from(domain, "ascii"), ...parts);
}

function requireHex(value, bytes, label) {
  assert(typeof value === "string" && new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "u").test(value), `${label} must be ${bytes}-byte lowercase hex`);
  return Buffer.from(value, "hex");
}

function requirePositiveSafeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
}

function publicKey(value, label) {
  assert(typeof value === "string", `${label} must be base58`);
  const key = new PublicKey(value);
  assert(!key.equals(PublicKey.default), `${label} must be nondefault`);
  return key;
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

function assertManifestEqual(actual, expected, label) {
  assert.deepEqual(actual.map(instructionManifest), expected, `${label} instruction manifest changed`);
}

function validateDescriptor(value) {
  assertExactKeys(value, DESCRIPTOR_KEYS, "governance V2 descriptor");
  assert.equal(value.schema, DESCRIPTOR_SCHEMA);
  assertExactKeys(value.cluster, CLUSTER_KEYS, "descriptor.cluster");
  assert.equal(value.cluster.name, "devnet");
  assert.equal(value.cluster.genesisHash, EXPECTED_GENESIS);
  assertExactKeys(value.source, SOURCE_KEYS, "descriptor.source");
  assert.equal(value.source.repository, "https://github.com/SPACE999978/ameba_gov");
  assert(/^codex\/[a-z0-9][a-z0-9._/-]*$/u.test(value.source.branch), "descriptor source branch is invalid");
  requireHex(value.source.commit, 20, "descriptor source commit");
  requireHex(value.source.tree, 20, "descriptor source tree");
  requireHex(value.source.cargoLockSha256, 32, "descriptor Cargo.lock hash");
  assertExactKeys(value.artifact, ARTIFACT_KEYS, "descriptor.artifact");
  assert.equal(path.basename(value.artifact.file), value.artifact.file, "artifact filename must be a basename");
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*\.so$/u.test(value.artifact.file), "artifact filename is invalid");
  assert.equal(value.artifact.sbpfArchitecture, "v0", "fast-lane controller must use the audited v0 artifact");
  requirePositiveSafeInteger(value.artifact.bytes, "artifact bytes");
  assert(value.artifact.bytes <= MAX_ARTIFACT_BYTES_V1, "artifact exceeds controller maximum");
  requireHex(value.artifact.sha256, 32, "artifact SHA-256");
  assert.equal(value.artifact.programDataRawBytes, PROGRAMDATA_HEADER_BYTES + value.artifact.bytes);
  assert.equal(value.artifact.bufferRawBytes, BUFFER_HEADER_BYTES + value.artifact.bytes);
  const deployBytes = requireHex(value.artifact.deployWithMaxDataLenHex, 12, "DeployWithMaxDataLen bytes");
  assert.equal(deployBytes.readUInt32LE(0), 2, "DeployWithMaxDataLen variant changed");
  assert.equal(Number(deployBytes.readBigUInt64LE(4)), value.artifact.bytes, "DeployWithMaxDataLen capacity changed");
  assertExactKeys(value.identities, IDENTITY_KEYS, "descriptor.identities");
  for (const field of IDENTITY_KEYS.filter((field) => field !== "seats")) publicKey(value.identities[field], `descriptor.identities.${field}`);
  assert(Array.isArray(value.identities.seats) && value.identities.seats.length === 5, "descriptor must contain five seats");
  const seats = value.identities.seats.map((entry, index) => publicKey(entry, `seat ${index}`));
  assert.equal(new Set(seats.map((entry) => entry.toBase58())).size, 5, "descriptor seats must be distinct");
  const allIdentities = [
    ...IDENTITY_KEYS.filter((field) => field !== "seats").map((field) => value.identities[field]),
    ...value.identities.seats,
  ];
  assert.equal(new Set(allIdentities).size, allIdentities.length, "descriptor identities must be distinct");
  assertExactKeys(value.pdas, PDA_KEYS, "descriptor.pdas");
  for (const [field, entry] of Object.entries(value.pdas)) publicKey(entry, `descriptor.pdas.${field}`);
  assertExactKeys(value.governanceLivenessV2, LIVENESS_KEYS, "descriptor.governanceLivenessV2");
  assert.equal(value.governanceLivenessV2.initialTimingProfileVersion, 1);
  requireHex(value.governanceLivenessV2.initialTimingProfileHash, 32, "initial timing profile hash");
  assert.equal(value.governanceLivenessV2.initialNextProposalId, 1);
  assert.equal(value.governanceLivenessV2.initialRotationNonce, 1);
  assert.equal(value.governanceLivenessV2.routineQuorum, 3);
  assert.equal(value.governanceLivenessV2.terminalQuorumReserved, 4);
  assert.equal(value.governanceLivenessV2.tokenGovernanceEnabled, false);
  assertExactKeys(value.authorization, AUTHORIZATION_KEYS, "descriptor.authorization");
  assert.equal(value.authorization.devnetOnly, true);
  assert.equal(value.authorization.mainnetAllowed, false);
  assert.equal(value.authorization.writerRestartAllowed, false);
  assert.equal(value.authorization.mainBranchMergeAllowed, false);
  return value;
}

function deriveIdentities(descriptor) {
  const controller = publicKey(descriptor.identities.controllerProgram, "controller program");
  const target = publicKey(descriptor.identities.targetProgram, "target program");
  assert.equal(
    deriveUpgradeableProgramdataAddress(controller)[0].toBase58(),
    descriptor.identities.controllerProgramData,
    "descriptor controller ProgramData is not canonical",
  );
  assert.equal(
    deriveUpgradeableProgramdataAddress(target)[0].toBase58(),
    descriptor.identities.targetProgramData,
    "descriptor target ProgramData is not canonical",
  );
  const [config, configBump] = deriveControllerConfigPda(controller, target);
  const [authority, authorityBump] = deriveAuthorityPda(controller, target);
  const [gate, gateBump] = deriveGatePda(controller, target);
  const [policy, policyBump] = derivePolicyPda(controller, target, INITIAL_POLICY_VERSION);
  const [council, councilBump] = deriveCouncilPda(controller, target, INITIAL_COUNCIL_VERSION);
  const [capacityPolicy, capacityPolicyBump] = deriveCapacityPolicyPdaV1(controller, target);
  const [controllerRelease, controllerReleaseBump] = deriveControllerReleaseCommitmentPdaV1(controller, target);
  const [immutabilityReceipt] = deriveControllerImmutabilityReceiptPdaV1(controller, target);
  const [lifecycleRegistry, lifecycleRegistryBump] = deriveGovernanceLifecycleRegistryPdaV2(controller, target);
  const [timingProfile, timingProfileBump] = deriveGovernanceTimingProfilePdaV1(controller, target, 1n);
  const expected = {
    controllerConfig: config,
    controllerAuthority: authority,
    protocolGate: gate,
    governancePolicyV1: policy,
    governanceCouncilSetV1: council,
    capacityPolicy,
    controllerReleaseCommitment: controllerRelease,
    controllerImmutabilityReceipt: immutabilityReceipt,
    governanceLifecycleRegistryV2: lifecycleRegistry,
    governanceTimingProfileV1: timingProfile,
  };
  for (const [field, key] of Object.entries(expected)) {
    assert.equal(key.toBase58(), descriptor.pdas[field], `descriptor ${field} PDA changed`);
  }
  return {
    controller,
    controllerProgramdata: publicKey(descriptor.identities.controllerProgramData, "controller ProgramData"),
    deployBuffer: publicKey(descriptor.identities.controllerDeployBuffer, "controller deploy buffer"),
    target,
    targetProgramdata: publicKey(descriptor.identities.targetProgramData, "target ProgramData"),
    legacyTargetAuthority: publicKey(descriptor.identities.legacyTargetAuthority, "legacy target authority"),
    payer: publicKey(descriptor.identities.feePayer, "fee payer"),
    initializer: publicKey(descriptor.identities.initializer, "initializer"),
    treasury: publicKey(descriptor.identities.treasury, "treasury"),
    guardian: publicKey(descriptor.identities.guardian, "guardian"),
    seats: descriptor.identities.seats.map((entry) => new PublicKey(entry)),
    config,
    configBump,
    authority,
    authorityBump,
    gate,
    gateBump,
    policy,
    policyBump,
    council,
    councilBump,
    capacityPolicy,
    capacityPolicyBump,
    controllerRelease,
    controllerReleaseBump,
    immutabilityReceipt,
    lifecycleRegistry,
    lifecycleRegistryBump,
    timingProfile,
    timingProfileBump,
  };
}

async function requireAuditedEvidenceFile(file, label, enforceReadonlyPermissions = true) {
  const resolved = path.resolve(file);
  const status = await lstat(resolved);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  if (typeof process.getuid === "function") assert.equal(status.uid, process.getuid(), `${label} owner changed`);
  if (enforceReadonlyPermissions) assert.equal(status.mode & 0o022, 0, `${label} must not be group/other writable`);
  return { file: resolved, bytes: await readFile(resolved) };
}

async function loadBuildEvidence(descriptor, artifact) {
  const configured = process.env.AMEBA_GOVERNANCE_V2_BUILD_EVIDENCE_DIR?.trim();
  assert(configured, "AMEBA_GOVERNANCE_V2_BUILD_EVIDENCE_DIR is required for tag53/bootstrap evidence");
  const directory = path.resolve(configured);
  const directoryStatus = await lstat(directory);
  assert(directoryStatus.isDirectory() && !directoryStatus.isSymbolicLink(), "build evidence directory must be a regular directory");
  if (typeof process.getuid === "function") assert.equal(directoryStatus.uid, process.getuid(), "build evidence directory owner changed");
  assert.equal(directoryStatus.mode & 0o022, 0, "build evidence directory must not be group/other writable");
  const files = {};
  for (const name of ["command.txt", "receipt.txt", "linked-elf-symbols.txt", "deploy-elf-symbols.txt"]) {
    files[name] = await requireAuditedEvidenceFile(path.join(directory, name), `audited ${name}`);
  }
  const auditedArtifact = await requireAuditedEvidenceFile(path.join(directory, "deploy", "upgrade_controller.so"), "audited deployed controller artifact");
  assert(auditedArtifact.bytes.equals(artifact), "secure ceremony artifact differs from audited deployed artifact");
  const sourceFiles = {};
  for (const relative of [
    "Cargo.lock",
    "programs/upgrade_controller/src/release1_governance_v2.rs",
    "programs/upgrade_controller/src/release1_governance_v2_processor.rs",
    "programs/upgrade_controller/src/processor.rs",
    "clients/ts/upgradeGovernance/release1GovernanceV2.ts",
    "clients/ts/upgradeGovernance/release1GovernanceV2Instructions.ts",
  ]) {
    sourceFiles[relative] = await requireAuditedEvidenceFile(path.join(REPOSITORY_ROOT, relative), `audited source ${relative}`, false);
  }
  assert.equal(sha256Hex(sourceFiles["Cargo.lock"].bytes), descriptor.source.cargoLockSha256, "current Cargo.lock differs from descriptor");
  const git = async (args) => {
    const environment = sanitizedChildEnvironment();
    let result = spawnSync("git", ["-C", REPOSITORY_ROOT, ...args], { encoding: "utf8", env: environment, timeout: 30_000 });
    if (result.status !== 0) {
      const dotGit = (await readFile(path.join(REPOSITORY_ROOT, ".git"), "utf8")).trim();
      assert(dotGit.startsWith("gitdir: "), "repository .git indirection is malformed");
      let gitDirectory = dotGit.slice("gitdir: ".length).trim();
      if (/^[A-Za-z]:[\\/]/u.test(gitDirectory)) {
        const converted = spawnSync("wslpath", ["-u", gitDirectory], { encoding: "utf8", env: environment, timeout: 30_000 });
        assert.equal(converted.status, 0, "wslpath failed to resolve the linked Windows gitdir");
        gitDirectory = converted.stdout.trim();
      } else {
        gitDirectory = path.resolve(REPOSITORY_ROOT, gitDirectory);
      }
      result = spawnSync("git", ["--git-dir", gitDirectory, "--work-tree", REPOSITORY_ROOT, ...args], { encoding: "utf8", env: environment, timeout: 30_000 });
    }
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  assert.equal(await git(["rev-parse", "HEAD"]), descriptor.source.commit, "repository HEAD differs from descriptor source commit");
  assert.equal(await git(["rev-parse", "HEAD^{tree}"]), descriptor.source.tree, "repository tree differs from descriptor source tree");
  assert.equal(await git(["status", "--porcelain", "--untracked-files=no"]), "", "repository has tracked working-tree changes");
  return { directory, files, sourceFiles, auditedArtifact };
}

async function loadBundle({ artifactRequired = true, evidenceRequired = false } = {}) {
  const configured = process.env.AMEBA_GOVERNANCE_V2_DESCRIPTOR?.trim();
  assert(configured, "AMEBA_GOVERNANCE_V2_DESCRIPTOR is required");
  const descriptorFile = await requireSecureRegularFile(configured, "governance V2 descriptor");
  const runDir = await requireSecureDirectory(path.dirname(descriptorFile), "governance V2 run directory");
  const descriptorBytes = await readFile(descriptorFile);
  const descriptor = validateDescriptor(JSON.parse(descriptorBytes.toString("utf8")));
  const ids = deriveIdentities(descriptor);
  let artifact = null;
  let artifactFile = null;
  if (artifactRequired) {
    artifactFile = await requireSecureRegularFile(path.join(runDir, descriptor.artifact.file), "controller v2 artifact");
    assert.equal(path.dirname(artifactFile), runDir, "controller artifact escaped run directory");
    artifact = await readFile(artifactFile);
    assert.equal(artifact.length, descriptor.artifact.bytes, "controller artifact length changed");
    assert.equal(sha256Hex(artifact), descriptor.artifact.sha256, "controller artifact SHA-256 changed");
  }
  const bundle = {
    descriptor,
    descriptorFile,
    descriptorSha256: sha256Hex(descriptorBytes),
    runDir,
    artifact,
    artifactFile,
    ids,
    evidence: null,
  };
  if (evidenceRequired) {
    assert(artifact !== null, "build evidence requires the controller artifact");
    bundle.evidence = await loadBuildEvidence(descriptor, artifact);
  }
  return bundle;
}

function lookupAddresses(ids) {
  const values = [
    ids.controllerProgramdata,
    ids.target,
    ids.targetProgramdata,
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ids.config,
    ids.authority,
    ids.gate,
    ids.policy,
    ids.council,
    ids.capacityPolicy,
    ids.controllerRelease,
    ids.treasury,
    ids.guardian,
    ...ids.seats,
    ids.lifecycleRegistry,
    ids.timingProfile,
  ];
  assert.equal(values.length, 20, "V2 bootstrap ALT address count changed");
  assert.equal(new Set(values.map((entry) => entry.toBase58())).size, values.length, "V2 bootstrap ALT contains duplicates");
  return values;
}

function buildCapacityPolicy(bundle, creationSlot = 0n) {
  const { ids } = bundle;
  const geometry = programDataObservationGeometryV1(
    MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
    PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  );
  const value = {
    discriminator: PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.capacityPolicyBump,
    initialized: true,
    controllerProgram: ids.controller,
    controllerConfig: ids.config,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
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
    policyDigest: ZERO_HASH,
    creationSlot,
    reserved: Buffer.alloc(PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN),
  };
  value.policyDigest = programDataCapacityPolicyDigestV1(value);
  return value;
}

function sourceCommitments(bundle) {
  const { descriptor, descriptorSha256, artifact, evidence } = bundle;
  assert(evidence, "audited build evidence is required for controller release commitments");
  const sourceCommit = Buffer.from(descriptor.source.commit, "hex");
  const sourceTree = Buffer.from(descriptor.source.tree, "hex");
  const artifactHash = Buffer.from(descriptor.artifact.sha256, "hex");
  const sourceCommitment = domainDigest("AMOEBA_CONTROLLER_SOURCE_COMMIT_V1", sourceCommit);
  const sourceTreeCommitment = domainDigest("AMOEBA_CONTROLLER_SOURCE_TREE_V1", sourceTree);
  const buildInputsCommitment = domainDigest(
    "AMOEBA_CONTROLLER_BUILD_INPUTS_V1",
    evidence.files["command.txt"].bytes,
    evidence.files["receipt.txt"].bytes,
    evidence.sourceFiles["Cargo.lock"].bytes,
    evidence.sourceFiles["programs/upgrade_controller/src/processor.rs"].bytes,
    evidence.sourceFiles["programs/upgrade_controller/src/release1_governance_v2.rs"].bytes,
    evidence.sourceFiles["programs/upgrade_controller/src/release1_governance_v2_processor.rs"].bytes,
  );
  const toolchainCommitment = domainDigest(
    "AMOEBA_CONTROLLER_TOOLCHAIN_V1",
    evidence.files["command.txt"].bytes,
    evidence.files["receipt.txt"].bytes,
    evidence.files["linked-elf-symbols.txt"].bytes,
    evidence.files["deploy-elf-symbols.txt"].bytes,
  );
  const packageCommitment = domainDigest(
    "AMOEBA_CONTROLLER_PACKAGE_V1",
    artifactHash,
    artifact,
    evidence.files["receipt.txt"].bytes,
  );
  const releaseManifestCommitment = domainDigest(
    "AMOEBA_CONTROLLER_DEPLOY_MANIFEST_V1",
    Buffer.from(descriptorSha256, "hex"),
    evidence.files["receipt.txt"].bytes,
  );
  const abiCommitment = domainDigest(
    "AMOEBA_CONTROLLER_ABI_V1",
    evidence.sourceFiles["programs/upgrade_controller/src/release1_governance_v2.rs"].bytes,
    evidence.sourceFiles["programs/upgrade_controller/src/release1_governance_v2_processor.rs"].bytes,
    evidence.sourceFiles["clients/ts/upgradeGovernance/release1GovernanceV2.ts"].bytes,
    evidence.sourceFiles["clients/ts/upgradeGovernance/release1GovernanceV2Instructions.ts"].bytes,
  );
  return {
    sourceCommitment,
    sourceTreeCommitment,
    buildInputsCommitment,
    toolchainCommitment,
    packageCommitment,
    releaseManifestCommitment,
    abiCommitment,
  };
}

function buildTag53Model(bundle, activationSlot, controllerCapacity) {
  assert(activationSlot > 0n, "tag53 activation slot must be nonzero");
  assert(controllerCapacity >= bundle.descriptor.artifact.bytes, "controller capacity is below artifact length");
  const { ids } = bundle;
  const seatTerms = ids.seats.map(() => ({
    termStartSlot: activationSlot,
    termEndSlot: BOOTSTRAP_INITIAL_SEAT_TERM_END_V2,
  }));
  assert.equal(BOOTSTRAP_INITIAL_SEAT_TERM_END_V2, U64_MAX);
  const policy = {
    discriminator: GOVERNANCE_POLICY_V1_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.policyBump,
    initialized: true,
    controllerConfig: ids.config,
    version: INITIAL_POLICY_VERSION,
    targetProgram: ids.target,
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
    policyHash: ZERO_HASH,
    reserved: Buffer.alloc(21),
  };
  policy.policyHash = governancePolicyHash(policy);
  const council = {
    discriminator: GOVERNANCE_COUNCIL_SET_V1_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.councilBump,
    initialized: true,
    controllerConfig: ids.config,
    version: INITIAL_COUNCIL_VERSION,
    targetProgram: ids.target,
    activationSlot,
    deactivationSlot: 0n,
    seats: ids.seats.map((seatAuthority) => ({
      seatAuthority,
      termStartSlot: activationSlot,
      termEndSlot: U64_MAX,
      active: true,
      reserved: Buffer.alloc(47),
    })),
    routineThreshold: 3,
    terminalThreshold: 4,
    policyFlags: 0,
    setHash: ZERO_HASH,
    reserved: Buffer.alloc(26),
  };
  council.setHash = governanceCouncilSetHash(council);
  const capacityPolicy = buildCapacityPolicy(bundle);
  const commitments = sourceCommitments(bundle);
  const controllerRelease = {
    discriminator: CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR,
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: ids.controllerReleaseBump,
    initialized: true,
    controllerProgram: ids.controller,
    controllerProgramdata: ids.controllerProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    capacityPolicy: ids.capacityPolicy,
    capacityPolicyDigest: capacityPolicy.policyDigest,
    artifactLength: BigInt(bundle.artifact.length),
    artifactSha256: Buffer.from(bundle.descriptor.artifact.sha256, "hex"),
    artifactMerkleRoot: artifactMerkleRoot(bundle.artifact),
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    ...commitments,
    preImmutabilityAuthority: { present: true, value: ids.initializer },
    minimumProgramdataCapacity: BigInt(controllerCapacity),
    releaseDigest: ZERO_HASH,
    creationSlot: 0n,
    finalized: true,
    reserved: Buffer.alloc(CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN),
  };
  controllerRelease.releaseDigest = controllerReleaseDigestV1(controllerRelease);
  return {
    activationSlot,
    clusterDomain: clusterDomainFromGenesisHashV1(EXPECTED_GENESIS),
    seatTerms,
    policy,
    council,
    capacityPolicy,
    controllerRelease,
  };
}

function tag53Instruction(bundle, model) {
  const { ids } = bundle;
  return buildInitializeControllerV2Instruction(ids.controller, {
    payer: ids.payer,
    initializer: ids.initializer,
    controllerProgram: ids.controller,
    controllerProgramdata: ids.controllerProgramdata,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerConfig: ids.config,
    authorityPda: ids.authority,
    protocolGate: ids.gate,
    policy: ids.policy,
    council: ids.council,
    capacityPolicy: ids.capacityPolicy,
    controllerRelease: ids.controllerRelease,
    canonicalSpillTreasury: ids.treasury,
    guardian: ids.guardian,
    seatAuthorities: ids.seats,
    systemProgram: SystemProgram.programId,
  }, {
    clusterDomain: model.clusterDomain,
    initialPolicyVersion: INITIAL_POLICY_VERSION,
    initialCouncilVersion: INITIAL_COUNCIL_VERSION,
    nextProposalId: INITIAL_NEXT_PROPOSAL_ID,
    targetNonce: INITIAL_TARGET_NONCE,
    initialGateEpoch: INITIAL_GATE_EPOCH,
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

function expectedNominalProfile(bundle, creationSlot = 1n) {
  const profile = nominalGovernanceTimingProfileV1({
    bump: bundle.ids.timingProfileBump,
    controllerConfig: bundle.ids.config,
    targetProgram: bundle.ids.target,
    creationCouncilVersion: INITIAL_COUNCIL_VERSION,
    creationSlot,
  });
  const expectedHash = Buffer.from(bundle.descriptor.governanceLivenessV2.initialTimingProfileHash, "hex");
  assert(profile.profileHash.equals(expectedHash), "descriptor initial timing profile hash changed");
  return profile;
}

function tag82Instruction(bundle) {
  expectedNominalProfile(bundle);
  const { ids } = bundle;
  return buildInitializeGovernanceLifecycleRegistryV2Instruction(ids.controller, {
    payer: ids.payer,
    initializer: ids.initializer,
    controllerProgram: ids.controller,
    controllerProgramdata: ids.controllerProgramdata,
    controllerConfig: ids.config,
    governancePolicy: ids.policy,
    council: ids.council,
    protocolGate: ids.gate,
    lifecycleRegistry: ids.lifecycleRegistry,
    initialTimingProfile: ids.timingProfile,
    systemProgram: SystemProgram.programId,
  }, {
    expectedInitialTimingProfileVersion: INITIAL_POLICY_VERSION,
    expectedInitialTimingProfileHash: Buffer.from(bundle.descriptor.governanceLivenessV2.initialTimingProfileHash, "hex"),
    expectedInitialNextProposalId: INITIAL_NEXT_PROPOSAL_ID,
    expectedInitialRotationNonce: INITIAL_ROTATION_NONCE,
  });
}

function setAuthorityFinalInstruction(ids) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4, 0);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: ids.controllerProgramdata, isSigner: false, isWritable: true },
      { pubkey: ids.initializer, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function loaderProgramdata(data, label) {
  assert(Buffer.isBuffer(data) && data.length >= PROGRAMDATA_HEADER_BYTES, `${label} is truncated`);
  assert.equal(data.readUInt32LE(0), 3, `${label} is not Upgradeable Loader ProgramData`);
  const deployedSlot = data.readBigUInt64LE(4);
  const option = data[12];
  assert(option === 0 || option === 1, `${label} authority option is malformed`);
  const authority = option === 0 ? null : new PublicKey(data.subarray(13, 45));
  return { deployedSlot, authority, payload: data.subarray(PROGRAMDATA_HEADER_BYTES) };
}

async function readAccount(connection, key, minContextSlot, label) {
  const response = await connection.getAccountInfoAndContext(key, {
    commitment: "finalized",
    minContextSlot,
  });
  assert(response.context.slot >= minContextSlot, `${label} read predates its minimum context slot`);
  return { account: response.value, slot: response.context.slot };
}

async function assertVacant(connection, keys, minContextSlot, label) {
  for (const key of keys) {
    const value = await readAccount(connection, key, minContextSlot, `${label}:${key.toBase58()}`);
    assert.equal(value.account, null, `${label} account ${key.toBase58()} already exists`);
  }
}

async function readControllerGraph(connection, bundle, minContextSlot, expectedAuthority) {
  const { ids, descriptor, artifact } = bundle;
  const programRead = await readAccount(connection, ids.controller, minContextSlot, "controller Program");
  assert(programRead.account, "controller Program is absent");
  assert(programRead.account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "controller Program owner changed");
  assert.equal(programRead.account.executable, true, "controller Program is not executable");
  assert.equal(programRead.account.data.length, CONTROLLER_PROGRAM_RAW_BYTES, "controller Program length changed");
  assert.equal(programRead.account.data.readUInt32LE(0), 2, "controller Program variant changed");
  assert(new PublicKey(programRead.account.data.subarray(4, 36)).equals(ids.controllerProgramdata), "controller ProgramData link changed");
  const programdataRead = await readAccount(connection, ids.controllerProgramdata, programRead.slot, "controller ProgramData");
  assert(programdataRead.account, "controller ProgramData is absent");
  assert(programdataRead.account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "controller ProgramData owner changed");
  assert.equal(programdataRead.account.executable, false, "controller ProgramData is executable");
  assert.equal(programdataRead.account.data.length, descriptor.artifact.programDataRawBytes, "controller ProgramData length changed");
  const decoded = loaderProgramdata(programdataRead.account.data, "controller ProgramData");
  if (expectedAuthority === null) {
    assert.equal(decoded.authority, null, "controller remains upgradeable");
  } else {
    assert(decoded.authority?.equals(expectedAuthority), "controller upgrade authority changed");
  }
  assert.equal(decoded.payload.length, descriptor.artifact.bytes, "controller deployed payload capacity changed");
  assert(decoded.payload.equals(artifact), "controller deployed payload differs from the descriptor artifact");
  assert.equal(sha256Hex(decoded.payload), descriptor.artifact.sha256, "controller deployed payload SHA-256 changed");
  return {
    slot: programdataRead.slot,
    deployedSlot: decoded.deployedSlot.toString(),
    authority: decoded.authority?.toBase58() ?? null,
    capacity: decoded.payload.length,
    rawBytes: programdataRead.account.data.length,
    rawSha256: sha256Hex(programdataRead.account.data),
    payloadSha256: sha256Hex(decoded.payload),
  };
}

async function readTargetGraph(connection, bundle, minContextSlot) {
  const { ids } = bundle;
  const programRead = await readAccount(connection, ids.target, minContextSlot, "target Program");
  assert(programRead.account, "target Program is absent");
  assert(programRead.account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "target Program owner changed");
  assert.equal(programRead.account.executable, true, "target Program is not executable");
  assert.equal(programRead.account.data.length, CONTROLLER_PROGRAM_RAW_BYTES, "target Program length changed");
  assert.equal(programRead.account.data.readUInt32LE(0), 2, "target Program variant changed");
  assert(new PublicKey(programRead.account.data.subarray(4, 36)).equals(ids.targetProgramdata), "target ProgramData link changed");
  const programdataRead = await readAccount(connection, ids.targetProgramdata, programRead.slot, "target ProgramData");
  assert(programdataRead.account, "target ProgramData is absent");
  assert(programdataRead.account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "target ProgramData owner changed");
  assert.equal(programdataRead.account.executable, false, "target ProgramData is executable");
  const decoded = loaderProgramdata(programdataRead.account.data, "target ProgramData");
  assert(decoded.authority?.equals(ids.legacyTargetAuthority), "target authority is not the descriptor legacy authority");
  return {
    slot: programdataRead.slot,
    deployedSlot: decoded.deployedSlot.toString(),
    authority: decoded.authority.toBase58(),
    capacity: decoded.payload.length,
    rawBytes: programdataRead.account.data.length,
    rawSha256: sha256Hex(programdataRead.account.data),
    payloadSha256: sha256Hex(decoded.payload),
  };
}

function stableLoaderGraph(graph) {
  const { slot: _slot, ...stable } = graph;
  return stable;
}

function assertControllerOwned(account, controller, expectedLength, label) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(controller), `${label} owner changed`);
  assert.equal(account.executable, false, `${label} is executable`);
  assert.equal(account.data.length, expectedLength, `${label} length changed`);
}

async function readBootstrapAccounts(connection, bundle, minContextSlot, includeV2) {
  const { ids } = bundle;
  const definitions = [
    ["config", ids.config, CONTROLLER_CONFIG_LEN],
    ["gate", ids.gate, PROTOCOL_GATE_LEN],
    ["policy", ids.policy, GOVERNANCE_POLICY_LEN],
    ["council", ids.council, GOVERNANCE_COUNCIL_SET_LEN],
    ["capacityPolicy", ids.capacityPolicy, PROGRAMDATA_CAPACITY_POLICY_V1_LEN],
    ["controllerRelease", ids.controllerRelease, CONTROLLER_RELEASE_COMMITMENT_V1_LEN],
  ];
  if (includeV2) {
    definitions.push(
      ["lifecycleRegistry", ids.lifecycleRegistry, GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN],
      ["timingProfile", ids.timingProfile, GOVERNANCE_TIMING_PROFILE_V1_LEN],
    );
  }
  const result = {};
  let slot = minContextSlot;
  for (const [name, key, length] of definitions) {
    const read = await readAccount(connection, key, slot, name);
    assertControllerOwned(read.account, ids.controller, length, name);
    result[name] = read.account.data;
    slot = Math.max(slot, read.slot);
  }
  return { bytes: result, slot };
}

function validateTag53Decoded(bundle, bytes) {
  const { ids } = bundle;
  const config = deserializeControllerConfigV1(bytes.config);
  assert(config.discriminator.equals(CONTROLLER_CONFIG_V1_DISCRIMINATOR));
  assert(config.targetProgram.equals(ids.target));
  assert(config.targetProgramdata.equals(ids.targetProgramdata));
  assert(config.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID));
  assert(config.authorityPda.equals(ids.authority));
  assert(config.gatePda.equals(ids.gate));
  assert(config.canonicalSpillTreasury.equals(ids.treasury));
  assert.equal(config.currentCouncilVersion, INITIAL_COUNCIL_VERSION);
  assert.equal(config.currentPolicyVersion, INITIAL_POLICY_VERSION);
  assert.equal(config.nextProposalId, INITIAL_NEXT_PROPOSAL_ID);
  assert.equal(config.targetNonce, INITIAL_TARGET_NONCE);
  assert(config.guardian.equals(ids.guardian));
  assert.equal(config.tokenGovernanceEnabled, false);
  assert(config.voteProgram.equals(PublicKey.default));
  assert(config.voteProgramdata.equals(PublicKey.default));
  assert(config.voteConfig.equals(PublicKey.default));
  assert(config.voteMint.equals(PublicKey.default));
  const gate = deserializeProtocolGateV1(bytes.gate);
  assert(gate.discriminator.equals(PROTOCOL_GATE_DISCRIMINATOR));
  assert.equal(gate.status, 2, "bootstrap gate is not EmergencyFrozen");
  assert.equal(gate.epoch, INITIAL_GATE_EPOCH);
  assert(gate.activeProposal.equals(PublicKey.default));
  assert(gate.freezeSlot > 0n);
  assert.equal(gate.freezeReasonCode, 1);
  const policy = deserializeGovernancePolicyFixedV1(bytes.policy);
  assert(policy.controllerConfig.equals(ids.config));
  assert(policy.targetProgram.equals(ids.target));
  assert.equal(policy.version, INITIAL_POLICY_VERSION);
  assert.equal(policy.routineThreshold, 3);
  assert.equal(policy.terminalThreshold, 4);
  assert.equal(policy.governanceMode, 0);
  assert(policy.policyHash.equals(governancePolicyHash(policy)), "governance policy hash changed");
  const council = deserializeGovernanceCouncilSetFixedV1(bytes.council);
  assert(council.controllerConfig.equals(ids.config));
  assert(council.targetProgram.equals(ids.target));
  assert.equal(council.version, INITIAL_COUNCIL_VERSION);
  assert.deepEqual(council.seats.map((seat) => seat.seatAuthority.toBase58()), ids.seats.map((seat) => seat.toBase58()));
  assert.equal(council.routineThreshold, 3);
  assert.equal(council.terminalThreshold, 4);
  assert(council.setHash.equals(governanceCouncilSetHash(council)), "governance council hash changed");
  const capacityPolicy = deserializeProgramDataCapacityPolicyV1(bytes.capacityPolicy);
  validateProgramDataCapacityPolicyDigestV1(capacityPolicy);
  assert(capacityPolicy.controllerProgram.equals(ids.controller));
  assert(capacityPolicy.controllerConfig.equals(ids.config));
  assert(capacityPolicy.targetProgram.equals(ids.target));
  assert(capacityPolicy.targetProgramdata.equals(ids.targetProgramdata));
  const controllerRelease = deserializeControllerReleaseCommitmentV1(bytes.controllerRelease);
  validateControllerReleaseDigestV1(controllerRelease);
  assert(controllerRelease.controllerProgram.equals(ids.controller));
  assert(controllerRelease.controllerProgramdata.equals(ids.controllerProgramdata));
  assert.equal(controllerRelease.artifactLength, BigInt(bundle.descriptor.artifact.bytes));
  assert(controllerRelease.artifactSha256.equals(Buffer.from(bundle.descriptor.artifact.sha256, "hex")));
  assert(controllerRelease.artifactMerkleRoot.equals(artifactMerkleRoot(bundle.artifact)));
  assert(controllerRelease.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID));
  assert(controllerRelease.preImmutabilityAuthority.present);
  assert(controllerRelease.preImmutabilityAuthority.value.equals(ids.initializer));
  assert.equal(gate.freezeSlot, capacityPolicy.creationSlot, "capacity policy creation slot differs from the bootstrap slot");
  assert.equal(gate.freezeSlot, controllerRelease.creationSlot, "controller release creation slot differs from the bootstrap slot");
  const model = buildTag53Model(bundle, policy.activationSlot, bundle.descriptor.artifact.bytes);
  const expectedConfig = {
    discriminator: CONTROLLER_CONFIG_V1_DISCRIMINATOR,
    version: 1,
    bump: ids.configBump,
    initialized: true,
    clusterDomain: model.clusterDomain,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    authorityPda: ids.authority,
    gatePda: ids.gate,
    canonicalSpillTreasury: ids.treasury,
    currentCouncilVersion: INITIAL_COUNCIL_VERSION,
    currentPolicyVersion: INITIAL_POLICY_VERSION,
    nextProposalId: INITIAL_NEXT_PROPOSAL_ID,
    targetNonce: INITIAL_TARGET_NONCE,
    guardian: ids.guardian,
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
  const expectedGate = {
    discriminator: PROTOCOL_GATE_DISCRIMINATOR,
    accountVersion: 1,
    bump: ids.gateBump,
    initialized: true,
    status: 2,
    controllerConfig: ids.config,
    targetProgram: ids.target,
    targetProgramdata: ids.targetProgramdata,
    epoch: INITIAL_GATE_EPOCH,
    activeProposal: PublicKey.default,
    freezeSlot: gate.freezeSlot,
    freezeReasonCode: 1,
    lastCompletedProposal: PublicKey.default,
    reserved: Buffer.alloc(2),
  };
  assert(bytes.config.equals(serializeControllerConfigV1(expectedConfig)), "controller config differs from exact tag53 initialization");
  assert(bytes.gate.equals(serializeProtocolGateV1(expectedGate)), "protocol gate differs from exact tag53 initialization");
  assert(bytes.policy.equals(serializeGovernancePolicyFixedV1(model.policy)), "governance policy differs from exact tag53 initialization");
  assert(bytes.council.equals(serializeGovernanceCouncilSetFixedV1(model.council)), "governance council differs from exact tag53 initialization");
  assert(bytes.capacityPolicy.equals(serializeProgramDataCapacityPolicyV1({
    ...model.capacityPolicy,
    creationSlot: gate.freezeSlot,
  })), "capacity policy differs from exact tag53 initialization");
  assert(bytes.controllerRelease.equals(serializeControllerReleaseCommitmentV1({
    ...model.controllerRelease,
    creationSlot: gate.freezeSlot,
  })), "controller release differs from exact tag53 initialization");
  return { config, gate, policy, council, capacityPolicy, controllerRelease };
}

function validateTag82Decoded(bundle, decodedTag53, bytes) {
  const registry = deserializeGovernanceLifecycleRegistryV2(bytes.lifecycleRegistry);
  const profile = deserializeGovernanceTimingProfileV1(bytes.timingProfile);
  validateGovernanceLifecycleRegistryV2(registry);
  validateGovernanceTimingProfileV1(profile);
  assert(registry.controllerProgram.equals(bundle.ids.controller));
  assert.equal(registry.bump, bundle.ids.lifecycleRegistryBump);
  assert(registry.controllerConfig.equals(bundle.ids.config));
  assert(registry.targetProgram.equals(bundle.ids.target));
  assert(registry.currentTimingProfile.equals(bundle.ids.timingProfile));
  assert.equal(registry.currentTimingProfileVersion, 1n);
  assert.equal(registry.nextProposalId, decodedTag53.config.nextProposalId);
  assert.equal(registry.nextTimingProfileVersion, 2n);
  assert.equal(registry.rotationNonce, 1n);
  assert(registry.lastPolicyChangeProposal.equals(PublicKey.default));
  assert(profile.controllerConfig.equals(bundle.ids.config));
  assert.equal(profile.bump, bundle.ids.timingProfileBump);
  assert(profile.targetProgram.equals(bundle.ids.target));
  assert.equal(profile.profileVersion, 1n);
  assert(profile.predecessorProfile.equals(PublicKey.default));
  assert(profile.predecessorProfileHash.equals(ZERO_HASH));
  assert.equal(profile.finalized, true);
  assert.equal(profile.creationCouncilVersion, decodedTag53.council.version);
  assert.equal(profile.creationSlot, registry.creationSlot);
  const expectedHash = Buffer.from(bundle.descriptor.governanceLivenessV2.initialTimingProfileHash, "hex");
  assert(profile.profileHash.equals(expectedHash));
  assert(registry.currentTimingProfileHash.equals(expectedHash));
  assert(governanceTimingProfileHashV1(profile).equals(expectedHash));
  return { registry, profile };
}

async function verifyBootstrapState(connection, bundle, minContextSlot, authorityMode) {
  const graph = await readControllerGraph(connection, bundle, minContextSlot, authorityMode === "initializer" ? bundle.ids.initializer : null);
  const target = await readTargetGraph(connection, bundle, graph.slot);
  const accounts = await readBootstrapAccounts(connection, bundle, target.slot, true);
  const tag53 = validateTag53Decoded(bundle, accounts.bytes);
  const tag82 = validateTag82Decoded(bundle, tag53, accounts.bytes);
  return {
    observedSlot: accounts.slot,
    controller: graph,
    target,
    gate: {
      status: tag53.gate.status,
      epoch: tag53.gate.epoch.toString(),
      freezeSlot: tag53.gate.freezeSlot.toString(),
      freezeReasonCode: tag53.gate.freezeReasonCode,
    },
    policyHash: tag53.policy.policyHash.toString("hex"),
    councilHash: tag53.council.setHash.toString("hex"),
    lifecycleRegistry: bundle.ids.lifecycleRegistry.toBase58(),
    timingProfile: bundle.ids.timingProfile.toBase58(),
    timingProfileHash: tag82.profile.profileHash.toString("hex"),
    nextProposalId: tag82.registry.nextProposalId.toString(),
    rotationNonce: tag82.registry.rotationNonce.toString(),
  };
}

async function rpcContext(bundle, journal, scope) {
  const rpc = await loadDevnetRpcConfiguration();
  const connection = guardRpcConnection(
    new Connection(rpc.stateRpcUrl, { commitment: "finalized" }),
    journal,
    scope,
  );
  const genesisHash = await connection.getGenesisHash();
  assert.equal(genesisHash, bundle.descriptor.cluster.genesisHash, "RPC genesis changed");
  const observedSlot = await connection.getSlot("finalized");
  requirePositiveSafeInteger(observedSlot, "finalized observation slot");
  return { connection, observedSlot, rpcSelection: rpc.rpcSelection, rpcOrigin: rpc.stateRpcOrigin };
}

function planningJournalId(bundle, action) {
  return operationId({
    schema: "ameba-governance-devnet-controller-v2-planning-session-v1",
    descriptorSha256: bundle.descriptorSha256,
    action,
  });
}

async function withPlanning(bundle, action, callback) {
  const id = planningJournalId(bundle, action);
  const journal = await openJournal(bundle.runDir, `governance-v2-plan-${action}-${id.slice(0, 12)}`, id);
  try {
    const context = await rpcContext(bundle, journal, `governance-v2-plan-${action}`);
    return await callback(context, journal);
  } finally {
    await journal.close();
  }
}

async function writePlan(bundle, action, observedSlot, validUntilSlot, details) {
  const material = {
    schema: PLAN_SCHEMA,
    descriptorSha256: bundle.descriptorSha256,
    action,
    genesisHash: EXPECTED_GENESIS,
    observedSlot,
    validUntilSlot,
    details,
  };
  const plan = { ...material, operationId: operationId(material) };
  assertExactKeys(plan, PLAN_KEYS, "governance V2 plan");
  const file = path.join(bundle.runDir, `governance-v2-${action}-plan-${plan.operationId}.json`);
  await writeExclusiveJson(file, plan);
  process.stdout.write(`${JSON.stringify({ planFile: file, plan }, null, 2)}\n`);
  return { file, plan };
}

async function readExecutionPlan(bundle, expectedAction) {
  const configured = process.env.AMEBA_GOVERNANCE_V2_PLAN?.trim();
  assert(configured, "AMEBA_GOVERNANCE_V2_PLAN is required");
  const file = await requireSecureRegularFile(configured, "governance V2 plan");
  assert.equal(path.dirname(file), bundle.runDir, "plan must be inside the descriptor run directory");
  const raw = await readFile(file);
  const plan = JSON.parse(raw.toString("utf8"));
  assertExactKeys(plan, PLAN_KEYS, "governance V2 plan");
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.descriptorSha256, bundle.descriptorSha256);
  assert.equal(plan.action, expectedAction);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  requirePositiveSafeInteger(plan.observedSlot, "plan observed slot");
  requirePositiveSafeInteger(plan.validUntilSlot, "plan validity slot");
  assert(plan.validUntilSlot >= plan.observedSlot, "plan validity predates its observation");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(storedOperationId, operationId(material), "plan operation ID changed");
  const planSha256 = sha256Hex(raw);
  const expectedArm = `${expectedAction}:${storedOperationId}:${planSha256}`;
  assert.equal(
    process.env.AMEBA_GOVERNANCE_V2_ARM,
    expectedArm,
    `explicit arming required: AMEBA_GOVERNANCE_V2_ARM=${expectedArm}`,
  );
  return { file, plan, planSha256 };
}

function dummyPacket(ids, instructions, lookups = []) {
  const message = new TransactionMessage({
    payerKey: ids.payer,
    recentBlockhash: EXPECTED_GENESIS,
    instructions,
  }).compileToV0Message(lookups);
  const transaction = new VersionedTransaction(message);
  const packetBytes = transaction.serialize().length;
  assert(packetBytes <= MAX_PACKET_BYTES, `transaction packet is ${packetBytes} bytes`);
  return { messageSha256: sha256Hex(Buffer.from(message.serialize())), packetBytes };
}

async function readAltReceipt(bundle, environmentName, expectedAction) {
  const configured = process.env[environmentName]?.trim();
  assert(configured, `${environmentName} is required`);
  const file = await requireSecureRegularFile(configured, `${expectedAction} receipt`);
  assert.equal(path.dirname(file), bundle.runDir, `${expectedAction} receipt must be inside the run directory`);
  const raw = await readFile(file);
  const receipt = JSON.parse(raw.toString("utf8"));
  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.action, expectedAction);
  assert.equal(receipt.descriptorSha256, bundle.descriptorSha256);
  assert(typeof receipt.lookupTable === "string", `${expectedAction} receipt lookup table is absent`);
  return { file, receipt, sha256: sha256Hex(raw), lookupTable: new PublicKey(receipt.lookupTable) };
}

async function readLookup(connection, address, minContextSlot, expectedAuthority, expectedAddresses = null) {
  const result = await connection.getAddressLookupTable(address, {
    commitment: "finalized",
    minContextSlot,
  });
  assert(result.context.slot >= minContextSlot, "ALT read predates minimum context slot");
  assert(result.value, "ALT is absent");
  assert(result.value.state.authority?.equals(expectedAuthority), "ALT authority changed");
  assert(result.value.isActive(), "ALT is inactive");
  if (expectedAddresses !== null) {
    assert.deepEqual(
      result.value.state.addresses.map((entry) => entry.toBase58()),
      expectedAddresses.map((entry) => entry.toBase58()),
      "ALT addresses changed",
    );
  }
  return { value: result.value, slot: result.context.slot };
}

async function writeReceipt(bundle, action, executionPlan, fields) {
  const receipt = {
    schema: RECEIPT_SCHEMA,
    descriptorSha256: bundle.descriptorSha256,
    action,
    operationId: executionPlan.plan.operationId,
    planFile: path.basename(executionPlan.file),
    planSha256: executionPlan.planSha256,
    genesisHash: EXPECTED_GENESIS,
    ...fields,
  };
  const file = path.join(bundle.runDir, `governance-v2-${action}-receipt-${executionPlan.plan.operationId}.json`);
  try {
    await writeExclusiveJson(file, receipt);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse((await readFile(await requireSecureRegularFile(file, `${action} receipt`), "utf8")));
    assert.deepEqual(existing, receipt, `${action} receipt changed`);
  }
  process.stdout.write(`${JSON.stringify({ receiptFile: file, receipt }, null, 2)}\n`);
  return { file, receipt };
}

async function readExistingReceipt(bundle, action, executionPlan) {
  const file = path.join(bundle.runDir, `governance-v2-${action}-receipt-${executionPlan.plan.operationId}.json`);
  try {
    const secure = await requireSecureRegularFile(file, `${action} receipt`);
    const receipt = JSON.parse(await readFile(secure, "utf8"));
    assert.equal(receipt.schema, RECEIPT_SCHEMA);
    assert.equal(receipt.descriptorSha256, bundle.descriptorSha256);
    assert.equal(receipt.action, action);
    assert.equal(receipt.operationId, executionPlan.plan.operationId);
    assert.equal(receipt.planSha256, executionPlan.planSha256);
    process.stdout.write(`${JSON.stringify({ receiptFile: file, receipt, alreadyComplete: true }, null, 2)}\n`);
    return { file, receipt };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function stableBootstrapStateHash(state) {
  const { observedSlot: _observedSlot, controller, target, ...rest } = state;
  const { slot: _readSlot, ...stableController } = controller;
  const { slot: _targetReadSlot, ...stableTarget } = target;
  return sha256Hex(Buffer.from(JSON.stringify({ ...rest, controller: stableController, target: stableTarget }), "utf8"));
}

async function validateCliKeypair(file, expected, label) {
  const signer = await loadSecureKeypair(file, expected, label);
  signer.secretKey.fill(0);
}

async function planDeploy() {
  const bundle = await loadBundle();
  return withPlanning(bundle, "deploy", async ({ connection, observedSlot }) => {
    await assertVacant(connection, [bundle.ids.controller, bundle.ids.controllerProgramdata, bundle.ids.deployBuffer], observedSlot, "fresh deployment");
    const cli = await solanaCliFacts();
    return writePlan(bundle, "deploy", observedSlot, observedSlot + PLAN_TTL_SLOTS, {
      controllerProgram: bundle.ids.controller.toBase58(),
      controllerProgramdata: bundle.ids.controllerProgramdata.toBase58(),
      deployBuffer: bundle.ids.deployBuffer.toBase58(),
      payer: bundle.ids.payer.toBase58(),
      initializer: bundle.ids.initializer.toBase58(),
      artifactFile: bundle.descriptor.artifact.file,
      artifactBytes: bundle.descriptor.artifact.bytes,
      artifactSha256: bundle.descriptor.artifact.sha256,
      programDataRawBytes: bundle.descriptor.artifact.programDataRawBytes,
      bufferRawBytes: bundle.descriptor.artifact.bufferRawBytes,
      sbpfArchitecture: bundle.descriptor.artifact.sbpfArchitecture,
      maxSignAttempts: 1,
      solanaCli: cli,
    });
  });
}

async function classifyDeploymentPrestate(connection, bundle, minContextSlot) {
  const program = await readAccount(connection, bundle.ids.controller, minContextSlot, "controller deployment prestate Program");
  const programdata = await readAccount(connection, bundle.ids.controllerProgramdata, program.slot, "controller deployment prestate ProgramData");
  const buffer = await readAccount(connection, bundle.ids.deployBuffer, programdata.slot, "controller deployment prestate buffer");
  if (program.account !== null) {
    assert(programdata.account !== null, "partial controller deployment: Program exists without ProgramData");
    assert.equal(buffer.account, null, "partial controller deployment: exact Program exists but deploy buffer remains");
    const graph = await readControllerGraph(connection, bundle, buffer.slot, bundle.ids.initializer);
    return { kind: "exact-deployed", graph };
  }
  assert.equal(programdata.account, null, "partial controller deployment: ProgramData exists without Program");
  assert.equal(buffer.account, null, "partial controller deployment: deploy buffer exists without Program");
  return { kind: "vacant", slot: buffer.slot };
}

async function solanaCliFacts() {
  const configured = process.env.AMEBA_SOLANA_CLI?.trim() || "/home/space/.local/share/solana/install/active_release/bin/solana";
  const resolved = await realpath(configured);
  const status = await lstat(resolved);
  assert(status.isFile() && !status.isSymbolicLink(), "Solana CLI must resolve to a regular file");
  assert((status.mode & 0o022) === 0, "Solana CLI must not be group/other writable");
  const version = spawnSync(resolved, ["--version"], {
    encoding: "utf8",
    env: sanitizedChildEnvironment(),
    timeout: 30_000,
  });
  assert.equal(version.status, 0, "Solana CLI version check failed");
  const stdout = version.stdout.trim();
  assert(/^solana-cli [0-9]+\.[0-9]+\.[0-9]+/u.test(stdout), "Solana CLI version output changed");
  return { executable: resolved, executableSha256: sha256Hex(await readFile(resolved)), version: stdout };
}

function sanitizedChildEnvironment() {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const result = {};
  for (const key of allowed) if (process.env[key] !== undefined) result[key] = process.env[key];
  return result;
}

async function executeDeploy() {
  const bundle = await loadBundle();
  const selected = await readExecutionPlan(bundle, "deploy");
  const existingReceipt = await readExistingReceipt(bundle, "deploy", selected);
  if (existingReceipt) return existingReceipt;
  return withExecutionLock(bundle.runDir, `governance-v2-deploy-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId, async () => (
    withCeremonyRpcOwnerLock(bundle.runDir, selected.plan.operationId, async () => {
      const journal = await openJournal(bundle.runDir, `governance-v2-deploy-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId);
      try {
        const { connection, observedSlot, rpcSelection } = await rpcContext(bundle, journal, "governance-v2-execute-deploy");
        assert(observedSlot >= selected.plan.observedSlot, "deployment RPC context predates the plan");
        const deploymentPrestate = await classifyDeploymentPrestate(connection, bundle, selected.plan.observedSlot);
        if (deploymentPrestate.kind === "exact-deployed") {
          await journal.append("recovered-exact-poststate", {
            controllerProgram: bundle.ids.controller.toBase58(),
            payloadSha256: deploymentPrestate.graph.payloadSha256,
            automaticResubmission: false,
          });
          return writeReceipt(bundle, "deploy", selected, {
            recoveredFromExactFinalizedPoststate: true,
            finalizedObservationSlot: deploymentPrestate.graph.slot,
            controller: deploymentPrestate.graph,
          });
        }
        assert(observedSlot <= selected.plan.validUntilSlot, "deployment plan expired");
        const cli = await solanaCliFacts();
        assert.deepEqual(cli, selected.plan.details.solanaCli, "Solana CLI changed after planning");
        const files = {
          payer: path.join(bundle.runDir, KEYPAIR_FILES.payer),
          initializer: path.join(bundle.runDir, KEYPAIR_FILES.initializer),
          program: path.join(bundle.runDir, KEYPAIR_FILES.program),
          buffer: path.join(bundle.runDir, KEYPAIR_FILES.buffer),
        };
        await validateCliKeypair(files.payer, bundle.ids.payer, "fee payer");
        await validateCliKeypair(files.initializer, bundle.ids.initializer, "initializer");
        await validateCliKeypair(files.program, bundle.ids.controller, "controller program");
        await validateCliKeypair(files.buffer, bundle.ids.deployBuffer, "controller buffer");
        const rpc = await loadDevnetRpcConfiguration();
        const temporary = await mkdtemp(path.join(bundle.runDir, ".governance-v2-solana-cli-"));
        await chmod(temporary, 0o700);
        const configFile = path.join(temporary, "config.json");
        await writeFile(configFile, `${JSON.stringify({
          json_rpc_url: rpc.stateRpcUrl,
          websocket_url: "",
          keypair_path: files.initializer,
          address_labels: {},
          commitment: "finalized",
        })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        const args = [
          "program", "deploy",
          "--config", configFile,
          "--use-rpc",
          "--commitment", "finalized",
          "--output", "json-compact",
          "--max-sign-attempts", "1",
          "--no-auto-extend",
          "--max-len", String(bundle.descriptor.artifact.bytes),
          "--program-id", files.program,
          "--buffer", files.buffer,
          "--upgrade-authority", files.initializer,
          "--fee-payer", files.payer,
          "--keypair", files.initializer,
          bundle.artifactFile,
        ];
        const decodedAction = {
          action: "fresh-controller-deploy",
          controllerProgram: bundle.ids.controller.toBase58(),
          controllerProgramdata: bundle.ids.controllerProgramdata.toBase58(),
          buffer: bundle.ids.deployBuffer.toBase58(),
          artifactSha256: bundle.descriptor.artifact.sha256,
          artifactBytes: bundle.descriptor.artifact.bytes,
          maxSignAttempts: 1,
          rpcSelection,
        };
        process.stdout.write(`${JSON.stringify({ decodedAction }, null, 2)}\n`);
        await journal.append("decoded-action", decodedAction);
        await journal.append("cli-started", {
          cliSha256: cli.executableSha256,
          cliVersion: cli.version,
          argumentsSha256: sha256Hex(Buffer.from(JSON.stringify(args.map((entry) => path.basename(entry) || entry)), "utf8")),
          maximumProcessInvocations: 1,
        });
        let result;
        try {
          result = spawnSync(cli.executable, args, {
            cwd: bundle.runDir,
            encoding: "utf8",
            env: sanitizedChildEnvironment(),
            timeout: 45 * 60_000,
            maxBuffer: 4 * 1024 * 1024,
          });
        } finally {
          await rm(temporary, { recursive: true, force: false });
        }
        await journal.append("cli-finished", {
          exitCode: result.status,
          signal: result.signal,
          stdoutSha256: sha256Hex(Buffer.from(result.stdout ?? "", "utf8")),
          stderrSha256: sha256Hex(Buffer.from(result.stderr ?? "", "utf8")),
        });
        assert.equal(result.error, undefined, "Solana CLI deployment failed to launch");
        assert.equal(result.status, 0, "Solana CLI deployment failed; no automatic retry is permitted");
        let cliReceipt;
        try {
          cliReceipt = JSON.parse(result.stdout.trim());
        } catch {
          throw new Error("Solana CLI deployment did not return JSON");
        }
        assert.equal(cliReceipt.programId, bundle.ids.controller.toBase58(), "Solana CLI returned a different program ID");
        const postSlot = await connection.getSlot("finalized");
        const graph = await readControllerGraph(connection, bundle, postSlot, bundle.ids.initializer);
        const buffer = await readAccount(connection, bundle.ids.deployBuffer, graph.slot, "deploy buffer poststate");
        assert.equal(buffer.account, null, "deployment buffer was not consumed/closed");
        await journal.append("verified", { controllerProgram: bundle.ids.controller.toBase58(), observedSlot: graph.slot, payloadSha256: graph.payloadSha256 });
        return writeReceipt(bundle, "deploy", selected, {
          finalizedObservationSlot: graph.slot,
          controller: graph,
          cliOutputSha256: sha256Hex(Buffer.from(result.stdout, "utf8")),
        });
      } finally {
        await journal.close();
      }
    })
  ));
}

async function planAltCreate() {
  const bundle = await loadBundle();
  return withPlanning(bundle, "alt-create", async ({ connection, observedSlot }) => {
    await readControllerGraph(connection, bundle, observedSlot, bundle.ids.initializer);
    const [instruction, lookupTable] = AddressLookupTableProgram.createLookupTable({
      authority: bundle.ids.payer,
      payer: bundle.ids.payer,
      recentSlot: observedSlot,
    });
    const packet = dummyPacket(bundle.ids, [instruction]);
    return writePlan(bundle, "alt-create", observedSlot, observedSlot + 200, {
      lookupTable: lookupTable.toBase58(),
      authority: bundle.ids.payer.toBase58(),
      recentSlot: observedSlot,
      instructions: [instructionManifest(instruction)],
      ...packet,
    });
  });
}

async function planAltExtend() {
  const bundle = await loadBundle();
  const created = await readAltReceipt(bundle, "AMEBA_GOVERNANCE_V2_ALT_CREATE_RECEIPT", "alt-create");
  return withPlanning(bundle, "alt-extend", async ({ connection, observedSlot }) => {
    const lookup = await readLookup(connection, created.lookupTable, observedSlot, bundle.ids.payer, []);
    assert(lookup.slot > lookup.value.state.lastExtendedSlot, "created ALT is not warm enough to extend");
    const addresses = lookupAddresses(bundle.ids);
    const instruction = AddressLookupTableProgram.extendLookupTable({
      payer: bundle.ids.payer,
      authority: bundle.ids.payer,
      lookupTable: created.lookupTable,
      addresses,
    });
    const packet = dummyPacket(bundle.ids, [instruction]);
    return writePlan(bundle, "alt-extend", observedSlot, observedSlot + PLAN_TTL_SLOTS, {
      createReceiptSha256: created.sha256,
      lookupTable: created.lookupTable.toBase58(),
      authority: bundle.ids.payer.toBase58(),
      addresses: addresses.map((entry) => entry.toBase58()),
      instructions: [instructionManifest(instruction)],
      ...packet,
    });
  });
}

async function planTag53() {
  const bundle = await loadBundle({ evidenceRequired: true });
  const extended = await readAltReceipt(bundle, "AMEBA_GOVERNANCE_V2_ALT_EXTEND_RECEIPT", "alt-extend");
  return withPlanning(bundle, "initialize-tag53", async ({ connection, observedSlot }) => {
    const graph = await readControllerGraph(connection, bundle, observedSlot, bundle.ids.initializer);
    const target = await readTargetGraph(connection, bundle, graph.slot);
    await assertVacant(connection, [bundle.ids.config, bundle.ids.gate, bundle.ids.policy, bundle.ids.council, bundle.ids.capacityPolicy, bundle.ids.controllerRelease], target.slot, "tag53");
    const lookup = await readLookup(connection, extended.lookupTable, target.slot, bundle.ids.payer, lookupAddresses(bundle.ids));
    assert(lookup.slot > lookup.value.state.lastExtendedSlot, "bootstrap ALT is not warm");
    const model = buildTag53Model(bundle, BigInt(observedSlot), graph.capacity);
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000n }),
      tag53Instruction(bundle, model),
    ];
    const packet = dummyPacket(bundle.ids, instructions, [lookup.value]);
    return writePlan(bundle, "initialize-tag53", observedSlot, observedSlot + PLAN_TTL_SLOTS, {
      altExtendReceiptSha256: extended.sha256,
      lookupTable: extended.lookupTable.toBase58(),
      policyActivationSlot: observedSlot,
      controllerCapacity: graph.capacity,
      targetProgramdataState: stableLoaderGraph(target),
      policyHash: model.policy.policyHash.toString("hex"),
      councilHash: model.council.setHash.toString("hex"),
      capacityPolicyDigest: model.capacityPolicy.policyDigest.toString("hex"),
      controllerReleaseDigest: model.controllerRelease.releaseDigest.toString("hex"),
      artifactMerkleRoot: model.controllerRelease.artifactMerkleRoot.toString("hex"),
      instructions: instructions.map(instructionManifest),
      ...packet,
    });
  });
}

async function planTag82() {
  const bundle = await loadBundle({ evidenceRequired: true });
  return withPlanning(bundle, "initialize-tag82", async ({ connection, observedSlot }) => {
    await readControllerGraph(connection, bundle, observedSlot, bundle.ids.initializer);
    const target = await readTargetGraph(connection, bundle, observedSlot);
    const accounts = await readBootstrapAccounts(connection, bundle, target.slot, false);
    validateTag53Decoded(bundle, accounts.bytes);
    await assertVacant(connection, [bundle.ids.lifecycleRegistry, bundle.ids.timingProfile], accounts.slot, "tag82");
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      tag82Instruction(bundle),
    ];
    const packet = dummyPacket(bundle.ids, instructions);
    return writePlan(bundle, "initialize-tag82", observedSlot, observedSlot + PLAN_TTL_SLOTS, {
      lifecycleRegistry: bundle.ids.lifecycleRegistry.toBase58(),
      initialTimingProfile: bundle.ids.timingProfile.toBase58(),
      initialTimingProfileHash: bundle.descriptor.governanceLivenessV2.initialTimingProfileHash,
      instructions: instructions.map(instructionManifest),
      ...packet,
    });
  });
}

async function planAuthorityFinal() {
  const bundle = await loadBundle({ evidenceRequired: true });
  return withPlanning(bundle, "authority-final", async ({ connection, observedSlot }) => {
    const state = await verifyBootstrapState(connection, bundle, observedSlot, "initializer");
    const instructions = [setAuthorityFinalInstruction(bundle.ids)];
    const packet = dummyPacket(bundle.ids, instructions);
    return writePlan(bundle, "authority-final", observedSlot, observedSlot + PLAN_TTL_SLOTS, {
      controllerProgramdata: bundle.ids.controllerProgramdata.toBase58(),
      currentAuthority: bundle.ids.initializer.toBase58(),
      newAuthority: null,
      bootstrapStateSha256: stableBootstrapStateHash(state),
      instructions: instructions.map(instructionManifest),
      ...packet,
    });
  });
}

function instructionsForPlan(bundle, plan, lookup) {
  switch (plan.action) {
    case "alt-create": {
      const [instruction, table] = AddressLookupTableProgram.createLookupTable({
        authority: bundle.ids.payer,
        payer: bundle.ids.payer,
        recentSlot: plan.details.recentSlot,
      });
      assert.equal(table.toBase58(), plan.details.lookupTable);
      return { instructions: [instruction], signers: [bundle.ids.payer], lookups: [] };
    }
    case "alt-extend": {
      const instruction = AddressLookupTableProgram.extendLookupTable({
        payer: bundle.ids.payer,
        authority: bundle.ids.payer,
        lookupTable: new PublicKey(plan.details.lookupTable),
        addresses: plan.details.addresses.map((entry) => new PublicKey(entry)),
      });
      return { instructions: [instruction], signers: [bundle.ids.payer], lookups: [] };
    }
    case "initialize-tag53": {
      assert(lookup, "tag53 lookup is absent");
      const model = buildTag53Model(bundle, BigInt(plan.details.policyActivationSlot), plan.details.controllerCapacity);
      return {
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000n }),
          tag53Instruction(bundle, model),
        ],
        signers: [bundle.ids.payer, bundle.ids.initializer],
        lookups: [lookup],
      };
    }
    case "initialize-tag82":
      return {
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          tag82Instruction(bundle),
        ],
        signers: [bundle.ids.payer, bundle.ids.initializer],
        lookups: [],
      };
    case "authority-final":
      return {
        instructions: [setAuthorityFinalInstruction(bundle.ids)],
        signers: [bundle.ids.payer, bundle.ids.initializer],
        lookups: [],
      };
    default:
      throw new Error(`unsupported transaction action ${plan.action}`);
  }
}

async function verifyActionPrestate(connection, bundle, selected, minContextSlot) {
  const { action, details } = selected.plan;
  if (action === "alt-create") {
    await readControllerGraph(connection, bundle, minContextSlot, bundle.ids.initializer);
    await assertVacant(connection, [new PublicKey(details.lookupTable)], minContextSlot, "ALT create");
    return { slot: minContextSlot };
  }
  if (action === "alt-extend") {
    const lookup = await readLookup(connection, new PublicKey(details.lookupTable), minContextSlot, bundle.ids.payer, []);
    assert(lookup.slot > lookup.value.state.lastExtendedSlot, "ALT is not warm enough to extend");
    return { slot: lookup.slot };
  }
  if (action === "initialize-tag53") {
    const graph = await readControllerGraph(connection, bundle, minContextSlot, bundle.ids.initializer);
    const target = await readTargetGraph(connection, bundle, graph.slot);
    assert.deepEqual(stableLoaderGraph(target), details.targetProgramdataState, "target ProgramData changed after tag53 planning");
    await assertVacant(connection, [bundle.ids.config, bundle.ids.gate, bundle.ids.policy, bundle.ids.council, bundle.ids.capacityPolicy, bundle.ids.controllerRelease], target.slot, "tag53");
    const lookup = await readLookup(connection, new PublicKey(details.lookupTable), target.slot, bundle.ids.payer, lookupAddresses(bundle.ids));
    assert(lookup.slot > lookup.value.state.lastExtendedSlot, "bootstrap ALT is not warm");
    return { slot: lookup.slot, lookup: lookup.value };
  }
  if (action === "initialize-tag82") {
    await readControllerGraph(connection, bundle, minContextSlot, bundle.ids.initializer);
    const target = await readTargetGraph(connection, bundle, minContextSlot);
    const accounts = await readBootstrapAccounts(connection, bundle, target.slot, false);
    validateTag53Decoded(bundle, accounts.bytes);
    await assertVacant(connection, [bundle.ids.lifecycleRegistry, bundle.ids.timingProfile], accounts.slot, "tag82");
    return { slot: accounts.slot };
  }
  if (action === "authority-final") {
    const state = await verifyBootstrapState(connection, bundle, minContextSlot, "initializer");
    assert.equal(stableBootstrapStateHash(state), details.bootstrapStateSha256, "bootstrap state changed after authority plan");
    return { slot: state.observedSlot };
  }
  throw new Error(`unsupported transaction action ${action}`);
}

async function verifyActionPoststate(connection, bundle, selected, minContextSlot) {
  const { action, details } = selected.plan;
  if (action === "alt-create") {
    const lookup = await readLookup(connection, new PublicKey(details.lookupTable), minContextSlot, bundle.ids.payer, []);
    return { observedSlot: lookup.slot, lookupTable: details.lookupTable, addresses: [] };
  }
  if (action === "alt-extend") {
    const expected = details.addresses.map((entry) => new PublicKey(entry));
    const lookup = await readLookup(connection, new PublicKey(details.lookupTable), minContextSlot, bundle.ids.payer, expected);
    return { observedSlot: lookup.slot, lookupTable: details.lookupTable, addresses: details.addresses };
  }
  if (action === "initialize-tag53") {
    const target = await readTargetGraph(connection, bundle, minContextSlot);
    assert.deepEqual(stableLoaderGraph(target), details.targetProgramdataState, "target ProgramData changed across tag53");
    const accounts = await readBootstrapAccounts(connection, bundle, target.slot, false);
    const decoded = validateTag53Decoded(bundle, accounts.bytes);
    assert.equal(decoded.policy.activationSlot.toString(), String(details.policyActivationSlot));
    assert.equal(decoded.policy.policyHash.toString("hex"), details.policyHash);
    assert.equal(decoded.council.setHash.toString("hex"), details.councilHash);
    assert.equal(decoded.capacityPolicy.policyDigest.toString("hex"), details.capacityPolicyDigest);
    assert.equal(decoded.controllerRelease.releaseDigest.toString("hex"), details.controllerReleaseDigest);
    return { observedSlot: accounts.slot, policyHash: details.policyHash, councilHash: details.councilHash };
  }
  if (action === "initialize-tag82") {
    const target = await readTargetGraph(connection, bundle, minContextSlot);
    const accounts = await readBootstrapAccounts(connection, bundle, target.slot, true);
    const tag53 = validateTag53Decoded(bundle, accounts.bytes);
    const tag82 = validateTag82Decoded(bundle, tag53, accounts.bytes);
    return {
      observedSlot: accounts.slot,
      lifecycleRegistry: bundle.ids.lifecycleRegistry.toBase58(),
      timingProfile: bundle.ids.timingProfile.toBase58(),
      timingProfileHash: tag82.profile.profileHash.toString("hex"),
    };
  }
  if (action === "authority-final") {
    const state = await verifyBootstrapState(connection, bundle, minContextSlot, "final");
    return { observedSlot: state.observedSlot, controller: state.controller };
  }
  throw new Error(`unsupported transaction action ${action}`);
}

async function executeTransactionAction(action) {
  const bundle = await loadBundle({
    evidenceRequired: ["initialize-tag53", "initialize-tag82", "authority-final"].includes(action),
  });
  const selected = await readExecutionPlan(bundle, action);
  const existingReceipt = await readExistingReceipt(bundle, action, selected);
  if (existingReceipt) return existingReceipt;
  return withExecutionLock(bundle.runDir, `governance-v2-${action}-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId, async () => (
    withCeremonyRpcOwnerLock(bundle.runDir, selected.plan.operationId, async () => {
      const journal = await openJournal(bundle.runDir, `governance-v2-${action}-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId);
      try {
        const { connection, observedSlot } = await rpcContext(bundle, journal, `governance-v2-execute-${action}`);
        assert(observedSlot >= selected.plan.observedSlot, `${action} RPC context predates the plan`);
        const lookup = action === "initialize-tag53"
          ? (await readLookup(connection, new PublicKey(selected.plan.details.lookupTable), selected.plan.observedSlot, bundle.ids.payer, lookupAddresses(bundle.ids))).value
          : null;
        const actionValue = instructionsForPlan(bundle, selected.plan, lookup);
        assertManifestEqual(actionValue.instructions, selected.plan.details.instructions, action);
        const packet = dummyPacket(bundle.ids, actionValue.instructions, actionValue.lookups);
        assert.equal(packet.packetBytes, selected.plan.details.packetBytes, `${action} packet size changed`);
        assert.equal(packet.messageSha256, selected.plan.details.messageSha256, `${action} planning message changed`);
        const decodedAction = {
          action,
          actionOperationId: selected.plan.operationId,
          signers: actionValue.signers.map((entry) => entry.toBase58()),
          instructions: actionValue.instructions.map(instructionManifest),
          packetBytes: packet.packetBytes,
        };
        process.stdout.write(`${JSON.stringify({ decodedAction }, null, 2)}\n`);
        await journal.append("decoded-action", decodedAction);
        const reconciled = await reconcileOneFinalized({
          connection,
          journal,
          operationId: selected.plan.operationId,
          stage: action,
          expectedSigners: actionValue.signers,
          expectedPacketBytes: packet.packetBytes,
          verifyImmediatelyBeforeResubmit: async (minimum) => verifyActionPrestate(connection, bundle, selected, minimum),
        });
        if (reconciled) {
          const poststate = await verifyActionPoststate(connection, bundle, selected, reconciled.slot);
          return writeReceipt(bundle, action, selected, { signature: reconciled.signature, finalizedSlot: reconciled.slot, ...poststate });
        }
        assert(observedSlot <= selected.plan.validUntilSlot, `${action} plan expired`);
        const prestate = await verifyActionPrestate(connection, bundle, selected, selected.plan.observedSlot);
        const latest = await connection.getLatestBlockhashAndContext({
          commitment: "finalized",
          minContextSlot: prestate.slot,
        });
        assert(latest.context.slot >= prestate.slot, "latest blockhash predates verified prestate");
        const message = new TransactionMessage({
          payerKey: bundle.ids.payer,
          recentBlockhash: latest.value.blockhash,
          instructions: actionValue.instructions,
        }).compileToV0Message(actionValue.lookups);
        const unsigned = new VersionedTransaction(message);
        assert.equal(unsigned.serialize().length, packet.packetBytes, `${action} packet changed with live blockhash`);
        const provider = await loadInjectedSignerProvider(bundle.runDir, "AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER");
        const signed = await signTransactionWithProvider({
          providerValue: provider,
          transaction: unsigned,
          expectedSigners: actionValue.signers,
          operationId: selected.plan.operationId,
          stage: action,
        });
        const landed = await submitOneFinalized({
          connection,
          transaction: signed.transaction,
          latestBlockhash: latest.value,
          journal,
          operationId: selected.plan.operationId,
          stage: action,
          expectedSigners: actionValue.signers,
          expectedPacketBytes: packet.packetBytes,
          minContextSlot: latest.context.slot,
          preparedContext: { provider: signed.providerEvidence },
          verifyImmediatelyBeforeSubmit: async (minimum) => verifyActionPrestate(connection, bundle, selected, minimum),
        });
        const poststate = await verifyActionPoststate(connection, bundle, selected, landed.slot);
        return writeReceipt(bundle, action, selected, {
          signature: landed.signature,
          finalizedSlot: landed.slot,
          provider: signed.providerEvidence,
          ...poststate,
        });
      } finally {
        await journal.close();
      }
    })
  ));
}

async function verifyCommand(authorityMode) {
  const bundle = await loadBundle({ evidenceRequired: true });
  const action = authorityMode === "final" ? "verify-immutable" : "verify-bootstrap";
  return withPlanning(bundle, action, async ({ connection, observedSlot }) => {
    const state = await verifyBootstrapState(connection, bundle, observedSlot, authorityMode);
    const result = {
      schema: `ameba-governance-devnet-controller-v2-${action}-v1`,
      descriptorSha256: bundle.descriptorSha256,
      genesisHash: EXPECTED_GENESIS,
      ...state,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  });
}

async function selfTest() {
  const descriptor = validateDescriptor({
    schema: DESCRIPTOR_SCHEMA,
    cluster: { name: "devnet", genesisHash: EXPECTED_GENESIS },
    source: {
      repository: "https://github.com/SPACE999978/ameba_gov",
      branch: "codex/governance-timing-v2-fastlane",
      commit: "da5d915c4a0406316075fa92f1ee9786a2958630",
      tree: "1e5809687b9d4addbea1ecb63bb9084cc103ca09",
      cargoLockSha256: "0c26b200f23a65d0976f30474208b74a64f04623f16d539e6b805c4fcf98768d",
    },
    artifact: {
      file: "upgrade_controller-v2-fastlane.so",
      sbpfArchitecture: "v0",
      bytes: 1_388_320,
      sha256: "fbf03369dd95e3010a9f65fd7131edfff8ef3a2b248dc4e7f522b4c23106f4ca",
      programDataRawBytes: 1_388_365,
      bufferRawBytes: 1_388_357,
      deployWithMaxDataLenHex: "02000000202f150000000000",
    },
    identities: {
      controllerProgram: "J4ugyomki2MpGTbXMJ38w4h8ZybYQHUkiFC7FqxoQ6RW",
      controllerProgramData: "8WqJonLtgtw6tswhtGQ5RuQSzhfv1njSLuAnnYDsoh7x",
      controllerDeployBuffer: "5wQRrsKyuer8YBPJ7Lz4QGTTyf1rkMitDakXGsUa2zr8",
      targetProgram: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH",
      targetProgramData: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3",
      legacyTargetAuthority: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq",
      feePayer: "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT",
      initializer: "7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ",
      treasury: "8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j",
      guardian: "9DREu4USpbCHzLHD9whKHnRud8KDMhPswU4jZMbJP3ab",
      seats: [
        "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
        "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
        "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
        "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
        "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
      ],
    },
    pdas: {
      controllerConfig: "2iGUy7fPV69ZQY3GLGbr5YXNuihnT4tCpcrb94rqb946",
      controllerAuthority: "6Qow1hoUqiPrGQAFT9uxk2qbXwzo69cReRHbJY5FhV1v",
      protocolGate: "4oKrg4A8T6Z8UeSXSqtojZ3MZJwzKA2tyHgWj6jWrEj1",
      governancePolicyV1: "8JQ1mE9ruQ1GFhwwdb7jkEmHkyYo6S3gyA7ErdVLjQFT",
      governanceCouncilSetV1: "a6KooRHCqbEvryCMyHsxL7kBci9V37fid87WN2KAWds",
      capacityPolicy: "7B2CAF1JAHF4VadMyY9XVR68C3RMbihfAYEJeoYp1AVK",
      controllerReleaseCommitment: "HaYtP3PvscgdzokLpuSD9aijMDCYDWZ34jdnFx4sNESk",
      controllerImmutabilityReceipt: "BWid4vy43WP4DQ7jUQdCShpxLbULHp4ZhXw1jTpUMnvv",
      governanceLifecycleRegistryV2: "2trDW4rR1BtFNhUaTvxKWHYTw2DZVbZarfQWXveTHkei",
      governanceTimingProfileV1: "H9tEbax7fdjTTa8rgRW566rfWHHQ6kfqAUh5fVS1fWdW",
    },
    governanceLivenessV2: {
      initialTimingProfileVersion: 1,
      initialTimingProfileHash: "1663ed402b211cc47b5318cec498fc92ec6f87e2c0178ae6d1536ead7f5f7ebe",
      initialNextProposalId: 1,
      initialRotationNonce: 1,
      routineQuorum: 3,
      terminalQuorumReserved: 4,
      tokenGovernanceEnabled: false,
    },
    authorization: {
      devnetOnly: true,
      mainnetAllowed: false,
      writerRestartAllowed: false,
      mainBranchMergeAllowed: false,
    },
  });
  const ids = deriveIdentities(descriptor);
  const bundle = { descriptor, ids };
  const profileA = expectedNominalProfile(bundle, 1n);
  const profileB = expectedNominalProfile(bundle, 9_999n);
  assert.equal(profileA.creationSlot, 1n);
  assert.equal(profileB.creationSlot, 9_999n);
  assert(profileA.profileHash.equals(profileB.profileHash), "profile hash depends on the runtime creation slot");
  const tag82 = tag82Instruction(bundle);
  assert.equal(tag82.data[0], 82);
  assert.equal(tag82.data.length, 57);
  assert.equal(tag82.keys.length, 11);
  const finalAuthority = setAuthorityFinalInstruction(ids);
  assert.equal(finalAuthority.data.toString("hex"), "04000000");
  assert.equal(finalAuthority.keys.length, 2);
  assert.equal(lookupAddresses(ids).length, 20);
  const rejected = structuredClone(descriptor);
  rejected.authorization.mainnetAllowed = true;
  assert.throws(() => validateDescriptor(rejected), /true !== false/u);
  let liveDescriptorVector = null;
  if (process.env.AMEBA_GOVERNANCE_V2_DESCRIPTOR?.trim()) {
    const live = await loadBundle({ evidenceRequired: true });
    const model = buildTag53Model(live, 123n, live.descriptor.artifact.bytes);
    const tag53 = tag53Instruction(live, model);
    assert.equal(tag53.data[0], 53);
    assert.equal(tag53.data.length, 633);
    assert.equal(tag53.keys.length, 22);
    const lookup = new AddressLookupTableAccount({
      key: new PublicKey("11111111111111111111111111111112"),
      state: {
        deactivationSlot: U64_MAX,
        lastExtendedSlot: 1,
        lastExtendedSlotStartIndex: 0,
        authority: live.ids.payer,
        addresses: lookupAddresses(live.ids),
      },
    });
    const tag53Packet = dummyPacket(live.ids, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000n }),
      tag53,
    ], [lookup]);
    liveDescriptorVector = {
      descriptorSha256: live.descriptorSha256,
      artifactSha256: sha256Hex(live.artifact),
      tag53DataSha256: sha256Hex(tag53.data),
      tag53PacketBytes: tag53Packet.packetBytes,
      policyHash: model.policy.policyHash.toString("hex"),
      councilHash: model.council.setHash.toString("hex"),
      capacityPolicyDigest: model.capacityPolicy.policyDigest.toString("hex"),
      controllerReleaseDigest: model.controllerRelease.releaseDigest.toString("hex"),
    };
  }
  const result = {
    schema: "ameba-governance-devnet-controller-v2-tool-self-test-v1",
    descriptorSchema: descriptor.schema,
    controllerProgram: ids.controller.toBase58(),
    timingProfileHash: profileA.profileHash.toString("hex"),
    tag82DataHex: tag82.data.toString("hex"),
    setAuthorityFinalDataHex: finalAuthority.data.toString("hex"),
    lookupAddressCount: lookupAddresses(ids).length,
    liveDescriptorVector,
    passed: true,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const command = process.argv[2];
  assert(COMMANDS.has(command), usage());
  switch (command) {
    case "self-test": return selfTest();
    case "plan-deploy": return planDeploy();
    case "execute-deploy": return executeDeploy();
    case "plan-alt-create": return planAltCreate();
    case "execute-alt-create": return executeTransactionAction("alt-create");
    case "plan-alt-extend": return planAltExtend();
    case "execute-alt-extend": return executeTransactionAction("alt-extend");
    case "plan-initialize-tag53": return planTag53();
    case "execute-initialize-tag53": return executeTransactionAction("initialize-tag53");
    case "plan-initialize-tag82": return planTag82();
    case "execute-initialize-tag82": return executeTransactionAction("initialize-tag82");
    case "verify-bootstrap": return verifyCommand("initializer");
    case "plan-authority-final": return planAuthorityFinal();
    case "execute-authority-final": return executeTransactionAction("authority-final");
    case "verify-immutable": return verifyCommand("final");
    default: throw new Error("unreachable command");
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
