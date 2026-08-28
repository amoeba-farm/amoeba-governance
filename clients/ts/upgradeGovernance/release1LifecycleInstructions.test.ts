import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  CouncilRotationStateV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
} from "./release1.js";
import * as abi from "./release1LifecycleInstructions.js";

const b = (value: number): Buffer => Buffer.alloc(32, value);
const k = (value: number): PublicKey => new PublicKey(b(value));
const some = (value: number) => ({ present: true, value: k(value) });
const seatTerms = Array.from({ length: 5 }, (_, index) => ({
  termStartSlot: BigInt(10 + index),
  termEndSlot: BigInt(110 + index),
}));

const proposalExpectation = {
  expectedProposalDigest: b(33), expectedPolicyVersion: 34n, expectedPolicyHash: b(35), expectedCouncilVersion: 36n, expectedCouncilHash: b(37),
  expectedGateStatus: GateStatusV1.FrozenForUpgrade, expectedGateEpoch: 38n, expectedTargetNonce: 39n, expectedState: ProposalStateV2.Timelocked,
  expectedReviewStartSlot: 40n, expectedReviewEndSlot: 41n, expectedNotBeforeSlot: 42n, expectedExpirySlot: 43n,
};

const emergencyExpectation = {
  expectedResolutionDigest: b(67), expectedPolicyVersion: 68n, expectedPolicyHash: b(69), expectedCouncilVersion: 70n, expectedCouncilHash: b(71),
  expectedGateStatus: GateStatusV1.EmergencyFrozen, expectedGateEpoch: 72n, expectedFreezeSlot: 73n, expectedFreezeReasonCode: 74,
  expectedTargetNonce: 75n, expectedState: EmergencyFreezeResolutionStateV1.Timelocked, expectedNotBeforeSlot: 76n, expectedExpirySlot: 77n,
};

function checkpointCandidate(phase: abi.CheckpointCandidateV1["phase"]): abi.CheckpointCandidateV1 {
  return {
    phase,
    expectedSubjectState: phase === StateCheckpointPhaseV1.Prestate ? abi.CheckpointSubjectStateV1.ProposalFrozen : phase === StateCheckpointPhaseV1.Poststate ? abi.CheckpointSubjectStateV1.ProposalProgramDataVerified : abi.CheckpointSubjectStateV1.EmergencyResolutionTimelocked,
    expectedSubjectDigest: b(78), expectedGateStatus: phase === StateCheckpointPhaseV1.Emergency ? GateStatusV1.EmergencyFrozen : GateStatusV1.FrozenForUpgrade,
    expectedGateEpoch: 79n, finalizedObservationSlot: 80n, targetProgramdataSlot: 81n, targetPayloadCommitment: b(82), targetRawProgramdataCommitment: b(83),
    targetCapacity: 84n, programOwnedStateRoot: b(85), programOwnedStateCount: 86n, logicalCompressedStateRoot: b(87), logicalCompressedStateCount: 88n,
    semanticCustodyAccountingRoot: b(89), hardCombinedRoot: b(90), externalMetadataObservationRoot: b(91), externalRawBalanceObservationRoot: b(92),
    schemaIdentifier: b(93), admittedPositiveDonationRoot: b(94), admittedPositiveDonationCount: 95n, forbiddenDriftCount: 0, expectedCheckpointDigest: b(96),
  };
}

const rotationExpectation = {
  expectedRotationDigest: b(117), expectedCurrentCouncilVersion: 118n, expectedCurrentCouncilHash: b(119), expectedCandidateCouncilVersion: 119n,
  expectedCandidateCouncilHash: b(120), expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 121n, expectedTargetNonce: 122n,
  expectedState: CouncilRotationStateV1.Timelocked, expectedNotBeforeSlot: 123n, expectedExpirySlot: 124n,
};

const initialize: abi.InitializeControllerV1 = {
  clusterDomain: b(1), initialPolicyVersion: 2n, initialCouncilVersion: 3n, nextProposalId: 4n, targetNonce: 5n, initialGateEpoch: 6n,
  policyActivationSlot: 7n, routineDelaySlots: 8n, majorDelaySlots: 9n, rollbackDelaySlots: 10n, terminalDelaySlots: 11n,
  voteReviewSlots: 12n, proposalExpirySlots: 13n, expectedPolicyHash: b(2), expectedCouncilHash: b(3), seatTerms,
};

const createProposal: abi.CreateProposalV2 = {
  proposalClass: ProposalClassV1.RoutineUpgrade, creationGateStatus: GateStatusV1.Active, expectedProposalId: 1n, expectedTargetNonce: 2n, creationSlot: 3n,
  expectedPolicyVersion: 4n, expectedPolicyHash: b(4), expectedCreationCouncilVersion: 5n, expectedCreationCouncilHash: b(5), expectedCreationGateEpoch: 6n,
  expectedFreezeGateEpoch: 7n, artifactLength: 8n, artifactSha256: b(8), artifactChunkMerkleRoot: b(9), sourceCommitHash: b(10), sourceTreeHash: b(11),
  buildInputInventoryHash: b(12), reproducibleBuildReceiptHash: b(13), packageReceiptHash: b(14), releaseIntentHash: b(15), expectedExecutionPrePayloadHash: b(16),
  expectedExecutionPreChunkRoot: b(17), currentRawProgramdataHash: b(18), deployedSlot: 19n, currentCapacity: 20n, extensionDelta: 21n, expectedPostCapacity: 41n,
  checkpointSchemaId: b(22), checkpointPolicyHash: b(23), primaryProposal: { present: false, value: PublicKey.default }, rollbackProposal: some(24), rollbackBuffer: some(25),
  rollbackArtifactSha256: b(26), rollbackArtifactChunkRoot: b(27), reviewStartSlot: 28n, reviewEndSlot: 29n, notBeforeSlot: 30n, expirySlot: 31n, expectedProposalDigest: b(32),
};

const cases: readonly [number, number, (value: never) => Buffer, (data: Buffer) => unknown, unknown, string][] = [
  [1, abi.INITIALIZE_CONTROLLER_V1_LEN, abi.encodeInitializeControllerV1 as never, abi.decodeInitializeControllerV1, initialize, "fd1577c009d091c8e1663995d9d2f2d9152202cfe478e32843b250380d0af333"],
  [2, abi.CREATE_PROPOSAL_V2_LEN, abi.encodeCreateProposalV2 as never, abi.decodeCreateProposalV2, createProposal, "8d37b3e474fc04ed2dcff0b3b2b62c06cf02db0314c3f26377271740a72aaaa9"],
  [3, abi.APPROVE_PROPOSAL_V2_LEN, abi.encodeApproveProposalV2 as never, abi.decodeApproveProposalV2, { expected: proposalExpectation, expectedApprovalBitset: 1, expectedApprovalCount: 1 }, "62049b8b68f3942a8bc7c95cceb12891a41467fdf33af9bd6a230bf17f5b4413"],
  [4, abi.FINALIZE_GOVERNANCE_V2_LEN, abi.encodeFinalizeGovernanceV2 as never, abi.decodeFinalizeGovernanceV2, { expected: proposalExpectation, expectedApprovalBitset: 7, expectedApprovalCount: 3 }, "9457000e5009faa0194c414c171e8e04de24e21acc5dc4fd1a4a72569104e36b"],
  [5, abi.QUEUE_PROPOSAL_V2_LEN, abi.encodeQueueProposalV2 as never, abi.decodeQueueProposalV2, { expected: proposalExpectation }, "21988d765c4b9ce9914eceb457a2c2195941a3903af0fefaad03e61d0c03c922"],
  [6, abi.FREEZE_PROPOSAL_V2_LEN, abi.encodeFreezeProposalV2 as never, abi.decodeFreezeProposalV2, { expected: proposalExpectation, expectedNextGateEpoch: 125n }, "3b620a7c4329f771708f04e9c5a67649361679fd938c067862189e15c3fe1e56"],
  [7, abi.CANCEL_PROPOSAL_V2_LEN, abi.encodeCancelProposalV2 as never, abi.decodeCancelProposalV2, { expected: proposalExpectation, expectedCancellationApprovalBitset: 3, expectedCancellationApprovalCount: 2, cancellationReasonCode: 126 }, "9e803483c6d1841e231202b38a9340b4da8158f41a77fbf032b42891cfd9cefa"],
  [8, abi.EXPIRE_PROPOSAL_V2_LEN, abi.encodeExpireProposalV2 as never, abi.decodeExpireProposalV2, { expected: proposalExpectation }, "1f56def734c90a6ec8d7c57656a0afdbedea9f0f02d30dbf56f2c8ed7cfacc8e"],
  [11, abi.APPROVE_EMERGENCY_RESOLUTION_V1_LEN, abi.encodeApproveEmergencyResolutionV1 as never, abi.decodeApproveEmergencyResolutionV1, { expected: emergencyExpectation, expectedApprovalBitset: 1, expectedApprovalCount: 1 }, "d0758b17a34761c901a2179c3efca641ec90d5eb99adf6127db76e5e38b88f3f"],
  [12, abi.QUEUE_EMERGENCY_RESOLUTION_V1_LEN, abi.encodeQueueEmergencyResolutionV1 as never, abi.decodeQueueEmergencyResolutionV1, { expected: emergencyExpectation, expectedApprovalBitset: 7, expectedApprovalCount: 3 }, "b2a887d34ec526c21acc67d1bff50a8a46dc7512134da225cba473bc73f52bdd"],
  [14, abi.CONVERT_EMERGENCY_FREEZE_V2_LEN, abi.encodeConvertEmergencyFreezeV2 as never, abi.decodeConvertEmergencyFreezeV2, { expected: proposalExpectation, expectedNextGateEpoch: 133n, expectedFreezeObservationDigest: b(134) }, "5a4d40e3251b16ec43335c3be668d8960de58bf88a4d3fd9f0b2f183877f4e6b"],
  [15, abi.CREATE_CHECKPOINT_ATTESTATION_V1_LEN, abi.encodeCreateCheckpointAttestationV1 as never, abi.decodeCreateCheckpointAttestationV1, { candidate: checkpointCandidate(StateCheckpointPhaseV1.Prestate), expectedCouncilVersion: 99n, expectedCouncilHash: b(100), seatIndex: 2 }, "13926203b575433e6c2398425197afd2c95b3709080f2f8be87572090191e85f"],
  [16, abi.RECAST_CHECKPOINT_ATTESTATION_V1_LEN, abi.encodeRecastCheckpointAttestationV1 as never, abi.decodeRecastCheckpointAttestationV1, { candidate: checkpointCandidate(StateCheckpointPhaseV1.Prestate), expectedCouncilVersion: 99n, expectedCouncilHash: b(100), seatIndex: 2, expectedPreviousAttestationDigest: b(101) }, "7debda7d6677e4c2aaa68f8a98d27448e9d7e895866bf21733dd27b3d0e147e0"],
  [17, abi.FINALIZE_CHECKPOINT_V1_LEN, abi.encodeFinalizeCheckpointV1 as never, abi.decodeFinalizeCheckpointV1, { candidate: checkpointCandidate(StateCheckpointPhaseV1.Poststate), expectedCouncilVersion: 99n, expectedCouncilHash: b(100) }, "f1956372117b3e5d2ec9703efd689c09e728985bdcdeeb050c4663c6591e0e27"],
  [18, abi.CREATE_CANDIDATE_COUNCIL_SET_V1_LEN, abi.encodeCreateCandidateCouncilSetV1 as never, abi.decodeCreateCandidateCouncilSetV1, { expectedCurrentCouncilVersion: 102n, expectedCurrentCouncilHash: b(103), candidateCouncilVersion: 103n, activationSlot: 104n, expectedTargetNonce: 105n, expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 106n, expectedCandidateCouncilHash: b(107), seatTerms }, "5def6df1390d29cfc307060bc71fc3832d4944abd6c3dbae0ed2195a244495d8"],
  [19, abi.CREATE_COUNCIL_ROTATION_V1_LEN, abi.encodeCreateCouncilRotationV1 as never, abi.decodeCreateCouncilRotationV1, { creationSlot: 108n, notBeforeSlot: 109n, expirySlot: 110n, expectedCurrentCouncilVersion: 111n, expectedCurrentCouncilHash: b(112), expectedCandidateCouncilVersion: 112n, expectedCandidateCouncilHash: b(113), expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 114n, expectedTargetNonce: 115n, expectedRotationDigest: b(116) }, "78e9e1b6f4872ceb2daae23342e7bc67dbead99cd775a041bfbe3854e43bf641"],
  [20, abi.APPROVE_COUNCIL_ROTATION_V1_LEN, abi.encodeApproveCouncilRotationV1 as never, abi.decodeApproveCouncilRotationV1, { expected: rotationExpectation, expectedApprovalBitset: 1, expectedApprovalCount: 1 }, "61ad2b4266e86786ce759b5185fe85498f530b2ace3488e326bbdcbd2fbf08b9"],
  [21, abi.ACTIVATE_COUNCIL_ROTATION_V1_LEN, abi.encodeActivateCouncilRotationV1 as never, abi.decodeActivateCouncilRotationV1, { expected: rotationExpectation, expectedApprovalBitset: 7, expectedApprovalCount: 3 }, "7abc119c92b123a650958622dc62ae0ea505d6181d59c17092a062038237a1e5"],
  [22, abi.QUEUE_COUNCIL_ROTATION_V1_LEN, abi.encodeQueueCouncilRotationV1 as never, abi.decodeQueueCouncilRotationV1, { expected: rotationExpectation, expectedApprovalBitset: 7, expectedApprovalCount: 3 }, "990f251f7f9e03e9a2ba74bee466dd30cdfb798b79e7351a10df0e9a6720e996"],
  [23, abi.EXPIRE_EMERGENCY_RESOLUTION_V1_LEN, abi.encodeExpireEmergencyResolutionV1 as never, abi.decodeExpireEmergencyResolutionV1, { expected: emergencyExpectation }, "d7149648c292c8c317d06254eedd5dd4555b68cd725dd48df582ec4d12d7e889"],
  [24, abi.CANCEL_COUNCIL_ROTATION_V1_LEN, abi.encodeCancelCouncilRotationV1 as never, abi.decodeCancelCouncilRotationV1, { expected: rotationExpectation, expectedCancellationApprovalBitset: 3, expectedCancellationApprovalCount: 2, cancellationReasonCode: 125 }, "b5fc9d9a55e04046811c021f6ab457bb472c2ffde9e57029f6aa17d3ccc4feb4"],
  [25, abi.EXPIRE_COUNCIL_ROTATION_V1_LEN, abi.encodeExpireCouncilRotationV1 as never, abi.decodeExpireCouncilRotationV1, { expected: rotationExpectation }, "6a3d38460805bf0bd09adfeb46915cfce2db7799f218bff9d3bbd73f378cc9d9"],
];

test("lifecycle instruction codecs match the frozen Rust vectors", () => {
  for (const [tag, length, encode, decode, value, expectedSha] of cases) {
    const bytes = encode(value as never);
    assert.equal(bytes[0], tag);
    assert.equal(bytes.length, length);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedSha);
    assert.deepEqual(decode(bytes), value);
    assert.equal(abi.decodeRelease1InstructionV1(bytes).tag, tag);
    assert.throws(() => decode(bytes.subarray(0, -1)));
    assert.throws(() => decode(Buffer.concat([bytes, Buffer.alloc(1)])));
  }
});

test("unified decoder rejects tag 0, reserved tag 26, unknown tags, and oversize", () => {
  for (const tag of [0, abi.CANCEL_EMERGENCY_RESOLUTION_V2_RESERVED_TAG, 39, 255]) assert.throws(() => abi.decodeRelease1InstructionV1(Buffer.from([tag])));
  assert.throws(() => abi.decodeRelease1InstructionV1(Buffer.alloc(16_385, 1)));
});

function flags(instruction: TransactionInstruction): string {
  return instruction.keys.map((meta) => `${Number(meta.isSigner)}${Number(meta.isWritable)}`).join(" ");
}

test("lifecycle builders freeze account order and privileges", () => {
  const keys = Array.from({ length: 32 }, (_, index) => k(index + 1));
  const program = k(250);
  assert.equal(flags(abi.buildInitializeControllerV1Instruction(program, { payer: keys[0]!, initializer: keys[1]!, controllerProgram: keys[2]!, controllerProgramdata: keys[3]!, targetProgram: keys[4]!, targetProgramdata: keys[5]!, upgradeableLoader: keys[6]!, controllerConfig: keys[7]!, authorityPda: keys[8]!, protocolGate: keys[9]!, policy: keys[10]!, council: keys[11]!, canonicalSpillTreasury: keys[12]!, guardian: keys[13]!, seatAuthorities: keys.slice(14, 19), systemProgram: keys[19]! }, initialize)), "11 10 00 00 00 00 00 01 00 01 01 01 00 00 00 00 00 00 00 00");
  assert.equal(flags(abi.buildCreateProposalV2Instruction(program, { payer: keys[0]!, creatorSeatAuthority: keys[1]!, controllerConfig: keys[2]!, policy: keys[3]!, council: keys[4]!, protocolGate: keys[5]!, targetProgram: keys[6]!, targetProgramdata: keys[7]!, upgradeableLoader: keys[8]!, authorityPda: keys[9]!, canonicalSpillTreasury: keys[10]!, buffer: keys[11]!, bufferUploaderAuthority: keys[12]!, proposal: keys[13]!, systemProgram: keys[14]! }, createProposal)), "11 10 01 00 00 00 00 00 00 00 00 00 00 01 00");
  assert.equal(flags(abi.buildFreezeProposalV2Instruction(program, { controllerConfig: keys[0]!, policy: keys[1]!, council: keys[2]!, protocolGate: keys[3]!, proposal: keys[4]!, targetProgram: keys[5]!, targetProgramdata: keys[6]!, upgradeableLoader: keys[7]!, authorityPda: keys[8]!, rollbackProposal: keys[9]!, rollbackBufferVerification: keys[10]!, rollbackBuffer: keys[11]! }, { expected: proposalExpectation, expectedNextGateEpoch: 125n })), "01 00 00 01 01 00 00 00 00 00 00 00");
  const poststate = { candidate: checkpointCandidate(StateCheckpointPhaseV1.Poststate), expectedCouncilVersion: 99n, expectedCouncilHash: b(100) };
  assert.equal(flags(abi.buildFinalizeCheckpointV1Instruction(program, { payer: keys[0]!, controllerConfig: keys[1]!, policy: keys[2]!, council: keys[3]!, protocolGate: keys[4]!, subject: keys[5]!, targetProgram: keys[6]!, targetProgramdata: keys[7]!, phaseEvidence: keys[8]!, baselineCheckpoint: keys[9]!, checkpoint: keys[10]!, checkpointAttestations: keys.slice(11, 14), systemProgram: keys[14]! }, poststate)), "11 00 00 00 00 01 00 00 00 00 01 00 00 00 00");
  assert.throws(() => abi.buildFinalizeCheckpointV1Instruction(program, { payer: keys[0]!, controllerConfig: keys[1]!, policy: keys[2]!, council: keys[3]!, protocolGate: keys[4]!, subject: keys[5]!, targetProgram: keys[6]!, targetProgramdata: keys[7]!, phaseEvidence: keys[8]!, checkpoint: keys[10]!, checkpointAttestations: keys.slice(11, 14), systemProgram: keys[14]! }, poststate));
});
