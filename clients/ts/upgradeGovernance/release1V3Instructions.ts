import { PublicKey, type AccountMeta, type TransactionInstruction } from "@solana/web3.js";
import { MAX_ARTIFACT_BYTES_V1 } from "./artifactMerkleV1.js";
import {
  EmergencyFreezeResolutionKindV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
  type EmergencyFreezeResolutionKindV1 as EmergencyResolutionKind,
  type EmergencyFreezeResolutionStateV1 as EmergencyResolutionState,
  type GateStatusV1 as GateStatus,
  type ProposalClassV1 as ProposalClass,
  type ProposalStateV2 as ProposalState,
  type StateCheckpointPhaseV1 as CheckpointPhase,
} from "./release1.js";
import { MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 } from "./release1Ceremony.js";
import {
  type CeremonyEnvelopeV1,
  type OptionalPublicKeyV1,
  FixedReader,
  FixedWriter,
  U32_MAX,
  U64_MAX,
  decodeFixed,
  encodeFixed,
  enumByte,
  exactBytes,
  fixedInstruction,
  nondefaultKey,
  nonzeroHash,
  readCeremonyEnvelope,
  readOptionalKey,
  ro,
  rs,
  rw,
  writeCeremonyEnvelope,
  writeOptionalKey,
  ws,
} from "./release1FixedWire.js";

export const INITIALIZE_CONTROLLER_V2_TAG = 53;
export const CREATE_PROPOSAL_V3_TAG = 54;
export const APPROVE_PROPOSAL_V3_TAG = 55;
export const FINALIZE_GOVERNANCE_V3_TAG = 56;
export const QUEUE_PROPOSAL_V3_TAG = 57;
export const FREEZE_PROPOSAL_V3_TAG = 58;
export const CANCEL_PROPOSAL_V3_TAG = 59;
export const EXPIRE_PROPOSAL_V3_TAG = 60;
export const GUARDIAN_FREEZE_V2_TAG = 61;
export const CREATE_EMERGENCY_RESOLUTION_V2_TAG = 62;
export const APPROVE_EMERGENCY_RESOLUTION_V2_TAG = 63;
export const QUEUE_EMERGENCY_RESOLUTION_V2_TAG = 64;
export const EXECUTE_EMERGENCY_RESOLUTION_V2_TAG = 65;
export const EXPIRE_EMERGENCY_RESOLUTION_V2_TAG = 66;
export const CREATE_CHECKPOINT_V2_TAG = 67;
export const RECAST_CHECKPOINT_V2_TAG = 68;
export const FINALIZE_CHECKPOINT_V2_TAG = 69;
export const BIND_PROGRAMDATA_VERIFICATION_V2_TAG = 70;
export const FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG = 71;
export const OBSERVE_PROGRAMDATA_FAILURE_V2_TAG = 72;
export const APPROVE_UNFREEZE_V2_TAG = 73;
export const EXECUTE_UNFREEZE_V2_TAG = 74;

export const INITIALIZE_CONTROLLER_V2_LEN = 633;
export const CREATE_PROPOSAL_V3_LEN = 694;
export const APPROVE_PROPOSAL_V3_LEN = 165;
export const FINALIZE_GOVERNANCE_V3_LEN = 125;
export const QUEUE_PROPOSAL_V3_LEN = 123;
export const FREEZE_PROPOSAL_V3_LEN = 131;
export const CANCEL_PROPOSAL_V3_LEN = 167;
export const EXPIRE_PROPOSAL_V3_LEN = 123;
export const GUARDIAN_FREEZE_V2_LEN = 99;
export const CREATE_EMERGENCY_RESOLUTION_V2_LEN = 250;
export const APPROVE_EMERGENCY_RESOLUTION_V2_LEN = 229;
export const QUEUE_EMERGENCY_RESOLUTION_V2_LEN = 227;
export const EXECUTE_EMERGENCY_RESOLUTION_V2_LEN = 305;
export const EXPIRE_EMERGENCY_RESOLUTION_V2_LEN = 227;
export const CREATE_CHECKPOINT_V2_LEN = 591;
export const RECAST_CHECKPOINT_V2_LEN = 591;
export const FINALIZE_CHECKPOINT_V2_LEN = 558;
export const BIND_PROGRAMDATA_VERIFICATION_V2_LEN = 251;
export const FINALIZE_PROGRAMDATA_VERIFICATION_V2_LEN = 242;
export const OBSERVE_PROGRAMDATA_FAILURE_V2_LEN = 473;
export const APPROVE_UNFREEZE_V2_LEN = 323;
export const EXECUTE_UNFREEZE_V2_LEN = 433;

export const SEAT_TERM_V2_LEN = 16;
export const CAPACITY_POLICY_INPUT_V1_LEN = 32;
export const CONTROLLER_RELEASE_INPUT_V1_LEN = 328;
export const PROPOSAL_MANIFEST_V3_LEN = 693;
export const GUARDIAN_FREEZE_MANIFEST_V2_LEN = 98;
export const EMERGENCY_RESOLUTION_MANIFEST_V2_LEN = 249;
export const CHECKPOINT_MANIFEST_V2_LEN = 557;
export const CHECKPOINT_ATTESTATION_GUARD_V2_LEN = 590;
export const PROPOSAL_GUARD_V3_LEN = 122;
export const EMERGENCY_RESOLUTION_GUARD_V2_LEN = 226;
export const PROGRAMDATA_VERIFICATION_MANIFEST_V2_LEN = 250;
export const PROGRAMDATA_VERIFICATION_GUARD_V2_LEN = 241;
export const PROGRAMDATA_FAILURE_PROOF_V2_LEN = 225;
export const PROGRAMDATA_FAILURE_WITNESS_V2_LEN = 472;
export const UNFREEZE_GUARD_V2_LEN = 322;
export const MAX_ARTIFACT_PROOF_DEPTH_V1 = 7;
export const NO_FAILING_CHUNK_INDEX_V1 = U32_MAX;
export const RELEASE1_APPROVAL_THRESHOLD = 3;
export const BOOTSTRAP_INITIAL_SEAT_TERM_END_V2 = U64_MAX;
export const BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 = 1;

export const ProgramDataVerificationStatusV2 = Object.freeze({ ObservationBound: 0, Verified: 1 } as const);
export type ProgramDataVerificationStatusV2 = (typeof ProgramDataVerificationStatusV2)[keyof typeof ProgramDataVerificationStatusV2];
export const ProgramDataMismatchClassV2 = Object.freeze({
  ProgramLinkage: 0, ProgramOwner: 1, ProgramExecutable: 2, ProgramDataOwner: 3,
  ProgramDataExecutable: 4, Header: 5, Authority: 6, CapacityDecrease: 7,
  CapacityAboveRuntimeMaximum: 8, ArtifactLength: 9, ArtifactPayload: 10,
  ZeroTail: 11, ObservationStale: 12, ObservationScheme: 13,
} as const);
export type ProgramDataMismatchClassV2 = (typeof ProgramDataMismatchClassV2)[keyof typeof ProgramDataMismatchClassV2];

type Digest = Buffer;

export interface SeatTermV2 { termStartSlot: bigint; termEndSlot: bigint }
export interface CapacityPolicyInputV1 { expectedPolicyDigest: Digest }
export interface ControllerReleaseInputV1 {
  artifactLength: bigint; artifactSha256: Digest; artifactMerkleRoot: Digest; sourceCommitment: Digest;
  sourceTreeCommitment: Digest; buildInputsCommitment: Digest; toolchainCommitment: Digest;
  packageCommitment: Digest; releaseManifestCommitment: Digest; abiCommitment: Digest; expectedReleaseDigest: Digest;
}
export interface ProposalManifestV3 {
  proposalClass: ProposalClass; expectedProposalId: bigint; expectedTargetNonce: bigint; expectedGateStatus: GateStatus;
  expectedGateEpoch: bigint; expectedCapacityPolicyDigest: Digest; expectedCurrentDeploymentDigest: Digest;
  expectedCurrentDeploymentGeneration: bigint; expectedPolicyVersion: bigint; expectedPolicyHash: Digest;
  expectedCouncilVersion: bigint; expectedCouncilHash: Digest; artifactLength: bigint; artifactSha256: Digest;
  artifactChunkMerkleRoot: Digest; sourceCommitHash: Digest; sourceTreeHash: Digest; buildInputInventoryHash: Digest;
  reproducibleBuildReceiptHash: Digest; packageReceiptHash: Digest; releaseIntentHash: Digest;
  minimumRequiredCapacity: bigint; checkpointSchemaId: Digest; checkpointPolicyHash: Digest;
  primaryProposal: OptionalPublicKeyV1; rollbackProposal: OptionalPublicKeyV1; rollbackBuffer: OptionalPublicKeyV1;
  rollbackArtifactLength: bigint; rollbackArtifactSha256: Digest; rollbackArtifactChunkRoot: Digest; planValidUntilSlot: bigint;
}
export interface GuardianFreezeManifestV2 {
  expectedGateEpoch: bigint; expectedTargetNonce: bigint; expectedCapacityPolicyDigest: Digest;
  expectedCurrentDeploymentDigest: Digest; expectedCurrentDeploymentGeneration: bigint;
  freezeReasonCode: number; planValidUntilSlot: bigint;
}
export interface EmergencyResolutionManifestV2 {
  resolutionKind: EmergencyResolutionKind; expectedGateEpoch: bigint; expectedTargetNonce: bigint;
  expectedCapacityPolicyDigest: Digest; expectedCurrentDeploymentDigest: Digest; expectedCurrentDeploymentGeneration: bigint;
  expectedFreezeObservationDigest: Digest; expectedProgramdataObservationDigest: Digest;
  expectedProgramdataObservationGeneration: bigint; expectedPolicyVersion: bigint; expectedPolicyHash: Digest;
  expectedCouncilVersion: bigint; expectedCouncilHash: Digest; planValidUntilSlot: bigint;
}
export interface CheckpointManifestV2 {
  phase: CheckpointPhase; checkpointGeneration: bigint; previousCheckpointDigest: Digest; expectedSubjectDigest: Digest;
  expectedGateEpoch: bigint; expectedCapacityPolicyDigest: Digest; expectedCurrentDeploymentDigest: Digest;
  expectedCurrentDeploymentGeneration: bigint; expectedObservationDigest: Digest; expectedObservationGeneration: bigint;
  programOwnedStateRoot: Digest; programOwnedStateCount: bigint; logicalCompressedStateRoot: Digest;
  logicalCompressedStateCount: bigint; semanticCustodyAccountingRoot: Digest; hardCombinedRoot: Digest;
  externalMetadataObservationRoot: Digest; externalRawBalanceObservationRoot: Digest; schemaIdentifier: Digest;
  admittedPositiveDonationRoot: Digest; admittedPositiveDonationCount: bigint; forbiddenDriftCount: number;
  expectedCouncilVersion: bigint; expectedCouncilHash: Digest; expectedCheckpointDigest: Digest; planValidUntilSlot: bigint;
}
export interface CheckpointAttestationGuardV2 {
  manifest: CheckpointManifestV2; seatIndex: number; expectedPreviousAttestationDigest: Digest;
}
export interface ProposalGuardV3 {
  expectedProposalDigest: Digest; expectedState: ProposalState; expectedGateStatus: GateStatus; expectedGateEpoch: bigint;
  expectedTargetNonce: bigint; expectedCapacityPolicyDigest: Digest; expectedCurrentDeploymentDigest: Digest;
  expectedCurrentDeploymentGeneration: bigint;
}
export interface EmergencyResolutionGuardV2 {
  expectedResolutionDigest: Digest; expectedState: EmergencyResolutionState; expectedGateStatus: GateStatus;
  expectedGateEpoch: bigint; expectedTargetNonce: bigint; expectedCapacityPolicyDigest: Digest;
  expectedCurrentDeploymentDigest: Digest; expectedCurrentDeploymentGeneration: bigint;
  expectedFreezeObservationDigest: Digest; expectedProgramdataObservationDigest: Digest;
  expectedObservationGeneration: bigint; expectedCheckpointDigest: Digest;
}
export interface ProgramDataVerificationManifestV2 {
  expected: ProposalGuardV3; expectedObservationDigest: Digest; expectedObservationGeneration: bigint;
  expectedObservationRoot: Digest; expectedObservationFinalizedSlot: bigint; verificationGeneration: bigint;
  previousVerificationDigest: Digest; planValidUntilSlot: bigint;
}
export interface ProgramDataFailureProofV2 { proofLen: number; nodes: readonly Digest[] }
export interface ProgramDataFailureWitnessV2 {
  expectedProposal: ProposalGuardV3; expectedVerificationDigest: Digest; expectedVerificationGeneration: bigint;
  expectedObservationGeneration: bigint; expectedObservationStateHash: Digest; mismatchClass: ProgramDataMismatchClassV2;
  failingChunkIndex: number; expectedLeafHash: Digest; proof: ProgramDataFailureProofV2; planValidUntilSlot: bigint;
}
export interface ProgramDataVerificationGuardV2 {
  expectedProposalDigest: Digest; expectedVerificationDigest: Digest; expectedVerificationGeneration: bigint;
  expectedStatus: ProgramDataVerificationStatusV2; expectedGateEpoch: bigint; expectedTargetNonce: bigint;
  expectedCapacityPolicyDigest: Digest; expectedCurrentDeploymentDigest: Digest; expectedCurrentDeploymentGeneration: bigint;
  expectedObservationDigest: Digest; expectedObservationGeneration: bigint; expectedActualCapacity: bigint;
  expectedAuthority: PublicKey;
}
export interface UnfreezeGuardV2 {
  expectedProposalDigest: Digest; expectedCheckpointDigest: Digest; expectedCheckpointGeneration: bigint;
  expectedVerificationDigest: Digest; expectedVerificationGeneration: bigint; expectedOriginalCouncilVersion: bigint;
  expectedOriginalCouncilHash: Digest; expectedCurrentCouncilVersion: bigint; expectedCurrentCouncilHash: Digest;
  expectedGateEpoch: bigint; expectedTargetNonce: bigint; expectedCurrentDeploymentDigest: Digest;
  expectedCurrentDeploymentGeneration: bigint; expectedArtifactSha256: Digest; expectedArtifactMerkleRoot: Digest;
  expectedActualCapacity: bigint; expectedApprovalBitset: number; expectedApprovalCount: number;
}

export interface InitializeControllerV2 {
  clusterDomain: Digest; initialPolicyVersion: bigint; initialCouncilVersion: bigint; nextProposalId: bigint;
  targetNonce: bigint; initialGateEpoch: bigint; policyActivationSlot: bigint; routineDelaySlots: bigint;
  majorDelaySlots: bigint; rollbackDelaySlots: bigint; terminalDelaySlots: bigint; voteReviewSlots: bigint;
  proposalExpirySlots: bigint; expectedPolicyHash: Digest; expectedCouncilHash: Digest;
  seatTerms: readonly SeatTermV2[]; capacityPolicy: CapacityPolicyInputV1; controllerRelease: ControllerReleaseInputV1;
}
export interface CreateProposalV3 { manifest: ProposalManifestV3 }
export interface ApproveProposalV3 { expected: ProposalGuardV3; expectedCreationCouncilVersion: bigint; expectedCreationCouncilHash: Digest; expectedApprovalBitset: number; expectedApprovalCount: number }
export interface FinalizeGovernanceV3 { expected: ProposalGuardV3; expectedApprovalBitset: number; expectedApprovalCount: number }
export interface QueueProposalV3 { expected: ProposalGuardV3 }
export interface FreezeProposalV3 { expected: ProposalGuardV3; expectedNextGateEpoch: bigint }
export interface CancelProposalV3 { expected: ProposalGuardV3; expectedCancellationCouncilVersion: bigint; expectedCancellationCouncilHash: Digest; expectedCancellationApprovalBitset: number; expectedCancellationApprovalCount: number; cancellationReasonCode: number }
export interface ExpireProposalV3 { expected: ProposalGuardV3 }
export interface GuardianFreezeV2 { manifest: GuardianFreezeManifestV2 }
export interface CreateEmergencyResolutionV2 { manifest: EmergencyResolutionManifestV2 }
export interface ApproveEmergencyResolutionV2 { expected: EmergencyResolutionGuardV2; expectedApprovalBitset: number; expectedApprovalCount: number }
export interface QueueEmergencyResolutionV2 { expected: EmergencyResolutionGuardV2 }
export interface ExecuteEmergencyResolutionV2 { expected: EmergencyResolutionGuardV2; envelope: CeremonyEnvelopeV1 }
export interface ExpireEmergencyResolutionV2 { expected: EmergencyResolutionGuardV2 }
export interface CreateCheckpointV2 { attestation: CheckpointAttestationGuardV2 }
export interface RecastCheckpointV2 { attestation: CheckpointAttestationGuardV2 }
export interface FinalizeCheckpointV2 { manifest: CheckpointManifestV2 }
export interface BindProgramDataVerificationV2 { manifest: ProgramDataVerificationManifestV2 }
export interface FinalizeProgramDataVerificationV2 { expected: ProgramDataVerificationGuardV2 }
export interface ObserveProgramDataFailureV2 { witness: ProgramDataFailureWitnessV2 }
export interface ApproveUnfreezeV2 { expected: UnfreezeGuardV2 }
export interface ExecuteUnfreezeV2 { expected: UnfreezeGuardV2; linkedProposal: PublicKey; envelope: CeremonyEnvelopeV1 }

const hash = (value: Digest, field: string): Digest => nonzeroHash(value, field);
const anyHash = (value: Digest, field: string): Digest => exactBytes(value, 32, field);
const isZero = (value: Digest): boolean => exactBytes(value, 32, "digest").equals(Buffer.alloc(32));
const enumValues = (value: object): readonly number[] => Object.values(value) as number[];
const proposalClass = (value: number): ProposalClass => enumByte(value, enumValues(ProposalClassV1), "proposalClass");
const gateStatus = (value: number): GateStatus => enumByte(value, enumValues(GateStatusV1), "gateStatus");
const proposalState = (value: number): ProposalState => enumByte(value, enumValues(ProposalStateV2), "proposalState");
const resolutionKind = (value: number): EmergencyResolutionKind => enumByte(value, enumValues(EmergencyFreezeResolutionKindV1), "resolutionKind");
const resolutionState = (value: number): EmergencyResolutionState => enumByte(value, enumValues(EmergencyFreezeResolutionStateV1), "resolutionState");
const checkpointPhase = (value: number): CheckpointPhase => enumByte(value, enumValues(StateCheckpointPhaseV1), "checkpointPhase");
const verificationStatus = (value: number): ProgramDataVerificationStatusV2 => enumByte(value, enumValues(ProgramDataVerificationStatusV2), "verificationStatus");
const mismatchClass = (value: number): ProgramDataMismatchClassV2 => enumByte(value, enumValues(ProgramDataMismatchClassV2), "mismatchClass");

function validateApproval(bitset: number, count: number): void {
  enumByte(bitset, Array.from({ length: 32 }, (_, index) => index), "approvalBitset");
  enumByte(count, Array.from({ length: 6 }, (_, index) => index), "approvalCount");
  let bits = bitset;
  let popcount = 0;
  while (bits !== 0) { popcount += bits & 1; bits >>>= 1; }
  if (popcount !== count) throw new Error("approval bitset/count mismatch");
}

function writeSeatTerm(w: FixedWriter, value: SeatTermV2): void { w.u64(value.termStartSlot, "termStartSlot").u64(value.termEndSlot, "termEndSlot"); }
function readSeatTerm(r: FixedReader): SeatTermV2 { return { termStartSlot: r.u64(), termEndSlot: r.u64() }; }
function validateSeatTerm(value: SeatTermV2): void {
  if (value.termEndSlot !== BOOTSTRAP_INITIAL_SEAT_TERM_END_V2 || value.termEndSlot <= value.termStartSlot) throw new Error("invalid bootstrap seat term");
}

function writeControllerRelease(w: FixedWriter, v: ControllerReleaseInputV1): void {
  w.u64(v.artifactLength, "artifactLength")
    .bytes(hash(v.artifactSha256, "artifactSha256"), 32, "artifactSha256")
    .bytes(hash(v.artifactMerkleRoot, "artifactMerkleRoot"), 32, "artifactMerkleRoot")
    .bytes(hash(v.sourceCommitment, "sourceCommitment"), 32, "sourceCommitment")
    .bytes(hash(v.sourceTreeCommitment, "sourceTreeCommitment"), 32, "sourceTreeCommitment")
    .bytes(hash(v.buildInputsCommitment, "buildInputsCommitment"), 32, "buildInputsCommitment")
    .bytes(hash(v.toolchainCommitment, "toolchainCommitment"), 32, "toolchainCommitment")
    .bytes(hash(v.packageCommitment, "packageCommitment"), 32, "packageCommitment")
    .bytes(hash(v.releaseManifestCommitment, "releaseManifestCommitment"), 32, "releaseManifestCommitment")
    .bytes(hash(v.abiCommitment, "abiCommitment"), 32, "abiCommitment")
    .bytes(hash(v.expectedReleaseDigest, "expectedReleaseDigest"), 32, "expectedReleaseDigest");
}
function readControllerRelease(r: FixedReader): ControllerReleaseInputV1 {
  return { artifactLength: r.u64(), artifactSha256: r.bytes(32), artifactMerkleRoot: r.bytes(32), sourceCommitment: r.bytes(32), sourceTreeCommitment: r.bytes(32), buildInputsCommitment: r.bytes(32), toolchainCommitment: r.bytes(32), packageCommitment: r.bytes(32), releaseManifestCommitment: r.bytes(32), abiCommitment: r.bytes(32), expectedReleaseDigest: r.bytes(32) };
}
function validateControllerRelease(v: ControllerReleaseInputV1): void {
  [v.artifactSha256, v.artifactMerkleRoot, v.sourceCommitment, v.sourceTreeCommitment, v.buildInputsCommitment, v.toolchainCommitment, v.packageCommitment, v.releaseManifestCommitment, v.abiCommitment, v.expectedReleaseDigest].forEach((x, i) => hash(x, `controllerRelease.hash[${i}]`));
  if (v.artifactLength === 0n || v.artifactLength > BigInt(MAX_ARTIFACT_BYTES_V1)) throw new Error("controller release artifact length is invalid");
}

function validateProposalManifest(v: ProposalManifestV3): void {
  proposalClass(v.proposalClass);
  gateStatus(v.expectedGateStatus);
  [v.expectedCapacityPolicyDigest, v.expectedCurrentDeploymentDigest, v.expectedPolicyHash, v.expectedCouncilHash,
    v.artifactSha256, v.artifactChunkMerkleRoot, v.sourceCommitHash, v.sourceTreeHash, v.buildInputInventoryHash,
    v.reproducibleBuildReceiptHash, v.packageReceiptHash, v.releaseIntentHash, v.checkpointSchemaId,
    v.checkpointPolicyHash].forEach((x, i) => hash(x, `proposalManifest.hash[${i}]`));
  if (v.expectedProposalId === 0n || v.expectedProposalId === U64_MAX || v.expectedTargetNonce === 0n || v.expectedTargetNonce === U64_MAX ||
    (v.expectedGateStatus !== GateStatusV1.Active && v.expectedGateStatus !== GateStatusV1.EmergencyFrozen) ||
    v.expectedGateEpoch === 0n || v.expectedCurrentDeploymentGeneration === 0n || v.expectedPolicyVersion === 0n ||
    v.expectedCouncilVersion === 0n || v.artifactLength === 0n || v.artifactLength > BigInt(MAX_ARTIFACT_BYTES_V1) ||
    v.minimumRequiredCapacity < v.artifactLength || v.minimumRequiredCapacity > MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 ||
    v.planValidUntilSlot === 0n) throw new Error("invalid proposal manifest numeric binding");
  const rollbackPresent = v.rollbackProposal.present;
  const rollbackShape = rollbackPresent === v.rollbackBuffer.present && rollbackPresent === (v.rollbackArtifactLength !== 0n) &&
    rollbackPresent === !isZero(v.rollbackArtifactSha256) && rollbackPresent === !isZero(v.rollbackArtifactChunkRoot);
  if (!rollbackShape || (rollbackPresent && v.rollbackArtifactLength > BigInt(MAX_ARTIFACT_BYTES_V1))) throw new Error("invalid rollback commitment shape");
  if (v.proposalClass === ProposalClassV1.EmergencyRollback) {
    if (!v.primaryProposal.present || rollbackPresent) throw new Error("emergency rollback proposal shape is invalid");
  } else if (v.proposalClass === ProposalClassV1.RoutineUpgrade || v.proposalClass === ProposalClassV1.EconomicChange || v.proposalClass === ProposalClassV1.ConstitutionalChange) {
    if (v.primaryProposal.present || !rollbackPresent) throw new Error("upgrade proposal rollback shape is invalid");
  } else {
    throw new Error("proposal class is non-executable in Release 1");
  }
}

function writeProposalManifest(w: FixedWriter, v: ProposalManifestV3): void {
  validateProposalManifest(v);
  w.byte(proposalClass(v.proposalClass), "proposalClass").u64(v.expectedProposalId, "expectedProposalId")
    .u64(v.expectedTargetNonce, "expectedTargetNonce").byte(gateStatus(v.expectedGateStatus), "expectedGateStatus")
    .u64(v.expectedGateEpoch, "expectedGateEpoch").bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest")
    .bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration")
    .u64(v.expectedPolicyVersion, "expectedPolicyVersion").bytes(v.expectedPolicyHash, 32, "expectedPolicyHash")
    .u64(v.expectedCouncilVersion, "expectedCouncilVersion").bytes(v.expectedCouncilHash, 32, "expectedCouncilHash")
    .u64(v.artifactLength, "artifactLength").bytes(v.artifactSha256, 32, "artifactSha256")
    .bytes(v.artifactChunkMerkleRoot, 32, "artifactChunkMerkleRoot").bytes(v.sourceCommitHash, 32, "sourceCommitHash")
    .bytes(v.sourceTreeHash, 32, "sourceTreeHash").bytes(v.buildInputInventoryHash, 32, "buildInputInventoryHash")
    .bytes(v.reproducibleBuildReceiptHash, 32, "reproducibleBuildReceiptHash").bytes(v.packageReceiptHash, 32, "packageReceiptHash")
    .bytes(v.releaseIntentHash, 32, "releaseIntentHash").u64(v.minimumRequiredCapacity, "minimumRequiredCapacity")
    .bytes(v.checkpointSchemaId, 32, "checkpointSchemaId").bytes(v.checkpointPolicyHash, 32, "checkpointPolicyHash");
  writeOptionalKey(w, v.primaryProposal, "primaryProposal");
  writeOptionalKey(w, v.rollbackProposal, "rollbackProposal");
  writeOptionalKey(w, v.rollbackBuffer, "rollbackBuffer");
  w.u64(v.rollbackArtifactLength, "rollbackArtifactLength").bytes(anyHash(v.rollbackArtifactSha256, "rollbackArtifactSha256"), 32, "rollbackArtifactSha256")
    .bytes(anyHash(v.rollbackArtifactChunkRoot, "rollbackArtifactChunkRoot"), 32, "rollbackArtifactChunkRoot")
    .u64(v.planValidUntilSlot, "planValidUntilSlot");
}

function readProposalManifest(r: FixedReader): ProposalManifestV3 {
  const value: ProposalManifestV3 = {
    proposalClass: proposalClass(r.byte()), expectedProposalId: r.u64(), expectedTargetNonce: r.u64(),
    expectedGateStatus: gateStatus(r.byte()), expectedGateEpoch: r.u64(), expectedCapacityPolicyDigest: r.bytes(32),
    expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedPolicyVersion: r.u64(),
    expectedPolicyHash: r.bytes(32), expectedCouncilVersion: r.u64(), expectedCouncilHash: r.bytes(32), artifactLength: r.u64(),
    artifactSha256: r.bytes(32), artifactChunkMerkleRoot: r.bytes(32), sourceCommitHash: r.bytes(32), sourceTreeHash: r.bytes(32),
    buildInputInventoryHash: r.bytes(32), reproducibleBuildReceiptHash: r.bytes(32), packageReceiptHash: r.bytes(32),
    releaseIntentHash: r.bytes(32), minimumRequiredCapacity: r.u64(), checkpointSchemaId: r.bytes(32), checkpointPolicyHash: r.bytes(32),
    primaryProposal: readOptionalKey(r, "primaryProposal"), rollbackProposal: readOptionalKey(r, "rollbackProposal"),
    rollbackBuffer: readOptionalKey(r, "rollbackBuffer"), rollbackArtifactLength: r.u64(), rollbackArtifactSha256: r.bytes(32),
    rollbackArtifactChunkRoot: r.bytes(32), planValidUntilSlot: r.u64(),
  };
  validateProposalManifest(value);
  return value;
}

function validateGuardianFreezeManifest(v: GuardianFreezeManifestV2): void {
  hash(v.expectedCapacityPolicyDigest, "expectedCapacityPolicyDigest"); hash(v.expectedCurrentDeploymentDigest, "expectedCurrentDeploymentDigest");
  if (v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n || v.expectedCurrentDeploymentGeneration === 0n ||
    v.freezeReasonCode === 0 || v.freezeReasonCode === BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1 || v.planValidUntilSlot === 0n) throw new Error("invalid guardian freeze manifest");
}
function writeGuardianFreezeManifest(w: FixedWriter, v: GuardianFreezeManifestV2): void {
  validateGuardianFreezeManifest(v); w.u64(v.expectedGateEpoch, "expectedGateEpoch").u64(v.expectedTargetNonce, "expectedTargetNonce")
    .bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest").bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration").u16(v.freezeReasonCode, "freezeReasonCode").u64(v.planValidUntilSlot, "planValidUntilSlot");
}
function readGuardianFreezeManifest(r: FixedReader): GuardianFreezeManifestV2 {
  const value = { expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), freezeReasonCode: r.u16(), planValidUntilSlot: r.u64() };
  validateGuardianFreezeManifest(value); return value;
}

function validateEmergencyResolutionManifest(v: EmergencyResolutionManifestV2): void {
  resolutionKind(v.resolutionKind);
  [v.expectedCapacityPolicyDigest, v.expectedCurrentDeploymentDigest, v.expectedFreezeObservationDigest, v.expectedProgramdataObservationDigest, v.expectedPolicyHash, v.expectedCouncilHash].forEach((x, i) => hash(x, `emergencyManifest.hash[${i}]`));
  if (v.resolutionKind !== EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade || v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n ||
    v.expectedCurrentDeploymentGeneration === 0n || v.expectedProgramdataObservationGeneration === 0n || v.expectedPolicyVersion === 0n ||
    v.expectedCouncilVersion === 0n || v.planValidUntilSlot === 0n) throw new Error("invalid emergency resolution manifest");
}
function writeEmergencyResolutionManifest(w: FixedWriter, v: EmergencyResolutionManifestV2): void {
  validateEmergencyResolutionManifest(v); w.byte(resolutionKind(v.resolutionKind), "resolutionKind").u64(v.expectedGateEpoch, "expectedGateEpoch")
    .u64(v.expectedTargetNonce, "expectedTargetNonce").bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest")
    .bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest").u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration")
    .bytes(v.expectedFreezeObservationDigest, 32, "expectedFreezeObservationDigest").bytes(v.expectedProgramdataObservationDigest, 32, "expectedProgramdataObservationDigest")
    .u64(v.expectedProgramdataObservationGeneration, "expectedProgramdataObservationGeneration").u64(v.expectedPolicyVersion, "expectedPolicyVersion")
    .bytes(v.expectedPolicyHash, 32, "expectedPolicyHash").u64(v.expectedCouncilVersion, "expectedCouncilVersion")
    .bytes(v.expectedCouncilHash, 32, "expectedCouncilHash").u64(v.planValidUntilSlot, "planValidUntilSlot");
}
function readEmergencyResolutionManifest(r: FixedReader): EmergencyResolutionManifestV2 {
  const value = { resolutionKind: resolutionKind(r.byte()), expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedFreezeObservationDigest: r.bytes(32), expectedProgramdataObservationDigest: r.bytes(32), expectedProgramdataObservationGeneration: r.u64(), expectedPolicyVersion: r.u64(), expectedPolicyHash: r.bytes(32), expectedCouncilVersion: r.u64(), expectedCouncilHash: r.bytes(32), planValidUntilSlot: r.u64() };
  validateEmergencyResolutionManifest(value); return value;
}

function validateCheckpointManifest(v: CheckpointManifestV2): void {
  checkpointPhase(v.phase);
  [v.expectedSubjectDigest, v.expectedCapacityPolicyDigest, v.expectedCurrentDeploymentDigest, v.expectedObservationDigest,
    v.programOwnedStateRoot, v.logicalCompressedStateRoot, v.semanticCustodyAccountingRoot, v.hardCombinedRoot,
    v.externalMetadataObservationRoot, v.externalRawBalanceObservationRoot, v.schemaIdentifier, v.expectedCouncilHash,
    v.expectedCheckpointDigest].forEach((x, i) => hash(x, `checkpoint.hash[${i}]`));
  if (v.checkpointGeneration === 0n || (v.checkpointGeneration === 1n && !isZero(v.previousCheckpointDigest)) ||
    (v.checkpointGeneration > 1n && isZero(v.previousCheckpointDigest)) || v.expectedGateEpoch === 0n ||
    v.expectedCurrentDeploymentGeneration === 0n || v.expectedObservationGeneration === 0n || v.expectedCouncilVersion === 0n ||
    v.forbiddenDriftCount !== 0 || v.planValidUntilSlot === 0n ||
    (v.admittedPositiveDonationCount === 0n && !isZero(v.admittedPositiveDonationRoot)) ||
    (v.admittedPositiveDonationCount !== 0n && isZero(v.admittedPositiveDonationRoot))) throw new Error("invalid checkpoint manifest");
}
function writeCheckpointManifest(w: FixedWriter, v: CheckpointManifestV2): void {
  validateCheckpointManifest(v); w.byte(checkpointPhase(v.phase), "phase").u64(v.checkpointGeneration, "checkpointGeneration")
    .bytes(anyHash(v.previousCheckpointDigest, "previousCheckpointDigest"), 32, "previousCheckpointDigest")
    .bytes(v.expectedSubjectDigest, 32, "expectedSubjectDigest").u64(v.expectedGateEpoch, "expectedGateEpoch")
    .bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest").bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration").bytes(v.expectedObservationDigest, 32, "expectedObservationDigest")
    .u64(v.expectedObservationGeneration, "expectedObservationGeneration").bytes(v.programOwnedStateRoot, 32, "programOwnedStateRoot")
    .u64(v.programOwnedStateCount, "programOwnedStateCount").bytes(v.logicalCompressedStateRoot, 32, "logicalCompressedStateRoot")
    .u64(v.logicalCompressedStateCount, "logicalCompressedStateCount").bytes(v.semanticCustodyAccountingRoot, 32, "semanticCustodyAccountingRoot")
    .bytes(v.hardCombinedRoot, 32, "hardCombinedRoot").bytes(v.externalMetadataObservationRoot, 32, "externalMetadataObservationRoot")
    .bytes(v.externalRawBalanceObservationRoot, 32, "externalRawBalanceObservationRoot").bytes(v.schemaIdentifier, 32, "schemaIdentifier")
    .bytes(anyHash(v.admittedPositiveDonationRoot, "admittedPositiveDonationRoot"), 32, "admittedPositiveDonationRoot")
    .u64(v.admittedPositiveDonationCount, "admittedPositiveDonationCount").u32(v.forbiddenDriftCount, "forbiddenDriftCount")
    .u64(v.expectedCouncilVersion, "expectedCouncilVersion").bytes(v.expectedCouncilHash, 32, "expectedCouncilHash")
    .bytes(v.expectedCheckpointDigest, 32, "expectedCheckpointDigest").u64(v.planValidUntilSlot, "planValidUntilSlot");
}
function readCheckpointManifest(r: FixedReader): CheckpointManifestV2 {
  const value = { phase: checkpointPhase(r.byte()), checkpointGeneration: r.u64(), previousCheckpointDigest: r.bytes(32), expectedSubjectDigest: r.bytes(32), expectedGateEpoch: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), programOwnedStateRoot: r.bytes(32), programOwnedStateCount: r.u64(), logicalCompressedStateRoot: r.bytes(32), logicalCompressedStateCount: r.u64(), semanticCustodyAccountingRoot: r.bytes(32), hardCombinedRoot: r.bytes(32), externalMetadataObservationRoot: r.bytes(32), externalRawBalanceObservationRoot: r.bytes(32), schemaIdentifier: r.bytes(32), admittedPositiveDonationRoot: r.bytes(32), admittedPositiveDonationCount: r.u64(), forbiddenDriftCount: r.u32(), expectedCouncilVersion: r.u64(), expectedCouncilHash: r.bytes(32), expectedCheckpointDigest: r.bytes(32), planValidUntilSlot: r.u64() };
  validateCheckpointManifest(value); return value;
}

function validateProposalGuard(v: ProposalGuardV3): void {
  hash(v.expectedProposalDigest, "expectedProposalDigest"); proposalState(v.expectedState); gateStatus(v.expectedGateStatus);
  hash(v.expectedCapacityPolicyDigest, "expectedCapacityPolicyDigest"); hash(v.expectedCurrentDeploymentDigest, "expectedCurrentDeploymentDigest");
  if (v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n || v.expectedCurrentDeploymentGeneration === 0n ||
    v.expectedState === ProposalStateV2.TokenReviewOpen) throw new Error("invalid proposal guard");
}
export function writeProposalGuardV3(w: FixedWriter, v: ProposalGuardV3): void {
  validateProposalGuard(v); w.bytes(v.expectedProposalDigest, 32, "expectedProposalDigest").byte(proposalState(v.expectedState), "expectedState")
    .byte(gateStatus(v.expectedGateStatus), "expectedGateStatus").u64(v.expectedGateEpoch, "expectedGateEpoch")
    .u64(v.expectedTargetNonce, "expectedTargetNonce").bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest")
    .bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration");
}
export function readProposalGuardV3(r: FixedReader): ProposalGuardV3 {
  const value = { expectedProposalDigest: r.bytes(32), expectedState: proposalState(r.byte()), expectedGateStatus: gateStatus(r.byte()), expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64() };
  validateProposalGuard(value); return value;
}

function validateEmergencyResolutionGuard(v: EmergencyResolutionGuardV2): void {
  resolutionState(v.expectedState); gateStatus(v.expectedGateStatus);
  [v.expectedResolutionDigest, v.expectedCapacityPolicyDigest, v.expectedCurrentDeploymentDigest, v.expectedFreezeObservationDigest,
    v.expectedProgramdataObservationDigest].forEach((x, i) => hash(x, `emergencyGuard.hash[${i}]`));
  if (v.expectedGateStatus !== GateStatusV1.EmergencyFrozen || v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n ||
    v.expectedCurrentDeploymentGeneration === 0n || v.expectedObservationGeneration === 0n) throw new Error("invalid emergency resolution guard");
}
function writeEmergencyResolutionGuard(w: FixedWriter, v: EmergencyResolutionGuardV2): void {
  validateEmergencyResolutionGuard(v); w.bytes(v.expectedResolutionDigest, 32, "expectedResolutionDigest")
    .byte(resolutionState(v.expectedState), "expectedState").byte(gateStatus(v.expectedGateStatus), "expectedGateStatus")
    .u64(v.expectedGateEpoch, "expectedGateEpoch").u64(v.expectedTargetNonce, "expectedTargetNonce")
    .bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest").bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration")
    .bytes(v.expectedFreezeObservationDigest, 32, "expectedFreezeObservationDigest")
    .bytes(v.expectedProgramdataObservationDigest, 32, "expectedProgramdataObservationDigest")
    .u64(v.expectedObservationGeneration, "expectedObservationGeneration")
    .bytes(anyHash(v.expectedCheckpointDigest, "expectedCheckpointDigest"), 32, "expectedCheckpointDigest");
}
function readEmergencyResolutionGuard(r: FixedReader): EmergencyResolutionGuardV2 {
  const value = { expectedResolutionDigest: r.bytes(32), expectedState: resolutionState(r.byte()), expectedGateStatus: gateStatus(r.byte()), expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedFreezeObservationDigest: r.bytes(32), expectedProgramdataObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), expectedCheckpointDigest: r.bytes(32) };
  validateEmergencyResolutionGuard(value); return value;
}

function validateVerificationManifest(v: ProgramDataVerificationManifestV2): void {
  validateProposalGuard(v.expected); hash(v.expectedObservationDigest, "expectedObservationDigest"); hash(v.expectedObservationRoot, "expectedObservationRoot");
  if (v.expected.expectedState !== ProposalStateV2.UpgradeExecuted || v.expectedObservationGeneration === 0n ||
    v.expectedObservationFinalizedSlot === 0n || v.verificationGeneration === 0n ||
    (v.verificationGeneration === 1n && !isZero(v.previousVerificationDigest)) ||
    (v.verificationGeneration > 1n && isZero(v.previousVerificationDigest)) || v.planValidUntilSlot === 0n) throw new Error("invalid ProgramData verification manifest");
}
function writeVerificationManifest(w: FixedWriter, v: ProgramDataVerificationManifestV2): void {
  validateVerificationManifest(v); writeProposalGuardV3(w, v.expected); w.bytes(v.expectedObservationDigest, 32, "expectedObservationDigest")
    .u64(v.expectedObservationGeneration, "expectedObservationGeneration").bytes(v.expectedObservationRoot, 32, "expectedObservationRoot")
    .u64(v.expectedObservationFinalizedSlot, "expectedObservationFinalizedSlot").u64(v.verificationGeneration, "verificationGeneration")
    .bytes(anyHash(v.previousVerificationDigest, "previousVerificationDigest"), 32, "previousVerificationDigest")
    .u64(v.planValidUntilSlot, "planValidUntilSlot");
}
function readVerificationManifest(r: FixedReader): ProgramDataVerificationManifestV2 {
  const value = { expected: readProposalGuardV3(r), expectedObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), expectedObservationRoot: r.bytes(32), expectedObservationFinalizedSlot: r.u64(), verificationGeneration: r.u64(), previousVerificationDigest: r.bytes(32), planValidUntilSlot: r.u64() };
  validateVerificationManifest(value); return value;
}

function validateFailureProof(v: ProgramDataFailureProofV2): void {
  if (!Number.isSafeInteger(v.proofLen) || v.proofLen < 0 || v.proofLen > MAX_ARTIFACT_PROOF_DEPTH_V1 || v.nodes.length !== MAX_ARTIFACT_PROOF_DEPTH_V1) throw new Error("invalid fixed failure proof geometry");
  v.nodes.forEach((node, index) => anyHash(node, `proof.nodes[${index}]`));
  if (v.nodes.slice(v.proofLen).some((node) => !isZero(node))) throw new Error("failure proof has nonzero padding");
}
function writeFailureProof(w: FixedWriter, v: ProgramDataFailureProofV2): void { validateFailureProof(v); w.byte(v.proofLen, "proofLen"); v.nodes.forEach((node, index) => w.bytes(node, 32, `nodes[${index}]`)); }
function readFailureProof(r: FixedReader): ProgramDataFailureProofV2 { const value = { proofLen: r.byte(), nodes: Array.from({ length: MAX_ARTIFACT_PROOF_DEPTH_V1 }, () => r.bytes(32)) }; validateFailureProof(value); return value; }

function validateFailureWitness(v: ProgramDataFailureWitnessV2): void {
  validateProposalGuard(v.expectedProposal); mismatchClass(v.mismatchClass); validateFailureProof(v.proof);
  const verificationPresent = !isZero(v.expectedVerificationDigest);
  if (v.expectedProposal.expectedState !== ProposalStateV2.UpgradeExecuted || verificationPresent !== (v.expectedVerificationGeneration !== 0n) ||
    v.expectedObservationGeneration === 0n || v.planValidUntilSlot === 0n) throw new Error("invalid ProgramData failure witness binding");
  const proofPresent = v.proof.proofLen !== 0 || v.proof.nodes.some((node) => !isZero(node));
  if (v.mismatchClass === ProgramDataMismatchClassV2.ArtifactPayload) {
    if (v.failingChunkIndex === NO_FAILING_CHUNK_INDEX_V1 || isZero(v.expectedLeafHash) || isZero(v.expectedObservationStateHash)) throw new Error("invalid artifact-payload failure witness");
  } else if (v.mismatchClass === ProgramDataMismatchClassV2.ZeroTail) {
    if (v.failingChunkIndex === NO_FAILING_CHUNK_INDEX_V1 || !isZero(v.expectedLeafHash) || proofPresent || isZero(v.expectedObservationStateHash)) throw new Error("invalid zero-tail failure witness");
  } else if (v.mismatchClass === ProgramDataMismatchClassV2.ObservationStale || v.mismatchClass === ProgramDataMismatchClassV2.ObservationScheme) {
    if (v.failingChunkIndex !== NO_FAILING_CHUNK_INDEX_V1 || !isZero(v.expectedLeafHash) || proofPresent || isZero(v.expectedObservationStateHash)) throw new Error("invalid observation failure witness");
  } else if (v.failingChunkIndex !== NO_FAILING_CHUNK_INDEX_V1 || !isZero(v.expectedLeafHash) || proofPresent) throw new Error("invalid scalar failure witness");
}
function writeFailureWitness(w: FixedWriter, v: ProgramDataFailureWitnessV2): void {
  validateFailureWitness(v); writeProposalGuardV3(w, v.expectedProposal); w.bytes(anyHash(v.expectedVerificationDigest, "expectedVerificationDigest"), 32, "expectedVerificationDigest")
    .u64(v.expectedVerificationGeneration, "expectedVerificationGeneration").u64(v.expectedObservationGeneration, "expectedObservationGeneration")
    .bytes(anyHash(v.expectedObservationStateHash, "expectedObservationStateHash"), 32, "expectedObservationStateHash")
    .byte(mismatchClass(v.mismatchClass), "mismatchClass").u32(v.failingChunkIndex, "failingChunkIndex")
    .bytes(anyHash(v.expectedLeafHash, "expectedLeafHash"), 32, "expectedLeafHash");
  writeFailureProof(w, v.proof); w.u64(v.planValidUntilSlot, "planValidUntilSlot");
}
function readFailureWitness(r: FixedReader): ProgramDataFailureWitnessV2 {
  const value = { expectedProposal: readProposalGuardV3(r), expectedVerificationDigest: r.bytes(32), expectedVerificationGeneration: r.u64(), expectedObservationGeneration: r.u64(), expectedObservationStateHash: r.bytes(32), mismatchClass: mismatchClass(r.byte()), failingChunkIndex: r.u32(), expectedLeafHash: r.bytes(32), proof: readFailureProof(r), planValidUntilSlot: r.u64() };
  validateFailureWitness(value); return value;
}

function validateVerificationGuard(v: ProgramDataVerificationGuardV2): void {
  [v.expectedProposalDigest, v.expectedVerificationDigest, v.expectedCapacityPolicyDigest, v.expectedCurrentDeploymentDigest,
    v.expectedObservationDigest].forEach((x, i) => hash(x, `verificationGuard.hash[${i}]`)); verificationStatus(v.expectedStatus);
  nondefaultKey(v.expectedAuthority, "expectedAuthority");
  if (v.expectedVerificationGeneration === 0n || v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n ||
    v.expectedCurrentDeploymentGeneration === 0n || v.expectedObservationGeneration === 0n || v.expectedActualCapacity === 0n) throw new Error("invalid ProgramData verification guard");
}
function writeVerificationGuard(w: FixedWriter, v: ProgramDataVerificationGuardV2): void {
  validateVerificationGuard(v); w.bytes(v.expectedProposalDigest, 32, "expectedProposalDigest").bytes(v.expectedVerificationDigest, 32, "expectedVerificationDigest")
    .u64(v.expectedVerificationGeneration, "expectedVerificationGeneration").byte(verificationStatus(v.expectedStatus), "expectedStatus")
    .u64(v.expectedGateEpoch, "expectedGateEpoch").u64(v.expectedTargetNonce, "expectedTargetNonce")
    .bytes(v.expectedCapacityPolicyDigest, 32, "expectedCapacityPolicyDigest").bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration").bytes(v.expectedObservationDigest, 32, "expectedObservationDigest")
    .u64(v.expectedObservationGeneration, "expectedObservationGeneration").u64(v.expectedActualCapacity, "expectedActualCapacity")
    .key(v.expectedAuthority, "expectedAuthority");
}
function readVerificationGuard(r: FixedReader): ProgramDataVerificationGuardV2 {
  const value = { expectedProposalDigest: r.bytes(32), expectedVerificationDigest: r.bytes(32), expectedVerificationGeneration: r.u64(), expectedStatus: verificationStatus(r.byte()), expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCapacityPolicyDigest: r.bytes(32), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), expectedActualCapacity: r.u64(), expectedAuthority: r.key() };
  validateVerificationGuard(value); return value;
}

function validateUnfreezeGuard(v: UnfreezeGuardV2): void {
  [v.expectedProposalDigest, v.expectedCheckpointDigest, v.expectedVerificationDigest, v.expectedOriginalCouncilHash,
    v.expectedCurrentCouncilHash, v.expectedCurrentDeploymentDigest, v.expectedArtifactSha256, v.expectedArtifactMerkleRoot]
    .forEach((x, i) => hash(x, `unfreezeGuard.hash[${i}]`)); validateApproval(v.expectedApprovalBitset, v.expectedApprovalCount);
  if (v.expectedCheckpointGeneration === 0n || v.expectedVerificationGeneration === 0n || v.expectedOriginalCouncilVersion === 0n ||
    v.expectedCurrentCouncilVersion === 0n || v.expectedGateEpoch === 0n || v.expectedTargetNonce === 0n ||
    v.expectedCurrentDeploymentGeneration === 0n || v.expectedActualCapacity === 0n || v.expectedApprovalCount > RELEASE1_APPROVAL_THRESHOLD) throw new Error("invalid unfreeze guard");
}
function writeUnfreezeGuard(w: FixedWriter, v: UnfreezeGuardV2): void {
  validateUnfreezeGuard(v); w.bytes(v.expectedProposalDigest, 32, "expectedProposalDigest").bytes(v.expectedCheckpointDigest, 32, "expectedCheckpointDigest")
    .u64(v.expectedCheckpointGeneration, "expectedCheckpointGeneration").bytes(v.expectedVerificationDigest, 32, "expectedVerificationDigest")
    .u64(v.expectedVerificationGeneration, "expectedVerificationGeneration").u64(v.expectedOriginalCouncilVersion, "expectedOriginalCouncilVersion")
    .bytes(v.expectedOriginalCouncilHash, 32, "expectedOriginalCouncilHash").u64(v.expectedCurrentCouncilVersion, "expectedCurrentCouncilVersion")
    .bytes(v.expectedCurrentCouncilHash, 32, "expectedCurrentCouncilHash").u64(v.expectedGateEpoch, "expectedGateEpoch")
    .u64(v.expectedTargetNonce, "expectedTargetNonce").bytes(v.expectedCurrentDeploymentDigest, 32, "expectedCurrentDeploymentDigest")
    .u64(v.expectedCurrentDeploymentGeneration, "expectedCurrentDeploymentGeneration").bytes(v.expectedArtifactSha256, 32, "expectedArtifactSha256")
    .bytes(v.expectedArtifactMerkleRoot, 32, "expectedArtifactMerkleRoot").u64(v.expectedActualCapacity, "expectedActualCapacity")
    .byte(v.expectedApprovalBitset, "expectedApprovalBitset").byte(v.expectedApprovalCount, "expectedApprovalCount");
}
function readUnfreezeGuard(r: FixedReader): UnfreezeGuardV2 {
  const value = { expectedProposalDigest: r.bytes(32), expectedCheckpointDigest: r.bytes(32), expectedCheckpointGeneration: r.u64(), expectedVerificationDigest: r.bytes(32), expectedVerificationGeneration: r.u64(), expectedOriginalCouncilVersion: r.u64(), expectedOriginalCouncilHash: r.bytes(32), expectedCurrentCouncilVersion: r.u64(), expectedCurrentCouncilHash: r.bytes(32), expectedGateEpoch: r.u64(), expectedTargetNonce: r.u64(), expectedCurrentDeploymentDigest: r.bytes(32), expectedCurrentDeploymentGeneration: r.u64(), expectedArtifactSha256: r.bytes(32), expectedArtifactMerkleRoot: r.bytes(32), expectedActualCapacity: r.u64(), expectedApprovalBitset: r.byte(), expectedApprovalCount: r.byte() };
  validateUnfreezeGuard(value); return value;
}

function validateInitialize(v: InitializeControllerV2): void {
  hash(v.clusterDomain, "clusterDomain"); hash(v.expectedPolicyHash, "expectedPolicyHash"); hash(v.expectedCouncilHash, "expectedCouncilHash");
  hash(v.capacityPolicy.expectedPolicyDigest, "capacityPolicy.expectedPolicyDigest"); validateControllerRelease(v.controllerRelease);
  if (v.seatTerms.length !== 5) throw new Error("initial council must have exactly five seat terms");
  v.seatTerms.forEach(validateSeatTerm);
  const minimumExpirySlots = 1n + v.voteReviewSlots + v.majorDelaySlots + v.voteReviewSlots + 2n;
  if (v.initialPolicyVersion === 0n || v.initialCouncilVersion === 0n || v.nextProposalId === 0n || v.nextProposalId === U64_MAX ||
    v.targetNonce === 0n || v.targetNonce === U64_MAX || v.initialGateEpoch !== 1n || v.policyActivationSlot === 0n ||
    v.routineDelaySlots < 10n || v.majorDelaySlots < 20n || v.rollbackDelaySlots < 5n || v.terminalDelaySlots < 30n ||
    v.voteReviewSlots < 7n || v.proposalExpirySlots < 50n || v.majorDelaySlots < v.routineDelaySlots ||
    v.rollbackDelaySlots > v.routineDelaySlots || v.terminalDelaySlots < v.majorDelaySlots || minimumExpirySlots >= v.proposalExpirySlots) throw new Error("invalid controller initialization timing or monotonic identity");
}

export function encodeInitializeControllerV2(v: InitializeControllerV2): Buffer {
  validateInitialize(v); return encodeFixed(INITIALIZE_CONTROLLER_V2_TAG, INITIALIZE_CONTROLLER_V2_LEN, (w) => {
    w.bytes(v.clusterDomain, 32, "clusterDomain").u64(v.initialPolicyVersion, "initialPolicyVersion")
      .u64(v.initialCouncilVersion, "initialCouncilVersion").u64(v.nextProposalId, "nextProposalId")
      .u64(v.targetNonce, "targetNonce").u64(v.initialGateEpoch, "initialGateEpoch").u64(v.policyActivationSlot, "policyActivationSlot")
      .u64(v.routineDelaySlots, "routineDelaySlots").u64(v.majorDelaySlots, "majorDelaySlots")
      .u64(v.rollbackDelaySlots, "rollbackDelaySlots").u64(v.terminalDelaySlots, "terminalDelaySlots")
      .u64(v.voteReviewSlots, "voteReviewSlots").u64(v.proposalExpirySlots, "proposalExpirySlots")
      .bytes(v.expectedPolicyHash, 32, "expectedPolicyHash").bytes(v.expectedCouncilHash, 32, "expectedCouncilHash");
    v.seatTerms.forEach((term) => writeSeatTerm(w, term));
    w.bytes(v.capacityPolicy.expectedPolicyDigest, 32, "capacityPolicy.expectedPolicyDigest"); writeControllerRelease(w, v.controllerRelease);
  });
}
export function decodeInitializeControllerV2(data: Buffer): InitializeControllerV2 {
  return decodeFixed(data, INITIALIZE_CONTROLLER_V2_TAG, INITIALIZE_CONTROLLER_V2_LEN, (r) => ({
    clusterDomain: r.bytes(32), initialPolicyVersion: r.u64(), initialCouncilVersion: r.u64(), nextProposalId: r.u64(),
    targetNonce: r.u64(), initialGateEpoch: r.u64(), policyActivationSlot: r.u64(), routineDelaySlots: r.u64(), majorDelaySlots: r.u64(),
    rollbackDelaySlots: r.u64(), terminalDelaySlots: r.u64(), voteReviewSlots: r.u64(), proposalExpirySlots: r.u64(),
    expectedPolicyHash: r.bytes(32), expectedCouncilHash: r.bytes(32), seatTerms: Array.from({ length: 5 }, () => readSeatTerm(r)),
    capacityPolicy: { expectedPolicyDigest: r.bytes(32) }, controllerRelease: readControllerRelease(r),
  }), validateInitialize);
}

export const encodeCreateProposalV3 = (v: CreateProposalV3): Buffer => encodeFixed(CREATE_PROPOSAL_V3_TAG, CREATE_PROPOSAL_V3_LEN, (w) => writeProposalManifest(w, v.manifest));
export const decodeCreateProposalV3 = (data: Buffer): CreateProposalV3 => decodeFixed(data, CREATE_PROPOSAL_V3_TAG, CREATE_PROPOSAL_V3_LEN, (r) => ({ manifest: readProposalManifest(r) }), (v) => validateProposalManifest(v.manifest));

export function encodeApproveProposalV3(v: ApproveProposalV3): Buffer {
  validateProposalGuard(v.expected); validateApproval(v.expectedApprovalBitset, v.expectedApprovalCount);
  if (v.expected.expectedState !== ProposalStateV2.BufferVerified || v.expectedCreationCouncilVersion === 0n || isZero(v.expectedCreationCouncilHash) || v.expectedApprovalCount >= RELEASE1_APPROVAL_THRESHOLD) throw new Error("invalid proposal approval transition");
  return encodeFixed(APPROVE_PROPOSAL_V3_TAG, APPROVE_PROPOSAL_V3_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.u64(v.expectedCreationCouncilVersion, "expectedCreationCouncilVersion").bytes(v.expectedCreationCouncilHash, 32, "expectedCreationCouncilHash").byte(v.expectedApprovalBitset, "expectedApprovalBitset").byte(v.expectedApprovalCount, "expectedApprovalCount"); });
}
export function decodeApproveProposalV3(data: Buffer): ApproveProposalV3 {
  return decodeFixed(data, APPROVE_PROPOSAL_V3_TAG, APPROVE_PROPOSAL_V3_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedCreationCouncilVersion: r.u64(), expectedCreationCouncilHash: r.bytes(32), expectedApprovalBitset: r.byte(), expectedApprovalCount: r.byte() }), (v) => { encodeApproveProposalV3(v); });
}

export function encodeFinalizeGovernanceV3(v: FinalizeGovernanceV3): Buffer {
  validateProposalGuard(v.expected); validateApproval(v.expectedApprovalBitset, v.expectedApprovalCount);
  if (v.expected.expectedState !== ProposalStateV2.CouncilApproved || v.expectedApprovalCount !== RELEASE1_APPROVAL_THRESHOLD) throw new Error("invalid governance finalization transition");
  return encodeFixed(FINALIZE_GOVERNANCE_V3_TAG, FINALIZE_GOVERNANCE_V3_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.byte(v.expectedApprovalBitset, "expectedApprovalBitset").byte(v.expectedApprovalCount, "expectedApprovalCount"); });
}
export const decodeFinalizeGovernanceV3 = (data: Buffer): FinalizeGovernanceV3 => decodeFixed(data, FINALIZE_GOVERNANCE_V3_TAG, FINALIZE_GOVERNANCE_V3_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedApprovalBitset: r.byte(), expectedApprovalCount: r.byte() }), (v) => { encodeFinalizeGovernanceV3(v); });

function guardOnlyEncode(tag: number, length: number, v: QueueProposalV3 | ExpireProposalV3, expectedState?: ProposalState): Buffer {
  validateProposalGuard(v.expected); if (expectedState !== undefined && v.expected.expectedState !== expectedState) throw new Error("proposal guard state mismatch");
  return encodeFixed(tag, length, (w) => writeProposalGuardV3(w, v.expected));
}
export const encodeQueueProposalV3 = (v: QueueProposalV3): Buffer => guardOnlyEncode(QUEUE_PROPOSAL_V3_TAG, QUEUE_PROPOSAL_V3_LEN, v, ProposalStateV2.GovernanceSatisfied);
export const decodeQueueProposalV3 = (data: Buffer): QueueProposalV3 => decodeFixed(data, QUEUE_PROPOSAL_V3_TAG, QUEUE_PROPOSAL_V3_LEN, (r) => ({ expected: readProposalGuardV3(r) }), (v) => { encodeQueueProposalV3(v); });

export function encodeFreezeProposalV3(v: FreezeProposalV3): Buffer {
  validateProposalGuard(v.expected);
  if (v.expected.expectedState !== ProposalStateV2.Timelocked || v.expected.expectedGateEpoch === U64_MAX || v.expectedNextGateEpoch !== v.expected.expectedGateEpoch + 1n ||
    (v.expected.expectedGateStatus !== GateStatusV1.Active && v.expected.expectedGateStatus !== GateStatusV1.EmergencyFrozen)) throw new Error("invalid proposal freeze transition");
  return encodeFixed(FREEZE_PROPOSAL_V3_TAG, FREEZE_PROPOSAL_V3_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.u64(v.expectedNextGateEpoch, "expectedNextGateEpoch"); });
}
export const decodeFreezeProposalV3 = (data: Buffer): FreezeProposalV3 => decodeFixed(data, FREEZE_PROPOSAL_V3_TAG, FREEZE_PROPOSAL_V3_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedNextGateEpoch: r.u64() }), (v) => { encodeFreezeProposalV3(v); });

const prefreezeStates = new Set<ProposalState>([ProposalStateV2.Draft, ProposalStateV2.BufferAdopted, ProposalStateV2.BufferVerified, ProposalStateV2.CouncilApproved, ProposalStateV2.GovernanceSatisfied, ProposalStateV2.Timelocked]);
export function encodeCancelProposalV3(v: CancelProposalV3): Buffer {
  validateProposalGuard(v.expected); validateApproval(v.expectedCancellationApprovalBitset, v.expectedCancellationApprovalCount);
  if (!prefreezeStates.has(v.expected.expectedState) || v.expectedCancellationCouncilVersion === 0n || isZero(v.expectedCancellationCouncilHash) ||
    v.expectedCancellationApprovalCount >= RELEASE1_APPROVAL_THRESHOLD || v.cancellationReasonCode === 0) throw new Error("invalid proposal cancellation transition");
  return encodeFixed(CANCEL_PROPOSAL_V3_TAG, CANCEL_PROPOSAL_V3_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.u64(v.expectedCancellationCouncilVersion, "expectedCancellationCouncilVersion").bytes(v.expectedCancellationCouncilHash, 32, "expectedCancellationCouncilHash").byte(v.expectedCancellationApprovalBitset, "expectedCancellationApprovalBitset").byte(v.expectedCancellationApprovalCount, "expectedCancellationApprovalCount").u16(v.cancellationReasonCode, "cancellationReasonCode"); });
}
export const decodeCancelProposalV3 = (data: Buffer): CancelProposalV3 => decodeFixed(data, CANCEL_PROPOSAL_V3_TAG, CANCEL_PROPOSAL_V3_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedCancellationCouncilVersion: r.u64(), expectedCancellationCouncilHash: r.bytes(32), expectedCancellationApprovalBitset: r.byte(), expectedCancellationApprovalCount: r.byte(), cancellationReasonCode: r.u16() }), (v) => { encodeCancelProposalV3(v); });
export const encodeExpireProposalV3 = (v: ExpireProposalV3): Buffer => { if (!prefreezeStates.has(v.expected.expectedState)) throw new Error("proposal is not pre-freeze"); return guardOnlyEncode(EXPIRE_PROPOSAL_V3_TAG, EXPIRE_PROPOSAL_V3_LEN, v); };
export const decodeExpireProposalV3 = (data: Buffer): ExpireProposalV3 => decodeFixed(data, EXPIRE_PROPOSAL_V3_TAG, EXPIRE_PROPOSAL_V3_LEN, (r) => ({ expected: readProposalGuardV3(r) }), (v) => { encodeExpireProposalV3(v); });

export const encodeGuardianFreezeV2 = (v: GuardianFreezeV2): Buffer => encodeFixed(GUARDIAN_FREEZE_V2_TAG, GUARDIAN_FREEZE_V2_LEN, (w) => writeGuardianFreezeManifest(w, v.manifest));
export const decodeGuardianFreezeV2 = (data: Buffer): GuardianFreezeV2 => decodeFixed(data, GUARDIAN_FREEZE_V2_TAG, GUARDIAN_FREEZE_V2_LEN, (r) => ({ manifest: readGuardianFreezeManifest(r) }), (v) => validateGuardianFreezeManifest(v.manifest));
export const encodeCreateEmergencyResolutionV2 = (v: CreateEmergencyResolutionV2): Buffer => encodeFixed(CREATE_EMERGENCY_RESOLUTION_V2_TAG, CREATE_EMERGENCY_RESOLUTION_V2_LEN, (w) => writeEmergencyResolutionManifest(w, v.manifest));
export const decodeCreateEmergencyResolutionV2 = (data: Buffer): CreateEmergencyResolutionV2 => decodeFixed(data, CREATE_EMERGENCY_RESOLUTION_V2_TAG, CREATE_EMERGENCY_RESOLUTION_V2_LEN, (r) => ({ manifest: readEmergencyResolutionManifest(r) }), (v) => validateEmergencyResolutionManifest(v.manifest));

function validateEmergencyApproval(v: ApproveEmergencyResolutionV2): void {
  validateEmergencyResolutionGuard(v.expected); validateApproval(v.expectedApprovalBitset, v.expectedApprovalCount);
  if (v.expected.expectedState !== EmergencyFreezeResolutionStateV1.Draft || isZero(v.expected.expectedCheckpointDigest) || v.expectedApprovalCount >= RELEASE1_APPROVAL_THRESHOLD) throw new Error("invalid emergency approval transition");
}
export const encodeApproveEmergencyResolutionV2 = (v: ApproveEmergencyResolutionV2): Buffer => { validateEmergencyApproval(v); return encodeFixed(APPROVE_EMERGENCY_RESOLUTION_V2_TAG, APPROVE_EMERGENCY_RESOLUTION_V2_LEN, (w) => { writeEmergencyResolutionGuard(w, v.expected); w.byte(v.expectedApprovalBitset, "expectedApprovalBitset").byte(v.expectedApprovalCount, "expectedApprovalCount"); }); };
export const decodeApproveEmergencyResolutionV2 = (data: Buffer): ApproveEmergencyResolutionV2 => decodeFixed(data, APPROVE_EMERGENCY_RESOLUTION_V2_TAG, APPROVE_EMERGENCY_RESOLUTION_V2_LEN, (r) => ({ expected: readEmergencyResolutionGuard(r), expectedApprovalBitset: r.byte(), expectedApprovalCount: r.byte() }), validateEmergencyApproval);

function validateEmergencyState(v: QueueEmergencyResolutionV2 | ExecuteEmergencyResolutionV2, state: EmergencyResolutionState): void {
  validateEmergencyResolutionGuard(v.expected); if (v.expected.expectedState !== state || isZero(v.expected.expectedCheckpointDigest)) throw new Error("invalid emergency resolution transition");
}
export const encodeQueueEmergencyResolutionV2 = (v: QueueEmergencyResolutionV2): Buffer => { validateEmergencyState(v, EmergencyFreezeResolutionStateV1.CouncilApproved); return encodeFixed(QUEUE_EMERGENCY_RESOLUTION_V2_TAG, QUEUE_EMERGENCY_RESOLUTION_V2_LEN, (w) => writeEmergencyResolutionGuard(w, v.expected)); };
export const decodeQueueEmergencyResolutionV2 = (data: Buffer): QueueEmergencyResolutionV2 => decodeFixed(data, QUEUE_EMERGENCY_RESOLUTION_V2_TAG, QUEUE_EMERGENCY_RESOLUTION_V2_LEN, (r) => ({ expected: readEmergencyResolutionGuard(r) }), (v) => validateEmergencyState(v, EmergencyFreezeResolutionStateV1.CouncilApproved));
export const encodeExecuteEmergencyResolutionV2 = (v: ExecuteEmergencyResolutionV2): Buffer => { validateEmergencyState(v, EmergencyFreezeResolutionStateV1.Timelocked); return encodeFixed(EXECUTE_EMERGENCY_RESOLUTION_V2_TAG, EXECUTE_EMERGENCY_RESOLUTION_V2_LEN, (w) => { writeEmergencyResolutionGuard(w, v.expected); writeCeremonyEnvelope(w, v.envelope); }); };
export const decodeExecuteEmergencyResolutionV2 = (data: Buffer): ExecuteEmergencyResolutionV2 => decodeFixed(data, EXECUTE_EMERGENCY_RESOLUTION_V2_TAG, EXECUTE_EMERGENCY_RESOLUTION_V2_LEN, (r) => ({ expected: readEmergencyResolutionGuard(r), envelope: readCeremonyEnvelope(r) }), (v) => validateEmergencyState(v, EmergencyFreezeResolutionStateV1.Timelocked));
const expirableEmergencyStates = new Set<EmergencyResolutionState>([EmergencyFreezeResolutionStateV1.Draft, EmergencyFreezeResolutionStateV1.CouncilApproved, EmergencyFreezeResolutionStateV1.Timelocked]);
export const encodeExpireEmergencyResolutionV2 = (v: ExpireEmergencyResolutionV2): Buffer => { validateEmergencyResolutionGuard(v.expected); if (!expirableEmergencyStates.has(v.expected.expectedState)) throw new Error("emergency resolution is not expirable"); return encodeFixed(EXPIRE_EMERGENCY_RESOLUTION_V2_TAG, EXPIRE_EMERGENCY_RESOLUTION_V2_LEN, (w) => writeEmergencyResolutionGuard(w, v.expected)); };
export const decodeExpireEmergencyResolutionV2 = (data: Buffer): ExpireEmergencyResolutionV2 => decodeFixed(data, EXPIRE_EMERGENCY_RESOLUTION_V2_TAG, EXPIRE_EMERGENCY_RESOLUTION_V2_LEN, (r) => ({ expected: readEmergencyResolutionGuard(r) }), (v) => { encodeExpireEmergencyResolutionV2(v); });

function writeCheckpointAttestation(w: FixedWriter, v: CheckpointAttestationGuardV2, recast: boolean): void {
  validateCheckpointManifest(v.manifest);
  if (!Number.isSafeInteger(v.seatIndex) || v.seatIndex < 0 || v.seatIndex >= 5 || recast === isZero(v.expectedPreviousAttestationDigest)) throw new Error("invalid checkpoint attestation guard");
  writeCheckpointManifest(w, v.manifest); w.byte(v.seatIndex, "seatIndex").bytes(anyHash(v.expectedPreviousAttestationDigest, "expectedPreviousAttestationDigest"), 32, "expectedPreviousAttestationDigest");
}
function readCheckpointAttestation(r: FixedReader, recast: boolean): CheckpointAttestationGuardV2 {
  const value = { manifest: readCheckpointManifest(r), seatIndex: r.byte(), expectedPreviousAttestationDigest: r.bytes(32) };
  if (!Number.isSafeInteger(value.seatIndex) || value.seatIndex >= 5 || recast === isZero(value.expectedPreviousAttestationDigest)) throw new Error("invalid checkpoint attestation guard");
  return value;
}
export const encodeCreateCheckpointV2 = (v: CreateCheckpointV2): Buffer => encodeFixed(CREATE_CHECKPOINT_V2_TAG, CREATE_CHECKPOINT_V2_LEN, (w) => writeCheckpointAttestation(w, v.attestation, false));
export const decodeCreateCheckpointV2 = (data: Buffer): CreateCheckpointV2 => decodeFixed(data, CREATE_CHECKPOINT_V2_TAG, CREATE_CHECKPOINT_V2_LEN, (r) => ({ attestation: readCheckpointAttestation(r, false) }), (v) => { const probe = new FixedWriter(); writeCheckpointAttestation(probe, v.attestation, false); });
export const encodeRecastCheckpointV2 = (v: RecastCheckpointV2): Buffer => encodeFixed(RECAST_CHECKPOINT_V2_TAG, RECAST_CHECKPOINT_V2_LEN, (w) => writeCheckpointAttestation(w, v.attestation, true));
export const decodeRecastCheckpointV2 = (data: Buffer): RecastCheckpointV2 => decodeFixed(data, RECAST_CHECKPOINT_V2_TAG, RECAST_CHECKPOINT_V2_LEN, (r) => ({ attestation: readCheckpointAttestation(r, true) }), (v) => { const probe = new FixedWriter(); writeCheckpointAttestation(probe, v.attestation, true); });
export const encodeFinalizeCheckpointV2 = (v: FinalizeCheckpointV2): Buffer => encodeFixed(FINALIZE_CHECKPOINT_V2_TAG, FINALIZE_CHECKPOINT_V2_LEN, (w) => writeCheckpointManifest(w, v.manifest));
export const decodeFinalizeCheckpointV2 = (data: Buffer): FinalizeCheckpointV2 => decodeFixed(data, FINALIZE_CHECKPOINT_V2_TAG, FINALIZE_CHECKPOINT_V2_LEN, (r) => ({ manifest: readCheckpointManifest(r) }), (v) => validateCheckpointManifest(v.manifest));

export const encodeBindProgramDataVerificationV2 = (v: BindProgramDataVerificationV2): Buffer => encodeFixed(BIND_PROGRAMDATA_VERIFICATION_V2_TAG, BIND_PROGRAMDATA_VERIFICATION_V2_LEN, (w) => writeVerificationManifest(w, v.manifest));
export const decodeBindProgramDataVerificationV2 = (data: Buffer): BindProgramDataVerificationV2 => decodeFixed(data, BIND_PROGRAMDATA_VERIFICATION_V2_TAG, BIND_PROGRAMDATA_VERIFICATION_V2_LEN, (r) => ({ manifest: readVerificationManifest(r) }), (v) => validateVerificationManifest(v.manifest));
export const encodeFinalizeProgramDataVerificationV2 = (v: FinalizeProgramDataVerificationV2): Buffer => { validateVerificationGuard(v.expected); if (v.expected.expectedStatus !== ProgramDataVerificationStatusV2.ObservationBound) throw new Error("verification is not observation-bound"); return encodeFixed(FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG, FINALIZE_PROGRAMDATA_VERIFICATION_V2_LEN, (w) => writeVerificationGuard(w, v.expected)); };
export const decodeFinalizeProgramDataVerificationV2 = (data: Buffer): FinalizeProgramDataVerificationV2 => decodeFixed(data, FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG, FINALIZE_PROGRAMDATA_VERIFICATION_V2_LEN, (r) => ({ expected: readVerificationGuard(r) }), (v) => { encodeFinalizeProgramDataVerificationV2(v); });
export const encodeObserveProgramDataFailureV2 = (v: ObserveProgramDataFailureV2): Buffer => encodeFixed(OBSERVE_PROGRAMDATA_FAILURE_V2_TAG, OBSERVE_PROGRAMDATA_FAILURE_V2_LEN, (w) => writeFailureWitness(w, v.witness));
export const decodeObserveProgramDataFailureV2 = (data: Buffer): ObserveProgramDataFailureV2 => decodeFixed(data, OBSERVE_PROGRAMDATA_FAILURE_V2_TAG, OBSERVE_PROGRAMDATA_FAILURE_V2_LEN, (r) => ({ witness: readFailureWitness(r) }), (v) => validateFailureWitness(v.witness));
export const encodeApproveUnfreezeV2 = (v: ApproveUnfreezeV2): Buffer => { validateUnfreezeGuard(v.expected); if (v.expected.expectedApprovalCount >= RELEASE1_APPROVAL_THRESHOLD) throw new Error("unfreeze is already approved"); return encodeFixed(APPROVE_UNFREEZE_V2_TAG, APPROVE_UNFREEZE_V2_LEN, (w) => writeUnfreezeGuard(w, v.expected)); };
export const decodeApproveUnfreezeV2 = (data: Buffer): ApproveUnfreezeV2 => decodeFixed(data, APPROVE_UNFREEZE_V2_TAG, APPROVE_UNFREEZE_V2_LEN, (r) => ({ expected: readUnfreezeGuard(r) }), (v) => { encodeApproveUnfreezeV2(v); });
export const encodeExecuteUnfreezeV2 = (v: ExecuteUnfreezeV2): Buffer => { validateUnfreezeGuard(v.expected); nondefaultKey(v.linkedProposal, "linkedProposal"); if (v.expected.expectedApprovalCount !== RELEASE1_APPROVAL_THRESHOLD) throw new Error("unfreeze quorum is incomplete"); return encodeFixed(EXECUTE_UNFREEZE_V2_TAG, EXECUTE_UNFREEZE_V2_LEN, (w) => { writeUnfreezeGuard(w, v.expected); w.key(v.linkedProposal, "linkedProposal"); writeCeremonyEnvelope(w, v.envelope); }); };
export const decodeExecuteUnfreezeV2 = (data: Buffer): ExecuteUnfreezeV2 => decodeFixed(data, EXECUTE_UNFREEZE_V2_TAG, EXECUTE_UNFREEZE_V2_LEN, (r) => ({ expected: readUnfreezeGuard(r), linkedProposal: r.key(), envelope: readCeremonyEnvelope(r) }), (v) => { encodeExecuteUnfreezeV2(v); });

export type Release1V3Instruction =
  | { tag: 53; value: InitializeControllerV2 } | { tag: 54; value: CreateProposalV3 }
  | { tag: 55; value: ApproveProposalV3 } | { tag: 56; value: FinalizeGovernanceV3 }
  | { tag: 57; value: QueueProposalV3 } | { tag: 58; value: FreezeProposalV3 }
  | { tag: 59; value: CancelProposalV3 } | { tag: 60; value: ExpireProposalV3 }
  | { tag: 61; value: GuardianFreezeV2 } | { tag: 62; value: CreateEmergencyResolutionV2 }
  | { tag: 63; value: ApproveEmergencyResolutionV2 } | { tag: 64; value: QueueEmergencyResolutionV2 }
  | { tag: 65; value: ExecuteEmergencyResolutionV2 } | { tag: 66; value: ExpireEmergencyResolutionV2 }
  | { tag: 67; value: CreateCheckpointV2 } | { tag: 68; value: RecastCheckpointV2 }
  | { tag: 69; value: FinalizeCheckpointV2 } | { tag: 70; value: BindProgramDataVerificationV2 }
  | { tag: 71; value: FinalizeProgramDataVerificationV2 } | { tag: 72; value: ObserveProgramDataFailureV2 }
  | { tag: 73; value: ApproveUnfreezeV2 } | { tag: 74; value: ExecuteUnfreezeV2 };

export function decodeRelease1V3Instruction(data: Buffer): Release1V3Instruction {
  switch (data[0]) {
    case 53: return { tag: 53, value: decodeInitializeControllerV2(data) };
    case 54: return { tag: 54, value: decodeCreateProposalV3(data) };
    case 55: return { tag: 55, value: decodeApproveProposalV3(data) };
    case 56: return { tag: 56, value: decodeFinalizeGovernanceV3(data) };
    case 57: return { tag: 57, value: decodeQueueProposalV3(data) };
    case 58: return { tag: 58, value: decodeFreezeProposalV3(data) };
    case 59: return { tag: 59, value: decodeCancelProposalV3(data) };
    case 60: return { tag: 60, value: decodeExpireProposalV3(data) };
    case 61: return { tag: 61, value: decodeGuardianFreezeV2(data) };
    case 62: return { tag: 62, value: decodeCreateEmergencyResolutionV2(data) };
    case 63: return { tag: 63, value: decodeApproveEmergencyResolutionV2(data) };
    case 64: return { tag: 64, value: decodeQueueEmergencyResolutionV2(data) };
    case 65: return { tag: 65, value: decodeExecuteEmergencyResolutionV2(data) };
    case 66: return { tag: 66, value: decodeExpireEmergencyResolutionV2(data) };
    case 67: return { tag: 67, value: decodeCreateCheckpointV2(data) };
    case 68: return { tag: 68, value: decodeRecastCheckpointV2(data) };
    case 69: return { tag: 69, value: decodeFinalizeCheckpointV2(data) };
    case 70: return { tag: 70, value: decodeBindProgramDataVerificationV2(data) };
    case 71: return { tag: 71, value: decodeFinalizeProgramDataVerificationV2(data) };
    case 72: return { tag: 72, value: decodeObserveProgramDataFailureV2(data) };
    case 73: return { tag: 73, value: decodeApproveUnfreezeV2(data) };
    case 74: return { tag: 74, value: decodeExecuteUnfreezeV2(data) };
    default: throw new Error("unknown Release 1 V3 instruction tag");
  }
}
