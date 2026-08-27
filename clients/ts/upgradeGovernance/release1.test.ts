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
  COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1,
  COUNCIL_ROTATION_PROPOSAL_V1_LEN,
  COUNCIL_ROTATION_V1_OFFSETS,
  CouncilRotationStateV1,
  EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
  EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1,
  EMERGENCY_RESOLUTION_V1_OFFSETS,
  EmergencyFreezeResolutionStateV1,
  PROGRAMDATA_VERIFICATION_V1_LEN,
  PROGRAMDATA_VERIFICATION_V1_OFFSETS,
  PROPOSAL_DIGEST_DOMAIN_V2,
  PROPOSAL_DIGEST_MATERIAL_LEN_V2,
  PROPOSAL_DIGEST_PREIMAGE_LEN_V2,
  ProposalStateV2,
  STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1,
  STATE_CHECKPOINT_V1_LEN,
  STATE_CHECKPOINT_V1_OFFSETS,
  StateCheckpointPhaseV1,
  UPGRADE_PROPOSAL_V2_LEN,
  UPGRADE_PROPOSAL_V2_OFFSETS,
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
  deserializeBufferVerificationV1,
  deserializeCouncilRotationProposalV1,
  deserializeEmergencyFreezeResolutionV1,
  deserializeProgramDataVerificationV1,
  deserializeStateCheckpointV1,
  deserializeUpgradeProposalV2,
  emergencyResolutionDigestV1,
  proposalDigestV2,
  serializeBufferVerificationV1,
  serializeCouncilRotationProposalV1,
  serializeEmergencyFreezeResolutionV1,
  serializeProgramDataVerificationV1,
  serializeStateCheckpointV1,
  serializeUpgradeProposalV2,
  stateCheckpointDigestV1,
  validateBufferVerificationV1,
  validateEmergencyFreezeResolutionV1,
  validateProposalDigestV2,
  validateStateCheckpointDigestV1,
} from "./release1.js";
import {
  syntheticArtifact,
  syntheticBufferVerificationV1,
  syntheticCouncilRotationProposalV1,
  syntheticEmergencyFreezeResolutionV1,
  syntheticProgramDataVerificationV1,
  syntheticRelease1Key,
  syntheticStateCheckpointV1,
  syntheticUpgradeProposalV2,
} from "./release1SyntheticVector.js";
import {
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
  selected_chunk_size: number;
  verification_bitmap_bytes: number;
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
    frozen_epoch: string;
    candidate_council_version: string;
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
  assert.equal(EMERGENCY_FREEZE_RESOLUTION_V1_LEN, 512);
  assert.equal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 16_384);
  assert.equal(VERIFICATION_BITMAP_BYTES_V1, 64);
  assert.equal(MAX_ARTIFACT_CHUNKS_V1, 512);
  assert.equal(MAX_SELECTED_ARTIFACT_CHUNKS_V1, 128);
  assert.equal(MAX_ARTIFACT_PROOF_DEPTH_V1, 7);
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
  assert.equal(EMERGENCY_RESOLUTION_V1_OFFSETS.resolutionDigest, 377);
  assert.equal(fixture.selected_chunk_size, 16_384);
  assert.equal(fixture.verification_bitmap_bytes, 64);
});

test("all six account codecs roundtrip and match the shared Rust-shaped fixture", () => {
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
  ] as const;

  for (const entry of cases) {
    const encoded = Buffer.from(account(entry.name).encoded_hex, "hex");
    assert.throws(() => entry.decode(encoded.subarray(0, encoded.length - 1)), /must be/);
    assert.throws(() => entry.decode(Buffer.concat([encoded, Buffer.alloc(1)])), /must be/);
    const unknownEnum = Buffer.from(encoded);
    unknownEnum[entry.enumOffset] = 0xff;
    assert.throws(() => entry.decode(unknownEnum), /unknown/);
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
});

test("all four Release 1 digest builders match fixture material and exclusion boundaries", () => {
  const proposal = syntheticUpgradeProposalV2();
  const checkpoint = syntheticStateCheckpointV1();
  const rotation = syntheticCouncilRotationProposalV1();
  const resolution = syntheticEmergencyFreezeResolutionV1();
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
  assert.equal(PROPOSAL_DIGEST_MATERIAL_LEN_V2, 1_424);
  assert.equal(PROPOSAL_DIGEST_PREIMAGE_LEN_V2, 1_450);
  assert.equal(STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1, 573);
  assert.equal(COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1, 240);
  assert.equal(EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1, 323);
  validateProposalDigestV2(proposal);
  validateStateCheckpointDigestV1(checkpoint);

  const proposalBaseline = canonicalProposalDigestMaterialV2(proposal);
  const mutableProposal = {
    ...proposal,
    state: ProposalStateV2.Completed,
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
  const mutableCheckpoint = {
    ...checkpoint,
    approvalCouncilVersion: 3n,
    approvalCouncilHash: Buffer.alloc(32, 99),
    approvalBitset: 31,
    approvalCount: 5,
    acceptedSlot: 92n,
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

test("maximum artifact and fixed 64-byte bitmap leave every unused bit zero", () => {
  assert.equal(
    artifactChunkCount(MAX_ARTIFACT_BYTES_V1, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
    128,
  );
  assert.throws(() => artifactChunkCount(1, 8_192), /invalid Release 1/);
  const bitmap = completeVerificationBitmapV1(128);
  assert.equal(bitmap.length, 64);
  assert.ok(bitmap.subarray(0, 16).equals(Buffer.alloc(16, 0xff)));
  assert.ok(bitmap.subarray(16).equals(Buffer.alloc(48)));
  validateVerificationBitmapV1(bitmap, 128, 128);
  const bad = Buffer.from(bitmap);
  bad[63] = 0x80;
  assert.throws(() => validateVerificationBitmapV1(bad, 128, 129), /unused bits/);

  const buffer = syntheticBufferVerificationV1();
  const invalidBuffer = {
    ...buffer,
    verifiedChunkBitmap: Buffer.from(buffer.verifiedChunkBitmap),
    verifiedChunkCount: buffer.verifiedChunkCount + 1,
  };
  invalidBuffer.verifiedChunkBitmap[63] = 0x80;
  assert.throws(() => validateBufferVerificationV1(invalidBuffer), /unused bits/);

  const maximum = Buffer.alloc(MAX_ARTIFACT_BYTES_V1, 0x5a);
  const maximumRoot = artifactMerkleRoot(maximum);
  const maximumProof = artifactMerkleProof(maximum, 127);
  assert.equal(maximumProof.length, 7);
  assert.equal(
    verifyArtifactChunkProof(
      maximumRoot,
      maximum.length,
      RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      127,
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
      BigInt(fixture.pda_inputs.frozen_epoch),
    ),
    pda("emergency_resolution"),
  );
  expectPda(
    deriveEmergencyCheckpointPda(
      controller,
      target,
      BigInt(fixture.pda_inputs.frozen_epoch),
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
    value: fixture.pda_inputs.frozen_epoch,
  });
});

test("emergency resolution timing requires a strict post-creation delay", () => {
  const resolution = syntheticEmergencyFreezeResolutionV1();
  validateEmergencyFreezeResolutionV1(resolution);
  assert.throws(
    () =>
      validateEmergencyFreezeResolutionV1({
        ...resolution,
        notBeforeSlot: resolution.creationSlot,
      }),
    /invalid EmergencyFreezeResolutionV1 commitment/,
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
