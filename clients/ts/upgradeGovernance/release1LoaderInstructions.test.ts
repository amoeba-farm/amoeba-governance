import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { VERIFICATION_BITMAP_BYTES_V1 } from "./artifactMerkleV1.js";
import {
  ACTIVATE_ROLLBACK_V1_LEN,
  ACTIVATE_ROLLBACK_V1_TAG,
  ADOPT_BUFFER_V1_LEN,
  ADOPT_BUFFER_V1_TAG,
  APPROVE_UNFREEZE_V1_LEN,
  APPROVE_UNFREEZE_V1_TAG,
  CLOSE_ABANDONED_BUFFER_V1_LEN,
  CLOSE_ABANDONED_BUFFER_V1_TAG,
  CREATE_EMERGENCY_RESOLUTION_V1_LEN,
  CREATE_EMERGENCY_RESOLUTION_V1_TAG,
  ENVELOPE_EXPECTATION_V1_LEN,
  EMERGENCY_RESOLUTION_EXPECTATION_V1_LEN,
  EXECUTE_EMERGENCY_RESOLUTION_V1_LEN,
  EXECUTE_EMERGENCY_RESOLUTION_V1_TAG,
  EXECUTE_UNFREEZE_V1_LEN,
  EXECUTE_UNFREEZE_V1_TAG,
  EXECUTE_UPGRADE_V1_LEN,
  EXECUTE_UPGRADE_V1_TAG,
  EXTEND_TARGET_V1_LEN,
  EXTEND_TARGET_V1_TAG,
  FINALIZE_BUFFER_VERIFICATION_V1_LEN,
  FINALIZE_BUFFER_VERIFICATION_V1_TAG,
  FINALIZE_PROGRAMDATA_VERIFICATION_V1_LEN,
  FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG,
  FIXED_MERKLE_PROOF_V1_LEN,
  GUARDIAN_FREEZE_V1_LEN,
  GUARDIAN_FREEZE_V1_TAG,
  MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
  MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
  MAX_FIXED_MERKLE_PROOF_NODES_V1,
  OBSERVE_PROGRAMDATA_FAILURE_V1_LEN,
  OBSERVE_PROGRAMDATA_FAILURE_V1_TAG,
  PROPOSAL_EXPECTATION_V2_LEN,
  ProgramDataChunkPhaseV1,
  UNFREEZE_EXPECTATION_V1_LEN,
  VERIFY_BUFFER_CHUNK_V1_LEN,
  VERIFY_BUFFER_CHUNK_V1_TAG,
  VERIFY_PROGRAMDATA_CHUNK_V1_LEN,
  VERIFY_PROGRAMDATA_CHUNK_V1_TAG,
  buildActivateRollbackV1Instruction,
  buildAdoptBufferV1Instruction,
  buildApproveUnfreezeV1Instruction,
  buildCloseAbandonedBufferV1Instruction,
  buildCreateEmergencyResolutionV1Instruction,
  buildExecuteEmergencyResolutionV1Instruction,
  buildExecuteUnfreezeV1Instruction,
  buildExecuteUpgradeV1Instruction,
  buildExtendTargetV1Instruction,
  buildFinalizeBufferVerificationV1Instruction,
  buildFinalizeProgramDataVerificationV1Instruction,
  buildGuardianFreezeV1Instruction,
  buildObserveProgramDataFailureV1Instruction,
  buildVerifyBufferChunkV1Instruction,
  buildVerifyProgramDataChunkV1Instruction,
  decodeActivateRollbackV1,
  decodeAdoptBufferV1,
  decodeApproveUnfreezeV1,
  decodeCloseAbandonedBufferV1,
  decodeCreateEmergencyResolutionV1,
  decodeExecuteEmergencyResolutionV1,
  decodeExecuteUnfreezeV1,
  decodeExecuteUpgradeV1,
  decodeExtendTargetV1,
  decodeFinalizeBufferVerificationV1,
  decodeFinalizeProgramDataVerificationV1,
  decodeGuardianFreezeV1,
  decodeObserveProgramDataFailureV1,
  decodeRelease1LoaderInstructionV1,
  decodeVerifyBufferChunkV1,
  decodeVerifyProgramDataChunkV1,
  encodeActivateRollbackV1,
  encodeAdoptBufferV1,
  encodeApproveUnfreezeV1,
  encodeCloseAbandonedBufferV1,
  encodeCreateEmergencyResolutionV1,
  encodeExecuteEmergencyResolutionV1,
  encodeExecuteUnfreezeV1,
  encodeExecuteUpgradeV1,
  encodeExtendTargetV1,
  encodeFinalizeBufferVerificationV1,
  encodeFinalizeProgramDataVerificationV1,
  encodeGuardianFreezeV1,
  encodeObserveProgramDataFailureV1,
  encodeVerifyBufferChunkV1,
  encodeVerifyProgramDataChunkV1,
  type ActivateRollbackV1,
  type AdoptBufferV1,
  type ApproveUnfreezeV1,
  type CloseAbandonedBufferV1,
  type CreateEmergencyResolutionV1,
  type EmergencyResolutionExpectationV1,
  type EnvelopeExpectationV1,
  type ExecuteUnfreezeV1,
  type ExecuteUpgradeV1,
  type ExecuteEmergencyResolutionV1,
  type ExtendTargetV1,
  type FinalizeBufferVerificationV1,
  type FinalizeProgramDataVerificationV1,
  type FixedMerkleProofV1,
  type GuardianFreezeV1,
  type ObserveProgramDataFailureV1,
  type OptionalInstructionPublicKeyV1,
  type ProposalExpectationV2,
  type UnfreezeExpectationV1,
  type VerifyBufferChunkV1,
  type VerifyProgramDataChunkV1,
} from "./release1LoaderInstructions.js";
import {
  BufferVerificationStatusV1,
  EmergencyFreezeResolutionKindV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
  ProgramDataMismatchClassV1,
  ProgramDataVerificationStatusV1,
  ProposalStateV2,
} from "./release1.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "./v1.js";

const key = (value: number): PublicKey => new PublicKey(Buffer.alloc(32, value));
const bytes = (value: number): Buffer => Buffer.alloc(32, value);
const sha256Hex = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const bitmap = (value: number): Buffer => Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1, value);
const none = (): OptionalInstructionPublicKeyV1 => ({ present: false, value: PublicKey.default });
const some = (value: number): OptionalInstructionPublicKeyV1 => ({ present: true, value: key(value) });

const expected = (): ProposalExpectationV2 => ({
  expectedProposalDigest: bytes(1),
  expectedPolicyVersion: 2n,
  expectedPolicyHash: bytes(3),
  expectedCouncilVersion: 4n,
  expectedCouncilHash: bytes(5),
  expectedGateStatus: GateStatusV1.FrozenForUpgrade,
  expectedGateEpoch: 6n,
  expectedTargetNonce: 7n,
  expectedState: ProposalStateV2.Frozen,
  expectedReviewStartSlot: 8n,
  expectedReviewEndSlot: 9n,
  expectedNotBeforeSlot: 10n,
  expectedExpirySlot: 11n,
});

const emergencyExpected = (): EmergencyResolutionExpectationV1 => ({
  expectedResolutionDigest: bytes(67),
  expectedPolicyVersion: 68n,
  expectedPolicyHash: bytes(69),
  expectedCouncilVersion: 70n,
  expectedCouncilHash: bytes(71),
  expectedGateStatus: GateStatusV1.EmergencyFrozen,
  expectedGateEpoch: 72n,
  expectedFreezeSlot: 73n,
  expectedFreezeReasonCode: 74,
  expectedTargetNonce: 75n,
  expectedState: EmergencyFreezeResolutionStateV1.Timelocked,
  expectedNotBeforeSlot: 76n,
  expectedExpirySlot: 77n,
});

const proof = (): FixedMerkleProofV1 => ({
  proofLen: 2,
  nodes: [bytes(12), bytes(13), ...Array.from({ length: 5 }, () => Buffer.alloc(32))],
});
const emptyProof = (): FixedMerkleProofV1 => ({
  proofLen: 0,
  nodes: Array.from({ length: MAX_FIXED_MERKLE_PROOF_NODES_V1 }, () => Buffer.alloc(32)),
});

const envelope = (): EnvelopeExpectationV1 => ({
  computeUnitLimit: 1_200_000,
  computeUnitPriceMicroLamports: 17n,
  durableNonceAccount: some(14),
  durableNonceAuthority: some(15),
});

const unfreeze = (): UnfreezeExpectationV1 => ({
  expectedProposalDigest: bytes(16),
  expectedPolicyVersion: 17n,
  expectedPolicyHash: bytes(18),
  expectedCurrentCouncilVersion: 19n,
  expectedCurrentCouncilHash: bytes(20),
  expectedFrozenGateEpoch: 21n,
  expectedTargetNonce: 22n,
  expectedProposalState: ProposalStateV2.PoststateAccepted,
  expectedPoststateCheckpointDigest: bytes(23),
  expectedProgramdataAuthority: key(24),
  expectedProgramdataDeployedSlot: 25n,
  expectedProgramdataCapacity: 26n,
  expectedRawProgramdataHash: bytes(27),
  expectedUnfreezeApprovalBitset: 3,
  expectedUnfreezeApprovalCount: 2,
  expectedProgramdataVerificationFinalizedSlot: 28n,
});

const adopt: AdoptBufferV1 = { expected: expected() };
const verifyBuffer: VerifyBufferChunkV1 = {
  expected: expected(),
  chunkIndex: 1,
  proof: proof(),
  expectedVerificationStatus: BufferVerificationStatusV1.Verifying,
  expectedVerifiedChunkBitmap: bitmap(1),
  expectedVerifiedChunkCount: 2,
};
const finalizeBuffer: FinalizeBufferVerificationV1 = {
  expected: expected(),
  expectedVerificationStatus: BufferVerificationStatusV1.ReadyToFinalize,
  expectedVerifiedChunkBitmap: bitmap(0xff),
  expectedVerifiedChunkCount: 128,
};
const extend: ExtendTargetV1 = {
  expected: expected(),
  expectedPrestateCheckpointDigest: bytes(29),
  expectedCurrentCapacity: 1_000n,
  expectedExtensionDelta: 200n,
  expectedPostCapacity: 1_200n,
  envelope: envelope(),
};
const executeUpgrade: ExecuteUpgradeV1 = {
  expected: expected(),
  expectedPrestateCheckpointDigest: bytes(30),
  expectedCurrentRawProgramdataHash: bytes(31),
  expectedSealedBufferHeaderHash: bytes(32),
  expectedCounterpartProposalDigest: bytes(33),
  expectedProgramdataSlot: 34n,
  expectedCapacity: 35n,
  expectedVerifiedChunkCount: 128,
  expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
  expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
  envelope: envelope(),
};
const verifyProgramdata: VerifyProgramDataChunkV1 = {
  expected: expected(),
  phase: ProgramDataChunkPhaseV1.Payload,
  chunkIndex: 2,
  proof: proof(),
  expectedVerificationStatus: ProgramDataVerificationStatusV1.Verifying,
  expectedVerifiedPayloadChunkBitmap: bitmap(2),
  expectedVerifiedPayloadChunkCount: 3,
  expectedVerifiedTailChunkBitmap: bitmap(0),
  expectedVerifiedTailChunkCount: 0,
};
const finalizeProgramdata: FinalizeProgramDataVerificationV1 = {
  expected: expected(),
  expectedVerificationStatus: ProgramDataVerificationStatusV1.ReadyToFinalize,
  expectedVerifiedPayloadChunkBitmap: bitmap(0xff),
  expectedVerifiedPayloadChunkCount: 128,
  expectedVerifiedTailChunkBitmap: bitmap(0),
  expectedVerifiedTailChunkCount: 0,
  expectedDeployedSlot: 36n,
  expectedCapacity: 37n,
};
const approveUnfreeze: ApproveUnfreezeV1 = { expected: unfreeze() };
const executeUnfreeze: ExecuteUnfreezeV1 = {
  expected: unfreeze(),
  linkedProposal: key(38),
  envelope: envelope(),
};
const closeBuffer: CloseAbandonedBufferV1 = {
  expected: expected(),
  expectedVerificationStatus: BufferVerificationStatusV1.Verified,
  expectedVerifiedChunkBitmap: bitmap(0xff),
  expectedVerifiedChunkCount: 128,
  expectedBufferVerificationFinalizedSlot: 39n,
};
const activateRollback: ActivateRollbackV1 = {
  expectedPrimary: expected(),
  expectedRollback: expected(),
  expectedFailureEvidenceDigest: bytes(40),
  expectedPrimaryProgramdataVerificationStatus: ProgramDataVerificationStatusV1.Verifying,
  expectedPrimaryProgramdataVerificationFinalizedSlot: 0n,
  expectedRollbackBufferVerificationStatus: BufferVerificationStatusV1.Verified,
  expectedRollbackVerifiedChunkBitmap: bitmap(0xff),
  expectedRollbackVerifiedChunkCount: 128,
};
const observeFailure: ObserveProgramDataFailureV1 = {
  expected: expected(),
  expectedProgramOwner: key(41),
  expectedProgramExecutable: true,
  expectedProgramDataLength: 36n,
  expectedProgramHeaderPresent: true,
  expectedLinkedProgramdata: some(42),
  expectedProgramdataOwner: key(41),
  expectedProgramdataExecutable: false,
  expectedProgramdataDataLength: 8_237n,
  expectedProgramdataHeaderPresent: true,
  expectedProgramdataSlot: 43n,
  expectedRawHashComplete: true,
  expectedRawProgramdataHash: bytes(44),
  expectedCapacity: 8_192n,
  expectedProgramdataAuthority: some(45),
  mismatchClass: ProgramDataMismatchClassV1.PayloadLeaf,
  failingChunkIndex: 3,
  expectedLeafHash: bytes(46),
  proof: proof(),
};

const guardianFreeze: GuardianFreezeV1 = {
  expectedGateStatus: GateStatusV1.Active,
  expectedGateEpoch: 44n,
  expectedNextGateEpoch: 45n,
  expectedTargetNonce: 46n,
  expectedProgramOwner: key(43),
  expectedProgramExecutable: true,
  expectedProgramDataLength: 36n,
  expectedProgramHeaderPresent: true,
  expectedLinkedProgramdata: some(44),
  expectedProgramdataOwner: key(47),
  expectedProgramdataExecutable: false,
  expectedProgramdataDataLength: 4_141n,
  expectedProgramdataHeaderPresent: true,
  expectedProgramdataSlot: 47n,
  expectedRawHashComplete: true,
  expectedRawProgramdataHash: bytes(48),
  expectedCapacity: 4_096n,
  expectedProgramdataAuthority: some(50),
  freezeReasonCode: 51,
  expectedObservationDigest: bytes(52),
};

const createEmergencyResolution: CreateEmergencyResolutionV1 = {
  resolutionKind: EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade,
  creationSlot: 51n,
  notBeforeSlot: 52n,
  expirySlot: 53n,
  expectedPolicyVersion: 54n,
  expectedPolicyHash: bytes(55),
  expectedCouncilVersion: 56n,
  expectedCouncilHash: bytes(57),
  expectedGateEpoch: 58n,
  expectedFreezeSlot: 59n,
  expectedFreezeReasonCode: 60,
  expectedTargetNonce: 61n,
  expectedFreezeObservationDigest: bytes(62),
  observedProgramOwner: key(58),
  observedProgramExecutable: true,
  observedProgramDataLength: 36n,
  observedProgramHeaderPresent: true,
  observedLinkedProgramdata: some(59),
  observedProgramdataOwner: key(63),
  observedProgramdataExecutable: false,
  observedProgramdataDataLength: 4_141n,
  observedProgramdataHeaderPresent: true,
  observedProgramdataSlot: 63n,
  observedRawHashComplete: true,
  observedRawProgramdataHash: bytes(64),
  observedCapacity: 4_096n,
  observedProgramdataAuthority: some(66),
  expectedResolutionDigest: bytes(67),
};

const executeEmergencyResolution: ExecuteEmergencyResolutionV1 = {
  expected: emergencyExpected(),
  expectedFreezeObservationDigest: bytes(127),
  expectedCheckpointDigest: bytes(128),
  expectedProgramOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramExecutable: true,
  expectedProgramDataLength: 36n,
  expectedProgramHeaderPresent: true,
  expectedLinkedProgramdata: some(126),
  expectedProgramdataOwner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  expectedProgramdataExecutable: false,
  expectedProgramdataDataLength: 4_141n,
  expectedProgramdataHeaderPresent: true,
  expectedProgramdataSlot: 129n,
  expectedRawHashComplete: true,
  expectedRawProgramdataHash: bytes(130),
  expectedCapacity: 4_096n,
  expectedProgramdataAuthority: some(132),
};

test("Release 1 loader codecs match every fixed tag and exact length", () => {
  assert.equal(FIXED_MERKLE_PROOF_V1_LEN, 225);
  assert.equal(ENVELOPE_EXPECTATION_V1_LEN, 78);
  assert.equal(PROPOSAL_EXPECTATION_V2_LEN, 162);
  assert.equal(UNFREEZE_EXPECTATION_V1_LEN, 251);
  assert.equal(EMERGENCY_RESOLUTION_EXPECTATION_V1_LEN, 156);
  const cases = [
    [GUARDIAN_FREEZE_V1_TAG, GUARDIAN_FREEZE_V1_LEN, encodeGuardianFreezeV1, decodeGuardianFreezeV1, guardianFreeze],
    [CREATE_EMERGENCY_RESOLUTION_V1_TAG, CREATE_EMERGENCY_RESOLUTION_V1_LEN, encodeCreateEmergencyResolutionV1, decodeCreateEmergencyResolutionV1, createEmergencyResolution],
    [EXECUTE_EMERGENCY_RESOLUTION_V1_TAG, EXECUTE_EMERGENCY_RESOLUTION_V1_LEN, encodeExecuteEmergencyResolutionV1, decodeExecuteEmergencyResolutionV1, executeEmergencyResolution],
    [ADOPT_BUFFER_V1_TAG, ADOPT_BUFFER_V1_LEN, encodeAdoptBufferV1, decodeAdoptBufferV1, adopt],
    [VERIFY_BUFFER_CHUNK_V1_TAG, VERIFY_BUFFER_CHUNK_V1_LEN, encodeVerifyBufferChunkV1, decodeVerifyBufferChunkV1, verifyBuffer],
    [FINALIZE_BUFFER_VERIFICATION_V1_TAG, FINALIZE_BUFFER_VERIFICATION_V1_LEN, encodeFinalizeBufferVerificationV1, decodeFinalizeBufferVerificationV1, finalizeBuffer],
    [EXTEND_TARGET_V1_TAG, EXTEND_TARGET_V1_LEN, encodeExtendTargetV1, decodeExtendTargetV1, extend],
    [EXECUTE_UPGRADE_V1_TAG, EXECUTE_UPGRADE_V1_LEN, encodeExecuteUpgradeV1, decodeExecuteUpgradeV1, executeUpgrade],
    [VERIFY_PROGRAMDATA_CHUNK_V1_TAG, VERIFY_PROGRAMDATA_CHUNK_V1_LEN, encodeVerifyProgramDataChunkV1, decodeVerifyProgramDataChunkV1, verifyProgramdata],
    [FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG, FINALIZE_PROGRAMDATA_VERIFICATION_V1_LEN, encodeFinalizeProgramDataVerificationV1, decodeFinalizeProgramDataVerificationV1, finalizeProgramdata],
    [APPROVE_UNFREEZE_V1_TAG, APPROVE_UNFREEZE_V1_LEN, encodeApproveUnfreezeV1, decodeApproveUnfreezeV1, approveUnfreeze],
    [EXECUTE_UNFREEZE_V1_TAG, EXECUTE_UNFREEZE_V1_LEN, encodeExecuteUnfreezeV1, decodeExecuteUnfreezeV1, executeUnfreeze],
    [CLOSE_ABANDONED_BUFFER_V1_TAG, CLOSE_ABANDONED_BUFFER_V1_LEN, encodeCloseAbandonedBufferV1, decodeCloseAbandonedBufferV1, closeBuffer],
    [ACTIVATE_ROLLBACK_V1_TAG, ACTIVATE_ROLLBACK_V1_LEN, encodeActivateRollbackV1, decodeActivateRollbackV1, activateRollback],
    [OBSERVE_PROGRAMDATA_FAILURE_V1_TAG, OBSERVE_PROGRAMDATA_FAILURE_V1_LEN, encodeObserveProgramDataFailureV1, decodeObserveProgramDataFailureV1, observeFailure],
  ] as const;

  for (const [tag, length, encode, decode, value] of cases) {
    const data = (encode as (value: never) => Buffer)(value as never);
    assert.equal(data[0], tag);
    assert.equal(data.length, length);
    assert.deepEqual((encode as (value: never) => Buffer)((decode as (data: Buffer) => never)(data)), data);
    assert.equal(decodeRelease1LoaderInstructionV1(data).tag, tag);
    assert.throws(() => (decode as (data: Buffer) => unknown)(data.subarray(0, data.length - 1)));
    assert.throws(() => (decode as (data: Buffer) => unknown)(Buffer.concat([data, Buffer.from([0])])));
  }
  for (const unsupportedTag of [1, 8, 11, 12, 14, 26, 39]) {
    assert.throws(() => decodeRelease1LoaderInstructionV1(Buffer.from([unsupportedTag])));
  }
});

test("tags 9, 10, and 13 match the canonical Rust SHA-256 vectors", () => {
  const vectors = [
    [
      encodeGuardianFreezeV1(guardianFreeze),
      "857d6e2c23661eeb4ae8f343a14c4aca2ec7ab2ee90c298166c7b49ed128f0c8",
    ],
    [
      encodeCreateEmergencyResolutionV1(createEmergencyResolution),
      "1f5e1f21db5fc4c2b3014352b16b0ac87fcb5ec4bf06fd7b9b516aef699aae42",
    ],
    [
      encodeExecuteEmergencyResolutionV1(executeEmergencyResolution),
      "c8ff25283cdf05d3fa249f8cbb99f803aad8f305f84db75fcced32885faad0ef",
    ],
  ] as const;
  for (const [encoded, expectedHash] of vectors) {
    assert.equal(sha256Hex(encoded), expectedHash);
  }
});

test("emergency instruction enums, booleans, and observation graphs fail closed", () => {
  const badGuardianGate = encodeGuardianFreezeV1(guardianFreeze);
  badGuardianGate[1] = 0xff;
  assert.throws(() => decodeGuardianFreezeV1(badGuardianGate), /GateStatusV1/);

  const badGuardianBool = encodeGuardianFreezeV1(guardianFreeze);
  badGuardianBool[58] = 2;
  assert.throws(() => decodeGuardianFreezeV1(badGuardianBool), /canonical boolean/);

  const badResolutionKind = encodeCreateEmergencyResolutionV1(createEmergencyResolution);
  badResolutionKind[1] = 0xff;
  assert.throws(
    () => decodeCreateEmergencyResolutionV1(badResolutionKind),
    /EmergencyFreezeResolutionKindV1/,
  );

  const badExecuteGate = encodeExecuteEmergencyResolutionV1(executeEmergencyResolution);
  badExecuteGate[113] = 0xff;
  assert.throws(() => decodeExecuteEmergencyResolutionV1(badExecuteGate), /GateStatusV1/);

  const badExecuteState = encodeExecuteEmergencyResolutionV1(executeEmergencyResolution);
  badExecuteState[140] = 0xff;
  assert.throws(
    () => decodeExecuteEmergencyResolutionV1(badExecuteState),
    /EmergencyFreezeResolutionStateV1/,
  );

  assert.throws(
    () => encodeGuardianFreezeV1({ ...guardianFreeze, expectedProgramDataLength: 35n }),
    /Program header/,
  );
  assert.throws(
    () =>
      encodeCreateEmergencyResolutionV1({
        ...createEmergencyResolution,
        observedProgramdataDataLength: 4_142n,
      }),
    /ProgramData header/,
  );
  assert.throws(
    () =>
      encodeCreateEmergencyResolutionV1({
        ...createEmergencyResolution,
        observedRawHashComplete: false,
        observedRawProgramdataHash: Buffer.alloc(32),
      }),
    /raw ProgramData hash/,
  );

  assert.throws(
    () =>
      encodeExecuteEmergencyResolutionV1({
        ...executeEmergencyResolution,
        expectedProgramOwner: key(125),
      }),
    /canonical Loader-v3 graph/,
  );
  assert.throws(
    () =>
      encodeExecuteEmergencyResolutionV1({
        ...executeEmergencyResolution,
        expectedProgramHeaderPresent: false,
        expectedLinkedProgramdata: none(),
      }),
    /canonical Loader-v3 graph/,
  );
  assert.throws(
    () =>
      encodeExecuteEmergencyResolutionV1({
        ...executeEmergencyResolution,
        expectedProgramdataAuthority: none(),
      }),
    /canonical Loader-v3 graph/,
  );
  assert.throws(
    () =>
      encodeExecuteEmergencyResolutionV1({
        ...executeEmergencyResolution,
        expectedProgramdataDataLength:
          MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n,
        expectedCapacity:
          MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n - 45n,
        expectedRawHashComplete: false,
        expectedRawProgramdataHash: Buffer.alloc(32),
      }),
    /canonical Loader-v3 graph/,
  );

  assert.throws(
    () => encodeGuardianFreezeV1({ ...guardianFreeze, freezeReasonCode: 0x1_0000 }),
    /freezeReasonCode/,
  );
  assert.throws(
    () =>
      encodeCreateEmergencyResolutionV1({
        ...createEmergencyResolution,
        creationSlot: -1n,
      }),
    /creationSlot/,
  );
});

test("tag 38 freezes the complete Program and ProgramData evidence wire order", () => {
  const encoded = encodeObserveProgramDataFailureV1(observeFailure);
  const evidenceOffset = 1 + PROPOSAL_EXPECTATION_V2_LEN;
  assert.deepEqual(
    encoded.subarray(evidenceOffset, evidenceOffset + 32),
    observeFailure.expectedProgramOwner.toBuffer(),
  );
  assert.equal(encoded[evidenceOffset + 32], 1);
  assert.equal(encoded.readBigUInt64LE(evidenceOffset + 33), 36n);
  assert.equal(encoded[evidenceOffset + 41], 1);
  assert.equal(encoded[evidenceOffset + 42], 1);
  assert.deepEqual(
    encoded.subarray(evidenceOffset + 43, evidenceOffset + 75),
    observeFailure.expectedLinkedProgramdata.value.toBuffer(),
  );
  assert.deepEqual(
    encoded.subarray(evidenceOffset + 75, evidenceOffset + 107),
    observeFailure.expectedProgramdataOwner.toBuffer(),
  );
  assert.equal(encoded[evidenceOffset + 107], 0);
  assert.equal(encoded.readBigUInt64LE(evidenceOffset + 108), 8_237n);
  assert.equal(encoded[evidenceOffset + 116], 1);
  assert.equal(encoded.readBigUInt64LE(evidenceOffset + 117), 43n);
  assert.equal(encoded[evidenceOffset + 125], 1);
  assert.deepEqual(
    encoded.subarray(evidenceOffset + 126, evidenceOffset + 158),
    observeFailure.expectedRawProgramdataHash,
  );
  assert.equal(encoded.readBigUInt64LE(evidenceOffset + 158), 8_192n);
  assert.equal(encoded[evidenceOffset + 166], 1);
  assert.deepEqual(
    encoded.subarray(evidenceOffset + 167, evidenceOffset + 199),
    observeFailure.expectedProgramdataAuthority.value.toBuffer(),
  );
  assert.equal(encoded[evidenceOffset + 199], observeFailure.mismatchClass);
  assert.equal(encoded.readUInt32LE(evidenceOffset + 200), observeFailure.failingChunkIndex);
  assert.deepEqual(
    encoded.subarray(evidenceOffset + 204, evidenceOffset + 236),
    observeFailure.expectedLeafHash,
  );
  assert.equal(encoded.length, 624);
});

test("proof padding, phase shape, failure shape, and envelope bounds fail closed", () => {
  const padded = encodeVerifyBufferChunkV1(verifyBuffer);
  const proofLengthOffset = 1 + PROPOSAL_EXPECTATION_V2_LEN + 4;
  padded[proofLengthOffset + 1 + 2 * 32] = 1;
  assert.throws(() => decodeVerifyBufferChunkV1(padded));

  assert.throws(() => encodeVerifyProgramDataChunkV1({
    ...verifyProgramdata,
    phase: ProgramDataChunkPhaseV1.ZeroTail,
    proof: proof(),
  }));
  assert.doesNotThrow(() => encodeVerifyProgramDataChunkV1({
    ...verifyProgramdata,
    phase: ProgramDataChunkPhaseV1.ZeroTail,
    proof: emptyProof(),
  }));

  assert.throws(() => encodeObserveProgramDataFailureV1({
    ...observeFailure,
    mismatchClass: ProgramDataMismatchClassV1.Header,
  }));
  assert.doesNotThrow(() => encodeObserveProgramDataFailureV1({
    ...observeFailure,
    mismatchClass: ProgramDataMismatchClassV1.Header,
    expectedProgramdataDataLength:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n,
    expectedCapacity:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 +
      1n -
      45n,
    expectedRawHashComplete: false,
    expectedRawProgramdataHash: Buffer.alloc(32),
    failingChunkIndex: 0xffff_ffff,
    expectedLeafHash: Buffer.alloc(32),
    proof: emptyProof(),
  }));
  assert.throws(() => encodeObserveProgramDataFailureV1({
    ...observeFailure,
    expectedProgramDataLength: 35n,
  }), /Program header/);
  assert.throws(() => encodeObserveProgramDataFailureV1({
    ...observeFailure,
    expectedProgramdataDataLength: 8_238n,
  }), /ProgramData header/);
  assert.throws(() => encodeObserveProgramDataFailureV1({
    ...observeFailure,
    expectedRawHashComplete: false,
    expectedRawProgramdataHash: Buffer.alloc(32),
  }), /raw ProgramData hash|rawHashComplete|complete raw hash/);

  const noncanonicalProgramBool = encodeObserveProgramDataFailureV1(observeFailure);
  noncanonicalProgramBool[1 + PROPOSAL_EXPECTATION_V2_LEN + 32] = 2;
  assert.throws(
    () => decodeObserveProgramDataFailureV1(noncanonicalProgramBool),
    /canonical boolean/,
  );

  for (const invalidEnvelope of [
    { ...envelope(), computeUnitLimit: 0 },
    { ...envelope(), computeUnitLimit: MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1 + 1 },
    { ...envelope(), computeUnitPriceMicroLamports: MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1 + 1n },
    { ...envelope(), durableNonceAccount: none() },
    { ...envelope(), durableNonceAuthority: none() },
  ]) {
    assert.throws(() => encodeExtendTargetV1({ ...extend, envelope: invalidEnvelope }));
  }
  assert.doesNotThrow(() => encodeExtendTargetV1({
    ...extend,
    envelope: {
      computeUnitLimit: MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
      computeUnitPriceMicroLamports: MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
      durableNonceAccount: none(),
      durableNonceAuthority: none(),
    },
  }));
  assert.throws(() => encodeExecuteUnfreezeV1({
    ...executeUnfreeze,
    linkedProposal: PublicKey.default,
  }));
});

function assertLayout(
  instruction: TransactionInstruction,
  expectedKeys: readonly PublicKey[],
  flags: string,
): void {
  assert.deepEqual(instruction.keys.map((meta) => meta.pubkey.toBase58()), expectedKeys.map((item) => item.toBase58()));
  assert.equal(instruction.keys.map((meta) => `${Number(meta.isSigner)}${Number(meta.isWritable)}`).join(" "), flags);
}

test("typed builders freeze exact account order and privilege flags", () => {
  const program = key(200);
  const k = Array.from({ length: 20 }, (_, index) => key(index + 50));

  assertLayout(buildGuardianFreezeV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, protocolGate: k[2]!, targetProgram: k[3]!, targetProgramdata: k[4]!, upgradeableLoader: k[5]!, authorityPda: k[6]!, guardian: k[7]!, emergencyFreezeObservation: k[8]!, systemProgram: k[9]! }, guardianFreeze), k.slice(0, 10), "11 00 01 00 00 00 00 10 01 00");
  assertLayout(buildCreateEmergencyResolutionV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, policy: k[2]!, council: k[3]!, protocolGate: k[4]!, emergencyFreezeObservation: k[5]!, emergencyResolution: k[6]!, systemProgram: k[7]! }, createEmergencyResolution), k.slice(0, 8), "11 00 00 00 00 00 01 00");
  assertLayout(buildExecuteEmergencyResolutionV1Instruction(program, { controllerConfig: k[0]!, policy: k[1]!, council: k[2]!, protocolGate: k[3]!, emergencyResolution: k[4]!, emergencyFreezeObservation: k[5]!, emergencyCheckpoint: k[6]!, targetProgram: k[7]!, targetProgramdata: k[8]!, upgradeableLoader: k[9]!, authorityPda: k[10]!, instructionsSysvar: k[11]! }, executeEmergencyResolution), k.slice(0, 12), "00 00 00 01 01 00 00 00 00 00 00 00");
  assertLayout(buildAdoptBufferV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, protocolGate: k[2]!, proposal: k[3]!, buffer: k[4]!, uploaderAuthority: k[5]!, authorityPda: k[6]!, bufferVerification: k[7]!, upgradeableLoader: k[8]!, systemProgram: k[9]! }, adopt), k.slice(0, 10), "11 00 00 01 01 10 00 01 00 00");
  assertLayout(buildVerifyBufferChunkV1Instruction(program, { controllerConfig: k[0]!, protocolGate: k[1]!, proposal: k[2]!, buffer: k[3]!, bufferVerification: k[4]!, authorityPda: k[5]!, upgradeableLoader: k[6]! }, verifyBuffer), k.slice(0, 7), "00 00 00 00 01 00 00");
  assertLayout(buildFinalizeBufferVerificationV1Instruction(program, { controllerConfig: k[0]!, protocolGate: k[1]!, proposal: k[2]!, buffer: k[3]!, bufferVerification: k[4]!, authorityPda: k[5]!, upgradeableLoader: k[6]! }, finalizeBuffer), k.slice(0, 7), "00 00 01 00 01 00 00");
  assertLayout(buildExtendTargetV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, protocolGate: k[2]!, proposal: k[3]!, prestateCheckpoint: k[4]!, targetProgramdata: k[5]!, targetProgram: k[6]!, authorityPda: k[7]!, upgradeableLoader: k[8]!, systemProgram: k[9]!, rentSysvar: k[10]!, instructionsSysvar: k[11]! }, extend), k.slice(0, 12), "11 00 00 01 00 01 01 01 00 00 00 00");
  assertLayout(buildExecuteUpgradeV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, policy: k[2]!, protocolGate: k[3]!, proposal: k[4]!, counterpartProposal: k[5]!, counterpartBufferVerification: k[6]!, prestateCheckpoint: k[7]!, bufferVerification: k[8]!, programdataVerification: k[9]!, targetProgramdata: k[10]!, targetProgram: k[11]!, buffer: k[12]!, canonicalSpillTreasury: k[13]!, rentSysvar: k[14]!, clockSysvar: k[15]!, authorityPda: k[16]!, upgradeableLoader: k[17]!, systemProgram: k[18]!, instructionsSysvar: k[19]! }, executeUpgrade), k, "11 00 00 00 01 00 00 00 01 01 01 01 01 01 00 00 00 00 00 00");
  assertLayout(buildVerifyProgramDataChunkV1Instruction(program, { controllerConfig: k[0]!, protocolGate: k[1]!, proposal: k[2]!, targetProgram: k[3]!, targetProgramdata: k[4]!, authorityPda: k[5]!, upgradeableLoader: k[6]!, programdataVerification: k[7]! }, verifyProgramdata), k.slice(0, 8), "00 00 00 00 00 00 00 01");
  assertLayout(buildFinalizeProgramDataVerificationV1Instruction(program, { controllerConfig: k[0]!, protocolGate: k[1]!, proposal: k[2]!, targetProgram: k[3]!, targetProgramdata: k[4]!, authorityPda: k[5]!, upgradeableLoader: k[6]!, programdataVerification: k[7]! }, finalizeProgramdata), k.slice(0, 8), "00 00 01 00 00 00 00 01");
  assertLayout(buildApproveUnfreezeV1Instruction(program, { controllerConfig: k[0]!, policy: k[1]!, currentCouncil: k[2]!, protocolGate: k[3]!, proposal: k[4]!, poststateCheckpoint: k[5]!, programdataVerification: k[6]!, targetProgram: k[7]!, targetProgramdata: k[8]!, authorityPda: k[9]!, upgradeableLoader: k[10]!, seatAuthority: k[11]! }, approveUnfreeze), k.slice(0, 12), "00 00 00 00 01 00 00 00 00 00 00 10");
  assertLayout(buildExecuteUnfreezeV1Instruction(program, { controllerConfig: k[0]!, policy: k[1]!, currentCouncil: k[2]!, protocolGate: k[3]!, proposal: k[4]!, linkedProposal: k[5]!, poststateCheckpoint: k[6]!, programdataVerification: k[7]!, targetProgram: k[8]!, targetProgramdata: k[9]!, authorityPda: k[10]!, upgradeableLoader: k[11]!, instructionsSysvar: k[12]! }, executeUnfreeze), k.slice(0, 13), "00 00 00 01 01 01 00 00 00 00 00 00 00");
  assertLayout(buildCloseAbandonedBufferV1Instruction(program, { controllerConfig: k[0]!, protocolGate: k[1]!, proposal: k[2]!, bufferVerification: k[3]!, buffer: k[4]!, canonicalSpillTreasury: k[5]!, authorityPda: k[6]!, upgradeableLoader: k[7]! }, closeBuffer), k.slice(0, 8), "00 00 00 01 01 01 00 00");
  assertLayout(buildActivateRollbackV1Instruction(program, { controllerConfig: k[0]!, policy: k[1]!, protocolGate: k[2]!, primaryProposal: k[3]!, rollbackProposal: k[4]!, rollbackBufferVerification: k[5]!, primaryProgramdataVerification: k[6]!, failureEvidence: k[7]!, targetProgram: k[8]!, targetProgramdata: k[9]!, authorityPda: k[10]!, upgradeableLoader: k[11]! }, activateRollback), k.slice(0, 12), "00 00 01 00 01 00 00 00 00 00 00 00");
  assertLayout(buildObserveProgramDataFailureV1Instruction(program, { payer: k[0]!, controllerConfig: k[1]!, protocolGate: k[2]!, primaryProposal: k[3]!, programdataVerification: k[4]!, targetProgram: k[5]!, targetProgramdata: k[6]!, authorityPda: k[7]!, upgradeableLoader: k[8]!, failureObservation: k[9]!, systemProgram: k[10]! }, observeFailure), k.slice(0, 11), "11 00 00 00 00 00 00 00 00 01 00");
});
