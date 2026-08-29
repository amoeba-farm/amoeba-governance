import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
  MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1,
  MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1,
  MIN_PROGRAMDATA_ACCOUNT_BYTES_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_DOMAIN_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_32_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_64_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_128_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_CANDIDATES_V1,
  PROGRAMDATA_OBSERVATION_EMPTY_DOMAIN_V1,
  PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_MATERIAL_V1,
  PROGRAMDATA_OBSERVATION_NODE_DOMAIN_V1,
  appendProgramDataObservationChunkV1,
  createProgramDataObservationFrontierV1,
  finalizeProgramDataObservationFrontierV1,
  programDataObservationChunkCountV1,
  programDataObservationChunkLeafHashV1,
  programDataObservationEmptyHashV1,
  programDataObservationGeometryV1,
  programDataObservationMerkleRootV1,
  programDataObservationNodeHashV1,
  programDataRawSha256ReceiptV1,
  type ProgramDataObservationFrontierV1,
} from "./programDataObservationMerkleV1.js";

const subject = Buffer.from(Array.from({ length: 32 }, (_, index) => index));

function deterministicBytes(length: number, salt = 3): Buffer {
  return Buffer.from(
    Array.from({ length }, (_, index) => (index * 17 + salt) & 0xff),
  );
}

function independentTreeRoot(
  raw: Buffer,
  subjectDigest: Buffer,
  chunkSize: number,
): Buffer {
  const geometry = programDataObservationGeometryV1(raw.length, chunkSize);
  let level: Buffer[] = [];
  for (let index = 0; index < geometry.chunkCount; index += 1) {
    const start = index * chunkSize;
    level.push(
      programDataObservationChunkLeafHashV1(
        subjectDigest,
        index,
        chunkSize,
        raw.subarray(start, Math.min(start + chunkSize, raw.length)),
      ),
    );
  }
  for (let index = geometry.chunkCount; index < geometry.paddedChunkCount; index += 1) {
    level.push(programDataObservationEmptyHashV1(subjectDigest, index));
  }
  let parentLevel = 1;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        programDataObservationNodeHashV1(
          parentLevel,
          level[index]!,
          level[index + 1]!,
        ),
      );
    }
    level = next;
    parentLevel += 1;
  }
  return level[0]!;
}

function appendAll(
  raw: Buffer,
  subjectDigest: Buffer,
  chunkSize: number,
): ProgramDataObservationFrontierV1 {
  const geometry = programDataObservationGeometryV1(raw.length, chunkSize);
  let state = createProgramDataObservationFrontierV1();
  for (let index = 0; index < geometry.chunkCount; index += 1) {
    const start = index * chunkSize;
    state = appendProgramDataObservationChunkV1(
      state,
      subjectDigest,
      raw.length,
      chunkSize,
      index,
      raw.subarray(start, Math.min(start + chunkSize, raw.length)),
    );
  }
  return state;
}

test("all candidate sizes cover the minimum and runtime maximum geometry", () => {
  assert.equal(
    createHash("sha256")
      .update(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_MATERIAL_V1)
      .digest("hex"),
    PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1.toString("hex"),
  );
  const expectedMax = new Map<number, readonly [number, number, number]>([
    [PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1, [640, 1024, 10]],
    [PROGRAMDATA_OBSERVATION_CHUNK_SIZE_32_KIB_V1, [320, 512, 9]],
    [PROGRAMDATA_OBSERVATION_CHUNK_SIZE_64_KIB_V1, [160, 256, 8]],
    [PROGRAMDATA_OBSERVATION_CHUNK_SIZE_128_KIB_V1, [80, 128, 7]],
  ]);
  assert.equal(PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1, 11);
  assert.equal(MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1, 640);
  assert.equal(MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1, 10);
  for (const chunkSize of PROGRAMDATA_OBSERVATION_CHUNK_SIZE_CANDIDATES_V1) {
    assert.deepEqual(programDataObservationGeometryV1(MIN_PROGRAMDATA_ACCOUNT_BYTES_V1, chunkSize), {
      rawLength: MIN_PROGRAMDATA_ACCOUNT_BYTES_V1,
      chunkSize,
      chunkCount: 1,
      paddedChunkCount: 1,
      treeDepth: 0,
    });
    const maximum = programDataObservationGeometryV1(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1, chunkSize);
    assert.deepEqual(
      [maximum.chunkCount, maximum.paddedChunkCount, maximum.treeDepth],
      expectedMax.get(chunkSize),
    );
    assert.equal(
      programDataObservationChunkCountV1(BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1), chunkSize),
      maximum.chunkCount,
    );
  }
});

test("ordered frontier equals an independent full tree for partial and padded trees", () => {
  const lengths = [
    MIN_PROGRAMDATA_ACCOUNT_BYTES_V1,
    PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 + 37,
    PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 * 3,
    PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 * 4 + 19,
  ];
  for (const length of lengths) {
    const raw = deterministicBytes(length);
    for (const chunkSize of PROGRAMDATA_OBSERVATION_CHUNK_SIZE_CANDIDATES_V1) {
      const state = appendAll(raw, subject, chunkSize);
      const finalized = finalizeProgramDataObservationFrontierV1(
        state,
        subject,
        raw.length,
        chunkSize,
      );
      assert.deepEqual(finalized, independentTreeRoot(raw, subject, chunkSize));
      assert.deepEqual(
        programDataObservationMerkleRootV1(raw, subject, chunkSize),
        finalized,
      );
    }
  }
});

test("maximum 16 KiB geometry reaches the depth-ten root without a bitmap", () => {
  const chunkSize = PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1;
  const exactChunk = Buffer.alloc(chunkSize, 0x3d);
  let state = createProgramDataObservationFrontierV1();
  for (let index = 0; index < MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1; index += 1) {
    state = appendProgramDataObservationChunkV1(
      state,
      subject,
      MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
      chunkSize,
      index,
      exactChunk,
    );
  }
  assert.equal(state.nextIndex, 640);
  assert.equal(state.frontierMask, 640);
  const root = finalizeProgramDataObservationFrontierV1(
    state,
    subject,
    MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
    chunkSize,
  );
  assert.equal(root.length, 32);
  assert.notDeepEqual(root, Buffer.alloc(32));
});

test("partial and padded golden roots are stable", () => {
  const partial = deterministicBytes(PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 + 37);
  const padded = deterministicBytes(PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 * 3, 11);
  assert.equal(
    programDataObservationMerkleRootV1(
      partial,
      subject,
      PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
    ).toString("hex"),
    "21d6a5fc9bb40303c13cb4c7f9c7d8cde9c6c64108afbadc75ac5602acd84a60",
  );
  assert.equal(
    programDataObservationMerkleRootV1(
      padded,
      subject,
      PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
    ).toString("hex"),
    "1a9a553ee1ef86be2f7f9610736b6248fdd678b49b4efb0f7256857c7b167c24",
  );
  assert.equal(
    programDataRawSha256ReceiptV1(partial).toString("hex"),
    "dd1dd97c58b38010c1646a30bc55ef5825b550d0f0790cd3dfb6a1481ffb04b8",
  );
  assert.deepEqual(
    programDataRawSha256ReceiptV1(partial),
    createHash("sha256").update(partial).digest(),
  );
});

test("append is ordered, exact-length, and duplicate safe", () => {
  const chunkSize = PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1;
  const raw = deterministicBytes(chunkSize + 37);
  const initial = createProgramDataObservationFrontierV1();
  assert.throws(
    () => appendProgramDataObservationChunkV1(initial, subject, raw.length, chunkSize, 1, raw.subarray(chunkSize)),
    /ordered nextIndex 0/u,
  );
  const first = appendProgramDataObservationChunkV1(
    initial,
    subject,
    raw.length,
    chunkSize,
    0,
    raw.subarray(0, chunkSize),
  );
  assert.equal(initial.nextIndex, 0);
  assert.equal(first.nextIndex, 1);
  assert.throws(
    () => appendProgramDataObservationChunkV1(first, subject, raw.length, chunkSize, 0, raw.subarray(0, chunkSize)),
    /ordered nextIndex 1/u,
  );
  assert.throws(
    () => appendProgramDataObservationChunkV1(first, subject, raw.length, chunkSize, 1, raw.subarray(chunkSize, raw.length - 1)),
    /does not equal expected length 37/u,
  );
  assert.throws(
    () => finalizeProgramDataObservationFrontierV1(first, subject, raw.length, chunkSize),
    /before all 2 raw chunks/u,
  );
});

test("strict validation rejects malformed numeric, hash, and frontier inputs", () => {
  const chunkSize = PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1;
  for (const length of [44, MAX_PROGRAMDATA_ACCOUNT_BYTES_V1 + 1, 45.5, Number.NaN]) {
    assert.throws(() => programDataObservationGeometryV1(length, chunkSize), /rawLength/u);
  }
  for (const size of [0, 4 * 1024, 24 * 1024, 16.5 * 1024, Number.NaN]) {
    assert.throws(() => programDataObservationGeometryV1(45, size), /chunkSize/u);
  }
  assert.throws(
    () => programDataObservationChunkLeafHashV1(Buffer.alloc(31), 0, chunkSize, Buffer.of(1)),
    /32 bytes/u,
  );
  assert.throws(
    () => programDataObservationNodeHashV1(0, Buffer.alloc(32), Buffer.alloc(32)),
    /parentLevel/u,
  );
  assert.throws(
    () => programDataRawSha256ReceiptV1(Buffer.alloc(44)),
    /rawProgramData.length/u,
  );
  const malformed: ProgramDataObservationFrontierV1 = {
    frontier: createProgramDataObservationFrontierV1().frontier,
    frontierMask: 1,
    nextIndex: 0,
  };
  assert.throws(
    () => finalizeProgramDataObservationFrontierV1(malformed, subject, 45, chunkSize),
    /binary decomposition/u,
  );
});

test("domains, subject, index, length, node level, order, and padding are sensitive", () => {
  const exact = deterministicBytes(45);
  const otherSubject = Buffer.from(subject);
  otherSubject[0] ^= 1;
  const chunkSize = PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1;
  const leaf = programDataObservationChunkLeafHashV1(subject, 0, chunkSize, exact);
  assert.notDeepEqual(leaf, programDataObservationChunkLeafHashV1(otherSubject, 0, chunkSize, exact));
  assert.notDeepEqual(leaf, programDataObservationChunkLeafHashV1(subject, 1, chunkSize, exact));
  assert.notDeepEqual(leaf, programDataObservationChunkLeafHashV1(subject, 0, chunkSize, exact.subarray(0, 44)));
  const right = createHash("sha256").update("right").digest();
  assert.notDeepEqual(
    programDataObservationNodeHashV1(1, leaf, right),
    programDataObservationNodeHashV1(2, leaf, right),
  );
  assert.notDeepEqual(
    programDataObservationNodeHashV1(1, leaf, right),
    programDataObservationNodeHashV1(1, right, leaf),
  );
  assert.notDeepEqual(
    programDataObservationEmptyHashV1(subject, 3),
    programDataObservationEmptyHashV1(otherSubject, 3),
  );
  assert.notDeepEqual(
    programDataObservationEmptyHashV1(subject, 3),
    programDataObservationEmptyHashV1(subject, 4),
  );
  assert.notDeepEqual(PROGRAMDATA_OBSERVATION_CHUNK_DOMAIN_V1, PROGRAMDATA_OBSERVATION_NODE_DOMAIN_V1);
  assert.notDeepEqual(PROGRAMDATA_OBSERVATION_NODE_DOMAIN_V1, PROGRAMDATA_OBSERVATION_EMPTY_DOMAIN_V1);
});
