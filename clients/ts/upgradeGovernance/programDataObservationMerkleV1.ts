import { createHash } from "node:crypto";

export const PROGRAMDATA_OBSERVATION_CHUNK_LEAF_DOMAIN_V1 = Buffer.from(
  "AMOEBA_PROGRAMDATA_OBSERVATION_CHUNK_V1",
  "ascii",
);
export const PROGRAMDATA_OBSERVATION_CHUNK_DOMAIN_V1 =
  PROGRAMDATA_OBSERVATION_CHUNK_LEAF_DOMAIN_V1;
export const PROGRAMDATA_OBSERVATION_NODE_DOMAIN_V1 = Buffer.from(
  "AMOEBA_PROGRAMDATA_OBSERVATION_NODE_V1",
  "ascii",
);
export const PROGRAMDATA_OBSERVATION_EMPTY_DOMAIN_V1 = Buffer.from(
  "AMOEBA_PROGRAMDATA_OBSERVATION_EMPTY_V1",
  "ascii",
);
export const PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_MATERIAL_V1 = Buffer.from(
  "AMOEBA_PROGRAMDATA_OBSERVATION_MERKLE_V1\0AMOEBA_PROGRAMDATA_OBSERVATION_CHUNK_V1\0AMOEBA_PROGRAMDATA_OBSERVATION_NODE_V1\0AMOEBA_PROGRAMDATA_OBSERVATION_EMPTY_V1\0SUBJECT_DIGEST_U32LE_INDEX_U32LE_ACTUAL_LENGTH_U8_PARENT_LEVEL_NEXT_POWER_OF_TWO_ORDERED_FRONTIER",
  "ascii",
);
export const PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1 = Buffer.from(
  "6f7afe51acf1d701bdc5d9de7145de24de10d6d454182dcdc69e68b549242ed2",
  "hex",
);

export const MIN_PROGRAMDATA_ACCOUNT_BYTES_V1 = 45;
export const MAX_PROGRAMDATA_ACCOUNT_BYTES_V1 = 10_485_760;
export const MIN_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 = MIN_PROGRAMDATA_ACCOUNT_BYTES_V1;
export const MAX_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 = MAX_PROGRAMDATA_ACCOUNT_BYTES_V1;
export const PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1 = 16 * 1024;
export const PROGRAMDATA_OBSERVATION_CHUNK_SIZE_32_KIB_V1 = 32 * 1024;
export const PROGRAMDATA_OBSERVATION_CHUNK_SIZE_64_KIB_V1 = 64 * 1024;
export const PROGRAMDATA_OBSERVATION_CHUNK_SIZE_128_KIB_V1 = 128 * 1024;
export const PROGRAMDATA_OBSERVATION_CHUNK_SIZE_CANDIDATES_V1 = Object.freeze([
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_32_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_64_KIB_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_128_KIB_V1,
] as const);
export const MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1 = 640;
export const MAX_PROGRAMDATA_OBSERVATION_PADDED_CHUNKS_V1 = 1024;
export const MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1 = 10;
export const PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1 = 11;
export const MAX_PADDED_PROGRAMDATA_OBSERVATION_CHUNKS_V1 =
  MAX_PROGRAMDATA_OBSERVATION_PADDED_CHUNKS_V1;
export const MAX_PROGRAMDATA_OBSERVATION_TREE_DEPTH_V1 =
  MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1;

export interface ProgramDataObservationFrontierV1 {
  readonly frontier: readonly Buffer[];
  readonly frontierMask: number;
  readonly nextIndex: number;
}

export interface ProgramDataObservationGeometryV1 {
  readonly rawLength: number;
  readonly chunkSize: number;
  readonly chunkCount: number;
  readonly paddedChunkCount: number;
  readonly treeDepth: number;
}

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function requireIntegerInRange(
  value: bigint | number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (typeof value === "bigint") {
    if (value < BigInt(minimum) || value > BigInt(maximum)) {
      throw new RangeError(`${field} must be in [${minimum}, ${maximum}]`);
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function u32Le(value: number, field: string): Buffer {
  const checked = requireIntegerInRange(value, 0, 0xffff_ffff, field);
  const out = Buffer.alloc(4);
  out.writeUInt32LE(checked);
  return out;
}

function requireHash32(value: Uint8Array, field: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new RangeError(`${field} must be exactly 32 bytes`);
  }
  return bytes;
}

function nextPowerOfTwo(value: number): number {
  requireIntegerInRange(
    value,
    1,
    MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1,
    "chunkCount",
  );
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

export function isProgramDataObservationChunkSizeCandidateV1(
  chunkSize: number,
): boolean {
  return PROGRAMDATA_OBSERVATION_CHUNK_SIZE_CANDIDATES_V1.some(
    (candidate) => candidate === chunkSize,
  );
}

export function programDataObservationGeometryV1(
  rawLength: bigint | number,
  chunkSize: number,
): ProgramDataObservationGeometryV1 {
  const length = requireIntegerInRange(
    rawLength,
    MIN_PROGRAMDATA_ACCOUNT_BYTES_V1,
    MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
    "rawLength",
  );
  if (!Number.isSafeInteger(chunkSize) || !isProgramDataObservationChunkSizeCandidateV1(chunkSize)) {
    throw new RangeError("chunkSize must be a ProgramData observation V1 candidate");
  }
  const chunkCount = Math.ceil(length / chunkSize);
  if (chunkCount < 1 || chunkCount > MAX_PROGRAMDATA_OBSERVATION_CHUNKS_V1) {
    throw new RangeError("ProgramData observation chunk count exceeds V1 bounds");
  }
  const paddedChunkCount = nextPowerOfTwo(chunkCount);
  const treeDepth = Math.log2(paddedChunkCount);
  if (
    !Number.isInteger(treeDepth) ||
    treeDepth < 0 ||
    treeDepth > MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1
  ) {
    throw new RangeError("ProgramData observation tree depth exceeds V1 bounds");
  }
  return { rawLength: length, chunkSize, chunkCount, paddedChunkCount, treeDepth };
}

export function programDataObservationChunkCountV1(
  rawLength: bigint | number,
  chunkSize: number,
): number {
  return programDataObservationGeometryV1(rawLength, chunkSize).chunkCount;
}

export function programDataObservationChunkLeafHashV1(
  subjectDigest: Uint8Array,
  chunkIndex: number,
  chunkSize: number,
  exactChunk: Uint8Array,
): Buffer {
  const subject = requireHash32(subjectDigest, "subjectDigest");
  if (!Number.isSafeInteger(chunkSize) || !isProgramDataObservationChunkSizeCandidateV1(chunkSize)) {
    throw new RangeError("chunkSize must be a ProgramData observation V1 candidate");
  }
  const maximumChunkCount = Math.ceil(MAX_PROGRAMDATA_ACCOUNT_BYTES_V1 / chunkSize);
  const index = requireIntegerInRange(
    chunkIndex,
    0,
    maximumChunkCount - 1,
    "chunkIndex",
  );
  const chunk = Buffer.from(exactChunk);
  if (chunk.length < 1 || chunk.length > chunkSize) {
    throw new RangeError(`exactChunk must contain 1 to ${chunkSize} bytes`);
  }
  return sha256(
    PROGRAMDATA_OBSERVATION_CHUNK_LEAF_DOMAIN_V1,
    subject,
    u32Le(index, "chunkIndex"),
    u32Le(chunk.length, "actualChunkLength"),
    chunk,
  );
}

export function programDataObservationNodeHashV1(
  parentLevel: number,
  left: Uint8Array,
  right: Uint8Array,
): Buffer {
  const level = requireIntegerInRange(
    parentLevel,
    1,
    MAX_PROGRAMDATA_OBSERVATION_DEPTH_V1,
    "parentLevel",
  );
  return sha256(
    PROGRAMDATA_OBSERVATION_NODE_DOMAIN_V1,
    Uint8Array.of(level),
    requireHash32(left, "left"),
    requireHash32(right, "right"),
  );
}

export function programDataObservationEmptyHashV1(
  subjectDigest: Uint8Array,
  paddedIndex: number,
): Buffer {
  const index = requireIntegerInRange(
    paddedIndex,
    0,
    MAX_PROGRAMDATA_OBSERVATION_PADDED_CHUNKS_V1 - 1,
    "paddedIndex",
  );
  return sha256(
    PROGRAMDATA_OBSERVATION_EMPTY_DOMAIN_V1,
    requireHash32(subjectDigest, "subjectDigest"),
    u32Le(index, "paddedIndex"),
  );
}

export function createProgramDataObservationFrontierV1(): ProgramDataObservationFrontierV1 {
  return {
    frontier: Array.from(
      { length: PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1 },
      () => Buffer.alloc(32),
    ),
    frontierMask: 0,
    nextIndex: 0,
  };
}

function validateFrontierV1(state: ProgramDataObservationFrontierV1): Buffer[] {
  const nextIndex = requireIntegerInRange(
    state.nextIndex,
    0,
    MAX_PROGRAMDATA_OBSERVATION_PADDED_CHUNKS_V1,
    "nextIndex",
  );
  const mask = requireIntegerInRange(
    state.frontierMask,
    0,
    (1 << PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1) - 1,
    "frontierMask",
  );
  if (mask !== nextIndex) {
    throw new Error("frontierMask must equal the binary decomposition of nextIndex");
  }
  if (state.frontier.length !== PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1) {
    throw new RangeError(
      `frontier must contain ${PROGRAMDATA_OBSERVATION_FRONTIER_SLOTS_V1} slots`,
    );
  }
  return state.frontier.map((entry, level) => {
    const node = requireHash32(entry, `frontier[${level}]`);
    if ((mask & (1 << level)) === 0 && !node.equals(Buffer.alloc(32))) {
      throw new Error(`unused frontier[${level}] must be zero`);
    }
    return node;
  });
}

function appendNodeV1(
  state: ProgramDataObservationFrontierV1,
  node: Uint8Array,
): ProgramDataObservationFrontierV1 {
  const frontier = validateFrontierV1(state);
  const nextIndex = state.nextIndex;
  if (nextIndex >= MAX_PROGRAMDATA_OBSERVATION_PADDED_CHUNKS_V1) {
    throw new RangeError("ProgramData observation frontier is full");
  }
  let current = requireHash32(node, "node");
  let level = 0;
  let mask = state.frontierMask;
  while ((mask & (1 << level)) !== 0) {
    current = programDataObservationNodeHashV1(level + 1, frontier[level]!, current);
    frontier[level] = Buffer.alloc(32);
    mask &= ~(1 << level);
    level += 1;
  }
  frontier[level] = current;
  mask |= 1 << level;
  return { frontier, frontierMask: mask, nextIndex: nextIndex + 1 };
}

export function appendProgramDataObservationChunkV1(
  state: ProgramDataObservationFrontierV1,
  subjectDigest: Uint8Array,
  rawLength: bigint | number,
  chunkSize: number,
  chunkIndex: number,
  exactChunk: Uint8Array,
): ProgramDataObservationFrontierV1 {
  const geometry = programDataObservationGeometryV1(rawLength, chunkSize);
  const index = requireIntegerInRange(
    chunkIndex,
    0,
    geometry.chunkCount - 1,
    "chunkIndex",
  );
  validateFrontierV1(state);
  if (state.nextIndex !== index) {
    throw new Error(`chunkIndex must equal ordered nextIndex ${state.nextIndex}`);
  }
  const expectedLength = Math.min(
    chunkSize,
    geometry.rawLength - index * chunkSize,
  );
  const chunk = Buffer.from(exactChunk);
  if (chunk.length !== expectedLength) {
    throw new RangeError(
      `exactChunk length ${chunk.length} does not equal expected length ${expectedLength}`,
    );
  }
  return appendNodeV1(
    state,
    programDataObservationChunkLeafHashV1(subjectDigest, index, chunkSize, chunk),
  );
}

export function finalizeProgramDataObservationFrontierV1(
  state: ProgramDataObservationFrontierV1,
  subjectDigest: Uint8Array,
  rawLength: bigint | number,
  chunkSize: number,
): Buffer {
  const geometry = programDataObservationGeometryV1(rawLength, chunkSize);
  validateFrontierV1(state);
  if (state.nextIndex !== geometry.chunkCount) {
    throw new Error(
      `cannot finalize before all ${geometry.chunkCount} raw chunks are appended`,
    );
  }
  let paddedState = state;
  for (
    let paddedIndex = geometry.chunkCount;
    paddedIndex < geometry.paddedChunkCount;
    paddedIndex += 1
  ) {
    paddedState = appendNodeV1(
      paddedState,
      programDataObservationEmptyHashV1(subjectDigest, paddedIndex),
    );
  }
  const frontier = validateFrontierV1(paddedState);
  const expectedMask = 1 << geometry.treeDepth;
  if (
    paddedState.nextIndex !== geometry.paddedChunkCount ||
    paddedState.frontierMask !== expectedMask
  ) {
    throw new Error("canonical ProgramData observation padding did not yield one root");
  }
  return Buffer.from(frontier[geometry.treeDepth]!);
}

export function programDataObservationMerkleRootV1(
  rawProgramData: Uint8Array,
  subjectDigest: Uint8Array,
  chunkSize: number,
): Buffer {
  const raw = Buffer.from(rawProgramData);
  const geometry = programDataObservationGeometryV1(raw.length, chunkSize);
  let state = createProgramDataObservationFrontierV1();
  for (let index = 0; index < geometry.chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, raw.length);
    state = appendProgramDataObservationChunkV1(
      state,
      subjectDigest,
      raw.length,
      chunkSize,
      index,
      raw.subarray(start, end),
    );
  }
  return finalizeProgramDataObservationFrontierV1(
    state,
    subjectDigest,
    raw.length,
    chunkSize,
  );
}

export function programDataRawSha256ReceiptV1(rawProgramData: Uint8Array): Buffer {
  const raw = Buffer.from(rawProgramData);
  requireIntegerInRange(
    raw.length,
    MIN_PROGRAMDATA_ACCOUNT_BYTES_V1,
    MAX_PROGRAMDATA_ACCOUNT_BYTES_V1,
    "rawProgramData.length",
  );
  return sha256(raw);
}

if (
  !sha256(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_MATERIAL_V1).equals(
    PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  )
) {
  throw new Error("ProgramData observation Merkle V1 scheme id does not match its material");
}
