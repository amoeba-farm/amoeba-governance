import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  MAX_ARTIFACT_BYTES_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  VERIFICATION_BITMAP_BYTES_V1,
  artifactChunkCount,
  artifactChunkCountAllowEmpty,
  artifactMerkleRoot,
} from "./artifactMerkleV1.js";
import {
  BufferVerificationStatusV1,
  CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
  GateStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  RELEASE1_ACCOUNT_VERSION_V1,
  STATE_CHECKPOINT_V1_DISCRIMINATOR,
  StateCheckpointPhaseV1,
  stateCheckpointDigestV1,
  stateCheckpointHardCombinedRootV1,
  type StateCheckpointV1,
} from "./release1.js";
import {
  MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  decodeExecuteUnfreezeV1,
  decodeExecuteUpgradeV1,
} from "./release1LoaderInstructions.js";
import {
  decodeConvertEmergencyFreezeV2,
  decodeFreezeProposalV2,
} from "./release1LifecycleInstructions.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID_V1,
  RECENT_BLOCKHASHES_SYSVAR_ID_V1,
  SYSTEM_PROGRAM_ID_V1,
} from "./operator.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";
import {
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveUpgradeableProgramdataAddress,
  deserializeProtocolGateV1,
} from "./v1.js";
import { deserializeControllerConfigV1 } from "./v1FixedAccounts.js";

// Receipt v3 has not been frozen or published externally. This explicit
// predeployment revision binds canonical external observations, a re-queryable
// frozen-history inventory, and content-addressed controller trust material.
// It does not pretend receipt-supplied observations are trustless enumeration.
export const GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA = "amoeba-governed-upgrade-receipt-v3-predeployment-r4" as const;
export const GOVERNED_UPGRADE_RECEIPT_V3_VERSION = 3 as const;
export const GOVERNED_UPGRADE_RECEIPT_V3_DIGEST_DOMAIN = Buffer.from(
  "AMOEBA_GOVERNED_UPGRADE_RECEIPT_V3",
  "ascii",
);
export const LOADER_V3_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const RENT_SYSVAR_ID = new PublicKey("SysvarRent111111111111111111111111111111111");
export const CLOCK_SYSVAR_ID = new PublicKey("SysvarC1ock11111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR_ID = new PublicKey("Sysvar1nstructions1111111111111111111111111");

const RECEIPT_PROGRAMDATA_HEADER_LENGTH = 45;
const MAX_RECEIPT_PROGRAMDATA_CAPACITY = 4 * 1024 * 1024;
const MAX_RECEIPT_EXTERNAL_ACCOUNTS = 4096;
const MAX_RECEIPT_EXTERNAL_INLINE_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_INLINE_ACCOUNT_DATA_BYTES = 256 * 1024;
const MAX_RECEIPT_ACCOUNT_DATA_LENGTH = 10 * 1024 * 1024;
const MAX_RECEIPT_HISTORY_TRANSACTIONS = 4096;
const MAX_RECEIPT_HISTORY_INSTRUCTIONS = 64;
const MAX_RECEIPT_HISTORY_ACCOUNTS = 128;
const MAX_RECEIPT_INSTRUCTION_DATA_BYTES = 16 * 1024;
const MAX_RECEIPT_TRUST_BLOB_BYTES = 4 * 1024 * 1024 + RECEIPT_PROGRAMDATA_HEADER_LENGTH;
const MAX_RECEIPT_TRUST_TOTAL_BYTES = 12 * 1024 * 1024;
const TOKEN_ACCOUNT_BASE_LENGTH = 165;
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_STATE_OFFSET = 108;
const ZERO_HASH = "0".repeat(64);

export const RECEIPT_FINALIZED_ACCOUNT_ROLES_V3 = Object.freeze([
  "controller-program",
  "controller-programdata",
  "controller-config",
  "policy",
  "protocol-gate",
  "proposal",
  "counterpart-proposal",
  "creation-council",
  "current-council",
  "prestate-checkpoint",
  "poststate-checkpoint",
  "buffer",
  "buffer-verification",
  "counterpart-buffer-verification",
  "programdata-verification",
  "emergency-freeze-observation",
  "target-program",
  "target-programdata",
] as const);
export type ReceiptFinalizedAccountRoleV3 = (typeof RECEIPT_FINALIZED_ACCOUNT_ROLES_V3)[number];

export interface ReceiptAccountMetaV3 {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface ReceiptInstructionV3 {
  kind: "durable-nonce-advance" | "compute-unit-limit" | "compute-unit-price" | "controller-execute-upgrade";
  programId: string;
  dataHex: string;
  accounts: readonly ReceiptAccountMetaV3[];
}

export interface ReceiptLoaderUpgradeCpiV3 {
  kind: "loader-upgrade";
  programId: string;
  dataHex: string;
  accounts: readonly ReceiptAccountMetaV3[];
}

export interface ReceiptIdentitiesV3 {
  clusterDomainHex: string;
  controllerProgram: string;
  controllerProgramdata: string;
  controllerConfig: string;
  policy: string;
  protocolGate: string;
  proposal: string;
  counterpartProposal: string;
  creationCouncil: string;
  council: string;
  targetProgram: string;
  targetProgramdata: string;
  authorityPda: string;
  upgradeableLoader: string;
  canonicalSpillTreasury: string;
  payer: string;
  buffer: string;
  bufferVerification: string;
  counterpartBufferVerification: string;
  programdataVerification: string;
  prestateCheckpoint: string;
  poststateCheckpoint: string;
  emergencyFreezeObservation: string;
}

export interface ReceiptGovernanceV3 {
  proposalDigest: string;
  counterpartProposalDigest: string;
  proposalClass: ProposalClassV1;
  policyVersion: string;
  policyHash: string;
  routineDelaySlots: string;
  majorDelaySlots: string;
  rollbackDelaySlots: string;
  councilReviewSlots: string;
  proposalExpirySlots: string;
  creationCouncilVersion: string;
  creationCouncilHash: string;
  currentCouncilVersion: string;
  currentCouncilHash: string;
  proposalApprovalBitset: number;
  proposalApprovalCount: number;
  poststateApprovalBitset: number;
  poststateApprovalCount: number;
  unfreezeApprovalBitset: number;
  unfreezeApprovalCount: number;
  proposalTargetNonce: string;
  configTargetNonceAfterFreeze: string;
  freezeTransition: "ordinary" | "emergency-conversion";
  creationGateStatus: GateStatusV1;
  creationGateEpoch: string;
  frozenGateEpoch: string;
  completedGateEpoch: string;
  creationSlot: string;
  reviewStartSlot: string;
  reviewEndSlot: string;
  notBeforeSlot: string;
  expirySlot: string;
  firstApprovalSlot: string;
  councilApprovedSlot: string;
  governanceSatisfiedSlot: string;
  queuedSlot: string;
  freezeSlot: string;
  extensionSlot: string;
  upgradeSlot: string;
  programdataVerifiedSlot: string;
  poststateAcceptedSlot: string;
  unfreezeApprovedSlot: string;
  unfreezeSlot: string;
  preProgramdataSlot: string;
  preProgramdataCapacity: string;
  preRawProgramdataHash: string;
  transitions: readonly string[];
}

export interface ReceiptBufferV3 {
  initialOwner: string;
  initialUploaderAuthority: string;
  finalAuthority: string;
  sealedBufferHeaderHash: string;
  adoptedSlot: string;
  verificationFinalizedSlot: string;
  sealedThroughSlot: string;
  artifactLength: string;
  artifactSha256: string;
  artifactChunkMerkleRoot: string;
  chunkSize: number;
  chunkCount: number;
  verifiedChunkBitmapHex: string;
  verifiedChunkCount: number;
  status: "verified";
  result: "consumed-by-upgrade" | "retained-controller-owned" | "closed-to-canonical-treasury";
  artifactBytesBase64: string;
}

export interface ReceiptProgramDataV3 {
  owner: string;
  deployedSlot: string;
  capacity: string;
  authority: string;
  artifactLength: string;
  payloadSha256: string;
  artifactChunkMerkleRoot: string;
  rawProgramdataSha256: string;
  rawProgramdataBytesBase64: string;
  verifiedPayloadChunkBitmapHex: string;
  verifiedPayloadChunkCount: number;
  verifiedTailChunkBitmapHex: string;
  verifiedTailChunkCount: number;
  zeroTailRequired: true;
  zeroTailVerified: true;
  verificationFinalizedSlot: string;
}

export interface ReceiptDonationDriftV3 {
  account: string;
  owner: string;
  assetKind: "lamports" | "token";
  tokenProgram: string | null;
  mint: string | null;
  authority: string | null;
  preAtoms: string;
  postAtoms: string;
  positiveDeltaAtoms: string;
}

export interface ReceiptFinalizedObservationContextV3 {
  commitment: "finalized";
  clusterDomainHex: string;
  slot: string;
  blockHash: string;
  blockTimeUnix: string;
}

export interface ReceiptExternalAccountObservationV3 {
  account: string;
  owner: string;
  executable: boolean;
  lamports: string;
  dataLength: number;
  dataSha256: string;
  dataBase64: string | null;
  assetKind: "lamports" | "token";
  tokenProgram: string | null;
  mint: string | null;
  authority: string | null;
  tokenState: "initialized" | "frozen" | null;
  rawTokenAmount: string | null;
  normalizedSemanticSha256: string;
}

export interface ReceiptExternalObservationSetV3 {
  context: ReceiptFinalizedObservationContextV3;
  accounts: readonly ReceiptExternalAccountObservationV3[];
}

export interface ReceiptCheckpointV3 {
  checkpoint: string;
  phase: "prestate" | "poststate";
  subjectDigest: string;
  finalizedObservationSlot: string;
  gateEpoch: string;
  targetProgramdataSlot: string;
  targetPayloadCommitment: string;
  targetRawProgramdataCommitment: string;
  targetCapacity: string;
  programOwnedStateRoot: string;
  programOwnedStateCount: string;
  logicalCompressedStateRoot: string;
  logicalCompressedStateCount: string;
  semanticCustodyAccountingRoot: string;
  hardCombinedRoot: string;
  externalMetadataObservationRoot: string;
  externalRawBalanceObservationRoot: string;
  schemaIdentifier: string;
  admittedPositiveDonationRoot: string;
  admittedPositiveDonationCount: string;
  forbiddenDriftCount: number;
  approvalCouncilVersion: string;
  approvalCouncilHash: string;
  checkpointDigest: string;
  approvalBitset: number;
  approvalCount: number;
  accepted: true;
  finalizedSlot: string;
}

export interface ReceiptStateEvidenceV3 {
  prestate: ReceiptCheckpointV3;
  poststate: ReceiptCheckpointV3;
  externalPrestate: ReceiptExternalObservationSetV3;
  externalPoststate: ReceiptExternalObservationSetV3;
}

export interface ReceiptHistoryInstructionV3 {
  programId: string;
  dataHex: string;
  accounts: readonly ReceiptAccountMetaV3[];
}

export interface ReceiptHistoryInnerInstructionGroupV3 {
  topLevelInstructionIndex: number;
  instructions: readonly ReceiptHistoryInstructionV3[];
}

export interface ReceiptFrozenHistoryTransactionV3 {
  slot: string;
  blockHash: string;
  blockTimeUnix: string;
  transactionIndex: number;
  signatureHex: string;
  messageSha256: string;
  metaSha256: string;
  status: "succeeded" | "failed";
  errorSha256: string;
  topLevelInstructions: readonly ReceiptHistoryInstructionV3[];
  innerInstructionGroups: readonly ReceiptHistoryInnerInstructionGroupV3[];
}

export interface ReceiptFrozenHistoryQueryV3 {
  commitment: "finalized";
  clusterDomainHex: string;
  startSlot: string;
  endSlot: string;
  matchMode: "any-account-key";
  includeFailed: true;
  addresses: readonly string[];
  queryIdentity: string;
}

export interface ReceiptFrozenHistoryV3 {
  query: ReceiptFrozenHistoryQueryV3;
  transactions: readonly ReceiptFrozenHistoryTransactionV3[];
  inventoryRoot: string;
}

export interface ReceiptFinalizedHistoryReadV3 {
  clusterDomainHex: string;
  startSlot: string;
  endSlot: string;
  transactions: readonly ReceiptFrozenHistoryTransactionV3[];
}

export interface ReceiptFinalizedAccountSnapshotV3 {
  role: ReceiptFinalizedAccountRoleV3;
  pubkey: string;
  exists: boolean;
  owner: string | null;
  executable: boolean | null;
  lamports: string | null;
  dataLength: number;
  dataSha256: string;
  dataBase64: string | null;
}

export interface ReceiptFinalizedAccountQueryV3 {
  context: ReceiptFinalizedObservationContextV3;
  accounts: readonly { role: ReceiptFinalizedAccountRoleV3; pubkey: string }[];
  queryIdentity: string;
}

export interface ReceiptFinalizedAccountInventoryV3 {
  query: ReceiptFinalizedAccountQueryV3;
  snapshots: readonly ReceiptFinalizedAccountSnapshotV3[];
  inventoryRoot: string;
}

export interface ReceiptFinalizedAccountReadV3 {
  context: ReceiptFinalizedObservationContextV3;
  snapshots: readonly ReceiptFinalizedAccountSnapshotV3[];
}

export interface ReceiptOldAuthorityRejectionQueryV3 {
  commitment: "finalized";
  clusterDomainHex: string;
  slot: string;
  signatureHex: string;
  targetProgram: string;
  targetProgramdata: string;
  controllerAuthority: string;
  oldAuthority: string;
  attemptedBuffer: string;
  spillTreasury: string;
  queryIdentity: string;
}

export interface ReceiptOldAuthorityRejectionEvidenceV3 {
  query: ReceiptOldAuthorityRejectionQueryV3;
  programdataAuthority: string;
  transaction: ReceiptFrozenHistoryTransactionV3;
  deterministicIdentity: string;
}

export interface ReceiptOldAuthorityRejectionReadV3 {
  clusterDomainHex: string;
  slot: string;
  programdataAuthority: string;
  transaction: ReceiptFrozenHistoryTransactionV3;
}

export interface ReceiptFinalizedSourceReaderV3 {
  readFinalizedFrozenHistory(query: Readonly<ReceiptFrozenHistoryQueryV3>): Promise<ReceiptFinalizedHistoryReadV3>;
  readFinalizedAccountSnapshots(query: Readonly<ReceiptFinalizedAccountQueryV3>): Promise<ReceiptFinalizedAccountReadV3>;
  readFinalizedOldAuthorityRejection(query: Readonly<ReceiptOldAuthorityRejectionQueryV3>): Promise<ReceiptOldAuthorityRejectionReadV3>;
}

export type ReceiptFinalizedHistoryReaderV3 = ReceiptFinalizedSourceReaderV3;

export interface ReceiptContentAddressedBlobV3 {
  sha256: string;
  bytesBase64: string;
}

export interface ReceiptControllerProgramdataEvidenceV3 {
  owner: string;
  deployedSlot: string;
  capacity: string;
  authority: string | null;
  zeroTailRequired: true;
  rawProgramdata: ReceiptContentAddressedBlobV3;
}

export interface ReceiptControllerTrustRootV3 {
  sourceCommit: ReceiptContentAddressedBlobV3;
  sourceTree: ReceiptContentAddressedBlobV3;
  abi: ReceiptContentAddressedBlobV3;
  buildInputInventory: ReceiptContentAddressedBlobV3;
  controllerArtifact: ReceiptContentAddressedBlobV3;
  controllerProgramOwner: string;
  controllerProgramAccount: ReceiptContentAddressedBlobV3;
  controllerProgramdata: ReceiptControllerProgramdataEvidenceV3;
  initializationStateOwner: string;
  initializationState: ReceiptContentAddressedBlobV3;
  initialized: true;
  tokenGovernanceEnabled: false;
  controllerImmutable: boolean;
  immutabilityPlan: ReceiptContentAddressedBlobV3;
  productionIdentityVerified: boolean;
}

export interface ReceiptHandoffEvidenceV3 {
  performed: boolean;
  simulated: boolean;
  authorityBefore: string;
  authorityAfter: string;
  oldAuthority: string;
  oldAuthorityRejection: ReceiptOldAuthorityRejectionEvidenceV3;
}

export interface GovernedUpgradeReceiptV3Material {
  schema: typeof GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA;
  version: typeof GOVERNED_UPGRADE_RECEIPT_V3_VERSION;
  production: boolean;
  identities: ReceiptIdentitiesV3;
  topLevelEnvelope: readonly ReceiptInstructionV3[];
  innerCpis: readonly ReceiptLoaderUpgradeCpiV3[];
  governance: ReceiptGovernanceV3;
  buffer: ReceiptBufferV3;
  programdata: ReceiptProgramDataV3;
  state: ReceiptStateEvidenceV3;
  frozenHistory: ReceiptFrozenHistoryV3;
  finalizedAccounts: ReceiptFinalizedAccountInventoryV3;
  controllerTrustRoot: ReceiptControllerTrustRootV3;
  handoff: ReceiptHandoffEvidenceV3;
}

export interface GovernedUpgradeReceiptV3 extends GovernedUpgradeReceiptV3Material {
  receiptDigest: string;
}

export interface GovernedUpgradeReceiptV3Verification {
  valid: true;
  receiptDigest: string;
  artifactSha256: string;
  rawProgramdataSha256: string;
  admittedDonationCount: number;
  finalizedSourceVerification: "receipt-evidence-only" | "finalized-source-requeried";
}

export class GovernedUpgradeReceiptV3VerificationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "GovernedUpgradeReceiptV3VerificationError";
  }
}

function fail(path: string, message: string): never {
  throw new GovernedUpgradeReceiptV3VerificationError(path, message);
}

function assertExactObjectKeys(value: unknown, expected: readonly string[], path: string): void {
  if (value === null || Array.isArray(value) || typeof value !== "object") fail(path, "must be an object");
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((field, index) => field !== canonical[index])) fail(path, "contains missing or unknown schema fields");
}

function canonicalJson(value: unknown, path = "receipt"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(path, "JSON numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([field, entry]) => `${JSON.stringify(field)}:${canonicalJson(entry, `${path}.${field}`)}`).join(",")}}`;
  }
  return fail(path, "value is not canonical JSON");
}

function sha256Hex(...parts: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

export function governedUpgradeReceiptDigestV3(material: GovernedUpgradeReceiptV3Material): string {
  return sha256Hex(GOVERNED_UPGRADE_RECEIPT_V3_DIGEST_DOMAIN, Buffer.from(canonicalJson(material), "utf8"));
}

export function finalizeGovernedUpgradeReceiptV3(
  material: GovernedUpgradeReceiptV3Material,
): GovernedUpgradeReceiptV3 {
  return { ...material, receiptDigest: governedUpgradeReceiptDigestV3(material) };
}

function hash32(value: unknown, path: string): Buffer {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(path, "must be lowercase 32-byte hex");
  return Buffer.from(value, "hex");
}

function pubkey(value: unknown, path: string): PublicKey {
  if (typeof value !== "string") fail(path, "must be a base58 public key");
  try {
    const result = new PublicKey(value);
    if (result.toBase58() !== value) fail(path, "must use canonical base58");
    return result;
  } catch (error) {
    if (error instanceof GovernedUpgradeReceiptV3VerificationError) throw error;
    return fail(path, "must be a base58 public key");
  }
}

function u64(value: unknown, path: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) fail(path, "must be a canonical decimal u64 string");
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) fail(path, "exceeds u64");
  return parsed;
}

function checkedAddU64(left: bigint, right: bigint, path: string): bigint {
  const value = left + right;
  if (value > 0xffff_ffff_ffff_ffffn) fail(path, "u64 addition overflows");
  return value;
}

function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer in ${min}..${max}`);
  return value;
}

function bytesFromHex(value: unknown, path: string, exactLength?: number): Buffer {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/u.test(value)) fail(path, "must be canonical lowercase even-length hex");
  if (exactLength !== undefined && value.length !== exactLength * 2) fail(path, `must contain exactly ${exactLength} bytes`);
  const bytes = Buffer.from(value, "hex");
  return bytes;
}

function bytesFromBase64(value: unknown, path: string, maxLength: number): Buffer {
  if (typeof value !== "string") fail(path, "must be base64");
  const maximumEncodedLength = Math.ceil(maxLength / 3) * 4;
  if (value.length > maximumEncodedLength) fail(path, "exceeds receipt byte limit");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(path, "must use canonical base64");
  if (bytes.length > maxLength) fail(path, "exceeds receipt byte limit");
  return bytes;
}

export function receiptContentAddressedBlobV3(bytes: Uint8Array): ReceiptContentAddressedBlobV3 {
  const material = Buffer.from(bytes);
  if (material.length > MAX_RECEIPT_TRUST_BLOB_BYTES) throw new RangeError("receipt trust material exceeds the per-blob bound");
  return { sha256: sha256Hex(material), bytesBase64: material.toString("base64") };
}

function comparePubkeys(left: string, right: string): number {
  return Buffer.compare(new PublicKey(left).toBuffer(), new PublicKey(right).toBuffer());
}

function validateFinalizedContext(
  context: ReceiptFinalizedObservationContextV3,
  clusterDomainHex: string,
  path: string,
): void {
  assertExactObjectKeys(context, ["commitment", "clusterDomainHex", "slot", "blockHash", "blockTimeUnix"], path);
  if (context.commitment !== "finalized") fail(`${path}.commitment`, "must be finalized");
  if (context.clusterDomainHex !== clusterDomainHex) fail(`${path}.clusterDomainHex`, "does not match the receipt cluster domain");
  hash32(context.clusterDomainHex, `${path}.clusterDomainHex`);
  u64(context.slot, `${path}.slot`);
  hash32(context.blockHash, `${path}.blockHash`);
  u64(context.blockTimeUnix, `${path}.blockTimeUnix`);
}

interface ValidatedExternalObservationV3 {
  readonly account: string;
  readonly observation: ReceiptExternalAccountObservationV3;
  readonly data: Buffer | null;
}

function validateExternalObservationSet(
  set: ReceiptExternalObservationSetV3,
  clusterDomainHex: string,
  path: string,
): readonly ValidatedExternalObservationV3[] {
  assertExactObjectKeys(set, ["context", "accounts"], path);
  validateFinalizedContext(set.context, clusterDomainHex, `${path}.context`);
  if (!Array.isArray(set.accounts) || set.accounts.length > MAX_RECEIPT_EXTERNAL_ACCOUNTS) fail(`${path}.accounts`, "exceeds the bounded external-account inventory");
  let inlineBytes = 0;
  let previous: string | null = null;
  const result: ValidatedExternalObservationV3[] = [];
  for (const [index, observation] of set.accounts.entries()) {
    const itemPath = `${path}.accounts[${index}]`;
    assertExactObjectKeys(observation, [
      "account", "owner", "executable", "lamports", "dataLength", "dataSha256", "dataBase64", "assetKind",
      "tokenProgram", "mint", "authority", "tokenState", "rawTokenAmount", "normalizedSemanticSha256",
    ], itemPath);
    const account = pubkey(observation.account, `${itemPath}.account`).toBase58();
    pubkey(observation.owner, `${itemPath}.owner`);
    if (previous !== null && comparePubkeys(previous, account) >= 0) fail(itemPath, "external observations must be strictly sorted by account bytes with no duplicates");
    previous = account;
    if (typeof observation.executable !== "boolean") fail(`${itemPath}.executable`, "must be a boolean");
    u64(observation.lamports, `${itemPath}.lamports`);
    const dataLength = integer(observation.dataLength, 0, MAX_RECEIPT_ACCOUNT_DATA_LENGTH, `${itemPath}.dataLength`);
    hash32(observation.dataSha256, `${itemPath}.dataSha256`);
    hash32(observation.normalizedSemanticSha256, `${itemPath}.normalizedSemanticSha256`);
    let data: Buffer | null = null;
    if (observation.dataBase64 !== null) {
      data = bytesFromBase64(observation.dataBase64, `${itemPath}.dataBase64`, MAX_RECEIPT_INLINE_ACCOUNT_DATA_BYTES);
      inlineBytes += data.length;
      if (data.length !== dataLength || sha256Hex(data) !== observation.dataSha256) fail(itemPath, "inline account data length or SHA-256 mismatch");
    }
    if (inlineBytes > MAX_RECEIPT_EXTERNAL_INLINE_BYTES) fail(`${path}.accounts`, "inline external-account evidence exceeds the total byte bound");
    if (observation.assetKind === "lamports") {
      if (
        observation.tokenProgram !== null || observation.mint !== null || observation.authority !== null ||
        observation.tokenState !== null || observation.rawTokenAmount !== null
      ) fail(itemPath, "lamport-only observation contains token fields");
      if (observation.normalizedSemanticSha256 !== observation.dataSha256) fail(itemPath, "lamport-only semantic hash must equal the exact data hash");
    } else if (observation.assetKind === "token") {
      if (data === null || data.length < TOKEN_ACCOUNT_BASE_LENGTH) fail(itemPath, "token observations must include the bounded raw account bytes");
      if (observation.executable) fail(itemPath, "token account cannot be executable");
      const tokenProgram = pubkey(observation.tokenProgram, `${itemPath}.tokenProgram`).toBase58();
      if (tokenProgram !== observation.owner) fail(itemPath, "token program must equal the exact account owner");
      const mint = pubkey(observation.mint, `${itemPath}.mint`);
      const authority = pubkey(observation.authority, `${itemPath}.authority`);
      if (!mint.equals(new PublicKey(data.subarray(0, 32))) || !authority.equals(new PublicKey(data.subarray(32, 64)))) fail(itemPath, "token mint or authority does not match raw token-account bytes");
      const amount = data.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET);
      if (u64(observation.rawTokenAmount, `${itemPath}.rawTokenAmount`) !== amount) fail(itemPath, "raw token amount does not match raw token-account bytes");
      const expectedState = data[TOKEN_ACCOUNT_STATE_OFFSET] === 1 ? "initialized" : data[TOKEN_ACCOUNT_STATE_OFFSET] === 2 ? "frozen" : null;
      if (expectedState === null || observation.tokenState !== expectedState) fail(itemPath, "token state is invalid or does not match raw token-account bytes");
      const normalized = Buffer.from(data);
      normalized.fill(0, TOKEN_ACCOUNT_AMOUNT_OFFSET, TOKEN_ACCOUNT_AMOUNT_OFFSET + 8);
      if (sha256Hex(normalized) !== observation.normalizedSemanticSha256) fail(itemPath, "normalized token-account semantic hash mismatch");
    } else {
      fail(`${itemPath}.assetKind`, "unknown external asset kind");
    }
    result.push({ account, observation, data });
  }
  return result;
}

function orderedLeafRoot(domain: string, leaves: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(domain, "ascii");
  const count = Buffer.alloc(4);
  count.writeUInt32LE(leaves.length);
  hash.update(count);
  for (const leaf of leaves) hash.update(Buffer.from(leaf, "hex"));
  return hash.digest("hex");
}

export function externalObservationRootsV3(
  set: ReceiptExternalObservationSetV3,
): { readonly metadataRoot: string; readonly rawBalanceRoot: string } {
  const validated = validateExternalObservationSet(set, set.context.clusterDomainHex, "externalObservations");
  const metadataLeaves = validated.map(({ observation }, index) => sha256Hex(
    Buffer.from("AMOEBA_EXTERNAL_METADATA_LEAF_V3", "ascii"),
    Buffer.from(canonicalJson({
      index,
      account: observation.account,
      owner: observation.owner,
      executable: observation.executable,
      dataLength: observation.dataLength,
      assetKind: observation.assetKind,
      tokenProgram: observation.tokenProgram,
      mint: observation.mint,
      authority: observation.authority,
      tokenState: observation.tokenState,
      normalizedSemanticSha256: observation.normalizedSemanticSha256,
    }, `externalObservations.accounts[${index}].metadata`), "utf8"),
  ));
  const rawLeaves = validated.map(({ observation }, index) => sha256Hex(
    Buffer.from("AMOEBA_EXTERNAL_BALANCE_LEAF_V3", "ascii"),
    Buffer.from(canonicalJson({
      index,
      account: observation.account,
      lamports: observation.lamports,
      rawTokenAmount: observation.rawTokenAmount,
      dataSha256: observation.dataSha256,
    }, `externalObservations.accounts[${index}].balance`), "utf8"),
  ));
  return {
    metadataRoot: orderedLeafRoot("AMOEBA_EXTERNAL_METADATA_ROOT_V3", metadataLeaves),
    rawBalanceRoot: orderedLeafRoot("AMOEBA_EXTERNAL_BALANCE_ROOT_V3", rawLeaves),
  };
}

export function deriveExternalDonationDriftV3(
  externalPrestate: ReceiptExternalObservationSetV3,
  externalPoststate: ReceiptExternalObservationSetV3,
): readonly ReceiptDonationDriftV3[] {
  if (externalPrestate.context.clusterDomainHex !== externalPoststate.context.clusterDomainHex) fail("externalObservations", "pre/post cluster domains differ");
  const preAccounts = validateExternalObservationSet(externalPrestate, externalPrestate.context.clusterDomainHex, "externalPrestate");
  const postAccounts = validateExternalObservationSet(externalPoststate, externalPrestate.context.clusterDomainHex, "externalPoststate");
  if (preAccounts.length !== postAccounts.length) fail("externalPoststate.accounts", "external account inventory has an omission or addition");
  const donations: ReceiptDonationDriftV3[] = [];
  for (let index = 0; index < preAccounts.length; index += 1) {
    const before = preAccounts[index]!.observation;
    const after = postAccounts[index]!.observation;
    const path = `externalPoststate.accounts[${index}]`;
    if (before.account !== after.account) fail(path, "external account inventory has an omission, addition, or reordering");
    for (const field of [
      "owner", "executable", "dataLength", "assetKind", "tokenProgram", "mint", "authority", "tokenState", "normalizedSemanticSha256",
    ] as const) {
      if (before[field] !== after[field]) fail(`${path}.${field}`, "external account identity or semantic state changed");
    }
    if (before.assetKind === "lamports" && before.dataSha256 !== after.dataSha256) fail(`${path}.dataSha256`, "non-token account data changed");
    const beforeLamports = u64(before.lamports, `externalPrestate.accounts[${index}].lamports`);
    const afterLamports = u64(after.lamports, `${path}.lamports`);
    if (afterLamports < beforeLamports) fail(`${path}.lamports`, "negative lamport delta is forbidden");
    if (afterLamports > beforeLamports) donations.push({
      account: before.account,
      owner: before.owner,
      assetKind: "lamports",
      tokenProgram: null,
      mint: null,
      authority: null,
      preAtoms: before.lamports,
      postAtoms: after.lamports,
      positiveDeltaAtoms: (afterLamports - beforeLamports).toString(),
    });
    if (before.assetKind === "token") {
      const beforeTokens = u64(before.rawTokenAmount, `externalPrestate.accounts[${index}].rawTokenAmount`);
      const afterTokens = u64(after.rawTokenAmount, `${path}.rawTokenAmount`);
      if (afterTokens < beforeTokens) fail(`${path}.rawTokenAmount`, "negative token delta is forbidden");
      if (afterTokens > beforeTokens) donations.push({
        account: before.account,
        owner: before.owner,
        assetKind: "token",
        tokenProgram: before.tokenProgram,
        mint: before.mint,
        authority: before.authority,
        preAtoms: before.rawTokenAmount!,
        postAtoms: after.rawTokenAmount!,
        positiveDeltaAtoms: (afterTokens - beforeTokens).toString(),
      });
    }
  }
  return donations;
}

export function externalDonationRootV3(donations: readonly ReceiptDonationDriftV3[]): string {
  return donationRoot(donations);
}

export function frozenHistoryQueryIdentityV3(
  query: Omit<ReceiptFrozenHistoryQueryV3, "queryIdentity">,
): string {
  return sha256Hex(
    Buffer.from("AMOEBA_FROZEN_HISTORY_QUERY_V3", "ascii"),
    Buffer.from(canonicalJson(query, "frozenHistory.query"), "utf8"),
  );
}

export function finalizeFrozenHistoryQueryV3(
  query: Omit<ReceiptFrozenHistoryQueryV3, "queryIdentity">,
): ReceiptFrozenHistoryQueryV3 {
  return { ...query, queryIdentity: frozenHistoryQueryIdentityV3(query) };
}

export function frozenHistoryInventoryRootV3(
  transactions: readonly ReceiptFrozenHistoryTransactionV3[],
): string {
  const leaves = transactions.map((transaction, index) => sha256Hex(
    Buffer.from("AMOEBA_FROZEN_HISTORY_TRANSACTION_V3", "ascii"),
    Buffer.from(canonicalJson({ index, transaction }, `frozenHistory.transactions[${index}]`), "utf8"),
  ));
  return orderedLeafRoot("AMOEBA_FROZEN_HISTORY_INVENTORY_V3", leaves);
}

export function finalizedAccountQueryIdentityV3(
  query: Omit<ReceiptFinalizedAccountQueryV3, "queryIdentity">,
): string {
  return sha256Hex(
    Buffer.from("AMOEBA_FINALIZED_ACCOUNT_QUERY_V3", "ascii"),
    Buffer.from(canonicalJson(query, "finalizedAccounts.query"), "utf8"),
  );
}

export function finalizeFinalizedAccountQueryV3(
  query: Omit<ReceiptFinalizedAccountQueryV3, "queryIdentity">,
): ReceiptFinalizedAccountQueryV3 {
  return { ...query, queryIdentity: finalizedAccountQueryIdentityV3(query) };
}

export function finalizedAccountInventoryRootV3(
  snapshots: readonly ReceiptFinalizedAccountSnapshotV3[],
): string {
  const leaves = snapshots.map((snapshot, index) => sha256Hex(
    Buffer.from("AMOEBA_FINALIZED_ACCOUNT_SNAPSHOT_V3", "ascii"),
    Buffer.from(canonicalJson({ index, snapshot }, `finalizedAccounts.snapshots[${index}]`), "utf8"),
  ));
  return orderedLeafRoot("AMOEBA_FINALIZED_ACCOUNT_INVENTORY_V3", leaves);
}

export function oldAuthorityRejectionQueryIdentityV3(
  query: Omit<ReceiptOldAuthorityRejectionQueryV3, "queryIdentity">,
): string {
  return sha256Hex(
    Buffer.from("AMOEBA_OLD_AUTHORITY_REJECTION_QUERY_V3", "ascii"),
    Buffer.from(canonicalJson(query, "handoff.oldAuthorityRejection.query"), "utf8"),
  );
}

export function finalizeOldAuthorityRejectionQueryV3(
  query: Omit<ReceiptOldAuthorityRejectionQueryV3, "queryIdentity">,
): ReceiptOldAuthorityRejectionQueryV3 {
  return { ...query, queryIdentity: oldAuthorityRejectionQueryIdentityV3(query) };
}

export function oldAuthorityRejectionIdentityV3(
  query: ReceiptOldAuthorityRejectionQueryV3,
  programdataAuthority: string,
  transaction: ReceiptFrozenHistoryTransactionV3,
): string {
  return sha256Hex(
    Buffer.from("AMOEBA_OLD_AUTHORITY_REJECTION_EVIDENCE_V3", "ascii"),
    Buffer.from(canonicalJson({ query, programdataAuthority, transaction }, "handoff.oldAuthorityRejection"), "utf8"),
  );
}

function popcount5(bitset: unknown, path: string): number {
  const bits = integer(bitset, 0, 0x1f, path);
  let count = 0;
  for (let index = 0; index < 5; index += 1) count += (bits >>> index) & 1;
  return count;
}

function assertApproval(bitset: number, count: number, path: string): void {
  const actual = popcount5(bitset, `${path}.bitset`);
  if (integer(count, 0, 5, `${path}.count`) !== actual) fail(path, "approval count does not match the five-seat bitset");
  if (actual < 3) fail(path, "Release 1 requires equal-seat 3-of-5 approval");
}

function completeBitmapHex(value: unknown, count: number, path: string): void {
  const actual = bytesFromHex(value, path, VERIFICATION_BITMAP_BYTES_V1);
  const expected = Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1);
  for (let index = 0; index < count; index += 1) expected[Math.floor(index / 8)]! |= 1 << (index % 8);
  if (!actual.equals(expected)) fail(path, "bitmap is not the exact complete canonical bitmap");
}

function exactMeta(
  actual: ReceiptAccountMetaV3,
  expectedKey: string,
  signer: boolean,
  writable: boolean,
  path: string,
): void {
  if (pubkey(actual?.pubkey, `${path}.pubkey`).toBase58() !== expectedKey || actual.isSigner !== signer || actual.isWritable !== writable) {
    fail(path, "account identity or privilege mismatch");
  }
}

function validateEnvelope(receipt: GovernedUpgradeReceiptV3): ReturnType<typeof decodeExecuteUpgradeV1> {
  const instructions = receipt.topLevelEnvelope;
  if (!Array.isArray(instructions) || instructions.length < 3 || instructions.length > 4) fail("topLevelEnvelope", "must contain optional nonce, limit, price, and one controller instruction");
  const controller = instructions.at(-1)!;
  if (controller.kind !== "controller-execute-upgrade") fail("topLevelEnvelope", "controller ExecuteUpgradeV1 must be last");
  if (!pubkey(controller.programId, "topLevelEnvelope.controller.programId").equals(pubkey(receipt.identities.controllerProgram, "identities.controllerProgram"))) fail("topLevelEnvelope.controller.programId", "wrong controller program");
  const controllerData = bytesFromHex(controller.dataHex, "topLevelEnvelope.controller.dataHex");
  let decoded: ReturnType<typeof decodeExecuteUpgradeV1>;
  try { decoded = decodeExecuteUpgradeV1(controllerData); } catch { return fail("topLevelEnvelope.controller.dataHex", "is not the strict fixed ExecuteUpgradeV1 codec"); }
  const envelope = decoded.envelope;
  const hasNonce = envelope.durableNonceAccount.present;
  if (hasNonce !== envelope.durableNonceAuthority.present || instructions.length !== (hasNonce ? 4 : 3)) fail("topLevelEnvelope", "does not match the instruction's nonce expectation");
  let cursor = 0;
  if (hasNonce) {
    const nonce = instructions[cursor++]!;
    if (nonce.kind !== "durable-nonce-advance" || !pubkey(nonce.programId, "topLevelEnvelope.nonce.programId").equals(SYSTEM_PROGRAM_ID_V1) || !bytesFromHex(nonce.dataHex, "topLevelEnvelope.nonce.dataHex").equals(Buffer.from([4, 0, 0, 0])) || nonce.accounts.length !== 3) fail("topLevelEnvelope.nonce", "is not the exact durable nonce advance");
    exactMeta(nonce.accounts[0]!, envelope.durableNonceAccount.value.toBase58(), false, true, "topLevelEnvelope.nonce.accounts[0]");
    exactMeta(nonce.accounts[1]!, RECENT_BLOCKHASHES_SYSVAR_ID_V1.toBase58(), false, false, "topLevelEnvelope.nonce.accounts[1]");
    exactMeta(nonce.accounts[2]!, envelope.durableNonceAuthority.value.toBase58(), true, false, "topLevelEnvelope.nonce.accounts[2]");
  }
  const limit = instructions[cursor++]!;
  const expectedLimit = Buffer.alloc(5); expectedLimit[0] = 2; expectedLimit.writeUInt32LE(envelope.computeUnitLimit, 1);
  if (limit.kind !== "compute-unit-limit" || !pubkey(limit.programId, "topLevelEnvelope.limit.programId").equals(COMPUTE_BUDGET_PROGRAM_ID_V1) || limit.accounts.length !== 0 || !bytesFromHex(limit.dataHex, "topLevelEnvelope.limit.dataHex").equals(expectedLimit)) fail("topLevelEnvelope.limit", "does not exactly match the committed compute-unit limit");
  const price = instructions[cursor++]!;
  const expectedPrice = Buffer.alloc(9); expectedPrice[0] = 3; expectedPrice.writeBigUInt64LE(envelope.computeUnitPriceMicroLamports, 1);
  if (price.kind !== "compute-unit-price" || !pubkey(price.programId, "topLevelEnvelope.price.programId").equals(COMPUTE_BUDGET_PROGRAM_ID_V1) || price.accounts.length !== 0 || !bytesFromHex(price.dataHex, "topLevelEnvelope.price.dataHex").equals(expectedPrice)) fail("topLevelEnvelope.price", "does not exactly match the committed compute-unit price");

  const i = receipt.identities;
  const exactControllerAccounts: readonly [string, boolean, boolean][] = [
    [i.payer, true, true], [i.controllerConfig, false, false], [i.policy, false, false], [i.protocolGate, false, false],
    [i.proposal, false, true], [i.counterpartProposal, false, false], [i.counterpartBufferVerification, false, false],
    [i.prestateCheckpoint, false, false], [i.bufferVerification, false, true], [i.programdataVerification, false, true],
    [i.targetProgramdata, false, true], [i.targetProgram, false, true], [i.buffer, false, true], [i.canonicalSpillTreasury, false, true],
    [RENT_SYSVAR_ID.toBase58(), false, false], [CLOCK_SYSVAR_ID.toBase58(), false, false], [i.authorityPda, false, false],
    [i.upgradeableLoader, false, false], [SYSTEM_PROGRAM_ID_V1.toBase58(), false, false], [INSTRUCTIONS_SYSVAR_ID.toBase58(), false, false],
  ];
  if (controller.accounts.length !== exactControllerAccounts.length) fail("topLevelEnvelope.controller.accounts", "wrong ExecuteUpgradeV1 account count");
  exactControllerAccounts.forEach(([key, signer, writable], index) => exactMeta(controller.accounts[index]!, key, signer, writable, `topLevelEnvelope.controller.accounts[${index}]`));
  return decoded;
}

function validateInnerCpi(receipt: GovernedUpgradeReceiptV3): void {
  if (!Array.isArray(receipt.innerCpis) || receipt.innerCpis.length !== 1) fail("innerCpis", "must contain exactly one inner CPI");
  const cpi = receipt.innerCpis[0]!;
  if (cpi.kind !== "loader-upgrade" || !pubkey(cpi.programId, "innerCpis[0].programId").equals(LOADER_V3_PROGRAM_ID) || !bytesFromHex(cpi.dataHex, "innerCpis[0].dataHex").equals(Buffer.from([3, 0, 0, 0]))) fail("innerCpis[0]", "must be one exact Upgradeable Loader Upgrade instruction");
  const i = receipt.identities;
  const expected: readonly [string, boolean, boolean][] = [
    [i.targetProgramdata, false, true], [i.targetProgram, false, true], [i.buffer, false, true], [i.canonicalSpillTreasury, false, true],
    [RENT_SYSVAR_ID.toBase58(), false, false], [CLOCK_SYSVAR_ID.toBase58(), false, false], [i.authorityPda, true, false],
  ];
  if (cpi.accounts.length !== expected.length) fail("innerCpis[0].accounts", "wrong Loader Upgrade account count");
  expected.forEach(([key, signer, writable], index) => exactMeta(cpi.accounts[index]!, key, signer, writable, `innerCpis[0].accounts[${index}]`));
}

function validateGovernance(receipt: GovernedUpgradeReceiptV3, decoded: ReturnType<typeof decodeExecuteUpgradeV1>): void {
  const g = receipt.governance;
  hash32(g.proposalDigest, "governance.proposalDigest"); hash32(g.counterpartProposalDigest, "governance.counterpartProposalDigest"); hash32(g.policyHash, "governance.policyHash");
  hash32(g.creationCouncilHash, "governance.creationCouncilHash"); hash32(g.currentCouncilHash, "governance.currentCouncilHash");
  hash32(g.preRawProgramdataHash, "governance.preRawProgramdataHash");
  assertApproval(g.proposalApprovalBitset, g.proposalApprovalCount, "governance.proposalApproval");
  assertApproval(g.poststateApprovalBitset, g.poststateApprovalCount, "governance.poststateApproval");
  assertApproval(g.unfreezeApprovalBitset, g.unfreezeApprovalCount, "governance.unfreezeApproval");
  const targetNonce = u64(g.proposalTargetNonce, "governance.proposalTargetNonce");
  const consumedNonce = u64(g.configTargetNonceAfterFreeze, "governance.configTargetNonceAfterFreeze");
  if (targetNonce === 0xffff_ffff_ffff_ffffn || consumedNonce !== targetNonce + 1n) fail("governance.configTargetNonceAfterFreeze", "must consume exactly one proposal target nonce");
  const creationEpoch = u64(g.creationGateEpoch, "governance.creationGateEpoch");
  const frozenEpoch = u64(g.frozenGateEpoch, "governance.frozenGateEpoch");
  const completedEpoch = u64(g.completedGateEpoch, "governance.completedGateEpoch");
  const creationGateStatus = integer(g.creationGateStatus, GateStatusV1.Active, GateStatusV1.EmergencyFrozen, "governance.creationGateStatus");
  if (g.freezeTransition === "ordinary") {
    if (creationGateStatus !== GateStatusV1.Active) fail("governance.freezeTransition", "ordinary freeze requires an Active creation gate");
  } else if (g.freezeTransition === "emergency-conversion") {
    if (creationGateStatus !== GateStatusV1.EmergencyFrozen) fail("governance.freezeTransition", "emergency conversion requires an EmergencyFrozen creation gate");
  } else {
    fail("governance.freezeTransition", "unknown freeze transition");
  }
  if (
    frozenEpoch !== checkedAddU64(creationEpoch, 1n, "governance.frozenGateEpoch") ||
    completedEpoch !== checkedAddU64(frozenEpoch, 1n, "governance.completedGateEpoch")
  ) fail("governance", "gate epochs do not prove one exact freeze/conversion increment and one separate unfreeze increment");
  const proposalClass = integer(g.proposalClass, ProposalClassV1.RoutineUpgrade, ProposalClassV1.ConstitutionalChange, "governance.proposalClass");
  const routineDelay = u64(g.routineDelaySlots, "governance.routineDelaySlots");
  const majorDelay = u64(g.majorDelaySlots, "governance.majorDelaySlots");
  const rollbackDelay = u64(g.rollbackDelaySlots, "governance.rollbackDelaySlots");
  const councilReview = u64(g.councilReviewSlots, "governance.councilReviewSlots");
  const proposalExpiry = u64(g.proposalExpirySlots, "governance.proposalExpirySlots");
  if ([routineDelay, majorDelay, rollbackDelay, councilReview, proposalExpiry].some((value) => value === 0n)) fail("governance", "committed timing policy must be nonzero");
  const classDelay = proposalClass === ProposalClassV1.EmergencyRollback
    ? rollbackDelay
    : proposalClass === ProposalClassV1.RoutineUpgrade
      ? routineDelay
      : majorDelay;
  const creation = u64(g.creationSlot, "governance.creationSlot");
  const reviewStart = u64(g.reviewStartSlot, "governance.reviewStartSlot");
  const reviewEnd = u64(g.reviewEndSlot, "governance.reviewEndSlot");
  const notBefore = u64(g.notBeforeSlot, "governance.notBeforeSlot");
  const expiry = u64(g.expirySlot, "governance.expirySlot");
  const firstApproval = u64(g.firstApprovalSlot, "governance.firstApprovalSlot");
  const councilApproved = u64(g.councilApprovedSlot, "governance.councilApprovedSlot");
  const governanceSatisfied = u64(g.governanceSatisfiedSlot, "governance.governanceSatisfiedSlot");
  const queued = u64(g.queuedSlot, "governance.queuedSlot");
  const freeze = u64(g.freezeSlot, "governance.freezeSlot");
  const extension = u64(g.extensionSlot, "governance.extensionSlot");
  const upgrade = u64(g.upgradeSlot, "governance.upgradeSlot");
  const verified = u64(g.programdataVerifiedSlot, "governance.programdataVerifiedSlot");
  const poststate = u64(g.poststateAcceptedSlot, "governance.poststateAcceptedSlot");
  const approved = u64(g.unfreezeApprovedSlot, "governance.unfreezeApprovedSlot");
  const unfreeze = u64(g.unfreezeSlot, "governance.unfreezeSlot");
  if (
    reviewStart !== checkedAddU64(creation, 1n, "governance.reviewStartSlot") ||
    reviewEnd !== checkedAddU64(reviewStart, councilReview, "governance.reviewEndSlot") ||
    notBefore !== checkedAddU64(reviewEnd, classDelay, "governance.notBeforeSlot") ||
    expiry !== checkedAddU64(creation, proposalExpiry, "governance.expirySlot")
  ) fail("governance", "proposal timing does not match the committed class-selected policy");
  if (!(
    firstApproval >= reviewStart && firstApproval <= reviewEnd &&
    councilApproved >= firstApproval && councilApproved <= reviewEnd &&
    governanceSatisfied >= councilApproved && governanceSatisfied < expiry &&
    queued >= governanceSatisfied && queued < expiry
  )) fail("governance", "approval, governance-satisfaction, or queue timing is invalid");
  if (!(reviewEnd < expiry && notBefore < expiry && freeze >= queued && freeze >= notBefore && freeze < expiry && upgrade >= freeze && upgrade < expiry && verified >= upgrade && poststate >= verified && approved >= poststate && unfreeze >= approved)) fail("governance", "timing or frozen lifecycle ordering is invalid");
  if (extension !== 0n && !(extension >= freeze && extension < upgrade)) fail("governance.extensionSlot", "extension must be in a separate strictly earlier frozen slot");
  const executionRunway = extension === 0n ? 1n : 2n;
  const freezeHorizon = checkedAddU64(
    freeze,
    checkedAddU64(councilReview, executionRunway, "governance.freezeRunway"),
    "governance.freezeRunway",
  );
  if (freezeHorizon >= expiry) fail("governance.freezeSlot", "freeze did not retain the committed checkpoint and execution runway");
  const base = ["Draft", "BufferAdopted", "BufferVerified", "CouncilApproved", "GovernanceSatisfied", "Timelocked", "Frozen"];
  const tail = ["UpgradeExecuted", "ProgramDataVerified", "PoststateAccepted", "UnfreezeApproved", "Completed"];
  const expected = extension === 0n ? [...base, ...tail] : [...base, "Extended", ...tail];
  if (!Array.isArray(g.transitions) || g.transitions.length !== expected.length || g.transitions.some((entry, index) => entry !== expected[index])) fail("governance.transitions", "does not contain the exact complete Release 1 state sequence");
  const expectedState = extension === 0n ? ProposalStateV2.Frozen : ProposalStateV2.Extended;
  if (
    !decoded.expected.expectedProposalDigest.equals(hash32(g.proposalDigest, "governance.proposalDigest")) ||
    decoded.expected.expectedPolicyVersion !== u64(g.policyVersion, "governance.policyVersion") ||
    !decoded.expected.expectedPolicyHash.equals(hash32(g.policyHash, "governance.policyHash")) ||
    decoded.expected.expectedCouncilVersion !== u64(g.creationCouncilVersion, "governance.creationCouncilVersion") ||
    !decoded.expected.expectedCouncilHash.equals(hash32(g.creationCouncilHash, "governance.creationCouncilHash")) ||
    decoded.expected.expectedGateStatus !== GateStatusV1.FrozenForUpgrade ||
    decoded.expected.expectedGateEpoch !== frozenEpoch ||
    decoded.expected.expectedTargetNonce !== consumedNonce ||
    decoded.expected.expectedState !== expectedState ||
    decoded.expected.expectedReviewStartSlot !== reviewStart ||
    decoded.expected.expectedReviewEndSlot !== reviewEnd ||
    decoded.expected.expectedNotBeforeSlot !== notBefore ||
    decoded.expected.expectedExpirySlot !== expiry ||
    !decoded.expectedPrestateCheckpointDigest.equals(hash32(receipt.state.prestate.checkpointDigest, "state.prestate.checkpointDigest")) ||
    !decoded.expectedCurrentRawProgramdataHash.equals(hash32(g.preRawProgramdataHash, "governance.preRawProgramdataHash")) ||
    !decoded.expectedSealedBufferHeaderHash.equals(hash32(receipt.buffer.sealedBufferHeaderHash, "buffer.sealedBufferHeaderHash")) ||
    !decoded.expectedCounterpartProposalDigest.equals(hash32(g.counterpartProposalDigest, "governance.counterpartProposalDigest")) ||
    decoded.expectedProgramdataSlot !== u64(g.preProgramdataSlot, "governance.preProgramdataSlot") ||
    decoded.expectedCapacity !== u64(g.preProgramdataCapacity, "governance.preProgramdataCapacity") ||
    decoded.expectedCapacity !== u64(receipt.programdata.capacity, "programdata.capacity") ||
    decoded.expectedVerifiedChunkCount !== receipt.buffer.verifiedChunkCount ||
    decoded.expectedBufferVerificationStatus !== BufferVerificationStatusV1.Verified ||
    decoded.expectedCounterpartBufferVerificationStatus !== BufferVerificationStatusV1.Verified
  ) fail("topLevelEnvelope.controller", "embedded ExecuteUpgradeV1 expectations do not match governance evidence");
}

function validateBuffer(receipt: GovernedUpgradeReceiptV3): Buffer {
  const b = receipt.buffer;
  if (!pubkey(b.initialOwner, "buffer.initialOwner").equals(LOADER_V3_PROGRAM_ID) || !pubkey(b.finalAuthority, "buffer.finalAuthority").equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda"))) fail("buffer", "loader ownership or final controller authority mismatch");
  if (pubkey(b.initialUploaderAuthority, "buffer.initialUploaderAuthority").equals(PublicKey.default)) fail("buffer.initialUploaderAuthority", "must be a nondefault uploader authority observation");
  const artifactLength = u64(b.artifactLength, "buffer.artifactLength");
  if (artifactLength === 0n || artifactLength > BigInt(MAX_ARTIFACT_BYTES_V1)) fail("buffer.artifactLength", "outside the Release 1 artifact bound");
  if (b.chunkSize !== RELEASE1_ARTIFACT_CHUNK_SIZE_V1) fail("buffer.chunkSize", "must be the fixed 16-KiB Release 1 chunk size");
  const expectedChunks = artifactChunkCount(artifactLength, b.chunkSize);
  if (b.chunkCount !== expectedChunks || b.verifiedChunkCount !== expectedChunks) fail("buffer", "chunk count or verified count mismatch");
  completeBitmapHex(b.verifiedChunkBitmapHex, expectedChunks, "buffer.verifiedChunkBitmapHex");
  const artifact = bytesFromBase64(b.artifactBytesBase64, "buffer.artifactBytesBase64", MAX_ARTIFACT_BYTES_V1);
  if (BigInt(artifact.length) !== artifactLength) fail("buffer.artifactBytesBase64", "artifact length mismatch");
  if (sha256Hex(artifact) !== b.artifactSha256 || artifactMerkleRoot(artifact).toString("hex") !== b.artifactChunkMerkleRoot) fail("buffer", "artifact SHA-256 or Merkle root mismatch");
  hash32(b.artifactSha256, "buffer.artifactSha256"); hash32(b.artifactChunkMerkleRoot, "buffer.artifactChunkMerkleRoot");
  const adopted = u64(b.adoptedSlot, "buffer.adoptedSlot");
  const finalized = u64(b.verificationFinalizedSlot, "buffer.verificationFinalizedSlot");
  const sealedThrough = u64(b.sealedThroughSlot, "buffer.sealedThroughSlot");
  const creation = u64(receipt.governance.creationSlot, "governance.creationSlot");
  const firstApproval = u64(receipt.governance.firstApprovalSlot, "governance.firstApprovalSlot");
  const upgrade = u64(receipt.governance.upgradeSlot, "governance.upgradeSlot");
  if (!(adopted >= creation && adopted <= finalized && finalized <= firstApproval && finalized <= sealedThrough && sealedThrough >= upgrade)) fail("buffer", "sealed interval does not prove verification before approval and custody through upgrade");
  if (b.status !== "verified" || b.result !== "consumed-by-upgrade") fail("buffer", "upgrade receipt requires a verified buffer consumed by the one Loader Upgrade");
  return artifact;
}

function validateProgramData(receipt: GovernedUpgradeReceiptV3, artifact: Buffer): void {
  const p = receipt.programdata;
  if (!pubkey(p.owner, "programdata.owner").equals(LOADER_V3_PROGRAM_ID) || !pubkey(p.authority, "programdata.authority").equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda"))) fail("programdata", "loader ownership or controller authority mismatch");
  const capacity = u64(p.capacity, "programdata.capacity");
  if (capacity < BigInt(artifact.length) || capacity > BigInt(MAX_RECEIPT_PROGRAMDATA_CAPACITY)) fail("programdata.capacity", "outside bounded expected capacity");
  if (p.artifactLength !== receipt.buffer.artifactLength || p.payloadSha256 !== receipt.buffer.artifactSha256 || p.artifactChunkMerkleRoot !== receipt.buffer.artifactChunkMerkleRoot) fail("programdata", "deployed payload commitment drifted from sealed buffer");
  const raw = bytesFromBase64(p.rawProgramdataBytesBase64, "programdata.rawProgramdataBytesBase64", MAX_RECEIPT_PROGRAMDATA_CAPACITY + RECEIPT_PROGRAMDATA_HEADER_LENGTH);
  if (raw.length !== RECEIPT_PROGRAMDATA_HEADER_LENGTH + Number(capacity)) fail("programdata.rawProgramdataBytesBase64", "raw ProgramData length does not match capacity plus exact header");
  if (raw.readUInt32LE(0) !== 3) fail("programdata.rawProgramdataBytesBase64", "wrong Upgradeable Loader ProgramData variant");
  if (raw.readBigUInt64LE(4) !== u64(p.deployedSlot, "programdata.deployedSlot")) fail("programdata.deployedSlot", "does not match the ProgramData header");
  if (raw[12] !== 1 || !new PublicKey(raw.subarray(13, 45)).equals(pubkey(p.authority, "programdata.authority"))) fail("programdata.authority", "does not match the ProgramData header");
  const deployedPayload = raw.subarray(RECEIPT_PROGRAMDATA_HEADER_LENGTH, RECEIPT_PROGRAMDATA_HEADER_LENGTH + artifact.length);
  if (!deployedPayload.equals(artifact)) fail("programdata", "deployed payload bytes differ from the mechanically verified buffer");
  const tail = raw.subarray(RECEIPT_PROGRAMDATA_HEADER_LENGTH + artifact.length);
  if (tail.some((byte) => byte !== 0) || p.zeroTailRequired !== true || p.zeroTailVerified !== true) fail("programdata", "ProgramData zero tail is absent or unverified");
  if (sha256Hex(deployedPayload) !== p.payloadSha256 || artifactMerkleRoot(deployedPayload).toString("hex") !== p.artifactChunkMerkleRoot || sha256Hex(raw) !== p.rawProgramdataSha256) fail("programdata", "payload Merkle/SHA or raw ProgramData SHA mismatch");
  hash32(p.rawProgramdataSha256, "programdata.rawProgramdataSha256");
  const payloadChunks = artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  const tailChunks = artifactChunkCountAllowEmpty(tail.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  if (p.verifiedPayloadChunkCount !== payloadChunks || p.verifiedTailChunkCount !== tailChunks) fail("programdata", "verification chunk counts are incomplete");
  completeBitmapHex(p.verifiedPayloadChunkBitmapHex, payloadChunks, "programdata.verifiedPayloadChunkBitmapHex");
  completeBitmapHex(p.verifiedTailChunkBitmapHex, tailChunks, "programdata.verifiedTailChunkBitmapHex");
  if (u64(p.verificationFinalizedSlot, "programdata.verificationFinalizedSlot") !== u64(receipt.governance.programdataVerifiedSlot, "governance.programdataVerifiedSlot")) fail("programdata.verificationFinalizedSlot", "does not match governance transition evidence");
}

function checkpointState(receipt: GovernedUpgradeReceiptV3, checkpoint: ReceiptCheckpointV3): StateCheckpointV1 {
  const phase = checkpoint.phase === "prestate" ? StateCheckpointPhaseV1.Prestate : checkpoint.phase === "poststate" ? StateCheckpointPhaseV1.Poststate : fail("state.checkpoint.phase", "unknown checkpoint phase");
  return {
    discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 0,
    initialized: true,
    phase,
    controllerConfig: pubkey(receipt.identities.controllerConfig, "identities.controllerConfig"),
    proposal: pubkey(receipt.identities.proposal, "identities.proposal"),
    emergencyResolution: PublicKey.default,
    subjectDigest: hash32(checkpoint.subjectDigest, `state.${checkpoint.phase}.subjectDigest`),
    targetProgram: pubkey(receipt.identities.targetProgram, "identities.targetProgram"),
    targetProgramdata: pubkey(receipt.identities.targetProgramdata, "identities.targetProgramdata"),
    finalizedObservationSlot: u64(checkpoint.finalizedObservationSlot, `state.${checkpoint.phase}.finalizedObservationSlot`),
    gateEpoch: u64(checkpoint.gateEpoch, `state.${checkpoint.phase}.gateEpoch`),
    targetProgramdataSlot: u64(checkpoint.targetProgramdataSlot, `state.${checkpoint.phase}.targetProgramdataSlot`),
    targetPayloadCommitment: hash32(checkpoint.targetPayloadCommitment, `state.${checkpoint.phase}.targetPayloadCommitment`),
    targetRawProgramdataCommitment: hash32(checkpoint.targetRawProgramdataCommitment, `state.${checkpoint.phase}.targetRawProgramdataCommitment`),
    targetCapacity: u64(checkpoint.targetCapacity, `state.${checkpoint.phase}.targetCapacity`),
    programOwnedStateRoot: hash32(checkpoint.programOwnedStateRoot, `state.${checkpoint.phase}.programOwnedStateRoot`),
    programOwnedStateCount: u64(checkpoint.programOwnedStateCount, `state.${checkpoint.phase}.programOwnedStateCount`),
    logicalCompressedStateRoot: hash32(checkpoint.logicalCompressedStateRoot, `state.${checkpoint.phase}.logicalCompressedStateRoot`),
    logicalCompressedStateCount: u64(checkpoint.logicalCompressedStateCount, `state.${checkpoint.phase}.logicalCompressedStateCount`),
    semanticCustodyAccountingRoot: hash32(checkpoint.semanticCustodyAccountingRoot, `state.${checkpoint.phase}.semanticCustodyAccountingRoot`),
    hardCombinedRoot: hash32(checkpoint.hardCombinedRoot, `state.${checkpoint.phase}.hardCombinedRoot`),
    externalMetadataObservationRoot: hash32(checkpoint.externalMetadataObservationRoot, `state.${checkpoint.phase}.externalMetadataObservationRoot`),
    externalRawBalanceObservationRoot: hash32(checkpoint.externalRawBalanceObservationRoot, `state.${checkpoint.phase}.externalRawBalanceObservationRoot`),
    schemaIdentifier: hash32(checkpoint.schemaIdentifier, `state.${checkpoint.phase}.schemaIdentifier`),
    admittedPositiveDonationRoot: hash32(checkpoint.admittedPositiveDonationRoot, `state.${checkpoint.phase}.admittedPositiveDonationRoot`),
    admittedPositiveDonationCount: u64(checkpoint.admittedPositiveDonationCount, `state.${checkpoint.phase}.admittedPositiveDonationCount`),
    forbiddenDriftCount: integer(checkpoint.forbiddenDriftCount, 0, 0xffff_ffff, `state.${checkpoint.phase}.forbiddenDriftCount`),
    approvalCouncilVersion: u64(checkpoint.approvalCouncilVersion, `state.${checkpoint.phase}.approvalCouncilVersion`),
    approvalCouncilHash: hash32(checkpoint.approvalCouncilHash, `state.${checkpoint.phase}.approvalCouncilHash`),
    checkpointDigest: hash32(checkpoint.checkpointDigest, `state.${checkpoint.phase}.checkpointDigest`),
    approvalBitset: integer(checkpoint.approvalBitset, 0, 0x1f, `state.${checkpoint.phase}.approvalBitset`),
    approvalCount: integer(checkpoint.approvalCount, 0, 5, `state.${checkpoint.phase}.approvalCount`),
    accepted: checkpoint.accepted,
    finalizedSlot: u64(checkpoint.finalizedSlot, `state.${checkpoint.phase}.finalizedSlot`),
    reserved: Buffer.alloc(37),
  };
}

function donationRoot(donations: readonly ReceiptDonationDriftV3[]): string {
  return donations.length === 0 ? ZERO_HASH : sha256Hex(Buffer.from("AMOEBA_EXTERNAL_DONATION_V3", "ascii"), Buffer.from(canonicalJson(donations, "state.derivedPositiveDonations"), "utf8"));
}

function validateState(receipt: GovernedUpgradeReceiptV3): readonly ReceiptDonationDriftV3[] {
  assertExactObjectKeys(receipt.state, ["prestate", "poststate", "externalPrestate", "externalPoststate"], "state");
  const { prestate: pre, poststate: post, externalPrestate, externalPoststate } = receipt.state;
  if (pre.phase !== "prestate" || post.phase !== "poststate" || pre.checkpoint !== receipt.identities.prestateCheckpoint || post.checkpoint !== receipt.identities.poststateCheckpoint) fail("state", "checkpoint phase or identity mismatch");
  [pre, post].forEach((checkpoint) => {
    pubkey(checkpoint.checkpoint, `state.${checkpoint.phase}.checkpoint`);
    if (checkpoint.subjectDigest !== receipt.governance.proposalDigest) fail(`state.${checkpoint.phase}.subjectDigest`, "must bind the immutable proposal digest");
    const state = checkpointState(receipt, checkpoint);
    if (!stateCheckpointHardCombinedRootV1(state).equals(state.hardCombinedRoot)) fail(`state.${checkpoint.phase}.hardCombinedRoot`, "does not recompute from protected roots");
    if (!stateCheckpointDigestV1(state).equals(state.checkpointDigest)) fail(`state.${checkpoint.phase}.checkpointDigest`, "does not recompute from checkpoint evidence");
    if (state.forbiddenDriftCount !== 0 || checkpoint.accepted !== true) fail(`state.${checkpoint.phase}`, "checkpoint has forbidden drift or is not accepted");
    assertApproval(checkpoint.approvalBitset, checkpoint.approvalCount, `state.${checkpoint.phase}.approval`);
  });
  if (pre.gateEpoch !== receipt.governance.frozenGateEpoch || post.gateEpoch !== receipt.governance.frozenGateEpoch) fail("state", "checkpoints must bind the exact frozen epoch");
  if (
    pre.targetProgramdataSlot !== receipt.governance.preProgramdataSlot ||
    pre.targetRawProgramdataCommitment !== receipt.governance.preRawProgramdataHash ||
    pre.targetCapacity !== receipt.governance.preProgramdataCapacity
  ) fail("state.prestate", "does not bind the exact pre-upgrade ProgramData observation");
  if (
    post.approvalCouncilVersion !== receipt.governance.currentCouncilVersion ||
    post.approvalCouncilHash !== receipt.governance.currentCouncilHash ||
    post.approvalBitset !== receipt.governance.poststateApprovalBitset ||
    post.approvalCount !== receipt.governance.poststateApprovalCount
  ) fail("state.poststate", "does not bind the current-council poststate quorum");
  const preObserved = u64(pre.finalizedObservationSlot, "state.prestate.finalizedObservationSlot");
  const preFinalized = u64(pre.finalizedSlot, "state.prestate.finalizedSlot");
  const postObserved = u64(post.finalizedObservationSlot, "state.poststate.finalizedObservationSlot");
  const postFinalized = u64(post.finalizedSlot, "state.poststate.finalizedSlot");
  if (!(preObserved <= preFinalized && preFinalized < u64(receipt.governance.upgradeSlot, "governance.upgradeSlot"))) fail("state.prestate", "must be finalized and accepted before loader work");
  if (!(postObserved <= postFinalized && postFinalized <= u64(receipt.governance.poststateAcceptedSlot, "governance.poststateAcceptedSlot"))) fail("state.poststate", "must be finalized before poststate acceptance");
  const hardFields: readonly (keyof ReceiptCheckpointV3)[] = [
    "schemaIdentifier", "programOwnedStateRoot", "programOwnedStateCount", "logicalCompressedStateRoot", "logicalCompressedStateCount",
    "semanticCustodyAccountingRoot", "externalMetadataObservationRoot", "hardCombinedRoot",
  ];
  for (const field of hardFields) if (pre[field] !== post[field]) fail(`state.poststate.${field}`, "hard protected state changed");
  validateExternalObservationSet(externalPrestate, receipt.identities.clusterDomainHex, "state.externalPrestate");
  validateExternalObservationSet(externalPoststate, receipt.identities.clusterDomainHex, "state.externalPoststate");
  if (
    externalPrestate.context.slot !== pre.finalizedObservationSlot ||
    externalPoststate.context.slot !== post.finalizedObservationSlot
  ) fail("state.externalObservations", "finalized observation contexts do not match their checkpoint slots");
  const preRoots = externalObservationRootsV3(externalPrestate);
  const postRoots = externalObservationRootsV3(externalPoststate);
  if (
    preRoots.metadataRoot !== pre.externalMetadataObservationRoot ||
    preRoots.rawBalanceRoot !== pre.externalRawBalanceObservationRoot
  ) fail("state.externalPrestate", "external metadata or raw-balance root does not recompute from the canonical prestate observations");
  if (
    postRoots.metadataRoot !== post.externalMetadataObservationRoot ||
    postRoots.rawBalanceRoot !== post.externalRawBalanceObservationRoot
  ) fail("state.externalPoststate", "external metadata or raw-balance root does not recompute from the canonical poststate observations");
  const donations = deriveExternalDonationDriftV3(externalPrestate, externalPoststate);
  if (u64(pre.admittedPositiveDonationCount, "state.prestate.admittedPositiveDonationCount") !== 0n || pre.admittedPositiveDonationRoot !== ZERO_HASH) fail("state.prestate", "prestate cannot pre-admit post-upgrade donations");
  if (u64(post.admittedPositiveDonationCount, "state.poststate.admittedPositiveDonationCount") !== BigInt(donations.length) || post.admittedPositiveDonationRoot !== donationRoot(donations)) fail("state.poststate", "donation count or deterministic donation root mismatch");
  if (donations.length === 0 && pre.externalRawBalanceObservationRoot !== post.externalRawBalanceObservationRoot) fail("state.poststate.externalRawBalanceObservationRoot", "raw external balances changed without a mechanically derived donation");
  if (post.targetPayloadCommitment !== receipt.programdata.payloadSha256 || post.targetRawProgramdataCommitment !== receipt.programdata.rawProgramdataSha256 || post.targetProgramdataSlot !== receipt.programdata.deployedSlot || post.targetCapacity !== receipt.programdata.capacity) fail("state.poststate", "does not bind the mechanically verified ProgramData");
  return donations;
}

function finalizedAccountRoleIdentity(receipt: GovernedUpgradeReceiptV3, role: ReceiptFinalizedAccountRoleV3): string {
  const identities = receipt.identities;
  switch (role) {
    case "controller-program": return identities.controllerProgram;
    case "controller-programdata": return identities.controllerProgramdata;
    case "controller-config": return identities.controllerConfig;
    case "policy": return identities.policy;
    case "protocol-gate": return identities.protocolGate;
    case "proposal": return identities.proposal;
    case "counterpart-proposal": return identities.counterpartProposal;
    case "creation-council": return identities.creationCouncil;
    case "current-council": return identities.council;
    case "prestate-checkpoint": return identities.prestateCheckpoint;
    case "poststate-checkpoint": return identities.poststateCheckpoint;
    case "buffer": return identities.buffer;
    case "buffer-verification": return identities.bufferVerification;
    case "counterpart-buffer-verification": return identities.counterpartBufferVerification;
    case "programdata-verification": return identities.programdataVerification;
    case "emergency-freeze-observation": return identities.emergencyFreezeObservation;
    case "target-program": return identities.targetProgram;
    case "target-programdata": return identities.targetProgramdata;
  }
}

function validateFinalizedAccounts(receipt: GovernedUpgradeReceiptV3): void {
  const inventory = receipt.finalizedAccounts;
  assertExactObjectKeys(inventory, ["query", "snapshots", "inventoryRoot"], "finalizedAccounts");
  const query = inventory.query;
  assertExactObjectKeys(query, ["context", "accounts", "queryIdentity"], "finalizedAccounts.query");
  validateFinalizedContext(query.context, receipt.identities.clusterDomainHex, "finalizedAccounts.query.context");
  if (u64(query.context.slot, "finalizedAccounts.query.context.slot") < u64(receipt.governance.unfreezeSlot, "governance.unfreezeSlot")) fail("finalizedAccounts.query.context.slot", "finalized account snapshot predates governed unfreeze");
  if (!Array.isArray(query.accounts) || query.accounts.length !== RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.length) fail("finalizedAccounts.query.accounts", "must contain every canonical finalized account role");
  for (const [index, role] of RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.entries()) {
    const expected = { role, pubkey: finalizedAccountRoleIdentity(receipt, role) };
    const actual = query.accounts[index]!;
    assertExactObjectKeys(actual, ["role", "pubkey"], `finalizedAccounts.query.accounts[${index}]`);
    if (actual.role !== expected.role || pubkey(actual.pubkey, `finalizedAccounts.query.accounts[${index}].pubkey`).toBase58() !== expected.pubkey) fail("finalizedAccounts.query.accounts", "finalized account query has an omission, addition, reordering, or identity drift");
  }
  const { queryIdentity: _queryIdentity, ...queryMaterial } = query;
  if (finalizedAccountQueryIdentityV3(queryMaterial) !== query.queryIdentity) fail("finalizedAccounts.query.queryIdentity", "does not recompute from the exact account query");
  hash32(query.queryIdentity, "finalizedAccounts.query.queryIdentity");
  if (!Array.isArray(inventory.snapshots) || inventory.snapshots.length !== RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.length) fail("finalizedAccounts.snapshots", "must contain every canonical finalized account snapshot");
  let inlineBytes = 0;
  const byRole = new Map<ReceiptFinalizedAccountRoleV3, { snapshot: ReceiptFinalizedAccountSnapshotV3; data: Buffer | null }>();
  for (const [index, role] of RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.entries()) {
    const snapshot = inventory.snapshots[index]!;
    const path = `finalizedAccounts.snapshots[${index}]`;
    assertExactObjectKeys(snapshot, ["role", "pubkey", "exists", "owner", "executable", "lamports", "dataLength", "dataSha256", "dataBase64"], path);
    if (snapshot.role !== role || pubkey(snapshot.pubkey, `${path}.pubkey`).toBase58() !== finalizedAccountRoleIdentity(receipt, role)) fail(path, "snapshot role or identity drifted from the canonical query");
    if (typeof snapshot.exists !== "boolean") fail(`${path}.exists`, "must be a boolean");
    let data: Buffer | null = null;
    if (!snapshot.exists) {
      if (snapshot.owner !== null || snapshot.executable !== null || snapshot.lamports !== null || snapshot.dataLength !== 0 || snapshot.dataSha256 !== ZERO_HASH || snapshot.dataBase64 !== null) fail(path, "absent account snapshot is not canonical");
    } else {
      pubkey(snapshot.owner, `${path}.owner`);
      if (typeof snapshot.executable !== "boolean") fail(`${path}.executable`, "must be a boolean");
      u64(snapshot.lamports, `${path}.lamports`);
      integer(snapshot.dataLength, 0, MAX_RECEIPT_ACCOUNT_DATA_LENGTH, `${path}.dataLength`);
      hash32(snapshot.dataSha256, `${path}.dataSha256`);
      if (snapshot.dataBase64 === null) fail(`${path}.dataBase64`, "finalized trust-root snapshots must include exact bounded account bytes");
      data = bytesFromBase64(snapshot.dataBase64, `${path}.dataBase64`, MAX_RECEIPT_TRUST_BLOB_BYTES);
      inlineBytes += data.length;
      if (data.length !== snapshot.dataLength || sha256Hex(data) !== snapshot.dataSha256) fail(path, "snapshot data length or SHA-256 mismatch");
    }
    byRole.set(role, { snapshot, data });
  }
  if (inlineBytes > MAX_RECEIPT_TRUST_TOTAL_BYTES) fail("finalizedAccounts.snapshots", "finalized account evidence exceeds the total byte bound");
  if (finalizedAccountInventoryRootV3(inventory.snapshots) !== inventory.inventoryRoot) fail("finalizedAccounts.inventoryRoot", "does not recompute from the ordered finalized account inventory");
  hash32(inventory.inventoryRoot, "finalizedAccounts.inventoryRoot");

  const controller = receipt.identities.controllerProgram;
  for (const role of RECEIPT_FINALIZED_ACCOUNT_ROLES_V3) {
    const { snapshot } = byRole.get(role)!;
    const mayBeAbsent = role === "buffer" || role === "emergency-freeze-observation";
    if (!snapshot.exists && !mayBeAbsent) fail(`finalizedAccounts.${role}`, "required finalized account is absent");
    if (!snapshot.exists) continue;
    const loaderOwned = role === "controller-program" || role === "controller-programdata" || role === "target-program" || role === "target-programdata";
    const expectedOwner = loaderOwned ? LOADER_V3_PROGRAM_ID.toBase58() : controller;
    const expectedExecutable = role === "controller-program" || role === "target-program";
    if (snapshot.owner !== expectedOwner || snapshot.executable !== expectedExecutable) fail(`finalizedAccounts.${role}`, "owner or executable state is not canonical");
  }
  if (byRole.get("buffer")!.snapshot.exists) fail("finalizedAccounts.buffer", "consumed Loader buffer must be absent from the finalized inventory");
  if (receipt.governance.freezeTransition === "emergency-conversion" && !byRole.get("emergency-freeze-observation")!.snapshot.exists) fail("finalizedAccounts.emergency-freeze-observation", "emergency conversion requires its finalized observation account");

  const exactBytes = (role: ReceiptFinalizedAccountRoleV3): Buffer => byRole.get(role)!.data ?? fail(`finalizedAccounts.${role}`, "required raw account bytes are absent");
  if (!exactBytes("controller-program").equals(bytesFromBase64(receipt.controllerTrustRoot.controllerProgramAccount.bytesBase64, "controllerTrustRoot.controllerProgramAccount.bytesBase64", 36))) fail("finalizedAccounts.controller-program", "does not match the controller trust-root Program bytes");
  if (!exactBytes("controller-programdata").equals(bytesFromBase64(receipt.controllerTrustRoot.controllerProgramdata.rawProgramdata.bytesBase64, "controllerTrustRoot.controllerProgramdata.rawProgramdata.bytesBase64", MAX_RECEIPT_TRUST_BLOB_BYTES))) fail("finalizedAccounts.controller-programdata", "does not match the controller trust-root ProgramData bytes");
  if (!exactBytes("controller-config").equals(bytesFromBase64(receipt.controllerTrustRoot.initializationState.bytesBase64, "controllerTrustRoot.initializationState.bytesBase64", MAX_RECEIPT_TRUST_BLOB_BYTES))) fail("finalizedAccounts.controller-config", "does not match the decoded controller config evidence");
  if (!exactBytes("target-programdata").equals(bytesFromBase64(receipt.programdata.rawProgramdataBytesBase64, "programdata.rawProgramdataBytesBase64", MAX_RECEIPT_PROGRAMDATA_CAPACITY + RECEIPT_PROGRAMDATA_HEADER_LENGTH))) fail("finalizedAccounts.target-programdata", "does not match the mechanically verified target ProgramData bytes");
  const targetProgram = exactBytes("target-program");
  if (targetProgram.length !== 36 || targetProgram.readUInt32LE(0) !== 2 || !new PublicKey(targetProgram.subarray(4)).equals(pubkey(receipt.identities.targetProgramdata, "identities.targetProgramdata"))) fail("finalizedAccounts.target-program", "does not mechanically link the target Program to its ProgramData");
  let gate: ReturnType<typeof deserializeProtocolGateV1>;
  try { gate = deserializeProtocolGateV1(exactBytes("protocol-gate")); } catch { return fail("finalizedAccounts.protocol-gate", "is not a canonical ProtocolGateV1 account"); }
  if (
    gate.status !== GateStatusV1.Active || gate.epoch !== u64(receipt.governance.completedGateEpoch, "governance.completedGateEpoch") ||
    !gate.controllerConfig.equals(pubkey(receipt.identities.controllerConfig, "identities.controllerConfig")) ||
    !gate.targetProgram.equals(pubkey(receipt.identities.targetProgram, "identities.targetProgram")) ||
    !gate.targetProgramdata.equals(pubkey(receipt.identities.targetProgramdata, "identities.targetProgramdata")) ||
    !gate.activeProposal.equals(PublicKey.default) || gate.freezeSlot !== 0n || gate.freezeReasonCode !== 0 ||
    !gate.lastCompletedProposal.equals(pubkey(receipt.identities.proposal, "identities.proposal"))
  ) fail("finalizedAccounts.protocol-gate", "does not prove the exact completed Active gate state");
}

function requiredHistoryAddresses(receipt: GovernedUpgradeReceiptV3): readonly string[] {
  return [
    receipt.identities.controllerProgram,
    receipt.identities.targetProgram,
    receipt.identities.targetProgramdata,
    receipt.identities.authorityPda,
    receipt.identities.protocolGate,
    receipt.identities.proposal,
    receipt.identities.buffer,
  ].sort(comparePubkeys);
}

function validateHistoryInstruction(instruction: ReceiptHistoryInstructionV3, path: string): void {
  assertExactObjectKeys(instruction, ["programId", "dataHex", "accounts"], path);
  pubkey(instruction.programId, `${path}.programId`);
  if (typeof instruction.dataHex !== "string" || instruction.dataHex.length > MAX_RECEIPT_INSTRUCTION_DATA_BYTES * 2) fail(`${path}.dataHex`, "instruction data exceeds the receipt bound");
  bytesFromHex(instruction.dataHex, `${path}.dataHex`);
  if (!Array.isArray(instruction.accounts) || instruction.accounts.length > MAX_RECEIPT_HISTORY_ACCOUNTS) fail(`${path}.accounts`, "instruction account vector exceeds the receipt bound");
  for (const [index, account] of instruction.accounts.entries()) {
    assertExactObjectKeys(account, ["pubkey", "isSigner", "isWritable"], `${path}.accounts[${index}]`);
    pubkey(account.pubkey, `${path}.accounts[${index}].pubkey`);
    if (typeof account.isSigner !== "boolean" || typeof account.isWritable !== "boolean") fail(`${path}.accounts[${index}]`, "account privileges must be booleans");
  }
}

function validateComputeBudgetInstruction(instruction: ReceiptHistoryInstructionV3, path: string): number {
  const data = bytesFromHex(instruction.dataHex, `${path}.dataHex`);
  if (instruction.accounts.length !== 0) fail(path, "ComputeBudget instruction cannot carry accounts");
  if (data.length === 5 && data[0] === 2) {
    const units = data.readUInt32LE(1);
    if (units === 0 || units > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1) fail(path, "compute-unit limit exceeds the canonical bound");
    return 2;
  }
  if (data.length === 9 && data[0] === 3) {
    if (data.readBigUInt64LE(1) > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1) fail(path, "compute-unit price exceeds the canonical bound");
    return 3;
  }
  return fail(path, "is not a canonical bounded ComputeBudget instruction");
}

function validateProposalExpectationForHistory(
  receipt: GovernedUpgradeReceiptV3,
  expected: ReturnType<typeof decodeFreezeProposalV2>["expected"],
  gateStatus: number,
): void {
  const governance = receipt.governance;
  if (
    !expected.expectedProposalDigest.equals(hash32(governance.proposalDigest, "governance.proposalDigest")) ||
    expected.expectedPolicyVersion !== u64(governance.policyVersion, "governance.policyVersion") ||
    !expected.expectedPolicyHash.equals(hash32(governance.policyHash, "governance.policyHash")) ||
    expected.expectedCouncilVersion !== u64(governance.creationCouncilVersion, "governance.creationCouncilVersion") ||
    !expected.expectedCouncilHash.equals(hash32(governance.creationCouncilHash, "governance.creationCouncilHash")) ||
    expected.expectedGateStatus !== gateStatus ||
    expected.expectedGateEpoch !== u64(governance.creationGateEpoch, "governance.creationGateEpoch") ||
    expected.expectedTargetNonce !== u64(governance.proposalTargetNonce, "governance.proposalTargetNonce") ||
    expected.expectedState !== ProposalStateV2.Timelocked ||
    expected.expectedReviewStartSlot !== u64(governance.reviewStartSlot, "governance.reviewStartSlot") ||
    expected.expectedReviewEndSlot !== u64(governance.reviewEndSlot, "governance.reviewEndSlot") ||
    expected.expectedNotBeforeSlot !== u64(governance.notBeforeSlot, "governance.notBeforeSlot") ||
    expected.expectedExpirySlot !== u64(governance.expirySlot, "governance.expirySlot")
  ) fail("frozenHistory.freeze", "freeze instruction expectation does not bind the exact proposal, gate, nonce, policy, council, or timing state");
}

function validateFreezeHistoryEvent(
  receipt: GovernedUpgradeReceiptV3,
  instruction: ReceiptHistoryInstructionV3,
  path: string,
): void {
  const identities = receipt.identities;
  if (receipt.governance.freezeTransition === "ordinary") {
    let decoded: ReturnType<typeof decodeFreezeProposalV2>;
    try { decoded = decodeFreezeProposalV2(bytesFromHex(instruction.dataHex, `${path}.dataHex`)); } catch { return fail(path, "is not the exact FreezeProposalV2 codec"); }
    validateProposalExpectationForHistory(receipt, decoded.expected, GateStatusV1.Active);
    if (decoded.expectedNextGateEpoch !== u64(receipt.governance.frozenGateEpoch, "governance.frozenGateEpoch")) fail(path, "freeze next epoch does not match the receipt");
    const expected: readonly [string, boolean, boolean][] = [
      [identities.controllerConfig, false, true], [identities.policy, false, false], [identities.creationCouncil, false, false],
      [identities.protocolGate, false, true], [identities.proposal, false, true], [identities.targetProgram, false, false],
      [identities.targetProgramdata, false, false], [identities.upgradeableLoader, false, false], [identities.authorityPda, false, false],
      [identities.counterpartProposal, false, false], [identities.counterpartBufferVerification, false, false], [identities.buffer, false, false],
    ];
    if (instruction.accounts.length !== expected.length) fail(path, "FreezeProposalV2 account count mismatch");
    expected.forEach(([key, signer, writable], index) => exactMeta(instruction.accounts[index]!, key, signer, writable, `${path}.accounts[${index}]`));
  } else {
    let decoded: ReturnType<typeof decodeConvertEmergencyFreezeV2>;
    try { decoded = decodeConvertEmergencyFreezeV2(bytesFromHex(instruction.dataHex, `${path}.dataHex`)); } catch { return fail(path, "is not the exact ConvertEmergencyFreezeV2 codec"); }
    validateProposalExpectationForHistory(receipt, decoded.expected, GateStatusV1.EmergencyFrozen);
    if (decoded.expectedNextGateEpoch !== u64(receipt.governance.frozenGateEpoch, "governance.frozenGateEpoch") || decoded.expectedFreezeObservationDigest.equals(Buffer.alloc(32))) fail(path, "emergency conversion epoch or observation digest is invalid");
    const expected: readonly [string, boolean, boolean][] = [
      [identities.controllerConfig, false, true], [identities.policy, false, false], [identities.creationCouncil, false, false],
      [identities.protocolGate, false, true], [identities.proposal, false, true], [identities.emergencyFreezeObservation, false, false],
      [identities.targetProgram, false, false], [identities.targetProgramdata, false, false], [identities.upgradeableLoader, false, false],
      [identities.authorityPda, false, false], [identities.counterpartProposal, false, false],
      [identities.counterpartBufferVerification, false, false], [identities.buffer, false, false],
    ];
    if (instruction.accounts.length !== expected.length) fail(path, "ConvertEmergencyFreezeV2 account count mismatch");
    expected.forEach(([key, signer, writable], index) => exactMeta(instruction.accounts[index]!, key, signer, writable, `${path}.accounts[${index}]`));
  }
}

function validateHistoryEnvelope(
  instructions: readonly ReceiptHistoryInstructionV3[],
  controllerIndex: number,
  envelope: ReturnType<typeof decodeExecuteUnfreezeV1>["envelope"],
  path: string,
): void {
  const hasNonce = envelope.durableNonceAccount.present;
  if (hasNonce !== envelope.durableNonceAuthority.present || controllerIndex !== (hasNonce ? 3 : 2)) fail(path, "history envelope length does not match its nonce commitment");
  let cursor = 0;
  if (hasNonce) {
    const nonce = instructions[cursor++]!;
    if (nonce.programId !== SYSTEM_PROGRAM_ID_V1.toBase58() || nonce.dataHex !== "04000000" || nonce.accounts.length !== 3) fail(path, "history envelope nonce is not canonical");
    exactMeta(nonce.accounts[0]!, envelope.durableNonceAccount.value.toBase58(), false, true, `${path}.nonce.accounts[0]`);
    exactMeta(nonce.accounts[1]!, RECENT_BLOCKHASHES_SYSVAR_ID_V1.toBase58(), false, false, `${path}.nonce.accounts[1]`);
    exactMeta(nonce.accounts[2]!, envelope.durableNonceAuthority.value.toBase58(), true, false, `${path}.nonce.accounts[2]`);
  }
  const limit = instructions[cursor++]!;
  const expectedLimit = Buffer.alloc(5); expectedLimit[0] = 2; expectedLimit.writeUInt32LE(envelope.computeUnitLimit, 1);
  if (limit.programId !== COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58() || limit.accounts.length !== 0 || limit.dataHex !== expectedLimit.toString("hex")) fail(path, "history envelope compute limit mismatch");
  const price = instructions[cursor++]!;
  const expectedPrice = Buffer.alloc(9); expectedPrice[0] = 3; expectedPrice.writeBigUInt64LE(envelope.computeUnitPriceMicroLamports, 1);
  if (price.programId !== COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58() || price.accounts.length !== 0 || price.dataHex !== expectedPrice.toString("hex")) fail(path, "history envelope compute price mismatch");
}

function validateUnfreezeHistoryEvent(
  receipt: GovernedUpgradeReceiptV3,
  topLevelInstructions: readonly ReceiptHistoryInstructionV3[],
  controllerIndex: number,
  path: string,
): void {
  const instruction = topLevelInstructions[controllerIndex]!;
  let decoded: ReturnType<typeof decodeExecuteUnfreezeV1>;
  try { decoded = decodeExecuteUnfreezeV1(bytesFromHex(instruction.dataHex, `${path}.dataHex`)); } catch { return fail(path, "is not the exact ExecuteUnfreezeV1 codec"); }
  const governance = receipt.governance;
  const expected = decoded.expected;
  if (
    !expected.expectedProposalDigest.equals(hash32(governance.proposalDigest, "governance.proposalDigest")) ||
    expected.expectedPolicyVersion !== u64(governance.policyVersion, "governance.policyVersion") ||
    !expected.expectedPolicyHash.equals(hash32(governance.policyHash, "governance.policyHash")) ||
    expected.expectedCurrentCouncilVersion !== u64(governance.currentCouncilVersion, "governance.currentCouncilVersion") ||
    !expected.expectedCurrentCouncilHash.equals(hash32(governance.currentCouncilHash, "governance.currentCouncilHash")) ||
    expected.expectedFrozenGateEpoch !== u64(governance.frozenGateEpoch, "governance.frozenGateEpoch") ||
    expected.expectedTargetNonce !== u64(governance.configTargetNonceAfterFreeze, "governance.configTargetNonceAfterFreeze") ||
    expected.expectedProposalState !== ProposalStateV2.UnfreezeApproved ||
    !expected.expectedPoststateCheckpointDigest.equals(hash32(receipt.state.poststate.checkpointDigest, "state.poststate.checkpointDigest")) ||
    !expected.expectedProgramdataAuthority.equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda")) ||
    expected.expectedProgramdataDeployedSlot !== u64(receipt.programdata.deployedSlot, "programdata.deployedSlot") ||
    expected.expectedProgramdataCapacity !== u64(receipt.programdata.capacity, "programdata.capacity") ||
    !expected.expectedRawProgramdataHash.equals(hash32(receipt.programdata.rawProgramdataSha256, "programdata.rawProgramdataSha256")) ||
    expected.expectedUnfreezeApprovalBitset !== governance.unfreezeApprovalBitset ||
    expected.expectedUnfreezeApprovalCount !== governance.unfreezeApprovalCount ||
    expected.expectedProgramdataVerificationFinalizedSlot !== u64(receipt.programdata.verificationFinalizedSlot, "programdata.verificationFinalizedSlot") ||
    !decoded.linkedProposal.equals(pubkey(receipt.identities.counterpartProposal, "identities.counterpartProposal"))
  ) fail(path, "unfreeze instruction does not bind the exact proposal, gate, council, ProgramData, checkpoint, approvals, or linked proposal");
  validateHistoryEnvelope(topLevelInstructions, controllerIndex, decoded.envelope, `${path}.envelope`);
  const identities = receipt.identities;
  const accounts: readonly [string, boolean, boolean][] = [
    [identities.controllerConfig, false, false], [identities.policy, false, false], [identities.council, false, false],
    [identities.protocolGate, false, true], [identities.proposal, false, true], [identities.counterpartProposal, false, true],
    [identities.poststateCheckpoint, false, false], [identities.programdataVerification, false, false],
    [identities.targetProgram, false, false], [identities.targetProgramdata, false, false], [identities.authorityPda, false, false],
    [identities.upgradeableLoader, false, false], [INSTRUCTIONS_SYSVAR_ID.toBase58(), false, false],
  ];
  if (instruction.accounts.length !== accounts.length) fail(path, "ExecuteUnfreezeV1 account count mismatch");
  accounts.forEach(([key, signer, writable], index) => exactMeta(instruction.accounts[index]!, key, signer, writable, `${path}.accounts[${index}]`));
}

function validateHistory(receipt: GovernedUpgradeReceiptV3): void {
  const history = receipt.frozenHistory;
  assertExactObjectKeys(history, ["query", "transactions", "inventoryRoot"], "frozenHistory");
  const { query, transactions } = history;
  assertExactObjectKeys(query, ["commitment", "clusterDomainHex", "startSlot", "endSlot", "matchMode", "includeFailed", "addresses", "queryIdentity"], "frozenHistory.query");
  if (query.commitment !== "finalized" || query.matchMode !== "any-account-key" || query.includeFailed !== true) fail("frozenHistory.query", "must request a complete finalized any-account-key inventory including failed transactions");
  if (query.clusterDomainHex !== receipt.identities.clusterDomainHex) fail("frozenHistory.query.clusterDomainHex", "does not match the receipt cluster domain");
  hash32(query.clusterDomainHex, "frozenHistory.query.clusterDomainHex");
  const freeze = u64(receipt.governance.freezeSlot, "governance.freezeSlot");
  const unfreeze = u64(receipt.governance.unfreezeSlot, "governance.unfreezeSlot");
  const upgrade = u64(receipt.governance.upgradeSlot, "governance.upgradeSlot");
  if (u64(query.startSlot, "frozenHistory.query.startSlot") !== freeze || u64(query.endSlot, "frozenHistory.query.endSlot") !== unfreeze) fail("frozenHistory.query", "query interval does not exactly span freeze through governed unfreeze");
  const requiredAddresses = requiredHistoryAddresses(receipt);
  if (!Array.isArray(query.addresses) || query.addresses.length !== requiredAddresses.length) fail("frozenHistory.query.addresses", "does not contain the exact relevant address inventory");
  query.addresses.forEach((address, index) => {
    if (pubkey(address, `frozenHistory.query.addresses[${index}]`).toBase58() !== requiredAddresses[index]) fail("frozenHistory.query.addresses", "must be the exact strictly sorted relevant address inventory");
  });
  const { queryIdentity: _queryIdentity, ...queryMaterial } = query;
  if (frozenHistoryQueryIdentityV3(queryMaterial) !== query.queryIdentity) fail("frozenHistory.query.queryIdentity", "does not recompute from the exact finalized query");
  hash32(query.queryIdentity, "frozenHistory.query.queryIdentity");
  if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > MAX_RECEIPT_HISTORY_TRANSACTIONS) fail("frozenHistory.transactions", "must be a bounded nonempty history");
  if (frozenHistoryInventoryRootV3(transactions) !== history.inventoryRoot) fail("frozenHistory.inventoryRoot", "does not recompute from the ordered transaction inventory");
  hash32(history.inventoryRoot, "frozenHistory.inventoryRoot");
  const admittedTopLevel = new Set([receipt.identities.controllerProgram, COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), SYSTEM_PROGRAM_ID_V1.toBase58()]);
  let priorSlot = freeze;
  let priorTransactionIndex = -1;
  let priorBlockHash: string | null = null;
  let freezeEvents = 0;
  let upgradeEvents = 0;
  let unfreezeEvents = 0;
  const signatures = new Set<string>();
  for (const [index, event] of transactions.entries()) {
    const path = `frozenHistory.transactions[${index}]`;
    assertExactObjectKeys(event, [
      "slot", "blockHash", "blockTimeUnix", "transactionIndex", "signatureHex", "messageSha256", "metaSha256", "status",
      "errorSha256", "topLevelInstructions", "innerInstructionGroups",
    ], path);
    const slot = u64(event.slot, `${path}.slot`);
    const transactionIndex = integer(event.transactionIndex, 0, 0xffff_ffff, `${path}.transactionIndex`);
    if (slot < freeze || slot > unfreeze || slot < priorSlot || (slot === priorSlot && transactionIndex <= priorTransactionIndex)) fail(path, "transaction inventory is outside or reorders the frozen interval");
    const blockHash = hash32(event.blockHash, `${path}.blockHash`).toString("hex");
    if (slot === priorSlot && priorBlockHash !== null && blockHash !== priorBlockHash) fail(path, "transactions in one slot disagree on block identity");
    priorTransactionIndex = slot === priorSlot ? transactionIndex : transactionIndex;
    priorBlockHash = slot === priorSlot ? blockHash : blockHash;
    priorSlot = slot;
    u64(event.blockTimeUnix, `${path}.blockTimeUnix`);
    bytesFromHex(event.signatureHex, `${path}.signatureHex`, 64);
    if (signatures.has(event.signatureHex)) fail(`${path}.signatureHex`, "duplicate transaction signature");
    signatures.add(event.signatureHex);
    hash32(event.messageSha256, `${path}.messageSha256`);
    hash32(event.metaSha256, `${path}.metaSha256`);
    if (event.status === "succeeded") {
      if (event.errorSha256 !== ZERO_HASH) fail(`${path}.errorSha256`, "successful transaction must have the canonical zero error hash");
    } else if (event.status === "failed") {
      if (hash32(event.errorSha256, `${path}.errorSha256`).equals(Buffer.alloc(32))) fail(`${path}.errorSha256`, "failed transaction must bind a nonzero error hash");
    } else {
      fail(`${path}.status`, "unknown transaction status");
    }
    if (!Array.isArray(event.topLevelInstructions) || event.topLevelInstructions.length === 0 || event.topLevelInstructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${path}.topLevelInstructions`, "invalid bounded top-level instruction inventory");
    const topLevelInstructions = event.topLevelInstructions as readonly ReceiptHistoryInstructionV3[];
    topLevelInstructions.forEach((instruction: ReceiptHistoryInstructionV3, instructionIndex: number) => validateHistoryInstruction(instruction, `${path}.topLevelInstructions[${instructionIndex}]`));
    if (event.status === "failed") {
      if (!Array.isArray(event.innerInstructionGroups) || event.innerInstructionGroups.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${path}.innerInstructionGroups`, "invalid bounded inner-instruction inventory");
      let priorFailedGroup = -1;
      for (const [groupIndex, group] of (event.innerInstructionGroups as readonly ReceiptHistoryInnerInstructionGroupV3[]).entries()) {
        const groupPath = `${path}.innerInstructionGroups[${groupIndex}]`;
        assertExactObjectKeys(group, ["topLevelInstructionIndex", "instructions"], groupPath);
        const topLevelInstructionIndex = integer(group.topLevelInstructionIndex, 0, topLevelInstructions.length - 1, `${groupPath}.topLevelInstructionIndex`);
        if (topLevelInstructionIndex <= priorFailedGroup) fail(groupPath, "inner instruction groups must be strictly ordered and unique");
        priorFailedGroup = topLevelInstructionIndex;
        if (!Array.isArray(group.instructions) || group.instructions.length === 0 || group.instructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${groupPath}.instructions`, "invalid bounded inner instruction group");
        (group.instructions as readonly ReceiptHistoryInstructionV3[]).forEach((instruction, instructionIndex) => validateHistoryInstruction(instruction, `${groupPath}.instructions[${instructionIndex}]`));
      }
      continue;
    }
    const topLevelProgramIds = topLevelInstructions.map((instruction: ReceiptHistoryInstructionV3) => instruction.programId);
    if (topLevelProgramIds.some((program) => !admittedTopLevel.has(program))) fail(path, "contains a sibling arbitrary top-level instruction");
    const controllerIndexes = topLevelProgramIds.map((program: string, instructionIndex: number) => program === receipt.identities.controllerProgram ? instructionIndex : -1).filter((instructionIndex: number) => instructionIndex >= 0);
    if (controllerIndexes.length !== 1 || controllerIndexes[0] !== event.topLevelInstructions.length - 1) fail(path, "must contain one final top-level controller instruction");
    const controllerIndex = controllerIndexes[0]!;
    const controllerData = bytesFromHex(topLevelInstructions[controllerIndex]!.dataHex, `${path}.topLevelInstructions[${controllerIndex}].dataHex`);
    if (controllerData.length === 0) fail(path, "controller instruction has no tag");
    const tag = integer(controllerData[0], 1, 38, `${path}.controllerInstructionTag`);
    if (tag === 26) fail(path, "reserved controller instruction tag is not executable");
    const computeTags = new Set<number>();
    let nonceCount = 0;
    for (let instructionIndex = 0; instructionIndex < controllerIndex; instructionIndex += 1) {
      const instruction = topLevelInstructions[instructionIndex]!;
      if (instruction.programId === COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58()) {
        const computeTag = validateComputeBudgetInstruction(instruction, `${path}.topLevelInstructions[${instructionIndex}]`);
        if (computeTags.has(computeTag)) fail(path, "duplicate ComputeBudget instruction kind");
        computeTags.add(computeTag);
      } else if (instruction.programId === SYSTEM_PROGRAM_ID_V1.toBase58()) {
        nonceCount += 1;
        if (
          nonceCount !== 1 || instructionIndex !== 0 || instruction.dataHex !== "04000000" || instruction.accounts.length !== 3 ||
          instruction.accounts[1]!.pubkey !== RECENT_BLOCKHASHES_SYSVAR_ID_V1.toBase58() || !instruction.accounts[2]!.isSigner
        ) fail(path, "noncanonical durable-nonce advance");
      }
    }
    if (!Array.isArray(event.innerInstructionGroups) || event.innerInstructionGroups.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${path}.innerInstructionGroups`, "invalid bounded inner-instruction inventory");
    let priorGroup = -1;
    const innerInstructions: ReceiptHistoryInstructionV3[] = [];
    const innerInstructionGroups = event.innerInstructionGroups as readonly ReceiptHistoryInnerInstructionGroupV3[];
    for (const [groupIndex, group] of innerInstructionGroups.entries()) {
      const groupPath = `${path}.innerInstructionGroups[${groupIndex}]`;
      assertExactObjectKeys(group, ["topLevelInstructionIndex", "instructions"], groupPath);
      const topLevelInstructionIndex = integer(group.topLevelInstructionIndex, 0, event.topLevelInstructions.length - 1, `${groupPath}.topLevelInstructionIndex`);
      if (topLevelInstructionIndex <= priorGroup) fail(groupPath, "inner instruction groups must be strictly ordered and unique");
      priorGroup = topLevelInstructionIndex;
      if (!Array.isArray(group.instructions) || group.instructions.length === 0 || group.instructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${groupPath}.instructions`, "invalid bounded inner instruction group");
      (group.instructions as readonly ReceiptHistoryInstructionV3[]).forEach((instruction: ReceiptHistoryInstructionV3, instructionIndex: number) => {
        validateHistoryInstruction(instruction, `${groupPath}.instructions[${instructionIndex}]`);
        if (instruction.programId !== LOADER_V3_PROGRAM_ID.toBase58() && instruction.programId !== SYSTEM_PROGRAM_ID_V1.toBase58()) fail(groupPath, "contains an arbitrary inner CPI while frozen");
        innerInstructions.push(instruction);
      });
    }
    const loaderCpis = innerInstructions.filter((instruction) => instruction.programId === LOADER_V3_PROGRAM_ID.toBase58());
    const expectedFreezeTag = receipt.governance.freezeTransition === "ordinary" ? 6 : 14;
    if (tag === expectedFreezeTag && slot !== freeze) fail(path, "successful freeze transition occurred outside the committed freeze slot");
    if (tag === 35 && slot !== unfreeze) fail(path, "successful unfreeze transition occurred outside the committed unfreeze slot");
    if (event.status === "succeeded" && slot === freeze && tag === expectedFreezeTag) {
      validateFreezeHistoryEvent(receipt, topLevelInstructions[controllerIndex]!, `${path}.freeze`);
      freezeEvents += 1;
    }
    if (event.status === "succeeded" && slot === unfreeze && tag === 35) {
      validateUnfreezeHistoryEvent(receipt, topLevelInstructions, controllerIndex, `${path}.unfreeze`);
      unfreezeEvents += 1;
    }
    if (tag === 31) {
      if (slot !== upgrade || loaderCpis.length !== 1 || innerInstructions.length !== 1) fail(path, "Loader Upgrade CPI is not the exact controller execution event");
      const expectedTopLevel = receipt.topLevelEnvelope.map(({ programId, dataHex, accounts }) => ({ programId, dataHex, accounts }));
      if (canonicalJson(event.topLevelInstructions, `${path}.topLevelInstructions`) !== canonicalJson(expectedTopLevel, "topLevelEnvelope")) fail(path, "upgrade history does not match the exact verified top-level envelope");
      const expectedInner = receipt.innerCpis.map(({ programId, dataHex, accounts }) => ({ programId, dataHex, accounts }));
      if (canonicalJson(loaderCpis, `${path}.loaderCpis`) !== canonicalJson(expectedInner, "innerCpis")) fail(path, "upgrade history does not match the exact verified Loader CPI");
      if (event.status === "succeeded") upgradeEvents += 1;
    } else if (loaderCpis.length > 0 && tag !== 30) {
      fail(path, "Loader CPI is not owned by a typed extension or upgrade transition");
    }
  }
  if (freezeEvents !== 1) fail("frozenHistory", "must prove one exact ordinary-freeze or emergency-conversion event");
  if (upgradeEvents !== 1) fail("frozenHistory", "must prove exactly one controller-owned Loader Upgrade CPI");
  if (unfreezeEvents !== 1) fail("frozenHistory", "must prove one exact separate governed unfreeze event");
}

function parseCanonicalTrustManifest(bytes: Buffer, path: string): Record<string, unknown> {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail(path, "manifest must be canonical UTF-8");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail(path, "manifest must be valid canonical JSON"); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") fail(path, "manifest must be a JSON object");
  if (canonicalJson(parsed, path) !== text) fail(path, "manifest JSON is not canonical or contains duplicate keys");
  return parsed as Record<string, unknown>;
}

function boundedManifestString(value: unknown, path: string, maxLength = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) fail(path, "must be a bounded nonempty string");
  return value;
}

function safeManifestPath(value: unknown, path: string): string {
  const name = boundedManifestString(value, path, 512);
  if (name.startsWith("/") || name.includes("\\") || name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) fail(path, "must be a canonical relative path");
  return name;
}

function contentInventoryRoot(
  domain: string,
  entries: readonly { name: string; sha256: string; bytes: Buffer }[],
): string {
  const littleEndianU64 = (value: bigint): Buffer => {
    const result = Buffer.alloc(8);
    result.writeBigUInt64LE(value);
    return result;
  };
  return orderedLeafRoot(domain, entries.map(({ name, sha256, bytes }, index) => sha256Hex(
    Buffer.from(`${domain}_ENTRY`, "ascii"),
    littleEndianU64(BigInt(index)),
    littleEndianU64(BigInt(Buffer.byteLength(name, "utf8"))),
    Buffer.from(name, "utf8"),
    hash32(sha256, `${domain}.entries[${index}].sha256`),
    littleEndianU64(BigInt(bytes.length)),
    bytes,
  )));
}

function parseContentInventory(
  value: unknown,
  path: string,
  domain: string,
  maxEntries: number,
): { entries: readonly { name: string; sha256: string; bytes: Buffer }[]; root: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxEntries) fail(path, "must be a bounded nonempty content inventory");
  const entries: { name: string; sha256: string; bytes: Buffer }[] = [];
  let priorName: string | null = null;
  let totalBytes = 0;
  for (const [index, rawEntry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    assertExactObjectKeys(rawEntry, ["name", "sha256", "bytesBase64"], entryPath);
    const entry = rawEntry as { name: unknown; sha256: unknown; bytesBase64: unknown };
    const name = safeManifestPath(entry.name, `${entryPath}.name`);
    if (priorName !== null && Buffer.compare(Buffer.from(priorName, "utf8"), Buffer.from(name, "utf8")) >= 0) fail(path, "entries must be strictly byte-sorted with no duplicates");
    priorName = name;
    const sha256 = boundedManifestString(entry.sha256, `${entryPath}.sha256`, 64);
    const bytes = bytesFromBase64(entry.bytesBase64, `${entryPath}.bytesBase64`, MAX_RECEIPT_TRUST_BLOB_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > MAX_RECEIPT_TRUST_BLOB_BYTES || sha256Hex(bytes) !== sha256) fail(entryPath, "content SHA-256 does not recompute or inventory exceeds its byte bound");
    entries.push({ name, sha256, bytes });
  }
  return { entries, root: contentInventoryRoot(domain, entries) };
}

function validateTypedTrustManifests(
  receipt: GovernedUpgradeReceiptV3,
  sourceCommitBytes: Buffer,
  sourceTreeBytes: Buffer,
  abiBytes: Buffer,
  buildInputBytes: Buffer,
  controllerArtifact: Buffer,
  immutabilityPlanBytes: Buffer,
): void {
  const trust = receipt.controllerTrustRoot;
  const sourceTree = parseCanonicalTrustManifest(sourceTreeBytes, "controllerTrustRoot.sourceTree");
  assertExactObjectKeys(sourceTree, ["schema", "files", "treeRoot"], "controllerTrustRoot.sourceTree");
  if (sourceTree.schema !== "amoeba-controller-source-tree-v1") fail("controllerTrustRoot.sourceTree.schema", "unknown source-tree manifest schema");
  const sourceFiles = parseContentInventory(sourceTree.files, "controllerTrustRoot.sourceTree.files", "AMOEBA_CONTROLLER_SOURCE_TREE_V1", 4096);
  if (sourceTree.treeRoot !== sourceFiles.root) fail("controllerTrustRoot.sourceTree.treeRoot", "does not recompute from the exact ordered source bytes");
  hash32(sourceTree.treeRoot, "controllerTrustRoot.sourceTree.treeRoot");

  const sourceCommit = parseCanonicalTrustManifest(sourceCommitBytes, "controllerTrustRoot.sourceCommit");
  assertExactObjectKeys(sourceCommit, ["schema", "commitId", "sourceTreeManifestSha256", "sourceTreeRoot"], "controllerTrustRoot.sourceCommit");
  if (sourceCommit.schema !== "amoeba-controller-source-commit-v1") fail("controllerTrustRoot.sourceCommit.schema", "unknown source-commit manifest schema");
  const commitId = boundedManifestString(sourceCommit.commitId, "controllerTrustRoot.sourceCommit.commitId", 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commitId)) fail("controllerTrustRoot.sourceCommit.commitId", "must be an exact lowercase Git commit identity");
  if (sourceCommit.sourceTreeManifestSha256 !== trust.sourceTree.sha256 || sourceCommit.sourceTreeRoot !== sourceTree.treeRoot) fail("controllerTrustRoot.sourceCommit", "does not bind the exact source-tree manifest and recomputed tree root");

  const abi = parseCanonicalTrustManifest(abiBytes, "controllerTrustRoot.abi");
  assertExactObjectKeys(abi, ["schema", "sourceCommitManifestSha256", "sourceTreeManifestSha256", "sourceTreeRoot", "abiSha256", "abiBytesBase64"], "controllerTrustRoot.abi");
  if (abi.schema !== "amoeba-controller-abi-manifest-v1") fail("controllerTrustRoot.abi.schema", "unknown ABI manifest schema");
  const exactAbiBytes = bytesFromBase64(abi.abiBytesBase64, "controllerTrustRoot.abi.abiBytesBase64", MAX_RECEIPT_TRUST_BLOB_BYTES);
  parseCanonicalTrustManifest(exactAbiBytes, "controllerTrustRoot.abi.abiBytesBase64");
  if (
    abi.sourceCommitManifestSha256 !== trust.sourceCommit.sha256 || abi.sourceTreeManifestSha256 !== trust.sourceTree.sha256 ||
    abi.sourceTreeRoot !== sourceTree.treeRoot || abi.abiSha256 !== sha256Hex(exactAbiBytes)
  ) fail("controllerTrustRoot.abi", "does not bind the exact source commit/tree or recomputed ABI bytes");
  hash32(abi.abiSha256, "controllerTrustRoot.abi.abiSha256");

  const build = parseCanonicalTrustManifest(buildInputBytes, "controllerTrustRoot.buildInputInventory");
  assertExactObjectKeys(build, [
    "schema", "sourceCommitManifestSha256", "sourceTreeManifestSha256", "sourceTreeRoot", "abiManifestSha256", "abiSha256",
    "controllerArtifactSha256", "toolchain", "inputs", "inputsRoot",
  ], "controllerTrustRoot.buildInputInventory");
  if (build.schema !== "amoeba-controller-build-inputs-v1") fail("controllerTrustRoot.buildInputInventory.schema", "unknown build-input manifest schema");
  assertExactObjectKeys(build.toolchain, ["rustc", "solana", "sbpfVersion"], "controllerTrustRoot.buildInputInventory.toolchain");
  const toolchain = build.toolchain as { rustc: unknown; solana: unknown; sbpfVersion: unknown };
  boundedManifestString(toolchain.rustc, "controllerTrustRoot.buildInputInventory.toolchain.rustc");
  boundedManifestString(toolchain.solana, "controllerTrustRoot.buildInputInventory.toolchain.solana");
  boundedManifestString(toolchain.sbpfVersion, "controllerTrustRoot.buildInputInventory.toolchain.sbpfVersion");
  const inputs = parseContentInventory(build.inputs, "controllerTrustRoot.buildInputInventory.inputs", "AMOEBA_CONTROLLER_BUILD_INPUTS_V1", 4096);
  if (
    build.sourceCommitManifestSha256 !== trust.sourceCommit.sha256 || build.sourceTreeManifestSha256 !== trust.sourceTree.sha256 ||
    build.sourceTreeRoot !== sourceTree.treeRoot || build.abiManifestSha256 !== trust.abi.sha256 || build.abiSha256 !== abi.abiSha256 ||
    build.controllerArtifactSha256 !== sha256Hex(controllerArtifact) || build.inputsRoot !== inputs.root
  ) fail("controllerTrustRoot.buildInputInventory", "does not bind the exact source/tree/ABI/input inventory and controller artifact");

  const plan = parseCanonicalTrustManifest(immutabilityPlanBytes, "controllerTrustRoot.immutabilityPlan");
  assertExactObjectKeys(plan, [
    "schema", "sourceCommitManifestSha256", "sourceTreeManifestSha256", "sourceTreeRoot", "abiManifestSha256", "abiSha256",
    "buildInputInventoryManifestSha256", "controllerArtifactSha256", "controllerProgram", "controllerProgramdata",
    "controllerProgramAccountSha256", "controllerProgramdataRawSha256", "controllerProgramdataAuthority", "initializationStateSha256",
    "currentControllerImmutable", "intendedFinalControllerImmutable", "status",
  ], "controllerTrustRoot.immutabilityPlan");
  if (plan.schema !== "amoeba-controller-immutability-plan-v1" || plan.status !== "readiness-only" || plan.intendedFinalControllerImmutable !== true) fail("controllerTrustRoot.immutabilityPlan", "is not the typed readiness-only controller immutability plan");
  if (
    plan.sourceCommitManifestSha256 !== trust.sourceCommit.sha256 || plan.sourceTreeManifestSha256 !== trust.sourceTree.sha256 ||
    plan.sourceTreeRoot !== sourceTree.treeRoot || plan.abiManifestSha256 !== trust.abi.sha256 || plan.abiSha256 !== abi.abiSha256 ||
    plan.buildInputInventoryManifestSha256 !== trust.buildInputInventory.sha256 || plan.controllerArtifactSha256 !== trust.controllerArtifact.sha256 ||
    plan.controllerProgram !== receipt.identities.controllerProgram || plan.controllerProgramdata !== receipt.identities.controllerProgramdata ||
    plan.controllerProgramAccountSha256 !== trust.controllerProgramAccount.sha256 || plan.controllerProgramdataRawSha256 !== trust.controllerProgramdata.rawProgramdata.sha256 ||
    plan.controllerProgramdataAuthority !== trust.controllerProgramdata.authority || plan.initializationStateSha256 !== trust.initializationState.sha256 ||
    plan.currentControllerImmutable !== trust.controllerImmutable
  ) fail("controllerTrustRoot.immutabilityPlan", "does not cross-bind the exact source/build/artifact/ProgramData/initialization trust chain");
}

function validateTrustRootAndHandoff(receipt: GovernedUpgradeReceiptV3): void {
  const trust = receipt.controllerTrustRoot;
  assertExactObjectKeys(trust, [
    "sourceCommit", "sourceTree", "abi", "buildInputInventory", "controllerArtifact", "controllerProgramOwner",
    "controllerProgramAccount", "controllerProgramdata", "initializationStateOwner", "initializationState", "initialized", "tokenGovernanceEnabled",
    "controllerImmutable", "immutabilityPlan", "productionIdentityVerified",
  ], "controllerTrustRoot");
  let totalEvidenceBytes = 0;
  const material = (blob: ReceiptContentAddressedBlobV3, path: string, allowEmpty = false): Buffer => {
    assertExactObjectKeys(blob, ["sha256", "bytesBase64"], path);
    const bytes = bytesFromBase64(blob.bytesBase64, `${path}.bytesBase64`, MAX_RECEIPT_TRUST_BLOB_BYTES);
    totalEvidenceBytes += bytes.length;
    if ((!allowEmpty && bytes.length === 0) || sha256Hex(bytes) !== blob.sha256) fail(path, "content-addressed material is empty or its SHA-256 does not recompute");
    hash32(blob.sha256, `${path}.sha256`);
    if (totalEvidenceBytes > MAX_RECEIPT_TRUST_TOTAL_BYTES) fail("controllerTrustRoot", "content-addressed evidence exceeds the total receipt bound");
    return bytes;
  };
  const sourceCommit = material(trust.sourceCommit, "controllerTrustRoot.sourceCommit");
  const sourceTree = material(trust.sourceTree, "controllerTrustRoot.sourceTree");
  const abi = material(trust.abi, "controllerTrustRoot.abi");
  const buildInputInventory = material(trust.buildInputInventory, "controllerTrustRoot.buildInputInventory");
  const controllerArtifact = material(trust.controllerArtifact, "controllerTrustRoot.controllerArtifact");
  const controllerProgramAccount = material(trust.controllerProgramAccount, "controllerTrustRoot.controllerProgramAccount");
  const initializationState = material(trust.initializationState, "controllerTrustRoot.initializationState");
  const immutabilityPlan = material(trust.immutabilityPlan, "controllerTrustRoot.immutabilityPlan");
  validateTypedTrustManifests(receipt, sourceCommit, sourceTree, abi, buildInputInventory, controllerArtifact, immutabilityPlan);
  if (trust.initialized !== true || trust.tokenGovernanceEnabled !== false) fail("controllerTrustRoot", "controller initialization or disabled token-governance proof is absent");
  const controller = pubkey(receipt.identities.controllerProgram, "identities.controllerProgram");
  if (receipt.production) {
    if (controller.equals(PublicKey.default) || controller.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1) || trust.productionIdentityVerified !== true || trust.controllerImmutable !== true) fail("controllerTrustRoot", "production receipt requires a non-synthetic independently verified immutable controller");
  }
  if (!pubkey(receipt.identities.upgradeableLoader, "identities.upgradeableLoader").equals(LOADER_V3_PROGRAM_ID)) fail("identities.upgradeableLoader", "wrong Upgradeable Loader identity");
  if (!/^[0-9a-f]{64}$/u.test(receipt.identities.clusterDomainHex)) fail("identities.clusterDomainHex", "must be a lowercase 32-byte cluster domain");
  for (const [field, value] of Object.entries(receipt.identities)) if (field !== "clusterDomainHex") pubkey(value, `identities.${field}`);

  if (!pubkey(trust.controllerProgramOwner, "controllerTrustRoot.controllerProgramOwner").equals(LOADER_V3_PROGRAM_ID)) fail("controllerTrustRoot.controllerProgramOwner", "controller Program account is not Loader-v3-owned");
  if (controllerProgramAccount.length !== 36 || controllerProgramAccount.readUInt32LE(0) !== 2) fail("controllerTrustRoot.controllerProgramAccount", "is not the exact Upgradeable Loader Program account layout");
  const linkedProgramdata = new PublicKey(controllerProgramAccount.subarray(4, 36));
  const controllerProgramdata = pubkey(receipt.identities.controllerProgramdata, "identities.controllerProgramdata");
  if (!linkedProgramdata.equals(controllerProgramdata) || !deriveUpgradeableProgramdataAddress(controller)[0].equals(controllerProgramdata)) fail("controllerTrustRoot.controllerProgramAccount", "controller Program/ProgramData linkage is not canonical");

  const deployed = trust.controllerProgramdata;
  assertExactObjectKeys(deployed, ["owner", "deployedSlot", "capacity", "authority", "zeroTailRequired", "rawProgramdata"], "controllerTrustRoot.controllerProgramdata");
  if (!pubkey(deployed.owner, "controllerTrustRoot.controllerProgramdata.owner").equals(LOADER_V3_PROGRAM_ID)) fail("controllerTrustRoot.controllerProgramdata.owner", "controller ProgramData is not Loader-v3-owned");
  const rawControllerProgramdata = material(deployed.rawProgramdata, "controllerTrustRoot.controllerProgramdata.rawProgramdata");
  const controllerCapacity = u64(deployed.capacity, "controllerTrustRoot.controllerProgramdata.capacity");
  if (controllerCapacity < BigInt(controllerArtifact.length) || controllerCapacity > BigInt(MAX_RECEIPT_PROGRAMDATA_CAPACITY) || rawControllerProgramdata.length !== RECEIPT_PROGRAMDATA_HEADER_LENGTH + Number(controllerCapacity)) fail("controllerTrustRoot.controllerProgramdata", "controller ProgramData capacity or raw length is invalid");
  if (rawControllerProgramdata.readUInt32LE(0) !== 3 || rawControllerProgramdata.readBigUInt64LE(4) !== u64(deployed.deployedSlot, "controllerTrustRoot.controllerProgramdata.deployedSlot")) fail("controllerTrustRoot.controllerProgramdata", "controller ProgramData header or deployed slot is invalid");
  let deployedAuthority: PublicKey | null;
  if (rawControllerProgramdata[12] === 0) {
    if (rawControllerProgramdata.subarray(13, 45).some((byte) => byte !== 0) || deployed.authority !== null) fail("controllerTrustRoot.controllerProgramdata.authority", "immutable controller authority header is malformed");
    deployedAuthority = null;
  } else if (rawControllerProgramdata[12] === 1) {
    deployedAuthority = new PublicKey(rawControllerProgramdata.subarray(13, 45));
    if (!deployedAuthority.equals(pubkey(deployed.authority, "controllerTrustRoot.controllerProgramdata.authority"))) fail("controllerTrustRoot.controllerProgramdata.authority", "does not match the raw ProgramData header");
  } else {
    fail("controllerTrustRoot.controllerProgramdata.authority", "invalid ProgramData authority option");
  }
  if (trust.controllerImmutable !== (deployedAuthority === null)) fail("controllerTrustRoot.controllerImmutable", "does not match the mechanical ProgramData authority state");
  const deployedControllerPayload = rawControllerProgramdata.subarray(RECEIPT_PROGRAMDATA_HEADER_LENGTH, RECEIPT_PROGRAMDATA_HEADER_LENGTH + controllerArtifact.length);
  const deployedControllerTail = rawControllerProgramdata.subarray(RECEIPT_PROGRAMDATA_HEADER_LENGTH + controllerArtifact.length);
  if (!deployedControllerPayload.equals(controllerArtifact) || deployed.zeroTailRequired !== true || deployedControllerTail.some((byte) => byte !== 0)) fail("controllerTrustRoot.controllerProgramdata", "controller payload or zero tail does not match the content-addressed artifact");

  let config: ReturnType<typeof deserializeControllerConfigV1>;
  if (!pubkey(trust.initializationStateOwner, "controllerTrustRoot.initializationStateOwner").equals(controller)) fail("controllerTrustRoot.initializationStateOwner", "controller config evidence is not controller-owned");
  try {
    config = deserializeControllerConfigV1(initializationState);
  } catch {
    return fail("controllerTrustRoot.initializationState", "is not a canonical ControllerConfigV1 account");
  }
  const target = pubkey(receipt.identities.targetProgram, "identities.targetProgram");
  const [expectedConfig, expectedConfigBump] = deriveControllerConfigPda(controller, target);
  const expectedAuthority = deriveAuthorityPda(controller, target)[0];
  const expectedGate = deriveGatePda(controller, target)[0];
  const expectedPolicy = derivePolicyPda(controller, target, config.currentPolicyVersion)[0];
  const expectedCouncil = deriveCouncilPda(controller, target, config.currentCouncilVersion)[0];
  if (
    !expectedConfig.equals(pubkey(receipt.identities.controllerConfig, "identities.controllerConfig")) ||
    !expectedAuthority.equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda")) ||
    !expectedGate.equals(pubkey(receipt.identities.protocolGate, "identities.protocolGate")) ||
    !expectedPolicy.equals(pubkey(receipt.identities.policy, "identities.policy")) ||
    !expectedCouncil.equals(pubkey(receipt.identities.council, "identities.council")) ||
    config.bump !== expectedConfigBump ||
    !config.clusterDomain.equals(hash32(receipt.identities.clusterDomainHex, "identities.clusterDomainHex")) ||
    !config.targetProgram.equals(target) ||
    !config.targetProgramdata.equals(deriveUpgradeableProgramdataAddress(target)[0]) ||
    !config.targetProgramdata.equals(pubkey(receipt.identities.targetProgramdata, "identities.targetProgramdata")) ||
    !config.upgradeableLoader.equals(LOADER_V3_PROGRAM_ID) ||
    !config.authorityPda.equals(expectedAuthority) ||
    !config.gatePda.equals(expectedGate) ||
    !config.canonicalSpillTreasury.equals(pubkey(receipt.identities.canonicalSpillTreasury, "identities.canonicalSpillTreasury")) ||
    config.currentPolicyVersion !== u64(receipt.governance.policyVersion, "governance.policyVersion") ||
    config.currentCouncilVersion !== u64(receipt.governance.currentCouncilVersion, "governance.currentCouncilVersion") ||
    config.tokenGovernanceEnabled || !config.voteProgram.equals(PublicKey.default) || !config.voteProgramdata.equals(PublicKey.default) ||
    !config.voteConfig.equals(PublicKey.default) || !config.voteMint.equals(PublicKey.default)
  ) fail("controllerTrustRoot.initializationState", "decoded initialization/config identities do not match the receipt trust root");

  const handoff = receipt.handoff;
  assertExactObjectKeys(handoff, ["performed", "simulated", "authorityBefore", "authorityAfter", "oldAuthority", "oldAuthorityRejection"], "handoff");
  if (typeof handoff.performed !== "boolean" || typeof handoff.simulated !== "boolean") fail("handoff", "mode flags must be booleans");
  if (handoff.performed === handoff.simulated) fail("handoff", "must prove exactly one of performed or simulated handoff mode");
  const after = pubkey(handoff.authorityAfter, "handoff.authorityAfter");
  if (!after.equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda")) || !after.equals(pubkey(receipt.programdata.authority, "programdata.authority"))) fail("handoff.authorityAfter", "controller authority is not retained");
  const oldAuthority = pubkey(handoff.oldAuthority, "handoff.oldAuthority");
  const authorityBefore = pubkey(handoff.authorityBefore, "handoff.authorityBefore");
  if (!oldAuthority.equals(authorityBefore) || oldAuthority.equals(after)) fail("handoff", "old external authority graph is not exact or distinct from the controller PDA");

  const rejection = handoff.oldAuthorityRejection;
  assertExactObjectKeys(rejection, ["query", "programdataAuthority", "transaction", "deterministicIdentity"], "handoff.oldAuthorityRejection");
  const query = rejection.query;
  assertExactObjectKeys(query, [
    "commitment", "clusterDomainHex", "slot", "signatureHex", "targetProgram", "targetProgramdata", "controllerAuthority",
    "oldAuthority", "attemptedBuffer", "spillTreasury", "queryIdentity",
  ], "handoff.oldAuthorityRejection.query");
  if (query.commitment !== "finalized" || query.clusterDomainHex !== receipt.identities.clusterDomainHex) fail("handoff.oldAuthorityRejection.query", "must bind the exact finalized cluster domain");
  if (u64(query.slot, "handoff.oldAuthorityRejection.query.slot") <= u64(receipt.governance.unfreezeSlot, "governance.unfreezeSlot")) fail("handoff.oldAuthorityRejection.query.slot", "old-authority rejection must occur after governed unfreeze and handoff");
  bytesFromHex(query.signatureHex, "handoff.oldAuthorityRejection.query.signatureHex", 64);
  const exactQueryKeys: readonly [keyof ReceiptOldAuthorityRejectionQueryV3, string][] = [
    ["targetProgram", receipt.identities.targetProgram], ["targetProgramdata", receipt.identities.targetProgramdata],
    ["controllerAuthority", receipt.identities.authorityPda], ["oldAuthority", handoff.oldAuthority],
    ["spillTreasury", receipt.identities.canonicalSpillTreasury],
  ];
  exactQueryKeys.forEach(([field, expected]) => {
    if (pubkey(query[field] as string, `handoff.oldAuthorityRejection.query.${field}`).toBase58() !== expected) fail(`handoff.oldAuthorityRejection.query.${field}`, "does not match the exact handoff identity");
  });
  const attemptedBuffer = pubkey(query.attemptedBuffer, "handoff.oldAuthorityRejection.query.attemptedBuffer");
  if (attemptedBuffer.equals(PublicKey.default) || attemptedBuffer.equals(pubkey(receipt.identities.buffer, "identities.buffer"))) fail("handoff.oldAuthorityRejection.query.attemptedBuffer", "must be a distinct nondefault sacrificial Loader buffer");
  const { queryIdentity: _oldAuthorityQueryIdentity, ...queryMaterial } = query;
  if (oldAuthorityRejectionQueryIdentityV3(queryMaterial) !== query.queryIdentity) fail("handoff.oldAuthorityRejection.query.queryIdentity", "does not recompute from the exact failed-attempt query");
  hash32(query.queryIdentity, "handoff.oldAuthorityRejection.query.queryIdentity");
  if (!pubkey(rejection.programdataAuthority, "handoff.oldAuthorityRejection.programdataAuthority").equals(after)) fail("handoff.oldAuthorityRejection.programdataAuthority", "authority graph does not retain the controller PDA");

  const transaction = rejection.transaction;
  assertExactObjectKeys(transaction, [
    "slot", "blockHash", "blockTimeUnix", "transactionIndex", "signatureHex", "messageSha256", "metaSha256", "status",
    "errorSha256", "topLevelInstructions", "innerInstructionGroups",
  ], "handoff.oldAuthorityRejection.transaction");
  if (transaction.slot !== query.slot || transaction.signatureHex !== query.signatureHex) fail("handoff.oldAuthorityRejection.transaction", "slot or signature does not match the exact finalized query");
  hash32(transaction.blockHash, "handoff.oldAuthorityRejection.transaction.blockHash");
  u64(transaction.blockTimeUnix, "handoff.oldAuthorityRejection.transaction.blockTimeUnix");
  integer(transaction.transactionIndex, 0, 0xffff_ffff, "handoff.oldAuthorityRejection.transaction.transactionIndex");
  hash32(transaction.messageSha256, "handoff.oldAuthorityRejection.transaction.messageSha256");
  hash32(transaction.metaSha256, "handoff.oldAuthorityRejection.transaction.metaSha256");
  if (transaction.status !== "failed" || hash32(transaction.errorSha256, "handoff.oldAuthorityRejection.transaction.errorSha256").equals(Buffer.alloc(32))) fail("handoff.oldAuthorityRejection.transaction", "must be a source-identifiable failed transaction with a nonzero error hash");
  if (!Array.isArray(transaction.innerInstructionGroups) || transaction.innerInstructionGroups.length !== 0) fail("handoff.oldAuthorityRejection.transaction.innerInstructionGroups", "failed direct Loader attempt must not claim inner CPI execution");
  if (!Array.isArray(transaction.topLevelInstructions) || transaction.topLevelInstructions.length !== 1) fail("handoff.oldAuthorityRejection.transaction.topLevelInstructions", "must contain exactly one direct Loader Upgrade attempt");
  const upgradeAttempt = transaction.topLevelInstructions[0]!;
  validateHistoryInstruction(upgradeAttempt, "handoff.oldAuthorityRejection.transaction.topLevelInstructions[0]");
  if (upgradeAttempt.programId !== LOADER_V3_PROGRAM_ID.toBase58() || upgradeAttempt.dataHex !== "03000000") fail("handoff.oldAuthorityRejection.transaction.topLevelInstructions[0]", "is not the exact direct Upgradeable Loader Upgrade instruction");
  const expectedAccounts: readonly [string, boolean, boolean][] = [
    [receipt.identities.targetProgramdata, false, true], [receipt.identities.targetProgram, false, true], [query.attemptedBuffer, false, true],
    [receipt.identities.canonicalSpillTreasury, false, true], [RENT_SYSVAR_ID.toBase58(), false, false], [CLOCK_SYSVAR_ID.toBase58(), false, false],
    [handoff.oldAuthority, true, false],
  ];
  if (upgradeAttempt.accounts.length !== expectedAccounts.length) fail("handoff.oldAuthorityRejection.transaction.topLevelInstructions[0].accounts", "direct Loader Upgrade account count mismatch");
  expectedAccounts.forEach(([key, signer, writable], index) => exactMeta(upgradeAttempt.accounts[index]!, key, signer, writable, `handoff.oldAuthorityRejection.transaction.topLevelInstructions[0].accounts[${index}]`));
  if (oldAuthorityRejectionIdentityV3(query, rejection.programdataAuthority, transaction) !== rejection.deterministicIdentity) fail("handoff.oldAuthorityRejection.deterministicIdentity", "does not recompute from the exact authority graph and failed transaction");
  hash32(rejection.deterministicIdentity, "handoff.oldAuthorityRejection.deterministicIdentity");
}

function preflightEncodedLength(value: unknown, maxBytes: number, path: string, encoding: "base64" | "hex"): number {
  if (typeof value !== "string") fail(path, `must be ${encoding}`);
  const maximumCharacters = encoding === "hex" ? maxBytes * 2 : Math.ceil(maxBytes / 3) * 4;
  if (value.length > maximumCharacters) fail(path, "exceeds the preflight receipt byte bound");
  return value.length;
}

function preflightReceiptEvidenceBounds(receipt: GovernedUpgradeReceiptV3): void {
  preflightEncodedLength(receipt.buffer?.artifactBytesBase64, MAX_ARTIFACT_BYTES_V1, "buffer.artifactBytesBase64", "base64");
  preflightEncodedLength(receipt.programdata?.rawProgramdataBytesBase64, MAX_RECEIPT_PROGRAMDATA_CAPACITY + RECEIPT_PROGRAMDATA_HEADER_LENGTH, "programdata.rawProgramdataBytesBase64", "base64");
  assertExactObjectKeys(receipt.state, ["prestate", "poststate", "externalPrestate", "externalPoststate"], "state");
  for (const [name, set] of [["externalPrestate", receipt.state?.externalPrestate], ["externalPoststate", receipt.state?.externalPoststate]] as const) {
    assertExactObjectKeys(set, ["context", "accounts"], `state.${name}`);
    if (!Array.isArray(set?.accounts) || set.accounts.length > MAX_RECEIPT_EXTERNAL_ACCOUNTS) fail(`state.${name}.accounts`, "exceeds the preflight external inventory bound");
    let encodedBytes = 0;
    for (const [index, observation] of set.accounts.entries()) {
      assertExactObjectKeys(observation, [
        "account", "owner", "executable", "lamports", "dataLength", "dataSha256", "dataBase64", "assetKind",
        "tokenProgram", "mint", "authority", "tokenState", "rawTokenAmount", "normalizedSemanticSha256",
      ], `state.${name}.accounts[${index}]`);
      if (observation.dataBase64 !== null) encodedBytes += preflightEncodedLength(observation.dataBase64, MAX_RECEIPT_INLINE_ACCOUNT_DATA_BYTES, `state.${name}.accounts[${index}].dataBase64`, "base64");
    }
    if (encodedBytes > Math.ceil(MAX_RECEIPT_EXTERNAL_INLINE_BYTES / 3) * 4 + set.accounts.length * 3) fail(`state.${name}.accounts`, "exceeds the preflight total inline-data bound");
  }
  const history = receipt.frozenHistory;
  assertExactObjectKeys(history, ["query", "transactions", "inventoryRoot"], "frozenHistory");
  assertExactObjectKeys(history?.query, ["commitment", "clusterDomainHex", "startSlot", "endSlot", "matchMode", "includeFailed", "addresses", "queryIdentity"], "frozenHistory.query");
  if (!Array.isArray(history?.transactions) || history.transactions.length > MAX_RECEIPT_HISTORY_TRANSACTIONS) fail("frozenHistory.transactions", "exceeds the preflight transaction bound");
  for (const [transactionIndex, transaction] of history.transactions.entries()) {
    assertExactObjectKeys(transaction, [
      "slot", "blockHash", "blockTimeUnix", "transactionIndex", "signatureHex", "messageSha256", "metaSha256", "status",
      "errorSha256", "topLevelInstructions", "innerInstructionGroups",
    ], `frozenHistory.transactions[${transactionIndex}]`);
    if (!Array.isArray(transaction.topLevelInstructions) || transaction.topLevelInstructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`frozenHistory.transactions[${transactionIndex}].topLevelInstructions`, "exceeds the preflight instruction bound");
    for (const [instructionIndex, instruction] of transaction.topLevelInstructions.entries()) {
      assertExactObjectKeys(instruction, ["programId", "dataHex", "accounts"], `frozenHistory.transactions[${transactionIndex}].topLevelInstructions[${instructionIndex}]`);
      preflightEncodedLength(instruction.dataHex, MAX_RECEIPT_INSTRUCTION_DATA_BYTES, `frozenHistory.transactions[${transactionIndex}].topLevelInstructions[${instructionIndex}].dataHex`, "hex");
      if (!Array.isArray(instruction.accounts) || instruction.accounts.length > MAX_RECEIPT_HISTORY_ACCOUNTS) fail(`frozenHistory.transactions[${transactionIndex}].topLevelInstructions[${instructionIndex}].accounts`, "exceeds the preflight account-vector bound");
      instruction.accounts.forEach((account: ReceiptAccountMetaV3, accountIndex: number) => assertExactObjectKeys(account, ["pubkey", "isSigner", "isWritable"], `frozenHistory.transactions[${transactionIndex}].topLevelInstructions[${instructionIndex}].accounts[${accountIndex}]`));
    }
    if (!Array.isArray(transaction.innerInstructionGroups) || transaction.innerInstructionGroups.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`frozenHistory.transactions[${transactionIndex}].innerInstructionGroups`, "exceeds the preflight inner-group bound");
    for (const [groupIndex, group] of transaction.innerInstructionGroups.entries()) {
      assertExactObjectKeys(group, ["topLevelInstructionIndex", "instructions"], `frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}]`);
      if (!Array.isArray(group.instructions) || group.instructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}]`, "exceeds the preflight inner-instruction bound");
      for (const [instructionIndex, instruction] of group.instructions.entries()) {
        assertExactObjectKeys(instruction, ["programId", "dataHex", "accounts"], `frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}].instructions[${instructionIndex}]`);
        preflightEncodedLength(instruction.dataHex, MAX_RECEIPT_INSTRUCTION_DATA_BYTES, `frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}].instructions[${instructionIndex}].dataHex`, "hex");
        if (!Array.isArray(instruction.accounts) || instruction.accounts.length > MAX_RECEIPT_HISTORY_ACCOUNTS) fail(`frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}].instructions[${instructionIndex}].accounts`, "exceeds the preflight account-vector bound");
        instruction.accounts.forEach((account: ReceiptAccountMetaV3, accountIndex: number) => assertExactObjectKeys(account, ["pubkey", "isSigner", "isWritable"], `frozenHistory.transactions[${transactionIndex}].innerInstructionGroups[${groupIndex}].instructions[${instructionIndex}].accounts[${accountIndex}]`));
      }
    }
  }
  const finalizedAccounts = receipt.finalizedAccounts;
  assertExactObjectKeys(finalizedAccounts, ["query", "snapshots", "inventoryRoot"], "finalizedAccounts");
  assertExactObjectKeys(finalizedAccounts.query, ["context", "accounts", "queryIdentity"], "finalizedAccounts.query");
  assertExactObjectKeys(finalizedAccounts.query.context, ["commitment", "clusterDomainHex", "slot", "blockHash", "blockTimeUnix"], "finalizedAccounts.query.context");
  if (!Array.isArray(finalizedAccounts.query.accounts) || finalizedAccounts.query.accounts.length > RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.length) fail("finalizedAccounts.query.accounts", "exceeds the preflight finalized-account query bound");
  finalizedAccounts.query.accounts.forEach((account: { role: ReceiptFinalizedAccountRoleV3; pubkey: string }, index: number) => assertExactObjectKeys(account, ["role", "pubkey"], `finalizedAccounts.query.accounts[${index}]`));
  if (!Array.isArray(finalizedAccounts.snapshots) || finalizedAccounts.snapshots.length > RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.length) fail("finalizedAccounts.snapshots", "exceeds the preflight finalized-account inventory bound");
  let finalizedEncodedCharacters = 0;
  finalizedAccounts.snapshots.forEach((snapshot, index) => {
    const path = `finalizedAccounts.snapshots[${index}]`;
    assertExactObjectKeys(snapshot, ["role", "pubkey", "exists", "owner", "executable", "lamports", "dataLength", "dataSha256", "dataBase64"], path);
    if (snapshot.dataBase64 !== null) finalizedEncodedCharacters += preflightEncodedLength(snapshot.dataBase64, MAX_RECEIPT_TRUST_BLOB_BYTES, `${path}.dataBase64`, "base64");
  });
  if (finalizedEncodedCharacters > Math.ceil(MAX_RECEIPT_TRUST_TOTAL_BYTES / 3) * 4 + finalizedAccounts.snapshots.length * 3) fail("finalizedAccounts.snapshots", "exceeds the preflight total finalized-account byte bound");

  const handoff = receipt.handoff;
  assertExactObjectKeys(handoff, ["performed", "simulated", "authorityBefore", "authorityAfter", "oldAuthority", "oldAuthorityRejection"], "handoff");
  const rejection = handoff.oldAuthorityRejection;
  assertExactObjectKeys(rejection, ["query", "programdataAuthority", "transaction", "deterministicIdentity"], "handoff.oldAuthorityRejection");
  assertExactObjectKeys(rejection.query, [
    "commitment", "clusterDomainHex", "slot", "signatureHex", "targetProgram", "targetProgramdata", "controllerAuthority",
    "oldAuthority", "attemptedBuffer", "spillTreasury", "queryIdentity",
  ], "handoff.oldAuthorityRejection.query");
  const rejectedTransaction = rejection.transaction;
  assertExactObjectKeys(rejectedTransaction, [
    "slot", "blockHash", "blockTimeUnix", "transactionIndex", "signatureHex", "messageSha256", "metaSha256", "status",
    "errorSha256", "topLevelInstructions", "innerInstructionGroups",
  ], "handoff.oldAuthorityRejection.transaction");
  if (!Array.isArray(rejectedTransaction.topLevelInstructions) || rejectedTransaction.topLevelInstructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail("handoff.oldAuthorityRejection.transaction.topLevelInstructions", "exceeds the preflight instruction bound");
  rejectedTransaction.topLevelInstructions.forEach((instruction: ReceiptHistoryInstructionV3, instructionIndex: number) => {
    const path = `handoff.oldAuthorityRejection.transaction.topLevelInstructions[${instructionIndex}]`;
    assertExactObjectKeys(instruction, ["programId", "dataHex", "accounts"], path);
    preflightEncodedLength(instruction.dataHex, MAX_RECEIPT_INSTRUCTION_DATA_BYTES, `${path}.dataHex`, "hex");
    if (!Array.isArray(instruction.accounts) || instruction.accounts.length > MAX_RECEIPT_HISTORY_ACCOUNTS) fail(`${path}.accounts`, "exceeds the preflight account-vector bound");
    instruction.accounts.forEach((account: ReceiptAccountMetaV3, accountIndex: number) => assertExactObjectKeys(account, ["pubkey", "isSigner", "isWritable"], `${path}.accounts[${accountIndex}]`));
  });
  if (!Array.isArray(rejectedTransaction.innerInstructionGroups) || rejectedTransaction.innerInstructionGroups.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail("handoff.oldAuthorityRejection.transaction.innerInstructionGroups", "exceeds the preflight inner-group bound");
  rejectedTransaction.innerInstructionGroups.forEach((group: ReceiptHistoryInnerInstructionGroupV3, groupIndex: number) => {
    const path = `handoff.oldAuthorityRejection.transaction.innerInstructionGroups[${groupIndex}]`;
    assertExactObjectKeys(group, ["topLevelInstructionIndex", "instructions"], path);
    if (!Array.isArray(group.instructions) || group.instructions.length > MAX_RECEIPT_HISTORY_INSTRUCTIONS) fail(`${path}.instructions`, "exceeds the preflight inner-instruction bound");
    group.instructions.forEach((instruction: ReceiptHistoryInstructionV3, instructionIndex: number) => {
      const instructionPath = `${path}.instructions[${instructionIndex}]`;
      assertExactObjectKeys(instruction, ["programId", "dataHex", "accounts"], instructionPath);
      preflightEncodedLength(instruction.dataHex, MAX_RECEIPT_INSTRUCTION_DATA_BYTES, `${instructionPath}.dataHex`, "hex");
      if (!Array.isArray(instruction.accounts) || instruction.accounts.length > MAX_RECEIPT_HISTORY_ACCOUNTS) fail(`${instructionPath}.accounts`, "exceeds the preflight account-vector bound");
    });
  });
  const trust = receipt.controllerTrustRoot;
  assertExactObjectKeys(trust, [
    "sourceCommit", "sourceTree", "abi", "buildInputInventory", "controllerArtifact", "controllerProgramOwner",
    "controllerProgramAccount", "controllerProgramdata", "initializationStateOwner", "initializationState", "initialized", "tokenGovernanceEnabled",
    "controllerImmutable", "immutabilityPlan", "productionIdentityVerified",
  ], "controllerTrustRoot");
  const blobs: readonly [string, ReceiptContentAddressedBlobV3 | undefined][] = [
    ["sourceCommit", trust?.sourceCommit], ["sourceTree", trust?.sourceTree], ["abi", trust?.abi],
    ["buildInputInventory", trust?.buildInputInventory], ["controllerArtifact", trust?.controllerArtifact],
    ["controllerProgramAccount", trust?.controllerProgramAccount], ["initializationState", trust?.initializationState],
    ["immutabilityPlan", trust?.immutabilityPlan], ["controllerProgramdata.rawProgramdata", trust?.controllerProgramdata?.rawProgramdata],
  ];
  let trustEncodedCharacters = 0;
  for (const [name, blob] of blobs) {
    assertExactObjectKeys(blob, ["sha256", "bytesBase64"], `controllerTrustRoot.${name}`);
    trustEncodedCharacters += preflightEncodedLength(blob?.bytesBase64, MAX_RECEIPT_TRUST_BLOB_BYTES, `controllerTrustRoot.${name}.bytesBase64`, "base64");
  }
  if (trustEncodedCharacters > Math.ceil(MAX_RECEIPT_TRUST_TOTAL_BYTES / 3) * 4 + blobs.length * 3) fail("controllerTrustRoot", "exceeds the preflight total content-evidence bound");
}

export function verifyGovernedUpgradeReceiptV3(input: unknown): GovernedUpgradeReceiptV3Verification {
  if (input === null || Array.isArray(input) || typeof input !== "object") return fail("receipt", "must be an object");
  assertExactObjectKeys(input, [
    "schema", "version", "production", "identities", "topLevelEnvelope", "innerCpis", "governance", "buffer", "programdata", "state",
    "frozenHistory", "finalizedAccounts", "controllerTrustRoot", "handoff", "receiptDigest",
  ], "receipt");
  const receipt = input as GovernedUpgradeReceiptV3;
  if (receipt.schema !== GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA || receipt.version !== GOVERNED_UPGRADE_RECEIPT_V3_VERSION) fail("receipt", "unknown receipt schema or version");
  if (typeof receipt.production !== "boolean") fail("receipt.production", "must be a boolean");
  if (receipt.production) fail("receipt.production", "the predeployment-r4 schema cannot assert a production trust root");
  preflightReceiptEvidenceBounds(receipt);
  hash32(receipt.receiptDigest, "receipt.receiptDigest");
  const { receiptDigest: _receiptDigest, ...material } = receipt;
  const recomputed = governedUpgradeReceiptDigestV3(material as GovernedUpgradeReceiptV3Material);
  if (recomputed !== receipt.receiptDigest) fail("receipt.receiptDigest", "deterministic receipt digest mismatch");
  const decoded = validateEnvelope(receipt);
  validateInnerCpi(receipt);
  validateGovernance(receipt, decoded);
  const artifact = validateBuffer(receipt);
  validateProgramData(receipt, artifact);
  const donations = validateState(receipt);
  validateHistory(receipt);
  validateFinalizedAccounts(receipt);
  validateTrustRootAndHandoff(receipt);
  return {
    valid: true,
    receiptDigest: receipt.receiptDigest,
    artifactSha256: receipt.buffer.artifactSha256,
    rawProgramdataSha256: receipt.programdata.rawProgramdataSha256,
    admittedDonationCount: donations.length,
    finalizedSourceVerification: "receipt-evidence-only",
  };
}

export async function verifyGovernedUpgradeReceiptV3AgainstFinalizedSource(
  input: unknown,
  reader: ReceiptFinalizedSourceReaderV3,
): Promise<GovernedUpgradeReceiptV3Verification> {
  const verified = verifyGovernedUpgradeReceiptV3(input);
  const receipt = input as GovernedUpgradeReceiptV3;
  if (
    reader === null || typeof reader !== "object" ||
    typeof reader.readFinalizedFrozenHistory !== "function" ||
    typeof reader.readFinalizedAccountSnapshots !== "function" ||
    typeof reader.readFinalizedOldAuthorityRejection !== "function"
  ) fail("finalizedSourceReader", "must provide every injected read-only finalized history, account, and rejection API");
  const historyQuery = JSON.parse(canonicalJson(receipt.frozenHistory.query, "frozenHistory.query")) as ReceiptFrozenHistoryQueryV3;
  const accountQuery = JSON.parse(canonicalJson(receipt.finalizedAccounts.query, "finalizedAccounts.query")) as ReceiptFinalizedAccountQueryV3;
  const rejectionQuery = JSON.parse(canonicalJson(receipt.handoff.oldAuthorityRejection.query, "handoff.oldAuthorityRejection.query")) as ReceiptOldAuthorityRejectionQueryV3;
  const [observedHistory, observedAccounts, observedRejection] = await Promise.all([
    reader.readFinalizedFrozenHistory(Object.freeze(historyQuery)),
    reader.readFinalizedAccountSnapshots(Object.freeze(accountQuery)),
    reader.readFinalizedOldAuthorityRejection(Object.freeze(rejectionQuery)),
  ]);
  if (observedHistory === null || Array.isArray(observedHistory) || typeof observedHistory !== "object") fail("finalizedHistoryRead", "reader returned a malformed result");
  assertExactObjectKeys(observedHistory, ["clusterDomainHex", "startSlot", "endSlot", "transactions"], "finalizedHistoryRead");
  if (
    observedHistory.clusterDomainHex !== receipt.frozenHistory.query.clusterDomainHex ||
    observedHistory.startSlot !== receipt.frozenHistory.query.startSlot ||
    observedHistory.endSlot !== receipt.frozenHistory.query.endSlot
  ) fail("finalizedHistoryRead", "cluster or frozen-interval identity drifted from the receipt query");
  if (!Array.isArray(observedHistory.transactions) || observedHistory.transactions.length > MAX_RECEIPT_HISTORY_TRANSACTIONS) fail("finalizedHistoryRead.transactions", "reader returned an oversized transaction inventory");
  preflightReceiptEvidenceBounds({
    ...receipt,
    frozenHistory: { ...receipt.frozenHistory, transactions: observedHistory.transactions },
  });
  if (
    frozenHistoryInventoryRootV3(observedHistory.transactions) !== receipt.frozenHistory.inventoryRoot ||
    canonicalJson(observedHistory.transactions, "finalizedHistoryRead.transactions") !== canonicalJson(receipt.frozenHistory.transactions, "frozenHistory.transactions")
  ) fail("finalizedHistoryRead.transactions", "finalized inventory has an omission, addition, reordering, or content drift");

  if (observedAccounts === null || Array.isArray(observedAccounts) || typeof observedAccounts !== "object") fail("finalizedAccountRead", "reader returned a malformed result");
  assertExactObjectKeys(observedAccounts, ["context", "snapshots"], "finalizedAccountRead");
  if (
    canonicalJson(observedAccounts.context, "finalizedAccountRead.context") !== canonicalJson(receipt.finalizedAccounts.query.context, "finalizedAccounts.query.context")
  ) fail("finalizedAccountRead.context", "cluster, slot, or finalized block identity drifted from the receipt query");
  if (!Array.isArray(observedAccounts.snapshots) || observedAccounts.snapshots.length > RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.length) fail("finalizedAccountRead.snapshots", "reader returned an oversized account inventory");
  preflightReceiptEvidenceBounds({
    ...receipt,
    finalizedAccounts: { ...receipt.finalizedAccounts, snapshots: observedAccounts.snapshots },
  });
  if (
    finalizedAccountInventoryRootV3(observedAccounts.snapshots) !== receipt.finalizedAccounts.inventoryRoot ||
    canonicalJson(observedAccounts.snapshots, "finalizedAccountRead.snapshots") !== canonicalJson(receipt.finalizedAccounts.snapshots, "finalizedAccounts.snapshots")
  ) fail("finalizedAccountRead.snapshots", "finalized account inventory has an omission, addition, reordering, or content drift");

  if (observedRejection === null || Array.isArray(observedRejection) || typeof observedRejection !== "object") fail("finalizedOldAuthorityRejectionRead", "reader returned a malformed result");
  assertExactObjectKeys(observedRejection, ["clusterDomainHex", "slot", "programdataAuthority", "transaction"], "finalizedOldAuthorityRejectionRead");
  if (
    observedRejection.clusterDomainHex !== rejectionQuery.clusterDomainHex || observedRejection.slot !== rejectionQuery.slot ||
    pubkey(observedRejection.programdataAuthority, "finalizedOldAuthorityRejectionRead.programdataAuthority").toBase58() !== receipt.handoff.oldAuthorityRejection.programdataAuthority
  ) fail("finalizedOldAuthorityRejectionRead", "cluster, slot, or ProgramData authority graph drifted from the rejection query");
  preflightReceiptEvidenceBounds({
    ...receipt,
    handoff: {
      ...receipt.handoff,
      oldAuthorityRejection: { ...receipt.handoff.oldAuthorityRejection, transaction: observedRejection.transaction },
    },
  });
  if (
    canonicalJson(observedRejection.transaction, "finalizedOldAuthorityRejectionRead.transaction") !== canonicalJson(receipt.handoff.oldAuthorityRejection.transaction, "handoff.oldAuthorityRejection.transaction") ||
    oldAuthorityRejectionIdentityV3(rejectionQuery, observedRejection.programdataAuthority, observedRejection.transaction) !== receipt.handoff.oldAuthorityRejection.deterministicIdentity
  ) fail("finalizedOldAuthorityRejectionRead.transaction", "failed old-authority transaction has an omission, addition, reordering, or authority-graph drift");
  return { ...verified, finalizedSourceVerification: "finalized-source-requeried" };
}

export async function verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(
  input: unknown,
  reader: ReceiptFinalizedHistoryReaderV3,
): Promise<GovernedUpgradeReceiptV3Verification> {
  return verifyGovernedUpgradeReceiptV3AgainstFinalizedSource(input, reader);
}

// Kept as an explicit exported identity so package consumers can assert the
// receipt verifier is wired to the separate checkpoint-attestation domain.
export const RECEIPT_V3_CHECKPOINT_ATTESTATION_DISCRIMINATOR = Buffer.from(
  CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
);
