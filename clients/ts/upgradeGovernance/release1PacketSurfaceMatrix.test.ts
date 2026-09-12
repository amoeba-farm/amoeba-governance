import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ARTIFACT_MERKLE_SCHEME_ID,
  VERIFICATION_BITMAP_BYTES_V1,
} from "./artifactMerkleV1.js";
import {
  OPERATOR_EXPECTED_TAGS_V1,
  OPERATOR_MUTATION_COMMANDS_V1,
} from "./operator.js";
import * as lifecycle from "./release1LifecycleInstructions.js";
import * as loader from "./release1LoaderInstructions.js";
import * as ceremony from "./release1CeremonyInstructions.js";
import * as authority from "./release1AuthorityInstructions.js";
import * as v3 from "./release1V3Instructions.js";
import * as v3Builders from "./release1V3Builders.js";
import * as custody from "./release1V3CustodyInstructions.js";
import { GOVERNANCE_LIVENESS_V2_INSTRUCTION_TAGS } from "./release1GovernanceV2.js";
import {
  BufferVerificationStatusV1,
  CouncilRotationStateV1,
  EmergencyFreezeResolutionKindV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  ProgramDataMismatchClassV1,
  ProgramDataVerificationStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
} from "./release1.js";
import {
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
} from "./release1Ceremony.js";
import {
  RELEASE1_TRANSACTION_PACKET_LIMIT_V1,
  buildCanonicalRelease1LoaderEnvelopeV1,
  createRelease1AddressLookupPlanV1,
  measureRelease1TransactionPacketV1,
  planRelease1TransactionPacketV1,
  type Release1PacketPlanningInputV1,
} from "./release1PacketPlanning.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const OBSERVED_SLOT = 40_000n;
const CURRENT_SLOT = 40_001n;
const VALID_THROUGH_SLOT = 40_128n;
const LAST_EXTENDED_SLOT = 39_999;

function hash(label: string): Buffer {
  return createHash("sha256").update(label, "utf8").digest();
}

function key(label: string): PublicKey {
  return new PublicKey(hash(`key:${label}`));
}

function operationId(label: string): string {
  return hash(`operation:${label}`).toString("hex");
}

const controllerProgram = key("controller-program");
const feePayer = key("fee-payer");
const clusterDomain = hash("synthetic-local-cluster");
const recentBlockhash = key("recent-blockhash").toBase58();
const bytes = (label: string): Buffer => hash(`bytes:${label}`);
const bitmap = (value: number): Buffer =>
  Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1, value);
const none = (): loader.OptionalInstructionPublicKeyV1 => ({
  present: false,
  value: PublicKey.default,
});
const some = (label: string): loader.OptionalInstructionPublicKeyV1 => ({
  present: true,
  value: key(label),
});

function accountBag<A>(): A {
  const fixed = new Map<PropertyKey, unknown>([
    ["payer", feePayer],
    ["systemProgram", SystemProgram.programId],
    ["upgradeableLoader", BPF_LOADER_UPGRADEABLE_PROGRAM_ID],
    ["seatAuthorities", Array.from({ length: 5 }, (_, i) => key(`seat-${i}`))],
    [
      "candidateSeatAuthorities",
      Array.from({ length: 5 }, (_, i) => key(`candidate-seat-${i}`)),
    ],
    [
      "checkpointAttestations",
      Array.from({ length: 3 }, (_, i) => key(`checkpoint-attestation-${i}`)),
    ],
  ]);
  return new Proxy(Object.create(null) as Record<PropertyKey, unknown>, {
    get(_target, property): unknown {
      const present = fixed.get(property);
      if (present !== undefined) return present;
      const generated = key(String(property));
      fixed.set(property, generated);
      return generated;
    },
  }) as A;
}

function build<A, V>(
  builder: (programId: PublicKey, accounts: A, value: V) => TransactionInstruction,
  value: V,
): TransactionInstruction {
  return builder(controllerProgram, accountBag<A>(), value);
}

const proposalExpectation = (): loader.ProposalExpectationV2 => ({
  expectedProposalDigest: bytes("proposal-digest"),
  expectedPolicyVersion: 2n,
  expectedPolicyHash: bytes("policy-hash"),
  expectedCouncilVersion: 3n,
  expectedCouncilHash: bytes("council-hash"),
  expectedGateStatus: GateStatusV1.FrozenForUpgrade,
  expectedGateEpoch: 4n,
  expectedTargetNonce: 5n,
  expectedState: ProposalStateV2.Frozen,
  expectedReviewStartSlot: 6n,
  expectedReviewEndSlot: 7n,
  expectedNotBeforeSlot: 8n,
  expectedExpirySlot: 9n,
});

const emergencyExpectation = (): loader.EmergencyResolutionExpectationV1 => ({
  expectedResolutionDigest: bytes("resolution-digest"),
  expectedPolicyVersion: 10n,
  expectedPolicyHash: bytes("emergency-policy-hash"),
  expectedCouncilVersion: 11n,
  expectedCouncilHash: bytes("emergency-council-hash"),
  expectedGateStatus: GateStatusV1.EmergencyFrozen,
  expectedGateEpoch: 12n,
  expectedFreezeSlot: 13n,
  expectedFreezeReasonCode: 14,
  expectedTargetNonce: 15n,
  expectedState: EmergencyFreezeResolutionStateV1.Timelocked,
  expectedNotBeforeSlot: 16n,
  expectedExpirySlot: 17n,
});

const rotationExpectation: lifecycle.CouncilRotationExpectationV1 = {
  expectedRotationDigest: bytes("rotation-digest"),
  expectedCurrentCouncilVersion: 18n,
  expectedCurrentCouncilHash: bytes("rotation-current-council"),
  expectedCandidateCouncilVersion: 19n,
  expectedCandidateCouncilHash: bytes("rotation-candidate-council"),
  expectedGateStatus: GateStatusV1.Active,
  expectedGateEpoch: 20n,
  expectedTargetNonce: 21n,
  expectedState: CouncilRotationStateV1.Timelocked,
  expectedNotBeforeSlot: 22n,
  expectedExpirySlot: 23n,
};

function checkpointCandidate(
  phase: typeof StateCheckpointPhaseV1.Poststate,
): lifecycle.CheckpointCandidateV1 {
  return {
    phase,
    expectedSubjectState: lifecycle.CheckpointSubjectStateV1.ProposalProgramDataVerified,
    expectedSubjectDigest: bytes("checkpoint-subject"),
    expectedGateStatus: GateStatusV1.FrozenForUpgrade,
    expectedGateEpoch: 24n,
    finalizedObservationSlot: 25n,
    targetProgramdataSlot: 26n,
    targetPayloadCommitment: bytes("checkpoint-payload"),
    targetRawProgramdataCommitment: bytes("checkpoint-raw"),
    targetCapacity: 1_572_864n,
    programOwnedStateRoot: bytes("program-owned-root"),
    programOwnedStateCount: 27n,
    logicalCompressedStateRoot: bytes("compressed-root"),
    logicalCompressedStateCount: 28n,
    semanticCustodyAccountingRoot: bytes("semantic-root"),
    hardCombinedRoot: bytes("hard-root"),
    externalMetadataObservationRoot: bytes("external-metadata-root"),
    externalRawBalanceObservationRoot: bytes("external-balance-root"),
    schemaIdentifier: bytes("checkpoint-schema"),
    admittedPositiveDonationRoot: bytes("donation-root"),
    admittedPositiveDonationCount: 1n,
    forbiddenDriftCount: 0,
    expectedCheckpointDigest: bytes("checkpoint-digest"),
  };
}

const fixedProof = (): loader.FixedMerkleProofV1 => ({
  proofLen: loader.MAX_FIXED_MERKLE_PROOF_NODES_V1,
  nodes: Array.from(
    { length: loader.MAX_FIXED_MERKLE_PROOF_NODES_V1 },
    (_, index) => bytes(`proof-${index}`),
  ),
});

const envelope = (withDurableNonce = true): loader.EnvelopeExpectationV1 => ({
  computeUnitLimit: loader.MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  computeUnitPriceMicroLamports:
    loader.MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  durableNonceAccount: withDurableNonce ? some("durable-nonce") : none(),
  durableNonceAuthority: withDurableNonce ? some("durable-nonce-authority") : none(),
});

const unfreezeExpectation = (): loader.UnfreezeExpectationV1 => ({
  expectedProposalDigest: bytes("unfreeze-proposal"),
  expectedPolicyVersion: 29n,
  expectedPolicyHash: bytes("unfreeze-policy"),
  expectedCurrentCouncilVersion: 30n,
  expectedCurrentCouncilHash: bytes("unfreeze-council"),
  expectedFrozenGateEpoch: 31n,
  expectedTargetNonce: 32n,
  expectedProposalState: ProposalStateV2.PoststateAccepted,
  expectedPoststateCheckpointDigest: bytes("unfreeze-poststate"),
  expectedProgramdataAuthority: key("authority"),
  expectedProgramdataDeployedSlot: 33n,
  expectedProgramdataCapacity: 1_572_864n,
  expectedRawProgramdataHash: bytes("unfreeze-programdata"),
  expectedUnfreezeApprovalBitset: 0b00111,
  expectedUnfreezeApprovalCount: 3,
  expectedProgramdataVerificationFinalizedSlot: 34n,
});

const seatTerms = Array.from({ length: 5 }, (_, index) => ({
  termStartSlot: BigInt(100 + index),
  termEndSlot: BigInt(1_000 + index),
}));

const initialize: lifecycle.InitializeControllerV1 = {
  clusterDomain,
  initialPolicyVersion: 1n,
  initialCouncilVersion: 1n,
  nextProposalId: 1n,
  targetNonce: 1n,
  initialGateEpoch: 1n,
  policyActivationSlot: 100n,
  routineDelaySlots: 10n,
  majorDelaySlots: 20n,
  rollbackDelaySlots: 5n,
  terminalDelaySlots: 30n,
  voteReviewSlots: 8n,
  proposalExpirySlots: 100n,
  expectedPolicyHash: bytes("initialize-policy"),
  expectedCouncilHash: bytes("initialize-council"),
  seatTerms,
};

const createProposal: lifecycle.CreateProposalV2 = {
  proposalClass: ProposalClassV1.RoutineUpgrade,
  creationGateStatus: GateStatusV1.Active,
  expectedProposalId: 1n,
  expectedTargetNonce: 1n,
  creationSlot: 100n,
  expectedPolicyVersion: 1n,
  expectedPolicyHash: bytes("create-policy"),
  expectedCreationCouncilVersion: 1n,
  expectedCreationCouncilHash: bytes("create-council"),
  expectedCreationGateEpoch: 2n,
  expectedFreezeGateEpoch: 0n,
  artifactLength: 1_572_864n,
  artifactSha256: bytes("artifact-sha"),
  artifactChunkMerkleRoot: bytes("artifact-root"),
  sourceCommitHash: bytes("source-commit"),
  sourceTreeHash: bytes("source-tree"),
  buildInputInventoryHash: bytes("build-input"),
  reproducibleBuildReceiptHash: bytes("build-receipt"),
  packageReceiptHash: bytes("package-receipt"),
  releaseIntentHash: bytes("release-intent"),
  expectedExecutionPrePayloadHash: bytes("pre-payload"),
  expectedExecutionPreChunkRoot: bytes("pre-chunk-root"),
  currentRawProgramdataHash: bytes("pre-raw"),
  deployedSlot: 99n,
  currentCapacity: 1_500_000n,
  extensionDelta: 72_864n,
  expectedPostCapacity: 1_572_864n,
  checkpointSchemaId: bytes("checkpoint-schema-id"),
  checkpointPolicyHash: bytes("checkpoint-policy"),
  primaryProposal: none(),
  rollbackProposal: some("rollback-proposal"),
  rollbackBuffer: some("rollback-buffer"),
  rollbackArtifactSha256: bytes("rollback-sha"),
  rollbackArtifactChunkRoot: bytes("rollback-root"),
  reviewStartSlot: 101n,
  reviewEndSlot: 109n,
  notBeforeSlot: 119n,
  expirySlot: 200n,
  expectedProposalDigest: bytes("create-proposal-digest"),
};

const guardianFreeze: loader.GuardianFreezeV1 = {
  expectedGateStatus: GateStatusV1.Active,
  expectedGateEpoch: 35n,
  expectedNextGateEpoch: 36n,
  expectedTargetNonce: 37n,
  expectedProgramOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramExecutable: true,
  expectedProgramDataLength: 36n,
  expectedProgramHeaderPresent: true,
  expectedLinkedProgramdata: some("guardian-programdata"),
  expectedProgramdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramdataExecutable: false,
  expectedProgramdataDataLength: 1_572_909n,
  expectedProgramdataHeaderPresent: true,
  expectedProgramdataSlot: 38n,
  expectedRawHashComplete: true,
  expectedRawProgramdataHash: bytes("guardian-raw"),
  expectedCapacity: 1_572_864n,
  expectedProgramdataAuthority: some("guardian-authority"),
  freezeReasonCode: 39,
  expectedObservationDigest: bytes("guardian-observation"),
};

const createEmergency: loader.CreateEmergencyResolutionV1 = {
  resolutionKind: EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade,
  creationSlot: 40n,
  notBeforeSlot: 50n,
  expirySlot: 100n,
  expectedPolicyVersion: 1n,
  expectedPolicyHash: bytes("resolution-policy"),
  expectedCouncilVersion: 1n,
  expectedCouncilHash: bytes("resolution-council"),
  expectedGateEpoch: 41n,
  expectedFreezeSlot: 39n,
  expectedFreezeReasonCode: 42,
  expectedTargetNonce: 43n,
  expectedFreezeObservationDigest: bytes("resolution-observation"),
  observedProgramOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  observedProgramExecutable: true,
  observedProgramDataLength: 36n,
  observedProgramHeaderPresent: true,
  observedLinkedProgramdata: some("resolution-programdata"),
  observedProgramdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  observedProgramdataExecutable: false,
  observedProgramdataDataLength: 1_572_909n,
  observedProgramdataHeaderPresent: true,
  observedProgramdataSlot: 44n,
  observedRawHashComplete: true,
  observedRawProgramdataHash: bytes("resolution-raw"),
  observedCapacity: 1_572_864n,
  observedProgramdataAuthority: some("resolution-authority"),
  expectedResolutionDigest: bytes("resolution-digest"),
};

const executeEmergency: loader.ExecuteEmergencyResolutionV1 = {
  expected: emergencyExpectation(),
  expectedFreezeObservationDigest: bytes("execute-emergency-observation"),
  expectedCheckpointDigest: bytes("execute-emergency-checkpoint"),
  expectedProgramOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramExecutable: true,
  expectedProgramDataLength: 36n,
  expectedProgramHeaderPresent: true,
  expectedLinkedProgramdata: some("execute-emergency-programdata"),
  expectedProgramdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramdataExecutable: false,
  expectedProgramdataDataLength: 1_572_909n,
  expectedProgramdataHeaderPresent: true,
  expectedProgramdataSlot: 45n,
  expectedRawHashComplete: true,
  expectedRawProgramdataHash: bytes("execute-emergency-raw"),
  expectedCapacity: 1_572_864n,
  expectedProgramdataAuthority: some("execute-emergency-authority"),
};

const v3Envelope = (): loader.EnvelopeExpectationV1 => ({
  computeUnitLimit: loader.MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  computeUnitPriceMicroLamports: loader.MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  durableNonceAccount: none(),
  durableNonceAuthority: none(),
});
const v3Guard = (state: ProposalStateV2, gateStatus: GateStatusV1 = GateStatusV1.FrozenForUpgrade): v3.ProposalGuardV3 => ({
  expectedProposalDigest: bytes("v3-proposal"), expectedState: state, expectedGateStatus: gateStatus,
  expectedGateEpoch: 4n, expectedTargetNonce: 5n, expectedCapacityPolicyDigest: bytes("v3-capacity"),
  expectedCurrentDeploymentDigest: bytes("v3-deployment"), expectedCurrentDeploymentGeneration: 6n,
});
const v3EmergencyGuard = (state: EmergencyFreezeResolutionStateV1): v3.EmergencyResolutionGuardV2 => ({
  expectedResolutionDigest: bytes("v3-resolution"), expectedState: state, expectedGateStatus: GateStatusV1.EmergencyFrozen,
  expectedGateEpoch: 4n, expectedTargetNonce: 5n, expectedCapacityPolicyDigest: bytes("v3-capacity"),
  expectedCurrentDeploymentDigest: bytes("v3-deployment"), expectedCurrentDeploymentGeneration: 6n,
  expectedFreezeObservationDigest: bytes("v3-freeze-observation"),
  expectedProgramdataObservationDigest: bytes("v3-programdata-observation"), expectedObservationGeneration: 7n,
  expectedCheckpointDigest: bytes("v3-emergency-checkpoint"),
});
const v3Checkpoint = (): v3.CheckpointManifestV2 => ({
  phase: StateCheckpointPhaseV1.Prestate, checkpointGeneration: 1n, previousCheckpointDigest: Buffer.alloc(32),
  expectedSubjectDigest: bytes("v3-checkpoint-subject"), expectedGateEpoch: 4n,
  expectedCapacityPolicyDigest: bytes("v3-capacity"), expectedCurrentDeploymentDigest: bytes("v3-deployment"),
  expectedCurrentDeploymentGeneration: 6n, expectedObservationDigest: bytes("v3-checkpoint-observation"),
  expectedObservationGeneration: 7n, programOwnedStateRoot: bytes("v3-owned"), programOwnedStateCount: 8n,
  logicalCompressedStateRoot: bytes("v3-compressed"), logicalCompressedStateCount: 9n,
  semanticCustodyAccountingRoot: bytes("v3-semantic"), hardCombinedRoot: bytes("v3-hard"),
  externalMetadataObservationRoot: bytes("v3-external-metadata"), externalRawBalanceObservationRoot: bytes("v3-external-raw"),
  schemaIdentifier: bytes("v3-schema"), admittedPositiveDonationRoot: Buffer.alloc(32), admittedPositiveDonationCount: 0n,
  forbiddenDriftCount: 0, expectedCouncilVersion: 2n, expectedCouncilHash: bytes("v3-council"),
  expectedCheckpointDigest: bytes("v3-checkpoint"), planValidUntilSlot: 100n,
});
const v3Unfreeze = (approvalCount: number): v3.UnfreezeGuardV2 => ({
  expectedProposalDigest: bytes("v3-proposal"), expectedCheckpointDigest: bytes("v3-checkpoint"),
  expectedCheckpointGeneration: 1n, expectedVerificationDigest: bytes("v3-verification"), expectedVerificationGeneration: 1n,
  expectedOriginalCouncilVersion: 1n, expectedOriginalCouncilHash: bytes("v3-original-council"),
  expectedCurrentCouncilVersion: 2n, expectedCurrentCouncilHash: bytes("v3-current-council"), expectedGateEpoch: 4n,
  expectedTargetNonce: 5n, expectedCurrentDeploymentDigest: bytes("v3-deployment"),
  expectedCurrentDeploymentGeneration: 6n, expectedArtifactSha256: bytes("v3-artifact"),
  expectedArtifactMerkleRoot: bytes("v3-artifact-root"), expectedActualCapacity: 1_572_864n,
  expectedApprovalBitset: approvalCount === 3 ? 0b00111 : 0, expectedApprovalCount: approvalCount,
});

interface SurfaceCase {
  label: string;
  tag: number;
  instructions: readonly TransactionInstruction[];
}

function one(label: string, instruction: TransactionInstruction): SurfaceCase {
  return { label, tag: instruction.data[0]!, instructions: [instruction] };
}

function enveloped(
  label: string,
  instruction: TransactionInstruction,
  instructions: readonly TransactionInstruction[],
): SurfaceCase {
  return { label, tag: instruction.data[0]!, instructions };
}

function ceremonySurfaceCases(): readonly SurfaceCase[] {
  const observationGuard: ceremony.ProgramDataObservationGuardV1 = {
    purpose: ProgramDataObservationPurposeV1.ProposalPrestate,
    generation: 1n,
    expectedSubjectDigest: bytes("ceremony-observation-subject"),
    expectedGateStatus: GateStatusV1.Active,
    expectedGateEpoch: 2n,
    expectedFreezeReasonCode: 0,
    expectedFreezeSlot: 0n,
  };
  const observationProof: ceremony.ObservedArtifactMerkleProofV1 = {
    proofLen: ceremony.MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1,
    nodes: Array.from(
      { length: ceremony.MAX_OBSERVED_ARTIFACT_PROOF_NODES_V1 },
      (_, index) => bytes(`ceremony-observation-proof-${index}`),
    ),
  };
  const approval = {
    expectedProposalDigest: bytes("ceremony-proposal"),
    expectedCouncilVersion: 1n,
    expectedGateEpoch: 2n,
    expectedTargetNonce: 3n,
  };
  const handoff = build(authority.buildAcceptTargetAuthorityCheckedV1Instruction, {
    expectedProposalDigest: approval.expectedProposalDigest,
    expectedBridgeObservationDigest: bytes("ceremony-bridge-observation"),
    expectedGateEpoch: approval.expectedGateEpoch,
    expectedTargetNonce: approval.expectedTargetNonce,
    envelope: v3Envelope(),
  });
  const activation = build(authority.buildExecuteBootstrapActivationV1Instruction, {
    expectedProposalDigest: bytes("ceremony-activation-proposal"),
    expectedBridgeObservationDigest: bytes("ceremony-activation-observation"),
    expectedGateEpoch: 2n,
    expectedTargetNonce: 3n,
    expectedDeploymentPlanDigest: bytes("ceremony-deployment-plan"),
    expectedReceiptPlanDigest: bytes("ceremony-receipt-plan"),
    envelope: v3Envelope(),
  });

  return [
    one("begin-programdata-observation", build(ceremony.buildBeginProgramDataObservationV1Instruction, {
      guard: observationGuard,
      expectedCapacityPolicyDigest: bytes("ceremony-capacity-policy"),
      expectedArtifactLength: 1_300_000n,
      expectedArtifactSha256: bytes("ceremony-artifact-sha"),
      expectedArtifactMerkleRoot: bytes("ceremony-artifact-root"),
      expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
      minimumRequiredCapacity: 1_300_000n,
      expectedDeployedSlot: 10n,
      expectedActualCapacity: 1_572_864n,
      expectedUpgradeAuthority: { present: true, value: key("ceremony-authority") },
    })),
    one("append-programdata-observation", build(ceremony.buildAppendProgramDataObservationChunkV1Instruction, {
      guard: observationGuard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex: 639,
    })),
    one("verify-observed-artifact", build(ceremony.buildVerifyObservedArtifactChunkV1Instruction, {
      guard: observationGuard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex: 79,
      expectedNextArtifactChunkIndex: 79,
      expectedTailBytesVerified: 0n,
      proof: observationProof,
    })),
    one("finalize-programdata-observation", build(ceremony.buildFinalizeProgramDataObservationV1Instruction, {
      guard: observationGuard,
      expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
      expectedNextRawChunkIndex: 640,
      expectedNextArtifactChunkIndex: 80,
      expectedTailBytesVerified: 272_864n,
    })),
    one("record-controller-immutability", build(authority.buildRecordControllerImmutabilityV1Instruction, {
      expectedCapacityPolicyDigest: bytes("ceremony-capacity-policy"),
      expectedReleaseDigest: bytes("ceremony-release"),
      expectedPreObservationDigest: bytes("ceremony-controller-pre"),
      expectedPostObservationDigest: bytes("ceremony-controller-post"),
      expectedReceiptDigest: bytes("ceremony-immutability-receipt"),
    })),
    one("create-target-authority-handoff", build(authority.buildCreateTargetAuthorityHandoffV1Instruction, {
      expectedGateEpoch: 2n,
      expectedTargetNonce: 3n,
      expectedCouncilVersion: 1n,
      bridgeSourceCommitment: bytes("ceremony-bridge-source"),
      bridgeBuildInputsCommitment: bytes("ceremony-bridge-build"),
      bridgePackageCommitment: bytes("ceremony-bridge-package"),
      bridgeReleaseManifestCommitment: bytes("ceremony-bridge-release"),
      planValidUntilSlot: 100n,
    })),
    one("approve-target-authority-handoff", build(authority.buildApproveTargetAuthorityHandoffV1Instruction, approval)),
    one("queue-target-authority-handoff", build(authority.buildQueueTargetAuthorityHandoffV1Instruction, approval)),
    one("accept-target-authority", handoff),
    one("create-bootstrap-activation", build(authority.buildCreateBootstrapActivationV1Instruction, {
      expectedControllerImmutabilityDigest: bytes("ceremony-immutability-receipt"),
      expectedHandoffReceiptDigest: bytes("ceremony-handoff-receipt"),
      expectedBridgeObservationDigest: bytes("ceremony-bridge-observation"),
      expectedGateEpoch: 2n,
      expectedTargetNonce: 3n,
      expectedCouncilVersion: 1n,
      planValidUntilSlot: 100n,
    })),
    one("approve-bootstrap-activation", build(authority.buildApproveBootstrapActivationV1Instruction, {
      ...approval,
      expectedProposalDigest: bytes("ceremony-activation-proposal"),
    })),
    one("queue-bootstrap-activation", build(authority.buildQueueBootstrapActivationV1Instruction, {
      ...approval,
      expectedProposalDigest: bytes("ceremony-activation-proposal"),
    })),
    one("execute-bootstrap-activation", activation),
  ];
}

function allSurfaceCases(): readonly SurfaceCase[] {
  const proposal = proposalExpectation();
  const checkpoint = checkpointCandidate(StateCheckpointPhaseV1.Poststate);
  const checkpointAttestation = {
    candidate: checkpoint,
    expectedCouncilVersion: 1n,
    expectedCouncilHash: bytes("checkpoint-council"),
    seatIndex: 2,
  };
  const initializeIx = build(lifecycle.buildInitializeControllerV1Instruction, initialize);
  const createProposalIx = build(lifecycle.buildCreateProposalV2Instruction, createProposal);
  const executeEmergencyIx = build(
    loader.buildExecuteEmergencyResolutionV1Instruction,
    executeEmergency,
  );
  const extendIx = build(loader.buildExtendTargetV1Instruction, {
    expected: proposal,
    expectedPrestateCheckpointDigest: bytes("extend-prestate"),
    expectedCurrentCapacity: 1_500_000n,
    expectedExtensionDelta: 72_864n,
    expectedPostCapacity: 1_572_864n,
    envelope: envelope(),
  });
  const executeUpgradeIx = build(loader.buildExecuteUpgradeV1Instruction, {
    expected: proposal,
    expectedPrestateCheckpointDigest: bytes("upgrade-prestate"),
    expectedCurrentRawProgramdataHash: bytes("upgrade-current-raw"),
    expectedSealedBufferHeaderHash: bytes("upgrade-buffer-header"),
    expectedCounterpartProposalDigest: bytes("upgrade-counterpart"),
    expectedProgramdataSlot: 46n,
    expectedCapacity: 1_572_864n,
    expectedVerifiedChunkCount: 96,
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope: envelope(),
  });
  const executeUnfreezeIx = build(loader.buildExecuteUnfreezeV1Instruction, {
    expected: unfreezeExpectation(),
    linkedProposal: key("linked-proposal"),
    envelope: envelope(),
  });
  const extendWithoutNonceIx = build(loader.buildExtendTargetV1Instruction, {
    expected: proposal,
    expectedPrestateCheckpointDigest: bytes("extend-prestate"),
    expectedCurrentCapacity: 1_500_000n,
    expectedExtensionDelta: 72_864n,
    expectedPostCapacity: 1_572_864n,
    envelope: envelope(false),
  });
  const executeUpgradeWithoutNonceIx = build(loader.buildExecuteUpgradeV1Instruction, {
    expected: proposal,
    expectedPrestateCheckpointDigest: bytes("upgrade-prestate"),
    expectedCurrentRawProgramdataHash: bytes("upgrade-current-raw"),
    expectedSealedBufferHeaderHash: bytes("upgrade-buffer-header"),
    expectedCounterpartProposalDigest: bytes("upgrade-counterpart"),
    expectedProgramdataSlot: 46n,
    expectedCapacity: 1_572_864n,
    expectedVerifiedChunkCount: 96,
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope: envelope(false),
  });
  const executeUnfreezeWithoutNonceIx = build(loader.buildExecuteUnfreezeV1Instruction, {
    expected: unfreezeExpectation(),
    linkedProposal: key("linked-proposal"),
    envelope: envelope(false),
  });

  return [
    one("initialize-controller", initializeIx),
    one("create-proposal", createProposalIx),
    one("approve-proposal", build(lifecycle.buildApproveProposalV2Instruction, { expected: proposal, expectedApprovalBitset: 1, expectedApprovalCount: 1 })),
    one("finalize-governance", build(lifecycle.buildFinalizeGovernanceV2Instruction, { expected: proposal, expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    one("queue-proposal", build(lifecycle.buildQueueProposalV2Instruction, { expected: proposal })),
    one("freeze-proposal", build(lifecycle.buildFreezeProposalV2Instruction, { expected: proposal, expectedNextGateEpoch: 47n })),
    one("cancel-proposal", build(lifecycle.buildCancelProposalV2Instruction, { expected: proposal, expectedCancellationApprovalBitset: 1, expectedCancellationApprovalCount: 1, cancellationReasonCode: 48 })),
    one("expire-proposal", build(lifecycle.buildExpireProposalV2Instruction, { expected: proposal })),
    one("guardian-freeze", build(loader.buildGuardianFreezeV1Instruction, guardianFreeze)),
    one("create-emergency-resolution", build(loader.buildCreateEmergencyResolutionV1Instruction, createEmergency)),
    one("approve-emergency-resolution", build(lifecycle.buildApproveEmergencyResolutionV1Instruction, { expected: emergencyExpectation(), expectedApprovalBitset: 1, expectedApprovalCount: 1 })),
    one("queue-emergency-resolution", build(lifecycle.buildQueueEmergencyResolutionV1Instruction, { expected: emergencyExpectation(), expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    enveloped("execute-emergency-resolution", executeEmergencyIx, loader.buildExecuteEmergencyResolutionEnvelopeV1(executeEmergencyIx, loader.MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1, loader.MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1)),
    one("convert-emergency-freeze", build(lifecycle.buildConvertEmergencyFreezeV2Instruction, { expected: proposal, expectedNextGateEpoch: 49n, expectedFreezeObservationDigest: bytes("convert-observation") })),
    one("create-checkpoint-attestation", build(lifecycle.buildCreateCheckpointAttestationV1Instruction, checkpointAttestation)),
    one("recast-checkpoint-attestation", build(lifecycle.buildRecastCheckpointAttestationV1Instruction, { ...checkpointAttestation, expectedPreviousAttestationDigest: bytes("previous-attestation") })),
    one("finalize-checkpoint", build(lifecycle.buildFinalizeCheckpointV1Instruction, { candidate: checkpoint, expectedCouncilVersion: 1n, expectedCouncilHash: bytes("checkpoint-council") })),
    one("create-candidate-council", build(lifecycle.buildCreateCandidateCouncilSetV1Instruction, { expectedCurrentCouncilVersion: 1n, expectedCurrentCouncilHash: bytes("current-council"), candidateCouncilVersion: 2n, activationSlot: 120n, expectedTargetNonce: 1n, expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 2n, expectedCandidateCouncilHash: bytes("candidate-council"), seatTerms })),
    one("create-council-rotation", build(lifecycle.buildCreateCouncilRotationV1Instruction, { creationSlot: 100n, notBeforeSlot: 120n, expirySlot: 200n, expectedCurrentCouncilVersion: 1n, expectedCurrentCouncilHash: bytes("current-council"), expectedCandidateCouncilVersion: 2n, expectedCandidateCouncilHash: bytes("candidate-council"), expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 2n, expectedTargetNonce: 1n, expectedRotationDigest: bytes("rotation-digest") })),
    one("approve-council-rotation", build(lifecycle.buildApproveCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 1, expectedApprovalCount: 1 })),
    one("activate-council-rotation", build(lifecycle.buildActivateCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    one("queue-council-rotation", build(lifecycle.buildQueueCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    one("expire-emergency-resolution", build(lifecycle.buildExpireEmergencyResolutionV1Instruction, { expected: emergencyExpectation() })),
    one("cancel-council-rotation", build(lifecycle.buildCancelCouncilRotationV1Instruction, { expected: rotationExpectation, expectedCancellationApprovalBitset: 1, expectedCancellationApprovalCount: 1, cancellationReasonCode: 50 })),
    one("expire-council-rotation", build(lifecycle.buildExpireCouncilRotationV1Instruction, { expected: rotationExpectation })),
    one("adopt-buffer", build(loader.buildAdoptBufferV1Instruction, { expected: proposal })),
    one("verify-buffer-chunk-max-proof", build(loader.buildVerifyBufferChunkV1Instruction, { expected: proposal, chunkIndex: 95, proof: fixedProof(), expectedVerificationStatus: BufferVerificationStatusV1.Verifying, expectedVerifiedChunkBitmap: bitmap(0x5a), expectedVerifiedChunkCount: 95 })),
    one("finalize-buffer", build(loader.buildFinalizeBufferVerificationV1Instruction, { expected: proposal, expectedVerificationStatus: BufferVerificationStatusV1.ReadyToFinalize, expectedVerifiedChunkBitmap: bitmap(0xff), expectedVerifiedChunkCount: 96 })),
    enveloped("extend-target-durable-nonce", extendIx, buildCanonicalRelease1LoaderEnvelopeV1(extendIx)),
    enveloped("extend-target", extendWithoutNonceIx, buildCanonicalRelease1LoaderEnvelopeV1(extendWithoutNonceIx)),
    enveloped("execute-upgrade-durable-nonce", executeUpgradeIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUpgradeIx)),
    enveloped("execute-upgrade", executeUpgradeWithoutNonceIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUpgradeWithoutNonceIx)),
    one("verify-programdata-chunk-max-proof", build(loader.buildVerifyProgramDataChunkV1Instruction, { expected: proposal, phase: loader.ProgramDataChunkPhaseV1.Payload, chunkIndex: 95, proof: fixedProof(), expectedVerificationStatus: ProgramDataVerificationStatusV1.Verifying, expectedVerifiedPayloadChunkBitmap: bitmap(0x5a), expectedVerifiedPayloadChunkCount: 95, expectedVerifiedTailChunkBitmap: bitmap(0), expectedVerifiedTailChunkCount: 0 })),
    one("finalize-programdata", build(loader.buildFinalizeProgramDataVerificationV1Instruction, { expected: proposal, expectedVerificationStatus: ProgramDataVerificationStatusV1.ReadyToFinalize, expectedVerifiedPayloadChunkBitmap: bitmap(0xff), expectedVerifiedPayloadChunkCount: 96, expectedVerifiedTailChunkBitmap: bitmap(0), expectedVerifiedTailChunkCount: 0, expectedDeployedSlot: 51n, expectedCapacity: 1_572_864n })),
    one("approve-unfreeze", build(loader.buildApproveUnfreezeV1Instruction, { expected: unfreezeExpectation() })),
    enveloped("execute-unfreeze-durable-nonce", executeUnfreezeIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUnfreezeIx)),
    enveloped("execute-unfreeze", executeUnfreezeWithoutNonceIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUnfreezeWithoutNonceIx)),
    one("close-abandoned-buffer", build(loader.buildCloseAbandonedBufferV1Instruction, { expected: proposal, expectedVerificationStatus: BufferVerificationStatusV1.Verified, expectedVerifiedChunkBitmap: bitmap(0xff), expectedVerifiedChunkCount: 96, expectedBufferVerificationFinalizedSlot: 52n })),
    one("activate-rollback", build(loader.buildActivateRollbackV1Instruction, { expectedPrimary: proposal, expectedRollback: proposal, expectedFailureEvidenceDigest: bytes("failure-evidence"), expectedPrimaryProgramdataVerificationStatus: ProgramDataVerificationStatusV1.Verifying, expectedPrimaryProgramdataVerificationFinalizedSlot: 0n, expectedRollbackBufferVerificationStatus: BufferVerificationStatusV1.Verified, expectedRollbackVerifiedChunkBitmap: bitmap(0xff), expectedRollbackVerifiedChunkCount: 96 })),
    one("observe-programdata-failure", build(loader.buildObserveProgramDataFailureV1Instruction, { expected: proposal, expectedProgramOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, expectedProgramExecutable: true, expectedProgramDataLength: 36n, expectedProgramHeaderPresent: true, expectedLinkedProgramdata: some("failure-programdata"), expectedProgramdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, expectedProgramdataExecutable: false, expectedProgramdataDataLength: 1_572_909n, expectedProgramdataHeaderPresent: true, expectedProgramdataSlot: 53n, expectedRawHashComplete: true, expectedRawProgramdataHash: bytes("failure-raw"), expectedCapacity: 1_572_864n, expectedProgramdataAuthority: some("failure-authority"), mismatchClass: ProgramDataMismatchClassV1.PayloadLeaf, failingChunkIndex: 95, expectedLeafHash: bytes("failure-leaf"), proof: fixedProof() })),
  ];
}

function currentMutationSurfaceCases(): readonly SurfaceCase[] {
  const checkpoint = v3Checkpoint();
  const proof: custody.ArtifactChunkProofV2 = {
    proofLen: custody.MAX_FIXED_MERKLE_PROOF_NODES_V1,
    nodes: Array.from({ length: custody.MAX_FIXED_MERKLE_PROOF_NODES_V1 }, (_, index) => bytes(`v3-proof-${index}`)),
  };
  const executeEmergencyIx = build(v3Builders.buildExecuteEmergencyResolutionV2Instruction, {
    expected: v3EmergencyGuard(EmergencyFreezeResolutionStateV1.Timelocked), envelope: v3Envelope(),
  });
  const extendIx = build(custody.buildExtendTargetV2Instruction, {
    expected: v3Guard(ProposalStateV2.Frozen), expectedPrestateCheckpointDigest: bytes("v3-prestate"),
    expectedPrestateCheckpointGeneration: 1n, expectedObservationDigest: bytes("v3-observation"),
    expectedObservationGeneration: 7n, expectedObservationRoot: bytes("v3-observation-root"),
    expectedObservationFinalizedSlot: 80n, expectedCurrentCapacity: 1_500_000n, expectedExtensionDelta: 72_864n,
    expectedPostCapacity: 1_572_864n, expectedNextDeploymentGeneration: 7n,
    expectedNextDeploymentDigest: bytes("v3-next-deployment"), envelope: v3Envelope(),
  });
  const executeUpgradeIx = build(custody.buildExecuteUpgradeV2Instruction, {
    expected: v3Guard(ProposalStateV2.Frozen), expectedPrestateCheckpointDigest: bytes("v3-prestate"),
    expectedPrestateCheckpointGeneration: 1n, expectedObservationDigest: bytes("v3-observation"),
    expectedObservationGeneration: 7n, expectedObservationRoot: bytes("v3-observation-root"),
    expectedObservationFinalizedSlot: 80n, expectedActualCapacity: 1_572_864n,
    expectedSealedBufferHeaderHash: bytes("v3-sealed-buffer"), expectedVerifiedChunkCount: 96,
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartProposalDigest: bytes("v3-counterpart"),
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified, envelope: v3Envelope(),
  });
  const executeUnfreezeIx = build(v3Builders.buildExecuteUnfreezeV2Instruction, {
    expected: v3Unfreeze(3), linkedProposal: key("v3-linked-proposal"), envelope: v3Envelope(),
  });
  return [
    one("v3-approve-proposal", build(v3Builders.buildApproveProposalV3Instruction, {
      expected: v3Guard(ProposalStateV2.BufferVerified), expectedCreationCouncilVersion: 2n,
      expectedCreationCouncilHash: bytes("v3-council"), expectedApprovalBitset: 1, expectedApprovalCount: 1,
    })),
    one("v3-finalize-governance", build(v3Builders.buildFinalizeGovernanceV3Instruction, {
      expected: v3Guard(ProposalStateV2.CouncilApproved), expectedApprovalBitset: 0b00111, expectedApprovalCount: 3,
    })),
    one("v3-queue-proposal", build(v3Builders.buildQueueProposalV3Instruction, { expected: v3Guard(ProposalStateV2.GovernanceSatisfied) })),
    one("v3-freeze-proposal", build(v3Builders.buildFreezeProposalV3Instruction, { expected: v3Guard(ProposalStateV2.Timelocked, GateStatusV1.Active), expectedNextGateEpoch: 5n })),
    one("v3-cancel-proposal", build(v3Builders.buildCancelProposalV3Instruction, {
      expected: v3Guard(ProposalStateV2.Draft, GateStatusV1.Active), expectedCancellationCouncilVersion: 2n,
      expectedCancellationCouncilHash: bytes("v3-council"), expectedCancellationApprovalBitset: 1,
      expectedCancellationApprovalCount: 1, cancellationReasonCode: 2,
    })),
    one("v3-expire-proposal", build(v3Builders.buildExpireProposalV3Instruction, { expected: v3Guard(ProposalStateV2.Draft, GateStatusV1.Active) })),
    one("v3-guardian-freeze", build(v3Builders.buildGuardianFreezeV2Instruction, { manifest: {
      expectedGateEpoch: 4n, expectedTargetNonce: 5n, expectedCapacityPolicyDigest: bytes("v3-capacity"),
      expectedCurrentDeploymentDigest: bytes("v3-deployment"), expectedCurrentDeploymentGeneration: 6n,
      freezeReasonCode: 2, planValidUntilSlot: 100n,
    } })),
    one("v3-create-emergency-resolution", build(v3Builders.buildCreateEmergencyResolutionV2Instruction, { manifest: {
      resolutionKind: EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade, expectedGateEpoch: 4n, expectedTargetNonce: 5n,
      expectedCapacityPolicyDigest: bytes("v3-capacity"), expectedCurrentDeploymentDigest: bytes("v3-deployment"),
      expectedCurrentDeploymentGeneration: 6n, expectedFreezeObservationDigest: bytes("v3-freeze-observation"),
      expectedProgramdataObservationDigest: bytes("v3-programdata-observation"), expectedProgramdataObservationGeneration: 7n,
      expectedPolicyVersion: 1n, expectedPolicyHash: bytes("v3-policy"), expectedCouncilVersion: 2n,
      expectedCouncilHash: bytes("v3-council"), planValidUntilSlot: 100n,
    } })),
    one("v3-approve-emergency-resolution", build(v3Builders.buildApproveEmergencyResolutionV2Instruction, {
      expected: v3EmergencyGuard(EmergencyFreezeResolutionStateV1.Draft), expectedApprovalBitset: 1, expectedApprovalCount: 1,
    })),
    one("v3-queue-emergency-resolution", build(v3Builders.buildQueueEmergencyResolutionV2Instruction, {
      expected: v3EmergencyGuard(EmergencyFreezeResolutionStateV1.CouncilApproved),
    })),
    enveloped("v3-execute-emergency-resolution", executeEmergencyIx, buildCanonicalRelease1LoaderEnvelopeV1(executeEmergencyIx)),
    one("v3-expire-emergency-resolution", build(v3Builders.buildExpireEmergencyResolutionV2Instruction, {
      expected: v3EmergencyGuard(EmergencyFreezeResolutionStateV1.Draft),
    })),
    one("v3-create-checkpoint", build(v3Builders.buildCreateCheckpointV2Instruction, {
      attestation: { manifest: checkpoint, seatIndex: 0, expectedPreviousAttestationDigest: Buffer.alloc(32) },
    })),
    one("v3-recast-checkpoint", build(v3Builders.buildRecastCheckpointV2Instruction, {
      attestation: { manifest: checkpoint, seatIndex: 0, expectedPreviousAttestationDigest: bytes("v3-previous-attestation") },
    })),
    one("v3-finalize-checkpoint", build(v3Builders.buildFinalizeCheckpointV2Instruction, { manifest: checkpoint })),
    one("v3-bind-programdata-verification", build(v3Builders.buildBindProgramDataVerificationV2Instruction, { manifest: {
      expected: v3Guard(ProposalStateV2.UpgradeExecuted), expectedObservationDigest: bytes("v3-observation"),
      expectedObservationGeneration: 7n, expectedObservationRoot: bytes("v3-observation-root"),
      expectedObservationFinalizedSlot: 80n, verificationGeneration: 1n, previousVerificationDigest: Buffer.alloc(32),
      planValidUntilSlot: 100n,
    } })),
    one("v3-finalize-programdata-verification", build(v3Builders.buildFinalizeProgramDataVerificationV2Instruction, { expected: {
      expectedProposalDigest: bytes("v3-proposal"), expectedVerificationDigest: bytes("v3-verification"),
      expectedVerificationGeneration: 1n, expectedStatus: v3.ProgramDataVerificationStatusV2.ObservationBound,
      expectedGateEpoch: 4n, expectedTargetNonce: 5n, expectedCapacityPolicyDigest: bytes("v3-capacity"),
      expectedCurrentDeploymentDigest: bytes("v3-deployment"), expectedCurrentDeploymentGeneration: 6n,
      expectedObservationDigest: bytes("v3-observation"), expectedObservationGeneration: 7n,
      expectedActualCapacity: 1_572_864n, expectedAuthority: key("authorityPda"),
    } })),
    one("v3-observe-programdata-failure", build(v3Builders.buildObserveProgramDataFailureV2Instruction, { witness: {
      expectedProposal: v3Guard(ProposalStateV2.UpgradeExecuted), expectedVerificationDigest: Buffer.alloc(32),
      expectedVerificationGeneration: 0n, expectedObservationGeneration: 7n, expectedObservationStateHash: Buffer.alloc(32),
      mismatchClass: v3.ProgramDataMismatchClassV2.ProgramLinkage, failingChunkIndex: 0xffff_ffff,
      expectedLeafHash: Buffer.alloc(32), proof: { proofLen: 0, nodes: Array.from({ length: 7 }, () => Buffer.alloc(32)) },
      planValidUntilSlot: 100n,
    } })),
    one("v3-approve-unfreeze", build(v3Builders.buildApproveUnfreezeV2Instruction, { expected: v3Unfreeze(0) })),
    enveloped("v3-execute-unfreeze", executeUnfreezeIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUnfreezeIx)),
    one("v3-adopt-buffer", build(custody.buildAdoptBufferV2Instruction, { expected: v3Guard(ProposalStateV2.Draft) })),
    one("v3-verify-buffer", build(custody.buildVerifyBufferChunkV2Instruction, {
      expected: v3Guard(ProposalStateV2.BufferAdopted), chunkIndex: 95, proof,
      expectedVerificationStatus: BufferVerificationStatusV1.Verifying, expectedVerifiedChunkBitmap: bitmap(0x5a),
      expectedVerifiedChunkCount: 95,
    })),
    one("v3-finalize-buffer", build(custody.buildFinalizeBufferVerificationV2Instruction, {
      expected: v3Guard(ProposalStateV2.BufferAdopted), expectedVerificationStatus: BufferVerificationStatusV1.ReadyToFinalize,
      expectedVerifiedChunkBitmap: bitmap(0xff), expectedVerifiedChunkCount: 96,
      expectedSealedBufferHeaderHash: bytes("v3-sealed-buffer"),
    })),
    enveloped("v3-extend-target", extendIx, buildCanonicalRelease1LoaderEnvelopeV1(extendIx)),
    enveloped("v3-execute-upgrade", executeUpgradeIx, buildCanonicalRelease1LoaderEnvelopeV1(executeUpgradeIx)),
    one("v3-close-buffer", build(custody.buildCloseAbandonedBufferV2Instruction, {
      expected: v3Guard(ProposalStateV2.Cancelled), expectedVerificationStatus: BufferVerificationStatusV1.Verified,
      expectedVerifiedChunkBitmap: bitmap(0xff), expectedVerifiedChunkCount: 96, expectedBufferVerificationFinalizedSlot: 90n,
    })),
    one("v3-activate-rollback", build(custody.buildActivateRollbackV2Instruction, {
      expectedPrimary: v3Guard(ProposalStateV2.UpgradeExecuted), expectedRollback: v3Guard(ProposalStateV2.Timelocked),
      expectedFailureEvidenceDigest: bytes("v3-failure"), expectedPrimaryVerificationGeneration: 0n,
      expectedProgramdataObservationStateHash: bytes("v3-observation-state"), expectedProgramdataObservationGeneration: 7n,
      expectedRollbackBufferVerificationStatus: BufferVerificationStatusV1.Verified,
      expectedRollbackVerifiedChunkBitmap: bitmap(0xff), expectedRollbackVerifiedChunkCount: 96,
      expectedRollbackBufferFinalizedSlot: 90n, expectedNextGateEpoch: 5n,
    })),
  ];
}

function retainedCouncilSurfaceCases(): readonly SurfaceCase[] {
  return [
    one("create-candidate-council", build(lifecycle.buildCreateCandidateCouncilSetV1Instruction, {
      expectedCurrentCouncilVersion: 1n, expectedCurrentCouncilHash: bytes("current-council"), candidateCouncilVersion: 2n,
      activationSlot: 120n, expectedTargetNonce: 1n, expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 2n,
      expectedCandidateCouncilHash: bytes("candidate-council"), seatTerms,
    })),
    one("create-council-rotation", build(lifecycle.buildCreateCouncilRotationV1Instruction, {
      creationSlot: 100n, notBeforeSlot: 120n, expirySlot: 200n, expectedCurrentCouncilVersion: 1n,
      expectedCurrentCouncilHash: bytes("current-council"), expectedCandidateCouncilVersion: 2n,
      expectedCandidateCouncilHash: bytes("candidate-council"), expectedGateStatus: GateStatusV1.Active,
      expectedGateEpoch: 2n, expectedTargetNonce: 1n, expectedRotationDigest: bytes("rotation-digest"),
    })),
    one("approve-council-rotation", build(lifecycle.buildApproveCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 1, expectedApprovalCount: 1 })),
    one("activate-council-rotation", build(lifecycle.buildActivateCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    one("queue-council-rotation", build(lifecycle.buildQueueCouncilRotationV1Instruction, { expected: rotationExpectation, expectedApprovalBitset: 0b00111, expectedApprovalCount: 3 })),
    one("cancel-council-rotation", build(lifecycle.buildCancelCouncilRotationV1Instruction, { expected: rotationExpectation, expectedCancellationApprovalBitset: 1, expectedCancellationApprovalCount: 1, cancellationReasonCode: 50 })),
    one("expire-council-rotation", build(lifecycle.buildExpireCouncilRotationV1Instruction, { expected: rotationExpectation })),
  ];
}

function lookupCandidates(
  instructions: readonly TransactionInstruction[],
): PublicKey[] {
  const staticKeys = new Set<string>([
    feePayer.toBase58(),
    ...instructions.map((instruction) => instruction.programId.toBase58()),
    ...instructions.flatMap((instruction) =>
      instruction.keys
        .filter((meta) => meta.isSigner)
        .map((meta) => meta.pubkey.toBase58()),
    ),
  ]);
  const seen = new Set<string>();
  const candidates: PublicKey[] = [];
  for (const instruction of instructions) {
    for (const meta of instruction.keys) {
      const encoded = meta.pubkey.toBase58();
      if (staticKeys.has(encoded) || seen.has(encoded)) continue;
      seen.add(encoded);
      candidates.push(meta.pubkey);
    }
  }
  return candidates;
}

function legacyInput(surface: SurfaceCase): Release1PacketPlanningInputV1 {
  return {
    operationId: operationId(`${surface.label}:legacy`),
    controllerProgram,
    clusterDomain,
    payer: feePayer,
    recentBlockhash,
    instructions: surface.instructions,
    format: "legacy",
  };
}

function v0Input(surface: SurfaceCase): Release1PacketPlanningInputV1 {
  const operation = operationId(`${surface.label}:v0`);
  const addresses = lookupCandidates(surface.instructions);
  const table = new AddressLookupTableAccount({
    key: key(`lookup-table:${surface.label}`),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: LAST_EXTENDED_SLOT,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
  const plan = createRelease1AddressLookupPlanV1({
    operationId: operation,
    controllerProgram,
    clusterDomain,
    lookupTableAccount: table,
    requiredLookupAddresses: addresses,
    observedSlot: OBSERVED_SLOT,
    validThroughSlot: VALID_THROUGH_SLOT,
  });
  return {
    operationId: operation,
    controllerProgram,
    clusterDomain,
    payer: feePayer,
    recentBlockhash,
    instructions: surface.instructions,
    format: "v0",
    lookup: { plan, lookupTableAccount: table, currentSlot: CURRENT_SLOT },
  };
}

function actualWireBytes(input: Release1PacketPlanningInputV1): number {
  const messageBuilder = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: input.recentBlockhash,
    instructions: [...input.instructions],
  });
  const message = input.format === "v0"
    ? messageBuilder.compileToV0Message([input.lookup!.lookupTableAccount])
    : messageBuilder.compileToLegacyMessage();
  return new VersionedTransaction(message).serialize().length;
}

test("every current Release 1 operator mutation surface has a bounded packet plan", () => {
  const fixtures = [
    ...retainedCouncilSurfaceCases(),
    ...ceremonySurfaceCases(),
    ...currentMutationSurfaceCases(),
  ];
  // Preserve real historical payloads as negative planner coverage.
  const retiredTags = new Set([19, 20, 21, 22, 24, 25, 44, 45, 46, 47, 49, 50, 51, 52]);
  const retired = fixtures.filter((surface) => retiredTags.has(surface.tag));
  assert.equal(retired.length, 14);
  for (const surface of retired) {
    assert.throws(() => planRelease1TransactionPacketV1(legacyInput(surface)),
      /controller instruction is not a strict current Release 1 instruction/, surface.label);
    assert.throws(() => planRelease1TransactionPacketV1(v0Input(surface)),
      /controller instruction is not a strict current Release 1 instruction/, surface.label);
  }
  const surfaces = fixtures.filter((surface) => !retiredTags.has(surface.tag));
  assert.equal(surfaces.length, 33);
  assert.deepEqual(
    [...new Set(surfaces.map((surface) => surface.tag))].sort((a, b) => a - b),
    [
      18,
      ...Array.from({ length: 5 }, (_, index) => index + 39),
      ...Array.from({ length: 27 }, (_, index) => index + 55),
    ],
  );

  const coveredTags = new Set(surfaces.map((surface) => surface.tag));
  // Governance-liveness V2 has its own exact builder/account/packet matrix in
  // release1GovernanceV2Instructions.test.ts. Keep the operator completeness
  // assertion aware of that independently bounded surface without duplicating
  // its 26 typed transactions here.
  const governanceLivenessV2PacketTags = new Set<number>(Object.values(GOVERNANCE_LIVENESS_V2_INSTRUCTION_TAGS));
  assert.deepEqual([...governanceLivenessV2PacketTags], Array.from({ length: 26 }, (_, index) => 82 + index));
  assert.deepEqual(
    [...OPERATOR_MUTATION_COMMANDS_V1],
    Object.keys(OPERATOR_EXPECTED_TAGS_V1),
  );
  for (const command of OPERATOR_MUTATION_COMMANDS_V1) {
    const expectedTags = OPERATOR_EXPECTED_TAGS_V1[command];
    assert.ok(expectedTags.length > 0, `${command} has no typed instruction surface`);
    for (const tag of expectedTags) {
      assert.ok(coveredTags.has(tag) || governanceLivenessV2PacketTags.has(tag), `${command} tag ${tag} lacks packet coverage`);
    }
  }

  const results: Record<string, { legacy: number; v0: number }> = {};
  const v0Blockers: string[] = [];
  for (const surface of surfaces) {
    const legacy = measureRelease1TransactionPacketV1(legacyInput(surface));
    const v0 = measureRelease1TransactionPacketV1(v0Input(surface));
    results[surface.label] = { legacy: legacy.packetBytes, v0: v0.packetBytes };
    if (legacy.fitsPacketLimit) {
      assert.equal(legacy.packetBytes, actualWireBytes(legacyInput(surface)));
      assert.doesNotThrow(() => planRelease1TransactionPacketV1(legacyInput(surface)));
    }
    if (v0.fitsPacketLimit) {
      assert.equal(v0.packetBytes, actualWireBytes(v0Input(surface)));
      const plan = planRelease1TransactionPacketV1(v0Input(surface));
      assert.equal(plan.fitsPacketLimit, true);
      assert.ok(plan.packetBytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1);
    } else {
      v0Blockers.push(`${surface.label}:${v0.packetBytes}`);
    }
  }

  assert.deepEqual(v0Blockers, [], `non-fitting required v0 surfaces: ${v0Blockers.join(", ")}`);
  assert.equal(Object.keys(results).length, 33);
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/governance/evidence/release-1-current-packet-surface-20260912.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    packet_limit: number;
    surfaces: Record<string, { legacy: number; v0: number }>;
    legacy_non_fit: Record<string, number>;
    v0_non_fit: Record<string, number>;
  };
  assert.equal(evidence.packet_limit, RELEASE1_TRANSACTION_PACKET_LIMIT_V1);
  assert.deepEqual(results, evidence.surfaces);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(results).filter(
        ([, measurement]) => measurement.legacy > RELEASE1_TRANSACTION_PACKET_LIMIT_V1,
      ).map(([label, measurement]) => [label, measurement.legacy]),
    ),
    evidence.legacy_non_fit,
  );
  assert.deepEqual(evidence.v0_non_fit, {});
  assert.ok(
    Object.values(results).some((measurement) => measurement.legacy > RELEASE1_TRANSACTION_PACKET_LIMIT_V1),
    "the matrix must preserve explicit legacy non-fit evidence",
  );
});
