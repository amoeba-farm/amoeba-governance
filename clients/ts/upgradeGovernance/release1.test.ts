import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  ARTIFACT_MERKLE_SCHEME_ID,
  ARTIFACT_MERKLE_SCHEME_MATERIAL_V1,
  MAX_ARTIFACT_BYTES_V1,
  MAX_ARTIFACT_CHUNKS_V1,
  MAX_ARTIFACT_PROOF_DEPTH_V1,
  MAX_PADDED_ARTIFACT_CHUNKS_V1,
  MAX_SELECTED_ARTIFACT_CHUNKS_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  VERIFICATION_BITMAP_BYTES_V1,
  artifactChunkCount,
  artifactChunkEmptyHash,
  artifactChunkLeafHash,
  artifactChunkNodeHash,
  artifactMerkleProof,
  artifactMerkleRoot,
  completeVerificationBitmapV1,
  validateVerificationBitmapV1,
  verifyArtifactChunkProof,
} from "./artifactMerkleV1.js";
import {
  BUFFER_VERIFICATION_V1_LEN,
  BUFFER_VERIFICATION_V1_OFFSETS,
  BufferVerificationStatusV1,
  CHECKPOINT_ATTESTATION_DIGEST_DOMAIN_V1,
  CHECKPOINT_ATTESTATION_DIGEST_MATERIAL_LEN_V1,
  CHECKPOINT_ATTESTATION_V1_LEN,
  CHECKPOINT_ATTESTATION_V1_OFFSETS,
  COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1,
  COUNCIL_ROTATION_PROPOSAL_V1_LEN,
  COUNCIL_ROTATION_V1_OFFSETS,
  CouncilRotationStateV1,
  EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
  EMERGENCY_FREEZE_OBSERVATION_DIGEST_MATERIAL_LEN_V1,
  EMERGENCY_FREEZE_OBSERVATION_V1_LEN,
  EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS,
  EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1,
  EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1,
  EMERGENCY_RESOLUTION_V1_OFFSETS,
  EmergencyFreezeResolutionStateV1,
  MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
  NO_FAILING_CHUNK_INDEX_V1,
  PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_MATERIAL_LEN_V1,
  PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN,
  PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS,
  ProgramDataMismatchClassV1,
  PROGRAMDATA_VERIFICATION_V1_LEN,
  PROGRAMDATA_VERIFICATION_V1_OFFSETS,
  ProgramDataVerificationStatusV1,
  PROPOSAL_DIGEST_DOMAIN_V2,
  PROPOSAL_DIGEST_MATERIAL_LEN_V2,
  PROPOSAL_DIGEST_PREIMAGE_LEN_V2,
  ProposalStateV2,
  STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1,
  STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1,
  STATE_CHECKPOINT_HARD_ROOT_MATERIAL_LEN_V1,
  STATE_CHECKPOINT_HARD_ROOT_PREIMAGE_LEN_V1,
  STATE_CHECKPOINT_V1_LEN,
  STATE_CHECKPOINT_V1_OFFSETS,
  StateCheckpointPhaseV1,
  UPGRADE_PROPOSAL_V2_LEN,
  UPGRADE_PROPOSAL_V2_OFFSETS,
  canonicalCouncilRotationDigestMaterialV1,
  canonicalCheckpointAttestationDigestMaterialV1,
  canonicalEmergencyResolutionDigestMaterialV1,
  canonicalEmergencyFreezeObservationDigestMaterialV1,
  canonicalProgramDataFailureObservationDigestMaterialV1,
  canonicalProposalDigestMaterialV2,
  canonicalStateCheckpointDigestMaterialV1,
  canonicalStateCheckpointHardRootMaterialV1,
  councilRotationDigestV1,
  checkpointAttestationDigestV1,
  deriveBufferVerificationPdaV1,
  deriveCouncilRotationPda,
  deriveCheckpointAttestationPda,
  deriveEmergencyCheckpointPda,
  deriveEmergencyResolutionPda,
  deriveEmergencyFreezeObservationPda,
  deriveProgramDataFailureObservationPda,
  deriveProgramdataCheckPda,
  deriveRelease1CheckpointPda,
  deserializeBufferVerificationV1,
  deserializeCouncilRotationProposalV1,
  deserializeCheckpointAttestationV1,
  deserializeEmergencyFreezeResolutionV1,
  deserializeEmergencyFreezeObservationV1,
  deserializeProgramDataFailureObservationV1,
  deserializeProgramDataVerificationV1,
  deserializeStateCheckpointV1,
  deserializeUpgradeProposalV2,
  emergencyResolutionDigestV1,
  emergencyFreezeObservationDigestV1,
  programDataFailureObservationDigestV1,
  proposalDigestV2,
  serializeBufferVerificationV1,
  serializeCouncilRotationProposalV1,
  serializeCheckpointAttestationV1,
  serializeEmergencyFreezeResolutionV1,
  serializeEmergencyFreezeObservationV1,
  serializeProgramDataFailureObservationV1,
  serializeProgramDataVerificationV1,
  serializeStateCheckpointV1,
  serializeUpgradeProposalV2,
  stateCheckpointDigestV1,
  stateCheckpointHardCombinedRootV1,
  validateBufferVerificationV1,
  validateCheckpointAttestationDigestV1,
  validateCheckpointAttestationV1,
  validateEmergencyFreezeResolutionV1,
  validateEmergencyFreezeObservationDigestV1,
  validateProgramDataFailureObservationDigestV1,
  validateProgramDataFailureObservationV1,
  validateProposalDigestV2,
  validateStateCheckpointDigestV1,
  validateStateCheckpointHardCombinedRootV1,
} from "./release1.js";
import {
  syntheticArtifact,
  syntheticBufferVerificationV1,
  syntheticCouncilRotationProposalV1,
  syntheticCheckpointAttestationV1,
  syntheticEmergencyFreezeResolutionV1,
  syntheticEmergencyFreezeObservationV1,
  syntheticProgramDataFailureObservationV1,
  syntheticProgramDataVerificationV1,
  syntheticRelease1Key,
  syntheticRelease1IdentityGraph,
  syntheticStateCheckpointV1,
  syntheticUpgradeProposalV2,
} from "./release1SyntheticVector.js";
import {
  AMEBA_SPREAD_PROGRAM_V1,
  SYNTHETIC_CONTROLLER_PROGRAM_V1,
} from "./spreadGateBridgeV1.js";
import {
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveProposalPda,
  deriveUpgradeableProgramdataAddress,
  PROPOSAL_DIGEST_DOMAIN_V1,
  PROPOSAL_DIGEST_MATERIAL_LEN,
  UPGRADE_PROPOSAL_LEN,
} from "./v1.js";

interface PdaVector {
  seed_inputs: readonly {
    encoding: "ascii" | "pubkey" | "u64_le_decimal" | "u8_decimal";
    value: string;
  }[];
  address: string;
  bump: number;
}

interface AccountVector {
  discriminator_ascii: string;
  account_version: number;
  len: number;
  encoded_hex: string;
  digest?: {
    domain_ascii: string;
    material_length: number;
    preimage_length: number;
    material_hex: string;
    sha256_hex: string;
  };
}

interface Release1Fixture {
  fixture_version: number;
  warning: string;
  fixture_hash_contract: string;
  fixture_sha256: string;
  max_artifact_bytes: number;
  max_atomic_raw_programdata_account_bytes: number;
  selected_chunk_size: number;
  max_selected_artifact_chunks: number;
  max_padded_artifact_chunks: number;
  verification_bitmap_bytes: number;
  checkpoint_hard_combined_root: {
    domain_ascii: string;
    material_length: number;
    preimage_length: number;
    material_hex: string;
    sha256_hex: string;
  };
  merkle_scheme: {
    leaf_domain_ascii: string;
    node_domain_ascii: string;
    empty_domain_ascii: string;
    scheme_material_length: number;
    scheme_material_hex: string;
    scheme_id_hex: string;
  };
  pda_inputs: {
    controller_program: string;
    target_program: string;
    proposal: string;
    emergency_frozen_epoch: string;
    failure_frozen_epoch: string;
    candidate_council_version: string;
    checkpoint: string;
    checkpoint_council_version: string;
    checkpoint_seat_index: string;
  };
  pdas: Record<string, PdaVector>;
  accounts: Record<string, AccountVector>;
  merkle: {
    artifact_generator: { artifact_length: number; chunk_count: number };
    root_sha256_hex: string;
    chunks: readonly {
      label: string;
      index: number;
      actual_length: number;
      leaf_sha256_hex: string;
      proof_hex: readonly string[];
    }[];
    padding: {
      padded_index: number;
      empty_sha256_hex: string;
      manual_root_sha256_hex: string;
    };
  };
  v1_regression: {
    fixture_path: string;
    fixture_sha256: string;
    proposal_discriminator_ascii: string;
    proposal_length: number;
    proposal_reserved_length: number;
    proposal_digest_domain_ascii: string;
    proposal_digest_material_length: number;
    proposal_digest_preimage_length: number;
  };
}

const fixturePath = new URL(
  "../../../fixtures/upgrade_governance_release1.json",
  import.meta.url,
);
const fixtureText = readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText) as Release1Fixture;

function account(name: string): AccountVector {
  const value = fixture.accounts[name];
  assert.ok(value, `missing fixture account ${name}`);
  return value;
}

function pda(name: string): PdaVector {
  const value = fixture.pdas[name];
  assert.ok(value, `missing fixture PDA ${name}`);
  return value;
}

function expectPda(actual: [PublicKey, number], expected: PdaVector): void {
  assert.equal(actual[0].toBase58(), expected.address);
  assert.equal(actual[1], expected.bump);
}

test("Release 1 fixture is self-authenticating and explicitly synthetic", () => {
  assert.equal(fixture.fixture_version, 1);
  assert.match(fixture.warning, /SYNTHETIC NON-PRODUCTION/);
  assert.match(fixture.fixture_hash_contract, /64 ASCII zeroes/);
  const withZeroHash = {
    ...fixture,
    fixture_sha256: "0".repeat(64),
  };
  const canonical = `${JSON.stringify(withZeroHash, null, 2)}\n`;
  assert.equal(
    createHash("sha256").update(canonical, "utf8").digest("hex"),
    fixture.fixture_sha256,
  );
});

test("fixed account sizes, selected chunk size, bitmap width, and Rust offsets remain exact", () => {
  assert.equal(UPGRADE_PROPOSAL_V2_LEN, 1_792);
  assert.equal(BUFFER_VERIFICATION_V1_LEN, 512);
  assert.equal(PROGRAMDATA_VERIFICATION_V1_LEN, 640);
  assert.equal(STATE_CHECKPOINT_V1_LEN, 704);
  assert.equal(COUNCIL_ROTATION_PROPOSAL_V1_LEN, 384);
  assert.equal(EMERGENCY_FREEZE_RESOLUTION_V1_LEN, 640);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_LEN, 512);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN, 512);
  assert.equal(CHECKPOINT_ATTESTATION_V1_LEN, 384);
  assert.equal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 16_384);
  assert.equal(VERIFICATION_BITMAP_BYTES_V1, 64);
  assert.equal(MAX_ARTIFACT_CHUNKS_V1, 512);
  assert.equal(MAX_SELECTED_ARTIFACT_CHUNKS_V1, 96);
  assert.equal(MAX_PADDED_ARTIFACT_CHUNKS_V1, 128);
  assert.equal(MAX_ARTIFACT_PROOF_DEPTH_V1, 7);
  assert.equal(MAX_ARTIFACT_BYTES_V1, 1_572_864);
  assert.equal(MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1, 1_572_909n);
  assert.deepEqual(UPGRADE_PROPOSAL_V2_OFFSETS, {
    discriminator: 0,
    accountVersion: 8,
    initialized: 10,
    proposalClass: 11,
    state: 12,
    proposalId: 16,
    clusterDomain: 40,
    buffer: 424,
    artifactLength: 616,
    chunkSize: 720,
    firstApprovalSlot: 1436,
    proposalDigest: 1610,
    reserved: 1646,
  });
  assert.equal(BUFFER_VERIFICATION_V1_OFFSETS.bitmap, 316);
  assert.equal(PROGRAMDATA_VERIFICATION_V1_OFFSETS.tailBitmap, 412);
  assert.equal(STATE_CHECKPOINT_V1_OFFSETS.checkpointDigest, 624);
  assert.equal(COUNCIL_ROTATION_V1_OFFSETS.rotationDigest, 256);
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.observedProgramOwner, 223);
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.observedProgramdataOwner, 298);
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.observedProgramdataSlot, 340);
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.observedRawHashComplete, 348);
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.resolutionDigest, 496);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.actualProgramOwner, 254);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.actualProgramdataOwner, 329);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.deployedProgramdataSlot, 371);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.rawHashComplete, 379);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.observationDigest, 453);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.actualProgramOwner, 180);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.actualProgramdataOwner, 288);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.actualProgramdataSlot, 330);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.rawHashComplete, 255);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.observationDigest, 456);
  assert.equal(CHECKPOINT_ATTESTATION_V1_OFFSETS.phase, 171);
  assert.equal(CHECKPOINT_ATTESTATION_V1_OFFSETS.attestationDigest, 325);
  assert.equal(fixture.selected_chunk_size, 16_384);
  assert.equal(fixture.max_artifact_bytes, 1_572_864);
  assert.equal(fixture.max_atomic_raw_programdata_account_bytes, 1_572_909);
  assert.equal(fixture.max_selected_artifact_chunks, 96);
  assert.equal(fixture.max_padded_artifact_chunks, 128);
  assert.equal(fixture.verification_bitmap_bytes, 64);
});

test("Release 1 vectors reuse the exact Phase 3 synthetic Spread identity graph", () => {
  const identity = syntheticRelease1IdentityGraph();
  const proposal = syntheticUpgradeProposalV2();
  assert.ok(identity.controllerProgram.equals(SYNTHETIC_CONTROLLER_PROGRAM_V1));
  assert.ok(identity.targetProgram.equals(AMEBA_SPREAD_PROGRAM_V1));
  assert.equal(identity.controllerProgram.toBase58(), fixture.pda_inputs.controller_program);
  assert.equal(identity.targetProgram.toBase58(), fixture.pda_inputs.target_program);
  assert.equal(identity.proposal.toBase58(), fixture.pda_inputs.proposal);
  assert.ok(proposal.controllerProgram.equals(identity.controllerProgram));
  assert.ok(proposal.controllerConfig.equals(identity.controllerConfig));
  assert.ok(proposal.protocolGate.equals(identity.protocolGate));
  assert.ok(proposal.targetProgram.equals(identity.targetProgram));
  assert.ok(proposal.targetProgramdata.equals(identity.targetProgramdata));
  assert.ok(proposal.authorityPda.equals(identity.authorityPda));
  assert.ok(proposal.bufferVerification.equals(identity.bufferVerification));
  assert.ok(proposal.programdataVerification.equals(identity.programdataVerification));
  assert.ok(proposal.prestateCheckpoint.equals(identity.prestateCheckpoint));
  assert.ok(proposal.requiredPoststateCheckpoint.equals(identity.poststateCheckpoint));
});

test("all nine account codecs roundtrip and match the shared Rust-shaped fixture", () => {
  const cases = [
    {
      name: "upgrade_proposal_v2",
      value: syntheticUpgradeProposalV2(),
      encode: serializeUpgradeProposalV2,
      decode: deserializeUpgradeProposalV2,
    },
    {
      name: "buffer_verification_v1",
      value: syntheticBufferVerificationV1(),
      encode: serializeBufferVerificationV1,
      decode: deserializeBufferVerificationV1,
    },
    {
      name: "programdata_verification_v1",
      value: syntheticProgramDataVerificationV1(),
      encode: serializeProgramDataVerificationV1,
      decode: deserializeProgramDataVerificationV1,
    },
    {
      name: "state_checkpoint_v1",
      value: syntheticStateCheckpointV1(),
      encode: serializeStateCheckpointV1,
      decode: deserializeStateCheckpointV1,
    },
    {
      name: "council_rotation_proposal_v1",
      value: syntheticCouncilRotationProposalV1(),
      encode: serializeCouncilRotationProposalV1,
      decode: deserializeCouncilRotationProposalV1,
    },
    {
      name: "emergency_freeze_resolution_v1",
      value: syntheticEmergencyFreezeResolutionV1(),
      encode: serializeEmergencyFreezeResolutionV1,
      decode: deserializeEmergencyFreezeResolutionV1,
    },
    {
      name: "emergency_freeze_observation_v1",
      value: syntheticEmergencyFreezeObservationV1(),
      encode: serializeEmergencyFreezeObservationV1,
      decode: deserializeEmergencyFreezeObservationV1,
    },
    {
      name: "programdata_failure_observation_v1",
      value: syntheticProgramDataFailureObservationV1(),
      encode: serializeProgramDataFailureObservationV1,
      decode: deserializeProgramDataFailureObservationV1,
    },
    {
      name: "checkpoint_attestation_v1",
      value: syntheticCheckpointAttestationV1(),
      encode: serializeCheckpointAttestationV1,
      decode: deserializeCheckpointAttestationV1,
    },
  ] as const;

  for (const entry of cases) {
    const encoded = entry.encode(entry.value as never);
    const expected = account(entry.name);
    assert.equal(encoded.length, expected.len);
    assert.equal(encoded.subarray(0, 8).toString("ascii"), expected.discriminator_ascii);
    assert.equal(encoded.readUInt8(8), expected.account_version);
    assert.equal(encoded.toString("hex"), expected.encoded_hex);
    const decoded = entry.decode(encoded);
    assert.equal(entry.encode(decoded as never).toString("hex"), expected.encoded_hex);
  }
});

test("ProgramData raw hash is written only by finalization", () => {
  const verifying = syntheticProgramDataVerificationV1();
  verifying.status = ProgramDataVerificationStatusV1.Verifying;
  verifying.verifiedPayloadChunkBitmap = Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1);
  verifying.verifiedPayloadChunkCount = 0;
  verifying.rawProgramdataHash = Buffer.alloc(32);
  verifying.zeroTailVerified = false;
  verifying.finalizedSlot = 0n;
  assert.doesNotThrow(() => serializeProgramDataVerificationV1(verifying));

  const ready = syntheticProgramDataVerificationV1();
  ready.status = ProgramDataVerificationStatusV1.ReadyToFinalize;
  ready.rawProgramdataHash = Buffer.alloc(32);
  ready.zeroTailVerified = false;
  ready.finalizedSlot = 0n;
  assert.doesNotThrow(() => serializeProgramDataVerificationV1(ready));

  const completeButStillVerifying = {
    ...ready,
    status: ProgramDataVerificationStatusV1.Verifying,
  };
  assert.throws(
    () => serializeProgramDataVerificationV1(completeButStillVerifying),
    /in-progress ProgramData verification evidence/,
  );

  verifying.rawProgramdataHash = Buffer.alloc(32, 99);
  assert.throws(
    () => serializeProgramDataVerificationV1(verifying),
    /in-progress ProgramData verification evidence/,
  );

  const verified = syntheticProgramDataVerificationV1();
  verified.rawProgramdataHash = Buffer.alloc(32);
  assert.throws(
    () => serializeProgramDataVerificationV1(verified),
    /completed ProgramData verification evidence/,
  );
});

test("buffer verification exposes a complete awaiting-finalization state", () => {
  const ready = syntheticBufferVerificationV1();
  ready.status = BufferVerificationStatusV1.ReadyToFinalize;
  ready.finalizedSlot = 0n;
  assert.doesNotThrow(() => serializeBufferVerificationV1(ready));

  assert.throws(
    () =>
      serializeBufferVerificationV1({
        ...ready,
        status: BufferVerificationStatusV1.Verifying,
      }),
    /buffer verification lifecycle evidence/,
  );
  assert.throws(
    () =>
      serializeBufferVerificationV1({
        ...ready,
        verifiedChunkBitmap: Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1),
        verifiedChunkCount: 0,
      }),
    /buffer verification lifecycle evidence/,
  );
});

test("ProgramData failure observations reject every noncanonical mismatch shape", () => {
  const base = syntheticProgramDataFailureObservationV1();
  const noLeaf = {
    failingChunkIndex: NO_FAILING_CHUNK_INDEX_V1,
    expectedLeafHash: Buffer.alloc(32),
    actualLeafHash: Buffer.alloc(32),
  };
  const variants = [
    {
      ...base,
      mismatchClass: ProgramDataMismatchClassV1.Header,
      programdataHeaderPresent: false,
      actualProgramdataSlot: 0n,
      actualCapacity: 0n,
      actualAuthority: { present: false, value: syntheticRelease1Key(0) },
      ...noLeaf,
    },
    {
      ...base,
      mismatchClass: ProgramDataMismatchClassV1.Authority,
      actualAuthority: { present: false, value: syntheticRelease1Key(0) },
      ...noLeaf,
    },
    {
      ...base,
      mismatchClass: ProgramDataMismatchClassV1.Capacity,
      actualDataLength: 45n,
      actualCapacity: 0n,
      ...noLeaf,
    },
    base,
    { ...base, mismatchClass: ProgramDataMismatchClassV1.ZeroTail },
  ];
  for (const variant of variants) {
    assert.doesNotThrow(() => validateProgramDataFailureObservationV1(variant));
  }

  assert.throws(
    () =>
      validateProgramDataFailureObservationV1({
        ...variants[0]!,
        mismatchClass: ProgramDataMismatchClassV1.Capacity,
      }),
    /absent ProgramData header/,
  );
  assert.throws(
    () =>
      validateProgramDataFailureObservationV1({
        ...base,
        failingChunkIndex: NO_FAILING_CHUNK_INDEX_V1,
      }),
    /failure leaf evidence/,
  );
  assert.throws(
    () =>
      validateProgramDataFailureObservationV1({
        ...base,
        actualLeafHash: Buffer.from(base.expectedLeafHash),
      }),
    /failure leaf evidence/,
  );
  assert.throws(
    () =>
      validateProgramDataFailureObservationV1({
        ...variants[1]!,
        expectedLeafHash: Buffer.alloc(32, 1),
      }),
    /failure leaf evidence/,
  );
  assert.throws(
    () => validateProgramDataFailureObservationV1({ ...base, actualDataLength: 0n }),
    /metadata plus capacity/,
  );
});

test("guardian freeze records absent or drifted authority without weakening resume", () => {
  const observation = syntheticEmergencyFreezeObservationV1();
  for (const observedAuthority of [
    { present: false, value: syntheticRelease1Key(0) },
    { present: true, value: syntheticRelease1Key(99) },
  ]) {
    const candidateDraft = {
      ...observation,
      observedAuthority,
      observationDigest: Buffer.alloc(32),
    };
    const candidate = {
      ...candidateDraft,
      observationDigest: emergencyFreezeObservationDigestV1(candidateDraft),
    };
    assert.doesNotThrow(() => serializeEmergencyFreezeObservationV1(candidate));
  }

  const malformedDraft = {
    ...observation,
    actualProgramdataOwner: syntheticRelease1Key(98),
    actualProgramdataExecutable: true,
    actualProgramdataDataLength: 17n,
    programdataHeaderPresent: false,
    deployedProgramdataSlot: 0n,
    capacity: 0n,
    observedAuthority: { present: false, value: syntheticRelease1Key(0) },
    observationDigest: Buffer.alloc(32),
  };
  const malformed = {
    ...malformedDraft,
    observationDigest: emergencyFreezeObservationDigestV1(malformedDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeObservationV1(malformed));
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...malformed,
        deployedProgramdataSlot: 1n,
      }),
    /absent-header metadata/,
  );

  const resolution = syntheticEmergencyFreezeResolutionV1();
  const absentDraft = {
    ...resolution,
    observedAuthority: { present: false, value: syntheticRelease1Key(0) },
    resolutionDigest: Buffer.alloc(32),
  };
  const absent = {
    ...absentDraft,
    resolutionDigest: emergencyResolutionDigestV1(absentDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeResolutionV1(absent));

  const malformedResolutionDraft = {
    ...resolution,
    observedProgramdataOwner: syntheticRelease1Key(98),
    observedProgramdataExecutable: true,
    observedProgramdataDataLength: 17n,
    observedProgramdataHeaderPresent: false,
    observedProgramdataSlot: 0n,
    observedCapacity: 0n,
    observedAuthority: { present: false, value: syntheticRelease1Key(0) },
    resolutionDigest: Buffer.alloc(32),
  };
  const malformedResolution = {
    ...malformedResolutionDraft,
    resolutionDigest: emergencyResolutionDigestV1(malformedResolutionDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeResolutionV1(malformedResolution));
});

test("target Program evidence and raw ProgramData completeness are canonical", () => {
  const freeze = syntheticEmergencyFreezeObservationV1();
  const malformedProgramDraft = {
    ...freeze,
    actualProgramDataLength: 17n,
    programHeaderPresent: false,
    actualLinkedProgramdata: { present: false, value: syntheticRelease1Key(0) },
    observationDigest: Buffer.alloc(32),
  };
  const malformedProgram = {
    ...malformedProgramDraft,
    observationDigest: emergencyFreezeObservationDigestV1(malformedProgramDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeObservationV1(malformedProgram));
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...freeze,
        actualProgramDataLength: 35n,
      }),
    /Program header evidence/,
  );
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...malformedProgram,
        actualLinkedProgramdata: {
          present: true,
          value: freeze.targetProgramdata,
        },
      }),
    /absent Program header evidence/,
  );

  const incompleteFreezeDraft = {
    ...freeze,
    actualProgramdataDataLength:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n,
    capacity:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 +
      1n -
      45n,
    rawHashComplete: false,
    rawProgramdataSha256: Buffer.alloc(32),
    observationDigest: Buffer.alloc(32),
  };
  const incompleteFreeze = {
    ...incompleteFreezeDraft,
    observationDigest: emergencyFreezeObservationDigestV1(incompleteFreezeDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeObservationV1(incompleteFreeze));
  const ceilingFreezeDraft = {
    ...freeze,
    actualProgramdataDataLength:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
    capacity:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 - 45n,
    observationDigest: Buffer.alloc(32),
  };
  const ceilingFreeze = {
    ...ceilingFreezeDraft,
    observationDigest: emergencyFreezeObservationDigestV1(ceilingFreezeDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeObservationV1(ceilingFreeze));
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...ceilingFreeze,
        rawHashComplete: false,
        rawProgramdataSha256: Buffer.alloc(32),
      }),
    /canonically complete or incomplete/,
  );
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...incompleteFreeze,
        rawHashComplete: true,
        rawProgramdataSha256: Buffer.alloc(32, 1),
      }),
    /canonically complete or incomplete/,
  );
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...freeze,
        rawHashComplete: false,
      }),
    /canonically complete or incomplete/,
  );
  assert.throws(
    () =>
      serializeEmergencyFreezeObservationV1({
        ...freeze,
        rawProgramdataSha256: Buffer.alloc(32),
      }),
    /canonically complete or incomplete/,
  );

  const resolution = syntheticEmergencyFreezeResolutionV1();
  const incompleteResolutionDraft = {
    ...resolution,
    observedProgramdataDataLength:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n,
    observedCapacity:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 +
      1n -
      45n,
    observedRawHashComplete: false,
    observedRawProgramdataHash: Buffer.alloc(32),
    resolutionDigest: Buffer.alloc(32),
  };
  const incompleteResolution = {
    ...incompleteResolutionDraft,
    resolutionDigest: emergencyResolutionDigestV1(incompleteResolutionDraft),
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeResolutionV1(incompleteResolution));
  const executedResolution = {
    ...resolution,
    state: EmergencyFreezeResolutionStateV1.Executed,
    executedSlot: resolution.notBeforeSlot,
    terminalReasonCode: EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1,
  };
  assert.doesNotThrow(() => serializeEmergencyFreezeResolutionV1(executedResolution));
  assert.throws(
    () =>
      serializeEmergencyFreezeResolutionV1({
        ...incompleteResolution,
        state: EmergencyFreezeResolutionStateV1.Executed,
        executedSlot: incompleteResolution.notBeforeSlot,
        terminalReasonCode: EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1,
      }),
    /execution evidence/,
  );
  for (const invalid of [
    {
      ...executedResolution,
      observedProgramOwner: syntheticRelease1Key(99),
    },
    {
      ...executedResolution,
      observedProgramdataExecutable: true,
    },
    {
      ...executedResolution,
      observedProgramdataSlot: 0n,
    },
    {
      ...executedResolution,
      observedAuthority: { present: false, value: syntheticRelease1Key(0) },
    },
  ]) {
    assert.throws(
      () => serializeEmergencyFreezeResolutionV1(invalid),
      /execution evidence/,
    );
  }

  const failure = syntheticProgramDataFailureObservationV1();
  const noLeaf = {
    mismatchClass: ProgramDataMismatchClassV1.Header,
    failingChunkIndex: NO_FAILING_CHUNK_INDEX_V1,
    expectedLeafHash: Buffer.alloc(32),
    actualLeafHash: Buffer.alloc(32),
  } as const;
  const incompleteFailureDraft = {
    ...failure,
    ...noLeaf,
    actualDataLength: MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1n,
    actualCapacity:
      MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 +
      1n -
      45n,
    rawHashComplete: false,
    actualRawProgramdataSha256: Buffer.alloc(32),
    observationDigest: Buffer.alloc(32),
  };
  const incompleteFailure = {
    ...incompleteFailureDraft,
    observationDigest: programDataFailureObservationDigestV1(incompleteFailureDraft),
  };
  assert.doesNotThrow(() => serializeProgramDataFailureObservationV1(incompleteFailure));
  assert.throws(
    () =>
      serializeProgramDataFailureObservationV1({
        ...failure,
        rawHashComplete: false,
        actualRawProgramdataSha256: Buffer.alloc(32),
      }),
    /canonically complete or incomplete|complete raw hash/,
  );
});

test("forbidden checkpoint drift is digest-bound evidence but can never be accepted", () => {
  const accepted = syntheticStateCheckpointV1();
  assert.throws(
    () =>
      serializeStateCheckpointV1({
        ...accepted,
        forbiddenDriftCount: 1,
      }),
    /acceptance disagrees with forbidden drift/,
  );

  const failedWithoutDigest = {
    ...accepted,
    forbiddenDriftCount: 1,
    accepted: false,
    checkpointDigest: Buffer.alloc(32),
  };
  const failed = {
    ...failedWithoutDigest,
    checkpointDigest: stateCheckpointDigestV1(failedWithoutDigest),
  };
  assert.doesNotThrow(() => serializeStateCheckpointV1(failed));
  validateStateCheckpointDigestV1(failed);

  assert.throws(
    () => serializeStateCheckpointV1({ ...failed, approvalBitset: 0, approvalCount: 0 }),
    /approval council binding|lacks quorum/,
  );
  assert.throws(
    () => serializeStateCheckpointV1({ ...failed, finalizedSlot: 0n }),
    /finalization slot/,
  );
  assert.throws(
    () =>
      serializeStateCheckpointV1({
        ...failed,
        approvalBitset: 0b0_1111,
        approvalCount: 4,
      }),
    /lacks quorum or finalization slot/,
  );
});

test("checkpoint attestations are seat-scoped, recastable, and bind every finalizer input", () => {
  const base = syntheticCheckpointAttestationV1();
  validateCheckpointAttestationV1(base);
  validateCheckpointAttestationDigestV1(base);

  assert.throws(
    () => validateCheckpointAttestationV1({ ...base, subject: syntheticRelease1Key(0) }),
    /subject must be nondefault/,
  );
  assert.throws(
    () => validateCheckpointAttestationV1({ ...base, seatIndex: 5 }),
    /invalid CheckpointAttestationV1 commitment/,
  );
  assert.throws(
    () => validateCheckpointAttestationV1({ ...base, councilVersion: 0n }),
    /invalid CheckpointAttestationV1 commitment/,
  );

  const baseline = checkpointAttestationDigestV1(base);
  const changes = [
    { ...base, checkpointDigest: Buffer.alloc(32, 91) },
    { ...base, subjectDigest: Buffer.alloc(32, 92) },
    { ...base, phase: StateCheckpointPhaseV1.Poststate },
    { ...base, councilVersion: base.councilVersion + 1n },
    { ...base, gateEpoch: base.gateEpoch + 1n },
    { ...base, seatIndex: 3 },
    { ...base, seatAuthority: syntheticRelease1Key(63) },
    { ...base, attestedSlot: base.attestedSlot + 1n },
  ];
  for (const changed of changes) {
    assert.notDeepEqual(checkpointAttestationDigestV1(changed), baseline);
  }

  const recastCandidate = {
    ...base,
    checkpointDigest: Buffer.alloc(32, 99),
    attestedSlot: base.attestedSlot + 1n,
    attestationDigest: Buffer.alloc(32),
  };
  const recast = {
    ...recastCandidate,
    attestationDigest: checkpointAttestationDigestV1(recastCandidate),
  };
  assert.doesNotThrow(() => serializeCheckpointAttestationV1(recast));
});

test("fixed decoders reject truncation, trailing bytes, unknown enums, booleans, and reserved drift", () => {
  const cases = [
    {
      name: "upgrade_proposal_v2",
      decode: deserializeUpgradeProposalV2,
      enumOffset: UPGRADE_PROPOSAL_V2_OFFSETS.state,
      boolOffset: 14,
      reservedOffset: UPGRADE_PROPOSAL_V2_OFFSETS.reserved,
    },
    {
      name: "buffer_verification_v1",
      decode: deserializeBufferVerificationV1,
      enumOffset: BUFFER_VERIFICATION_V1_OFFSETS.status,
      boolOffset: 10,
      reservedOffset: BUFFER_VERIFICATION_V1_OFFSETS.reserved,
    },
    {
      name: "programdata_verification_v1",
      decode: deserializeProgramDataVerificationV1,
      enumOffset: PROGRAMDATA_VERIFICATION_V1_OFFSETS.status,
      boolOffset: PROGRAMDATA_VERIFICATION_V1_OFFSETS.zeroTailVerified,
      reservedOffset: PROGRAMDATA_VERIFICATION_V1_OFFSETS.reserved,
    },
    {
      name: "state_checkpoint_v1",
      decode: deserializeStateCheckpointV1,
      enumOffset: STATE_CHECKPOINT_V1_OFFSETS.phase,
      boolOffset: STATE_CHECKPOINT_V1_OFFSETS.accepted,
      reservedOffset: STATE_CHECKPOINT_V1_OFFSETS.reserved,
    },
    {
      name: "council_rotation_proposal_v1",
      decode: deserializeCouncilRotationProposalV1,
      enumOffset: COUNCIL_ROTATION_V1_OFFSETS.state,
      boolOffset: 10,
      reservedOffset: COUNCIL_ROTATION_V1_OFFSETS.reserved,
    },
    {
      name: "emergency_freeze_resolution_v1",
      decode: deserializeEmergencyFreezeResolutionV1,
      enumOffset: EMERGENCY_RESOLUTION_V1_OFFSETS.state,
      boolOffset: 10,
      reservedOffset: EMERGENCY_RESOLUTION_V1_OFFSETS.reserved,
    },
    {
      name: "emergency_freeze_observation_v1",
      decode: deserializeEmergencyFreezeObservationV1,
      enumOffset: undefined,
      boolOffset: EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.finalized,
      reservedOffset: EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.reserved,
    },
    {
      name: "programdata_failure_observation_v1",
      decode: deserializeProgramDataFailureObservationV1,
      enumOffset: PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.mismatchClass,
      boolOffset: PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.programdataHeaderPresent,
      reservedOffset: PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.reserved,
    },
    {
      name: "checkpoint_attestation_v1",
      decode: deserializeCheckpointAttestationV1,
      enumOffset: CHECKPOINT_ATTESTATION_V1_OFFSETS.phase,
      boolOffset: 10,
      reservedOffset: CHECKPOINT_ATTESTATION_V1_OFFSETS.reserved,
    },
  ] as const;

  for (const entry of cases) {
    const encoded = Buffer.from(account(entry.name).encoded_hex, "hex");
    assert.throws(() => entry.decode(encoded.subarray(0, encoded.length - 1)), /must be/);
    assert.throws(() => entry.decode(Buffer.concat([encoded, Buffer.alloc(1)])), /must be/);
    if (entry.enumOffset !== undefined) {
      const unknownEnum = Buffer.from(encoded);
      unknownEnum[entry.enumOffset] = 0xff;
      assert.throws(() => entry.decode(unknownEnum), /unknown/);
    }
    const invalidBool = Buffer.from(encoded);
    invalidBool[entry.boolOffset] = 2;
    assert.throws(() => entry.decode(invalidBool), /canonical boolean/);
    const nonzeroReserved = Buffer.from(encoded);
    nonzeroReserved[entry.reservedOffset] = 1;
    assert.throws(() => entry.decode(nonzeroReserved), /must be zero/);
  }

  const unknownResolutionKind = Buffer.from(
    account("emergency_freeze_resolution_v1").encoded_hex,
    "hex",
  );
  unknownResolutionKind[EMERGENCY_RESOLUTION_V1_OFFSETS.resolutionKind] = 1;
  assert.throws(
    () => deserializeEmergencyFreezeResolutionV1(unknownResolutionKind),
    /unknown EmergencyFreezeResolutionKindV1/,
  );

  const freezeObservation = Buffer.from(
    account("emergency_freeze_observation_v1").encoded_hex,
    "hex",
  );
  assert.throws(
    () =>
      deserializeEmergencyFreezeObservationV1(
        freezeObservation.subarray(0, freezeObservation.length - 1),
      ),
    /must be/,
  );
  const freezeTrailing = Buffer.concat([freezeObservation, Buffer.alloc(1)]);
  assert.throws(() => deserializeEmergencyFreezeObservationV1(freezeTrailing), /must be/);
  const freezeReserved = Buffer.from(freezeObservation);
  freezeReserved[EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.reserved] = 1;
  assert.throws(
    () => deserializeEmergencyFreezeObservationV1(freezeReserved),
    /must be zero/,
  );
  freezeObservation[EMERGENCY_FREEZE_OBSERVATION_V1_OFFSETS.finalized] = 2;
  assert.throws(
    () => deserializeEmergencyFreezeObservationV1(freezeObservation),
    /canonical boolean/,
  );
  const failureExecutable = Buffer.from(
    account("programdata_failure_observation_v1").encoded_hex,
    "hex",
  );
  failureExecutable[
    PROGRAMDATA_FAILURE_OBSERVATION_V1_OFFSETS.actualProgramdataExecutable
  ] = 2;
  assert.throws(
    () => deserializeProgramDataFailureObservationV1(failureExecutable),
    /canonical boolean/,
  );

  for (const [name, decode] of [
    ["emergency_freeze_observation_v1", deserializeEmergencyFreezeObservationV1],
    ["programdata_failure_observation_v1", deserializeProgramDataFailureObservationV1],
    ["checkpoint_attestation_v1", deserializeCheckpointAttestationV1],
  ] as const) {
    const badDiscriminator = Buffer.from(account(name).encoded_hex, "hex");
    badDiscriminator[0]! ^= 1;
    assert.throws(() => decode(badDiscriminator), /invalid .* discriminator/);
    const badVersion = Buffer.from(account(name).encoded_hex, "hex");
    badVersion[8] = 2;
    assert.throws(() => decode(badVersion), /unsupported .* version/);
  }
});

test("all seven Release 1 digest builders match fixture material and exclusion boundaries", () => {
  const proposal = syntheticUpgradeProposalV2();
  const checkpoint = syntheticStateCheckpointV1();
  const rotation = syntheticCouncilRotationProposalV1();
  const resolution = syntheticEmergencyFreezeResolutionV1();
  const freezeObservation = syntheticEmergencyFreezeObservationV1();
  const failureObservation = syntheticProgramDataFailureObservationV1();
  const checkpointAttestation = syntheticCheckpointAttestationV1();
  const checks = [
    {
      fixtureName: "upgrade_proposal_v2",
      domain: PROPOSAL_DIGEST_DOMAIN_V2,
      material: canonicalProposalDigestMaterialV2(proposal),
      digest: proposalDigestV2(proposal),
    },
    {
      fixtureName: "state_checkpoint_v1",
      domain: Buffer.from("AMOEBA_STATE_CHECKPOINT_V1", "ascii"),
      material: canonicalStateCheckpointDigestMaterialV1(checkpoint),
      digest: stateCheckpointDigestV1(checkpoint),
    },
    {
      fixtureName: "council_rotation_proposal_v1",
      domain: Buffer.from("AMOEBA_COUNCIL_ROTATION_V1", "ascii"),
      material: canonicalCouncilRotationDigestMaterialV1(rotation),
      digest: councilRotationDigestV1(rotation),
    },
    {
      fixtureName: "emergency_freeze_resolution_v1",
      domain: Buffer.from("AMOEBA_EMERGENCY_RESOLUTION_V1", "ascii"),
      material: canonicalEmergencyResolutionDigestMaterialV1(resolution),
      digest: emergencyResolutionDigestV1(resolution),
    },
    {
      fixtureName: "emergency_freeze_observation_v1",
      domain: Buffer.from("AMOEBA_EMERGENCY_FREEZE_OBSERVATION_V1", "ascii"),
      material: canonicalEmergencyFreezeObservationDigestMaterialV1(freezeObservation),
      digest: emergencyFreezeObservationDigestV1(freezeObservation),
    },
    {
      fixtureName: "programdata_failure_observation_v1",
      domain: Buffer.from("AMOEBA_PROGRAMDATA_FAILURE_OBSERVATION_V1", "ascii"),
      material: canonicalProgramDataFailureObservationDigestMaterialV1(failureObservation),
      digest: programDataFailureObservationDigestV1(failureObservation),
    },
    {
      fixtureName: "checkpoint_attestation_v1",
      domain: CHECKPOINT_ATTESTATION_DIGEST_DOMAIN_V1,
      material: canonicalCheckpointAttestationDigestMaterialV1(checkpointAttestation),
      digest: checkpointAttestationDigestV1(checkpointAttestation),
    },
  ];
  for (const check of checks) {
    const expected = account(check.fixtureName).digest;
    assert.ok(expected);
    assert.equal(check.domain.toString("ascii"), expected.domain_ascii);
    assert.equal(check.material.length, expected.material_length);
    assert.equal(check.domain.length + check.material.length, expected.preimage_length);
    assert.equal(check.material.toString("hex"), expected.material_hex);
    assert.equal(check.digest.toString("hex"), expected.sha256_hex);
  }
  assert.equal(PROPOSAL_DIGEST_MATERIAL_LEN_V2, 1_416);
  assert.equal(PROPOSAL_DIGEST_PREIMAGE_LEN_V2, 1_442);
  assert.equal(STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1, 573);
  assert.equal(STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1.length, 30);
  assert.equal(STATE_CHECKPOINT_HARD_ROOT_MATERIAL_LEN_V1, 176);
  assert.equal(STATE_CHECKPOINT_HARD_ROOT_PREIMAGE_LEN_V1, 206);
  assert.equal(COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1, 240);
  assert.equal(EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1, 442);
  assert.equal(EMERGENCY_FREEZE_OBSERVATION_DIGEST_MATERIAL_LEN_V1, 450);
  assert.equal(PROGRAMDATA_FAILURE_OBSERVATION_DIGEST_MATERIAL_LEN_V1, 444);
  assert.equal(CHECKPOINT_ATTESTATION_DIGEST_MATERIAL_LEN_V1, 314);
  validateProposalDigestV2(proposal);
  validateStateCheckpointDigestV1(checkpoint);
  validateStateCheckpointHardCombinedRootV1(checkpoint);
  validateEmergencyFreezeObservationDigestV1(freezeObservation);
  validateProgramDataFailureObservationDigestV1(failureObservation);
  validateCheckpointAttestationDigestV1(checkpointAttestation);

  const proposalBaseline = canonicalProposalDigestMaterialV2(proposal);
  const mutableProposal = {
    ...proposal,
    state: ProposalStateV2.Completed,
    freezeGateEpoch: 10n,
    firstApprovalSlot: 1n,
    terminalSlot: 999n,
    councilApprovalBitset: 7,
    councilApprovalCount: 3,
    proposalDigest: Buffer.alloc(32, 99),
  };
  assert.deepEqual(canonicalProposalDigestMaterialV2(mutableProposal), proposalBaseline);
  const immutableProposal = {
    ...proposal,
    artifactChunkMerkleRoot: Buffer.alloc(32, 99),
  };
  assert.notDeepEqual(canonicalProposalDigestMaterialV2(immutableProposal), proposalBaseline);

  const checkpointBaseline = canonicalStateCheckpointDigestMaterialV1(checkpoint);
  const hardRootMaterial = canonicalStateCheckpointHardRootMaterialV1(checkpoint);
  assert.equal(
    STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1.toString("ascii"),
    fixture.checkpoint_hard_combined_root.domain_ascii,
  );
  assert.equal(hardRootMaterial.length, fixture.checkpoint_hard_combined_root.material_length);
  assert.equal(
    STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1.length + hardRootMaterial.length,
    fixture.checkpoint_hard_combined_root.preimage_length,
  );
  assert.equal(
    hardRootMaterial.toString("hex"),
    fixture.checkpoint_hard_combined_root.material_hex,
  );
  assert.equal(
    stateCheckpointHardCombinedRootV1(checkpoint).toString("hex"),
    fixture.checkpoint_hard_combined_root.sha256_hex,
  );
  const mutableCheckpoint = {
    ...checkpoint,
    approvalCouncilVersion: 3n,
    approvalCouncilHash: Buffer.alloc(32, 99),
    approvalBitset: 31,
    approvalCount: 5,
    finalizedSlot: 92n,
  };
  assert.deepEqual(
    canonicalStateCheckpointDigestMaterialV1(mutableCheckpoint),
    checkpointBaseline,
  );
  assert.notDeepEqual(
    canonicalStateCheckpointDigestMaterialV1({
      ...checkpoint,
      hardCombinedRoot: Buffer.alloc(32, 99),
    }),
    checkpointBaseline,
  );
  for (const changed of [
    { ...checkpoint, schemaIdentifier: Buffer.alloc(32, 91) },
    { ...checkpoint, programOwnedStateRoot: Buffer.alloc(32, 92) },
    { ...checkpoint, programOwnedStateCount: checkpoint.programOwnedStateCount + 1n },
    { ...checkpoint, logicalCompressedStateRoot: Buffer.alloc(32, 93) },
    {
      ...checkpoint,
      logicalCompressedStateCount: checkpoint.logicalCompressedStateCount + 1n,
    },
    { ...checkpoint, semanticCustodyAccountingRoot: Buffer.alloc(32, 94) },
    { ...checkpoint, externalMetadataObservationRoot: Buffer.alloc(32, 95) },
  ]) {
    assert.notDeepEqual(stateCheckpointHardCombinedRootV1(changed), checkpoint.hardCombinedRoot);
    assert.throws(
      () => validateStateCheckpointHardCombinedRootV1(changed),
      /hard combined root mismatch/,
    );
  }

  const rotationBaseline = canonicalCouncilRotationDigestMaterialV1(rotation);
  assert.deepEqual(
    canonicalCouncilRotationDigestMaterialV1({
      ...rotation,
      state: CouncilRotationStateV1.Activated,
      activatedSlot: 121n,
    }),
    rotationBaseline,
  );
  const resolutionBaseline = canonicalEmergencyResolutionDigestMaterialV1(resolution);
  assert.deepEqual(
    canonicalEmergencyResolutionDigestMaterialV1({
      ...resolution,
      state: EmergencyFreezeResolutionStateV1.Executed,
      executedSlot: 171n,
    }),
    resolutionBaseline,
  );
  assert.notDeepEqual(
    canonicalEmergencyFreezeObservationDigestMaterialV1({
      ...freezeObservation,
      rawProgramdataSha256: Buffer.alloc(32, 99),
    }),
    canonicalEmergencyFreezeObservationDigestMaterialV1(freezeObservation),
  );
  assert.notDeepEqual(
    canonicalProgramDataFailureObservationDigestMaterialV1({
      ...failureObservation,
      actualLeafHash: Buffer.alloc(32, 99),
    }),
    canonicalProgramDataFailureObservationDigestMaterialV1(failureObservation),
  );
  for (const changed of [
    { ...failureObservation, actualOwner: syntheticRelease1Key(98) },
    { ...failureObservation, actualExecutable: true },
    { ...failureObservation, actualDataLength: failureObservation.actualDataLength + 1n },
  ]) {
    assert.notDeepEqual(
      canonicalProgramDataFailureObservationDigestMaterialV1(changed),
      canonicalProgramDataFailureObservationDigestMaterialV1(failureObservation),
    );
  }
  assert.notDeepEqual(
    canonicalCheckpointAttestationDigestMaterialV1({
      ...checkpointAttestation,
      checkpointDigest: Buffer.alloc(32, 99),
    }),
    canonicalCheckpointAttestationDigestMaterialV1(checkpointAttestation),
  );
});

test("Merkle first, middle, final-partial, and padding vectors match and verify", () => {
  assert.equal(ARTIFACT_MERKLE_SCHEME_MATERIAL_V1.length, 149);
  assert.equal(
    createHash("sha256").update(ARTIFACT_MERKLE_SCHEME_MATERIAL_V1).digest("hex"),
    ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
  );
  assert.equal(
    fixture.merkle_scheme.scheme_material_hex,
    ARTIFACT_MERKLE_SCHEME_MATERIAL_V1.toString("hex"),
  );
  assert.equal(
    fixture.merkle_scheme.scheme_id_hex,
    ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
  );
  assert.equal(fixture.merkle_scheme.leaf_domain_ascii, "AMOEBA_ARTIFACT_CHUNK_V1");
  assert.equal(fixture.merkle_scheme.node_domain_ascii, "AMOEBA_ARTIFACT_NODE_V1");
  assert.equal(fixture.merkle_scheme.empty_domain_ascii, "AMOEBA_ARTIFACT_EMPTY_V1");
  const artifact = syntheticArtifact(fixture.merkle.artifact_generator.artifact_length);
  const root = artifactMerkleRoot(artifact);
  assert.equal(root.toString("hex"), fixture.merkle.root_sha256_hex);
  assert.equal(artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1), 3);

  for (const vector of fixture.merkle.chunks) {
    const start = vector.index * RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
    const end = Math.min(start + RELEASE1_ARTIFACT_CHUNK_SIZE_V1, artifact.length);
    const chunk = artifact.subarray(start, end);
    const proof = artifactMerkleProof(artifact, vector.index);
    assert.equal(chunk.length, vector.actual_length);
    assert.equal(
      artifactChunkLeafHash(vector.index, chunk).toString("hex"),
      vector.leaf_sha256_hex,
    );
    assert.deepEqual(
      proof.map((entry) => entry.toString("hex")),
      vector.proof_hex,
    );
    assert.equal(
      verifyArtifactChunkProof(
        root,
        artifact.length,
        RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
        vector.index,
        chunk,
        proof,
      ),
      true,
    );
  }

  const empty = artifactChunkEmptyHash(fixture.merkle.padding.padded_index);
  assert.equal(empty.toString("hex"), fixture.merkle.padding.empty_sha256_hex);
  const leaf0 = artifactChunkLeafHash(
    0,
    artifact.subarray(0, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
  );
  const leaf1 = artifactChunkLeafHash(
    1,
    artifact.subarray(
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2,
    ),
  );
  const leaf2 = artifactChunkLeafHash(
    2,
    artifact.subarray(RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2),
  );
  const manualRoot = artifactChunkNodeHash(
    artifactChunkNodeHash(leaf0, leaf1),
    artifactChunkNodeHash(leaf2, empty),
  );
  assert.equal(
    manualRoot.toString("hex"),
    fixture.merkle.padding.manual_root_sha256_hex,
  );
  assert.equal(manualRoot.toString("hex"), root.toString("hex"));

  const last = fixture.merkle.chunks[2]!;
  const lastChunk = artifact.subarray(RELEASE1_ARTIFACT_CHUNK_SIZE_V1 * 2);
  const proof = last.proof_hex.map((entry) => Buffer.from(entry, "hex"));
  const wrongRoot = Buffer.from(root);
  wrongRoot[0]! ^= 1;
  assert.equal(
    verifyArtifactChunkProof(
      wrongRoot,
      artifact.length,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      2,
      lastChunk,
      proof,
    ),
    false,
  );
  assert.equal(
    verifyArtifactChunkProof(
      root,
      artifact.length,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      2,
      lastChunk.subarray(0, lastChunk.length - 1),
      proof,
    ),
    false,
  );
});

test("three-chunk padding golden blocks complete verification", () => {
  const chunkSize = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
  const artifact = Buffer.concat([
    Buffer.alloc(chunkSize, 0x01),
    Buffer.alloc(chunkSize, 0x02),
    Buffer.alloc(7, 0x03),
  ]);
  const canonicalRoot = artifactMerkleRoot(artifact);
  assert.equal(
    canonicalRoot.toString("hex"),
    "5c25ae10679556cc57d6590fd44719c2a418ec3a58d6441bdefca444e0d596bd",
  );

  const leaf0 = artifactChunkLeafHash(0, artifact.subarray(0, chunkSize));
  const leaf1 = artifactChunkLeafHash(
    1,
    artifact.subarray(chunkSize, chunkSize * 2),
  );
  const leaf2 = artifactChunkLeafHash(2, artifact.subarray(chunkSize * 2));
  const arbitraryPadding = Buffer.alloc(32, 0xa5);
  const adversarialRoot = artifactChunkNodeHash(
    artifactChunkNodeHash(leaf0, leaf1),
    artifactChunkNodeHash(leaf2, arbitraryPadding),
  );
  assert.equal(
    adversarialRoot.toString("hex"),
    "b038867e7ff1557a45e02de6963f58483a1a722a2bde07d36a7da4b91869d98f",
  );

  const maliciousMixedSubtree = artifactChunkNodeHash(leaf2, arbitraryPadding);
  const adversarialOutcomes: boolean[] = [];
  for (let index = 0; index < 3; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, artifact.length);
    const canonicalProof = artifactMerkleProof(artifact, index).map((entry) =>
      Buffer.from(entry),
    );
    assert.equal(
      verifyArtifactChunkProof(
        canonicalRoot,
        artifact.length,
        chunkSize,
        index,
        artifact.subarray(start, end),
        canonicalProof,
      ),
      true,
    );

    if (index < 2) {
      // These proofs see an opaque sibling containing real chunk 2 and padded
      // leaf 3, so a single proof cannot locally decompose the padding.
      canonicalProof[1] = Buffer.from(maliciousMixedSubtree);
    } else {
      // The final real chunk exposes padded leaf 3 directly. All three chunks
      // must verify before finalization, so this rejection blocks the root.
      canonicalProof[0] = arbitraryPadding;
    }
    adversarialOutcomes.push(
      verifyArtifactChunkProof(
        adversarialRoot,
        artifact.length,
        chunkSize,
        index,
        artifact.subarray(start, end),
        canonicalProof,
      ),
    );
  }
  assert.deepEqual(adversarialOutcomes, [true, true, false]);
});

test("Merkle verification rejects arbitrary multi-leaf padding subtrees", () => {
  const chunkSize = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
  const artifact = syntheticArtifact(chunkSize * 4 + 17);
  const root = artifactMerkleRoot(artifact);
  const proof = artifactMerkleProof(artifact, 4).map((entry) => Buffer.from(entry));
  const finalChunk = artifact.subarray(chunkSize * 4);
  assert.equal(proof.length, 3);
  assert.equal(
    verifyArtifactChunkProof(root, artifact.length, chunkSize, 4, finalChunk, proof),
    true,
  );

  // Proof level 1 covers padded leaf indexes 6 and 7.  The verifier must
  // derive that whole subtree from the indexed empty-leaf rule.
  const arbitraryPaddingSubtree = Buffer.alloc(32, 0xa5);
  const node45 = artifactChunkNodeHash(
    artifactChunkLeafHash(4, finalChunk),
    proof[0]!,
  );
  const node47 = artifactChunkNodeHash(node45, arbitraryPaddingSubtree);
  const maliciousRoot = artifactChunkNodeHash(proof[2]!, node47);
  assert.equal(
    maliciousRoot.toString("hex"),
    "df84137f11277170a460c500de78125c12b00bf39826e897df7a21f015439259",
  );
  proof[1] = arbitraryPaddingSubtree;
  assert.equal(
    verifyArtifactChunkProof(
      maliciousRoot,
      artifact.length,
      chunkSize,
      4,
      finalChunk,
      proof,
    ),
    false,
  );

  // A 65-chunk artifact exercises the fixed maximum proof depth and a final
  // partial right half with padding sibling spans through 32 leaves.
  const maxDepthArtifact = syntheticArtifact(chunkSize * 64 + 17);
  const maxDepthRoot = artifactMerkleRoot(maxDepthArtifact);
  const maxDepthChunk = maxDepthArtifact.subarray(chunkSize * 64);
  const maxDepthProof = artifactMerkleProof(maxDepthArtifact, 64).map((entry) =>
    Buffer.from(entry),
  );
  assert.equal(maxDepthProof.length, MAX_ARTIFACT_PROOF_DEPTH_V1);
  assert.equal(
    verifyArtifactChunkProof(
      maxDepthRoot,
      maxDepthArtifact.length,
      chunkSize,
      64,
      maxDepthChunk,
      maxDepthProof,
    ),
    true,
  );

  maxDepthProof[5] = Buffer.from(arbitraryPaddingSubtree);
  let maliciousMaxDepthRoot = artifactChunkLeafHash(64, maxDepthChunk);
  let index = 64;
  for (const sibling of maxDepthProof) {
    maliciousMaxDepthRoot =
      (index & 1) === 0
        ? artifactChunkNodeHash(maliciousMaxDepthRoot, sibling)
        : artifactChunkNodeHash(sibling, maliciousMaxDepthRoot);
    index >>>= 1;
  }
  assert.equal(
    verifyArtifactChunkProof(
      maliciousMaxDepthRoot,
      maxDepthArtifact.length,
      chunkSize,
      64,
      maxDepthChunk,
      maxDepthProof,
    ),
    false,
  );
});

test("maximum artifact and fixed 64-byte bitmap leave every unused bit zero", () => {
  assert.equal(
    artifactChunkCount(MAX_ARTIFACT_BYTES_V1, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
    96,
  );
  assert.throws(() => artifactChunkCount(1, 8_192), /invalid Release 1/);
  const bitmap = completeVerificationBitmapV1(96);
  assert.equal(bitmap.length, 64);
  assert.ok(bitmap.subarray(0, 12).equals(Buffer.alloc(12, 0xff)));
  assert.ok(bitmap.subarray(12).equals(Buffer.alloc(52)));
  validateVerificationBitmapV1(bitmap, 96, 96);
  const bad = Buffer.from(bitmap);
  bad[63] = 0x80;
  assert.throws(() => validateVerificationBitmapV1(bad, 96, 97), /unused bits/);

  const buffer = syntheticBufferVerificationV1();
  const invalidBuffer = {
    ...buffer,
    verifiedChunkBitmap: Buffer.from(buffer.verifiedChunkBitmap),
    verifiedChunkCount: buffer.verifiedChunkCount + 1,
  };
  invalidBuffer.verifiedChunkBitmap[63] = 0x80;
  assert.throws(() => validateBufferVerificationV1(invalidBuffer), /unused bits/);

  const maximum = Buffer.alloc(MAX_ARTIFACT_BYTES_V1, 0x5a);
  assert.doesNotThrow(() => artifactChunkEmptyHash(127));
  assert.throws(() => artifactChunkEmptyHash(128), /padding index/);
  const maximumRoot = artifactMerkleRoot(maximum);
  const maximumProof = artifactMerkleProof(maximum, 95);
  assert.equal(maximumProof.length, 7);
  assert.equal(
    verifyArtifactChunkProof(
      maximumRoot,
      maximum.length,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      95,
      maximum.subarray(maximum.length - RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
      maximumProof,
    ),
    true,
  );
});

test("all new PDA domains and little-endian numeric seeds match the fixture", () => {
  const controller = new PublicKey(fixture.pda_inputs.controller_program);
  const target = new PublicKey(fixture.pda_inputs.target_program);
  const proposal = new PublicKey(fixture.pda_inputs.proposal);
  const checkpoint = new PublicKey(fixture.pda_inputs.checkpoint);
  expectPda(deriveUpgradeableProgramdataAddress(target), pda("target_programdata"));
  expectPda(deriveControllerConfigPda(controller, target), pda("controller_config"));
  expectPda(deriveAuthorityPda(controller, target), pda("authority"));
  expectPda(deriveGatePda(controller, target), pda("protocol_gate"));
  expectPda(derivePolicyPda(controller, target, 1n), pda("policy_v1"));
  expectPda(deriveCouncilPda(controller, target, 1n), pda("council_v1"));
  expectPda(deriveCouncilPda(controller, target, 2n), pda("council_v2"));
  expectPda(deriveProposalPda(controller, target, 7n), pda("proposal_v2"));
  expectPda(
    deriveBufferVerificationPdaV1(controller, proposal),
    pda("buffer_verification"),
  );
  expectPda(
    deriveProgramdataCheckPda(controller, proposal),
    pda("programdata_verification"),
  );
  expectPda(
    deriveRelease1CheckpointPda(controller, proposal, StateCheckpointPhaseV1.Prestate),
    pda("prestate_checkpoint"),
  );
  expectPda(
    deriveRelease1CheckpointPda(controller, proposal, StateCheckpointPhaseV1.Poststate),
    pda("poststate_checkpoint"),
  );
  expectPda(
    deriveEmergencyResolutionPda(
      controller,
      target,
      BigInt(fixture.pda_inputs.emergency_frozen_epoch),
    ),
    pda("emergency_resolution"),
  );
  expectPda(
    deriveEmergencyCheckpointPda(
      controller,
      target,
      BigInt(fixture.pda_inputs.emergency_frozen_epoch),
    ),
    pda("emergency_checkpoint"),
  );
  expectPda(
    deriveCouncilRotationPda(
      controller,
      target,
      BigInt(fixture.pda_inputs.candidate_council_version),
    ),
    pda("council_rotation"),
  );
  expectPda(
    deriveEmergencyFreezeObservationPda(
      controller,
      target,
      BigInt(fixture.pda_inputs.emergency_frozen_epoch),
    ),
    pda("emergency_freeze_observation"),
  );
  expectPda(
    deriveProgramDataFailureObservationPda(
      controller,
      proposal,
      BigInt(fixture.pda_inputs.failure_frozen_epoch),
    ),
    pda("programdata_failure_observation"),
  );
  expectPda(
    deriveCheckpointAttestationPda(
      controller,
      checkpoint,
      BigInt(fixture.pda_inputs.checkpoint_council_version),
      Number(fixture.pda_inputs.checkpoint_seat_index),
    ),
    pda("checkpoint_attestation"),
  );
  assert.notEqual(
    deriveEmergencyResolutionPda(controller, target, 7n)[0].toBase58(),
    deriveEmergencyResolutionPda(controller, target, 8n)[0].toBase58(),
  );
  assert.notEqual(
    deriveCouncilRotationPda(controller, target, 8n)[0].toBase58(),
    deriveCouncilRotationPda(controller, target, 0x0800_0000_0000_0000n)[0].toBase58(),
  );
  assert.deepEqual(pda("prestate_checkpoint").seed_inputs, [
    { encoding: "ascii", value: "ameba-upgrade-v1" },
    { encoding: "ascii", value: "checkpoint" },
    { encoding: "pubkey", value: fixture.pda_inputs.proposal },
    { encoding: "u8_decimal", value: "0" },
  ]);
  assert.deepEqual(pda("emergency_resolution").seed_inputs.at(-1), {
    encoding: "u64_le_decimal",
    value: fixture.pda_inputs.emergency_frozen_epoch,
  });
  const seatAddresses = Array.from({ length: 5 }, (_, seatIndex) =>
    deriveCheckpointAttestationPda(controller, checkpoint, 2n, seatIndex)[0].toBase58(),
  );
  assert.equal(new Set(seatAddresses).size, 5);
  assert.notEqual(
    deriveCheckpointAttestationPda(controller, checkpoint, 2n, 2)[0].toBase58(),
    deriveCheckpointAttestationPda(controller, checkpoint, 3n, 2)[0].toBase58(),
  );
  assert.throws(
    () => deriveCheckpointAttestationPda(controller, checkpoint, 2n, 5),
    /five council seats/,
  );
});

test("emergency resolution timing is pinned to the guardian freeze", () => {
  const resolution = syntheticEmergencyFreezeResolutionV1();
  validateEmergencyFreezeResolutionV1(resolution);
  assert.doesNotThrow(() =>
    validateEmergencyFreezeResolutionV1({
      ...resolution,
      creationSlot: resolution.notBeforeSlot,
    }),
  );
  for (const invalid of [
    { ...resolution, creationSlot: resolution.freezeSlot - 1n },
    { ...resolution, creationSlot: resolution.expirySlot },
    { ...resolution, notBeforeSlot: resolution.freezeSlot },
    { ...resolution, notBeforeSlot: resolution.expirySlot },
  ]) {
    assert.throws(
      () => validateEmergencyFreezeResolutionV1(invalid),
      /invalid EmergencyFreezeResolutionV1 commitment/,
    );
  }
});

test("council rotation candidate versions are monotonic and may skip occupied history", () => {
  const rotation = syntheticCouncilRotationProposalV1();
  assert.doesNotThrow(() =>
    serializeCouncilRotationProposalV1({
      ...rotation,
      candidateCouncilVersion: 9n,
      rotationDigest: councilRotationDigestV1({
        ...rotation,
        candidateCouncilVersion: 9n,
      }),
    }),
  );
  assert.throws(
    () =>
      serializeCouncilRotationProposalV1({
        ...rotation,
        candidateCouncilVersion: rotation.currentCouncilVersion,
      }),
    /invalid CouncilRotationProposalV1 commitment/,
  );
  assert.throws(
    () =>
      serializeCouncilRotationProposalV1({
        ...rotation,
        candidateCouncilVersion: rotation.currentCouncilVersion - 1n,
      }),
    /invalid CouncilRotationProposalV1 commitment/,
  );
});

test("V1 proposal fixture and digest ABI remain byte-for-byte immutable", () => {
  const v1Fixture = readFileSync(
    new URL("../../../fixtures/upgrade_governance_v1.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(v1Fixture).digest("hex"),
    fixture.v1_regression.fixture_sha256,
  );
  assert.equal(UPGRADE_PROPOSAL_LEN, fixture.v1_regression.proposal_length);
  assert.equal(PROPOSAL_DIGEST_DOMAIN_V1.toString("ascii"), "AMOEBA_UPGRADE_PROPOSAL_V1");
  assert.equal(
    PROPOSAL_DIGEST_DOMAIN_V1.toString("ascii"),
    fixture.v1_regression.proposal_digest_domain_ascii,
  );
  assert.equal(PROPOSAL_DIGEST_MATERIAL_LEN, 1_084);
  assert.equal(
    PROPOSAL_DIGEST_MATERIAL_LEN,
    fixture.v1_regression.proposal_digest_material_length,
  );
  assert.equal(
    PROPOSAL_DIGEST_DOMAIN_V1.length + PROPOSAL_DIGEST_MATERIAL_LEN,
    fixture.v1_regression.proposal_digest_preimage_length,
  );
  assert.equal(fixture.v1_regression.proposal_discriminator_ascii, "AGVPRP01");
  assert.equal(fixture.v1_regression.proposal_reserved_length, 142);
});
