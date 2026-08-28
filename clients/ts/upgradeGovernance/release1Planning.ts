import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

export const RELEASE1_PLAN_ID_DOMAIN_V1 = Buffer.from("AMOEBA_GOVERNANCE_PLAN_V1", "ascii");
export const FINALIZED_COMMITMENT = "finalized" as const;

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
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  authorityPda: PublicKey;
  programdataAuthority: PublicKey;
  protocolGate: PublicKey;
  gateEpoch: bigint;
  proposal: PublicKey;
  proposalDigest: Buffer;
  councilVersion: bigint;
  councilHash: Buffer;
  council: PublicKey;
  targetNonce: bigint;
  buffer: PublicKey;
  bufferAuthority: PublicKey;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  checkpoint: PublicKey;
  checkpointDigest: Buffer;
}

export interface Release1ProposalPlanV1 extends Release1ProposalPlanBindingsV1 {
  operationId: string;
  armed: false;
}

export function canonicalRelease1ProposalPlanMaterialV1(value: Release1ProposalPlanBindingsV1): Buffer {
  if (!Object.values(Release1PlanKindV1).includes(value.kind)) throw new RangeError("unknown Release1 plan kind");
  return Buffer.concat([
    Buffer.from([value.kind]), hash32(value.clusterDomain, "clusterDomain"), key(value.controllerProgram, "controllerProgram"),
    key(value.controllerConfig, "controllerConfig"), key(value.targetProgram, "targetProgram"), key(value.targetProgramdata, "targetProgramdata"),
    key(value.authorityPda, "authorityPda"), key(value.programdataAuthority, "programdataAuthority"), key(value.protocolGate, "protocolGate"), u64Le(value.gateEpoch, "gateEpoch"),
    key(value.proposal, "proposal"), hash32(value.proposalDigest, "proposalDigest"), u64Le(value.councilVersion, "councilVersion"),
    hash32(value.councilHash, "councilHash"), key(value.council, "council"), u64Le(value.targetNonce, "targetNonce"), key(value.buffer, "buffer"),
    key(value.bufferAuthority, "bufferAuthority"),
    hash32(value.artifactSha256, "artifactSha256"), hash32(value.artifactChunkMerkleRoot, "artifactChunkMerkleRoot"),
    key(value.checkpoint, "checkpoint"), hash32(value.checkpointDigest, "checkpointDigest"),
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

const SECRET_FIELD = /^(secret|secretKey|privateKey|keypair|seedPhrase|mnemonic|accessToken|refreshToken|authorization)$/i;

export function redactGovernanceJournalValueV1(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(redactGovernanceJournalValueV1);
  if (value !== null && typeof value === "object") {
    if (value instanceof PublicKey) return value.toBase58();
    if (Buffer.isBuffer(value)) return value.toString("hex");
    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, SECRET_FIELD.test(field) ? "[REDACTED]" : redactGovernanceJournalValueV1(entry)]));
  }
  return value;
}
