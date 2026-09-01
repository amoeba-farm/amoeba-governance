import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { BufferVerificationStatusV1, EmergencyFreezeResolutionKindV1, EmergencyFreezeResolutionStateV1, GateStatusV1, ProposalClassV1, ProposalStateV2, StateCheckpointPhaseV1 } from "./release1.js";
import * as authority from "./release1AuthorityInstructions.js";
import { CURRENT_RELEASE1_INSTRUCTION_TAGS, decodeRelease1CurrentInstruction } from "./release1CurrentInstructions.js";
import * as v3 from "./release1V3Instructions.js";
import * as builders from "./release1V3Builders.js";
import * as custody from "./release1V3CustodyInstructions.js";
import * as governanceV2 from "./release1GovernanceV2.js";

const h = (seed: number): Buffer => Buffer.alloc(32, seed);
const key = (seed: number): PublicKey => new PublicKey(h(seed));
const none = { present: false, value: PublicKey.default } as const;
const some = (seed: number) => ({ present: true, value: key(seed) }) as const;
const envelope = { computeUnitLimit: 1_000_000, computeUnitPriceMicroLamports: 1n, durableNonceAccount: none, durableNonceAuthority: none } as const;
const zeroProof = { proofLen: 0, nodes: Array.from({ length: 7 }, () => Buffer.alloc(32)) } as const;
const bitmap = Buffer.alloc(64);

function governanceLivenessV2Instructions(): readonly Buffer[] {
  const profile = governanceV2.nominalGovernanceTimingProfileV1({
    bump: 1,
    controllerConfig: key(70),
    targetProgram: key(71),
    creationCouncilVersion: 1n,
    creationSlot: 1_000_000n,
  });
  const actionGuard: governanceV2.GovernanceActionGuardV2 = {
    proposalId: 9n,
    expectedProposalDigest: h(72),
    expectedCouncilVersion: 2n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: profile.profileHash,
  };
  const action = { guard: actionGuard } as const;
  return [
    governanceV2.encodeInitializeGovernanceLifecycleRegistryV2({ expectedInitialTimingProfileVersion: 1n, expectedInitialTimingProfileHash: profile.profileHash, expectedInitialNextProposalId: 1n, expectedInitialRotationNonce: 1n }),
    governanceV2.encodeCreateGovernanceTimingProfileV1({ profileVersion: 1n, predecessorProfileHash: Buffer.alloc(32), emergencyRollback: profile.emergencyRollback, routine: profile.routine, major: profile.major, constitutional: profile.constitutional }),
    governanceV2.encodeCreateTimingPolicyChangeProposalV1({ expectedProposalId: 1n, expectedCurrentTimingProfileVersion: 1n, expectedCurrentTimingProfileHash: profile.profileHash, candidateTimingProfileVersion: 3n, candidateTimingProfileHash: h(73), expectedCouncilVersion: 2n, expectedCouncilHash: h(74) }),
    governanceV2.encodeApproveTimingPolicyChangeProposalV1(action),
    governanceV2.encodeCancelTimingPolicyChangeProposalV1({ ...action, cancellationReasonCode: 1 }),
    governanceV2.encodeExpireTimingPolicyChangeProposalV1(action),
    governanceV2.encodeQueueTimingPolicyChangeProposalV1(action),
    governanceV2.encodeExecuteTimingPolicyChangeProposalV1(action),
    governanceV2.encodeCreateCouncilRotationProposalV2({ expectedProposalId: 2n, expectedCurrentCouncilVersion: 2n, expectedCurrentCouncilHash: h(75), candidateCouncilVersion: 4n, candidateCouncilHash: h(76), expectedRotationNonce: 1n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash }),
    governanceV2.encodeApproveCouncilRotationProposalV2(action),
    governanceV2.encodeCancelCouncilRotationProposalV2({ ...action, cancellationReasonCode: 2 }),
    governanceV2.encodeExpireCouncilRotationProposalV2(action),
    governanceV2.encodeQueueCouncilRotationProposalV2(action),
    governanceV2.encodeExecuteCouncilRotationProposalV2(action),
    governanceV2.encodeCreateTargetAuthorityHandoffProposalV2({ expectedProposalId: 3n, expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedCouncilVersion: 2n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash, bridgeSourceCommitment: h(77), bridgeBuildInputsCommitment: h(78), bridgePackageCommitment: h(79), bridgeReleaseManifestCommitment: h(80) }),
    governanceV2.encodeApproveTargetAuthorityHandoffProposalV2(action),
    governanceV2.encodeCancelTargetAuthorityHandoffProposalV2({ ...action, cancellationReasonCode: 3 }),
    governanceV2.encodeExpireTargetAuthorityHandoffProposalV2(action),
    governanceV2.encodeQueueTargetAuthorityHandoffProposalV2(action),
    governanceV2.encodeExecuteTargetAuthorityHandoffProposalV2({ ...action, expectedBridgeObservationDigest: h(81), expectedGateEpoch: 1n, expectedTargetNonce: 1n, envelope }),
    governanceV2.encodeCreateBootstrapActivationProposalV2({ expectedProposalId: 4n, expectedControllerImmutabilityDigest: h(82), expectedHandoffReceiptDigest: h(83), expectedBridgeObservationDigest: h(84), expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedCouncilVersion: 2n, expectedTimingProfileVersion: 1n, expectedTimingProfileHash: profile.profileHash }),
    governanceV2.encodeApproveBootstrapActivationProposalV2(action),
    governanceV2.encodeCancelBootstrapActivationProposalV2({ ...action, cancellationReasonCode: 4 }),
    governanceV2.encodeExpireBootstrapActivationProposalV2(action),
    governanceV2.encodeQueueBootstrapActivationProposalV2(action),
    governanceV2.encodeExecuteBootstrapActivationProposalV2({ ...action, expectedBridgeObservationDigest: h(85), expectedGateEpoch: 1n, expectedTargetNonce: 1n, expectedDeploymentPlanDigest: h(86), expectedReceiptPlanDigest: h(87), envelope }),
  ];
}

const guard = (state: ProposalStateV2 = ProposalStateV2.Draft, gate: GateStatusV1 = GateStatusV1.FrozenForUpgrade): v3.ProposalGuardV3 => ({
  expectedProposalDigest: h(1), expectedState: state, expectedGateStatus: gate, expectedGateEpoch: 3n,
  expectedTargetNonce: 7n, expectedCapacityPolicyDigest: h(2), expectedCurrentDeploymentDigest: h(3),
  expectedCurrentDeploymentGeneration: 4n,
});
const emergencyGuard = (state: EmergencyFreezeResolutionStateV1 = EmergencyFreezeResolutionStateV1.Draft): v3.EmergencyResolutionGuardV2 => ({
  expectedResolutionDigest: h(4), expectedState: state, expectedGateStatus: GateStatusV1.EmergencyFrozen,
  expectedGateEpoch: 3n, expectedTargetNonce: 7n, expectedCapacityPolicyDigest: h(2),
  expectedCurrentDeploymentDigest: h(3), expectedCurrentDeploymentGeneration: 4n,
  expectedFreezeObservationDigest: h(5), expectedProgramdataObservationDigest: h(6),
  expectedObservationGeneration: 2n, expectedCheckpointDigest: h(7),
});
const checkpointManifest = (): v3.CheckpointManifestV2 => ({
  phase: StateCheckpointPhaseV1.Prestate, checkpointGeneration: 1n, previousCheckpointDigest: h(0),
  expectedSubjectDigest: h(8), expectedGateEpoch: 3n, expectedCapacityPolicyDigest: h(2),
  expectedCurrentDeploymentDigest: h(3), expectedCurrentDeploymentGeneration: 4n,
  expectedObservationDigest: h(9), expectedObservationGeneration: 2n, programOwnedStateRoot: h(10),
  programOwnedStateCount: 1n, logicalCompressedStateRoot: h(11), logicalCompressedStateCount: 2n,
  semanticCustodyAccountingRoot: h(12), hardCombinedRoot: h(13), externalMetadataObservationRoot: h(14),
  externalRawBalanceObservationRoot: h(15), schemaIdentifier: h(16), admittedPositiveDonationRoot: h(0),
  admittedPositiveDonationCount: 0n, forbiddenDriftCount: 0, expectedCouncilVersion: 1n,
  expectedCouncilHash: h(17), expectedCheckpointDigest: h(18), planValidUntilSlot: 100n,
});
const unfreeze = (count: number): v3.UnfreezeGuardV2 => ({
  expectedProposalDigest: h(1), expectedCheckpointDigest: h(18), expectedCheckpointGeneration: 1n,
  expectedVerificationDigest: h(19), expectedVerificationGeneration: 1n, expectedOriginalCouncilVersion: 1n,
  expectedOriginalCouncilHash: h(20), expectedCurrentCouncilVersion: 1n, expectedCurrentCouncilHash: h(21),
  expectedGateEpoch: 3n, expectedTargetNonce: 7n, expectedCurrentDeploymentDigest: h(3),
  expectedCurrentDeploymentGeneration: 4n, expectedArtifactSha256: h(22), expectedArtifactMerkleRoot: h(23),
  expectedActualCapacity: 1_200_000n, expectedApprovalBitset: count === 3 ? 7 : 0, expectedApprovalCount: count,
});

const initialize: v3.InitializeControllerV2 = {
  clusterDomain: h(24), initialPolicyVersion: 1n, initialCouncilVersion: 1n, nextProposalId: 1n,
  targetNonce: 1n, initialGateEpoch: 1n, policyActivationSlot: 100n, routineDelaySlots: 10n,
  majorDelaySlots: 20n, rollbackDelaySlots: 5n, terminalDelaySlots: 30n, voteReviewSlots: 7n,
  proposalExpirySlots: 100n, expectedPolicyHash: h(25), expectedCouncilHash: h(26),
  seatTerms: Array.from({ length: 5 }, (_, index) => ({ termStartSlot: BigInt(100 + index), termEndSlot: 0xffff_ffff_ffff_ffffn })),
  capacityPolicy: { expectedPolicyDigest: h(27) },
  controllerRelease: {
    artifactLength: 1_100_003n, artifactSha256: h(28), artifactMerkleRoot: h(29), sourceCommitment: h(30),
    sourceTreeCommitment: h(31), buildInputsCommitment: h(32), toolchainCommitment: h(33), packageCommitment: h(34),
    releaseManifestCommitment: h(35), abiCommitment: h(36), expectedReleaseDigest: h(37),
  },
};
const proposalManifest: v3.ProposalManifestV3 = {
  proposalClass: ProposalClassV1.RoutineUpgrade, expectedProposalId: 1n, expectedTargetNonce: 7n,
  expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 3n, expectedCapacityPolicyDigest: h(2),
  expectedCurrentDeploymentDigest: h(3), expectedCurrentDeploymentGeneration: 4n, expectedPolicyVersion: 1n,
  expectedPolicyHash: h(38), expectedCouncilVersion: 1n, expectedCouncilHash: h(39), artifactLength: 1_100_003n,
  artifactSha256: h(40), artifactChunkMerkleRoot: h(41), sourceCommitHash: h(42), sourceTreeHash: h(43),
  buildInputInventoryHash: h(44), reproducibleBuildReceiptHash: h(45), packageReceiptHash: h(46), releaseIntentHash: h(47),
  minimumRequiredCapacity: 1_200_000n, checkpointSchemaId: h(48), checkpointPolicyHash: h(49), primaryProposal: none,
  rollbackProposal: some(50), rollbackBuffer: some(51), rollbackArtifactLength: 1_000_000n,
  rollbackArtifactSha256: h(52), rollbackArtifactChunkRoot: h(53), planValidUntilSlot: 100n,
};

type CodecCase = readonly [number, number, unknown, (value: never) => Buffer, (data: Buffer) => unknown];
const cases: readonly CodecCase[] = [
  [43, 161, { expectedCapacityPolicyDigest: h(1), expectedReleaseDigest: h(2), expectedPreObservationDigest: h(3), expectedPostObservationDigest: h(4), expectedReceiptDigest: h(5) }, authority.encodeRecordControllerImmutabilityV1 as never, authority.decodeRecordControllerImmutabilityV1],
  [53, 633, initialize, v3.encodeInitializeControllerV2 as never, v3.decodeInitializeControllerV2],
  [54, 694, { manifest: proposalManifest }, v3.encodeCreateProposalV3 as never, v3.decodeCreateProposalV3],
  [55, 165, { expected: guard(ProposalStateV2.BufferVerified, GateStatusV1.Active), expectedCreationCouncilVersion: 1n, expectedCreationCouncilHash: h(4), expectedApprovalBitset: 0, expectedApprovalCount: 0 }, v3.encodeApproveProposalV3 as never, v3.decodeApproveProposalV3],
  [56, 125, { expected: guard(ProposalStateV2.CouncilApproved), expectedApprovalBitset: 7, expectedApprovalCount: 3 }, v3.encodeFinalizeGovernanceV3 as never, v3.decodeFinalizeGovernanceV3],
  [57, 123, { expected: guard(ProposalStateV2.GovernanceSatisfied) }, v3.encodeQueueProposalV3 as never, v3.decodeQueueProposalV3],
  [58, 131, { expected: guard(ProposalStateV2.Timelocked, GateStatusV1.Active), expectedNextGateEpoch: 4n }, v3.encodeFreezeProposalV3 as never, v3.decodeFreezeProposalV3],
  [59, 167, { expected: guard(ProposalStateV2.Draft, GateStatusV1.Active), expectedCancellationCouncilVersion: 1n, expectedCancellationCouncilHash: h(4), expectedCancellationApprovalBitset: 0, expectedCancellationApprovalCount: 0, cancellationReasonCode: 2 }, v3.encodeCancelProposalV3 as never, v3.decodeCancelProposalV3],
  [60, 123, { expected: guard(ProposalStateV2.Draft, GateStatusV1.Active) }, v3.encodeExpireProposalV3 as never, v3.decodeExpireProposalV3],
  [61, 99, { manifest: { expectedGateEpoch: 3n, expectedTargetNonce: 7n, expectedCapacityPolicyDigest: h(2), expectedCurrentDeploymentDigest: h(3), expectedCurrentDeploymentGeneration: 4n, freezeReasonCode: 2, planValidUntilSlot: 100n } }, v3.encodeGuardianFreezeV2 as never, v3.decodeGuardianFreezeV2],
  [62, 250, { manifest: { resolutionKind: EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade, expectedGateEpoch: 3n, expectedTargetNonce: 7n, expectedCapacityPolicyDigest: h(2), expectedCurrentDeploymentDigest: h(3), expectedCurrentDeploymentGeneration: 4n, expectedFreezeObservationDigest: h(5), expectedProgramdataObservationDigest: h(6), expectedProgramdataObservationGeneration: 2n, expectedPolicyVersion: 1n, expectedPolicyHash: h(7), expectedCouncilVersion: 1n, expectedCouncilHash: h(8), planValidUntilSlot: 100n } }, v3.encodeCreateEmergencyResolutionV2 as never, v3.decodeCreateEmergencyResolutionV2],
  [63, 229, { expected: emergencyGuard(), expectedApprovalBitset: 0, expectedApprovalCount: 0 }, v3.encodeApproveEmergencyResolutionV2 as never, v3.decodeApproveEmergencyResolutionV2],
  [64, 227, { expected: emergencyGuard(EmergencyFreezeResolutionStateV1.CouncilApproved) }, v3.encodeQueueEmergencyResolutionV2 as never, v3.decodeQueueEmergencyResolutionV2],
  [65, 305, { expected: emergencyGuard(EmergencyFreezeResolutionStateV1.Timelocked), envelope }, v3.encodeExecuteEmergencyResolutionV2 as never, v3.decodeExecuteEmergencyResolutionV2],
  [66, 227, { expected: emergencyGuard() }, v3.encodeExpireEmergencyResolutionV2 as never, v3.decodeExpireEmergencyResolutionV2],
  [67, 591, { attestation: { manifest: checkpointManifest(), seatIndex: 0, expectedPreviousAttestationDigest: h(0) } }, v3.encodeCreateCheckpointV2 as never, v3.decodeCreateCheckpointV2],
  [68, 591, { attestation: { manifest: checkpointManifest(), seatIndex: 0, expectedPreviousAttestationDigest: h(19) } }, v3.encodeRecastCheckpointV2 as never, v3.decodeRecastCheckpointV2],
  [69, 558, { manifest: checkpointManifest() }, v3.encodeFinalizeCheckpointV2 as never, v3.decodeFinalizeCheckpointV2],
  [70, 251, { manifest: { expected: guard(ProposalStateV2.UpgradeExecuted), expectedObservationDigest: h(5), expectedObservationGeneration: 2n, expectedObservationRoot: h(6), expectedObservationFinalizedSlot: 10n, verificationGeneration: 1n, previousVerificationDigest: h(0), planValidUntilSlot: 100n } }, v3.encodeBindProgramDataVerificationV2 as never, v3.decodeBindProgramDataVerificationV2],
  [71, 242, { expected: { expectedProposalDigest: h(1), expectedVerificationDigest: h(2), expectedVerificationGeneration: 1n, expectedStatus: v3.ProgramDataVerificationStatusV2.ObservationBound, expectedGateEpoch: 3n, expectedTargetNonce: 7n, expectedCapacityPolicyDigest: h(3), expectedCurrentDeploymentDigest: h(4), expectedCurrentDeploymentGeneration: 1n, expectedObservationDigest: h(5), expectedObservationGeneration: 1n, expectedActualCapacity: 1_200_000n, expectedAuthority: key(6) } }, v3.encodeFinalizeProgramDataVerificationV2 as never, v3.decodeFinalizeProgramDataVerificationV2],
  [72, 473, { witness: { expectedProposal: guard(ProposalStateV2.UpgradeExecuted), expectedVerificationDigest: h(0), expectedVerificationGeneration: 0n, expectedObservationGeneration: 1n, expectedObservationStateHash: h(0), mismatchClass: v3.ProgramDataMismatchClassV2.ProgramLinkage, failingChunkIndex: 0xffff_ffff, expectedLeafHash: h(0), proof: zeroProof, planValidUntilSlot: 100n } }, v3.encodeObserveProgramDataFailureV2 as never, v3.decodeObserveProgramDataFailureV2],
  [73, 323, { expected: unfreeze(0) }, v3.encodeApproveUnfreezeV2 as never, v3.decodeApproveUnfreezeV2],
  [74, 433, { expected: unfreeze(3), linkedProposal: key(55), envelope }, v3.encodeExecuteUnfreezeV2 as never, v3.decodeExecuteUnfreezeV2],
  [75, 123, { expected: guard() }, custody.encodeAdoptBufferV2 as never, custody.decodeAdoptBufferV2],
  [76, 421, { expected: guard(ProposalStateV2.BufferAdopted), chunkIndex: 0, proof: zeroProof, expectedVerificationStatus: BufferVerificationStatusV1.Adopted, expectedVerifiedChunkBitmap: bitmap, expectedVerifiedChunkCount: 0 }, custody.encodeVerifyBufferChunkV2 as never, custody.decodeVerifyBufferChunkV2],
  [77, 224, { expected: guard(ProposalStateV2.BufferAdopted), expectedVerificationStatus: BufferVerificationStatusV1.ReadyToFinalize, expectedVerifiedChunkBitmap: bitmap, expectedVerifiedChunkCount: 0, expectedSealedBufferHeaderHash: h(4) }, custody.encodeFinalizeBufferVerificationV2 as never, custody.decodeFinalizeBufferVerificationV2],
  [78, 385, { expected: guard(ProposalStateV2.Frozen), expectedPrestateCheckpointDigest: h(4), expectedPrestateCheckpointGeneration: 1n, expectedObservationDigest: h(5), expectedObservationGeneration: 2n, expectedObservationRoot: h(6), expectedObservationFinalizedSlot: 10n, expectedCurrentCapacity: 100n, expectedExtensionDelta: 20n, expectedPostCapacity: 120n, expectedNextDeploymentGeneration: 5n, expectedNextDeploymentDigest: h(7), envelope }, custody.encodeExtendTargetV2 as never, custody.decodeExtendTargetV2],
  [79, 399, { expected: guard(ProposalStateV2.Frozen), expectedPrestateCheckpointDigest: h(4), expectedPrestateCheckpointGeneration: 1n, expectedObservationDigest: h(5), expectedObservationGeneration: 2n, expectedObservationRoot: h(6), expectedObservationFinalizedSlot: 10n, expectedActualCapacity: 120n, expectedSealedBufferHeaderHash: h(7), expectedVerifiedChunkCount: 1, expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified, expectedCounterpartProposalDigest: h(8), expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified, envelope }, custody.encodeExecuteUpgradeV2 as never, custody.decodeExecuteUpgradeV2],
  [80, 200, { expected: guard(ProposalStateV2.Cancelled), expectedVerificationStatus: BufferVerificationStatusV1.Verified, expectedVerifiedChunkBitmap: bitmap, expectedVerifiedChunkCount: 0, expectedBufferVerificationFinalizedSlot: 9n }, custody.encodeCloseAbandonedBufferV2 as never, custody.decodeCloseAbandonedBufferV2],
  [81, 410, { expectedPrimary: guard(ProposalStateV2.UpgradeExecuted), expectedRollback: guard(ProposalStateV2.Timelocked), expectedFailureEvidenceDigest: h(7), expectedPrimaryVerificationGeneration: 0n, expectedProgramdataObservationStateHash: h(8), expectedProgramdataObservationGeneration: 1n, expectedRollbackBufferVerificationStatus: BufferVerificationStatusV1.Verified, expectedRollbackVerifiedChunkBitmap: bitmap, expectedRollbackVerifiedChunkCount: 1, expectedRollbackBufferFinalizedSlot: 10n, expectedNextGateEpoch: 4n }, custody.encodeActivateRollbackV2 as never, custody.decodeActivateRollbackV2],
];

test("current tags 43 and 53-81 round-trip exact Rust fixed lengths and reject all framing drift", () => {
  assert.equal(cases.length, 30);
  for (const [tag, length, value, encode, decode] of cases) {
    const data = encode(value as never);
    assert.equal(data[0], tag, `tag ${tag}`);
    assert.equal(data.length, length, `length ${tag}`);
    assert.deepEqual(decode(data), value, `round-trip ${tag}`);
    assert.equal(decodeRelease1CurrentInstruction(data).tag, tag);
    assert.throws(() => decode(data.subarray(0, data.length - 1)), `truncated ${tag}`);
    assert.throws(() => decode(Buffer.concat([data, Buffer.from([0])])), `trailing ${tag}`);
    const wrong = Buffer.from(data); wrong[0] = 48;
    assert.throws(() => decode(wrong), `wrong tag ${tag}`);
  }
});

test("current decoder advertises retained council, ceremony/V3, and governance-liveness V2 tags", () => {
  assert.equal(CURRENT_RELEASE1_INSTRUCTION_TAGS.length, 61);
  for (const [index, instruction] of governanceLivenessV2Instructions().entries()) {
    const tag = 82 + index;
    assert.equal(instruction[0], tag);
    const decoded = decodeRelease1CurrentInstruction(instruction);
    assert.equal("kind" in decoded, true);
    if ("kind" in decoded) assert.equal(decoded.kind, governanceV2.decodeRelease1GovernanceV2Instruction(instruction).kind);
  }
  for (const tag of [...Array.from({ length: 18 }, (_, index) => index), ...Array.from({ length: 20 }, (_, index) => 19 + index), ...Array.from({ length: 9 }, (_, index) => 44 + index), 108, 255]) {
    assert.throws(() => decodeRelease1CurrentInstruction(Buffer.from([tag])));
  }
});

test("V3 codecs enforce canonical enums, approval pairs, proofs, and nonce pairing", () => {
  assert.throws(() => v3.encodeFinalizeGovernanceV3({ expected: guard(ProposalStateV2.CouncilApproved), expectedApprovalBitset: 3, expectedApprovalCount: 3 }), /bitset\/count/u);
  assert.throws(() => custody.encodeVerifyBufferChunkV2({ expected: guard(), chunkIndex: 0, proof: { proofLen: 0, nodes: [h(1), ...zeroProof.nodes.slice(1)] }, expectedVerificationStatus: BufferVerificationStatusV1.Adopted, expectedVerifiedChunkBitmap: bitmap, expectedVerifiedChunkCount: 0 }), /padding/u);
  assert.throws(() => authority.encodeAcceptTargetAuthorityCheckedV1({ expectedProposalDigest: h(1), expectedBridgeObservationDigest: h(2), expectedGateEpoch: 3n, expectedTargetNonce: 4n, envelope: { ...envelope, durableNonceAccount: some(2) } }), /paired/u);
  assert.throws(() => v3.encodeCreateProposalV3({ manifest: { ...proposalManifest, proposalClass: ProposalClassV1.TargetImmutability } }), /non-executable/u);
});

type Mode = "r" | "w" | "rs" | "ws";
type AnyBuilder = (programId: PublicKey, accounts: never, value: never) => { keys: readonly { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]; data: Buffer };
interface BuilderCase { tag: number; builder: AnyBuilder; fields: readonly string[]; modes: readonly Mode[] }
const fieldList = (value: string): readonly string[] => value.trim().split(/\s+/u);
const modeList = (value: string): readonly Mode[] => value.trim().split(/\s+/u) as Mode[];

function materializeAccounts(fields: readonly string[]): { accounts: Record<string, PublicKey | readonly PublicKey[]>; flattened: readonly PublicKey[] } {
  const accounts: Record<string, PublicKey | readonly PublicKey[]> = {};
  const flattened: PublicKey[] = [];
  let seed = 80;
  for (const descriptor of fields) {
    const [field, countText] = descriptor.split(":");
    if (field === undefined) throw new Error("missing account field");
    if (countText === undefined) {
      const value = key(seed++); accounts[field] = value; flattened.push(value);
    } else {
      const values = Array.from({ length: Number(countText) }, () => key(seed++));
      accounts[field] = values; flattened.push(...values);
    }
  }
  return { accounts, flattened };
}

const builderCases: readonly BuilderCase[] = [
  { tag: 43, builder: authority.buildRecordControllerImmutabilityV1Instruction as AnyBuilder, fields: fieldList("payer controllerProgram controllerProgramdata controllerConfig capacityPolicy controllerRelease preObservation postObservation immutabilityReceipt upgradeableLoader systemProgram"), modes: modeList("ws r r r r r r r w r r") },
  { tag: 53, builder: builders.buildInitializeControllerV2Instruction as AnyBuilder, fields: fieldList("payer initializer controllerProgram controllerProgramdata targetProgram targetProgramdata upgradeableLoader controllerConfig authorityPda protocolGate policy council capacityPolicy controllerRelease canonicalSpillTreasury guardian seatAuthorities:5 systemProgram"), modes: modeList("ws rs r r r r r w r w w w w w r r r r r r r r") },
  { tag: 54, builder: builders.buildCreateProposalV3Instruction as AnyBuilder, fields: fieldList("payer creatorSeatAuthority controllerConfig policy council protocolGate capacityPolicy currentDeployment targetProgram targetProgramdata upgradeableLoader authorityPda canonicalSpillTreasury buffer bufferUploaderAuthority proposal systemProgram"), modes: modeList("ws rs w r r r r r r r r r r r r w r") },
  { tag: 55, builder: builders.buildApproveProposalV3Instruction as AnyBuilder, fields: fieldList("controllerConfig policy creationCouncil protocolGate capacityPolicy currentDeployment proposal bufferVerification seatAuthority"), modes: modeList("r r r r r r w r rs") },
  { tag: 56, builder: builders.buildFinalizeGovernanceV3Instruction as AnyBuilder, fields: fieldList("controllerConfig policy creationCouncil protocolGate capacityPolicy currentDeployment proposal"), modes: modeList("r r r r r r w") },
  { tag: 57, builder: builders.buildQueueProposalV3Instruction as AnyBuilder, fields: fieldList("controllerConfig policy protocolGate capacityPolicy currentDeployment proposal"), modes: modeList("r r r r r w") },
  { tag: 58, builder: builders.buildFreezeProposalV3Instruction as AnyBuilder, fields: fieldList("controllerConfig policy creationCouncil protocolGate capacityPolicy currentDeployment proposal targetProgram targetProgramdata upgradeableLoader authorityPda rollbackProposal rollbackBufferVerification rollbackBuffer"), modes: modeList("w r r w r r w r r r r r r r") },
  { tag: 59, builder: builders.buildCancelProposalV3Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate capacityPolicy currentDeployment proposal seatAuthority"), modes: modeList("r r r r r r w rs") },
  { tag: 60, builder: builders.buildExpireProposalV3Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate capacityPolicy currentDeployment proposal"), modes: modeList("r r r r w") },
  { tag: 61, builder: builders.buildGuardianFreezeV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig protocolGate capacityPolicy currentDeployment targetProgram targetProgramdata upgradeableLoader authorityPda guardian emergencyFreezeObservation systemProgram"), modes: modeList("ws r w r r r r r r rs w r") },
  { tag: 62, builder: builders.buildCreateEmergencyResolutionV2Instruction as AnyBuilder, fields: fieldList("payer creatorSeatAuthority controllerConfig policy currentCouncil protocolGate capacityPolicy currentDeployment emergencyFreezeObservation programdataObservation emergencyResolution systemProgram"), modes: modeList("ws rs r r r r r r r r w r") },
  { tag: 63, builder: builders.buildApproveEmergencyResolutionV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate capacityPolicy currentDeployment emergencyFreezeObservation programdataObservation emergencyCheckpoint emergencyResolution seatAuthority"), modes: modeList("r r r r r r r r r w rs") },
  { tag: 64, builder: builders.buildQueueEmergencyResolutionV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate capacityPolicy currentDeployment emergencyFreezeObservation programdataObservation emergencyCheckpoint emergencyResolution"), modes: modeList("r r r r r r r r r w") },
  { tag: 65, builder: builders.buildExecuteEmergencyResolutionV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate capacityPolicy currentDeployment emergencyResolution emergencyFreezeObservation programdataObservation emergencyCheckpoint targetProgram targetProgramdata upgradeableLoader authorityPda instructionsSysvar"), modes: modeList("r r r w r w w r r r r r r r r") },
  { tag: 66, builder: builders.buildExpireEmergencyResolutionV2Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate capacityPolicy currentDeployment emergencyResolution"), modes: modeList("r r r r w") },
  { tag: 67, builder: builders.buildCreateCheckpointV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig policy currentCouncil protocolGate subject linkedPrimaryOrAuthority capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata checkpoint checkpointAttestation seatAuthority systemProgram"), modes: modeList("ws r r r r r r r r r r r r w rs r") },
  { tag: 68, builder: builders.buildRecastCheckpointV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate subject linkedPrimaryOrAuthority capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata checkpoint checkpointAttestation seatAuthority"), modes: modeList("r r r r r r r r r r r r w rs") },
  { tag: 69, builder: builders.buildFinalizeCheckpointV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig policy currentCouncil protocolGate subject linkedPrimaryOrAuthority capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata checkpoint checkpointAttestations:3 systemProgram"), modes: modeList("ws r r r r r r r r r r r w r r r r") },
  { tag: 70, builder: builders.buildBindProgramDataVerificationV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig protocolGate proposal capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata authorityPda upgradeableLoader programdataVerification systemProgram"), modes: modeList("ws r r r r r r r r r r w r") },
  { tag: 71, builder: builders.buildFinalizeProgramDataVerificationV2Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate proposal capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata authorityPda upgradeableLoader programdataVerification"), modes: modeList("r r w r r r r r r r w") },
  { tag: 72, builder: builders.buildObserveProgramDataFailureV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig protocolGate primaryProposal programdataVerification capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata authorityPda upgradeableLoader failureObservation systemProgram"), modes: modeList("ws r r r r r r r r r r r w r") },
  { tag: 73, builder: builders.buildApproveUnfreezeV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate proposal poststateCheckpoint programdataVerification capacityPolicy currentDeployment targetProgram targetProgramdata authorityPda upgradeableLoader seatAuthority"), modes: modeList("r r r r w r r r r r r r r rs") },
  { tag: 74, builder: builders.buildExecuteUnfreezeV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy currentCouncil protocolGate proposal linkedProposal poststateCheckpoint programdataVerification capacityPolicy currentDeployment targetProgram targetProgramdata authorityPda upgradeableLoader instructionsSysvar"), modes: modeList("r r r w w w r r r w r r r r r") },
  { tag: 75, builder: custody.buildAdoptBufferV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig protocolGate proposal capacityPolicy currentDeployment buffer uploaderAuthority authorityPda bufferVerification upgradeableLoader systemProgram"), modes: modeList("ws r r w r r w rs r w r r") },
  { tag: 76, builder: custody.buildVerifyBufferChunkV2Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate proposal buffer bufferVerification authorityPda upgradeableLoader"), modes: modeList("r r r r w r r") },
  { tag: 77, builder: custody.buildFinalizeBufferVerificationV2Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate proposal buffer bufferVerification authorityPda upgradeableLoader"), modes: modeList("r r w r w r r") },
  { tag: 78, builder: custody.buildExtendTargetV2Instruction as AnyBuilder, fields: fieldList("payer controllerConfig protocolGate proposal capacityPolicy currentDeployment programdataObservation prestateCheckpoint targetProgramdata targetProgram authorityPda upgradeableLoader systemProgram rentSysvar instructionsSysvar"), modes: modeList("ws r r w r w r r w w w r r r r") },
  { tag: 79, builder: custody.buildExecuteUpgradeV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy protocolGate proposal counterpartProposal counterpartBufferVerification capacityPolicy currentDeployment prestateProgramdataObservation prestateCheckpoint currentProgramdataObservation bufferVerification targetProgramdata targetProgram buffer canonicalSpillTreasury rentSysvar clockSysvar authorityPda upgradeableLoader instructionsSysvar"), modes: modeList("r r r w r r r r r r r w w w w w r r r r r") },
  { tag: 80, builder: custody.buildCloseAbandonedBufferV2Instruction as AnyBuilder, fields: fieldList("controllerConfig protocolGate proposal bufferVerification buffer canonicalSpillTreasury authorityPda upgradeableLoader"), modes: modeList("r r r w w w r r") },
  { tag: 81, builder: custody.buildActivateRollbackV2Instruction as AnyBuilder, fields: fieldList("controllerConfig policy protocolGate primaryProposal rollbackProposal rollbackBufferVerification primaryProgramdataVerification failureObservation capacityPolicy currentDeployment programdataObservation targetProgram targetProgramdata authorityPda upgradeableLoader"), modes: modeList("r r w r w r r r r r r r r r r") },
];

test("every current tag 43 and 53-81 builder has the exact Rust account order and privileges", () => {
  assert.equal(builderCases.length, cases.length);
  for (const entry of builderCases) {
    const value = cases.find(([tag]) => tag === entry.tag)?.[2];
    assert.notEqual(value, undefined, `missing payload fixture for tag ${entry.tag}`);
    const { accounts, flattened } = materializeAccounts(entry.fields);
    const instruction = entry.builder(key(79), accounts as never, value as never);
    assert.equal(instruction.data[0], entry.tag);
    assert.deepEqual(instruction.keys.map((meta) => meta.pubkey.toBase58()), flattened.map((pubkey) => pubkey.toBase58()), `account order ${entry.tag}`);
    assert.deepEqual(instruction.keys.map((meta): Mode => meta.isSigner ? (meta.isWritable ? "ws" : "rs") : (meta.isWritable ? "w" : "r")), entry.modes, `account privileges ${entry.tag}`);
  }
});
