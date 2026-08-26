import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const UPGRADE_SEED_DOMAIN_V1 = Buffer.from("ameba-upgrade-v1", "ascii");
export const PROPOSAL_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_UPGRADE_PROPOSAL_V1",
  "ascii",
);
export const POLICY_HASH_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOVERNANCE_POLICY_V1",
  "ascii",
);
export const COUNCIL_SET_HASH_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOVERNANCE_COUNCIL_V1",
  "ascii",
);
export const CONTROLLER_CONFIG_LEN = 512;
export const GOVERNANCE_POLICY_LEN = 160;
export const COUNCIL_SEAT_LEN = 96;
export const GOVERNANCE_COUNCIL_SET_LEN = 640;
export const PROTOCOL_GATE_LEN = 192;
export const UPGRADE_PROPOSAL_LEN = 1280;
export const POLICY_HASH_MATERIAL_LEN = 96;
export const COUNCIL_SET_HASH_MATERIAL_LEN = 336;
export const PROPOSAL_DIGEST_MATERIAL_LEN = 1084;

const seed = (value: string): Buffer => Buffer.from(value, "ascii");
const TARGET_SEED = seed("target");
const AUTHORITY_SEED = seed("authority");
const GATE_SEED = seed("gate");
const POLICY_SEED = seed("policy");
const COUNCIL_SEED = seed("council");
const PROPOSAL_SEED = seed("proposal");
const CHECKPOINT_SEED = seed("checkpoint");
const BUFFER_CHECK_SEED = seed("buffer-check");

function u64Le(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("u64 out of range");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function u8(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${field} must be a u8`);
  }
  return Buffer.from([value]);
}

function u16Le(value: number, field: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${field} must be a u16`);
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function boolByte(value: boolean, field: string): Buffer {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be boolean`);
  }
  return Buffer.from([Number(value)]);
}

function requireZeroBytes(value: Buffer, length: number, field: string): Buffer {
  requireBytes(value, length, field);
  if (!value.equals(Buffer.alloc(length))) {
    throw new Error(`${field} must be zero`);
  }
  return value;
}

function requireNondefaultKey(value: PublicKey, field: string): Buffer {
  const bytes = value.toBuffer();
  if (bytes.equals(Buffer.alloc(32))) {
    throw new Error(`${field} must be nondefault`);
  }
  return bytes;
}

function derive(programId: PublicKey, seeds: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function deriveControllerConfigPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    TARGET_SEED,
    targetProgram.toBuffer(),
  ]);
}

export function deriveAuthorityPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    AUTHORITY_SEED,
    targetProgram.toBuffer(),
  ]);
}

export function deriveGatePda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    GATE_SEED,
    targetProgram.toBuffer(),
  ]);
}

export function derivePolicyPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  version: bigint,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    POLICY_SEED,
    targetProgram.toBuffer(),
    u64Le(version),
  ]);
}

export function deriveCouncilPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  version: bigint,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    COUNCIL_SEED,
    targetProgram.toBuffer(),
    u64Le(version),
  ]);
}

export function deriveProposalPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  proposalId: bigint,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    PROPOSAL_SEED,
    targetProgram.toBuffer(),
    u64Le(proposalId),
  ]);
}

export function deriveCheckpointPda(
  controllerProgram: PublicKey,
  proposal: PublicKey,
  phase: 0 | 1,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    CHECKPOINT_SEED,
    proposal.toBuffer(),
    Buffer.from([phase]),
  ]);
}

export function deriveBufferCheckPda(
  controllerProgram: PublicKey,
  proposal: PublicKey,
): [PublicKey, number] {
  return derive(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    BUFFER_CHECK_SEED,
    proposal.toBuffer(),
  ]);
}

export interface OptionalPublicKeyV1 {
  present: boolean;
  value: PublicKey;
}

export interface CouncilSeatV1Input {
  seatAuthority: PublicKey;
  termStartSlot: bigint;
  termEndSlot: bigint;
  active: boolean;
  reserved: Buffer;
}

export interface GovernancePolicyV1Input {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  controllerConfig: PublicKey;
  version: bigint;
  targetProgram: PublicKey;
  activationSlot: bigint;
  councilSize: number;
  routineThreshold: number;
  terminalThreshold: number;
  governanceMode: number;
  policyFlags: number;
  vetoQuorumBps: number;
  affirmativeQuorumBps: number;
  affirmativeApprovalBps: number;
  routineRequiresVote: boolean;
  economicRequiresVote: boolean;
  constitutionalRequiresVote: boolean;
  rotationRequiresVote: boolean;
  immutabilityRequiresVote: boolean;
  policyHash: Buffer;
  reserved: Buffer;
}

export interface GovernanceCouncilSetV1Input {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  controllerConfig: PublicKey;
  version: bigint;
  targetProgram: PublicKey;
  activationSlot: bigint;
  deactivationSlot: bigint;
  seats: readonly CouncilSeatV1Input[];
  routineThreshold: number;
  terminalThreshold: number;
  policyFlags: number;
  setHash: Buffer;
  reserved: Buffer;
}

export function serializeCouncilSeatV1(value: CouncilSeatV1Input): Buffer {
  if (value.termStartSlot >= value.termEndSlot) {
    throw new Error("seat term must be increasing");
  }
  const out = Buffer.concat([
    requireNondefaultKey(value.seatAuthority, "seatAuthority"),
    u64Le(value.termStartSlot),
    u64Le(value.termEndSlot),
    boolByte(value.active, "active"),
    requireZeroBytes(value.reserved, 47, "seat reserved"),
  ]);
  if (out.length !== COUNCIL_SEAT_LEN) {
    throw new Error(`council seat length ${out.length}`);
  }
  return out;
}

export function canonicalPolicyHashMaterial(
  value: GovernancePolicyV1Input,
): Buffer {
  const material = Buffer.concat([
    value.controllerConfig.toBuffer(),
    value.targetProgram.toBuffer(),
    u64Le(value.version),
    u64Le(value.activationSlot),
    u8(value.councilSize, "councilSize"),
    u8(value.routineThreshold, "routineThreshold"),
    u8(value.terminalThreshold, "terminalThreshold"),
    u8(value.governanceMode, "governanceMode"),
    u8(value.policyFlags, "policyFlags"),
    u16Le(value.vetoQuorumBps, "vetoQuorumBps"),
    u16Le(value.affirmativeQuorumBps, "affirmativeQuorumBps"),
    u16Le(value.affirmativeApprovalBps, "affirmativeApprovalBps"),
    boolByte(value.routineRequiresVote, "routineRequiresVote"),
    boolByte(value.economicRequiresVote, "economicRequiresVote"),
    boolByte(value.constitutionalRequiresVote, "constitutionalRequiresVote"),
    boolByte(value.rotationRequiresVote, "rotationRequiresVote"),
    boolByte(value.immutabilityRequiresVote, "immutabilityRequiresVote"),
  ]);
  if (material.length !== POLICY_HASH_MATERIAL_LEN) {
    throw new Error(`policy hash material length ${material.length}`);
  }
  return material;
}

export function governancePolicyHash(value: GovernancePolicyV1Input): Buffer {
  return createHash("sha256")
    .update(POLICY_HASH_DOMAIN_V1)
    .update(canonicalPolicyHashMaterial(value))
    .digest();
}

export function serializeGovernancePolicyV1(
  value: GovernancePolicyV1Input,
): Buffer {
  if (value.governanceMode !== 0) {
    throw new RangeError("governanceMode out of range");
  }
  const out = Buffer.concat([
    requireBytes(value.discriminator, 8, "policy discriminator"),
    u8(value.accountVersion, "accountVersion"),
    u8(value.bump, "bump"),
    boolByte(value.initialized, "initialized"),
    value.controllerConfig.toBuffer(),
    u64Le(value.version),
    value.targetProgram.toBuffer(),
    u64Le(value.activationSlot),
    u8(value.councilSize, "councilSize"),
    u8(value.routineThreshold, "routineThreshold"),
    u8(value.terminalThreshold, "terminalThreshold"),
    u8(value.governanceMode, "governanceMode"),
    u8(value.policyFlags, "policyFlags"),
    u16Le(value.vetoQuorumBps, "vetoQuorumBps"),
    u16Le(value.affirmativeQuorumBps, "affirmativeQuorumBps"),
    u16Le(value.affirmativeApprovalBps, "affirmativeApprovalBps"),
    boolByte(value.routineRequiresVote, "routineRequiresVote"),
    boolByte(value.economicRequiresVote, "economicRequiresVote"),
    boolByte(value.constitutionalRequiresVote, "constitutionalRequiresVote"),
    boolByte(value.rotationRequiresVote, "rotationRequiresVote"),
    boolByte(value.immutabilityRequiresVote, "immutabilityRequiresVote"),
    requireBytes(value.policyHash, 32, "policyHash"),
    requireZeroBytes(value.reserved, 21, "policy reserved"),
  ]);
  if (out.length !== GOVERNANCE_POLICY_LEN) {
    throw new Error(`governance policy length ${out.length}`);
  }
  return out;
}

export function canonicalCouncilSetHashMaterial(
  value: GovernanceCouncilSetV1Input,
): Buffer {
  if (value.seats.length !== 5) {
    throw new Error("council must contain five seats");
  }
  const seatMaterial = value.seats.map((seat) =>
    Buffer.concat([
      requireNondefaultKey(seat.seatAuthority, "seatAuthority"),
      u64Le(seat.termStartSlot),
      u64Le(seat.termEndSlot),
      boolByte(seat.active, "active"),
    ]),
  );
  const material = Buffer.concat([
    value.controllerConfig.toBuffer(),
    u64Le(value.version),
    value.targetProgram.toBuffer(),
    u64Le(value.activationSlot),
    u64Le(value.deactivationSlot),
    ...seatMaterial,
    u8(value.routineThreshold, "routineThreshold"),
    u8(value.terminalThreshold, "terminalThreshold"),
    u8(value.policyFlags, "policyFlags"),
  ]);
  if (material.length !== COUNCIL_SET_HASH_MATERIAL_LEN) {
    throw new Error(`council hash material length ${material.length}`);
  }
  return material;
}

export function governanceCouncilSetHash(
  value: GovernanceCouncilSetV1Input,
): Buffer {
  return createHash("sha256")
    .update(COUNCIL_SET_HASH_DOMAIN_V1)
    .update(canonicalCouncilSetHashMaterial(value))
    .digest();
}

export function serializeGovernanceCouncilSetV1(
  value: GovernanceCouncilSetV1Input,
): Buffer {
  if (value.seats.length !== 5) {
    throw new Error("council must contain five seats");
  }
  const out = Buffer.concat([
    requireBytes(value.discriminator, 8, "council discriminator"),
    u8(value.accountVersion, "accountVersion"),
    u8(value.bump, "bump"),
    boolByte(value.initialized, "initialized"),
    value.controllerConfig.toBuffer(),
    u64Le(value.version),
    value.targetProgram.toBuffer(),
    u64Le(value.activationSlot),
    u64Le(value.deactivationSlot),
    ...value.seats.map(serializeCouncilSeatV1),
    u8(value.routineThreshold, "routineThreshold"),
    u8(value.terminalThreshold, "terminalThreshold"),
    u8(value.policyFlags, "policyFlags"),
    requireBytes(value.setHash, 32, "setHash"),
    requireZeroBytes(value.reserved, 26, "council reserved"),
  ]);
  if (out.length !== GOVERNANCE_COUNCIL_SET_LEN) {
    throw new Error(`governance council length ${out.length}`);
  }
  return out;
}

function requireCanonicalBoolByte(value: number, field: string): void {
  if (value !== 0 && value !== 1) {
    throw new Error(`${field} is not a canonical boolean`);
  }
}

export function validateCouncilSeatV1Bytes(value: Buffer): void {
  requireBytes(value, COUNCIL_SEAT_LEN, "CouncilSeatV1");
  requireCanonicalBoolByte(value[48]!, "seat active");
  requireZeroBytes(value.subarray(49), 47, "seat reserved");
}

export function validateGovernancePolicyV1Bytes(value: Buffer): void {
  requireBytes(value, GOVERNANCE_POLICY_LEN, "GovernancePolicyV1");
  requireCanonicalBoolByte(value[10]!, "policy initialized");
  if (value[94] !== 0) {
    throw new Error("unknown GovernanceModeV1");
  }
  for (const offset of [102, 103, 104, 105, 106]) {
    requireCanonicalBoolByte(value[offset]!, `policy bool at ${offset}`);
  }
  requireZeroBytes(value.subarray(139), 21, "policy reserved");
}

export function validateGovernanceCouncilSetV1Bytes(value: Buffer): void {
  requireBytes(value, GOVERNANCE_COUNCIL_SET_LEN, "GovernanceCouncilSetV1");
  requireCanonicalBoolByte(value[10]!, "council initialized");
  for (let index = 0; index < 5; index += 1) {
    const start = 99 + index * COUNCIL_SEAT_LEN;
    validateCouncilSeatV1Bytes(value.subarray(start, start + COUNCIL_SEAT_LEN));
  }
  requireZeroBytes(value.subarray(614), 26, "council reserved");
}

export interface ProposalDigestInputV1 {
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  policyVersion: bigint;
  policyHash: Buffer;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  authorityPda: PublicKey;
  canonicalSpillTreasury: PublicKey;
  proposalId: bigint;
  targetNonce: bigint;
  proposalClass: number;
  councilVersion: bigint;
  councilHash: Buffer;
  creationGateEpoch: bigint;
  freezeGateEpoch: bigint;
  bufferPubkey: PublicKey;
  bufferLoaderOwner: PublicKey;
  bufferAuthority: PublicKey;
  artifactLength: bigint;
  artifactSha256: Buffer;
  sourceCommitHash: Buffer;
  sourceTreeHash: Buffer;
  buildInputInventoryHash: Buffer;
  reproducibleBuildReceiptHash: Buffer;
  packageReceiptHash: Buffer;
  releaseIntentHash: Buffer;
  currentDeployedPayloadHash: Buffer;
  currentRawProgramdataHash: Buffer;
  deployedSlot: bigint;
  currentCapacity: bigint;
  extensionDelta: bigint;
  expectedPostCapacity: bigint;
  prestateCheckpoint: PublicKey;
  requiredPoststateCheckpoint: PublicKey;
  rollbackProposal: OptionalPublicKeyV1;
  rollbackBuffer: OptionalPublicKeyV1;
  rollbackArtifactHash: Buffer;
  voteProgram: PublicKey;
  voteResultPda: PublicKey;
  voteRequirement: number;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
}

function requireBytes(value: Buffer, length: number, field: string): Buffer {
  if (value.length !== length) {
    throw new RangeError(`${field} must be ${length} bytes`);
  }
  return value;
}

function optionalKey(value: OptionalPublicKeyV1, field: string): Buffer {
  const key = value.value.toBuffer();
  const isDefault = key.equals(Buffer.alloc(32));
  if ((value.present && isDefault) || (!value.present && !isDefault)) {
    throw new Error(`${field} is not canonically encoded`);
  }
  return Buffer.concat([Buffer.from([Number(value.present)]), key]);
}

export function canonicalProposalDigestMaterial(
  value: ProposalDigestInputV1,
): Buffer {
  if (!Number.isInteger(value.proposalClass) || value.proposalClass < 0 || value.proposalClass > 5) {
    throw new RangeError("proposalClass out of range");
  }
  if (
    !Number.isInteger(value.voteRequirement) ||
    value.voteRequirement < 0 ||
    value.voteRequirement > 2
  ) {
    throw new RangeError("voteRequirement out of range");
  }
  const material = Buffer.concat([
    requireBytes(value.clusterDomain, 32, "clusterDomain"),
    value.controllerProgram.toBuffer(),
    value.controllerConfig.toBuffer(),
    value.protocolGate.toBuffer(),
    u64Le(value.policyVersion),
    requireBytes(value.policyHash, 32, "policyHash"),
    value.targetProgram.toBuffer(),
    value.targetProgramdata.toBuffer(),
    value.upgradeableLoader.toBuffer(),
    value.authorityPda.toBuffer(),
    value.canonicalSpillTreasury.toBuffer(),
    u64Le(value.proposalId),
    u64Le(value.targetNonce),
    Buffer.from([value.proposalClass]),
    u64Le(value.councilVersion),
    requireBytes(value.councilHash, 32, "councilHash"),
    u64Le(value.creationGateEpoch),
    u64Le(value.freezeGateEpoch),
    value.bufferPubkey.toBuffer(),
    value.bufferLoaderOwner.toBuffer(),
    value.bufferAuthority.toBuffer(),
    u64Le(value.artifactLength),
    requireBytes(value.artifactSha256, 32, "artifactSha256"),
    requireBytes(value.sourceCommitHash, 32, "sourceCommitHash"),
    requireBytes(value.sourceTreeHash, 32, "sourceTreeHash"),
    requireBytes(value.buildInputInventoryHash, 32, "buildInputInventoryHash"),
    requireBytes(value.reproducibleBuildReceiptHash, 32, "reproducibleBuildReceiptHash"),
    requireBytes(value.packageReceiptHash, 32, "packageReceiptHash"),
    requireBytes(value.releaseIntentHash, 32, "releaseIntentHash"),
    requireBytes(value.currentDeployedPayloadHash, 32, "currentDeployedPayloadHash"),
    requireBytes(value.currentRawProgramdataHash, 32, "currentRawProgramdataHash"),
    u64Le(value.deployedSlot),
    u64Le(value.currentCapacity),
    u64Le(value.extensionDelta),
    u64Le(value.expectedPostCapacity),
    value.prestateCheckpoint.toBuffer(),
    value.requiredPoststateCheckpoint.toBuffer(),
    optionalKey(value.rollbackProposal, "rollbackProposal"),
    optionalKey(value.rollbackBuffer, "rollbackBuffer"),
    requireBytes(value.rollbackArtifactHash, 32, "rollbackArtifactHash"),
    value.voteProgram.toBuffer(),
    value.voteResultPda.toBuffer(),
    Buffer.from([value.voteRequirement]),
    u64Le(value.reviewStartSlot),
    u64Le(value.reviewEndSlot),
    u64Le(value.notBeforeSlot),
    u64Le(value.expirySlot),
  ]);
  if (material.length !== PROPOSAL_DIGEST_MATERIAL_LEN) {
    throw new Error(`proposal digest material length ${material.length}`);
  }
  return material;
}

export function proposalDigest(value: ProposalDigestInputV1): Buffer {
  const material = canonicalProposalDigestMaterial(value);
  return createHash("sha256")
    .update(PROPOSAL_DIGEST_DOMAIN_V1)
    .update(material)
    .digest();
}
