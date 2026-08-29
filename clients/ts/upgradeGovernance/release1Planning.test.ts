import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import * as publicPackage from "./index.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

const b = (value: number): Buffer => Buffer.alloc(32, value);
const k = (value: number): PublicKey => new PublicKey(b(value));

test("public package exports account, Merkle, instruction, planning, and bridge namespaces", () => {
  assert.equal(publicPackage.release1Accounts.UPGRADE_PROPOSAL_V2_LEN, 1_792);
  assert.equal(publicPackage.artifactMerkleV1.RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 16 * 1024);
  assert.equal(publicPackage.release1CurrentInstructions.CREATE_CANDIDATE_COUNCIL_SET_V1_TAG, 18);
  assert.equal(publicPackage.release1V3Instructions.INITIALIZE_CONTROLLER_V2_TAG, 53);
  assert.equal(publicPackage.release1V3CustodyInstructions.ACTIVATE_ROLLBACK_V2_TAG, 81);
  assert.equal("release1LifecycleInstructions" in publicPackage, false);
  assert.equal("release1LoaderInstructions" in publicPackage, false);
  assert.equal(publicPackage.legacyV1.GOVERNANCE_TAIL_LEN, 16);
  assert.ok(publicPackage.spreadGateBridgeV1.SYNTHETIC_CONTROLLER_PROGRAM_V1 instanceof PublicKey);
});

test("finalized observation parsing rejects weaker commitment and hashes exact bytes", () => {
  const data = Buffer.from("canonical account bytes", "utf8");
  const response = { context: { slot: 42 }, value: { owner: k(2).toBase58(), lamports: 7, executable: false, rentEpoch: 9, data: [data.toString("base64"), "base64"] as const } };
  const observed = publicPackage.parseFinalizedAccountObservationV1(k(1), response, "finalized");
  assert.equal(observed.contextSlot, 42n);
  assert.deepEqual(observed.data, data);
  assert.equal(observed.dataSha256.toString("hex"), "86baffc4a97cf38f2cbff844b636da56177e6f51d4e524e8cf87e79f99777ac5");
  assert.throws(() => publicPackage.parseFinalizedAccountObservationV1(k(1), response, "confirmed"));
});

test("freeze planning mirrors the controller checkpoint and extension runway", () => {
  assert.equal(publicPackage.requiredRelease1FreezeRunwaySlotsV1(4n, 0n), 5n);
  assert.equal(publicPackage.requiredRelease1FreezeRunwaySlotsV1(4n, 1n), 6n);
  publicPackage.assertRelease1FreezeRunwayV1({
    currentSlot: 94n,
    expirySlot: 100n,
    councilReviewSlots: 4n,
    extensionDelta: 0n,
  });
  assert.throws(() => publicPackage.assertRelease1FreezeRunwayV1({
    currentSlot: 95n,
    expirySlot: 100n,
    councilReviewSlots: 4n,
    extensionDelta: 0n,
  }), /insufficient protected freeze runway/u);
  assert.throws(() => publicPackage.requiredRelease1FreezeRunwaySlotsV1(
    0xffff_ffff_ffff_ffffn,
    1n,
  ), /overflows u64/u);
});

test("production identity, token defaults, cluster domain, and deterministic plans fail closed", () => {
  assert.throws(() => publicPackage.assertProductionControllerIdentityV1(SYNTHETIC_CONTROLLER_PROGRAM_V1));
  assert.throws(() => publicPackage.assertProductionControllerIdentityV1(PublicKey.default));
  publicPackage.assertProductionControllerIdentityV1(k(201));
  publicPackage.assertTokenGovernanceDisabledV1({ tokenGovernanceEnabled: false, voteProgram: PublicKey.default, voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default });
  assert.throws(() => publicPackage.assertTokenGovernanceDisabledV1({ tokenGovernanceEnabled: true, voteProgram: PublicKey.default, voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default }));

  const genesis = k(202).toBase58();
  publicPackage.assertClusterDomainV1(k(202).toBuffer(), genesis);
  assert.throws(() => publicPackage.assertClusterDomainV1(b(203), genesis));

  const bindings: publicPackage.Release1ProposalPlanBindingsV1 = {
    kind: publicPackage.Release1PlanKindV1.Upgrade, clusterDomain: b(1), controllerProgram: k(2), controllerConfig: k(3),
    controllerInstructionData: Buffer.from([31, 1, 2, 3]),
    controllerInstructionAccounts: [
      { pubkey: k(3), isSigner: false, isWritable: false },
      { pubkey: k(9), isSigner: false, isWritable: true },
      { pubkey: k(22), isSigner: true, isWritable: false },
    ],
    controllerLookupTable: null,
    targetProgram: k(4), targetProgramdata: k(5),
    authorityPda: k(6), programdataAuthority: k(6), protocolGate: k(7), gateStatus: publicPackage.release1Accounts.GateStatusV1.Active, gateEpoch: 8n,
    proposal: k(9), proposalDigest: b(10), proposalState: publicPackage.release1Accounts.ProposalStateV2.BufferVerified,
    reviewStartSlot: 20n, reviewEndSlot: 30n, notBeforeSlot: 40n, expirySlot: 50n,
    councilVersion: 11n, councilHash: b(12), council: k(18), targetNonce: 13n,
    programdataDeployedSlot: 21n, programdataCapacity: 1_000n,
    buffer: k(14), bufferAuthority: k(19), bufferVerificationStatus: publicPackage.release1Accounts.BufferVerificationStatusV1.Verified,
    bufferVerifiedChunkCount: 1, bufferChunkCount: 1,
    artifactSha256: b(15), artifactChunkMerkleRoot: b(16),
    programdataVerificationStatus: publicPackage.release1Accounts.ProgramDataVerificationStatusV1.Verifying,
    programdataVerifiedPayloadChunkCount: 0, programdataVerifiedZeroTailChunkCount: 0,
    checkpoint: k(20), checkpointDigest: b(17), checkpointPhase: publicPackage.release1Accounts.StateCheckpointPhaseV1.Prestate, checkpointAccepted: false,
  };
  const plan = publicPackage.planRelease1ProposalOperationV1(bindings);
  assert.equal(plan.armed, false);
  assert.equal(plan.operationId.length, 64);
  publicPackage.assertRelease1PlanFreshV1(plan, bindings);
  assert.throws(() => publicPackage.assertRelease1PlanFreshV1(plan, { ...bindings, gateEpoch: 9n }));
  for (const field of ["proposalDigest", "councilHash", "artifactSha256", "artifactChunkMerkleRoot", "checkpointDigest"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: b(99) }), plan.operationId);
  }
  for (const field of ["controllerProgram", "controllerConfig", "targetProgram", "targetProgramdata", "authorityPda", "programdataAuthority", "protocolGate", "proposal", "council", "buffer", "bufferAuthority", "checkpoint"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: k(99) }), plan.operationId);
  }
  for (const field of ["gateEpoch", "reviewStartSlot", "reviewEndSlot", "notBeforeSlot", "expirySlot", "councilVersion", "targetNonce", "programdataDeployedSlot", "programdataCapacity"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: 99n }), plan.operationId);
  }
  for (const field of ["bufferVerifiedChunkCount", "bufferChunkCount", "programdataVerifiedPayloadChunkCount", "programdataVerifiedZeroTailChunkCount"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: 99 }), plan.operationId);
  }
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, gateStatus: publicPackage.release1Accounts.GateStatusV1.FrozenForUpgrade }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, proposalState: publicPackage.release1Accounts.ProposalStateV2.Frozen }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, bufferVerificationStatus: publicPackage.release1Accounts.BufferVerificationStatusV1.Verifying }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, programdataVerificationStatus: publicPackage.release1Accounts.ProgramDataVerificationStatusV1.Verified }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, checkpointPhase: publicPackage.release1Accounts.StateCheckpointPhaseV1.Poststate }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, checkpointAccepted: true }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, controllerInstructionData: Buffer.from([31, 1, 2, 4]) }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, controllerInstructionAccounts: bindings.controllerInstructionAccounts.map((meta, index) => index === 1 ? { ...meta, pubkey: k(99) } : meta) }), plan.operationId);
  assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, controllerInstructionAccounts: bindings.controllerInstructionAccounts.map((meta, index) => index === 1 ? { ...meta, isWritable: false } : meta) }), plan.operationId);
  const drifted = [
    { ...bindings, gateStatus: publicPackage.release1Accounts.GateStatusV1.FrozenForUpgrade },
    { ...bindings, proposalState: publicPackage.release1Accounts.ProposalStateV2.Frozen },
    { ...bindings, programdataCapacity: 1_001n },
    { ...bindings, bufferVerifiedChunkCount: 0 },
    { ...bindings, programdataVerifiedPayloadChunkCount: 1 },
    { ...bindings, checkpointAccepted: true },
  ];
  for (const current of drifted) assert.throws(() => publicPackage.assertRelease1PlanFreshV1(plan, current), /stale or mutated/u);
});

test("journal redaction removes secret material without hiding public identities", () => {
  assert.deepEqual(publicPackage.redactGovernanceJournalValueV1({ controllerProgram: k(4), privateKey: "never", nested: { mnemonic: "never", operationId: "ok" } }), {
    controllerProgram: k(4).toBase58(), privateKey: "[REDACTED]", nested: { mnemonic: "[REDACTED]", operationId: "ok" },
  });
});
