import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  ARTIFACT_CHUNK_SIZE_V3,
  CONTROLLER_RELEASE_V3,
  DEFAULT_TIMING_V3,
  MAX_ARTIFACT_BYTES_V3,
  MAX_ARTIFACT_CHUNKS_V3,
  artifactChunkCountV3,
  artifactMerkleProofV3,
  artifactMerkleRootV3,
  createV3,
  decodeProposalV3,
  deriveAuthorityV3,
  deriveConfigV3,
  deriveProgramdataV3,
  deriveProposalV3,
  encodeActionV3,
  extendControllerV3,
  extendTargetV3,
  proposalDigestV3,
  verifyChunkV3,
  type ActionV3,
  type ConfigV3,
  type ProposalV3,
} from "./governanceV3.js";
import {
  artifactMerkleProof,
  artifactMerkleRoot,
  verifyArtifactChunkProof,
} from "./artifactMerkleV1.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const program = key(31);
const config: ConfigV3 = {
  bump: deriveConfigV3(program)[1],
  controller: program,
  programdata: deriveProgramdataV3(program),
  authority: deriveAuthorityV3(program)[0],
  treasury: key(32),
  seats: [40, 41, 42, 43, 44].map(key),
  councilEpoch: 1n,
  timingVersion: 1n,
  timing: DEFAULT_TIMING_V3,
  nextId: 1n,
};
// Pinned from an independent Python implementation of the Release 1 scheme.
const PINNED: Array<[number, string]> = [
  [2_097_152, "209812d102a353ca780529085472fa3546bd104a5e60d965c35fced89027a854"],
  [2_097_151, "4d0aa1710a4fcaa3470683e3dae310c33019554fe52ca94ae61d8a00f5701a96"],
  [1_572_865, "01ab5fb8c5946f03f231b5113075d2fa1e702fb017068597b9fe5cfbd7646666"],
  [1_572_864, "e9e6f420426a7a29f7f6b5516d9425223989871d5be59c27ab228eb2e3cdad7b"],
];
const pattern = (length: number) => {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) out[i] = i % 251;
  return out;
};
function targetAction(artifactLength: bigint, capacity: bigint): ActionV3 {
  return {
    kind: "upgradeTarget",
    buffer: key(7),
    artifactLength,
    merkleRoot: Buffer.alloc(32, 2),
    deployedSlot: 9n,
    capacity,
    sourceCommitment: Buffer.alloc(32, 3),
    buildCommitment: Buffer.alloc(32, 4),
    target: key(8),
    gateEpoch: 1n,
  };
}
function proposal(action: ActionV3): ProposalV3 {
  const p: ProposalV3 = {
    bump: deriveProposalV3(program, 1n)[1],
    config: deriveConfigV3(program)[0],
    id: 1n,
    councilEpoch: 1n,
    timingVersion: 1n,
    timing: DEFAULT_TIMING_V3,
    created: 100n,
    reviewEnd: 1_512_100n,
    notBefore: 4_600n,
    expires: 2_592_100n,
    action,
    digest: Buffer.alloc(32),
    approvals: 0,
    approvalCount: 0,
    cancellations: 0,
    cancellationCount: 0,
    state: 0,
    verifiedChunks: Buffer.alloc(16),
    verifiedCount: 0,
    extensionSlot: 0n,
    extendedCapacity: 0n,
    executedSlot: 0n,
  };
  p.digest = proposalDigestV3(program, p);
  return p;
}
const u64 = (n: bigint) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(n);
  return out;
};
/** Raw 400-byte account: bitmap low bytes at 353..365, high at 393..397. */
function account(p: ProposalV3, low: Buffer, count: number, high: Buffer, reserved = Buffer.alloc(3)): Buffer {
  const countBytes = Buffer.alloc(4);
  countBytes.writeUInt32LE(count);
  return Buffer.concat([
    Buffer.from("AG3PRP01"),
    Buffer.from([1, p.bump, 1]),
    p.config.toBuffer(),
    ...[p.id, p.councilEpoch, p.timingVersion, p.timing.reviewSlots, p.timing.delaySlots,
      p.timing.expirySlots, p.created, p.reviewEnd, p.notBefore, p.expires].map(u64),
    encodeActionV3(p.action),
    p.digest,
    Buffer.from([0, 0, 0, 0, 0]),
    low,
    countBytes,
    u64(p.extensionSlot),
    u64(p.extendedCapacity),
    u64(p.executedSlot),
    high,
    reserved,
  ]);
}

test("V3 ceiling is 2 MiB of 16 KiB chunks with exact boundaries", () => {
  assert.equal(MAX_ARTIFACT_BYTES_V3, 2_097_152);
  assert.equal(MAX_ARTIFACT_CHUNKS_V3, 128);
  assert.equal(ARTIFACT_CHUNK_SIZE_V3, 16_384);
  for (const [length, chunks] of [[1, 1], [16_384, 1], [16_385, 2], [1_572_864, 96],
    [1_572_865, 97], [2_097_151, 128], [2_097_152, 128]] as const)
    assert.equal(artifactChunkCountV3(length), chunks, String(length));
  for (const length of [0, 2_097_153]) assert.throws(() => artifactChunkCountV3(length));
  for (const kind of ["upgradeTarget", "upgradeController"] as const) {
    const make = (artifactLength: bigint, capacity: bigint): ActionV3 =>
      kind === "upgradeTarget"
        ? targetAction(artifactLength, capacity)
        : {
            kind, buffer: key(7), artifactLength, artifactSha256: Buffer.alloc(32, 1),
            merkleRoot: Buffer.alloc(32, 2), deployedSlot: 9n, capacity,
            sourceCommitment: Buffer.alloc(32, 3), buildCommitment: Buffer.alloc(32, 4),
            controllerRelease: CONTROLLER_RELEASE_V3,
          };
    assert.equal(encodeActionV3(make(2_097_152n, 2_097_152n)).length, 193);
    assert.throws(() => encodeActionV3(make(2_097_153n, 2_097_152n)));
    // Third parties may grow ProgramData (up to 10 MiB) before activation.
    for (const capacity of [1_572_865n, 2_097_153n, 10_485_715n])
      assert.equal(encodeActionV3(make(2_097_152n, capacity)).length, 193);
  }
});

test("V3 Merkle root matches pinned vectors and the Release 1 implementation", () => {
  const full = pattern(2_097_152);
  for (const [length, expected] of PINNED)
    assert.equal(artifactMerkleRootV3(full.subarray(0, length)).toString("hex"), expected);
  for (const length of [1, 16_385, 1_000_000, 1_572_864]) {
    const data = full.subarray(0, length);
    assert(artifactMerkleRootV3(data).equals(artifactMerkleRoot(data)));
    const last = artifactChunkCountV3(length) - 1;
    assert.deepEqual(artifactMerkleProofV3(data, last), [...artifactMerkleProof(data, last)]);
  }
  assert.throws(() => artifactMerkleRoot(full.subarray(0, 1_572_865)));
  assert.throws(() => artifactMerkleRootV3(pattern(2_097_153)));
  // Proofs are always seven siblings above 64 chunks; each verifies against
  // the root using the same padding rules (checked with the V1 verifier on a
  // proof whose depth it supports).
  const data = full.subarray(0, 2_097_152);
  const root = artifactMerkleRootV3(data);
  for (const index of [0, 95, 96, 127]) {
    const proof = artifactMerkleProofV3(data, index);
    assert.equal(proof.length, 7);
    assert(proof.every((sibling) => sibling.length === 32));
  }
  assert.throws(() => artifactMerkleProofV3(data, 128));
  const small = full.subarray(0, 1_000_000);
  const smallRoot = artifactMerkleRootV3(small);
  const index = artifactChunkCountV3(small.length) - 1;
  assert(verifyArtifactChunkProof(smallRoot, small.length, 16_384, index,
    small.subarray(index * 16_384), artifactMerkleProofV3(small, index)));
  assert.equal(root.length, 32);
});

test("proposal bitmap spans 128 bits using four former reserved bytes", () => {
  const p = proposal(targetAction(2_097_152n, 2_097_152n));
  const where = deriveProposalV3(program, 1n)[0];
  const empty = account(p, Buffer.alloc(12), 0, Buffer.alloc(4));
  assert.equal(empty.length, 400);
  const decodedEmpty = decodeProposalV3(program, where, empty);
  assert.equal(decodedEmpty.verifiedChunks.length, 16);
  assert(decodedEmpty.verifiedChunks.equals(Buffer.alloc(16)));
  const full = account(p, Buffer.alloc(12, 0xff), 128, Buffer.alloc(4, 0xff));
  const decoded = decodeProposalV3(program, where, full);
  assert(decoded.verifiedChunks.equals(Buffer.alloc(16, 0xff)));
  assert.equal(decoded.verifiedCount, 128);
  for (let index = 0; index < 128; index += 1)
    assert.notEqual(decoded.verifiedChunks[index >> 3]! & (1 << (index & 7)), 0);
  // Count must match both halves; the last three reserved bytes stay zero.
  assert.throws(() => decodeProposalV3(program, where,
    account(p, Buffer.alloc(12, 0xff), 128, Buffer.from([0xff, 0xff, 0xff, 0x7f]))));
  for (let i = 0; i < 3; i += 1) {
    const reserved = Buffer.alloc(3);
    reserved[i] = 1;
    assert.throws(() => decodeProposalV3(program, where,
      account(p, Buffer.alloc(12, 0xff), 128, Buffer.alloc(4, 0xff), reserved)));
  }
  // More verified chunks than the artifact has is not a valid state.
  const small = proposal(targetAction(16_384n, 16_384n));
  assert.throws(() => decodeProposalV3(program, where,
    account(small, Buffer.from([3, ...Array(11).fill(0)]), 2, Buffer.alloc(4))));
  const ix = verifyChunkV3(program, decoded, 127, Array.from({ length: 7 }, () => Buffer.alloc(32, 9)));
  assert.equal(ix.data.readUInt32LE(33), 127);
  assert.throws(() => verifyChunkV3(program, decoded, 128, []));
});

test("create needs a covering snapshot; retired extension builders throw", () => {
  const smaller = targetAction(2_000_000n, 1_457_072n);
  assert.throws(() => createV3(config, key(50), config.seats[0]!, smaller), /extend ProgramData/);
  const covered = targetAction(2_000_000n, 2_000_000n);
  assert.equal(createV3(config, key(50), config.seats[0]!, covered).data[0], 1);
  // enable_extend_program_checked was cancelled; instructions 10/13 are
  // rejected on chain and the client no longer builds them.
  const p = proposal(smaller);
  assert.throws(() => extendTargetV3(config, p, key(50)), /checked extension is retired/);
  assert.throws(() => extendControllerV3(config, p, key(50)), /checked extension is retired/);
  const own = proposal({
    kind: "upgradeController", buffer: key(7), artifactLength: 300_000n,
    artifactSha256: Buffer.alloc(32, 1), merkleRoot: Buffer.alloc(32, 2), deployedSlot: 9n,
    capacity: 223_096n, sourceCommitment: Buffer.alloc(32, 3), buildCommitment: Buffer.alloc(32, 4),
    controllerRelease: CONTROLLER_RELEASE_V3,
  });
  // The release occupies the action's last eight body bytes (formerly zero).
  const wire = encodeActionV3(own.action);
  assert.equal(wire.readBigUInt64LE(185), CONTROLLER_RELEASE_V3);
  // Proposals for the deployed (pre-release) controller keep them zero.
  const legacy = encodeActionV3({ ...(own.action as Extract<ActionV3, { kind: "upgradeController" }>), controllerRelease: 0n });
  assert(legacy.subarray(185).equals(Buffer.alloc(8)));
  assert.throws(() => extendControllerV3(config, own, key(50)), /checked extension is retired/);
});
