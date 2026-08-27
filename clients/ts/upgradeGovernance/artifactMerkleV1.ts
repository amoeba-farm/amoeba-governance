import { createHash } from "node:crypto";

export const ARTIFACT_CHUNK_LEAF_DOMAIN_V1 = Buffer.from(
  "AMOEBA_ARTIFACT_CHUNK_V1",
  "ascii",
);
export const ARTIFACT_CHUNK_NODE_DOMAIN_V1 = Buffer.from(
  "AMOEBA_ARTIFACT_NODE_V1",
  "ascii",
);
export const ARTIFACT_CHUNK_EMPTY_DOMAIN_V1 = Buffer.from(
  "AMOEBA_ARTIFACT_EMPTY_V1",
  "ascii",
);
export const ARTIFACT_MERKLE_SCHEME_MATERIAL_V1 = Buffer.from(
  "AMOEBA_ARTIFACT_MERKLE_V1\0AMOEBA_ARTIFACT_CHUNK_V1\0AMOEBA_ARTIFACT_NODE_V1\0AMOEBA_ARTIFACT_EMPTY_V1\0U32LE_INDEX_U32LE_ACTUAL_LENGTH_NEXT_POWER_OF_TWO",
  "ascii",
);
export const ARTIFACT_MERKLE_SCHEME_ID = Buffer.from(
  "8a859639697974c16e2eb3743d260d303c11313c7d3c5c0ddcd0563f5d1a32a5",
  "hex",
);

export const ARTIFACT_CHUNK_SIZE_4_KIB = 4 * 1024;
export const ARTIFACT_CHUNK_SIZE_8_KIB = 8 * 1024;
export const ARTIFACT_CHUNK_SIZE_16_KIB = 16 * 1024;
export const BENCHMARK_ARTIFACT_CHUNK_SIZE_CANDIDATES_V1 = Object.freeze([
  ARTIFACT_CHUNK_SIZE_4_KIB,
  ARTIFACT_CHUNK_SIZE_8_KIB,
  ARTIFACT_CHUNK_SIZE_16_KIB,
] as const);
export const RELEASE1_ARTIFACT_CHUNK_SIZE_V1 = ARTIFACT_CHUNK_SIZE_16_KIB;
export const MAX_ARTIFACT_BYTES_V1 = 1_572_864;
// The bitmap width is frozen account ABI capacity. The Release 1 payload cap
// is lower, but shrinking this bound would silently change persisted layouts.
export const MAX_ARTIFACT_CHUNKS_V1 = 512;
export const MAX_SELECTED_ARTIFACT_CHUNKS_V1 =
  MAX_ARTIFACT_BYTES_V1 / RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
export const MAX_PADDED_ARTIFACT_CHUNKS_V1 = 128;
export const MAX_ARTIFACT_PROOF_DEPTH_V1 = 7;
export const VERIFICATION_BITMAP_BYTES_V1 = 64;

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function u32Le(value: number, field: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${field} must be a u32`);
  }
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function requireHash(value: Uint8Array, field: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new RangeError(`${field} must be 32 bytes`);
  }
  return bytes;
}

function nextPowerOfTwo(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("tree leaf count must be positive");
  }
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

export function isBenchmarkChunkSizeCandidateV1(chunkSize: number): boolean {
  return BENCHMARK_ARTIFACT_CHUNK_SIZE_CANDIDATES_V1.some(
    (candidate) => candidate === chunkSize,
  );
}

export function isRelease1ChunkSize(chunkSize: number): boolean {
  return chunkSize === RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
}

export function artifactChunkCount(
  artifactLength: bigint | number,
  chunkSize: number,
): number {
  const length = typeof artifactLength === "bigint" ? artifactLength : BigInt(artifactLength);
  if (
    length <= 0n ||
    length > BigInt(MAX_ARTIFACT_BYTES_V1) ||
    !isRelease1ChunkSize(chunkSize)
  ) {
    throw new RangeError("invalid Release 1 Merkle parameters");
  }
  const size = BigInt(chunkSize);
  const count = Number((length + size - 1n) / size);
  if (count <= 0 || count > MAX_SELECTED_ARTIFACT_CHUNKS_V1) {
    throw new RangeError("invalid Release 1 artifact chunk count");
  }
  return count;
}

export function artifactChunkCountAllowEmpty(
  artifactLength: bigint | number,
  chunkSize: number,
): number {
  const length = typeof artifactLength === "bigint" ? artifactLength : BigInt(artifactLength);
  return length === 0n ? 0 : artifactChunkCount(length, chunkSize);
}

export function artifactChunkLeafHash(
  chunkIndex: number,
  exactChunk: Uint8Array,
): Buffer {
  const chunk = Buffer.from(exactChunk);
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= MAX_SELECTED_ARTIFACT_CHUNKS_V1 ||
    chunk.length === 0 ||
    chunk.length > RELEASE1_ARTIFACT_CHUNK_SIZE_V1
  ) {
    throw new RangeError("invalid Release 1 artifact leaf");
  }
  return sha256(
    ARTIFACT_CHUNK_LEAF_DOMAIN_V1,
    u32Le(chunkIndex, "chunkIndex"),
    u32Le(chunk.length, "actualChunkLength"),
    chunk,
  );
}

export function artifactChunkNodeHash(
  left: Uint8Array,
  right: Uint8Array,
): Buffer {
  return sha256(
    ARTIFACT_CHUNK_NODE_DOMAIN_V1,
    requireHash(left, "left node"),
    requireHash(right, "right node"),
  );
}

export function artifactChunkEmptyHash(paddedIndex: number): Buffer {
  if (
    !Number.isInteger(paddedIndex) ||
    paddedIndex < 0 ||
    paddedIndex >= MAX_PADDED_ARTIFACT_CHUNKS_V1
  ) {
    throw new RangeError("invalid Release 1 padding index");
  }
  return sha256(
    ARTIFACT_CHUNK_EMPTY_DOMAIN_V1,
    u32Le(paddedIndex, "paddedIndex"),
  );
}

function initialMerkleLevel(artifact: Uint8Array, chunkSize: number): Buffer[] {
  const bytes = Buffer.from(artifact);
  const chunkCount = artifactChunkCount(bytes.length, chunkSize);
  const paddedCount = nextPowerOfTwo(chunkCount);
  const level: Buffer[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, bytes.length);
    level.push(artifactChunkLeafHash(index, bytes.subarray(start, end)));
  }
  for (let index = chunkCount; index < paddedCount; index += 1) {
    level.push(artifactChunkEmptyHash(index));
  }
  return level;
}

function reduceMerkleLevel(initial: readonly Uint8Array[]): Buffer {
  if (initial.length === 0 || (initial.length & (initial.length - 1)) !== 0) {
    throw new RangeError("Merkle level must contain a nonempty power of two");
  }
  let level = initial.map((entry, index) => requireHash(entry, `node ${index}`));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(artifactChunkNodeHash(level[index]!, level[index + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

export function artifactMerkleRoot(
  artifact: Uint8Array,
  chunkSize = RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
): Buffer {
  return reduceMerkleLevel(initialMerkleLevel(artifact, chunkSize));
}

export function artifactMerkleProof(
  artifact: Uint8Array,
  chunkIndex: number,
  chunkSize = RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
): readonly Buffer[] {
  const bytes = Buffer.from(artifact);
  const chunkCount = artifactChunkCount(bytes.length, chunkSize);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
    throw new RangeError("invalid Release 1 proof chunk index");
  }
  let level = initialMerkleLevel(bytes, chunkSize);
  let index = chunkIndex;
  const proof: Buffer[] = [];
  while (level.length > 1) {
    proof.push(Buffer.from(level[index ^ 1]!));
    const next: Buffer[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      next.push(artifactChunkNodeHash(level[cursor]!, level[cursor + 1]!));
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

export function verifyArtifactChunkProof(
  expectedRoot: Uint8Array,
  artifactLength: bigint | number,
  chunkSize: number,
  chunkIndex: number,
  exactChunk: Uint8Array,
  proof: readonly Uint8Array[],
): boolean {
  try {
    const length = typeof artifactLength === "bigint" ? artifactLength : BigInt(artifactLength);
    const chunkCount = artifactChunkCount(length, chunkSize);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
      return false;
    }
    const chunkStart = BigInt(chunkIndex) * BigInt(chunkSize);
    const remaining = length - chunkStart;
    const expectedLength = Number(
      remaining < BigInt(chunkSize) ? remaining : BigInt(chunkSize),
    );
    const chunk = Buffer.from(exactChunk);
    if (chunk.length !== expectedLength) {
      return false;
    }
    const paddedCount = nextPowerOfTwo(chunkCount);
    const expectedDepth = Math.log2(paddedCount);
    if (proof.length !== expectedDepth || proof.length > MAX_ARTIFACT_PROOF_DEPTH_V1) {
      return false;
    }
    let current = artifactChunkLeafHash(chunkIndex, chunk);
    let index = chunkIndex;
    for (let proofLevel = 0; proofLevel < proof.length; proofLevel += 1) {
      const siblingBytes = proof[proofLevel]!;
      const sibling = requireHash(siblingBytes, "proof sibling");
      if (
        !isCanonicalPaddingSibling(
          sibling,
          index,
          proofLevel,
          chunkCount,
          paddedCount,
        )
      ) {
        return false;
      }
      current =
        (index & 1) === 0
          ? artifactChunkNodeHash(current, sibling)
          : artifactChunkNodeHash(sibling, current);
      index >>>= 1;
    }
    return current.equals(requireHash(expectedRoot, "expected root"));
  } catch {
    return false;
  }
}

function isCanonicalPaddingSibling(
  sibling: Buffer,
  nodeIndex: number,
  proofLevel: number,
  chunkCount: number,
  paddedCount: number,
): boolean {
  if (
    !Number.isInteger(proofLevel) ||
    proofLevel < 0 ||
    proofLevel >= MAX_ARTIFACT_PROOF_DEPTH_V1
  ) {
    return false;
  }
  const siblingLeafCount = 2 ** proofLevel;
  const siblingNodeIndex = nodeIndex ^ 1;
  const siblingStart = siblingNodeIndex * siblingLeafCount;
  const siblingEnd = siblingStart + siblingLeafCount;
  if (
    !Number.isSafeInteger(siblingStart) ||
    siblingStart < 0 ||
    siblingEnd > paddedCount
  ) {
    return false;
  }
  if (siblingStart < chunkCount) {
    return true;
  }
  return sibling.equals(
    artifactPaddingSubtreeHash(siblingStart, siblingLeafCount),
  );
}

function artifactPaddingSubtreeHash(
  paddedStart: number,
  paddedLeafCount: number,
): Buffer {
  const paddedEnd = paddedStart + paddedLeafCount;
  if (
    !Number.isSafeInteger(paddedStart) ||
    !Number.isSafeInteger(paddedLeafCount) ||
    paddedStart < 0 ||
    paddedLeafCount <= 0 ||
    (paddedLeafCount & (paddedLeafCount - 1)) !== 0 ||
    paddedStart % paddedLeafCount !== 0 ||
    paddedEnd > MAX_PADDED_ARTIFACT_CHUNKS_V1
  ) {
    throw new RangeError("invalid Release 1 padding subtree");
  }
  const level: Buffer[] = [];
  for (let paddedIndex = paddedStart; paddedIndex < paddedEnd; paddedIndex += 1) {
    level.push(artifactChunkEmptyHash(paddedIndex));
  }
  return reduceMerkleLevel(level);
}

export function validateVerificationBitmapV1(
  bitmapBytes: Uint8Array,
  bitCount: number,
  storedCount: number,
): void {
  const bitmap = Buffer.from(bitmapBytes);
  if (bitmap.length !== VERIFICATION_BITMAP_BYTES_V1) {
    throw new RangeError(
      `verification bitmap must be ${VERIFICATION_BITMAP_BYTES_V1} bytes`,
    );
  }
  if (
    !Number.isInteger(bitCount) ||
    bitCount < 0 ||
    bitCount > MAX_ARTIFACT_CHUNKS_V1 ||
    !Number.isInteger(storedCount) ||
    storedCount < 0 ||
    storedCount > MAX_ARTIFACT_CHUNKS_V1
  ) {
    throw new RangeError("invalid verification bitmap count");
  }
  let actualCount = 0;
  for (const byte of bitmap) {
    let value = byte;
    while (value !== 0) {
      actualCount += value & 1;
      value >>>= 1;
    }
  }
  if (actualCount !== storedCount) {
    throw new Error("verification bitmap count mismatch");
  }
  for (let index = bitCount; index < MAX_ARTIFACT_CHUNKS_V1; index += 1) {
    if ((bitmap[Math.floor(index / 8)]! & (1 << (index % 8))) !== 0) {
      throw new Error("verification bitmap has nonzero unused bits");
    }
  }
}

export function completeVerificationBitmapV1(bitCount: number): Buffer {
  if (
    !Number.isInteger(bitCount) ||
    bitCount < 0 ||
    bitCount > MAX_ARTIFACT_CHUNKS_V1
  ) {
    throw new RangeError("invalid verification bitmap bit count");
  }
  const bitmap = Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1);
  for (let index = 0; index < bitCount; index += 1) {
    bitmap[Math.floor(index / 8)]! |= 1 << (index % 8);
  }
  return bitmap;
}

if (!sha256(ARTIFACT_MERKLE_SCHEME_MATERIAL_V1).equals(ARTIFACT_MERKLE_SCHEME_ID)) {
  throw new Error("Release 1 artifact Merkle scheme id does not match its material");
}
