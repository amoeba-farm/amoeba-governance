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
  ProposalStateV2,
  RELEASE1_ACCOUNT_VERSION_V1,
  STATE_CHECKPOINT_V1_DISCRIMINATOR,
  StateCheckpointPhaseV1,
  stateCheckpointDigestV1,
  stateCheckpointHardCombinedRootV1,
  type StateCheckpointV1,
} from "./release1.js";
import { decodeExecuteUpgradeV1 } from "./release1LoaderInstructions.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID_V1,
  RECENT_BLOCKHASHES_SYSVAR_ID_V1,
  SYSTEM_PROGRAM_ID_V1,
} from "./operator.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

export const GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA = "amoeba-governed-upgrade-receipt-v3" as const;
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
const ZERO_HASH = "0".repeat(64);

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
}

export interface ReceiptGovernanceV3 {
  proposalDigest: string;
  counterpartProposalDigest: string;
  policyVersion: string;
  policyHash: string;
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
  creationGateEpoch: string;
  frozenGateEpoch: string;
  completedGateEpoch: string;
  reviewStartSlot: string;
  reviewEndSlot: string;
  notBeforeSlot: string;
  expirySlot: string;
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
  mint: string;
  authority: string;
  assetKind: "lamports" | "token";
  positiveDeltaAtoms: string;
  previouslyKnownAccount: true;
  identityUnchanged: true;
  semanticAccountingUnchanged: true;
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
  admittedPositiveDonations: readonly ReceiptDonationDriftV3[];
}

export interface ReceiptFrozenHistoryEventV3 {
  slot: string;
  topLevelProgramIds: readonly string[];
  controllerInstructionTag: number;
  computeBudgetInstructionCount: number;
  systemInstructionCount: number;
  admittedDurableNonceAdvanceCount: number;
  loaderUpgradeInnerCpiCount: number;
  targetTopLevelMutationCount: number;
  externalLoaderTopLevelInstructionCount: number;
  otherMutationCount: number;
}

export interface ReceiptControllerTrustRootV3 {
  sourceCommitSha256: string;
  sourceTreeSha256: string;
  abiSha256: string;
  buildInputInventorySha256: string;
  controllerArtifactSha256: string;
  controllerRawProgramdataSha256: string;
  initializationStateSha256: string;
  initialized: true;
  tokenGovernanceEnabled: false;
  controllerImmutable: boolean;
  immutabilityPlanSha256: string;
  productionIdentityVerified: boolean;
}

export interface ReceiptHandoffEvidenceV3 {
  performed: boolean;
  simulated: boolean;
  authorityBefore: string;
  authorityAfter: string;
  oldAuthority: string;
  oldAuthorityDirectUpgradeRejected: boolean;
  externalKeyDirectUpgradeObserved: boolean;
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
  frozenHistory: readonly ReceiptFrozenHistoryEventV3[];
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

function assertExactObjectKeys(value: object, expected: readonly string[], path: string): void {
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

function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer in ${min}..${max}`);
  return value;
}

function bytesFromHex(value: unknown, path: string, exactLength?: number): Buffer {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/u.test(value)) fail(path, "must be canonical lowercase even-length hex");
  const bytes = Buffer.from(value, "hex");
  if (exactLength !== undefined && bytes.length !== exactLength) fail(path, `must contain exactly ${exactLength} bytes`);
  return bytes;
}

function bytesFromBase64(value: unknown, path: string, maxLength: number): Buffer {
  if (typeof value !== "string") fail(path, "must be base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(path, "must use canonical base64");
  if (bytes.length > maxLength) fail(path, "exceeds receipt byte limit");
  return bytes;
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
  if (frozenEpoch <= creationEpoch || completedEpoch !== frozenEpoch + 1n) fail("governance", "gate epochs do not prove freeze then separate unfreeze");
  const reviewStart = u64(g.reviewStartSlot, "governance.reviewStartSlot");
  const reviewEnd = u64(g.reviewEndSlot, "governance.reviewEndSlot");
  const notBefore = u64(g.notBeforeSlot, "governance.notBeforeSlot");
  const expiry = u64(g.expirySlot, "governance.expirySlot");
  const freeze = u64(g.freezeSlot, "governance.freezeSlot");
  const extension = u64(g.extensionSlot, "governance.extensionSlot");
  const upgrade = u64(g.upgradeSlot, "governance.upgradeSlot");
  const verified = u64(g.programdataVerifiedSlot, "governance.programdataVerifiedSlot");
  const poststate = u64(g.poststateAcceptedSlot, "governance.poststateAcceptedSlot");
  const approved = u64(g.unfreezeApprovedSlot, "governance.unfreezeApprovedSlot");
  const unfreeze = u64(g.unfreezeSlot, "governance.unfreezeSlot");
  if (!(reviewStart <= reviewEnd && reviewEnd < expiry && notBefore < expiry && freeze >= notBefore && freeze < expiry && upgrade >= freeze && upgrade < expiry && verified >= upgrade && poststate >= verified && approved >= poststate && unfreeze >= approved)) fail("governance", "timing or frozen lifecycle ordering is invalid");
  if (extension !== 0n && !(extension >= freeze && extension < upgrade)) fail("governance.extensionSlot", "extension must be in a separate strictly earlier frozen slot");
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
  const upgrade = u64(receipt.governance.upgradeSlot, "governance.upgradeSlot");
  if (!(adopted <= finalized && finalized <= sealedThrough && sealedThrough >= upgrade)) fail("buffer", "sealed interval does not cover verification through upgrade");
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
  return donations.length === 0 ? ZERO_HASH : sha256Hex(Buffer.from("AMOEBA_EXTERNAL_DONATION_V1", "ascii"), Buffer.from(canonicalJson(donations, "state.admittedPositiveDonations"), "utf8"));
}

function validateState(receipt: GovernedUpgradeReceiptV3): void {
  const { prestate: pre, poststate: post, admittedPositiveDonations: donations } = receipt.state;
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
  if (!Array.isArray(donations) || donations.length > 4096) fail("state.admittedPositiveDonations", "invalid donation list length");
  const identities = new Set<string>();
  for (const [index, donation] of donations.entries()) {
    const path = `state.admittedPositiveDonations[${index}]`;
    const account = pubkey(donation.account, `${path}.account`).toBase58();
    pubkey(donation.owner, `${path}.owner`); pubkey(donation.mint, `${path}.mint`); pubkey(donation.authority, `${path}.authority`);
    if (identities.has(account)) fail(path, "duplicate donated account"); identities.add(account);
    if (u64(donation.positiveDeltaAtoms, `${path}.positiveDeltaAtoms`) === 0n || donation.previouslyKnownAccount !== true || donation.identityUnchanged !== true || donation.semanticAccountingUnchanged !== true || (donation.assetKind !== "lamports" && donation.assetKind !== "token")) fail(path, "is not a narrowly admitted positive donation to an unchanged known identity");
  }
  if (u64(pre.admittedPositiveDonationCount, "state.prestate.admittedPositiveDonationCount") !== 0n || pre.admittedPositiveDonationRoot !== ZERO_HASH) fail("state.prestate", "prestate cannot pre-admit post-upgrade donations");
  if (u64(post.admittedPositiveDonationCount, "state.poststate.admittedPositiveDonationCount") !== BigInt(donations.length) || post.admittedPositiveDonationRoot !== donationRoot(donations)) fail("state.poststate", "donation count or deterministic donation root mismatch");
  if (donations.length === 0 && pre.externalRawBalanceObservationRoot !== post.externalRawBalanceObservationRoot) fail("state.poststate.externalRawBalanceObservationRoot", "raw external balances changed without an admitted donation");
  if (post.targetPayloadCommitment !== receipt.programdata.payloadSha256 || post.targetRawProgramdataCommitment !== receipt.programdata.rawProgramdataSha256 || post.targetProgramdataSlot !== receipt.programdata.deployedSlot || post.targetCapacity !== receipt.programdata.capacity) fail("state.poststate", "does not bind the mechanically verified ProgramData");
}

function validateHistory(receipt: GovernedUpgradeReceiptV3): void {
  const history = receipt.frozenHistory;
  if (!Array.isArray(history) || history.length === 0 || history.length > 4096) fail("frozenHistory", "must be a bounded nonempty history");
  const freeze = u64(receipt.governance.freezeSlot, "governance.freezeSlot");
  const unfreeze = u64(receipt.governance.unfreezeSlot, "governance.unfreezeSlot");
  const upgrade = u64(receipt.governance.upgradeSlot, "governance.upgradeSlot");
  const admittedTopLevel = new Set([receipt.identities.controllerProgram, COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), SYSTEM_PROGRAM_ID_V1.toBase58()]);
  let prior = freeze;
  let upgradeEvents = 0;
  for (const [index, event] of history.entries()) {
    const path = `frozenHistory[${index}]`;
    const slot = u64(event.slot, `${path}.slot`);
    if (slot < freeze || slot > unfreeze || slot < prior) fail(path, "slot lies outside or reorders the frozen interval"); prior = slot;
    if (!Array.isArray(event.topLevelProgramIds) || (event.topLevelProgramIds as readonly unknown[]).some((program: unknown) => !admittedTopLevel.has(pubkey(program, `${path}.topLevelProgramIds`).toBase58()))) fail(path, "contains a sibling arbitrary top-level instruction");
    const topLevelProgramIds = event.topLevelProgramIds as readonly string[];
    const controllerCount = topLevelProgramIds.filter((program: string) => program === receipt.identities.controllerProgram).length;
    const computeCount = topLevelProgramIds.filter((program: string) => program === COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58()).length;
    const systemCount = topLevelProgramIds.filter((program: string) => program === SYSTEM_PROGRAM_ID_V1.toBase58()).length;
    if (
      controllerCount !== 1 ||
      integer(event.computeBudgetInstructionCount, 0, 2, `${path}.computeBudgetInstructionCount`) !== computeCount ||
      integer(event.systemInstructionCount, 0, 1, `${path}.systemInstructionCount`) !== systemCount ||
      integer(event.admittedDurableNonceAdvanceCount, 0, 1, `${path}.admittedDurableNonceAdvanceCount`) !== systemCount
    ) fail(path, "top-level instruction counts do not prove only canonical compute/nonce/controller activity");
    if (integer(event.targetTopLevelMutationCount, 0, 0xffff_ffff, `${path}.targetTopLevelMutationCount`) !== 0 || integer(event.externalLoaderTopLevelInstructionCount, 0, 0xffff_ffff, `${path}.externalLoaderTopLevelInstructionCount`) !== 0 || integer(event.otherMutationCount, 0, 0xffff_ffff, `${path}.otherMutationCount`) !== 0) fail(path, "contains a target, external-loader, or arbitrary mutation while frozen");
    const innerCount = integer(event.loaderUpgradeInnerCpiCount, 0, 1, `${path}.loaderUpgradeInnerCpiCount`);
    const tag = integer(event.controllerInstructionTag, 1, 38, `${path}.controllerInstructionTag`);
    if (tag === 26) fail(path, "reserved controller instruction tag is not executable");
    if (innerCount === 1) {
      if (tag !== 31 || slot !== upgrade) fail(path, "Loader Upgrade CPI is not the exact controller execution event");
      const envelopePrograms = receipt.topLevelEnvelope.map((instruction) => instruction.programId);
      if (topLevelProgramIds.length !== envelopePrograms.length || topLevelProgramIds.some((program: string, instructionIndex: number) => program !== envelopePrograms[instructionIndex])) fail(path, "upgrade history does not match the exact verified top-level envelope");
      upgradeEvents += 1;
    }
  }
  if (upgradeEvents !== 1) fail("frozenHistory", "must prove exactly one controller-owned Loader Upgrade CPI");
}

function validateTrustRootAndHandoff(receipt: GovernedUpgradeReceiptV3): void {
  const trust = receipt.controllerTrustRoot;
  for (const field of ["sourceCommitSha256", "sourceTreeSha256", "abiSha256", "buildInputInventorySha256", "controllerArtifactSha256", "controllerRawProgramdataSha256", "initializationStateSha256", "immutabilityPlanSha256"] as const) {
    if (hash32(trust[field], `controllerTrustRoot.${field}`).equals(Buffer.alloc(32))) fail(`controllerTrustRoot.${field}`, "must be a nonzero evidence commitment");
  }
  if (trust.initialized !== true || trust.tokenGovernanceEnabled !== false) fail("controllerTrustRoot", "controller initialization or disabled token-governance proof is absent");
  const controller = pubkey(receipt.identities.controllerProgram, "identities.controllerProgram");
  if (receipt.production) {
    if (controller.equals(PublicKey.default) || controller.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1) || trust.productionIdentityVerified !== true || trust.controllerImmutable !== true) fail("controllerTrustRoot", "production receipt requires a non-synthetic independently verified immutable controller");
  } else if (trust.immutabilityPlanSha256 === ZERO_HASH) {
    fail("controllerTrustRoot.immutabilityPlanSha256", "readiness receipt must bind a future immutability plan");
  }
  if (!pubkey(receipt.identities.upgradeableLoader, "identities.upgradeableLoader").equals(LOADER_V3_PROGRAM_ID)) fail("identities.upgradeableLoader", "wrong Upgradeable Loader identity");
  if (!/^[0-9a-f]{64}$/u.test(receipt.identities.clusterDomainHex)) fail("identities.clusterDomainHex", "must be a lowercase 32-byte cluster domain");
  for (const [field, value] of Object.entries(receipt.identities)) if (field !== "clusterDomainHex") pubkey(value, `identities.${field}`);

  const handoff = receipt.handoff;
  if (handoff.performed === handoff.simulated) fail("handoff", "must prove exactly one of performed or simulated handoff mode");
  const after = pubkey(handoff.authorityAfter, "handoff.authorityAfter");
  if (!after.equals(pubkey(receipt.identities.authorityPda, "identities.authorityPda")) || !after.equals(pubkey(receipt.programdata.authority, "programdata.authority"))) fail("handoff.authorityAfter", "controller authority is not retained");
  if (pubkey(handoff.oldAuthority, "handoff.oldAuthority").equals(after) || pubkey(handoff.authorityBefore, "handoff.authorityBefore").equals(after)) fail("handoff", "old external authority was not distinct from the controller PDA");
  if (handoff.oldAuthorityDirectUpgradeRejected !== true || handoff.externalKeyDirectUpgradeObserved !== false) fail("handoff", "external-key direct upgrade rejection is not proven");
}

export function verifyGovernedUpgradeReceiptV3(input: unknown): GovernedUpgradeReceiptV3Verification {
  if (input === null || Array.isArray(input) || typeof input !== "object") return fail("receipt", "must be an object");
  assertExactObjectKeys(input, [
    "schema", "version", "production", "identities", "topLevelEnvelope", "innerCpis", "governance", "buffer", "programdata", "state",
    "frozenHistory", "controllerTrustRoot", "handoff", "receiptDigest",
  ], "receipt");
  const receipt = input as GovernedUpgradeReceiptV3;
  if (receipt.schema !== GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA || receipt.version !== GOVERNED_UPGRADE_RECEIPT_V3_VERSION) fail("receipt", "unknown receipt schema or version");
  if (typeof receipt.production !== "boolean") fail("receipt.production", "must be a boolean");
  hash32(receipt.receiptDigest, "receipt.receiptDigest");
  const { receiptDigest: _receiptDigest, ...material } = receipt;
  const recomputed = governedUpgradeReceiptDigestV3(material as GovernedUpgradeReceiptV3Material);
  if (recomputed !== receipt.receiptDigest) fail("receipt.receiptDigest", "deterministic receipt digest mismatch");
  const decoded = validateEnvelope(receipt);
  validateInnerCpi(receipt);
  validateGovernance(receipt, decoded);
  const artifact = validateBuffer(receipt);
  validateProgramData(receipt, artifact);
  validateState(receipt);
  validateHistory(receipt);
  validateTrustRootAndHandoff(receipt);
  return {
    valid: true,
    receiptDigest: receipt.receiptDigest,
    artifactSha256: receipt.buffer.artifactSha256,
    rawProgramdataSha256: receipt.programdata.rawProgramdataSha256,
    admittedDonationCount: receipt.state.admittedPositiveDonations.length,
  };
}

// Kept as an explicit exported identity so package consumers can assert the
// receipt verifier is wired to the separate checkpoint-attestation domain.
export const RECEIPT_V3_CHECKPOINT_ATTESTATION_DISCRIMINATOR = Buffer.from(
  CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
);
