import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const UPGRADE_SEED_DOMAIN_V1 = Buffer.from("ameba-upgrade-v1", "ascii");
export const PROPOSAL_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_UPGRADE_PROPOSAL_V1",
  "ascii",
);
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
