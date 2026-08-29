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
  type EnvelopeExpectationV1,
  type OptionalInstructionPublicKeyV1,
} from "./release1LoaderInstructions.js";
import * as v3 from "./release1V3Instructions.js";
import * as v3Builders from "./release1V3Builders.js";
import * as custody from "./release1V3CustodyInstructions.js";
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

const proposalExpectation = (state: ProposalStateV2 = ProposalStateV2.Frozen): v3.ProposalGuardV3 => ({
  expectedProposalDigest: bytes("proposal-digest"),
  expectedState: state,
  expectedGateStatus: GateStatusV1.FrozenForUpgrade,
  expectedGateEpoch: 4n,
  expectedTargetNonce: 5n,
  expectedCapacityPolicyDigest: bytes("capacity-policy"),
  expectedCurrentDeploymentDigest: bytes("current-deployment"),
  expectedCurrentDeploymentGeneration: 6n,
});

const createProposal: v3.CreateProposalV3 = { manifest: {
  proposalClass: ProposalClassV1.RoutineUpgrade, expectedProposalId: 1n, expectedTargetNonce: 2n,
  expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 6n,
  expectedCapacityPolicyDigest: bytes("capacity-policy"), expectedCurrentDeploymentDigest: bytes("current-deployment"),
  expectedCurrentDeploymentGeneration: 1n, expectedPolicyVersion: 4n, expectedPolicyHash: bytes("create-policy"),
  expectedCouncilVersion: 5n, expectedCouncilHash: bytes("create-council"), artifactLength: 1_100_003n,
  artifactSha256: bytes("artifact-sha"), artifactChunkMerkleRoot: bytes("artifact-root"),
  sourceCommitHash: bytes("source-commit"), sourceTreeHash: bytes("source-tree"),
  buildInputInventoryHash: bytes("build-inventory"), reproducibleBuildReceiptHash: bytes("build-receipt"),
  packageReceiptHash: bytes("package-receipt"), releaseIntentHash: bytes("release-intent"),
  minimumRequiredCapacity: 1_300_000n, checkpointSchemaId: bytes("checkpoint-schema"),
  checkpointPolicyHash: bytes("checkpoint-policy"), primaryProposal: none(), rollbackProposal: some("rollback-proposal"),
  rollbackBuffer: some("rollback-buffer"), rollbackArtifactLength: 1_000_000n,
  rollbackArtifactSha256: bytes("rollback-sha"), rollbackArtifactChunkRoot: bytes("rollback-root"),
  planValidUntilSlot: 100n,
} };

function buildCreateProposalInstruction(): TransactionInstruction {
  return v3Builders.buildCreateProposalV3Instruction(
    controllerProgram,
    {
      payer,
      creatorSeatAuthority: key("creator-seat"),
      controllerConfig: key("config"),
      policy: key("policy"),
      council: key("council"),
      protocolGate: key("gate"),
      capacityPolicy: key("capacity-policy"),
      currentDeployment: key("current-deployment"),
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

function checkpointCandidate(): v3.CheckpointManifestV2 {
  return {
    phase: StateCheckpointPhaseV1.Poststate,
    checkpointGeneration: 1n,
    previousCheckpointDigest: Buffer.alloc(32),
    expectedSubjectDigest: bytes("checkpoint-subject"),
    expectedGateEpoch: 9n,
    expectedCapacityPolicyDigest: bytes("capacity-policy"), expectedCurrentDeploymentDigest: bytes("current-deployment"),
    expectedCurrentDeploymentGeneration: 1n, expectedObservationDigest: bytes("checkpoint-observation"),
    expectedObservationGeneration: 1n,
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
    expectedCouncilVersion: 3n,
    expectedCouncilHash: bytes("council-hash"),
    expectedCheckpointDigest: bytes("checkpoint-digest"),
    planValidUntilSlot: 100n,
  };
}

function buildCheckpointInstruction(): TransactionInstruction {
  return v3Builders.buildFinalizeCheckpointV2Instruction(
    controllerProgram,
    {
      payer,
      controllerConfig: key("config"),
      policy: key("policy"),
      currentCouncil: key("council"),
      protocolGate: key("gate"),
      subject: key("proposal"),
      linkedPrimaryOrAuthority: key("linked-primary"),
      capacityPolicy: key("capacity-policy"),
      currentDeployment: key("current-deployment"),
      programdataObservation: key("programdata-observation"),
      targetProgram: key("target-program"),
      targetProgramdata: key("target-programdata"),
      checkpoint: key("poststate-checkpoint"),
      checkpointAttestations: [
        key("checkpoint-attestation-0"),
        key("checkpoint-attestation-1"),
        key("checkpoint-attestation-2"),
      ],
      systemProgram: SystemProgram.programId,
    },
    { manifest: checkpointCandidate() },
  );
}

function buildMaxProofInstruction(): TransactionInstruction {
  const value: custody.VerifyBufferChunkV2 = {
    expected: proposalExpectation(ProposalStateV2.BufferAdopted),
    chunkIndex: 67,
    proof: {
      proofLen: custody.MAX_FIXED_MERKLE_PROOF_NODES_V1,
      nodes: Array.from(
        { length: custody.MAX_FIXED_MERKLE_PROOF_NODES_V1 },
        (_, index) => bytes(`proof-node-${index}`),
      ),
    },
    expectedVerificationStatus: BufferVerificationStatusV1.Verifying,
    expectedVerifiedChunkBitmap: Buffer.alloc(
      VERIFICATION_BITMAP_BYTES_V1,
      0x5a,
    ),
    expectedVerifiedChunkCount: 67,
  };
  return custody.buildVerifyBufferChunkV2Instruction(
    controllerProgram,
    {
      controllerConfig: key("config"),
      protocolGate: key("gate"),
      proposal: key("proposal"),
      buffer: key("buffer"),
      bufferVerification: key("buffer-verification"),
      authorityPda: key("authority"),
      upgradeableLoader: key("upgradeable-loader"),
    },
    value,
  );
}

function executeUpgradeValue(withNonce: boolean): custody.ExecuteUpgradeV2 {
  const envelope: EnvelopeExpectationV1 = {
    computeUnitLimit: 1_400_000,
    computeUnitPriceMicroLamports: 10_000_000n,
    durableNonceAccount: withNonce ? some("durable-nonce") : none(),
    durableNonceAuthority: withNonce ? some("durable-nonce-authority") : none(),
  };
  return {
    expected: proposalExpectation(),
    expectedPrestateCheckpointDigest: bytes("prestate-checkpoint-digest"),
    expectedPrestateCheckpointGeneration: 1n,
    expectedObservationDigest: bytes("programdata-observation"), expectedObservationGeneration: 1n,
    expectedObservationRoot: bytes("programdata-observation-root"), expectedObservationFinalizedSlot: 40n,
    expectedSealedBufferHeaderHash: bytes("sealed-buffer-header"),
    expectedCounterpartProposalDigest: bytes("counterpart-proposal"),
    expectedActualCapacity: 1_300_000n,
    expectedVerifiedChunkCount: 68,
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope,
  };
}

function buildExecuteUpgradeEnvelope(withNonce: boolean): readonly TransactionInstruction[] {
  const controller = custody.buildExecuteUpgradeV2Instruction(
    controllerProgram,
    {
      controllerConfig: key("config"),
      policy: key("policy"),
      protocolGate: key("gate"),
      proposal: key("proposal"),
      counterpartProposal: key("rollback-proposal"),
      counterpartBufferVerification: key("rollback-buffer-verification"),
      capacityPolicy: key("capacity-policy"),
      currentDeployment: key("current-deployment"),
      prestateProgramdataObservation: key("prestate-programdata-observation"),
      prestateCheckpoint: key("prestate-checkpoint"),
      currentProgramdataObservation: key("current-programdata-observation"),
      bufferVerification: key("buffer-verification"),
      targetProgramdata: key("target-programdata"),
      targetProgram: key("target-program"),
      buffer: key("candidate-buffer"),
      canonicalSpillTreasury: key("spill"),
      rentSysvar: key("rent-sysvar"),
      clockSysvar: key("clock-sysvar"),
      authorityPda: key("authority"),
      upgradeableLoader: key("upgradeable-loader"),
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
      legacy: 1_457,
      v0: 1_028,
      signatures: 2,
      staticKeys: 3,
      lookupWritable: 2,
      lookupReadonly: 13,
    },
    "max-merkle-proof": {
      legacy: 822,
      v0: 641,
      signatures: 1,
      staticKeys: 2,
      lookupWritable: 1,
      lookupReadonly: 6,
    },
    "poststate-checkpoint": {
      legacy: 1_257,
      v0: 797,
      signatures: 1,
      staticKeys: 2,
      lookupWritable: 2,
      lookupReadonly: 14,
    },
    "execute-upgrade": {
      legacy: 1_314,
      v0: 699,
      signatures: 1,
      staticKeys: 3,
      lookupWritable: 6,
      lookupReadonly: 15,
    },
    "execute-upgrade-nonce": {
      legacy: 1_516,
      v0: 839,
      signatures: 2,
      staticKeys: 5,
      lookupWritable: 7,
      lookupReadonly: 16,
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
