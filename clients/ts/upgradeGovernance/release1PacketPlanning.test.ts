import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { VERIFICATION_BITMAP_BYTES_V1 } from "./artifactMerkleV1.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProgramDataVerificationStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
} from "./release1.js";
import {
  CheckpointSubjectStateV1,
  buildCreateProposalV2Instruction,
  buildFinalizeCheckpointV1Instruction,
  type CheckpointCandidateV1,
  type CreateProposalV2,
} from "./release1LifecycleInstructions.js";
import {
  MAX_FIXED_MERKLE_PROOF_NODES_V1,
  ProgramDataChunkPhaseV1,
  buildExecuteUpgradeV1Instruction,
  buildVerifyProgramDataChunkV1Instruction,
  type EnvelopeExpectationV1,
  type ExecuteUpgradeV1,
  type OptionalInstructionPublicKeyV1,
  type ProposalExpectationV2,
  type VerifyProgramDataChunkV1,
} from "./release1LoaderInstructions.js";
import {
  RELEASE1_TRANSACTION_PACKET_LIMIT_V1,
  Release1PacketLimitError,
  assertRelease1AddressLookupPlanFreshV1,
  assertRelease1PacketSizeV1,
  buildCanonicalRelease1LoaderEnvelopeV1,
  createRelease1AddressLookupPlanV1,
  measureRelease1TransactionPacketV1,
  planRelease1TransactionPacketV1,
  type Release1AddressLookupPlanV1,
  type Release1PacketPlanningInputV1,
} from "./release1PacketPlanning.js";

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const CURRENT_SLOT = 10_001n;
const OBSERVED_SLOT = 10_000n;
const LAST_EXTENDED_SLOT = 9_999;
const VALID_THROUGH_SLOT = 10_128n;

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
const clusterDomain = hash("synthetic-local-cluster-domain");
const payer = key("payer");
const recentBlockhash = key("recent-blockhash").toBase58();

const none = (): OptionalInstructionPublicKeyV1 => ({
  present: false,
  value: PublicKey.default,
});
const some = (label: string): OptionalInstructionPublicKeyV1 => ({
  present: true,
  value: key(label),
});
const bytes = (label: string): Buffer => hash(`bytes:${label}`);

const proposalExpectation = (): ProposalExpectationV2 => ({
  expectedProposalDigest: bytes("proposal-digest"),
  expectedPolicyVersion: 2n,
  expectedPolicyHash: bytes("policy-hash"),
  expectedCouncilVersion: 3n,
  expectedCouncilHash: bytes("council-hash"),
  expectedGateStatus: GateStatusV1.FrozenForUpgrade,
  expectedGateEpoch: 4n,
  expectedTargetNonce: 5n,
  expectedState: ProposalStateV2.Frozen,
  expectedReviewStartSlot: 10n,
  expectedReviewEndSlot: 20n,
  expectedNotBeforeSlot: 30n,
  expectedExpirySlot: 100n,
});

const createProposal: CreateProposalV2 = {
  proposalClass: ProposalClassV1.RoutineUpgrade,
  creationGateStatus: GateStatusV1.Active,
  expectedProposalId: 1n,
  expectedTargetNonce: 2n,
  creationSlot: 3n,
  expectedPolicyVersion: 4n,
  expectedPolicyHash: bytes("create-policy"),
  expectedCreationCouncilVersion: 5n,
  expectedCreationCouncilHash: bytes("create-council"),
  expectedCreationGateEpoch: 6n,
  expectedFreezeGateEpoch: 7n,
  artifactLength: 1_100_003n,
  artifactSha256: bytes("artifact-sha"),
  artifactChunkMerkleRoot: bytes("artifact-root"),
  sourceCommitHash: bytes("source-commit"),
  sourceTreeHash: bytes("source-tree"),
  buildInputInventoryHash: bytes("build-inventory"),
  reproducibleBuildReceiptHash: bytes("build-receipt"),
  packageReceiptHash: bytes("package-receipt"),
  releaseIntentHash: bytes("release-intent"),
  expectedExecutionPrePayloadHash: bytes("pre-payload"),
  expectedExecutionPreChunkRoot: bytes("pre-root"),
  currentRawProgramdataHash: bytes("raw-programdata"),
  deployedSlot: 8n,
  currentCapacity: 1_200_000n,
  extensionDelta: 100_000n,
  expectedPostCapacity: 1_300_000n,
  checkpointSchemaId: bytes("checkpoint-schema"),
  checkpointPolicyHash: bytes("checkpoint-policy"),
  primaryProposal: none(),
  rollbackProposal: some("rollback-proposal"),
  rollbackBuffer: some("rollback-buffer"),
  rollbackArtifactSha256: bytes("rollback-sha"),
  rollbackArtifactChunkRoot: bytes("rollback-root"),
  reviewStartSlot: 10n,
  reviewEndSlot: 20n,
  notBeforeSlot: 30n,
  expirySlot: 100n,
  expectedProposalDigest: bytes("create-proposal-digest"),
};

function buildCreateProposalInstruction(): TransactionInstruction {
  return buildCreateProposalV2Instruction(
    controllerProgram,
    {
      payer,
      creatorSeatAuthority: key("creator-seat"),
      controllerConfig: key("config"),
      policy: key("policy"),
      council: key("council"),
      protocolGate: key("gate"),
      targetProgram: key("target-program"),
      targetProgramdata: key("target-programdata"),
      upgradeableLoader: key("upgradeable-loader"),
      authorityPda: key("authority"),
      canonicalSpillTreasury: key("spill"),
      buffer: key("candidate-buffer"),
      bufferUploaderAuthority: key("uploader"),
      proposal: key("proposal"),
      systemProgram: SystemProgram.programId,
    },
    createProposal,
  );
}

function checkpointCandidate(): CheckpointCandidateV1 {
  return {
    phase: StateCheckpointPhaseV1.Poststate,
    expectedSubjectState: CheckpointSubjectStateV1.ProposalProgramDataVerified,
    expectedSubjectDigest: bytes("checkpoint-subject"),
    expectedGateStatus: GateStatusV1.FrozenForUpgrade,
    expectedGateEpoch: 9n,
    finalizedObservationSlot: 10n,
    targetProgramdataSlot: 11n,
    targetPayloadCommitment: bytes("checkpoint-payload"),
    targetRawProgramdataCommitment: bytes("checkpoint-raw"),
    targetCapacity: 1_300_000n,
    programOwnedStateRoot: bytes("program-owned-root"),
    programOwnedStateCount: 12n,
    logicalCompressedStateRoot: bytes("compressed-root"),
    logicalCompressedStateCount: 13n,
    semanticCustodyAccountingRoot: bytes("semantic-root"),
    hardCombinedRoot: bytes("hard-root"),
    externalMetadataObservationRoot: bytes("metadata-root"),
    externalRawBalanceObservationRoot: bytes("balance-root"),
    schemaIdentifier: bytes("schema-id"),
    admittedPositiveDonationRoot: bytes("donation-root"),
    admittedPositiveDonationCount: 1n,
    forbiddenDriftCount: 0,
    expectedCheckpointDigest: bytes("checkpoint-digest"),
  };
}

function buildCheckpointInstruction(): TransactionInstruction {
  return buildFinalizeCheckpointV1Instruction(
    controllerProgram,
    {
      payer,
      controllerConfig: key("config"),
      policy: key("policy"),
      council: key("council"),
      protocolGate: key("gate"),
      subject: key("proposal"),
      targetProgram: key("target-program"),
      targetProgramdata: key("target-programdata"),
      phaseEvidence: key("programdata-verification"),
      baselineCheckpoint: key("prestate-checkpoint"),
      checkpoint: key("poststate-checkpoint"),
      checkpointAttestations: [
        key("checkpoint-attestation-0"),
        key("checkpoint-attestation-1"),
        key("checkpoint-attestation-2"),
      ],
      systemProgram: SystemProgram.programId,
    },
    {
      candidate: checkpointCandidate(),
      expectedCouncilVersion: 3n,
      expectedCouncilHash: bytes("council-hash"),
    },
  );
}

function buildMaxProofInstruction(): TransactionInstruction {
  const value: VerifyProgramDataChunkV1 = {
    expected: proposalExpectation(),
    phase: ProgramDataChunkPhaseV1.Payload,
    chunkIndex: 67,
    proof: {
      proofLen: MAX_FIXED_MERKLE_PROOF_NODES_V1,
      nodes: Array.from(
        { length: MAX_FIXED_MERKLE_PROOF_NODES_V1 },
        (_, index) => bytes(`proof-node-${index}`),
      ),
    },
    expectedVerificationStatus: ProgramDataVerificationStatusV1.Verifying,
    expectedVerifiedPayloadChunkBitmap: Buffer.alloc(
      VERIFICATION_BITMAP_BYTES_V1,
      0x5a,
    ),
    expectedVerifiedPayloadChunkCount: 67,
    expectedVerifiedTailChunkBitmap: Buffer.alloc(
      VERIFICATION_BITMAP_BYTES_V1,
      0xa5,
    ),
    expectedVerifiedTailChunkCount: 2,
  };
  return buildVerifyProgramDataChunkV1Instruction(
    controllerProgram,
    {
      controllerConfig: key("config"),
      protocolGate: key("gate"),
      proposal: key("proposal"),
      targetProgram: key("target-program"),
      targetProgramdata: key("target-programdata"),
      authorityPda: key("authority"),
      upgradeableLoader: key("upgradeable-loader"),
      programdataVerification: key("programdata-verification"),
    },
    value,
  );
}

function executeUpgradeValue(withNonce: boolean): ExecuteUpgradeV1 {
  const envelope: EnvelopeExpectationV1 = {
    computeUnitLimit: 1_400_000,
    computeUnitPriceMicroLamports: 10_000_000n,
    durableNonceAccount: withNonce ? some("durable-nonce") : none(),
    durableNonceAuthority: withNonce ? some("durable-nonce-authority") : none(),
  };
  return {
    expected: proposalExpectation(),
    expectedPrestateCheckpointDigest: bytes("prestate-checkpoint-digest"),
    expectedCurrentRawProgramdataHash: bytes("current-programdata-hash"),
    expectedSealedBufferHeaderHash: bytes("sealed-buffer-header"),
    expectedCounterpartProposalDigest: bytes("counterpart-proposal"),
    expectedProgramdataSlot: 40n,
    expectedCapacity: 1_300_000n,
    expectedVerifiedChunkCount: 68,
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope,
  };
}

function buildExecuteUpgradeEnvelope(withNonce: boolean): readonly TransactionInstruction[] {
  const controller = buildExecuteUpgradeV1Instruction(
    controllerProgram,
    {
      payer,
      controllerConfig: key("config"),
      policy: key("policy"),
      protocolGate: key("gate"),
      proposal: key("proposal"),
      counterpartProposal: key("rollback-proposal"),
      counterpartBufferVerification: key("rollback-buffer-verification"),
      prestateCheckpoint: key("prestate-checkpoint"),
      bufferVerification: key("buffer-verification"),
      programdataVerification: key("programdata-verification"),
      targetProgramdata: key("target-programdata"),
      targetProgram: key("target-program"),
      buffer: key("candidate-buffer"),
      canonicalSpillTreasury: key("spill"),
      rentSysvar: key("rent-sysvar"),
      clockSysvar: key("clock-sysvar"),
      authorityPda: key("authority"),
      upgradeableLoader: key("upgradeable-loader"),
      systemProgram: SystemProgram.programId,
      instructionsSysvar: key("instructions-sysvar"),
    },
    executeUpgradeValue(withNonce),
  );
  return buildCanonicalRelease1LoaderEnvelopeV1(controller);
}

function lookupCandidates(
  instructions: readonly TransactionInstruction[],
  feePayer: PublicKey,
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

function lookupTable(
  label: string,
  addresses: readonly PublicKey[],
): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: key(`lookup-table:${label}`),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: LAST_EXTENDED_SLOT,
      lastExtendedSlotStartIndex: 0,
      addresses: [...addresses],
    },
  });
}

function v0Input(
  label: string,
  instructions: readonly TransactionInstruction[],
  tableAddresses = lookupCandidates(instructions, payer),
  requiredAddresses = tableAddresses,
): Release1PacketPlanningInputV1 {
  const operation = operationId(label);
  const table = lookupTable(label, tableAddresses);
  const plan = createRelease1AddressLookupPlanV1({
    operationId: operation,
    controllerProgram,
    clusterDomain,
    lookupTableAccount: table,
    requiredLookupAddresses: requiredAddresses,
    observedSlot: OBSERVED_SLOT,
    validThroughSlot: VALID_THROUGH_SLOT,
  });
  return {
    operationId: operation,
    controllerProgram,
    clusterDomain,
    payer,
    recentBlockhash,
    instructions,
    format: "v0",
    lookup: { plan, lookupTableAccount: table, currentSlot: CURRENT_SLOT },
  };
}

function legacyInput(
  label: string,
  instructions: readonly TransactionInstruction[],
): Release1PacketPlanningInputV1 {
  return {
    operationId: operationId(label),
    controllerProgram,
    clusterDomain,
    payer,
    recentBlockhash,
    instructions,
    format: "legacy",
  };
}

function actualV0WireBytes(input: Release1PacketPlanningInputV1): number {
  assert.equal(input.format, "v0");
  assert.ok(input.lookup);
  const message = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: input.recentBlockhash,
    instructions: [...input.instructions],
  }).compileToV0Message([input.lookup.lookupTableAccount]);
  return new VersionedTransaction(message).serialize().length;
}

function actualLegacyWireBytes(input: Release1PacketPlanningInputV1): number {
  assert.equal(input.format, "legacy");
  const message = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: input.recentBlockhash,
    instructions: [...input.instructions],
  }).compileToLegacyMessage();
  return new VersionedTransaction(message).serialize().length;
}

test("official Release 1 builders have deterministic legacy and v0 packet measurements", () => {
  const cases = [
    { label: "create-proposal", instructions: [buildCreateProposalInstruction()] },
    { label: "max-merkle-proof", instructions: [buildMaxProofInstruction()] },
    { label: "poststate-checkpoint", instructions: [buildCheckpointInstruction()] },
    { label: "execute-upgrade", instructions: buildExecuteUpgradeEnvelope(false) },
    { label: "execute-upgrade-nonce", instructions: buildExecuteUpgradeEnvelope(true) },
  ] as const;

  const measured = Object.fromEntries(
    cases.map(({ label, instructions }) => {
      const legacy = measureRelease1TransactionPacketV1(
        legacyInput(`${label}:legacy`, instructions),
      );
      const v0 = measureRelease1TransactionPacketV1(
        v0Input(`${label}:v0`, instructions),
      );
      assert.equal(v0.packetBytes, actualV0WireBytes(v0Input(`${label}:v0`, instructions)));
      if (legacy.fitsPacketLimit) {
        assert.equal(
          legacy.packetBytes,
          actualLegacyWireBytes(legacyInput(`${label}:legacy`, instructions)),
        );
      }
      assert.equal(v0.fitsPacketLimit, true);
      assert.ok(v0.lookupWritableCount + v0.lookupReadonlyCount > 0);
      return [
        label,
        {
          legacy: legacy.packetBytes,
          v0: v0.packetBytes,
          signatures: v0.requiredSignatureCount,
          staticKeys: v0.staticAccountKeyCount,
          lookupWritable: v0.lookupWritableCount,
          lookupReadonly: v0.lookupReadonlyCount,
        },
      ];
    }),
  );

  assert.deepEqual(measured, {
    "create-proposal": {
      legacy: 1_503,
      v0: 1_136,
      signatures: 2,
      staticKeys: 3,
      lookupWritable: 2,
      lookupReadonly: 11,
    },
    "max-merkle-proof": {
      legacy: 964,
      v0: 752,
      signatures: 1,
      staticKeys: 2,
      lookupWritable: 1,
      lookupReadonly: 7,
    },
    "poststate-checkpoint": {
      legacy: 1_121,
      v0: 723,
      signatures: 1,
      staticKeys: 2,
      lookupWritable: 2,
      lookupReadonly: 12,
    },
    "execute-upgrade": {
      legacy: 1_241,
      v0: 688,
      signatures: 1,
      staticKeys: 3,
      lookupWritable: 7,
      lookupReadonly: 12,
    },
    "execute-upgrade-nonce": {
      legacy: 1_411,
      v0: 827,
      signatures: 2,
      staticKeys: 5,
      lookupWritable: 8,
      lookupReadonly: 12,
    },
  });
});

test("packet plans accept 1,232 bytes exactly and reject every larger packet", () => {
  assert.doesNotThrow(() => assertRelease1PacketSizeV1(0));
  assert.doesNotThrow(() =>
    assertRelease1PacketSizeV1(RELEASE1_TRANSACTION_PACKET_LIMIT_V1),
  );
  assert.throws(
    () => assertRelease1PacketSizeV1(RELEASE1_TRANSACTION_PACKET_LIMIT_V1 + 1),
    (error: unknown) =>
      error instanceof Release1PacketLimitError
      && error.packetBytes === 1_233
      && error.packetLimit === 1_232,
  );
  assert.throws(() => assertRelease1PacketSizeV1(-1));

  const createInstructions = [buildCreateProposalInstruction()];
  const legacy = legacyInput("create-oversize-legacy", createInstructions);
  const legacyMeasurement = measureRelease1TransactionPacketV1(legacy);
  assert.equal(legacyMeasurement.fitsPacketLimit, false);
  assert.throws(
    () => planRelease1TransactionPacketV1(legacy),
    (error: unknown) =>
      error instanceof Release1PacketLimitError
      && error.packetBytes === legacyMeasurement.packetBytes,
  );

  const candidates = lookupCandidates(createInstructions, payer);
  const sparse = v0Input(
    "create-oversize-sparse-v0",
    createInstructions,
    [candidates[0]!],
    [candidates[0]!],
  );
  const sparseMeasurement = measureRelease1TransactionPacketV1(sparse);
  assert.equal(sparseMeasurement.fitsPacketLimit, false);
  assert.throws(
    () => planRelease1TransactionPacketV1(sparse),
    Release1PacketLimitError,
  );

  const compressed = v0Input("create-fitting-v0", createInstructions);
  const plan = planRelease1TransactionPacketV1(compressed);
  assert.equal(plan.fitsPacketLimit, true);
  assert.ok(plan.packetBytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1);
  assert.match(plan.packetPlanId, /^[0-9a-f]{64}$/);
  assert.match(plan.messageSha256, /^[0-9a-f]{64}$/);
});

test("v0 lookup planning fails closed for missing, stale, or mismatched snapshots", () => {
  const instructions = [buildCheckpointInstruction()];
  const input = v0Input("lookup-freshness", instructions);
  assert.ok(input.lookup);
  assert.doesNotThrow(() => planRelease1TransactionPacketV1(input));

  assert.throws(() =>
    planRelease1TransactionPacketV1({ ...input, lookup: undefined }),
  );
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      lookup: { ...input.lookup!, currentSlot: VALID_THROUGH_SLOT + 1n },
    }),
  );
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      operationId: operationId("wrong-operation"),
    }),
  );
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      clusterDomain: bytes("wrong-cluster"),
    }),
  );
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      controllerProgram: key("wrong-controller"),
    }),
  );

  const corruptedPlan: Release1AddressLookupPlanV1 = {
    ...input.lookup!.plan,
    lookupPlanId: "00".repeat(32),
  };
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      lookup: { ...input.lookup!, plan: corruptedPlan },
    }),
  );

  const changedTable = new AddressLookupTableAccount({
    key: input.lookup!.lookupTableAccount.key,
    state: {
      ...input.lookup!.lookupTableAccount.state,
      addresses: [
        ...input.lookup!.lookupTableAccount.state.addresses.slice(0, -1),
        key("unexpected-replacement"),
      ],
    },
  });
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      lookup: { ...input.lookup!, lookupTableAccount: changedTable },
    }),
  );

  const extraRequired = key("unused-required-address");
  const expandedTable = lookupTable("unused-required", [
    ...lookupCandidates(instructions, payer),
    extraRequired,
  ]);
  const expandedPlan = createRelease1AddressLookupPlanV1({
    operationId: input.operationId,
    controllerProgram,
    clusterDomain,
    lookupTableAccount: expandedTable,
    requiredLookupAddresses: expandedTable.state.addresses,
    observedSlot: OBSERVED_SLOT,
    validThroughSlot: VALID_THROUGH_SLOT,
  });
  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...input,
      lookup: {
        plan: expandedPlan,
        lookupTableAccount: expandedTable,
        currentSlot: CURRENT_SLOT,
      },
    }),
  );

  assert.throws(() =>
    planRelease1TransactionPacketV1({
      ...legacyInput("legacy-cannot-ignore-alt", instructions),
      lookup: input.lookup,
    }),
  );
});

test("lookup plans require active warm unique tables and canonical index order", () => {
  const instructions = [buildMaxProofInstruction()];
  const addresses = lookupCandidates(instructions, payer);
  const operation = operationId("lookup-contract");
  const active = lookupTable("lookup-contract", addresses);
  const plan = createRelease1AddressLookupPlanV1({
    operationId: operation,
    controllerProgram,
    clusterDomain,
    lookupTableAccount: active,
    requiredLookupAddresses: addresses,
    observedSlot: OBSERVED_SLOT,
    validThroughSlot: VALID_THROUGH_SLOT,
  });
  assert.doesNotThrow(() =>
    assertRelease1AddressLookupPlanFreshV1(plan, {
      operationId: operation,
      controllerProgram,
      clusterDomain,
      lookupTableAccount: active,
      currentSlot: CURRENT_SLOT,
    }),
  );
  assert.throws(() =>
    createRelease1AddressLookupPlanV1({
      operationId: operation,
      controllerProgram,
      clusterDomain,
      lookupTableAccount: active,
      requiredLookupAddresses: [...addresses].reverse(),
      observedSlot: OBSERVED_SLOT,
      validThroughSlot: VALID_THROUGH_SLOT,
    }),
  );
  assert.throws(() =>
    createRelease1AddressLookupPlanV1({
      operationId: operation,
      controllerProgram,
      clusterDomain,
      lookupTableAccount: active,
      requiredLookupAddresses: [addresses[0]!, addresses[0]!],
      observedSlot: OBSERVED_SLOT,
      validThroughSlot: VALID_THROUGH_SLOT,
    }),
  );
  const deactivated = new AddressLookupTableAccount({
    key: active.key,
    state: { ...active.state, deactivationSlot: CURRENT_SLOT },
  });
  assert.throws(() =>
    createRelease1AddressLookupPlanV1({
      operationId: operation,
      controllerProgram,
      clusterDomain,
      lookupTableAccount: deactivated,
      requiredLookupAddresses: addresses,
      observedSlot: OBSERVED_SLOT,
      validThroughSlot: VALID_THROUGH_SLOT,
    }),
  );
  assert.throws(() =>
    createRelease1AddressLookupPlanV1({
      operationId: operation,
      controllerProgram,
      clusterDomain,
      lookupTableAccount: active,
      requiredLookupAddresses: addresses,
      observedSlot: BigInt(LAST_EXTENDED_SLOT),
      validThroughSlot: VALID_THROUGH_SLOT,
    }),
  );
});

test("execute-upgrade planning admits only the exact compute and optional nonce envelope", () => {
  const withoutNonce = buildExecuteUpgradeEnvelope(false);
  assert.equal(withoutNonce.length, 3);
  assert.ok(withoutNonce[0]!.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(withoutNonce[0]!.data[0], 2);
  assert.equal(withoutNonce[0]!.data.readUInt32LE(1), 1_400_000);
  assert.equal(withoutNonce[1]!.data[0], 3);
  assert.equal(withoutNonce[1]!.data.readBigUInt64LE(1), 10_000_000n);
  assert.ok(withoutNonce[2]!.programId.equals(controllerProgram));
  assert.doesNotThrow(() =>
    planRelease1TransactionPacketV1(
      v0Input("exact-upgrade-envelope", withoutNonce),
    ),
  );

  const withNonce = buildExecuteUpgradeEnvelope(true);
  assert.equal(withNonce.length, 4);
  assert.ok(withNonce[0]!.programId.equals(SystemProgram.programId));
  assert.equal(withNonce[0]!.keys.length, 3);
  assert.ok(withNonce[0]!.keys[0]!.pubkey.equals(key("durable-nonce")));
  assert.equal(withNonce[0]!.keys[0]!.isWritable, true);
  assert.ok(withNonce[0]!.keys[2]!.pubkey.equals(key("durable-nonce-authority")));
  assert.equal(withNonce[0]!.keys[2]!.isSigner, true);
  assert.doesNotThrow(() =>
    planRelease1TransactionPacketV1(
      v0Input("exact-upgrade-nonce-envelope", withNonce),
    ),
  );

  const alteredCompute = [...withoutNonce];
  alteredCompute[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_399_999 });
  assert.throws(() =>
    planRelease1TransactionPacketV1(
      v0Input("altered-compute-envelope", alteredCompute),
    ),
  );

  const alteredNonce = [...withNonce];
  alteredNonce[0] = SystemProgram.nonceAdvance({
    noncePubkey: key("wrong-nonce"),
    authorizedPubkey: key("durable-nonce-authority"),
  });
  assert.throws(() =>
    planRelease1TransactionPacketV1(
      v0Input("altered-nonce-envelope", alteredNonce),
    ),
  );

  const create = buildCreateProposalInstruction();
  assert.throws(() =>
    planRelease1TransactionPacketV1(
      v0Input("non-envelope-sibling", [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        create,
      ]),
    ),
  );
  assert.throws(() =>
    planRelease1TransactionPacketV1(
      v0Input("instruction-after-controller", [
        withoutNonce[0]!,
        withoutNonce[1]!,
        withoutNonce[2]!,
        new TransactionInstruction({
          programId: key("arbitrary-program"),
          keys: [],
          data: Buffer.alloc(0),
        }),
      ]),
    ),
  );
});
