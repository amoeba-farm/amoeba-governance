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
import { PublicKey } from "@solana/web3.js";
import {
  assertClusterDomainV1,
  assertProductionControllerIdentityV1,
  assertRelease1PlanFreshV1,
  redactGovernanceJournalValueV1,
  type FinalizedAccountObservationV1,
  type Release1ProposalPlanBindingsV1,
  type Release1ProposalPlanV1,
} from "./release1Planning.js";
import { decodeRelease1InstructionV1 } from "./release1LifecycleInstructions.js";
import {
  MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  type EnvelopeExpectationV1,
} from "./release1LoaderInstructions.js";

export const GOVERNANCE_OPERATOR_JOURNAL_VERSION_V1 = 1;
export const GOVERNANCE_OPERATOR_LOCK_VERSION_V1 = 1;

export const OPERATOR_MUTATION_COMMANDS_V1 = Object.freeze([
  "adopt-buffer", "verify-buffer", "approve", "finalize-governance", "queue",
  "guardian-freeze", "freeze", "bind-prestate", "approve-checkpoint",
  "execute-extension", "execute-upgrade", "verify-programdata", "bind-poststate",
  "approve-unfreeze", "unfreeze", "cancel", "expire", "close-buffer",
  "create-council-set", "rotate-council",
] as const);
export type OperatorMutationCommandV1 = (typeof OPERATOR_MUTATION_COMMANDS_V1)[number];

export const COMPUTE_BUDGET_PROGRAM_ID_V1 = new PublicKey(
  "ComputeBudget111111111111111111111111111111",
);
export const SYSTEM_PROGRAM_ID_V1 = PublicKey.default;
export const RECENT_BLOCKHASHES_SYSVAR_ID_V1 = new PublicKey(
  "SysvarRecentB1ockHashes11111111111111111111",
);

const EXPECTED_TAGS: Readonly<Record<OperatorMutationCommandV1, readonly number[]>> = Object.freeze({
  "adopt-buffer": [27],
  "verify-buffer": [28, 29],
  approve: [3],
  "finalize-governance": [4],
  queue: [5],
  "guardian-freeze": [9],
  freeze: [6, 14],
  "bind-prestate": [15, 16, 17],
  "approve-checkpoint": [15, 16],
  "execute-extension": [30],
  "execute-upgrade": [31],
  "verify-programdata": [32, 33],
  "bind-poststate": [15, 16, 17],
  "approve-unfreeze": [34],
  unfreeze: [35],
  cancel: [7, 24],
  expire: [8, 23, 25],
  "close-buffer": [36],
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
  decodedAction: Readonly<Record<string, unknown>>;
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
}

export interface TypedGovernanceTransactionAdapterV1 {
  prepare(command: OperatorMutationCommandV1, plan: Release1ProposalPlanV1): Promise<PreparedGovernanceTransactionV1>;
  compileMessage(prepared: PreparedGovernanceTransactionV1): Promise<Buffer>;
  assembleSignedTransaction(prepared: PreparedGovernanceTransactionV1, message: Buffer, signature: Buffer): Promise<Buffer>;
}

export interface InjectedGovernanceSignerV1 {
  readonly providerKind: "wallet" | "kms" | "hardware" | "smart-account";
  readonly authority: PublicKey;
  signMessage(message: Buffer, decodedAction: Readonly<Record<string, unknown>>): Promise<Buffer>;
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
  decoded: ReturnType<typeof decodeRelease1InstructionV1>,
): EnvelopeExpectationV1 | undefined {
  const value = decoded.value as unknown;
  if (value === null || typeof value !== "object" || !("envelope" in value)) return undefined;
  return (value as { envelope: EnvelopeExpectationV1 }).envelope;
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

export function validatePreparedGovernanceTransactionV1(
  command: OperatorMutationCommandV1,
  plan: Release1ProposalPlanV1,
  prepared: PreparedGovernanceTransactionV1,
): void {
  if (!prepared.controllerProgram.equals(plan.controllerProgram)) throw new Error("prepared controller program drifted");
  const decoded = decodeRelease1InstructionV1(prepared.controllerInstructionData);
  if (!EXPECTED_TAGS[command].includes(decoded.tag)) throw new Error(`controller tag ${decoded.tag} is not admitted for ${command}`);
  const controllerInstructions = prepared.topLevelInstructions.filter((instruction) => instruction.kind === "controller");
  if (controllerInstructions.length !== 1 || prepared.topLevelInstructions.at(-1)?.kind !== "controller") throw new Error("prepared envelope must end with exactly one controller instruction");
  if (!controllerInstructions[0]!.programId.equals(plan.controllerProgram) || !controllerInstructions[0]!.data.equals(prepared.controllerInstructionData)) throw new Error("prepared controller instruction mirror drifted");
  if (prepared.topLevelInstructions.filter((instruction) => instruction.kind === "durable-nonce-advance").length > 1) throw new Error("prepared envelope contains multiple nonce advances");
  if (prepared.topLevelInstructions.filter((instruction) => instruction.kind === "compute-unit-limit").length > 1 || prepared.topLevelInstructions.filter((instruction) => instruction.kind === "compute-unit-price").length > 1) throw new Error("prepared envelope contains duplicate compute-budget fields");
  const controllerIndex = prepared.topLevelInstructions.length - 1;
  if (prepared.topLevelInstructions.slice(0, controllerIndex).some((instruction) => instruction.kind === "controller")) throw new Error("prepared envelope contains a sibling controller instruction");
  validateExactEnvelope(envelopeFromDecodedInstruction(decoded), prepared.topLevelInstructions);
}

export interface ExecuteGovernanceMutationV1Input {
  command: OperatorMutationCommandV1;
  plan: Release1ProposalPlanV1;
  armOperationId: string;
  expectedGenesisHash: string;
  production: boolean;
  readAdapter: FinalizedGovernanceReadAdapterV1;
  transactionAdapter: TypedGovernanceTransactionAdapterV1;
  signer: InjectedGovernanceSignerV1;
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
  input.journal.append(plan.operationId, "armed", { command: input.command, signerProvider: input.signer.providerKind, signerAuthority: input.signer.authority });
  try {
    assertClusterDomainV1(plan.clusterDomain, await input.readAdapter.getGenesisHash());
    assertClusterDomainV1(plan.clusterDomain, input.expectedGenesisHash);

    const beforeSigning = await input.readAdapter.rereadPlanBindings(plan);
    if (beforeSigning.commitment !== "finalized" || beforeSigning.contextSlot < 0n) throw new Error("pre-signing reread was not finalized");
    assertRelease1PlanFreshV1(plan, beforeSigning.bindings);
    input.journal.append(plan.operationId, "reread-before-signing", beforeSigning);

    const prepared = await input.transactionAdapter.prepare(input.command, plan);
    validatePreparedGovernanceTransactionV1(input.command, plan, prepared);
    input.journal.append(plan.operationId, "decoded-action", prepared.decodedAction);
    if (!(await input.confirmDecodedAction(prepared.decodedAction, plan.operationId))) throw new Error("decoded action was not confirmed");

    const message = await input.transactionAdapter.compileMessage(prepared);
    const signature = await input.signer.signMessage(Buffer.from(message), prepared.decodedAction);
    if (!Buffer.isBuffer(signature) || signature.length !== 64) throw new Error("injected signer must return one 64-byte Ed25519 signature");
    input.journal.append(plan.operationId, "signed", { messageSha256: createHash("sha256").update(message).digest("hex"), signerAuthority: input.signer.authority });

    const beforeSubmission = await input.readAdapter.rereadPlanBindings(plan);
    if (beforeSubmission.commitment !== "finalized" || beforeSubmission.contextSlot < beforeSigning.contextSlot) throw new Error("pre-submission reread was not a monotonic finalized observation");
    assertRelease1PlanFreshV1(plan, beforeSubmission.bindings);
    input.journal.append(plan.operationId, "reread-before-submission", beforeSubmission);

    const signedTransaction = await input.transactionAdapter.assembleSignedTransaction(prepared, message, signature);
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
    input.journal.append(plan.operationId, "failed", { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    input.lock.release();
  }
}
