import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { GateStatusV1 } from "./release1.js";
import * as v2 from "./release1GovernanceV2.js";

const key = (byte: number): PublicKey => new PublicKey(Buffer.alloc(32, byte));
const hash = (byte: number): Buffer => Buffer.alloc(32, byte);

const controller = key(1);
const config = key(2);
const target = key(3);
const profilePda = v2.deriveGovernanceTimingProfilePdaV1(controller, target, 1n)[0];
const registryPda = v2.deriveGovernanceLifecycleRegistryPdaV2(controller, target)[0];

function nominalProfile(): v2.GovernanceTimingProfileV1 {
  return v2.nominalGovernanceTimingProfileV1({
    bump: v2.deriveGovernanceTimingProfilePdaV1(controller, target, 1n)[1],
    controllerConfig: config,
    targetProgram: target,
    creationCouncilVersion: 7n,
    creationSlot: 1_000_000n,
  });
}

function draftLifecycle(proposalId: bigint, profile: v2.GovernanceTimingProfileV1): v2.GovernanceProposalLifecycleFieldsV2 {
  const timing = v2.deriveProposalTimingV2(profile, v2.GovernanceTimingClassV1.Routine, 2_000_000n);
  return {
    state: v2.GovernanceLifecycleStateV2.Draft,
    proposalId,
    reviewDurationSlots: timing.reviewSlots,
    delayDurationSlots: timing.delaySlots,
    expiryDurationSlots: timing.expirySlots,
    creationSlot: timing.creationSlot,
    reviewStartSlot: timing.reviewStartSlot,
    reviewEndSlot: timing.reviewEndSlot,
    notBeforeSlot: timing.notBeforeSlot,
    expirySlot: timing.expirySlot,
    approvalBitset: 0,
    approvalCount: 0,
    approvalThreshold: 3,
    cancellationBitset: 0,
    cancellationCount: 0,
    cancellationThreshold: 3,
    firstApprovalSlot: 0n,
    councilApprovedSlot: 0n,
    queuedSlot: 0n,
    executedSlot: 0n,
    terminalSlot: 0n,
    terminalReasonCode: 0,
    proposalDigest: Buffer.alloc(32),
  };
}

function timingPolicyProposal(): v2.TimingPolicyChangeProposalV1 {
  const profile = nominalProfile();
  const proposal: v2.TimingPolicyChangeProposalV1 = {
    discriminator: v2.TIMING_POLICY_CHANGE_PROPOSAL_V1_DISCRIMINATOR,
    version: v2.GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION,
    bump: v2.deriveGovernanceActionProposalPdaV2(controller, target, v2.GovernanceActionKindV2.TimingPolicyChange, 11n)[1],
    initialized: true,
    ...draftLifecycle(11n, profile),
    controllerConfig: config,
    targetProgram: target,
    lifecycleRegistry: registryPda,
    creationCouncil: key(4),
    creationCouncilVersion: 7n,
    creationCouncilHash: hash(5),
    governingTimingProfile: profilePda,
    governingTimingProfileVersion: 1n,
    governingTimingProfileHash: profile.profileHash,
    candidateTimingProfile: v2.deriveGovernanceTimingProfilePdaV1(controller, target, 3n)[0],
    candidateTimingProfileVersion: 3n,
    candidateTimingProfileHash: hash(6),
    reserved: Buffer.alloc(v2.TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN),
  };
  proposal.proposalDigest = v2.timingPolicyChangeProposalDigestV1(proposal);
  return proposal;
}

function rotationProposal(): v2.CouncilRotationProposalV2 {
  const profile = nominalProfile();
  const proposal: v2.CouncilRotationProposalV2 = {
    discriminator: v2.COUNCIL_ROTATION_PROPOSAL_V2_DISCRIMINATOR,
    version: v2.GOVERNANCE_V2_ACCOUNT_VERSION,
    bump: v2.deriveGovernanceActionProposalPdaV2(controller, target, v2.GovernanceActionKindV2.CouncilRotation, 12n)[1],
    initialized: true,
    ...draftLifecycle(12n, profile),
    controllerConfig: config,
    targetProgram: target,
    lifecycleRegistry: registryPda,
    governingTimingProfile: profilePda,
    governingTimingProfileVersion: 1n,
    governingTimingProfileHash: profile.profileHash,
    currentCouncil: key(7),
    currentCouncilVersion: 7n,
    currentCouncilHash: hash(8),
    candidateCouncil: key(9),
    candidateCouncilVersion: 9n,
    candidateCouncilHash: hash(10),
    rotationNonce: 4n,
    reserved: Buffer.alloc(v2.COUNCIL_ROTATION_PROPOSAL_V2_RESERVED_LEN),
  };
  proposal.proposalDigest = v2.councilRotationProposalDigestV2(proposal);
  return proposal;
}

function handoffProposal(): v2.TargetAuthorityHandoffProposalV2 {
  const profile = nominalProfile();
  const proposal: v2.TargetAuthorityHandoffProposalV2 = {
    discriminator: v2.TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_DISCRIMINATOR,
    version: v2.GOVERNANCE_V2_ACCOUNT_VERSION,
    bump: v2.deriveGovernanceActionProposalPdaV2(controller, target, v2.GovernanceActionKindV2.TargetAuthorityHandoff, 13n)[1],
    initialized: true,
    ...draftLifecycle(13n, profile),
    lifecycleRegistry: registryPda,
    governingTimingProfile: profilePda,
    governingTimingProfileVersion: 1n,
    governingTimingProfileHash: profile.profileHash,
    clusterDomain: hash(11),
    controllerProgram: controller,
    controllerProgramdata: key(12),
    controllerImmutabilityReceipt: key(13),
    controllerImmutabilityDigest: hash(14),
    controllerConfig: config,
    governancePolicy: key(15),
    governancePolicyHash: hash(16),
    capacityPolicy: key(17),
    capacityPolicyDigest: hash(18),
    gate: key(19),
    controllerAuthority: key(20),
    targetProgram: target,
    targetProgramdata: key(21),
    upgradeableLoader: key(22),
    legacyTargetAuthority: key(23),
    bridgeArtifactLength: 1_200_000n,
    bridgeArtifactSha256: hash(24),
    bridgeArtifactMerkleRoot: hash(25),
    bridgeArtifactSchemeId: hash(26),
    bridgeSourceCommitment: hash(27),
    bridgeBuildInputsCommitment: hash(28),
    bridgePackageCommitment: hash(29),
    bridgeReleaseManifestCommitment: hash(30),
    bridgeObservation: key(31),
    bridgeObservationGeneration: 2n,
    bridgeObservationRoot: hash(32),
    bridgeObservationDigest: hash(33),
    minimumTargetDeployedSlot: 100n,
    minimumTargetCapacity: 1_300_000n,
    minimumTargetRawLength: 1_300_045n,
    bootstrapGateStatus: GateStatusV1.EmergencyFrozen,
    bootstrapGateEpoch: 1n,
    bootstrapFreezeReasonCode: 9,
    bootstrapFreezeSlot: 99n,
    targetNonce: 1n,
    councilVersion: 7n,
    councilHash: hash(34),
    reserved: Buffer.alloc(v2.TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_RESERVED_LEN),
  };
  proposal.proposalDigest = v2.targetAuthorityHandoffProposalDigestV2(proposal);
  return proposal;
}

function activationProposal(): v2.BootstrapActivationProposalV2 {
  const handoff = handoffProposal();
  const proposal: v2.BootstrapActivationProposalV2 = {
    discriminator: v2.BOOTSTRAP_ACTIVATION_PROPOSAL_V2_DISCRIMINATOR,
    version: v2.GOVERNANCE_V2_ACCOUNT_VERSION,
    bump: v2.deriveGovernanceActionProposalPdaV2(controller, target, v2.GovernanceActionKindV2.BootstrapActivation, 14n)[1],
    initialized: true,
    ...draftLifecycle(14n, nominalProfile()),
    lifecycleRegistry: handoff.lifecycleRegistry,
    governingTimingProfile: handoff.governingTimingProfile,
    governingTimingProfileVersion: handoff.governingTimingProfileVersion,
    governingTimingProfileHash: handoff.governingTimingProfileHash,
    clusterDomain: handoff.clusterDomain,
    controllerProgram: handoff.controllerProgram,
    controllerProgramdata: handoff.controllerProgramdata,
    controllerConfig: handoff.controllerConfig,
    governancePolicy: handoff.governancePolicy,
    governancePolicyHash: handoff.governancePolicyHash,
    capacityPolicy: handoff.capacityPolicy,
    capacityPolicyDigest: handoff.capacityPolicyDigest,
    controllerImmutabilityReceipt: handoff.controllerImmutabilityReceipt,
    controllerImmutabilityDigest: handoff.controllerImmutabilityDigest,
    targetHandoffReceipt: key(35),
    targetHandoffDigest: hash(36),
    gate: handoff.gate,
    targetProgram: handoff.targetProgram,
    targetProgramdata: handoff.targetProgramdata,
    upgradeableLoader: handoff.upgradeableLoader,
    controllerAuthority: handoff.controllerAuthority,
    bridgeArtifactLength: handoff.bridgeArtifactLength,
    bridgeArtifactSha256: handoff.bridgeArtifactSha256,
    bridgeArtifactMerkleRoot: handoff.bridgeArtifactMerkleRoot,
    bridgeArtifactSchemeId: handoff.bridgeArtifactSchemeId,
    bridgeSourceCommitment: handoff.bridgeSourceCommitment,
    bridgeBuildInputsCommitment: handoff.bridgeBuildInputsCommitment,
    bridgePackageCommitment: handoff.bridgePackageCommitment,
    bridgeReleaseManifestCommitment: handoff.bridgeReleaseManifestCommitment,
    bridgeObservation: handoff.bridgeObservation,
    bridgeObservationGeneration: handoff.bridgeObservationGeneration,
    bridgeObservationRoot: handoff.bridgeObservationRoot,
    bridgeObservationDigest: handoff.bridgeObservationDigest,
    minimumTargetDeployedSlot: handoff.minimumTargetDeployedSlot,
    minimumTargetCapacity: handoff.minimumTargetCapacity,
    minimumTargetRawLength: handoff.minimumTargetRawLength,
    bootstrapGateStatus: handoff.bootstrapGateStatus,
    bootstrapGateEpoch: handoff.bootstrapGateEpoch,
    bootstrapFreezeReasonCode: handoff.bootstrapFreezeReasonCode,
    bootstrapFreezeSlot: handoff.bootstrapFreezeSlot,
    targetNonce: handoff.targetNonce,
    councilVersion: handoff.councilVersion,
    councilHash: handoff.councilHash,
    reserved: Buffer.alloc(v2.BOOTSTRAP_ACTIVATION_PROPOSAL_V2_RESERVED_LEN),
  };
  proposal.proposalDigest = v2.bootstrapActivationProposalDigestV2(proposal);
  return proposal;
}

test("V2 nominal profile has four checked timing classes and actual-slot boundaries", () => {
  const profile = nominalProfile();
  assert.equal(profile.routine.reviewSlots, v2.NOMINAL_SLOTS_PER_WEEK_V1);
  assert.equal(profile.major.reviewSlots, 2n * v2.NOMINAL_SLOTS_PER_WEEK_V1);
  assert.equal(profile.constitutional.reviewSlots, 4n * v2.NOMINAL_SLOTS_PER_WEEK_V1);
  assert.equal(profile.emergencyRollback.delaySlots, 4_500n);
  assert.equal(profile.routine.delaySlots, 4_500n);
  assert.equal(profile.major.delaySlots, 9_000n);
  assert.equal(profile.constitutional.delaySlots, 18_000n);
  const laterCreation = { ...profile, creationSlot: 9_000_000n };
  assert.deepEqual(v2.governanceTimingProfileHashV1(laterCreation), profile.profileHash);
  v2.validateGovernanceTimingProfileV1(laterCreation);
  const encodedLater = v2.serializeGovernanceTimingProfileV1(laterCreation);
  assert.notDeepEqual(encodedLater, v2.serializeGovernanceTimingProfileV1(profile));
  assert.equal(v2.deserializeGovernanceTimingProfileV1(encodedLater).creationSlot, 9_000_000n);
  const derived = v2.deriveProposalTimingV2(profile, v2.GovernanceTimingClassV1.Routine, 8_000_000n);
  assert.equal(derived.reviewStartSlot, 8_000_000n);
  assert.equal(derived.reviewEndSlot, 8_000_000n + v2.NOMINAL_SLOTS_PER_WEEK_V1);
  assert.equal(derived.notBeforeSlot, 8_004_500n);
  assert.throws(() => v2.validateGovernanceTimingDurationsV1({
    reviewSlots: v2.MINIMUM_REVIEW_SLOTS_V1,
    delaySlots: v2.MINIMUM_DELAY_SLOTS_V1,
    expirySlots: v2.MINIMUM_REVIEW_SLOTS_V1 + v2.MINIMUM_EXECUTION_MARGIN_SLOTS_V1,
  }), /must exceed/);
  assert.throws(() => v2.deriveProposalTimingV2(profile, v2.GovernanceTimingClassV1.Routine, 0xffff_ffff_ffff_ffffn), /overflow/);
});

test("Rust and TypeScript V2 profile, proposal, and PDA vectors match", () => {
  const rustProfile = v2.nominalGovernanceTimingProfileV1({
    bump: 254,
    controllerConfig: key(1),
    targetProgram: key(2),
    creationCouncilVersion: 1n,
    creationSlot: 10n,
  });
  assert.equal(
    rustProfile.profileHash.toString("hex"),
    "b206b4639e1867dda2895a8089393df2deb13eeb0562e7ba6d2dc0443f221182",
  );

  const timing = v2.deriveProposalTimingV2(
    rustProfile,
    v2.GovernanceTimingClassV1.Constitutional,
    100n,
  );
  const proposal: v2.TimingPolicyChangeProposalV1 = {
    discriminator: v2.TIMING_POLICY_CHANGE_PROPOSAL_V1_DISCRIMINATOR,
    version: v2.GOVERNANCE_TIMING_PROFILE_ACCOUNT_VERSION,
    bump: 201,
    initialized: true,
    state: v2.GovernanceLifecycleStateV2.Draft,
    proposalId: 7n,
    controllerConfig: key(1),
    targetProgram: key(2),
    lifecycleRegistry: key(3),
    creationCouncil: key(4),
    creationCouncilVersion: 2n,
    creationCouncilHash: hash(5),
    governingTimingProfile: key(6),
    governingTimingProfileVersion: 1n,
    governingTimingProfileHash: rustProfile.profileHash,
    candidateTimingProfile: key(7),
    candidateTimingProfileVersion: 3n,
    candidateTimingProfileHash: hash(8),
    reviewDurationSlots: timing.reviewSlots,
    delayDurationSlots: timing.delaySlots,
    expiryDurationSlots: timing.expirySlots,
    creationSlot: timing.creationSlot,
    reviewStartSlot: timing.reviewStartSlot,
    reviewEndSlot: timing.reviewEndSlot,
    notBeforeSlot: timing.notBeforeSlot,
    expirySlot: timing.expirySlot,
    approvalBitset: 0,
    approvalCount: 0,
    approvalThreshold: 3,
    cancellationBitset: 0,
    cancellationCount: 0,
    cancellationThreshold: 3,
    firstApprovalSlot: 0n,
    councilApprovedSlot: 0n,
    queuedSlot: 0n,
    executedSlot: 0n,
    terminalSlot: 0n,
    terminalReasonCode: 0,
    proposalDigest: Buffer.alloc(32),
    reserved: Buffer.alloc(v2.TIMING_POLICY_CHANGE_PROPOSAL_V1_RESERVED_LEN),
  };
  proposal.proposalDigest = v2.timingPolicyChangeProposalDigestV1(proposal);
  v2.validateTimingPolicyChangeProposalV1(proposal);
  assert.equal(
    proposal.proposalDigest.toString("hex"),
    "2c3c08f7f99d09297eb266142c0f8857de9ce258218995d1d41822c101346a13",
  );

  const rustController = key(9);
  const rustTarget = key(10);
  assert.equal(
    v2.deriveGovernanceLifecycleRegistryPdaV2(rustController, rustTarget)[0].toBase58(),
    "6hX43xoXUUtFMGmBMwE9u744ECmkyiuTcvsU3e4SD19X",
  );
  assert.equal(
    v2.deriveGovernanceTimingProfilePdaV1(rustController, rustTarget, 1n)[0].toBase58(),
    "2xwLZqxM6hNJMuMcCULBHvmsr61Wmk7L51yi5qoFAviw",
  );
  assert.equal(
    v2.deriveGovernanceActionProposalPdaV2(
      rustController,
      rustTarget,
      v2.GovernanceActionKindV2.TargetAuthorityHandoff,
      7n,
    )[0].toBase58(),
    "6rZgfEMjaYVfsQghBf7LPFrYzMzTVDJGMnQVMdb2kQMU",
  );
});

test("V2 fixed accounts round-trip at exact lengths", () => {
  const profile = nominalProfile();
  const registry: v2.GovernanceLifecycleRegistryV2 = {
    discriminator: v2.GOVERNANCE_LIFECYCLE_REGISTRY_V2_DISCRIMINATOR,
    version: v2.GOVERNANCE_V2_ACCOUNT_VERSION,
    bump: v2.deriveGovernanceLifecycleRegistryPdaV2(controller, target)[1],
    initialized: true,
    controllerProgram: controller,
    controllerConfig: config,
    targetProgram: target,
    currentTimingProfile: profilePda,
    currentTimingProfileVersion: 1n,
    currentTimingProfileHash: profile.profileHash,
    nextProposalId: 1n,
    nextTimingProfileVersion: 2n,
    rotationNonce: 1n,
    lastPolicyChangeProposal: PublicKey.default,
    creationSlot: 1_000_000n,
    reserved: Buffer.alloc(v2.GOVERNANCE_LIFECYCLE_REGISTRY_V2_RESERVED_LEN),
  };
  const cases = [
    [v2.serializeGovernanceLifecycleRegistryV2(registry), v2.GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, v2.deserializeGovernanceLifecycleRegistryV2],
    [v2.serializeGovernanceTimingProfileV1(profile), v2.GOVERNANCE_TIMING_PROFILE_V1_LEN, v2.deserializeGovernanceTimingProfileV1],
    [v2.serializeTimingPolicyChangeProposalV1(timingPolicyProposal()), v2.TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN, v2.deserializeTimingPolicyChangeProposalV1],
    [v2.serializeCouncilRotationProposalV2(rotationProposal()), v2.COUNCIL_ROTATION_PROPOSAL_V2_LEN, v2.deserializeCouncilRotationProposalV2],
    [v2.serializeTargetAuthorityHandoffProposalV2(handoffProposal()), v2.TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, v2.deserializeTargetAuthorityHandoffProposalV2],
    [v2.serializeBootstrapActivationProposalV2(activationProposal()), v2.BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN, v2.deserializeBootstrapActivationProposalV2],
  ] as const;
  for (const [encoded, length, decode] of cases) {
    assert.equal(encoded.length, length);
    assert.deepEqual((decode as (value: Uint8Array) => unknown)(encoded), (decode as (value: Uint8Array) => unknown)(encoded));
  }
  assert.throws(() => v2.serializeGovernanceLifecycleRegistryV2({ ...registry, rotationNonce: 0n }), /registry counters/);
});

test("V2 proposal identity is monotonic and independent of council version", () => {
  const kind = v2.GovernanceActionKindV2.TargetAuthorityHandoff;
  const first = v2.deriveGovernanceActionProposalPdaV2(controller, target, kind, 1n)[0];
  const second = v2.deriveGovernanceActionProposalPdaV2(controller, target, kind, 2n)[0];
  const rotation = v2.deriveGovernanceActionProposalPdaV2(controller, target, v2.GovernanceActionKindV2.CouncilRotation, 1n)[0];
  assert.notEqual(first.toBase58(), second.toBase58());
  assert.notEqual(first.toBase58(), rotation.toBase58());
});

test("Cancelled and Expired are terminal immutable-history states", () => {
  const draft = timingPolicyProposal();
  const cancelled: v2.TimingPolicyChangeProposalV1 = {
    ...draft,
    state: v2.GovernanceLifecycleStateV2.Cancelled,
    cancellationBitset: 0b0_0111,
    cancellationCount: 3,
    terminalSlot: draft.creationSlot + 10n,
    terminalReasonCode: 41,
  };
  v2.validateTimingPolicyChangeProposalV1(cancelled);
  const expired: v2.TimingPolicyChangeProposalV1 = {
    ...draft,
    state: v2.GovernanceLifecycleStateV2.Expired,
    terminalSlot: draft.expirySlot,
    terminalReasonCode: 42,
  };
  v2.validateTimingPolicyChangeProposalV1(expired);
  assert.throws(() => v2.validateTimingPolicyChangeProposalV1({ ...cancelled, cancellationCount: 2 }), /bitset\/count mismatch/);
});

test("V2 instruction tags 82 through 107 are exact and creation omits a clock slot", () => {
  const guard: v2.GovernanceActionGuardV2 = {
    proposalId: 9n,
    expectedProposalDigest: hash(1),
    expectedCouncilVersion: 2n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: hash(2),
  };
  const envelope = {
    computeUnitLimit: 1_000_000,
    computeUnitPriceMicroLamports: 1n,
    durableNonceAccount: { present: false, value: PublicKey.default },
    durableNonceAuthority: { present: false, value: PublicKey.default },
  };
  const profile = nominalProfile();
  const instructions: Buffer[] = [
    v2.encodeInitializeGovernanceLifecycleRegistryV2({ expectedInitialTimingProfileVersion: 1n, expectedInitialTimingProfileHash: profile.profileHash, expectedInitialNextProposalId: 1n, expectedInitialRotationNonce: 1n }),
    v2.encodeCreateGovernanceTimingProfileV1({ profileVersion: 1n, predecessorProfileHash: Buffer.alloc(32), emergencyRollback: profile.emergencyRollback, routine: profile.routine, major: profile.major, constitutional: profile.constitutional }),
    v2.encodeCreateTimingPolicyChangeProposalV1({ expectedProposalId: 1n, expectedCurrentTimingProfileVersion: 1n, expectedCurrentTimingProfileHash: profile.profileHash, candidateTimingProfileVersion: 3n, candidateTimingProfileHash: hash(3), expectedCouncilVersion: 2n, expectedCouncilHash: hash(4) }),
    v2.encodeApproveTimingPolicyChangeProposalV1({ guard }),
    v2.encodeCancelTimingPolicyChangeProposalV1({ guard, cancellationReasonCode: 1 }),
    v2.encodeExpireTimingPolicyChangeProposalV1({ guard }),
    v2.encodeQueueTimingPolicyChangeProposalV1({ guard }),
    v2.encodeExecuteTimingPolicyChangeProposalV1({ guard }),
    v2.encodeCreateCouncilRotationProposalV2({ expectedProposalId: 2n, expectedCurrentCouncilVersion: 2n, expectedCurrentCouncilHash: hash(5), candidateCouncilVersion: 4n, candidateCouncilHash: hash(6), expectedRotationNonce: 1n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash }),
    v2.encodeApproveCouncilRotationProposalV2({ guard }),
    v2.encodeCancelCouncilRotationProposalV2({ guard, cancellationReasonCode: 2 }),
    v2.encodeExpireCouncilRotationProposalV2({ guard }),
    v2.encodeQueueCouncilRotationProposalV2({ guard }),
    v2.encodeExecuteCouncilRotationProposalV2({ guard }),
    v2.encodeCreateTargetAuthorityHandoffProposalV2({ expectedProposalId: 3n, expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedCouncilVersion: 2n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash, bridgeSourceCommitment: hash(7), bridgeBuildInputsCommitment: hash(8), bridgePackageCommitment: hash(9), bridgeReleaseManifestCommitment: hash(10) }),
    v2.encodeApproveTargetAuthorityHandoffProposalV2({ guard }),
    v2.encodeCancelTargetAuthorityHandoffProposalV2({ guard, cancellationReasonCode: 3 }),
    v2.encodeExpireTargetAuthorityHandoffProposalV2({ guard }),
    v2.encodeQueueTargetAuthorityHandoffProposalV2({ guard }),
    v2.encodeExecuteTargetAuthorityHandoffProposalV2({ guard, expectedBridgeObservationDigest: hash(11), expectedGateEpoch: 1n, expectedTargetNonce: 1n, envelope }),
    v2.encodeCreateBootstrapActivationProposalV2({ expectedProposalId: 4n, expectedControllerImmutabilityDigest: hash(12), expectedHandoffReceiptDigest: hash(13), expectedBridgeObservationDigest: hash(14), expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedCouncilVersion: 2n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash }),
    v2.encodeApproveBootstrapActivationProposalV2({ guard }),
    v2.encodeCancelBootstrapActivationProposalV2({ guard, cancellationReasonCode: 4 }),
    v2.encodeExpireBootstrapActivationProposalV2({ guard }),
    v2.encodeQueueBootstrapActivationProposalV2({ guard }),
    v2.encodeExecuteBootstrapActivationProposalV2({ guard, expectedBridgeObservationDigest: hash(15), expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedDeploymentPlanDigest: hash(16), expectedReceiptPlanDigest: hash(17), envelope }),
  ];
  assert.deepEqual(instructions.map((instruction) => instruction[0]), Array.from({ length: 26 }, (_, index) => 82 + index));
  for (const instruction of instructions) assert.doesNotThrow(() => v2.decodeRelease1GovernanceV2Instruction(instruction));
  assert.equal(instructions[2]!.length, v2.CREATE_TIMING_POLICY_CHANGE_PROPOSAL_V1_LEN);
  assert.equal(instructions[2]!.includes(Buffer.from([0x40, 0x42, 0x0f, 0, 0, 0, 0, 0])), false, "creation payload carries no predicted creation slot");
  assert.throws(() => v2.encodeInitializeGovernanceLifecycleRegistryV2({ expectedInitialTimingProfileVersion: 1n, expectedInitialTimingProfileHash: profile.profileHash, expectedInitialNextProposalId: 1n, expectedInitialRotationNonce: 0n }), /start at one/);
});
