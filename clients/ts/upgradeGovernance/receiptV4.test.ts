import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { ARTIFACT_MERKLE_SCHEME_ID } from "./artifactMerkleV1.js";
import { PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1 } from "./programDataObservationMerkleV1.js";
import {
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN,
  CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR,
  CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
  CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN,
  CeremonyProposalStateV1,
  EXTEND_PROGRAM_CHECKED_FEATURE_ID_V1,
  PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
  PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN,
  PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR,
  PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  SET_AUTHORITY_CHECKED_FEATURE_ID_V1,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN,
  TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR,
  TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN,
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
  programDataCapacityPolicyDigestV1,
  programDataObservationDigestV1,
  programDataObservationSubjectDigestV1,
  serializeBootstrapActivationProposalV1,
  serializeBootstrapActivationReceiptV1,
  serializeControllerImmutabilityReceiptV1,
  serializeControllerReleaseCommitmentV1,
  serializeCurrentDeploymentStateV1,
  serializeProgramDataCapacityPolicyV1,
  serializeProgramDataObservationV1,
  serializeTargetAuthorityHandoffProposalV1,
  serializeTargetAuthorityHandoffReceiptV1,
  targetAuthorityHandoffProposalDigestV1,
  targetAuthorityHandoffReceiptDigestV1,
  type BootstrapActivationProposalV1,
  type BootstrapActivationReceiptV1,
  type ControllerImmutabilityReceiptV1,
  type ControllerReleaseCommitmentV1,
  type CurrentDeploymentStateV1,
  type ProgramDataCapacityPolicyV1,
  type ProgramDataObservationV1,
  type TargetAuthorityHandoffProposalV1,
  type TargetAuthorityHandoffReceiptV1,
} from "./release1Ceremony.js";
import {
  CEREMONY_ACCOUNT_ROLES_V4,
  GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_SCHEMA,
  GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION,
  finalizeGovernedRelease1CeremonyReceiptV4,
  verifyGovernedRelease1CeremonyReceiptV4,
  type CeremonyAccountRoleV4,
  type CeremonyReceiptAccountV4,
  type GovernedRelease1CeremonyReceiptV4,
  type GovernedRelease1CeremonyReceiptV4Material,
} from "./receiptV4.js";
import {
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
  GateStatusV1,
} from "./release1.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

const key = (seed: number): PublicKey => new PublicKey(Buffer.alloc(32, seed));
const hash = (seed: number): Buffer => Buffer.alloc(32, seed);
const hashHex = (seed: number): string => hash(seed).toString("hex");
const present = (value: PublicKey) => ({ present: true, value }) as const;
const absent = { present: false, value: PublicKey.default } as const;

const controller = SYNTHETIC_CONTROLLER_PROGRAM_V1;
const controllerConfig = key(2);
const target = key(3);
const targetProgramdata = key(4);
const controllerAuthority = key(5);
const legacyAuthority = key(6);
const controllerProgramdata = key(7);
const governancePolicy = key(8);
const gate = key(9);
const controllerInitialAuthority = key(10);
const artifactLength = 100n;
const capacity = 200n;
const deployedSlot = 7n;
const clusterDomain = hash(70);
const artifactSha256 = hash(40);
const artifactRoot = hash(41);

function programHeader(programdata: PublicKey): Buffer {
  const result = Buffer.alloc(36);
  result.writeUInt32LE(2, 0);
  programdata.toBuffer().copy(result, 4);
  return result;
}

function programdataHeader(slot: bigint, authority: ReturnType<typeof present> | typeof absent): Buffer {
  const result = Buffer.alloc(45);
  result.writeUInt32LE(3, 0);
  result.writeBigUInt64LE(slot, 4);
  result[12] = Number(authority.present);
  authority.value.toBuffer().copy(result, 13);
  return result;
}

function makeCapacityPolicy(): ProgramDataCapacityPolicyV1 {
  const [pda, bump] = deriveCapacityPolicyPdaV1(controller, target);
  const value: ProgramDataCapacityPolicyV1 = {
    discriminator: PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
    version: 1,
    bump,
    initialized: true,
    controllerProgram: controller,
    controllerConfig,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    loaderProgramdataMetadataLen: 45n,
    maximumRawProgramdataLength: 10_485_760n,
    maximumPayloadCapacity: 10_485_715n,
    maximumArtifactLength: 1_572_864n,
    observationSchemeId: PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
    observationChunkSize: 16 * 1024,
    observationMaxChunkCount: 640,
    observationPaddedLeafCount: 1_024,
    observationTreeDepth: 10,
    observationFrontierHashCount: 11,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    artifactChunkSize: 16 * 1024,
    zeroTailRequired: true,
    extendProgramCheckedFeature: EXTEND_PROGRAM_CHECKED_FEATURE_ID_V1,
    setAuthorityCheckedFeature: SET_AUTHORITY_CHECKED_FEATURE_ID_V1,
    policyDigest: hash(250),
    creationSlot: 1n,
    reserved: Buffer.alloc(PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN),
  };
  value.policyDigest = programDataCapacityPolicyDigestV1(value);
  assert.ok(pda);
  return value;
}

function makeControllerRelease(policy: ProgramDataCapacityPolicyV1): ControllerReleaseCommitmentV1 {
  const [pda, bump] = deriveControllerReleaseCommitmentPdaV1(controller, target);
  const value: ControllerReleaseCommitmentV1 = {
    discriminator: CONTROLLER_RELEASE_COMMITMENT_V1_DISCRIMINATOR,
    version: 1,
    bump,
    initialized: true,
    controllerProgram: controller,
    controllerProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    artifactLength,
    artifactSha256,
    artifactMerkleRoot: artifactRoot,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    sourceCommitment: hash(20),
    sourceTreeCommitment: hash(21),
    buildInputsCommitment: hash(22),
    toolchainCommitment: hash(23),
    packageCommitment: hash(24),
    releaseManifestCommitment: hash(25),
    abiCommitment: hash(26),
    preImmutabilityAuthority: present(controllerInitialAuthority),
    minimumProgramdataCapacity: capacity,
    releaseDigest: hash(251),
    creationSlot: 2n,
    finalized: true,
    reserved: Buffer.alloc(CONTROLLER_RELEASE_COMMITMENT_V1_RESERVED_LEN),
  };
  value.releaseDigest = controllerReleaseDigestV1(value);
  assert.ok(pda);
  return value;
}

interface ObservationInput {
  observedProgram: PublicKey;
  observedProgramdata: PublicKey;
  purpose: ProgramDataObservationPurposeV1;
  generation: bigint;
  authority: ReturnType<typeof present> | typeof absent;
  rootSeed: number;
  startSlot: bigint;
}

function makeObservation(policy: ProgramDataCapacityPolicyV1, input: ObservationInput): ProgramDataObservationV1 {
  const { observedProgram, observedProgramdata, purpose, generation, authority, rootSeed, startSlot } = input;
  const value: ProgramDataObservationV1 = {
    discriminator: PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR,
    version: 1,
    bump: 0,
    initialized: true,
    controllerProgram: controller,
    controllerConfig,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    purpose,
    subject: key(30 + Number(generation) + purpose),
    subjectDigest: hash(80 + Number(generation) + purpose),
    generation,
    protocolGate: gate,
    gateStatus: GateStatusV1.EmergencyFrozen,
    gateEpoch: 1n,
    gateActiveProposal: PublicKey.default,
    gateFreezeSlot: 19n,
    gateFreezeReasonCode: BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
    targetProgram: observedProgram,
    targetProgramdata: observedProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    programOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    programExecutable: true,
    programDataLength: 36n,
    programHeaderPresent: true,
    programHeaderSnapshot: programHeader(observedProgramdata),
    linkedProgramdata: observedProgramdata,
    programdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    programdataExecutable: false,
    programdataHeaderPresent: true,
    programdataHeaderSnapshot: programdataHeader(deployedSlot, authority),
    deployedSlot,
    upgradeAuthority: authority,
    rawDataLength: capacity + 45n,
    payloadOffset: 45,
    actualCapacity: capacity,
    expectedArtifactLength: artifactLength,
    expectedArtifactSha256: artifactSha256,
    expectedArtifactMerkleRoot: artifactRoot,
    expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    artifactChunkSize: 16 * 1024,
    artifactChunkCount: 1,
    minimumRequiredCapacity: artifactLength,
    rawObservationSchemeId: PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
    rawChunkSize: 16 * 1024,
    rawChunkCount: 1,
    rawPaddedLeafCount: 1,
    rawTreeDepth: 0,
    nextRawChunkIndex: 1,
    rawFrontier: [hash(rootSeed + 20), ...Array.from({ length: 10 }, () => Buffer.alloc(32))],
    rawFrontierMask: 1,
    nextArtifactChunkIndex: 1,
    tailBytesVerified: capacity - artifactLength,
    startSlot,
    lastObservedSlot: startSlot + 1n,
    finalizedSlot: startSlot + 2n,
    finalRawMerkleRoot: hash(rootSeed),
    observationDigest: hash(252),
    status: ProgramDataObservationStatusV1.Finalized,
    reserved: Buffer.alloc(PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN),
  };
  value.subjectDigest = programDataObservationSubjectDigestV1(value);
  value.bump = deriveProgramDataObservationPdaV1(controller, observedProgram, purpose, value.subjectDigest, generation)[1];
  value.observationDigest = programDataObservationDigestV1(value);
  return value;
}

function makeImmutabilityReceipt(
  policy: ProgramDataCapacityPolicyV1,
  release: ControllerReleaseCommitmentV1,
  pre: ProgramDataObservationV1,
  post: ProgramDataObservationV1,
): ControllerImmutabilityReceiptV1 {
  const value: ControllerImmutabilityReceiptV1 = {
    discriminator: CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveControllerImmutabilityReceiptPdaV1(controller, target)[1],
    initialized: true,
    controllerProgram: controller,
    controllerProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    releaseCommitment: deriveControllerReleaseCommitmentPdaV1(controller, target)[0],
    releaseCommitmentDigest: release.releaseDigest,
    preObservation: deriveProgramDataObservationPdaV1(controller, controller, pre.purpose, pre.subjectDigest, pre.generation)[0],
    preObservationGeneration: pre.generation,
    preObservationRoot: pre.finalRawMerkleRoot,
    preObservationDigest: pre.observationDigest,
    preUpgradeAuthority: pre.upgradeAuthority,
    postObservation: deriveProgramDataObservationPdaV1(controller, controller, post.purpose, post.subjectDigest, post.generation)[0],
    postObservationGeneration: post.generation,
    postObservationRoot: post.finalRawMerkleRoot,
    postObservationDigest: post.observationDigest,
    postUpgradeAuthority: post.upgradeAuthority,
    deployedSlot,
    rawProgramdataLength: capacity + 45n,
    programdataCapacity: capacity,
    artifactLength,
    artifactSha256,
    artifactMerkleRoot: artifactRoot,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    sourceCommitment: release.sourceCommitment,
    buildInputsCommitment: release.buildInputsCommitment,
    packageCommitment: release.packageCommitment,
    releaseManifestCommitment: release.releaseManifestCommitment,
    finalizedSlot: post.finalizedSlot,
    receiptDigest: hash(253),
    finalized: true,
    reserved: Buffer.alloc(CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN),
  };
  value.receiptDigest = controllerImmutabilityReceiptDigestV1(value);
  return value;
}

function makeHandoffProposal(
  policy: ProgramDataCapacityPolicyV1,
  immutability: ControllerImmutabilityReceiptV1,
  bridge: ProgramDataObservationV1,
): TargetAuthorityHandoffProposalV1 {
  const value: TargetAuthorityHandoffProposalV1 = {
    discriminator: TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 1n)[1],
    initialized: true,
    state: CeremonyProposalStateV1.Completed,
    clusterDomain,
    controllerProgram: controller,
    controllerProgramdata,
    controllerImmutabilityReceipt: deriveControllerImmutabilityReceiptPdaV1(controller, target)[0],
    controllerImmutabilityDigest: immutability.receiptDigest,
    controllerConfig,
    governancePolicy,
    governancePolicyHash: hash(73),
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    gate,
    controllerAuthority,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    legacyTargetAuthority: legacyAuthority,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: artifactSha256,
    bridgeArtifactMerkleRoot: artifactRoot,
    bridgeArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    bridgeSourceCommitment: hash(74),
    bridgeBuildInputsCommitment: hash(75),
    bridgePackageCommitment: hash(76),
    bridgeReleaseManifestCommitment: hash(77),
    bridgeObservation: deriveProgramDataObservationPdaV1(controller, target, bridge.purpose, bridge.subjectDigest, bridge.generation)[0],
    bridgeObservationGeneration: bridge.generation,
    bridgeObservationRoot: bridge.finalRawMerkleRoot,
    bridgeObservationDigest: bridge.observationDigest,
    minimumTargetDeployedSlot: deployedSlot,
    minimumTargetCapacity: capacity,
    minimumTargetRawLength: capacity + 45n,
    bootstrapGateStatus: GateStatusV1.EmergencyFrozen,
    bootstrapGateEpoch: 1n,
    bootstrapFreezeReasonCode: 1,
    bootstrapFreezeSlot: 19n,
    targetNonce: 1n,
    councilVersion: 1n,
    councilHash: hash(78),
    reviewStartSlot: 31n,
    reviewEndSlot: 35n,
    notBeforeSlot: 40n,
    expirySlot: 100n,
    approvalBitset: 0b00111,
    approvalCount: 3,
    approvalThreshold: 3,
    firstApprovalSlot: 32n,
    councilApprovedSlot: 33n,
    queuedSlot: 36n,
    executedSlot: 45n,
    terminalSlot: 45n,
    terminalReasonCode: 1,
    proposalDigest: hash(254),
    creationSlot: 30n,
    reserved: Buffer.alloc(TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN),
  };
  value.proposalDigest = targetAuthorityHandoffProposalDigestV1(value);
  return value;
}

function makeHandoffReceipt(
  proposal: TargetAuthorityHandoffProposalV1,
  immutability: ControllerImmutabilityReceiptV1,
  pre: ProgramDataObservationV1,
): TargetAuthorityHandoffReceiptV1 {
  const value: TargetAuthorityHandoffReceiptV1 = {
    discriminator: TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveTargetAuthorityHandoffReceiptPdaV1(controller, target)[1],
    initialized: true,
    proposal: deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 1n)[0],
    proposalDigest: proposal.proposalDigest,
    controllerProgram: controller,
    controllerConfig,
    controllerAuthority,
    controllerImmutabilityReceipt: deriveControllerImmutabilityReceiptPdaV1(controller, target)[0],
    controllerImmutabilityDigest: immutability.receiptDigest,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    preObservation: deriveProgramDataObservationPdaV1(controller, target, pre.purpose, pre.subjectDigest, pre.generation)[0],
    preObservationGeneration: pre.generation,
    preObservationRoot: pre.finalRawMerkleRoot,
    preObservationDigest: pre.observationDigest,
    preUpgradeAuthority: pre.upgradeAuthority,
    preProgramdataHeaderSnapshot: programdataHeader(deployedSlot, present(legacyAuthority)),
    postProgramdataHeaderSnapshot: programdataHeader(deployedSlot, present(controllerAuthority)),
    postUpgradeAuthority: present(controllerAuthority),
    deployedSlot,
    rawProgramdataLength: capacity + 45n,
    programdataCapacity: capacity,
    artifactLength,
    artifactSha256,
    artifactMerkleRoot: artifactRoot,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    bridgeSourceCommitment: proposal.bridgeSourceCommitment,
    bridgeBuildInputsCommitment: proposal.bridgeBuildInputsCommitment,
    bridgePackageCommitment: proposal.bridgePackageCommitment,
    bridgeReleaseManifestCommitment: proposal.bridgeReleaseManifestCommitment,
    bootstrapGateEpoch: 1n,
    targetNonce: 1n,
    councilVersion: 1n,
    acceptedSlot: 45n,
    receiptDigest: hash(200),
    finalized: true,
    reserved: Buffer.alloc(TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN),
  };
  value.receiptDigest = targetAuthorityHandoffReceiptDigestV1(value);
  return value;
}

function makeActivationProposal(
  policy: ProgramDataCapacityPolicyV1,
  immutability: ControllerImmutabilityReceiptV1,
  handoff: TargetAuthorityHandoffReceiptV1,
  observation: ProgramDataObservationV1,
): BootstrapActivationProposalV1 {
  const value: BootstrapActivationProposalV1 = {
    discriminator: BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveBootstrapActivationProposalPdaV1(controller, target, 1n)[1],
    initialized: true,
    state: CeremonyProposalStateV1.Completed,
    clusterDomain,
    controllerProgram: controller,
    controllerProgramdata,
    controllerConfig,
    governancePolicy,
    governancePolicyHash: hash(73),
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    controllerImmutabilityReceipt: deriveControllerImmutabilityReceiptPdaV1(controller, target)[0],
    controllerImmutabilityDigest: immutability.receiptDigest,
    targetHandoffReceipt: deriveTargetAuthorityHandoffReceiptPdaV1(controller, target)[0],
    targetHandoffDigest: handoff.receiptDigest,
    gate,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: artifactSha256,
    bridgeArtifactMerkleRoot: artifactRoot,
    bridgeArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    bridgeSourceCommitment: handoff.bridgeSourceCommitment,
    bridgeBuildInputsCommitment: handoff.bridgeBuildInputsCommitment,
    bridgePackageCommitment: handoff.bridgePackageCommitment,
    bridgeReleaseManifestCommitment: handoff.bridgeReleaseManifestCommitment,
    bridgeObservation: deriveProgramDataObservationPdaV1(controller, target, observation.purpose, observation.subjectDigest, observation.generation)[0],
    bridgeObservationGeneration: observation.generation,
    bridgeObservationRoot: observation.finalRawMerkleRoot,
    bridgeObservationDigest: observation.observationDigest,
    minimumTargetDeployedSlot: deployedSlot,
    minimumTargetCapacity: capacity,
    minimumTargetRawLength: capacity + 45n,
    bootstrapGateStatus: GateStatusV1.EmergencyFrozen,
    bootstrapGateEpoch: 1n,
    bootstrapFreezeReasonCode: 1,
    bootstrapFreezeSlot: 19n,
    targetNonce: 1n,
    councilVersion: 1n,
    councilHash: hash(78),
    reviewStartSlot: 53n,
    reviewEndSlot: 57n,
    notBeforeSlot: 65n,
    expirySlot: 120n,
    approvalBitset: 0b00111,
    approvalCount: 3,
    approvalThreshold: 3,
    firstApprovalSlot: 54n,
    councilApprovedSlot: 55n,
    queuedSlot: 58n,
    executedSlot: 70n,
    terminalSlot: 70n,
    terminalReasonCode: 1,
    proposalDigest: hash(201),
    creationSlot: 52n,
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN),
  };
  value.proposalDigest = bootstrapActivationProposalDigestV1(value);
  return value;
}

function makeDeployment(
  policy: ProgramDataCapacityPolicyV1,
  release: ControllerReleaseCommitmentV1,
  observation: ProgramDataObservationV1,
): CurrentDeploymentStateV1 {
  const value: CurrentDeploymentStateV1 = {
    discriminator: CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveCurrentDeploymentStatePdaV1(controller, target)[1],
    initialized: true,
    controllerProgram: controller,
    controllerConfig,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority,
    artifactLength,
    artifactSha256,
    artifactMerkleRoot: artifactRoot,
    artifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    actualProgramdataCapacity: capacity,
    programdataObservation: deriveProgramDataObservationPdaV1(controller, target, observation.purpose, observation.subjectDigest, observation.generation)[0],
    observationGeneration: observation.generation,
    observationRoot: observation.finalRawMerkleRoot,
    observationDigest: observation.observationDigest,
    deployedSlot,
    installedAuthority: controllerAuthority,
    sourceCommitment: hash(74),
    buildInputsCommitment: hash(75),
    packageCommitment: hash(76),
    releaseManifestCommitment: hash(77),
    releaseCommitment: deriveControllerReleaseCommitmentPdaV1(controller, target)[0],
    releaseCommitmentDigest: release.releaseDigest,
    activationReceipt: present(deriveBootstrapActivationReceiptPdaV1(controller, target)[0]),
    completedProposal: absent,
    gateEpochAtActivation: 2n,
    deploymentGeneration: 1n,
    deploymentDigest: hash(202),
    lastUpdatedSlot: 70n,
    reserved: Buffer.alloc(CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN),
  };
  value.deploymentDigest = currentDeploymentDigestV1(value);
  return value;
}

function makeActivationReceipt(
  policy: ProgramDataCapacityPolicyV1,
  immutability: ControllerImmutabilityReceiptV1,
  handoff: TargetAuthorityHandoffReceiptV1,
  proposal: BootstrapActivationProposalV1,
  observation: ProgramDataObservationV1,
  deployment: CurrentDeploymentStateV1,
): BootstrapActivationReceiptV1 {
  const value: BootstrapActivationReceiptV1 = {
    discriminator: BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveBootstrapActivationReceiptPdaV1(controller, target)[1],
    initialized: true,
    proposal: deriveBootstrapActivationProposalPdaV1(controller, target, 1n)[0],
    proposalDigest: proposal.proposalDigest,
    controllerProgram: controller,
    controllerConfig,
    governancePolicy,
    governancePolicyHash: proposal.governancePolicyHash,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    controllerImmutabilityReceipt: deriveControllerImmutabilityReceiptPdaV1(controller, target)[0],
    controllerImmutabilityDigest: immutability.receiptDigest,
    targetHandoffReceipt: deriveTargetAuthorityHandoffReceiptPdaV1(controller, target)[0],
    targetHandoffDigest: handoff.receiptDigest,
    gate,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority,
    bridgeObservation: deriveProgramDataObservationPdaV1(controller, target, observation.purpose, observation.subjectDigest, observation.generation)[0],
    bridgeObservationGeneration: observation.generation,
    bridgeObservationRoot: observation.finalRawMerkleRoot,
    bridgeObservationDigest: observation.observationDigest,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: artifactSha256,
    bridgeArtifactMerkleRoot: artifactRoot,
    bridgeArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    actualTargetCapacity: capacity,
    targetDeployedSlot: deployedSlot,
    previousGateStatus: GateStatusV1.EmergencyFrozen,
    previousGateEpoch: 1n,
    previousFreezeReasonCode: 1,
    previousFreezeSlot: 19n,
    activatedGateStatus: GateStatusV1.Active,
    activatedGateEpoch: 2n,
    targetNonce: 1n,
    councilVersion: 1n,
    councilHash: hash(78),
    currentDeploymentState: deriveCurrentDeploymentStatePdaV1(controller, target)[0],
    currentDeploymentDigest: deployment.deploymentDigest,
    deploymentGeneration: 1n,
    finalizedSlot: 70n,
    receiptDigest: hash(203),
    finalized: true,
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN),
  };
  value.receiptDigest = bootstrapActivationReceiptDigestV1(value);
  return value;
}

function accountEvidence(
  role: CeremonyAccountRoleV4,
  pubkey: PublicKey,
  data: Buffer,
  finalizedSlot: bigint,
): CeremonyReceiptAccountV4 {
  return {
    role,
    pubkey: pubkey.toBase58(),
    owner: controller.toBase58(),
    executable: false,
    dataLength: data.length,
    dataSha256: createHash("sha256").update(data).digest("hex"),
    dataBase64: data.toString("base64"),
    finalizedSlot: finalizedSlot.toString(),
  };
}

function fixture(options: { sameControllerRoots?: boolean } = {}): GovernedRelease1CeremonyReceiptV4 {
  const policy = makeCapacityPolicy();
  const release = makeControllerRelease(policy);
  const controllerPre = makeObservation(policy, {
    observedProgram: controller,
    observedProgramdata: controllerProgramdata,
    purpose: ProgramDataObservationPurposeV1.ControllerImmutability,
    generation: 1n,
    authority: present(controllerInitialAuthority),
    rootSeed: 60,
    startSlot: 10n,
  });
  const controllerPost = makeObservation(policy, {
    observedProgram: controller,
    observedProgramdata: controllerProgramdata,
    purpose: ProgramDataObservationPurposeV1.ControllerImmutability,
    generation: 2n,
    authority: absent,
    rootSeed: options.sameControllerRoots ? 60 : 61,
    startSlot: 13n,
  });
  const immutability = makeImmutabilityReceipt(policy, release, controllerPre, controllerPost);
  const handoffPre = makeObservation(policy, {
    observedProgram: target,
    observedProgramdata: targetProgramdata,
    purpose: ProgramDataObservationPurposeV1.TargetHandoffBridge,
    generation: 1n,
    authority: present(legacyAuthority),
    rootSeed: 62,
    startSlot: 20n,
  });
  const handoffProposal = makeHandoffProposal(policy, immutability, handoffPre);
  const handoffReceipt = makeHandoffReceipt(handoffProposal, immutability, handoffPre);
  const activationObservation = makeObservation(policy, {
    observedProgram: target,
    observedProgramdata: targetProgramdata,
    purpose: ProgramDataObservationPurposeV1.BootstrapActivation,
    generation: 3n,
    authority: present(controllerAuthority),
    rootSeed: 64,
    startSlot: 49n,
  });
  const activationProposal = makeActivationProposal(policy, immutability, handoffReceipt, activationObservation);
  const deployment = makeDeployment(policy, release, activationObservation);
  const activationReceipt = makeActivationReceipt(policy, immutability, handoffReceipt, activationProposal, activationObservation, deployment);

  const encoded = new Map<CeremonyAccountRoleV4, readonly [PublicKey, Buffer, bigint]>([
    ["capacity-policy", [deriveCapacityPolicyPdaV1(controller, target)[0], serializeProgramDataCapacityPolicyV1(policy), 1n]],
    ["controller-release", [deriveControllerReleaseCommitmentPdaV1(controller, target)[0], serializeControllerReleaseCommitmentV1(release), 2n]],
    ["controller-pre-observation", [deriveProgramDataObservationPdaV1(controller, controller, controllerPre.purpose, controllerPre.subjectDigest, controllerPre.generation)[0], serializeProgramDataObservationV1(controllerPre), controllerPre.finalizedSlot]],
    ["controller-post-observation", [deriveProgramDataObservationPdaV1(controller, controller, controllerPost.purpose, controllerPost.subjectDigest, controllerPost.generation)[0], serializeProgramDataObservationV1(controllerPost), controllerPost.finalizedSlot]],
    ["controller-immutability-receipt", [deriveControllerImmutabilityReceiptPdaV1(controller, target)[0], serializeControllerImmutabilityReceiptV1(immutability), immutability.finalizedSlot]],
    ["handoff-proposal", [deriveTargetAuthorityHandoffProposalPdaV1(controller, target, handoffProposal.councilVersion)[0], serializeTargetAuthorityHandoffProposalV1(handoffProposal), handoffProposal.executedSlot]],
    ["handoff-pre-observation", [deriveProgramDataObservationPdaV1(controller, target, handoffPre.purpose, handoffPre.subjectDigest, handoffPre.generation)[0], serializeProgramDataObservationV1(handoffPre), handoffPre.finalizedSlot]],
    ["handoff-receipt", [deriveTargetAuthorityHandoffReceiptPdaV1(controller, target)[0], serializeTargetAuthorityHandoffReceiptV1(handoffReceipt), handoffReceipt.acceptedSlot]],
    ["activation-proposal", [deriveBootstrapActivationProposalPdaV1(controller, target, activationProposal.councilVersion)[0], serializeBootstrapActivationProposalV1(activationProposal), activationProposal.executedSlot]],
    ["activation-observation", [deriveProgramDataObservationPdaV1(controller, target, activationObservation.purpose, activationObservation.subjectDigest, activationObservation.generation)[0], serializeProgramDataObservationV1(activationObservation), activationObservation.finalizedSlot]],
    ["activation-receipt", [deriveBootstrapActivationReceiptPdaV1(controller, target)[0], serializeBootstrapActivationReceiptV1(activationReceipt), activationReceipt.finalizedSlot]],
    ["current-deployment-state", [deriveCurrentDeploymentStatePdaV1(controller, target)[0], serializeCurrentDeploymentStateV1(deployment), deployment.lastUpdatedSlot]],
  ]);
  const accounts = CEREMONY_ACCOUNT_ROLES_V4.map((role) => {
    const [pubkey, bytes, finalizedSlot] = encoded.get(role)!;
    return accountEvidence(role, pubkey, bytes, finalizedSlot);
  });
  const material: GovernedRelease1CeremonyReceiptV4Material = {
    schema: GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_SCHEMA,
    version: GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION,
    production: false,
    identityKind: "synthetic-local",
    clusterDomainHex: clusterDomain.toString("hex"),
    controllerProgram: controller.toBase58(),
    controllerProgramdata: controllerProgramdata.toBase58(),
    controllerConfig: controllerConfig.toBase58(),
    controllerAuthority: controllerAuthority.toBase58(),
    targetProgram: target.toBase58(),
    targetProgramdata: targetProgramdata.toBase58(),
    legacyAuthority: legacyAuthority.toBase58(),
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    accounts,
    controllerImmutabilityTransition: "loader-set-authority-to-none",
    checkedHandoff: {
      performed: true,
      simulated: false,
      bankPatched: false,
      controllerInstructionProgram: controller.toBase58(),
      topLevelInstructionCount: 1,
      loaderCpiKind: "set-authority-checked",
      loaderProgram: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
      loaderDataHex: "07000000",
      loaderAccounts: [
        { pubkey: targetProgramdata.toBase58(), isSigner: false, isWritable: true },
        { pubkey: legacyAuthority.toBase58(), isSigner: true, isWritable: false },
        { pubkey: controllerAuthority.toBase58(), isSigner: true, isWritable: false },
      ],
      authorityBefore: legacyAuthority.toBase58(),
      authorityAfter: controllerAuthority.toBase58(),
      acceptedSlot: "45",
    },
    formerAuthorityRejection: {
      attemptedSlot: "49",
      signatureHex: "ab".repeat(64),
      status: "failed",
      errorSha256: hashHex(90),
      authorityAfter: controllerAuthority.toBase58(),
      targetRawRootBefore: activationObservation.finalRawMerkleRoot.toString("hex"),
      targetRawRootAfter: activationObservation.finalRawMerkleRoot.toString("hex"),
    },
    bootstrapActivation: {
      transitionKind: "controller-bootstrap-activation-v1",
      bankPatched: false,
      controllerInstructionProgram: controller.toBase58(),
      topLevelInstructionCount: 1,
      innerCpiCount: 0,
      executedSlot: "70",
      gateStatusBefore: "emergency-frozen",
      gateEpochBefore: "1",
      freezeReasonBefore: 1,
      gateStatusAfter: "active",
      gateEpochAfter: "2",
      targetNonceBefore: "1",
      targetNonceAfter: "1",
    },
    postHandoffUpgradeEvents: [
      {
        slot: "49",
        authorityKind: "external-key",
        authority: legacyAuthority.toBase58(),
        status: "failed",
        artifactSha256: artifactSha256.toString("hex"),
        programdataObservationDigest: activationObservation.observationDigest.toString("hex"),
      },
      {
        slot: "80",
        authorityKind: "controller-pda",
        authority: controllerAuthority.toBase58(),
        status: "succeeded",
        artifactSha256: hashHex(91),
        programdataObservationDigest: hashHex(92),
      },
    ],
  };
  return finalizeGovernedRelease1CeremonyReceiptV4(material);
}

function rematerialize(
  receipt: GovernedRelease1CeremonyReceiptV4,
  mutate: (material: GovernedRelease1CeremonyReceiptV4Material) => void,
): GovernedRelease1CeremonyReceiptV4 {
  const { receiptDigest: _digest, ...material } = structuredClone(receipt);
  mutate(material);
  return finalizeGovernedRelease1CeremonyReceiptV4(material);
}

test("receipt v4 independently verifies the complete synthetic ceremony evidence", () => {
  const receipt = fixture();
  const verified = verifyGovernedRelease1CeremonyReceiptV4(receipt);
  assert.deepEqual(verified, {
    valid: true,
    receiptDigest: receipt.receiptDigest,
    controllerImmutable: true,
    checkedHandoff: true,
    bootstrapActivated: true,
    oldAuthorityRejected: true,
    capacity: "200",
    finalGateEpoch: "2",
  });
  assert.equal(receipt.receiptDigest, fixture().receiptDigest);
});

test("receipt v4 rejects missing or reordered mechanical evidence", () => {
  const receipt = fixture();
  const missing = rematerialize(receipt, (material) => {
    material.accounts = material.accounts.slice(0, -1);
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(missing), /every ceremony account/u);
  const reordered = rematerialize(receipt, (material) => {
    material.accounts = [material.accounts[1]!, material.accounts[0]!, ...material.accounts.slice(2)];
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(reordered), /reordered/u);
});

test("receipt v4 rejects simulated or unchecked handoff and bank-patched activation", () => {
  const receipt = fixture();
  const simulated = rematerialize(receipt, (material) => {
    (material.checkedHandoff as { simulated: boolean }).simulated = true;
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(simulated), /simulated/u);
  const unchecked = rematerialize(receipt, (material) => {
    (material.checkedHandoff as { loaderDataHex: string }).loaderDataHex = "04000000";
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(unchecked), /SetAuthorityChecked/u);
  const bankPatched = rematerialize(receipt, (material) => {
    (material.bootstrapActivation as { bankPatched: boolean }).bankPatched = true;
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(bankPatched), /bank patch/u);
});

test("receipt v4 rejects synthetic production identity and successful external-key upgrade", () => {
  const receipt = fixture();
  const production = rematerialize(receipt, (material) => {
    material.production = true;
    material.identityKind = "production";
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(production), /synthetic/u);
  const externalSuccess = rematerialize(receipt, (material) => {
    material.postHandoffUpgradeEvents = material.postHandoffUpgradeEvents.map((event, index) =>
      index === 0 ? { ...event, status: "succeeded" } : event,
    );
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(externalSuccess), /direct external-key upgrade/u);
});

test("receipt v4 rejects same pre/post raw roots for authority transitions", () => {
  assert.throws(() => fixture({ sameControllerRoots: true }), /distinct ordered pre\/post observations/u);
});

test("receipt v4 rejects stale observations, omitted finalization, and nonzero-tail evidence", () => {
  const receipt = fixture();
  const stale = rematerialize(receipt, (material) => {
    const evidence = material.accounts.find((entry) => entry.role === "activation-observation")!;
    const bytes = Buffer.from(evidence.dataBase64, "base64");
    bytes[1_264] = ProgramDataObservationStatusV1.Stale;
    evidence.dataBase64 = bytes.toString("base64");
    evidence.dataSha256 = createHash("sha256").update(bytes).digest("hex");
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(stale), /stale|observation/u);
  const omittedFinalization = rematerialize(receipt, (material) => {
    const evidence = material.accounts.find((entry) => entry.role === "activation-receipt")!;
    const bytes = Buffer.from(evidence.dataBase64, "base64");
    bytes[967] = 0;
    evidence.dataBase64 = bytes.toString("base64");
    evidence.dataSha256 = createHash("sha256").update(bytes).digest("hex");
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(omittedFinalization), /incomplete|codec/u);
  const nonzeroTail = rematerialize(receipt, (material) => {
    const evidence = material.accounts.find((entry) => entry.role === "activation-observation")!;
    const bytes = Buffer.from(evidence.dataBase64, "base64");
    // tail_bytes_verified is the u64 at byte offset 1168 after the gate snapshot.
    bytes.writeBigUInt64LE(99n, 1_168);
    evidence.dataBase64 = bytes.toString("base64");
    evidence.dataSha256 = createHash("sha256").update(bytes).digest("hex");
  });
  assert.throws(() => verifyGovernedRelease1CeremonyReceiptV4(nonzeroTail), /tail|observation/u);
});
