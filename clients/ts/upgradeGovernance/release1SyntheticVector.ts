import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  ARTIFACT_MERKLE_SCHEME_ID,
  ARTIFACT_MERKLE_SCHEME_MATERIAL_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  artifactChunkCount,
  artifactChunkCountAllowEmpty,
  artifactChunkEmptyHash,
  artifactChunkLeafHash,
  artifactChunkNodeHash,
  artifactMerkleProof,
  artifactMerkleRoot,
  completeVerificationBitmapV1,
} from "./artifactMerkleV1.js";
import {
  ACCOUNT_VERSION_V2,
  BUFFER_VERIFICATION_V1_DISCRIMINATOR,
  BUFFER_VERIFICATION_V1_RESERVED_LEN,
  BufferVerificationStatusV1,
  COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
  COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN,
  CouncilRotationStateV1,
  EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
  EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN,
  EmergencyFreezeResolutionKindV1,
  EmergencyFreezeResolutionStateV1,
  GateStatusV1,
  PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
  PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN,
  PROPOSAL_DIGEST_DOMAIN_V2,
  ProposalClassV1,
  ProposalStateV2,
  RELEASE1_ACCOUNT_VERSION_V1,
  STATE_CHECKPOINT_V1_DISCRIMINATOR,
  STATE_CHECKPOINT_V1_RESERVED_LEN,
  StateCheckpointPhaseV1,
  UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
  UPGRADE_PROPOSAL_V2_RESERVED_LEN,
  VoteRequirementV1,
  canonicalCouncilRotationDigestMaterialV1,
  canonicalEmergencyResolutionDigestMaterialV1,
  canonicalProposalDigestMaterialV2,
  canonicalStateCheckpointDigestMaterialV1,
  councilRotationDigestV1,
  deriveBufferVerificationPdaV1,
  deriveCouncilRotationPda,
  deriveEmergencyCheckpointPda,
  deriveEmergencyResolutionPda,
  deriveProgramdataCheckPda,
  deriveRelease1CheckpointPda,
  emergencyResolutionDigestV1,
  proposalDigestV2,
  serializeBufferVerificationV1,
  serializeCouncilRotationProposalV1,
  serializeEmergencyFreezeResolutionV1,
  serializeProgramDataVerificationV1,
  serializeStateCheckpointV1,
  serializeUpgradeProposalV2,
  stateCheckpointDigestV1,
  type BufferVerificationV1,
  type CouncilRotationProposalV1,
  type EmergencyFreezeResolutionV1,
  type ProgramDataVerificationV1,
  type StateCheckpointV1,
  type UpgradeProposalV2,
} from "./release1.js";

export const syntheticRelease1Key = (value: number): PublicKey =>
  new PublicKey(Buffer.alloc(32, value));

export const syntheticRelease1Bytes = (value: number): Buffer => Buffer.alloc(32, value);

export function syntheticArtifact(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => index % 251));
}

function sha256(value: Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function syntheticUpgradeProposalV2(): UpgradeProposalV2 {
  const artifact = syntheticArtifact(5_000);
  const chunkSize = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
  const defaultKey = syntheticRelease1Key(0);
  const value: UpgradeProposalV2 = {
    discriminator: Buffer.from(UPGRADE_PROPOSAL_V2_DISCRIMINATOR),
    accountVersion: ACCOUNT_VERSION_V2,
    bump: 201,
    initialized: true,
    proposalClass: ProposalClassV1.RoutineUpgrade,
    state: ProposalStateV2.Draft,
    creationGateStatus: GateStatusV1.Active,
    zeroTailRequired: true,
    proposalFlags: 0,
    proposalId: 7n,
    targetNonce: 11n,
    creationSlot: 10n,
    clusterDomain: syntheticRelease1Bytes(1),
    controllerProgram: syntheticRelease1Key(2),
    controllerConfig: syntheticRelease1Key(3),
    protocolGate: syntheticRelease1Key(4),
    policyVersion: 1n,
    policyHash: syntheticRelease1Bytes(5),
    creationCouncilVersion: 1n,
    creationCouncilHash: syntheticRelease1Bytes(6),
    creationGateEpoch: 9n,
    freezeGateEpoch: 10n,
    targetProgram: syntheticRelease1Key(7),
    targetProgramdata: syntheticRelease1Key(8),
    upgradeableLoader: syntheticRelease1Key(9),
    authorityPda: syntheticRelease1Key(10),
    canonicalSpillTreasury: syntheticRelease1Key(11),
    bufferPubkey: syntheticRelease1Key(12),
    bufferLoaderOwner: syntheticRelease1Key(9),
    bufferUploaderAuthority: syntheticRelease1Key(13),
    bufferFinalAuthority: syntheticRelease1Key(10),
    bufferVerification: syntheticRelease1Key(14),
    programdataVerification: syntheticRelease1Key(15),
    artifactLength: BigInt(artifact.length),
    artifactSha256: sha256(artifact),
    artifactChunkMerkleRoot: artifactMerkleRoot(artifact),
    chunkHashDomain: Buffer.from(ARTIFACT_MERKLE_SCHEME_ID),
    chunkSize,
    chunkCount: artifactChunkCount(artifact.length, chunkSize),
    sourceCommitHash: syntheticRelease1Bytes(16),
    sourceTreeHash: syntheticRelease1Bytes(17),
    buildInputInventoryHash: syntheticRelease1Bytes(18),
    reproducibleBuildReceiptHash: syntheticRelease1Bytes(19),
    packageReceiptHash: syntheticRelease1Bytes(20),
    releaseIntentHash: syntheticRelease1Bytes(21),
    expectedExecutionPrePayloadHash: syntheticRelease1Bytes(22),
    expectedExecutionPreChunkRoot: syntheticRelease1Bytes(23),
    currentRawProgramdataHash: syntheticRelease1Bytes(24),
    deployedSlot: 2n,
    currentCapacity: 4_096n,
    extensionDelta: 4_096n,
    expectedPostCapacity: 8_192n,
    prestateCheckpoint: syntheticRelease1Key(25),
    requiredPoststateCheckpoint: syntheticRelease1Key(26),
    checkpointSchemaId: syntheticRelease1Bytes(27),
    checkpointPolicyHash: syntheticRelease1Bytes(28),
    primaryProposal: { present: false, value: defaultKey },
    rollbackProposal: { present: true, value: syntheticRelease1Key(29) },
    rollbackBuffer: { present: true, value: syntheticRelease1Key(30) },
    rollbackArtifactSha256: syntheticRelease1Bytes(31),
    rollbackArtifactChunkRoot: syntheticRelease1Bytes(32),
    voteRequirement: VoteRequirementV1.None,
    voteProgram: defaultKey,
    voteResultPda: defaultKey,
    reviewStartSlot: 20n,
    reviewEndSlot: 30n,
    notBeforeSlot: 40n,
    expirySlot: 50n,
    firstApprovalSlot: 0n,
    councilApprovedSlot: 0n,
    governanceSatisfiedSlot: 0n,
    queuedSlot: 0n,
    frozenSlot: 0n,
    extensionExecutedSlot: 0n,
    upgradeExecutedSlot: 0n,
    programdataVerifiedSlot: 0n,
    poststateAcceptedSlot: 0n,
    unfreezeApprovedSlot: 0n,
    terminalSlot: 0n,
    councilApprovalBitset: 0,
    councilApprovalCount: 0,
    cancellationCouncilVersion: 0n,
    cancellationCouncilHash: Buffer.alloc(32),
    cancellationApprovalBitset: 0,
    cancellationApprovalCount: 0,
    unfreezeCouncilVersion: 0n,
    unfreezeCouncilHash: Buffer.alloc(32),
    unfreezeApprovalBitset: 0,
    unfreezeApprovalCount: 0,
    proposalDigest: Buffer.alloc(32),
    cancellationReasonCode: 0,
    terminalReasonCode: 0,
    reserved: Buffer.alloc(UPGRADE_PROPOSAL_V2_RESERVED_LEN),
  };
  value.proposalDigest = proposalDigestV2(value);
  return value;
}

export function syntheticBufferVerificationV1(): BufferVerificationV1 {
  const proposal = syntheticUpgradeProposalV2();
  return {
    discriminator: Buffer.from(BUFFER_VERIFICATION_V1_DISCRIMINATOR),
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 202,
    initialized: true,
    status: BufferVerificationStatusV1.Verified,
    controllerConfig: proposal.controllerConfig,
    proposal: syntheticRelease1Key(33),
    upgradeableLoader: proposal.upgradeableLoader,
    buffer: proposal.bufferPubkey,
    expectedUploaderAuthority: proposal.bufferUploaderAuthority,
    controllerAuthority: proposal.authorityPda,
    artifactLength: proposal.artifactLength,
    artifactSha256: proposal.artifactSha256,
    artifactChunkMerkleRoot: proposal.artifactChunkMerkleRoot,
    chunkHashDomain: proposal.chunkHashDomain,
    chunkSize: proposal.chunkSize,
    chunkCount: proposal.chunkCount,
    verifiedChunkBitmap: completeVerificationBitmapV1(proposal.chunkCount),
    verifiedChunkCount: proposal.chunkCount,
    adoptedSlot: 21n,
    finalizedSlot: 22n,
    sealedBufferHeaderHash: syntheticRelease1Bytes(34),
    terminalSlot: 0n,
    reserved: Buffer.alloc(BUFFER_VERIFICATION_V1_RESERVED_LEN),
  };
}

export function syntheticProgramDataVerificationV1(): ProgramDataVerificationV1 {
  const proposal = syntheticUpgradeProposalV2();
  const tailLength = proposal.expectedPostCapacity - proposal.artifactLength;
  const tailChunkCount = artifactChunkCountAllowEmpty(tailLength, proposal.chunkSize);
  return {
    discriminator: Buffer.from(PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR),
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 203,
    initialized: true,
    status: 1,
    controllerConfig: proposal.controllerConfig,
    proposal: syntheticRelease1Key(33),
    targetProgram: proposal.targetProgram,
    targetProgramdata: proposal.targetProgramdata,
    upgradeableLoader: proposal.upgradeableLoader,
    controllerAuthority: proposal.authorityPda,
    artifactLength: proposal.artifactLength,
    artifactSha256: proposal.artifactSha256,
    artifactChunkMerkleRoot: proposal.artifactChunkMerkleRoot,
    chunkHashDomain: proposal.chunkHashDomain,
    chunkSize: proposal.chunkSize,
    payloadChunkCount: proposal.chunkCount,
    verifiedPayloadChunkBitmap: completeVerificationBitmapV1(proposal.chunkCount),
    verifiedPayloadChunkCount: proposal.chunkCount,
    deployedSlot: 88n,
    capacity: proposal.expectedPostCapacity,
    tailLength,
    tailChunkCount,
    verifiedTailChunkBitmap: completeVerificationBitmapV1(tailChunkCount),
    verifiedTailChunkCount: tailChunkCount,
    rawProgramdataHash: syntheticRelease1Bytes(35),
    zeroTailVerified: true,
    finalizedSlot: 89n,
    reserved: Buffer.alloc(PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN),
  };
}

export function syntheticStateCheckpointV1(): StateCheckpointV1 {
  const value: StateCheckpointV1 = {
    discriminator: Buffer.from(STATE_CHECKPOINT_V1_DISCRIMINATOR),
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 204,
    initialized: true,
    phase: StateCheckpointPhaseV1.Prestate,
    controllerConfig: syntheticRelease1Key(3),
    proposal: syntheticRelease1Key(33),
    emergencyResolution: syntheticRelease1Key(0),
    subjectDigest: syntheticRelease1Bytes(36),
    targetProgram: syntheticRelease1Key(7),
    targetProgramdata: syntheticRelease1Key(8),
    finalizedObservationSlot: 90n,
    gateEpoch: 10n,
    targetProgramdataSlot: 2n,
    targetPayloadCommitment: syntheticRelease1Bytes(37),
    targetRawProgramdataCommitment: syntheticRelease1Bytes(38),
    targetCapacity: 4_096n,
    programOwnedStateRoot: syntheticRelease1Bytes(39),
    programOwnedStateCount: 17n,
    logicalCompressedStateRoot: syntheticRelease1Bytes(40),
    logicalCompressedStateCount: 19n,
    semanticCustodyAccountingRoot: syntheticRelease1Bytes(41),
    hardCombinedRoot: syntheticRelease1Bytes(42),
    externalMetadataObservationRoot: syntheticRelease1Bytes(43),
    externalRawBalanceObservationRoot: syntheticRelease1Bytes(44),
    schemaIdentifier: syntheticRelease1Bytes(45),
    admittedPositiveDonationRoot: syntheticRelease1Bytes(46),
    admittedPositiveDonationCount: 1n,
    forbiddenDriftCount: 0,
    approvalCouncilVersion: 2n,
    approvalCouncilHash: syntheticRelease1Bytes(47),
    checkpointDigest: Buffer.alloc(32),
    approvalBitset: 0b0_0111,
    approvalCount: 3,
    accepted: true,
    acceptedSlot: 91n,
    reserved: Buffer.alloc(STATE_CHECKPOINT_V1_RESERVED_LEN),
  };
  value.checkpointDigest = stateCheckpointDigestV1(value);
  return value;
}

export function syntheticCouncilRotationProposalV1(): CouncilRotationProposalV1 {
  const value: CouncilRotationProposalV1 = {
    discriminator: Buffer.from(COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR),
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 205,
    initialized: true,
    state: CouncilRotationStateV1.Timelocked,
    controllerConfig: syntheticRelease1Key(3),
    targetProgram: syntheticRelease1Key(7),
    currentCouncil: syntheticRelease1Key(48),
    currentCouncilVersion: 2n,
    currentCouncilHash: syntheticRelease1Bytes(49),
    candidateCouncil: syntheticRelease1Key(50),
    candidateCouncilVersion: 3n,
    candidateCouncilHash: syntheticRelease1Bytes(51),
    creationSlot: 100n,
    notBeforeSlot: 120n,
    expirySlot: 140n,
    targetNonce: 11n,
    approvalBitset: 0b0_0111,
    approvalCount: 3,
    cancellationApprovalBitset: 0,
    cancellationApprovalCount: 0,
    rotationDigest: Buffer.alloc(32),
    activatedSlot: 0n,
    cancellationReasonCode: 0,
    terminalReasonCode: 0,
    reserved: Buffer.alloc(COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN),
  };
  value.rotationDigest = councilRotationDigestV1(value);
  return value;
}

export function syntheticEmergencyFreezeResolutionV1(): EmergencyFreezeResolutionV1 {
  const value: EmergencyFreezeResolutionV1 = {
    discriminator: Buffer.from(EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR),
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 206,
    initialized: true,
    state: EmergencyFreezeResolutionStateV1.Timelocked,
    controllerConfig: syntheticRelease1Key(3),
    protocolGate: syntheticRelease1Key(4),
    targetProgram: syntheticRelease1Key(7),
    targetProgramdata: syntheticRelease1Key(8),
    frozenEpoch: 12n,
    freezeSlot: 150n,
    freezeReasonCode: 2,
    resolutionKind: EmergencyFreezeResolutionKindV1.ResumeWithoutUpgrade,
    creationSlot: 151n,
    notBeforeSlot: 170n,
    expirySlot: 190n,
    targetNonce: 11n,
    observedProgramdataSlot: 2n,
    observedPayloadHash: syntheticRelease1Bytes(52),
    observedRawProgramdataHash: syntheticRelease1Bytes(53),
    observedCapacity: 4_096n,
    observedAuthority: syntheticRelease1Key(10),
    emergencyCheckpoint: syntheticRelease1Key(54),
    approvalCouncilVersion: 2n,
    approvalCouncilHash: syntheticRelease1Bytes(55),
    approvalBitset: 0b0_0111,
    approvalCount: 3,
    resolutionDigest: Buffer.alloc(32),
    executedSlot: 0n,
    cancellationReasonCode: 0,
    terminalReasonCode: 0,
    reserved: Buffer.alloc(EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN),
  };
  value.resolutionDigest = emergencyResolutionDigestV1(value);
  return value;
}

const vectorAccount = (
  discriminator: Buffer,
  accountVersion: number,
  bytes: Buffer,
  digestDomain?: Buffer,
  digestMaterial?: Buffer,
  digest?: Buffer,
) => ({
  discriminator_ascii: discriminator.toString("ascii"),
  account_version: accountVersion,
  len: bytes.length,
  encoded_hex: bytes.toString("hex"),
  ...(digestDomain && digestMaterial && digest
    ? {
        digest: {
          domain_ascii: digestDomain.toString("ascii"),
          material_length: digestMaterial.length,
          preimage_length: digestDomain.length + digestMaterial.length,
          material_hex: digestMaterial.toString("hex"),
          sha256_hex: digest.toString("hex"),
        },
      }
    : {}),
});

type SeedInput = Readonly<{
  encoding: "ascii" | "pubkey" | "u64_le_decimal" | "u8_decimal";
  value: string;
}>;

const asciiSeed = (value: string): SeedInput => ({ encoding: "ascii", value });
const pubkeySeed = (value: PublicKey): SeedInput => ({
  encoding: "pubkey",
  value: value.toBase58(),
});
const u64Seed = (value: bigint): SeedInput => ({
  encoding: "u64_le_decimal",
  value: value.toString(10),
});
const u8Seed = (value: number): SeedInput => ({
  encoding: "u8_decimal",
  value: value.toString(10),
});

const pda = (value: [PublicKey, number], seedInputs: readonly SeedInput[]) => ({
  seed_inputs: seedInputs,
  address: value[0].toBase58(),
  bump: value[1],
});

export function buildRelease1GoldenFixture(v1FixtureSha256: string): Record<string, unknown> {
  const proposal = syntheticUpgradeProposalV2();
  const buffer = syntheticBufferVerificationV1();
  const programdata = syntheticProgramDataVerificationV1();
  const checkpoint = syntheticStateCheckpointV1();
  const rotation = syntheticCouncilRotationProposalV1();
  const resolution = syntheticEmergencyFreezeResolutionV1();
  const merkleArtifact = syntheticArtifact(RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2 + 17);
  const merkleRoot = artifactMerkleRoot(merkleArtifact);
  const chunks = [0, 1, 2].map((index) => {
    const start = index * RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
    const end = Math.min(start + RELEASE1_ARTIFACT_CHUNK_SIZE_V1, merkleArtifact.length);
    const exact = merkleArtifact.subarray(start, end);
    return {
      label: index === 0 ? "first" : index === 1 ? "middle" : "final-partial",
      index,
      actual_length: exact.length,
      leaf_sha256_hex: artifactChunkLeafHash(index, exact).toString("hex"),
      proof_hex: artifactMerkleProof(merkleArtifact, index).map((entry) =>
        entry.toString("hex"),
      ),
    };
  });
  const leaf0 = artifactChunkLeafHash(
    0,
    merkleArtifact.subarray(0, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
  );
  const leaf1 = artifactChunkLeafHash(
    1,
    merkleArtifact.subarray(
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2,
    ),
  );
  const leaf2 = artifactChunkLeafHash(
    2,
    merkleArtifact.subarray(RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2),
  );
  const empty3 = artifactChunkEmptyHash(3);
  const manualRoot = artifactChunkNodeHash(
    artifactChunkNodeHash(leaf0, leaf1),
    artifactChunkNodeHash(leaf2, empty3),
  );
  const controller = syntheticRelease1Key(70);
  const target = syntheticRelease1Key(71);
  const proposalKey = syntheticRelease1Key(72);
  const seedDomain = asciiSeed("ameba-upgrade-v1");

  return {
    fixture_version: 1,
    warning:
      "SYNTHETIC NON-PRODUCTION RELEASE 1 VECTOR. No controller identity is assigned or deployed, and these bytes are not live governance state.",
    fixture_hash_contract:
      "SHA-256 of this exact UTF-8, two-space-indented, LF-terminated JSON with fixture_sha256 replaced by 64 ASCII zeroes.",
    fixture_sha256: "0".repeat(64),
    rust_sample_contract:
      "Values mirror programs/upgrade_controller/src/tests/release1_schema.rs key(byte), bytes(byte), and artifact(index modulo 251) helpers.",
    selected_chunk_size: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    verification_bitmap_bytes: 64,
    merkle_scheme: {
      leaf_domain_ascii: "AMOEBA_ARTIFACT_CHUNK_V1",
      node_domain_ascii: "AMOEBA_ARTIFACT_NODE_V1",
      empty_domain_ascii: "AMOEBA_ARTIFACT_EMPTY_V1",
      scheme_material_length: ARTIFACT_MERKLE_SCHEME_MATERIAL_V1.length,
      scheme_material_hex: ARTIFACT_MERKLE_SCHEME_MATERIAL_V1.toString("hex"),
      scheme_id_hex: ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
    },
    pda_inputs: {
      controller_program: controller.toBase58(),
      target_program: target.toBase58(),
      proposal: proposalKey.toBase58(),
      frozen_epoch: "7",
      candidate_council_version: "8",
    },
    pdas: {
      buffer_verification: pda(deriveBufferVerificationPdaV1(controller, proposalKey), [
        seedDomain,
        asciiSeed("buffer-check"),
        pubkeySeed(proposalKey),
      ]),
      programdata_verification: pda(deriveProgramdataCheckPda(controller, proposalKey), [
        seedDomain,
        asciiSeed("programdata-check"),
        pubkeySeed(proposalKey),
      ]),
      prestate_checkpoint: pda(
        deriveRelease1CheckpointPda(controller, proposalKey, StateCheckpointPhaseV1.Prestate),
        [seedDomain, asciiSeed("checkpoint"), pubkeySeed(proposalKey), u8Seed(0)],
      ),
      poststate_checkpoint: pda(
        deriveRelease1CheckpointPda(controller, proposalKey, StateCheckpointPhaseV1.Poststate),
        [seedDomain, asciiSeed("checkpoint"), pubkeySeed(proposalKey), u8Seed(1)],
      ),
      emergency_resolution: pda(deriveEmergencyResolutionPda(controller, target, 7n), [
        seedDomain,
        asciiSeed("emergency-resolution"),
        pubkeySeed(target),
        u64Seed(7n),
      ]),
      emergency_checkpoint: pda(deriveEmergencyCheckpointPda(controller, target, 7n), [
        seedDomain,
        asciiSeed("emergency-checkpoint"),
        pubkeySeed(target),
        u64Seed(7n),
      ]),
      council_rotation: pda(deriveCouncilRotationPda(controller, target, 8n), [
        seedDomain,
        asciiSeed("council-rotation"),
        pubkeySeed(target),
        u64Seed(8n),
      ]),
    },
    accounts: {
      upgrade_proposal_v2: vectorAccount(
        UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
        ACCOUNT_VERSION_V2,
        serializeUpgradeProposalV2(proposal),
        PROPOSAL_DIGEST_DOMAIN_V2,
        canonicalProposalDigestMaterialV2(proposal),
        proposal.proposalDigest,
      ),
      buffer_verification_v1: vectorAccount(
        BUFFER_VERIFICATION_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1,
        serializeBufferVerificationV1(buffer),
      ),
      programdata_verification_v1: vectorAccount(
        PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1,
        serializeProgramDataVerificationV1(programdata),
      ),
      state_checkpoint_v1: vectorAccount(
        STATE_CHECKPOINT_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1,
        serializeStateCheckpointV1(checkpoint),
        Buffer.from("AMOEBA_STATE_CHECKPOINT_V1", "ascii"),
        canonicalStateCheckpointDigestMaterialV1(checkpoint),
        checkpoint.checkpointDigest,
      ),
      council_rotation_proposal_v1: vectorAccount(
        COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1,
        serializeCouncilRotationProposalV1(rotation),
        Buffer.from("AMOEBA_COUNCIL_ROTATION_V1", "ascii"),
        canonicalCouncilRotationDigestMaterialV1(rotation),
        rotation.rotationDigest,
      ),
      emergency_freeze_resolution_v1: vectorAccount(
        EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1,
        serializeEmergencyFreezeResolutionV1(resolution),
        Buffer.from("AMOEBA_EMERGENCY_RESOLUTION_V1", "ascii"),
        canonicalEmergencyResolutionDigestMaterialV1(resolution),
        resolution.resolutionDigest,
      ),
    },
    merkle: {
      artifact_generator: {
        rule: "byte[index] = index modulo 251",
        artifact_length: merkleArtifact.length,
        chunk_count: 3,
      },
      root_sha256_hex: merkleRoot.toString("hex"),
      chunks,
      padding: {
        padded_index: 3,
        empty_sha256_hex: empty3.toString("hex"),
        manual_root_sha256_hex: manualRoot.toString("hex"),
      },
    },
    v1_regression: {
      fixture_path: "fixtures/upgrade_governance_v1.json",
      fixture_sha256: v1FixtureSha256,
      proposal_discriminator_ascii: "AGVPRP01",
      proposal_length: 1_280,
      proposal_reserved_length: 142,
      proposal_digest_domain_ascii: "AMOEBA_UPGRADE_PROPOSAL_V1",
      proposal_digest_material_length: 1_084,
      proposal_digest_preimage_length: 1_110,
    },
  };
}
