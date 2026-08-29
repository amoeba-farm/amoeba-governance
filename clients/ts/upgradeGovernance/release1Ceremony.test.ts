import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { ARTIFACT_MERKLE_SCHEME_ID } from "./artifactMerkleV1.js";
import { PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1 } from "./programDataObservationMerkleV1.js";
import {
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN,
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN,
  CeremonyPlanOperationV1,
  CeremonyProposalStateV1,
  MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
  PROGRAMDATA_CAPACITY_POLICY_V1_DISCRIMINATOR,
  PROGRAMDATA_CAPACITY_POLICY_V1_LEN,
  PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN,
  PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR,
  PROGRAMDATA_OBSERVATION_V1_LEN,
  PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN,
  bootstrapActivationProposalDigestV1,
  deriveBootstrapActivationProposalPdaV1,
  deriveCapacityPolicyPdaV1,
  deriveProgramDataObservationPdaV1,
  deriveTargetAuthorityHandoffProposalPdaV1,
  deserializeBootstrapActivationProposalV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  deserializeTargetAuthorityHandoffProposalV1,
  programDataCapacityPolicyDigestV1,
  programDataObservationDigestV1,
  release1CeremonyOperationIdV1,
  serializeBootstrapActivationProposalV1,
  serializeProgramDataCapacityPolicyV1,
  serializeProgramDataObservationV1,
  serializeTargetAuthorityHandoffProposalV1,
  targetAuthorityHandoffProposalDigestV1,
  validateBootstrapActivationProposalDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
  validateRelease1CeremonyPlanV1,
  validateTargetAuthorityHandoffProposalDigestV1,
  type BootstrapActivationProposalV1,
  type ProgramDataCapacityPolicyV1,
  type ProgramDataObservationV1,
  type Release1CeremonyPlanV1,
  type TargetAuthorityHandoffProposalV1,
} from "./release1Ceremony.js";
import {
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
  GateStatusV1,
} from "./release1.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

const key = (seed: number): PublicKey => new PublicKey(Buffer.alloc(32, seed));
const hash = (seed: number): Buffer => Buffer.alloc(32, seed);
const absent = { present: false, value: PublicKey.default } as const;
const present = (value: PublicKey) => ({ present: true, value }) as const;

const controller = SYNTHETIC_CONTROLLER_PROGRAM_V1;
const controllerConfig = key(2);
const target = key(3);
const targetProgramdata = key(4);
const controllerAuthority = key(5);
const legacyAuthority = key(6);
const controllerProgramdata = key(7);
const governancePolicy = key(8);
const gate = key(9);
const extendFeature = key(10);
const setAuthorityFeature = key(11);
const artifactLength = 100n;
const capacity = 200n;
const deployedSlot = 7n;

function capacityPolicy(): ProgramDataCapacityPolicyV1 {
  const [capacityPolicyPda, bump] = deriveCapacityPolicyPdaV1(controller, target);
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
    maximumPayloadCapacity: MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1,
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
    extendProgramCheckedFeature: extendFeature,
    setAuthorityCheckedFeature: setAuthorityFeature,
    policyDigest: hash(250),
    creationSlot: 1n,
    reserved: Buffer.alloc(PROGRAMDATA_CAPACITY_POLICY_V1_RESERVED_LEN),
  };
  value.policyDigest = programDataCapacityPolicyDigestV1(value);
  assert.ok(capacityPolicyPda);
  return value;
}

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

function observation(
  purpose: ProgramDataObservationPurposeV1,
  generation: bigint,
  authority: ReturnType<typeof present> | typeof absent,
  rootSeed: number,
): ProgramDataObservationV1 {
  const policy = capacityPolicy();
  const subject = key(20 + Number(generation));
  const value: ProgramDataObservationV1 = {
    discriminator: PROGRAMDATA_OBSERVATION_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveProgramDataObservationPdaV1(controller, target, purpose, generation)[1],
    initialized: true,
    controllerProgram: controller,
    controllerConfig,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: policy.policyDigest,
    purpose,
    subject,
    subjectDigest: hash(30 + Number(generation)),
    generation,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    programOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    programExecutable: true,
    programDataLength: 36n,
    programHeaderPresent: true,
    programHeaderSnapshot: programHeader(targetProgramdata),
    linkedProgramdata: targetProgramdata,
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
    expectedArtifactSha256: hash(40),
    expectedArtifactMerkleRoot: hash(41),
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
    rawFrontier: [hash(50 + Number(generation)), ...Array.from({ length: 10 }, () => Buffer.alloc(32))],
    rawFrontierMask: 1,
    nextArtifactChunkIndex: 1,
    tailBytesVerified: capacity - artifactLength,
    startSlot: 10n + generation * 3n,
    lastObservedSlot: 11n + generation * 3n,
    finalizedSlot: 12n + generation * 3n,
    finalRawMerkleRoot: hash(rootSeed),
    observationDigest: hash(251),
    status: ProgramDataObservationStatusV1.Finalized,
    reserved: Buffer.alloc(PROGRAMDATA_OBSERVATION_V1_RESERVED_LEN),
  };
  value.observationDigest = programDataObservationDigestV1(value);
  return value;
}

function handoffProposal(mask = 0b00111): TargetAuthorityHandoffProposalV1 {
  const bridge = observation(ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n, present(legacyAuthority), 61);
  const value: TargetAuthorityHandoffProposalV1 = {
    discriminator: TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 1n)[1],
    initialized: true,
    state: CeremonyProposalStateV1.Completed,
    clusterDomain: hash(70),
    controllerProgram: controller,
    controllerProgramdata,
    controllerImmutabilityReceipt: key(71),
    controllerImmutabilityDigest: hash(72),
    controllerConfig,
    governancePolicy,
    governancePolicyHash: hash(73),
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: capacityPolicy().policyDigest,
    gate,
    controllerAuthority,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    legacyTargetAuthority: legacyAuthority,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: hash(40),
    bridgeArtifactMerkleRoot: hash(41),
    bridgeArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    bridgeSourceCommitment: hash(74),
    bridgeBuildInputsCommitment: hash(75),
    bridgePackageCommitment: hash(76),
    bridgeReleaseManifestCommitment: hash(77),
    bridgeObservation: deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n)[0],
    bridgeObservationGeneration: 1n,
    bridgeObservationRoot: bridge.finalRawMerkleRoot,
    bridgeObservationDigest: bridge.observationDigest,
    expectedTargetDeployedSlot: deployedSlot,
    expectedTargetCapacity: capacity,
    expectedTargetRawLength: capacity + 45n,
    bootstrapGateStatus: GateStatusV1.EmergencyFrozen,
    bootstrapGateEpoch: 1n,
    bootstrapFreezeReasonCode: BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
    bootstrapFreezeSlot: 19n,
    targetNonce: 1n,
    councilVersion: 1n,
    councilHash: hash(78),
    reviewStartSlot: 21n,
    reviewEndSlot: 25n,
    notBeforeSlot: 30n,
    expirySlot: 100n,
    approvalBitset: mask,
    approvalCount: mask.toString(2).split("1").length - 1,
    approvalThreshold: 3,
    firstApprovalSlot: 22n,
    councilApprovedSlot: 23n,
    queuedSlot: 26n,
    executedSlot: 35n,
    terminalSlot: 35n,
    terminalReasonCode: 1,
    proposalDigest: hash(252),
    creationSlot: 20n,
    reserved: Buffer.alloc(TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN),
  };
  value.proposalDigest = targetAuthorityHandoffProposalDigestV1(value);
  return value;
}

function activationProposal(): BootstrapActivationProposalV1 {
  const bridge = observation(ProgramDataObservationPurposeV1.BootstrapActivation, 3n, present(controllerAuthority), 63);
  const value: BootstrapActivationProposalV1 = {
    discriminator: BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
    version: 1,
    bump: deriveBootstrapActivationProposalPdaV1(controller, target, 1n)[1],
    initialized: true,
    state: CeremonyProposalStateV1.Completed,
    clusterDomain: hash(70),
    controllerProgram: controller,
    controllerProgramdata,
    controllerConfig,
    governancePolicy,
    governancePolicyHash: hash(73),
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: capacityPolicy().policyDigest,
    controllerImmutabilityReceipt: key(71),
    controllerImmutabilityDigest: hash(72),
    targetHandoffReceipt: key(79),
    targetHandoffDigest: hash(80),
    gate,
    targetProgram: target,
    targetProgramdata,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: hash(40),
    bridgeArtifactMerkleRoot: hash(41),
    bridgeArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    bridgeSourceCommitment: hash(74),
    bridgeBuildInputsCommitment: hash(75),
    bridgePackageCommitment: hash(76),
    bridgeReleaseManifestCommitment: hash(77),
    bridgeObservation: deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.BootstrapActivation, 3n)[0],
    bridgeObservationGeneration: 3n,
    bridgeObservationRoot: bridge.finalRawMerkleRoot,
    bridgeObservationDigest: bridge.observationDigest,
    expectedTargetDeployedSlot: deployedSlot,
    expectedTargetCapacity: capacity,
    expectedTargetRawLength: capacity + 45n,
    bootstrapGateStatus: GateStatusV1.EmergencyFrozen,
    bootstrapGateEpoch: 1n,
    bootstrapFreezeReasonCode: 1,
    bootstrapFreezeSlot: 19n,
    targetNonce: 1n,
    councilVersion: 1n,
    councilHash: hash(78),
    reviewStartSlot: 37n,
    reviewEndSlot: 40n,
    notBeforeSlot: 45n,
    expirySlot: 100n,
    approvalBitset: 0b00111,
    approvalCount: 3,
    approvalThreshold: 3,
    firstApprovalSlot: 38n,
    councilApprovedSlot: 39n,
    queuedSlot: 41n,
    executedSlot: 50n,
    terminalSlot: 50n,
    terminalReasonCode: 1,
    proposalDigest: hash(253),
    creationSlot: 36n,
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN),
  };
  value.proposalDigest = bootstrapActivationProposalDigestV1(value);
  return value;
}

test("capacity policy has exact fixed bytes, digest, and maximum-runtime geometry", () => {
  const policy = capacityPolicy();
  const encoded = serializeProgramDataCapacityPolicyV1(policy);
  assert.equal(encoded.length, PROGRAMDATA_CAPACITY_POLICY_V1_LEN);
  assert.deepEqual(deserializeProgramDataCapacityPolicyV1(encoded), policy);
  validateProgramDataCapacityPolicyDigestV1(policy);
  assert.equal(policy.maximumRawProgramdataLength, 10_485_760n);
  assert.equal(policy.maximumPayloadCapacity, 10_485_715n);
  assert.throws(() => deserializeProgramDataCapacityPolicyV1(encoded.subarray(0, -1)), /512 bytes/u);
  assert.throws(() => deserializeProgramDataCapacityPolicyV1(Buffer.concat([encoded, Buffer.of(0)])), /512 bytes/u);
  const nonzeroReserved = Buffer.from(encoded);
  nonzeroReserved[nonzeroReserved.length - 1] = 1;
  assert.throws(() => deserializeProgramDataCapacityPolicyV1(nonzeroReserved), /reserved/u);
});

test("finalized observation strictly binds headers, frontier, zero tail, purpose, and digest", () => {
  const value = observation(ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n, present(legacyAuthority), 61);
  const encoded = serializeProgramDataObservationV1(value);
  assert.equal(encoded.length, PROGRAMDATA_OBSERVATION_V1_LEN);
  assert.deepEqual(deserializeProgramDataObservationV1(encoded), value);
  validateProgramDataObservationDigestV1(value);
  assert.throws(() => serializeProgramDataObservationV1({ ...value, rawFrontierMask: 0 }), /frontier/u);
  assert.throws(() => serializeProgramDataObservationV1({ ...value, tailBytesVerified: 99n }), /finalized observation|tail/u);
  assert.throws(() => serializeProgramDataObservationV1({ ...value, programdataHeaderSnapshot: Buffer.alloc(45) }), /header/u);
  assert.throws(() => serializeProgramDataObservationV1({ ...value, status: 99 as ProgramDataObservationStatusV1 }), /unknown/u);
  assert.throws(() => deserializeProgramDataObservationV1(encoded.subarray(0, -1)), /1280 bytes/u);
});

test("handoff and activation proposals preserve immutable digests across lifecycle fields", () => {
  const handoff = handoffProposal();
  const handoffBytes = serializeTargetAuthorityHandoffProposalV1(handoff);
  assert.equal(handoffBytes.length, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN);
  assert.deepEqual(deserializeTargetAuthorityHandoffProposalV1(handoffBytes), handoff);
  validateTargetAuthorityHandoffProposalDigestV1(handoff);
  const activation = activationProposal();
  const activationBytes = serializeBootstrapActivationProposalV1(activation);
  assert.equal(activationBytes.length, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN);
  assert.deepEqual(deserializeBootstrapActivationProposalV1(activationBytes), activation);
  validateBootstrapActivationProposalDigestV1(activation);
  const mutatedLifecycle = { ...handoff, state: CeremonyProposalStateV1.Timelocked, executedSlot: 0n, terminalSlot: 0n, terminalReasonCode: 0 };
  assert.deepEqual(targetAuthorityHandoffProposalDigestV1(mutatedLifecycle), handoff.proposalDigest);
  assert.throws(() => serializeTargetAuthorityHandoffProposalV1({ ...handoff, approvalThreshold: 4 }), /timing or quorum/u);
});

test("all 32 equal-seat masks have canonical popcount and threshold behavior", () => {
  for (let mask = 0; mask < 32; mask += 1) {
    const count = mask.toString(2).split("1").length - 1;
    const candidate = handoffProposal(mask);
    if (count === 3) {
      assert.doesNotThrow(() => serializeTargetAuthorityHandoffProposalV1(candidate));
    } else {
      assert.throws(() => serializeTargetAuthorityHandoffProposalV1(candidate));
    }
  }
});

function ceremonyPlan(): Release1CeremonyPlanV1 {
  return {
    operation: CeremonyPlanOperationV1.AcceptTargetAuthority,
    production: false,
    clusterDomain: hash(70),
    controllerProgram: controller,
    controllerConfig,
    targetProgram: target,
    targetProgramdata,
    controllerAuthority,
    capacityPolicy: deriveCapacityPolicyPdaV1(controller, target)[0],
    capacityPolicyDigest: capacityPolicy().policyDigest,
    controllerRelease: key(81),
    controllerReleaseDigest: hash(82),
    controllerImmutabilityReceipt: key(83),
    programdataObservation: deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n)[0],
    observationPurpose: ProgramDataObservationPurposeV1.TargetHandoffBridge,
    observationGeneration: 1n,
    observationDigest: observation(ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n, present(legacyAuthority), 61).observationDigest,
    actualCapacity: capacity,
    handoffProposal: deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 1n)[0],
    handoffReceipt: key(84),
    legacyAuthority,
    activationProposal: deriveBootstrapActivationProposalPdaV1(controller, target, 1n)[0],
    activationReceipt: key(85),
    gateStatus: GateStatusV1.EmergencyFrozen,
    gateEpoch: 1n,
    freezeReasonCode: 1,
    targetNonce: 1n,
    bridgeArtifactLength: artifactLength,
    bridgeArtifactSha256: hash(40),
    bridgeArtifactMerkleRoot: hash(41),
    currentDeploymentState: key(86),
    councilVersion: 1n,
    councilHash: hash(78),
    plannedAtSlot: 20n,
    expiresAtSlot: 100n,
  };
}

test("planning is execution-free, deterministic, identity-bound, and fail-closed", () => {
  const plan = ceremonyPlan();
  validateRelease1CeremonyPlanV1(plan);
  const operationId = release1CeremonyOperationIdV1(plan);
  assert.match(operationId, /^[0-9a-f]{64}$/u);
  assert.equal(operationId, release1CeremonyOperationIdV1({ ...plan }));
  assert.notEqual(operationId, release1CeremonyOperationIdV1({ ...plan, gateEpoch: 2n }));
  assert.notEqual(operationId, release1CeremonyOperationIdV1({ ...plan, actualCapacity: 201n }));
  assert.throws(() => validateRelease1CeremonyPlanV1({ ...plan, production: true }), /synthetic/u);
  assert.throws(() => validateRelease1CeremonyPlanV1({ ...plan, observationPurpose: ProgramDataObservationPurposeV1.BootstrapActivation }), /TargetHandoffBridge/u);
  assert.throws(() => validateRelease1CeremonyPlanV1({ ...plan, gateStatus: GateStatusV1.Active }), /bootstrap freeze/u);
  assert.throws(() => validateRelease1CeremonyPlanV1({ ...plan, actualCapacity: MAX_PROGRAMDATA_PAYLOAD_CAPACITY_V1 + 1n }), /numeric/u);
});

test("ceremony PDAs separate roles, purposes, and observation generations", () => {
  const policy = deriveCapacityPolicyPdaV1(controller, target)[0];
  const handoff = deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 1n)[0];
  const rotatedHandoff = deriveTargetAuthorityHandoffProposalPdaV1(controller, target, 2n)[0];
  const activation = deriveBootstrapActivationProposalPdaV1(controller, target, 1n)[0];
  const rotatedActivation = deriveBootstrapActivationProposalPdaV1(controller, target, 2n)[0];
  const observation1 = deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.TargetHandoffBridge, 1n)[0];
  const observation2 = deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.TargetHandoffBridge, 2n)[0];
  const activationObservation = deriveProgramDataObservationPdaV1(controller, target, ProgramDataObservationPurposeV1.BootstrapActivation, 1n)[0];
  const identities = [policy, handoff, rotatedHandoff, activation, rotatedActivation, observation1, observation2, activationObservation].map((entry) => entry.toBase58());
  assert.equal(new Set(identities).size, identities.length);
});
