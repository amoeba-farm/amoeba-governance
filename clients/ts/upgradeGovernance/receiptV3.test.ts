import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProposalStateV2,
  RELEASE1_ACCOUNT_VERSION_V1,
  STATE_CHECKPOINT_V1_DISCRIMINATOR,
  STATE_CHECKPOINT_V1_RESERVED_LEN,
  StateCheckpointPhaseV1,
  stateCheckpointDigestV1,
  stateCheckpointHardCombinedRootV1,
  type StateCheckpointV1,
} from "./release1.js";
import { artifactChunkCount, artifactChunkCountAllowEmpty, artifactMerkleRoot, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, VERIFICATION_BITMAP_BYTES_V1 } from "./artifactMerkleV1.js";
import { encodeExecuteUpgradeV1, type ExecuteUpgradeV1 } from "./release1LoaderInstructions.js";
import { COMPUTE_BUDGET_PROGRAM_ID_V1, SYSTEM_PROGRAM_ID_V1 } from "./operator.js";
import {
  CLOCK_SYSVAR_ID,
  GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA,
  INSTRUCTIONS_SYSVAR_ID,
  LOADER_V3_PROGRAM_ID,
  RENT_SYSVAR_ID,
  finalizeGovernedUpgradeReceiptV3,
  verifyGovernedUpgradeReceiptV3,
  type GovernedUpgradeReceiptV3,
  type GovernedUpgradeReceiptV3Material,
  type ReceiptAccountMetaV3,
  type ReceiptCheckpointV3,
  type ReceiptIdentitiesV3,
} from "./receiptV3.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

const rawBytes = (value: number): Buffer => Buffer.alloc(32, value);
const key = (value: number): PublicKey => new PublicKey(rawBytes(value));
const hash = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const h = (value: number): string => rawBytes(value).toString("hex");
const decimal = (value: bigint | number): string => BigInt(value).toString();

function bitmap(count: number): string {
  const result = Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1);
  for (let index = 0; index < count; index += 1) result[Math.floor(index / 8)]! |= 1 << (index % 8);
  return result.toString("hex");
}

const identities: ReceiptIdentitiesV3 = {
  clusterDomainHex: h(1),
  controllerProgram: key(2).toBase58(),
  controllerProgramdata: key(21).toBase58(),
  controllerConfig: key(3).toBase58(),
  policy: key(4).toBase58(),
  protocolGate: key(5).toBase58(),
  proposal: key(6).toBase58(),
  counterpartProposal: key(7).toBase58(),
  council: key(8).toBase58(),
  targetProgram: key(9).toBase58(),
  targetProgramdata: key(10).toBase58(),
  authorityPda: key(11).toBase58(),
  upgradeableLoader: LOADER_V3_PROGRAM_ID.toBase58(),
  canonicalSpillTreasury: key(12).toBase58(),
  payer: key(13).toBase58(),
  buffer: key(14).toBase58(),
  bufferVerification: key(15).toBase58(),
  counterpartBufferVerification: key(16).toBase58(),
  programdataVerification: key(17).toBase58(),
  prestateCheckpoint: key(18).toBase58(),
  poststateCheckpoint: key(19).toBase58(),
};

function meta(pubkey: string, isSigner: boolean, isWritable: boolean): ReceiptAccountMetaV3 {
  return { pubkey, isSigner, isWritable };
}

function checkpoint(
  phase: typeof StateCheckpointPhaseV1.Prestate | typeof StateCheckpointPhaseV1.Poststate,
  checkpointKey: string,
  targetSlot: bigint,
  targetPayload: string,
  targetRaw: string,
  targetCapacity: bigint,
  observationSlot: bigint,
  finalizedSlot: bigint,
  donation: { root: string; count: bigint; externalRawBalanceRoot: string } = { root: "0".repeat(64), count: 0n, externalRawBalanceRoot: h(25) },
): ReceiptCheckpointV3 {
  const value: StateCheckpointV1 = {
    discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 1,
    initialized: true,
    phase,
    controllerConfig: new PublicKey(identities.controllerConfig),
    proposal: new PublicKey(identities.proposal),
    emergencyResolution: PublicKey.default,
    subjectDigest: rawBytes(20),
    targetProgram: new PublicKey(identities.targetProgram),
    targetProgramdata: new PublicKey(identities.targetProgramdata),
    finalizedObservationSlot: observationSlot,
    gateEpoch: 3n,
    targetProgramdataSlot: targetSlot,
    targetPayloadCommitment: Buffer.from(targetPayload, "hex"),
    targetRawProgramdataCommitment: Buffer.from(targetRaw, "hex"),
    targetCapacity,
    programOwnedStateRoot: rawBytes(21),
    programOwnedStateCount: 10n,
    logicalCompressedStateRoot: rawBytes(22),
    logicalCompressedStateCount: 20n,
    semanticCustodyAccountingRoot: rawBytes(23),
    hardCombinedRoot: Buffer.alloc(32),
    externalMetadataObservationRoot: rawBytes(24),
    externalRawBalanceObservationRoot: Buffer.from(donation.externalRawBalanceRoot, "hex"),
    schemaIdentifier: rawBytes(26),
    admittedPositiveDonationRoot: Buffer.from(donation.root, "hex"),
    admittedPositiveDonationCount: donation.count,
    forbiddenDriftCount: 0,
    approvalCouncilVersion: 4n,
    approvalCouncilHash: rawBytes(27),
    checkpointDigest: Buffer.alloc(32),
    approvalBitset: 7,
    approvalCount: 3,
    accepted: true,
    finalizedSlot,
    reserved: Buffer.alloc(STATE_CHECKPOINT_V1_RESERVED_LEN),
  };
  value.hardCombinedRoot = stateCheckpointHardCombinedRootV1(value);
  value.checkpointDigest = stateCheckpointDigestV1(value);
  return {
    checkpoint: checkpointKey,
    phase: phase === StateCheckpointPhaseV1.Prestate ? "prestate" : "poststate",
    subjectDigest: value.subjectDigest.toString("hex"),
    finalizedObservationSlot: decimal(value.finalizedObservationSlot),
    gateEpoch: decimal(value.gateEpoch),
    targetProgramdataSlot: decimal(value.targetProgramdataSlot),
    targetPayloadCommitment: value.targetPayloadCommitment.toString("hex"),
    targetRawProgramdataCommitment: value.targetRawProgramdataCommitment.toString("hex"),
    targetCapacity: decimal(value.targetCapacity),
    programOwnedStateRoot: value.programOwnedStateRoot.toString("hex"),
    programOwnedStateCount: decimal(value.programOwnedStateCount),
    logicalCompressedStateRoot: value.logicalCompressedStateRoot.toString("hex"),
    logicalCompressedStateCount: decimal(value.logicalCompressedStateCount),
    semanticCustodyAccountingRoot: value.semanticCustodyAccountingRoot.toString("hex"),
    hardCombinedRoot: value.hardCombinedRoot.toString("hex"),
    externalMetadataObservationRoot: value.externalMetadataObservationRoot.toString("hex"),
    externalRawBalanceObservationRoot: value.externalRawBalanceObservationRoot.toString("hex"),
    schemaIdentifier: value.schemaIdentifier.toString("hex"),
    admittedPositiveDonationRoot: value.admittedPositiveDonationRoot.toString("hex"),
    admittedPositiveDonationCount: decimal(value.admittedPositiveDonationCount),
    forbiddenDriftCount: 0,
    approvalCouncilVersion: decimal(value.approvalCouncilVersion),
    approvalCouncilHash: value.approvalCouncilHash.toString("hex"),
    checkpointDigest: value.checkpointDigest.toString("hex"),
    approvalBitset: 7,
    approvalCount: 3,
    accepted: true,
    finalizedSlot: decimal(value.finalizedSlot),
  };
}

function validReceipt(): GovernedUpgradeReceiptV3 {
  const artifact = Buffer.alloc(20_000);
  for (let index = 0; index < artifact.length; index += 1) artifact[index] = index % 251;
  const artifactSha = hash(artifact);
  const merkleRoot = artifactMerkleRoot(artifact).toString("hex");
  const capacity = 40_000;
  const rawProgramdata = Buffer.alloc(45 + capacity);
  rawProgramdata.writeUInt32LE(3, 0);
  rawProgramdata.writeBigUInt64LE(100n, 4);
  rawProgramdata[12] = 1;
  new PublicKey(identities.authorityPda).toBuffer().copy(rawProgramdata, 13);
  artifact.copy(rawProgramdata, 45);
  const rawProgramdataSha = hash(rawProgramdata);
  const prestate = checkpoint(StateCheckpointPhaseV1.Prestate, identities.prestateCheckpoint, 80n, h(30), h(31), BigInt(capacity), 92n, 93n);
  const poststate = checkpoint(StateCheckpointPhaseV1.Poststate, identities.poststateCheckpoint, 100n, artifactSha, rawProgramdataSha, BigInt(capacity), 108n, 109n);

  const execute: ExecuteUpgradeV1 = {
    expected: {
      expectedProposalDigest: rawBytes(20),
      expectedPolicyVersion: 1n,
      expectedPolicyHash: rawBytes(32),
      expectedCouncilVersion: 2n,
      expectedCouncilHash: rawBytes(33),
      expectedGateStatus: GateStatusV1.FrozenForUpgrade,
      expectedGateEpoch: 3n,
      expectedTargetNonce: 6n,
      expectedState: ProposalStateV2.Frozen,
      expectedReviewStartSlot: 50n,
      expectedReviewEndSlot: 70n,
      expectedNotBeforeSlot: 90n,
      expectedExpirySlot: 200n,
    },
    expectedPrestateCheckpointDigest: Buffer.from(prestate.checkpointDigest, "hex"),
    expectedCurrentRawProgramdataHash: rawBytes(31),
    expectedSealedBufferHeaderHash: rawBytes(34),
    expectedCounterpartProposalDigest: rawBytes(35),
    expectedProgramdataSlot: 80n,
    expectedCapacity: BigInt(capacity),
    expectedVerifiedChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope: {
      computeUnitLimit: 1_200_000,
      computeUnitPriceMicroLamports: 17n,
      durableNonceAccount: { present: false, value: PublicKey.default },
      durableNonceAuthority: { present: false, value: PublicKey.default },
    },
  };
  const controllerData = encodeExecuteUpgradeV1(execute);
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(1_200_000, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(17n, 1);
  const controllerAccounts = [
    meta(identities.payer, true, true), meta(identities.controllerConfig, false, false), meta(identities.policy, false, false), meta(identities.protocolGate, false, false),
    meta(identities.proposal, false, true), meta(identities.counterpartProposal, false, false), meta(identities.counterpartBufferVerification, false, false),
    meta(identities.prestateCheckpoint, false, false), meta(identities.bufferVerification, false, true), meta(identities.programdataVerification, false, true),
    meta(identities.targetProgramdata, false, true), meta(identities.targetProgram, false, true), meta(identities.buffer, false, true), meta(identities.canonicalSpillTreasury, false, true),
    meta(RENT_SYSVAR_ID.toBase58(), false, false), meta(CLOCK_SYSVAR_ID.toBase58(), false, false), meta(identities.authorityPda, false, false),
    meta(identities.upgradeableLoader, false, false), meta(SYSTEM_PROGRAM_ID_V1.toBase58(), false, false), meta(INSTRUCTIONS_SYSVAR_ID.toBase58(), false, false),
  ];
  const material: GovernedUpgradeReceiptV3Material = {
    schema: GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA,
    version: 3,
    production: false,
    identities: { ...identities },
    topLevelEnvelope: [
      { kind: "compute-unit-limit", programId: COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), dataHex: limit.toString("hex"), accounts: [] },
      { kind: "compute-unit-price", programId: COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), dataHex: price.toString("hex"), accounts: [] },
      { kind: "controller-execute-upgrade", programId: identities.controllerProgram, dataHex: controllerData.toString("hex"), accounts: controllerAccounts },
    ],
    innerCpis: [{
      kind: "loader-upgrade",
      programId: LOADER_V3_PROGRAM_ID.toBase58(),
      dataHex: "03000000",
      accounts: [
        meta(identities.targetProgramdata, false, true), meta(identities.targetProgram, false, true), meta(identities.buffer, false, true),
        meta(identities.canonicalSpillTreasury, false, true), meta(RENT_SYSVAR_ID.toBase58(), false, false), meta(CLOCK_SYSVAR_ID.toBase58(), false, false),
        meta(identities.authorityPda, true, false),
      ],
    }],
    governance: {
      proposalDigest: h(20), counterpartProposalDigest: h(35), policyVersion: "1", policyHash: h(32), creationCouncilVersion: "2", creationCouncilHash: h(33),
      currentCouncilVersion: "4", currentCouncilHash: h(27), proposalApprovalBitset: 7, proposalApprovalCount: 3, poststateApprovalBitset: 7,
      poststateApprovalCount: 3, unfreezeApprovalBitset: 7, unfreezeApprovalCount: 3, proposalTargetNonce: "5", configTargetNonceAfterFreeze: "6",
      creationGateEpoch: "1", frozenGateEpoch: "3", completedGateEpoch: "4", reviewStartSlot: "50", reviewEndSlot: "70", notBeforeSlot: "90",
      expirySlot: "200", freezeSlot: "90", extensionSlot: "0", upgradeSlot: "100", programdataVerifiedSlot: "107", poststateAcceptedSlot: "110",
      unfreezeApprovedSlot: "115", unfreezeSlot: "120", preProgramdataSlot: "80", preProgramdataCapacity: decimal(capacity), preRawProgramdataHash: h(31),
      transitions: ["Draft", "BufferAdopted", "BufferVerified", "CouncilApproved", "GovernanceSatisfied", "Timelocked", "Frozen", "UpgradeExecuted", "ProgramDataVerified", "PoststateAccepted", "UnfreezeApproved", "Completed"],
    },
    buffer: {
      initialOwner: LOADER_V3_PROGRAM_ID.toBase58(), initialUploaderAuthority: key(40).toBase58(), finalAuthority: identities.authorityPda, sealedBufferHeaderHash: h(34),
      adoptedSlot: "70", verificationFinalizedSlot: "80", sealedThroughSlot: "100", artifactLength: decimal(artifact.length), artifactSha256: artifactSha,
      artifactChunkMerkleRoot: merkleRoot, chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1, chunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
      verifiedChunkBitmapHex: bitmap(artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)), verifiedChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
      status: "verified", result: "consumed-by-upgrade", artifactBytesBase64: artifact.toString("base64"),
    },
    programdata: {
      owner: LOADER_V3_PROGRAM_ID.toBase58(), deployedSlot: "100", capacity: decimal(capacity), authority: identities.authorityPda,
      artifactLength: decimal(artifact.length), payloadSha256: artifactSha, artifactChunkMerkleRoot: merkleRoot, rawProgramdataSha256: rawProgramdataSha,
      rawProgramdataBytesBase64: rawProgramdata.toString("base64"), verifiedPayloadChunkBitmapHex: bitmap(artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)),
      verifiedPayloadChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1), verifiedTailChunkBitmapHex: bitmap(artifactChunkCountAllowEmpty(capacity - artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)),
      verifiedTailChunkCount: artifactChunkCountAllowEmpty(capacity - artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1), zeroTailRequired: true, zeroTailVerified: true,
      verificationFinalizedSlot: "107",
    },
    state: { prestate, poststate, admittedPositiveDonations: [] },
    frozenHistory: [
      { slot: "90", topLevelProgramIds: [identities.controllerProgram], controllerInstructionTag: 6, computeBudgetInstructionCount: 0, systemInstructionCount: 0, admittedDurableNonceAdvanceCount: 0, loaderUpgradeInnerCpiCount: 0, targetTopLevelMutationCount: 0, externalLoaderTopLevelInstructionCount: 0, otherMutationCount: 0 },
      { slot: "100", topLevelProgramIds: [COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), identities.controllerProgram], controllerInstructionTag: 31, computeBudgetInstructionCount: 2, systemInstructionCount: 0, admittedDurableNonceAdvanceCount: 0, loaderUpgradeInnerCpiCount: 1, targetTopLevelMutationCount: 0, externalLoaderTopLevelInstructionCount: 0, otherMutationCount: 0 },
      { slot: "120", topLevelProgramIds: [identities.controllerProgram], controllerInstructionTag: 35, computeBudgetInstructionCount: 0, systemInstructionCount: 0, admittedDurableNonceAdvanceCount: 0, loaderUpgradeInnerCpiCount: 0, targetTopLevelMutationCount: 0, externalLoaderTopLevelInstructionCount: 0, otherMutationCount: 0 },
    ],
    controllerTrustRoot: {
      sourceCommitSha256: h(41), sourceTreeSha256: h(42), abiSha256: h(43), buildInputInventorySha256: h(44), controllerArtifactSha256: h(45),
      controllerRawProgramdataSha256: h(46), initializationStateSha256: h(47), initialized: true, tokenGovernanceEnabled: false,
      controllerImmutable: false, immutabilityPlanSha256: h(48), productionIdentityVerified: false,
    },
    handoff: {
      performed: false, simulated: true, authorityBefore: key(49).toBase58(), authorityAfter: identities.authorityPda, oldAuthority: key(49).toBase58(),
      oldAuthorityDirectUpgradeRejected: true, externalKeyDirectUpgradeObserved: false,
    },
  };
  return finalizeGovernedUpgradeReceiptV3(material);
}

function changed(receipt: GovernedUpgradeReceiptV3, mutate: (material: GovernedUpgradeReceiptV3Material) => void): GovernedUpgradeReceiptV3 {
  const copy = JSON.parse(JSON.stringify(receipt)) as GovernedUpgradeReceiptV3;
  const { receiptDigest: _digest, ...material } = copy;
  mutate(material);
  return finalizeGovernedUpgradeReceiptV3(material);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([field, entry]) => `${JSON.stringify(field)}:${canonicalJson(entry)}`).join(",")}}`;
}

test("receipt v3 independently verifies the full governed lifecycle", () => {
  const receipt = validReceipt();
  const result = verifyGovernedUpgradeReceiptV3(receipt);
  assert.equal(result.valid, true);
  assert.equal(result.receiptDigest, receipt.receiptDigest);
  assert.equal(result.artifactSha256, receipt.buffer.artifactSha256);
  assert.equal(result.rawProgramdataSha256, receipt.programdata.rawProgramdataSha256);
  assert.equal(result.admittedDonationCount, 0);
});

test("receipt v3 rejects digest, envelope, Loader CPI, governance, and bitmap failures", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3({ ...receipt, production: true }), /receiptDigest/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.topLevelEnvelope = [...value.topLevelEnvelope, value.topLevelEnvelope.at(-1)!]; })), /topLevelEnvelope/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.innerCpis[0]!.accounts[3]!.pubkey = key(90).toBase58(); })), /innerCpis/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.proposalApprovalBitset = 3; value.governance.proposalApprovalCount = 2; })), /3-of-5/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.configTargetNonceAfterFreeze = "8"; })), /consume exactly one/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.buffer.verifiedChunkBitmapHex = "00".repeat(64); })), /bitmap/u);
});

test("receipt v3 rejects altered sealed bytes and every ProgramData verification shortcut", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const bytes = Buffer.from(value.buffer.artifactBytesBase64, "base64"); bytes[0] ^= 1; value.buffer.artifactBytesBase64 = bytes.toString("base64"); })), /artifact SHA-256 or Merkle/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const raw = Buffer.from(value.programdata.rawProgramdataBytesBase64, "base64"); raw[45] ^= 1; value.programdata.rawProgramdataBytesBase64 = raw.toString("base64"); })), /deployed payload bytes/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const raw = Buffer.from(value.programdata.rawProgramdataBytesBase64, "base64"); raw[raw.length - 1] = 1; value.programdata.rawProgramdataBytesBase64 = raw.toString("base64"); })), /zero tail/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.programdata.rawProgramdataSha256 = h(99); })), /raw ProgramData SHA/u);
});

test("receipt v3 rejects hard-root drift, unacknowledged external drift, and donation disguises", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.state.poststate.programOwnedStateRoot = h(88); })), /hardCombinedRoot|hard protected/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.state.poststate.externalRawBalanceObservationRoot = h(89); })), /checkpointDigest|raw external balances/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.state.admittedPositiveDonations = [{ account: key(60).toBase58(), owner: key(61).toBase58(), mint: key(62).toBase58(), authority: key(63).toBase58(), assetKind: "token", positiveDeltaAtoms: "0", previouslyKnownAccount: true, identityUnchanged: true, semanticAccountingUnchanged: true }];
  })), /narrowly admitted positive donation/u);
});

test("receipt v3 admits only an explicitly attested positive donation to the same identity", () => {
  const receipt = validReceipt();
  const donation = {
    account: key(60).toBase58(), owner: key(61).toBase58(), mint: key(62).toBase58(), authority: key(63).toBase58(), assetKind: "token" as const,
    positiveDeltaAtoms: "25", previouslyKnownAccount: true as const, identityUnchanged: true as const, semanticAccountingUnchanged: true as const,
  };
  const root = createHash("sha256").update("AMOEBA_EXTERNAL_DONATION_V1", "ascii").update(canonicalJson([donation]), "utf8").digest("hex");
  const admitted = changed(receipt, (value) => {
    value.state.admittedPositiveDonations = [donation];
    value.state.poststate = checkpoint(
      StateCheckpointPhaseV1.Poststate,
      identities.poststateCheckpoint,
      100n,
      value.programdata.payloadSha256,
      value.programdata.rawProgramdataSha256,
      BigInt(value.programdata.capacity),
      108n,
      109n,
      { root, count: 1n, externalRawBalanceRoot: h(89) },
    );
  });
  assert.equal(verifyGovernedUpgradeReceiptV3(admitted).admittedDonationCount, 1);
});

test("receipt v3 rejects frozen-history, trust-root, and post-handoff direct-upgrade failures", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.frozenHistory[1]!.topLevelProgramIds = [...value.frozenHistory[1]!.topLevelProgramIds, value.identities.targetProgram]; })), /sibling arbitrary/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.frozenHistory[1]!.externalLoaderTopLevelInstructionCount = 1; })), /external-loader/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const previousController = value.identities.controllerProgram;
    const synthetic = SYNTHETIC_CONTROLLER_PROGRAM_V1.toBase58();
    value.production = true;
    value.identities.controllerProgram = synthetic;
    value.topLevelEnvelope[2]!.programId = synthetic;
    value.frozenHistory.forEach((event) => { event.topLevelProgramIds = event.topLevelProgramIds.map((program) => program === previousController ? synthetic : program); });
    value.controllerTrustRoot.controllerImmutable = true;
    value.controllerTrustRoot.productionIdentityVerified = true;
  })), /non-synthetic/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.handoff.externalKeyDirectUpgradeObserved = true; })), /external-key direct upgrade/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.handoff.oldAuthorityDirectUpgradeRejected = false; })), /external-key direct upgrade/u);
});
