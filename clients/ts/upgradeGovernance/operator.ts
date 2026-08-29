import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  assertClusterDomainV1,
  assertProductionControllerIdentityV1,
  assertRelease1PlanFreshV1,
  redactGovernanceJournalValueV1,
  type FinalizedAccountObservationV1,
  type Release1ProposalPlanBindingsV1,
  type Release1ProposalPlanV1,
} from "./release1Planning.js";
import {
  assertRelease1AddressLookupPlanFreshV1,
  release1AddressLookupPlanIdV1,
  type Release1AddressLookupPlanV1,
} from "./release1PacketPlanning.js";
import { decodeRelease1CurrentInstruction } from "./release1CurrentInstructions.js";
import {
  MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  type EnvelopeExpectationV1,
} from "./release1LoaderInstructions.js";

export const GOVERNANCE_OPERATOR_JOURNAL_VERSION_V1 = 1;
export const GOVERNANCE_OPERATOR_LOCK_VERSION_V1 = 1;

export const OPERATOR_MUTATION_COMMANDS_V1 = Object.freeze([
  "observe-programdata", "record-controller-immutability", "create-handoff",
  "approve-handoff", "queue-handoff", "accept-target-authority",
  "create-bootstrap-activation", "approve-bootstrap-activation",
  "queue-bootstrap-activation", "execute-bootstrap-activation",
  "adopt-buffer", "verify-buffer", "approve", "finalize-governance", "queue",
  "guardian-freeze", "create-emergency-resolution", "approve-emergency-resolution",
  "queue-emergency-resolution", "execute-emergency-resolution", "freeze",
  "bind-prestate", "approve-checkpoint",
  "execute-extension", "execute-upgrade", "verify-programdata", "bind-poststate",
  "approve-unfreeze", "unfreeze", "cancel", "expire", "close-buffer",
  "observe-programdata-failure", "activate-rollback", "create-council-set",
  "rotate-council",
] as const);
export type OperatorMutationCommandV1 = (typeof OPERATOR_MUTATION_COMMANDS_V1)[number];

export const COMPUTE_BUDGET_PROGRAM_ID_V1 = new PublicKey(
  "ComputeBudget111111111111111111111111111111",
);
export const SYSTEM_PROGRAM_ID_V1 = PublicKey.default;
export const RECENT_BLOCKHASHES_SYSVAR_ID_V1 = new PublicKey(
  "SysvarRecentB1ockHashes11111111111111111111",
);

export const OPERATOR_EXPECTED_TAGS_V1: Readonly<Record<OperatorMutationCommandV1, readonly number[]>> = Object.freeze({
  "observe-programdata": [39, 40, 41, 42],
  "record-controller-immutability": [43],
  "create-handoff": [44],
  "approve-handoff": [45],
  "queue-handoff": [46],
  "accept-target-authority": [47],
  "create-bootstrap-activation": [49],
  "approve-bootstrap-activation": [50],
  "queue-bootstrap-activation": [51],
  "execute-bootstrap-activation": [52],
  "adopt-buffer": [75],
  "verify-buffer": [76, 77],
  approve: [55],
  "finalize-governance": [56],
  queue: [57],
  "guardian-freeze": [61],
  "create-emergency-resolution": [62],
  "approve-emergency-resolution": [63],
  "queue-emergency-resolution": [64],
  "execute-emergency-resolution": [65],
  freeze: [58],
  "bind-prestate": [67, 68, 69],
  "approve-checkpoint": [67, 68],
  "execute-extension": [78],
  "execute-upgrade": [79],
  "verify-programdata": [70, 71],
  "bind-poststate": [67, 68, 69],
  "approve-unfreeze": [73],
  unfreeze: [74],
  cancel: [59, 24],
  expire: [60, 66, 25],
  "close-buffer": [80],
  "observe-programdata-failure": [72],
  "activate-rollback": [81],
  "create-council-set": [18],
  "rotate-council": [19, 20, 21, 22, 24, 25],
});

export interface NormalizedAccountMetaV1 {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface NormalizedTopLevelInstructionV1 {
  programId: PublicKey;
  data: Buffer;
  accounts: readonly NormalizedAccountMetaV1[];
  kind: "compute-unit-limit" | "compute-unit-price" | "durable-nonce-advance" | "controller";
}

export interface PreparedGovernanceTransactionV1 {
  controllerProgram: PublicKey;
  controllerInstructionData: Buffer;
  topLevelInstructions: readonly NormalizedTopLevelInstructionV1[];
  feePayer: PublicKey;
  recentBlockhash: string;
  messageVersion: "legacy" | 0;
  addressLookupTableAccounts: readonly AddressLookupTableAccount[];
}

export interface FinalizedPlanBindingsObservationV1 {
  commitment: "finalized";
  contextSlot: bigint;
  bindings: Release1ProposalPlanBindingsV1;
}

export interface FinalizedGovernanceReadAdapterV1 {
  getGenesisHash(): Promise<string>;
  rereadPlanBindings(plan: Release1ProposalPlanV1): Promise<FinalizedPlanBindingsObservationV1>;
  observeAccounts(pubkeys: readonly PublicKey[]): Promise<readonly FinalizedAccountObservationV1[]>;
  rereadAddressLookupTable?(plan: Release1AddressLookupPlanV1): Promise<{
    commitment: "finalized";
    contextSlot: bigint;
    lookupTableAccount: AddressLookupTableAccount;
  }>;
}

export interface TypedGovernanceTransactionAdapterV1 {
  prepare(command: OperatorMutationCommandV1, plan: Release1ProposalPlanV1): Promise<PreparedGovernanceTransactionV1>;
  compileMessage(prepared: PreparedGovernanceTransactionV1): Promise<Buffer>;
  assembleSignedTransaction(
    prepared: PreparedGovernanceTransactionV1,
    message: Buffer,
    signatures: readonly GovernanceMessageSignatureV1[],
  ): Promise<Buffer>;
}

export interface InjectedGovernanceSignerV1 {
  readonly providerKind: "wallet" | "kms" | "hardware";
  readonly authority: PublicKey;
  signMessage(message: Buffer, decodedAction: Readonly<Record<string, unknown>>): Promise<Buffer>;
}

export interface GovernanceMessageSignatureV1 {
  authority: PublicKey;
  signature: Buffer;
}

export interface InjectedSubmissionTransportV1 {
  submitSignedTransaction(signedTransaction: Buffer, operationId: string): Promise<{ signature: string }>;
}

export type DecodedActionConfirmationHookV1 = (
  action: Readonly<Record<string, unknown>>,
  operationId: string,
) => Promise<boolean>;

export interface GovernanceJournalEntryV1 {
  journalVersion: typeof GOVERNANCE_OPERATOR_JOURNAL_VERSION_V1;
  sequence: number;
  timestamp: string;
  operationId: string;
  event: string;
  previousEntryHash: string;
  payload: unknown;
  entryHash: string;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("journal value is not JSON encodable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([field, entry]) => `${JSON.stringify(field)}:${stableJson(entry)}`).join(",")}}`;
}

function journalHash(entry: Omit<GovernanceJournalEntryV1, "entryHash">): string {
  return createHash("sha256").update("AMOEBA_GOVERNANCE_JOURNAL_ENTRY_V1").update(stableJson(entry)).digest("hex");
}

export class GovernanceJournalV1 {
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(path);
    if (this.path === resolve(dirname(this.path))) throw new Error("journal path must name a file");
  }

  recover(): readonly GovernanceJournalEntryV1[] {
    if (!existsSync(this.path)) return [];
    const text = readFileSync(this.path, "utf8");
    const lines = text.length === 0 ? [] : text.split(/\r?\n/u).filter((line) => line.length !== 0);
    const entries: GovernanceJournalEntryV1[] = [];
    let previous = "0".repeat(64);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as GovernanceJournalEntryV1;
      const { entryHash, ...material } = parsed;
      if (parsed.journalVersion !== GOVERNANCE_OPERATOR_JOURNAL_VERSION_V1 || parsed.sequence !== index || parsed.previousEntryHash !== previous || journalHash(material) !== entryHash) {
        throw new Error(`governance journal hash chain failed at sequence ${index}`);
      }
      previous = entryHash;
      entries.push(parsed);
    }
    return entries;
  }

  append(operationId: string, event: string, payload: unknown): GovernanceJournalEntryV1 {
    if (!/^[0-9a-f]{64}$/u.test(operationId)) throw new Error("operationId must be a lowercase SHA-256 hex string");
    const existing = this.recover();
    const material = {
      journalVersion: GOVERNANCE_OPERATOR_JOURNAL_VERSION_V1,
      sequence: existing.length,
      timestamp: new Date().toISOString(),
      operationId,
      event,
      previousEntryHash: existing.at(-1)?.entryHash ?? "0".repeat(64),
      payload: redactGovernanceJournalValueV1(payload),
    } as const;
    const entry: GovernanceJournalEntryV1 = { ...material, entryHash: journalHash(material) };
    const descriptor = openSync(this.path, "a");
    try {
      writeSync(descriptor, `${JSON.stringify(entry)}\n`, undefined, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return entry;
  }
}

export class ExclusiveOperatorLockV1 {
  readonly path: string;
  #held = false;
  constructor(path: string) { this.path = resolve(path); }
  acquire(operationId: string): void {
    if (this.#held) throw new Error("operator lock is already held by this process");
    const descriptor = openSync(this.path, "wx");
    try {
      writeFileSync(descriptor, JSON.stringify({ lockVersion: GOVERNANCE_OPERATOR_LOCK_VERSION_V1, operationId, acquiredAt: new Date().toISOString() }), "utf8");
      fsyncSync(descriptor);
      this.#held = true;
    } catch (error) {
      try { unlinkSync(this.path); } catch { /* best-effort cleanup of only the exact lock path */ }
      throw error;
    } finally {
      closeSync(descriptor);
    }
  }
  release(): void {
    if (!this.#held) return;
    unlinkSync(this.path);
    this.#held = false;
  }
}

export class RpcRateLimit429V1 extends Error {
  readonly status = 429;
  constructor(readonly retryAfterMs: number, message = "RPC rate limited") {
    super(message);
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) throw new RangeError("retryAfterMs must be a nonnegative integer");
  }
}

export class OperatorBackoffExitV1 extends Error {
  constructor(readonly retryAfterMs: number) { super(`operator exited after first 429; retry no earlier than ${retryAfterMs} ms`); }
}

function isRateLimit(error: unknown): error is { retryAfterMs?: number; status?: number } {
  return error instanceof RpcRateLimit429V1 || (typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 429);
}

function exactMeta(
  actual: NormalizedAccountMetaV1,
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
  field: string,
): void {
  if (
    !actual.pubkey.equals(pubkey) ||
    actual.isSigner !== isSigner ||
    actual.isWritable !== isWritable
  ) {
    throw new Error(`${field} account metadata drifted`);
  }
}

function envelopeFromDecodedInstruction(
  decoded: ReturnType<typeof decodeRelease1CurrentInstruction>,
): EnvelopeExpectationV1 | undefined {
  const value = decoded.value as unknown;
  if (value === null || typeof value !== "object" || !("envelope" in value)) return undefined;
  return (value as { envelope: EnvelopeExpectationV1 }).envelope;
}

const OPERATOR_INSTRUCTION_NAMES_V1: Readonly<Record<number, string>> = Object.freeze({
  18: "CreateCandidateCouncilSetV1", 19: "CreateCouncilRotationV1",
  20: "ApproveCouncilRotationV1", 21: "ActivateCouncilRotationV1",
  22: "QueueCouncilRotationV1",
  24: "CancelCouncilRotationV1", 25: "ExpireCouncilRotationV1",
  39: "BeginProgramDataObservationV1", 40: "AppendProgramDataObservationChunkV1",
  41: "VerifyObservedArtifactChunkV1", 42: "FinalizeProgramDataObservationV1",
  43: "RecordControllerImmutabilityV1", 44: "CreateTargetAuthorityHandoffV1",
  45: "ApproveTargetAuthorityHandoffV1", 46: "QueueTargetAuthorityHandoffV1",
  47: "AcceptTargetAuthorityCheckedV1", 49: "CreateBootstrapActivationV1",
  50: "ApproveBootstrapActivationV1", 51: "QueueBootstrapActivationV1",
  52: "ExecuteBootstrapActivationV1", 53: "InitializeControllerV2",
  54: "CreateProposalV3", 55: "ApproveProposalV3", 56: "FinalizeGovernanceV3",
  57: "QueueProposalV3", 58: "FreezeProposalV3", 59: "CancelProposalV3",
  60: "ExpireProposalV3", 61: "GuardianFreezeV2", 62: "CreateEmergencyResolutionV2",
  63: "ApproveEmergencyResolutionV2", 64: "QueueEmergencyResolutionV2",
  65: "ExecuteEmergencyResolutionV2", 66: "ExpireEmergencyResolutionV2",
  67: "CreateCheckpointV2", 68: "RecastCheckpointV2", 69: "FinalizeCheckpointV2",
  70: "BindProgramDataVerificationV2", 71: "FinalizeProgramDataVerificationV2",
  72: "ObserveProgramDataFailureV2", 73: "ApproveUnfreezeV2", 74: "ExecuteUnfreezeV2",
  75: "AdoptBufferV2", 76: "VerifyBufferChunkV2", 77: "FinalizeBufferVerificationV2",
  78: "ExtendTargetV2", 79: "ExecuteUpgradeV2", 80: "CloseAbandonedBufferV2",
  81: "ActivateRollbackV2",
});

function decodedActionValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(decodedActionValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([field, entry]) => [field, decodedActionValue(entry)]),
    );
  }
  return value;
}

/** Returns the complete action display from the exact instruction bytes and
 * ordered metas that will be validated before signing. No adapter-supplied
 * human-readable mirror participates in confirmation. */
export function decodePreparedGovernanceActionV1(
  prepared: PreparedGovernanceTransactionV1,
): Readonly<Record<string, unknown>> {
  const decoded = decodeRelease1CurrentInstruction(prepared.controllerInstructionData);
  const controller = prepared.topLevelInstructions.find((instruction) => instruction.kind === "controller");
  if (controller === undefined) throw new Error("prepared transaction has no controller instruction");
  return Object.freeze({
    controllerProgram: prepared.controllerProgram.toBase58(),
    instructionName: OPERATOR_INSTRUCTION_NAMES_V1[decoded.tag] ?? `UnknownTag${decoded.tag}`,
    instructionTag: decoded.tag,
    instructionDataHex: prepared.controllerInstructionData.toString("hex"),
    accounts: controller.accounts.map((account, index) => Object.freeze({
      index,
      pubkey: account.pubkey.toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    decoded: decodedActionValue(decoded.value),
  });
}

export interface ValidatedGovernanceMessageV1 {
  bytes: Buffer;
  version: "legacy" | 0;
  feePayer: PublicKey;
  recentBlockhash: string;
  messageSha256: string;
  requiredSignerAuthorities: readonly PublicKey[];
  lookupTables: readonly Readonly<{
    key: string;
    deactivationSlot: string;
    lastExtendedSlot: number;
    lastExtendedSlotStartIndex: number;
    authority: string | null;
    addresses: readonly string[];
  }>[];
}

/** Deserialize the exact bytes sent to the signer, resolve any v0 lookup
 * tables from the supplied finalized snapshots, compare every instruction and
 * privilege to the armed preparation, and require canonical round-trip bytes. */
export function validateCompiledGovernanceMessageV1(
  prepared: PreparedGovernanceTransactionV1,
  rawMessage: Buffer,
): ValidatedGovernanceMessageV1 {
  if (!Buffer.isBuffer(rawMessage) || rawMessage.length === 0) {
    throw new Error("compiled governance message must be nonempty bytes");
  }
  const message = VersionedMessage.deserialize(rawMessage);
  if (message.version !== prepared.messageVersion) {
    throw new Error("compiled governance message version drifted");
  }
  if (message.recentBlockhash !== prepared.recentBlockhash) {
    throw new Error("compiled governance recent blockhash drifted");
  }
  const lookupTables = [...prepared.addressLookupTableAccounts];
  if (message.version === "legacy" && lookupTables.length !== 0) {
    throw new Error("legacy governance message cannot carry lookup-table snapshots");
  }
  let decompiled: TransactionMessage;
  try {
    decompiled = message.version === 0
      ? TransactionMessage.decompile(message, { addressLookupTableAccounts: lookupTables })
      : TransactionMessage.decompile(message);
  } catch (error) {
    throw new Error(`compiled governance message lookup resolution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!decompiled.payerKey.equals(prepared.feePayer)) {
    throw new Error("compiled governance fee payer drifted");
  }
  if (decompiled.instructions.length !== prepared.topLevelInstructions.length) {
    throw new Error("compiled governance instruction count drifted");
  }
  decompiled.instructions.forEach((instruction, instructionIndex) => {
    const expected = prepared.topLevelInstructions[instructionIndex]!;
    if (!instruction.programId.equals(expected.programId) || !Buffer.from(instruction.data).equals(expected.data)) {
      throw new Error(`compiled governance instruction ${instructionIndex} data or program drifted`);
    }
    if (instruction.keys.length !== expected.accounts.length) {
      throw new Error(`compiled governance instruction ${instructionIndex} account count drifted`);
    }
    instruction.keys.forEach((account, accountIndex) => {
      const expectedAccount = expected.accounts[accountIndex]!;
      exactMeta(account, expectedAccount.pubkey, expectedAccount.isSigner, expectedAccount.isWritable, `compiled[${instructionIndex}][${accountIndex}]`);
    });
  });
  const canonical = new TransactionMessage({
    payerKey: decompiled.payerKey,
    recentBlockhash: decompiled.recentBlockhash,
    instructions: decompiled.instructions,
  });
  const canonicalBytes = Buffer.from(
    message.version === 0
      ? canonical.compileToV0Message(lookupTables).serialize()
      : canonical.compileToLegacyMessage().serialize(),
  );
  if (!canonicalBytes.equals(rawMessage)) {
    throw new Error("compiled governance message is not canonical for the validated action");
  }
  return Object.freeze({
    bytes: Buffer.from(rawMessage),
    version: message.version,
    feePayer: decompiled.payerKey,
    recentBlockhash: decompiled.recentBlockhash,
    messageSha256: createHash("sha256").update(rawMessage).digest("hex"),
    requiredSignerAuthorities: Object.freeze(message.staticAccountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((authority) => new PublicKey(authority))),
    lookupTables: Object.freeze(lookupTables.map((table) => Object.freeze({
      key: table.key.toBase58(),
      deactivationSlot: table.state.deactivationSlot.toString(),
      lastExtendedSlot: table.state.lastExtendedSlot,
      lastExtendedSlotStartIndex: table.state.lastExtendedSlotStartIndex,
      authority: table.state.authority?.toBase58() ?? null,
      addresses: Object.freeze(table.state.addresses.map((address) => address.toBase58())),
    }))),
  });
}

/** Ensure the submitted packet contains the exact validated message and the
 * exact signer-provider signature at that authority's required signer index. */
export function validateAssembledGovernanceTransactionV1(
  signedTransaction: Buffer,
  validatedMessage: ValidatedGovernanceMessageV1,
  signatures: readonly GovernanceMessageSignatureV1[],
): void {
  if (!Buffer.isBuffer(signedTransaction) || signedTransaction.length === 0 || signedTransaction.length > 1_232) {
    throw new Error("assembled governance transaction is outside the 1,232-byte packet bound");
  }
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(signedTransaction);
  } catch (error) {
    throw new Error(`assembled governance transaction is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Buffer.from(transaction.message.serialize()).equals(validatedMessage.bytes)) {
    throw new Error("assembled governance transaction substituted the validated message");
  }
  if (signatures.length !== validatedMessage.requiredSignerAuthorities.length) {
    throw new Error("assembled governance transaction lacks an explicit required signature");
  }
  const supplied = new Map<string, Buffer>();
  for (const entry of signatures) {
    const encoded = entry.authority.toBase58();
    if (supplied.has(encoded)) throw new Error("duplicate injected signer authority");
    supplied.set(encoded, entry.signature);
  }
  for (const [signerIndex, authority] of validatedMessage.requiredSignerAuthorities.entries()) {
    const signature = supplied.get(authority.toBase58());
    if (signature === undefined) throw new Error("assembled governance transaction lacks an explicit required signature");
    if (!Buffer.from(transaction.signatures[signerIndex] ?? []).equals(signature)) {
      throw new Error("assembled governance transaction substituted an injected signature");
    }
  }
}

function expectedComputeUnitLimitData(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1) {
    throw new RangeError("compute-unit limit is outside the Release 1 envelope bound");
  }
  const data = Buffer.alloc(5);
  data[0] = 2;
  data.writeUInt32LE(value, 1);
  return data;
}

function expectedComputeUnitPriceData(value: bigint): Buffer {
  if (value < 0n || value > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1) {
    throw new RangeError("compute-unit price is outside the Release 1 envelope bound");
  }
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(value, 1);
  return data;
}

function validateExactEnvelope(
  envelope: EnvelopeExpectationV1 | undefined,
  instructions: readonly NormalizedTopLevelInstructionV1[],
): void {
  if (envelope === undefined) {
    if (instructions.length !== 1 || instructions[0]?.kind !== "controller") {
      throw new Error("this typed action admits only its one controller instruction");
    }
    return;
  }
  if (envelope.durableNonceAccount.present !== envelope.durableNonceAuthority.present) {
    throw new Error("durable nonce account and authority must be jointly present or absent");
  }
  const hasNonce = envelope.durableNonceAccount.present;
  const expectedLength = hasNonce ? 4 : 3;
  if (instructions.length !== expectedLength) throw new Error("prepared envelope has the wrong instruction count");
  let cursor = 0;
  if (hasNonce) {
    const nonce = instructions[cursor++]!;
    if (
      nonce.kind !== "durable-nonce-advance" ||
      !nonce.programId.equals(SYSTEM_PROGRAM_ID_V1) ||
      !nonce.data.equals(Buffer.from([4, 0, 0, 0])) ||
      nonce.accounts.length !== 3
    ) {
      throw new Error("durable nonce advance is not canonical");
    }
    exactMeta(nonce.accounts[0]!, envelope.durableNonceAccount.value, false, true, "durable nonce");
    exactMeta(nonce.accounts[1]!, RECENT_BLOCKHASHES_SYSVAR_ID_V1, false, false, "recent blockhashes");
    exactMeta(nonce.accounts[2]!, envelope.durableNonceAuthority.value, true, false, "durable nonce authority");
  }
  const limit = instructions[cursor++]!;
  if (
    limit.kind !== "compute-unit-limit" ||
    !limit.programId.equals(COMPUTE_BUDGET_PROGRAM_ID_V1) ||
    limit.accounts.length !== 0 ||
    !limit.data.equals(expectedComputeUnitLimitData(envelope.computeUnitLimit))
  ) {
    throw new Error("compute-unit limit instruction is not canonical");
  }
  const price = instructions[cursor++]!;
  if (
    price.kind !== "compute-unit-price" ||
    !price.programId.equals(COMPUTE_BUDGET_PROGRAM_ID_V1) ||
    price.accounts.length !== 0 ||
    !price.data.equals(expectedComputeUnitPriceData(envelope.computeUnitPriceMicroLamports))
  ) {
    throw new Error("compute-unit price instruction is not canonical");
  }
  if (instructions[cursor]?.kind !== "controller") throw new Error("controller instruction must be last");
}

function addressLookupPlanFromProposalPlan(
  plan: Release1ProposalPlanV1,
): Release1AddressLookupPlanV1 | null {
  const lookup = plan.controllerLookupTable;
  if (lookup === null) return null;
  const bindings = {
    operationId: plan.operationId,
    controllerProgram: plan.controllerProgram,
    clusterDomain: plan.clusterDomain,
    lookupTable: lookup.lookupTable,
    lookupTableAuthority: lookup.lookupTableAuthority,
    lookupTableDeactivationSlot: lookup.lookupTableDeactivationSlot,
    lookupTableLastExtendedSlot: lookup.lookupTableLastExtendedSlot,
    lookupTableLastExtendedSlotStartIndex: lookup.lookupTableLastExtendedSlotStartIndex,
    lookupTableAddresses: lookup.lookupTableAddresses,
    requiredLookupAddresses: lookup.requiredLookupAddresses,
    observedSlot: lookup.observedSlot,
    validThroughSlot: lookup.validThroughSlot,
  };
  return { ...bindings, lookupPlanId: release1AddressLookupPlanIdV1(bindings) };
}

function exactPreparedLookupSnapshot(
  plan: Release1ProposalPlanV1,
  prepared: PreparedGovernanceTransactionV1,
): void {
  const lookupPlan = addressLookupPlanFromProposalPlan(plan);
  if (lookupPlan === null) {
    if (prepared.messageVersion !== "legacy" || prepared.addressLookupTableAccounts.length !== 0) {
      throw new Error("armed legacy plan cannot be replaced with an unbound lookup table");
    }
    return;
  }
  if (prepared.messageVersion !== 0 || prepared.addressLookupTableAccounts.length !== 1) {
    throw new Error("armed v0 plan requires its one exact lookup table snapshot");
  }
  assertRelease1AddressLookupPlanFreshV1(lookupPlan, {
    operationId: plan.operationId,
    controllerProgram: plan.controllerProgram,
    clusterDomain: plan.clusterDomain,
    lookupTableAccount: prepared.addressLookupTableAccounts[0]!,
    currentSlot: lookupPlan.observedSlot,
  });
}

async function assertFinalizedLookupFreshV1(
  adapter: FinalizedGovernanceReadAdapterV1,
  plan: Release1ProposalPlanV1,
): Promise<void> {
  const lookupPlan = addressLookupPlanFromProposalPlan(plan);
  if (lookupPlan === null) return;
  if (adapter.rereadAddressLookupTable === undefined) {
    throw new Error("v0 execution requires an injected finalized lookup-table reader");
  }
  const observation = await adapter.rereadAddressLookupTable(lookupPlan);
  if (observation.commitment !== "finalized" || observation.contextSlot < 0n) {
    throw new Error("lookup-table reread was not finalized");
  }
  assertRelease1AddressLookupPlanFreshV1(lookupPlan, {
    operationId: plan.operationId,
    controllerProgram: plan.controllerProgram,
    clusterDomain: plan.clusterDomain,
    lookupTableAccount: observation.lookupTableAccount,
    currentSlot: observation.contextSlot,
  });
}

/** Emergency resume admits no nonce and exactly one bounded limit/price pair. */
export function validateBoundedEmergencyResolutionEnvelopeV1(
  instructions: readonly NormalizedTopLevelInstructionV1[],
): void {
  if (
    instructions.length !== 3
    || instructions[0]?.kind !== "compute-unit-limit"
    || instructions[1]?.kind !== "compute-unit-price"
    || instructions[2]?.kind !== "controller"
  ) throw new Error("emergency resolution requires the bounded compute/controller envelope");
  const [limit, price] = instructions;
  if (
    !limit!.programId.equals(COMPUTE_BUDGET_PROGRAM_ID_V1)
    || limit!.accounts.length !== 0
    || limit!.data.length !== 5
    || limit!.data[0] !== 2
  ) throw new Error("emergency resolution compute-unit limit is not canonical");
  const units = limit!.data.readUInt32LE(1);
  if (units === 0 || units > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1) {
    throw new Error("emergency resolution compute-unit limit is outside the Release 1 bound");
  }
  if (
    !price!.programId.equals(COMPUTE_BUDGET_PROGRAM_ID_V1)
    || price!.accounts.length !== 0
    || price!.data.length !== 9
    || price!.data[0] !== 3
    || price!.data.readBigUInt64LE(1) > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1
  ) throw new Error("emergency resolution compute-unit price is not canonical or bounded");
}

export function validatePreparedGovernanceTransactionV1(
  command: OperatorMutationCommandV1,
  plan: Release1ProposalPlanV1,
  prepared: PreparedGovernanceTransactionV1,
): Readonly<Record<string, unknown>> {
  if (!prepared.controllerProgram.equals(plan.controllerProgram)) throw new Error("prepared controller program drifted");
  exactPreparedLookupSnapshot(plan, prepared);
  const decoded = decodeRelease1CurrentInstruction(prepared.controllerInstructionData);
  if (!OPERATOR_EXPECTED_TAGS_V1[command].includes(decoded.tag)) throw new Error(`controller tag ${decoded.tag} is not admitted for ${command}`);
  const controllerInstructions = prepared.topLevelInstructions.filter((instruction) => instruction.kind === "controller");
  if (controllerInstructions.length !== 1 || prepared.topLevelInstructions.at(-1)?.kind !== "controller") throw new Error("prepared envelope must end with exactly one controller instruction");
  if (!controllerInstructions[0]!.programId.equals(plan.controllerProgram) || !controllerInstructions[0]!.data.equals(prepared.controllerInstructionData)) throw new Error("prepared controller instruction mirror drifted");
  if (!prepared.controllerInstructionData.equals(plan.controllerInstructionData)) {
    throw new Error("prepared controller instruction data does not match the armed plan");
  }
  if (controllerInstructions[0]!.accounts.length !== plan.controllerInstructionAccounts.length) {
    throw new Error("prepared controller account count does not match the armed plan");
  }
  controllerInstructions[0]!.accounts.forEach((account, index) => {
    const expected = plan.controllerInstructionAccounts[index]!;
    exactMeta(account, expected.pubkey, expected.isSigner, expected.isWritable, `controller[${index}]`);
  });
  if (prepared.topLevelInstructions.filter((instruction) => instruction.kind === "durable-nonce-advance").length > 1) throw new Error("prepared envelope contains multiple nonce advances");
  if (prepared.topLevelInstructions.filter((instruction) => instruction.kind === "compute-unit-limit").length > 1 || prepared.topLevelInstructions.filter((instruction) => instruction.kind === "compute-unit-price").length > 1) throw new Error("prepared envelope contains duplicate compute-budget fields");
  const controllerIndex = prepared.topLevelInstructions.length - 1;
  if (prepared.topLevelInstructions.slice(0, controllerIndex).some((instruction) => instruction.kind === "controller")) throw new Error("prepared envelope contains a sibling controller instruction");
  if (decoded.tag === 65) {
    validateBoundedEmergencyResolutionEnvelopeV1(prepared.topLevelInstructions);
    validateExactEnvelope(envelopeFromDecodedInstruction(decoded), prepared.topLevelInstructions);
  } else {
    validateExactEnvelope(envelopeFromDecodedInstruction(decoded), prepared.topLevelInstructions);
  }
  return decodePreparedGovernanceActionV1(prepared);
}

export interface ExecuteGovernanceMutationV1Input {
  command: OperatorMutationCommandV1;
  plan: Release1ProposalPlanV1;
  armOperationId: string;
  expectedGenesisHash: string;
  production: boolean;
  readAdapter: FinalizedGovernanceReadAdapterV1;
  transactionAdapter: TypedGovernanceTransactionAdapterV1;
  signers: readonly InjectedGovernanceSignerV1[];
  submission: InjectedSubmissionTransportV1;
  confirmDecodedAction: DecodedActionConfirmationHookV1;
  journal: GovernanceJournalV1;
  lock: ExclusiveOperatorLockV1;
}

export async function executeGovernanceMutationV1(input: ExecuteGovernanceMutationV1Input): Promise<{ signature: string }> {
  const { plan } = input;
  if (!OPERATOR_MUTATION_COMMANDS_V1.includes(input.command)) throw new Error("unknown mutation command");
  if (input.armOperationId !== plan.operationId) throw new Error("explicit arming must equal the deterministic operation ID");
  if (input.production) assertProductionControllerIdentityV1(plan.controllerProgram);
  input.lock.acquire(plan.operationId);
  input.journal.append(plan.operationId, "armed", {
    command: input.command,
    signerProviders: input.signers.map((signer) => ({
      providerKind: signer.providerKind,
      authority: signer.authority,
    })),
  });
  try {
    assertClusterDomainV1(plan.clusterDomain, await input.readAdapter.getGenesisHash());
    assertClusterDomainV1(plan.clusterDomain, input.expectedGenesisHash);

    const beforeSigning = await input.readAdapter.rereadPlanBindings(plan);
    if (beforeSigning.commitment !== "finalized" || beforeSigning.contextSlot < 0n) throw new Error("pre-signing reread was not finalized");
    assertRelease1PlanFreshV1(plan, beforeSigning.bindings);
    input.journal.append(plan.operationId, "reread-before-signing", beforeSigning);

    const prepared = await input.transactionAdapter.prepare(input.command, plan);
    const decodedInstruction = validatePreparedGovernanceTransactionV1(input.command, plan, prepared);
    const message = Buffer.from(await input.transactionAdapter.compileMessage(prepared));
    const validatedMessage = validateCompiledGovernanceMessageV1(prepared, message);
    const decodedAction = Object.freeze({
      ...decodedInstruction,
      message: Object.freeze({
        version: validatedMessage.version,
        feePayer: validatedMessage.feePayer.toBase58(),
        recentBlockhash: validatedMessage.recentBlockhash,
        messageSha256: validatedMessage.messageSha256,
        requiredSignerAuthorities: validatedMessage.requiredSignerAuthorities.map((authority) => authority.toBase58()),
        lookupTables: validatedMessage.lookupTables,
      }),
    });
    input.journal.append(plan.operationId, "decoded-action", decodedAction);
    if (!(await input.confirmDecodedAction(decodedAction, plan.operationId))) throw new Error("decoded action was not confirmed");

    const immediateBeforeSigning = await input.readAdapter.rereadPlanBindings(plan);
    if (immediateBeforeSigning.commitment !== "finalized" || immediateBeforeSigning.contextSlot < beforeSigning.contextSlot) {
      throw new Error("immediate pre-signing reread was not a monotonic finalized observation");
    }
    assertRelease1PlanFreshV1(plan, immediateBeforeSigning.bindings);
    await assertFinalizedLookupFreshV1(input.readAdapter, plan);
    input.journal.append(plan.operationId, "reread-immediately-before-signing", immediateBeforeSigning);

    const signerByAuthority = new Map<string, InjectedGovernanceSignerV1>();
    for (const signer of input.signers) {
      const encoded = signer.authority.toBase58();
      if (signerByAuthority.has(encoded)) throw new Error("duplicate injected signer provider");
      signerByAuthority.set(encoded, signer);
    }
    if (signerByAuthority.size !== validatedMessage.requiredSignerAuthorities.length) {
      throw new Error("injected signer set does not exactly match the validated message");
    }
    const signatureEntries: GovernanceMessageSignatureV1[] = [];
    for (const authority of validatedMessage.requiredSignerAuthorities) {
      const signer = signerByAuthority.get(authority.toBase58());
      if (signer === undefined) throw new Error("missing injected signer provider for a required authority");
      const signature = await signer.signMessage(message, decodedAction);
      if (!Buffer.isBuffer(signature) || signature.length !== 64) throw new Error("every injected signer must return one 64-byte Ed25519 signature");
      signatureEntries.push({ authority, signature: Buffer.from(signature) });
    }
    input.journal.append(plan.operationId, "signed", {
      messageSha256: validatedMessage.messageSha256,
      signerAuthorities: signatureEntries.map((entry) => entry.authority),
    });

    const beforeSubmission = await input.readAdapter.rereadPlanBindings(plan);
    if (beforeSubmission.commitment !== "finalized" || beforeSubmission.contextSlot < beforeSigning.contextSlot) throw new Error("pre-submission reread was not a monotonic finalized observation");
    assertRelease1PlanFreshV1(plan, beforeSubmission.bindings);
    await assertFinalizedLookupFreshV1(input.readAdapter, plan);
    input.journal.append(plan.operationId, "reread-before-submission", beforeSubmission);

    const signedTransaction = await input.transactionAdapter.assembleSignedTransaction(prepared, message, signatureEntries);
    validateAssembledGovernanceTransactionV1(
      Buffer.from(signedTransaction),
      validatedMessage,
      signatureEntries,
    );
    const result = await input.submission.submitSignedTransaction(signedTransaction, plan.operationId);
    input.journal.append(plan.operationId, "submitted", result);
    return result;
  } catch (error) {
    if (isRateLimit(error)) {
      const retryAfterMs = Number.isSafeInteger(error.retryAfterMs) && (error.retryAfterMs ?? -1) >= 0
        ? error.retryAfterMs!
        : 0;
      input.journal.append(plan.operationId, "rate-limit-exit", { status: 429, retryAfterMs, retryAt: new Date(Date.now() + retryAfterMs).toISOString() });
      throw new OperatorBackoffExitV1(retryAfterMs);
    }
    input.journal.append(plan.operationId, "failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      detail: "operation failed before finalized submission",
    });
    throw error;
  } finally {
    input.lock.release();
  }
}
