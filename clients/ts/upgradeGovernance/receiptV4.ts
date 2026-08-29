import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import {
  BootstrapActivationProposalV1,
  CeremonyProposalStateV1,
  ControllerImmutabilityReceiptV1,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  bootstrapActivationProposalDigestV1,
  bootstrapActivationReceiptDigestV1,
  controllerImmutabilityReceiptDigestV1,
  controllerReleaseDigestV1,
  currentDeploymentDigestV1,
  deriveBootstrapActivationProposalPdaV1,
  deriveBootstrapActivationReceiptPdaV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerImmutabilityReceiptPdaV1,
  deriveControllerReleaseCommitmentPdaV1,
  deriveCurrentDeploymentStatePdaV1,
  deriveProgramDataObservationPdaV1,
  deriveTargetAuthorityHandoffProposalPdaV1,
  deriveTargetAuthorityHandoffReceiptPdaV1,
  deserializeBootstrapActivationProposalV1,
  deserializeBootstrapActivationReceiptV1,
  deserializeControllerImmutabilityReceiptV1,
  deserializeControllerReleaseCommitmentV1,
  deserializeCurrentDeploymentStateV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  deserializeTargetAuthorityHandoffProposalV1,
  deserializeTargetAuthorityHandoffReceiptV1,
  programDataCapacityPolicyDigestV1,
  programDataObservationDigestV1,
  programDataObservationSubjectDigestV1,
  targetAuthorityHandoffProposalDigestV1,
  targetAuthorityHandoffReceiptDigestV1,
  validateBootstrapActivationProposalDigestV1,
  validateBootstrapActivationReceiptDigestV1,
  validateControllerImmutabilityReceiptDigestV1,
  validateControllerReleaseDigestV1,
  validateCurrentDeploymentDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
  validateTargetAuthorityHandoffProposalDigestV1,
  validateTargetAuthorityHandoffReceiptDigestV1,
  type BootstrapActivationReceiptV1,
  type ControllerReleaseCommitmentV1,
  type CurrentDeploymentStateV1,
  type ProgramDataCapacityPolicyV1,
  type ProgramDataObservationV1,
  type TargetAuthorityHandoffProposalV1,
  type TargetAuthorityHandoffReceiptV1,
} from "./release1Ceremony.js";
import { GateStatusV1, RELEASE1_APPROVAL_THRESHOLD } from "./release1.js";
import {
  LOCAL_CEREMONY_CONTROLLER_PROGRAM_V1,
  SYNTHETIC_CONTROLLER_PROGRAM_V1,
} from "./spreadGateBridgeV1.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

export const GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_SCHEMA =
  "amoeba-release1-ceremony-receipt-v4" as const;
export const GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION = 4 as const;
export const GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_DIGEST_DOMAIN = Buffer.from(
  "AMOEBA_RELEASE1_CEREMONY_RECEIPT_V4",
  "ascii",
);

export const CEREMONY_ACCOUNT_ROLES_V4 = Object.freeze([
  "capacity-policy",
  "controller-release",
  "controller-pre-observation",
  "controller-post-observation",
  "controller-immutability-receipt",
  "handoff-proposal",
  "handoff-pre-observation",
  "handoff-receipt",
  "activation-proposal",
  "activation-observation",
  "activation-receipt",
  "current-deployment-state",
] as const);
export type CeremonyAccountRoleV4 = (typeof CEREMONY_ACCOUNT_ROLES_V4)[number];

export interface CeremonyReceiptAccountV4 {
  role: CeremonyAccountRoleV4;
  pubkey: string;
  owner: string;
  executable: false;
  dataLength: number;
  dataSha256: string;
  dataBase64: string;
  finalizedSlot: string;
}

export interface CeremonyInstructionAccountMetaV4 {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface CheckedAuthorityHandoffEvidenceV4 {
  performed: true;
  simulated: false;
  bankPatched: false;
  controllerInstructionProgram: string;
  topLevelInstructionCount: number;
  loaderCpiKind: "set-authority-checked";
  loaderProgram: string;
  loaderDataHex: string;
  loaderAccounts: readonly CeremonyInstructionAccountMetaV4[];
  authorityBefore: string;
  authorityAfter: string;
  acceptedSlot: string;
}

export interface FormerAuthorityRejectionEvidenceV4 {
  attemptedSlot: string;
  signatureHex: string;
  status: "failed";
  errorSha256: string;
  authorityAfter: string;
  targetRawRootBefore: string;
  targetRawRootAfter: string;
}

export interface BootstrapActivationEvidenceV4 {
  transitionKind: "controller-bootstrap-activation-v1";
  bankPatched: false;
  controllerInstructionProgram: string;
  topLevelInstructionCount: number;
  innerCpiCount: 0;
  executedSlot: string;
  gateStatusBefore: "emergency-frozen";
  gateEpochBefore: string;
  freezeReasonBefore: number;
  gateStatusAfter: "active";
  gateEpochAfter: string;
  targetNonceBefore: string;
  targetNonceAfter: string;
}

export interface PostHandoffUpgradeEventV4 {
  slot: string;
  authorityKind: "controller-pda" | "external-key";
  authority: string;
  status: "succeeded" | "failed";
  artifactSha256: string;
  programdataObservationDigest: string;
}

export interface GovernedRelease1CeremonyReceiptV4Material {
  schema: typeof GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_SCHEMA;
  version: typeof GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION;
  production: boolean;
  identityKind: "synthetic-local" | "production";
  clusterDomainHex: string;
  controllerProgram: string;
  controllerProgramdata: string;
  controllerConfig: string;
  controllerAuthority: string;
  targetProgram: string;
  targetProgramdata: string;
  legacyAuthority: string;
  upgradeableLoader: string;
  accounts: readonly CeremonyReceiptAccountV4[];
  controllerImmutabilityTransition: "loader-set-authority-to-none";
  checkedHandoff: CheckedAuthorityHandoffEvidenceV4;
  formerAuthorityRejection: FormerAuthorityRejectionEvidenceV4;
  bootstrapActivation: BootstrapActivationEvidenceV4;
  postHandoffUpgradeEvents: readonly PostHandoffUpgradeEventV4[];
}

export interface GovernedRelease1CeremonyReceiptV4
  extends GovernedRelease1CeremonyReceiptV4Material {
  receiptDigest: string;
}

export interface GovernedRelease1CeremonyReceiptV4Verification {
  valid: true;
  receiptDigest: string;
  controllerImmutable: true;
  checkedHandoff: true;
  bootstrapActivated: true;
  oldAuthorityRejected: true;
  capacity: string;
  finalGateEpoch: string;
}

export class GovernedRelease1CeremonyReceiptV4VerificationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "GovernedRelease1CeremonyReceiptV4VerificationError";
  }
}

function fail(path: string, message: string): never {
  throw new GovernedRelease1CeremonyReceiptV4VerificationError(path, message);
}

function assertExactKeys(value: unknown, fields: readonly string[], path: string): void {
  if (value === null || Array.isArray(value) || typeof value !== "object") fail(path, "must be an object");
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) fail(path, "contains missing or unknown schema fields");
}

function canonicalJson(value: unknown, path = "receipt"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(path, "numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, entry]) => `${JSON.stringify(field)}:${canonicalJson(entry, `${path}.${field}`)}`)
      .join(",")}}`;
  }
  return fail(path, "is not canonical JSON");
}

function sha256Hex(...parts: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function hash32(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(path, "must be lowercase 32-byte hex");
  return value;
}

function publicKey(value: unknown, path: string): PublicKey {
  if (typeof value !== "string") fail(path, "must be a base58 public key");
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) fail(path, "must use canonical base58");
    return key;
  } catch (error) {
    if (error instanceof GovernedRelease1CeremonyReceiptV4VerificationError) throw error;
    return fail(path, "must be a base58 public key");
  }
}

function u64(value: unknown, path: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) fail(path, "must be a canonical decimal u64 string");
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) fail(path, "exceeds u64");
  return result;
}

function integer(value: unknown, minimum: number, maximum: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(path, `must be an integer in ${minimum}..${maximum}`);
  return value;
}

function canonicalBase64(value: unknown, path: string): Buffer {
  if (typeof value !== "string") fail(path, "must be base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(path, "must use canonical base64");
  if (bytes.length > 2_048) fail(path, "account evidence exceeds the fixed ceremony bound");
  return bytes;
}

function sameKey(left: PublicKey, right: PublicKey, path: string): void {
  if (!left.equals(right)) fail(path, "public-key binding mismatch");
}

function sameBytes(left: Uint8Array, right: Uint8Array, path: string): void {
  if (!Buffer.from(left).equals(Buffer.from(right))) fail(path, "byte commitment mismatch");
}

export function governedRelease1CeremonyReceiptDigestV4(
  material: GovernedRelease1CeremonyReceiptV4Material,
): string {
  return sha256Hex(
    GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_DIGEST_DOMAIN,
    Buffer.from(canonicalJson(material), "utf8"),
  );
}

export function finalizeGovernedRelease1CeremonyReceiptV4(
  material: GovernedRelease1CeremonyReceiptV4Material,
): GovernedRelease1CeremonyReceiptV4 {
  return { ...material, receiptDigest: governedRelease1CeremonyReceiptDigestV4(material) };
}

type DecodedCeremonyAccounts = {
  capacityPolicy: ProgramDataCapacityPolicyV1;
  controllerRelease: ControllerReleaseCommitmentV1;
  controllerPre: ProgramDataObservationV1;
  controllerPost: ProgramDataObservationV1;
  immutability: ControllerImmutabilityReceiptV1;
  handoffProposal: TargetAuthorityHandoffProposalV1;
  handoffPre: ProgramDataObservationV1;
  handoffReceipt: TargetAuthorityHandoffReceiptV1;
  activationProposal: BootstrapActivationProposalV1;
  activationObservation: ProgramDataObservationV1;
  activationReceipt: BootstrapActivationReceiptV1;
  deployment: CurrentDeploymentStateV1;
  accountKeys: ReadonlyMap<CeremonyAccountRoleV4, PublicKey>;
};

function decodeAccounts(
  receipt: GovernedRelease1CeremonyReceiptV4,
  controller: PublicKey,
): DecodedCeremonyAccounts {
  if (!Array.isArray(receipt.accounts) || receipt.accounts.length !== CEREMONY_ACCOUNT_ROLES_V4.length) fail("accounts", "must contain every ceremony account exactly once in canonical role order");
  const data = new Map<CeremonyAccountRoleV4, Buffer>();
  const accountKeys = new Map<CeremonyAccountRoleV4, PublicKey>();
  for (const [index, role] of CEREMONY_ACCOUNT_ROLES_V4.entries()) {
    const evidence = receipt.accounts[index]!;
    const path = `accounts[${index}]`;
    assertExactKeys(evidence, ["role", "pubkey", "owner", "executable", "dataLength", "dataSha256", "dataBase64", "finalizedSlot"], path);
    if (evidence.role !== role) fail(`${path}.role`, "account roles are omitted, duplicated, or reordered");
    const key = publicKey(evidence.pubkey, `${path}.pubkey`);
    if (!publicKey(evidence.owner, `${path}.owner`).equals(controller) || evidence.executable !== false) fail(path, "ceremony state must be controller-owned and nonexecutable");
    const bytes = canonicalBase64(evidence.dataBase64, `${path}.dataBase64`);
    if (integer(evidence.dataLength, 1, 2_048, `${path}.dataLength`) !== bytes.length || hash32(evidence.dataSha256, `${path}.dataSha256`) !== sha256Hex(bytes)) fail(path, "account length or SHA-256 mismatch");
    if (u64(evidence.finalizedSlot, `${path}.finalizedSlot`) === 0n) fail(`${path}.finalizedSlot`, "must bind a finalized nonzero slot");
    if ([...accountKeys.values()].some((existing) => existing.equals(key))) fail(`${path}.pubkey`, "duplicate ceremony account identity");
    data.set(role, bytes);
    accountKeys.set(role, key);
  }
  try {
    const result: DecodedCeremonyAccounts = {
      capacityPolicy: deserializeProgramDataCapacityPolicyV1(data.get("capacity-policy")!),
      controllerRelease: deserializeControllerReleaseCommitmentV1(data.get("controller-release")!),
      controllerPre: deserializeProgramDataObservationV1(data.get("controller-pre-observation")!),
      controllerPost: deserializeProgramDataObservationV1(data.get("controller-post-observation")!),
      immutability: deserializeControllerImmutabilityReceiptV1(data.get("controller-immutability-receipt")!),
      handoffProposal: deserializeTargetAuthorityHandoffProposalV1(data.get("handoff-proposal")!),
      handoffPre: deserializeProgramDataObservationV1(data.get("handoff-pre-observation")!),
      handoffReceipt: deserializeTargetAuthorityHandoffReceiptV1(data.get("handoff-receipt")!),
      activationProposal: deserializeBootstrapActivationProposalV1(data.get("activation-proposal")!),
      activationObservation: deserializeProgramDataObservationV1(data.get("activation-observation")!),
      activationReceipt: deserializeBootstrapActivationReceiptV1(data.get("activation-receipt")!),
      deployment: deserializeCurrentDeploymentStateV1(data.get("current-deployment-state")!),
      accountKeys,
    };
    validateProgramDataCapacityPolicyDigestV1(result.capacityPolicy);
    validateControllerReleaseDigestV1(result.controllerRelease);
    for (const observation of [result.controllerPre, result.controllerPost, result.handoffPre, result.activationObservation]) validateProgramDataObservationDigestV1(observation);
    validateControllerImmutabilityReceiptDigestV1(result.immutability);
    validateTargetAuthorityHandoffProposalDigestV1(result.handoffProposal);
    validateTargetAuthorityHandoffReceiptDigestV1(result.handoffReceipt);
    validateBootstrapActivationProposalDigestV1(result.activationProposal);
    validateBootstrapActivationReceiptDigestV1(result.activationReceipt);
    validateCurrentDeploymentDigestV1(result.deployment);
    return result;
  } catch (error) {
    return fail("accounts", `strict ceremony account codec or digest failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function validateCanonicalPdas(
  accounts: DecodedCeremonyAccounts,
  controller: PublicKey,
  target: PublicKey,
): void {
  const expected: readonly [CeremonyAccountRoleV4, PublicKey][] = [
    ["capacity-policy", deriveCapacityPolicyPdaV1(controller, target)[0]],
    ["controller-release", deriveControllerReleaseCommitmentPdaV1(controller, target)[0]],
    ["controller-immutability-receipt", deriveControllerImmutabilityReceiptPdaV1(controller, target)[0]],
    ["handoff-proposal", deriveTargetAuthorityHandoffProposalPdaV1(controller, target, accounts.handoffProposal.councilVersion)[0]],
    ["handoff-receipt", deriveTargetAuthorityHandoffReceiptPdaV1(controller, target)[0]],
    ["activation-proposal", deriveBootstrapActivationProposalPdaV1(controller, target, accounts.activationProposal.councilVersion)[0]],
    ["activation-receipt", deriveBootstrapActivationReceiptPdaV1(controller, target)[0]],
    ["current-deployment-state", deriveCurrentDeploymentStatePdaV1(controller, target)[0]],
  ];
  for (const [role, key] of expected) sameKey(accounts.accountKeys.get(role)!, key, `accounts.${role}.pda`);
  const observationRoles: readonly [CeremonyAccountRoleV4, ProgramDataObservationV1][] = [
    ["controller-pre-observation", accounts.controllerPre],
    ["controller-post-observation", accounts.controllerPost],
    ["handoff-pre-observation", accounts.handoffPre],
    ["activation-observation", accounts.activationObservation],
  ];
  for (const [role, observation] of observationRoles) {
    const expectedKey = deriveProgramDataObservationPdaV1(
      controller,
      observation.targetProgram,
      observation.purpose,
      observation.subjectDigest,
      observation.generation,
    )[0];
    sameKey(accounts.accountKeys.get(role)!, expectedKey, `accounts.${role}.pda`);
  }
}

function validateObservation(
  observation: ProgramDataObservationV1,
  expectedProgram: PublicKey,
  expectedProgramdata: PublicKey,
  expectedPurpose: number,
  policy: ProgramDataCapacityPolicyV1,
  policyKey: PublicKey,
  expectedGate: PublicKey,
  path: string,
): void {
  if (observation.status !== ProgramDataObservationStatusV1.Finalized || observation.purpose !== expectedPurpose) fail(path, "observation is stale, incomplete, or bound to the wrong purpose");
  sameKey(observation.targetProgram, expectedProgram, `${path}.targetProgram`);
  sameKey(observation.targetProgramdata, expectedProgramdata, `${path}.targetProgramdata`);
  sameKey(observation.capacityPolicy, policyKey, `${path}.capacityPolicy`);
  sameKey(observation.protocolGate, expectedGate, `${path}.protocolGate`);
  sameBytes(observation.capacityPolicyDigest, policy.policyDigest, `${path}.capacityPolicyDigest`);
  sameBytes(observation.subjectDigest, programDataObservationSubjectDigestV1(observation), `${path}.subjectDigest`);
  if (observation.tailBytesVerified !== observation.actualCapacity - observation.expectedArtifactLength) fail(path, "zero-only extension tail is not completely verified");
  sameBytes(observation.rawObservationSchemeId, policy.observationSchemeId, `${path}.rawObservationSchemeId`);
  if (observation.rawChunkSize !== policy.observationChunkSize || observation.expectedArtifactSchemeId.equals(policy.artifactSchemeId) === false) fail(path, "observation chunk or artifact scheme drifted from capacity policy");
}

function validateControllerImmutability(
  accounts: DecodedCeremonyAccounts,
  receipt: GovernedRelease1CeremonyReceiptV4,
  controller: PublicKey,
  controllerProgramdata: PublicKey,
): void {
  if (receipt.controllerImmutabilityTransition !== "loader-set-authority-to-none") fail("controllerImmutabilityTransition", "controller immutability must be a real Loader authority transition");
  const policyKey = accounts.accountKeys.get("capacity-policy")!;
  const protocolGate = accounts.handoffProposal.gate;
  validateObservation(accounts.controllerPre, controller, controllerProgramdata, ProgramDataObservationPurposeV1.ControllerImmutability, accounts.capacityPolicy, policyKey, protocolGate, "controllerPreObservation");
  validateObservation(accounts.controllerPost, controller, controllerProgramdata, ProgramDataObservationPurposeV1.ControllerImmutability, accounts.capacityPolicy, policyKey, protocolGate, "controllerPostObservation");
  const before = accounts.controllerPre;
  const after = accounts.controllerPost;
  if (!before.upgradeAuthority.present || after.upgradeAuthority.present) fail("controllerImmutability", "controller authority did not transition from Some to None");
  if (before.deployedSlot > after.deployedSlot || before.actualCapacity > after.actualCapacity || before.rawDataLength > after.rawDataLength || before.expectedArtifactLength !== after.expectedArtifactLength) fail("controllerImmutability", "authority transition regressed ProgramData chronology, capacity, raw length, or artifact identity");
  for (const [name, left, right] of [
    ["artifactSha256", before.expectedArtifactSha256, after.expectedArtifactSha256],
    ["artifactMerkleRoot", before.expectedArtifactMerkleRoot, after.expectedArtifactMerkleRoot],
    ["artifactSchemeId", before.expectedArtifactSchemeId, after.expectedArtifactSchemeId],
    ["programHeaderSnapshot", before.programHeaderSnapshot, after.programHeaderSnapshot],
  ] as const) sameBytes(left, right, `controllerImmutability.${name}`);
  const release = accounts.controllerRelease;
  if (release.minimumProgramdataCapacity > before.actualCapacity || release.minimumProgramdataCapacity > after.actualCapacity) fail("controllerImmutability", "observed capacity is below the release minimum");
  if (release.artifactLength !== after.expectedArtifactLength) fail("controllerImmutability", "release artifact length drifted from the post-observation");
  sameBytes(release.artifactSha256, after.expectedArtifactSha256, "controllerImmutability.releaseArtifactSha256");
  sameBytes(release.artifactMerkleRoot, after.expectedArtifactMerkleRoot, "controllerImmutability.releaseArtifactMerkleRoot");
  sameBytes(release.artifactSchemeId, after.expectedArtifactSchemeId, "controllerImmutability.releaseArtifactSchemeId");
  if (before.finalRawMerkleRoot.equals(after.finalRawMerkleRoot)) fail("controllerImmutability", "pre/post raw ProgramData roots must differ across the authority transition");
  const evidence = accounts.immutability;
  sameKey(evidence.preObservation, accounts.accountKeys.get("controller-pre-observation")!, "controllerImmutability.receipt.preObservation");
  sameKey(evidence.postObservation, accounts.accountKeys.get("controller-post-observation")!, "controllerImmutability.receipt.postObservation");
  sameBytes(evidence.preObservationDigest, before.observationDigest, "controllerImmutability.receipt.preDigest");
  sameBytes(evidence.postObservationDigest, after.observationDigest, "controllerImmutability.receipt.postDigest");
}

function exactMeta(
  actual: CeremonyInstructionAccountMetaV4,
  key: PublicKey,
  signer: boolean,
  writable: boolean,
  path: string,
): void {
  assertExactKeys(actual, ["pubkey", "isSigner", "isWritable"], path);
  if (!publicKey(actual.pubkey, `${path}.pubkey`).equals(key) || actual.isSigner !== signer || actual.isWritable !== writable) fail(path, "account identity or privilege mismatch");
}

function validateHandoff(
  accounts: DecodedCeremonyAccounts,
  receipt: GovernedRelease1CeremonyReceiptV4,
  controller: PublicKey,
  target: PublicKey,
  targetProgramdata: PublicKey,
  controllerAuthority: PublicKey,
  legacyAuthority: PublicKey,
): void {
  const policyKey = accounts.accountKeys.get("capacity-policy")!;
  validateObservation(accounts.handoffPre, target, targetProgramdata, ProgramDataObservationPurposeV1.TargetHandoffBridge, accounts.capacityPolicy, policyKey, accounts.handoffProposal.gate, "handoffPreObservation");
  if (!accounts.handoffPre.upgradeAuthority.present || !accounts.handoffPre.upgradeAuthority.value.equals(legacyAuthority)) fail("checkedHandoff", "pre-observation authority graph is invalid");

  const proposal = accounts.handoffProposal;
  const handoffReceipt = accounts.handoffReceipt;
  if (proposal.state !== CeremonyProposalStateV1.Completed || proposal.approvalCount !== RELEASE1_APPROVAL_THRESHOLD || proposal.approvalThreshold !== RELEASE1_APPROVAL_THRESHOLD) fail("handoffProposal", "checked handoff lacks equal-seat 3-of-5 completed governance");
  sameBytes(proposal.clusterDomain, Buffer.from(receipt.clusterDomainHex, "hex"), "handoffProposal.clusterDomain");
  sameKey(proposal.controllerProgram, controller, "handoffProposal.controllerProgram");
  sameKey(proposal.targetProgram, target, "handoffProposal.targetProgram");
  sameKey(proposal.targetProgramdata, targetProgramdata, "handoffProposal.targetProgramdata");
  if (accounts.handoffPre.generation < proposal.bridgeObservationGeneration) fail("handoffProposal.bridgeObservationGeneration", "fresh handoff observation regressed below the proposal minimum generation");
  if (accounts.handoffPre.generation === proposal.bridgeObservationGeneration) {
    sameKey(proposal.bridgeObservation, accounts.accountKeys.get("handoff-pre-observation")!, "handoffProposal.bridgeObservation");
    sameBytes(proposal.bridgeObservationRoot, accounts.handoffPre.finalRawMerkleRoot, "handoffProposal.bridgeObservationRoot");
    sameBytes(proposal.bridgeObservationDigest, accounts.handoffPre.observationDigest, "handoffProposal.bridgeObservationDigest");
  }
  if (proposal.minimumTargetDeployedSlot > accounts.handoffPre.deployedSlot || proposal.minimumTargetCapacity > accounts.handoffPre.actualCapacity || proposal.minimumTargetRawLength > accounts.handoffPre.rawDataLength) fail("handoffProposal", "fresh handoff observation is below a committed ProgramData minimum");
  if (proposal.bridgeArtifactLength !== accounts.handoffPre.expectedArtifactLength) fail("handoffProposal.bridgeArtifactLength", "artifact length drifted from observation");
  sameBytes(proposal.bridgeArtifactSha256, accounts.handoffPre.expectedArtifactSha256, "handoffProposal.bridgeArtifactSha256");
  sameBytes(proposal.bridgeArtifactMerkleRoot, accounts.handoffPre.expectedArtifactMerkleRoot, "handoffProposal.bridgeArtifactMerkleRoot");
  sameBytes(proposal.bridgeArtifactSchemeId, accounts.handoffPre.expectedArtifactSchemeId, "handoffProposal.bridgeArtifactSchemeId");
  sameKey(handoffReceipt.proposal, accounts.accountKeys.get("handoff-proposal")!, "handoffReceipt.proposal");
  sameBytes(handoffReceipt.proposalDigest, proposal.proposalDigest, "handoffReceipt.proposalDigest");
  sameKey(handoffReceipt.preObservation, accounts.accountKeys.get("handoff-pre-observation")!, "handoffReceipt.preObservation");
  sameBytes(handoffReceipt.preObservationRoot, accounts.handoffPre.finalRawMerkleRoot, "handoffReceipt.preObservationRoot");
  sameBytes(handoffReceipt.preObservationDigest, accounts.handoffPre.observationDigest, "handoffReceipt.preObservationDigest");
  if (!handoffReceipt.preUpgradeAuthority.present || !handoffReceipt.preUpgradeAuthority.value.equals(legacyAuthority)
    || !handoffReceipt.postUpgradeAuthority.present || !handoffReceipt.postUpgradeAuthority.value.equals(controllerAuthority)) {
    fail("handoffReceipt", "atomic checked handoff header transition is invalid");
  }

  const handoff = receipt.checkedHandoff;
  assertExactKeys(handoff, ["performed", "simulated", "bankPatched", "controllerInstructionProgram", "topLevelInstructionCount", "loaderCpiKind", "loaderProgram", "loaderDataHex", "loaderAccounts", "authorityBefore", "authorityAfter", "acceptedSlot"], "checkedHandoff");
  if (handoff.performed !== true || handoff.simulated !== false || handoff.bankPatched !== false) fail("checkedHandoff", "unchecked, simulated, or bank-patched handoff is forbidden");
  if (!publicKey(handoff.controllerInstructionProgram, "checkedHandoff.controllerInstructionProgram").equals(controller) || handoff.topLevelInstructionCount !== 1) fail("checkedHandoff", "handoff must be one exact top-level controller instruction");
  if (handoff.loaderCpiKind !== "set-authority-checked" || !publicKey(handoff.loaderProgram, "checkedHandoff.loaderProgram").equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || handoff.loaderDataHex !== "07000000") fail("checkedHandoff", "inner CPI is not exact Loader SetAuthorityChecked");
  if (!Array.isArray(handoff.loaderAccounts) || handoff.loaderAccounts.length !== 3) fail("checkedHandoff.loaderAccounts", "SetAuthorityChecked must use exactly three accounts");
  exactMeta(handoff.loaderAccounts[0]!, targetProgramdata, false, true, "checkedHandoff.loaderAccounts[0]");
  exactMeta(handoff.loaderAccounts[1]!, legacyAuthority, true, false, "checkedHandoff.loaderAccounts[1]");
  exactMeta(handoff.loaderAccounts[2]!, controllerAuthority, true, false, "checkedHandoff.loaderAccounts[2]");
  if (!publicKey(handoff.authorityBefore, "checkedHandoff.authorityBefore").equals(legacyAuthority) || !publicKey(handoff.authorityAfter, "checkedHandoff.authorityAfter").equals(controllerAuthority) || u64(handoff.acceptedSlot, "checkedHandoff.acceptedSlot") !== handoffReceipt.acceptedSlot) fail("checkedHandoff", "authority or accepted-slot evidence drifted from the receipt account");
}

function validateOldAuthorityRejection(
  evidence: FormerAuthorityRejectionEvidenceV4,
  controllerAuthority: PublicKey,
  handoffSlot: bigint,
): void {
  assertExactKeys(evidence, ["attemptedSlot", "signatureHex", "status", "errorSha256", "authorityAfter", "targetRawRootBefore", "targetRawRootAfter"], "formerAuthorityRejection");
  if (u64(evidence.attemptedSlot, "formerAuthorityRejection.attemptedSlot") < handoffSlot) fail("formerAuthorityRejection.attemptedSlot", "must not predate checked handoff");
  if (typeof evidence.signatureHex !== "string" || !/^[0-9a-f]{128}$/u.test(evidence.signatureHex)) fail("formerAuthorityRejection.signatureHex", "must bind one canonical signature");
  if (evidence.status !== "failed" || !publicKey(evidence.authorityAfter, "formerAuthorityRejection.authorityAfter").equals(controllerAuthority)) fail("formerAuthorityRejection", "former-authority attempt did not fail closed with the controller still authoritative");
  hash32(evidence.errorSha256, "formerAuthorityRejection.errorSha256");
  if (evidence.errorSha256 === "0".repeat(64)) fail("formerAuthorityRejection.errorSha256", "failed attempt must bind a nonzero error");
  if (hash32(evidence.targetRawRootBefore, "formerAuthorityRejection.targetRawRootBefore") !== hash32(evidence.targetRawRootAfter, "formerAuthorityRejection.targetRawRootAfter")) fail("formerAuthorityRejection", "failed old-authority attempt changed target bytes");
}

function validateActivation(
  accounts: DecodedCeremonyAccounts,
  receipt: GovernedRelease1CeremonyReceiptV4,
  controller: PublicKey,
  target: PublicKey,
  targetProgramdata: PublicKey,
  controllerAuthority: PublicKey,
): void {
  const policyKey = accounts.accountKeys.get("capacity-policy")!;
  validateObservation(accounts.activationObservation, target, targetProgramdata, ProgramDataObservationPurposeV1.BootstrapActivation, accounts.capacityPolicy, policyKey, accounts.activationProposal.gate, "activationObservation");
  if (!accounts.activationObservation.upgradeAuthority.present || !accounts.activationObservation.upgradeAuthority.value.equals(controllerAuthority)) fail("activationObservation", "target authority is not the controller PDA");
  const proposal = accounts.activationProposal;
  const activationReceipt = accounts.activationReceipt;
  const deployment = accounts.deployment;
  if (proposal.state !== CeremonyProposalStateV1.Completed || proposal.approvalCount !== RELEASE1_APPROVAL_THRESHOLD || proposal.approvalThreshold !== RELEASE1_APPROVAL_THRESHOLD) fail("activationProposal", "bootstrap activation lacks equal-seat 3-of-5 completed governance");
  sameBytes(proposal.clusterDomain, Buffer.from(receipt.clusterDomainHex, "hex"), "activationProposal.clusterDomain");
  sameKey(proposal.gate, accounts.handoffProposal.gate, "activationProposal.gate");
  if (accounts.activationObservation.generation < proposal.bridgeObservationGeneration) fail("activationProposal.bridgeObservationGeneration", "fresh activation observation regressed below the proposal minimum generation");
  if (accounts.activationObservation.generation === proposal.bridgeObservationGeneration) {
    sameKey(proposal.bridgeObservation, accounts.accountKeys.get("activation-observation")!, "activationProposal.bridgeObservation");
    sameBytes(proposal.bridgeObservationRoot, accounts.activationObservation.finalRawMerkleRoot, "activationProposal.bridgeObservationRoot");
    sameBytes(proposal.bridgeObservationDigest, accounts.activationObservation.observationDigest, "activationProposal.bridgeObservationDigest");
  }
  if (proposal.minimumTargetDeployedSlot > accounts.activationObservation.deployedSlot || proposal.minimumTargetCapacity > accounts.activationObservation.actualCapacity || proposal.minimumTargetRawLength > accounts.activationObservation.rawDataLength) fail("activationProposal", "fresh activation observation is below a committed ProgramData minimum");
  if (accounts.activationObservation.deployedSlot < accounts.handoffReceipt.deployedSlot || accounts.activationObservation.actualCapacity < accounts.handoffReceipt.programdataCapacity || accounts.activationObservation.rawDataLength < accounts.handoffReceipt.rawProgramdataLength) fail("activationObservation", "target ProgramData regressed after handoff");
  sameKey(proposal.targetHandoffReceipt, accounts.accountKeys.get("handoff-receipt")!, "activationProposal.handoffReceipt");
  sameBytes(proposal.targetHandoffDigest, accounts.handoffReceipt.receiptDigest, "activationProposal.handoffDigest");
  sameKey(activationReceipt.proposal, accounts.accountKeys.get("activation-proposal")!, "activationReceipt.proposal");
  sameBytes(activationReceipt.proposalDigest, proposal.proposalDigest, "activationReceipt.proposalDigest");
  sameKey(activationReceipt.currentDeploymentState, accounts.accountKeys.get("current-deployment-state")!, "activationReceipt.currentDeploymentState");
  sameBytes(activationReceipt.currentDeploymentDigest, deployment.deploymentDigest, "activationReceipt.currentDeploymentDigest");
  sameKey(deployment.activationReceipt.value, accounts.accountKeys.get("activation-receipt")!, "deployment.activationReceipt");
  if (!deployment.activationReceipt.present || deployment.completedProposal.present) fail("currentDeploymentState", "bootstrap deployment state must bind exactly the activation receipt");
  sameKey(deployment.programdataObservation, accounts.accountKeys.get("activation-observation")!, "deployment.programdataObservation");
  sameBytes(deployment.observationDigest, accounts.activationObservation.observationDigest, "deployment.observationDigest");
  sameKey(deployment.installedAuthority, controllerAuthority, "deployment.installedAuthority");

  const activation = receipt.bootstrapActivation;
  assertExactKeys(activation, ["transitionKind", "bankPatched", "controllerInstructionProgram", "topLevelInstructionCount", "innerCpiCount", "executedSlot", "gateStatusBefore", "gateEpochBefore", "freezeReasonBefore", "gateStatusAfter", "gateEpochAfter", "targetNonceBefore", "targetNonceAfter"], "bootstrapActivation");
  if (activation.transitionKind !== "controller-bootstrap-activation-v1" || activation.bankPatched !== false || !publicKey(activation.controllerInstructionProgram, "bootstrapActivation.controllerInstructionProgram").equals(controller) || activation.topLevelInstructionCount !== 1 || activation.innerCpiCount !== 0) fail("bootstrapActivation", "activation must be one production controller instruction with no bank patch or inner CPI");
  const beforeEpoch = u64(activation.gateEpochBefore, "bootstrapActivation.gateEpochBefore");
  const afterEpoch = u64(activation.gateEpochAfter, "bootstrapActivation.gateEpochAfter");
  if (activation.gateStatusBefore !== "emergency-frozen" || activation.freezeReasonBefore !== proposal.bootstrapFreezeReasonCode || activation.gateStatusAfter !== "active" || afterEpoch !== beforeEpoch + 1n || beforeEpoch !== activationReceipt.previousGateEpoch || afterEpoch !== activationReceipt.activatedGateEpoch) fail("bootstrapActivation", "gate activation transition is not the exact one-time epoch increment");
  const beforeNonce = u64(activation.targetNonceBefore, "bootstrapActivation.targetNonceBefore");
  const afterNonce = u64(activation.targetNonceAfter, "bootstrapActivation.targetNonceAfter");
  if (beforeNonce !== afterNonce || beforeNonce !== proposal.targetNonce || afterNonce !== activationReceipt.targetNonce) fail("bootstrapActivation", "bootstrap activation must not consume or rewrite target nonce");
  if (u64(activation.executedSlot, "bootstrapActivation.executedSlot") !== proposal.executedSlot || proposal.executedSlot !== activationReceipt.finalizedSlot) fail("bootstrapActivation.executedSlot", "does not match proposal and activation receipt");
}

function validateUpgradeEvents(
  events: readonly PostHandoffUpgradeEventV4[],
  controllerAuthority: PublicKey,
  handoffSlot: bigint,
): void {
  if (!Array.isArray(events) || events.length === 0 || events.length > 128) fail("postHandoffUpgradeEvents", "must include a bounded governed lifecycle event inventory");
  let controllerSuccess = 0;
  let priorSlot = handoffSlot;
  for (const [index, event] of events.entries()) {
    const path = `postHandoffUpgradeEvents[${index}]`;
    assertExactKeys(event, ["slot", "authorityKind", "authority", "status", "artifactSha256", "programdataObservationDigest"], path);
    const slot = u64(event.slot, `${path}.slot`);
    if (slot < handoffSlot || slot < priorSlot) fail(`${path}.slot`, "event is before handoff or out of order");
    priorSlot = slot;
    const authority = publicKey(event.authority, `${path}.authority`);
    hash32(event.artifactSha256, `${path}.artifactSha256`);
    hash32(event.programdataObservationDigest, `${path}.programdataObservationDigest`);
    if (event.authorityKind === "external-key") {
      if (event.status === "succeeded") fail(path, "direct external-key upgrade succeeded after handoff");
      if (authority.equals(controllerAuthority)) fail(path, "external-key event falsely identifies the controller PDA");
    } else if (event.authorityKind === "controller-pda") {
      if (!authority.equals(controllerAuthority)) fail(path, "controller-pda event uses the wrong authority");
      if (event.status === "succeeded") controllerSuccess += 1;
    } else {
      fail(`${path}.authorityKind`, "unknown post-handoff authority class");
    }
    if (event.status !== "succeeded" && event.status !== "failed") fail(`${path}.status`, "unknown event status");
  }
  if (controllerSuccess === 0) fail("postHandoffUpgradeEvents", "receipt omits a successful controller-PDA governed upgrade");
}

export function verifyGovernedRelease1CeremonyReceiptV4(
  input: unknown,
): GovernedRelease1CeremonyReceiptV4Verification {
  assertExactKeys(input, [
    "schema", "version", "production", "identityKind", "clusterDomainHex", "controllerProgram", "controllerProgramdata",
    "controllerConfig", "controllerAuthority", "targetProgram", "targetProgramdata", "legacyAuthority", "upgradeableLoader",
    "accounts", "controllerImmutabilityTransition", "checkedHandoff", "formerAuthorityRejection", "bootstrapActivation",
    "postHandoffUpgradeEvents", "receiptDigest",
  ], "receipt");
  const receipt = input as GovernedRelease1CeremonyReceiptV4;
  if (receipt.schema !== GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_SCHEMA || receipt.version !== GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION) fail("receipt", "unknown receipt schema or version");
  if (typeof receipt.production !== "boolean") fail("production", "must be boolean");
  if (receipt.identityKind !== "synthetic-local" && receipt.identityKind !== "production") fail("identityKind", "unknown identity class");
  if (receipt.production !== (receipt.identityKind === "production")) fail("identityKind", "production flag and identity class disagree");
  const controller = publicKey(receipt.controllerProgram, "controllerProgram");
  if (
    receipt.production &&
    (controller.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1) ||
      controller.equals(LOCAL_CEREMONY_CONTROLLER_PROGRAM_V1))
  ) fail("controllerProgram", "synthetic controller identity cannot be presented as production");
  if (!receipt.production && !controller.equals(LOCAL_CEREMONY_CONTROLLER_PROGRAM_V1)) fail("controllerProgram", "local ceremony receipts must use the declared local ceremony controller identity");
  const controllerProgramdata = publicKey(receipt.controllerProgramdata, "controllerProgramdata");
  const controllerConfig = publicKey(receipt.controllerConfig, "controllerConfig");
  const controllerAuthority = publicKey(receipt.controllerAuthority, "controllerAuthority");
  const target = publicKey(receipt.targetProgram, "targetProgram");
  const targetProgramdata = publicKey(receipt.targetProgramdata, "targetProgramdata");
  const legacyAuthority = publicKey(receipt.legacyAuthority, "legacyAuthority");
  if (legacyAuthority.equals(controllerAuthority)) fail("legacyAuthority", "must differ from the controller PDA");
  if (!publicKey(receipt.upgradeableLoader, "upgradeableLoader").equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) fail("upgradeableLoader", "wrong Loader-v3 identity");
  hash32(receipt.clusterDomainHex, "clusterDomainHex");
  hash32(receipt.receiptDigest, "receiptDigest");
  const { receiptDigest: _receiptDigest, ...material } = receipt;
  if (governedRelease1CeremonyReceiptDigestV4(material) !== receipt.receiptDigest) fail("receiptDigest", "deterministic receipt digest mismatch");

  const accounts = decodeAccounts(receipt, controller);
  validateCanonicalPdas(accounts, controller, target);
  sameKey(accounts.capacityPolicy.controllerProgram, controller, "capacityPolicy.controllerProgram");
  sameKey(accounts.capacityPolicy.controllerConfig, controllerConfig, "capacityPolicy.controllerConfig");
  sameKey(accounts.capacityPolicy.targetProgram, target, "capacityPolicy.targetProgram");
  sameKey(accounts.capacityPolicy.targetProgramdata, targetProgramdata, "capacityPolicy.targetProgramdata");
  sameKey(accounts.controllerRelease.controllerProgram, controller, "controllerRelease.controllerProgram");
  sameKey(accounts.controllerRelease.controllerProgramdata, controllerProgramdata, "controllerRelease.controllerProgramdata");
  sameKey(accounts.controllerRelease.capacityPolicy, accounts.accountKeys.get("capacity-policy")!, "controllerRelease.capacityPolicy");
  sameBytes(accounts.controllerRelease.capacityPolicyDigest, accounts.capacityPolicy.policyDigest, "controllerRelease.capacityPolicyDigest");

  validateControllerImmutability(accounts, receipt, controller, controllerProgramdata);
  validateHandoff(accounts, receipt, controller, target, targetProgramdata, controllerAuthority, legacyAuthority);
  validateOldAuthorityRejection(receipt.formerAuthorityRejection, controllerAuthority, accounts.handoffReceipt.acceptedSlot);
  validateActivation(accounts, receipt, controller, target, targetProgramdata, controllerAuthority);
  if (accounts.activationReceipt.finalizedSlot <= accounts.handoffReceipt.acceptedSlot) fail("activationReceipt.finalizedSlot", "activation must be a separate later transaction");
  validateUpgradeEvents(receipt.postHandoffUpgradeEvents, controllerAuthority, accounts.handoffReceipt.acceptedSlot);

  // These comparisons also make accidental replacement of a typed digest helper
  // with a caller-supplied hash immediately visible to the independent verifier.
  sameBytes(accounts.capacityPolicy.policyDigest, programDataCapacityPolicyDigestV1(accounts.capacityPolicy), "capacityPolicy.digest");
  sameBytes(accounts.controllerRelease.releaseDigest, controllerReleaseDigestV1(accounts.controllerRelease), "controllerRelease.digest");
  sameBytes(accounts.controllerPre.observationDigest, programDataObservationDigestV1(accounts.controllerPre), "controllerPre.digest");
  sameBytes(accounts.immutability.receiptDigest, controllerImmutabilityReceiptDigestV1(accounts.immutability), "immutability.digest");
  sameBytes(accounts.handoffProposal.proposalDigest, targetAuthorityHandoffProposalDigestV1(accounts.handoffProposal), "handoffProposal.digest");
  sameBytes(accounts.handoffReceipt.receiptDigest, targetAuthorityHandoffReceiptDigestV1(accounts.handoffReceipt), "handoffReceipt.digest");
  sameBytes(accounts.activationProposal.proposalDigest, bootstrapActivationProposalDigestV1(accounts.activationProposal), "activationProposal.digest");
  sameBytes(accounts.activationReceipt.receiptDigest, bootstrapActivationReceiptDigestV1(accounts.activationReceipt), "activationReceipt.digest");
  sameBytes(accounts.deployment.deploymentDigest, currentDeploymentDigestV1(accounts.deployment), "deployment.digest");

  return {
    valid: true,
    receiptDigest: receipt.receiptDigest,
    controllerImmutable: true,
    checkedHandoff: true,
    bootstrapActivated: true,
    oldAuthorityRejected: true,
    capacity: accounts.activationReceipt.actualTargetCapacity.toString(),
    finalGateEpoch: accounts.activationReceipt.activatedGateEpoch.toString(),
  };
}
