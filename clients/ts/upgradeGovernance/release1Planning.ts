import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProgramDataVerificationStatusV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
  type BufferVerificationStatusV1 as BufferVerificationStatusV1Type,
  type GateStatusV1 as GateStatusV1Type,
  type ProgramDataVerificationStatusV1 as ProgramDataVerificationStatusV1Type,
  type ProposalStateV2 as ProposalStateV2Type,
  type StateCheckpointPhaseV1 as StateCheckpointPhaseV1Type,
} from "./release1.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

export const RELEASE1_PLAN_ID_DOMAIN_V1 = Buffer.from("AMOEBA_GOVERNANCE_PLAN_V1", "ascii");
export const FINALIZED_COMMITMENT = "finalized" as const;
export const RELEASE1_NO_EXTENSION_EXECUTION_RUNWAY_SLOTS_V1 = 1n;
export const RELEASE1_CHECKED_EXTENSION_EXECUTION_RUNWAY_SLOTS_V1 = 2n;

export const Release1PlanKindV1 = Object.freeze({
  Initialize: 1,
  CreateProposal: 2,
  AdoptBuffer: 3,
  VerifyBuffer: 4,
  ApproveProposal: 5,
  FinalizeGovernance: 6,
  Queue: 7,
  GuardianFreeze: 8,
  EmergencyResolution: 9,
  Freeze: 10,
  BindPrestate: 11,
  ApproveCheckpoint: 12,
  Extend: 13,
  Upgrade: 14,
  VerifyProgramdata: 15,
  BindPoststate: 16,
  ApproveUnfreeze: 17,
  Unfreeze: 18,
  Cancel: 19,
  Expire: 20,
  CloseBuffer: 21,
  Rollback: 22,
  CreateCouncilSet: 23,
  RotateCouncil: 24,
  PlanControllerImmutability: 25,
  PlanAuthorityHandoff: 26,
  VerifyAuthorityHandoff: 27,
} as const);
export type Release1PlanKindV1 =
  (typeof Release1PlanKindV1)[keyof typeof Release1PlanKindV1];

export const RELEASE1_MAX_CONTROLLER_INSTRUCTION_DATA_LEN_V1 = 16_384;
export const RELEASE1_MAX_CONTROLLER_ACCOUNT_METAS_V1 = 255;
export const RELEASE1_CONTROLLER_INSTRUCTION_INTENT_DOMAIN_V1 = Buffer.from(
  "AMOEBA_CONTROLLER_INSTRUCTION_INTENT_V1",
  "ascii",
);

export interface Release1ControllerInstructionAccountMetaV1 {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Release1ControllerLookupTableBindingV1 {
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

export interface FinalizedAccountObservationV1 {
  pubkey: PublicKey;
  contextSlot: bigint;
  owner: PublicKey;
  lamports: bigint;
  executable: boolean;
  rentEpoch: bigint;
  data: Buffer;
  dataSha256: Buffer;
  commitment: typeof FINALIZED_COMMITMENT;
}

export interface JsonRpcAccountInfoV1 {
  owner: string;
  lamports: number | bigint;
  executable: boolean;
  rentEpoch: number | bigint;
  data: readonly [string, "base64"] | Buffer;
}

export interface JsonRpcAccountContextV1 {
  context: { slot: number | bigint };
  value: JsonRpcAccountInfoV1 | null;
}

function toU64(value: number | bigint, field: string): bigint {
  const result = typeof value === "bigint" ? value : BigInt(value);
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || result < 0n || result > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`${field} must be an exact u64`);
  }
  return result;
}

function hash32(value: Buffer, field: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new RangeError(`${field} must be 32 bytes`);
  return value;
}

function key(value: PublicKey, field: string): Buffer {
  if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`);
  return value.toBuffer();
}

function u64Le(value: bigint, field: string): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(toU64(value, field));
  return out;
}

function enumByte(value: number, allowed: readonly number[], field: string): Buffer {
  if (!Number.isSafeInteger(value) || !allowed.includes(value)) throw new RangeError(`${field} is not a canonical enum value`);
  return Buffer.from([value]);
}

function u32Le(value: number, field: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${field} must be an exact u32`);
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function boolByte(value: boolean, field: string): Buffer {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return Buffer.from([value ? 1 : 0]);
}

/** Canonical exact controller instruction bytes and ordered privilege vector.
 * Mutation plan IDs bind this material so a transaction adapter cannot swap a
 * same-tag action, account, order, or privilege after the user arms the plan. */
export function canonicalRelease1ControllerInstructionIntentMaterialV1(
  data: Buffer,
  accounts: readonly Release1ControllerInstructionAccountMetaV1[],
): Buffer {
  if (
    !Buffer.isBuffer(data)
    || data.length === 0
    || data.length > RELEASE1_MAX_CONTROLLER_INSTRUCTION_DATA_LEN_V1
  ) {
    throw new RangeError("controller instruction data is outside the Release 1 bound");
  }
  if (
    !Array.isArray(accounts)
    || accounts.length > RELEASE1_MAX_CONTROLLER_ACCOUNT_METAS_V1
  ) {
    throw new RangeError("controller account metadata exceeds the Release 1 bound");
  }
  const encodedAccounts = accounts.map((account, index) => Buffer.concat([
    key(account.pubkey, `controllerInstructionAccounts[${index}].pubkey`),
    boolByte(account.isSigner, `controllerInstructionAccounts[${index}].isSigner`),
    boolByte(account.isWritable, `controllerInstructionAccounts[${index}].isWritable`),
  ]));
  return Buffer.concat([
    RELEASE1_CONTROLLER_INSTRUCTION_INTENT_DOMAIN_V1,
    u32Le(data.length, "controllerInstructionData.length"),
    data,
    u32Le(accounts.length, "controllerInstructionAccounts.length"),
    ...encodedAccounts,
  ]);
}

function canonicalControllerLookupTableMaterialV1(
  value: Release1ControllerLookupTableBindingV1 | null,
): Buffer {
  if (value === null) return Buffer.from([0]);
  if (value.lookupTableAddresses.length === 0 || value.lookupTableAddresses.length > 256) {
    throw new RangeError("lookupTableAddresses must contain 1-256 entries");
  }
  if (value.requiredLookupAddresses.length === 0 || value.requiredLookupAddresses.length > 256) {
    throw new RangeError("requiredLookupAddresses must contain 1-256 entries");
  }
  if (
    !Number.isSafeInteger(value.lookupTableLastExtendedSlotStartIndex)
    || value.lookupTableLastExtendedSlotStartIndex < 0
    || value.lookupTableLastExtendedSlotStartIndex > 255
  ) throw new RangeError("lookupTableLastExtendedSlotStartIndex must be a byte");
  const addressKeys = value.lookupTableAddresses.map((entry, index) => key(entry, `lookupTableAddresses[${index}]`));
  const requiredKeys = value.requiredLookupAddresses.map((entry, index) => key(entry, `requiredLookupAddresses[${index}]`));
  return Buffer.concat([
    Buffer.from([1]),
    key(value.lookupTable, "lookupTable"),
    value.lookupTableAuthority === null
      ? Buffer.concat([Buffer.from([0]), Buffer.alloc(32)])
      : Buffer.concat([Buffer.from([1]), key(value.lookupTableAuthority, "lookupTableAuthority")]),
    u64Le(value.lookupTableDeactivationSlot, "lookupTableDeactivationSlot"),
    u64Le(value.lookupTableLastExtendedSlot, "lookupTableLastExtendedSlot"),
    Buffer.from([value.lookupTableLastExtendedSlotStartIndex]),
    u32Le(addressKeys.length, "lookupTableAddresses.length"),
    ...addressKeys,
    u32Le(requiredKeys.length, "requiredLookupAddresses.length"),
    ...requiredKeys,
    u64Le(value.observedSlot, "lookupTableObservedSlot"),
    u64Le(value.validThroughSlot, "lookupTableValidThroughSlot"),
  ]);
}

/**
 * Returns the controller-derived minimum interval that must remain after a
 * permissionless freeze. It preserves one complete checkpoint-review window,
 * then one execution slot, plus the mandatory extension/upgrade separation
 * when checked extension is required.
 */
export function requiredRelease1FreezeRunwaySlotsV1(
  councilReviewSlots: bigint,
  extensionDelta: bigint,
): bigint {
  const review = toU64(councilReviewSlots, "councilReviewSlots");
  const extension = toU64(extensionDelta, "extensionDelta");
  const execution = extension === 0n
    ? RELEASE1_NO_EXTENSION_EXECUTION_RUNWAY_SLOTS_V1
    : RELEASE1_CHECKED_EXTENSION_EXECUTION_RUNWAY_SLOTS_V1;
  const result = review + execution;
  if (result > 0xffff_ffff_ffff_ffffn) throw new RangeError("freeze runway overflows u64");
  return result;
}

export function assertRelease1FreezeRunwayV1(value: {
  currentSlot: bigint;
  expirySlot: bigint;
  councilReviewSlots: bigint;
  extensionDelta: bigint;
}): void {
  const current = toU64(value.currentSlot, "currentSlot");
  const expiry = toU64(value.expirySlot, "expirySlot");
  const runway = requiredRelease1FreezeRunwaySlotsV1(
    value.councilReviewSlots,
    value.extensionDelta,
  );
  const horizon = current + runway;
  if (horizon > 0xffff_ffff_ffff_ffffn) throw new RangeError("freeze horizon overflows u64");
  if (horizon >= expiry) throw new Error("proposal has insufficient protected freeze runway");
}

export function parseFinalizedAccountObservationV1(
  pubkey: PublicKey,
  response: JsonRpcAccountContextV1,
  commitment: string,
): FinalizedAccountObservationV1 {
  if (commitment !== FINALIZED_COMMITMENT) throw new Error("governance observations require finalized commitment");
  if (response.value === null) throw new Error("observed account is absent");
  const encoded = response.value.data;
  const data = Buffer.isBuffer(encoded)
    ? Buffer.from(encoded)
    : encoded.length === 2 && encoded[1] === "base64"
      ? Buffer.from(encoded[0], "base64")
      : (() => { throw new Error("account data must use canonical base64 encoding"); })();
  if (typeof response.value.owner !== "string") throw new TypeError("account owner must be a base58 string");
  return {
    pubkey,
    contextSlot: toU64(response.context.slot, "context.slot"),
    owner: new PublicKey(response.value.owner),
    lamports: toU64(response.value.lamports, "lamports"),
    executable: response.value.executable,
    rentEpoch: toU64(response.value.rentEpoch, "rentEpoch"),
    data,
    dataSha256: createHash("sha256").update(data).digest(),
    commitment: FINALIZED_COMMITMENT,
  };
}

export function clusterDomainFromGenesisHashV1(genesisHash: string): Buffer {
  if (typeof genesisHash !== "string" || genesisHash.length === 0) throw new TypeError("genesisHash must be a base58 string");
  return new PublicKey(genesisHash).toBuffer();
}

export function assertClusterDomainV1(expectedClusterDomain: Buffer, genesisHash: string): void {
  if (!hash32(expectedClusterDomain, "expectedClusterDomain").equals(clusterDomainFromGenesisHashV1(genesisHash))) {
    throw new Error("connected genesis does not match the configured cluster domain");
  }
}

export function assertProductionControllerIdentityV1(controllerProgram: PublicKey): void {
  const bytes = key(controllerProgram, "controllerProgram");
  if (bytes.equals(Buffer.alloc(32)) || controllerProgram.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1)) {
    throw new Error("synthetic or default controller identity is forbidden for production planning");
  }
}

export interface TokenGovernanceDisabledStateV1 {
  tokenGovernanceEnabled: boolean;
  voteProgram: PublicKey;
  voteProgramdata: PublicKey;
  voteConfig: PublicKey;
  voteMint: PublicKey;
}

export function assertTokenGovernanceDisabledV1(value: TokenGovernanceDisabledStateV1): void {
  if (value.tokenGovernanceEnabled || [value.voteProgram, value.voteProgramdata, value.voteConfig, value.voteMint].some((entry) => !entry.equals(PublicKey.default))) {
    throw new Error("token governance must remain mechanically disabled in Release 1");
  }
}

export interface Release1ProposalPlanBindingsV1 {
  kind: Release1PlanKindV1;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  controllerInstructionData: Buffer;
  controllerInstructionAccounts: readonly Release1ControllerInstructionAccountMetaV1[];
  controllerLookupTable: Release1ControllerLookupTableBindingV1 | null;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  authorityPda: PublicKey;
  programdataAuthority: PublicKey;
  protocolGate: PublicKey;
  gateStatus: GateStatusV1Type;
  gateEpoch: bigint;
  proposal: PublicKey;
  proposalDigest: Buffer;
  proposalState: ProposalStateV2Type;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  council: PublicKey;
  targetNonce: bigint;
  programdataDeployedSlot: bigint;
  programdataCapacity: bigint;
  buffer: PublicKey;
  bufferAuthority: PublicKey;
  bufferVerificationStatus: BufferVerificationStatusV1Type;
  bufferVerifiedChunkCount: number;
  bufferChunkCount: number;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  programdataVerificationStatus: ProgramDataVerificationStatusV1Type;
  programdataVerifiedPayloadChunkCount: number;
  programdataVerifiedZeroTailChunkCount: number;
  checkpoint: PublicKey;
  checkpointDigest: Buffer;
  checkpointPhase: StateCheckpointPhaseV1Type;
  checkpointAccepted: boolean;
}

export interface Release1ProposalPlanV1 extends Release1ProposalPlanBindingsV1 {
  operationId: string;
  armed: false;
}

export function canonicalRelease1ProposalPlanMaterialV1(value: Release1ProposalPlanBindingsV1): Buffer {
  if (!Object.values(Release1PlanKindV1).includes(value.kind)) throw new RangeError("unknown Release1 plan kind");
  return Buffer.concat([
    Buffer.from([value.kind]), hash32(value.clusterDomain, "clusterDomain"), key(value.controllerProgram, "controllerProgram"),
    key(value.controllerConfig, "controllerConfig"),
    canonicalRelease1ControllerInstructionIntentMaterialV1(
      value.controllerInstructionData,
      value.controllerInstructionAccounts,
    ),
    canonicalControllerLookupTableMaterialV1(value.controllerLookupTable),
    key(value.targetProgram, "targetProgram"), key(value.targetProgramdata, "targetProgramdata"),
    key(value.authorityPda, "authorityPda"), key(value.programdataAuthority, "programdataAuthority"), key(value.protocolGate, "protocolGate"),
    enumByte(value.gateStatus, Object.values(GateStatusV1), "gateStatus"), u64Le(value.gateEpoch, "gateEpoch"),
    key(value.proposal, "proposal"), hash32(value.proposalDigest, "proposalDigest"),
    enumByte(value.proposalState, Object.values(ProposalStateV2), "proposalState"),
    u64Le(value.reviewStartSlot, "reviewStartSlot"), u64Le(value.reviewEndSlot, "reviewEndSlot"),
    u64Le(value.notBeforeSlot, "notBeforeSlot"), u64Le(value.expirySlot, "expirySlot"),
    u64Le(value.councilVersion, "councilVersion"), hash32(value.councilHash, "councilHash"), key(value.council, "council"),
    u64Le(value.targetNonce, "targetNonce"), u64Le(value.programdataDeployedSlot, "programdataDeployedSlot"),
    u64Le(value.programdataCapacity, "programdataCapacity"), key(value.buffer, "buffer"), key(value.bufferAuthority, "bufferAuthority"),
    enumByte(value.bufferVerificationStatus, Object.values(BufferVerificationStatusV1), "bufferVerificationStatus"),
    u32Le(value.bufferVerifiedChunkCount, "bufferVerifiedChunkCount"), u32Le(value.bufferChunkCount, "bufferChunkCount"),
    hash32(value.artifactSha256, "artifactSha256"), hash32(value.artifactChunkMerkleRoot, "artifactChunkMerkleRoot"),
    enumByte(value.programdataVerificationStatus, Object.values(ProgramDataVerificationStatusV1), "programdataVerificationStatus"),
    u32Le(value.programdataVerifiedPayloadChunkCount, "programdataVerifiedPayloadChunkCount"),
    u32Le(value.programdataVerifiedZeroTailChunkCount, "programdataVerifiedZeroTailChunkCount"),
    key(value.checkpoint, "checkpoint"), hash32(value.checkpointDigest, "checkpointDigest"),
    enumByte(value.checkpointPhase, Object.values(StateCheckpointPhaseV1), "checkpointPhase"),
    boolByte(value.checkpointAccepted, "checkpointAccepted"),
  ]);
}

export function release1ProposalPlanOperationIdV1(value: Release1ProposalPlanBindingsV1): string {
  return createHash("sha256").update(RELEASE1_PLAN_ID_DOMAIN_V1).update(canonicalRelease1ProposalPlanMaterialV1(value)).digest("hex");
}

/** Planning is deliberately execution-free and always returns an unarmed plan. */
export function planRelease1ProposalOperationV1(value: Release1ProposalPlanBindingsV1): Release1ProposalPlanV1 {
  return { ...value, operationId: release1ProposalPlanOperationIdV1(value), armed: false };
}

export function assertRelease1PlanFreshV1(plan: Release1ProposalPlanV1, current: Release1ProposalPlanBindingsV1): void {
  const expected = release1ProposalPlanOperationIdV1(current);
  if (plan.operationId !== expected || release1ProposalPlanOperationIdV1(plan) !== expected) throw new Error("stale or mutated governance plan");
}

const GOVERNANCE_SECRET_FIELD_NAMES_V1 = new Set([
  "secret", "secretkey", "privatekey", "keypair", "walletkeypair",
  "seed", "seedphrase", "mnemonic", "accesstoken", "refreshtoken",
  "authorization", "bearertoken", "apikey", "credential", "credentials",
  "password", "kmscredential", "kmscredentials",
]);

/** Normalize separators and case before classifying secret-bearing fields so
 * snake_case, kebab-case, and mixed-case aliases cannot bypass redaction. */
export function isGovernanceSecretFieldV1(field: string): boolean {
  const normalized = field.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return GOVERNANCE_SECRET_FIELD_NAMES_V1.has(normalized)
    || normalized.endsWith("privatekey")
    || normalized.endsWith("secretkey")
    || normalized.endsWith("seedphrase")
    || normalized.endsWith("keypair")
    || normalized.endsWith("accesstoken")
    || normalized.endsWith("refreshtoken")
    || normalized.endsWith("apikey")
    || normalized.endsWith("password");
}

export function redactGovernanceJournalValueV1(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(redactGovernanceJournalValueV1);
  if (value !== null && typeof value === "object") {
    if (value instanceof PublicKey) return value.toBase58();
    if (Buffer.isBuffer(value)) return value.toString("hex");
    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, isGovernanceSecretFieldV1(field) ? "[REDACTED]" : redactGovernanceJournalValueV1(entry)]));
  }
  return value;
}
