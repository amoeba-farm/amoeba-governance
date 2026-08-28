import { PublicKey } from "@solana/web3.js";
import {
  CONTROLLER_CONFIG_LEN,
  GOVERNANCE_COUNCIL_SET_LEN,
  GOVERNANCE_POLICY_LEN,
  PROTOCOL_GATE_LEN,
  UPGRADE_PROPOSAL_LEN,
  deserializeProtocolGateV1,
  governanceCouncilSetHash,
  governancePolicyHash,
  proposalDigest,
  serializeProtocolGateV1,
  type CouncilSeatV1Input,
  type GovernanceCouncilSetV1Input,
  type GovernancePolicyV1Input,
  type OptionalPublicKeyV1,
  type ProtocolGateV1Input,
} from "./v1.js";

export const CONTROLLER_CONFIG_V1_DISCRIMINATOR = Buffer.from("AGVCFG01", "ascii");
export const GOVERNANCE_POLICY_V1_DISCRIMINATOR = Buffer.from("AGVPOL01", "ascii");
export const GOVERNANCE_COUNCIL_SET_V1_DISCRIMINATOR = Buffer.from("AGVCNS01", "ascii");
export const UPGRADE_PROPOSAL_V1_DISCRIMINATOR = Buffer.from("AGVPRP01", "ascii");
export const V1_ACCOUNT_VERSION = 1;

export interface ControllerConfigV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  clusterDomain: Buffer;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  authorityPda: PublicKey;
  gatePda: PublicKey;
  canonicalSpillTreasury: PublicKey;
  currentCouncilVersion: bigint;
  currentPolicyVersion: bigint;
  nextProposalId: bigint;
  targetNonce: bigint;
  guardian: PublicKey;
  voteProgram: PublicKey;
  voteProgramdata: PublicKey;
  voteConfig: PublicKey;
  voteMint: PublicKey;
  tokenGovernanceEnabled: boolean;
  routineDelaySlots: bigint;
  majorDelaySlots: bigint;
  rollbackDelaySlots: bigint;
  terminalDelaySlots: bigint;
  voteReviewSlots: bigint;
  proposalExpirySlots: bigint;
  policyFlags: bigint;
  reserved: Buffer;
}

export interface UpgradeProposalV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  proposalId: bigint;
  targetNonce: bigint;
  proposalClass: number;
  state: number;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  policyVersion: bigint;
  policyHash: Buffer;
  councilVersion: bigint;
  councilHash: Buffer;
  creationGateEpoch: bigint;
  freezeGateEpoch: bigint;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  authorityPda: PublicKey;
  canonicalSpillTreasury: PublicKey;
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
  voteRequirement: number;
  voteProgram: PublicKey;
  voteResultPda: PublicKey;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  councilApprovalBitset: number;
  councilApprovalCount: number;
  poststateApprovalBitset: number;
  poststateApprovalCount: number;
  unfreezeApprovalBitset: number;
  unfreezeApprovalCount: number;
  proposalDigest: Buffer;
  cancellationReasonCode: number;
  terminalReasonCode: number;
  reserved: Buffer;
}

class Writer {
  readonly parts: Buffer[] = [];
  bytes(value: Buffer, length: number, field: string): this { if (!Buffer.isBuffer(value) || value.length !== length) throw new RangeError(`${field} must be ${length} bytes`); this.parts.push(value); return this; }
  byte(value: number, field: string): this { if (!Number.isSafeInteger(value) || value < 0 || value > 255) throw new RangeError(`${field} must be a u8`); this.parts.push(Buffer.from([value])); return this; }
  bool(value: boolean, field: string): this { if (typeof value !== "boolean") throw new TypeError(`${field} must be boolean`); return this.byte(Number(value), field); }
  u16(value: number, field: string): this { if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${field} must be a u16`); const out = Buffer.alloc(2); out.writeUInt16LE(value); this.parts.push(out); return this; }
  u64(value: bigint, field: string): this { if (typeof value !== "bigint" || value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError(`${field} must be a u64`); const out = Buffer.alloc(8); out.writeBigUInt64LE(value); this.parts.push(out); return this; }
  key(value: PublicKey, field: string): this { if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`); this.parts.push(value.toBuffer()); return this; }
  optionalKey(value: OptionalPublicKeyV1, field: string): this { const isDefault = value.value.equals(PublicKey.default); if (value.present === isDefault) throw new Error(`${field} is noncanonical`); return this.bool(value.present, `${field}.present`).key(value.value, `${field}.value`); }
  finish(length: number): Buffer { const out = Buffer.concat(this.parts); if (out.length !== length) throw new Error(`internal fixed account length ${out.length} != ${length}`); return out; }
}

class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  bytes(length: number): Buffer { const end = this.offset + length; if (end > this.data.length) throw new Error("truncated fixed account"); const out = Buffer.from(this.data.subarray(this.offset, end)); this.offset = end; return out; }
  byte(): number { return this.bytes(1)[0]!; }
  bool(): boolean { const value = this.byte(); if (value !== 0 && value !== 1) throw new Error("noncanonical boolean"); return value === 1; }
  u16(): number { return this.bytes(2).readUInt16LE(); }
  u64(): bigint { return this.bytes(8).readBigUInt64LE(); }
  key(): PublicKey { return new PublicKey(this.bytes(32)); }
  optionalKey(): OptionalPublicKeyV1 { const present = this.bool(); const value = this.key(); if (present === value.equals(PublicKey.default)) throw new Error("noncanonical optional public key"); return { present, value }; }
  finish(): void { if (this.offset !== this.data.length) throw new Error("trailing fixed account bytes"); }
}

function zeros(value: Buffer, length: number, field: string): void { if (value.length !== length || value.some((byte) => byte !== 0)) throw new Error(`${field} must be ${length} zero bytes`); }
function discriminator(value: Buffer, expected: Buffer, field: string): void { if (!Buffer.isBuffer(value) || !value.equals(expected)) throw new Error(`invalid ${field} discriminator`); }
function version(value: number): void { if (value !== V1_ACCOUNT_VERSION) throw new Error("unknown V1 account version"); }
function initialized(value: boolean): void { if (!value) throw new Error("V1 account is uninitialized"); }
function enumValue(value: number, maximum: number, field: string): void { if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`unknown ${field}`); }

export function serializeControllerConfigV1(value: ControllerConfigV1): Buffer {
  discriminator(value.discriminator, CONTROLLER_CONFIG_V1_DISCRIMINATOR, "ControllerConfigV1"); version(value.version); initialized(value.initialized); zeros(value.reserved, 28, "ControllerConfigV1.reserved");
  if (value.tokenGovernanceEnabled || [value.voteProgram, value.voteProgramdata, value.voteConfig, value.voteMint].some((entry) => !entry.equals(PublicKey.default))) throw new Error("Release 1 token governance fields must be canonical defaults");
  const minimumExpiry = value.voteReviewSlots + value.majorDelaySlots + 1n;
  if (value.clusterDomain.equals(Buffer.alloc(32)) || value.currentCouncilVersion === 0n || value.currentPolicyVersion === 0n || value.nextProposalId === 0n || value.targetNonce === 0n || value.rollbackDelaySlots === 0n || value.rollbackDelaySlots > value.routineDelaySlots || value.routineDelaySlots > value.majorDelaySlots || value.majorDelaySlots > value.terminalDelaySlots || value.majorDelaySlots >= value.proposalExpirySlots || value.voteReviewSlots >= value.proposalExpirySlots || minimumExpiry >= value.proposalExpirySlots || value.policyFlags !== 0n) throw new Error("ControllerConfigV1 violates Bootstrap V1 timing or identity defaults");
  return new Writer().bytes(value.discriminator, 8, "discriminator").byte(value.version, "version").byte(value.bump, "bump").bool(value.initialized, "initialized")
    .bytes(value.clusterDomain, 32, "clusterDomain").key(value.targetProgram, "targetProgram").key(value.targetProgramdata, "targetProgramdata")
    .key(value.upgradeableLoader, "upgradeableLoader").key(value.authorityPda, "authorityPda").key(value.gatePda, "gatePda").key(value.canonicalSpillTreasury, "canonicalSpillTreasury")
    .u64(value.currentCouncilVersion, "currentCouncilVersion").u64(value.currentPolicyVersion, "currentPolicyVersion").u64(value.nextProposalId, "nextProposalId").u64(value.targetNonce, "targetNonce")
    .key(value.guardian, "guardian").key(value.voteProgram, "voteProgram").key(value.voteProgramdata, "voteProgramdata").key(value.voteConfig, "voteConfig").key(value.voteMint, "voteMint")
    .bool(value.tokenGovernanceEnabled, "tokenGovernanceEnabled").u64(value.routineDelaySlots, "routineDelaySlots").u64(value.majorDelaySlots, "majorDelaySlots")
    .u64(value.rollbackDelaySlots, "rollbackDelaySlots").u64(value.terminalDelaySlots, "terminalDelaySlots").u64(value.voteReviewSlots, "voteReviewSlots")
    .u64(value.proposalExpirySlots, "proposalExpirySlots").u64(value.policyFlags, "policyFlags").bytes(value.reserved, 28, "reserved").finish(CONTROLLER_CONFIG_LEN);
}

export function deserializeControllerConfigV1(bytes: Buffer): ControllerConfigV1 {
  if (bytes.length !== CONTROLLER_CONFIG_LEN) throw new RangeError("ControllerConfigV1 must be 512 bytes");
  const reader = new Reader(bytes); const value: ControllerConfigV1 = { discriminator: reader.bytes(8), version: reader.byte(), bump: reader.byte(), initialized: reader.bool(), clusterDomain: reader.bytes(32), targetProgram: reader.key(), targetProgramdata: reader.key(), upgradeableLoader: reader.key(), authorityPda: reader.key(), gatePda: reader.key(), canonicalSpillTreasury: reader.key(), currentCouncilVersion: reader.u64(), currentPolicyVersion: reader.u64(), nextProposalId: reader.u64(), targetNonce: reader.u64(), guardian: reader.key(), voteProgram: reader.key(), voteProgramdata: reader.key(), voteConfig: reader.key(), voteMint: reader.key(), tokenGovernanceEnabled: reader.bool(), routineDelaySlots: reader.u64(), majorDelaySlots: reader.u64(), rollbackDelaySlots: reader.u64(), terminalDelaySlots: reader.u64(), voteReviewSlots: reader.u64(), proposalExpirySlots: reader.u64(), policyFlags: reader.u64(), reserved: reader.bytes(28) }; reader.finish(); serializeControllerConfigV1(value); return value;
}

function writePolicy(writer: Writer, value: GovernancePolicyV1Input): void { writer.bytes(value.discriminator, 8, "discriminator").byte(value.accountVersion, "accountVersion").byte(value.bump, "bump").bool(value.initialized, "initialized").key(value.controllerConfig, "controllerConfig").u64(value.version, "version").key(value.targetProgram, "targetProgram").u64(value.activationSlot, "activationSlot").byte(value.councilSize, "councilSize").byte(value.routineThreshold, "routineThreshold").byte(value.terminalThreshold, "terminalThreshold").byte(value.governanceMode, "governanceMode").byte(value.policyFlags, "policyFlags").u16(value.vetoQuorumBps, "vetoQuorumBps").u16(value.affirmativeQuorumBps, "affirmativeQuorumBps").u16(value.affirmativeApprovalBps, "affirmativeApprovalBps").bool(value.routineRequiresVote, "routineRequiresVote").bool(value.economicRequiresVote, "economicRequiresVote").bool(value.constitutionalRequiresVote, "constitutionalRequiresVote").bool(value.rotationRequiresVote, "rotationRequiresVote").bool(value.immutabilityRequiresVote, "immutabilityRequiresVote").bytes(value.policyHash, 32, "policyHash").bytes(value.reserved, 21, "reserved"); }
export function serializeGovernancePolicyFixedV1(value: GovernancePolicyV1Input): Buffer { discriminator(value.discriminator, GOVERNANCE_POLICY_V1_DISCRIMINATOR, "GovernancePolicyV1"); version(value.accountVersion); initialized(value.initialized); zeros(value.reserved, 21, "GovernancePolicyV1.reserved"); if (value.governanceMode !== 0 || value.councilSize !== 5 || value.routineThreshold !== 3 || value.terminalThreshold !== 4 || value.policyFlags !== 0 || value.vetoQuorumBps !== 0 || value.affirmativeQuorumBps !== 0 || value.affirmativeApprovalBps !== 0 || value.routineRequiresVote || value.economicRequiresVote || value.constitutionalRequiresVote || value.rotationRequiresVote || value.immutabilityRequiresVote || !governancePolicyHash(value).equals(value.policyHash)) throw new Error("GovernancePolicyV1 violates Bootstrap V1 defaults or digest"); const writer = new Writer(); writePolicy(writer, value); return writer.finish(GOVERNANCE_POLICY_LEN); }
export function deserializeGovernancePolicyFixedV1(bytes: Buffer): GovernancePolicyV1Input { if (bytes.length !== GOVERNANCE_POLICY_LEN) throw new RangeError("GovernancePolicyV1 must be 160 bytes"); const r = new Reader(bytes); const value: GovernancePolicyV1Input = { discriminator: r.bytes(8), accountVersion: r.byte(), bump: r.byte(), initialized: r.bool(), controllerConfig: r.key(), version: r.u64(), targetProgram: r.key(), activationSlot: r.u64(), councilSize: r.byte(), routineThreshold: r.byte(), terminalThreshold: r.byte(), governanceMode: r.byte(), policyFlags: r.byte(), vetoQuorumBps: r.u16(), affirmativeQuorumBps: r.u16(), affirmativeApprovalBps: r.u16(), routineRequiresVote: r.bool(), economicRequiresVote: r.bool(), constitutionalRequiresVote: r.bool(), rotationRequiresVote: r.bool(), immutabilityRequiresVote: r.bool(), policyHash: r.bytes(32), reserved: r.bytes(21) }; r.finish(); serializeGovernancePolicyFixedV1(value); return value; }

function writeSeat(writer: Writer, value: CouncilSeatV1Input): void { writer.key(value.seatAuthority, "seatAuthority").u64(value.termStartSlot, "termStartSlot").u64(value.termEndSlot, "termEndSlot").bool(value.active, "active").bytes(value.reserved, 47, "seat.reserved"); }
function readSeat(reader: Reader): CouncilSeatV1Input { return { seatAuthority: reader.key(), termStartSlot: reader.u64(), termEndSlot: reader.u64(), active: reader.bool(), reserved: reader.bytes(47) }; }
export function serializeGovernanceCouncilSetFixedV1(value: GovernanceCouncilSetV1Input): Buffer { discriminator(value.discriminator, GOVERNANCE_COUNCIL_SET_V1_DISCRIMINATOR, "GovernanceCouncilSetV1"); version(value.accountVersion); initialized(value.initialized); zeros(value.reserved, 26, "GovernanceCouncilSetV1.reserved"); const identities = value.seats.map((seat) => seat.seatAuthority.toBase58()); if (value.seats.length !== 5 || new Set(identities).size !== 5 || value.seats.some((seat) => !seat.active || seat.seatAuthority.equals(PublicKey.default) || seat.termStartSlot >= seat.termEndSlot) || value.routineThreshold !== 3 || value.terminalThreshold !== 4 || value.policyFlags !== 0 || !governanceCouncilSetHash(value).equals(value.setHash)) throw new Error("GovernanceCouncilSetV1 violates five-seat Bootstrap V1 defaults or digest"); const writer = new Writer().bytes(value.discriminator, 8, "discriminator").byte(value.accountVersion, "accountVersion").byte(value.bump, "bump").bool(value.initialized, "initialized").key(value.controllerConfig, "controllerConfig").u64(value.version, "version").key(value.targetProgram, "targetProgram").u64(value.activationSlot, "activationSlot").u64(value.deactivationSlot, "deactivationSlot"); for (const seat of value.seats) { zeros(seat.reserved, 47, "CouncilSeatV1.reserved"); writeSeat(writer, seat); } return writer.byte(value.routineThreshold, "routineThreshold").byte(value.terminalThreshold, "terminalThreshold").byte(value.policyFlags, "policyFlags").bytes(value.setHash, 32, "setHash").bytes(value.reserved, 26, "reserved").finish(GOVERNANCE_COUNCIL_SET_LEN); }
export function deserializeGovernanceCouncilSetFixedV1(bytes: Buffer): GovernanceCouncilSetV1Input { if (bytes.length !== GOVERNANCE_COUNCIL_SET_LEN) throw new RangeError("GovernanceCouncilSetV1 must be 640 bytes"); const r = new Reader(bytes); const value: GovernanceCouncilSetV1Input = { discriminator: r.bytes(8), accountVersion: r.byte(), bump: r.byte(), initialized: r.bool(), controllerConfig: r.key(), version: r.u64(), targetProgram: r.key(), activationSlot: r.u64(), deactivationSlot: r.u64(), seats: Array.from({ length: 5 }, () => readSeat(r)), routineThreshold: r.byte(), terminalThreshold: r.byte(), policyFlags: r.byte(), setHash: r.bytes(32), reserved: r.bytes(26) }; r.finish(); serializeGovernanceCouncilSetFixedV1(value); return value; }

export const serializeProtocolGateFixedV1 = serializeProtocolGateV1;
export const deserializeProtocolGateFixedV1 = (bytes: Buffer): ProtocolGateV1Input => deserializeProtocolGateV1(bytes);

export function serializeUpgradeProposalFixedV1(value: UpgradeProposalV1): Buffer {
  discriminator(value.discriminator, UPGRADE_PROPOSAL_V1_DISCRIMINATOR, "UpgradeProposalV1"); version(value.accountVersion); initialized(value.initialized); zeros(value.reserved, 142, "UpgradeProposalV1.reserved"); enumValue(value.proposalClass, 5, "ProposalClassV1"); enumValue(value.state, 15, "ProposalStateV1"); enumValue(value.voteRequirement, 2, "VoteRequirementV1"); if (value.voteRequirement !== 0 || !value.voteProgram.equals(PublicKey.default) || !value.voteResultPda.equals(PublicKey.default) || !proposalDigest(value).equals(value.proposalDigest)) throw new Error("UpgradeProposalV1 token governance fields or digest are noncanonical");
  return new Writer().bytes(value.discriminator, 8, "discriminator").byte(value.accountVersion, "accountVersion").byte(value.bump, "bump").bool(value.initialized, "initialized").u64(value.proposalId, "proposalId").u64(value.targetNonce, "targetNonce").byte(value.proposalClass, "proposalClass").byte(value.state, "state").bytes(value.clusterDomain, 32, "clusterDomain").key(value.controllerProgram, "controllerProgram").key(value.controllerConfig, "controllerConfig").key(value.protocolGate, "protocolGate").u64(value.policyVersion, "policyVersion").bytes(value.policyHash, 32, "policyHash").u64(value.councilVersion, "councilVersion").bytes(value.councilHash, 32, "councilHash").u64(value.creationGateEpoch, "creationGateEpoch").u64(value.freezeGateEpoch, "freezeGateEpoch").key(value.targetProgram, "targetProgram").key(value.targetProgramdata, "targetProgramdata").key(value.upgradeableLoader, "upgradeableLoader").key(value.authorityPda, "authorityPda").key(value.canonicalSpillTreasury, "canonicalSpillTreasury").key(value.bufferPubkey, "bufferPubkey").key(value.bufferLoaderOwner, "bufferLoaderOwner").key(value.bufferAuthority, "bufferAuthority").u64(value.artifactLength, "artifactLength").bytes(value.artifactSha256, 32, "artifactSha256").bytes(value.sourceCommitHash, 32, "sourceCommitHash").bytes(value.sourceTreeHash, 32, "sourceTreeHash").bytes(value.buildInputInventoryHash, 32, "buildInputInventoryHash").bytes(value.reproducibleBuildReceiptHash, 32, "reproducibleBuildReceiptHash").bytes(value.packageReceiptHash, 32, "packageReceiptHash").bytes(value.releaseIntentHash, 32, "releaseIntentHash").bytes(value.currentDeployedPayloadHash, 32, "currentDeployedPayloadHash").bytes(value.currentRawProgramdataHash, 32, "currentRawProgramdataHash").u64(value.deployedSlot, "deployedSlot").u64(value.currentCapacity, "currentCapacity").u64(value.extensionDelta, "extensionDelta").u64(value.expectedPostCapacity, "expectedPostCapacity").key(value.prestateCheckpoint, "prestateCheckpoint").key(value.requiredPoststateCheckpoint, "requiredPoststateCheckpoint").optionalKey(value.rollbackProposal, "rollbackProposal").optionalKey(value.rollbackBuffer, "rollbackBuffer").bytes(value.rollbackArtifactHash, 32, "rollbackArtifactHash").byte(value.voteRequirement, "voteRequirement").key(value.voteProgram, "voteProgram").key(value.voteResultPda, "voteResultPda").u64(value.reviewStartSlot, "reviewStartSlot").u64(value.reviewEndSlot, "reviewEndSlot").u64(value.notBeforeSlot, "notBeforeSlot").u64(value.expirySlot, "expirySlot").byte(value.councilApprovalBitset, "councilApprovalBitset").byte(value.councilApprovalCount, "councilApprovalCount").byte(value.poststateApprovalBitset, "poststateApprovalBitset").byte(value.poststateApprovalCount, "poststateApprovalCount").byte(value.unfreezeApprovalBitset, "unfreezeApprovalBitset").byte(value.unfreezeApprovalCount, "unfreezeApprovalCount").bytes(value.proposalDigest, 32, "proposalDigest").u16(value.cancellationReasonCode, "cancellationReasonCode").u16(value.terminalReasonCode, "terminalReasonCode").bytes(value.reserved, 142, "reserved").finish(UPGRADE_PROPOSAL_LEN);
}

export function deserializeUpgradeProposalFixedV1(bytes: Buffer): UpgradeProposalV1 {
  if (bytes.length !== UPGRADE_PROPOSAL_LEN) throw new RangeError("UpgradeProposalV1 must be 1280 bytes"); const r = new Reader(bytes);
  const value: UpgradeProposalV1 = { discriminator: r.bytes(8), accountVersion: r.byte(), bump: r.byte(), initialized: r.bool(), proposalId: r.u64(), targetNonce: r.u64(), proposalClass: r.byte(), state: r.byte(), clusterDomain: r.bytes(32), controllerProgram: r.key(), controllerConfig: r.key(), protocolGate: r.key(), policyVersion: r.u64(), policyHash: r.bytes(32), councilVersion: r.u64(), councilHash: r.bytes(32), creationGateEpoch: r.u64(), freezeGateEpoch: r.u64(), targetProgram: r.key(), targetProgramdata: r.key(), upgradeableLoader: r.key(), authorityPda: r.key(), canonicalSpillTreasury: r.key(), bufferPubkey: r.key(), bufferLoaderOwner: r.key(), bufferAuthority: r.key(), artifactLength: r.u64(), artifactSha256: r.bytes(32), sourceCommitHash: r.bytes(32), sourceTreeHash: r.bytes(32), buildInputInventoryHash: r.bytes(32), reproducibleBuildReceiptHash: r.bytes(32), packageReceiptHash: r.bytes(32), releaseIntentHash: r.bytes(32), currentDeployedPayloadHash: r.bytes(32), currentRawProgramdataHash: r.bytes(32), deployedSlot: r.u64(), currentCapacity: r.u64(), extensionDelta: r.u64(), expectedPostCapacity: r.u64(), prestateCheckpoint: r.key(), requiredPoststateCheckpoint: r.key(), rollbackProposal: r.optionalKey(), rollbackBuffer: r.optionalKey(), rollbackArtifactHash: r.bytes(32), voteRequirement: r.byte(), voteProgram: r.key(), voteResultPda: r.key(), reviewStartSlot: r.u64(), reviewEndSlot: r.u64(), notBeforeSlot: r.u64(), expirySlot: r.u64(), councilApprovalBitset: r.byte(), councilApprovalCount: r.byte(), poststateApprovalBitset: r.byte(), poststateApprovalCount: r.byte(), unfreezeApprovalBitset: r.byte(), unfreezeApprovalCount: r.byte(), proposalDigest: r.bytes(32), cancellationReasonCode: r.u16(), terminalReasonCode: r.u16(), reserved: r.bytes(142) }; r.finish(); serializeUpgradeProposalFixedV1(value); return value;
}
