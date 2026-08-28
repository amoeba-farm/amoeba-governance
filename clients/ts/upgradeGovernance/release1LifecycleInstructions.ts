import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  CouncilRotationStateV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
  type CouncilRotationStateV1 as CouncilRotationStateV1Value,
  type EmergencyFreezeResolutionStateV1 as EmergencyFreezeResolutionStateV1Value,
  type GateStatusV1 as GateStatusV1Value,
  type ProposalClassV1 as ProposalClassV1Value,
  type ProposalStateV2 as ProposalStateV2Value,
  type StateCheckpointPhaseV1 as StateCheckpointPhaseV1Value,
} from "./release1.js";
import {
  MAX_CONTROLLER_INSTRUCTION_DATA_LEN,
  decodeRelease1LoaderInstructionV1,
  type Release1LoaderInstructionV1,
  type EmergencyResolutionExpectationV1,
  type OptionalInstructionPublicKeyV1,
  type ProposalExpectationV2,
} from "./release1LoaderInstructions.js";

export const INITIALIZE_CONTROLLER_V1_TAG = 1;
export const CREATE_PROPOSAL_V2_TAG = 2;
export const APPROVE_PROPOSAL_V2_TAG = 3;
export const FINALIZE_GOVERNANCE_V2_TAG = 4;
export const QUEUE_PROPOSAL_V2_TAG = 5;
export const FREEZE_PROPOSAL_V2_TAG = 6;
export const CANCEL_PROPOSAL_V2_TAG = 7;
export const EXPIRE_PROPOSAL_V2_TAG = 8;
export const APPROVE_EMERGENCY_RESOLUTION_V1_TAG = 11;
export const QUEUE_EMERGENCY_RESOLUTION_V1_TAG = 12;
export const CONVERT_EMERGENCY_FREEZE_V2_TAG = 14;
export const CREATE_CHECKPOINT_ATTESTATION_V1_TAG = 15;
export const RECAST_CHECKPOINT_ATTESTATION_V1_TAG = 16;
export const FINALIZE_CHECKPOINT_V1_TAG = 17;
export const CREATE_CANDIDATE_COUNCIL_SET_V1_TAG = 18;
export const CREATE_COUNCIL_ROTATION_V1_TAG = 19;
export const APPROVE_COUNCIL_ROTATION_V1_TAG = 20;
export const ACTIVATE_COUNCIL_ROTATION_V1_TAG = 21;
export const QUEUE_COUNCIL_ROTATION_V1_TAG = 22;
export const EXPIRE_EMERGENCY_RESOLUTION_V1_TAG = 23;
export const CANCEL_COUNCIL_ROTATION_V1_TAG = 24;
export const EXPIRE_COUNCIL_ROTATION_V1_TAG = 25;
export const CANCEL_EMERGENCY_RESOLUTION_V2_RESERVED_TAG = 26;

export const COUNCIL_SEAT_TERM_V1_LEN = 16;
export const CHECKPOINT_CANDIDATE_V1_LEN = 447;
export const COUNCIL_ROTATION_EXPECTATION_V1_LEN = 146;
export const INITIALIZE_CONTROLLER_V1_LEN = 273;
export const CREATE_PROPOSAL_V2_LEN = 806;
export const APPROVE_PROPOSAL_V2_LEN = 165;
export const FINALIZE_GOVERNANCE_V2_LEN = 165;
export const QUEUE_PROPOSAL_V2_LEN = 163;
export const FREEZE_PROPOSAL_V2_LEN = 171;
export const CANCEL_PROPOSAL_V2_LEN = 167;
export const EXPIRE_PROPOSAL_V2_LEN = 163;
export const APPROVE_EMERGENCY_RESOLUTION_V1_LEN = 159;
export const QUEUE_EMERGENCY_RESOLUTION_V1_LEN = 159;
export const CONVERT_EMERGENCY_FREEZE_V2_LEN = 203;
export const CREATE_CHECKPOINT_ATTESTATION_V1_LEN = 489;
export const RECAST_CHECKPOINT_ATTESTATION_V1_LEN = 521;
export const FINALIZE_CHECKPOINT_V1_LEN = 488;
export const CREATE_CANDIDATE_COUNCIL_SET_V1_LEN = 186;
export const CREATE_COUNCIL_ROTATION_V1_LEN = 154;
export const APPROVE_COUNCIL_ROTATION_V1_LEN = 149;
export const ACTIVATE_COUNCIL_ROTATION_V1_LEN = 149;
export const QUEUE_COUNCIL_ROTATION_V1_LEN = 149;
export const EXPIRE_EMERGENCY_RESOLUTION_V1_LEN = 157;
export const CANCEL_COUNCIL_ROTATION_V1_LEN = 151;
export const EXPIRE_COUNCIL_ROTATION_V1_LEN = 147;

export const CheckpointSubjectStateV1 = Object.freeze({
  ProposalFrozen: 0,
  ProposalProgramDataVerified: 1,
  EmergencyResolutionTimelocked: 2,
} as const);
export type CheckpointSubjectStateV1Value =
  (typeof CheckpointSubjectStateV1)[keyof typeof CheckpointSubjectStateV1];

export interface CouncilSeatTermV1 {
  termStartSlot: bigint;
  termEndSlot: bigint;
}

export interface CheckpointCandidateV1 {
  phase: StateCheckpointPhaseV1Value;
  expectedSubjectState: CheckpointSubjectStateV1Value;
  expectedSubjectDigest: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  finalizedObservationSlot: bigint;
  targetProgramdataSlot: bigint;
  targetPayloadCommitment: Buffer;
  targetRawProgramdataCommitment: Buffer;
  targetCapacity: bigint;
  programOwnedStateRoot: Buffer;
  programOwnedStateCount: bigint;
  logicalCompressedStateRoot: Buffer;
  logicalCompressedStateCount: bigint;
  semanticCustodyAccountingRoot: Buffer;
  hardCombinedRoot: Buffer;
  externalMetadataObservationRoot: Buffer;
  externalRawBalanceObservationRoot: Buffer;
  schemaIdentifier: Buffer;
  admittedPositiveDonationRoot: Buffer;
  admittedPositiveDonationCount: bigint;
  forbiddenDriftCount: number;
  expectedCheckpointDigest: Buffer;
}

export interface CouncilRotationExpectationV1 {
  expectedRotationDigest: Buffer;
  expectedCurrentCouncilVersion: bigint;
  expectedCurrentCouncilHash: Buffer;
  expectedCandidateCouncilVersion: bigint;
  expectedCandidateCouncilHash: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedState: CouncilRotationStateV1Value;
  expectedNotBeforeSlot: bigint;
  expectedExpirySlot: bigint;
}

export interface InitializeControllerV1 {
  clusterDomain: Buffer;
  initialPolicyVersion: bigint;
  initialCouncilVersion: bigint;
  nextProposalId: bigint;
  targetNonce: bigint;
  initialGateEpoch: bigint;
  policyActivationSlot: bigint;
  routineDelaySlots: bigint;
  majorDelaySlots: bigint;
  rollbackDelaySlots: bigint;
  terminalDelaySlots: bigint;
  voteReviewSlots: bigint;
  proposalExpirySlots: bigint;
  expectedPolicyHash: Buffer;
  expectedCouncilHash: Buffer;
  seatTerms: readonly CouncilSeatTermV1[];
}

export interface CreateProposalV2 {
  proposalClass: ProposalClassV1Value;
  creationGateStatus: GateStatusV1Value;
  expectedProposalId: bigint;
  expectedTargetNonce: bigint;
  creationSlot: bigint;
  expectedPolicyVersion: bigint;
  expectedPolicyHash: Buffer;
  expectedCreationCouncilVersion: bigint;
  expectedCreationCouncilHash: Buffer;
  expectedCreationGateEpoch: bigint;
  expectedFreezeGateEpoch: bigint;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  sourceCommitHash: Buffer;
  sourceTreeHash: Buffer;
  buildInputInventoryHash: Buffer;
  reproducibleBuildReceiptHash: Buffer;
  packageReceiptHash: Buffer;
  releaseIntentHash: Buffer;
  expectedExecutionPrePayloadHash: Buffer;
  expectedExecutionPreChunkRoot: Buffer;
  currentRawProgramdataHash: Buffer;
  deployedSlot: bigint;
  currentCapacity: bigint;
  extensionDelta: bigint;
  expectedPostCapacity: bigint;
  checkpointSchemaId: Buffer;
  checkpointPolicyHash: Buffer;
  primaryProposal: OptionalInstructionPublicKeyV1;
  rollbackProposal: OptionalInstructionPublicKeyV1;
  rollbackBuffer: OptionalInstructionPublicKeyV1;
  rollbackArtifactSha256: Buffer;
  rollbackArtifactChunkRoot: Buffer;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  expectedProposalDigest: Buffer;
}

export interface ProposalWithApprovalsV2 {
  expected: ProposalExpectationV2;
  expectedApprovalBitset: number;
  expectedApprovalCount: number;
}

export type ApproveProposalV2 = ProposalWithApprovalsV2;
export type FinalizeGovernanceV2 = ProposalWithApprovalsV2;
export interface QueueProposalV2 { expected: ProposalExpectationV2 }
export interface FreezeProposalV2 { expected: ProposalExpectationV2; expectedNextGateEpoch: bigint }
export interface CancelProposalV2 {
  expected: ProposalExpectationV2;
  expectedCancellationApprovalBitset: number;
  expectedCancellationApprovalCount: number;
  cancellationReasonCode: number;
}
export interface ExpireProposalV2 { expected: ProposalExpectationV2 }

export interface EmergencyResolutionWithApprovalsV1 {
  expected: EmergencyResolutionExpectationV1;
  expectedApprovalBitset: number;
  expectedApprovalCount: number;
}
export type ApproveEmergencyResolutionV1 = EmergencyResolutionWithApprovalsV1;
export type QueueEmergencyResolutionV1 = EmergencyResolutionWithApprovalsV1;
export interface ConvertEmergencyFreezeV2 {
  expected: ProposalExpectationV2;
  expectedNextGateEpoch: bigint;
  expectedFreezeObservationDigest: Buffer;
}

export interface CreateCheckpointAttestationV1 {
  candidate: CheckpointCandidateV1;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
  seatIndex: number;
}
export interface RecastCheckpointAttestationV1 extends CreateCheckpointAttestationV1 {
  expectedPreviousAttestationDigest: Buffer;
}
export interface FinalizeCheckpointV1 {
  candidate: CheckpointCandidateV1;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
}
export interface CreateCandidateCouncilSetV1 {
  expectedCurrentCouncilVersion: bigint;
  expectedCurrentCouncilHash: Buffer;
  candidateCouncilVersion: bigint;
  activationSlot: bigint;
  expectedTargetNonce: bigint;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedCandidateCouncilHash: Buffer;
  seatTerms: readonly CouncilSeatTermV1[];
}
export interface CreateCouncilRotationV1 {
  creationSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  expectedCurrentCouncilVersion: bigint;
  expectedCurrentCouncilHash: Buffer;
  expectedCandidateCouncilVersion: bigint;
  expectedCandidateCouncilHash: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedRotationDigest: Buffer;
}
export interface CouncilRotationWithApprovalsV1 {
  expected: CouncilRotationExpectationV1;
  expectedApprovalBitset: number;
  expectedApprovalCount: number;
}
export type ApproveCouncilRotationV1 = CouncilRotationWithApprovalsV1;
export type ActivateCouncilRotationV1 = CouncilRotationWithApprovalsV1;
export type QueueCouncilRotationV1 = CouncilRotationWithApprovalsV1;
export interface ExpireEmergencyResolutionV1 { expected: EmergencyResolutionExpectationV1 }
export interface CancelCouncilRotationV1 {
  expected: CouncilRotationExpectationV1;
  expectedCancellationApprovalBitset: number;
  expectedCancellationApprovalCount: number;
  cancellationReasonCode: number;
}
export interface ExpireCouncilRotationV1 { expected: CouncilRotationExpectationV1 }

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function integer(value: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} is outside its fixed unsigned range`);
  }
}

function exactHash(value: Buffer, field: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new RangeError(`${field} must be 32 bytes`);
  }
  return value;
}

function exactKey(value: PublicKey, field: string): PublicKey {
  if (!(value instanceof PublicKey)) {
    throw new TypeError(`${field} must be a PublicKey`);
  }
  return value;
}

class Writer {
  readonly parts: Buffer[] = [];
  byte(value: number, field: string): this { integer(value, U8_MAX, field); this.parts.push(Buffer.from([value])); return this; }
  u16(value: number, field: string): this { integer(value, U16_MAX, field); const out = Buffer.alloc(2); out.writeUInt16LE(value); this.parts.push(out); return this; }
  u32(value: number, field: string): this { integer(value, U32_MAX, field); const out = Buffer.alloc(4); out.writeUInt32LE(value); this.parts.push(out); return this; }
  u64(value: bigint, field: string): this { if (typeof value !== "bigint" || value < 0n || value > U64_MAX) throw new RangeError(`${field} must be a u64`); const out = Buffer.alloc(8); out.writeBigUInt64LE(value); this.parts.push(out); return this; }
  bytes(value: Buffer, length: number, field: string): this { if (!Buffer.isBuffer(value) || value.length !== length) throw new RangeError(`${field} must be ${length} bytes`); this.parts.push(value); return this; }
  key(value: PublicKey, field: string): this { this.parts.push(exactKey(value, field).toBuffer()); return this; }
  optionalKey(value: OptionalInstructionPublicKeyV1, field: string): this {
    if (value.present) {
      if (value.value.equals(PublicKey.default)) throw new Error(`${field} cannot contain the default key`);
      return this.byte(1, `${field}.present`).key(value.value, `${field}.value`);
    }
    if (!value.value.equals(PublicKey.default)) throw new Error(`${field} absent form must contain the default key`);
    return this.byte(0, `${field}.present`).key(value.value, `${field}.value`);
  }
  finish(expectedLength: number): Buffer { const out = Buffer.concat(this.parts); if (out.length !== expectedLength) throw new Error(`internal codec length ${out.length} != ${expectedLength}`); return out; }
}

class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  bytes(length: number): Buffer { const end = this.offset + length; if (end > this.data.length) throw new Error("truncated instruction"); const out = Buffer.from(this.data.subarray(this.offset, end)); this.offset = end; return out; }
  byte(): number { return this.bytes(1)[0]!; }
  u16(): number { return this.bytes(2).readUInt16LE(); }
  u32(): number { return this.bytes(4).readUInt32LE(); }
  u64(): bigint { return this.bytes(8).readBigUInt64LE(); }
  key(): PublicKey { return new PublicKey(this.bytes(32)); }
  optionalKey(): OptionalInstructionPublicKeyV1 { const present = this.byte(); const value = this.key(); if (present === 0 && value.equals(PublicKey.default)) return { present: false, value }; if (present === 1 && !value.equals(PublicKey.default)) return { present: true, value }; throw new Error("noncanonical optional public key"); }
  finish(): void { if (this.offset !== this.data.length) throw new Error("trailing instruction bytes"); }
}

function enumValue<T extends number>(value: number, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) throw new Error(`unknown ${field}`);
  return value as T;
}
function gate(value: number): GateStatusV1Value { return enumValue(value, [GateStatusV1.Active, GateStatusV1.FrozenForUpgrade, GateStatusV1.EmergencyFrozen], "GateStatusV1"); }
function proposalClass(value: number): ProposalClassV1Value { return enumValue(value, [ProposalClassV1.RoutineUpgrade, ProposalClassV1.EmergencyRollback, ProposalClassV1.EconomicChange, ProposalClassV1.ConstitutionalChange], "ProposalClassV1"); }
function proposalState(value: number): ProposalStateV2Value { return enumValue(value, [ProposalStateV2.Draft, ProposalStateV2.BufferAdopted, ProposalStateV2.BufferVerified, ProposalStateV2.CouncilApproved, ProposalStateV2.GovernanceSatisfied, ProposalStateV2.Timelocked, ProposalStateV2.Frozen, ProposalStateV2.Extended, ProposalStateV2.UpgradeExecuted, ProposalStateV2.ProgramDataVerified, ProposalStateV2.PoststateAccepted, ProposalStateV2.UnfreezeApproved, ProposalStateV2.Completed, ProposalStateV2.Cancelled, ProposalStateV2.Expired, ProposalStateV2.SupersededByRollback, ProposalStateV2.Retired], "ProposalStateV2"); }
function checkpointPhase(value: number): StateCheckpointPhaseV1Value { return enumValue(value, [StateCheckpointPhaseV1.Prestate, StateCheckpointPhaseV1.Poststate, StateCheckpointPhaseV1.Emergency], "StateCheckpointPhaseV1"); }
function checkpointSubjectState(value: number): CheckpointSubjectStateV1Value { return enumValue(value, Object.values(CheckpointSubjectStateV1), "CheckpointSubjectStateV1"); }
function rotationState(value: number): CouncilRotationStateV1Value { return enumValue(value, Object.values(CouncilRotationStateV1), "CouncilRotationStateV1"); }
function emergencyState(value: number): EmergencyFreezeResolutionStateV1Value { return enumValue(value, Object.values(EmergencyFreezeResolutionStateV1), "EmergencyFreezeResolutionStateV1"); }

function encodeFixed(tag: number, length: number, write: (writer: Writer) => void): Buffer { const writer = new Writer().byte(tag, "tag"); write(writer); const out = writer.finish(length); if (out.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) throw new Error("instruction exceeds controller cap"); return out; }
function decodeFixed<T>(data: Buffer, tag: number, length: number, read: (reader: Reader) => T): T { if (!Buffer.isBuffer(data) || data.length !== length || data[0] !== tag || data.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) throw new Error("invalid fixed instruction"); const reader = new Reader(data.subarray(1)); const value = read(reader); reader.finish(); return value; }

function writeSeatTerm(writer: Writer, value: CouncilSeatTermV1): void { writer.u64(value.termStartSlot, "termStartSlot").u64(value.termEndSlot, "termEndSlot"); }
function readSeatTerm(reader: Reader): CouncilSeatTermV1 { return { termStartSlot: reader.u64(), termEndSlot: reader.u64() }; }

function writeProposalExpectation(writer: Writer, value: ProposalExpectationV2): void {
  writer.bytes(exactHash(value.expectedProposalDigest, "expectedProposalDigest"), 32, "expectedProposalDigest")
    .u64(value.expectedPolicyVersion, "expectedPolicyVersion").bytes(exactHash(value.expectedPolicyHash, "expectedPolicyHash"), 32, "expectedPolicyHash")
    .u64(value.expectedCouncilVersion, "expectedCouncilVersion").bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash")
    .byte(gate(value.expectedGateStatus), "expectedGateStatus").u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce")
    .byte(proposalState(value.expectedState), "expectedState").u64(value.expectedReviewStartSlot, "expectedReviewStartSlot").u64(value.expectedReviewEndSlot, "expectedReviewEndSlot")
    .u64(value.expectedNotBeforeSlot, "expectedNotBeforeSlot").u64(value.expectedExpirySlot, "expectedExpirySlot");
}
function readProposalExpectation(reader: Reader): ProposalExpectationV2 { return { expectedProposalDigest: reader.bytes(32), expectedPolicyVersion: reader.u64(), expectedPolicyHash: reader.bytes(32), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedState: proposalState(reader.byte()), expectedReviewStartSlot: reader.u64(), expectedReviewEndSlot: reader.u64(), expectedNotBeforeSlot: reader.u64(), expectedExpirySlot: reader.u64() }; }

function writeEmergencyExpectation(writer: Writer, value: EmergencyResolutionExpectationV1): void {
  writer.bytes(exactHash(value.expectedResolutionDigest, "expectedResolutionDigest"), 32, "expectedResolutionDigest").u64(value.expectedPolicyVersion, "expectedPolicyVersion")
    .bytes(exactHash(value.expectedPolicyHash, "expectedPolicyHash"), 32, "expectedPolicyHash").u64(value.expectedCouncilVersion, "expectedCouncilVersion")
    .bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash").byte(gate(value.expectedGateStatus), "expectedGateStatus")
    .u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedFreezeSlot, "expectedFreezeSlot").u16(value.expectedFreezeReasonCode, "expectedFreezeReasonCode")
    .u64(value.expectedTargetNonce, "expectedTargetNonce").byte(emergencyState(value.expectedState), "expectedState").u64(value.expectedNotBeforeSlot, "expectedNotBeforeSlot").u64(value.expectedExpirySlot, "expectedExpirySlot");
}
function readEmergencyExpectation(reader: Reader): EmergencyResolutionExpectationV1 { return { expectedResolutionDigest: reader.bytes(32), expectedPolicyVersion: reader.u64(), expectedPolicyHash: reader.bytes(32), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), expectedFreezeSlot: reader.u64(), expectedFreezeReasonCode: reader.u16(), expectedTargetNonce: reader.u64(), expectedState: emergencyState(reader.byte()), expectedNotBeforeSlot: reader.u64(), expectedExpirySlot: reader.u64() }; }

function writeCheckpointCandidate(writer: Writer, value: CheckpointCandidateV1): void {
  writer.byte(checkpointPhase(value.phase), "phase").byte(checkpointSubjectState(value.expectedSubjectState), "expectedSubjectState").bytes(exactHash(value.expectedSubjectDigest, "expectedSubjectDigest"), 32, "expectedSubjectDigest")
    .byte(gate(value.expectedGateStatus), "expectedGateStatus").u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.finalizedObservationSlot, "finalizedObservationSlot")
    .u64(value.targetProgramdataSlot, "targetProgramdataSlot").bytes(exactHash(value.targetPayloadCommitment, "targetPayloadCommitment"), 32, "targetPayloadCommitment")
    .bytes(exactHash(value.targetRawProgramdataCommitment, "targetRawProgramdataCommitment"), 32, "targetRawProgramdataCommitment").u64(value.targetCapacity, "targetCapacity")
    .bytes(exactHash(value.programOwnedStateRoot, "programOwnedStateRoot"), 32, "programOwnedStateRoot").u64(value.programOwnedStateCount, "programOwnedStateCount")
    .bytes(exactHash(value.logicalCompressedStateRoot, "logicalCompressedStateRoot"), 32, "logicalCompressedStateRoot").u64(value.logicalCompressedStateCount, "logicalCompressedStateCount")
    .bytes(exactHash(value.semanticCustodyAccountingRoot, "semanticCustodyAccountingRoot"), 32, "semanticCustodyAccountingRoot")
    .bytes(exactHash(value.hardCombinedRoot, "hardCombinedRoot"), 32, "hardCombinedRoot").bytes(exactHash(value.externalMetadataObservationRoot, "externalMetadataObservationRoot"), 32, "externalMetadataObservationRoot")
    .bytes(exactHash(value.externalRawBalanceObservationRoot, "externalRawBalanceObservationRoot"), 32, "externalRawBalanceObservationRoot").bytes(exactHash(value.schemaIdentifier, "schemaIdentifier"), 32, "schemaIdentifier")
    .bytes(exactHash(value.admittedPositiveDonationRoot, "admittedPositiveDonationRoot"), 32, "admittedPositiveDonationRoot").u64(value.admittedPositiveDonationCount, "admittedPositiveDonationCount")
    .u32(value.forbiddenDriftCount, "forbiddenDriftCount").bytes(exactHash(value.expectedCheckpointDigest, "expectedCheckpointDigest"), 32, "expectedCheckpointDigest");
}
function readCheckpointCandidate(reader: Reader): CheckpointCandidateV1 { return { phase: checkpointPhase(reader.byte()), expectedSubjectState: checkpointSubjectState(reader.byte()), expectedSubjectDigest: reader.bytes(32), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), finalizedObservationSlot: reader.u64(), targetProgramdataSlot: reader.u64(), targetPayloadCommitment: reader.bytes(32), targetRawProgramdataCommitment: reader.bytes(32), targetCapacity: reader.u64(), programOwnedStateRoot: reader.bytes(32), programOwnedStateCount: reader.u64(), logicalCompressedStateRoot: reader.bytes(32), logicalCompressedStateCount: reader.u64(), semanticCustodyAccountingRoot: reader.bytes(32), hardCombinedRoot: reader.bytes(32), externalMetadataObservationRoot: reader.bytes(32), externalRawBalanceObservationRoot: reader.bytes(32), schemaIdentifier: reader.bytes(32), admittedPositiveDonationRoot: reader.bytes(32), admittedPositiveDonationCount: reader.u64(), forbiddenDriftCount: reader.u32(), expectedCheckpointDigest: reader.bytes(32) }; }

function writeRotationExpectation(writer: Writer, value: CouncilRotationExpectationV1): void { writer.bytes(exactHash(value.expectedRotationDigest, "expectedRotationDigest"), 32, "expectedRotationDigest").u64(value.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion").bytes(exactHash(value.expectedCurrentCouncilHash, "expectedCurrentCouncilHash"), 32, "expectedCurrentCouncilHash").u64(value.expectedCandidateCouncilVersion, "expectedCandidateCouncilVersion").bytes(exactHash(value.expectedCandidateCouncilHash, "expectedCandidateCouncilHash"), 32, "expectedCandidateCouncilHash").byte(gate(value.expectedGateStatus), "expectedGateStatus").u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce").byte(rotationState(value.expectedState), "expectedState").u64(value.expectedNotBeforeSlot, "expectedNotBeforeSlot").u64(value.expectedExpirySlot, "expectedExpirySlot"); }
function readRotationExpectation(reader: Reader): CouncilRotationExpectationV1 { return { expectedRotationDigest: reader.bytes(32), expectedCurrentCouncilVersion: reader.u64(), expectedCurrentCouncilHash: reader.bytes(32), expectedCandidateCouncilVersion: reader.u64(), expectedCandidateCouncilHash: reader.bytes(32), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedState: rotationState(reader.byte()), expectedNotBeforeSlot: reader.u64(), expectedExpirySlot: reader.u64() }; }

export function encodeInitializeControllerV1(value: InitializeControllerV1): Buffer {
  if (value.seatTerms.length !== 5) throw new RangeError("seatTerms must contain exactly five entries");
  return encodeFixed(INITIALIZE_CONTROLLER_V1_TAG, INITIALIZE_CONTROLLER_V1_LEN, (writer) => {
    writer.bytes(exactHash(value.clusterDomain, "clusterDomain"), 32, "clusterDomain")
      .u64(value.initialPolicyVersion, "initialPolicyVersion").u64(value.initialCouncilVersion, "initialCouncilVersion")
      .u64(value.nextProposalId, "nextProposalId").u64(value.targetNonce, "targetNonce").u64(value.initialGateEpoch, "initialGateEpoch")
      .u64(value.policyActivationSlot, "policyActivationSlot").u64(value.routineDelaySlots, "routineDelaySlots").u64(value.majorDelaySlots, "majorDelaySlots")
      .u64(value.rollbackDelaySlots, "rollbackDelaySlots").u64(value.terminalDelaySlots, "terminalDelaySlots").u64(value.voteReviewSlots, "voteReviewSlots")
      .u64(value.proposalExpirySlots, "proposalExpirySlots").bytes(exactHash(value.expectedPolicyHash, "expectedPolicyHash"), 32, "expectedPolicyHash")
      .bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash");
    for (const term of value.seatTerms) writeSeatTerm(writer, term);
  });
}

export function decodeInitializeControllerV1(data: Buffer): InitializeControllerV1 {
  return decodeFixed(data, INITIALIZE_CONTROLLER_V1_TAG, INITIALIZE_CONTROLLER_V1_LEN, (reader) => ({
    clusterDomain: reader.bytes(32), initialPolicyVersion: reader.u64(), initialCouncilVersion: reader.u64(), nextProposalId: reader.u64(), targetNonce: reader.u64(), initialGateEpoch: reader.u64(), policyActivationSlot: reader.u64(), routineDelaySlots: reader.u64(), majorDelaySlots: reader.u64(), rollbackDelaySlots: reader.u64(), terminalDelaySlots: reader.u64(), voteReviewSlots: reader.u64(), proposalExpirySlots: reader.u64(), expectedPolicyHash: reader.bytes(32), expectedCouncilHash: reader.bytes(32), seatTerms: Array.from({ length: 5 }, () => readSeatTerm(reader)),
  }));
}

export function encodeCreateProposalV2(value: CreateProposalV2): Buffer {
  return encodeFixed(CREATE_PROPOSAL_V2_TAG, CREATE_PROPOSAL_V2_LEN, (writer) => {
    writer.byte(proposalClass(value.proposalClass), "proposalClass").byte(gate(value.creationGateStatus), "creationGateStatus")
      .u64(value.expectedProposalId, "expectedProposalId").u64(value.expectedTargetNonce, "expectedTargetNonce").u64(value.creationSlot, "creationSlot")
      .u64(value.expectedPolicyVersion, "expectedPolicyVersion").bytes(exactHash(value.expectedPolicyHash, "expectedPolicyHash"), 32, "expectedPolicyHash")
      .u64(value.expectedCreationCouncilVersion, "expectedCreationCouncilVersion").bytes(exactHash(value.expectedCreationCouncilHash, "expectedCreationCouncilHash"), 32, "expectedCreationCouncilHash")
      .u64(value.expectedCreationGateEpoch, "expectedCreationGateEpoch").u64(value.expectedFreezeGateEpoch, "expectedFreezeGateEpoch").u64(value.artifactLength, "artifactLength")
      .bytes(exactHash(value.artifactSha256, "artifactSha256"), 32, "artifactSha256").bytes(exactHash(value.artifactChunkMerkleRoot, "artifactChunkMerkleRoot"), 32, "artifactChunkMerkleRoot")
      .bytes(exactHash(value.sourceCommitHash, "sourceCommitHash"), 32, "sourceCommitHash").bytes(exactHash(value.sourceTreeHash, "sourceTreeHash"), 32, "sourceTreeHash")
      .bytes(exactHash(value.buildInputInventoryHash, "buildInputInventoryHash"), 32, "buildInputInventoryHash").bytes(exactHash(value.reproducibleBuildReceiptHash, "reproducibleBuildReceiptHash"), 32, "reproducibleBuildReceiptHash")
      .bytes(exactHash(value.packageReceiptHash, "packageReceiptHash"), 32, "packageReceiptHash").bytes(exactHash(value.releaseIntentHash, "releaseIntentHash"), 32, "releaseIntentHash")
      .bytes(exactHash(value.expectedExecutionPrePayloadHash, "expectedExecutionPrePayloadHash"), 32, "expectedExecutionPrePayloadHash").bytes(exactHash(value.expectedExecutionPreChunkRoot, "expectedExecutionPreChunkRoot"), 32, "expectedExecutionPreChunkRoot")
      .bytes(exactHash(value.currentRawProgramdataHash, "currentRawProgramdataHash"), 32, "currentRawProgramdataHash").u64(value.deployedSlot, "deployedSlot")
      .u64(value.currentCapacity, "currentCapacity").u64(value.extensionDelta, "extensionDelta").u64(value.expectedPostCapacity, "expectedPostCapacity")
      .bytes(exactHash(value.checkpointSchemaId, "checkpointSchemaId"), 32, "checkpointSchemaId").bytes(exactHash(value.checkpointPolicyHash, "checkpointPolicyHash"), 32, "checkpointPolicyHash")
      .optionalKey(value.primaryProposal, "primaryProposal").optionalKey(value.rollbackProposal, "rollbackProposal").optionalKey(value.rollbackBuffer, "rollbackBuffer")
      .bytes(exactHash(value.rollbackArtifactSha256, "rollbackArtifactSha256"), 32, "rollbackArtifactSha256").bytes(exactHash(value.rollbackArtifactChunkRoot, "rollbackArtifactChunkRoot"), 32, "rollbackArtifactChunkRoot")
      .u64(value.reviewStartSlot, "reviewStartSlot").u64(value.reviewEndSlot, "reviewEndSlot").u64(value.notBeforeSlot, "notBeforeSlot").u64(value.expirySlot, "expirySlot")
      .bytes(exactHash(value.expectedProposalDigest, "expectedProposalDigest"), 32, "expectedProposalDigest");
  });
}

export function decodeCreateProposalV2(data: Buffer): CreateProposalV2 {
  return decodeFixed(data, CREATE_PROPOSAL_V2_TAG, CREATE_PROPOSAL_V2_LEN, (reader) => ({
    proposalClass: proposalClass(reader.byte()), creationGateStatus: gate(reader.byte()), expectedProposalId: reader.u64(), expectedTargetNonce: reader.u64(), creationSlot: reader.u64(), expectedPolicyVersion: reader.u64(), expectedPolicyHash: reader.bytes(32), expectedCreationCouncilVersion: reader.u64(), expectedCreationCouncilHash: reader.bytes(32), expectedCreationGateEpoch: reader.u64(), expectedFreezeGateEpoch: reader.u64(), artifactLength: reader.u64(), artifactSha256: reader.bytes(32), artifactChunkMerkleRoot: reader.bytes(32), sourceCommitHash: reader.bytes(32), sourceTreeHash: reader.bytes(32), buildInputInventoryHash: reader.bytes(32), reproducibleBuildReceiptHash: reader.bytes(32), packageReceiptHash: reader.bytes(32), releaseIntentHash: reader.bytes(32), expectedExecutionPrePayloadHash: reader.bytes(32), expectedExecutionPreChunkRoot: reader.bytes(32), currentRawProgramdataHash: reader.bytes(32), deployedSlot: reader.u64(), currentCapacity: reader.u64(), extensionDelta: reader.u64(), expectedPostCapacity: reader.u64(), checkpointSchemaId: reader.bytes(32), checkpointPolicyHash: reader.bytes(32), primaryProposal: reader.optionalKey(), rollbackProposal: reader.optionalKey(), rollbackBuffer: reader.optionalKey(), rollbackArtifactSha256: reader.bytes(32), rollbackArtifactChunkRoot: reader.bytes(32), reviewStartSlot: reader.u64(), reviewEndSlot: reader.u64(), notBeforeSlot: reader.u64(), expirySlot: reader.u64(), expectedProposalDigest: reader.bytes(32),
  }));
}

function encodeProposalWithApprovals(tag: number, length: number, value: ProposalWithApprovalsV2): Buffer { return encodeFixed(tag, length, (writer) => { writeProposalExpectation(writer, value.expected); writer.byte(value.expectedApprovalBitset, "expectedApprovalBitset").byte(value.expectedApprovalCount, "expectedApprovalCount"); }); }
function decodeProposalWithApprovals(data: Buffer, tag: number, length: number): ProposalWithApprovalsV2 { return decodeFixed(data, tag, length, (reader) => ({ expected: readProposalExpectation(reader), expectedApprovalBitset: reader.byte(), expectedApprovalCount: reader.byte() })); }
export function encodeApproveProposalV2(value: ApproveProposalV2): Buffer { return encodeProposalWithApprovals(APPROVE_PROPOSAL_V2_TAG, APPROVE_PROPOSAL_V2_LEN, value); }
export function decodeApproveProposalV2(data: Buffer): ApproveProposalV2 { return decodeProposalWithApprovals(data, APPROVE_PROPOSAL_V2_TAG, APPROVE_PROPOSAL_V2_LEN); }
export function encodeFinalizeGovernanceV2(value: FinalizeGovernanceV2): Buffer { return encodeProposalWithApprovals(FINALIZE_GOVERNANCE_V2_TAG, FINALIZE_GOVERNANCE_V2_LEN, value); }
export function decodeFinalizeGovernanceV2(data: Buffer): FinalizeGovernanceV2 { return decodeProposalWithApprovals(data, FINALIZE_GOVERNANCE_V2_TAG, FINALIZE_GOVERNANCE_V2_LEN); }
export function encodeQueueProposalV2(value: QueueProposalV2): Buffer { return encodeFixed(QUEUE_PROPOSAL_V2_TAG, QUEUE_PROPOSAL_V2_LEN, (writer) => writeProposalExpectation(writer, value.expected)); }
export function decodeQueueProposalV2(data: Buffer): QueueProposalV2 { return decodeFixed(data, QUEUE_PROPOSAL_V2_TAG, QUEUE_PROPOSAL_V2_LEN, (reader) => ({ expected: readProposalExpectation(reader) })); }
export function encodeFreezeProposalV2(value: FreezeProposalV2): Buffer { return encodeFixed(FREEZE_PROPOSAL_V2_TAG, FREEZE_PROPOSAL_V2_LEN, (writer) => { writeProposalExpectation(writer, value.expected); writer.u64(value.expectedNextGateEpoch, "expectedNextGateEpoch"); }); }
export function decodeFreezeProposalV2(data: Buffer): FreezeProposalV2 { return decodeFixed(data, FREEZE_PROPOSAL_V2_TAG, FREEZE_PROPOSAL_V2_LEN, (reader) => ({ expected: readProposalExpectation(reader), expectedNextGateEpoch: reader.u64() })); }
export function encodeCancelProposalV2(value: CancelProposalV2): Buffer { return encodeFixed(CANCEL_PROPOSAL_V2_TAG, CANCEL_PROPOSAL_V2_LEN, (writer) => { writeProposalExpectation(writer, value.expected); writer.byte(value.expectedCancellationApprovalBitset, "expectedCancellationApprovalBitset").byte(value.expectedCancellationApprovalCount, "expectedCancellationApprovalCount").u16(value.cancellationReasonCode, "cancellationReasonCode"); }); }
export function decodeCancelProposalV2(data: Buffer): CancelProposalV2 { return decodeFixed(data, CANCEL_PROPOSAL_V2_TAG, CANCEL_PROPOSAL_V2_LEN, (reader) => ({ expected: readProposalExpectation(reader), expectedCancellationApprovalBitset: reader.byte(), expectedCancellationApprovalCount: reader.byte(), cancellationReasonCode: reader.u16() })); }
export function encodeExpireProposalV2(value: ExpireProposalV2): Buffer { return encodeFixed(EXPIRE_PROPOSAL_V2_TAG, EXPIRE_PROPOSAL_V2_LEN, (writer) => writeProposalExpectation(writer, value.expected)); }
export function decodeExpireProposalV2(data: Buffer): ExpireProposalV2 { return decodeFixed(data, EXPIRE_PROPOSAL_V2_TAG, EXPIRE_PROPOSAL_V2_LEN, (reader) => ({ expected: readProposalExpectation(reader) })); }

function encodeEmergencyWithApprovals(tag: number, length: number, value: EmergencyResolutionWithApprovalsV1): Buffer { return encodeFixed(tag, length, (writer) => { writeEmergencyExpectation(writer, value.expected); writer.byte(value.expectedApprovalBitset, "expectedApprovalBitset").byte(value.expectedApprovalCount, "expectedApprovalCount"); }); }
function decodeEmergencyWithApprovals(data: Buffer, tag: number, length: number): EmergencyResolutionWithApprovalsV1 { return decodeFixed(data, tag, length, (reader) => ({ expected: readEmergencyExpectation(reader), expectedApprovalBitset: reader.byte(), expectedApprovalCount: reader.byte() })); }
export function encodeApproveEmergencyResolutionV1(value: ApproveEmergencyResolutionV1): Buffer { return encodeEmergencyWithApprovals(APPROVE_EMERGENCY_RESOLUTION_V1_TAG, APPROVE_EMERGENCY_RESOLUTION_V1_LEN, value); }
export function decodeApproveEmergencyResolutionV1(data: Buffer): ApproveEmergencyResolutionV1 { return decodeEmergencyWithApprovals(data, APPROVE_EMERGENCY_RESOLUTION_V1_TAG, APPROVE_EMERGENCY_RESOLUTION_V1_LEN); }
export function encodeQueueEmergencyResolutionV1(value: QueueEmergencyResolutionV1): Buffer { return encodeEmergencyWithApprovals(QUEUE_EMERGENCY_RESOLUTION_V1_TAG, QUEUE_EMERGENCY_RESOLUTION_V1_LEN, value); }
export function decodeQueueEmergencyResolutionV1(data: Buffer): QueueEmergencyResolutionV1 { return decodeEmergencyWithApprovals(data, QUEUE_EMERGENCY_RESOLUTION_V1_TAG, QUEUE_EMERGENCY_RESOLUTION_V1_LEN); }

export function encodeConvertEmergencyFreezeV2(value: ConvertEmergencyFreezeV2): Buffer { return encodeFixed(CONVERT_EMERGENCY_FREEZE_V2_TAG, CONVERT_EMERGENCY_FREEZE_V2_LEN, (writer) => { writeProposalExpectation(writer, value.expected); writer.u64(value.expectedNextGateEpoch, "expectedNextGateEpoch").bytes(exactHash(value.expectedFreezeObservationDigest, "expectedFreezeObservationDigest"), 32, "expectedFreezeObservationDigest"); }); }
export function decodeConvertEmergencyFreezeV2(data: Buffer): ConvertEmergencyFreezeV2 { return decodeFixed(data, CONVERT_EMERGENCY_FREEZE_V2_TAG, CONVERT_EMERGENCY_FREEZE_V2_LEN, (reader) => ({ expected: readProposalExpectation(reader), expectedNextGateEpoch: reader.u64(), expectedFreezeObservationDigest: reader.bytes(32) })); }

export function encodeCreateCheckpointAttestationV1(value: CreateCheckpointAttestationV1): Buffer { return encodeFixed(CREATE_CHECKPOINT_ATTESTATION_V1_TAG, CREATE_CHECKPOINT_ATTESTATION_V1_LEN, (writer) => { writeCheckpointCandidate(writer, value.candidate); writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion").bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash").byte(value.seatIndex, "seatIndex"); }); }
export function decodeCreateCheckpointAttestationV1(data: Buffer): CreateCheckpointAttestationV1 { return decodeFixed(data, CREATE_CHECKPOINT_ATTESTATION_V1_TAG, CREATE_CHECKPOINT_ATTESTATION_V1_LEN, (reader) => ({ candidate: readCheckpointCandidate(reader), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32), seatIndex: reader.byte() })); }
export function encodeRecastCheckpointAttestationV1(value: RecastCheckpointAttestationV1): Buffer { return encodeFixed(RECAST_CHECKPOINT_ATTESTATION_V1_TAG, RECAST_CHECKPOINT_ATTESTATION_V1_LEN, (writer) => { writeCheckpointCandidate(writer, value.candidate); writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion").bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash").byte(value.seatIndex, "seatIndex").bytes(exactHash(value.expectedPreviousAttestationDigest, "expectedPreviousAttestationDigest"), 32, "expectedPreviousAttestationDigest"); }); }
export function decodeRecastCheckpointAttestationV1(data: Buffer): RecastCheckpointAttestationV1 { return decodeFixed(data, RECAST_CHECKPOINT_ATTESTATION_V1_TAG, RECAST_CHECKPOINT_ATTESTATION_V1_LEN, (reader) => ({ candidate: readCheckpointCandidate(reader), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32), seatIndex: reader.byte(), expectedPreviousAttestationDigest: reader.bytes(32) })); }
export function encodeFinalizeCheckpointV1(value: FinalizeCheckpointV1): Buffer { return encodeFixed(FINALIZE_CHECKPOINT_V1_TAG, FINALIZE_CHECKPOINT_V1_LEN, (writer) => { writeCheckpointCandidate(writer, value.candidate); writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion").bytes(exactHash(value.expectedCouncilHash, "expectedCouncilHash"), 32, "expectedCouncilHash"); }); }
export function decodeFinalizeCheckpointV1(data: Buffer): FinalizeCheckpointV1 { return decodeFixed(data, FINALIZE_CHECKPOINT_V1_TAG, FINALIZE_CHECKPOINT_V1_LEN, (reader) => ({ candidate: readCheckpointCandidate(reader), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32) })); }

export function encodeCreateCandidateCouncilSetV1(value: CreateCandidateCouncilSetV1): Buffer {
  if (value.seatTerms.length !== 5) throw new RangeError("seatTerms must contain exactly five entries");
  return encodeFixed(CREATE_CANDIDATE_COUNCIL_SET_V1_TAG, CREATE_CANDIDATE_COUNCIL_SET_V1_LEN, (writer) => {
    writer.u64(value.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion").bytes(exactHash(value.expectedCurrentCouncilHash, "expectedCurrentCouncilHash"), 32, "expectedCurrentCouncilHash")
      .u64(value.candidateCouncilVersion, "candidateCouncilVersion").u64(value.activationSlot, "activationSlot").u64(value.expectedTargetNonce, "expectedTargetNonce")
      .byte(gate(value.expectedGateStatus), "expectedGateStatus").u64(value.expectedGateEpoch, "expectedGateEpoch")
      .bytes(exactHash(value.expectedCandidateCouncilHash, "expectedCandidateCouncilHash"), 32, "expectedCandidateCouncilHash");
    for (const term of value.seatTerms) writeSeatTerm(writer, term);
  });
}
export function decodeCreateCandidateCouncilSetV1(data: Buffer): CreateCandidateCouncilSetV1 { return decodeFixed(data, CREATE_CANDIDATE_COUNCIL_SET_V1_TAG, CREATE_CANDIDATE_COUNCIL_SET_V1_LEN, (reader) => ({ expectedCurrentCouncilVersion: reader.u64(), expectedCurrentCouncilHash: reader.bytes(32), candidateCouncilVersion: reader.u64(), activationSlot: reader.u64(), expectedTargetNonce: reader.u64(), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), expectedCandidateCouncilHash: reader.bytes(32), seatTerms: Array.from({ length: 5 }, () => readSeatTerm(reader)) })); }

export function encodeCreateCouncilRotationV1(value: CreateCouncilRotationV1): Buffer { return encodeFixed(CREATE_COUNCIL_ROTATION_V1_TAG, CREATE_COUNCIL_ROTATION_V1_LEN, (writer) => writer.u64(value.creationSlot, "creationSlot").u64(value.notBeforeSlot, "notBeforeSlot").u64(value.expirySlot, "expirySlot").u64(value.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion").bytes(exactHash(value.expectedCurrentCouncilHash, "expectedCurrentCouncilHash"), 32, "expectedCurrentCouncilHash").u64(value.expectedCandidateCouncilVersion, "expectedCandidateCouncilVersion").bytes(exactHash(value.expectedCandidateCouncilHash, "expectedCandidateCouncilHash"), 32, "expectedCandidateCouncilHash").byte(gate(value.expectedGateStatus), "expectedGateStatus").u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce").bytes(exactHash(value.expectedRotationDigest, "expectedRotationDigest"), 32, "expectedRotationDigest")); }
export function decodeCreateCouncilRotationV1(data: Buffer): CreateCouncilRotationV1 { return decodeFixed(data, CREATE_COUNCIL_ROTATION_V1_TAG, CREATE_COUNCIL_ROTATION_V1_LEN, (reader) => ({ creationSlot: reader.u64(), notBeforeSlot: reader.u64(), expirySlot: reader.u64(), expectedCurrentCouncilVersion: reader.u64(), expectedCurrentCouncilHash: reader.bytes(32), expectedCandidateCouncilVersion: reader.u64(), expectedCandidateCouncilHash: reader.bytes(32), expectedGateStatus: gate(reader.byte()), expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedRotationDigest: reader.bytes(32) })); }

function encodeRotationWithApprovals(tag: number, length: number, value: CouncilRotationWithApprovalsV1): Buffer { return encodeFixed(tag, length, (writer) => { writeRotationExpectation(writer, value.expected); writer.byte(value.expectedApprovalBitset, "expectedApprovalBitset").byte(value.expectedApprovalCount, "expectedApprovalCount"); }); }
function decodeRotationWithApprovals(data: Buffer, tag: number, length: number): CouncilRotationWithApprovalsV1 { return decodeFixed(data, tag, length, (reader) => ({ expected: readRotationExpectation(reader), expectedApprovalBitset: reader.byte(), expectedApprovalCount: reader.byte() })); }
export function encodeApproveCouncilRotationV1(value: ApproveCouncilRotationV1): Buffer { return encodeRotationWithApprovals(APPROVE_COUNCIL_ROTATION_V1_TAG, APPROVE_COUNCIL_ROTATION_V1_LEN, value); }
export function decodeApproveCouncilRotationV1(data: Buffer): ApproveCouncilRotationV1 { return decodeRotationWithApprovals(data, APPROVE_COUNCIL_ROTATION_V1_TAG, APPROVE_COUNCIL_ROTATION_V1_LEN); }
export function encodeActivateCouncilRotationV1(value: ActivateCouncilRotationV1): Buffer { return encodeRotationWithApprovals(ACTIVATE_COUNCIL_ROTATION_V1_TAG, ACTIVATE_COUNCIL_ROTATION_V1_LEN, value); }
export function decodeActivateCouncilRotationV1(data: Buffer): ActivateCouncilRotationV1 { return decodeRotationWithApprovals(data, ACTIVATE_COUNCIL_ROTATION_V1_TAG, ACTIVATE_COUNCIL_ROTATION_V1_LEN); }
export function encodeQueueCouncilRotationV1(value: QueueCouncilRotationV1): Buffer { return encodeRotationWithApprovals(QUEUE_COUNCIL_ROTATION_V1_TAG, QUEUE_COUNCIL_ROTATION_V1_LEN, value); }
export function decodeQueueCouncilRotationV1(data: Buffer): QueueCouncilRotationV1 { return decodeRotationWithApprovals(data, QUEUE_COUNCIL_ROTATION_V1_TAG, QUEUE_COUNCIL_ROTATION_V1_LEN); }
export function encodeExpireEmergencyResolutionV1(value: ExpireEmergencyResolutionV1): Buffer { return encodeFixed(EXPIRE_EMERGENCY_RESOLUTION_V1_TAG, EXPIRE_EMERGENCY_RESOLUTION_V1_LEN, (writer) => writeEmergencyExpectation(writer, value.expected)); }
export function decodeExpireEmergencyResolutionV1(data: Buffer): ExpireEmergencyResolutionV1 { return decodeFixed(data, EXPIRE_EMERGENCY_RESOLUTION_V1_TAG, EXPIRE_EMERGENCY_RESOLUTION_V1_LEN, (reader) => ({ expected: readEmergencyExpectation(reader) })); }
export function encodeCancelCouncilRotationV1(value: CancelCouncilRotationV1): Buffer { return encodeFixed(CANCEL_COUNCIL_ROTATION_V1_TAG, CANCEL_COUNCIL_ROTATION_V1_LEN, (writer) => { writeRotationExpectation(writer, value.expected); writer.byte(value.expectedCancellationApprovalBitset, "expectedCancellationApprovalBitset").byte(value.expectedCancellationApprovalCount, "expectedCancellationApprovalCount").u16(value.cancellationReasonCode, "cancellationReasonCode"); }); }
export function decodeCancelCouncilRotationV1(data: Buffer): CancelCouncilRotationV1 { return decodeFixed(data, CANCEL_COUNCIL_ROTATION_V1_TAG, CANCEL_COUNCIL_ROTATION_V1_LEN, (reader) => ({ expected: readRotationExpectation(reader), expectedCancellationApprovalBitset: reader.byte(), expectedCancellationApprovalCount: reader.byte(), cancellationReasonCode: reader.u16() })); }
export function encodeExpireCouncilRotationV1(value: ExpireCouncilRotationV1): Buffer { return encodeFixed(EXPIRE_COUNCIL_ROTATION_V1_TAG, EXPIRE_COUNCIL_ROTATION_V1_LEN, (writer) => writeRotationExpectation(writer, value.expected)); }
export function decodeExpireCouncilRotationV1(data: Buffer): ExpireCouncilRotationV1 { return decodeFixed(data, EXPIRE_COUNCIL_ROTATION_V1_TAG, EXPIRE_COUNCIL_ROTATION_V1_LEN, (reader) => ({ expected: readRotationExpectation(reader) })); }

export type Release1LifecycleInstructionV1 =
  | { tag: typeof INITIALIZE_CONTROLLER_V1_TAG; value: InitializeControllerV1 }
  | { tag: typeof CREATE_PROPOSAL_V2_TAG; value: CreateProposalV2 }
  | { tag: typeof APPROVE_PROPOSAL_V2_TAG; value: ApproveProposalV2 }
  | { tag: typeof FINALIZE_GOVERNANCE_V2_TAG; value: FinalizeGovernanceV2 }
  | { tag: typeof QUEUE_PROPOSAL_V2_TAG; value: QueueProposalV2 }
  | { tag: typeof FREEZE_PROPOSAL_V2_TAG; value: FreezeProposalV2 }
  | { tag: typeof CANCEL_PROPOSAL_V2_TAG; value: CancelProposalV2 }
  | { tag: typeof EXPIRE_PROPOSAL_V2_TAG; value: ExpireProposalV2 }
  | { tag: typeof APPROVE_EMERGENCY_RESOLUTION_V1_TAG; value: ApproveEmergencyResolutionV1 }
  | { tag: typeof QUEUE_EMERGENCY_RESOLUTION_V1_TAG; value: QueueEmergencyResolutionV1 }
  | { tag: typeof CONVERT_EMERGENCY_FREEZE_V2_TAG; value: ConvertEmergencyFreezeV2 }
  | { tag: typeof CREATE_CHECKPOINT_ATTESTATION_V1_TAG; value: CreateCheckpointAttestationV1 }
  | { tag: typeof RECAST_CHECKPOINT_ATTESTATION_V1_TAG; value: RecastCheckpointAttestationV1 }
  | { tag: typeof FINALIZE_CHECKPOINT_V1_TAG; value: FinalizeCheckpointV1 }
  | { tag: typeof CREATE_CANDIDATE_COUNCIL_SET_V1_TAG; value: CreateCandidateCouncilSetV1 }
  | { tag: typeof CREATE_COUNCIL_ROTATION_V1_TAG; value: CreateCouncilRotationV1 }
  | { tag: typeof APPROVE_COUNCIL_ROTATION_V1_TAG; value: ApproveCouncilRotationV1 }
  | { tag: typeof ACTIVATE_COUNCIL_ROTATION_V1_TAG; value: ActivateCouncilRotationV1 }
  | { tag: typeof QUEUE_COUNCIL_ROTATION_V1_TAG; value: QueueCouncilRotationV1 }
  | { tag: typeof EXPIRE_EMERGENCY_RESOLUTION_V1_TAG; value: ExpireEmergencyResolutionV1 }
  | { tag: typeof CANCEL_COUNCIL_ROTATION_V1_TAG; value: CancelCouncilRotationV1 }
  | { tag: typeof EXPIRE_COUNCIL_ROTATION_V1_TAG; value: ExpireCouncilRotationV1 };

export type Release1InstructionV1 = Release1LifecycleInstructionV1 | Release1LoaderInstructionV1;

/** Strictly decodes only the executable Release 1 tag set. Legacy tag 0,
 * reserved tag 26, unknown tags, trailing bytes, and oversized data all fail. */
export function decodeRelease1InstructionV1(data: Buffer): Release1InstructionV1 {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) throw new Error("invalid controller instruction length");
  switch (data[0]) {
    case INITIALIZE_CONTROLLER_V1_TAG: return { tag: INITIALIZE_CONTROLLER_V1_TAG, value: decodeInitializeControllerV1(data) };
    case CREATE_PROPOSAL_V2_TAG: return { tag: CREATE_PROPOSAL_V2_TAG, value: decodeCreateProposalV2(data) };
    case APPROVE_PROPOSAL_V2_TAG: return { tag: APPROVE_PROPOSAL_V2_TAG, value: decodeApproveProposalV2(data) };
    case FINALIZE_GOVERNANCE_V2_TAG: return { tag: FINALIZE_GOVERNANCE_V2_TAG, value: decodeFinalizeGovernanceV2(data) };
    case QUEUE_PROPOSAL_V2_TAG: return { tag: QUEUE_PROPOSAL_V2_TAG, value: decodeQueueProposalV2(data) };
    case FREEZE_PROPOSAL_V2_TAG: return { tag: FREEZE_PROPOSAL_V2_TAG, value: decodeFreezeProposalV2(data) };
    case CANCEL_PROPOSAL_V2_TAG: return { tag: CANCEL_PROPOSAL_V2_TAG, value: decodeCancelProposalV2(data) };
    case EXPIRE_PROPOSAL_V2_TAG: return { tag: EXPIRE_PROPOSAL_V2_TAG, value: decodeExpireProposalV2(data) };
    case APPROVE_EMERGENCY_RESOLUTION_V1_TAG: return { tag: APPROVE_EMERGENCY_RESOLUTION_V1_TAG, value: decodeApproveEmergencyResolutionV1(data) };
    case QUEUE_EMERGENCY_RESOLUTION_V1_TAG: return { tag: QUEUE_EMERGENCY_RESOLUTION_V1_TAG, value: decodeQueueEmergencyResolutionV1(data) };
    case CONVERT_EMERGENCY_FREEZE_V2_TAG: return { tag: CONVERT_EMERGENCY_FREEZE_V2_TAG, value: decodeConvertEmergencyFreezeV2(data) };
    case CREATE_CHECKPOINT_ATTESTATION_V1_TAG: return { tag: CREATE_CHECKPOINT_ATTESTATION_V1_TAG, value: decodeCreateCheckpointAttestationV1(data) };
    case RECAST_CHECKPOINT_ATTESTATION_V1_TAG: return { tag: RECAST_CHECKPOINT_ATTESTATION_V1_TAG, value: decodeRecastCheckpointAttestationV1(data) };
    case FINALIZE_CHECKPOINT_V1_TAG: return { tag: FINALIZE_CHECKPOINT_V1_TAG, value: decodeFinalizeCheckpointV1(data) };
    case CREATE_CANDIDATE_COUNCIL_SET_V1_TAG: return { tag: CREATE_CANDIDATE_COUNCIL_SET_V1_TAG, value: decodeCreateCandidateCouncilSetV1(data) };
    case CREATE_COUNCIL_ROTATION_V1_TAG: return { tag: CREATE_COUNCIL_ROTATION_V1_TAG, value: decodeCreateCouncilRotationV1(data) };
    case APPROVE_COUNCIL_ROTATION_V1_TAG: return { tag: APPROVE_COUNCIL_ROTATION_V1_TAG, value: decodeApproveCouncilRotationV1(data) };
    case ACTIVATE_COUNCIL_ROTATION_V1_TAG: return { tag: ACTIVATE_COUNCIL_ROTATION_V1_TAG, value: decodeActivateCouncilRotationV1(data) };
    case QUEUE_COUNCIL_ROTATION_V1_TAG: return { tag: QUEUE_COUNCIL_ROTATION_V1_TAG, value: decodeQueueCouncilRotationV1(data) };
    case EXPIRE_EMERGENCY_RESOLUTION_V1_TAG: return { tag: EXPIRE_EMERGENCY_RESOLUTION_V1_TAG, value: decodeExpireEmergencyResolutionV1(data) };
    case CANCEL_COUNCIL_ROTATION_V1_TAG: return { tag: CANCEL_COUNCIL_ROTATION_V1_TAG, value: decodeCancelCouncilRotationV1(data) };
    case EXPIRE_COUNCIL_ROTATION_V1_TAG: return { tag: EXPIRE_COUNCIL_ROTATION_V1_TAG, value: decodeExpireCouncilRotationV1(data) };
    case 9: case 10: case 13:
    case 27: case 28: case 29: case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37: case 38:
      return decodeRelease1LoaderInstructionV1(data);
    default: throw new Error("unknown, legacy, or reserved controller instruction tag");
  }
}

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const rs = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: false });
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });
function ix(programId: PublicKey, keys: readonly AccountMeta[], data: Buffer): TransactionInstruction { exactKey(programId, "programId"); for (const [index, meta] of keys.entries()) exactKey(meta.pubkey, `accounts[${index}]`); return new TransactionInstruction({ programId, keys: [...keys], data }); }

export interface InitializeControllerV1Accounts { payer: PublicKey; initializer: PublicKey; controllerProgram: PublicKey; controllerProgramdata: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; controllerConfig: PublicKey; authorityPda: PublicKey; protocolGate: PublicKey; policy: PublicKey; council: PublicKey; canonicalSpillTreasury: PublicKey; guardian: PublicKey; seatAuthorities: readonly PublicKey[]; systemProgram: PublicKey }
export function buildInitializeControllerV1Instruction(programId: PublicKey, a: InitializeControllerV1Accounts, v: InitializeControllerV1): TransactionInstruction { if (a.seatAuthorities.length !== 5) throw new RangeError("seatAuthorities must contain exactly five entries"); return ix(programId, [ws(a.payer), rs(a.initializer), ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), rw(a.controllerConfig), ro(a.authorityPda), rw(a.protocolGate), rw(a.policy), rw(a.council), ro(a.canonicalSpillTreasury), ro(a.guardian), ...a.seatAuthorities.map(ro), ro(a.systemProgram)], encodeInitializeControllerV1(v)); }

export interface CreateProposalV2Accounts { payer: PublicKey; creatorSeatAuthority: PublicKey; controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; authorityPda: PublicKey; canonicalSpillTreasury: PublicKey; buffer: PublicKey; bufferUploaderAuthority: PublicKey; proposal: PublicKey; systemProgram: PublicKey }
export function buildCreateProposalV2Instruction(programId: PublicKey, a: CreateProposalV2Accounts, v: CreateProposalV2): TransactionInstruction { return ix(programId, [ws(a.payer), rs(a.creatorSeatAuthority), rw(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), ro(a.authorityPda), ro(a.canonicalSpillTreasury), ro(a.buffer), ro(a.bufferUploaderAuthority), rw(a.proposal), ro(a.systemProgram)], encodeCreateProposalV2(v)); }
export interface ApproveProposalV2Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; proposal: PublicKey; seatAuthority: PublicKey }
export function buildApproveProposalV2Instruction(programId: PublicKey, a: ApproveProposalV2Accounts, v: ApproveProposalV2): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), rw(a.proposal), rs(a.seatAuthority)], encodeApproveProposalV2(v)); }
export interface FinalizeGovernanceV2Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; proposal: PublicKey }
export function buildFinalizeGovernanceV2Instruction(programId: PublicKey, a: FinalizeGovernanceV2Accounts, v: FinalizeGovernanceV2): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), rw(a.proposal)], encodeFinalizeGovernanceV2(v)); }
export interface QueueProposalV2Accounts { controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; proposal: PublicKey }
export function buildQueueProposalV2Instruction(programId: PublicKey, a: QueueProposalV2Accounts, v: QueueProposalV2): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.protocolGate), rw(a.proposal)], encodeQueueProposalV2(v)); }
export interface FreezeProposalV2Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; proposal: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; authorityPda: PublicKey; rollbackProposal: PublicKey; rollbackBufferVerification: PublicKey; rollbackBuffer: PublicKey }
export function buildFreezeProposalV2Instruction(programId: PublicKey, a: FreezeProposalV2Accounts, v: FreezeProposalV2): TransactionInstruction { return ix(programId, [rw(a.controllerConfig), ro(a.policy), ro(a.council), rw(a.protocolGate), rw(a.proposal), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), ro(a.authorityPda), ro(a.rollbackProposal), ro(a.rollbackBufferVerification), ro(a.rollbackBuffer)], encodeFreezeProposalV2(v)); }
export interface CancelProposalV2Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; proposal: PublicKey; seatAuthority: PublicKey }
export function buildCancelProposalV2Instruction(programId: PublicKey, a: CancelProposalV2Accounts, v: CancelProposalV2): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), rw(a.proposal), rs(a.seatAuthority)], encodeCancelProposalV2(v)); }
export interface ExpireProposalV2Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey }
export function buildExpireProposalV2Instruction(programId: PublicKey, a: ExpireProposalV2Accounts, v: ExpireProposalV2): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal)], encodeExpireProposalV2(v)); }

export interface ApproveEmergencyResolutionV1Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; emergencyResolution: PublicKey; seatAuthority: PublicKey }
export function buildApproveEmergencyResolutionV1Instruction(programId: PublicKey, a: ApproveEmergencyResolutionV1Accounts, v: ApproveEmergencyResolutionV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), rw(a.emergencyResolution), rs(a.seatAuthority)], encodeApproveEmergencyResolutionV1(v)); }
export interface QueueEmergencyResolutionV1Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; emergencyResolution: PublicKey }
export function buildQueueEmergencyResolutionV1Instruction(programId: PublicKey, a: QueueEmergencyResolutionV1Accounts, v: QueueEmergencyResolutionV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), rw(a.emergencyResolution)], encodeQueueEmergencyResolutionV1(v)); }
export interface ConvertEmergencyFreezeV2Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; proposal: PublicKey; emergencyFreezeObservation: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; authorityPda: PublicKey; rollbackProposal: PublicKey; rollbackBufferVerification: PublicKey; rollbackBuffer: PublicKey }
export function buildConvertEmergencyFreezeV2Instruction(programId: PublicKey, a: ConvertEmergencyFreezeV2Accounts, v: ConvertEmergencyFreezeV2): TransactionInstruction { return ix(programId, [rw(a.controllerConfig), ro(a.policy), ro(a.council), rw(a.protocolGate), rw(a.proposal), ro(a.emergencyFreezeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), ro(a.authorityPda), ro(a.rollbackProposal), ro(a.rollbackBufferVerification), ro(a.rollbackBuffer)], encodeConvertEmergencyFreezeV2(v)); }

export interface CreateCheckpointAttestationV1Accounts { payer: PublicKey; controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; subject: PublicKey; checkpoint: PublicKey; checkpointAttestation: PublicKey; seatAuthority: PublicKey; systemProgram: PublicKey }
export function buildCreateCheckpointAttestationV1Instruction(programId: PublicKey, a: CreateCheckpointAttestationV1Accounts, v: CreateCheckpointAttestationV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), ro(a.subject), ro(a.checkpoint), rw(a.checkpointAttestation), rs(a.seatAuthority), ro(a.systemProgram)], encodeCreateCheckpointAttestationV1(v)); }
export interface RecastCheckpointAttestationV1Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; subject: PublicKey; checkpoint: PublicKey; checkpointAttestation: PublicKey; seatAuthority: PublicKey }
export function buildRecastCheckpointAttestationV1Instruction(programId: PublicKey, a: RecastCheckpointAttestationV1Accounts, v: RecastCheckpointAttestationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), ro(a.subject), ro(a.checkpoint), rw(a.checkpointAttestation), rs(a.seatAuthority)], encodeRecastCheckpointAttestationV1(v)); }
export interface FinalizeCheckpointV1Accounts { payer: PublicKey; controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; subject: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; phaseEvidence: PublicKey; baselineCheckpoint?: PublicKey; checkpoint: PublicKey; checkpointAttestations: readonly PublicKey[]; systemProgram: PublicKey }
export function buildFinalizeCheckpointV1Instruction(programId: PublicKey, a: FinalizeCheckpointV1Accounts, v: FinalizeCheckpointV1): TransactionInstruction {
  const poststate = v.candidate.phase === StateCheckpointPhaseV1.Poststate;
  const prestate = v.candidate.phase === StateCheckpointPhaseV1.Prestate;
  const emergency = v.candidate.phase === StateCheckpointPhaseV1.Emergency;
  if (poststate && a.baselineCheckpoint === undefined) throw new Error("baselineCheckpoint is required for Poststate");
  if (emergency && a.baselineCheckpoint !== undefined) throw new Error("Emergency checkpoint cannot accept a baselineCheckpoint");
  if (!poststate && !prestate && a.baselineCheckpoint !== undefined) throw new Error("baselineCheckpoint is not admitted for this phase");
  if (a.checkpointAttestations.length !== 3) throw new RangeError("checkpointAttestations must contain exactly three entries");
  const keys: AccountMeta[] = [ws(a.payer), ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), poststate ? rw(a.subject) : ro(a.subject), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.phaseEvidence)];
  if (a.baselineCheckpoint !== undefined) keys.push(ro(a.baselineCheckpoint));
  keys.push(rw(a.checkpoint), ...a.checkpointAttestations.map(ro), ro(a.systemProgram));
  return ix(programId, keys, encodeFinalizeCheckpointV1(v));
}

export interface CreateCandidateCouncilSetV1Accounts { payer: PublicKey; creatorSeatAuthority: PublicKey; controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; protocolGate: PublicKey; candidateCouncil: PublicKey; candidateSeatAuthorities: readonly PublicKey[]; systemProgram: PublicKey }
export function buildCreateCandidateCouncilSetV1Instruction(programId: PublicKey, a: CreateCandidateCouncilSetV1Accounts, v: CreateCandidateCouncilSetV1): TransactionInstruction { if (a.candidateSeatAuthorities.length !== 5) throw new RangeError("candidateSeatAuthorities must contain exactly five entries"); return ix(programId, [ws(a.payer), rs(a.creatorSeatAuthority), ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.protocolGate), rw(a.candidateCouncil), ...a.candidateSeatAuthorities.map(ro), ro(a.systemProgram)], encodeCreateCandidateCouncilSetV1(v)); }
export interface CreateCouncilRotationV1Accounts { payer: PublicKey; creatorSeatAuthority: PublicKey; controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; candidateCouncil: PublicKey; protocolGate: PublicKey; rotation: PublicKey; systemProgram: PublicKey }
export function buildCreateCouncilRotationV1Instruction(programId: PublicKey, a: CreateCouncilRotationV1Accounts, v: CreateCouncilRotationV1): TransactionInstruction { return ix(programId, [ws(a.payer), rs(a.creatorSeatAuthority), ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.candidateCouncil), ro(a.protocolGate), rw(a.rotation), ro(a.systemProgram)], encodeCreateCouncilRotationV1(v)); }
export interface ApproveCouncilRotationV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; candidateCouncil: PublicKey; protocolGate: PublicKey; rotation: PublicKey; seatAuthority: PublicKey }
export function buildApproveCouncilRotationV1Instruction(programId: PublicKey, a: ApproveCouncilRotationV1Accounts, v: ApproveCouncilRotationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.candidateCouncil), ro(a.protocolGate), rw(a.rotation), rs(a.seatAuthority)], encodeApproveCouncilRotationV1(v)); }
export interface ActivateCouncilRotationV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; candidateCouncil: PublicKey; protocolGate: PublicKey; rotation: PublicKey }
export function buildActivateCouncilRotationV1Instruction(programId: PublicKey, a: ActivateCouncilRotationV1Accounts, v: ActivateCouncilRotationV1): TransactionInstruction { return ix(programId, [rw(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.candidateCouncil), ro(a.protocolGate), rw(a.rotation)], encodeActivateCouncilRotationV1(v)); }
export interface QueueCouncilRotationV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; candidateCouncil: PublicKey; protocolGate: PublicKey; rotation: PublicKey }
export function buildQueueCouncilRotationV1Instruction(programId: PublicKey, a: QueueCouncilRotationV1Accounts, v: QueueCouncilRotationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.candidateCouncil), ro(a.protocolGate), rw(a.rotation)], encodeQueueCouncilRotationV1(v)); }
export interface ExpireEmergencyResolutionV1Accounts { controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; emergencyResolution: PublicKey }
export function buildExpireEmergencyResolutionV1Instruction(programId: PublicKey, a: ExpireEmergencyResolutionV1Accounts, v: ExpireEmergencyResolutionV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.protocolGate), rw(a.emergencyResolution)], encodeExpireEmergencyResolutionV1(v)); }
export interface CancelCouncilRotationV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; candidateCouncil: PublicKey; protocolGate: PublicKey; rotation: PublicKey; seatAuthority: PublicKey }
export function buildCancelCouncilRotationV1Instruction(programId: PublicKey, a: CancelCouncilRotationV1Accounts, v: CancelCouncilRotationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.candidateCouncil), ro(a.protocolGate), rw(a.rotation), rs(a.seatAuthority)], encodeCancelCouncilRotationV1(v)); }
export interface ExpireCouncilRotationV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; rotation: PublicKey }
export function buildExpireCouncilRotationV1Instruction(programId: PublicKey, a: ExpireCouncilRotationV1Accounts, v: ExpireCouncilRotationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), rw(a.rotation)], encodeExpireCouncilRotationV1(v)); }
