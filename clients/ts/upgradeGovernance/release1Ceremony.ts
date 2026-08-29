import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import {
  ARTIFACT_MERKLE_SCHEME_ID,
  MAX_ARTIFACT_BYTES_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  artifactChunkCount,
} from "./artifactMerkleV1.js";
import {
  MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
  PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  programDataObservationGeometryV1,
} from "./programDataObservationMerkleV1.js";
import {
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
  GateStatusV1,
  RELEASE1_APPROVAL_THRESHOLD,
  type OptionalPublicKeyV1,
} from "./release1.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  UPGRADE_SEED_DOMAIN_V1,
} from "./v1.js";

/**
 * Ceremony-only fixed accounts are an additive Release 1 surface. Published
 * V1/V2 account bytes and receipt v3 remain unchanged.
 */
export const CEREMONY_ACCOUNT_VERSION_V1 = 1;
export const PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR = Buffer.from("AGVCAP01", "ascii");
export const CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR = Buffer.from("AGVREL01", "ascii");
export const PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR = Buffer.from("AGVOBS01", "ascii");
export const CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR = Buffer.from("AGVDEP01", "ascii");
export const CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR = Buffer.from("AGVIMR01", "ascii");
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR = Buffer.from("AGVTHP01", "ascii");
export const TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR = Buffer.from("AGVTHR01", "ascii");
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR = Buffer.from("AGVBAP01", "ascii");
export const BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR = Buffer.from("AGVBAR01", "ascii");

export const PROGRAMDATA_CAPACITY_POLICY_V1_LEN = 512;
export const CONTROLLER_RELEASE_COMMITMENT_V1_LEN = 640;
export const PROGRAMDATA_OBSERVATION_V1_LEN = 1_280;
export const CURRENT_DEPLOYMENT_STATE_V1_LEN = 1_024;
export const CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN = 1_024;
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN = 1_280;
export const TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN = 1_024;
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN = 1_280;
export const BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN = 1_024;

export const PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN = 122;
export const CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN = 59;
export const PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN = 98;
export const CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN = 187;
export const CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN = 218;
export const TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN = 212;
export const TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN = 112;
export const BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN = 180;
export const BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN = 56;

export const LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 = 45n;
export const LOADER_V3_PROGRAM_ACCOUNT_LEN_V1 = 36;
export const MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 =
  BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1) - LOADER_V3_PROGRAMDATA_METADATA_LEN_V1;
export const CEREMONY_PROPOSAL_COMPLETED_REASON_V1 = 1;
export const CEREMONY_PROPOSAL_EXPIRED_REASON_V1 = 2;

export const ProgramDataObservationPurposeV1 = Object.freeze({
  ControllerImmutability: 0,
  TargetHandoffBridge: 1,
  ProposalPrestate: 2,
  PostUpgrade: 3,
  Rollback: 4,
  EmergencyResolution: 5,
  BootstrapActivation: 6,
} as const);
export type ProgramDataObservationPurposeV1 =
  (typeof ProgramDataObservationPurposeV1)[keyof typeof ProgramDataObservationPurposeV1];

export const ProgramDataObservationStatusV1 = Object.freeze({
  Accumulating: 0,
  ReadyToFinalize: 1,
  Finalized: 2,
  Stale: 3,
} as const);
export type ProgramDataObservationStatusV1 =
  (typeof ProgramDataObservationStatusV1)[keyof typeof ProgramDataObservationStatusV1];

export const CeremonyProposalStateV1 = Object.freeze({
  Draft: 0,
  CouncilApproved: 1,
  Timelocked: 2,
  Completed: 3,
  Expired: 4,
} as const);
export type CeremonyProposalStateV1 =
  (typeof CeremonyProposalStateV1)[keyof typeof CeremonyProposalStateV1];

export interface ProgramDataCapacityPolicyV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  loaderProgramdataMetadataLen: bigint;
  maximumRawProgramdataLength: bigint;
  maximumPayloadCapacity: bigint;
  maximumArtifactLength: bigint;
  observationSchemeId: Buffer;
  observationChunkSize: number;
  observationMaxChunkCount: number;
  observationPaddedLeafCount: number;
  observationTreeDepth: number;
  observationFrontierHashCount: number;
  artifactSchemeId: Buffer;
  artifactChunkSize: number;
  zeroTailRequired: boolean;
  extendProgramCheckedFeature: PublicKey;
  setAuthorityCheckedFeature: PublicKey;
  policyDigest: Buffer;
  creationSlot: bigint;
  reserved: Buffer;
}

export interface ControllerReleaseCommitmentV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactMerkleRoot: Buffer;
  artifactSchemeId: Buffer;
  sourceCommitment: Buffer;
  sourceTreeCommitment: Buffer;
  buildInputsCommitment: Buffer;
  toolchainCommitment: Buffer;
  packageCommitment: Buffer;
  releaseManifestCommitment: Buffer;
  abiCommitment: Buffer;
  preImmutabilityAuthority: OptionalPublicKeyV1;
  expectedProgramdataCapacity: bigint;
  releaseDigest: Buffer;
  creationSlot: bigint;
  finalized: boolean;
  reserved: Buffer;
}

export interface ProgramDataObservationV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  purpose: ProgramDataObservationPurposeV1;
  subject: PublicKey;
  subjectDigest: Buffer;
  generation: bigint;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  programOwner: PublicKey;
  programExecutable: boolean;
  programDataLength: bigint;
  programHeaderPresent: boolean;
  programHeaderSnapshot: Buffer;
  linkedProgramdata: PublicKey;
  programdataOwner: PublicKey;
  programdataExecutable: boolean;
  programdataHeaderPresent: boolean;
  programdataHeaderSnapshot: Buffer;
  deployedSlot: bigint;
  upgradeAuthority: OptionalPublicKeyV1;
  rawDataLength: bigint;
  payloadOffset: number;
  actualCapacity: bigint;
  expectedArtifactLength: bigint;
  expectedArtifactSha256: Buffer;
  expectedArtifactMerkleRoot: Buffer;
  expectedArtifactSchemeId: Buffer;
  artifactChunkSize: number;
  artifactChunkCount: number;
  minimumRequiredCapacity: bigint;
  rawObservationSchemeId: Buffer;
  rawChunkSize: number;
  rawChunkCount: number;
  rawPaddedLeafCount: number;
  rawTreeDepth: number;
  nextRawChunkIndex: number;
  rawFrontier: readonly Buffer[];
  rawFrontierMask: number;
  nextArtifactChunkIndex: number;
  tailBytesVerified: bigint;
  startSlot: bigint;
  lastObservedSlot: bigint;
  finalizedSlot: bigint;
  finalRawMerkleRoot: Buffer;
  observationDigest: Buffer;
  status: ProgramDataObservationStatusV1;
  reserved: Buffer;
}

export interface CurrentDeploymentStateV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  controllerAuthority: PublicKey;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactMerkleRoot: Buffer;
  artifactSchemeId: Buffer;
  actualProgramdataCapacity: bigint;
  programdataObservation: PublicKey;
  observationGeneration: bigint;
  observationRoot: Buffer;
  observationDigest: Buffer;
  deployedSlot: bigint;
  installedAuthority: PublicKey;
  sourceCommitment: Buffer;
  buildInputsCommitment: Buffer;
  packageCommitment: Buffer;
  releaseManifestCommitment: Buffer;
  releaseCommitment: PublicKey;
  releaseCommitmentDigest: Buffer;
  activationReceipt: OptionalPublicKeyV1;
  completedProposal: OptionalPublicKeyV1;
  gateEpochAtActivation: bigint;
  deploymentGeneration: bigint;
  deploymentDigest: Buffer;
  lastUpdatedSlot: bigint;
  reserved: Buffer;
}

export interface ControllerImmutabilityReceiptV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  releaseCommitment: PublicKey;
  releaseCommitmentDigest: Buffer;
  preObservation: PublicKey;
  preObservationGeneration: bigint;
  preObservationRoot: Buffer;
  preObservationDigest: Buffer;
  preUpgradeAuthority: OptionalPublicKeyV1;
  postObservation: PublicKey;
  postObservationGeneration: bigint;
  postObservationRoot: Buffer;
  postObservationDigest: Buffer;
  postUpgradeAuthority: OptionalPublicKeyV1;
  deployedSlot: bigint;
  rawProgramdataLength: bigint;
  programdataCapacity: bigint;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactMerkleRoot: Buffer;
  artifactSchemeId: Buffer;
  sourceCommitment: Buffer;
  buildInputsCommitment: Buffer;
  packageCommitment: Buffer;
  releaseManifestCommitment: Buffer;
  finalizedSlot: bigint;
  receiptDigest: Buffer;
  finalized: boolean;
  reserved: Buffer;
}

export interface TargetAuthorityHandoffProposalV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  state: CeremonyProposalStateV1;
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
  expectedTargetDeployedSlot: bigint;
  expectedTargetCapacity: bigint;
  expectedTargetRawLength: bigint;
  bootstrapGateStatus: GateStatusV1;
  bootstrapGateEpoch: bigint;
  bootstrapFreezeReasonCode: number;
  bootstrapFreezeSlot: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  approvalBitset: number;
  approvalCount: number;
  approvalThreshold: number;
  firstApprovalSlot: bigint;
  councilApprovedSlot: bigint;
  queuedSlot: bigint;
  executedSlot: bigint;
  terminalSlot: bigint;
  terminalReasonCode: number;
  proposalDigest: Buffer;
  creationSlot: bigint;
  reserved: Buffer;
}

export interface TargetAuthorityHandoffReceiptV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  proposal: PublicKey;
  proposalDigest: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  controllerAuthority: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  controllerImmutabilityDigest: Buffer;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  preObservation: PublicKey;
  preObservationGeneration: bigint;
  preObservationRoot: Buffer;
  preObservationDigest: Buffer;
  preUpgradeAuthority: OptionalPublicKeyV1;
  preProgramdataHeaderSnapshot: Buffer;
  postProgramdataHeaderSnapshot: Buffer;
  postUpgradeAuthority: OptionalPublicKeyV1;
  deployedSlot: bigint;
  rawProgramdataLength: bigint;
  programdataCapacity: bigint;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactMerkleRoot: Buffer;
  artifactSchemeId: Buffer;
  bridgeSourceCommitment: Buffer;
  bridgeBuildInputsCommitment: Buffer;
  bridgePackageCommitment: Buffer;
  bridgeReleaseManifestCommitment: Buffer;
  bootstrapGateEpoch: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  acceptedSlot: bigint;
  receiptDigest: Buffer;
  finalized: boolean;
  reserved: Buffer;
}

export interface BootstrapActivationProposalV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  state: CeremonyProposalStateV1;
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
  expectedTargetDeployedSlot: bigint;
  expectedTargetCapacity: bigint;
  expectedTargetRawLength: bigint;
  bootstrapGateStatus: GateStatusV1;
  bootstrapGateEpoch: bigint;
  bootstrapFreezeReasonCode: number;
  bootstrapFreezeSlot: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  approvalBitset: number;
  approvalCount: number;
  approvalThreshold: number;
  firstApprovalSlot: bigint;
  councilApprovedSlot: bigint;
  queuedSlot: bigint;
  executedSlot: bigint;
  terminalSlot: bigint;
  terminalReasonCode: number;
  proposalDigest: Buffer;
  creationSlot: bigint;
  reserved: Buffer;
}

export interface BootstrapActivationReceiptV1 {
  discriminator: Buffer;
  version: number;
  bump: number;
  initialized: boolean;
  proposal: PublicKey;
  proposalDigest: Buffer;
  controllerProgram: PublicKey;
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
  bridgeObservation: PublicKey;
  bridgeObservationGeneration: bigint;
  bridgeObservationRoot: Buffer;
  bridgeObservationDigest: Buffer;
  bridgeArtifactLength: bigint;
  bridgeArtifactSha256: Buffer;
  bridgeArtifactMerkleRoot: Buffer;
  bridgeArtifactSchemeId: Buffer;
  actualTargetCapacity: bigint;
  targetDeployedSlot: bigint;
  previousGateStatus: GateStatusV1;
  previousGateEpoch: bigint;
  previousFreezeReasonCode: number;
  previousFreezeSlot: bigint;
  activatedGateStatus: GateStatusV1;
  activatedGateEpoch: bigint;
  targetNonce: bigint;
  councilVersion: bigint;
  councilHash: Buffer;
  currentDeploymentState: PublicKey;
  currentDeploymentDigest: Buffer;
  deploymentGeneration: bigint;
  finalizedSlot: bigint;
  receiptDigest: Buffer;
  finalized: boolean;
  reserved: Buffer;
}

type FieldKind =
  | { readonly kind: "bytes"; readonly length: number }
  | { readonly kind: "pubkey" }
  | { readonly kind: "optionalPubkey" }
  | { readonly kind: "bool" }
  | { readonly kind: "u8" }
  | { readonly kind: "u16" }
  | { readonly kind: "u32" }
  | { readonly kind: "u64" }
  | { readonly kind: "hashArray"; readonly count: number };

interface FieldSpec {
  readonly name: string;
  readonly type: FieldKind;
}

const bytes = (name: string, length: number): FieldSpec => ({ name, type: { kind: "bytes", length } });
const key = (name: string): FieldSpec => ({ name, type: { kind: "pubkey" } });
const optionalKey = (name: string): FieldSpec => ({ name, type: { kind: "optionalPubkey" } });
const bool = (name: string): FieldSpec => ({ name, type: { kind: "bool" } });
const u8 = (name: string): FieldSpec => ({ name, type: { kind: "u8" } });
const u16 = (name: string): FieldSpec => ({ name, type: { kind: "u16" } });
const u32 = (name: string): FieldSpec => ({ name, type: { kind: "u32" } });
const u64 = (name: string): FieldSpec => ({ name, type: { kind: "u64" } });
const hashArray = (name: string, count: number): FieldSpec => ({ name, type: { kind: "hashArray", count } });

const HEADER_FIELDS = [bytes("discriminator", 8), u8("version"), u8("bump"), bool("initialized")] as const;

const CAPACITY_POLICY_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS,
  key("controllerProgram"), key("controllerConfig"), key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"),
  u64("loaderProgramdataMetadataLen"), u64("maximumRawProgramdataLength"), u64("maximumPayloadCapacity"), u64("maximumArtifactLength"),
  bytes("observationSchemeId", 32), u32("observationChunkSize"), u32("observationMaxChunkCount"), u32("observationPaddedLeafCount"),
  u8("observationTreeDepth"), u8("observationFrontierHashCount"), bytes("artifactSchemeId", 32), u32("artifactChunkSize"),
  bool("zeroTailRequired"), key("extendProgramCheckedFeature"), key("setAuthorityCheckedFeature"), bytes("policyDigest", 32),
  u64("creationSlot"), bytes("reserved", PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN),
];

const CONTROLLER_RELEASE_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS,
  key("controllerProgram"), key("controllerProgramdata"), key("upgradeableLoader"), key("capacityPolicy"), bytes("capacityPolicyDigest", 32),
  u64("artifactLength"), bytes("artifactSha256", 32), bytes("artifactMerkleRoot", 32), bytes("artifactSchemeId", 32),
  bytes("sourceCommitment", 32), bytes("sourceTreeCommitment", 32), bytes("buildInputsCommitment", 32), bytes("toolchainCommitment", 32),
  bytes("packageCommitment", 32), bytes("releaseManifestCommitment", 32), bytes("abiCommitment", 32), optionalKey("preImmutabilityAuthority"),
  u64("expectedProgramdataCapacity"), bytes("releaseDigest", 32), u64("creationSlot"), bool("finalized"),
  bytes("reserved", CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN),
];

const PROGRAMDATA_OBSERVATION_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS,
  key("controllerProgram"), key("controllerConfig"), key("capacityPolicy"), bytes("capacityPolicyDigest", 32), u8("purpose"),
  key("subject"), bytes("subjectDigest", 32), u64("generation"), key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"),
  key("programOwner"), bool("programExecutable"), u64("programDataLength"), bool("programHeaderPresent"), bytes("programHeaderSnapshot", LOADER_V3_PROGRAM_ACCOUNT_LEN_V1),
  key("linkedProgramdata"), key("programdataOwner"), bool("programdataExecutable"), bool("programdataHeaderPresent"),
  bytes("programdataHeaderSnapshot", Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1)), u64("deployedSlot"), optionalKey("upgradeAuthority"),
  u64("rawDataLength"), u32("payloadOffset"), u64("actualCapacity"), u64("expectedArtifactLength"),
  bytes("expectedArtifactSha256", 32), bytes("expectedArtifactMerkleRoot", 32), bytes("expectedArtifactSchemeId", 32),
  u32("artifactChunkSize"), u32("artifactChunkCount"), u64("minimumRequiredCapacity"), bytes("rawObservationSchemeId", 32),
  u32("rawChunkSize"), u32("rawChunkCount"), u32("rawPaddedLeafCount"), u8("rawTreeDepth"), u32("nextRawChunkIndex"),
  hashArray("rawFrontier", PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1), u16("rawFrontierMask"), u32("nextArtifactChunkIndex"),
  u64("tailBytesVerified"), u64("startSlot"), u64("lastObservedSlot"), u64("finalizedSlot"), bytes("finalRawMerkleRoot", 32),
  bytes("observationDigest", 32), u8("status"), bytes("reserved", PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN),
];

const CURRENT_DEPLOYMENT_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS,
  key("controllerProgram"), key("controllerConfig"), key("capacityPolicy"), bytes("capacityPolicyDigest", 32),
  key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"), key("controllerAuthority"),
  u64("artifactLength"), bytes("artifactSha256", 32), bytes("artifactMerkleRoot", 32), bytes("artifactSchemeId", 32),
  u64("actualProgramdataCapacity"), key("programdataObservation"), u64("observationGeneration"), bytes("observationRoot", 32),
  bytes("observationDigest", 32), u64("deployedSlot"), key("installedAuthority"), bytes("sourceCommitment", 32),
  bytes("buildInputsCommitment", 32), bytes("packageCommitment", 32), bytes("releaseManifestCommitment", 32),
  key("releaseCommitment"), bytes("releaseCommitmentDigest", 32), optionalKey("activationReceipt"), optionalKey("completedProposal"),
  u64("gateEpochAtActivation"), u64("deploymentGeneration"), bytes("deploymentDigest", 32), u64("lastUpdatedSlot"),
  bytes("reserved", CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN),
];

const CONTROLLER_IMMUTABILITY_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS,
  key("controllerProgram"), key("controllerProgramdata"), key("upgradeableLoader"), key("capacityPolicy"), bytes("capacityPolicyDigest", 32),
  key("releaseCommitment"), bytes("releaseCommitmentDigest", 32), key("preObservation"), u64("preObservationGeneration"),
  bytes("preObservationRoot", 32), bytes("preObservationDigest", 32), optionalKey("preUpgradeAuthority"),
  key("postObservation"), u64("postObservationGeneration"), bytes("postObservationRoot", 32), bytes("postObservationDigest", 32),
  optionalKey("postUpgradeAuthority"), u64("deployedSlot"), u64("rawProgramdataLength"), u64("programdataCapacity"),
  u64("artifactLength"), bytes("artifactSha256", 32), bytes("artifactMerkleRoot", 32), bytes("artifactSchemeId", 32),
  bytes("sourceCommitment", 32), bytes("buildInputsCommitment", 32), bytes("packageCommitment", 32), bytes("releaseManifestCommitment", 32),
  u64("finalizedSlot"), bytes("receiptDigest", 32), bool("finalized"), bytes("reserved", CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN),
];

const HANDOFF_PROPOSAL_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS, u8("state"), bytes("clusterDomain", 32), key("controllerProgram"), key("controllerProgramdata"),
  key("controllerImmutabilityReceipt"), bytes("controllerImmutabilityDigest", 32), key("controllerConfig"), key("governancePolicy"),
  bytes("governancePolicyHash", 32), key("capacityPolicy"), bytes("capacityPolicyDigest", 32), key("gate"), key("controllerAuthority"),
  key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"), key("legacyTargetAuthority"), u64("bridgeArtifactLength"),
  bytes("bridgeArtifactSha256", 32), bytes("bridgeArtifactMerkleRoot", 32), bytes("bridgeArtifactSchemeId", 32),
  bytes("bridgeSourceCommitment", 32), bytes("bridgeBuildInputsCommitment", 32), bytes("bridgePackageCommitment", 32),
  bytes("bridgeReleaseManifestCommitment", 32), key("bridgeObservation"), u64("bridgeObservationGeneration"),
  bytes("bridgeObservationRoot", 32), bytes("bridgeObservationDigest", 32), u64("expectedTargetDeployedSlot"),
  u64("expectedTargetCapacity"), u64("expectedTargetRawLength"), u8("bootstrapGateStatus"), u64("bootstrapGateEpoch"),
  u16("bootstrapFreezeReasonCode"), u64("bootstrapFreezeSlot"), u64("targetNonce"), u64("councilVersion"), bytes("councilHash", 32),
  u64("reviewStartSlot"), u64("reviewEndSlot"), u64("notBeforeSlot"), u64("expirySlot"), u8("approvalBitset"),
  u8("approvalCount"), u8("approvalThreshold"), u64("firstApprovalSlot"), u64("councilApprovedSlot"), u64("queuedSlot"),
  u64("executedSlot"), u64("terminalSlot"), u16("terminalReasonCode"), bytes("proposalDigest", 32), u64("creationSlot"),
  bytes("reserved", TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN),
];

const HANDOFF_RECEIPT_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS, key("proposal"), bytes("proposalDigest", 32), key("controllerProgram"), key("controllerConfig"), key("controllerAuthority"),
  key("controllerImmutabilityReceipt"), bytes("controllerImmutabilityDigest", 32), key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"),
  key("preObservation"), u64("preObservationGeneration"), bytes("preObservationRoot", 32), bytes("preObservationDigest", 32), optionalKey("preUpgradeAuthority"),
  bytes("preProgramdataHeaderSnapshot", Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1)),
  bytes("postProgramdataHeaderSnapshot", Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1)), optionalKey("postUpgradeAuthority"),
  u64("deployedSlot"), u64("rawProgramdataLength"), u64("programdataCapacity"), u64("artifactLength"), bytes("artifactSha256", 32),
  bytes("artifactMerkleRoot", 32), bytes("artifactSchemeId", 32), bytes("bridgeSourceCommitment", 32), bytes("bridgeBuildInputsCommitment", 32),
  bytes("bridgePackageCommitment", 32), bytes("bridgeReleaseManifestCommitment", 32), u64("bootstrapGateEpoch"), u64("targetNonce"),
  u64("councilVersion"), u64("acceptedSlot"), bytes("receiptDigest", 32), bool("finalized"), bytes("reserved", TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN),
];

const ACTIVATION_PROPOSAL_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS, u8("state"), bytes("clusterDomain", 32), key("controllerProgram"), key("controllerProgramdata"), key("controllerConfig"),
  key("governancePolicy"), bytes("governancePolicyHash", 32), key("capacityPolicy"), bytes("capacityPolicyDigest", 32),
  key("controllerImmutabilityReceipt"), bytes("controllerImmutabilityDigest", 32), key("targetHandoffReceipt"), bytes("targetHandoffDigest", 32),
  key("gate"), key("targetProgram"), key("targetProgramdata"), key("upgradeableLoader"), key("controllerAuthority"), u64("bridgeArtifactLength"),
  bytes("bridgeArtifactSha256", 32), bytes("bridgeArtifactMerkleRoot", 32), bytes("bridgeArtifactSchemeId", 32),
  bytes("bridgeSourceCommitment", 32), bytes("bridgeBuildInputsCommitment", 32), bytes("bridgePackageCommitment", 32),
  bytes("bridgeReleaseManifestCommitment", 32), key("bridgeObservation"), u64("bridgeObservationGeneration"),
  bytes("bridgeObservationRoot", 32), bytes("bridgeObservationDigest", 32), u64("expectedTargetDeployedSlot"), u64("expectedTargetCapacity"),
  u64("expectedTargetRawLength"), u8("bootstrapGateStatus"), u64("bootstrapGateEpoch"), u16("bootstrapFreezeReasonCode"),
  u64("bootstrapFreezeSlot"), u64("targetNonce"), u64("councilVersion"), bytes("councilHash", 32), u64("reviewStartSlot"),
  u64("reviewEndSlot"), u64("notBeforeSlot"), u64("expirySlot"), u8("approvalBitset"), u8("approvalCount"), u8("approvalThreshold"),
  u64("firstApprovalSlot"), u64("councilApprovedSlot"), u64("queuedSlot"), u64("executedSlot"), u64("terminalSlot"),
  u16("terminalReasonCode"), bytes("proposalDigest", 32), u64("creationSlot"), bytes("reserved", BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN),
];

const ACTIVATION_RECEIPT_SCHEMA: readonly FieldSpec[] = [
  ...HEADER_FIELDS, key("proposal"), bytes("proposalDigest", 32), key("controllerProgram"), key("controllerConfig"), key("governancePolicy"),
  bytes("governancePolicyHash", 32), key("capacityPolicy"), bytes("capacityPolicyDigest", 32), key("controllerImmutabilityReceipt"),
  bytes("controllerImmutabilityDigest", 32), key("targetHandoffReceipt"), bytes("targetHandoffDigest", 32), key("gate"), key("targetProgram"),
  key("targetProgramdata"), key("upgradeableLoader"), key("controllerAuthority"), key("bridgeObservation"), u64("bridgeObservationGeneration"),
  bytes("bridgeObservationRoot", 32), bytes("bridgeObservationDigest", 32), u64("bridgeArtifactLength"), bytes("bridgeArtifactSha256", 32),
  bytes("bridgeArtifactMerkleRoot", 32), bytes("bridgeArtifactSchemeId", 32), u64("actualTargetCapacity"), u64("targetDeployedSlot"),
  u8("previousGateStatus"), u64("previousGateEpoch"), u16("previousFreezeReasonCode"), u64("previousFreezeSlot"),
  u8("activatedGateStatus"), u64("activatedGateEpoch"), u64("targetNonce"), u64("councilVersion"), bytes("councilHash", 32),
  key("currentDeploymentState"), bytes("currentDeploymentDigest", 32), u64("deploymentGeneration"), u64("finalizedSlot"),
  bytes("receiptDigest", 32), bool("finalized"), bytes("reserved", BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN),
];

const ZERO_HASH = Buffer.alloc(32);
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function requireBytes(value: unknown, length: number, field: string): Buffer {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${field} must be bytes`);
  const result = Buffer.from(value);
  if (result.length !== length) throw new RangeError(`${field} must be ${length} bytes`);
  return result;
}

function requirePublicKey(value: unknown, field: string): PublicKey {
  if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`);
  return value;
}

function requireNondefaultKey(value: unknown, field: string): PublicKey {
  const result = requirePublicKey(value, field);
  if (result.equals(PublicKey.default)) throw new Error(`${field} must be nondefault`);
  return result;
}

function requireHash(value: unknown, field: string, allowZero = false): Buffer {
  const result = requireBytes(value, 32, field);
  if (!allowZero && result.equals(ZERO_HASH)) throw new Error(`${field} must be nonzero`);
  return result;
}

function requireU8(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${field} must be a u8`);
  return value;
}

function requireU16(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${field} must be a u16`);
  return value;
}

function requireU32(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${field} must be a u32`);
  return value;
}

function requireU64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) throw new RangeError(`${field} must be a u64`);
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be boolean`);
  return value;
}

function requireEnum(value: unknown, values: readonly number[], field: string): number {
  const checked = requireU8(value, field);
  if (!values.includes(checked)) throw new RangeError(`unknown ${field} discriminant ${checked}`);
  return checked;
}

function requireOptionalKey(value: unknown, field: string): OptionalPublicKeyV1 {
  if (value === null || typeof value !== "object") throw new TypeError(`${field} must be an OptionalPublicKeyV1`);
  const optional = value as OptionalPublicKeyV1;
  requireBoolean(optional.present, `${field}.present`);
  requirePublicKey(optional.value, `${field}.value`);
  if (optional.present === optional.value.equals(PublicKey.default)) throw new Error(`${field} is not canonically encoded`);
  return optional;
}

function requireHeader(
  value: { discriminator: Buffer; version: number; bump: number; initialized: boolean; reserved: Buffer },
  discriminator: Buffer,
  reservedLength: number,
  name: string,
): void {
  if (!requireBytes(value.discriminator, 8, `${name}.discriminator`).equals(discriminator)) throw new Error(`invalid ${name} discriminator`);
  if (value.version !== CEREMONY_ACCOUNT_VERSION_V1) throw new Error(`unsupported ${name} version`);
  requireU8(value.bump, `${name}.bump`);
  if (!requireBoolean(value.initialized, `${name}.initialized`)) throw new Error(`${name} is uninitialized`);
  if (!requireBytes(value.reserved, reservedLength, `${name}.reserved`).equals(Buffer.alloc(reservedLength))) throw new Error(`${name}.reserved must be zero`);
}

function popcount5(bitset: number): number {
  let count = 0;
  for (let index = 0; index < 5; index += 1) count += (bitset >>> index) & 1;
  return count;
}

function validateApproval(bitset: number, count: number): void {
  if ((requireU8(bitset, "approvalBitset") & ~0x1f) !== 0 || requireU8(count, "approvalCount") !== popcount5(bitset)) throw new Error("approval bitset/count mismatch");
}

function validateArtifactIdentity(length: bigint, sha256: Buffer, root: Buffer, scheme: Buffer): void {
  requireU64(length, "artifactLength");
  if (length === 0n || length > BigInt(MAX_ARTIFACT_BYTES_V1)) throw new RangeError("artifact length exceeds Release 1 bound");
  requireHash(sha256, "artifactSha256");
  requireHash(root, "artifactMerkleRoot");
  if (!requireHash(scheme, "artifactSchemeId").equals(ARTIFACT_MERKLE_SCHEME_ID)) throw new Error("artifact scheme mismatch");
  artifactChunkCount(length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
}

function validateAuthorityChange(
  preObservation: PublicKey,
  preGeneration: bigint,
  preRoot: Buffer,
  preDigest: Buffer,
  postObservation: PublicKey,
  postGeneration: bigint,
  postRoot: Buffer,
  postDigest: Buffer,
): void {
  if (
    preObservation.equals(postObservation) ||
    preGeneration === 0n ||
    postGeneration <= preGeneration ||
    requireHash(preRoot, "preObservationRoot").equals(requireHash(postRoot, "postObservationRoot")) ||
    requireHash(preDigest, "preObservationDigest").equals(requireHash(postDigest, "postObservationDigest"))
  ) throw new Error("authority transition requires distinct ordered pre/post observations and raw roots");
}

function encodeField(kind: FieldKind, value: unknown, field: string): Buffer {
  switch (kind.kind) {
    case "bytes": return requireBytes(value, kind.length, field);
    case "pubkey": return requirePublicKey(value, field).toBuffer();
    case "optionalPubkey": {
      const optional = requireOptionalKey(value, field);
      return Buffer.concat([Buffer.from([Number(optional.present)]), optional.value.toBuffer()]);
    }
    case "bool": return Buffer.from([Number(requireBoolean(value, field))]);
    case "u8": return Buffer.from([requireU8(value, field)]);
    case "u16": { const out = Buffer.alloc(2); out.writeUInt16LE(requireU16(value, field)); return out; }
    case "u32": { const out = Buffer.alloc(4); out.writeUInt32LE(requireU32(value, field)); return out; }
    case "u64": { const out = Buffer.alloc(8); out.writeBigUInt64LE(requireU64(value, field)); return out; }
    case "hashArray": {
      if (!Array.isArray(value) || value.length !== kind.count) throw new RangeError(`${field} must contain ${kind.count} hashes`);
      return Buffer.concat(value.map((entry, index) => requireBytes(entry, 32, `${field}[${index}]`)));
    }
  }
}

function encodeSchema(value: object, schema: readonly FieldSpec[], expectedLength?: number): Buffer {
  const record = value as unknown as Record<string, unknown>;
  const output = Buffer.concat(schema.map((field) => encodeField(field.type, record[field.name], field.name)));
  if (expectedLength !== undefined && output.length !== expectedLength) throw new Error(`fixed account length ${output.length}; expected ${expectedLength}`);
  return output;
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
    const result = Buffer.from(this.#bytes.subarray(this.#offset, end));
    this.#offset = end;
    return result;
  }
  field(kind: FieldKind, name: string): unknown {
    switch (kind.kind) {
      case "bytes": return this.take(kind.length);
      case "pubkey": return new PublicKey(this.take(32));
      case "optionalPubkey": {
        const present = this.take(1)[0]!;
        if (present > 1) throw new Error(`${name}.present is not a canonical boolean`);
        const value = new PublicKey(this.take(32));
        return requireOptionalKey({ present: present === 1, value }, name);
      }
      case "bool": { const value = this.take(1)[0]!; if (value > 1) throw new Error(`${name} is not a canonical boolean`); return value === 1; }
      case "u8": return this.take(1)[0]!;
      case "u16": return this.take(2).readUInt16LE(0);
      case "u32": return this.take(4).readUInt32LE(0);
      case "u64": return this.take(8).readBigUInt64LE(0);
      case "hashArray": return Array.from({ length: kind.count }, () => this.take(32));
    }
  }
  end(name: string): void { if (this.#offset !== this.#bytes.length) throw new Error(`${name} has trailing bytes`); }
}

function decodeSchema<T>(bytesValue: Uint8Array, schema: readonly FieldSpec[], expectedLength: number, name: string): T {
  const reader = new Reader(bytesValue, expectedLength, name);
  const record: Record<string, unknown> = {};
  for (const field of schema) record[field.name] = reader.field(field.type, field.name);
  reader.end(name);
  return record as T;
}

function digestFields(domain: string, value: object, schema: readonly FieldSpec[], excluded: readonly string[]): Buffer {
  // Ceremony accounts use a fixed-image digest: the complete canonical account
  // encoding is hashed after clearing only the stored digest and explicitly
  // mutable lifecycle accumulator fields. This binds the discriminator,
  // version, PDA bump, initialization flag, and canonical zero reservation.
  const exclusion = new Set(excluded);
  const canonical = { ...(value as Record<string, unknown>) };
  for (const field of schema) {
    if (exclusion.has(field.name)) canonical[field.name] = zeroFieldValue(field.type);
  }
  return createHash("sha256").update(domain, "ascii").update(encodeSchema(canonical, schema)).digest();
}

function zeroFieldValue(type: FieldKind): unknown {
  switch (type.kind) {
    case "bytes": return Buffer.alloc(type.length);
    case "pubkey": return PublicKey.default;
    case "optionalPubkey": return null;
    case "bool": return false;
    case "u8":
    case "u16":
    case "u32": return 0;
    case "u64": return 0n;
    case "hashArray": return Array.from({ length: type.count }, () => Buffer.alloc(32));
  }
}

function validateLoaderGraph(loader: PublicKey): void {
  if (!loader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) throw new Error("upgradeable loader identity mismatch");
}

export function validateProgramDataCapacityPolicyV1(value: ProgramDataCapacityPolicyV1): void {
  requireHeader(value, PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR, PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN, "ProgramDataCapacityPolicyV1");
  requireU8(value.bump, "bump");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, extendProgramCheckedFeature: value.extendProgramCheckedFeature, setAuthorityCheckedFeature: value.setAuthorityCheckedFeature })) requireNondefaultKey(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  if (value.extendProgramCheckedFeature.equals(value.setAuthorityCheckedFeature)) throw new Error("checked Loader features must be distinct");
  if (
    value.loaderProgramdataMetadataLen !== LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 ||
    value.maximumRawProgramdataLength !== BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1) ||
    value.maximumPayloadCapacity !== MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 ||
    value.maximumArtifactLength !== BigInt(MAX_ARTIFACT_BYTES_V1) ||
    !requireHash(value.observationSchemeId, "observationSchemeId").equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1) ||
    !requireHash(value.artifactSchemeId, "artifactSchemeId").equals(ARTIFACT_MERKLE_SCHEME_ID) ||
    value.artifactChunkSize !== RELEASE1_ARTIFACT_CHUNK_SIZE_V1 ||
    value.zeroTailRequired !== true || value.creationSlot === 0n
  ) throw new Error("capacity policy is not canonical");
  const geometry = programDataObservationGeometryV1(Number(value.maximumRawProgramdataLength), value.observationChunkSize);
  if (geometry.chunkCount !== value.observationMaxChunkCount || geometry.paddedChunkCount !== value.observationPaddedLeafCount || geometry.treeDepth !== value.observationTreeDepth || value.observationFrontierHashCount !== PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1) throw new Error("capacity policy observation geometry mismatch");
  requireHash(value.policyDigest, "policyDigest");
}

export function validateControllerReleaseCommitmentV1(value: ControllerReleaseCommitmentV1): void {
  requireHeader(value, CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR, CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN, "ControllerReleaseCommitmentV1");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerProgramdata: value.controllerProgramdata, upgradeableLoader: value.upgradeableLoader, capacityPolicy: value.capacityPolicy })) requireNondefaultKey(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  requireOptionalKey(value.preImmutabilityAuthority, "preImmutabilityAuthority");
  if (!value.preImmutabilityAuthority.present) throw new Error("controller release requires the pre-immutability authority");
  validateArtifactIdentity(value.artifactLength, value.artifactSha256, value.artifactMerkleRoot, value.artifactSchemeId);
  for (const [field, entry] of Object.entries({ capacityPolicyDigest: value.capacityPolicyDigest, sourceCommitment: value.sourceCommitment, sourceTreeCommitment: value.sourceTreeCommitment, buildInputsCommitment: value.buildInputsCommitment, toolchainCommitment: value.toolchainCommitment, packageCommitment: value.packageCommitment, releaseManifestCommitment: value.releaseManifestCommitment, abiCommitment: value.abiCommitment, releaseDigest: value.releaseDigest })) requireHash(entry, field);
  if (value.expectedProgramdataCapacity < value.artifactLength || value.expectedProgramdataCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.creationSlot === 0n || value.finalized !== true) throw new Error("controller release commitment is incomplete");
}

function loaderProgramHeader(programdata: PublicKey): Buffer {
  const out = Buffer.alloc(LOADER_V3_PROGRAM_ACCOUNT_LEN_V1);
  out.writeUInt32LE(2, 0);
  programdata.toBuffer().copy(out, 4);
  return out;
}

function loaderProgramdataHeader(slot: bigint, authority: OptionalPublicKeyV1): Buffer {
  const out = Buffer.alloc(Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1));
  out.writeUInt32LE(3, 0);
  out.writeBigUInt64LE(slot, 4);
  out[12] = Number(authority.present);
  authority.value.toBuffer().copy(out, 13);
  return out;
}

export function validateProgramDataObservationV1(value: ProgramDataObservationV1): void {
  requireHeader(value, PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR, PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN, "ProgramDataObservationV1");
  requireEnum(value.purpose, Object.values(ProgramDataObservationPurposeV1), "ProgramDataObservationPurposeV1");
  requireEnum(value.status, Object.values(ProgramDataObservationStatusV1), "ProgramDataObservationStatusV1");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, capacityPolicy: value.capacityPolicy, subject: value.subject, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, programOwner: value.programOwner, linkedProgramdata: value.linkedProgramdata, programdataOwner: value.programdataOwner })) requireNondefaultKey(entry, field);
  for (const [field, entry] of Object.entries({ capacityPolicyDigest: value.capacityPolicyDigest, subjectDigest: value.subjectDigest, expectedArtifactSha256: value.expectedArtifactSha256, expectedArtifactMerkleRoot: value.expectedArtifactMerkleRoot, expectedArtifactSchemeId: value.expectedArtifactSchemeId, rawObservationSchemeId: value.rawObservationSchemeId })) requireHash(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  const authority = requireOptionalKey(value.upgradeAuthority, "upgradeAuthority");
  if (!value.programOwner.equals(value.upgradeableLoader) || !value.programdataOwner.equals(value.upgradeableLoader) || !value.programExecutable || value.programdataExecutable || !value.programHeaderPresent || !value.programdataHeaderPresent || value.programDataLength !== BigInt(LOADER_V3_PROGRAM_ACCOUNT_LEN_V1) || !value.linkedProgramdata.equals(value.targetProgramdata) || !requireBytes(value.programHeaderSnapshot, LOADER_V3_PROGRAM_ACCOUNT_LEN_V1, "programHeaderSnapshot").equals(loaderProgramHeader(value.targetProgramdata)) || !requireBytes(value.programdataHeaderSnapshot, Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1), "programdataHeaderSnapshot").equals(loaderProgramdataHeader(value.deployedSlot, authority))) throw new Error("ProgramData observation Loader graph or header snapshot mismatch");
  if (value.generation === 0n || value.payloadOffset !== Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1) || value.rawDataLength !== value.actualCapacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 || value.rawDataLength > BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1) || value.actualCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.minimumRequiredCapacity < value.expectedArtifactLength || value.minimumRequiredCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.actualCapacity < value.minimumRequiredCapacity || value.deployedSlot === 0n || value.startSlot === 0n || value.lastObservedSlot < value.startSlot) throw new Error("ProgramData observation numeric binding mismatch");
  validateArtifactIdentity(value.expectedArtifactLength, value.expectedArtifactSha256, value.expectedArtifactMerkleRoot, value.expectedArtifactSchemeId);
  if (value.artifactChunkSize !== RELEASE1_ARTIFACT_CHUNK_SIZE_V1 || value.artifactChunkCount !== artifactChunkCount(value.expectedArtifactLength, value.artifactChunkSize) || !value.rawObservationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1)) throw new Error("ProgramData observation artifact or raw scheme mismatch");
  const geometry = programDataObservationGeometryV1(Number(value.rawDataLength), value.rawChunkSize);
  if (value.rawChunkCount !== geometry.chunkCount || value.rawPaddedLeafCount !== geometry.paddedChunkCount || value.rawTreeDepth !== geometry.treeDepth || value.nextRawChunkIndex > value.rawChunkCount || value.nextArtifactChunkIndex > value.artifactChunkCount || value.rawFrontierMask !== value.nextRawChunkIndex || value.rawFrontierMask > 0x7ff || !Array.isArray(value.rawFrontier) || value.rawFrontier.length !== PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1) throw new Error("ProgramData observation frontier geometry mismatch");
  value.rawFrontier.forEach((entry, level) => {
    const occupied = (value.rawFrontierMask & (1 << level)) !== 0;
    if (requireBytes(entry, 32, `rawFrontier[${level}]`).equals(ZERO_HASH) === occupied) throw new Error(`rawFrontier[${level}] occupancy mismatch`);
  });
  const expectedTail = value.actualCapacity - value.expectedArtifactLength;
  if (value.tailBytesVerified > expectedTail) throw new Error("ProgramData observation tail count exceeds capacity");
  const complete = value.nextRawChunkIndex === value.rawChunkCount && value.nextArtifactChunkIndex === value.artifactChunkCount && value.tailBytesVerified === expectedTail;
  const rootZero = requireHash(value.finalRawMerkleRoot, "finalRawMerkleRoot", true).equals(ZERO_HASH);
  const digestZero = requireHash(value.observationDigest, "observationDigest", true).equals(ZERO_HASH);
  if (value.status === ProgramDataObservationStatusV1.Accumulating && (complete || value.finalizedSlot !== 0n || !rootZero || !digestZero)) throw new Error("invalid accumulating observation");
  if (value.status === ProgramDataObservationStatusV1.ReadyToFinalize && (!complete || value.finalizedSlot !== 0n || !rootZero || !digestZero)) throw new Error("invalid ready observation");
  if (value.status === ProgramDataObservationStatusV1.Finalized && (!complete || value.finalizedSlot < value.lastObservedSlot || rootZero || digestZero)) throw new Error("invalid finalized observation");
  if (value.status === ProgramDataObservationStatusV1.Stale && (value.finalizedSlot !== 0n || !rootZero || !digestZero)) throw new Error("invalid stale observation");
}

export function validateCurrentDeploymentStateV1(value: CurrentDeploymentStateV1): void {
  requireHeader(value, CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR, CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN, "CurrentDeploymentStateV1");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, capacityPolicy: value.capacityPolicy, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, controllerAuthority: value.controllerAuthority, programdataObservation: value.programdataObservation, installedAuthority: value.installedAuthority, releaseCommitment: value.releaseCommitment })) requireNondefaultKey(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  validateArtifactIdentity(value.artifactLength, value.artifactSha256, value.artifactMerkleRoot, value.artifactSchemeId);
  for (const [field, entry] of Object.entries({ capacityPolicyDigest: value.capacityPolicyDigest, observationRoot: value.observationRoot, observationDigest: value.observationDigest, sourceCommitment: value.sourceCommitment, buildInputsCommitment: value.buildInputsCommitment, packageCommitment: value.packageCommitment, releaseManifestCommitment: value.releaseManifestCommitment, releaseCommitmentDigest: value.releaseCommitmentDigest, deploymentDigest: value.deploymentDigest })) requireHash(entry, field);
  const activation = requireOptionalKey(value.activationReceipt, "activationReceipt");
  const completed = requireOptionalKey(value.completedProposal, "completedProposal");
  if (!value.installedAuthority.equals(value.controllerAuthority) || value.actualProgramdataCapacity < value.artifactLength || value.actualProgramdataCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.observationGeneration === 0n || value.deployedSlot === 0n || value.gateEpochAtActivation === 0n || value.deploymentGeneration === 0n || value.lastUpdatedSlot === 0n || activation.present === completed.present) throw new Error("current deployment state is not canonical");
}

export function validateControllerImmutabilityReceiptV1(value: ControllerImmutabilityReceiptV1): void {
  requireHeader(value, CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR, CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN, "ControllerImmutabilityReceiptV1");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerProgramdata: value.controllerProgramdata, upgradeableLoader: value.upgradeableLoader, capacityPolicy: value.capacityPolicy, releaseCommitment: value.releaseCommitment, preObservation: value.preObservation, postObservation: value.postObservation })) requireNondefaultKey(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  const before = requireOptionalKey(value.preUpgradeAuthority, "preUpgradeAuthority");
  const after = requireOptionalKey(value.postUpgradeAuthority, "postUpgradeAuthority");
  if (!before.present || after.present) throw new Error("controller immutability authority transition must end at None");
  validateAuthorityChange(value.preObservation, value.preObservationGeneration, value.preObservationRoot, value.preObservationDigest, value.postObservation, value.postObservationGeneration, value.postObservationRoot, value.postObservationDigest);
  validateArtifactIdentity(value.artifactLength, value.artifactSha256, value.artifactMerkleRoot, value.artifactSchemeId);
  for (const [field, entry] of Object.entries({ capacityPolicyDigest: value.capacityPolicyDigest, releaseCommitmentDigest: value.releaseCommitmentDigest, sourceCommitment: value.sourceCommitment, buildInputsCommitment: value.buildInputsCommitment, packageCommitment: value.packageCommitment, releaseManifestCommitment: value.releaseManifestCommitment, receiptDigest: value.receiptDigest })) requireHash(entry, field);
  if (value.rawProgramdataLength !== value.programdataCapacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 || value.programdataCapacity < value.artifactLength || value.programdataCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.deployedSlot === 0n || value.finalizedSlot === 0n || value.finalized !== true) throw new Error("controller immutability receipt is incomplete");
}

function validateCeremonyProposalLifecycle(value: TargetAuthorityHandoffProposalV1 | BootstrapActivationProposalV1): void {
  requireEnum(value.state, Object.values(CeremonyProposalStateV1), "CeremonyProposalStateV1");
  validateApproval(value.approvalBitset, value.approvalCount);
  if (value.creationSlot === 0n || value.creationSlot > value.reviewStartSlot || value.reviewStartSlot >= value.reviewEndSlot || value.reviewEndSlot > value.notBeforeSlot || value.notBeforeSlot >= value.expirySlot || value.approvalThreshold !== RELEASE1_APPROVAL_THRESHOLD || value.approvalCount > value.approvalThreshold || ((value.approvalCount === 0) !== (value.firstApprovalSlot === 0n)) || ((value.approvalCount === value.approvalThreshold) !== (value.councilApprovedSlot !== 0n))) throw new Error("ceremony proposal timing or quorum binding is invalid");
  if (value.firstApprovalSlot !== 0n && (value.firstApprovalSlot < value.reviewStartSlot || value.firstApprovalSlot > value.reviewEndSlot || value.firstApprovalSlot >= value.expirySlot)) throw new Error("first approval is outside the review window");
  if (value.councilApprovedSlot !== 0n && (value.councilApprovedSlot < value.firstApprovalSlot || value.councilApprovedSlot > value.reviewEndSlot || value.councilApprovedSlot >= value.expirySlot)) throw new Error("quorum approval is outside the review window");
  if (value.queuedSlot !== 0n && (value.approvalCount !== value.approvalThreshold || value.queuedSlot < value.councilApprovedSlot || value.queuedSlot >= value.expirySlot)) throw new Error("queue slot is invalid");
  if (value.state === CeremonyProposalStateV1.Draft && (value.approvalCount === value.approvalThreshold || value.councilApprovedSlot !== 0n || value.queuedSlot !== 0n || value.executedSlot !== 0n || value.terminalSlot !== 0n || value.terminalReasonCode !== 0)) throw new Error("invalid Draft ceremony proposal");
  if (value.state === CeremonyProposalStateV1.CouncilApproved && (value.approvalCount !== value.approvalThreshold || value.queuedSlot !== 0n || value.executedSlot !== 0n || value.terminalSlot !== 0n || value.terminalReasonCode !== 0)) throw new Error("invalid CouncilApproved ceremony proposal");
  if (value.state === CeremonyProposalStateV1.Timelocked && (value.approvalCount !== value.approvalThreshold || value.queuedSlot === 0n || value.executedSlot !== 0n || value.terminalSlot !== 0n || value.terminalReasonCode !== 0)) throw new Error("invalid Timelocked ceremony proposal");
  if (value.state === CeremonyProposalStateV1.Completed && (value.approvalCount !== value.approvalThreshold || value.queuedSlot === 0n || value.executedSlot < value.notBeforeSlot || value.executedSlot >= value.expirySlot || value.terminalSlot !== value.executedSlot || value.terminalReasonCode !== CEREMONY_PROPOSAL_COMPLETED_REASON_V1)) throw new Error("invalid Completed ceremony proposal");
  if (value.state === CeremonyProposalStateV1.Expired && (value.executedSlot !== 0n || value.terminalSlot < value.expirySlot || value.terminalReasonCode !== CEREMONY_PROPOSAL_EXPIRED_REASON_V1)) throw new Error("invalid Expired ceremony proposal");
}

function validateHandoffCommon(value: TargetAuthorityHandoffProposalV1): void {
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerProgramdata: value.controllerProgramdata, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt, controllerConfig: value.controllerConfig, governancePolicy: value.governancePolicy, capacityPolicy: value.capacityPolicy, gate: value.gate, controllerAuthority: value.controllerAuthority, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, legacyTargetAuthority: value.legacyTargetAuthority, bridgeObservation: value.bridgeObservation })) requireNondefaultKey(entry, field);
  for (const [field, entry] of Object.entries({ clusterDomain: value.clusterDomain, controllerImmutabilityDigest: value.controllerImmutabilityDigest, governancePolicyHash: value.governancePolicyHash, capacityPolicyDigest: value.capacityPolicyDigest, bridgeSourceCommitment: value.bridgeSourceCommitment, bridgeBuildInputsCommitment: value.bridgeBuildInputsCommitment, bridgePackageCommitment: value.bridgePackageCommitment, bridgeReleaseManifestCommitment: value.bridgeReleaseManifestCommitment, bridgeObservationRoot: value.bridgeObservationRoot, bridgeObservationDigest: value.bridgeObservationDigest, councilHash: value.councilHash, proposalDigest: value.proposalDigest })) requireHash(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  validateArtifactIdentity(value.bridgeArtifactLength, value.bridgeArtifactSha256, value.bridgeArtifactMerkleRoot, value.bridgeArtifactSchemeId);
  if (value.legacyTargetAuthority.equals(value.controllerAuthority) || value.bridgeObservationGeneration === 0n || value.expectedTargetDeployedSlot === 0n || value.expectedTargetCapacity < value.bridgeArtifactLength || value.expectedTargetCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.expectedTargetRawLength !== value.expectedTargetCapacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 || value.bootstrapGateStatus !== GateStatusV1.EmergencyFrozen || value.bootstrapGateEpoch === 0n || value.bootstrapFreezeReasonCode !== BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 || value.bootstrapFreezeSlot === 0n || value.targetNonce === 0n || value.councilVersion === 0n) throw new Error("handoff proposal bootstrap or observation binding is invalid");
}

export function validateTargetAuthorityHandoffProposalV1(value: TargetAuthorityHandoffProposalV1): void {
  requireHeader(value, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN, "TargetAuthorityHandoffProposalV1");
  validateHandoffCommon(value);
  validateCeremonyProposalLifecycle(value);
}

export function validateTargetAuthorityHandoffReceiptV1(value: TargetAuthorityHandoffReceiptV1): void {
  requireHeader(value, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN, "TargetAuthorityHandoffReceiptV1");
  for (const [field, entry] of Object.entries({ proposal: value.proposal, controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, controllerAuthority: value.controllerAuthority, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, preObservation: value.preObservation })) requireNondefaultKey(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  for (const [field, entry] of Object.entries({ proposalDigest: value.proposalDigest, controllerImmutabilityDigest: value.controllerImmutabilityDigest, bridgeSourceCommitment: value.bridgeSourceCommitment, bridgeBuildInputsCommitment: value.bridgeBuildInputsCommitment, bridgePackageCommitment: value.bridgePackageCommitment, bridgeReleaseManifestCommitment: value.bridgeReleaseManifestCommitment, receiptDigest: value.receiptDigest })) requireHash(entry, field);
  const before = requireOptionalKey(value.preUpgradeAuthority, "preUpgradeAuthority");
  const after = requireOptionalKey(value.postUpgradeAuthority, "postUpgradeAuthority");
  if (!before.present || !after.present || before.value.equals(value.controllerAuthority) || !after.value.equals(value.controllerAuthority)) throw new Error("handoff receipt authority graph is invalid");
  if (value.preObservationGeneration === 0n
    || !requireBytes(value.preProgramdataHeaderSnapshot, Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1), "preProgramdataHeaderSnapshot").equals(loaderProgramdataHeader(value.deployedSlot, before))
    || !requireBytes(value.postProgramdataHeaderSnapshot, Number(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1), "postProgramdataHeaderSnapshot").equals(loaderProgramdataHeader(value.deployedSlot, after))) {
    throw new Error("handoff receipt ProgramData header transition is invalid");
  }
  validateArtifactIdentity(value.artifactLength, value.artifactSha256, value.artifactMerkleRoot, value.artifactSchemeId);
  if (value.rawProgramdataLength !== value.programdataCapacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 || value.programdataCapacity < value.artifactLength || value.programdataCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.deployedSlot === 0n || value.bootstrapGateEpoch === 0n || value.targetNonce === 0n || value.councilVersion === 0n || value.acceptedSlot === 0n || value.finalized !== true) throw new Error("handoff receipt is incomplete");
}

function validateActivationCommon(value: BootstrapActivationProposalV1): void {
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerProgramdata: value.controllerProgramdata, controllerConfig: value.controllerConfig, governancePolicy: value.governancePolicy, capacityPolicy: value.capacityPolicy, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt, targetHandoffReceipt: value.targetHandoffReceipt, gate: value.gate, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, controllerAuthority: value.controllerAuthority, bridgeObservation: value.bridgeObservation })) requireNondefaultKey(entry, field);
  for (const [field, entry] of Object.entries({ clusterDomain: value.clusterDomain, governancePolicyHash: value.governancePolicyHash, capacityPolicyDigest: value.capacityPolicyDigest, controllerImmutabilityDigest: value.controllerImmutabilityDigest, targetHandoffDigest: value.targetHandoffDigest, bridgeSourceCommitment: value.bridgeSourceCommitment, bridgeBuildInputsCommitment: value.bridgeBuildInputsCommitment, bridgePackageCommitment: value.bridgePackageCommitment, bridgeReleaseManifestCommitment: value.bridgeReleaseManifestCommitment, bridgeObservationRoot: value.bridgeObservationRoot, bridgeObservationDigest: value.bridgeObservationDigest, councilHash: value.councilHash, proposalDigest: value.proposalDigest })) requireHash(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  validateArtifactIdentity(value.bridgeArtifactLength, value.bridgeArtifactSha256, value.bridgeArtifactMerkleRoot, value.bridgeArtifactSchemeId);
  if (value.bridgeObservationGeneration === 0n || value.expectedTargetDeployedSlot === 0n || value.expectedTargetCapacity < value.bridgeArtifactLength || value.expectedTargetCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.expectedTargetRawLength !== value.expectedTargetCapacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 || value.bootstrapGateStatus !== GateStatusV1.EmergencyFrozen || value.bootstrapGateEpoch === 0n || value.bootstrapFreezeReasonCode !== BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 || value.bootstrapFreezeSlot === 0n || value.targetNonce === 0n || value.councilVersion === 0n) throw new Error("activation proposal bootstrap or observation binding is invalid");
}

export function validateBootstrapActivationProposalV1(value: BootstrapActivationProposalV1): void {
  requireHeader(value, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN, "BootstrapActivationProposalV1");
  validateActivationCommon(value);
  validateCeremonyProposalLifecycle(value);
}

export function validateBootstrapActivationReceiptV1(value: BootstrapActivationReceiptV1): void {
  requireHeader(value, BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR, BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN, "BootstrapActivationReceiptV1");
  for (const [field, entry] of Object.entries({ proposal: value.proposal, controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, governancePolicy: value.governancePolicy, capacityPolicy: value.capacityPolicy, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt, targetHandoffReceipt: value.targetHandoffReceipt, gate: value.gate, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, upgradeableLoader: value.upgradeableLoader, controllerAuthority: value.controllerAuthority, bridgeObservation: value.bridgeObservation, currentDeploymentState: value.currentDeploymentState })) requireNondefaultKey(entry, field);
  for (const [field, entry] of Object.entries({ proposalDigest: value.proposalDigest, governancePolicyHash: value.governancePolicyHash, capacityPolicyDigest: value.capacityPolicyDigest, controllerImmutabilityDigest: value.controllerImmutabilityDigest, targetHandoffDigest: value.targetHandoffDigest, bridgeObservationRoot: value.bridgeObservationRoot, bridgeObservationDigest: value.bridgeObservationDigest, councilHash: value.councilHash, currentDeploymentDigest: value.currentDeploymentDigest, receiptDigest: value.receiptDigest })) requireHash(entry, field);
  validateLoaderGraph(value.upgradeableLoader);
  validateArtifactIdentity(value.bridgeArtifactLength, value.bridgeArtifactSha256, value.bridgeArtifactMerkleRoot, value.bridgeArtifactSchemeId);
  if (value.bridgeObservationGeneration === 0n || value.actualTargetCapacity < value.bridgeArtifactLength || value.actualTargetCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.targetDeployedSlot === 0n || value.previousGateStatus !== GateStatusV1.EmergencyFrozen || value.previousGateEpoch === 0n || value.previousFreezeReasonCode !== BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 || value.previousFreezeSlot === 0n || value.activatedGateStatus !== GateStatusV1.Active || value.activatedGateEpoch !== value.previousGateEpoch + 1n || value.targetNonce === 0n || value.councilVersion === 0n || value.deploymentGeneration === 0n || value.finalizedSlot === 0n || value.finalized !== true) throw new Error("bootstrap activation receipt is incomplete");
}

type CodecDefinition<T> = readonly [readonly FieldSpec[], number, (value: T) => void];

function makeCodec<T>(definition: CodecDefinition<T>): readonly [(value: T) => Buffer, (bytes: Uint8Array) => T] {
  const [schema, length, validate] = definition;
  return [
    (value: T): Buffer => { validate(value); return encodeSchema(value as object, schema, length); },
    (encoded: Uint8Array): T => { const value = decodeSchema<T>(encoded, schema, length, "ceremony account"); validate(value); return value; },
  ];
}

export const [serializeProgramDataCapacityPolicyV1, deserializeProgramDataCapacityPolicyV1] = makeCodec<ProgramDataCapacityPolicyV1>([CAPACITY_POLICY_SCHEMA, PROGRAMDATA_CAPACITY_POLICY_V1_LEN, validateProgramDataCapacityPolicyV1]);
export const [serializeControllerReleaseCommitmentV1, deserializeControllerReleaseCommitmentV1] = makeCodec<ControllerReleaseCommitmentV1>([CONTROLLER_RELEASE_SCHEMA, CONTROLLER_RELEASE_COMMITMENT_V1_LEN, validateControllerReleaseCommitmentV1]);
export const [serializeProgramDataObservationV1, deserializeProgramDataObservationV1] = makeCodec<ProgramDataObservationV1>([PROGRAMDATA_OBSERVATION_SCHEMA, PROGRAMDATA_OBSERVATION_V1_LEN, validateProgramDataObservationV1]);
export const [serializeCurrentDeploymentStateV1, deserializeCurrentDeploymentStateV1] = makeCodec<CurrentDeploymentStateV1>([CURRENT_DEPLOYMENT_SCHEMA, CURRENT_DEPLOYMENT_STATE_V1_LEN, validateCurrentDeploymentStateV1]);
export const [serializeControllerImmutabilityReceiptV1, deserializeControllerImmutabilityReceiptV1] = makeCodec<ControllerImmutabilityReceiptV1>([CONTROLLER_IMMUTABILITY_SCHEMA, CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN, validateControllerImmutabilityReceiptV1]);
export const [serializeTargetAuthorityHandoffProposalV1, deserializeTargetAuthorityHandoffProposalV1] = makeCodec<TargetAuthorityHandoffProposalV1>([HANDOFF_PROPOSAL_SCHEMA, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN, validateTargetAuthorityHandoffProposalV1]);
export const [serializeTargetAuthorityHandoffReceiptV1, deserializeTargetAuthorityHandoffReceiptV1] = makeCodec<TargetAuthorityHandoffReceiptV1>([HANDOFF_RECEIPT_SCHEMA, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN, validateTargetAuthorityHandoffReceiptV1]);
export const [serializeBootstrapActivationProposalV1, deserializeBootstrapActivationProposalV1] = makeCodec<BootstrapActivationProposalV1>([ACTIVATION_PROPOSAL_SCHEMA, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN, validateBootstrapActivationProposalV1]);
export const [serializeBootstrapActivationReceiptV1, deserializeBootstrapActivationReceiptV1] = makeCodec<BootstrapActivationReceiptV1>([ACTIVATION_RECEIPT_SCHEMA, BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN, validateBootstrapActivationReceiptV1]);

export const CAPACITY_POLICY_DIGEST_DOMAIN_V1 = "AMOEBA_PROGRAMDATA_CAPACITY_POLICY_V1";
export const CONTROLLER_RELEASE_DIGEST_DOMAIN_V1 = "AMOEBA_CONTROLLER_RELEASE_COMMITMENT_V1";
export const PROGRAMDATA_OBSERVATION_DIGEST_DOMAIN_V1 = "AMOEBA_PROGRAMDATA_OBSERVATION_V1";
export const CURRENT_DEPLOYMENT_DIGEST_DOMAIN_V1 = "AMOEBA_CURRENT_DEPLOYMENT_STATE_V1";
export const CONTROLLER_IMMUTABILITY_DIGEST_DOMAIN_V1 = "AMOEBA_CONTROLLER_IMMUTABILITY_RECEIPT_V1";
export const TARGET_HANDOFF_PROPOSAL_DIGEST_DOMAIN_V1 = "AMOEBA_TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1";
export const TARGET_HANDOFF_RECEIPT_DIGEST_DOMAIN_V1 = "AMOEBA_TARGET_AUTHORITY_HANDOFF_RECEIPT_V1";
export const BOOTSTRAP_ACTIVATION_PROPOSAL_DIGEST_DOMAIN_V1 = "AMOEBA_BOOTSTRAP_ACTIVATION_PROPOSAL_V1";
export const BOOTSTRAP_ACTIVATION_RECEIPT_DIGEST_DOMAIN_V1 = "AMOEBA_BOOTSTRAP_ACTIVATION_RECEIPT_V1";

export const programDataCapacityPolicyDigestV1 = (value: ProgramDataCapacityPolicyV1): Buffer => digestFields(CAPACITY_POLICY_DIGEST_DOMAIN_V1, value, CAPACITY_POLICY_SCHEMA, ["policyDigest"]);
export const controllerReleaseDigestV1 = (value: ControllerReleaseCommitmentV1): Buffer => digestFields(CONTROLLER_RELEASE_DIGEST_DOMAIN_V1, value, CONTROLLER_RELEASE_SCHEMA, ["releaseDigest"]);
export const programDataObservationDigestV1 = (value: ProgramDataObservationV1): Buffer => digestFields(PROGRAMDATA_OBSERVATION_DIGEST_DOMAIN_V1, value, PROGRAMDATA_OBSERVATION_SCHEMA, ["observationDigest"]);
export const currentDeploymentDigestV1 = (value: CurrentDeploymentStateV1): Buffer => digestFields(CURRENT_DEPLOYMENT_DIGEST_DOMAIN_V1, value, CURRENT_DEPLOYMENT_SCHEMA, ["deploymentDigest"]);
export const controllerImmutabilityReceiptDigestV1 = (value: ControllerImmutabilityReceiptV1): Buffer => digestFields(CONTROLLER_IMMUTABILITY_DIGEST_DOMAIN_V1, value, CONTROLLER_IMMUTABILITY_SCHEMA, ["receiptDigest"]);
export const targetAuthorityHandoffProposalDigestV1 = (value: TargetAuthorityHandoffProposalV1): Buffer => digestFields(TARGET_HANDOFF_PROPOSAL_DIGEST_DOMAIN_V1, value, HANDOFF_PROPOSAL_SCHEMA, ["state", "approvalBitset", "approvalCount", "firstApprovalSlot", "councilApprovedSlot", "queuedSlot", "executedSlot", "terminalSlot", "terminalReasonCode", "proposalDigest"]);
export const targetAuthorityHandoffReceiptDigestV1 = (value: TargetAuthorityHandoffReceiptV1): Buffer => digestFields(TARGET_HANDOFF_RECEIPT_DIGEST_DOMAIN_V1, value, HANDOFF_RECEIPT_SCHEMA, ["receiptDigest"]);
export const bootstrapActivationProposalDigestV1 = (value: BootstrapActivationProposalV1): Buffer => digestFields(BOOTSTRAP_ACTIVATION_PROPOSAL_DIGEST_DOMAIN_V1, value, ACTIVATION_PROPOSAL_SCHEMA, ["state", "approvalBitset", "approvalCount", "firstApprovalSlot", "councilApprovedSlot", "queuedSlot", "executedSlot", "terminalSlot", "terminalReasonCode", "proposalDigest"]);
export const bootstrapActivationReceiptDigestV1 = (value: BootstrapActivationReceiptV1): Buffer => digestFields(BOOTSTRAP_ACTIVATION_RECEIPT_DIGEST_DOMAIN_V1, value, ACTIVATION_RECEIPT_SCHEMA, ["receiptDigest"]);

function validateDigest(actual: Buffer, expected: Buffer, name: string): void {
  if (!requireHash(actual, `${name}.storedDigest`).equals(expected)) throw new Error(`${name} digest mismatch`);
}

export const validateProgramDataCapacityPolicyDigestV1 = (value: ProgramDataCapacityPolicyV1): void => { validateProgramDataCapacityPolicyV1(value); validateDigest(value.policyDigest, programDataCapacityPolicyDigestV1(value), "ProgramDataCapacityPolicyV1"); };
export const validateControllerReleaseDigestV1 = (value: ControllerReleaseCommitmentV1): void => { validateControllerReleaseCommitmentV1(value); validateDigest(value.releaseDigest, controllerReleaseDigestV1(value), "ControllerReleaseCommitmentV1"); };
export const validateProgramDataObservationDigestV1 = (value: ProgramDataObservationV1): void => { validateProgramDataObservationV1(value); if (value.status !== ProgramDataObservationStatusV1.Finalized) throw new Error("only a finalized observation has a consensus digest"); validateDigest(value.observationDigest, programDataObservationDigestV1(value), "ProgramDataObservationV1"); };
export const validateCurrentDeploymentDigestV1 = (value: CurrentDeploymentStateV1): void => { validateCurrentDeploymentStateV1(value); validateDigest(value.deploymentDigest, currentDeploymentDigestV1(value), "CurrentDeploymentStateV1"); };
export const validateControllerImmutabilityReceiptDigestV1 = (value: ControllerImmutabilityReceiptV1): void => { validateControllerImmutabilityReceiptV1(value); validateDigest(value.receiptDigest, controllerImmutabilityReceiptDigestV1(value), "ControllerImmutabilityReceiptV1"); };
export const validateTargetAuthorityHandoffProposalDigestV1 = (value: TargetAuthorityHandoffProposalV1): void => { validateTargetAuthorityHandoffProposalV1(value); validateDigest(value.proposalDigest, targetAuthorityHandoffProposalDigestV1(value), "TargetAuthorityHandoffProposalV1"); };
export const validateTargetAuthorityHandoffReceiptDigestV1 = (value: TargetAuthorityHandoffReceiptV1): void => { validateTargetAuthorityHandoffReceiptV1(value); validateDigest(value.receiptDigest, targetAuthorityHandoffReceiptDigestV1(value), "TargetAuthorityHandoffReceiptV1"); };
export const validateBootstrapActivationProposalDigestV1 = (value: BootstrapActivationProposalV1): void => { validateBootstrapActivationProposalV1(value); validateDigest(value.proposalDigest, bootstrapActivationProposalDigestV1(value), "BootstrapActivationProposalV1"); };
export const validateBootstrapActivationReceiptDigestV1 = (value: BootstrapActivationReceiptV1): void => { validateBootstrapActivationReceiptV1(value); validateDigest(value.receiptDigest, bootstrapActivationReceiptDigestV1(value), "BootstrapActivationReceiptV1"); };

const CAPACITY_POLICY_SEED = Buffer.from("capacity-policy", "ascii");
const CONTROLLER_RELEASE_SEED = Buffer.from("controller-release", "ascii");
const PROGRAMDATA_OBSERVATION_SEED = Buffer.from("programdata-observation", "ascii");
const DEPLOYMENT_STATE_SEED = Buffer.from("deployment-state", "ascii");
const CONTROLLER_IMMUTABILITY_SEED = Buffer.from("controller-immutability", "ascii");
const TARGET_HANDOFF_SEED = Buffer.from("handoff", "ascii");
const TARGET_HANDOFF_RECEIPT_SEED = Buffer.from("handoff-receipt", "ascii");
const BOOTSTRAP_ACTIVATION_SEED = Buffer.from("bootstrap-activation", "ascii");
const BOOTSTRAP_ACTIVATION_RECEIPT_SEED = Buffer.from("activation-receipt", "ascii");

function u64Seed(value: bigint): Buffer { const out = Buffer.alloc(8); out.writeBigUInt64LE(requireU64(value, "PDA generation")); return out; }
function derive(controllerProgram: PublicKey, seeds: readonly Buffer[]): [PublicKey, number] { return PublicKey.findProgramAddressSync([...seeds], controllerProgram); }
export const deriveCapacityPolicyPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, CAPACITY_POLICY_SEED, targetProgram.toBuffer()]);
export const deriveControllerReleaseCommitmentPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, CONTROLLER_RELEASE_SEED, targetProgram.toBuffer()]);
export const deriveProgramDataObservationPdaV1 = (controllerProgram: PublicKey, observedProgram: PublicKey, purpose: ProgramDataObservationPurposeV1, generation: bigint): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, PROGRAMDATA_OBSERVATION_SEED, observedProgram.toBuffer(), Buffer.from([requireEnum(purpose, Object.values(ProgramDataObservationPurposeV1), "purpose")]), u64Seed(generation)]);
export const deriveCurrentDeploymentStatePdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, DEPLOYMENT_STATE_SEED, targetProgram.toBuffer()]);
export const deriveControllerImmutabilityReceiptPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, CONTROLLER_IMMUTABILITY_SEED, targetProgram.toBuffer()]);
export const deriveTargetAuthorityHandoffProposalPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey, councilVersion: bigint): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, TARGET_HANDOFF_SEED, targetProgram.toBuffer(), u64Seed(councilVersion)]);
export const deriveTargetAuthorityHandoffReceiptPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, TARGET_HANDOFF_RECEIPT_SEED, targetProgram.toBuffer()]);
export const deriveBootstrapActivationProposalPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey, councilVersion: bigint): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, BOOTSTRAP_ACTIVATION_SEED, targetProgram.toBuffer(), u64Seed(councilVersion)]);
export const deriveBootstrapActivationReceiptPdaV1 = (controllerProgram: PublicKey, targetProgram: PublicKey): [PublicKey, number] => derive(controllerProgram, [UPGRADE_SEED_DOMAIN_V1, BOOTSTRAP_ACTIVATION_RECEIPT_SEED, targetProgram.toBuffer()]);

export const CeremonyPlanOperationV1 = Object.freeze({
  ObserveProgramdata: 0,
  RecordControllerImmutability: 1,
  CreateHandoff: 2,
  AcceptTargetAuthority: 3,
  CreateBootstrapActivation: 4,
  ExecuteBootstrapActivation: 5,
  VerifyLocalCeremony: 6,
} as const);
export type CeremonyPlanOperationV1 =
  (typeof CeremonyPlanOperationV1)[keyof typeof CeremonyPlanOperationV1];

export interface Release1CeremonyPlanV1 {
  operation: CeremonyPlanOperationV1;
  production: boolean;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  controllerAuthority: PublicKey;
  capacityPolicy: PublicKey;
  capacityPolicyDigest: Buffer;
  controllerRelease: PublicKey;
  controllerReleaseDigest: Buffer;
  controllerImmutabilityReceipt: PublicKey;
  programdataObservation: PublicKey;
  observationPurpose: ProgramDataObservationPurposeV1;
  observationGeneration: bigint;
  observationDigest: Buffer;
  actualCapacity: bigint;
  handoffProposal: PublicKey;
  handoffReceipt: PublicKey;
  legacyAuthority: PublicKey;
  activationProposal: PublicKey;
  activationReceipt: PublicKey;
  gateStatus: GateStatusV1;
  gateEpoch: bigint;
  freezeReasonCode: number;
  targetNonce: bigint;
  bridgeArtifactLength: bigint;
  bridgeArtifactSha256: Buffer;
  bridgeArtifactMerkleRoot: Buffer;
  currentDeploymentState: PublicKey;
  councilVersion: bigint;
  councilHash: Buffer;
  plannedAtSlot: bigint;
  expiresAtSlot: bigint;
}

export const CEREMONY_PLAN_OPERATION_ID_DOMAIN_V1 = Buffer.from("AMOEBA_RELEASE1_CEREMONY_PLAN_V1", "ascii");

export function validateRelease1CeremonyPlanV1(value: Release1CeremonyPlanV1): void {
  requireEnum(value.operation, Object.values(CeremonyPlanOperationV1), "CeremonyPlanOperationV1");
  requireBoolean(value.production, "production");
  for (const [field, entry] of Object.entries({ controllerProgram: value.controllerProgram, controllerConfig: value.controllerConfig, targetProgram: value.targetProgram, targetProgramdata: value.targetProgramdata, controllerAuthority: value.controllerAuthority, capacityPolicy: value.capacityPolicy, controllerRelease: value.controllerRelease, controllerImmutabilityReceipt: value.controllerImmutabilityReceipt, programdataObservation: value.programdataObservation, handoffProposal: value.handoffProposal, handoffReceipt: value.handoffReceipt, legacyAuthority: value.legacyAuthority, activationProposal: value.activationProposal, activationReceipt: value.activationReceipt, currentDeploymentState: value.currentDeploymentState })) requireNondefaultKey(entry, field);
  for (const [field, entry] of Object.entries({ clusterDomain: value.clusterDomain, capacityPolicyDigest: value.capacityPolicyDigest, controllerReleaseDigest: value.controllerReleaseDigest, observationDigest: value.observationDigest, bridgeArtifactSha256: value.bridgeArtifactSha256, bridgeArtifactMerkleRoot: value.bridgeArtifactMerkleRoot, councilHash: value.councilHash })) requireHash(entry, field);
  if (value.production && value.controllerProgram.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1)) throw new Error("synthetic controller identity cannot be planned as production");
  if (value.controllerAuthority.equals(value.legacyAuthority)) throw new Error("legacy and controller authorities must differ");
  if (value.observationGeneration === 0n || value.actualCapacity < value.bridgeArtifactLength || value.actualCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 || value.gateEpoch === 0n || value.targetNonce === 0n || value.councilVersion === 0n || value.plannedAtSlot === 0n || value.expiresAtSlot <= value.plannedAtSlot) throw new Error("ceremony plan numeric binding is invalid");
  validateArtifactIdentity(value.bridgeArtifactLength, value.bridgeArtifactSha256, value.bridgeArtifactMerkleRoot, ARTIFACT_MERKLE_SCHEME_ID);
  requireEnum(value.observationPurpose, Object.values(ProgramDataObservationPurposeV1), "observationPurpose");
  requireEnum(value.gateStatus, Object.values(GateStatusV1), "gateStatus");
  const bootstrapOperation = value.operation >= CeremonyPlanOperationV1.CreateHandoff && value.operation <= CeremonyPlanOperationV1.ExecuteBootstrapActivation;
  if (bootstrapOperation && (value.gateStatus !== GateStatusV1.EmergencyFrozen || value.freezeReasonCode !== BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1)) throw new Error("handoff and activation plans require the exact bootstrap freeze");
  if ((value.operation === CeremonyPlanOperationV1.CreateHandoff || value.operation === CeremonyPlanOperationV1.AcceptTargetAuthority) && value.observationPurpose !== ProgramDataObservationPurposeV1.TargetHandoffBridge) throw new Error("handoff plan requires a TargetHandoffBridge observation");
  if ((value.operation === CeremonyPlanOperationV1.CreateBootstrapActivation || value.operation === CeremonyPlanOperationV1.ExecuteBootstrapActivation) && value.observationPurpose !== ProgramDataObservationPurposeV1.BootstrapActivation) throw new Error("activation plan requires a BootstrapActivation observation");
}

export function release1CeremonyOperationIdV1(value: Release1CeremonyPlanV1): string {
  validateRelease1CeremonyPlanV1(value);
  const material = Buffer.concat([
    Buffer.from([value.operation, Number(value.production)]), value.clusterDomain, value.controllerProgram.toBuffer(), value.controllerConfig.toBuffer(),
    value.targetProgram.toBuffer(), value.targetProgramdata.toBuffer(), value.controllerAuthority.toBuffer(), value.capacityPolicy.toBuffer(),
    value.capacityPolicyDigest, value.controllerRelease.toBuffer(), value.controllerReleaseDigest, value.controllerImmutabilityReceipt.toBuffer(),
    value.programdataObservation.toBuffer(), Buffer.from([value.observationPurpose]), u64Seed(value.observationGeneration), value.observationDigest,
    u64Seed(value.actualCapacity), value.handoffProposal.toBuffer(), value.handoffReceipt.toBuffer(), value.legacyAuthority.toBuffer(),
    value.activationProposal.toBuffer(), value.activationReceipt.toBuffer(), Buffer.from([value.gateStatus]), u64Seed(value.gateEpoch),
    (() => { const out = Buffer.alloc(2); out.writeUInt16LE(requireU16(value.freezeReasonCode, "freezeReasonCode")); return out; })(),
    u64Seed(value.targetNonce), u64Seed(value.bridgeArtifactLength), value.bridgeArtifactSha256, value.bridgeArtifactMerkleRoot,
    value.currentDeploymentState.toBuffer(), u64Seed(value.councilVersion), value.councilHash, u64Seed(value.plannedAtSlot), u64Seed(value.expiresAtSlot),
  ]);
  return createHash("sha256").update(CEREMONY_PLAN_OPERATION_ID_DOMAIN_V1).update(material).digest("hex");
}
