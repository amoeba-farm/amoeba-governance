import { createHash } from "node:crypto";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type Message,
  type MessageV0,
} from "@solana/web3.js";
import {
  MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  type EnvelopeExpectationV1,
} from "./release1LoaderInstructions.js";
import { decodeRelease1CurrentInstruction } from "./release1CurrentInstructions.js";
import { ACCEPT_TARGET_AUTHORITY_CHECKED_V1_TAG, EXECUTE_BOOTSTRAP_ACTIVATION_V1_TAG } from "./release1AuthorityInstructions.js";
import { EXECUTE_EMERGENCY_RESOLUTION_V2_TAG, EXECUTE_UNFREEZE_V2_TAG } from "./release1V3Instructions.js";
import { EXECUTE_UPGRADE_V2_TAG, EXTEND_TARGET_V2_TAG } from "./release1V3CustodyInstructions.js";

/** Solana's complete transaction wire-packet ceiling. */
export const RELEASE1_TRANSACTION_PACKET_LIMIT_V1 = 1_232;
export const RELEASE1_LOOKUP_PLAN_MAX_VALIDITY_SLOTS_V1 = 256n;
export const RELEASE1_LOOKUP_PLAN_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOVERNANCE_ALT_PLAN_V1",
  "ascii",
);
export const RELEASE1_PACKET_PLAN_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOVERNANCE_PACKET_PLAN_V1",
  "ascii",
);

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const ZERO_KEY = PublicKey.default;
const OPERATION_ID_PATTERN = /^[0-9a-f]{64}$/;

export type Release1TransactionFormatV1 = "legacy" | "v0";

export interface Release1AddressLookupPlanBindingsV1 {
  operationId: string;
  controllerProgram: PublicKey;
  clusterDomain: Buffer;
  lookupTable: PublicKey;
  lookupTableAuthority: PublicKey | null;
  lookupTableDeactivationSlot: bigint;
  lookupTableLastExtendedSlot: bigint;
  lookupTableLastExtendedSlotStartIndex: number;
  lookupTableAddresses: readonly PublicKey[];
  requiredLookupAddresses: readonly PublicKey[];
  observedSlot: bigint;
  validThroughSlot: bigint;
}

export interface Release1AddressLookupPlanV1
  extends Release1AddressLookupPlanBindingsV1 {
  lookupPlanId: string;
}

export interface CreateRelease1AddressLookupPlanV1 {
  operationId: string;
  controllerProgram: PublicKey;
  clusterDomain: Buffer;
  lookupTableAccount: AddressLookupTableAccount;
  requiredLookupAddresses: readonly PublicKey[];
  observedSlot: bigint;
  validThroughSlot: bigint;
}

export interface Release1LookupPlanUseV1 {
  plan: Release1AddressLookupPlanV1;
  lookupTableAccount: AddressLookupTableAccount;
  currentSlot: bigint;
}

export interface Release1PacketPlanningInputV1 {
  operationId: string;
  controllerProgram: PublicKey;
  clusterDomain: Buffer;
  payer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  format: Release1TransactionFormatV1;
  lookup?: Release1LookupPlanUseV1;
}

export interface Release1PacketMeasurementV1 {
  operationId: string;
  format: Release1TransactionFormatV1;
  packetBytes: number;
  messageBytes: number;
  requiredSignatureCount: number;
  staticAccountKeyCount: number;
  lookupWritableCount: number;
  lookupReadonlyCount: number;
  lookupPlanId: string | null;
  messageSha256: string | null;
  fitsPacketLimit: boolean;
}

export interface Release1TransactionPacketPlanV1
  extends Omit<Release1PacketMeasurementV1, "messageSha256" | "fitsPacketLimit"> {
  messageSha256: string;
  packetPlanId: string;
  fitsPacketLimit: true;
}

export class Release1PacketLimitError extends RangeError {
  readonly packetBytes: number;
  readonly packetLimit: number;

  constructor(packetBytes: number) {
    super(
      `Release 1 transaction is ${packetBytes} bytes and exceeds the ${RELEASE1_TRANSACTION_PACKET_LIMIT_V1}-byte packet ceiling`,
    );
    this.name = "Release1PacketLimitError";
    this.packetBytes = packetBytes;
    this.packetLimit = RELEASE1_TRANSACTION_PACKET_LIMIT_V1;
  }
}

export function assertRelease1PacketSizeV1(packetBytes: number): void {
  if (!Number.isSafeInteger(packetBytes) || packetBytes < 0) {
    throw new RangeError("packetBytes must be a nonnegative safe integer");
  }
  if (packetBytes > RELEASE1_TRANSACTION_PACKET_LIMIT_V1) {
    throw new Release1PacketLimitError(packetBytes);
  }
}

function exactOperationId(value: string): string {
  if (!OPERATION_ID_PATTERN.test(value)) {
    throw new Error("operationId must be exactly 32 lowercase hexadecimal bytes");
  }
  return value;
}

function exactDomain(value: Buffer): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new Error("clusterDomain must be exactly 32 bytes");
  }
  return Buffer.from(value);
}

function nondefaultKey(value: PublicKey, field: string): PublicKey {
  if (!(value instanceof PublicKey) || value.equals(ZERO_KEY)) {
    throw new Error(`${field} must be a nondefault PublicKey`);
  }
  return value;
}

function exactKey(value: PublicKey, field: string): PublicKey {
  if (!(value instanceof PublicKey)) throw new Error(`${field} must be a PublicKey`);
  return value;
}

function u64(value: bigint, field: string): Buffer {
  if (value < 0n || value > U64_MAX) throw new RangeError(`${field} must be a u64`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function u16(value: number, field: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${field} must be a u16`);
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function byte(value: number, field: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${field} must be a byte`);
  }
  return Buffer.from([value]);
}

function lengthPrefixed(value: Buffer, field: string): Buffer {
  if (value.length > 0xffff) throw new RangeError(`${field} is too long`);
  return Buffer.concat([u16(value.length, `${field}.length`), value]);
}

function keyList(value: readonly PublicKey[], field: string): Buffer {
  if (value.length > 256) throw new RangeError(`${field} cannot exceed 256 keys`);
  return Buffer.concat([
    u16(value.length, `${field}.length`),
    ...value.map((key, index) =>
      exactKey(key, `${field}[${index}]`).toBuffer(),
    ),
  ]);
}

function uniqueKeys(value: readonly PublicKey[], field: string): void {
  const seen = new Set<string>();
  for (const [index, key] of value.entries()) {
    const encoded = exactKey(key, `${field}[${index}]`).toBase58();
    if (seen.has(encoded)) throw new Error(`${field} contains a duplicate key`);
    seen.add(encoded);
  }
}

function lookupSnapshotBindings(
  input: CreateRelease1AddressLookupPlanV1,
): Release1AddressLookupPlanBindingsV1 {
  exactOperationId(input.operationId);
  nondefaultKey(input.controllerProgram, "controllerProgram");
  const clusterDomain = exactDomain(input.clusterDomain);
  if (!(input.lookupTableAccount instanceof AddressLookupTableAccount)) {
    throw new TypeError("lookupTableAccount must be an AddressLookupTableAccount");
  }
  nondefaultKey(input.lookupTableAccount.key, "lookupTable");
  const state = input.lookupTableAccount.state;
  if (state.deactivationSlot !== U64_MAX || !input.lookupTableAccount.isActive()) {
    throw new Error("lookup table must be canonically active");
  }
  if (!Number.isSafeInteger(state.lastExtendedSlot) || state.lastExtendedSlot < 0) {
    throw new RangeError("lookup table lastExtendedSlot is invalid");
  }
  if (
    !Number.isSafeInteger(state.lastExtendedSlotStartIndex)
    || state.lastExtendedSlotStartIndex < 0
    || state.lastExtendedSlotStartIndex > 255
  ) {
    throw new RangeError("lookup table lastExtendedSlotStartIndex is invalid");
  }
  uniqueKeys(state.addresses, "lookupTableAddresses");
  uniqueKeys(input.requiredLookupAddresses, "requiredLookupAddresses");
  if (input.requiredLookupAddresses.length === 0) {
    throw new Error("a v0 lookup plan must require at least one lookup address");
  }
  if (input.observedSlot <= BigInt(state.lastExtendedSlot)) {
    throw new Error("lookup table addresses are not warm at the observed slot");
  }
  if (
    input.validThroughSlot < input.observedSlot
    || input.validThroughSlot - input.observedSlot
      > RELEASE1_LOOKUP_PLAN_MAX_VALIDITY_SLOTS_V1
  ) {
    throw new Error("lookup plan validity window is invalid");
  }

  const addressIndexes = new Map(
    state.addresses.map((address, index) => [address.toBase58(), index]),
  );
  let previousIndex = -1;
  for (const address of input.requiredLookupAddresses) {
    const index = addressIndexes.get(address.toBase58());
    if (index === undefined) {
      throw new Error("required lookup address is absent from the lookup table");
    }
    if (index <= previousIndex) {
      throw new Error("required lookup addresses must use canonical table-index order");
    }
    previousIndex = index;
  }

  return {
    operationId: input.operationId,
    controllerProgram: input.controllerProgram,
    clusterDomain,
    lookupTable: input.lookupTableAccount.key,
    lookupTableAuthority: state.authority ?? null,
    lookupTableDeactivationSlot: state.deactivationSlot,
    lookupTableLastExtendedSlot: BigInt(state.lastExtendedSlot),
    lookupTableLastExtendedSlotStartIndex: state.lastExtendedSlotStartIndex,
    lookupTableAddresses: state.addresses.map((address) => new PublicKey(address)),
    requiredLookupAddresses: input.requiredLookupAddresses.map(
      (address) => new PublicKey(address),
    ),
    observedSlot: input.observedSlot,
    validThroughSlot: input.validThroughSlot,
  };
}

export function canonicalRelease1AddressLookupPlanMaterialV1(
  value: Release1AddressLookupPlanBindingsV1,
): Buffer {
  exactOperationId(value.operationId);
  nondefaultKey(value.controllerProgram, "controllerProgram");
  const authority = value.lookupTableAuthority;
  return Buffer.concat([
    RELEASE1_LOOKUP_PLAN_DOMAIN_V1,
    Buffer.from(value.operationId, "hex"),
    value.controllerProgram.toBuffer(),
    exactDomain(value.clusterDomain),
    nondefaultKey(value.lookupTable, "lookupTable").toBuffer(),
    authority === null
      ? Buffer.concat([Buffer.from([0]), Buffer.alloc(32)])
      : Buffer.concat([
          Buffer.from([1]),
          nondefaultKey(authority, "lookupTableAuthority").toBuffer(),
        ]),
    u64(value.lookupTableDeactivationSlot, "lookupTableDeactivationSlot"),
    u64(value.lookupTableLastExtendedSlot, "lookupTableLastExtendedSlot"),
    byte(
      value.lookupTableLastExtendedSlotStartIndex,
      "lookupTableLastExtendedSlotStartIndex",
    ),
    keyList(value.lookupTableAddresses, "lookupTableAddresses"),
    keyList(value.requiredLookupAddresses, "requiredLookupAddresses"),
    u64(value.observedSlot, "observedSlot"),
    u64(value.validThroughSlot, "validThroughSlot"),
  ]);
}

export function release1AddressLookupPlanIdV1(
  value: Release1AddressLookupPlanBindingsV1,
): string {
  return createHash("sha256")
    .update(canonicalRelease1AddressLookupPlanMaterialV1(value))
    .digest("hex");
}

export function createRelease1AddressLookupPlanV1(
  input: CreateRelease1AddressLookupPlanV1,
): Release1AddressLookupPlanV1 {
  const bindings = lookupSnapshotBindings(input);
  return {
    ...bindings,
    lookupPlanId: release1AddressLookupPlanIdV1(bindings),
  };
}

function sameKeyList(left: readonly PublicKey[], right: readonly PublicKey[]): boolean {
  return left.length === right.length
    && left.every((key, index) => key.equals(right[index]!));
}

export function assertRelease1AddressLookupPlanFreshV1(
  plan: Release1AddressLookupPlanV1,
  current: Omit<CreateRelease1AddressLookupPlanV1, "requiredLookupAddresses" | "observedSlot" | "validThroughSlot"> & {
    currentSlot: bigint;
  },
): void {
  const plannedSnapshot = new AddressLookupTableAccount({
    key: plan.lookupTable,
    state: {
      deactivationSlot: plan.lookupTableDeactivationSlot,
      lastExtendedSlot: Number(plan.lookupTableLastExtendedSlot),
      lastExtendedSlotStartIndex: plan.lookupTableLastExtendedSlotStartIndex,
      ...(plan.lookupTableAuthority === null
        ? {}
        : { authority: plan.lookupTableAuthority }),
      addresses: [...plan.lookupTableAddresses],
    },
  });
  lookupSnapshotBindings({
    operationId: plan.operationId,
    controllerProgram: plan.controllerProgram,
    clusterDomain: plan.clusterDomain,
    lookupTableAccount: plannedSnapshot,
    requiredLookupAddresses: plan.requiredLookupAddresses,
    observedSlot: plan.observedSlot,
    validThroughSlot: plan.validThroughSlot,
  });
  if (plan.operationId !== current.operationId) throw new Error("lookup plan operation is stale");
  if (!plan.controllerProgram.equals(current.controllerProgram)) {
    throw new Error("lookup plan controller is stale");
  }
  if (!plan.clusterDomain.equals(current.clusterDomain)) {
    throw new Error("lookup plan cluster domain is stale");
  }
  if (current.currentSlot < plan.observedSlot || current.currentSlot > plan.validThroughSlot) {
    throw new Error("lookup plan slot observation is stale");
  }
  if (plan.lookupPlanId !== release1AddressLookupPlanIdV1(plan)) {
    throw new Error("lookup plan identity does not match its bindings");
  }

  const state = current.lookupTableAccount.state;
  const authority = state.authority ?? null;
  if (
    !plan.lookupTable.equals(current.lookupTableAccount.key)
    || plan.lookupTableDeactivationSlot !== state.deactivationSlot
    || plan.lookupTableLastExtendedSlot !== BigInt(state.lastExtendedSlot)
    || plan.lookupTableLastExtendedSlotStartIndex !== state.lastExtendedSlotStartIndex
    || ((plan.lookupTableAuthority === null) !== (authority === null))
    || (plan.lookupTableAuthority !== null
      && authority !== null
      && !plan.lookupTableAuthority.equals(authority))
    || !sameKeyList(plan.lookupTableAddresses, state.addresses)
  ) {
    throw new Error("lookup table no longer matches the planned snapshot");
  }
  if (state.deactivationSlot !== U64_MAX || !current.lookupTableAccount.isActive()) {
    throw new Error("lookup table is no longer canonically active");
  }
  if (current.currentSlot <= BigInt(state.lastExtendedSlot)) {
    throw new Error("lookup table addresses are not warm at the current slot");
  }
}

function exactInstruction(
  actual: TransactionInstruction,
  expected: TransactionInstruction,
  field: string,
): void {
  if (!actual.programId.equals(expected.programId) || !actual.data.equals(expected.data)) {
    throw new Error(`${field} does not match the canonical instruction`);
  }
  if (
    actual.keys.length !== expected.keys.length
    || actual.keys.some((meta, index) => {
      const wanted = expected.keys[index]!;
      return !meta.pubkey.equals(wanted.pubkey)
        || meta.isSigner !== wanted.isSigner
        || meta.isWritable !== wanted.isWritable;
    })
  ) {
    throw new Error(`${field} account contract is not canonical`);
  }
}

function decodedControllerValue(controller: TransactionInstruction): {
  tag: number;
  value: unknown;
} {
  try { return decodeRelease1CurrentInstruction(controller.data); }
  catch { throw new Error("controller instruction is not a strict current Release 1 instruction"); }
}

function envelopeFromValue(value: unknown): EnvelopeExpectationV1 | null {
  if (value === null || typeof value !== "object" || !("envelope" in value)) return null;
  return (value as { envelope: EnvelopeExpectationV1 }).envelope;
}

export function buildCanonicalRelease1LoaderEnvelopeV1(
  controllerInstruction: TransactionInstruction,
): readonly TransactionInstruction[] {
  const decoded = decodedControllerValue(controllerInstruction);
  if (
    decoded.tag !== ACCEPT_TARGET_AUTHORITY_CHECKED_V1_TAG
    && decoded.tag !== EXECUTE_BOOTSTRAP_ACTIVATION_V1_TAG
    && decoded.tag !== EXECUTE_EMERGENCY_RESOLUTION_V2_TAG
    && decoded.tag !== EXECUTE_UNFREEZE_V2_TAG
    && decoded.tag !== EXTEND_TARGET_V2_TAG
    && decoded.tag !== EXECUTE_UPGRADE_V2_TAG
  ) {
    throw new Error("controller instruction does not carry a typed loader envelope");
  }
  const envelope = envelopeFromValue(decoded.value);
  if (envelope === null) throw new Error("typed loader instruction is missing its envelope");
  const instructions: TransactionInstruction[] = [];
  if (envelope.durableNonceAccount.present !== envelope.durableNonceAuthority.present) {
    throw new Error("durable nonce account and authority must be present together");
  }
  if (envelope.durableNonceAccount.present) {
    instructions.push(
      SystemProgram.nonceAdvance({
        noncePubkey: envelope.durableNonceAccount.value,
        authorizedPubkey: envelope.durableNonceAuthority.value,
      }),
    );
  }
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: envelope.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: envelope.computeUnitPriceMicroLamports,
    }),
    controllerInstruction,
  );
  return instructions;
}

function validateEmergencyComputeEnvelope(
  instructions: readonly TransactionInstruction[],
  controllerIndex: number,
): void {
  if (controllerIndex !== 2 || instructions.length !== 3) {
    throw new Error("emergency resolution requires its exact compute envelope");
  }
  const limit = instructions[0]!;
  const price = instructions[1]!;
  if (
    !limit.programId.equals(ComputeBudgetProgram.programId)
    || limit.keys.length !== 0
    || limit.data.length !== 5
    || limit.data[0] !== 2
  ) {
    throw new Error("emergency resolution compute-unit limit is not canonical");
  }
  const units = limit.data.readUInt32LE(1);
  if (units === 0 || units > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1) {
    throw new Error("emergency resolution compute-unit limit is outside policy");
  }
  if (
    !price.programId.equals(ComputeBudgetProgram.programId)
    || price.keys.length !== 0
    || price.data.length !== 9
    || price.data[0] !== 3
    || price.data.readBigUInt64LE(1)
      > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1
  ) {
    throw new Error("emergency resolution compute-unit price is not canonical");
  }
}

function validateControllerEnvelope(
  controllerProgram: PublicKey,
  instructions: readonly TransactionInstruction[],
): void {
  if (instructions.length === 0) throw new Error("transaction must contain an instruction");
  const controllerIndexes = instructions.flatMap((instruction, index) =>
    instruction.programId.equals(controllerProgram) ? [index] : [],
  );
  if (controllerIndexes.length !== 1) {
    throw new Error("transaction must contain exactly one controller instruction");
  }
  const controllerIndex = controllerIndexes[0]!;
  if (controllerIndex !== instructions.length - 1) {
    throw new Error("controller instruction must be the final top-level instruction");
  }
  const controller = instructions[controllerIndex]!;
  const decoded = decodedControllerValue(controller);
  const envelope = envelopeFromValue(decoded.value);
  if (decoded.tag === EXECUTE_EMERGENCY_RESOLUTION_V2_TAG) {
    if (envelope === null || envelope.durableNonceAccount.present || envelope.durableNonceAuthority.present) {
      throw new Error("emergency resolution requires its nonce-free typed envelope");
    }
    const expected = buildCanonicalRelease1LoaderEnvelopeV1(controller);
    if (expected.length !== instructions.length) throw new Error("emergency resolution envelope has the wrong instruction count");
    expected.forEach((instruction, index) => exactInstruction(instructions[index]!, instruction, `envelope[${index}]`));
    validateEmergencyComputeEnvelope(instructions, controllerIndex);
  } else if (envelope !== null) {
    const expected = buildCanonicalRelease1LoaderEnvelopeV1(controller);
    if (expected.length !== instructions.length) {
      throw new Error("typed loader envelope has the wrong instruction count");
    }
    expected.forEach((instruction, index) =>
      exactInstruction(instructions[index]!, instruction, `envelope[${index}]`),
    );
  } else if (instructions.length !== 1) {
    throw new Error("non-envelope Release 1 instruction cannot have siblings");
  }
}

function shortvecLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("shortvec value is invalid");
  let remaining = value;
  let length = 0;
  do {
    length += 1;
    remaining = Math.floor(remaining / 128);
  } while (remaining > 0);
  return length;
}

function compiledInstructionBytes(
  instructions: readonly TransactionInstruction[],
): number {
  return instructions.reduce(
    (total, instruction) =>
      total
      + 1
      + shortvecLength(instruction.keys.length)
      + instruction.keys.length
      + shortvecLength(instruction.data.length)
      + instruction.data.length,
    0,
  );
}

function legacyMessageBytes(
  message: Message,
  instructions: readonly TransactionInstruction[],
): number {
  return 3
    + shortvecLength(message.accountKeys.length)
    + 32 * message.accountKeys.length
    + 32
    + shortvecLength(instructions.length)
    + compiledInstructionBytes(instructions);
}

function v0MessageBytes(
  message: MessageV0,
  instructions: readonly TransactionInstruction[],
): number {
  const lookupBytes = message.addressTableLookups.reduce(
    (total, lookup) =>
      total
      + 32
      + shortvecLength(lookup.writableIndexes.length)
      + lookup.writableIndexes.length
      + shortvecLength(lookup.readonlyIndexes.length)
      + lookup.readonlyIndexes.length,
    0,
  );
  return 1
    + 3
    + shortvecLength(message.staticAccountKeys.length)
    + 32 * message.staticAccountKeys.length
    + 32
    + shortvecLength(instructions.length)
    + compiledInstructionBytes(instructions)
    + shortvecLength(message.addressTableLookups.length)
    + lookupBytes;
}

function validateRecentBlockhash(value: string): void {
  try {
    if (new PublicKey(value).toBase58() !== value) throw new Error("noncanonical");
  } catch {
    throw new Error("recentBlockhash must be a canonical 32-byte base58 value");
  }
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateUsedLookupAddresses(
  message: MessageV0,
  lookup: Release1LookupPlanUseV1,
): { writable: number; readonly: number } {
  if (message.addressTableLookups.length !== 1) {
    throw new Error("v0 transaction must use exactly one planned lookup table");
  }
  const compiled = message.addressTableLookups[0]!;
  if (!compiled.accountKey.equals(lookup.plan.lookupTable)) {
    throw new Error("compiled transaction uses an unplanned lookup table");
  }
  const addresses = lookup.lookupTableAccount.state.addresses;
  const indexes = [...compiled.writableIndexes, ...compiled.readonlyIndexes];
  const used = new Set(
    indexes.map((index) => {
      const address = addresses[index];
      if (address === undefined) throw new Error("compiled lookup index is outside the table");
      return address.toBase58();
    }),
  );
  const required = new Set(
    lookup.plan.requiredLookupAddresses.map((address) => address.toBase58()),
  );
  if (!setEquals(used, required)) {
    throw new Error("compiled lookup addresses do not exactly match the lookup plan");
  }
  return {
    writable: compiled.writableIndexes.length,
    readonly: compiled.readonlyIndexes.length,
  };
}

function compilePacket(
  input: Release1PacketPlanningInputV1,
): {
  measurement: Release1PacketMeasurementV1;
  serializedMessage: Buffer | null;
} {
  exactOperationId(input.operationId);
  nondefaultKey(input.controllerProgram, "controllerProgram");
  exactDomain(input.clusterDomain);
  nondefaultKey(input.payer, "payer");
  validateRecentBlockhash(input.recentBlockhash);
  validateControllerEnvelope(input.controllerProgram, input.instructions);

  const messageBuilder = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: input.recentBlockhash,
    instructions: [...input.instructions],
  });

  let messageBytes: number;
  let requiredSignatureCount: number;
  let staticAccountKeyCount: number;
  let lookupWritableCount = 0;
  let lookupReadonlyCount = 0;
  let lookupPlanId: string | null = null;
  let serializedMessage: Buffer | null = null;

  if (input.format === "legacy") {
    if (input.lookup !== undefined) throw new Error("legacy packet planning cannot ignore a lookup plan");
    const message = messageBuilder.compileToLegacyMessage();
    messageBytes = legacyMessageBytes(message, input.instructions);
    requiredSignatureCount = message.header.numRequiredSignatures;
    staticAccountKeyCount = message.accountKeys.length;
    if (messageBytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1) {
      serializedMessage = message.serialize();
      if (serializedMessage.length !== messageBytes) {
        throw new Error("legacy packet measurement diverged from web3 serialization");
      }
    }
  } else if (input.format === "v0") {
    if (input.lookup === undefined) throw new Error("v0 packet planning requires an exact lookup plan");
    assertRelease1AddressLookupPlanFreshV1(input.lookup.plan, {
      operationId: input.operationId,
      controllerProgram: input.controllerProgram,
      clusterDomain: input.clusterDomain,
      lookupTableAccount: input.lookup.lookupTableAccount,
      currentSlot: input.lookup.currentSlot,
    });
    const message = messageBuilder.compileToV0Message([
      input.lookup.lookupTableAccount,
    ]);
    const counts = validateUsedLookupAddresses(message, input.lookup);
    lookupWritableCount = counts.writable;
    lookupReadonlyCount = counts.readonly;
    lookupPlanId = input.lookup.plan.lookupPlanId;
    messageBytes = v0MessageBytes(message, input.instructions);
    requiredSignatureCount = message.header.numRequiredSignatures;
    staticAccountKeyCount = message.staticAccountKeys.length;
    if (messageBytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1) {
      serializedMessage = Buffer.from(message.serialize());
      if (serializedMessage.length !== messageBytes) {
        throw new Error("v0 packet measurement diverged from web3 serialization");
      }
    }
  } else {
    throw new Error("unknown Release 1 transaction format");
  }

  const packetBytes = shortvecLength(requiredSignatureCount)
    + 64 * requiredSignatureCount
    + messageBytes;
  return {
    measurement: {
      operationId: input.operationId,
      format: input.format,
      packetBytes,
      messageBytes,
      requiredSignatureCount,
      staticAccountKeyCount,
      lookupWritableCount,
      lookupReadonlyCount,
      lookupPlanId,
      messageSha256:
        serializedMessage === null
          ? null
          : createHash("sha256").update(serializedMessage).digest("hex"),
      fitsPacketLimit: packetBytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1,
    },
    serializedMessage,
  };
}

/**
 * Execution-free diagnostic measurement. Oversize results are reported but do
 * not contain transaction bytes and cannot be promoted to a packet plan.
 */
export function measureRelease1TransactionPacketV1(
  input: Release1PacketPlanningInputV1,
): Release1PacketMeasurementV1 {
  return compilePacket(input).measurement;
}

/**
 * Produces a deterministic, execution-free packet plan and fails closed above
 * the 1,232-byte wire ceiling. It does not sign, submit, or accept signer
 * material.
 */
export function planRelease1TransactionPacketV1(
  input: Release1PacketPlanningInputV1,
): Release1TransactionPacketPlanV1 {
  const { measurement, serializedMessage } = compilePacket(input);
  assertRelease1PacketSizeV1(measurement.packetBytes);
  if (serializedMessage === null || measurement.messageSha256 === null) {
    throw new Error("fitting packet did not produce a serialized message");
  }
  const material = Buffer.concat([
    RELEASE1_PACKET_PLAN_DOMAIN_V1,
    Buffer.from(input.operationId, "hex"),
    input.controllerProgram.toBuffer(),
    exactDomain(input.clusterDomain),
    Buffer.from([input.format === "legacy" ? 0 : 1]),
    lengthPrefixed(Buffer.from(input.recentBlockhash, "utf8"), "recentBlockhash"),
    u16(measurement.packetBytes, "packetBytes"),
    u16(measurement.messageBytes, "messageBytes"),
    Buffer.from(measurement.messageSha256, "hex"),
    measurement.lookupPlanId === null
      ? Buffer.concat([Buffer.from([0]), Buffer.alloc(32)])
      : Buffer.concat([
          Buffer.from([1]),
          Buffer.from(measurement.lookupPlanId, "hex"),
        ]),
  ]);
  return {
    ...measurement,
    messageSha256: measurement.messageSha256,
    packetPlanId: createHash("sha256").update(material).digest("hex"),
    fitsPacketLimit: true,
  };
}
