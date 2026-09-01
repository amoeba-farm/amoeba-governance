import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import { GateStatusV1 } from "./release1.js";
import {
  type CeremonyEnvelopeV1,
  FixedReader,
  FixedWriter,
  decodeFixed,
  encodeFixed,
  readCeremonyEnvelope,
  writeCeremonyEnvelope,
} from "./release1FixedWire.js";

/**
 * Governance-liveness V2 is additive. Historical V1 account bytes, digest
 * domains, PDA meanings, and instruction tags are intentionally untouched.
 */
export const GOVERNANCE_LIFECYCLE_REGISTRY_V2_DISCRIMINATOR = Buffer.from("AGVREG02", "ascii");
export const GOVERNANCE_TIMING_PROFILE_V1_DISCRIMINATOR = Buffer.from("AGVTPF01", "ascii");
export const TIMING_POLICY_CHANGE_PROPOSAL_V1_DISCRIMINATOR = Buffer.from("AGVTPP01", "ascii");
export const COUNCIL_ROTATION_PROPOSAL_V2_DISCRIMINATOR = Buffer.from("AGVROT02", "ascii");
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_DISCRIMINATOR = Buffer.from("AGVTHP02", "ascii");
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V2_DISCRIMINATOR = Buffer.from("AGVBAP02", "ascii");

export const GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN = 256;
export const GOVERNANCE_TIMING_PROFILE_V1_LEN = 384;
export const TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN = 512;
export const COUNCIL_ROTATION_PROPOSAL_V2_LEN = 512;
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN = 1_280;
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN = 1_280;

export const GOVERNANCE_LIFECYCLE_REGISTRY_V2_RESERVED_LEN = 13;
export const GOVERNANCE_TIMING_PROFILE_V1_RESERVED_LEN = 68;
export const TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN = 36;
export const COUNCIL_ROTATION_PROPOSAL_V2_RESERVED_LEN = 28;
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_RESERVED_LEN = 73;
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V2_RESERVED_LEN = 41;

export const GOVERNANCE_TIMING_PROFILE_HASH_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOV_TIMING_PROFILE_V1",
  "ascii",
);
export const TIMING_POLICY_CHANGE_PROPOSAL_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_GOV_TIMING_POLICY_CHANGE_V1",
  "ascii",
);
export const COUNCIL_ROTATION_PROPOSAL_DIGEST_DOMAIN_V2 = Buffer.from(
  "AMOEBA_GOV_COUNCIL_ROTATION_V2",
  "ascii",
);
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_DIGEST_DOMAIN_V2 = Buffer.from(
  "AMOEBA_GOV_TARGET_HANDOFF_V2",
  "ascii",
);
export const BOOTSTRAP_ACTIVATION_PROPOSAL_DIGEST_DOMAIN_V2 = Buffer.from(
  "AMOEBA_GOV_BOOTSTRAP_ACTIVATION_V2",
  "ascii",
);

export const GovernanceTimingClassV1 = Object.freeze({
  EmergencyRollback: 0,
  Routine: 1,
  Major: 2,
  Constitutional: 3,
} as const);
export type GovernanceTimingClassV1 =
  (typeof GovernanceTimingClassV1)[keyof typeof GovernanceTimingClassV1];

export const GovernanceActionKindV2 = Object.freeze({
  TimingPolicyChange: 0,
  CouncilRotation: 1,
  TargetAuthorityHandoff: 2,
  BootstrapActivation: 3,
} as const);
export type GovernanceActionKindV2 =
  (typeof GovernanceActionKindV2)[keyof typeof GovernanceActionKindV2];

export const GovernanceLifecycleStateV2 = Object.freeze({
  Draft: 0,
  CouncilApproved: 1,
  Timelocked: 2,
  Completed: 3,
  Cancelled: 4,
  Expired: 5,
} as const);
export type GovernanceLifecycleStateV2 =
  (typeof GovernanceLifecycleStateV2)[keyof typeof GovernanceLifecycleStateV2];

export const INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_TAG = 82;
export const CREATE_GOVERNANCE_TIMING_PROFILE_V1_TAG = 83;
export const CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 84;
export const APPROVE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 85;
export const CANCEL_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 86;
export const EXPIRE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 87;
export const QUEUE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 88;
export const EXECUTE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG = 89;
export const CREATE_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 90;
export const APPROVE_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 91;
export const CANCEL_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 92;
export const EXPIRE_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 93;
export const QUEUE_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 94;
export const EXECUTE_COUNCIL_ROTATION_PROPOSAL_V2_TAG = 95;
export const CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 96;
export const APPROVE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 97;
export const CANCEL_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 98;
export const EXPIRE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 99;
export const QUEUE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 100;
export const EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG = 101;
export const CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 102;
export const APPROVE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 103;
export const CANCEL_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 104;
export const EXPIRE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 105;
export const QUEUE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 106;
export const EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG = 107;

export const GOVERNANCE_LIVENESS_V2_INSTRUCTION_TAGS = Object.freeze({
  InitializeGovernanceLifecycleRegistryV2: INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_TAG,
  CreateGovernanceTimingProfileV1: CREATE_GOVERNANCE_TIMING_PROFILE_V1_TAG,
  CreateTimingPolicyChangeProposalV1: CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  ApproveTimingPolicyChangeProposalV1: APPROVE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  CancelTimingPolicyChangeProposalV1: CANCEL_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  ExpireTimingPolicyChangeProposalV1: EXPIRE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  QueueTimingPolicyChangeProposalV1: QUEUE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  ExecuteTimingPolicyChangeProposalV1: EXECUTE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG,
  CreateCouncilRotationProposalV2: CREATE_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  ApproveCouncilRotationProposalV2: APPROVE_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  CancelCouncilRotationProposalV2: CANCEL_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  ExpireCouncilRotationProposalV2: EXPIRE_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  QueueCouncilRotationProposalV2: QUEUE_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  ExecuteCouncilRotationProposalV2: EXECUTE_COUNCIL_ROTATION_PROPOSAL_V2_TAG,
  CreateTargetAuthorityHandoffProposalV2: CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  ApproveTargetAuthorityHandoffProposalV2: APPROVE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  CancelTargetAuthorityHandoffProposalV2: CANCEL_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  ExpireTargetAuthorityHandoffProposalV2: EXPIRE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  QueueTargetAuthorityHandoffProposalV2: QUEUE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  ExecuteTargetAuthorityHandoffProposalV2: EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG,
  CreateBootstrapActivationProposalV2: CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
  ApproveBootstrapActivationProposalV2: APPROVE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
  CancelBootstrapActivationProposalV2: CANCEL_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
  ExpireBootstrapActivationProposalV2: EXPIRE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
  QueueBootstrapActivationProposalV2: QUEUE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
  ExecuteBootstrapActivationProposalV2: EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG,
} as const);

export interface GovernanceTimingDurationsV1 {
  reviewSlots: bigint;
  delaySlots: bigint;
  expirySlots: bigint;
}
export type GovernanceClassTimingV1 = GovernanceTimingDurationsV1;

export interface GovernanceTimingBoundariesV1 {
  creationSlot: bigint;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
}

export interface GovernanceLifecycleRegistryV2 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  currentTimingProfile: PublicKey;
  currentTimingProfileVersion: bigint;
  currentTimingProfileHash: Buffer;
  nextProposalId: bigint;
  nextTimingProfileVersion: bigint;
  rotationNonce: bigint;
  lastPolicyChangeProposal: PublicKey;
  creationSlot: bigint;
  reserved: Buffer;
}

export interface GovernanceTimingProfileV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  profileVersion: bigint;
  predecessorProfile: PublicKey;
  predecessorProfileHash: Buffer;
  creationCouncilVersion: bigint;
  emergencyRollback: GovernanceTimingDurationsV1;
  routine: GovernanceTimingDurationsV1;
  major: GovernanceTimingDurationsV1;
  constitutional: GovernanceTimingDurationsV1;
  hardMinimumReviewSlots: bigint;
  hardMinimumDelaySlots: bigint;
  hardMinimumExecutionMarginSlots: bigint;
  profileHash: Buffer;
  creationSlot: bigint;
  finalized: boolean;
  reserved: Buffer;
}

export interface GovernanceProposalLifecycleFieldsV2 {
  state: GovernanceLifecycleStateV2;
  proposalId: bigint;
  reviewDurationSlots: bigint;
  delayDurationSlots: bigint;
  expiryDurationSlots: bigint;
  creationSlot: bigint;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  approvalBitset: number;
  approvalCount: number;
  approvalThreshold: number;
  cancellationBitset: number;
  cancellationCount: number;
  cancellationThreshold: number;
  firstApprovalSlot: bigint;
  councilApprovedSlot: bigint;
  queuedSlot: bigint;
  executedSlot: bigint;
  terminalSlot: bigint;
  terminalReasonCode: number;
  proposalDigest: Buffer;
}

export interface TimingPolicyChangeProposalV1 extends GovernanceProposalLifecycleFieldsV2 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  lifecycleRegistry: PublicKey;
  creationCouncil: PublicKey;
  creationCouncilVersion: bigint;
  creationCouncilHash: Buffer;
  governingTimingProfile: PublicKey;
  governingTimingProfileVersion: bigint;
  governingTimingProfileHash: Buffer;
  candidateTimingProfile: PublicKey;
  candidateTimingProfileVersion: bigint;
  candidateTimingProfileHash: Buffer;
  reserved: Buffer;
}

export interface CouncilRotationProposalV2 extends GovernanceProposalLifecycleFieldsV2 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  governingTimingProfileVersion: bigint;
  governingTimingProfileHash: Buffer;
  currentCouncil: PublicKey;
  currentCouncilVersion: bigint;
  currentCouncilHash: Buffer;
  candidateCouncil: PublicKey;
  candidateCouncilVersion: bigint;
  candidateCouncilHash: Buffer;
  rotationNonce: bigint;
  reserved: Buffer;
}

export interface TargetAuthorityHandoffProposalV2 extends GovernanceProposalLifecycleFieldsV2 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  governingTimingProfileVersion: bigint;
  governingTimingProfileHash: Buffer;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  controllerImmutabilityDigest: Buffer;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  governancePolicyHash: Buffer;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  gate: PublicKey;
  controllerAuthority: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  legacyTargetAuthority: PublicKey;
  bridgeArtifactLength: bigint;
  bridgeArtifactSha256: Buffer;
  bridgeArtifactMerkleRoot: Buffer;
  bridgeArtifactSchemeId: Buffer;
  bridgeSourceCommitment: Buffer;
  bridgeBuildInputsCommitment: Buffer;
  bridgePackageCommitment: Buffer;
  bridgeReleaseManifestCommitment: Buffer;
  bridgeObservation: PublicKey;
  bridgeObservationGeneration: bigint;
  bridgeObservationRoot: Buffer;
  bridgeObservationDigest: Buffer;
  minimumTargetDeployedSlot: bigint;
  minimumTargetCapacity: bigint;
  minimumTargetRawLength: bigint;
  bootstrapGateStatus: GateStatusV1;
  bootstrapGateEpoch: bigint;
  bootstrapFreezeReasonCode: number;
  bootstrapFreezeSlot: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  reserved: Buffer;
}

export interface BootstrapActivationProposalV2 extends GovernanceProposalLifecycleFieldsV2 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  governingTimingProfileVersion: bigint;
  governingTimingProfileHash: Buffer;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  governancePolicyHash: Buffer;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  controllerImmutabilityReceipt: PublicKey;
  controllerImmutabilityDigest: Buffer;
  targetHandoffReceipt: PublicKey;
  targetHandoffDigest: Buffer;
  gate: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  controllerAuthority: PublicKey;
  bridgeArtifactLength: bigint;
  bridgeArtifactSha256: Buffer;
  bridgeArtifactMerkleRoot: Buffer;
  bridgeArtifactSchemeId: Buffer;
  bridgeSourceCommitment: Buffer;
  bridgeBuildInputsCommitment: Buffer;
  bridgePackageCommitment: Buffer;
  bridgeReleaseManifestCommitment: Buffer;
  bridgeObservation: PublicKey;
  bridgeObservationGeneration: bigint;
  bridgeObservationRoot: Buffer;
  bridgeObservationDigest: Buffer;
  minimumTargetDeployedSlot: bigint;
  minimumTargetCapacity: bigint;
  minimumTargetRawLength: bigint;
  bootstrapGateStatus: GateStatusV1;
  bootstrapGateEpoch: bigint;
  bootstrapFreezeReasonCode: number;
  bootstrapFreezeSlot: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  reserved: Buffer;
}

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const ZERO_HASH = Buffer.alloc(32);
const ORDINARY_APPROVAL_THRESHOLD = 3;
const COUNCIL_MASK = 0x1f;

export const GOVERNANCE_V2_ACCOUNT_VERSION = 2;
export const GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION = 1;
export const NOMINAL_SLOTS_PER_DAY_V1 = 216_000n;
export const NOMINAL_SLOTS_PER_WEEK_V1 = 1_512_000n;
export const MINIMUM_REVIEW_SLOTS_V1 = 4_500n;
export const MINIMUM_DELAY_SLOTS_V1 = 4_500n;
export const MINIMUM_EXECUTION_MARGIN_SLOTS_V1 = 9_000n;

type FieldKind =
  | { readonly kind: "bytes"; readonly length: number }
  | { readonly kind: "pubkey" }
  | { readonly kind: "bool" }
  | { readonly kind: "u8" }
  | { readonly kind: "u16" }
  | { readonly kind: "u64" }
  | { readonly kind: "timing" };

interface FieldSpec { readonly name: string; readonly type: FieldKind }

const bytes = (name: string, length: number): FieldSpec => ({ name, type: { kind: "bytes", length } });
const key = (name: string): FieldSpec => ({ name, type: { kind: "pubkey" } });
const bool = (name: string): FieldSpec => ({ name, type: { kind: "bool" } });
const u8 = (name: string): FieldSpec => ({ name, type: { kind: "u8" } });
const u16 = (name: string): FieldSpec => ({ name, type: { kind: "u16" } });
const u64 = (name: string): FieldSpec => ({ name, type: { kind: "u64" } });
const timing = (name: string): FieldSpec => ({ name, type: { kind: "timing" } });

const HEADER_SCHEMA: readonly FieldSpec[] = [
  bytes("discriminator", 8), u8("version"), u8("bump"), bool("initialized"),
];

const LIFECYCLE_FIELDS_SCHEMA: readonly FieldSpec[] = [
  u64("reviewDurationSlots"), u64("delayDurationSlots"), u64("expiryDurationSlots"),
  u64("creationSlot"), u64("reviewStartSlot"), u64("reviewEndSlot"),
  u64("notBeforeSlot"), u64("expirySlot"),
  u8("approvalBitset"), u8("approvalCount"), u8("approvalThreshold"),
  u8("cancellationBitset"), u8("cancellationCount"), u8("cancellationThreshold"),
  u64("firstApprovalSlot"), u64("councilApprovedSlot"), u64("queuedSlot"),
  u64("executedSlot"), u64("terminalSlot"), u16("terminalReasonCode"),
  bytes("proposalDigest", 32),
];

const REGISTRY_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA,
  key("controllerProgram"), key("controllerConfig"), key("targetProgram"), key("currentTimingProfile"),
  u64("currentTimingProfileVersion"), bytes("currentTimingProfileHash", 32),
  u64("nextProposalId"), u64("nextTimingProfileVersion"), u64("rotationNonce"),
  key("lastPolicyChangeProposal"), u64("creationSlot"),
  bytes("reserved", GOVERNANCE_LIFECYCLE_REGISTRY_V2_RESERVED_LEN),
];

const TIMING_PROFILE_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA,
  key("controllerConfig"), key("targetProgram"), u64("profileVersion"),
  key("predecessorProfile"), bytes("predecessorProfileHash", 32), u64("creationCouncilVersion"),
  timing("emergencyRollback"), timing("routine"), timing("major"), timing("constitutional"),
  u64("hardMinimumReviewSlots"), u64("hardMinimumDelaySlots"), u64("hardMinimumExecutionMarginSlots"),
  bytes("profileHash", 32), u64("creationSlot"), bool("finalized"),
  bytes("reserved", GOVERNANCE_TIMING_PROFILE_V1_RESERVED_LEN),
];

const TIMING_POLICY_CHANGE_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA, u8("state"), u64("proposalId"),
  key("controllerConfig"), key("targetProgram"), key("lifecycleRegistry"), key("creationCouncil"),
  u64("creationCouncilVersion"), bytes("creationCouncilHash", 32),
  key("governingTimingProfile"), u64("governingTimingProfileVersion"), bytes("governingTimingProfileHash", 32),
  key("candidateTimingProfile"), u64("candidateTimingProfileVersion"), bytes("candidateTimingProfileHash", 32),
  ...LIFECYCLE_FIELDS_SCHEMA,
  bytes("reserved", TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN),
];

const COUNCIL_ROTATION_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA, u8("state"), u64("proposalId"),
  key("controllerConfig"), key("targetProgram"), key("lifecycleRegistry"),
  key("governingTimingProfile"), u64("governingTimingProfileVersion"), bytes("governingTimingProfileHash", 32),
  key("currentCouncil"), u64("currentCouncilVersion"), bytes("currentCouncilHash", 32),
  key("candidateCouncil"), u64("candidateCouncilVersion"), bytes("candidateCouncilHash", 32),
  u64("rotationNonce"),
  ...LIFECYCLE_FIELDS_SCHEMA,
  bytes("reserved", COUNCIL_ROTATION_PROPOSAL_V2_RESERVED_LEN),
];

const TARGET_HANDOFF_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA, u8("state"), u64("proposalId"),
  key("lifecycleRegistry"), key("governingTimingProfile"), u64("governingTimingProfileVersion"),
  bytes("governingTimingProfileHash", 32), bytes("clusterDomain", 32),
  key("controllerProgram"), key("controllerProgramdata"), key("controllerImmutabilityReceipt"),
  bytes("controllerImmutabilityDigest", 32), key("controllerConfig"), key("governancePolicy"),
  bytes("governancePolicyHash", 32), key("capacityPolicy"), bytes("capacityPolicyDigest", 32),
  key("gate"), key("controllerAuthority"), key("targetProgram"), key("targetProgramdata"),
  key("upgradeableLoader"), key("legacyTargetAuthority"), u64("bridgeArtifactLength"),
  bytes("bridgeArtifactSha256", 32), bytes("bridgeArtifactMerkleRoot", 32), bytes("bridgeArtifactSchemeId", 32),
  bytes("bridgeSourceCommitment", 32), bytes("bridgeBuildInputsCommitment", 32),
  bytes("bridgePackageCommitment", 32), bytes("bridgeReleaseManifestCommitment", 32),
  key("bridgeObservation"), u64("bridgeObservationGeneration"),
  bytes("bridgeObservationRoot", 32), bytes("bridgeObservationDigest", 32),
  u64("minimumTargetDeployedSlot"), u64("minimumTargetCapacity"), u64("minimumTargetRawLength"),
  u8("bootstrapGateStatus"), u64("bootstrapGateEpoch"), u16("bootstrapFreezeReasonCode"),
  u64("bootstrapFreezeSlot"), u64("targetNonce"), u64("councilVersion"), bytes("councilHash", 32),
  u64("reviewDurationSlots"), u64("delayDurationSlots"), u64("expiryDurationSlots"),
  u64("reviewStartSlot"), u64("reviewEndSlot"), u64("notBeforeSlot"), u64("expirySlot"),
  u8("approvalBitset"), u8("approvalCount"), u8("approvalThreshold"),
  u8("cancellationBitset"), u8("cancellationCount"), u8("cancellationThreshold"),
  u64("firstApprovalSlot"), u64("councilApprovedSlot"), u64("queuedSlot"),
  u64("executedSlot"), u64("terminalSlot"), u16("terminalReasonCode"),
  bytes("proposalDigest", 32), u64("creationSlot"),
  bytes("reserved", TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_RESERVED_LEN),
];

const BOOTSTRAP_ACTIVATION_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_SCHEMA, u8("state"), u64("proposalId"),
  key("lifecycleRegistry"), key("governingTimingProfile"), u64("governingTimingProfileVersion"),
  bytes("governingTimingProfileHash", 32), bytes("clusterDomain", 32),
  key("controllerProgram"), key("controllerProgramdata"), key("controllerConfig"),
  key("governancePolicy"), bytes("governancePolicyHash", 32), key("capacityPolicy"),
  bytes("capacityPolicyDigest", 32), key("controllerImmutabilityReceipt"),
  bytes("controllerImmutabilityDigest", 32), key("targetHandoffReceipt"), bytes("targetHandoffDigest", 32),
  key("gate"), key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"), key("controllerAuthority"),
  u64("bridgeArtifactLength"), bytes("bridgeArtifactSha256", 32), bytes("bridgeArtifactMerkleRoot", 32),
  bytes("bridgeArtifactSchemeId", 32), bytes("bridgeSourceCommitment", 32),
  bytes("bridgeBuildInputsCommitment", 32), bytes("bridgePackageCommitment", 32),
  bytes("bridgeReleaseManifestCommitment", 32), key("bridgeObservation"), u64("bridgeObservationGeneration"),
  bytes("bridgeObservationRoot", 32), bytes("bridgeObservationDigest", 32),
  u64("minimumTargetDeployedSlot"), u64("minimumTargetCapacity"), u64("minimumTargetRawLength"),
  u8("bootstrapGateStatus"), u64("bootstrapGateEpoch"), u16("bootstrapFreezeReasonCode"),
  u64("bootstrapFreezeSlot"), u64("targetNonce"), u64("councilVersion"), bytes("councilHash", 32),
  u64("reviewDurationSlots"), u64("delayDurationSlots"), u64("expiryDurationSlots"),
  u64("reviewStartSlot"), u64("reviewEndSlot"), u64("notBeforeSlot"), u64("expirySlot"),
  u8("approvalBitset"), u8("approvalCount"), u8("approvalThreshold"),
  u8("cancellationBitset"), u8("cancellationCount"), u8("cancellationThreshold"),
  u64("firstApprovalSlot"), u64("councilApprovedSlot"), u64("queuedSlot"),
  u64("executedSlot"), u64("terminalSlot"), u16("terminalReasonCode"),
  bytes("proposalDigest", 32), u64("creationSlot"),
  bytes("reserved", BOOTSTRAP_ACTIVATION_PROPOSAL_V2_RESERVED_LEN),
];

function requireU8(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${field} must be a u8`);
  return value;
}

function requireU16(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${field} must be a u16`);
  return value;
}

function requireU64(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) throw new RangeError(`${field} must be a u64`);
  return value;
}

function checkedAddU64(left: bigint, right: bigint, field: string): bigint {
  const result = requireU64(left, field) + requireU64(right, field);
  if (result > U64_MAX) throw new RangeError(`${field} overflows u64`);
  return result;
}

function u64Le(value: bigint, field = "u64"): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(requireU64(value, field));
  return out;
}

function requireBytes(value: Uint8Array, length: number, field: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length !== length) throw new RangeError(`${field} must be ${length} bytes`);
  return bytes;
}

function requireHash(value: Uint8Array, field: string, allowZero = false): Buffer {
  const hash = requireBytes(value, 32, field);
  if (!allowZero && hash.equals(ZERO_HASH)) throw new Error(`${field} must be nonzero`);
  return hash;
}

function requireKey(value: PublicKey, field: string, allowDefault = false): PublicKey {
  if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`);
  if (!allowDefault && value.equals(PublicKey.default)) throw new Error(`${field} must be nondefault`);
  return value;
}

function encodeField(kind: FieldKind, value: unknown, field: string): Buffer {
  switch (kind.kind) {
    case "bytes": return requireBytes(value as Uint8Array, kind.length, field);
    case "pubkey": return requireKey(value as PublicKey, field, true).toBuffer();
    case "bool": {
      if (typeof value !== "boolean") throw new TypeError(`${field} must be boolean`);
      return Buffer.from([Number(value)]);
    }
    case "u8": return Buffer.from([requireU8(value as number, field)]);
    case "u16": {
      const out = Buffer.alloc(2);
      out.writeUInt16LE(requireU16(value as number, field));
      return out;
    }
    case "u64": return u64Le(value as bigint, field);
    case "timing": {
      if (value === null || typeof value !== "object") throw new TypeError(`${field} must be timing durations`);
      const timingValue = value as GovernanceTimingDurationsV1;
      return Buffer.concat([
        u64Le(timingValue.reviewSlots, `${field}.reviewSlots`),
        u64Le(timingValue.delaySlots, `${field}.delaySlots`),
        u64Le(timingValue.expirySlots, `${field}.expirySlots`),
      ]);
    }
  }
}

function encodeSchema(value: object, schema: readonly FieldSpec[], expectedLength: number): Buffer {
  const record = value as unknown as Record<string, unknown>;
  const encoded = Buffer.concat(schema.map((field) => encodeField(field.type, record[field.name], field.name)));
  if (encoded.length !== expectedLength) throw new Error(`fixed encoding length ${encoded.length}; expected ${expectedLength}`);
  return encoded;
}

class Reader {
  readonly #bytes: Buffer;
  #offset = 0;

  constructor(value: Uint8Array, expectedLength: number, name: string) {
    this.#bytes = requireBytes(value, expectedLength, name);
  }

  take(length: number): Buffer {
    const end = this.#offset + length;
    if (end > this.#bytes.length) throw new RangeError("truncated fixed account");
    const value = Buffer.from(this.#bytes.subarray(this.#offset, end));
    this.#offset = end;
    return value;
  }

  field(kind: FieldKind, name: string): unknown {
    switch (kind.kind) {
      case "bytes": return this.take(kind.length);
      case "pubkey": return new PublicKey(this.take(32));
      case "bool": {
        const value = this.take(1)[0]!;
        if (value > 1) throw new Error(`${name} is not a canonical boolean`);
        return value === 1;
      }
      case "u8": return this.take(1)[0]!;
      case "u16": return this.take(2).readUInt16LE(0);
      case "u64": return this.take(8).readBigUInt64LE(0);
      case "timing": return {
        reviewSlots: this.take(8).readBigUInt64LE(0),
        delaySlots: this.take(8).readBigUInt64LE(0),
        expirySlots: this.take(8).readBigUInt64LE(0),
      } satisfies GovernanceTimingDurationsV1;
    }
  }

  end(name: string): void {
    if (this.#offset !== this.#bytes.length) throw new Error(`${name} has trailing bytes`);
  }
}

function decodeSchema<T>(value: Uint8Array, schema: readonly FieldSpec[], length: number, name: string): T {
  const reader = new Reader(value, length, name);
  const record: Record<string, unknown> = {};
  for (const field of schema) record[field.name] = reader.field(field.type, field.name);
  reader.end(name);
  return record as T;
}

function requireHeader(
  value: { discriminator: Buffer; version: number; bump: number; initialized: boolean; reserved: Buffer },
  discriminator: Buffer,
  version: number,
  reservedLength: number,
  name: string,
): void {
  if (!requireBytes(value.discriminator, 8, `${name}.discriminator`).equals(discriminator)) throw new Error(`invalid ${name} discriminator`);
  if (value.version !== version) throw new Error(`unsupported ${name} version`);
  requireU8(value.bump, `${name}.bump`);
  if (value.initialized !== true) throw new Error(`${name} is uninitialized`);
  if (!requireBytes(value.reserved, reservedLength, `${name}.reserved`).equals(Buffer.alloc(reservedLength))) throw new Error(`${name}.reserved must be zero`);
}

function requireNonzeroHashes(entries: Readonly<Record<string, Uint8Array>>): void {
  for (const [field, hash] of Object.entries(entries)) requireHash(hash, field);
}

function requireNondefaultKeys(entries: Readonly<Record<string, PublicKey>>): void {
  for (const [field, keyValue] of Object.entries(entries)) requireKey(keyValue, field);
}

function popcount5(bitset: number): number {
  let count = 0;
  for (let index = 0; index < 5; index += 1) count += (bitset >>> index) & 1;
  return count;
}

export function validateGovernanceApprovalAccumulatorV2(bitset: number, count: number): void {
  if ((requireU8(bitset, "approvalBitset") & ~COUNCIL_MASK) !== 0) throw new Error("approval bitset has non-council bits");
  if (requireU8(count, "approvalCount") !== popcount5(bitset)) throw new Error("approval bitset/count mismatch");
}

export function validateCancellationAccumulatorV2(bitset: number, count: number): void {
  validateGovernanceApprovalAccumulatorV2(bitset, count);
}

function validateBoundTimingV2(value: GovernanceProposalLifecycleFieldsV2): void {
  const derived = deriveGovernanceTimingBoundariesV1(value.creationSlot, {
    reviewSlots: value.reviewDurationSlots,
    delaySlots: value.delayDurationSlots,
    expirySlots: value.expiryDurationSlots,
  });
  if (
    value.reviewStartSlot !== derived.reviewStartSlot ||
    value.reviewEndSlot !== derived.reviewEndSlot ||
    value.notBeforeSlot !== derived.notBeforeSlot ||
    value.expirySlot !== derived.expirySlot
  ) throw new Error("proposal timing binding mismatch");
}

export function validateGovernanceLifecycleFieldsV2(value: GovernanceProposalLifecycleFieldsV2): void {
  validateGovernanceApprovalAccumulatorV2(value.approvalBitset, value.approvalCount);
  validateCancellationAccumulatorV2(value.cancellationBitset, value.cancellationCount);
  if (value.approvalThreshold !== ORDINARY_APPROVAL_THRESHOLD || value.cancellationThreshold !== ORDINARY_APPROVAL_THRESHOLD) {
    throw new Error("V2 lifecycle threshold must be three of five");
  }
  validateBoundTimingV2(value);
  if (!(Object.values(GovernanceLifecycleStateV2) as readonly number[]).includes(value.state)) throw new Error("unknown V2 lifecycle state");
  for (const [field, slot] of Object.entries({
    firstApprovalSlot: value.firstApprovalSlot,
    councilApprovedSlot: value.councilApprovedSlot,
    queuedSlot: value.queuedSlot,
    executedSlot: value.executedSlot,
    terminalSlot: value.terminalSlot,
  })) requireU64(slot, field);
  requireU16(value.terminalReasonCode, "terminalReasonCode");
  if (value.approvalCount === 0) {
    if (value.firstApprovalSlot !== 0n) throw new Error("empty approval accumulator must not have a first approval slot");
  } else if (value.firstApprovalSlot < value.reviewStartSlot || value.firstApprovalSlot > value.reviewEndSlot) {
    throw new Error("first approval slot is outside the review window");
  }

  switch (value.state) {
    case GovernanceLifecycleStateV2.Draft:
      if (
        value.approvalCount >= ORDINARY_APPROVAL_THRESHOLD ||
        value.cancellationCount >= ORDINARY_APPROVAL_THRESHOLD ||
        value.councilApprovedSlot !== 0n || value.queuedSlot !== 0n || value.executedSlot !== 0n ||
        value.terminalSlot !== 0n || value.terminalReasonCode !== 0
      ) throw new Error("invalid Draft lifecycle accumulators");
      break;
    case GovernanceLifecycleStateV2.CouncilApproved:
      if (
        value.approvalCount < ORDINARY_APPROVAL_THRESHOLD ||
        value.cancellationCount >= ORDINARY_APPROVAL_THRESHOLD ||
        value.councilApprovedSlot < value.firstApprovalSlot ||
        value.councilApprovedSlot > value.reviewEndSlot ||
        value.queuedSlot !== 0n || value.executedSlot !== 0n || value.terminalSlot !== 0n ||
        value.terminalReasonCode !== 0
      ) throw new Error("invalid CouncilApproved lifecycle accumulators");
      break;
    case GovernanceLifecycleStateV2.Timelocked:
      if (
        value.approvalCount < ORDINARY_APPROVAL_THRESHOLD ||
        value.cancellationCount >= ORDINARY_APPROVAL_THRESHOLD ||
        value.councilApprovedSlot < value.firstApprovalSlot ||
        value.queuedSlot < value.councilApprovedSlot ||
        value.queuedSlot >= value.expirySlot || value.executedSlot !== 0n || value.terminalSlot !== 0n ||
        value.terminalReasonCode !== 0
      ) throw new Error("invalid Timelocked lifecycle accumulators");
      break;
    case GovernanceLifecycleStateV2.Completed:
      if (
        value.approvalCount < ORDINARY_APPROVAL_THRESHOLD || value.queuedSlot === 0n ||
        value.executedSlot < value.notBeforeSlot || value.executedSlot >= value.expirySlot ||
        value.terminalSlot !== value.executedSlot || value.terminalReasonCode === 0
      ) throw new Error("invalid Completed lifecycle accumulators");
      break;
    case GovernanceLifecycleStateV2.Cancelled:
      if (
        value.cancellationCount < ORDINARY_APPROVAL_THRESHOLD || value.executedSlot !== 0n ||
        value.terminalSlot === 0n || value.terminalSlot >= value.expirySlot || value.terminalReasonCode === 0
      ) throw new Error("invalid Cancelled lifecycle accumulators");
      break;
    case GovernanceLifecycleStateV2.Expired:
      if (value.executedSlot !== 0n || value.terminalSlot < value.expirySlot || value.terminalReasonCode === 0) {
        throw new Error("invalid Expired lifecycle accumulators");
      }
      break;
  }
}

export function deriveGovernanceTimingBoundariesV1(
  creationSlot: bigint,
  durations: GovernanceTimingDurationsV1,
): GovernanceTimingBoundariesV1 {
  requireU64(creationSlot, "creationSlot");
  if (creationSlot === 0n) throw new Error("creationSlot must be nonzero");
  validateGovernanceTimingDurationsV1(durations);
  const reviewStartSlot = creationSlot;
  const reviewEndSlot = checkedAddU64(creationSlot, durations.reviewSlots, "reviewEndSlot");
  const notBeforeSlot = checkedAddU64(creationSlot, durations.delaySlots, "notBeforeSlot");
  const expirySlot = checkedAddU64(creationSlot, durations.expirySlots, "expirySlot");
  const minimumExpirySlot = checkedAddU64(
    reviewEndSlot > notBeforeSlot ? reviewEndSlot : notBeforeSlot,
    MINIMUM_EXECUTION_MARGIN_SLOTS_V1,
    "minimumExpirySlot",
  );
  if (expirySlot < minimumExpirySlot) throw new Error("expiry must preserve the execution margin");
  return { creationSlot, reviewStartSlot, reviewEndSlot, notBeforeSlot, expirySlot };
}

export function governanceClassTimingV1(
  profile: GovernanceTimingProfileV1,
  timingClass: GovernanceTimingClassV1,
): GovernanceTimingDurationsV1 {
  switch (timingClass) {
    case GovernanceTimingClassV1.EmergencyRollback: return profile.emergencyRollback;
    case GovernanceTimingClassV1.Routine: return profile.routine;
    case GovernanceTimingClassV1.Major: return profile.major;
    case GovernanceTimingClassV1.Constitutional: return profile.constitutional;
    default: throw new RangeError("unknown governance timing class");
  }
}

export function deriveProposalTimingV2(
  profile: GovernanceTimingProfileV1,
  timingClass: GovernanceTimingClassV1,
  actualCreationSlot: bigint,
): GovernanceTimingBoundariesV1 & GovernanceTimingDurationsV1 {
  validateGovernanceTimingProfileV1(profile);
  const selected = governanceClassTimingV1(profile, timingClass);
  return { ...selected, ...deriveGovernanceTimingBoundariesV1(actualCreationSlot, selected) };
}

export function nominalGovernanceTimingProfileV1(args: {
  bump: number;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  creationCouncilVersion: bigint;
  creationSlot: bigint;
}): GovernanceTimingProfileV1 {
  const profile: GovernanceTimingProfileV1 = {
    discriminator: GOVERNANCE_TIMING_PROFILE_V1_DISCRIMINATOR,
    version: GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION,
    bump: requireU8(args.bump, "bump"),
    initialized: true,
    controllerConfig: args.controllerConfig,
    targetProgram: args.targetProgram,
    profileVersion: 1n,
    predecessorProfile: PublicKey.default,
    predecessorProfileHash: Buffer.alloc(32),
    creationCouncilVersion: args.creationCouncilVersion,
    emergencyRollback: { reviewSlots: 21_600n, delaySlots: MINIMUM_DELAY_SLOTS_V1, expirySlots: NOMINAL_SLOTS_PER_DAY_V1 },
    routine: { reviewSlots: NOMINAL_SLOTS_PER_WEEK_V1, delaySlots: 4_500n, expirySlots: 12n * NOMINAL_SLOTS_PER_DAY_V1 },
    major: { reviewSlots: 2n * NOMINAL_SLOTS_PER_WEEK_V1, delaySlots: 9_000n, expirySlots: 24n * NOMINAL_SLOTS_PER_DAY_V1 },
    constitutional: { reviewSlots: 4n * NOMINAL_SLOTS_PER_WEEK_V1, delaySlots: 18_000n, expirySlots: 49n * NOMINAL_SLOTS_PER_DAY_V1 },
    hardMinimumReviewSlots: MINIMUM_REVIEW_SLOTS_V1,
    hardMinimumDelaySlots: MINIMUM_DELAY_SLOTS_V1,
    hardMinimumExecutionMarginSlots: MINIMUM_EXECUTION_MARGIN_SLOTS_V1,
    profileHash: Buffer.alloc(32),
    creationSlot: args.creationSlot,
    finalized: true,
    reserved: Buffer.alloc(GOVERNANCE_TIMING_PROFILE_V1_RESERVED_LEN),
  };
  profile.profileHash = governanceTimingProfileHashV1(profile);
  validateGovernanceTimingProfileV1(profile);
  return profile;
}

export function validateGovernanceTimingDurationsV1(
  durations: GovernanceTimingDurationsV1,
  minimums?: GovernanceTimingDurationsV1,
  executionMarginSlots = MINIMUM_EXECUTION_MARGIN_SLOTS_V1,
): void {
  const reviewSlots = requireU64(durations.reviewSlots, "reviewSlots");
  const delaySlots = requireU64(durations.delaySlots, "delaySlots");
  const expirySlots = requireU64(durations.expirySlots, "expirySlots");
  const margin = requireU64(executionMarginSlots, "executionMarginSlots");
  if (reviewSlots < MINIMUM_REVIEW_SLOTS_V1 || delaySlots < MINIMUM_DELAY_SLOTS_V1 || margin === 0n) throw new Error("timing durations are below the protocol hard floors");
  const minimumExpiry = checkedAddU64(reviewSlots > delaySlots ? reviewSlots : delaySlots, margin, "latestBoundaryAndMargin");
  if (expirySlots <= minimumExpiry) throw new Error("expiry must exceed both review and delay by the execution margin");
  if (minimums !== undefined && (
    reviewSlots < requireU64(minimums.reviewSlots, "minimumReviewSlots") ||
    delaySlots < requireU64(minimums.delaySlots, "minimumDelaySlots") ||
    expirySlots < requireU64(minimums.expirySlots, "minimumExpirySlots")
  )) throw new Error("timing profile is below a protocol hard floor");
}

const GOVERNANCE_V2_SEED_PREFIX = Buffer.from("ameba-gov-v2", "ascii");
const LIFECYCLE_REGISTRY_SEED_V2 = Buffer.from("lifecycle", "ascii");
const TIMING_PROFILE_SEED_V1 = Buffer.from("timing-profile", "ascii");
const GOVERNANCE_ACTION_PROPOSAL_V2_SEED = Buffer.from("proposal", "ascii");

export function deriveGovernanceLifecycleRegistryPdaV2(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([
    GOVERNANCE_V2_SEED_PREFIX,
    LIFECYCLE_REGISTRY_SEED_V2,
    requireKey(targetProgram, "targetProgram").toBuffer(),
  ], requireKey(controllerProgram, "controllerProgram"));
}

export function deriveGovernanceTimingProfilePdaV1(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  profileVersion: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([
    GOVERNANCE_V2_SEED_PREFIX,
    TIMING_PROFILE_SEED_V1,
    requireKey(targetProgram, "targetProgram").toBuffer(),
    u64Le(profileVersion, "profileVersion"),
  ], requireKey(controllerProgram, "controllerProgram"));
}

export function deriveGovernanceActionProposalPdaV2(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  kind: GovernanceActionKindV2,
  proposalId: bigint,
): [PublicKey, number] {
  if (!Object.values(GovernanceActionKindV2).includes(kind)) throw new RangeError("unknown V2 proposal kind");
  return PublicKey.findProgramAddressSync([
    GOVERNANCE_V2_SEED_PREFIX,
    GOVERNANCE_ACTION_PROPOSAL_V2_SEED,
    requireKey(targetProgram, "targetProgram").toBuffer(),
    Buffer.from([kind]),
    u64Le(proposalId, "proposalId"),
  ], requireKey(controllerProgram, "controllerProgram"));
}

export function sha256GovernanceV2(domain: Uint8Array, material: Uint8Array): Buffer {
  return createHash("sha256").update(domain).update(material).digest();
}

export const GOVERNANCE_LIVENESS_ORDINARY_THRESHOLD_V2 = ORDINARY_APPROVAL_THRESHOLD;

export function governanceTimingProfileHashV1(value: GovernanceTimingProfileV1): Buffer {
  const normalized: GovernanceTimingProfileV1 = {
    ...value,
    profileHash: Buffer.alloc(32),
    // creationSlot is recorded from Clock and is not policy identity. Keeping
    // it out of the hash removes any exact-slot landing requirement.
    creationSlot: 0n,
    reserved: Buffer.alloc(GOVERNANCE_TIMING_PROFILE_V1_RESERVED_LEN),
  };
  return sha256GovernanceV2(
    GOVERNANCE_TIMING_PROFILE_HASH_DOMAIN_V1,
    encodeSchema(normalized, TIMING_PROFILE_SCHEMA, GOVERNANCE_TIMING_PROFILE_V1_LEN),
  );
}

function normalizeProposalLifecycleV2<T extends GovernanceProposalLifecycleFieldsV2>(value: T): T {
  return {
    ...value,
    state: GovernanceLifecycleStateV2.Draft,
    approvalBitset: 0,
    approvalCount: 0,
    cancellationBitset: 0,
    cancellationCount: 0,
    firstApprovalSlot: 0n,
    councilApprovedSlot: 0n,
    queuedSlot: 0n,
    executedSlot: 0n,
    terminalSlot: 0n,
    terminalReasonCode: 0,
    proposalDigest: Buffer.alloc(32),
  };
}

export function timingPolicyChangeProposalDigestV1(value: TimingPolicyChangeProposalV1): Buffer {
  const normalized: TimingPolicyChangeProposalV1 = {
    ...normalizeProposalLifecycleV2(value),
    reserved: Buffer.alloc(TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN),
  };
  return sha256GovernanceV2(
    TIMING_POLICY_CHANGE_PROPOSAL_DIGEST_DOMAIN_V1,
    encodeSchema(normalized, TIMING_POLICY_CHANGE_SCHEMA, TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN),
  );
}

export function councilRotationProposalDigestV2(value: CouncilRotationProposalV2): Buffer {
  const normalized: CouncilRotationProposalV2 = {
    ...normalizeProposalLifecycleV2(value),
    reserved: Buffer.alloc(COUNCIL_ROTATION_PROPOSAL_V2_RESERVED_LEN),
  };
  return sha256GovernanceV2(
    COUNCIL_ROTATION_PROPOSAL_DIGEST_DOMAIN_V2,
    encodeSchema(normalized, COUNCIL_ROTATION_SCHEMA, COUNCIL_ROTATION_PROPOSAL_V2_LEN),
  );
}

export function targetAuthorityHandoffProposalDigestV2(value: TargetAuthorityHandoffProposalV2): Buffer {
  const normalized: TargetAuthorityHandoffProposalV2 = {
    ...normalizeProposalLifecycleV2(value),
    reserved: Buffer.alloc(TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_RESERVED_LEN),
  };
  return sha256GovernanceV2(
    TARGET_AUTHORITY_HANDOFF_PROPOSAL_DIGEST_DOMAIN_V2,
    encodeSchema(normalized, TARGET_HANDOFF_SCHEMA, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN),
  );
}

export function bootstrapActivationProposalDigestV2(value: BootstrapActivationProposalV2): Buffer {
  const normalized: BootstrapActivationProposalV2 = {
    ...normalizeProposalLifecycleV2(value),
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_PROPOSAL_V2_RESERVED_LEN),
  };
  return sha256GovernanceV2(
    BOOTSTRAP_ACTIVATION_PROPOSAL_DIGEST_DOMAIN_V2,
    encodeSchema(normalized, BOOTSTRAP_ACTIVATION_SCHEMA, BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN),
  );
}

export function validateGovernanceLifecycleRegistryV2(value: GovernanceLifecycleRegistryV2): void {
  requireHeader(value, GOVERNANCE_LIFECYCLE_REGISTRY_V2_DISCRIMINATOR, GOVERNANCE_V2_ACCOUNT_VERSION, GOVERNANCE_LIFECYCLE_REGISTRY_V2_RESERVED_LEN, "GovernanceLifecycleRegistryV2");
  requireNondefaultKeys({
    controllerProgram: value.controllerProgram,
    controllerConfig: value.controllerConfig,
    targetProgram: value.targetProgram,
    currentTimingProfile: value.currentTimingProfile,
  });
  requireHash(value.currentTimingProfileHash, "currentTimingProfileHash");
  if (
    value.currentTimingProfileVersion === 0n || value.nextProposalId === 0n ||
    value.nextTimingProfileVersion <= value.currentTimingProfileVersion || value.rotationNonce === 0n || value.creationSlot === 0n
  ) throw new Error("invalid lifecycle registry counters");
  for (const [field, counter] of Object.entries({
    currentTimingProfileVersion: value.currentTimingProfileVersion,
    nextProposalId: value.nextProposalId,
    nextTimingProfileVersion: value.nextTimingProfileVersion,
    rotationNonce: value.rotationNonce,
    creationSlot: value.creationSlot,
  })) requireU64(counter, field);
  requireKey(value.lastPolicyChangeProposal, "lastPolicyChangeProposal", true);
}

export function validateGovernanceTimingProfileV1(value: GovernanceTimingProfileV1): void {
  requireHeader(value, GOVERNANCE_TIMING_PROFILE_V1_DISCRIMINATOR, GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION, GOVERNANCE_TIMING_PROFILE_V1_RESERVED_LEN, "GovernanceTimingProfileV1");
  requireNondefaultKeys({ controllerConfig: value.controllerConfig, targetProgram: value.targetProgram });
  if (value.profileVersion === 0n || value.creationCouncilVersion === 0n || value.creationSlot === 0n || value.finalized !== true) {
    throw new Error("invalid timing profile identity");
  }
  if (
    value.hardMinimumReviewSlots !== MINIMUM_REVIEW_SLOTS_V1 ||
    value.hardMinimumDelaySlots !== MINIMUM_DELAY_SLOTS_V1 ||
    value.hardMinimumExecutionMarginSlots !== MINIMUM_EXECUTION_MARGIN_SLOTS_V1
  ) throw new Error("timing profile hard floors mismatch");
  if (value.profileVersion === 1n) {
    if (!value.predecessorProfile.equals(PublicKey.default) || !requireBytes(value.predecessorProfileHash, 32, "predecessorProfileHash").equals(ZERO_HASH)) {
      throw new Error("initial timing profile must not have a predecessor");
    }
  } else {
    requireKey(value.predecessorProfile, "predecessorProfile");
    requireHash(value.predecessorProfileHash, "predecessorProfileHash");
  }
  for (const timingValue of [value.emergencyRollback, value.routine, value.major, value.constitutional]) {
    validateGovernanceTimingDurationsV1(timingValue);
  }
  if (!governanceTimingProfileHashV1(value).equals(requireHash(value.profileHash, "profileHash"))) throw new Error("timing profile hash mismatch");
}

function validateProposalIdentityV2(value: GovernanceProposalLifecycleFieldsV2): void {
  if (value.proposalId === 0n) throw new Error("proposalId must be nonzero");
  requireU64(value.proposalId, "proposalId");
  validateGovernanceLifecycleFieldsV2(value);
  requireHash(value.proposalDigest, "proposalDigest");
}

export function validateTimingPolicyChangeProposalV1(value: TimingPolicyChangeProposalV1): void {
  requireHeader(value, TIMING_POLICY_CHANGE_PROPOSAL_V1_DISCRIMINATOR, GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION, TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN, "TimingPolicyChangeProposalV1");
  requireNondefaultKeys({
    controllerConfig: value.controllerConfig, targetProgram: value.targetProgram, lifecycleRegistry: value.lifecycleRegistry,
    creationCouncil: value.creationCouncil, governingTimingProfile: value.governingTimingProfile,
    candidateTimingProfile: value.candidateTimingProfile,
  });
  requireNonzeroHashes({
    creationCouncilHash: value.creationCouncilHash, governingTimingProfileHash: value.governingTimingProfileHash,
    candidateTimingProfileHash: value.candidateTimingProfileHash,
  });
  if (
    value.creationCouncilVersion === 0n || value.governingTimingProfileVersion === 0n ||
    value.candidateTimingProfileVersion <= value.governingTimingProfileVersion || value.candidateTimingProfileVersion === U64_MAX
  ) throw new Error("invalid timing-policy proposal version binding");
  validateProposalIdentityV2(value);
  if (!timingPolicyChangeProposalDigestV1(value).equals(value.proposalDigest)) throw new Error("timing-policy proposal digest mismatch");
}

export function validateCouncilRotationProposalV2(value: CouncilRotationProposalV2): void {
  requireHeader(value, COUNCIL_ROTATION_PROPOSAL_V2_DISCRIMINATOR, GOVERNANCE_V2_ACCOUNT_VERSION, COUNCIL_ROTATION_PROPOSAL_V2_RESERVED_LEN, "CouncilRotationProposalV2");
  requireNondefaultKeys({
    controllerConfig: value.controllerConfig, targetProgram: value.targetProgram, lifecycleRegistry: value.lifecycleRegistry,
    governingTimingProfile: value.governingTimingProfile, currentCouncil: value.currentCouncil,
    candidateCouncil: value.candidateCouncil,
  });
  requireNonzeroHashes({
    governingTimingProfileHash: value.governingTimingProfileHash,
    currentCouncilHash: value.currentCouncilHash,
    candidateCouncilHash: value.candidateCouncilHash,
  });
  if (
    value.governingTimingProfileVersion === 0n || value.currentCouncilVersion === 0n ||
    value.candidateCouncilVersion <= value.currentCouncilVersion || value.candidateCouncilVersion === U64_MAX
  ) throw new Error("invalid council-rotation version binding");
  requireU64(value.rotationNonce, "rotationNonce");
  validateProposalIdentityV2(value);
  if (!councilRotationProposalDigestV2(value).equals(value.proposalDigest)) throw new Error("council-rotation proposal digest mismatch");
}

function validateCeremonyProposalV2(
  value: TargetAuthorityHandoffProposalV2 | BootstrapActivationProposalV2,
  kind: "handoff" | "activation",
): void {
  requireNondefaultKeys({
    lifecycleRegistry: value.lifecycleRegistry, governingTimingProfile: value.governingTimingProfile,
    controllerProgram: value.controllerProgram, controllerProgramdata: value.controllerProgramdata,
    controllerConfig: value.controllerConfig, governancePolicy: value.governancePolicy,
    capacityPolicy: value.capacityPolicy, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt,
    gate: value.gate, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata,
    upgradeableLoader: value.upgradeableLoader, controllerAuthority: value.controllerAuthority,
    bridgeObservation: value.bridgeObservation,
  });
  if (kind === "handoff") requireKey((value as TargetAuthorityHandoffProposalV2).legacyTargetAuthority, "legacyTargetAuthority");
  else requireKey((value as BootstrapActivationProposalV2).targetHandoffReceipt, "targetHandoffReceipt");
  const hashes: Record<string, Uint8Array> = {
    clusterDomain: value.clusterDomain, governingTimingProfileHash: value.governingTimingProfileHash,
    governancePolicyHash: value.governancePolicyHash, capacityPolicyDigest: value.capacityPolicyDigest,
    controllerImmutabilityDigest: value.controllerImmutabilityDigest,
    bridgeArtifactSha256: value.bridgeArtifactSha256, bridgeArtifactMerkleRoot: value.bridgeArtifactMerkleRoot,
    bridgeArtifactSchemeId: value.bridgeArtifactSchemeId, bridgeSourceCommitment: value.bridgeSourceCommitment,
    bridgeBuildInputsCommitment: value.bridgeBuildInputsCommitment, bridgePackageCommitment: value.bridgePackageCommitment,
    bridgeReleaseManifestCommitment: value.bridgeReleaseManifestCommitment,
    bridgeObservationRoot: value.bridgeObservationRoot, bridgeObservationDigest: value.bridgeObservationDigest,
    councilHash: value.councilHash,
  };
  if (kind === "activation") hashes.targetHandoffDigest = (value as BootstrapActivationProposalV2).targetHandoffDigest;
  requireNonzeroHashes(hashes);
  if (
    value.governingTimingProfileVersion === 0n || value.bridgeArtifactLength === 0n ||
    value.bridgeObservationGeneration === 0n || value.minimumTargetDeployedSlot === 0n ||
    value.minimumTargetCapacity < value.bridgeArtifactLength ||
    value.minimumTargetRawLength < value.minimumTargetCapacity ||
    value.bootstrapGateStatus !== GateStatusV1.EmergencyFrozen || value.bootstrapGateEpoch === 0n ||
    value.bootstrapFreezeReasonCode === 0 || value.bootstrapFreezeSlot === 0n ||
    value.targetNonce === 0n || value.councilVersion === 0n
  ) throw new Error(`invalid ${kind} proposal commitments`);
  validateProposalIdentityV2(value);
}

export function validateTargetAuthorityHandoffProposalV2(value: TargetAuthorityHandoffProposalV2): void {
  requireHeader(value, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_DISCRIMINATOR, GOVERNANCE_V2_ACCOUNT_VERSION, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_RESERVED_LEN, "TargetAuthorityHandoffProposalV2");
  validateCeremonyProposalV2(value, "handoff");
  if (!targetAuthorityHandoffProposalDigestV2(value).equals(value.proposalDigest)) throw new Error("handoff proposal digest mismatch");
}

export function validateBootstrapActivationProposalV2(value: BootstrapActivationProposalV2): void {
  requireHeader(value, BOOTSTRAP_ACTIVATION_PROPOSAL_V2_DISCRIMINATOR, GOVERNANCE_V2_ACCOUNT_VERSION, BOOTSTRAP_ACTIVATION_PROPOSAL_V2_RESERVED_LEN, "BootstrapActivationProposalV2");
  validateCeremonyProposalV2(value, "activation");
  if (!bootstrapActivationProposalDigestV2(value).equals(value.proposalDigest)) throw new Error("activation proposal digest mismatch");
}

export function serializeGovernanceLifecycleRegistryV2(value: GovernanceLifecycleRegistryV2): Buffer {
  validateGovernanceLifecycleRegistryV2(value);
  return encodeSchema(value, REGISTRY_SCHEMA, GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN);
}

export function deserializeGovernanceLifecycleRegistryV2(value: Uint8Array): GovernanceLifecycleRegistryV2 {
  const decoded = decodeSchema<GovernanceLifecycleRegistryV2>(value, REGISTRY_SCHEMA, GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, "GovernanceLifecycleRegistryV2");
  validateGovernanceLifecycleRegistryV2(decoded);
  return decoded;
}

export function serializeGovernanceTimingProfileV1(value: GovernanceTimingProfileV1): Buffer {
  validateGovernanceTimingProfileV1(value);
  return encodeSchema(value, TIMING_PROFILE_SCHEMA, GOVERNANCE_TIMING_PROFILE_V1_LEN);
}

export function deserializeGovernanceTimingProfileV1(value: Uint8Array): GovernanceTimingProfileV1 {
  const decoded = decodeSchema<GovernanceTimingProfileV1>(value, TIMING_PROFILE_SCHEMA, GOVERNANCE_TIMING_PROFILE_V1_LEN, "GovernanceTimingProfileV1");
  validateGovernanceTimingProfileV1(decoded);
  return decoded;
}

export function serializeTimingPolicyChangeProposalV1(value: TimingPolicyChangeProposalV1): Buffer {
  validateTimingPolicyChangeProposalV1(value);
  return encodeSchema(value, TIMING_POLICY_CHANGE_SCHEMA, TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN);
}

export function deserializeTimingPolicyChangeProposalV1(value: Uint8Array): TimingPolicyChangeProposalV1 {
  const decoded = decodeSchema<TimingPolicyChangeProposalV1>(value, TIMING_POLICY_CHANGE_SCHEMA, TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN, "TimingPolicyChangeProposalV1");
  validateTimingPolicyChangeProposalV1(decoded);
  return decoded;
}

export function serializeCouncilRotationProposalV2(value: CouncilRotationProposalV2): Buffer {
  validateCouncilRotationProposalV2(value);
  return encodeSchema(value, COUNCIL_ROTATION_SCHEMA, COUNCIL_ROTATION_PROPOSAL_V2_LEN);
}

export function deserializeCouncilRotationProposalV2(value: Uint8Array): CouncilRotationProposalV2 {
  const decoded = decodeSchema<CouncilRotationProposalV2>(value, COUNCIL_ROTATION_SCHEMA, COUNCIL_ROTATION_PROPOSAL_V2_LEN, "CouncilRotationProposalV2");
  validateCouncilRotationProposalV2(decoded);
  return decoded;
}

export function serializeTargetAuthorityHandoffProposalV2(value: TargetAuthorityHandoffProposalV2): Buffer {
  validateTargetAuthorityHandoffProposalV2(value);
  return encodeSchema(value, TARGET_HANDOFF_SCHEMA, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN);
}

export function deserializeTargetAuthorityHandoffProposalV2(value: Uint8Array): TargetAuthorityHandoffProposalV2 {
  const decoded = decodeSchema<TargetAuthorityHandoffProposalV2>(value, TARGET_HANDOFF_SCHEMA, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, "TargetAuthorityHandoffProposalV2");
  validateTargetAuthorityHandoffProposalV2(decoded);
  return decoded;
}

export function serializeBootstrapActivationProposalV2(value: BootstrapActivationProposalV2): Buffer {
  validateBootstrapActivationProposalV2(value);
  return encodeSchema(value, BOOTSTRAP_ACTIVATION_SCHEMA, BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN);
}

export function deserializeBootstrapActivationProposalV2(value: Uint8Array): BootstrapActivationProposalV2 {
  const decoded = decodeSchema<BootstrapActivationProposalV2>(value, BOOTSTRAP_ACTIVATION_SCHEMA, BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, "BootstrapActivationProposalV2");
  validateBootstrapActivationProposalV2(decoded);
  return decoded;
}

export const GOVERNANCE_ACTION_GUARD_V2_LEN = 88;
export const INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN = 57;
export const CREATE_GOVERNANCE_TIMING_PROFILE_V1_LEN = 137;
export const CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN = 129;
export const GOVERNANCE_V2_GUARD_INSTRUCTION_LEN = 89;
export const GOVERNANCE_V2_CANCEL_INSTRUCTION_LEN = 91;
export const CREATE_COUNCIL_ROTATION_PROPOSAL_V2_LEN = 137;
export const CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN = 201;
export const EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN = 215;
export const CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN = 169;
export const EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN = 279;

export interface GovernanceActionGuardV2 {
  proposalId: bigint;
  expectedProposalDigest: Buffer;
  expectedCouncilVersion: bigint;
  expectedTimingProfileVersion: bigint;
  expectedTimingProfileHash: Buffer;
}

export interface InitializeGovernanceLifecycleRegistryV2 {
  expectedInitialTimingProfileVersion: bigint;
  expectedInitialTimingProfileHash: Buffer;
  expectedInitialNextProposalId: bigint;
  expectedInitialRotationNonce: bigint;
}

export interface CreateGovernanceTimingProfileV1 {
  profileVersion: bigint;
  predecessorProfileHash: Buffer;
  emergencyRollback: GovernanceTimingDurationsV1;
  routine: GovernanceTimingDurationsV1;
  major: GovernanceTimingDurationsV1;
  constitutional: GovernanceTimingDurationsV1;
}

export interface CreateTimingPolicyChangeProposalV1 {
  expectedProposalId: bigint;
  expectedCurrentTimingProfileVersion: bigint;
  expectedCurrentTimingProfileHash: Buffer;
  candidateTimingProfileVersion: bigint;
  candidateTimingProfileHash: Buffer;
  expectedCouncilVersion: bigint;
  expectedCouncilHash: Buffer;
}

export interface GovernanceGuardInstructionV2 { guard: GovernanceActionGuardV2 }
export interface GovernanceCancelInstructionV2 extends GovernanceGuardInstructionV2 { cancellationReasonCode: number }

export type ApproveTimingPolicyChangeProposalV1 = GovernanceGuardInstructionV2;
export type CancelTimingPolicyChangeProposalV1 = GovernanceCancelInstructionV2;
export type ExpireTimingPolicyChangeProposalV1 = GovernanceGuardInstructionV2;
export type QueueTimingPolicyChangeProposalV1 = GovernanceGuardInstructionV2;
export type ExecuteTimingPolicyChangeProposalV1 = GovernanceGuardInstructionV2;

export interface CreateCouncilRotationProposalV2 {
  expectedProposalId: bigint;
  expectedCurrentCouncilVersion: bigint;
  expectedCurrentCouncilHash: Buffer;
  candidateCouncilVersion: bigint;
  candidateCouncilHash: Buffer;
  expectedRotationNonce: bigint;
  expectedTimingProfileVersion: bigint;
  expectedTimingProfileHash: Buffer;
}

export type ApproveCouncilRotationProposalV2 = GovernanceGuardInstructionV2;
export type CancelCouncilRotationProposalV2 = GovernanceCancelInstructionV2;
export type ExpireCouncilRotationProposalV2 = GovernanceGuardInstructionV2;
export type QueueCouncilRotationProposalV2 = GovernanceGuardInstructionV2;
export type ExecuteCouncilRotationProposalV2 = GovernanceGuardInstructionV2;

export interface CreateTargetAuthorityHandoffProposalV2 {
  expectedProposalId: bigint;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedCouncilVersion: bigint;
  expectedTimingProfileVersion: bigint;
  expectedTimingProfileHash: Buffer;
  bridgeSourceCommitment: Buffer;
  bridgeBuildInputsCommitment: Buffer;
  bridgePackageCommitment: Buffer;
  bridgeReleaseManifestCommitment: Buffer;
}

export type ApproveTargetAuthorityHandoffProposalV2 = GovernanceGuardInstructionV2;
export type CancelTargetAuthorityHandoffProposalV2 = GovernanceCancelInstructionV2;
export type ExpireTargetAuthorityHandoffProposalV2 = GovernanceGuardInstructionV2;
export type QueueTargetAuthorityHandoffProposalV2 = GovernanceGuardInstructionV2;
export interface ExecuteTargetAuthorityHandoffProposalV2 extends GovernanceGuardInstructionV2 {
  expectedBridgeObservationDigest: Buffer;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  envelope: CeremonyEnvelopeV1;
}

export interface CreateBootstrapActivationProposalV2 {
  expectedProposalId: bigint;
  expectedControllerImmutabilityDigest: Buffer;
  expectedHandoffReceiptDigest: Buffer;
  expectedBridgeObservationDigest: Buffer;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedCouncilVersion: bigint;
  expectedTimingProfileVersion: bigint;
  expectedTimingProfileHash: Buffer;
}

export type ApproveBootstrapActivationProposalV2 = GovernanceGuardInstructionV2;
export type CancelBootstrapActivationProposalV2 = GovernanceCancelInstructionV2;
export type ExpireBootstrapActivationProposalV2 = GovernanceGuardInstructionV2;
export type QueueBootstrapActivationProposalV2 = GovernanceGuardInstructionV2;
export interface ExecuteBootstrapActivationProposalV2 extends GovernanceGuardInstructionV2 {
  expectedBridgeObservationDigest: Buffer;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedDeploymentPlanDigest: Buffer;
  expectedReceiptPlanDigest: Buffer;
  envelope: CeremonyEnvelopeV1;
}

function writeTiming(writer: FixedWriter, value: GovernanceTimingDurationsV1, field: string): void {
  validateGovernanceTimingDurationsV1(value);
  writer.u64(value.reviewSlots, `${field}.reviewSlots`)
    .u64(value.delaySlots, `${field}.delaySlots`)
    .u64(value.expirySlots, `${field}.expirySlots`);
}

function readTiming(reader: FixedReader): GovernanceTimingDurationsV1 {
  return { reviewSlots: reader.u64(), delaySlots: reader.u64(), expirySlots: reader.u64() };
}

function writeGuard(writer: FixedWriter, guard: GovernanceActionGuardV2): void {
  validateGovernanceActionGuardV2(guard);
  writer.u64(guard.proposalId, "guard.proposalId")
    .bytes(guard.expectedProposalDigest, 32, "guard.expectedProposalDigest")
    .u64(guard.expectedCouncilVersion, "guard.expectedCouncilVersion")
    .u64(guard.expectedTimingProfileVersion, "guard.expectedTimingProfileVersion")
    .bytes(guard.expectedTimingProfileHash, 32, "guard.expectedTimingProfileHash");
}

function readGuard(reader: FixedReader): GovernanceActionGuardV2 {
  return {
    proposalId: reader.u64(),
    expectedProposalDigest: reader.bytes(32),
    expectedCouncilVersion: reader.u64(),
    expectedTimingProfileVersion: reader.u64(),
    expectedTimingProfileHash: reader.bytes(32),
  };
}

export function validateGovernanceActionGuardV2(value: GovernanceActionGuardV2): void {
  if (value.proposalId === 0n || value.expectedCouncilVersion === 0n || value.expectedTimingProfileVersion === 0n) {
    throw new Error("governance action guard identities must be nonzero");
  }
  requireU64(value.proposalId, "proposalId");
  requireU64(value.expectedCouncilVersion, "expectedCouncilVersion");
  requireU64(value.expectedTimingProfileVersion, "expectedTimingProfileVersion");
  requireHash(value.expectedProposalDigest, "expectedProposalDigest");
  requireHash(value.expectedTimingProfileHash, "expectedTimingProfileHash");
}

function validateInitializeRegistryInstruction(value: InitializeGovernanceLifecycleRegistryV2): void {
  if (value.expectedInitialTimingProfileVersion !== 1n || value.expectedInitialNextProposalId !== 1n || value.expectedInitialRotationNonce !== 1n) {
    throw new Error("initial registry counters must start at one");
  }
  requireHash(value.expectedInitialTimingProfileHash, "expectedInitialTimingProfileHash");
  requireU64(value.expectedInitialRotationNonce, "expectedInitialRotationNonce");
}

export function encodeInitializeGovernanceLifecycleRegistryV2(value: InitializeGovernanceLifecycleRegistryV2): Buffer {
  validateInitializeRegistryInstruction(value);
  return encodeFixed(INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_TAG, INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, (writer) => {
    writer.u64(value.expectedInitialTimingProfileVersion, "expectedInitialTimingProfileVersion")
      .bytes(value.expectedInitialTimingProfileHash, 32, "expectedInitialTimingProfileHash")
      .u64(value.expectedInitialNextProposalId, "expectedInitialNextProposalId")
      .u64(value.expectedInitialRotationNonce, "expectedInitialRotationNonce");
  });
}

export function decodeInitializeGovernanceLifecycleRegistryV2(data: Buffer): InitializeGovernanceLifecycleRegistryV2 {
  return decodeFixed(data, INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_TAG, INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, (reader) => ({
    expectedInitialTimingProfileVersion: reader.u64(),
    expectedInitialTimingProfileHash: reader.bytes(32),
    expectedInitialNextProposalId: reader.u64(),
    expectedInitialRotationNonce: reader.u64(),
  }), validateInitializeRegistryInstruction);
}

function validateCreateTimingProfileInstruction(value: CreateGovernanceTimingProfileV1): void {
  if (value.profileVersion === 0n) throw new Error("profileVersion must be nonzero");
  requireU64(value.profileVersion, "profileVersion");
  requireBytes(value.predecessorProfileHash, 32, "predecessorProfileHash");
  for (const timingValue of [value.emergencyRollback, value.routine, value.major, value.constitutional]) {
    validateGovernanceTimingDurationsV1(timingValue);
  }
}

export function encodeCreateGovernanceTimingProfileV1(value: CreateGovernanceTimingProfileV1): Buffer {
  validateCreateTimingProfileInstruction(value);
  return encodeFixed(CREATE_GOVERNANCE_TIMING_PROFILE_V1_TAG, CREATE_GOVERNANCE_TIMING_PROFILE_V1_LEN, (writer) => {
    writer.u64(value.profileVersion, "profileVersion").bytes(value.predecessorProfileHash, 32, "predecessorProfileHash");
    writeTiming(writer, value.emergencyRollback, "emergencyRollback");
    writeTiming(writer, value.routine, "routine");
    writeTiming(writer, value.major, "major");
    writeTiming(writer, value.constitutional, "constitutional");
  });
}

export function decodeCreateGovernanceTimingProfileV1(data: Buffer): CreateGovernanceTimingProfileV1 {
  return decodeFixed(data, CREATE_GOVERNANCE_TIMING_PROFILE_V1_TAG, CREATE_GOVERNANCE_TIMING_PROFILE_V1_LEN, (reader) => ({
    profileVersion: reader.u64(),
    predecessorProfileHash: reader.bytes(32),
    emergencyRollback: readTiming(reader), routine: readTiming(reader), major: readTiming(reader), constitutional: readTiming(reader),
  }), validateCreateTimingProfileInstruction);
}

function validateCreateTimingPolicyChangeInstruction(value: CreateTimingPolicyChangeProposalV1): void {
  if (
    value.expectedProposalId === 0n || value.expectedCurrentTimingProfileVersion === 0n ||
    value.candidateTimingProfileVersion <= value.expectedCurrentTimingProfileVersion ||
    value.candidateTimingProfileVersion === U64_MAX || value.expectedCouncilVersion === 0n
  ) throw new Error("invalid timing-policy creation counters");
  requireHash(value.expectedCurrentTimingProfileHash, "expectedCurrentTimingProfileHash");
  requireHash(value.candidateTimingProfileHash, "candidateTimingProfileHash");
  requireHash(value.expectedCouncilHash, "expectedCouncilHash");
}

export function encodeCreateTimingPolicyChangeProposalV1(value: CreateTimingPolicyChangeProposalV1): Buffer {
  validateCreateTimingPolicyChangeInstruction(value);
  return encodeFixed(CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN, (writer) => {
    writer.u64(value.expectedProposalId, "expectedProposalId")
      .u64(value.expectedCurrentTimingProfileVersion, "expectedCurrentTimingProfileVersion")
      .bytes(value.expectedCurrentTimingProfileHash, 32, "expectedCurrentTimingProfileHash")
      .u64(value.candidateTimingProfileVersion, "candidateTimingProfileVersion")
      .bytes(value.candidateTimingProfileHash, 32, "candidateTimingProfileHash")
      .u64(value.expectedCouncilVersion, "expectedCouncilVersion")
      .bytes(value.expectedCouncilHash, 32, "expectedCouncilHash");
  });
}

export function decodeCreateTimingPolicyChangeProposalV1(data: Buffer): CreateTimingPolicyChangeProposalV1 {
  return decodeFixed(data, CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN, (reader) => ({
    expectedProposalId: reader.u64(), expectedCurrentTimingProfileVersion: reader.u64(),
    expectedCurrentTimingProfileHash: reader.bytes(32), candidateTimingProfileVersion: reader.u64(),
    candidateTimingProfileHash: reader.bytes(32), expectedCouncilVersion: reader.u64(), expectedCouncilHash: reader.bytes(32),
  }), validateCreateTimingPolicyChangeInstruction);
}

function encodeGuardInstruction(tag: number, value: GovernanceGuardInstructionV2): Buffer {
  return encodeFixed(tag, GOVERNANCE_V2_GUARD_INSTRUCTION_LEN, (writer) => writeGuard(writer, value.guard));
}

function decodeGuardInstruction(data: Buffer, tag: number): GovernanceGuardInstructionV2 {
  return decodeFixed(data, tag, GOVERNANCE_V2_GUARD_INSTRUCTION_LEN, (reader) => ({ guard: readGuard(reader) }), (value) => validateGovernanceActionGuardV2(value.guard));
}

function encodeCancelInstruction(tag: number, value: GovernanceCancelInstructionV2): Buffer {
  if (value.cancellationReasonCode === 0) throw new Error("cancellationReasonCode must be nonzero");
  requireU16(value.cancellationReasonCode, "cancellationReasonCode");
  return encodeFixed(tag, GOVERNANCE_V2_CANCEL_INSTRUCTION_LEN, (writer) => {
    writeGuard(writer, value.guard);
    writer.u16(value.cancellationReasonCode, "cancellationReasonCode");
  });
}

function decodeCancelInstruction(data: Buffer, tag: number): GovernanceCancelInstructionV2 {
  return decodeFixed(data, tag, GOVERNANCE_V2_CANCEL_INSTRUCTION_LEN, (reader) => ({
    guard: readGuard(reader), cancellationReasonCode: reader.u16(),
  }), (value) => {
    validateGovernanceActionGuardV2(value.guard);
    if (value.cancellationReasonCode === 0) throw new Error("cancellationReasonCode must be nonzero");
  });
}

export const encodeApproveTimingPolicyChangeProposalV1 = (value: ApproveTimingPolicyChangeProposalV1): Buffer => encodeGuardInstruction(APPROVE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, value);
export const decodeApproveTimingPolicyChangeProposalV1 = (data: Buffer): ApproveTimingPolicyChangeProposalV1 => decodeGuardInstruction(data, APPROVE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG);
export const encodeCancelTimingPolicyChangeProposalV1 = (value: CancelTimingPolicyChangeProposalV1): Buffer => encodeCancelInstruction(CANCEL_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, value);
export const decodeCancelTimingPolicyChangeProposalV1 = (data: Buffer): CancelTimingPolicyChangeProposalV1 => decodeCancelInstruction(data, CANCEL_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG);
export const encodeExpireTimingPolicyChangeProposalV1 = (value: ExpireTimingPolicyChangeProposalV1): Buffer => encodeGuardInstruction(EXPIRE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, value);
export const decodeExpireTimingPolicyChangeProposalV1 = (data: Buffer): ExpireTimingPolicyChangeProposalV1 => decodeGuardInstruction(data, EXPIRE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG);
export const encodeQueueTimingPolicyChangeProposalV1 = (value: QueueTimingPolicyChangeProposalV1): Buffer => encodeGuardInstruction(QUEUE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, value);
export const decodeQueueTimingPolicyChangeProposalV1 = (data: Buffer): QueueTimingPolicyChangeProposalV1 => decodeGuardInstruction(data, QUEUE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG);
export const encodeExecuteTimingPolicyChangeProposalV1 = (value: ExecuteTimingPolicyChangeProposalV1): Buffer => encodeGuardInstruction(EXECUTE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG, value);
export const decodeExecuteTimingPolicyChangeProposalV1 = (data: Buffer): ExecuteTimingPolicyChangeProposalV1 => decodeGuardInstruction(data, EXECUTE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG);

function validateCreateCouncilRotationInstruction(value: CreateCouncilRotationProposalV2): void {
  if (
    value.expectedProposalId === 0n || value.expectedCurrentCouncilVersion === 0n ||
    value.candidateCouncilVersion <= value.expectedCurrentCouncilVersion || value.candidateCouncilVersion === U64_MAX ||
    value.expectedTimingProfileVersion === 0n
  ) throw new Error("invalid council-rotation creation counters");
  requireHash(value.expectedCurrentCouncilHash, "expectedCurrentCouncilHash");
  requireHash(value.candidateCouncilHash, "candidateCouncilHash");
  requireHash(value.expectedTimingProfileHash, "expectedTimingProfileHash");
  if (value.expectedRotationNonce === 0n) throw new Error("expectedRotationNonce must be nonzero");
  requireU64(value.expectedRotationNonce, "expectedRotationNonce");
}

export function encodeCreateCouncilRotationProposalV2(value: CreateCouncilRotationProposalV2): Buffer {
  validateCreateCouncilRotationInstruction(value);
  return encodeFixed(CREATE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, CREATE_COUNCIL_ROTATION_PROPOSAL_V2_LEN, (writer) => {
    writer.u64(value.expectedProposalId, "expectedProposalId")
      .u64(value.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion")
      .bytes(value.expectedCurrentCouncilHash, 32, "expectedCurrentCouncilHash")
      .u64(value.candidateCouncilVersion, "candidateCouncilVersion")
      .bytes(value.candidateCouncilHash, 32, "candidateCouncilHash")
      .u64(value.expectedRotationNonce, "expectedRotationNonce")
      .u64(value.expectedTimingProfileVersion, "expectedTimingProfileVersion")
      .bytes(value.expectedTimingProfileHash, 32, "expectedTimingProfileHash");
  });
}

export function decodeCreateCouncilRotationProposalV2(data: Buffer): CreateCouncilRotationProposalV2 {
  return decodeFixed(data, CREATE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, CREATE_COUNCIL_ROTATION_PROPOSAL_V2_LEN, (reader) => ({
    expectedProposalId: reader.u64(), expectedCurrentCouncilVersion: reader.u64(), expectedCurrentCouncilHash: reader.bytes(32),
    candidateCouncilVersion: reader.u64(), candidateCouncilHash: reader.bytes(32), expectedRotationNonce: reader.u64(),
    expectedTimingProfileVersion: reader.u64(), expectedTimingProfileHash: reader.bytes(32),
  }), validateCreateCouncilRotationInstruction);
}

export const encodeApproveCouncilRotationProposalV2 = (value: ApproveCouncilRotationProposalV2): Buffer => encodeGuardInstruction(APPROVE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, value);
export const decodeApproveCouncilRotationProposalV2 = (data: Buffer): ApproveCouncilRotationProposalV2 => decodeGuardInstruction(data, APPROVE_COUNCIL_ROTATION_PROPOSAL_V2_TAG);
export const encodeCancelCouncilRotationProposalV2 = (value: CancelCouncilRotationProposalV2): Buffer => encodeCancelInstruction(CANCEL_COUNCIL_ROTATION_PROPOSAL_V2_TAG, value);
export const decodeCancelCouncilRotationProposalV2 = (data: Buffer): CancelCouncilRotationProposalV2 => decodeCancelInstruction(data, CANCEL_COUNCIL_ROTATION_PROPOSAL_V2_TAG);
export const encodeExpireCouncilRotationProposalV2 = (value: ExpireCouncilRotationProposalV2): Buffer => encodeGuardInstruction(EXPIRE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, value);
export const decodeExpireCouncilRotationProposalV2 = (data: Buffer): ExpireCouncilRotationProposalV2 => decodeGuardInstruction(data, EXPIRE_COUNCIL_ROTATION_PROPOSAL_V2_TAG);
export const encodeQueueCouncilRotationProposalV2 = (value: QueueCouncilRotationProposalV2): Buffer => encodeGuardInstruction(QUEUE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, value);
export const decodeQueueCouncilRotationProposalV2 = (data: Buffer): QueueCouncilRotationProposalV2 => decodeGuardInstruction(data, QUEUE_COUNCIL_ROTATION_PROPOSAL_V2_TAG);
export const encodeExecuteCouncilRotationProposalV2 = (value: ExecuteCouncilRotationProposalV2): Buffer => encodeGuardInstruction(EXECUTE_COUNCIL_ROTATION_PROPOSAL_V2_TAG, value);
export const decodeExecuteCouncilRotationProposalV2 = (data: Buffer): ExecuteCouncilRotationProposalV2 => decodeGuardInstruction(data, EXECUTE_COUNCIL_ROTATION_PROPOSAL_V2_TAG);

function validateCreateHandoffInstruction(value: CreateTargetAuthorityHandoffProposalV2): void {
  if (
    value.expectedProposalId === 0n || value.expectedGateEpoch === 0n || value.expectedTargetNonce === 0n ||
    value.expectedCouncilVersion === 0n || value.expectedTimingProfileVersion === 0n
  ) throw new Error("invalid handoff creation counters");
  requireHash(value.expectedTimingProfileHash, "expectedTimingProfileHash");
  for (const [field, commitment] of Object.entries({
    bridgeSourceCommitment: value.bridgeSourceCommitment,
    bridgeBuildInputsCommitment: value.bridgeBuildInputsCommitment,
    bridgePackageCommitment: value.bridgePackageCommitment,
    bridgeReleaseManifestCommitment: value.bridgeReleaseManifestCommitment,
  })) requireBytes(commitment, 32, field);
}

export function encodeCreateTargetAuthorityHandoffProposalV2(value: CreateTargetAuthorityHandoffProposalV2): Buffer {
  validateCreateHandoffInstruction(value);
  return encodeFixed(CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, (writer) => {
    writer.u64(value.expectedProposalId, "expectedProposalId")
      .u64(value.expectedGateEpoch, "expectedGateEpoch")
      .u64(value.expectedTargetNonce, "expectedTargetNonce")
      .u64(value.expectedCouncilVersion, "expectedCouncilVersion")
      .u64(value.expectedTimingProfileVersion, "expectedTimingProfileVersion")
      .bytes(value.expectedTimingProfileHash, 32, "expectedTimingProfileHash")
      .bytes(value.bridgeSourceCommitment, 32, "bridgeSourceCommitment")
      .bytes(value.bridgeBuildInputsCommitment, 32, "bridgeBuildInputsCommitment")
      .bytes(value.bridgePackageCommitment, 32, "bridgePackageCommitment")
      .bytes(value.bridgeReleaseManifestCommitment, 32, "bridgeReleaseManifestCommitment");
  });
}

export function decodeCreateTargetAuthorityHandoffProposalV2(data: Buffer): CreateTargetAuthorityHandoffProposalV2 {
  return decodeFixed(data, CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, (reader) => ({
    expectedProposalId: reader.u64(), expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(),
    expectedCouncilVersion: reader.u64(), expectedTimingProfileVersion: reader.u64(), expectedTimingProfileHash: reader.bytes(32),
    bridgeSourceCommitment: reader.bytes(32), bridgeBuildInputsCommitment: reader.bytes(32),
    bridgePackageCommitment: reader.bytes(32), bridgeReleaseManifestCommitment: reader.bytes(32),
  }), validateCreateHandoffInstruction);
}

export const encodeApproveTargetAuthorityHandoffProposalV2 = (value: ApproveTargetAuthorityHandoffProposalV2): Buffer => encodeGuardInstruction(APPROVE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, value);
export const decodeApproveTargetAuthorityHandoffProposalV2 = (data: Buffer): ApproveTargetAuthorityHandoffProposalV2 => decodeGuardInstruction(data, APPROVE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG);
export const encodeCancelTargetAuthorityHandoffProposalV2 = (value: CancelTargetAuthorityHandoffProposalV2): Buffer => encodeCancelInstruction(CANCEL_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, value);
export const decodeCancelTargetAuthorityHandoffProposalV2 = (data: Buffer): CancelTargetAuthorityHandoffProposalV2 => decodeCancelInstruction(data, CANCEL_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG);
export const encodeExpireTargetAuthorityHandoffProposalV2 = (value: ExpireTargetAuthorityHandoffProposalV2): Buffer => encodeGuardInstruction(EXPIRE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, value);
export const decodeExpireTargetAuthorityHandoffProposalV2 = (data: Buffer): ExpireTargetAuthorityHandoffProposalV2 => decodeGuardInstruction(data, EXPIRE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG);
export const encodeQueueTargetAuthorityHandoffProposalV2 = (value: QueueTargetAuthorityHandoffProposalV2): Buffer => encodeGuardInstruction(QUEUE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, value);
export const decodeQueueTargetAuthorityHandoffProposalV2 = (data: Buffer): QueueTargetAuthorityHandoffProposalV2 => decodeGuardInstruction(data, QUEUE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG);

function validateExecuteHandoffInstruction(value: ExecuteTargetAuthorityHandoffProposalV2): void {
  validateGovernanceActionGuardV2(value.guard);
  requireBytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest");
  requireU64(value.expectedGateEpoch, "expectedGateEpoch");
  requireU64(value.expectedTargetNonce, "expectedTargetNonce");
}

export function encodeExecuteTargetAuthorityHandoffProposalV2(value: ExecuteTargetAuthorityHandoffProposalV2): Buffer {
  validateExecuteHandoffInstruction(value);
  return encodeFixed(EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, (writer) => {
    writeGuard(writer, value.guard);
    writer.bytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch")
      .u64(value.expectedTargetNonce, "expectedTargetNonce");
    writeCeremonyEnvelope(writer, value.envelope);
  });
}

export function decodeExecuteTargetAuthorityHandoffProposalV2(data: Buffer): ExecuteTargetAuthorityHandoffProposalV2 {
  return decodeFixed(data, EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG, EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, (reader) => ({
    guard: readGuard(reader), expectedBridgeObservationDigest: reader.bytes(32),
    expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), envelope: readCeremonyEnvelope(reader),
  }), validateExecuteHandoffInstruction);
}

function validateCreateActivationInstruction(value: CreateBootstrapActivationProposalV2): void {
  if (
    value.expectedProposalId === 0n || value.expectedGateEpoch === 0n || value.expectedTargetNonce === 0n ||
    value.expectedCouncilVersion === 0n || value.expectedTimingProfileVersion === 0n
  ) throw new Error("invalid activation creation counters");
  requireHash(value.expectedTimingProfileHash, "expectedTimingProfileHash");
  requireBytes(value.expectedControllerImmutabilityDigest, 32, "expectedControllerImmutabilityDigest");
  requireBytes(value.expectedHandoffReceiptDigest, 32, "expectedHandoffReceiptDigest");
  requireBytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest");
}

export function encodeCreateBootstrapActivationProposalV2(value: CreateBootstrapActivationProposalV2): Buffer {
  validateCreateActivationInstruction(value);
  return encodeFixed(CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, (writer) => {
    writer.u64(value.expectedProposalId, "expectedProposalId")
      .bytes(value.expectedControllerImmutabilityDigest, 32, "expectedControllerImmutabilityDigest")
      .bytes(value.expectedHandoffReceiptDigest, 32, "expectedHandoffReceiptDigest")
      .bytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch")
      .u64(value.expectedTargetNonce, "expectedTargetNonce")
      .u64(value.expectedCouncilVersion, "expectedCouncilVersion")
      .u64(value.expectedTimingProfileVersion, "expectedTimingProfileVersion")
      .bytes(value.expectedTimingProfileHash, 32, "expectedTimingProfileHash");
  });
}

export function decodeCreateBootstrapActivationProposalV2(data: Buffer): CreateBootstrapActivationProposalV2 {
  return decodeFixed(data, CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, (reader) => ({
    expectedProposalId: reader.u64(), expectedControllerImmutabilityDigest: reader.bytes(32),
    expectedHandoffReceiptDigest: reader.bytes(32), expectedBridgeObservationDigest: reader.bytes(32),
    expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedCouncilVersion: reader.u64(),
    expectedTimingProfileVersion: reader.u64(), expectedTimingProfileHash: reader.bytes(32),
  }), validateCreateActivationInstruction);
}

export const encodeApproveBootstrapActivationProposalV2 = (value: ApproveBootstrapActivationProposalV2): Buffer => encodeGuardInstruction(APPROVE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, value);
export const decodeApproveBootstrapActivationProposalV2 = (data: Buffer): ApproveBootstrapActivationProposalV2 => decodeGuardInstruction(data, APPROVE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG);
export const encodeCancelBootstrapActivationProposalV2 = (value: CancelBootstrapActivationProposalV2): Buffer => encodeCancelInstruction(CANCEL_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, value);
export const decodeCancelBootstrapActivationProposalV2 = (data: Buffer): CancelBootstrapActivationProposalV2 => decodeCancelInstruction(data, CANCEL_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG);
export const encodeExpireBootstrapActivationProposalV2 = (value: ExpireBootstrapActivationProposalV2): Buffer => encodeGuardInstruction(EXPIRE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, value);
export const decodeExpireBootstrapActivationProposalV2 = (data: Buffer): ExpireBootstrapActivationProposalV2 => decodeGuardInstruction(data, EXPIRE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG);
export const encodeQueueBootstrapActivationProposalV2 = (value: QueueBootstrapActivationProposalV2): Buffer => encodeGuardInstruction(QUEUE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, value);
export const decodeQueueBootstrapActivationProposalV2 = (data: Buffer): QueueBootstrapActivationProposalV2 => decodeGuardInstruction(data, QUEUE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG);

function validateExecuteActivationInstruction(value: ExecuteBootstrapActivationProposalV2): void {
  validateGovernanceActionGuardV2(value.guard);
  requireBytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest");
  requireU64(value.expectedGateEpoch, "expectedGateEpoch");
  requireU64(value.expectedTargetNonce, "expectedTargetNonce");
  requireBytes(value.expectedDeploymentPlanDigest, 32, "expectedDeploymentPlanDigest");
  requireBytes(value.expectedReceiptPlanDigest, 32, "expectedReceiptPlanDigest");
}

export function encodeExecuteBootstrapActivationProposalV2(value: ExecuteBootstrapActivationProposalV2): Buffer {
  validateExecuteActivationInstruction(value);
  return encodeFixed(EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, (writer) => {
    writeGuard(writer, value.guard);
    writer.bytes(value.expectedBridgeObservationDigest, 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch")
      .u64(value.expectedTargetNonce, "expectedTargetNonce")
      .bytes(value.expectedDeploymentPlanDigest, 32, "expectedDeploymentPlanDigest")
      .bytes(value.expectedReceiptPlanDigest, 32, "expectedReceiptPlanDigest");
    writeCeremonyEnvelope(writer, value.envelope);
  });
}

export function decodeExecuteBootstrapActivationProposalV2(data: Buffer): ExecuteBootstrapActivationProposalV2 {
  return decodeFixed(data, EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG, EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, (reader) => ({
    guard: readGuard(reader), expectedBridgeObservationDigest: reader.bytes(32), expectedGateEpoch: reader.u64(),
    expectedTargetNonce: reader.u64(), expectedDeploymentPlanDigest: reader.bytes(32),
    expectedReceiptPlanDigest: reader.bytes(32), envelope: readCeremonyEnvelope(reader),
  }), validateExecuteActivationInstruction);
}

export type Release1GovernanceV2Instruction =
  | { kind: "InitializeRegistry"; value: InitializeGovernanceLifecycleRegistryV2 }
  | { kind: "CreateTimingProfile"; value: CreateGovernanceTimingProfileV1 }
  | { kind: "CreateTimingPolicyChange"; value: CreateTimingPolicyChangeProposalV1 }
  | { kind: "ApproveTimingPolicyChange"; value: ApproveTimingPolicyChangeProposalV1 }
  | { kind: "CancelTimingPolicyChange"; value: CancelTimingPolicyChangeProposalV1 }
  | { kind: "ExpireTimingPolicyChange"; value: ExpireTimingPolicyChangeProposalV1 }
  | { kind: "QueueTimingPolicyChange"; value: QueueTimingPolicyChangeProposalV1 }
  | { kind: "ExecuteTimingPolicyChange"; value: ExecuteTimingPolicyChangeProposalV1 }
  | { kind: "CreateCouncilRotation"; value: CreateCouncilRotationProposalV2 }
  | { kind: "ApproveCouncilRotation"; value: ApproveCouncilRotationProposalV2 }
  | { kind: "CancelCouncilRotation"; value: CancelCouncilRotationProposalV2 }
  | { kind: "ExpireCouncilRotation"; value: ExpireCouncilRotationProposalV2 }
  | { kind: "QueueCouncilRotation"; value: QueueCouncilRotationProposalV2 }
  | { kind: "ExecuteCouncilRotation"; value: ExecuteCouncilRotationProposalV2 }
  | { kind: "CreateTargetAuthorityHandoff"; value: CreateTargetAuthorityHandoffProposalV2 }
  | { kind: "ApproveTargetAuthorityHandoff"; value: ApproveTargetAuthorityHandoffProposalV2 }
  | { kind: "CancelTargetAuthorityHandoff"; value: CancelTargetAuthorityHandoffProposalV2 }
  | { kind: "ExpireTargetAuthorityHandoff"; value: ExpireTargetAuthorityHandoffProposalV2 }
  | { kind: "QueueTargetAuthorityHandoff"; value: QueueTargetAuthorityHandoffProposalV2 }
  | { kind: "ExecuteTargetAuthorityHandoff"; value: ExecuteTargetAuthorityHandoffProposalV2 }
  | { kind: "CreateBootstrapActivation"; value: CreateBootstrapActivationProposalV2 }
  | { kind: "ApproveBootstrapActivation"; value: ApproveBootstrapActivationProposalV2 }
  | { kind: "CancelBootstrapActivation"; value: CancelBootstrapActivationProposalV2 }
  | { kind: "ExpireBootstrapActivation"; value: ExpireBootstrapActivationProposalV2 }
  | { kind: "QueueBootstrapActivation"; value: QueueBootstrapActivationProposalV2 }
  | { kind: "ExecuteBootstrapActivation"; value: ExecuteBootstrapActivationProposalV2 };

export function decodeRelease1GovernanceV2Instruction(data: Buffer): Release1GovernanceV2Instruction {
  switch (data[0]) {
    case INITIALIZE_GOVERNANCE_LIFECYCLE_REGISTRY_V2_TAG: return { kind: "InitializeRegistry", value: decodeInitializeGovernanceLifecycleRegistryV2(data) };
    case CREATE_GOVERNANCE_TIMING_PROFILE_V1_TAG: return { kind: "CreateTimingProfile", value: decodeCreateGovernanceTimingProfileV1(data) };
    case CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "CreateTimingPolicyChange", value: decodeCreateTimingPolicyChangeProposalV1(data) };
    case APPROVE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "ApproveTimingPolicyChange", value: decodeApproveTimingPolicyChangeProposalV1(data) };
    case CANCEL_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "CancelTimingPolicyChange", value: decodeCancelTimingPolicyChangeProposalV1(data) };
    case EXPIRE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "ExpireTimingPolicyChange", value: decodeExpireTimingPolicyChangeProposalV1(data) };
    case QUEUE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "QueueTimingPolicyChange", value: decodeQueueTimingPolicyChangeProposalV1(data) };
    case EXECUTE_TIMING_POLICY_CHANGE_PROPOSAL_V1_TAG: return { kind: "ExecuteTimingPolicyChange", value: decodeExecuteTimingPolicyChangeProposalV1(data) };
    case CREATE_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "CreateCouncilRotation", value: decodeCreateCouncilRotationProposalV2(data) };
    case APPROVE_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "ApproveCouncilRotation", value: decodeApproveCouncilRotationProposalV2(data) };
    case CANCEL_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "CancelCouncilRotation", value: decodeCancelCouncilRotationProposalV2(data) };
    case EXPIRE_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "ExpireCouncilRotation", value: decodeExpireCouncilRotationProposalV2(data) };
    case QUEUE_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "QueueCouncilRotation", value: decodeQueueCouncilRotationProposalV2(data) };
    case EXECUTE_COUNCIL_ROTATION_PROPOSAL_V2_TAG: return { kind: "ExecuteCouncilRotation", value: decodeExecuteCouncilRotationProposalV2(data) };
    case CREATE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "CreateTargetAuthorityHandoff", value: decodeCreateTargetAuthorityHandoffProposalV2(data) };
    case APPROVE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "ApproveTargetAuthorityHandoff", value: decodeApproveTargetAuthorityHandoffProposalV2(data) };
    case CANCEL_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "CancelTargetAuthorityHandoff", value: decodeCancelTargetAuthorityHandoffProposalV2(data) };
    case EXPIRE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "ExpireTargetAuthorityHandoff", value: decodeExpireTargetAuthorityHandoffProposalV2(data) };
    case QUEUE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "QueueTargetAuthorityHandoff", value: decodeQueueTargetAuthorityHandoffProposalV2(data) };
    case EXECUTE_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_TAG: return { kind: "ExecuteTargetAuthorityHandoff", value: decodeExecuteTargetAuthorityHandoffProposalV2(data) };
    case CREATE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "CreateBootstrapActivation", value: decodeCreateBootstrapActivationProposalV2(data) };
    case APPROVE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "ApproveBootstrapActivation", value: decodeApproveBootstrapActivationProposalV2(data) };
    case CANCEL_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "CancelBootstrapActivation", value: decodeCancelBootstrapActivationProposalV2(data) };
    case EXPIRE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "ExpireBootstrapActivation", value: decodeExpireBootstrapActivationProposalV2(data) };
    case QUEUE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "QueueBootstrapActivation", value: decodeQueueBootstrapActivationProposalV2(data) };
    case EXECUTE_BOOTSTRAP_ACTIVATION_PROPOSAL_V2_TAG: return { kind: "ExecuteBootstrapActivation", value: decodeExecuteBootstrapActivationProposalV2(data) };
    default: throw new Error("unknown governance-liveness V2 instruction tag");
  }
}
