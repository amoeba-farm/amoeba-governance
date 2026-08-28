import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { VERIFICATION_BITMAP_BYTES_V1 } from "./artifactMerkleV1.js";
import {
  BufferVerificationStatusV1,
  EmergencyFreezeResolutionKindV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
  ProgramDataMismatchClassV1,
  ProgramDataVerificationStatusV1,
  ProposalStateV2,
  type BufferVerificationStatusV1 as BufferVerificationStatusV1Value,
  type EmergencyFreezeResolutionKindV1 as EmergencyFreezeResolutionKindV1Value,
  type EmergencyFreezeResolutionStateV1 as EmergencyFreezeResolutionStateV1Value,
  type GateStatusV1 as GateStatusV1Value,
  type ProgramDataMismatchClassV1 as ProgramDataMismatchClassV1Value,
  type ProgramDataVerificationStatusV1 as ProgramDataVerificationStatusV1Value,
  type ProposalStateV2 as ProposalStateV2Value,
} from "./release1.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

export const MAX_CONTROLLER_INSTRUCTION_DATA_LEN = 16_384;
export const MAX_FIXED_MERKLE_PROOF_NODES_V1 = 7;
export const FIXED_MERKLE_PROOF_V1_LEN = 225;
export const ENVELOPE_EXPECTATION_V1_LEN = 78;
export const PROPOSAL_EXPECTATION_V2_LEN = 162;
export const UNFREEZE_EXPECTATION_V1_LEN = 251;
export const EMERGENCY_RESOLUTION_EXPECTATION_V1_LEN = 156;
export const MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1 = 1_400_000;
export const MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1 = 10_000_000n;

export const GUARDIAN_FREEZE_V1_TAG = 9;
export const CREATE_EMERGENCY_RESOLUTION_V1_TAG = 10;
export const EXECUTE_EMERGENCY_RESOLUTION_V1_TAG = 13;
export const ADOPT_BUFFER_V1_TAG = 27;
export const VERIFY_BUFFER_CHUNK_V1_TAG = 28;
export const FINALIZE_BUFFER_VERIFICATION_V1_TAG = 29;
export const EXTEND_TARGET_V1_TAG = 30;
export const EXECUTE_UPGRADE_V1_TAG = 31;
export const VERIFY_PROGRAMDATA_CHUNK_V1_TAG = 32;
export const FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG = 33;
export const APPROVE_UNFREEZE_V1_TAG = 34;
export const EXECUTE_UNFREEZE_V1_TAG = 35;
export const CLOSE_ABANDONED_BUFFER_V1_TAG = 36;
export const ACTIVATE_ROLLBACK_V1_TAG = 37;
export const OBSERVE_PROGRAMDATA_FAILURE_V1_TAG = 38;

export const GUARDIAN_FREEZE_V1_LEN = 259;
export const CREATE_EMERGENCY_RESOLUTION_V1_LEN = 395;
export const EXECUTE_EMERGENCY_RESOLUTION_V1_LEN = 420;
export const ADOPT_BUFFER_V1_LEN = 163;
export const VERIFY_BUFFER_CHUNK_V1_LEN = 461;
export const FINALIZE_BUFFER_VERIFICATION_V1_LEN = 232;
export const EXTEND_TARGET_V1_LEN = 297;
export const EXECUTE_UPGRADE_V1_LEN = 391;
export const VERIFY_PROGRAMDATA_CHUNK_V1_LEN = 530;
export const FINALIZE_PROGRAMDATA_VERIFICATION_V1_LEN = 316;
export const APPROVE_UNFREEZE_V1_LEN = 252;
export const EXECUTE_UNFREEZE_V1_LEN = 362;
export const CLOSE_ABANDONED_BUFFER_V1_LEN = 240;
export const ACTIVATE_ROLLBACK_V1_LEN = 435;
export const OBSERVE_PROGRAMDATA_FAILURE_V1_LEN = 624;

const ZERO_32 = Buffer.alloc(32);
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;

export interface OptionalInstructionPublicKeyV1 {
  present: boolean;
  value: PublicKey;
}

export interface FixedMerkleProofV1 {
  proofLen: number;
  nodes: readonly Buffer[];
}

export interface EnvelopeExpectationV1 {
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
  durableNonceAccount: OptionalInstructionPublicKeyV1;
  durableNonceAuthority: OptionalInstructionPublicKeyV1;
}

export interface ProposalExpectationV2 {
  expectedProposalDigest: Buffer;
  expectedPolicyVersion: bigint;
  expectedPolicyHash: Buffer;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedState: ProposalStateV2Value;
  expectedReviewStartSlot: bigint;
  expectedReviewEndSlot: bigint;
  expectedNotBeforeSlot: bigint;
  expectedExpirySlot: bigint;
}

export interface EmergencyResolutionExpectationV1 {
  expectedResolutionDigest: Buffer;
  expectedPolicyVersion: bigint;
  expectedPolicyHash: Buffer;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedFreezeSlot: bigint;
  expectedFreezeReasonCode: number;
  expectedTargetNonce: bigint;
  expectedState: EmergencyFreezeResolutionStateV1Value;
  expectedNotBeforeSlot: bigint;
  expectedExpirySlot: bigint;
}

export interface UnfreezeExpectationV1 {
  expectedProposalDigest: Buffer;
  expectedPolicyVersion: bigint;
  expectedPolicyHash: Buffer;
  expectedCurrentCouncilVersion: bigint;
  expectedCurrentCouncilHash: Buffer;
  expectedFrozenGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedProposalState: ProposalStateV2Value;
  expectedPoststateCheckpointDigest: Buffer;
  expectedProgramdataAuthority: PublicKey;
  expectedProgramdataDeployedSlot: bigint;
  expectedProgramdataCapacity: bigint;
  expectedRawProgramdataHash: Buffer;
  expectedUnfreezeApprovalBitset: number;
  expectedUnfreezeApprovalCount: number;
  expectedProgramdataVerificationFinalizedSlot: bigint;
}

export const ProgramDataChunkPhaseV1 = Object.freeze({
  Payload: 0,
  ZeroTail: 1,
} as const);
export type ProgramDataChunkPhaseV1Value =
  (typeof ProgramDataChunkPhaseV1)[keyof typeof ProgramDataChunkPhaseV1];

export interface GuardianFreezeV1 {
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedNextGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedProgramOwner: PublicKey;
  expectedProgramExecutable: boolean;
  expectedProgramDataLength: bigint;
  expectedProgramHeaderPresent: boolean;
  expectedLinkedProgramdata: OptionalInstructionPublicKeyV1;
  expectedProgramdataOwner: PublicKey;
  expectedProgramdataExecutable: boolean;
  expectedProgramdataDataLength: bigint;
  expectedProgramdataHeaderPresent: boolean;
  expectedProgramdataSlot: bigint;
  expectedRawHashComplete: boolean;
  expectedRawProgramdataHash: Buffer;
  expectedCapacity: bigint;
  expectedProgramdataAuthority: OptionalInstructionPublicKeyV1;
  freezeReasonCode: number;
  expectedObservationDigest: Buffer;
}

export interface CreateEmergencyResolutionV1 {
  resolutionKind: EmergencyFreezeResolutionKindV1Value;
  creationSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  expectedPolicyVersion: bigint;
  expectedPolicyHash: Buffer;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
  expectedGateEpoch: bigint;
  expectedFreezeSlot: bigint;
  expectedFreezeReasonCode: number;
  expectedTargetNonce: bigint;
  expectedFreezeObservationDigest: Buffer;
  observedProgramOwner: PublicKey;
  observedProgramExecutable: boolean;
  observedProgramDataLength: bigint;
  observedProgramHeaderPresent: boolean;
  observedLinkedProgramdata: OptionalInstructionPublicKeyV1;
  observedProgramdataOwner: PublicKey;
  observedProgramdataExecutable: boolean;
  observedProgramdataDataLength: bigint;
  observedProgramdataHeaderPresent: boolean;
  observedProgramdataSlot: bigint;
  observedRawHashComplete: boolean;
  observedRawProgramdataHash: Buffer;
  observedCapacity: bigint;
  observedProgramdataAuthority: OptionalInstructionPublicKeyV1;
  expectedResolutionDigest: Buffer;
}

export interface ExecuteEmergencyResolutionV1 {
  expected: EmergencyResolutionExpectationV1;
  expectedFreezeObservationDigest: Buffer;
  expectedCheckpointDigest: Buffer;
  expectedProgramOwner: PublicKey;
  expectedProgramExecutable: boolean;
  expectedProgramDataLength: bigint;
  expectedProgramHeaderPresent: boolean;
  expectedLinkedProgramdata: OptionalInstructionPublicKeyV1;
  expectedProgramdataOwner: PublicKey;
  expectedProgramdataExecutable: boolean;
  expectedProgramdataDataLength: bigint;
  expectedProgramdataHeaderPresent: boolean;
  expectedProgramdataSlot: bigint;
  expectedRawHashComplete: boolean;
  expectedRawProgramdataHash: Buffer;
  expectedCapacity: bigint;
  expectedProgramdataAuthority: OptionalInstructionPublicKeyV1;
}

export interface AdoptBufferV1 {
  expected: ProposalExpectationV2;
}

export interface VerifyBufferChunkV1 {
  expected: ProposalExpectationV2;
  chunkIndex: number;
  proof: FixedMerkleProofV1;
  expectedVerificationStatus: BufferVerificationStatusV1Value;
  expectedVerifiedChunkBitmap: Buffer;
  expectedVerifiedChunkCount: number;
}

export interface FinalizeBufferVerificationV1 {
  expected: ProposalExpectationV2;
  expectedVerificationStatus: BufferVerificationStatusV1Value;
  expectedVerifiedChunkBitmap: Buffer;
  expectedVerifiedChunkCount: number;
}

export interface ExtendTargetV1 {
  expected: ProposalExpectationV2;
  expectedPrestateCheckpointDigest: Buffer;
  expectedCurrentCapacity: bigint;
  expectedExtensionDelta: bigint;
  expectedPostCapacity: bigint;
  envelope: EnvelopeExpectationV1;
}

export interface ExecuteUpgradeV1 {
  expected: ProposalExpectationV2;
  expectedPrestateCheckpointDigest: Buffer;
  expectedCurrentRawProgramdataHash: Buffer;
  expectedSealedBufferHeaderHash: Buffer;
  expectedCounterpartProposalDigest: Buffer;
  expectedProgramdataSlot: bigint;
  expectedCapacity: bigint;
  expectedVerifiedChunkCount: number;
  expectedBufferVerificationStatus: BufferVerificationStatusV1Value;
  expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1Value;
  envelope: EnvelopeExpectationV1;
}

export interface VerifyProgramDataChunkV1 {
  expected: ProposalExpectationV2;
  phase: ProgramDataChunkPhaseV1Value;
  chunkIndex: number;
  proof: FixedMerkleProofV1;
  expectedVerificationStatus: ProgramDataVerificationStatusV1Value;
  expectedVerifiedPayloadChunkBitmap: Buffer;
  expectedVerifiedPayloadChunkCount: number;
  expectedVerifiedTailChunkBitmap: Buffer;
  expectedVerifiedTailChunkCount: number;
}

export interface FinalizeProgramDataVerificationV1 {
  expected: ProposalExpectationV2;
  expectedVerificationStatus: ProgramDataVerificationStatusV1Value;
  expectedVerifiedPayloadChunkBitmap: Buffer;
  expectedVerifiedPayloadChunkCount: number;
  expectedVerifiedTailChunkBitmap: Buffer;
  expectedVerifiedTailChunkCount: number;
  expectedDeployedSlot: bigint;
  expectedCapacity: bigint;
}

export interface ApproveUnfreezeV1 {
  expected: UnfreezeExpectationV1;
}

export interface ExecuteUnfreezeV1 {
  expected: UnfreezeExpectationV1;
  linkedProposal: PublicKey;
  envelope: EnvelopeExpectationV1;
}

export interface CloseAbandonedBufferV1 {
  expected: ProposalExpectationV2;
  expectedVerificationStatus: BufferVerificationStatusV1Value;
  expectedVerifiedChunkBitmap: Buffer;
  expectedVerifiedChunkCount: number;
  expectedBufferVerificationFinalizedSlot: bigint;
}

export interface ActivateRollbackV1 {
  expectedPrimary: ProposalExpectationV2;
  expectedRollback: ProposalExpectationV2;
  expectedFailureEvidenceDigest: Buffer;
  expectedPrimaryProgramdataVerificationStatus: ProgramDataVerificationStatusV1Value;
  expectedPrimaryProgramdataVerificationFinalizedSlot: bigint;
  expectedRollbackBufferVerificationStatus: BufferVerificationStatusV1Value;
  expectedRollbackVerifiedChunkBitmap: Buffer;
  expectedRollbackVerifiedChunkCount: number;
}

export interface ObserveProgramDataFailureV1 {
  expected: ProposalExpectationV2;
  expectedProgramOwner: PublicKey;
  expectedProgramExecutable: boolean;
  expectedProgramDataLength: bigint;
  expectedProgramHeaderPresent: boolean;
  expectedLinkedProgramdata: OptionalInstructionPublicKeyV1;
  expectedProgramdataOwner: PublicKey;
  expectedProgramdataExecutable: boolean;
  expectedProgramdataDataLength: bigint;
  expectedProgramdataHeaderPresent: boolean;
  expectedProgramdataSlot: bigint;
  expectedRawHashComplete: boolean;
  expectedRawProgramdataHash: Buffer;
  expectedCapacity: bigint;
  expectedProgramdataAuthority: OptionalInstructionPublicKeyV1;
  mismatchClass: ProgramDataMismatchClassV1Value;
  failingChunkIndex: number;
  expectedLeafHash: Buffer;
  proof: FixedMerkleProofV1;
}

class Writer {
  readonly parts: Buffer[] = [];

  byte(value: number, field: string): void {
    integer(value, 0xff, field);
    this.parts.push(Buffer.from([value]));
  }

  u16(value: number, field: string): void {
    integer(value, U16_MAX, field);
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value);
    this.parts.push(out);
  }

  u32(value: number, field: string): void {
    integer(value, U32_MAX, field);
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value);
    this.parts.push(out);
  }

  u64(value: bigint, field: string): void {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError(`${field} must be a u64`);
    }
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(value);
    this.parts.push(out);
  }

  bytes(value: Buffer, length: number, field: string): void {
    if (!Buffer.isBuffer(value) || value.length !== length) {
      throw new RangeError(`${field} must be ${length} bytes`);
    }
    this.parts.push(value);
  }

  key(value: PublicKey, field: string): void {
    if (!(value instanceof PublicKey)) {
      throw new TypeError(`${field} must be a PublicKey`);
    }
    this.parts.push(value.toBuffer());
  }

  bool(value: boolean, field: string): void {
    if (typeof value !== "boolean") {
      throw new TypeError(`${field} must be boolean`);
    }
    this.byte(Number(value), field);
  }

  finish(expectedLength: number): Buffer {
    const out = Buffer.concat(this.parts);
    if (out.length !== expectedLength) {
      throw new Error(`internal codec length ${out.length} != ${expectedLength}`);
    }
    return out;
  }
}

class Reader {
  offset = 0;

  constructor(readonly data: Buffer) {}

  bytes(length: number): Buffer {
    const end = this.offset + length;
    if (end > this.data.length) throw new Error("truncated instruction");
    const out = this.data.subarray(this.offset, end);
    this.offset = end;
    return Buffer.from(out);
  }

  byte(): number {
    return this.bytes(1)[0]!;
  }

  u16(): number {
    return this.bytes(2).readUInt16LE();
  }

  u32(): number {
    return this.bytes(4).readUInt32LE();
  }

  u64(): bigint {
    return this.bytes(8).readBigUInt64LE();
  }

  key(): PublicKey {
    return new PublicKey(this.bytes(32));
  }

  bool(field: string): boolean {
    const value = this.byte();
    if (value !== 0 && value !== 1) {
      throw new Error(`${field} must be a canonical boolean`);
    }
    return value === 1;
  }

  finish(): void {
    if (this.offset !== this.data.length) throw new Error("trailing instruction data");
  }
}

function integer(value: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${field} out of range`);
  }
}

function enumValue(value: number, values: readonly number[], field: string): number {
  if (!values.includes(value)) throw new RangeError(`invalid ${field}`);
  return value;
}

function nondefault(key: PublicKey, field: string): PublicKey {
  if (key.toBuffer().equals(ZERO_32)) throw new Error(`${field} must be nondefault`);
  return key;
}

function optionalNone(): OptionalInstructionPublicKeyV1 {
  return { present: false, value: PublicKey.default };
}

function validateOptional(
  value: OptionalInstructionPublicKeyV1,
  field: string,
): void {
  if (typeof value.present !== "boolean") {
    throw new TypeError(`${field}.present must be boolean`);
  }
  if (!(value.value instanceof PublicKey)) {
    throw new TypeError(`${field}.value must be a PublicKey`);
  }
  const isDefault = value.value.toBuffer().equals(ZERO_32);
  if (value.present === isDefault) {
    throw new Error(`noncanonical ${field}`);
  }
}

function writeOptional(writer: Writer, value: OptionalInstructionPublicKeyV1, field: string): void {
  validateOptional(value, field);
  if (value.present) {
    writer.byte(1, `${field}.present`);
    writer.key(value.value, `${field}.value`);
  } else {
    writer.byte(0, `${field}.present`);
    writer.key(value.value, `${field}.value`);
  }
}

function readOptional(reader: Reader, field: string): OptionalInstructionPublicKeyV1 {
  const present = reader.byte();
  const value = reader.key();
  if (present === 0 && value.toBuffer().equals(ZERO_32)) return optionalNone();
  if (present === 1 && !value.toBuffer().equals(ZERO_32)) return { present: true, value };
  throw new Error(`noncanonical ${field}`);
}

function writeProposalExpectation(writer: Writer, value: ProposalExpectationV2): void {
  writer.bytes(value.expectedProposalDigest, 32, "expectedProposalDigest");
  writer.u64(value.expectedPolicyVersion, "expectedPolicyVersion");
  writer.bytes(value.expectedPolicyHash, 32, "expectedPolicyHash");
  writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion");
  writer.bytes(value.expectedCouncilHash, 32, "expectedCouncilHash");
  writer.byte(
    enumValue(value.expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1"),
    "expectedGateStatus",
  );
  writer.u64(value.expectedGateEpoch, "expectedGateEpoch");
  writer.u64(value.expectedTargetNonce, "expectedTargetNonce");
  writer.byte(
    enumValue(
      value.expectedState,
      Object.values(ProposalStateV2).filter((state) => state !== ProposalStateV2.TokenReviewOpen),
      "ProposalStateV2",
    ),
    "expectedState",
  );
  writer.u64(value.expectedReviewStartSlot, "expectedReviewStartSlot");
  writer.u64(value.expectedReviewEndSlot, "expectedReviewEndSlot");
  writer.u64(value.expectedNotBeforeSlot, "expectedNotBeforeSlot");
  writer.u64(value.expectedExpirySlot, "expectedExpirySlot");
}

function readProposalExpectation(reader: Reader): ProposalExpectationV2 {
  const value: ProposalExpectationV2 = {
    expectedProposalDigest: reader.bytes(32),
    expectedPolicyVersion: reader.u64(),
    expectedPolicyHash: reader.bytes(32),
    expectedCouncilVersion: reader.u64(),
    expectedCouncilHash: reader.bytes(32),
    expectedGateStatus: reader.byte() as GateStatusV1Value,
    expectedGateEpoch: reader.u64(),
    expectedTargetNonce: reader.u64(),
    expectedState: reader.byte() as ProposalStateV2Value,
    expectedReviewStartSlot: reader.u64(),
    expectedReviewEndSlot: reader.u64(),
    expectedNotBeforeSlot: reader.u64(),
    expectedExpirySlot: reader.u64(),
  };
  enumValue(value.expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1");
  enumValue(
    value.expectedState,
    Object.values(ProposalStateV2).filter((state) => state !== ProposalStateV2.TokenReviewOpen),
    "ProposalStateV2",
  );
  return value;
}

function writeEmergencyResolutionExpectation(
  writer: Writer,
  value: EmergencyResolutionExpectationV1,
): void {
  writer.bytes(value.expectedResolutionDigest, 32, "expectedResolutionDigest");
  writer.u64(value.expectedPolicyVersion, "expectedPolicyVersion");
  writer.bytes(value.expectedPolicyHash, 32, "expectedPolicyHash");
  writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion");
  writer.bytes(value.expectedCouncilHash, 32, "expectedCouncilHash");
  writer.byte(
    enumValue(value.expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1"),
    "expectedGateStatus",
  );
  writer.u64(value.expectedGateEpoch, "expectedGateEpoch");
  writer.u64(value.expectedFreezeSlot, "expectedFreezeSlot");
  writer.u16(value.expectedFreezeReasonCode, "expectedFreezeReasonCode");
  writer.u64(value.expectedTargetNonce, "expectedTargetNonce");
  writer.byte(
    enumValue(
      value.expectedState,
      Object.values(EmergencyFreezeResolutionStateV1),
      "EmergencyFreezeResolutionStateV1",
    ),
    "expectedState",
  );
  writer.u64(value.expectedNotBeforeSlot, "expectedNotBeforeSlot");
  writer.u64(value.expectedExpirySlot, "expectedExpirySlot");
}

function readEmergencyResolutionExpectation(
  reader: Reader,
): EmergencyResolutionExpectationV1 {
  const value: EmergencyResolutionExpectationV1 = {
    expectedResolutionDigest: reader.bytes(32),
    expectedPolicyVersion: reader.u64(),
    expectedPolicyHash: reader.bytes(32),
    expectedCouncilVersion: reader.u64(),
    expectedCouncilHash: reader.bytes(32),
    expectedGateStatus: reader.byte() as GateStatusV1Value,
    expectedGateEpoch: reader.u64(),
    expectedFreezeSlot: reader.u64(),
    expectedFreezeReasonCode: reader.u16(),
    expectedTargetNonce: reader.u64(),
    expectedState: reader.byte() as EmergencyFreezeResolutionStateV1Value,
    expectedNotBeforeSlot: reader.u64(),
    expectedExpirySlot: reader.u64(),
  };
  enumValue(value.expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1");
  enumValue(
    value.expectedState,
    Object.values(EmergencyFreezeResolutionStateV1),
    "EmergencyFreezeResolutionStateV1",
  );
  return value;
}

interface ObservationEvidenceV1 {
  programOwner: PublicKey;
  programExecutable: boolean;
  programDataLength: bigint;
  programHeaderPresent: boolean;
  linkedProgramdata: OptionalInstructionPublicKeyV1;
  programdataOwner: PublicKey;
  programdataExecutable: boolean;
  programdataDataLength: bigint;
  programdataHeaderPresent: boolean;
  programdataSlot: bigint;
  rawHashComplete: boolean;
  rawProgramdataHash: Buffer;
  capacity: bigint;
  programdataAuthority: OptionalInstructionPublicKeyV1;
}

function requireU64(value: bigint, field: string): void {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value > 0xffff_ffff_ffff_ffffn
  ) {
    throw new RangeError(`${field} must be a u64`);
  }
}

function validateObservationEvidence(
  value: ObservationEvidenceV1,
  prefix: string,
): void {
  if (!(value.programOwner instanceof PublicKey)) {
    throw new TypeError(`${prefix}ProgramOwner must be a PublicKey`);
  }
  if (!(value.programdataOwner instanceof PublicKey)) {
    throw new TypeError(`${prefix}ProgramdataOwner must be a PublicKey`);
  }
  for (const [field, flag] of [
    [`${prefix}ProgramExecutable`, value.programExecutable],
    [`${prefix}ProgramHeaderPresent`, value.programHeaderPresent],
    [`${prefix}ProgramdataExecutable`, value.programdataExecutable],
    [`${prefix}ProgramdataHeaderPresent`, value.programdataHeaderPresent],
    [`${prefix}RawHashComplete`, value.rawHashComplete],
  ] as const) {
    if (typeof flag !== "boolean") throw new TypeError(`${field} must be boolean`);
  }
  for (const [field, numeric] of [
    [`${prefix}ProgramDataLength`, value.programDataLength],
    [`${prefix}ProgramdataDataLength`, value.programdataDataLength],
    [`${prefix}ProgramdataSlot`, value.programdataSlot],
    [`${prefix}Capacity`, value.capacity],
  ] as const) {
    requireU64(numeric, field);
  }
  validateOptional(value.linkedProgramdata, `${prefix}LinkedProgramdata`);
  validateOptional(value.programdataAuthority, `${prefix}ProgramdataAuthority`);

  if (
    value.programHeaderPresent
      ? value.programDataLength !== 36n || !value.linkedProgramdata.present
      : value.linkedProgramdata.present
  ) {
    throw new Error(`invalid ${prefix} Program header evidence`);
  }
  if (
    value.programdataHeaderPresent
      ? value.programdataDataLength !== value.capacity + 45n
      : value.programdataSlot !== 0n ||
        value.capacity !== 0n ||
        value.programdataAuthority.present
  ) {
    throw new Error(`invalid ${prefix} ProgramData header evidence`);
  }
  if (
    !Buffer.isBuffer(value.rawProgramdataHash) ||
    value.rawProgramdataHash.length !== 32 ||
    value.rawHashComplete !==
      (value.programdataDataLength <= MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1) ||
    value.rawHashComplete === value.rawProgramdataHash.equals(ZERO_32)
  ) {
    throw new Error(`invalid ${prefix} raw ProgramData hash evidence`);
  }
}

function writeObservationEvidence(
  writer: Writer,
  value: ObservationEvidenceV1,
  prefix: string,
): void {
  validateObservationEvidence(value, prefix);
  writer.key(value.programOwner, `${prefix}ProgramOwner`);
  writer.bool(value.programExecutable, `${prefix}ProgramExecutable`);
  writer.u64(value.programDataLength, `${prefix}ProgramDataLength`);
  writer.bool(value.programHeaderPresent, `${prefix}ProgramHeaderPresent`);
  writeOptional(writer, value.linkedProgramdata, `${prefix}LinkedProgramdata`);
  writer.key(value.programdataOwner, `${prefix}ProgramdataOwner`);
  writer.bool(value.programdataExecutable, `${prefix}ProgramdataExecutable`);
  writer.u64(value.programdataDataLength, `${prefix}ProgramdataDataLength`);
  writer.bool(value.programdataHeaderPresent, `${prefix}ProgramdataHeaderPresent`);
  writer.u64(value.programdataSlot, `${prefix}ProgramdataSlot`);
  writer.bool(value.rawHashComplete, `${prefix}RawHashComplete`);
  writer.bytes(value.rawProgramdataHash, 32, `${prefix}RawProgramdataHash`);
  writer.u64(value.capacity, `${prefix}Capacity`);
  writeOptional(writer, value.programdataAuthority, `${prefix}ProgramdataAuthority`);
}

function readObservationEvidence(reader: Reader, prefix: string): ObservationEvidenceV1 {
  const value: ObservationEvidenceV1 = {
    programOwner: reader.key(),
    programExecutable: reader.bool(`${prefix}ProgramExecutable`),
    programDataLength: reader.u64(),
    programHeaderPresent: reader.bool(`${prefix}ProgramHeaderPresent`),
    linkedProgramdata: readOptional(reader, `${prefix}LinkedProgramdata`),
    programdataOwner: reader.key(),
    programdataExecutable: reader.bool(`${prefix}ProgramdataExecutable`),
    programdataDataLength: reader.u64(),
    programdataHeaderPresent: reader.bool(`${prefix}ProgramdataHeaderPresent`),
    programdataSlot: reader.u64(),
    rawHashComplete: reader.bool(`${prefix}RawHashComplete`),
    rawProgramdataHash: reader.bytes(32),
    capacity: reader.u64(),
    programdataAuthority: readOptional(reader, `${prefix}ProgramdataAuthority`),
  };
  validateObservationEvidence(value, prefix);
  return value;
}

function validateCanonicalExecuteObservation(value: ObservationEvidenceV1): void {
  validateObservationEvidence(value, "expected");
  if (
    !value.rawHashComplete ||
    !value.programOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
    !value.programExecutable ||
    !value.programHeaderPresent ||
    !value.linkedProgramdata.present ||
    !value.programdataOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
    value.programdataExecutable ||
    !value.programdataHeaderPresent ||
    value.programdataSlot === 0n ||
    value.capacity === 0n ||
    !value.programdataAuthority.present
  ) {
    throw new Error("ExecuteEmergencyResolutionV1 requires a complete canonical Loader-v3 graph");
  }
}

function validateProof(value: FixedMerkleProofV1): void {
  integer(value.proofLen, MAX_FIXED_MERKLE_PROOF_NODES_V1, "proofLen");
  if (value.nodes.length !== MAX_FIXED_MERKLE_PROOF_NODES_V1) {
    throw new RangeError(`nodes must contain ${MAX_FIXED_MERKLE_PROOF_NODES_V1} entries`);
  }
  value.nodes.forEach((node, index) => {
    if (!Buffer.isBuffer(node) || node.length !== 32) throw new Error(`nodes[${index}] must be 32 bytes`);
    if (index >= value.proofLen && !node.equals(ZERO_32)) {
      throw new Error("unused Merkle proof nodes must be zero");
    }
  });
}

function writeProof(writer: Writer, value: FixedMerkleProofV1): void {
  validateProof(value);
  writer.byte(value.proofLen, "proofLen");
  value.nodes.forEach((node, index) => writer.bytes(node, 32, `nodes[${index}]`));
}

function readProof(reader: Reader): FixedMerkleProofV1 {
  const value = {
    proofLen: reader.byte(),
    nodes: Array.from({ length: MAX_FIXED_MERKLE_PROOF_NODES_V1 }, () => reader.bytes(32)),
  };
  validateProof(value);
  return value;
}

function validateEnvelope(value: EnvelopeExpectationV1): void {
  integer(value.computeUnitLimit, MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1, "computeUnitLimit");
  if (value.computeUnitLimit === 0) throw new RangeError("computeUnitLimit must be nonzero");
  if (
    value.computeUnitPriceMicroLamports < 0n ||
    value.computeUnitPriceMicroLamports > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1
  ) {
    throw new RangeError("computeUnitPriceMicroLamports out of range");
  }
  if (value.durableNonceAccount.present !== value.durableNonceAuthority.present) {
    throw new Error("durable nonce account and authority must be present together");
  }
}

function writeEnvelope(writer: Writer, value: EnvelopeExpectationV1): void {
  validateEnvelope(value);
  writer.u32(value.computeUnitLimit, "computeUnitLimit");
  writer.u64(value.computeUnitPriceMicroLamports, "computeUnitPriceMicroLamports");
  writeOptional(writer, value.durableNonceAccount, "durableNonceAccount");
  writeOptional(writer, value.durableNonceAuthority, "durableNonceAuthority");
}

function readEnvelope(reader: Reader): EnvelopeExpectationV1 {
  const value = {
    computeUnitLimit: reader.u32(),
    computeUnitPriceMicroLamports: reader.u64(),
    durableNonceAccount: readOptional(reader, "durableNonceAccount"),
    durableNonceAuthority: readOptional(reader, "durableNonceAuthority"),
  };
  validateEnvelope(value);
  return value;
}

function writeUnfreeze(writer: Writer, value: UnfreezeExpectationV1): void {
  writer.bytes(value.expectedProposalDigest, 32, "expectedProposalDigest");
  writer.u64(value.expectedPolicyVersion, "expectedPolicyVersion");
  writer.bytes(value.expectedPolicyHash, 32, "expectedPolicyHash");
  writer.u64(value.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion");
  writer.bytes(value.expectedCurrentCouncilHash, 32, "expectedCurrentCouncilHash");
  writer.u64(value.expectedFrozenGateEpoch, "expectedFrozenGateEpoch");
  writer.u64(value.expectedTargetNonce, "expectedTargetNonce");
  writer.byte(
    enumValue(
      value.expectedProposalState,
      Object.values(ProposalStateV2).filter((state) => state !== ProposalStateV2.TokenReviewOpen),
      "ProposalStateV2",
    ),
    "expectedProposalState",
  );
  writer.bytes(value.expectedPoststateCheckpointDigest, 32, "expectedPoststateCheckpointDigest");
  writer.key(nondefault(value.expectedProgramdataAuthority, "expectedProgramdataAuthority"), "expectedProgramdataAuthority");
  writer.u64(value.expectedProgramdataDeployedSlot, "expectedProgramdataDeployedSlot");
  writer.u64(value.expectedProgramdataCapacity, "expectedProgramdataCapacity");
  writer.bytes(value.expectedRawProgramdataHash, 32, "expectedRawProgramdataHash");
  writer.byte(value.expectedUnfreezeApprovalBitset, "expectedUnfreezeApprovalBitset");
  writer.byte(value.expectedUnfreezeApprovalCount, "expectedUnfreezeApprovalCount");
  writer.u64(
    value.expectedProgramdataVerificationFinalizedSlot,
    "expectedProgramdataVerificationFinalizedSlot",
  );
}

function readUnfreeze(reader: Reader): UnfreezeExpectationV1 {
  const value: UnfreezeExpectationV1 = {
    expectedProposalDigest: reader.bytes(32),
    expectedPolicyVersion: reader.u64(),
    expectedPolicyHash: reader.bytes(32),
    expectedCurrentCouncilVersion: reader.u64(),
    expectedCurrentCouncilHash: reader.bytes(32),
    expectedFrozenGateEpoch: reader.u64(),
    expectedTargetNonce: reader.u64(),
    expectedProposalState: reader.byte() as ProposalStateV2Value,
    expectedPoststateCheckpointDigest: reader.bytes(32),
    expectedProgramdataAuthority: reader.key(),
    expectedProgramdataDeployedSlot: reader.u64(),
    expectedProgramdataCapacity: reader.u64(),
    expectedRawProgramdataHash: reader.bytes(32),
    expectedUnfreezeApprovalBitset: reader.byte(),
    expectedUnfreezeApprovalCount: reader.byte(),
    expectedProgramdataVerificationFinalizedSlot: reader.u64(),
  };
  enumValue(
    value.expectedProposalState,
    Object.values(ProposalStateV2).filter((state) => state !== ProposalStateV2.TokenReviewOpen),
    "ProposalStateV2",
  );
  nondefault(value.expectedProgramdataAuthority, "expectedProgramdataAuthority");
  return value;
}

function writeBitmap(writer: Writer, value: Buffer, field: string): void {
  writer.bytes(value, VERIFICATION_BITMAP_BYTES_V1, field);
}

export type Release1LoaderInstructionV1 =
  | { tag: typeof GUARDIAN_FREEZE_V1_TAG; value: GuardianFreezeV1 }
  | { tag: typeof CREATE_EMERGENCY_RESOLUTION_V1_TAG; value: CreateEmergencyResolutionV1 }
  | { tag: typeof EXECUTE_EMERGENCY_RESOLUTION_V1_TAG; value: ExecuteEmergencyResolutionV1 }
  | { tag: typeof ADOPT_BUFFER_V1_TAG; value: AdoptBufferV1 }
  | { tag: typeof VERIFY_BUFFER_CHUNK_V1_TAG; value: VerifyBufferChunkV1 }
  | { tag: typeof FINALIZE_BUFFER_VERIFICATION_V1_TAG; value: FinalizeBufferVerificationV1 }
  | { tag: typeof EXTEND_TARGET_V1_TAG; value: ExtendTargetV1 }
  | { tag: typeof EXECUTE_UPGRADE_V1_TAG; value: ExecuteUpgradeV1 }
  | { tag: typeof VERIFY_PROGRAMDATA_CHUNK_V1_TAG; value: VerifyProgramDataChunkV1 }
  | { tag: typeof FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG; value: FinalizeProgramDataVerificationV1 }
  | { tag: typeof APPROVE_UNFREEZE_V1_TAG; value: ApproveUnfreezeV1 }
  | { tag: typeof EXECUTE_UNFREEZE_V1_TAG; value: ExecuteUnfreezeV1 }
  | { tag: typeof CLOSE_ABANDONED_BUFFER_V1_TAG; value: CloseAbandonedBufferV1 }
  | { tag: typeof ACTIVATE_ROLLBACK_V1_TAG; value: ActivateRollbackV1 }
  | { tag: typeof OBSERVE_PROGRAMDATA_FAILURE_V1_TAG; value: ObserveProgramDataFailureV1 };

function encodeFixed(tag: number, length: number, body: (writer: Writer) => void): Buffer {
  const writer = new Writer();
  writer.byte(tag, "tag");
  body(writer);
  const data = writer.finish(length);
  if (data.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) throw new Error("instruction exceeds outer cap");
  return data;
}

function decodeFixed<T>(
  data: Buffer,
  tag: number,
  length: number,
  body: (reader: Reader) => T,
): T {
  if (!Buffer.isBuffer(data) || data.length !== length || data[0] !== tag) {
    throw new Error("invalid fixed instruction tag or length");
  }
  const reader = new Reader(data);
  reader.byte();
  const value = body(reader);
  reader.finish();
  return value;
}

function guardianFreezeEvidence(value: GuardianFreezeV1): ObservationEvidenceV1 {
  return {
    programOwner: value.expectedProgramOwner,
    programExecutable: value.expectedProgramExecutable,
    programDataLength: value.expectedProgramDataLength,
    programHeaderPresent: value.expectedProgramHeaderPresent,
    linkedProgramdata: value.expectedLinkedProgramdata,
    programdataOwner: value.expectedProgramdataOwner,
    programdataExecutable: value.expectedProgramdataExecutable,
    programdataDataLength: value.expectedProgramdataDataLength,
    programdataHeaderPresent: value.expectedProgramdataHeaderPresent,
    programdataSlot: value.expectedProgramdataSlot,
    rawHashComplete: value.expectedRawHashComplete,
    rawProgramdataHash: value.expectedRawProgramdataHash,
    capacity: value.expectedCapacity,
    programdataAuthority: value.expectedProgramdataAuthority,
  };
}

function createEmergencyResolutionEvidence(
  value: CreateEmergencyResolutionV1,
): ObservationEvidenceV1 {
  return {
    programOwner: value.observedProgramOwner,
    programExecutable: value.observedProgramExecutable,
    programDataLength: value.observedProgramDataLength,
    programHeaderPresent: value.observedProgramHeaderPresent,
    linkedProgramdata: value.observedLinkedProgramdata,
    programdataOwner: value.observedProgramdataOwner,
    programdataExecutable: value.observedProgramdataExecutable,
    programdataDataLength: value.observedProgramdataDataLength,
    programdataHeaderPresent: value.observedProgramdataHeaderPresent,
    programdataSlot: value.observedProgramdataSlot,
    rawHashComplete: value.observedRawHashComplete,
    rawProgramdataHash: value.observedRawProgramdataHash,
    capacity: value.observedCapacity,
    programdataAuthority: value.observedProgramdataAuthority,
  };
}

function executeEmergencyResolutionEvidence(
  value: ExecuteEmergencyResolutionV1,
): ObservationEvidenceV1 {
  return {
    programOwner: value.expectedProgramOwner,
    programExecutable: value.expectedProgramExecutable,
    programDataLength: value.expectedProgramDataLength,
    programHeaderPresent: value.expectedProgramHeaderPresent,
    linkedProgramdata: value.expectedLinkedProgramdata,
    programdataOwner: value.expectedProgramdataOwner,
    programdataExecutable: value.expectedProgramdataExecutable,
    programdataDataLength: value.expectedProgramdataDataLength,
    programdataHeaderPresent: value.expectedProgramdataHeaderPresent,
    programdataSlot: value.expectedProgramdataSlot,
    rawHashComplete: value.expectedRawHashComplete,
    rawProgramdataHash: value.expectedRawProgramdataHash,
    capacity: value.expectedCapacity,
    programdataAuthority: value.expectedProgramdataAuthority,
  };
}

export function encodeGuardianFreezeV1(value: GuardianFreezeV1): Buffer {
  return encodeFixed(GUARDIAN_FREEZE_V1_TAG, GUARDIAN_FREEZE_V1_LEN, (writer) => {
    writer.byte(
      enumValue(value.expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1"),
      "expectedGateStatus",
    );
    writer.u64(value.expectedGateEpoch, "expectedGateEpoch");
    writer.u64(value.expectedNextGateEpoch, "expectedNextGateEpoch");
    writer.u64(value.expectedTargetNonce, "expectedTargetNonce");
    writeObservationEvidence(writer, guardianFreezeEvidence(value), "expected");
    writer.u16(value.freezeReasonCode, "freezeReasonCode");
    writer.bytes(value.expectedObservationDigest, 32, "expectedObservationDigest");
  });
}

export function decodeGuardianFreezeV1(data: Buffer): GuardianFreezeV1 {
  return decodeFixed(data, GUARDIAN_FREEZE_V1_TAG, GUARDIAN_FREEZE_V1_LEN, (reader) => {
    const expectedGateStatus = reader.byte() as GateStatusV1Value;
    enumValue(expectedGateStatus, Object.values(GateStatusV1), "GateStatusV1");
    const expectedGateEpoch = reader.u64();
    const expectedNextGateEpoch = reader.u64();
    const expectedTargetNonce = reader.u64();
    const evidence = readObservationEvidence(reader, "expected");
    return {
      expectedGateStatus,
      expectedGateEpoch,
      expectedNextGateEpoch,
      expectedTargetNonce,
      expectedProgramOwner: evidence.programOwner,
      expectedProgramExecutable: evidence.programExecutable,
      expectedProgramDataLength: evidence.programDataLength,
      expectedProgramHeaderPresent: evidence.programHeaderPresent,
      expectedLinkedProgramdata: evidence.linkedProgramdata,
      expectedProgramdataOwner: evidence.programdataOwner,
      expectedProgramdataExecutable: evidence.programdataExecutable,
      expectedProgramdataDataLength: evidence.programdataDataLength,
      expectedProgramdataHeaderPresent: evidence.programdataHeaderPresent,
      expectedProgramdataSlot: evidence.programdataSlot,
      expectedRawHashComplete: evidence.rawHashComplete,
      expectedRawProgramdataHash: evidence.rawProgramdataHash,
      expectedCapacity: evidence.capacity,
      expectedProgramdataAuthority: evidence.programdataAuthority,
      freezeReasonCode: reader.u16(),
      expectedObservationDigest: reader.bytes(32),
    };
  });
}

export function encodeCreateEmergencyResolutionV1(
  value: CreateEmergencyResolutionV1,
): Buffer {
  return encodeFixed(
    CREATE_EMERGENCY_RESOLUTION_V1_TAG,
    CREATE_EMERGENCY_RESOLUTION_V1_LEN,
    (writer) => {
      writer.byte(
        enumValue(
          value.resolutionKind,
          Object.values(EmergencyFreezeResolutionKindV1),
          "EmergencyFreezeResolutionKindV1",
        ),
        "resolutionKind",
      );
      writer.u64(value.creationSlot, "creationSlot");
      writer.u64(value.notBeforeSlot, "notBeforeSlot");
      writer.u64(value.expirySlot, "expirySlot");
      writer.u64(value.expectedPolicyVersion, "expectedPolicyVersion");
      writer.bytes(value.expectedPolicyHash, 32, "expectedPolicyHash");
      writer.u64(value.expectedCouncilVersion, "expectedCouncilVersion");
      writer.bytes(value.expectedCouncilHash, 32, "expectedCouncilHash");
      writer.u64(value.expectedGateEpoch, "expectedGateEpoch");
      writer.u64(value.expectedFreezeSlot, "expectedFreezeSlot");
      writer.u16(value.expectedFreezeReasonCode, "expectedFreezeReasonCode");
      writer.u64(value.expectedTargetNonce, "expectedTargetNonce");
      writer.bytes(
        value.expectedFreezeObservationDigest,
        32,
        "expectedFreezeObservationDigest",
      );
      writeObservationEvidence(
        writer,
        createEmergencyResolutionEvidence(value),
        "observed",
      );
      writer.bytes(value.expectedResolutionDigest, 32, "expectedResolutionDigest");
    },
  );
}

export function decodeCreateEmergencyResolutionV1(
  data: Buffer,
): CreateEmergencyResolutionV1 {
  return decodeFixed(
    data,
    CREATE_EMERGENCY_RESOLUTION_V1_TAG,
    CREATE_EMERGENCY_RESOLUTION_V1_LEN,
    (reader) => {
      const resolutionKind = reader.byte() as EmergencyFreezeResolutionKindV1Value;
      enumValue(
        resolutionKind,
        Object.values(EmergencyFreezeResolutionKindV1),
        "EmergencyFreezeResolutionKindV1",
      );
      const creationSlot = reader.u64();
      const notBeforeSlot = reader.u64();
      const expirySlot = reader.u64();
      const expectedPolicyVersion = reader.u64();
      const expectedPolicyHash = reader.bytes(32);
      const expectedCouncilVersion = reader.u64();
      const expectedCouncilHash = reader.bytes(32);
      const expectedGateEpoch = reader.u64();
      const expectedFreezeSlot = reader.u64();
      const expectedFreezeReasonCode = reader.u16();
      const expectedTargetNonce = reader.u64();
      const expectedFreezeObservationDigest = reader.bytes(32);
      const evidence = readObservationEvidence(reader, "observed");
      return {
        resolutionKind,
        creationSlot,
        notBeforeSlot,
        expirySlot,
        expectedPolicyVersion,
        expectedPolicyHash,
        expectedCouncilVersion,
        expectedCouncilHash,
        expectedGateEpoch,
        expectedFreezeSlot,
        expectedFreezeReasonCode,
        expectedTargetNonce,
        expectedFreezeObservationDigest,
        observedProgramOwner: evidence.programOwner,
        observedProgramExecutable: evidence.programExecutable,
        observedProgramDataLength: evidence.programDataLength,
        observedProgramHeaderPresent: evidence.programHeaderPresent,
        observedLinkedProgramdata: evidence.linkedProgramdata,
        observedProgramdataOwner: evidence.programdataOwner,
        observedProgramdataExecutable: evidence.programdataExecutable,
        observedProgramdataDataLength: evidence.programdataDataLength,
        observedProgramdataHeaderPresent: evidence.programdataHeaderPresent,
        observedProgramdataSlot: evidence.programdataSlot,
        observedRawHashComplete: evidence.rawHashComplete,
        observedRawProgramdataHash: evidence.rawProgramdataHash,
        observedCapacity: evidence.capacity,
        observedProgramdataAuthority: evidence.programdataAuthority,
        expectedResolutionDigest: reader.bytes(32),
      };
    },
  );
}

export function encodeExecuteEmergencyResolutionV1(
  value: ExecuteEmergencyResolutionV1,
): Buffer {
  const evidence = executeEmergencyResolutionEvidence(value);
  validateCanonicalExecuteObservation(evidence);
  return encodeFixed(
    EXECUTE_EMERGENCY_RESOLUTION_V1_TAG,
    EXECUTE_EMERGENCY_RESOLUTION_V1_LEN,
    (writer) => {
      writeEmergencyResolutionExpectation(writer, value.expected);
      writer.bytes(
        value.expectedFreezeObservationDigest,
        32,
        "expectedFreezeObservationDigest",
      );
      writer.bytes(value.expectedCheckpointDigest, 32, "expectedCheckpointDigest");
      writeObservationEvidence(writer, evidence, "expected");
    },
  );
}

export function decodeExecuteEmergencyResolutionV1(
  data: Buffer,
): ExecuteEmergencyResolutionV1 {
  return decodeFixed(
    data,
    EXECUTE_EMERGENCY_RESOLUTION_V1_TAG,
    EXECUTE_EMERGENCY_RESOLUTION_V1_LEN,
    (reader) => {
      const expected = readEmergencyResolutionExpectation(reader);
      const expectedFreezeObservationDigest = reader.bytes(32);
      const expectedCheckpointDigest = reader.bytes(32);
      const evidence = readObservationEvidence(reader, "expected");
      validateCanonicalExecuteObservation(evidence);
      return {
        expected,
        expectedFreezeObservationDigest,
        expectedCheckpointDigest,
        expectedProgramOwner: evidence.programOwner,
        expectedProgramExecutable: evidence.programExecutable,
        expectedProgramDataLength: evidence.programDataLength,
        expectedProgramHeaderPresent: evidence.programHeaderPresent,
        expectedLinkedProgramdata: evidence.linkedProgramdata,
        expectedProgramdataOwner: evidence.programdataOwner,
        expectedProgramdataExecutable: evidence.programdataExecutable,
        expectedProgramdataDataLength: evidence.programdataDataLength,
        expectedProgramdataHeaderPresent: evidence.programdataHeaderPresent,
        expectedProgramdataSlot: evidence.programdataSlot,
        expectedRawHashComplete: evidence.rawHashComplete,
        expectedRawProgramdataHash: evidence.rawProgramdataHash,
        expectedCapacity: evidence.capacity,
        expectedProgramdataAuthority: evidence.programdataAuthority,
      };
    },
  );
}

export function encodeAdoptBufferV1(value: AdoptBufferV1): Buffer {
  return encodeFixed(ADOPT_BUFFER_V1_TAG, ADOPT_BUFFER_V1_LEN, (writer) =>
    writeProposalExpectation(writer, value.expected),
  );
}
export function decodeAdoptBufferV1(data: Buffer): AdoptBufferV1 {
  return decodeFixed(data, ADOPT_BUFFER_V1_TAG, ADOPT_BUFFER_V1_LEN, (reader) => ({
    expected: readProposalExpectation(reader),
  }));
}

export function encodeVerifyBufferChunkV1(value: VerifyBufferChunkV1): Buffer {
  return encodeFixed(VERIFY_BUFFER_CHUNK_V1_TAG, VERIFY_BUFFER_CHUNK_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.u32(value.chunkIndex, "chunkIndex");
    writeProof(writer, value.proof);
    writer.byte(
      enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"),
      "expectedVerificationStatus",
    );
    writeBitmap(writer, value.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap");
    writer.u32(value.expectedVerifiedChunkCount, "expectedVerifiedChunkCount");
  });
}
export function decodeVerifyBufferChunkV1(data: Buffer): VerifyBufferChunkV1 {
  return decodeFixed(data, VERIFY_BUFFER_CHUNK_V1_TAG, VERIFY_BUFFER_CHUNK_V1_LEN, (reader) => {
    const value: VerifyBufferChunkV1 = {
      expected: readProposalExpectation(reader),
      chunkIndex: reader.u32(),
      proof: readProof(reader),
      expectedVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      expectedVerifiedChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedVerifiedChunkCount: reader.u32(),
    };
    enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    return value;
  });
}

export function encodeFinalizeBufferVerificationV1(value: FinalizeBufferVerificationV1): Buffer {
  return encodeFixed(FINALIZE_BUFFER_VERIFICATION_V1_TAG, FINALIZE_BUFFER_VERIFICATION_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.byte(enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"), "expectedVerificationStatus");
    writeBitmap(writer, value.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap");
    writer.u32(value.expectedVerifiedChunkCount, "expectedVerifiedChunkCount");
  });
}
export function decodeFinalizeBufferVerificationV1(data: Buffer): FinalizeBufferVerificationV1 {
  return decodeFixed(data, FINALIZE_BUFFER_VERIFICATION_V1_TAG, FINALIZE_BUFFER_VERIFICATION_V1_LEN, (reader) => {
    const value: FinalizeBufferVerificationV1 = {
      expected: readProposalExpectation(reader),
      expectedVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      expectedVerifiedChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedVerifiedChunkCount: reader.u32(),
    };
    enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    return value;
  });
}

export function encodeExtendTargetV1(value: ExtendTargetV1): Buffer {
  return encodeFixed(EXTEND_TARGET_V1_TAG, EXTEND_TARGET_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.bytes(value.expectedPrestateCheckpointDigest, 32, "expectedPrestateCheckpointDigest");
    writer.u64(value.expectedCurrentCapacity, "expectedCurrentCapacity");
    writer.u64(value.expectedExtensionDelta, "expectedExtensionDelta");
    writer.u64(value.expectedPostCapacity, "expectedPostCapacity");
    writeEnvelope(writer, value.envelope);
  });
}
export function decodeExtendTargetV1(data: Buffer): ExtendTargetV1 {
  return decodeFixed(data, EXTEND_TARGET_V1_TAG, EXTEND_TARGET_V1_LEN, (reader) => ({
    expected: readProposalExpectation(reader),
    expectedPrestateCheckpointDigest: reader.bytes(32),
    expectedCurrentCapacity: reader.u64(),
    expectedExtensionDelta: reader.u64(),
    expectedPostCapacity: reader.u64(),
    envelope: readEnvelope(reader),
  }));
}

export function encodeExecuteUpgradeV1(value: ExecuteUpgradeV1): Buffer {
  return encodeFixed(EXECUTE_UPGRADE_V1_TAG, EXECUTE_UPGRADE_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.bytes(value.expectedPrestateCheckpointDigest, 32, "expectedPrestateCheckpointDigest");
    writer.bytes(value.expectedCurrentRawProgramdataHash, 32, "expectedCurrentRawProgramdataHash");
    writer.bytes(value.expectedSealedBufferHeaderHash, 32, "expectedSealedBufferHeaderHash");
    writer.bytes(value.expectedCounterpartProposalDigest, 32, "expectedCounterpartProposalDigest");
    writer.u64(value.expectedProgramdataSlot, "expectedProgramdataSlot");
    writer.u64(value.expectedCapacity, "expectedCapacity");
    writer.u32(value.expectedVerifiedChunkCount, "expectedVerifiedChunkCount");
    writer.byte(enumValue(value.expectedBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"), "expectedBufferVerificationStatus");
    writer.byte(enumValue(value.expectedCounterpartBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"), "expectedCounterpartBufferVerificationStatus");
    writeEnvelope(writer, value.envelope);
  });
}
export function decodeExecuteUpgradeV1(data: Buffer): ExecuteUpgradeV1 {
  return decodeFixed(data, EXECUTE_UPGRADE_V1_TAG, EXECUTE_UPGRADE_V1_LEN, (reader) => {
    const value: ExecuteUpgradeV1 = {
      expected: readProposalExpectation(reader),
      expectedPrestateCheckpointDigest: reader.bytes(32),
      expectedCurrentRawProgramdataHash: reader.bytes(32),
      expectedSealedBufferHeaderHash: reader.bytes(32),
      expectedCounterpartProposalDigest: reader.bytes(32),
      expectedProgramdataSlot: reader.u64(),
      expectedCapacity: reader.u64(),
      expectedVerifiedChunkCount: reader.u32(),
      expectedBufferVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      expectedCounterpartBufferVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      envelope: readEnvelope(reader),
    };
    enumValue(value.expectedBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    enumValue(value.expectedCounterpartBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    return value;
  });
}

function validateProgramDataChunk(value: VerifyProgramDataChunkV1): void {
  enumValue(value.phase, Object.values(ProgramDataChunkPhaseV1), "ProgramDataChunkPhaseV1");
  validateProof(value.proof);
  if (value.phase === ProgramDataChunkPhaseV1.ZeroTail && value.proof.proofLen !== 0) {
    throw new Error("zero-tail chunks must use an empty Merkle proof");
  }
}

export function encodeVerifyProgramDataChunkV1(value: VerifyProgramDataChunkV1): Buffer {
  validateProgramDataChunk(value);
  return encodeFixed(VERIFY_PROGRAMDATA_CHUNK_V1_TAG, VERIFY_PROGRAMDATA_CHUNK_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.byte(value.phase, "phase");
    writer.u32(value.chunkIndex, "chunkIndex");
    writeProof(writer, value.proof);
    writer.byte(enumValue(value.expectedVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1"), "expectedVerificationStatus");
    writeBitmap(writer, value.expectedVerifiedPayloadChunkBitmap, "expectedVerifiedPayloadChunkBitmap");
    writer.u32(value.expectedVerifiedPayloadChunkCount, "expectedVerifiedPayloadChunkCount");
    writeBitmap(writer, value.expectedVerifiedTailChunkBitmap, "expectedVerifiedTailChunkBitmap");
    writer.u32(value.expectedVerifiedTailChunkCount, "expectedVerifiedTailChunkCount");
  });
}
export function decodeVerifyProgramDataChunkV1(data: Buffer): VerifyProgramDataChunkV1 {
  const value = decodeFixed(data, VERIFY_PROGRAMDATA_CHUNK_V1_TAG, VERIFY_PROGRAMDATA_CHUNK_V1_LEN, (reader) => ({
    expected: readProposalExpectation(reader),
    phase: reader.byte() as ProgramDataChunkPhaseV1Value,
    chunkIndex: reader.u32(),
    proof: readProof(reader),
    expectedVerificationStatus: reader.byte() as ProgramDataVerificationStatusV1Value,
    expectedVerifiedPayloadChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
    expectedVerifiedPayloadChunkCount: reader.u32(),
    expectedVerifiedTailChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
    expectedVerifiedTailChunkCount: reader.u32(),
  }));
  enumValue(value.expectedVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1");
  validateProgramDataChunk(value);
  return value;
}

export function encodeFinalizeProgramDataVerificationV1(value: FinalizeProgramDataVerificationV1): Buffer {
  return encodeFixed(FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG, FINALIZE_PROGRAMDATA_VERIFICATION_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.byte(enumValue(value.expectedVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1"), "expectedVerificationStatus");
    writeBitmap(writer, value.expectedVerifiedPayloadChunkBitmap, "expectedVerifiedPayloadChunkBitmap");
    writer.u32(value.expectedVerifiedPayloadChunkCount, "expectedVerifiedPayloadChunkCount");
    writeBitmap(writer, value.expectedVerifiedTailChunkBitmap, "expectedVerifiedTailChunkBitmap");
    writer.u32(value.expectedVerifiedTailChunkCount, "expectedVerifiedTailChunkCount");
    writer.u64(value.expectedDeployedSlot, "expectedDeployedSlot");
    writer.u64(value.expectedCapacity, "expectedCapacity");
  });
}
export function decodeFinalizeProgramDataVerificationV1(data: Buffer): FinalizeProgramDataVerificationV1 {
  return decodeFixed(data, FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG, FINALIZE_PROGRAMDATA_VERIFICATION_V1_LEN, (reader) => {
    const value: FinalizeProgramDataVerificationV1 = {
      expected: readProposalExpectation(reader),
      expectedVerificationStatus: reader.byte() as ProgramDataVerificationStatusV1Value,
      expectedVerifiedPayloadChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedVerifiedPayloadChunkCount: reader.u32(),
      expectedVerifiedTailChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedVerifiedTailChunkCount: reader.u32(),
      expectedDeployedSlot: reader.u64(),
      expectedCapacity: reader.u64(),
    };
    enumValue(value.expectedVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1");
    return value;
  });
}

export function encodeApproveUnfreezeV1(value: ApproveUnfreezeV1): Buffer {
  return encodeFixed(APPROVE_UNFREEZE_V1_TAG, APPROVE_UNFREEZE_V1_LEN, (writer) => writeUnfreeze(writer, value.expected));
}
export function decodeApproveUnfreezeV1(data: Buffer): ApproveUnfreezeV1 {
  return decodeFixed(data, APPROVE_UNFREEZE_V1_TAG, APPROVE_UNFREEZE_V1_LEN, (reader) => ({ expected: readUnfreeze(reader) }));
}

export function encodeExecuteUnfreezeV1(value: ExecuteUnfreezeV1): Buffer {
  return encodeFixed(EXECUTE_UNFREEZE_V1_TAG, EXECUTE_UNFREEZE_V1_LEN, (writer) => {
    writeUnfreeze(writer, value.expected);
    writer.key(nondefault(value.linkedProposal, "linkedProposal"), "linkedProposal");
    writeEnvelope(writer, value.envelope);
  });
}
export function decodeExecuteUnfreezeV1(data: Buffer): ExecuteUnfreezeV1 {
  return decodeFixed(data, EXECUTE_UNFREEZE_V1_TAG, EXECUTE_UNFREEZE_V1_LEN, (reader) => ({
    expected: readUnfreeze(reader),
    linkedProposal: nondefault(reader.key(), "linkedProposal"),
    envelope: readEnvelope(reader),
  }));
}

export function encodeCloseAbandonedBufferV1(value: CloseAbandonedBufferV1): Buffer {
  return encodeFixed(CLOSE_ABANDONED_BUFFER_V1_TAG, CLOSE_ABANDONED_BUFFER_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.byte(enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"), "expectedVerificationStatus");
    writeBitmap(writer, value.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap");
    writer.u32(value.expectedVerifiedChunkCount, "expectedVerifiedChunkCount");
    writer.u64(value.expectedBufferVerificationFinalizedSlot, "expectedBufferVerificationFinalizedSlot");
  });
}
export function decodeCloseAbandonedBufferV1(data: Buffer): CloseAbandonedBufferV1 {
  return decodeFixed(data, CLOSE_ABANDONED_BUFFER_V1_TAG, CLOSE_ABANDONED_BUFFER_V1_LEN, (reader) => {
    const value: CloseAbandonedBufferV1 = {
      expected: readProposalExpectation(reader),
      expectedVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      expectedVerifiedChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedVerifiedChunkCount: reader.u32(),
      expectedBufferVerificationFinalizedSlot: reader.u64(),
    };
    enumValue(value.expectedVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    return value;
  });
}

export function encodeActivateRollbackV1(value: ActivateRollbackV1): Buffer {
  return encodeFixed(ACTIVATE_ROLLBACK_V1_TAG, ACTIVATE_ROLLBACK_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expectedPrimary);
    writeProposalExpectation(writer, value.expectedRollback);
    writer.bytes(value.expectedFailureEvidenceDigest, 32, "expectedFailureEvidenceDigest");
    writer.byte(enumValue(value.expectedPrimaryProgramdataVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1"), "expectedPrimaryProgramdataVerificationStatus");
    writer.u64(value.expectedPrimaryProgramdataVerificationFinalizedSlot, "expectedPrimaryProgramdataVerificationFinalizedSlot");
    writer.byte(enumValue(value.expectedRollbackBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1"), "expectedRollbackBufferVerificationStatus");
    writeBitmap(writer, value.expectedRollbackVerifiedChunkBitmap, "expectedRollbackVerifiedChunkBitmap");
    writer.u32(value.expectedRollbackVerifiedChunkCount, "expectedRollbackVerifiedChunkCount");
  });
}
export function decodeActivateRollbackV1(data: Buffer): ActivateRollbackV1 {
  return decodeFixed(data, ACTIVATE_ROLLBACK_V1_TAG, ACTIVATE_ROLLBACK_V1_LEN, (reader) => {
    const value: ActivateRollbackV1 = {
      expectedPrimary: readProposalExpectation(reader),
      expectedRollback: readProposalExpectation(reader),
      expectedFailureEvidenceDigest: reader.bytes(32),
      expectedPrimaryProgramdataVerificationStatus: reader.byte() as ProgramDataVerificationStatusV1Value,
      expectedPrimaryProgramdataVerificationFinalizedSlot: reader.u64(),
      expectedRollbackBufferVerificationStatus: reader.byte() as BufferVerificationStatusV1Value,
      expectedRollbackVerifiedChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
      expectedRollbackVerifiedChunkCount: reader.u32(),
    };
    enumValue(value.expectedPrimaryProgramdataVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "ProgramDataVerificationStatusV1");
    enumValue(value.expectedRollbackBufferVerificationStatus, Object.values(BufferVerificationStatusV1), "BufferVerificationStatusV1");
    return value;
  });
}

function validateFailure(value: ObserveProgramDataFailureV1): void {
  enumValue(value.mismatchClass, Object.values(ProgramDataMismatchClassV1), "ProgramDataMismatchClassV1");
  validateProof(value.proof);
  validateOptional(value.expectedLinkedProgramdata, "expectedLinkedProgramdata");
  validateOptional(value.expectedProgramdataAuthority, "expectedProgramdataAuthority");
  if (typeof value.expectedProgramExecutable !== "boolean") {
    throw new TypeError("expectedProgramExecutable must be boolean");
  }
  if (typeof value.expectedProgramHeaderPresent !== "boolean") {
    throw new TypeError("expectedProgramHeaderPresent must be boolean");
  }
  if (typeof value.expectedProgramdataExecutable !== "boolean") {
    throw new TypeError("expectedProgramdataExecutable must be boolean");
  }
  if (typeof value.expectedProgramdataHeaderPresent !== "boolean") {
    throw new TypeError("expectedProgramdataHeaderPresent must be boolean");
  }
  if (typeof value.expectedRawHashComplete !== "boolean") {
    throw new TypeError("expectedRawHashComplete must be boolean");
  }
  for (const [field, numeric] of [
    ["expectedProgramDataLength", value.expectedProgramDataLength],
    ["expectedProgramdataDataLength", value.expectedProgramdataDataLength],
    ["expectedProgramdataSlot", value.expectedProgramdataSlot],
    ["expectedCapacity", value.expectedCapacity],
  ] as const) {
    if (
      typeof numeric !== "bigint" ||
      numeric < 0n ||
      numeric > 0xffff_ffff_ffff_ffffn
    ) {
      throw new RangeError(`${field} must be a u64`);
    }
  }
  if (
    value.expectedProgramHeaderPresent
      ? value.expectedProgramDataLength !== 36n || !value.expectedLinkedProgramdata.present
      : value.expectedLinkedProgramdata.present
  ) {
    throw new Error("invalid expected Program header evidence");
  }
  if (
    value.expectedProgramdataHeaderPresent
      ? value.expectedProgramdataDataLength !== value.expectedCapacity + 45n
      : value.expectedProgramdataSlot !== 0n ||
        value.expectedCapacity !== 0n ||
        value.expectedProgramdataAuthority.present
  ) {
    throw new Error("invalid expected ProgramData header evidence");
  }
  if (
    !Buffer.isBuffer(value.expectedRawProgramdataHash) ||
    value.expectedRawProgramdataHash.length !== 32 ||
    value.expectedRawHashComplete !==
      (value.expectedProgramdataDataLength <=
        MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1) ||
    value.expectedRawHashComplete === value.expectedRawProgramdataHash.equals(ZERO_32)
  ) {
    throw new Error("invalid expected raw ProgramData hash evidence");
  }
  const leaf =
    value.mismatchClass === ProgramDataMismatchClassV1.PayloadLeaf ||
    value.mismatchClass === ProgramDataMismatchClassV1.ZeroTail;
  if (leaf) {
    if (
      !value.expectedRawHashComplete ||
      value.failingChunkIndex === U32_MAX ||
      value.expectedLeafHash.equals(ZERO_32)
    ) {
      throw new Error(
        "leaf failure requires rawHashComplete, an index, and a nonzero expected leaf",
      );
    }
    if (value.mismatchClass === ProgramDataMismatchClassV1.ZeroTail && value.proof.proofLen !== 0) {
      throw new Error("zero-tail failure must use an empty proof");
    }
    // For ZeroTail this hash is a stale-plan guard only. The processor derives
    // the canonical zero-chunk hash from the observed ProgramData byte range.
  } else if (
    value.failingChunkIndex !== U32_MAX ||
    !value.expectedLeafHash.equals(ZERO_32) ||
    value.proof.proofLen !== 0
  ) {
    throw new Error("non-leaf failure must use the canonical empty leaf shape");
  }
}

export function encodeObserveProgramDataFailureV1(value: ObserveProgramDataFailureV1): Buffer {
  validateFailure(value);
  return encodeFixed(OBSERVE_PROGRAMDATA_FAILURE_V1_TAG, OBSERVE_PROGRAMDATA_FAILURE_V1_LEN, (writer) => {
    writeProposalExpectation(writer, value.expected);
    writer.key(value.expectedProgramOwner, "expectedProgramOwner");
    writer.bool(value.expectedProgramExecutable, "expectedProgramExecutable");
    writer.u64(value.expectedProgramDataLength, "expectedProgramDataLength");
    writer.bool(value.expectedProgramHeaderPresent, "expectedProgramHeaderPresent");
    writeOptional(writer, value.expectedLinkedProgramdata, "expectedLinkedProgramdata");
    writer.key(value.expectedProgramdataOwner, "expectedProgramdataOwner");
    writer.bool(value.expectedProgramdataExecutable, "expectedProgramdataExecutable");
    writer.u64(value.expectedProgramdataDataLength, "expectedProgramdataDataLength");
    writer.bool(value.expectedProgramdataHeaderPresent, "expectedProgramdataHeaderPresent");
    writer.u64(value.expectedProgramdataSlot, "expectedProgramdataSlot");
    writer.bool(value.expectedRawHashComplete, "expectedRawHashComplete");
    writer.bytes(value.expectedRawProgramdataHash, 32, "expectedRawProgramdataHash");
    writer.u64(value.expectedCapacity, "expectedCapacity");
    writeOptional(writer, value.expectedProgramdataAuthority, "expectedProgramdataAuthority");
    writer.byte(value.mismatchClass, "mismatchClass");
    writer.u32(value.failingChunkIndex, "failingChunkIndex");
    writer.bytes(value.expectedLeafHash, 32, "expectedLeafHash");
    writeProof(writer, value.proof);
  });
}
export function decodeObserveProgramDataFailureV1(data: Buffer): ObserveProgramDataFailureV1 {
  const value = decodeFixed(data, OBSERVE_PROGRAMDATA_FAILURE_V1_TAG, OBSERVE_PROGRAMDATA_FAILURE_V1_LEN, (reader) => ({
    expected: readProposalExpectation(reader),
    expectedProgramOwner: reader.key(),
    expectedProgramExecutable: reader.bool("expectedProgramExecutable"),
    expectedProgramDataLength: reader.u64(),
    expectedProgramHeaderPresent: reader.bool("expectedProgramHeaderPresent"),
    expectedLinkedProgramdata: readOptional(reader, "expectedLinkedProgramdata"),
    expectedProgramdataOwner: reader.key(),
    expectedProgramdataExecutable: reader.bool("expectedProgramdataExecutable"),
    expectedProgramdataDataLength: reader.u64(),
    expectedProgramdataHeaderPresent: reader.bool("expectedProgramdataHeaderPresent"),
    expectedProgramdataSlot: reader.u64(),
    expectedRawHashComplete: reader.bool("expectedRawHashComplete"),
    expectedRawProgramdataHash: reader.bytes(32),
    expectedCapacity: reader.u64(),
    expectedProgramdataAuthority: readOptional(reader, "expectedProgramdataAuthority"),
    mismatchClass: reader.byte() as ProgramDataMismatchClassV1Value,
    failingChunkIndex: reader.u32(),
    expectedLeafHash: reader.bytes(32),
    proof: readProof(reader),
  }));
  validateFailure(value);
  return value;
}

export function decodeRelease1LoaderInstructionV1(data: Buffer): Release1LoaderInstructionV1 {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) {
    throw new Error("invalid controller instruction data");
  }
  switch (data[0]) {
    case GUARDIAN_FREEZE_V1_TAG: return { tag: GUARDIAN_FREEZE_V1_TAG, value: decodeGuardianFreezeV1(data) };
    case CREATE_EMERGENCY_RESOLUTION_V1_TAG: return { tag: CREATE_EMERGENCY_RESOLUTION_V1_TAG, value: decodeCreateEmergencyResolutionV1(data) };
    case EXECUTE_EMERGENCY_RESOLUTION_V1_TAG: return { tag: EXECUTE_EMERGENCY_RESOLUTION_V1_TAG, value: decodeExecuteEmergencyResolutionV1(data) };
    case ADOPT_BUFFER_V1_TAG: return { tag: ADOPT_BUFFER_V1_TAG, value: decodeAdoptBufferV1(data) };
    case VERIFY_BUFFER_CHUNK_V1_TAG: return { tag: VERIFY_BUFFER_CHUNK_V1_TAG, value: decodeVerifyBufferChunkV1(data) };
    case FINALIZE_BUFFER_VERIFICATION_V1_TAG: return { tag: FINALIZE_BUFFER_VERIFICATION_V1_TAG, value: decodeFinalizeBufferVerificationV1(data) };
    case EXTEND_TARGET_V1_TAG: return { tag: EXTEND_TARGET_V1_TAG, value: decodeExtendTargetV1(data) };
    case EXECUTE_UPGRADE_V1_TAG: return { tag: EXECUTE_UPGRADE_V1_TAG, value: decodeExecuteUpgradeV1(data) };
    case VERIFY_PROGRAMDATA_CHUNK_V1_TAG: return { tag: VERIFY_PROGRAMDATA_CHUNK_V1_TAG, value: decodeVerifyProgramDataChunkV1(data) };
    case FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG: return { tag: FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG, value: decodeFinalizeProgramDataVerificationV1(data) };
    case APPROVE_UNFREEZE_V1_TAG: return { tag: APPROVE_UNFREEZE_V1_TAG, value: decodeApproveUnfreezeV1(data) };
    case EXECUTE_UNFREEZE_V1_TAG: return { tag: EXECUTE_UNFREEZE_V1_TAG, value: decodeExecuteUnfreezeV1(data) };
    case CLOSE_ABANDONED_BUFFER_V1_TAG: return { tag: CLOSE_ABANDONED_BUFFER_V1_TAG, value: decodeCloseAbandonedBufferV1(data) };
    case ACTIVATE_ROLLBACK_V1_TAG: return { tag: ACTIVATE_ROLLBACK_V1_TAG, value: decodeActivateRollbackV1(data) };
    case OBSERVE_PROGRAMDATA_FAILURE_V1_TAG: return { tag: OBSERVE_PROGRAMDATA_FAILURE_V1_TAG, value: decodeObserveProgramDataFailureV1(data) };
    default: throw new Error("unsupported closed loader instruction tag");
  }
}

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const rs = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: false });
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });
const ix = (programId: PublicKey, keys: AccountMeta[], data: Buffer): TransactionInstruction =>
  new TransactionInstruction({ programId, keys, data });

export interface GuardianFreezeV1Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; authorityPda: PublicKey; guardian: PublicKey; emergencyFreezeObservation: PublicKey; systemProgram: PublicKey }
export function buildGuardianFreezeV1Instruction(programId: PublicKey, a: GuardianFreezeV1Accounts, v: GuardianFreezeV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), rw(a.protocolGate), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), ro(a.authorityPda), rs(a.guardian), rw(a.emergencyFreezeObservation), ro(a.systemProgram)], encodeGuardianFreezeV1(v)); }

export interface CreateEmergencyResolutionV1Accounts { payer: PublicKey; controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; emergencyFreezeObservation: PublicKey; emergencyResolution: PublicKey; systemProgram: PublicKey }
export function buildCreateEmergencyResolutionV1Instruction(programId: PublicKey, a: CreateEmergencyResolutionV1Accounts, v: CreateEmergencyResolutionV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.policy), ro(a.council), ro(a.protocolGate), ro(a.emergencyFreezeObservation), rw(a.emergencyResolution), ro(a.systemProgram)], encodeCreateEmergencyResolutionV1(v)); }

export interface ExecuteEmergencyResolutionV1Accounts { controllerConfig: PublicKey; policy: PublicKey; council: PublicKey; protocolGate: PublicKey; emergencyResolution: PublicKey; emergencyFreezeObservation: PublicKey; emergencyCheckpoint: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; upgradeableLoader: PublicKey; authorityPda: PublicKey; instructionsSysvar: PublicKey }
export function buildExecuteEmergencyResolutionV1Instruction(programId: PublicKey, a: ExecuteEmergencyResolutionV1Accounts, v: ExecuteEmergencyResolutionV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.council), rw(a.protocolGate), rw(a.emergencyResolution), ro(a.emergencyFreezeObservation), ro(a.emergencyCheckpoint), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.upgradeableLoader), ro(a.authorityPda), ro(a.instructionsSysvar)], encodeExecuteEmergencyResolutionV1(v)); }

export interface AdoptBufferV1Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; buffer: PublicKey; uploaderAuthority: PublicKey; authorityPda: PublicKey; bufferVerification: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey }
export function buildAdoptBufferV1Instruction(programId: PublicKey, a: AdoptBufferV1Accounts, v: AdoptBufferV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), rw(a.buffer), rs(a.uploaderAuthority), ro(a.authorityPda), rw(a.bufferVerification), ro(a.upgradeableLoader), ro(a.systemProgram)], encodeAdoptBufferV1(v)); }

export interface VerifyBufferChunkV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; buffer: PublicKey; bufferVerification: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export function buildVerifyBufferChunkV1Instruction(programId: PublicKey, a: VerifyBufferChunkV1Accounts, v: VerifyBufferChunkV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), ro(a.proposal), ro(a.buffer), rw(a.bufferVerification), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeVerifyBufferChunkV1(v)); }

export interface FinalizeBufferVerificationV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; buffer: PublicKey; bufferVerification: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export function buildFinalizeBufferVerificationV1Instruction(programId: PublicKey, a: FinalizeBufferVerificationV1Accounts, v: FinalizeBufferVerificationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.buffer), rw(a.bufferVerification), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeFinalizeBufferVerificationV1(v)); }

export interface ExtendTargetV1Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; prestateCheckpoint: PublicKey; targetProgramdata: PublicKey; targetProgram: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey; rentSysvar: PublicKey; instructionsSysvar: PublicKey }
export function buildExtendTargetV1Instruction(programId: PublicKey, a: ExtendTargetV1Accounts, v: ExtendTargetV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.prestateCheckpoint), rw(a.targetProgramdata), rw(a.targetProgram), rw(a.authorityPda), ro(a.upgradeableLoader), ro(a.systemProgram), ro(a.rentSysvar), ro(a.instructionsSysvar)], encodeExtendTargetV1(v)); }

export interface ExecuteUpgradeV1Accounts { payer: PublicKey; controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; proposal: PublicKey; counterpartProposal: PublicKey; counterpartBufferVerification: PublicKey; prestateCheckpoint: PublicKey; bufferVerification: PublicKey; programdataVerification: PublicKey; targetProgramdata: PublicKey; targetProgram: PublicKey; buffer: PublicKey; canonicalSpillTreasury: PublicKey; rentSysvar: PublicKey; clockSysvar: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey; instructionsSysvar: PublicKey }
export function buildExecuteUpgradeV1Instruction(programId: PublicKey, a: ExecuteUpgradeV1Accounts, v: ExecuteUpgradeV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.policy), ro(a.protocolGate), rw(a.proposal), ro(a.counterpartProposal), ro(a.counterpartBufferVerification), ro(a.prestateCheckpoint), rw(a.bufferVerification), rw(a.programdataVerification), rw(a.targetProgramdata), rw(a.targetProgram), rw(a.buffer), rw(a.canonicalSpillTreasury), ro(a.rentSysvar), ro(a.clockSysvar), ro(a.authorityPda), ro(a.upgradeableLoader), ro(a.systemProgram), ro(a.instructionsSysvar)], encodeExecuteUpgradeV1(v)); }

export interface VerifyProgramDataChunkV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; programdataVerification: PublicKey }
export function buildVerifyProgramDataChunkV1Instruction(programId: PublicKey, a: VerifyProgramDataChunkV1Accounts, v: VerifyProgramDataChunkV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), ro(a.proposal), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader), rw(a.programdataVerification)], encodeVerifyProgramDataChunkV1(v)); }

export interface FinalizeProgramDataVerificationV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; programdataVerification: PublicKey }
export function buildFinalizeProgramDataVerificationV1Instruction(programId: PublicKey, a: FinalizeProgramDataVerificationV1Accounts, v: FinalizeProgramDataVerificationV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader), rw(a.programdataVerification)], encodeFinalizeProgramDataVerificationV1(v)); }

export interface ApproveUnfreezeV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; protocolGate: PublicKey; proposal: PublicKey; poststateCheckpoint: PublicKey; programdataVerification: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; seatAuthority: PublicKey }
export function buildApproveUnfreezeV1Instruction(programId: PublicKey, a: ApproveUnfreezeV1Accounts, v: ApproveUnfreezeV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), ro(a.protocolGate), rw(a.proposal), ro(a.poststateCheckpoint), ro(a.programdataVerification), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader), rs(a.seatAuthority)], encodeApproveUnfreezeV1(v)); }

export interface ExecuteUnfreezeV1Accounts { controllerConfig: PublicKey; policy: PublicKey; currentCouncil: PublicKey; protocolGate: PublicKey; proposal: PublicKey; linkedProposal: PublicKey; poststateCheckpoint: PublicKey; programdataVerification: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; instructionsSysvar: PublicKey }
export function buildExecuteUnfreezeV1Instruction(programId: PublicKey, a: ExecuteUnfreezeV1Accounts, v: ExecuteUnfreezeV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), ro(a.currentCouncil), rw(a.protocolGate), rw(a.proposal), rw(a.linkedProposal), ro(a.poststateCheckpoint), ro(a.programdataVerification), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader), ro(a.instructionsSysvar)], encodeExecuteUnfreezeV1(v)); }

export interface CloseAbandonedBufferV1Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; bufferVerification: PublicKey; buffer: PublicKey; canonicalSpillTreasury: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export function buildCloseAbandonedBufferV1Instruction(programId: PublicKey, a: CloseAbandonedBufferV1Accounts, v: CloseAbandonedBufferV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.protocolGate), ro(a.proposal), rw(a.bufferVerification), rw(a.buffer), rw(a.canonicalSpillTreasury), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeCloseAbandonedBufferV1(v)); }

export interface ActivateRollbackV1Accounts { controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; primaryProposal: PublicKey; rollbackProposal: PublicKey; rollbackBufferVerification: PublicKey; primaryProgramdataVerification: PublicKey; failureEvidence: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export function buildActivateRollbackV1Instruction(programId: PublicKey, a: ActivateRollbackV1Accounts, v: ActivateRollbackV1): TransactionInstruction { return ix(programId, [ro(a.controllerConfig), ro(a.policy), rw(a.protocolGate), ro(a.primaryProposal), rw(a.rollbackProposal), ro(a.rollbackBufferVerification), ro(a.primaryProgramdataVerification), ro(a.failureEvidence), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeActivateRollbackV1(v)); }

export interface ObserveProgramDataFailureV1Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; primaryProposal: PublicKey; programdataVerification: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; failureObservation: PublicKey; systemProgram: PublicKey }
export function buildObserveProgramDataFailureV1Instruction(programId: PublicKey, a: ObserveProgramDataFailureV1Accounts, v: ObserveProgramDataFailureV1): TransactionInstruction { return ix(programId, [ws(a.payer), ro(a.controllerConfig), ro(a.protocolGate), ro(a.primaryProposal), ro(a.programdataVerification), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader), rw(a.failureObservation), ro(a.systemProgram)], encodeObserveProgramDataFailureV1(v)); }
