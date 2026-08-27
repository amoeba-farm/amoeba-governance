import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  ARTIFACT_MERKLE_SCHEME_ID,
  MAX_ARTIFACT_BYTES_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  VERIFICATION_BITMAP_BYTES_V1,
  artifactChunkCount,
  artifactChunkCountAllowEmpty,
  isRelease1ChunkSize,
  validateVerificationBitmapV1,
} from "./artifactMerkleV1.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  UPGRADE_SEED_DOMAIN_V1,
} from "./v1.js";

export const UPGRADE_PROPOSAL_V2_DISCRIMINATOR = Buffer.from("AGVPRP02", "ascii");
export const BUFFER_VERIFICATION_V1_DISCRIMINATOR = Buffer.from("AGVBFV01", "ascii");
export const PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR = Buffer.from("AGVPDV01", "ascii");
export const STATE_CHECKPOINT_V1_DISCRIMINATOR = Buffer.from("AGVCKP01", "ascii");
export const COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR = Buffer.from("AGVROT01", "ascii");
export const EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR = Buffer.from("AGVEFR01", "ascii");
export const EMERGENCY_FREEZE_OBSERVATION_V1_DISCRIMINATOR = Buffer.from("AGVEFO01", "ascii");
export const PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR = Buffer.from(
  "AGVPDF01",
  "ascii",
);
export const CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR = Buffer.from("AGVATT01", "ascii");

export const ACCOUNT_VERSION_V2 = 2;
export const RELEASE1_ACCOUNT_VERSION_V1 = 1;
export const RELEASE1_APPROVAL_THRESHOLD = 3;
export const BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 = 1;
export const PROPOSAL_EXPIRED_TERMINAL_REASON_V1 = 1;
export const PROPOSAL_COMPLETED_TERMINAL_REASON_V1 = 2;
export const PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1 = 3;
export const PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1 = 4;
export const COUNCIL_ROTATION_ACTIVATED_TERMINAL_REASON_V1 = 1;
export const COUNCIL_ROTATION_EXPIRED_TERMINAL_REASON_V1 = 2;
export const EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1 = 1;
export const EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V1 = 2;

export const UPGRADE_PROPOSAL_V2_LEN = 1_792;
export const BUFFER_VERIFICATION_V1_LEN = 512;
export const PROGRAMDATA_VERIFICATION_V1_LEN = 640;
export const STATE_CHECKPOINT_V1_LEN = 704;
export const COUNCIL_ROTATION_PROPOSAL_V1_LEN = 384;
export const EMERGENCY_FREEZE_RESOLUTION_V1_LEN = 640;
export const EMERGENCY_FREEZE_OBSERVATION_V1_LEN = 512;
export const PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN = 512;
export const CHECKPOINT_ATTESTATION_V1_LEN = 384;

export const UPGRADE_PROPOSAL_V2_RESERVED_LEN = 146;
export const BUFFER_VERIFICATION_V1_RESERVED_LEN = 72;
export const PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN = 119;
export const STATE_CHECKPOINT_V1_RESERVED_LEN = 37;
export const COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN = 84;
export const EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN = 100;
export const EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN = 19;
export const PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN = 24;
export const CHECKPOINT_ATTESTATION_V1_RESERVED_LEN = 27;
export const NO_FAILING_CHUNK_INDEX_V1 = 0xffff_ffff;
export const LOADER_V3_PROGRAMDATA_METADATA_LEN_V1 = 45n;
export const MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 = 1_572_909n;

export const PROPOSAL_DIGEST_DOMAIN_V2 = Buffer.from(
  "AMOEBA_UPGRADE_PROPOSAL_V2",
  "ascii",
);
export const PROPOSAL_DIGEST_MATERIAL_LEN_V2 = 1_416;
export const PROPOSAL_DIGEST_PREIMAGE_LEN_V2 = 1_442;
export const STATE_CHECKPOINT_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_STATE_CHECKPOINT_V1",
  "ascii",
);
export const STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1 = 573;
export const STATE_CHECKPOINT_DIGEST_PREIMAGE_LEN_V1 = 599;
export const STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1 = Buffer.from(
  "AMOEBA_CHECKPOINT_HARD_ROOT_V1",
  "ascii",
);
export const STATE_CHECKPOINT_HARD_ROOT_MATERIAL_LEN_V1 = 176;
export const STATE_CHECKPOINT_HARD_ROOT_PREIMAGE_LEN_V1 =
  STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1.length +
  STATE_CHECKPOINT_HARD_ROOT_MATERIAL_LEN_V1;
export const COUNCIL_ROTATION_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_COUNCIL_ROTATION_V1",
  "ascii",
);
export const COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1 = 240;
export const COUNCIL_ROTATION_DIGEST_PREIMAGE_LEN_V1 = 266;
export const EMERGENCY_RESOLUTION_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_EMERGENCY_RESOLUTION_V1",
  "ascii",
);
export const EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1 = 442;
export const EMERGENCY_RESOLUTION_DIGEST_PREIMAGE_LEN_V1 = 396;
export const EMERGENCY_FREEZE_OBSERVATION_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_EMERGENCY_FREEZE_OBSERVATION_V1",
  "ascii",
);
export const EMERGENCY_FREEZE_OBSERVATION_DIGEST_MATERIAL_LEN_V1 = 450;
export const EMERGENCY_FREEZE_OBSERVATION_DIGEST_PREIMAGE_LEN_V1 =
  EMERGENCY_FREEZE_OBSERVATION_DIGEST_DOMAIN_V1.length +
  EMERGENCY_FREEZE_OBSERVATION_DIGEST_MATERIAL_LEN_V1;
export const PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_PROGRAMDATA_FAILURE_OBSERVATION_V1",
  "ascii",
);
export const PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_MATERIAL_LEN_V1 = 444;
export const PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_PREIMAGE_LEN_V1 =
  PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_DOMAIN_V1.length +
  PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_MATERIAL_LEN_V1;
export const CHECKPOINT_ATTESTATION_DIGEST_DOMAIN_V1 = Buffer.from(
  "AMOEBA_CHECKPOINT_ATTESTATION_V1",
  "ascii",
);
export const CHECKPOINT_ATTESTATION_DIGEST_MATERIAL_LEN_V1 = 314;
export const CHECKPOINT_ATTESTATION_DIGEST_PREIMAGE_LEN_V1 =
  CHECKPOINT_ATTESTATION_DIGEST_DOMAIN_V1.length +
  CHECKPOINT_ATTESTATION_DIGEST_MATERIAL_LEN_V1;

export const ProposalClassV1 = Object.freeze({
  RoutineUpgrade: 0,
  EmergencyRollback: 1,
  EconomicChange: 2,
  ConstitutionalChange: 3,
  CouncilSetRotation: 4,
  TargetImmutability: 5,
} as const);
export type ProposalClassV1 = (typeof ProposalClassV1)[keyof typeof ProposalClassV1];

export const GateStatusV1 = Object.freeze({
  Active: 0,
  FrozenForUpgrade: 1,
  EmergencyFrozen: 2,
} as const);
export type GateStatusV1 = (typeof GateStatusV1)[keyof typeof GateStatusV1];

export const VoteRequirementV1 = Object.freeze({
  None: 0,
  Veto: 1,
  Affirmative: 2,
} as const);
export type VoteRequirementV1 =
  (typeof VoteRequirementV1)[keyof typeof VoteRequirementV1];

export const ProposalStateV2 = Object.freeze({
  Draft: 0,
  BufferAdopted: 1,
  BufferVerified: 2,
  CouncilApproved: 3,
  TokenReviewOpen: 4,
  GovernanceSatisfied: 5,
  Timelocked: 6,
  Frozen: 7,
  Extended: 8,
  UpgradeExecuted: 9,
  ProgramDataVerified: 10,
  PoststateAccepted: 11,
  UnfreezeApproved: 12,
  Completed: 13,
  Cancelled: 14,
  Expired: 15,
  SupersededByRollback: 16,
  Retired: 17,
} as const);
export type ProposalStateV2 = (typeof ProposalStateV2)[keyof typeof ProposalStateV2];

export const BufferVerificationStatusV1 = Object.freeze({
  Adopted: 0,
  Verifying: 1,
  ReadyToFinalize: 2,
  Verified: 3,
  ConsumedByUpgrade: 4,
  ClosedAbandoned: 5,
} as const);
export type BufferVerificationStatusV1 =
  (typeof BufferVerificationStatusV1)[keyof typeof BufferVerificationStatusV1];

export const ProgramDataVerificationStatusV1 = Object.freeze({
  Verifying: 0,
  ReadyToFinalize: 1,
  Verified: 2,
} as const);
export type ProgramDataVerificationStatusV1 =
  (typeof ProgramDataVerificationStatusV1)[keyof typeof ProgramDataVerificationStatusV1];

export const StateCheckpointPhaseV1 = Object.freeze({
  Prestate: 0,
  Poststate: 1,
  Emergency: 2,
} as const);
export type StateCheckpointPhaseV1 =
  (typeof StateCheckpointPhaseV1)[keyof typeof StateCheckpointPhaseV1];

export const CouncilRotationStateV1 = Object.freeze({
  Draft: 0,
  CouncilApproved: 1,
  Timelocked: 2,
  Activated: 3,
  Cancelled: 4,
  Expired: 5,
} as const);
export type CouncilRotationStateV1 =
  (typeof CouncilRotationStateV1)[keyof typeof CouncilRotationStateV1];

export const EmergencyFreezeResolutionStateV1 = Object.freeze({
  Draft: 0,
  CouncilApproved: 1,
  Timelocked: 2,
  Executed: 3,
  Cancelled: 4,
  Expired: 5,
} as const);
export type EmergencyFreezeResolutionStateV1 =
  (typeof EmergencyFreezeResolutionStateV1)[keyof typeof EmergencyFreezeResolutionStateV1];

export const EmergencyFreezeResolutionKindV1 = Object.freeze({
  ResumeWithoutUpgrade: 0,
} as const);
export type EmergencyFreezeResolutionKindV1 =
  (typeof EmergencyFreezeResolutionKindV1)[keyof typeof EmergencyFreezeResolutionKindV1];

export const ProgramDataMismatchClassV1 = Object.freeze({
  Header: 0,
  Authority: 1,
  Capacity: 2,
  PayloadLeaf: 3,
  ZeroTail: 4,
} as const);
export type ProgramDataMismatchClassV1 =
  (typeof ProgramDataMismatchClassV1)[keyof typeof ProgramDataMismatchClassV1];

export interface OptionalPublicKeyV1 {
  present: boolean;
  value: PublicKey;
}

export interface UpgradeProposalV2 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  proposalClass: ProposalClassV1;
  state: ProposalStateV2;
  creationGateStatus: GateStatusV1;
  zeroTailRequired: boolean;
  proposalFlags: number;
  proposalId: bigint;
  targetNonce: bigint;
  creationSlot: bigint;
  clusterDomain: Buffer;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  policyVersion: bigint;
  policyHash: Buffer;
  creationCouncilVersion: bigint;
  creationCouncilHash: Buffer;
  creationGateEpoch: bigint;
  freezeGateEpoch: bigint;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  authorityPda: PublicKey;
  canonicalSpillTreasury: PublicKey;
  bufferPubkey: PublicKey;
  bufferLoaderOwner: PublicKey;
  bufferUploaderAuthority: PublicKey;
  bufferFinalAuthority: PublicKey;
  bufferVerification: PublicKey;
  programdataVerification: PublicKey;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  chunkHashDomain: Buffer;
  chunkSize: number;
  chunkCount: number;
  sourceCommitHash: Buffer;
  sourceTreeHash: Buffer;
  buildInputInventoryHash: Buffer;
  reproducibleBuildReceiptHash: Buffer;
  packageReceiptHash: Buffer;
  releaseIntentHash: Buffer;
  expectedExecutionPrePayloadHash: Buffer;
  expectedExecutionPreChunkRoot: Buffer;
  currentRawProgramdataHash: Buffer;
  deployedSlot: bigint;
  currentCapacity: bigint;
  extensionDelta: bigint;
  expectedPostCapacity: bigint;
  prestateCheckpoint: PublicKey;
  requiredPoststateCheckpoint: PublicKey;
  checkpointSchemaId: Buffer;
  checkpointPolicyHash: Buffer;
  primaryProposal: OptionalPublicKeyV1;
  rollbackProposal: OptionalPublicKeyV1;
  rollbackBuffer: OptionalPublicKeyV1;
  rollbackArtifactSha256: Buffer;
  rollbackArtifactChunkRoot: Buffer;
  voteRequirement: VoteRequirementV1;
  voteProgram: PublicKey;
  voteResultPda: PublicKey;
  reviewStartSlot: bigint;
  reviewEndSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  firstApprovalSlot: bigint;
  councilApprovedSlot: bigint;
  governanceSatisfiedSlot: bigint;
  queuedSlot: bigint;
  frozenSlot: bigint;
  extensionExecutedSlot: bigint;
  upgradeExecutedSlot: bigint;
  programdataVerifiedSlot: bigint;
  poststateAcceptedSlot: bigint;
  unfreezeApprovedSlot: bigint;
  terminalSlot: bigint;
  councilApprovalBitset: number;
  councilApprovalCount: number;
  cancellationCouncilVersion: bigint;
  cancellationCouncilHash: Buffer;
  cancellationApprovalBitset: number;
  cancellationApprovalCount: number;
  unfreezeCouncilVersion: bigint;
  unfreezeCouncilHash: Buffer;
  unfreezeApprovalBitset: number;
  unfreezeApprovalCount: number;
  proposalDigest: Buffer;
  cancellationReasonCode: number;
  terminalReasonCode: number;
  reserved: Buffer;
}

export interface BufferVerificationV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  status: BufferVerificationStatusV1;
  controllerConfig: PublicKey;
  proposal: PublicKey;
  upgradeableLoader: PublicKey;
  buffer: PublicKey;
  expectedUploaderAuthority: PublicKey;
  controllerAuthority: PublicKey;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  chunkHashDomain: Buffer;
  chunkSize: number;
  chunkCount: number;
  verifiedChunkBitmap: Buffer;
  verifiedChunkCount: number;
  adoptedSlot: bigint;
  finalizedSlot: bigint;
  sealedBufferHeaderHash: Buffer;
  terminalSlot: bigint;
  reserved: Buffer;
}

export interface ProgramDataVerificationV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  status: ProgramDataVerificationStatusV1;
  controllerConfig: PublicKey;
  proposal: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  controllerAuthority: PublicKey;
  artifactLength: bigint;
  artifactSha256: Buffer;
  artifactChunkMerkleRoot: Buffer;
  chunkHashDomain: Buffer;
  chunkSize: number;
  payloadChunkCount: number;
  verifiedPayloadChunkBitmap: Buffer;
  verifiedPayloadChunkCount: number;
  deployedSlot: bigint;
  capacity: bigint;
  tailLength: bigint;
  tailChunkCount: number;
  verifiedTailChunkBitmap: Buffer;
  verifiedTailChunkCount: number;
  rawProgramdataHash: Buffer;
  zeroTailVerified: boolean;
  finalizedSlot: bigint;
  reserved: Buffer;
}

export interface StateCheckpointV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  phase: StateCheckpointPhaseV1;
  controllerConfig: PublicKey;
  proposal: PublicKey;
  emergencyResolution: PublicKey;
  subjectDigest: Buffer;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  finalizedObservationSlot: bigint;
  gateEpoch: bigint;
  targetProgramdataSlot: bigint;
  targetPayloadCommitment: Buffer;
  targetRawProgramdataCommitment: Buffer;
  targetCapacity: bigint;
  programOwnedStateRoot: Buffer;
  programOwnedStateCount: bigint;
  logicalCompressedStateRoot: Buffer;
  logicalCompressedStateCount: bigint;
  semanticCustodyAccountingRoot: Buffer;
  hardCombinedRoot: Buffer;
  externalMetadataObservationRoot: Buffer;
  externalRawBalanceObservationRoot: Buffer;
  schemaIdentifier: Buffer;
  admittedPositiveDonationRoot: Buffer;
  admittedPositiveDonationCount: bigint;
  forbiddenDriftCount: number;
  approvalCouncilVersion: bigint;
  approvalCouncilHash: Buffer;
  checkpointDigest: Buffer;
  approvalBitset: number;
  approvalCount: number;
  accepted: boolean;
  finalizedSlot: bigint;
  reserved: Buffer;
}

export interface CouncilRotationProposalV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  state: CouncilRotationStateV1;
  controllerConfig: PublicKey;
  targetProgram: PublicKey;
  currentCouncil: PublicKey;
  currentCouncilVersion: bigint;
  currentCouncilHash: Buffer;
  candidateCouncil: PublicKey;
  candidateCouncilVersion: bigint;
  candidateCouncilHash: Buffer;
  creationSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  targetNonce: bigint;
  approvalBitset: number;
  approvalCount: number;
  cancellationApprovalBitset: number;
  cancellationApprovalCount: number;
  rotationDigest: Buffer;
  activatedSlot: bigint;
  cancellationReasonCode: number;
  terminalReasonCode: number;
  reserved: Buffer;
}

export interface EmergencyFreezeResolutionV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  state: EmergencyFreezeResolutionStateV1;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  emergencyFreezeObservation: PublicKey;
  frozenEpoch: bigint;
  freezeSlot: bigint;
  freezeReasonCode: number;
  resolutionKind: EmergencyFreezeResolutionKindV1;
  creationSlot: bigint;
  notBeforeSlot: bigint;
  expirySlot: bigint;
  targetNonce: bigint;
  observedProgramOwner: PublicKey;
  observedProgramExecutable: boolean;
  observedProgramDataLength: bigint;
  observedProgramHeaderPresent: boolean;
  observedLinkedProgramdata: OptionalPublicKeyV1;
  observedProgramdataOwner: PublicKey;
  observedProgramdataExecutable: boolean;
  observedProgramdataDataLength: bigint;
  observedProgramdataHeaderPresent: boolean;
  observedProgramdataSlot: bigint;
  observedRawHashComplete: boolean;
  observedRawProgramdataHash: Buffer;
  observedCapacity: bigint;
  observedAuthority: OptionalPublicKeyV1;
  emergencyCheckpoint: PublicKey;
  approvalCouncilVersion: bigint;
  approvalCouncilHash: Buffer;
  approvalBitset: number;
  approvalCount: number;
  resolutionDigest: Buffer;
  executedSlot: bigint;
  cancellationReasonCode: number;
  terminalReasonCode: number;
  reserved: Buffer;
}

export interface EmergencyFreezeObservationV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  finalized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  upgradeableLoader: PublicKey;
  controllerAuthority: PublicKey;
  frozenEpoch: bigint;
  freezeSlot: bigint;
  freezeReasonCode: number;
  actualProgramOwner: PublicKey;
  actualProgramExecutable: boolean;
  actualProgramDataLength: bigint;
  programHeaderPresent: boolean;
  actualLinkedProgramdata: OptionalPublicKeyV1;
  actualProgramdataOwner: PublicKey;
  actualProgramdataExecutable: boolean;
  actualProgramdataDataLength: bigint;
  programdataHeaderPresent: boolean;
  deployedProgramdataSlot: bigint;
  rawHashComplete: boolean;
  rawProgramdataSha256: Buffer;
  capacity: bigint;
  observedAuthority: OptionalPublicKeyV1;
  observationDigest: Buffer;
  finalizedSlot: bigint;
  reserved: Buffer;
}

export interface ProgramDataFailureObservationV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  finalized: boolean;
  controllerConfig: PublicKey;
  protocolGate: PublicKey;
  primaryProposal: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  frozenEpoch: bigint;
  actualProgramOwner: PublicKey;
  actualProgramExecutable: boolean;
  actualProgramDataLength: bigint;
  programHeaderPresent: boolean;
  actualLinkedProgramdata: OptionalPublicKeyV1;
  rawHashComplete: boolean;
  actualRawProgramdataSha256: Buffer;
  actualOwner: PublicKey;
  actualExecutable: boolean;
  actualDataLength: bigint;
  programdataHeaderPresent: boolean;
  actualProgramdataSlot: bigint;
  actualCapacity: bigint;
  actualAuthority: OptionalPublicKeyV1;
  mismatchClass: ProgramDataMismatchClassV1;
  failingChunkIndex: number;
  expectedLeafHash: Buffer;
  actualLeafHash: Buffer;
  finalizedSlot: bigint;
  observationDigest: Buffer;
  reserved: Buffer;
}

export interface CheckpointAttestationV1 {
  discriminator: Buffer;
  accountVersion: number;
  bump: number;
  initialized: boolean;
  controllerProgram: PublicKey;
  controllerConfig: PublicKey;
  checkpoint: PublicKey;
  subject: PublicKey;
  subjectDigest: Buffer;
  phase: StateCheckpointPhaseV1;
  checkpointDigest: Buffer;
  council: PublicKey;
  councilVersion: bigint;
  councilHash: Buffer;
  gateEpoch: bigint;
  seatIndex: number;
  seatAuthority: PublicKey;
  attestedSlot: bigint;
  attestationDigest: Buffer;
  reserved: Buffer;
}

export const UPGRADE_PROPOSAL_V2_OFFSETS = Object.freeze({
  discriminator: 0,
  accountVersion: 8,
  initialized: 10,
  proposalClass: 11,
  state: 12,
  proposalId: 16,
  clusterDomain: 40,
  buffer: 424,
  artifactLength: 616,
  chunkSize: 720,
  firstApprovalSlot: 1436,
  proposalDigest: 1610,
  reserved: 1646,
});
export const BUFFER_VERIFICATION_V1_OFFSETS = Object.freeze({
  status: 11,
  artifactLength: 204,
  bitmap: 316,
  verifiedCount: 380,
  terminalSlot: 432,
  reserved: 440,
});
export const PROGRAMDATA_VERIFICATION_V1_OFFSETS = Object.freeze({
  status: 11,
  payloadBitmap: 316,
  tailLength: 400,
  tailBitmap: 412,
  rawHash: 480,
  zeroTailVerified: 512,
  reserved: 521,
});
export const STATE_CHECKPOINT_V1_OFFSETS = Object.freeze({
  phase: 11,
  controllerConfig: 12,
  subjectDigest: 108,
  hardCombinedRoot: 412,
  forbiddenDriftCount: 580,
  checkpointDigest: 624,
  accepted: 658,
  finalizedSlot: 659,
  reserved: 667,
});
export const COUNCIL_ROTATION_V1_OFFSETS = Object.freeze({
  state: 11,
  controllerConfig: 12,
  targetNonce: 244,
  rotationDigest: 256,
  reserved: 300,
});
export const EMERGENCY_RESOLUTION_V1_OFFSETS = Object.freeze({
  state: 11,
  controllerConfig: 12,
  frozenEpoch: 172,
  resolutionKind: 190,
  observedProgramOwner: 223,
  observedProgramExecutable: 255,
  observedProgramDataLength: 256,
  observedProgramHeaderPresent: 264,
  observedLinkedProgramdata: 265,
  observedProgramdataOwner: 298,
  observedProgramdataExecutable: 330,
  observedProgramdataDataLength: 331,
  observedProgramdataHeaderPresent: 339,
  observedProgramdataSlot: 340,
  observedRawHashComplete: 348,
  observedRawProgramdataHash: 349,
  resolutionDigest: 496,
  reserved: 540,
});
export const EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS = Object.freeze({
  finalized: 11,
  controllerProgram: 12,
  frozenEpoch: 236,
  actualProgramOwner: 254,
  actualProgramExecutable: 286,
  actualProgramDataLength: 287,
  programHeaderPresent: 295,
  actualLinkedProgramdata: 296,
  actualProgramdataOwner: 329,
  actualProgramdataExecutable: 361,
  actualProgramdataDataLength: 362,
  programdataHeaderPresent: 370,
  deployedProgramdataSlot: 371,
  rawHashComplete: 379,
  rawProgramdataSha256: 380,
  observationDigest: 453,
  reserved: 493,
});
export const PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS = Object.freeze({
  finalized: 11,
  controllerConfig: 12,
  frozenEpoch: 172,
  actualProgramOwner: 180,
  actualProgramExecutable: 212,
  actualProgramDataLength: 213,
  programHeaderPresent: 221,
  actualLinkedProgramdata: 222,
  rawHashComplete: 255,
  actualRawProgramdataSha256: 256,
  actualProgramdataOwner: 288,
  actualProgramdataExecutable: 320,
  actualProgramdataDataLength: 321,
  programdataHeaderPresent: 329,
  actualProgramdataSlot: 330,
  mismatchClass: 379,
  failingChunkIndex: 380,
  observationDigest: 456,
  reserved: 488,
});
export const CHECKPOINT_ATTESTATION_V1_OFFSETS = Object.freeze({
  controllerProgram: 11,
  controllerConfig: 43,
  checkpoint: 75,
  subject: 107,
  subjectDigest: 139,
  phase: 171,
  checkpointDigest: 172,
  councilVersion: 236,
  seatIndex: 284,
  attestationDigest: 325,
  reserved: 357,
});

const ZERO_PUBLIC_KEY = new PublicKey(Buffer.alloc(32));
const VALID_APPROVAL_MASK = 0b1_1111;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function requireBytes(value: Uint8Array, length: number, field: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length !== length) {
    throw new RangeError(`${field} must be ${length} bytes`);
  }
  return bytes;
}

function requireZeroBytes(value: Uint8Array, length: number, field: string): Buffer {
  const bytes = requireBytes(value, length, field);
  if (!bytes.equals(Buffer.alloc(length))) {
    throw new Error(`${field} must be zero`);
  }
  return bytes;
}

function isZero32(value: Uint8Array): boolean {
  return requireBytes(value, 32, "bytes32").equals(Buffer.alloc(32));
}

function isDefaultKey(value: PublicKey): boolean {
  return value.equals(ZERO_PUBLIC_KEY);
}

function requireNondefaultKeys(entries: readonly (readonly [string, PublicKey])[]): void {
  for (const [field, value] of entries) {
    if (isDefaultKey(value)) {
      throw new Error(`${field} must be nondefault`);
    }
  }
}

function requireU8(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${field} must be a u8`);
  }
  return value;
}

function requireU16(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${field} must be a u16`);
  }
  return value;
}

function requireU32(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${field} must be a u32`);
  }
  return value;
}

function requireU64(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    throw new RangeError(`${field} must be a u64`);
  }
  return value;
}

function requireBool(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be boolean`);
  }
  return value;
}

function enumValue<T extends number>(
  value: number,
  values: readonly T[],
  field: string,
): T {
  if (!values.includes(value as T)) {
    throw new RangeError(`unknown ${field} discriminant ${value}`);
  }
  return value as T;
}

function optionalPublicKeyBytes(value: OptionalPublicKeyV1, field: string): Buffer {
  requireBool(value.present, `${field}.present`);
  const isDefault = isDefaultKey(value.value);
  if ((value.present && isDefault) || (!value.present && !isDefault)) {
    throw new Error(`${field} is not canonically encoded`);
  }
  return Buffer.concat([Buffer.from([Number(value.present)]), value.value.toBuffer()]);
}

function validateProgramdataObservationShape(
  headerPresent: boolean,
  dataLength: bigint,
  deployedSlot: bigint,
  capacity: bigint,
  authority: OptionalPublicKeyV1,
  field: string,
): void {
  optionalPublicKeyBytes(authority, `${field}.authority`);
  if (headerPresent) {
    if (dataLength !== capacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1) {
      throw new Error(`${field} data length must equal Loader-v3 metadata plus capacity`);
    }
  } else if (deployedSlot !== 0n || capacity !== 0n || authority.present) {
    throw new Error(`${field} has invalid absent-header metadata`);
  }
}

function validateProgramObservationShape(
  headerPresent: boolean,
  dataLength: bigint,
  linkedProgramdata: OptionalPublicKeyV1,
  field: string,
): void {
  optionalPublicKeyBytes(linkedProgramdata, `${field}.linkedProgramdata`);
  if (headerPresent) {
    if (dataLength !== 36n || !linkedProgramdata.present) {
      throw new Error(`${field} has invalid Loader-v3 Program header evidence`);
    }
  } else if (linkedProgramdata.present) {
    throw new Error(`${field} has invalid absent Program header evidence`);
  }
}

function validateRawProgramdataHashShape(
  complete: boolean,
  rawHash: Uint8Array,
  dataLength: bigint,
  field: string,
): void {
  requireBool(complete, `${field}.complete`);
  requireU64(dataLength, `${field}.dataLength`);
  const hashIsZero = isZero32(rawHash);
  const withinAtomicCeiling =
    dataLength <= MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1;
  if (complete !== withinAtomicCeiling || complete === hashIsZero) {
    throw new Error(`${field} is not canonically complete or incomplete`);
  }
}

function popcount(value: number): number {
  let count = 0;
  let remaining = value;
  while (remaining !== 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

function validateApprovalPair(bitset: number, count: number, field: string): void {
  requireU8(bitset, `${field} bitset`);
  requireU8(count, `${field} count`);
  if ((bitset & ~VALID_APPROVAL_MASK) !== 0) {
    throw new Error(`${field} contains an invalid seat bit`);
  }
  if (popcount(bitset) !== count) {
    throw new Error(`${field} approval count mismatch`);
  }
}

function validateVersionedApproval(
  councilVersion: bigint,
  councilHash: Uint8Array,
  bitset: number,
  count: number,
  field: string,
): void {
  validateApprovalPair(bitset, count, field);
  requireU64(councilVersion, `${field} councilVersion`);
  const hashIsZero = isZero32(councilHash);
  const empty = councilVersion === 0n && hashIsZero && bitset === 0 && count === 0;
  const pinned = councilVersion !== 0n && !hashIsZero && count !== 0;
  if (!empty && !pinned) {
    throw new Error(`${field} council binding is not canonical`);
  }
}

function validateUpgradeProposalLifecycleShape(value: UpgradeProposalV2): void {
  if (
    (value.state === ProposalStateV2.Retired &&
      value.proposalClass !== ProposalClassV1.EmergencyRollback) ||
    (value.state === ProposalStateV2.SupersededByRollback &&
      value.proposalClass === ProposalClassV1.EmergencyRollback)
  ) {
    throw new Error("Release 1 proposal terminal class is not canonical");
  }
  if (
    value.councilApprovalCount > RELEASE1_APPROVAL_THRESHOLD ||
    value.cancellationApprovalCount > RELEASE1_APPROVAL_THRESHOLD ||
    value.unfreezeApprovalCount > RELEASE1_APPROVAL_THRESHOLD
  ) {
    throw new Error("Release 1 proposal approval count exceeds threshold");
  }

  const cancellationStarted = value.cancellationApprovalCount !== 0;
  if (cancellationStarted !== (value.cancellationReasonCode !== 0)) {
    throw new Error("Release 1 proposal cancellation reason is not canonical");
  }
  if (value.state === ProposalStateV2.Cancelled) {
    if (
      value.cancellationApprovalCount !== RELEASE1_APPROVAL_THRESHOLD ||
      value.terminalReasonCode !== value.cancellationReasonCode
    ) {
      throw new Error("cancelled proposal lacks canonical quorum or reason");
    }
  } else if (value.cancellationApprovalCount === RELEASE1_APPROVAL_THRESHOLD) {
    throw new Error("cancellation quorum must transition the proposal");
  }

  const firstApprovalPresent = value.firstApprovalSlot !== 0n;
  const councilApprovedPresent = value.councilApprovedSlot !== 0n;
  if (
    firstApprovalPresent !== (value.councilApprovalCount !== 0) ||
    councilApprovedPresent !==
      (value.councilApprovalCount === RELEASE1_APPROVAL_THRESHOLD)
  ) {
    throw new Error("Release 1 proposal initial approval slots are not canonical");
  }
  if (
    firstApprovalPresent &&
    (value.firstApprovalSlot < value.reviewStartSlot ||
      value.firstApprovalSlot > value.reviewEndSlot ||
      value.firstApprovalSlot >= value.expirySlot)
  ) {
    throw new Error("Release 1 proposal first approval is outside review timing");
  }
  if (
    councilApprovedPresent &&
    (value.councilApprovedSlot < value.firstApprovalSlot ||
      value.councilApprovedSlot > value.reviewEndSlot ||
      value.councilApprovedSlot >= value.expirySlot)
  ) {
    throw new Error("Release 1 proposal quorum slot is outside review timing");
  }

  const governanceSatisfied = value.governanceSatisfiedSlot !== 0n;
  const queued = value.queuedSlot !== 0n;
  if (
    (governanceSatisfied && !councilApprovedPresent) ||
    (queued && !governanceSatisfied) ||
    (governanceSatisfied && value.governanceSatisfiedSlot >= value.expirySlot) ||
    (queued && value.queuedSlot >= value.expirySlot)
  ) {
    throw new Error("Release 1 proposal governance slot prefix is invalid");
  }

  let prefreezeShape: boolean;
  switch (value.state) {
    case ProposalStateV2.Draft:
    case ProposalStateV2.BufferAdopted:
      prefreezeShape =
        value.councilApprovalCount === 0 && !governanceSatisfied && !queued;
      break;
    case ProposalStateV2.BufferVerified:
      prefreezeShape =
        value.councilApprovalCount < RELEASE1_APPROVAL_THRESHOLD &&
        !governanceSatisfied &&
        !queued;
      break;
    case ProposalStateV2.CouncilApproved:
      prefreezeShape =
        value.councilApprovalCount === RELEASE1_APPROVAL_THRESHOLD &&
        !governanceSatisfied &&
        !queued;
      break;
    case ProposalStateV2.GovernanceSatisfied:
      prefreezeShape =
        value.councilApprovalCount === RELEASE1_APPROVAL_THRESHOLD &&
        governanceSatisfied &&
        !queued;
      break;
    case ProposalStateV2.Timelocked:
    case ProposalStateV2.Retired:
      prefreezeShape =
        value.councilApprovalCount === RELEASE1_APPROVAL_THRESHOLD &&
        governanceSatisfied &&
        queued;
      break;
    case ProposalStateV2.Cancelled:
    case ProposalStateV2.Expired:
      prefreezeShape = true;
      break;
    case ProposalStateV2.TokenReviewOpen:
      prefreezeShape = false;
      break;
    default:
      prefreezeShape =
        value.councilApprovalCount === RELEASE1_APPROVAL_THRESHOLD &&
        governanceSatisfied &&
        queued;
      break;
  }
  if (!prefreezeShape) {
    throw new Error("Release 1 proposal pre-freeze state is not canonical");
  }

  const frozenRequired =
    value.state === ProposalStateV2.Frozen ||
    value.state === ProposalStateV2.Extended ||
    value.state === ProposalStateV2.UpgradeExecuted ||
    value.state === ProposalStateV2.ProgramDataVerified ||
    value.state === ProposalStateV2.PoststateAccepted ||
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed ||
    value.state === ProposalStateV2.SupersededByRollback;
  if (
    (value.frozenSlot !== 0n) !== frozenRequired ||
    (frozenRequired &&
      (value.frozenSlot < value.notBeforeSlot || value.frozenSlot >= value.expirySlot))
  ) {
    throw new Error("Release 1 proposal freeze slot is not canonical");
  }

  const extensionRequired = value.extensionDelta !== 0n;
  const extensionSlotRequired =
    extensionRequired &&
    (value.state === ProposalStateV2.Extended ||
      value.state === ProposalStateV2.UpgradeExecuted ||
      value.state === ProposalStateV2.ProgramDataVerified ||
      value.state === ProposalStateV2.PoststateAccepted ||
      value.state === ProposalStateV2.UnfreezeApproved ||
      value.state === ProposalStateV2.Completed ||
      value.state === ProposalStateV2.SupersededByRollback);
  if (
    (value.state === ProposalStateV2.Extended && !extensionRequired) ||
    (value.extensionExecutedSlot !== 0n) !== extensionSlotRequired ||
    value.extensionExecutedSlot >= value.expirySlot
  ) {
    throw new Error("Release 1 proposal extension slot is not canonical");
  }

  const upgradeExecuted =
    value.state === ProposalStateV2.UpgradeExecuted ||
    value.state === ProposalStateV2.ProgramDataVerified ||
    value.state === ProposalStateV2.PoststateAccepted ||
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed ||
    value.state === ProposalStateV2.SupersededByRollback;
  if (
    (value.upgradeExecutedSlot !== 0n) !== upgradeExecuted ||
    value.upgradeExecutedSlot >= value.expirySlot ||
    (extensionSlotRequired &&
      upgradeExecuted &&
      value.extensionExecutedSlot >= value.upgradeExecutedSlot)
  ) {
    throw new Error("Release 1 proposal upgrade slot is not canonical");
  }

  const programdataVerifiedRequired =
    value.state === ProposalStateV2.ProgramDataVerified ||
    value.state === ProposalStateV2.PoststateAccepted ||
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed;
  const programdataVerifiedAllowed =
    programdataVerifiedRequired || value.state === ProposalStateV2.SupersededByRollback;
  if (
    (programdataVerifiedRequired && value.programdataVerifiedSlot === 0n) ||
    (!programdataVerifiedAllowed && value.programdataVerifiedSlot !== 0n)
  ) {
    throw new Error("Release 1 proposal ProgramData verification slot is not canonical");
  }

  const poststateAccepted =
    value.state === ProposalStateV2.PoststateAccepted ||
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed;
  if ((value.poststateAcceptedSlot !== 0n) !== poststateAccepted) {
    throw new Error("Release 1 proposal poststate slot is not canonical");
  }

  const unfreezeApproved =
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed;
  const unfreezeShape =
    value.state === ProposalStateV2.PoststateAccepted
      ? value.unfreezeApprovalCount < RELEASE1_APPROVAL_THRESHOLD
      : unfreezeApproved
        ? value.unfreezeApprovalCount === RELEASE1_APPROVAL_THRESHOLD
        : value.unfreezeApprovalCount === 0;
  if (!unfreezeShape || (value.unfreezeApprovedSlot !== 0n) !== unfreezeApproved) {
    throw new Error("Release 1 proposal unfreeze approval state is not canonical");
  }

  const expectedTerminalReason =
    value.state === ProposalStateV2.Completed
      ? PROPOSAL_COMPLETED_TERMINAL_REASON_V1
      : value.state === ProposalStateV2.Cancelled
        ? value.cancellationReasonCode
        : value.state === ProposalStateV2.Expired
          ? PROPOSAL_EXPIRED_TERMINAL_REASON_V1
          : value.state === ProposalStateV2.SupersededByRollback
            ? PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1
            : value.state === ProposalStateV2.Retired
              ? PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1
              : 0;
  const terminal = expectedTerminalReason !== 0;
  if (
    (value.terminalSlot !== 0n) !== terminal ||
    value.terminalReasonCode !== expectedTerminalReason ||
    (value.state === ProposalStateV2.Cancelled && value.terminalSlot >= value.expirySlot) ||
    (value.state === ProposalStateV2.Expired && value.terminalSlot < value.expirySlot)
  ) {
    throw new Error("Release 1 proposal terminal state is not canonical");
  }

  let previous = 0n;
  for (const slot of [
    value.creationSlot,
    value.firstApprovalSlot,
    value.councilApprovedSlot,
    value.governanceSatisfiedSlot,
    value.queuedSlot,
    value.frozenSlot,
    value.extensionExecutedSlot,
    value.upgradeExecutedSlot,
    value.programdataVerifiedSlot,
    value.poststateAcceptedSlot,
    value.unfreezeApprovedSlot,
    value.terminalSlot,
  ]) {
    if (slot !== 0n) {
      if (slot < previous) {
        throw new Error("Release 1 proposal lifecycle slots are out of order");
      }
      previous = slot;
    }
  }
}

function validateHeader(
  discriminator: Uint8Array,
  expectedDiscriminator: Uint8Array,
  accountVersion: number,
  expectedVersion: number,
  initialized: boolean,
  reserved: Uint8Array,
  reservedLength: number,
  accountName: string,
): void {
  if (!requireBytes(discriminator, 8, `${accountName} discriminator`).equals(expectedDiscriminator)) {
    throw new Error(`invalid ${accountName} discriminator`);
  }
  if (accountVersion !== expectedVersion) {
    throw new Error(`unsupported ${accountName} version`);
  }
  if (!requireBool(initialized, `${accountName}.initialized`)) {
    throw new Error(`${accountName} is not initialized`);
  }
  requireZeroBytes(reserved, reservedLength, `${accountName} reserved`);
}

function validateArtifactCommitment(
  artifactLength: bigint,
  artifactSha256: Uint8Array,
  artifactRoot: Uint8Array,
  schemeId: Uint8Array,
  chunkSize: number,
  chunkCount: number,
): void {
  requireU64(artifactLength, "artifactLength");
  requireU32(chunkSize, "chunkSize");
  requireU32(chunkCount, "chunkCount");
  if (
    artifactLength === 0n ||
    artifactLength > BigInt(MAX_ARTIFACT_BYTES_V1) ||
    isZero32(artifactSha256) ||
    isZero32(artifactRoot) ||
    !requireBytes(schemeId, 32, "chunkHashDomain").equals(ARTIFACT_MERKLE_SCHEME_ID) ||
    !isRelease1ChunkSize(chunkSize) ||
    chunkCount !== artifactChunkCount(artifactLength, chunkSize)
  ) {
    throw new Error("invalid Release 1 artifact commitment");
  }
}

class Writer {
  readonly #parts: Buffer[] = [];

  bytes(value: Uint8Array, length: number, field: string): this {
    this.#parts.push(requireBytes(value, length, field));
    return this;
  }

  key(value: PublicKey): this {
    this.#parts.push(value.toBuffer());
    return this;
  }

  optionalKey(value: OptionalPublicKeyV1, field: string): this {
    this.#parts.push(optionalPublicKeyBytes(value, field));
    return this;
  }

  u8(value: number, field: string): this {
    this.#parts.push(Buffer.from([requireU8(value, field)]));
    return this;
  }

  bool(value: boolean, field: string): this {
    this.#parts.push(Buffer.from([Number(requireBool(value, field))]));
    return this;
  }

  u16(value: number, field: string): this {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(requireU16(value, field));
    this.#parts.push(out);
    return this;
  }

  u32(value: number, field: string): this {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(requireU32(value, field));
    this.#parts.push(out);
    return this;
  }

  u64(value: bigint, field: string): this {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(requireU64(value, field));
    this.#parts.push(out);
    return this;
  }

  finish(expectedLength: number, name: string): Buffer {
    const out = Buffer.concat(this.#parts);
    if (out.length !== expectedLength) {
      throw new Error(`${name} length ${out.length}; expected ${expectedLength}`);
    }
    return out;
  }
}

class Reader {
  readonly #bytes: Buffer;
  #offset = 0;

  constructor(value: Uint8Array, expectedLength: number, name: string) {
    this.#bytes = requireBytes(value, expectedLength, name);
  }

  bytes(length: number): Buffer {
    const end = this.#offset + length;
    if (end > this.#bytes.length) {
      throw new RangeError("truncated fixed-width account");
    }
    const value = Buffer.from(this.#bytes.subarray(this.#offset, end));
    this.#offset = end;
    return value;
  }

  key(): PublicKey {
    return new PublicKey(this.bytes(32));
  }

  optionalKey(field: string): OptionalPublicKeyV1 {
    const present = this.bool(`${field}.present`);
    const value = this.key();
    const decoded = { present, value };
    optionalPublicKeyBytes(decoded, field);
    return decoded;
  }

  u8(): number {
    return this.bytes(1)[0]!;
  }

  bool(field: string): boolean {
    const value = this.u8();
    if (value !== 0 && value !== 1) {
      throw new Error(`${field} is not a canonical boolean`);
    }
    return value === 1;
  }

  enum<T extends number>(values: readonly T[], field: string): T {
    return enumValue(this.u8(), values, field);
  }

  u16(): number {
    const value = this.#bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    const value = this.#bytes.readUInt32LE(this.#offset);
    this.#offset += 4;
    return value;
  }

  u64(): bigint {
    const value = this.#bytes.readBigUInt64LE(this.#offset);
    this.#offset += 8;
    return value;
  }

  end(name: string): void {
    if (this.#offset !== this.#bytes.length) {
      throw new Error(`${name} has trailing bytes`);
    }
  }
}

const PROPOSAL_CLASS_VALUES = Object.values(ProposalClassV1);
const GATE_STATUS_VALUES = Object.values(GateStatusV1);
const VOTE_REQUIREMENT_VALUES = Object.values(VoteRequirementV1);
const PROPOSAL_STATE_V2_VALUES = Object.values(ProposalStateV2);
const BUFFER_STATUS_VALUES = Object.values(BufferVerificationStatusV1);
const PROGRAMDATA_STATUS_VALUES = Object.values(ProgramDataVerificationStatusV1);
const CHECKPOINT_PHASE_VALUES = Object.values(StateCheckpointPhaseV1);
const ROTATION_STATE_VALUES = Object.values(CouncilRotationStateV1);
const EMERGENCY_STATE_VALUES = Object.values(EmergencyFreezeResolutionStateV1);
const EMERGENCY_KIND_VALUES = Object.values(EmergencyFreezeResolutionKindV1);
const PROGRAMDATA_MISMATCH_CLASS_VALUES = Object.values(ProgramDataMismatchClassV1);

function sha256(domain: Uint8Array, material: Uint8Array): Buffer {
  return createHash("sha256").update(domain).update(material).digest();
}

export function validateUpgradeProposalV2(value: UpgradeProposalV2): void {
  validateHeader(
    value.discriminator,
    UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
    value.accountVersion,
    ACCOUNT_VERSION_V2,
    value.initialized,
    value.reserved,
    UPGRADE_PROPOSAL_V2_RESERVED_LEN,
    "UpgradeProposalV2",
  );
  requireU8(value.bump, "bump");
  requireBool(value.zeroTailRequired, "zeroTailRequired");
  requireU8(value.proposalFlags, "proposalFlags");
  enumValue(value.proposalClass, PROPOSAL_CLASS_VALUES, "ProposalClassV1");
  enumValue(value.state, PROPOSAL_STATE_V2_VALUES, "ProposalStateV2");
  enumValue(value.creationGateStatus, GATE_STATUS_VALUES, "GateStatusV1");
  enumValue(value.voteRequirement, VOTE_REQUIREMENT_VALUES, "VoteRequirementV1");
  if (
    value.proposalFlags !== 0 ||
    !value.zeroTailRequired ||
    value.state === ProposalStateV2.TokenReviewOpen ||
    (value.creationGateStatus !== GateStatusV1.Active &&
      value.creationGateStatus !== GateStatusV1.EmergencyFrozen) ||
    value.proposalClass === ProposalClassV1.CouncilSetRotation ||
    value.proposalClass === ProposalClassV1.TargetImmutability
  ) {
    throw new Error("invalid Release 1 proposal class, state, gate, or flags");
  }
  requireNondefaultKeys([
    ["controllerProgram", value.controllerProgram],
    ["controllerConfig", value.controllerConfig],
    ["protocolGate", value.protocolGate],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
    ["upgradeableLoader", value.upgradeableLoader],
    ["authorityPda", value.authorityPda],
    ["canonicalSpillTreasury", value.canonicalSpillTreasury],
    ["bufferPubkey", value.bufferPubkey],
    ["bufferLoaderOwner", value.bufferLoaderOwner],
    ["bufferUploaderAuthority", value.bufferUploaderAuthority],
    ["bufferFinalAuthority", value.bufferFinalAuthority],
    ["bufferVerification", value.bufferVerification],
    ["programdataVerification", value.programdataVerification],
    ["prestateCheckpoint", value.prestateCheckpoint],
    ["requiredPoststateCheckpoint", value.requiredPoststateCheckpoint],
  ]);
  requireU64(value.proposalId, "proposalId");
  requireU64(value.targetNonce, "targetNonce");
  requireU64(value.creationSlot, "creationSlot");
  if (
    isZero32(value.clusterDomain) ||
    value.policyVersion === 0n ||
    isZero32(value.policyHash) ||
    value.creationCouncilVersion === 0n ||
    isZero32(value.creationCouncilHash) ||
    value.creationGateEpoch === 0n ||
    value.proposalId === 0n ||
    value.targetNonce === 0n ||
    value.creationSlot === 0n ||
    isZero32(value.checkpointSchemaId) ||
    isZero32(value.checkpointPolicyHash) ||
    isZero32(value.proposalDigest)
  ) {
    throw new Error("invalid Release 1 proposal commitment");
  }
  const requiresFrozenEpoch =
    value.state === ProposalStateV2.Frozen ||
    value.state === ProposalStateV2.Extended ||
    value.state === ProposalStateV2.UpgradeExecuted ||
    value.state === ProposalStateV2.ProgramDataVerified ||
    value.state === ProposalStateV2.PoststateAccepted ||
    value.state === ProposalStateV2.UnfreezeApproved ||
    value.state === ProposalStateV2.Completed ||
    value.state === ProposalStateV2.SupersededByRollback;
  if ((value.freezeGateEpoch !== 0n) !== requiresFrozenEpoch) {
    throw new Error("invalid Release 1 proposal frozen epoch");
  }
  validateArtifactCommitment(
    value.artifactLength,
    value.artifactSha256,
    value.artifactChunkMerkleRoot,
    value.chunkHashDomain,
    value.chunkSize,
    value.chunkCount,
  );
  if (
    !value.bufferLoaderOwner.equals(value.upgradeableLoader) ||
    !value.bufferFinalAuthority.equals(value.authorityPda)
  ) {
    throw new Error("invalid Release 1 proposal buffer authority graph");
  }
  for (const [field, commitment] of [
    ["sourceCommitHash", value.sourceCommitHash],
    ["sourceTreeHash", value.sourceTreeHash],
    ["buildInputInventoryHash", value.buildInputInventoryHash],
    ["reproducibleBuildReceiptHash", value.reproducibleBuildReceiptHash],
    ["packageReceiptHash", value.packageReceiptHash],
    ["releaseIntentHash", value.releaseIntentHash],
    ["expectedExecutionPrePayloadHash", value.expectedExecutionPrePayloadHash],
    ["expectedExecutionPreChunkRoot", value.expectedExecutionPreChunkRoot],
  ] as const) {
    if (isZero32(commitment)) {
      throw new Error(`${field} must be nonzero`);
    }
  }
  for (const [field, numeric] of [
    ["policyVersion", value.policyVersion],
    ["creationCouncilVersion", value.creationCouncilVersion],
    ["creationGateEpoch", value.creationGateEpoch],
    ["freezeGateEpoch", value.freezeGateEpoch],
    ["deployedSlot", value.deployedSlot],
    ["currentCapacity", value.currentCapacity],
    ["extensionDelta", value.extensionDelta],
    ["expectedPostCapacity", value.expectedPostCapacity],
    ["reviewStartSlot", value.reviewStartSlot],
    ["reviewEndSlot", value.reviewEndSlot],
    ["notBeforeSlot", value.notBeforeSlot],
    ["expirySlot", value.expirySlot],
    ["firstApprovalSlot", value.firstApprovalSlot],
    ["councilApprovedSlot", value.councilApprovedSlot],
    ["governanceSatisfiedSlot", value.governanceSatisfiedSlot],
    ["queuedSlot", value.queuedSlot],
    ["frozenSlot", value.frozenSlot],
    ["extensionExecutedSlot", value.extensionExecutedSlot],
    ["upgradeExecutedSlot", value.upgradeExecutedSlot],
    ["programdataVerifiedSlot", value.programdataVerifiedSlot],
    ["poststateAcceptedSlot", value.poststateAcceptedSlot],
    ["unfreezeApprovedSlot", value.unfreezeApprovedSlot],
    ["terminalSlot", value.terminalSlot],
  ] as const) {
    requireU64(numeric, field);
  }
  requireU16(value.cancellationReasonCode, "cancellationReasonCode");
  requireU16(value.terminalReasonCode, "terminalReasonCode");
  if (
    value.currentCapacity + value.extensionDelta !== value.expectedPostCapacity ||
    value.currentCapacity === 0n ||
    value.artifactLength > value.expectedPostCapacity ||
    value.expectedPostCapacity > BigInt(MAX_ARTIFACT_BYTES_V1)
  ) {
    throw new Error("invalid Release 1 proposal capacity plan");
  }
  if (
    value.creationSlot > value.reviewStartSlot ||
    value.reviewStartSlot >= value.reviewEndSlot ||
    value.reviewEndSlot > value.notBeforeSlot ||
    value.notBeforeSlot >= value.expirySlot
  ) {
    throw new Error("invalid Release 1 proposal timing");
  }
  optionalPublicKeyBytes(value.primaryProposal, "primaryProposal");
  optionalPublicKeyBytes(value.rollbackProposal, "rollbackProposal");
  optionalPublicKeyBytes(value.rollbackBuffer, "rollbackBuffer");
  const rollbackPresent = value.rollbackProposal.present;
  if (
    rollbackPresent !== value.rollbackBuffer.present ||
    rollbackPresent !== !isZero32(value.rollbackArtifactSha256) ||
    rollbackPresent !== !isZero32(value.rollbackArtifactChunkRoot)
  ) {
    throw new Error("invalid Release 1 rollback commitment shape");
  }
  if (value.proposalClass === ProposalClassV1.EmergencyRollback) {
    if (
      !value.primaryProposal.present ||
      rollbackPresent ||
      value.deployedSlot !== 0n ||
      !isZero32(value.currentRawProgramdataHash)
    ) {
      throw new Error("invalid emergency rollback commitment shape");
    }
  } else if (
    value.proposalClass === ProposalClassV1.RoutineUpgrade ||
    value.proposalClass === ProposalClassV1.EconomicChange ||
    value.proposalClass === ProposalClassV1.ConstitutionalChange
  ) {
    if (
      value.primaryProposal.present ||
      !rollbackPresent ||
      value.deployedSlot === 0n ||
      isZero32(value.currentRawProgramdataHash)
    ) {
      throw new Error("invalid primary proposal rollback commitment shape");
    }
  } else {
    throw new Error("unsupported Release 1 proposal class");
  }
  if (
    value.voteRequirement !== VoteRequirementV1.None ||
    !isDefaultKey(value.voteProgram) ||
    !isDefaultKey(value.voteResultPda)
  ) {
    throw new Error("token governance must remain disabled");
  }
  validateApprovalPair(
    value.councilApprovalBitset,
    value.councilApprovalCount,
    "initial proposal approval",
  );
  validateVersionedApproval(
    value.cancellationCouncilVersion,
    value.cancellationCouncilHash,
    value.cancellationApprovalBitset,
    value.cancellationApprovalCount,
    "cancellation approval",
  );
  validateVersionedApproval(
    value.unfreezeCouncilVersion,
    value.unfreezeCouncilHash,
    value.unfreezeApprovalBitset,
    value.unfreezeApprovalCount,
    "unfreeze approval",
  );
  validateUpgradeProposalLifecycleShape(value);
}

export function serializeUpgradeProposalV2(value: UpgradeProposalV2): Buffer {
  validateUpgradeProposalV2(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.proposalClass, "proposalClass")
    .u8(value.state, "state")
    .u8(value.creationGateStatus, "creationGateStatus")
    .bool(value.zeroTailRequired, "zeroTailRequired")
    .u8(value.proposalFlags, "proposalFlags")
    .u64(value.proposalId, "proposalId")
    .u64(value.targetNonce, "targetNonce")
    .u64(value.creationSlot, "creationSlot")
    .bytes(value.clusterDomain, 32, "clusterDomain")
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .u64(value.policyVersion, "policyVersion")
    .bytes(value.policyHash, 32, "policyHash")
    .u64(value.creationCouncilVersion, "creationCouncilVersion")
    .bytes(value.creationCouncilHash, 32, "creationCouncilHash")
    .u64(value.creationGateEpoch, "creationGateEpoch")
    .u64(value.freezeGateEpoch, "freezeGateEpoch")
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.upgradeableLoader)
    .key(value.authorityPda)
    .key(value.canonicalSpillTreasury)
    .key(value.bufferPubkey)
    .key(value.bufferLoaderOwner)
    .key(value.bufferUploaderAuthority)
    .key(value.bufferFinalAuthority)
    .key(value.bufferVerification)
    .key(value.programdataVerification)
    .u64(value.artifactLength, "artifactLength")
    .bytes(value.artifactSha256, 32, "artifactSha256")
    .bytes(value.artifactChunkMerkleRoot, 32, "artifactChunkMerkleRoot")
    .bytes(value.chunkHashDomain, 32, "chunkHashDomain")
    .u32(value.chunkSize, "chunkSize")
    .u32(value.chunkCount, "chunkCount")
    .bytes(value.sourceCommitHash, 32, "sourceCommitHash")
    .bytes(value.sourceTreeHash, 32, "sourceTreeHash")
    .bytes(value.buildInputInventoryHash, 32, "buildInputInventoryHash")
    .bytes(value.reproducibleBuildReceiptHash, 32, "reproducibleBuildReceiptHash")
    .bytes(value.packageReceiptHash, 32, "packageReceiptHash")
    .bytes(value.releaseIntentHash, 32, "releaseIntentHash")
    .bytes(value.expectedExecutionPrePayloadHash, 32, "expectedExecutionPrePayloadHash")
    .bytes(value.expectedExecutionPreChunkRoot, 32, "expectedExecutionPreChunkRoot")
    .bytes(value.currentRawProgramdataHash, 32, "currentRawProgramdataHash")
    .u64(value.deployedSlot, "deployedSlot")
    .u64(value.currentCapacity, "currentCapacity")
    .u64(value.extensionDelta, "extensionDelta")
    .u64(value.expectedPostCapacity, "expectedPostCapacity")
    .key(value.prestateCheckpoint)
    .key(value.requiredPoststateCheckpoint)
    .bytes(value.checkpointSchemaId, 32, "checkpointSchemaId")
    .bytes(value.checkpointPolicyHash, 32, "checkpointPolicyHash")
    .optionalKey(value.primaryProposal, "primaryProposal")
    .optionalKey(value.rollbackProposal, "rollbackProposal")
    .optionalKey(value.rollbackBuffer, "rollbackBuffer")
    .bytes(value.rollbackArtifactSha256, 32, "rollbackArtifactSha256")
    .bytes(value.rollbackArtifactChunkRoot, 32, "rollbackArtifactChunkRoot")
    .u8(value.voteRequirement, "voteRequirement")
    .key(value.voteProgram)
    .key(value.voteResultPda)
    .u64(value.reviewStartSlot, "reviewStartSlot")
    .u64(value.reviewEndSlot, "reviewEndSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot")
    .u64(value.firstApprovalSlot, "firstApprovalSlot")
    .u64(value.councilApprovedSlot, "councilApprovedSlot")
    .u64(value.governanceSatisfiedSlot, "governanceSatisfiedSlot")
    .u64(value.queuedSlot, "queuedSlot")
    .u64(value.frozenSlot, "frozenSlot")
    .u64(value.extensionExecutedSlot, "extensionExecutedSlot")
    .u64(value.upgradeExecutedSlot, "upgradeExecutedSlot")
    .u64(value.programdataVerifiedSlot, "programdataVerifiedSlot")
    .u64(value.poststateAcceptedSlot, "poststateAcceptedSlot")
    .u64(value.unfreezeApprovedSlot, "unfreezeApprovedSlot")
    .u64(value.terminalSlot, "terminalSlot")
    .u8(value.councilApprovalBitset, "councilApprovalBitset")
    .u8(value.councilApprovalCount, "councilApprovalCount")
    .u64(value.cancellationCouncilVersion, "cancellationCouncilVersion")
    .bytes(value.cancellationCouncilHash, 32, "cancellationCouncilHash")
    .u8(value.cancellationApprovalBitset, "cancellationApprovalBitset")
    .u8(value.cancellationApprovalCount, "cancellationApprovalCount")
    .u64(value.unfreezeCouncilVersion, "unfreezeCouncilVersion")
    .bytes(value.unfreezeCouncilHash, 32, "unfreezeCouncilHash")
    .u8(value.unfreezeApprovalBitset, "unfreezeApprovalBitset")
    .u8(value.unfreezeApprovalCount, "unfreezeApprovalCount")
    .bytes(value.proposalDigest, 32, "proposalDigest")
    .u16(value.cancellationReasonCode, "cancellationReasonCode")
    .u16(value.terminalReasonCode, "terminalReasonCode")
    .bytes(value.reserved, UPGRADE_PROPOSAL_V2_RESERVED_LEN, "reserved");
  return writer.finish(UPGRADE_PROPOSAL_V2_LEN, "UpgradeProposalV2");
}

export function deserializeUpgradeProposalV2(bytes: Uint8Array): UpgradeProposalV2 {
  const reader = new Reader(bytes, UPGRADE_PROPOSAL_V2_LEN, "UpgradeProposalV2");
  const value: UpgradeProposalV2 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    proposalClass: reader.enum(PROPOSAL_CLASS_VALUES, "ProposalClassV1"),
    state: reader.enum(PROPOSAL_STATE_V2_VALUES, "ProposalStateV2"),
    creationGateStatus: reader.enum(GATE_STATUS_VALUES, "GateStatusV1"),
    zeroTailRequired: reader.bool("zeroTailRequired"),
    proposalFlags: reader.u8(),
    proposalId: reader.u64(),
    targetNonce: reader.u64(),
    creationSlot: reader.u64(),
    clusterDomain: reader.bytes(32),
    controllerProgram: reader.key(),
    controllerConfig: reader.key(),
    protocolGate: reader.key(),
    policyVersion: reader.u64(),
    policyHash: reader.bytes(32),
    creationCouncilVersion: reader.u64(),
    creationCouncilHash: reader.bytes(32),
    creationGateEpoch: reader.u64(),
    freezeGateEpoch: reader.u64(),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    upgradeableLoader: reader.key(),
    authorityPda: reader.key(),
    canonicalSpillTreasury: reader.key(),
    bufferPubkey: reader.key(),
    bufferLoaderOwner: reader.key(),
    bufferUploaderAuthority: reader.key(),
    bufferFinalAuthority: reader.key(),
    bufferVerification: reader.key(),
    programdataVerification: reader.key(),
    artifactLength: reader.u64(),
    artifactSha256: reader.bytes(32),
    artifactChunkMerkleRoot: reader.bytes(32),
    chunkHashDomain: reader.bytes(32),
    chunkSize: reader.u32(),
    chunkCount: reader.u32(),
    sourceCommitHash: reader.bytes(32),
    sourceTreeHash: reader.bytes(32),
    buildInputInventoryHash: reader.bytes(32),
    reproducibleBuildReceiptHash: reader.bytes(32),
    packageReceiptHash: reader.bytes(32),
    releaseIntentHash: reader.bytes(32),
    expectedExecutionPrePayloadHash: reader.bytes(32),
    expectedExecutionPreChunkRoot: reader.bytes(32),
    currentRawProgramdataHash: reader.bytes(32),
    deployedSlot: reader.u64(),
    currentCapacity: reader.u64(),
    extensionDelta: reader.u64(),
    expectedPostCapacity: reader.u64(),
    prestateCheckpoint: reader.key(),
    requiredPoststateCheckpoint: reader.key(),
    checkpointSchemaId: reader.bytes(32),
    checkpointPolicyHash: reader.bytes(32),
    primaryProposal: reader.optionalKey("primaryProposal"),
    rollbackProposal: reader.optionalKey("rollbackProposal"),
    rollbackBuffer: reader.optionalKey("rollbackBuffer"),
    rollbackArtifactSha256: reader.bytes(32),
    rollbackArtifactChunkRoot: reader.bytes(32),
    voteRequirement: reader.enum(VOTE_REQUIREMENT_VALUES, "VoteRequirementV1"),
    voteProgram: reader.key(),
    voteResultPda: reader.key(),
    reviewStartSlot: reader.u64(),
    reviewEndSlot: reader.u64(),
    notBeforeSlot: reader.u64(),
    expirySlot: reader.u64(),
    firstApprovalSlot: reader.u64(),
    councilApprovedSlot: reader.u64(),
    governanceSatisfiedSlot: reader.u64(),
    queuedSlot: reader.u64(),
    frozenSlot: reader.u64(),
    extensionExecutedSlot: reader.u64(),
    upgradeExecutedSlot: reader.u64(),
    programdataVerifiedSlot: reader.u64(),
    poststateAcceptedSlot: reader.u64(),
    unfreezeApprovedSlot: reader.u64(),
    terminalSlot: reader.u64(),
    councilApprovalBitset: reader.u8(),
    councilApprovalCount: reader.u8(),
    cancellationCouncilVersion: reader.u64(),
    cancellationCouncilHash: reader.bytes(32),
    cancellationApprovalBitset: reader.u8(),
    cancellationApprovalCount: reader.u8(),
    unfreezeCouncilVersion: reader.u64(),
    unfreezeCouncilHash: reader.bytes(32),
    unfreezeApprovalBitset: reader.u8(),
    unfreezeApprovalCount: reader.u8(),
    proposalDigest: reader.bytes(32),
    cancellationReasonCode: reader.u16(),
    terminalReasonCode: reader.u16(),
    reserved: reader.bytes(UPGRADE_PROPOSAL_V2_RESERVED_LEN),
  };
  reader.end("UpgradeProposalV2");
  validateUpgradeProposalV2(value);
  return value;
}

export function validateBufferVerificationV1(value: BufferVerificationV1): void {
  validateHeader(
    value.discriminator,
    BUFFER_VERIFICATION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    BUFFER_VERIFICATION_V1_RESERVED_LEN,
    "BufferVerificationV1",
  );
  requireU8(value.bump, "bump");
  enumValue(value.status, BUFFER_STATUS_VALUES, "BufferVerificationStatusV1");
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["proposal", value.proposal],
    ["upgradeableLoader", value.upgradeableLoader],
    ["buffer", value.buffer],
    ["expectedUploaderAuthority", value.expectedUploaderAuthority],
    ["controllerAuthority", value.controllerAuthority],
  ]);
  validateArtifactCommitment(
    value.artifactLength,
    value.artifactSha256,
    value.artifactChunkMerkleRoot,
    value.chunkHashDomain,
    value.chunkSize,
    value.chunkCount,
  );
  validateVerificationBitmapV1(
    value.verifiedChunkBitmap,
    value.chunkCount,
    value.verifiedChunkCount,
  );
  requireU64(value.adoptedSlot, "adoptedSlot");
  requireU64(value.finalizedSlot, "finalizedSlot");
  requireU64(value.terminalSlot, "terminalSlot");
  if (value.adoptedSlot === 0n || isZero32(value.sealedBufferHeaderHash)) {
    throw new Error("invalid adopted buffer evidence");
  }
  const statusIsCanonical =
    (value.status === BufferVerificationStatusV1.Adopted &&
      value.verifiedChunkCount === 0 &&
      value.finalizedSlot === 0n &&
      value.terminalSlot === 0n) ||
    (value.status === BufferVerificationStatusV1.Verifying &&
      value.verifiedChunkCount > 0 &&
      value.verifiedChunkCount < value.chunkCount &&
      value.finalizedSlot === 0n &&
      value.terminalSlot === 0n) ||
    (value.status === BufferVerificationStatusV1.ReadyToFinalize &&
      value.verifiedChunkCount === value.chunkCount &&
      value.finalizedSlot === 0n &&
      value.terminalSlot === 0n) ||
    (value.status === BufferVerificationStatusV1.Verified &&
      value.verifiedChunkCount === value.chunkCount &&
      value.finalizedSlot !== 0n &&
      value.terminalSlot === 0n) ||
    (value.status === BufferVerificationStatusV1.ConsumedByUpgrade &&
      value.verifiedChunkCount === value.chunkCount &&
      value.finalizedSlot !== 0n &&
      value.terminalSlot !== 0n) ||
    (value.status === BufferVerificationStatusV1.ClosedAbandoned &&
      value.terminalSlot !== 0n &&
      ((value.finalizedSlot === 0n && value.verifiedChunkCount <= value.chunkCount) ||
        (value.finalizedSlot !== 0n && value.verifiedChunkCount === value.chunkCount)));
  if (!statusIsCanonical) {
    throw new Error("invalid buffer verification lifecycle evidence");
  }
  if (
    (value.finalizedSlot !== 0n && value.finalizedSlot < value.adoptedSlot) ||
    (value.terminalSlot !== 0n && value.terminalSlot < value.adoptedSlot) ||
    (value.finalizedSlot !== 0n &&
      value.terminalSlot !== 0n &&
      value.terminalSlot < value.finalizedSlot)
  ) {
    throw new Error("buffer verification slots are out of order");
  }
}

export function serializeBufferVerificationV1(value: BufferVerificationV1): Buffer {
  validateBufferVerificationV1(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.status, "status")
    .key(value.controllerConfig)
    .key(value.proposal)
    .key(value.upgradeableLoader)
    .key(value.buffer)
    .key(value.expectedUploaderAuthority)
    .key(value.controllerAuthority)
    .u64(value.artifactLength, "artifactLength")
    .bytes(value.artifactSha256, 32, "artifactSha256")
    .bytes(value.artifactChunkMerkleRoot, 32, "artifactChunkMerkleRoot")
    .bytes(value.chunkHashDomain, 32, "chunkHashDomain")
    .u32(value.chunkSize, "chunkSize")
    .u32(value.chunkCount, "chunkCount")
    .bytes(value.verifiedChunkBitmap, VERIFICATION_BITMAP_BYTES_V1, "verifiedChunkBitmap")
    .u32(value.verifiedChunkCount, "verifiedChunkCount")
    .u64(value.adoptedSlot, "adoptedSlot")
    .u64(value.finalizedSlot, "finalizedSlot")
    .bytes(value.sealedBufferHeaderHash, 32, "sealedBufferHeaderHash")
    .u64(value.terminalSlot, "terminalSlot")
    .bytes(value.reserved, BUFFER_VERIFICATION_V1_RESERVED_LEN, "reserved");
  return writer.finish(BUFFER_VERIFICATION_V1_LEN, "BufferVerificationV1");
}

export function deserializeBufferVerificationV1(bytes: Uint8Array): BufferVerificationV1 {
  const reader = new Reader(bytes, BUFFER_VERIFICATION_V1_LEN, "BufferVerificationV1");
  const value: BufferVerificationV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    status: reader.enum(BUFFER_STATUS_VALUES, "BufferVerificationStatusV1"),
    controllerConfig: reader.key(),
    proposal: reader.key(),
    upgradeableLoader: reader.key(),
    buffer: reader.key(),
    expectedUploaderAuthority: reader.key(),
    controllerAuthority: reader.key(),
    artifactLength: reader.u64(),
    artifactSha256: reader.bytes(32),
    artifactChunkMerkleRoot: reader.bytes(32),
    chunkHashDomain: reader.bytes(32),
    chunkSize: reader.u32(),
    chunkCount: reader.u32(),
    verifiedChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
    verifiedChunkCount: reader.u32(),
    adoptedSlot: reader.u64(),
    finalizedSlot: reader.u64(),
    sealedBufferHeaderHash: reader.bytes(32),
    terminalSlot: reader.u64(),
    reserved: reader.bytes(BUFFER_VERIFICATION_V1_RESERVED_LEN),
  };
  reader.end("BufferVerificationV1");
  validateBufferVerificationV1(value);
  return value;
}

export function validateProgramDataVerificationV1(value: ProgramDataVerificationV1): void {
  validateHeader(
    value.discriminator,
    PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN,
    "ProgramDataVerificationV1",
  );
  requireU8(value.bump, "bump");
  enumValue(value.status, PROGRAMDATA_STATUS_VALUES, "ProgramDataVerificationStatusV1");
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["proposal", value.proposal],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
    ["upgradeableLoader", value.upgradeableLoader],
    ["controllerAuthority", value.controllerAuthority],
  ]);
  validateArtifactCommitment(
    value.artifactLength,
    value.artifactSha256,
    value.artifactChunkMerkleRoot,
    value.chunkHashDomain,
    value.chunkSize,
    value.payloadChunkCount,
  );
  requireU64(value.deployedSlot, "deployedSlot");
  requireU64(value.capacity, "capacity");
  requireU64(value.tailLength, "tailLength");
  requireU32(value.tailChunkCount, "tailChunkCount");
  requireU32(value.verifiedPayloadChunkCount, "verifiedPayloadChunkCount");
  requireU32(value.verifiedTailChunkCount, "verifiedTailChunkCount");
  requireBool(value.zeroTailVerified, "zeroTailVerified");
  requireU64(value.finalizedSlot, "finalizedSlot");
  if (
    value.deployedSlot === 0n ||
    value.capacity < value.artifactLength ||
    value.capacity > BigInt(MAX_ARTIFACT_BYTES_V1) ||
    value.tailLength !== value.capacity - value.artifactLength ||
    value.tailChunkCount !== artifactChunkCountAllowEmpty(value.tailLength, value.chunkSize)
  ) {
    throw new Error("invalid ProgramData verification observation");
  }
  validateVerificationBitmapV1(
    value.verifiedPayloadChunkBitmap,
    value.payloadChunkCount,
    value.verifiedPayloadChunkCount,
  );
  validateVerificationBitmapV1(
    value.verifiedTailChunkBitmap,
    value.tailChunkCount,
    value.verifiedTailChunkCount,
  );
  const complete =
    value.verifiedPayloadChunkCount === value.payloadChunkCount &&
    value.verifiedTailChunkCount === value.tailChunkCount;
  if (value.status === ProgramDataVerificationStatusV1.Verifying) {
    if (
      complete ||
      value.zeroTailVerified ||
      !isZero32(value.rawProgramdataHash) ||
      value.finalizedSlot !== 0n
    ) {
      throw new Error("invalid in-progress ProgramData verification evidence");
    }
  } else if (value.status === ProgramDataVerificationStatusV1.ReadyToFinalize) {
    if (
      !complete ||
      value.zeroTailVerified ||
      !isZero32(value.rawProgramdataHash) ||
      value.finalizedSlot !== 0n
    ) {
      throw new Error("invalid ready ProgramData verification evidence");
    }
  } else if (
    !complete ||
    !value.zeroTailVerified ||
    isZero32(value.rawProgramdataHash) ||
    value.finalizedSlot === 0n
  ) {
    throw new Error("invalid completed ProgramData verification evidence");
  }
  if (value.finalizedSlot !== 0n && value.finalizedSlot < value.deployedSlot) {
    throw new Error("ProgramData verification slots are out of order");
  }
}

export function serializeProgramDataVerificationV1(
  value: ProgramDataVerificationV1,
): Buffer {
  validateProgramDataVerificationV1(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.status, "status")
    .key(value.controllerConfig)
    .key(value.proposal)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.upgradeableLoader)
    .key(value.controllerAuthority)
    .u64(value.artifactLength, "artifactLength")
    .bytes(value.artifactSha256, 32, "artifactSha256")
    .bytes(value.artifactChunkMerkleRoot, 32, "artifactChunkMerkleRoot")
    .bytes(value.chunkHashDomain, 32, "chunkHashDomain")
    .u32(value.chunkSize, "chunkSize")
    .u32(value.payloadChunkCount, "payloadChunkCount")
    .bytes(
      value.verifiedPayloadChunkBitmap,
      VERIFICATION_BITMAP_BYTES_V1,
      "verifiedPayloadChunkBitmap",
    )
    .u32(value.verifiedPayloadChunkCount, "verifiedPayloadChunkCount")
    .u64(value.deployedSlot, "deployedSlot")
    .u64(value.capacity, "capacity")
    .u64(value.tailLength, "tailLength")
    .u32(value.tailChunkCount, "tailChunkCount")
    .bytes(
      value.verifiedTailChunkBitmap,
      VERIFICATION_BITMAP_BYTES_V1,
      "verifiedTailChunkBitmap",
    )
    .u32(value.verifiedTailChunkCount, "verifiedTailChunkCount")
    .bytes(value.rawProgramdataHash, 32, "rawProgramdataHash")
    .bool(value.zeroTailVerified, "zeroTailVerified")
    .u64(value.finalizedSlot, "finalizedSlot")
    .bytes(value.reserved, PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN, "reserved");
  return writer.finish(PROGRAMDATA_VERIFICATION_V1_LEN, "ProgramDataVerificationV1");
}

export function deserializeProgramDataVerificationV1(
  bytes: Uint8Array,
): ProgramDataVerificationV1 {
  const reader = new Reader(
    bytes,
    PROGRAMDATA_VERIFICATION_V1_LEN,
    "ProgramDataVerificationV1",
  );
  const value: ProgramDataVerificationV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    status: reader.enum(PROGRAMDATA_STATUS_VALUES, "ProgramDataVerificationStatusV1"),
    controllerConfig: reader.key(),
    proposal: reader.key(),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    upgradeableLoader: reader.key(),
    controllerAuthority: reader.key(),
    artifactLength: reader.u64(),
    artifactSha256: reader.bytes(32),
    artifactChunkMerkleRoot: reader.bytes(32),
    chunkHashDomain: reader.bytes(32),
    chunkSize: reader.u32(),
    payloadChunkCount: reader.u32(),
    verifiedPayloadChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
    verifiedPayloadChunkCount: reader.u32(),
    deployedSlot: reader.u64(),
    capacity: reader.u64(),
    tailLength: reader.u64(),
    tailChunkCount: reader.u32(),
    verifiedTailChunkBitmap: reader.bytes(VERIFICATION_BITMAP_BYTES_V1),
    verifiedTailChunkCount: reader.u32(),
    rawProgramdataHash: reader.bytes(32),
    zeroTailVerified: reader.bool("zeroTailVerified"),
    finalizedSlot: reader.u64(),
    reserved: reader.bytes(PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN),
  };
  reader.end("ProgramDataVerificationV1");
  validateProgramDataVerificationV1(value);
  return value;
}

export function validateStateCheckpointV1(value: StateCheckpointV1): void {
  validateHeader(
    value.discriminator,
    STATE_CHECKPOINT_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    STATE_CHECKPOINT_V1_RESERVED_LEN,
    "StateCheckpointV1",
  );
  requireU8(value.bump, "bump");
  enumValue(value.phase, CHECKPOINT_PHASE_VALUES, "StateCheckpointPhaseV1");
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
  ]);
  for (const [field, numeric] of [
    ["finalizedObservationSlot", value.finalizedObservationSlot],
    ["gateEpoch", value.gateEpoch],
    ["targetProgramdataSlot", value.targetProgramdataSlot],
    ["targetCapacity", value.targetCapacity],
    ["programOwnedStateCount", value.programOwnedStateCount],
    ["logicalCompressedStateCount", value.logicalCompressedStateCount],
    ["admittedPositiveDonationCount", value.admittedPositiveDonationCount],
    ["finalizedSlot", value.finalizedSlot],
  ] as const) {
    requireU64(numeric, field);
  }
  requireU32(value.forbiddenDriftCount, "forbiddenDriftCount");
  requireBool(value.accepted, "accepted");
  const normalSubject =
    !isDefaultKey(value.proposal) && isDefaultKey(value.emergencyResolution);
  const emergencySubject =
    isDefaultKey(value.proposal) && !isDefaultKey(value.emergencyResolution);
  const subjectShape =
    value.phase === StateCheckpointPhaseV1.Emergency ? emergencySubject : normalSubject;
  if (
    !subjectShape ||
    isZero32(value.subjectDigest) ||
    value.finalizedObservationSlot === 0n ||
    value.gateEpoch === 0n ||
    value.targetProgramdataSlot === 0n ||
    isZero32(value.targetPayloadCommitment) ||
    isZero32(value.targetRawProgramdataCommitment) ||
    value.targetCapacity === 0n ||
    isZero32(value.programOwnedStateRoot) ||
    isZero32(value.logicalCompressedStateRoot) ||
    isZero32(value.semanticCustodyAccountingRoot) ||
    isZero32(value.schemaIdentifier) ||
    isZero32(value.hardCombinedRoot) ||
    isZero32(value.externalMetadataObservationRoot) ||
    isZero32(value.externalRawBalanceObservationRoot) ||
    isZero32(value.checkpointDigest) ||
    ((value.admittedPositiveDonationCount === 0n) !==
      isZero32(value.admittedPositiveDonationRoot))
  ) {
    throw new Error("invalid StateCheckpointV1 evidence");
  }
  validateVersionedApproval(
    value.approvalCouncilVersion,
    value.approvalCouncilHash,
    value.approvalBitset,
    value.approvalCount,
    "checkpoint approval",
  );
  if (
    value.approvalCount !== RELEASE1_APPROVAL_THRESHOLD ||
    value.finalizedSlot === 0n ||
    value.finalizedObservationSlot > value.finalizedSlot
  ) {
    throw new Error("finalized checkpoint lacks quorum or finalization slot");
  }
  if (value.accepted !== (value.forbiddenDriftCount === 0)) {
    throw new Error("checkpoint acceptance disagrees with forbidden drift evidence");
  }
  validateStateCheckpointHardCombinedRootV1(value);
}

export function serializeStateCheckpointV1(value: StateCheckpointV1): Buffer {
  validateStateCheckpointV1(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.phase, "phase")
    .key(value.controllerConfig)
    .key(value.proposal)
    .key(value.emergencyResolution)
    .bytes(value.subjectDigest, 32, "subjectDigest")
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .u64(value.finalizedObservationSlot, "finalizedObservationSlot")
    .u64(value.gateEpoch, "gateEpoch")
    .u64(value.targetProgramdataSlot, "targetProgramdataSlot")
    .bytes(value.targetPayloadCommitment, 32, "targetPayloadCommitment")
    .bytes(value.targetRawProgramdataCommitment, 32, "targetRawProgramdataCommitment")
    .u64(value.targetCapacity, "targetCapacity")
    .bytes(value.programOwnedStateRoot, 32, "programOwnedStateRoot")
    .u64(value.programOwnedStateCount, "programOwnedStateCount")
    .bytes(value.logicalCompressedStateRoot, 32, "logicalCompressedStateRoot")
    .u64(value.logicalCompressedStateCount, "logicalCompressedStateCount")
    .bytes(value.semanticCustodyAccountingRoot, 32, "semanticCustodyAccountingRoot")
    .bytes(value.hardCombinedRoot, 32, "hardCombinedRoot")
    .bytes(value.externalMetadataObservationRoot, 32, "externalMetadataObservationRoot")
    .bytes(value.externalRawBalanceObservationRoot, 32, "externalRawBalanceObservationRoot")
    .bytes(value.schemaIdentifier, 32, "schemaIdentifier")
    .bytes(value.admittedPositiveDonationRoot, 32, "admittedPositiveDonationRoot")
    .u64(value.admittedPositiveDonationCount, "admittedPositiveDonationCount")
    .u32(value.forbiddenDriftCount, "forbiddenDriftCount")
    .u64(value.approvalCouncilVersion, "approvalCouncilVersion")
    .bytes(value.approvalCouncilHash, 32, "approvalCouncilHash")
    .bytes(value.checkpointDigest, 32, "checkpointDigest")
    .u8(value.approvalBitset, "approvalBitset")
    .u8(value.approvalCount, "approvalCount")
    .bool(value.accepted, "accepted")
    .u64(value.finalizedSlot, "finalizedSlot")
    .bytes(value.reserved, STATE_CHECKPOINT_V1_RESERVED_LEN, "reserved");
  return writer.finish(STATE_CHECKPOINT_V1_LEN, "StateCheckpointV1");
}

export function deserializeStateCheckpointV1(bytes: Uint8Array): StateCheckpointV1 {
  const reader = new Reader(bytes, STATE_CHECKPOINT_V1_LEN, "StateCheckpointV1");
  const value: StateCheckpointV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    phase: reader.enum(CHECKPOINT_PHASE_VALUES, "StateCheckpointPhaseV1"),
    controllerConfig: reader.key(),
    proposal: reader.key(),
    emergencyResolution: reader.key(),
    subjectDigest: reader.bytes(32),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    finalizedObservationSlot: reader.u64(),
    gateEpoch: reader.u64(),
    targetProgramdataSlot: reader.u64(),
    targetPayloadCommitment: reader.bytes(32),
    targetRawProgramdataCommitment: reader.bytes(32),
    targetCapacity: reader.u64(),
    programOwnedStateRoot: reader.bytes(32),
    programOwnedStateCount: reader.u64(),
    logicalCompressedStateRoot: reader.bytes(32),
    logicalCompressedStateCount: reader.u64(),
    semanticCustodyAccountingRoot: reader.bytes(32),
    hardCombinedRoot: reader.bytes(32),
    externalMetadataObservationRoot: reader.bytes(32),
    externalRawBalanceObservationRoot: reader.bytes(32),
    schemaIdentifier: reader.bytes(32),
    admittedPositiveDonationRoot: reader.bytes(32),
    admittedPositiveDonationCount: reader.u64(),
    forbiddenDriftCount: reader.u32(),
    approvalCouncilVersion: reader.u64(),
    approvalCouncilHash: reader.bytes(32),
    checkpointDigest: reader.bytes(32),
    approvalBitset: reader.u8(),
    approvalCount: reader.u8(),
    accepted: reader.bool("accepted"),
    finalizedSlot: reader.u64(),
    reserved: reader.bytes(STATE_CHECKPOINT_V1_RESERVED_LEN),
  };
  reader.end("StateCheckpointV1");
  validateStateCheckpointV1(value);
  return value;
}

export function validateCouncilRotationProposalV1(
  value: CouncilRotationProposalV1,
): void {
  validateHeader(
    value.discriminator,
    COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN,
    "CouncilRotationProposalV1",
  );
  requireU8(value.bump, "bump");
  enumValue(value.state, ROTATION_STATE_VALUES, "CouncilRotationStateV1");
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["targetProgram", value.targetProgram],
    ["currentCouncil", value.currentCouncil],
    ["candidateCouncil", value.candidateCouncil],
  ]);
  for (const [field, numeric] of [
    ["currentCouncilVersion", value.currentCouncilVersion],
    ["candidateCouncilVersion", value.candidateCouncilVersion],
    ["creationSlot", value.creationSlot],
    ["notBeforeSlot", value.notBeforeSlot],
    ["expirySlot", value.expirySlot],
    ["targetNonce", value.targetNonce],
    ["activatedSlot", value.activatedSlot],
  ] as const) {
    requireU64(numeric, field);
  }
  requireU16(value.cancellationReasonCode, "cancellationReasonCode");
  requireU16(value.terminalReasonCode, "terminalReasonCode");
  if (
    value.currentCouncilVersion === 0n ||
    value.currentCouncilVersion === U64_MAX ||
    value.candidateCouncilVersion <= value.currentCouncilVersion ||
    value.candidateCouncilVersion === U64_MAX ||
    isZero32(value.currentCouncilHash) ||
    isZero32(value.candidateCouncilHash) ||
    value.targetNonce === 0n ||
    value.creationSlot >= value.notBeforeSlot ||
    value.notBeforeSlot >= value.expirySlot ||
    isZero32(value.rotationDigest)
  ) {
    throw new Error("invalid CouncilRotationProposalV1 commitment");
  }
  validateApprovalPair(value.approvalBitset, value.approvalCount, "rotation approval");
  validateApprovalPair(
    value.cancellationApprovalBitset,
    value.cancellationApprovalCount,
    "rotation cancellation approval",
  );
  if (
    value.approvalCount > RELEASE1_APPROVAL_THRESHOLD ||
    value.cancellationApprovalCount > RELEASE1_APPROVAL_THRESHOLD
  ) {
    throw new Error("council rotation approval count exceeds threshold");
  }
  const cancellationStarted = value.cancellationApprovalCount !== 0;
  if (cancellationStarted !== (value.cancellationReasonCode !== 0)) {
    throw new Error("council rotation cancellation reason is not canonical");
  }
  if (value.state === CouncilRotationStateV1.Cancelled) {
    if (
      value.cancellationApprovalCount !== RELEASE1_APPROVAL_THRESHOLD ||
      value.terminalReasonCode !== value.cancellationReasonCode
    ) {
      throw new Error("cancelled council rotation lacks canonical quorum or reason");
    }
  } else if (value.cancellationApprovalCount === RELEASE1_APPROVAL_THRESHOLD) {
    throw new Error("council rotation cancellation quorum must transition state");
  }
  const approvalShape =
    value.state === CouncilRotationStateV1.Draft
      ? value.approvalCount < RELEASE1_APPROVAL_THRESHOLD
      : value.state === CouncilRotationStateV1.CouncilApproved ||
          value.state === CouncilRotationStateV1.Timelocked ||
          value.state === CouncilRotationStateV1.Activated
        ? value.approvalCount === RELEASE1_APPROVAL_THRESHOLD
        : true;
  if (!approvalShape) {
    throw new Error("council rotation approval state is not canonical");
  }
  const expectedTerminalReason =
    value.state === CouncilRotationStateV1.Activated
      ? COUNCIL_ROTATION_ACTIVATED_TERMINAL_REASON_V1
      : value.state === CouncilRotationStateV1.Cancelled
        ? value.cancellationReasonCode
        : value.state === CouncilRotationStateV1.Expired
          ? COUNCIL_ROTATION_EXPIRED_TERMINAL_REASON_V1
          : 0;
  const activated = value.state === CouncilRotationStateV1.Activated;
  if (
    activated !== (value.activatedSlot !== 0n) ||
    (activated &&
      (value.activatedSlot < value.notBeforeSlot || value.activatedSlot >= value.expirySlot)) ||
    value.terminalReasonCode !== expectedTerminalReason
  ) {
    throw new Error("invalid council rotation activation evidence");
  }
}

export function serializeCouncilRotationProposalV1(
  value: CouncilRotationProposalV1,
): Buffer {
  validateCouncilRotationProposalV1(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.state, "state")
    .key(value.controllerConfig)
    .key(value.targetProgram)
    .key(value.currentCouncil)
    .u64(value.currentCouncilVersion, "currentCouncilVersion")
    .bytes(value.currentCouncilHash, 32, "currentCouncilHash")
    .key(value.candidateCouncil)
    .u64(value.candidateCouncilVersion, "candidateCouncilVersion")
    .bytes(value.candidateCouncilHash, 32, "candidateCouncilHash")
    .u64(value.creationSlot, "creationSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot")
    .u64(value.targetNonce, "targetNonce")
    .u8(value.approvalBitset, "approvalBitset")
    .u8(value.approvalCount, "approvalCount")
    .u8(value.cancellationApprovalBitset, "cancellationApprovalBitset")
    .u8(value.cancellationApprovalCount, "cancellationApprovalCount")
    .bytes(value.rotationDigest, 32, "rotationDigest")
    .u64(value.activatedSlot, "activatedSlot")
    .u16(value.cancellationReasonCode, "cancellationReasonCode")
    .u16(value.terminalReasonCode, "terminalReasonCode")
    .bytes(value.reserved, COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN, "reserved");
  return writer.finish(COUNCIL_ROTATION_PROPOSAL_V1_LEN, "CouncilRotationProposalV1");
}

export function deserializeCouncilRotationProposalV1(
  bytes: Uint8Array,
): CouncilRotationProposalV1 {
  const reader = new Reader(
    bytes,
    COUNCIL_ROTATION_PROPOSAL_V1_LEN,
    "CouncilRotationProposalV1",
  );
  const value: CouncilRotationProposalV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    state: reader.enum(ROTATION_STATE_VALUES, "CouncilRotationStateV1"),
    controllerConfig: reader.key(),
    targetProgram: reader.key(),
    currentCouncil: reader.key(),
    currentCouncilVersion: reader.u64(),
    currentCouncilHash: reader.bytes(32),
    candidateCouncil: reader.key(),
    candidateCouncilVersion: reader.u64(),
    candidateCouncilHash: reader.bytes(32),
    creationSlot: reader.u64(),
    notBeforeSlot: reader.u64(),
    expirySlot: reader.u64(),
    targetNonce: reader.u64(),
    approvalBitset: reader.u8(),
    approvalCount: reader.u8(),
    cancellationApprovalBitset: reader.u8(),
    cancellationApprovalCount: reader.u8(),
    rotationDigest: reader.bytes(32),
    activatedSlot: reader.u64(),
    cancellationReasonCode: reader.u16(),
    terminalReasonCode: reader.u16(),
    reserved: reader.bytes(COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN),
  };
  reader.end("CouncilRotationProposalV1");
  validateCouncilRotationProposalV1(value);
  return value;
}

export function validateEmergencyFreezeResolutionV1(
  value: EmergencyFreezeResolutionV1,
): void {
  validateHeader(
    value.discriminator,
    EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN,
    "EmergencyFreezeResolutionV1",
  );
  requireU8(value.bump, "bump");
  enumValue(
    value.state,
    EMERGENCY_STATE_VALUES,
    "EmergencyFreezeResolutionStateV1",
  );
  enumValue(
    value.resolutionKind,
    EMERGENCY_KIND_VALUES,
    "EmergencyFreezeResolutionKindV1",
  );
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["protocolGate", value.protocolGate],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
    ["emergencyFreezeObservation", value.emergencyFreezeObservation],
    ["emergencyCheckpoint", value.emergencyCheckpoint],
  ]);
  optionalPublicKeyBytes(value.observedAuthority, "observedAuthority");
  optionalPublicKeyBytes(value.observedLinkedProgramdata, "observedLinkedProgramdata");
  requireBool(value.observedProgramExecutable, "observedProgramExecutable");
  requireBool(value.observedProgramHeaderPresent, "observedProgramHeaderPresent");
  requireBool(value.observedProgramdataExecutable, "observedProgramdataExecutable");
  requireBool(value.observedProgramdataHeaderPresent, "observedProgramdataHeaderPresent");
  requireBool(value.observedRawHashComplete, "observedRawHashComplete");
  for (const [field, numeric] of [
    ["frozenEpoch", value.frozenEpoch],
    ["freezeSlot", value.freezeSlot],
    ["creationSlot", value.creationSlot],
    ["notBeforeSlot", value.notBeforeSlot],
    ["expirySlot", value.expirySlot],
    ["targetNonce", value.targetNonce],
    ["observedProgramDataLength", value.observedProgramDataLength],
    ["observedProgramdataDataLength", value.observedProgramdataDataLength],
    ["observedProgramdataSlot", value.observedProgramdataSlot],
    ["observedCapacity", value.observedCapacity],
    ["executedSlot", value.executedSlot],
  ] as const) {
    requireU64(numeric, field);
  }
  requireU16(value.freezeReasonCode, "freezeReasonCode");
  requireU16(value.cancellationReasonCode, "cancellationReasonCode");
  requireU16(value.terminalReasonCode, "terminalReasonCode");
  if (
    value.frozenEpoch === 0n ||
    value.freezeSlot === 0n ||
    value.freezeReasonCode === 0 ||
    value.freezeReasonCode === BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 ||
    value.creationSlot < value.freezeSlot ||
    value.creationSlot >= value.expirySlot ||
    value.freezeSlot >= value.notBeforeSlot ||
    value.notBeforeSlot >= value.expirySlot ||
    value.targetNonce === 0n ||
    isZero32(value.resolutionDigest)
  ) {
    throw new Error("invalid EmergencyFreezeResolutionV1 commitment");
  }
  validateProgramObservationShape(
    value.observedProgramHeaderPresent,
    value.observedProgramDataLength,
    value.observedLinkedProgramdata,
    "emergency Program observation",
  );
  validateRawProgramdataHashShape(
    value.observedRawHashComplete,
    value.observedRawProgramdataHash,
    value.observedProgramdataDataLength,
    "emergency raw ProgramData hash",
  );
  validateProgramdataObservationShape(
    value.observedProgramdataHeaderPresent,
    value.observedProgramdataDataLength,
    value.observedProgramdataSlot,
    value.observedCapacity,
    value.observedAuthority,
    "emergency ProgramData observation",
  );
  validateVersionedApproval(
    value.approvalCouncilVersion,
    value.approvalCouncilHash,
    value.approvalBitset,
    value.approvalCount,
    "emergency resolution approval",
  );
  if (
    value.approvalCount > RELEASE1_APPROVAL_THRESHOLD ||
    value.state === EmergencyFreezeResolutionStateV1.Cancelled ||
    value.cancellationReasonCode !== 0
  ) {
    throw new Error("emergency resolution contains unreachable cancellation state");
  }
  const approvalShape =
    value.state === EmergencyFreezeResolutionStateV1.Draft
      ? value.approvalCount < RELEASE1_APPROVAL_THRESHOLD
      : value.state === EmergencyFreezeResolutionStateV1.CouncilApproved ||
          value.state === EmergencyFreezeResolutionStateV1.Timelocked ||
          value.state === EmergencyFreezeResolutionStateV1.Executed
        ? value.approvalCount === RELEASE1_APPROVAL_THRESHOLD
        : true;
  if (!approvalShape) {
    throw new Error("emergency resolution approval state is not canonical");
  }
  const expectedTerminalReason =
    value.state === EmergencyFreezeResolutionStateV1.Executed
      ? EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1
      : value.state === EmergencyFreezeResolutionStateV1.Expired
        ? EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V1
        : 0;
  const executed = value.state === EmergencyFreezeResolutionStateV1.Executed;
  if (
    executed !== (value.executedSlot !== 0n) ||
    (executed &&
      (value.executedSlot < value.notBeforeSlot ||
        value.executedSlot < value.creationSlot ||
        value.executedSlot >= value.expirySlot)) ||
    (executed &&
      (!value.observedRawHashComplete ||
        !value.observedProgramOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
        !value.observedProgramExecutable ||
        !value.observedProgramHeaderPresent ||
        !value.observedLinkedProgramdata.present ||
        !value.observedLinkedProgramdata.value.equals(value.targetProgramdata) ||
        !value.observedProgramdataOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
        value.observedProgramdataExecutable ||
        !value.observedProgramdataHeaderPresent ||
        value.observedProgramdataSlot === 0n ||
        value.observedCapacity === 0n ||
        !value.observedAuthority.present)) ||
    value.terminalReasonCode !== expectedTerminalReason
  ) {
    throw new Error("invalid emergency resolution execution evidence");
  }
}

export function serializeEmergencyFreezeResolutionV1(
  value: EmergencyFreezeResolutionV1,
): Buffer {
  validateEmergencyFreezeResolutionV1(value);
  const writer = new Writer();
  writer
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .u8(value.state, "state")
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.emergencyFreezeObservation)
    .u64(value.frozenEpoch, "frozenEpoch")
    .u64(value.freezeSlot, "freezeSlot")
    .u16(value.freezeReasonCode, "freezeReasonCode")
    .u8(value.resolutionKind, "resolutionKind")
    .u64(value.creationSlot, "creationSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot")
    .u64(value.targetNonce, "targetNonce")
    .key(value.observedProgramOwner)
    .bool(value.observedProgramExecutable, "observedProgramExecutable")
    .u64(value.observedProgramDataLength, "observedProgramDataLength")
    .bool(value.observedProgramHeaderPresent, "observedProgramHeaderPresent")
    .optionalKey(value.observedLinkedProgramdata, "observedLinkedProgramdata")
    .key(value.observedProgramdataOwner)
    .bool(value.observedProgramdataExecutable, "observedProgramdataExecutable")
    .u64(value.observedProgramdataDataLength, "observedProgramdataDataLength")
    .bool(value.observedProgramdataHeaderPresent, "observedProgramdataHeaderPresent")
    .u64(value.observedProgramdataSlot, "observedProgramdataSlot")
    .bool(value.observedRawHashComplete, "observedRawHashComplete")
    .bytes(value.observedRawProgramdataHash, 32, "observedRawProgramdataHash")
    .u64(value.observedCapacity, "observedCapacity")
    .optionalKey(value.observedAuthority, "observedAuthority")
    .key(value.emergencyCheckpoint)
    .u64(value.approvalCouncilVersion, "approvalCouncilVersion")
    .bytes(value.approvalCouncilHash, 32, "approvalCouncilHash")
    .u8(value.approvalBitset, "approvalBitset")
    .u8(value.approvalCount, "approvalCount")
    .bytes(value.resolutionDigest, 32, "resolutionDigest")
    .u64(value.executedSlot, "executedSlot")
    .u16(value.cancellationReasonCode, "cancellationReasonCode")
    .u16(value.terminalReasonCode, "terminalReasonCode")
    .bytes(value.reserved, EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN, "reserved");
  return writer.finish(
    EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
    "EmergencyFreezeResolutionV1",
  );
}

export function deserializeEmergencyFreezeResolutionV1(
  bytes: Uint8Array,
): EmergencyFreezeResolutionV1 {
  const reader = new Reader(
    bytes,
    EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
    "EmergencyFreezeResolutionV1",
  );
  const value: EmergencyFreezeResolutionV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    state: reader.enum(EMERGENCY_STATE_VALUES, "EmergencyFreezeResolutionStateV1"),
    controllerConfig: reader.key(),
    protocolGate: reader.key(),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    emergencyFreezeObservation: reader.key(),
    frozenEpoch: reader.u64(),
    freezeSlot: reader.u64(),
    freezeReasonCode: reader.u16(),
    resolutionKind: reader.enum(
      EMERGENCY_KIND_VALUES,
      "EmergencyFreezeResolutionKindV1",
    ),
    creationSlot: reader.u64(),
    notBeforeSlot: reader.u64(),
    expirySlot: reader.u64(),
    targetNonce: reader.u64(),
    observedProgramOwner: reader.key(),
    observedProgramExecutable: reader.bool("observedProgramExecutable"),
    observedProgramDataLength: reader.u64(),
    observedProgramHeaderPresent: reader.bool("observedProgramHeaderPresent"),
    observedLinkedProgramdata: reader.optionalKey("observedLinkedProgramdata"),
    observedProgramdataOwner: reader.key(),
    observedProgramdataExecutable: reader.bool("observedProgramdataExecutable"),
    observedProgramdataDataLength: reader.u64(),
    observedProgramdataHeaderPresent: reader.bool("observedProgramdataHeaderPresent"),
    observedProgramdataSlot: reader.u64(),
    observedRawHashComplete: reader.bool("observedRawHashComplete"),
    observedRawProgramdataHash: reader.bytes(32),
    observedCapacity: reader.u64(),
    observedAuthority: reader.optionalKey("observedAuthority"),
    emergencyCheckpoint: reader.key(),
    approvalCouncilVersion: reader.u64(),
    approvalCouncilHash: reader.bytes(32),
    approvalBitset: reader.u8(),
    approvalCount: reader.u8(),
    resolutionDigest: reader.bytes(32),
    executedSlot: reader.u64(),
    cancellationReasonCode: reader.u16(),
    terminalReasonCode: reader.u16(),
    reserved: reader.bytes(EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN),
  };
  reader.end("EmergencyFreezeResolutionV1");
  validateEmergencyFreezeResolutionV1(value);
  return value;
}

export function validateEmergencyFreezeObservationV1(
  value: EmergencyFreezeObservationV1,
): void {
  validateHeader(
    value.discriminator,
    EMERGENCY_FREEZE_OBSERVATION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN,
    "EmergencyFreezeObservationV1",
  );
  requireU8(value.bump, "bump");
  requireBool(value.finalized, "finalized");
  requireBool(value.actualProgramExecutable, "actualProgramExecutable");
  requireBool(value.programHeaderPresent, "programHeaderPresent");
  requireBool(value.actualProgramdataExecutable, "actualProgramdataExecutable");
  requireBool(value.programdataHeaderPresent, "programdataHeaderPresent");
  requireBool(value.rawHashComplete, "rawHashComplete");
  requireNondefaultKeys([
    ["controllerProgram", value.controllerProgram],
    ["controllerConfig", value.controllerConfig],
    ["protocolGate", value.protocolGate],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
    ["upgradeableLoader", value.upgradeableLoader],
    ["controllerAuthority", value.controllerAuthority],
  ]);
  optionalPublicKeyBytes(value.actualLinkedProgramdata, "actualLinkedProgramdata");
  optionalPublicKeyBytes(value.observedAuthority, "observedAuthority");
  requireU64(value.frozenEpoch, "frozenEpoch");
  requireU64(value.freezeSlot, "freezeSlot");
  requireU16(value.freezeReasonCode, "freezeReasonCode");
  requireU64(value.actualProgramDataLength, "actualProgramDataLength");
  requireU64(value.actualProgramdataDataLength, "actualProgramdataDataLength");
  requireU64(value.deployedProgramdataSlot, "deployedProgramdataSlot");
  requireU64(value.capacity, "capacity");
  requireU64(value.finalizedSlot, "finalizedSlot");
  if (
    !value.finalized ||
    value.frozenEpoch === 0n ||
    value.freezeSlot === 0n ||
    value.freezeReasonCode === 0 ||
    value.freezeReasonCode === BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 ||
    isZero32(value.observationDigest) ||
    value.finalizedSlot !== value.freezeSlot
  ) {
    throw new Error("invalid EmergencyFreezeObservationV1 commitment");
  }
  validateProgramObservationShape(
    value.programHeaderPresent,
    value.actualProgramDataLength,
    value.actualLinkedProgramdata,
    "guardian Program observation",
  );
  validateRawProgramdataHashShape(
    value.rawHashComplete,
    value.rawProgramdataSha256,
    value.actualProgramdataDataLength,
    "guardian raw ProgramData hash",
  );
  validateProgramdataObservationShape(
    value.programdataHeaderPresent,
    value.actualProgramdataDataLength,
    value.deployedProgramdataSlot,
    value.capacity,
    value.observedAuthority,
    "guardian ProgramData observation",
  );
}

export function serializeEmergencyFreezeObservationV1(
  value: EmergencyFreezeObservationV1,
): Buffer {
  validateEmergencyFreezeObservationV1(value);
  return new Writer()
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .bool(value.finalized, "finalized")
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.upgradeableLoader)
    .key(value.controllerAuthority)
    .u64(value.frozenEpoch, "frozenEpoch")
    .u64(value.freezeSlot, "freezeSlot")
    .u16(value.freezeReasonCode, "freezeReasonCode")
    .key(value.actualProgramOwner)
    .bool(value.actualProgramExecutable, "actualProgramExecutable")
    .u64(value.actualProgramDataLength, "actualProgramDataLength")
    .bool(value.programHeaderPresent, "programHeaderPresent")
    .optionalKey(value.actualLinkedProgramdata, "actualLinkedProgramdata")
    .key(value.actualProgramdataOwner)
    .bool(value.actualProgramdataExecutable, "actualProgramdataExecutable")
    .u64(value.actualProgramdataDataLength, "actualProgramdataDataLength")
    .bool(value.programdataHeaderPresent, "programdataHeaderPresent")
    .u64(value.deployedProgramdataSlot, "deployedProgramdataSlot")
    .bool(value.rawHashComplete, "rawHashComplete")
    .bytes(value.rawProgramdataSha256, 32, "rawProgramdataSha256")
    .u64(value.capacity, "capacity")
    .optionalKey(value.observedAuthority, "observedAuthority")
    .bytes(value.observationDigest, 32, "observationDigest")
    .u64(value.finalizedSlot, "finalizedSlot")
    .bytes(value.reserved, EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN, "reserved")
    .finish(EMERGENCY_FREEZE_OBSERVATION_V1_LEN, "EmergencyFreezeObservationV1");
}

export function deserializeEmergencyFreezeObservationV1(
  bytes: Uint8Array,
): EmergencyFreezeObservationV1 {
  const reader = new Reader(
    bytes,
    EMERGENCY_FREEZE_OBSERVATION_V1_LEN,
    "EmergencyFreezeObservationV1",
  );
  const value: EmergencyFreezeObservationV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    finalized: reader.bool("finalized"),
    controllerProgram: reader.key(),
    controllerConfig: reader.key(),
    protocolGate: reader.key(),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    upgradeableLoader: reader.key(),
    controllerAuthority: reader.key(),
    frozenEpoch: reader.u64(),
    freezeSlot: reader.u64(),
    freezeReasonCode: reader.u16(),
    actualProgramOwner: reader.key(),
    actualProgramExecutable: reader.bool("actualProgramExecutable"),
    actualProgramDataLength: reader.u64(),
    programHeaderPresent: reader.bool("programHeaderPresent"),
    actualLinkedProgramdata: reader.optionalKey("actualLinkedProgramdata"),
    actualProgramdataOwner: reader.key(),
    actualProgramdataExecutable: reader.bool("actualProgramdataExecutable"),
    actualProgramdataDataLength: reader.u64(),
    programdataHeaderPresent: reader.bool("programdataHeaderPresent"),
    deployedProgramdataSlot: reader.u64(),
    rawHashComplete: reader.bool("rawHashComplete"),
    rawProgramdataSha256: reader.bytes(32),
    capacity: reader.u64(),
    observedAuthority: reader.optionalKey("observedAuthority"),
    observationDigest: reader.bytes(32),
    finalizedSlot: reader.u64(),
    reserved: reader.bytes(EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN),
  };
  reader.end("EmergencyFreezeObservationV1");
  validateEmergencyFreezeObservationV1(value);
  return value;
}

export function validateProgramDataFailureObservationV1(
  value: ProgramDataFailureObservationV1,
): void {
  validateHeader(
    value.discriminator,
    PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN,
    "ProgramDataFailureObservationV1",
  );
  requireU8(value.bump, "bump");
  requireBool(value.finalized, "finalized");
  requireBool(value.actualProgramExecutable, "actualProgramExecutable");
  requireBool(value.programHeaderPresent, "programHeaderPresent");
  requireBool(value.rawHashComplete, "rawHashComplete");
  requireBool(value.actualExecutable, "actualExecutable");
  requireBool(value.programdataHeaderPresent, "programdataHeaderPresent");
  requireNondefaultKeys([
    ["controllerConfig", value.controllerConfig],
    ["protocolGate", value.protocolGate],
    ["primaryProposal", value.primaryProposal],
    ["targetProgram", value.targetProgram],
    ["targetProgramdata", value.targetProgramdata],
  ]);
  optionalPublicKeyBytes(value.actualLinkedProgramdata, "actualLinkedProgramdata");
  optionalPublicKeyBytes(value.actualAuthority, "actualAuthority");
  enumValue(value.mismatchClass, PROGRAMDATA_MISMATCH_CLASS_VALUES, "ProgramDataMismatchClassV1");
  requireU64(value.frozenEpoch, "frozenEpoch");
  requireU64(value.actualProgramDataLength, "actualProgramDataLength");
  requireU64(value.actualDataLength, "actualDataLength");
  requireU64(value.actualProgramdataSlot, "actualProgramdataSlot");
  requireU64(value.actualCapacity, "actualCapacity");
  requireU32(value.failingChunkIndex, "failingChunkIndex");
  requireU64(value.finalizedSlot, "finalizedSlot");
  if (
    !value.finalized ||
    value.frozenEpoch === 0n ||
    value.finalizedSlot === 0n ||
    isZero32(value.observationDigest)
  ) {
    throw new Error("invalid ProgramDataFailureObservationV1 commitment");
  }
  validateProgramObservationShape(
    value.programHeaderPresent,
    value.actualProgramDataLength,
    value.actualLinkedProgramdata,
    "failure Program observation",
  );
  validateRawProgramdataHashShape(
    value.rawHashComplete,
    value.actualRawProgramdataSha256,
    value.actualDataLength,
    "failure raw ProgramData hash",
  );
  validateProgramdataObservationShape(
    value.programdataHeaderPresent,
    value.actualDataLength,
    value.actualProgramdataSlot,
    value.actualCapacity,
    value.actualAuthority,
    "failure ProgramData observation",
  );
  if (
    !value.programdataHeaderPresent &&
    value.mismatchClass !== ProgramDataMismatchClassV1.Header
  ) {
    throw new Error("invalid absent ProgramData header evidence");
  }
  const leafFailure =
    value.mismatchClass === ProgramDataMismatchClassV1.PayloadLeaf ||
    value.mismatchClass === ProgramDataMismatchClassV1.ZeroTail;
  if (leafFailure && !value.rawHashComplete) {
    throw new Error("ProgramData leaf failure requires a complete raw hash");
  }
  const leafShape = leafFailure
    ? value.failingChunkIndex !== NO_FAILING_CHUNK_INDEX_V1 &&
      !isZero32(value.expectedLeafHash) &&
      !isZero32(value.actualLeafHash) &&
      !requireBytes(value.expectedLeafHash, 32, "expectedLeafHash").equals(
        requireBytes(value.actualLeafHash, 32, "actualLeafHash"),
      )
    : value.failingChunkIndex === NO_FAILING_CHUNK_INDEX_V1 &&
      isZero32(value.expectedLeafHash) &&
      isZero32(value.actualLeafHash);
  if (!leafShape) {
    throw new Error("invalid ProgramData failure leaf evidence");
  }
  if (value.programdataHeaderPresent) {
    const headerShape =
      value.mismatchClass === ProgramDataMismatchClassV1.Header ||
      (value.mismatchClass === ProgramDataMismatchClassV1.Authority &&
        value.actualProgramdataSlot !== 0n &&
        value.actualCapacity !== 0n) ||
      (value.mismatchClass === ProgramDataMismatchClassV1.Capacity &&
        value.actualProgramdataSlot !== 0n &&
        value.actualAuthority.present) ||
      ((value.mismatchClass === ProgramDataMismatchClassV1.PayloadLeaf ||
        value.mismatchClass === ProgramDataMismatchClassV1.ZeroTail) &&
        value.actualProgramdataSlot !== 0n &&
        value.actualCapacity !== 0n &&
        value.actualAuthority.present);
    if (!headerShape) {
      throw new Error("invalid parsed ProgramData header evidence");
    }
  }
}

export function serializeProgramDataFailureObservationV1(
  value: ProgramDataFailureObservationV1,
): Buffer {
  validateProgramDataFailureObservationV1(value);
  return new Writer()
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .bool(value.finalized, "finalized")
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.primaryProposal)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .u64(value.frozenEpoch, "frozenEpoch")
    .key(value.actualProgramOwner)
    .bool(value.actualProgramExecutable, "actualProgramExecutable")
    .u64(value.actualProgramDataLength, "actualProgramDataLength")
    .bool(value.programHeaderPresent, "programHeaderPresent")
    .optionalKey(value.actualLinkedProgramdata, "actualLinkedProgramdata")
    .bool(value.rawHashComplete, "rawHashComplete")
    .bytes(value.actualRawProgramdataSha256, 32, "actualRawProgramdataSha256")
    .key(value.actualOwner)
    .bool(value.actualExecutable, "actualExecutable")
    .u64(value.actualDataLength, "actualDataLength")
    .bool(value.programdataHeaderPresent, "programdataHeaderPresent")
    .u64(value.actualProgramdataSlot, "actualProgramdataSlot")
    .u64(value.actualCapacity, "actualCapacity")
    .optionalKey(value.actualAuthority, "actualAuthority")
    .u8(value.mismatchClass, "mismatchClass")
    .u32(value.failingChunkIndex, "failingChunkIndex")
    .bytes(value.expectedLeafHash, 32, "expectedLeafHash")
    .bytes(value.actualLeafHash, 32, "actualLeafHash")
    .u64(value.finalizedSlot, "finalizedSlot")
    .bytes(value.observationDigest, 32, "observationDigest")
    .bytes(value.reserved, PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN, "reserved")
    .finish(
      PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN,
      "ProgramDataFailureObservationV1",
    );
}

export function deserializeProgramDataFailureObservationV1(
  bytes: Uint8Array,
): ProgramDataFailureObservationV1 {
  const reader = new Reader(
    bytes,
    PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN,
    "ProgramDataFailureObservationV1",
  );
  const value: ProgramDataFailureObservationV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    finalized: reader.bool("finalized"),
    controllerConfig: reader.key(),
    protocolGate: reader.key(),
    primaryProposal: reader.key(),
    targetProgram: reader.key(),
    targetProgramdata: reader.key(),
    frozenEpoch: reader.u64(),
    actualProgramOwner: reader.key(),
    actualProgramExecutable: reader.bool("actualProgramExecutable"),
    actualProgramDataLength: reader.u64(),
    programHeaderPresent: reader.bool("programHeaderPresent"),
    actualLinkedProgramdata: reader.optionalKey("actualLinkedProgramdata"),
    rawHashComplete: reader.bool("rawHashComplete"),
    actualRawProgramdataSha256: reader.bytes(32),
    actualOwner: reader.key(),
    actualExecutable: reader.bool("actualExecutable"),
    actualDataLength: reader.u64(),
    programdataHeaderPresent: reader.bool("programdataHeaderPresent"),
    actualProgramdataSlot: reader.u64(),
    actualCapacity: reader.u64(),
    actualAuthority: reader.optionalKey("actualAuthority"),
    mismatchClass: reader.enum(
      PROGRAMDATA_MISMATCH_CLASS_VALUES,
      "ProgramDataMismatchClassV1",
    ),
    failingChunkIndex: reader.u32(),
    expectedLeafHash: reader.bytes(32),
    actualLeafHash: reader.bytes(32),
    finalizedSlot: reader.u64(),
    observationDigest: reader.bytes(32),
    reserved: reader.bytes(PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN),
  };
  reader.end("ProgramDataFailureObservationV1");
  validateProgramDataFailureObservationV1(value);
  return value;
}

export function validateCheckpointAttestationV1(
  value: CheckpointAttestationV1,
): void {
  validateHeader(
    value.discriminator,
    CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
    value.accountVersion,
    RELEASE1_ACCOUNT_VERSION_V1,
    value.initialized,
    value.reserved,
    CHECKPOINT_ATTESTATION_V1_RESERVED_LEN,
    "CheckpointAttestationV1",
  );
  requireU8(value.bump, "bump");
  enumValue(value.phase, CHECKPOINT_PHASE_VALUES, "StateCheckpointPhaseV1");
  requireNondefaultKeys([
    ["controllerProgram", value.controllerProgram],
    ["controllerConfig", value.controllerConfig],
    ["checkpoint", value.checkpoint],
    ["subject", value.subject],
    ["council", value.council],
    ["seatAuthority", value.seatAuthority],
  ]);
  requireU64(value.councilVersion, "councilVersion");
  requireU64(value.gateEpoch, "gateEpoch");
  requireU8(value.seatIndex, "seatIndex");
  requireU64(value.attestedSlot, "attestedSlot");
  if (
    isZero32(value.subjectDigest) ||
    isZero32(value.checkpointDigest) ||
    value.councilVersion === 0n ||
    isZero32(value.councilHash) ||
    value.gateEpoch === 0n ||
    value.seatIndex >= 5 ||
    value.attestedSlot === 0n ||
    isZero32(value.attestationDigest)
  ) {
    throw new Error("invalid CheckpointAttestationV1 commitment");
  }
}

export function serializeCheckpointAttestationV1(
  value: CheckpointAttestationV1,
): Buffer {
  validateCheckpointAttestationV1(value);
  return new Writer()
    .bytes(value.discriminator, 8, "discriminator")
    .u8(value.accountVersion, "accountVersion")
    .u8(value.bump, "bump")
    .bool(value.initialized, "initialized")
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.checkpoint)
    .key(value.subject)
    .bytes(value.subjectDigest, 32, "subjectDigest")
    .u8(value.phase, "phase")
    .bytes(value.checkpointDigest, 32, "checkpointDigest")
    .key(value.council)
    .u64(value.councilVersion, "councilVersion")
    .bytes(value.councilHash, 32, "councilHash")
    .u64(value.gateEpoch, "gateEpoch")
    .u8(value.seatIndex, "seatIndex")
    .key(value.seatAuthority)
    .u64(value.attestedSlot, "attestedSlot")
    .bytes(value.attestationDigest, 32, "attestationDigest")
    .bytes(value.reserved, CHECKPOINT_ATTESTATION_V1_RESERVED_LEN, "reserved")
    .finish(CHECKPOINT_ATTESTATION_V1_LEN, "CheckpointAttestationV1");
}

export function deserializeCheckpointAttestationV1(
  bytes: Uint8Array,
): CheckpointAttestationV1 {
  const reader = new Reader(
    bytes,
    CHECKPOINT_ATTESTATION_V1_LEN,
    "CheckpointAttestationV1",
  );
  const value: CheckpointAttestationV1 = {
    discriminator: reader.bytes(8),
    accountVersion: reader.u8(),
    bump: reader.u8(),
    initialized: reader.bool("initialized"),
    controllerProgram: reader.key(),
    controllerConfig: reader.key(),
    checkpoint: reader.key(),
    subject: reader.key(),
    subjectDigest: reader.bytes(32),
    phase: reader.enum(CHECKPOINT_PHASE_VALUES, "StateCheckpointPhaseV1"),
    checkpointDigest: reader.bytes(32),
    council: reader.key(),
    councilVersion: reader.u64(),
    councilHash: reader.bytes(32),
    gateEpoch: reader.u64(),
    seatIndex: reader.u8(),
    seatAuthority: reader.key(),
    attestedSlot: reader.u64(),
    attestationDigest: reader.bytes(32),
    reserved: reader.bytes(CHECKPOINT_ATTESTATION_V1_RESERVED_LEN),
  };
  reader.end("CheckpointAttestationV1");
  validateCheckpointAttestationV1(value);
  return value;
}

export function canonicalProposalDigestMaterialV2(value: UpgradeProposalV2): Buffer {
  optionalPublicKeyBytes(value.primaryProposal, "primaryProposal");
  optionalPublicKeyBytes(value.rollbackProposal, "rollbackProposal");
  optionalPublicKeyBytes(value.rollbackBuffer, "rollbackBuffer");
  const writer = new Writer();
  writer
    .u8(value.proposalClass, "proposalClass")
    .u8(value.creationGateStatus, "creationGateStatus")
    .bool(value.zeroTailRequired, "zeroTailRequired")
    .u8(value.proposalFlags, "proposalFlags")
    .u64(value.proposalId, "proposalId")
    .u64(value.targetNonce, "targetNonce")
    .u64(value.creationSlot, "creationSlot")
    .bytes(value.clusterDomain, 32, "clusterDomain")
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .u64(value.policyVersion, "policyVersion")
    .bytes(value.policyHash, 32, "policyHash")
    .u64(value.creationCouncilVersion, "creationCouncilVersion")
    .bytes(value.creationCouncilHash, 32, "creationCouncilHash")
    .u64(value.creationGateEpoch, "creationGateEpoch")
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.upgradeableLoader)
    .key(value.authorityPda)
    .key(value.canonicalSpillTreasury)
    .key(value.bufferPubkey)
    .key(value.bufferLoaderOwner)
    .key(value.bufferUploaderAuthority)
    .key(value.bufferFinalAuthority)
    .key(value.bufferVerification)
    .key(value.programdataVerification)
    .u64(value.artifactLength, "artifactLength")
    .bytes(value.artifactSha256, 32, "artifactSha256")
    .bytes(value.artifactChunkMerkleRoot, 32, "artifactChunkMerkleRoot")
    .bytes(value.chunkHashDomain, 32, "chunkHashDomain")
    .u32(value.chunkSize, "chunkSize")
    .u32(value.chunkCount, "chunkCount")
    .bytes(value.sourceCommitHash, 32, "sourceCommitHash")
    .bytes(value.sourceTreeHash, 32, "sourceTreeHash")
    .bytes(value.buildInputInventoryHash, 32, "buildInputInventoryHash")
    .bytes(value.reproducibleBuildReceiptHash, 32, "reproducibleBuildReceiptHash")
    .bytes(value.packageReceiptHash, 32, "packageReceiptHash")
    .bytes(value.releaseIntentHash, 32, "releaseIntentHash")
    .bytes(value.expectedExecutionPrePayloadHash, 32, "expectedExecutionPrePayloadHash")
    .bytes(value.expectedExecutionPreChunkRoot, 32, "expectedExecutionPreChunkRoot")
    .bytes(value.currentRawProgramdataHash, 32, "currentRawProgramdataHash")
    .u64(value.deployedSlot, "deployedSlot")
    .u64(value.currentCapacity, "currentCapacity")
    .u64(value.extensionDelta, "extensionDelta")
    .u64(value.expectedPostCapacity, "expectedPostCapacity")
    .key(value.prestateCheckpoint)
    .key(value.requiredPoststateCheckpoint)
    .bytes(value.checkpointSchemaId, 32, "checkpointSchemaId")
    .bytes(value.checkpointPolicyHash, 32, "checkpointPolicyHash")
    .optionalKey(value.primaryProposal, "primaryProposal")
    .optionalKey(value.rollbackProposal, "rollbackProposal")
    .optionalKey(value.rollbackBuffer, "rollbackBuffer")
    .bytes(value.rollbackArtifactSha256, 32, "rollbackArtifactSha256")
    .bytes(value.rollbackArtifactChunkRoot, 32, "rollbackArtifactChunkRoot")
    .u8(value.voteRequirement, "voteRequirement")
    .key(value.voteProgram)
    .key(value.voteResultPda)
    .u64(value.reviewStartSlot, "reviewStartSlot")
    .u64(value.reviewEndSlot, "reviewEndSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot");
  return writer.finish(PROPOSAL_DIGEST_MATERIAL_LEN_V2, "proposal digest material V2");
}

export function proposalDigestV2(value: UpgradeProposalV2): Buffer {
  return sha256(PROPOSAL_DIGEST_DOMAIN_V2, canonicalProposalDigestMaterialV2(value));
}

export function validateProposalDigestV2(value: UpgradeProposalV2): void {
  validateUpgradeProposalV2(value);
  if (!proposalDigestV2(value).equals(value.proposalDigest)) {
    throw new Error("UpgradeProposalV2 digest mismatch");
  }
}

export function canonicalStateCheckpointDigestMaterialV1(
  value: StateCheckpointV1,
): Buffer {
  const writer = new Writer();
  writer
    .u8(value.phase, "phase")
    .key(value.controllerConfig)
    .key(value.proposal)
    .key(value.emergencyResolution)
    .bytes(value.subjectDigest, 32, "subjectDigest")
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .u64(value.finalizedObservationSlot, "finalizedObservationSlot")
    .u64(value.gateEpoch, "gateEpoch")
    .u64(value.targetProgramdataSlot, "targetProgramdataSlot")
    .bytes(value.targetPayloadCommitment, 32, "targetPayloadCommitment")
    .bytes(value.targetRawProgramdataCommitment, 32, "targetRawProgramdataCommitment")
    .u64(value.targetCapacity, "targetCapacity")
    .bytes(value.programOwnedStateRoot, 32, "programOwnedStateRoot")
    .u64(value.programOwnedStateCount, "programOwnedStateCount")
    .bytes(value.logicalCompressedStateRoot, 32, "logicalCompressedStateRoot")
    .u64(value.logicalCompressedStateCount, "logicalCompressedStateCount")
    .bytes(value.semanticCustodyAccountingRoot, 32, "semanticCustodyAccountingRoot")
    .bytes(value.hardCombinedRoot, 32, "hardCombinedRoot")
    .bytes(value.externalMetadataObservationRoot, 32, "externalMetadataObservationRoot")
    .bytes(value.externalRawBalanceObservationRoot, 32, "externalRawBalanceObservationRoot")
    .bytes(value.schemaIdentifier, 32, "schemaIdentifier")
    .bytes(value.admittedPositiveDonationRoot, 32, "admittedPositiveDonationRoot")
    .u64(value.admittedPositiveDonationCount, "admittedPositiveDonationCount")
    .u32(value.forbiddenDriftCount, "forbiddenDriftCount");
  return writer.finish(
    STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1,
    "state checkpoint digest material V1",
  );
}

export function canonicalStateCheckpointHardRootMaterialV1(
  value: StateCheckpointV1,
): Buffer {
  return new Writer()
    .bytes(value.schemaIdentifier, 32, "schemaIdentifier")
    .bytes(value.programOwnedStateRoot, 32, "programOwnedStateRoot")
    .u64(value.programOwnedStateCount, "programOwnedStateCount")
    .bytes(value.logicalCompressedStateRoot, 32, "logicalCompressedStateRoot")
    .u64(value.logicalCompressedStateCount, "logicalCompressedStateCount")
    .bytes(value.semanticCustodyAccountingRoot, 32, "semanticCustodyAccountingRoot")
    .bytes(value.externalMetadataObservationRoot, 32, "externalMetadataObservationRoot")
    .finish(
      STATE_CHECKPOINT_HARD_ROOT_MATERIAL_LEN_V1,
      "StateCheckpointV1 hard combined root material",
    );
}

export function stateCheckpointHardCombinedRootV1(
  value: StateCheckpointV1,
): Buffer {
  return sha256(
    STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1,
    canonicalStateCheckpointHardRootMaterialV1(value),
  );
}

export function validateStateCheckpointHardCombinedRootV1(
  value: StateCheckpointV1,
): void {
  if (!stateCheckpointHardCombinedRootV1(value).equals(value.hardCombinedRoot)) {
    throw new Error("StateCheckpointV1 hard combined root mismatch");
  }
}

export function stateCheckpointDigestV1(value: StateCheckpointV1): Buffer {
  return sha256(
    STATE_CHECKPOINT_DIGEST_DOMAIN_V1,
    canonicalStateCheckpointDigestMaterialV1(value),
  );
}

export function validateStateCheckpointDigestV1(value: StateCheckpointV1): void {
  validateStateCheckpointV1(value);
  if (!stateCheckpointDigestV1(value).equals(value.checkpointDigest)) {
    throw new Error("StateCheckpointV1 digest mismatch");
  }
}

export function canonicalCouncilRotationDigestMaterialV1(
  value: CouncilRotationProposalV1,
): Buffer {
  const writer = new Writer();
  writer
    .key(value.controllerConfig)
    .key(value.targetProgram)
    .key(value.currentCouncil)
    .u64(value.currentCouncilVersion, "currentCouncilVersion")
    .bytes(value.currentCouncilHash, 32, "currentCouncilHash")
    .key(value.candidateCouncil)
    .u64(value.candidateCouncilVersion, "candidateCouncilVersion")
    .bytes(value.candidateCouncilHash, 32, "candidateCouncilHash")
    .u64(value.creationSlot, "creationSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot")
    .u64(value.targetNonce, "targetNonce");
  return writer.finish(
    COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1,
    "council rotation digest material V1",
  );
}

export function councilRotationDigestV1(value: CouncilRotationProposalV1): Buffer {
  return sha256(
    COUNCIL_ROTATION_DIGEST_DOMAIN_V1,
    canonicalCouncilRotationDigestMaterialV1(value),
  );
}

export function validateCouncilRotationDigestV1(value: CouncilRotationProposalV1): void {
  validateCouncilRotationProposalV1(value);
  if (!councilRotationDigestV1(value).equals(value.rotationDigest)) {
    throw new Error("CouncilRotationProposalV1 digest mismatch");
  }
}

export function canonicalEmergencyResolutionDigestMaterialV1(
  value: EmergencyFreezeResolutionV1,
): Buffer {
  const writer = new Writer();
  writer
    .u8(value.resolutionKind, "resolutionKind")
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.emergencyFreezeObservation)
    .u64(value.frozenEpoch, "frozenEpoch")
    .u64(value.freezeSlot, "freezeSlot")
    .u16(value.freezeReasonCode, "freezeReasonCode")
    .u64(value.creationSlot, "creationSlot")
    .u64(value.notBeforeSlot, "notBeforeSlot")
    .u64(value.expirySlot, "expirySlot")
    .u64(value.targetNonce, "targetNonce")
    .key(value.observedProgramOwner)
    .bool(value.observedProgramExecutable, "observedProgramExecutable")
    .u64(value.observedProgramDataLength, "observedProgramDataLength")
    .bool(value.observedProgramHeaderPresent, "observedProgramHeaderPresent")
    .optionalKey(value.observedLinkedProgramdata, "observedLinkedProgramdata")
    .key(value.observedProgramdataOwner)
    .bool(value.observedProgramdataExecutable, "observedProgramdataExecutable")
    .u64(value.observedProgramdataDataLength, "observedProgramdataDataLength")
    .bool(value.observedProgramdataHeaderPresent, "observedProgramdataHeaderPresent")
    .u64(value.observedProgramdataSlot, "observedProgramdataSlot")
    .bool(value.observedRawHashComplete, "observedRawHashComplete")
    .bytes(value.observedRawProgramdataHash, 32, "observedRawProgramdataHash")
    .u64(value.observedCapacity, "observedCapacity")
    .optionalKey(value.observedAuthority, "observedAuthority")
    .key(value.emergencyCheckpoint);
  return writer.finish(
    EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1,
    "emergency resolution digest material V1",
  );
}

export function emergencyResolutionDigestV1(value: EmergencyFreezeResolutionV1): Buffer {
  return sha256(
    EMERGENCY_RESOLUTION_DIGEST_DOMAIN_V1,
    canonicalEmergencyResolutionDigestMaterialV1(value),
  );
}

export function validateEmergencyResolutionDigestV1(
  value: EmergencyFreezeResolutionV1,
): void {
  validateEmergencyFreezeResolutionV1(value);
  if (!emergencyResolutionDigestV1(value).equals(value.resolutionDigest)) {
    throw new Error("EmergencyFreezeResolutionV1 digest mismatch");
  }
}

export function canonicalEmergencyFreezeObservationDigestMaterialV1(
  value: EmergencyFreezeObservationV1,
): Buffer {
  return new Writer()
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .key(value.upgradeableLoader)
    .key(value.controllerAuthority)
    .u64(value.frozenEpoch, "frozenEpoch")
    .u64(value.freezeSlot, "freezeSlot")
    .u16(value.freezeReasonCode, "freezeReasonCode")
    .key(value.actualProgramOwner)
    .bool(value.actualProgramExecutable, "actualProgramExecutable")
    .u64(value.actualProgramDataLength, "actualProgramDataLength")
    .bool(value.programHeaderPresent, "programHeaderPresent")
    .optionalKey(value.actualLinkedProgramdata, "actualLinkedProgramdata")
    .key(value.actualProgramdataOwner)
    .bool(value.actualProgramdataExecutable, "actualProgramdataExecutable")
    .u64(value.actualProgramdataDataLength, "actualProgramdataDataLength")
    .bool(value.programdataHeaderPresent, "programdataHeaderPresent")
    .u64(value.deployedProgramdataSlot, "deployedProgramdataSlot")
    .bool(value.rawHashComplete, "rawHashComplete")
    .bytes(value.rawProgramdataSha256, 32, "rawProgramdataSha256")
    .u64(value.capacity, "capacity")
    .optionalKey(value.observedAuthority, "observedAuthority")
    .bool(value.finalized, "finalized")
    .u64(value.finalizedSlot, "finalizedSlot")
    .finish(
      EMERGENCY_FREEZE_OBSERVATION_DIGEST_MATERIAL_LEN_V1,
      "EmergencyFreezeObservationV1 digest material",
    );
}

export function emergencyFreezeObservationDigestV1(
  value: EmergencyFreezeObservationV1,
): Buffer {
  return sha256(
    EMERGENCY_FREEZE_OBSERVATION_DIGEST_DOMAIN_V1,
    canonicalEmergencyFreezeObservationDigestMaterialV1(value),
  );
}

export function validateEmergencyFreezeObservationDigestV1(
  value: EmergencyFreezeObservationV1,
): void {
  validateEmergencyFreezeObservationV1(value);
  if (!emergencyFreezeObservationDigestV1(value).equals(value.observationDigest)) {
    throw new Error("EmergencyFreezeObservationV1 digest mismatch");
  }
}

export function canonicalProgramDataFailureObservationDigestMaterialV1(
  value: ProgramDataFailureObservationV1,
): Buffer {
  return new Writer()
    .key(value.controllerConfig)
    .key(value.protocolGate)
    .key(value.primaryProposal)
    .key(value.targetProgram)
    .key(value.targetProgramdata)
    .u64(value.frozenEpoch, "frozenEpoch")
    .key(value.actualProgramOwner)
    .bool(value.actualProgramExecutable, "actualProgramExecutable")
    .u64(value.actualProgramDataLength, "actualProgramDataLength")
    .bool(value.programHeaderPresent, "programHeaderPresent")
    .optionalKey(value.actualLinkedProgramdata, "actualLinkedProgramdata")
    .bool(value.rawHashComplete, "rawHashComplete")
    .bytes(value.actualRawProgramdataSha256, 32, "actualRawProgramdataSha256")
    .key(value.actualOwner)
    .bool(value.actualExecutable, "actualExecutable")
    .u64(value.actualDataLength, "actualDataLength")
    .bool(value.programdataHeaderPresent, "programdataHeaderPresent")
    .u64(value.actualProgramdataSlot, "actualProgramdataSlot")
    .u64(value.actualCapacity, "actualCapacity")
    .optionalKey(value.actualAuthority, "actualAuthority")
    .u8(value.mismatchClass, "mismatchClass")
    .u32(value.failingChunkIndex, "failingChunkIndex")
    .bytes(value.expectedLeafHash, 32, "expectedLeafHash")
    .bytes(value.actualLeafHash, 32, "actualLeafHash")
    .u64(value.finalizedSlot, "finalizedSlot")
    .finish(
      PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_MATERIAL_LEN_V1,
      "ProgramDataFailureObservationV1 digest material",
    );
}

export function programDataFailureObservationDigestV1(
  value: ProgramDataFailureObservationV1,
): Buffer {
  return sha256(
    PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_DOMAIN_V1,
    canonicalProgramDataFailureObservationDigestMaterialV1(value),
  );
}

export function validateProgramDataFailureObservationDigestV1(
  value: ProgramDataFailureObservationV1,
): void {
  validateProgramDataFailureObservationV1(value);
  if (!programDataFailureObservationDigestV1(value).equals(value.observationDigest)) {
    throw new Error("ProgramDataFailureObservationV1 digest mismatch");
  }
}

export function canonicalCheckpointAttestationDigestMaterialV1(
  value: CheckpointAttestationV1,
): Buffer {
  return new Writer()
    .key(value.controllerProgram)
    .key(value.controllerConfig)
    .key(value.checkpoint)
    .key(value.subject)
    .bytes(value.subjectDigest, 32, "subjectDigest")
    .u8(value.phase, "phase")
    .bytes(value.checkpointDigest, 32, "checkpointDigest")
    .key(value.council)
    .u64(value.councilVersion, "councilVersion")
    .bytes(value.councilHash, 32, "councilHash")
    .u64(value.gateEpoch, "gateEpoch")
    .u8(value.seatIndex, "seatIndex")
    .key(value.seatAuthority)
    .u64(value.attestedSlot, "attestedSlot")
    .finish(
      CHECKPOINT_ATTESTATION_DIGEST_MATERIAL_LEN_V1,
      "CheckpointAttestationV1 digest material",
    );
}

export function checkpointAttestationDigestV1(
  value: CheckpointAttestationV1,
): Buffer {
  return sha256(
    CHECKPOINT_ATTESTATION_DIGEST_DOMAIN_V1,
    canonicalCheckpointAttestationDigestMaterialV1(value),
  );
}

export function validateCheckpointAttestationDigestV1(
  value: CheckpointAttestationV1,
): void {
  validateCheckpointAttestationV1(value);
  if (!checkpointAttestationDigestV1(value).equals(value.attestationDigest)) {
    throw new Error("CheckpointAttestationV1 digest mismatch");
  }
}

const PROGRAMDATA_CHECK_SEED = Buffer.from("programdata-check", "ascii");
const CHECKPOINT_SEED = Buffer.from("checkpoint", "ascii");
const BUFFER_CHECK_SEED = Buffer.from("buffer-check", "ascii");
const EMERGENCY_RESOLUTION_SEED = Buffer.from("emergency-resolution", "ascii");
const EMERGENCY_CHECKPOINT_SEED = Buffer.from("emergency-checkpoint", "ascii");
const COUNCIL_ROTATION_SEED = Buffer.from("council-rotation", "ascii");
const EMERGENCY_FREEZE_OBSERVATION_SEED = Buffer.from(
  "emergency-observation",
  "ascii",
);
const PROGRAMDATA_FAILURE_OBSERVATION_SEED = Buffer.from(
  "programdata-failure",
  "ascii",
);
const CHECKPOINT_ATTESTATION_SEED = Buffer.from("checkpoint-attestation", "ascii");

function u64Seed(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(requireU64(value, "PDA numeric seed"));
  return out;
}

function derivePda(programId: PublicKey, seeds: readonly Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([...seeds], programId);
}

export function deriveBufferVerificationPdaV1(
  controllerProgram: PublicKey,
  proposal: PublicKey,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    BUFFER_CHECK_SEED,
    proposal.toBuffer(),
  ]);
}

export function deriveProgramdataCheckPda(
  controllerProgram: PublicKey,
  proposal: PublicKey,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    PROGRAMDATA_CHECK_SEED,
    proposal.toBuffer(),
  ]);
}

export const deriveProgramDataVerificationPdaV1 = deriveProgramdataCheckPda;

export function deriveRelease1CheckpointPda(
  controllerProgram: PublicKey,
  proposal: PublicKey,
  phase: typeof StateCheckpointPhaseV1.Prestate | typeof StateCheckpointPhaseV1.Poststate,
): [PublicKey, number] {
  enumValue(
    phase,
    [StateCheckpointPhaseV1.Prestate, StateCheckpointPhaseV1.Poststate],
    "CheckpointPhaseV1",
  );
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    CHECKPOINT_SEED,
    proposal.toBuffer(),
    Buffer.from([phase]),
  ]);
}

export function deriveEmergencyResolutionPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  frozenEpoch: bigint,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    EMERGENCY_RESOLUTION_SEED,
    targetProgram.toBuffer(),
    u64Seed(frozenEpoch),
  ]);
}

export function deriveEmergencyCheckpointPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  frozenEpoch: bigint,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    EMERGENCY_CHECKPOINT_SEED,
    targetProgram.toBuffer(),
    u64Seed(frozenEpoch),
  ]);
}

export function deriveCouncilRotationPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  candidateCouncilVersion: bigint,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    COUNCIL_ROTATION_SEED,
    targetProgram.toBuffer(),
    u64Seed(candidateCouncilVersion),
  ]);
}

export function deriveEmergencyFreezeObservationPda(
  controllerProgram: PublicKey,
  targetProgram: PublicKey,
  frozenEpoch: bigint,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    EMERGENCY_FREEZE_OBSERVATION_SEED,
    targetProgram.toBuffer(),
    u64Seed(frozenEpoch),
  ]);
}

export function deriveProgramDataFailureObservationPda(
  controllerProgram: PublicKey,
  primaryProposal: PublicKey,
  frozenEpoch: bigint,
): [PublicKey, number] {
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    PROGRAMDATA_FAILURE_OBSERVATION_SEED,
    primaryProposal.toBuffer(),
    u64Seed(frozenEpoch),
  ]);
}

export function deriveCheckpointAttestationPda(
  controllerProgram: PublicKey,
  checkpoint: PublicKey,
  councilVersion: bigint,
  seatIndex: number,
): [PublicKey, number] {
  requireU8(seatIndex, "seatIndex");
  if (seatIndex >= 5) {
    throw new RangeError("seatIndex must identify one of the five council seats");
  }
  return derivePda(controllerProgram, [
    UPGRADE_SEED_DOMAIN_V1,
    CHECKPOINT_ATTESTATION_SEED,
    checkpoint.toBuffer(),
    u64Seed(councilVersion),
    Buffer.from([seatIndex]),
  ]);
}

export const RELEASE1_FIXED_CHUNK_SIZE = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
