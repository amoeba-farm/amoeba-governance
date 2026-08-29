import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  type ProgramDataObservationPurposeV1 as ProgramDataObservationPurposeV1Value,
  type ProgramDataObservationStatusV1 as ProgramDataObservationStatusV1Value,
} from "./release1Ceremony.js";
import {
  ARTIFACT_MERKLE_SCHEME_ID,
  MAX_ARTIFACT_BYTES_V1,
} from "./artifactMerkleV1.js";
import {
  GateStatusV1,
  type GateStatusV1 as GateStatusV1Value,
} from "./release1.js";

export const BEGIN_PROGRAMDATA_OBSERVATION_V1_TAG = 39;
export const APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_TAG = 40;
export const VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_TAG = 41;
export const FINALIZE_PROGRAMDATA_OBSERVATION_V1_TAG = 42;

export const PROGRAMDATA_OBSERVATION_GUARD_V1_LEN = 60;
export const OBSERVATION_AUTHORITY_V1_LEN = 33;
export const MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1 = 7;
export const OBSERVED_ARTIFACT_MERKLE_PROOF_V1_LEN =
  1 + 32 * MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1;
export const BEGIN_PROGRAMDATA_OBSERVATION_V1_LEN = 254;
export const APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_LEN = 66;
export const VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_LEN = 303;
export const FINALIZE_PROGRAMDATA_OBSERVATION_V1_LEN = 78;

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const MAX_CONTROLLER_INSTRUCTION_DATA_LEN = 16_384;
const ZERO_HASH = Buffer.alloc(32);

export interface ObservationAuthorityV1 {
  present: boolean;
  value: PublicKey;
}

export interface ObservedArtifactMerkleProofV1 {
  proofLen: number;
  nodes: readonly Buffer[];
}

export interface ProgramDataObservationGuardV1 {
  purpose: ProgramDataObservationPurposeV1Value;
  generation: bigint;
  expectedSubjectDigest: Buffer;
  expectedGateStatus: GateStatusV1Value;
  expectedGateEpoch: bigint;
  expectedFreezeReasonCode: number;
  expectedFreezeSlot: bigint;
}

export interface BeginProgramDataObservationV1 {
  guard: ProgramDataObservationGuardV1;
  expectedCapacityPolicyDigest: Buffer;
  expectedArtifactLength: bigint;
  expectedArtifactSha256: Buffer;
  expectedArtifactMerkleRoot: Buffer;
  expectedArtifactSchemeId: Buffer;
  minimumRequiredCapacity: bigint;
  expectedDeployedSlot: bigint;
  expectedActualCapacity: bigint;
  expectedUpgradeAuthority: ObservationAuthorityV1;
}

export interface AppendProgramDataObservationChunkV1 {
  guard: ProgramDataObservationGuardV1;
  expectedStatus: ProgramDataObservationStatusV1Value;
  chunkIndex: number;
}

export interface VerifyObservedArtifactChunkV1 {
  guard: ProgramDataObservationGuardV1;
  expectedStatus: ProgramDataObservationStatusV1Value;
  chunkIndex: number;
  expectedNextArtifactChunkIndex: number;
  expectedTailBytesVerified: bigint;
  proof: ObservedArtifactMerkleProofV1;
}

export interface FinalizeProgramDataObservationV1 {
  guard: ProgramDataObservationGuardV1;
  expectedStatus: ProgramDataObservationStatusV1Value;
  expectedNextRawChunkIndex: number;
  expectedNextArtifactChunkIndex: number;
  expectedTailBytesVerified: bigint;
}

function integer(value: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} is outside its fixed unsigned range`);
  }
}

function exactBytes(value: Buffer, length: number, field: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== length) {
    throw new RangeError(`${field} must be ${length} bytes`);
  }
  return value;
}

function exactKey(value: PublicKey, field: string): PublicKey {
  if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`);
  return value;
}

function enumValue<T extends number>(value: number, values: readonly number[], field: string): T {
  integer(value, U8_MAX, field);
  if (!values.includes(value)) throw new RangeError(`${field} is unknown`);
  return value as T;
}

const purpose = (value: number): ProgramDataObservationPurposeV1Value =>
  enumValue(value, Object.values(ProgramDataObservationPurposeV1), "purpose");
const status = (value: number): ProgramDataObservationStatusV1Value =>
  enumValue(value, Object.values(ProgramDataObservationStatusV1), "status");
const gateStatus = (value: number): GateStatusV1Value =>
  enumValue(value, Object.values(GateStatusV1), "gateStatus");

class Writer {
  readonly parts: Buffer[] = [];

  byte(value: number, field: string): this {
    integer(value, U8_MAX, field);
    this.parts.push(Buffer.from([value]));
    return this;
  }

  u16(value: number, field: string): this {
    integer(value, U16_MAX, field);
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value);
    this.parts.push(out);
    return this;
  }

  u32(value: number, field: string): this {
    integer(value, U32_MAX, field);
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value);
    this.parts.push(out);
    return this;
  }

  u64(value: bigint, field: string): this {
    if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
      throw new RangeError(`${field} must be a u64`);
    }
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(value);
    this.parts.push(out);
    return this;
  }

  bytes(value: Buffer, length: number, field: string): this {
    this.parts.push(exactBytes(value, length, field));
    return this;
  }

  key(value: PublicKey, field: string): this {
    this.parts.push(exactKey(value, field).toBuffer());
    return this;
  }

  finish(expectedLength: number): Buffer {
    const out = Buffer.concat(this.parts);
    if (out.length !== expectedLength || out.length > MAX_CONTROLLER_INSTRUCTION_DATA_LEN) {
      throw new Error(`internal codec length ${out.length} != ${expectedLength}`);
    }
    return out;
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  bytes(length: number): Buffer {
    const end = this.offset + length;
    if (end > this.data.length) throw new Error("truncated instruction");
    const out = Buffer.from(this.data.subarray(this.offset, end));
    this.offset = end;
    return out;
  }

  byte(): number { return this.bytes(1)[0]!; }
  u16(): number { return this.bytes(2).readUInt16LE(); }
  u32(): number { return this.bytes(4).readUInt32LE(); }
  u64(): bigint { return this.bytes(8).readBigUInt64LE(); }
  key(): PublicKey { return new PublicKey(this.bytes(32)); }

  finish(): void {
    if (this.offset !== this.data.length) throw new Error("trailing instruction bytes");
  }
}

function encodeFixed(tag: number, length: number, write: (writer: Writer) => void): Buffer {
  const writer = new Writer().byte(tag, "tag");
  write(writer);
  return writer.finish(length);
}

function decodeFixed<T>(
  data: Buffer,
  tag: number,
  length: number,
  read: (reader: Reader) => T,
): T {
  if (!Buffer.isBuffer(data) || data.length !== length || data[0] !== tag) {
    throw new Error("invalid fixed instruction");
  }
  const reader = new Reader(data.subarray(1));
  const value = read(reader);
  reader.finish();
  return value;
}

function writeAuthority(writer: Writer, value: ObservationAuthorityV1): void {
  if (value.present) {
    if (value.value.equals(PublicKey.default)) throw new Error("present authority is default");
    writer.byte(1, "authority.present").key(value.value, "authority.value");
  } else {
    if (!value.value.equals(PublicKey.default)) throw new Error("absent authority is nondefault");
    writer.byte(0, "authority.present").key(value.value, "authority.value");
  }
}

function readAuthority(reader: Reader): ObservationAuthorityV1 {
  const present = reader.byte();
  const value = reader.key();
  if (present === 0 && value.equals(PublicKey.default)) return { present: false, value };
  if (present === 1 && !value.equals(PublicKey.default)) return { present: true, value };
  throw new Error("noncanonical observation authority");
}

function writeGuard(writer: Writer, value: ProgramDataObservationGuardV1): void {
  writer
    .byte(purpose(value.purpose), "guard.purpose")
    .u64(value.generation, "guard.generation")
    .bytes(value.expectedSubjectDigest, 32, "guard.expectedSubjectDigest")
    .byte(gateStatus(value.expectedGateStatus), "guard.expectedGateStatus")
    .u64(value.expectedGateEpoch, "guard.expectedGateEpoch")
    .u16(value.expectedFreezeReasonCode, "guard.expectedFreezeReasonCode")
    .u64(value.expectedFreezeSlot, "guard.expectedFreezeSlot");
}

function readGuard(reader: Reader): ProgramDataObservationGuardV1 {
  return {
    purpose: purpose(reader.byte()),
    generation: reader.u64(),
    expectedSubjectDigest: reader.bytes(32),
    expectedGateStatus: gateStatus(reader.byte()),
    expectedGateEpoch: reader.u64(),
    expectedFreezeReasonCode: reader.u16(),
    expectedFreezeSlot: reader.u64(),
  };
}

function writeProof(writer: Writer, value: ObservedArtifactMerkleProofV1): void {
  integer(value.proofLen, MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1, "proof.proofLen");
  if (value.nodes.length !== MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1) {
    throw new RangeError("proof.nodes must contain exactly seven entries");
  }
  writer.byte(value.proofLen, "proof.proofLen");
  value.nodes.forEach((node, index) => {
    if (index >= value.proofLen && !node.equals(Buffer.alloc(32))) {
      throw new Error("unused proof nodes must be zero");
    }
    writer.bytes(node, 32, `proof.nodes[${index}]`);
  });
}

function readProof(reader: Reader): ObservedArtifactMerkleProofV1 {
  const proofLen = reader.byte();
  integer(proofLen, MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1, "proof.proofLen");
  const nodes = Array.from(
    { length: MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1 },
    () => reader.bytes(32),
  );
  if (nodes.slice(proofLen).some((node) => !node.equals(Buffer.alloc(32)))) {
    throw new Error("unused proof nodes must be zero");
  }
  return { proofLen, nodes };
}

function validateGuard(value: ProgramDataObservationGuardV1): void {
  purpose(value.purpose);
  gateStatus(value.expectedGateStatus);
  if (
    value.generation <= 0n ||
    value.generation > U64_MAX ||
    exactBytes(value.expectedSubjectDigest, 32, "guard.expectedSubjectDigest").equals(ZERO_HASH) ||
    value.expectedGateEpoch <= 0n ||
    value.expectedGateEpoch > U64_MAX
  ) {
    throw new Error("observation guard identity is incomplete");
  }
  integer(value.expectedFreezeReasonCode, U16_MAX, "guard.expectedFreezeReasonCode");
  if (value.expectedFreezeSlot < 0n || value.expectedFreezeSlot > U64_MAX) {
    throw new RangeError("guard.expectedFreezeSlot must be a u64");
  }
  const active = value.expectedFreezeReasonCode === 0 && value.expectedFreezeSlot === 0n;
  const frozen = value.expectedFreezeReasonCode !== 0 && value.expectedFreezeSlot !== 0n;
  const canonical = value.expectedGateStatus === GateStatusV1.Active ? active : frozen;
  if (!canonical) throw new Error("observation guard gate snapshot is noncanonical");
}

function validateAuthority(value: ObservationAuthorityV1): void {
  exactKey(value.value, "authority.value");
  if (value.present === true && !value.value.equals(PublicKey.default)) return;
  if (value.present === false && value.value.equals(PublicKey.default)) return;
  throw new Error("noncanonical observation authority");
}

function validateProof(value: ObservedArtifactMerkleProofV1): void {
  integer(value.proofLen, MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1, "proof.proofLen");
  if (value.nodes.length !== MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1) {
    throw new RangeError("proof.nodes must contain exactly seven entries");
  }
  value.nodes.forEach((node, index) => {
    exactBytes(node, 32, `proof.nodes[${index}]`);
    if (index >= value.proofLen && !node.equals(ZERO_HASH)) {
      throw new Error("unused proof nodes must be zero");
    }
  });
}

function validateBegin(value: BeginProgramDataObservationV1): void {
  validateGuard(value.guard);
  validateAuthority(value.expectedUpgradeAuthority);
  if (
    exactBytes(value.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest").equals(ZERO_HASH) ||
    value.expectedArtifactLength <= 0n ||
    value.expectedArtifactLength > BigInt(MAX_ARTIFACT_BYTES_V1) ||
    exactBytes(value.expectedArtifactSha256, 32, "expectedArtifactSha256").equals(ZERO_HASH) ||
    exactBytes(value.expectedArtifactMerkleRoot, 32, "expectedArtifactMerkleRoot").equals(ZERO_HASH) ||
    !exactBytes(value.expectedArtifactSchemeId, 32, "expectedArtifactSchemeId").equals(ARTIFACT_MERKLE_SCHEME_ID) ||
    value.minimumRequiredCapacity < value.expectedArtifactLength ||
    value.minimumRequiredCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 ||
    value.expectedDeployedSlot <= 0n ||
    value.expectedDeployedSlot > U64_MAX ||
    value.expectedActualCapacity < value.minimumRequiredCapacity ||
    value.expectedActualCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1
  ) {
    throw new Error("begin observation commitment is noncanonical");
  }
}

function validateAppend(value: AppendProgramDataObservationChunkV1): void {
  validateGuard(value.guard);
  if (status(value.expectedStatus) !== ProgramDataObservationStatusV1.Accumulating) {
    throw new Error("append requires Accumulating observation status");
  }
  integer(value.chunkIndex, U32_MAX, "chunkIndex");
}

function validateVerify(value: VerifyObservedArtifactChunkV1): void {
  validateGuard(value.guard);
  validateProof(value.proof);
  if (status(value.expectedStatus) !== ProgramDataObservationStatusV1.Accumulating) {
    throw new Error("artifact verification requires Accumulating observation status");
  }
  integer(value.chunkIndex, U32_MAX, "chunkIndex");
  integer(value.expectedNextArtifactChunkIndex, U32_MAX, "expectedNextArtifactChunkIndex");
  if (value.expectedTailBytesVerified < 0n || value.expectedTailBytesVerified > U64_MAX) {
    throw new RangeError("expectedTailBytesVerified must be a u64");
  }
}

function validateFinalize(value: FinalizeProgramDataObservationV1): void {
  validateGuard(value.guard);
  if (status(value.expectedStatus) !== ProgramDataObservationStatusV1.ReadyToFinalize) {
    throw new Error("finalization requires ReadyToFinalize observation status");
  }
  integer(value.expectedNextRawChunkIndex, U32_MAX, "expectedNextRawChunkIndex");
  integer(value.expectedNextArtifactChunkIndex, U32_MAX, "expectedNextArtifactChunkIndex");
  if (value.expectedTailBytesVerified < 0n || value.expectedTailBytesVerified > U64_MAX) {
    throw new RangeError("expectedTailBytesVerified must be a u64");
  }
}

export function encodeBeginProgramDataObservationV1(
  value: BeginProgramDataObservationV1,
): Buffer {
  validateBegin(value);
  return encodeFixed(BEGIN_PROGRAMDATA_OBSERVATION_V1_TAG, BEGIN_PROGRAMDATA_OBSERVATION_V1_LEN, (writer) => {
    writeGuard(writer, value.guard);
    writer
      .bytes(value.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest")
      .u64(value.expectedArtifactLength, "expectedArtifactLength")
      .bytes(value.expectedArtifactSha256, 32, "expectedArtifactSha256")
      .bytes(value.expectedArtifactMerkleRoot, 32, "expectedArtifactMerkleRoot")
      .bytes(value.expectedArtifactSchemeId, 32, "expectedArtifactSchemeId")
      .u64(value.minimumRequiredCapacity, "minimumRequiredCapacity")
      .u64(value.expectedDeployedSlot, "expectedDeployedSlot")
      .u64(value.expectedActualCapacity, "expectedActualCapacity");
    writeAuthority(writer, value.expectedUpgradeAuthority);
  });
}

export function decodeBeginProgramDataObservationV1(
  data: Buffer,
): BeginProgramDataObservationV1 {
  const value = decodeFixed(data, BEGIN_PROGRAMDATA_OBSERVATION_V1_TAG, BEGIN_PROGRAMDATA_OBSERVATION_V1_LEN, (reader) => ({
    guard: readGuard(reader),
    expectedCapacityPolicyDigest: reader.bytes(32),
    expectedArtifactLength: reader.u64(),
    expectedArtifactSha256: reader.bytes(32),
    expectedArtifactMerkleRoot: reader.bytes(32),
    expectedArtifactSchemeId: reader.bytes(32),
    minimumRequiredCapacity: reader.u64(),
    expectedDeployedSlot: reader.u64(),
    expectedActualCapacity: reader.u64(),
    expectedUpgradeAuthority: readAuthority(reader),
  }));
  validateBegin(value);
  return value;
}

export function encodeAppendProgramDataObservationChunkV1(
  value: AppendProgramDataObservationChunkV1,
): Buffer {
  validateAppend(value);
  return encodeFixed(
    APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_TAG,
    APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_LEN,
    (writer) => {
      writeGuard(writer, value.guard);
      writer.byte(status(value.expectedStatus), "expectedStatus").u32(value.chunkIndex, "chunkIndex");
    },
  );
}

export function decodeAppendProgramDataObservationChunkV1(
  data: Buffer,
): AppendProgramDataObservationChunkV1 {
  const value = decodeFixed(
    data,
    APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_TAG,
    APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_LEN,
    (reader) => ({
      guard: readGuard(reader),
      expectedStatus: status(reader.byte()),
      chunkIndex: reader.u32(),
    }),
  );
  validateAppend(value);
  return value;
}

export function encodeVerifyObservedArtifactChunkV1(
  value: VerifyObservedArtifactChunkV1,
): Buffer {
  validateVerify(value);
  return encodeFixed(
    VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_TAG,
    VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_LEN,
    (writer) => {
      writeGuard(writer, value.guard);
      writer
        .byte(status(value.expectedStatus), "expectedStatus")
        .u32(value.chunkIndex, "chunkIndex")
        .u32(value.expectedNextArtifactChunkIndex, "expectedNextArtifactChunkIndex")
        .u64(value.expectedTailBytesVerified, "expectedTailBytesVerified");
      writeProof(writer, value.proof);
    },
  );
}

export function decodeVerifyObservedArtifactChunkV1(
  data: Buffer,
): VerifyObservedArtifactChunkV1 {
  const value = decodeFixed(
    data,
    VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_TAG,
    VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_LEN,
    (reader) => ({
      guard: readGuard(reader),
      expectedStatus: status(reader.byte()),
      chunkIndex: reader.u32(),
      expectedNextArtifactChunkIndex: reader.u32(),
      expectedTailBytesVerified: reader.u64(),
      proof: readProof(reader),
    }),
  );
  validateVerify(value);
  return value;
}

export function encodeFinalizeProgramDataObservationV1(
  value: FinalizeProgramDataObservationV1,
): Buffer {
  validateFinalize(value);
  return encodeFixed(
    FINALIZE_PROGRAMDATA_OBSERVATION_V1_TAG,
    FINALIZE_PROGRAMDATA_OBSERVATION_V1_LEN,
    (writer) => {
      writeGuard(writer, value.guard);
      writer
        .byte(status(value.expectedStatus), "expectedStatus")
        .u32(value.expectedNextRawChunkIndex, "expectedNextRawChunkIndex")
        .u32(value.expectedNextArtifactChunkIndex, "expectedNextArtifactChunkIndex")
        .u64(value.expectedTailBytesVerified, "expectedTailBytesVerified");
    },
  );
}

export function decodeFinalizeProgramDataObservationV1(
  data: Buffer,
): FinalizeProgramDataObservationV1 {
  const value = decodeFixed(
    data,
    FINALIZE_PROGRAMDATA_OBSERVATION_V1_TAG,
    FINALIZE_PROGRAMDATA_OBSERVATION_V1_LEN,
    (reader) => ({
      guard: readGuard(reader),
      expectedStatus: status(reader.byte()),
      expectedNextRawChunkIndex: reader.u32(),
      expectedNextArtifactChunkIndex: reader.u32(),
      expectedTailBytesVerified: reader.u64(),
    }),
  );
  validateFinalize(value);
  return value;
}

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });

function instruction(programId: PublicKey, keys: readonly AccountMeta[], data: Buffer): TransactionInstruction {
  exactKey(programId, "programId");
  keys.forEach((meta, index) => exactKey(meta.pubkey, `accounts[${index}]`));
  return new TransactionInstruction({ programId, keys: [...keys], data });
}

export interface BeginProgramDataObservationV1Accounts {
  payer: PublicKey;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  subject: PublicKey;
  observedProgram: PublicKey;
  observedProgramdata: PublicKey;
  observation: PublicKey;
  upgradeableLoader: PublicKey;
  systemProgram: PublicKey;
}

export interface ProgramDataObservationStepV1Accounts {
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  subject: PublicKey;
  observedProgram: PublicKey;
  observedProgramdata: PublicKey;
  observation: PublicKey;
  upgradeableLoader: PublicKey;
}

export function buildBeginProgramDataObservationV1Instruction(
  programId: PublicKey,
  accounts: BeginProgramDataObservationV1Accounts,
  value: BeginProgramDataObservationV1,
): TransactionInstruction {
  return instruction(programId, [
    ws(accounts.payer),
    ro(accounts.controllerConfig),
    ro(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.subject),
    ro(accounts.observedProgram),
    ro(accounts.observedProgramdata),
    rw(accounts.observation),
    ro(accounts.upgradeableLoader),
    ro(accounts.systemProgram),
  ], encodeBeginProgramDataObservationV1(value));
}

function buildObservationStep(
  programId: PublicKey,
  accounts: ProgramDataObservationStepV1Accounts,
  data: Buffer,
): TransactionInstruction {
  return instruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.subject),
    ro(accounts.observedProgram),
    ro(accounts.observedProgramdata),
    rw(accounts.observation),
    ro(accounts.upgradeableLoader),
  ], data);
}

export const buildAppendProgramDataObservationChunkV1Instruction = (
  programId: PublicKey,
  accounts: ProgramDataObservationStepV1Accounts,
  value: AppendProgramDataObservationChunkV1,
): TransactionInstruction => buildObservationStep(
  programId,
  accounts,
  encodeAppendProgramDataObservationChunkV1(value),
);

export const buildVerifyObservedArtifactChunkV1Instruction = (
  programId: PublicKey,
  accounts: ProgramDataObservationStepV1Accounts,
  value: VerifyObservedArtifactChunkV1,
): TransactionInstruction => buildObservationStep(
  programId,
  accounts,
  encodeVerifyObservedArtifactChunkV1(value),
);

export const buildFinalizeProgramDataObservationV1Instruction = (
  programId: PublicKey,
  accounts: ProgramDataObservationStepV1Accounts,
  value: FinalizeProgramDataObservationV1,
): TransactionInstruction => buildObservationStep(
  programId,
  accounts,
  encodeFinalizeProgramDataObservationV1(value),
);
